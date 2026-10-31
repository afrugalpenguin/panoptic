<#
.SYNOPSIS
    Runs `pnpm dev` against a separate, pre-seeded store: Prod, UAT and Test with 20 connections.

.DESCRIPTION
    The sidecar reads its store from PANOPTIC_STORE, so this profile lives in its own file
    (%APPDATA%\Panoptic\dev-seeded\store.bin) and your real store is never read or changed.
    The first run seeds it through the sidecar itself, so it is DPAPI-encrypted like the real one.

    Prod (read-only), UAT and Test hold 20 connections across SQL Server, Synapse, Cosmos and
    PostgreSQL. Names are synthetic (.example.test), so expanding most of them fails fast. Test's
    first three point at the local Docker databases from scripts\dev-db.ps1 and do expand; their
    passwords come from docker\.env when it exists.

.PARAMETER Reset
    Delete the seeded store and seed it again.

.PARAMETER NoLaunch
    Seed only; do not start `pnpm dev`.
#>
param([switch]$Reset, [switch]$NoLaunch)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$profileDir = Join-Path $env:APPDATA 'Panoptic\dev-seeded'
$store = Join-Path $profileDir 'store.bin'
$catalog = Join-Path $profileDir 'catalog'
$project = Join-Path $root 'apps\sidecar\Panoptic.Sidecar'
$envFile = Join-Path $root 'docker\.env'
# The Cosmos emulator's published, well-known key (also in dev-db.ps1). Not a secret.
$cosmosKey = 'C2y6yDjf5/R+ob0N8A7Cgv30VRDJIWEHLM+4QDU5DE2nQ9nDuVTqobD4b8mGGyPMbIZnqyMsEcaGQy67XIw/Jw=='

