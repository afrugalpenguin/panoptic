<#
.SYNOPSIS
    Starts local SQL Server 2022 and the Cosmos DB emulator in Docker and seeds both.

.DESCRIPTION
    SQL Server:  127.0.0.1,14333  user sa, password in docker\.env (generated on first run)
    Cosmos:      https://localhost:8081  the emulator's well-known key (printed below)
    Both bind to 127.0.0.1 only. Re-running reseeds.

.PARAMETER Down
    Stop and remove the containers (data volumes are kept).
#>
param([switch]$Down)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$compose = Join-Path $root 'docker\compose.dev.yml'
$envFile = Join-Path $root 'docker\.env'

if ($Down) {
    docker compose -f $compose --env-file $envFile down
    return
}

if (-not (Test-Path $envFile)) {
    $bytes = New-Object byte[] 18
    [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
    $password = 'Pn!' + [Convert]::ToBase64String($bytes).Replace('/', 'x').Replace('+', 'y')
    [IO.File]::WriteAllText($envFile, "PANOPTIC_DEV_SA_PASSWORD=$password`n")
    Write-Host "Generated SA password in $envFile"
}
$password = (Select-String -Path $envFile -Pattern '^PANOPTIC_DEV_SA_PASSWORD=(.+)$').Matches[0].Groups[1].Value

docker compose -f $compose --env-file $envFile up -d
if ($LASTEXITCODE -ne 0) { throw 'docker compose up failed' }

# --- SQL Server ---------------------------------------------------------------
Write-Host 'Waiting for SQL Server...'
$sqlcmd = @('exec', 'panoptic-dev-sql-1', '/opt/mssql-tools18/bin/sqlcmd', '-S', 'localhost', '-U', 'sa', '-P', $password, '-C', '-b')
$deadline = (Get-Date).AddMinutes(2)
$ready = $false
do {
    Start-Sleep -Seconds 3
    # Login fails until SQL Server finishes starting; Windows PowerShell treats that stderr as an error.
    $ErrorActionPreference = 'Continue'
    & docker @sqlcmd -Q 'SELECT 1' 2>&1 | Out-Null
    $ready = $LASTEXITCODE -eq 0
    $ErrorActionPreference = 'Stop'
} until ($ready -or (Get-Date) -gt $deadline)
if (-not $ready) { throw 'SQL Server did not become ready' }

docker cp (Join-Path $root 'docker\seed.sql') panoptic-dev-sql-1:/tmp/seed.sql | Out-Null
& docker @sqlcmd -i /tmp/seed.sql
if ($LASTEXITCODE -ne 0) { throw 'SQL seed failed' }
Write-Host 'SQL Server seeded: Orders, Inventory'

# --- Cosmos emulator (REST API with master-key auth) ---------------------------
$cosmosKey = 'C2y6yDjf5/R+ob0N8A7Cgv30VRDJIWEHLM+4QDU5DE2nQ9nDuVTqobD4b8mGGyPMbIZnqyMsEcaGQy67XIw/Jw=='
$endpoint = 'https://localhost:8081'

Add-Type @'
using System.Net.Http;
public static class PanopticDevHttp {
    public static readonly HttpClient Client = new HttpClient(new HttpClientHandler {
        ServerCertificateCustomValidationCallback = HttpClientHandler.DangerousAcceptAnyServerCertificateValidator });
}
'@ -ReferencedAssemblies System.Net.Http

function Invoke-Cosmos([string]$Method, [string]$ResourceType, [string]$ResourceLink, [string]$Path, $Body, [string]$PartitionKey) {
    $date = [DateTime]::UtcNow.ToString('r')
    $payload = "$($Method.ToLowerInvariant())`n$ResourceType`n$ResourceLink`n$($date.ToLowerInvariant())`n`n"
    $hmac = New-Object Security.Cryptography.HMACSHA256 (, [Convert]::FromBase64String($cosmosKey))
    $sig = [Convert]::ToBase64String($hmac.ComputeHash([Text.Encoding]::UTF8.GetBytes($payload)))
    $request = New-Object Net.Http.HttpRequestMessage ([Net.Http.HttpMethod]::new($Method)), "$endpoint/$Path"
    $request.Headers.Add('authorization', [Uri]::EscapeDataString("type=master&ver=1.0&sig=$sig"))
    $request.Headers.Add('x-ms-date', $date)
    $request.Headers.Add('x-ms-version', '2018-12-31')
    if ($PartitionKey) { $request.Headers.Add('x-ms-documentdb-partitionkey', "[`"$PartitionKey`"]") }
    if ($Body) {
        $request.Content = New-Object Net.Http.StringContent (($Body | ConvertTo-Json -Depth 10 -Compress)), ([Text.Encoding]::UTF8), 'application/json'
    }
    $response = [PanopticDevHttp]::Client.SendAsync($request).GetAwaiter().GetResult()
    $code = [int]$response.StatusCode
    if ($code -ge 400 -and $code -ne 409) {
        throw "Cosmos $Method $Path failed: $code $($response.Content.ReadAsStringAsync().GetAwaiter().GetResult())"
    }
}

Write-Host 'Waiting for Cosmos emulator...'
$deadline = (Get-Date).AddMinutes(3)
while ($true) {
    try { Invoke-Cosmos 'GET' 'dbs' '' 'dbs'; break }
    catch { if ((Get-Date) -gt $deadline) { throw "Cosmos emulator did not become ready: $_" }; Start-Sleep -Seconds 3 }
}

$containers = @{
    'tenants'  = '/tenantId'
    'orders'   = '/tenantId'
    'events'   = '/streamId'
    'settings' = '/scope'
}
Invoke-Cosmos 'POST' 'dbs' '' 'dbs' @{ id = 'panoptic-dev' }
foreach ($name in $containers.Keys) {
    Invoke-Cosmos 'POST' 'colls' 'dbs/panoptic-dev' 'dbs/panoptic-dev/colls' @{ id = $name; partitionKey = @{ paths = @($containers[$name]); kind = 'Hash' } }
}
for ($i = 1; $i -le 25; $i++) {
    $tenant = "t-$($i % 5)"
    Invoke-Cosmos 'POST' 'docs' 'dbs/panoptic-dev/colls/orders' 'dbs/panoptic-dev/colls/orders/docs' `
        @{ id = "order-$i"; tenantId = $tenant; status = @('open', 'closed')[$i % 2]; total = $i * 10.5; lines = @(@{ sku = "SKU-$i"; qty = $i }) } $tenant
}
foreach ($t in 0..4) {
    Invoke-Cosmos 'POST' 'docs' 'dbs/panoptic-dev/colls/tenants' 'dbs/panoptic-dev/colls/tenants/docs' @{ id = "t-$t"; tenantId = "t-$t"; name = "Tenant $t" } "t-$t"
}
Invoke-Cosmos 'POST' 'dbs' '' 'dbs' @{ id = 'audit' }
Invoke-Cosmos 'POST' 'colls' 'dbs/audit' 'dbs/audit/colls' @{ id = 'changes'; partitionKey = @{ paths = @('/entity'); kind = 'Hash' } }
Write-Host 'Cosmos seeded: panoptic-dev (tenants, orders, events, settings), audit (changes)'

Write-Host ''
Write-Host 'Add these in Panoptic:'
Write-Host "  SQL Server   127.0.0.1,14333  SQL auth, user sa, password in $envFile, trust server certificate"
Write-Host "  Cosmos       $endpoint   account key, skip certificate validation (emulator)"
Write-Host "               key: $cosmosKey"
