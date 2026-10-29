<#
.SYNOPSIS
    Sets the app version everywhere it is declared. Tauri reads it from apps/desktop/package.json.

.EXAMPLE
    .\scripts\set-version.ps1 -Version 0.1.1
#>
param(
    [Parameter(Mandatory)]
    [ValidatePattern('^\d+\.\d+\.\d+$')]
    [string]$Version
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$utf8 = New-Object System.Text.UTF8Encoding $false

$files = @(
    @{ Path = 'apps\desktop\package.json'; Pattern = '(?m)^(  "version": ")[^"]+(")' },
    @{ Path = 'apps\desktop\src-tauri\Cargo.toml'; Pattern = '(?m)^(version = ")[^"]+(")' },
    @{ Path = 'apps\sidecar\Panoptic.Sidecar\Panoptic.Sidecar.csproj'; Pattern = '(<Version>)[^<]+(</Version>)' }
)

foreach ($f in $files) {
    $path = Join-Path $root $f.Path
    $text = [IO.File]::ReadAllText($path)
    $regex = [regex]$f.Pattern
    if (-not $regex.IsMatch($text)) { throw "No version found in $($f.Path)" }
    $text = $regex.Replace($text, "`${1}$Version`${2}", 1)
    [IO.File]::WriteAllText($path, $text, $utf8)
    Write-Host "$($f.Path) -> $Version"
}

Write-Host "Run 'cargo update -p panoptic' in apps\desktop\src-tauri to refresh Cargo.lock, then commit and tag v$Version after merge."
