<#
.SYNOPSIS
    Fails unless the release for a version has every asset the updater and users need.

.DESCRIPTION
    The release workflow runs this against its draft before publishing it. Expected names come from
    productName in tauri.conf.json and the NSIS bundle naming: the setup.exe, its .sig, latest.json
    and the portable zip. Each must be present, fully uploaded and non-empty. Throws on any gap, so
    the workflow step fails and the release stays a draft.

.PARAMETER AssetsFile
    Optional JSON in the shape of 'gh release view --json assets', to check a fabricated asset list
    instead of the live release.

.EXAMPLE
    .\scripts\check-release-assets.ps1 -Version 0.2.25
#>
param(
    [Parameter(Mandatory)]
    [ValidatePattern('^\d+\.\d+\.\d+$')]
    [string]$Version,
    [string]$AssetsFile
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot

$product = (Get-Content (Join-Path $root 'apps\desktop\src-tauri\tauri.conf.json') -Raw | ConvertFrom-Json).productName
$expected = @(
    "${product}_${Version}_x64-setup.exe",
    "${product}_${Version}_x64-setup.exe.sig",
    'latest.json',
    "${product}_${Version}_x64-portable.zip"
)

if ($AssetsFile) {
    $json = Get-Content $AssetsFile -Raw
} else {
    $json = gh release view "v$Version" --json assets | Out-String
    if ($LASTEXITCODE -ne 0) { throw "Could not read release v$Version" }
}
$assets = @(($json | ConvertFrom-Json).assets)

$problems = foreach ($name in $expected) {
    $asset = $assets | Where-Object { $_.name -eq $name } | Select-Object -First 1
    if (-not $asset) { "missing $name" }
    elseif ($asset.state -ne 'uploaded') { "$name is $($asset.state), not uploaded" }
    elseif ($asset.size -le 0) { "$name is empty" }
}

if ($problems) {
    throw "Release v$Version is incomplete: $($problems -join '; ')"
}
Write-Host "Release v$Version has all $($expected.Count) assets: $($expected -join ', ')"
