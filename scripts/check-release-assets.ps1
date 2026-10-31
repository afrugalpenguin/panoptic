<#
.SYNOPSIS
    Fails unless the release for a version has every asset the updater and users need.

.DESCRIPTION
    The release workflow runs this against its draft before publishing it. Expected names come from
    productName in tauri.conf.json and the NSIS bundle naming: the setup.exe, its .sig, latest.json
    and the portable zip. Each must be present, fully uploaded and non-empty. Throws on any gap, so
    the workflow step fails and the release stays a draft.

    It then checks that latest.json matches what it ships: its version is this one, every platform's
    url is the setup.exe asset (by asset API URL or download name), and every signature is the .sig
    file's content. A mismatch would not install a bad file (the updater verifies the signature), but
    it would break updates for everyone.

.PARAMETER AssetsFile
    Optional JSON in the shape of 'gh release view --json assets', to check a fabricated asset list
    instead of the live release.

.PARAMETER LatestJsonFile
    Optional local latest.json to check instead of downloading the release's.

.PARAMETER SignatureFile
    Optional local setup.exe.sig to compare against instead of downloading the release's.

.EXAMPLE
    .\scripts\check-release-assets.ps1 -Version 0.2.25
#>
param(
    [Parameter(Mandatory)]
    [ValidatePattern('^\d+\.\d+\.\d+$')]
    [string]$Version,
    [string]$AssetsFile,
    [string]$LatestJsonFile,
    [string]$SignatureFile
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

# latest.json must describe this release's installer.
$setupName = $expected[0]
$setup = $assets | Where-Object { $_.name -eq $setupName } | Select-Object -First 1
if (-not ($LatestJsonFile -and $SignatureFile)) {
    $download = Join-Path ([IO.Path]::GetTempPath()) "panoptic-release-check-$([guid]::NewGuid().ToString('N'))"
    New-Item -ItemType Directory -Path $download | Out-Null
    gh release download "v$Version" --pattern latest.json --pattern "$setupName.sig" --dir $download
    if ($LASTEXITCODE -ne 0) { throw "Could not download latest.json and the signature of v$Version" }
    if (-not $LatestJsonFile) { $LatestJsonFile = Join-Path $download 'latest.json' }
    if (-not $SignatureFile) { $SignatureFile = Join-Path $download "$setupName.sig" }
}
$latest = Get-Content $LatestJsonFile -Raw | ConvertFrom-Json
$signature = (Get-Content $SignatureFile -Raw).Trim()

$mismatches = @()
if ($latest.version -ne $Version) { $mismatches += "latest.json says version $($latest.version)" }
$platforms = @($latest.platforms.PSObject.Properties)
if ($platforms.Count -eq 0) { $mismatches += 'latest.json lists no platforms' }
foreach ($p in $platforms) {
    $url = [string]$p.Value.url
    $isSetup = ($setup.apiUrl -and $url -eq $setup.apiUrl) -or $url.EndsWith("/$setupName")
    if (-not $isSetup) { $mismatches += "latest.json $($p.Name) url is not $setupName ($url)" }
    if (([string]$p.Value.signature).Trim() -ne $signature) { $mismatches += "latest.json $($p.Name) signature is not $setupName.sig" }
}
if ($mismatches) {
    throw "Release v$Version latest.json does not match its installer: $($mismatches -join '; ')"
}
Write-Host "latest.json matches $setupName for $($platforms.Count) platform(s)"
