<#
.SYNOPSIS
    Runs Panoptic in benchmark mode and prints results ready for docs/benchmarks.md.

.PARAMETER Suite
    startup - launch, wait for first paint, sidecar ready and the tree rendered, then -IdleSec later measure the
              memory of the whole process tree and close. Repeated -Runs times.
    ui      - the shipped explorer tree (50k nodes) and result grid (100k rows): mount, expand and
              frame times. Keep the window visible and on top while it runs (about a minute); hidden
              windows throttle frames.
    expand  - expands each connection to this machine (the dev-db containers), then the first
              database and folder under it, timed cold and warm against the 300 ms budget. Uses the
              seeded store by default: run scripts\dev-db.ps1 and scripts\dev-seeded.ps1 -NoLaunch first.
              Keep the window visible: each expand is timed to the tree having painted.

.PARAMETER Exe
    Defaults to the installed copy. Pass the repo build to test without installing.

.PARAMETER Store
    The store the app reads. Defaults to the dev-seeded store for expand, and to the user's own store for the
    others (an empty one if there is none). Every run reads a copy of it in a temp folder (PANOPTIC_STORE), with
    an empty IntelliSense catalog beside it, so a bench never writes to the store it was given and never meets the
    single-instance lock (#241): the shell skips the lock for a run on its own store. The app also gets its own
    WebView2 profile (WEBVIEW2_USER_DATA_FOLDER, kept between benches), so it never shares the browser process of
    an open Panoptic either.

.PARAMETER IdleSec
    startup only: how long after the tree rendered to measure idle memory. 0 skips it and exits at once.

.EXAMPLE
    .\scripts\bench.ps1 -Suite startup -Runs 10
    .\scripts\bench.ps1 -Suite ui -Exe .\apps\desktop\src-tauri\target\release\panoptic.exe
    .\scripts\bench.ps1 -Suite expand -Runs 5
#>
param(
    [ValidateSet('startup', 'ui', 'expand')]
    [string]$Suite = 'startup',
    [int]$Runs = 10,
    [string]$Exe = "$env:LOCALAPPDATA\Panoptic\panoptic.exe",
    [string]$Store,
    [int]$IdleSec = 5,
    [int]$TimeoutSec = 180
)

$ErrorActionPreference = 'Stop'
if (-not (Test-Path $Exe)) { throw "Panoptic not found at $Exe" }
$Exe = (Resolve-Path $Exe).Path
if ($Suite -eq 'ui') { $Runs = 1 }
$measureIdle = $Suite -eq 'startup' -and $IdleSec -gt 0

$outDir = Join-Path ([IO.Path]::GetTempPath()) 'panoptic-bench'
New-Item -ItemType Directory -Force $outDir | Out-Null

# The copy the app reads, made fresh for each bench.
$storeDir = Join-Path $outDir 'store'
Remove-Item $storeDir -Recurse -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force $storeDir | Out-Null
$storeShown = 'empty store'
if ($Store) {
    if (-not (Test-Path $Store)) { throw "No store at $Store" }
    $source = (Resolve-Path $Store).Path
}
elseif ($Suite -eq 'expand') {
    $source = Join-Path $env:APPDATA 'Panoptic\dev-seeded\store.bin'
    if (-not (Test-Path $source)) { throw "No store at $source (scripts\dev-seeded.ps1 -NoLaunch seeds one)" }
}
else {
    $source = Join-Path $env:APPDATA 'Panoptic\store.bin'
    if (-not (Test-Path $source)) { $source = $null }
}
if ($source) {
    Copy-Item $source (Join-Path $storeDir 'store.bin')
    $storeShown = "a copy of $($source.Replace($env:APPDATA, '%APPDATA%').Replace($env:USERPROFILE, '%USERPROFILE%'))"
}

# The app's process tree: the shell, its sidecar and its WebView2 processes (the browser process is the shell's child;
# the renderer, GPU and utility processes are the browser's). Working set and private bytes per process, in bytes.
function Get-TreeMemory([int]$RootId) {
    $all = @(Get-CimInstance Win32_Process -Property ProcessId, ParentProcessId, Name, CommandLine, WorkingSetSize, PrivatePageCount)
    $ids = [Collections.Generic.HashSet[int]]::new()
    [void]$ids.Add($RootId)
    do {
        $added = 0
        foreach ($proc in $all) {
            if (-not $ids.Contains([int]$proc.ProcessId) -and $ids.Contains([int]$proc.ParentProcessId)) {
                [void]$ids.Add([int]$proc.ProcessId)
                $added++
            }
        }
    } while ($added)
    $all | Where-Object { $ids.Contains([int]$_.ProcessId) } | ForEach-Object {
        $type = if ($_.ProcessId -eq $RootId) { 'Shell' }
            elseif ($_.Name -eq 'panoptic-sidecar.exe') { 'Sidecar' }
            elseif ($_.Name -eq 'msedgewebview2.exe') {
                switch -regex ($_.CommandLine) {
                    '--type=renderer' { 'WebView2 renderer'; break }
                    '--type=gpu-process' { 'WebView2 GPU'; break }
                    '--type=utility' { 'WebView2 utility'; break }
                    '--type=([\w-]+)' { "WebView2 $($Matches[1])"; break }
                    default { 'WebView2 browser' }
                }
            }
            else { $_.Name }
        [pscustomobject]@{ Id = [int]$_.ProcessId; Type = $type; WorkingSet = [double]$_.WorkingSetSize; Private = [double]$_.PrivatePageCount }
    }
}

$results = @()
for ($i = 1; $i -le $Runs; $i++) {
    $out = Join-Path $outDir "$Suite-$i.json"
    Remove-Item $out -ErrorAction SilentlyContinue
    $env:PANOPTIC_BENCH = $Suite
    $env:PANOPTIC_BENCH_OUT = $out
    $env:PANOPTIC_STORE = Join-Path $storeDir 'store.bin'
    $env:PANOPTIC_CATALOG = Join-Path $storeDir 'catalog'
    $env:WEBVIEW2_USER_DATA_FOLDER = Join-Path $outDir 'webview'
    if ($measureIdle) { $env:PANOPTIC_BENCH_STAY_OPEN = '1' }
    try {
        $launchEpochMs = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
        $p = Start-Process $Exe -PassThru
    }
    finally {
        Remove-Item Env:PANOPTIC_BENCH, Env:PANOPTIC_BENCH_OUT, Env:PANOPTIC_STORE, Env:PANOPTIC_CATALOG, Env:WEBVIEW2_USER_DATA_FOLDER
        Remove-Item Env:PANOPTIC_BENCH_STAY_OPEN -ErrorAction SilentlyContinue
    }
    $memory = $null
    if ($measureIdle) {
        # The app writes its results once the tree has rendered and stays open, so it can be measured idle.
        $deadline = [DateTime]::UtcNow.AddSeconds($TimeoutSec)
        while (-not (Test-Path $out) -and -not $p.HasExited -and [DateTime]::UtcNow -lt $deadline) { Start-Sleep -Milliseconds 100 }
        if (Test-Path $out) {
            Start-Sleep -Seconds $IdleSec
            $memory = @(Get-TreeMemory $p.Id)
        }
        $tree = @(if ($memory) { $memory.Id } else { $p.Id })
        [void]$p.CloseMainWindow()
        if (-not $p.WaitForExit(10000)) { $tree | ForEach-Object { Stop-Process -Id $_ -Force -ErrorAction SilentlyContinue } }
    }
    if (-not $p.WaitForExit($TimeoutSec * 1000)) {
        Stop-Process -Id $p.Id -Force
        throw "Run $i timed out after $TimeoutSec s"
    }
    if (-not (Test-Path $out)) { throw "Run $i produced no results (exit $($p.ExitCode))" }
    $r = Get-Content $out -Raw | ConvertFrom-Json
    if ($r.error) { throw "Run $i failed: $($r.error)" }
    $r | Add-Member launchEpochMs $launchEpochMs
    $r | Add-Member memory $memory
    $results += $r
    if ($Suite -eq 'startup') {
        $idle = if ($memory) { ", idle working set {0} MB" -f [math]::Round(($memory | Measure-Object WorkingSet -Sum).Sum / 1MB) } else { '' }
        Write-Host ("Run {0,2}: launch to paint {1,4} ms, to sidecar ready {2,4} ms, to tree rendered {3,4} ms{4}" -f $i,
            [math]::Round($r.firstPaintEpochMs - $launchEpochMs), [math]::Round($r.sidecarReadyEpochMs - $launchEpochMs),
            [math]::Round($r.treeRenderedEpochMs - $launchEpochMs), $idle)
        Start-Sleep -Seconds 2
    }
    if ($Suite -eq 'expand') {
        $slowest = ($r.steps | Measure-Object coldMs -Maximum).Maximum
        Write-Host ("Run {0,2}: {1} expands, slowest cold {2} ms" -f $i, @($r.steps).Count, $slowest)
        Start-Sleep -Seconds 2
    }
}

$cpu = (Get-CimInstance Win32_Processor | Select-Object -First 1).Name.Trim()
$ramGb = [math]::Round((Get-CimInstance Win32_ComputerSystem).TotalPhysicalMemory / 1GB)
$os = Get-CimInstance Win32_OperatingSystem
$version = (Get-Item $Exe).VersionInfo.ProductVersion
# Hardware only, and the exe path without the user name: this output is pasted into the public repo.
$machine = "$cpu, $ramGb GB, Windows $($os.Version)"
$exeShown = $Exe.Replace($env:LOCALAPPDATA, '%LOCALAPPDATA%').Replace($env:USERPROFILE, '%USERPROFILE%')

Write-Host ""
Write-Host "### $Suite, $(Get-Date -Format 'yyyy-MM-dd'), Panoptic $version"
Write-Host ""
$sidecarExe = Join-Path (Split-Path $Exe) 'panoptic-sidecar.exe'
$sidecarShown = if (Test-Path $sidecarExe) { "{0:N1} MB" -f ((Get-Item $sidecarExe).Length / 1MB) } else { 'not found' }
Write-Host "Machine: $machine. Exe: $exeShown. Sidecar on disk: $sidecarShown. Store: $storeShown."
Write-Host ""

# The middle value; for an even count, the mean of the two middle values.
function Get-Median($values) {
    $s = @($values | Sort-Object)
    $mid = [math]::Floor($s.Count / 2)
    if ($s.Count % 2) { return $s[$mid] }
    return ($s[$mid - 1] + $s[$mid]) / 2
}

if ($Suite -eq 'startup') {
    $paint = $results | ForEach-Object { [math]::Round($_.firstPaintEpochMs - $_.launchEpochMs) }
    $ready = $results | ForEach-Object { [math]::Round($_.sidecarReadyEpochMs - $_.launchEpochMs) }
    $sidecar = $results | ForEach-Object { $_.sidecarStartupMs }
    Write-Host "| Metric | Run 1 (coldest) | Median of $Runs | Max |"
    Write-Host "| --- | --- | --- | --- |"
    Write-Host ("| Launch to first paint (ms) | {0} | {1} | {2} |" -f $paint[0], (Get-Median $paint), ($paint | Measure-Object -Maximum).Maximum)
    Write-Host ("| Launch to sidecar ready (ms) | {0} | {1} | {2} |" -f $ready[0], (Get-Median $ready), ($ready | Measure-Object -Maximum).Maximum)
    $tree = $results | ForEach-Object { [math]::Round($_.treeRenderedEpochMs - $_.launchEpochMs) }
    Write-Host ("| Launch to tree rendered (ms) | {0} | {1} | {2} |" -f $tree[0], (Get-Median $tree), ($tree | Measure-Object -Maximum).Maximum)
    Write-Host ("| Sidecar process start to ready (ms, {3}) | {0} | {1} | {2} |" -f $sidecar[0], (Get-Median $sidecar), ($sidecar | Measure-Object -Maximum).Maximum, $results[0].sidecarMode)
    $measured = @($results | Where-Object { $_.memory })
    if ($measured.Count) {
        $mb = { param($bytes) [math]::Round($bytes / 1MB, 1) }
        $total = @($measured | ForEach-Object { & $mb ($_.memory | Measure-Object WorkingSet -Sum).Sum })
        Write-Host ("| Idle working set, whole process tree (MB) | {0} | {1} | {2} |" -f $total[0], (Get-Median $total), ($total | Measure-Object -Maximum).Maximum)
        Write-Host ""
        # Per process type. Working sets are summed, so pages shared between processes count once per process.
        Write-Host "Idle memory $IdleSec s after the tree rendered, $($measured.Count) runs. Working set is the sum over the processes of that type; private bytes are not shared."
        Write-Host ""
        Write-Host "| Process | Count | Working set, run 1 (MB) | Working set, median (MB) | Private bytes, median (MB) |"
        Write-Host "| --- | --- | --- | --- | --- |"
        $order = 'Shell', 'Sidecar', 'WebView2 browser', 'WebView2 renderer', 'WebView2 GPU', 'WebView2 utility'
        $types = @($measured | ForEach-Object { $_.memory.Type } | Select-Object -Unique |
            Sort-Object { $at = [array]::IndexOf($order, $_); if ($at -lt 0) { 99 } else { $at } }, { $_ })
        foreach ($type in @($types) + 'Total') {
            $of = { param($run) @($run.memory | Where-Object { $type -eq 'Total' -or $_.Type -eq $type }) }
            $ws = @($measured | ForEach-Object { & $mb ((& $of $_) | Measure-Object WorkingSet -Sum).Sum })
            $private = @($measured | ForEach-Object { & $mb ((& $of $_) | Measure-Object Private -Sum).Sum })
            $count = @(& $of $measured[0]).Count
            Write-Host ("| {0} | {1} | {2} | {3} | {4} |" -f $type, $count, $ws[0], (Get-Median $ws), (Get-Median $private))
        }
    }
}
elseif ($Suite -eq 'expand') {
    # Steps line up across runs: each run walks the same connections down the same first children.
    $steps = @($results[0].steps)
    $engines = ($steps | ForEach-Object { $_.engine } | Select-Object -Unique) -join ', '
    Write-Host "$Runs runs, one process each, so every cold connection expand includes connecting. Engines: $engines. Budget 300 ms."
    Write-Host ""
    Write-Host "| Engine | Expand | Cold median (ms) | Cold max (ms) | Warm median (ms) | Children | Within 300 ms |"
    Write-Host "| --- | --- | --- | --- | --- | --- | --- |"
    for ($k = 0; $k -lt $steps.Count; $k++) {
        $s = $steps[$k]
        $label = "$($s.kind): $($s.path -join ' > ')"
        $all = @($results | ForEach-Object { @($_.steps)[$k] } | Where-Object { $_ })
        $ok = @($all | Where-Object { -not $_.error })
        if ($ok.Count -eq 0) {
            Write-Host "| $($s.engine) | $label | failed: $($all[0].error) | | | | |"
            continue
        }
        $cold = @($ok | ForEach-Object { $_.coldMs })
        $warm = @($ok | ForEach-Object { $_.warmMs })
        $max = ($cold | Measure-Object -Maximum).Maximum
        $within = if ($max -le 300) { 'yes' } elseif ((Get-Median $cold) -le 300) { 'median only' } else { 'no' }
        if ($ok.Count -lt $all.Count) { $within += " ($($all.Count - $ok.Count) failed)" }
        Write-Host ("| {0} | {1} | {2} | {3} | {4} | {5} | {6} |" -f $s.engine, $label, (Get-Median $cold), $max, (Get-Median $warm), $s.children, $within)
    }
}
else {
    Write-Host $results[0].markdown
}

Write-Host ""
Write-Host "Raw JSON: $outDir"
