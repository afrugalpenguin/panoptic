<#
.SYNOPSIS
    Runs Panoptic in benchmark mode and prints results ready for docs/benchmarks.md.

.PARAMETER Suite
    startup - launch, wait for first paint, sidecar ready and the tree rendered, exit. Repeated -Runs times.
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
    The store (PANOPTIC_STORE) the app reads. Defaults to the dev-seeded store for expand, and to the
    user's own store for the others. Its IntelliSense catalog is kept beside it.

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
    [int]$TimeoutSec = 180
)

$ErrorActionPreference = 'Stop'
if (-not (Test-Path $Exe)) { throw "Panoptic not found at $Exe" }
$Exe = (Resolve-Path $Exe).Path
if ($Suite -eq 'ui') { $Runs = 1 }
if (-not $Store -and $Suite -eq 'expand') { $Store = Join-Path $env:APPDATA 'Panoptic\dev-seeded\store.bin' }
if ($Store) {
    if (-not (Test-Path $Store)) { throw "No store at $Store (scripts\dev-seeded.ps1 -NoLaunch seeds one)" }
    $Store = (Resolve-Path $Store).Path
}

$outDir = Join-Path ([IO.Path]::GetTempPath()) 'panoptic-bench'
New-Item -ItemType Directory -Force $outDir | Out-Null

$results = @()
for ($i = 1; $i -le $Runs; $i++) {
    $out = Join-Path $outDir "$Suite-$i.json"
    Remove-Item $out -ErrorAction SilentlyContinue
    $env:PANOPTIC_BENCH = $Suite
    $env:PANOPTIC_BENCH_OUT = $out
    if ($Store) {
        $env:PANOPTIC_STORE = $Store
        $env:PANOPTIC_CATALOG = Join-Path (Split-Path $Store) 'catalog'
    }
    try {
        $launchEpochMs = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
        $p = Start-Process $Exe -PassThru
    }
    finally {
        Remove-Item Env:PANOPTIC_BENCH, Env:PANOPTIC_BENCH_OUT
        if ($Store) { Remove-Item Env:PANOPTIC_STORE, Env:PANOPTIC_CATALOG }
    }
    if (-not $p.WaitForExit($TimeoutSec * 1000)) {
        Stop-Process -Id $p.Id -Force
        throw "Run $i timed out after $TimeoutSec s"
    }
    if (-not (Test-Path $out)) { throw "Run $i produced no results (exit $($p.ExitCode))" }
    $r = Get-Content $out -Raw | ConvertFrom-Json
    if ($r.error) { throw "Run $i failed: $($r.error)" }
    $r | Add-Member launchEpochMs $launchEpochMs
    $results += $r
    if ($Suite -eq 'startup') {
        Write-Host ("Run {0,2}: launch to paint {1,4} ms, to sidecar ready {2,4} ms, to tree rendered {3,4} ms" -f $i,
            [math]::Round($r.firstPaintEpochMs - $launchEpochMs), [math]::Round($r.sidecarReadyEpochMs - $launchEpochMs),
            [math]::Round($r.treeRenderedEpochMs - $launchEpochMs))
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
Write-Host "Machine: $machine. Exe: $exeShown"
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
