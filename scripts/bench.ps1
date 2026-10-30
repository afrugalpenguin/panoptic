<#
.SYNOPSIS
    Runs Panoptic in benchmark mode and prints results ready for docs/benchmarks.md.

.PARAMETER Suite
    startup - launch, wait for first paint and sidecar ready, exit. Repeated -Runs times.
    ui      - 50k-node tree and 100k-row grid frame times, plain TS vs Svelte 5. Keep the window
              visible and on top while it runs (about a minute); hidden windows throttle frames.

.PARAMETER Exe
    Defaults to the installed copy. Pass the repo build to test without installing.

.EXAMPLE
    .\scripts\bench.ps1 -Suite startup -Runs 10
    .\scripts\bench.ps1 -Suite ui -Exe .\apps\desktop\src-tauri\target\release\panoptic.exe
#>
param(
    [ValidateSet('startup', 'ui')]
    [string]$Suite = 'startup',
    [int]$Runs = 10,
    [string]$Exe = "$env:LOCALAPPDATA\Panoptic\panoptic.exe",
    [int]$TimeoutSec = 180
)

$ErrorActionPreference = 'Stop'
if (-not (Test-Path $Exe)) { throw "Panoptic not found at $Exe" }
$Exe = (Resolve-Path $Exe).Path
if ($Suite -eq 'ui') { $Runs = 1 }

$outDir = Join-Path ([IO.Path]::GetTempPath()) 'panoptic-bench'
New-Item -ItemType Directory -Force $outDir | Out-Null

$results = @()
for ($i = 1; $i -le $Runs; $i++) {
    $out = Join-Path $outDir "$Suite-$i.json"
    Remove-Item $out -ErrorAction SilentlyContinue
    $env:PANOPTIC_BENCH = $Suite
    $env:PANOPTIC_BENCH_OUT = $out
    try {
        $launchEpochMs = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
        $p = Start-Process $Exe -PassThru
    }
    finally {
        Remove-Item Env:PANOPTIC_BENCH, Env:PANOPTIC_BENCH_OUT
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
        Write-Host ("Run {0,2}: launch to paint {1,4} ms, launch to sidecar ready {2,4} ms" -f $i,
            [math]::Round($r.firstPaintEpochMs - $launchEpochMs), [math]::Round($r.sidecarReadyEpochMs - $launchEpochMs))
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

function Get-Median($values) {
    $s = @($values | Sort-Object)
    return $s[[math]::Floor($s.Count / 2)]
}

if ($Suite -eq 'startup') {
    $paint = $results | ForEach-Object { [math]::Round($_.firstPaintEpochMs - $_.launchEpochMs) }
    $ready = $results | ForEach-Object { [math]::Round($_.sidecarReadyEpochMs - $_.launchEpochMs) }
    $sidecar = $results | ForEach-Object { $_.sidecarStartupMs }
    Write-Host "| Metric | Run 1 (coldest) | Median of $Runs | Max |"
    Write-Host "| --- | --- | --- | --- |"
    Write-Host ("| Launch to first paint (ms) | {0} | {1} | {2} |" -f $paint[0], (Get-Median $paint), ($paint | Measure-Object -Maximum).Maximum)
    Write-Host ("| Launch to sidecar ready (ms) | {0} | {1} | {2} |" -f $ready[0], (Get-Median $ready), ($ready | Measure-Object -Maximum).Maximum)
    Write-Host ("| Sidecar process start to ready (ms, {3}) | {0} | {1} | {2} |" -f $sidecar[0], (Get-Median $sidecar), ($sidecar | Measure-Object -Maximum).Maximum, $results[0].sidecarMode)
}
else {
    $r = $results[0]
    $names = $r.medians.PSObject.Properties.Name
    Write-Host "Medians of $($r.rounds) rounds. $($r.treeNodes) tree nodes, $($r.gridRows) grid rows, $($r.scrollMs / 1000) s scroll. Display $($r.refreshHz) Hz, DPR $($r.devicePixelRatio), viewport $($r.viewport)."
    Write-Host ""
    Write-Host "| Metric | $($names -join ' | ') |"
    Write-Host "| --- |$(' --- |' * $names.Count)"
    $row = {
        param($label, $pick)
        Write-Host "| $label | $(($names | ForEach-Object { & $pick $r.medians.$_ }) -join ' | ') |"
    }
    & $row 'Tree mount (ms)' { param($m) $m.treeMountMs }
    & $row 'Tree expand all (ms)' { param($m) $m.treeExpandAllMs }
    & $row 'Tree collapse all (ms)' { param($m) $m.treeCollapseAllMs }
    & $row 'Tree scroll frame ms p50/p95/p99/max' { param($m) "$($m.treeScroll.p50) / $($m.treeScroll.p95) / $($m.treeScroll.p99) / $($m.treeScroll.max)" }
    & $row 'Tree scroll frames >25 / >33 ms' { param($m) "$($m.treeScroll.over25) / $($m.treeScroll.over33) of $($m.treeScroll.frames)" }
    & $row 'Grid mount (ms)' { param($m) $m.gridMountMs }
    & $row 'Grid scroll frame ms p50/p95/p99/max' { param($m) "$($m.gridScroll.p50) / $($m.gridScroll.p95) / $($m.gridScroll.p99) / $($m.gridScroll.max)" }
    & $row 'Grid scroll frames >25 / >33 ms' { param($m) "$($m.gridScroll.over25) / $($m.gridScroll.over33) of $($m.gridScroll.frames)" }
}

Write-Host ""
Write-Host "Raw JSON: $outDir"
