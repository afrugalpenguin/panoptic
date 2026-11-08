<#
.SYNOPSIS
    Reports the sidecar and frontend build sizes against their budgets, and times sidecar start-up.

.DESCRIPTION
    Run after a release-mode build of both: scripts\build-sidecar.ps1 (jit, as releases build it) and
    pnpm --filter @panoptic/desktop build. Prints a Markdown table, appends it to the GitHub job summary when
    there is one, and fails if a size is over its budget. Sizes are the same on every machine for the same
    commit, so they can gate a pull request; the timing is reported for information only, because shared
    CI runners are too noisy to gate on. docs/benchmarks.md (Budgets) explains each budget.

.PARAMETER PingRuns
    How many times to start the sidecar and time its first ping. 0 skips the timing.

.EXAMPLE
    .\scripts\check-sizes.ps1
#>
param(
    [int]$PingRuns = 10
)

$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $PSScriptRoot
$sidecar = Join-Path $root 'apps\desktop\src-tauri\binaries\panoptic-sidecar-x86_64-pc-windows-msvc.exe'
$dist = Join-Path $root 'apps\desktop\dist'
if (-not (Test-Path $sidecar)) { throw "No sidecar at $sidecar (scripts\build-sidecar.ps1 builds it)" }
if (-not (Test-Path (Join-Path $dist 'index.html'))) { throw "No frontend build in $dist (pnpm --filter @panoptic/desktop build)" }

# Budgets: the size on 2026-11-08 plus about 10% (20% for the small start-up JS), so a dependency bump passes, while a
# new runtime, SDK or bundled library has to raise its budget on purpose, in the same pull request, with
# docs/benchmarks.md (Budgets).
$budgets = [ordered]@{
    'Sidecar (jit, self-contained single file)' = 112MB
    'Frontend JS, all chunks and workers' = 4250KB
    'Frontend JS, all, gzipped' = 1125KB
    'Frontend JS loaded at start' = 300KB
    'Frontend CSS' = 210KB
    'Frontend CSS, gzipped' = 40KB
}

function Get-GzipBytes([string]$Path) {
    $bytes = [IO.File]::ReadAllBytes($Path)
    $buffer = [IO.MemoryStream]::new()
    $gzip = [IO.Compression.GZipStream]::new($buffer, [IO.Compression.CompressionLevel]::Optimal, $true)
    $gzip.Write($bytes, 0, $bytes.Length)
    $gzip.Dispose()
    return $buffer.Length
}

$files = @(Get-ChildItem $dist -Recurse -File)
$js = @($files | Where-Object Extension -eq '.js')
$css = @($files | Where-Object Extension -eq '.css')
# The scripts index.html loads before first paint: its module entry and the chunks it preloads.
$html = Get-Content (Join-Path $dist 'index.html') -Raw
$startNames = @([regex]::Matches($html, '(?:src|href)="/?([^"]+\.js)"') | ForEach-Object { $_.Groups[1].Value })
$startJs = @($startNames | ForEach-Object { Get-Item (Join-Path $dist $_) })

$sum = { param($list) [double](($list | Measure-Object Length -Sum).Sum) }
$gzipSum = { param($list) [double](($list | ForEach-Object { Get-GzipBytes $_.FullName } | Measure-Object -Sum).Sum) }
$measured = [ordered]@{
    'Sidecar (jit, self-contained single file)' = (Get-Item $sidecar).Length
    'Frontend JS, all chunks and workers' = & $sum $js
    'Frontend JS, all, gzipped' = & $gzipSum $js
    'Frontend JS loaded at start' = & $sum $startJs
    'Frontend CSS' = & $sum $css
    'Frontend CSS, gzipped' = & $gzipSum $css
}

# MB (1,048,576 bytes) with one decimal from 10 MB up, KB (1,024 bytes) below.
function Format-Size([double]$Bytes) {
    if ($Bytes -ge 10MB) { return '{0:N1} MB' -f ($Bytes / 1MB) }
    return '{0:N0} KB' -f ($Bytes / 1KB)
}

$lines = @('### Build sizes', '', '| Item | Size | Budget | Within |', '| --- | --- | --- | --- |')
$over = @()
foreach ($item in $measured.Keys) {
    $within = if ($measured[$item] -le $budgets[$item]) { 'yes' } else { $over += $item; '**no**' }
    $lines += "| $item | $(Format-Size $measured[$item]) | $(Format-Size $budgets[$item]) | $within |"
}
$lines += ''
$lines += "$($js.Count) JS and $($css.Count) CSS files; loaded at start: $($startNames -join ', ')."

if ($PingRuns -gt 0) {
    # Each start is a new process on an empty store, timed from Process.Start to the ping response on stdout. The
    # sidecar's own number (startupMs) runs from its process start to reading stdin. Run 1 includes extracting the
    # bundled native libraries if this sidecar has never run here.
    $work = Join-Path ([IO.Path]::GetTempPath()) "panoptic-size-check-$PID"
    New-Item -ItemType Directory -Force $work | Out-Null
    $wall = @()
    $own = @()
    try {
        for ($i = 1; $i -le $PingRuns; $i++) {
            $info = [Diagnostics.ProcessStartInfo]::new($sidecar)
            $info.UseShellExecute = $false
            $info.RedirectStandardInput = $true
            $info.RedirectStandardOutput = $true
            $info.RedirectStandardError = $true
            $info.Environment['PANOPTIC_STORE'] = Join-Path $work 'store.bin'
            $info.Environment['PANOPTIC_CATALOG'] = Join-Path $work 'catalog'
            $clock = [Diagnostics.Stopwatch]::StartNew()
            $proc = [Diagnostics.Process]::Start($info)
            $proc.StandardInput.WriteLine('{"jsonrpc":"2.0","id":1,"method":"ping"}')
            $line = $proc.StandardOutput.ReadLine()
            $clock.Stop()
            $proc.StandardInput.Close()
            if (-not $proc.WaitForExit(10000)) { $proc.Kill() }
            $result = ($line | ConvertFrom-Json).result
            if (-not $result) { throw "Ping run $i got no result: $line" }
            $wall += [math]::Round($clock.Elapsed.TotalMilliseconds, 1)
            $own += [math]::Round([double]$result.startupMs, 1)
        }
    }
    finally {
        Remove-Item $work -Recurse -Force -ErrorAction SilentlyContinue
    }
    $median = { param($values) $s = @($values | Sort-Object); $m = [math]::Floor($s.Count / 2); if ($s.Count % 2) { $s[$m] } else { ($s[$m - 1] + $s[$m]) / 2 } }
    $lines += ''
    $lines += "### Sidecar start-up, for information ($PingRuns starts, not a gate)"
    $lines += ''
    $lines += '| Metric | Run 1 | Median |'
    $lines += '| --- | --- | --- |'
    $lines += "| Process start to ping response (ms) | $($wall[0]) | $(& $median $wall) |"
    $lines += "| Sidecar's own start to ready (ms, $($result.mode)) | $($own[0]) | $(& $median $own) |"
}

$report = $lines -join "`n"
Write-Host $report
if ($env:GITHUB_STEP_SUMMARY) { Add-Content $env:GITHUB_STEP_SUMMARY $report -Encoding utf8 }

if ($over) { throw "Over budget: $($over -join '; '). Shrink it, or raise the budget in scripts\check-sizes.ps1 and docs\benchmarks.md with the reason." }