# pnpm and dotnet installed after this shell started (winget) are only on the registry PATH.
$env:Path = [Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' + [Environment]::GetEnvironmentVariable('Path', 'User')

function Get-DevPassword([string]$name) {
    if (-not (Test-Path $envFile)) { return $null }
    $match = Select-String -Path $envFile -Pattern "^$name=(.+)$"
    if ($match) { $match.Matches[0].Groups[1].Value } else { $null }
}

function New-EnvironmentConfig($id, $name, $color, $readOnly) {
    @{ id = $id; name = $name; color = $color; readOnly = $readOnly; connections = @() }
}

function New-SeedConnection($env, $name, $kind, $endpoint, $auth, $user = $null, $secret = $null, $trust = $false, $database = $null) {
    @{
        environmentId = $env
        secret = $secret
        connection = @{
            id = "seed-$name"; name = $name; kind = $kind; endpoint = $endpoint; auth = $auth
            user = $user; database = $database; tenantId = $null; trustServerCertificate = $trust
        }
    }
}

# Colours and read-only match what import gives these names (apps/desktop/src/app/import-plan.ts).
$environments = @(
    (New-EnvironmentConfig 'seed-prod' 'Prod' '#e03131' $true),
    (New-EnvironmentConfig 'seed-uat' 'UAT' '#f08c00' $false),
    (New-EnvironmentConfig 'seed-test' 'Test' '#1971c2' $false)
)

$sa = Get-DevPassword 'PANOPTIC_DEV_SA_PASSWORD'
$pg = Get-DevPassword 'PANOPTIC_DEV_PG_PASSWORD'
$connections = @(
    # Prod: 7
    (New-SeedConnection 'seed-prod' 'uk-prod-sql-01' 'sql' 'uk-prod-sql-01.example.test' 'sql' 'panoptic_reader'),
    (New-SeedConnection 'seed-prod' 'uk-prod-sql-02' 'sql' 'uk-prod-sql-02.example.test' 'sql' 'panoptic_reader'),
    (New-SeedConnection 'seed-prod' 'uk-prod-sql-03' 'sql' 'uk-prod-sql-03.example.test' 'sql' 'panoptic_reader'),
    (New-SeedConnection 'seed-prod' 'us-prod-sql-01' 'sql' 'us-prod-sql-01.example.test' 'sql' 'panoptic_reader'),
    (New-SeedConnection 'seed-prod' 'prod-synapse' 'synapse' 'prod-synapse-ondemand.sql.example.test' 'sql' 'panoptic_reader'),
    (New-SeedConnection 'seed-prod' 'prod-cosmos' 'cosmos' 'https://prod-cosmos.documents.example.test:443/' 'key'),
    (New-SeedConnection 'seed-prod' 'prod-pg-01' 'postgres' 'prod-pg-01.example.test' 'password' 'panoptic_reader'),
    # UAT: 7
    (New-SeedConnection 'seed-uat' 'uk-uat-sql-01' 'sql' 'uk-uat-sql-01.example.test' 'sql' 'panoptic_reader'),
    (New-SeedConnection 'seed-uat' 'uk-uat-sql-02' 'sql' 'uk-uat-sql-02.example.test' 'sql' 'panoptic_reader'),
    (New-SeedConnection 'seed-uat' 'us-uat-sql-01' 'sql' 'us-uat-sql-01.example.test' 'sql' 'panoptic_reader'),
    (New-SeedConnection 'seed-uat' 'uat-synapse' 'synapse' 'uat-synapse-ondemand.sql.example.test' 'sql' 'panoptic_reader'),
    (New-SeedConnection 'seed-uat' 'uat-cosmos' 'cosmos' 'https://uat-cosmos.documents.example.test:443/' 'key'),
    (New-SeedConnection 'seed-uat' 'uat-pg-01' 'postgres' 'uat-pg-01.example.test' 'password' 'panoptic_reader'),
    (New-SeedConnection 'seed-uat' 'uat-pg-02' 'postgres' 'uat-pg-02.example.test' 'password' 'panoptic_reader'),
    # Test: 6, the first three on the local Docker databases (scripts\dev-db.ps1)
    (New-SeedConnection 'seed-test' 'local-sql' 'sql' '127.0.0.1,14333' 'sql' 'sa' $sa $true),
    (New-SeedConnection 'seed-test' 'local-pg' 'postgres' '127.0.0.1:15432' 'password' 'postgres' $pg $true),
    (New-SeedConnection 'seed-test' 'local-cosmos' 'cosmos' 'https://localhost:8081' 'key' $null $cosmosKey $true),
    (New-SeedConnection 'seed-test' 'test-sql-01' 'sql' 'test-sql-01.example.test' 'sql' 'panoptic_reader'),
    (New-SeedConnection 'seed-test' 'test-sql-02' 'sql' 'test-sql-02.example.test' 'sql' 'panoptic_reader'),
    (New-SeedConnection 'seed-test' 'test-pg-01' 'postgres' 'test-pg-01.example.test' 'password' 'panoptic_reader')
)

# Sends JSON-RPC requests to one sidecar on the seeded store, each after the previous one has answered: the
# sidecar runs requests concurrently, and the store keeps environments and connections in the order saved.
function Invoke-Sidecar([object[]]$requests) {
    $env:PANOPTIC_STORE = $store
    $start = New-Object Diagnostics.ProcessStartInfo 'dotnet', "run --no-build --project `"$project`""
    $start.UseShellExecute = $false
    $start.RedirectStandardInput = $true
    $start.RedirectStandardOutput = $true
    $sidecar = [Diagnostics.Process]::Start($start)
    try {
        $id = 0
        foreach ($r in $requests) {
            $id++
            $sidecar.StandardInput.WriteLine((@{ jsonrpc = '2.0'; id = $id; method = $r.method; params = $r.params } | ConvertTo-Json -Depth 6 -Compress))
            $line = $sidecar.StandardOutput.ReadLine()
            if ($null -eq $line) { throw "The sidecar exited while seeding ($($r.method))." }
            $answer = $line | ConvertFrom-Json
            if ($null -ne $answer.error) { throw "Seeding failed ($($r.method)): $($answer.error.message)" }
        }
    } finally {
        $sidecar.StandardInput.Close()
        $sidecar.WaitForExit()
    }
}

if ($Reset -and (Test-Path $profileDir)) {
    Remove-Item -Recurse -Force $profileDir
    Write-Host "Removed $profileDir"
}

if (-not (Test-Path $store)) {
    if (-not $sa -or -not $pg) { Write-Warning "No docker\.env passwords yet (run scripts\dev-db.ps1): local-sql and local-pg are saved without one." }
    Write-Host 'Building the sidecar...'
    dotnet build $project -v q -nologo | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'Sidecar build failed.' }
    New-Item -ItemType Directory -Force $profileDir | Out-Null
    Invoke-Sidecar (@($environments | ForEach-Object { @{ method = 'config.saveEnvironment'; params = $_ } }) +
        @($connections | ForEach-Object { @{ method = 'config.saveConnection'; params = $_ } }))
    Write-Host "Seeded $store with $($environments.Count) environments and $($connections.Count) connections."
} else {
    Write-Host "Using the seeded store at $store (-Reset to seed it again)."
}

if ($NoLaunch) { return }

$env:PANOPTIC_STORE = $store
$env:PANOPTIC_CATALOG = $catalog
Push-Location $root
try { pnpm dev } finally { Pop-Location }
