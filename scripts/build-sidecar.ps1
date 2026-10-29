<#
.SYNOPSIS
    Publishes the .NET sidecar to where Tauri expects its externalBin.

.PARAMETER Mode
    aot - Native AOT, self-contained single native exe (default; release builds)
    r2r - self-contained single-file with ReadyToRun
    fdd - framework-dependent, needs the .NET 10 runtime installed (fast dev builds)
#>
param(
    [ValidateSet('aot', 'r2r', 'fdd')]
    [string]$Mode = 'aot'
)

$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $PSScriptRoot
$project = Join-Path $root 'apps\sidecar\Panoptic.Sidecar\Panoptic.Sidecar.csproj'
$binaries = Join-Path $root 'apps\desktop\src-tauri\binaries'
$publishDir = Join-Path $root "apps\sidecar\artifacts\$Mode"
$triple = 'x86_64-pc-windows-msvc'

# Native AOT locates the MSVC linker through vswhere.exe, which is not on PATH by default.
$vsInstaller = Join-Path ${env:ProgramFiles(x86)} 'Microsoft Visual Studio\Installer'
if (-not (Get-Command vswhere.exe -ErrorAction SilentlyContinue) -and (Test-Path $vsInstaller)) {
    $env:Path = "$vsInstaller;$env:Path"
}

$modeArgs = @(switch ($Mode) {
    'aot' { @('-p:PublishAot=true') }
    'r2r' { @('--self-contained', '-p:PublishSingleFile=true', '-p:PublishReadyToRun=true', '-p:IncludeNativeLibrariesForSelfExtract=true') }
    'fdd' { @('--no-self-contained', '-p:PublishSingleFile=true') }
})

Write-Host "Publishing sidecar ($Mode)..."
& dotnet publish $project -c Release -r win-x64 -o $publishDir "-p:PanopticMode=$Mode" @modeArgs --nologo
if ($LASTEXITCODE -ne 0) { throw "dotnet publish failed ($LASTEXITCODE)" }

New-Item -ItemType Directory -Force $binaries | Out-Null
$target = Join-Path $binaries "panoptic-sidecar-$triple.exe"
Copy-Item (Join-Path $publishDir 'panoptic-sidecar.exe') $target -Force

$sizeMb = [math]::Round((Get-Item $target).Length / 1MB, 1)
Write-Host "Sidecar ($Mode, $sizeMb MB) -> $target"
