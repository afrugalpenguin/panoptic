<#
.SYNOPSIS
    Generates Panoptic's changelog from git tags and the change fragments in changes/ (docs/changelog.md).

.DESCRIPTION
    For each v* tag, in numeric version order, the section lists the fragments added under changes/
    since the previous tag (the first tag counts from the root commit), read as they were at that tag.
    Fragments are grouped Added, Changed, Fixed, Removed. Needs full history and tags.
    If git or tags are unavailable, writes a minimal file and exits 0: a build must never fail over this.

.PARAMETER Head
    Version being built now (no tag yet). Adds a section for fragments added since the latest tag.

.PARAMETER Latest
    Output only the newest section's body, without its heading (for the GitHub release body).

.PARAMETER Out
    Write to this file (UTF-8 without BOM, LF). Default is stdout.

.EXAMPLE
    .\scripts\changelog.ps1 -Head 0.3.0 -Out apps\desktop\src-tauri\CHANGELOG.md
    .\scripts\changelog.ps1 -Head 0.3.0 -Latest -Out notes.md
#>
param(
    [string]$Head,
    [switch]$Latest,
    [string]$Out
)

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding $false
$root = Split-Path -Parent $PSScriptRoot
$categories = @('Added', 'Changed', 'Fixed', 'Removed')

# Runs git and returns its output lines, or $null on any failure. Native stderr must not become a
# terminating error under Windows PowerShell 5.1, so errors are checked by exit code instead.
function Invoke-Git([string[]]$GitArgs) {
    $previous = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try {
        $output = & git -C $root @GitArgs 2>$null
        if ($LASTEXITCODE -ne 0) { return $null }
        return @($output)
    }
    catch { return $null }
    finally { $ErrorActionPreference = $previous }
}

function Write-Result([string]$Text) {
    $Text = $Text.Replace("`r`n", "`n")
    if ($Out) {
        $path = if ([IO.Path]::IsPathRooted($Out)) { $Out } else { Join-Path (Get-Location) $Out }
        [IO.File]::WriteAllText($path, $Text, (New-Object System.Text.UTF8Encoding $false))
    }
    else {
        [Console]::Out.Write($Text)
    }
}

function Get-Fragments([string]$From, [string]$To) {
    $files = Invoke-Git @('diff', '--name-only', '--diff-filter=A', $From, $To, '--', 'changes/')
    if ($null -eq $files) { return @() }
    $result = @()
    foreach ($file in $files) {
        if ($file -notmatch '^changes/[^/]+\.md$' -or $file -ieq 'changes/README.md') { continue }
        $content = Invoke-Git @('show', "${To}:$file")
        if ($null -eq $content) { continue }
        $text = (($content -join "`n").Trim())
        if ($text) { $result += $text }
    }
    return $result
}

# One bullet per fragment, grouped by category. The category label is kept, normalised, because the
# section has no sub-headings; a fragment without a recognised prefix is listed under Changed.
function Format-Section([string]$Version, [string]$Date, [string[]]$Fragments, [string]$Empty) {
    $groups = @{}
    foreach ($c in $categories) { $groups[$c] = @() }
    foreach ($fragment in $Fragments) {
        $category = 'Changed'
        $body = $fragment
        if ($fragment -match '^(?i)(added|changed|fixed|removed)\s*:\s*(?s)(.*)$') {
            $category = (Get-Culture).TextInfo.ToTitleCase($Matches[1].ToLowerInvariant())
            $body = $Matches[2].Trim()
        }
        $lines = $body -split "`n" | ForEach-Object { $_.TrimEnd() }
        $groups[$category] += , ("- ${category}: " + (($lines | Select-Object -First 1)) + (($lines | Select-Object -Skip 1 | ForEach-Object { "`n  $_" }) -join ''))
    }
    $bullets = foreach ($c in $categories) { $groups[$c] }
    $heading = if ($Date) { "## v$Version ($Date)" } else { "## v$Version" }
    $bodyText = if (@($bullets).Count -gt 0) { ($bullets -join "`n") } else { $Empty }
    return [pscustomobject]@{ Heading = $heading; Body = $bodyText }
}

function Write-Changelog($Sections) {
    if ($Latest) {
        Write-Result ($Sections[0].Body + "`n")
        return
    }
    $parts = @('# Panoptic changelog') + ($Sections | ForEach-Object { "$($_.Heading)`n`n$($_.Body)" })
    Write-Result (($parts -join "`n`n") + "`n")
}

$today = [DateTime]::UtcNow.ToString('yyyy-MM-dd')
$fallback = {
    $version = if ($Head) { $Head } else { '0.0.0' }
    Write-Changelog @([pscustomobject]@{ Heading = "## v$version ($today)"; Body = 'No release history available.' })
}

$tagLines = Invoke-Git @('tag', '--list', 'v*')
if ($null -eq $tagLines -or $tagLines.Count -eq 0) { & $fallback; exit 0 }

# Numeric version order, oldest first; anything that is not vMAJOR.MINOR.PATCH is ignored.
$tags = $tagLines |
    Where-Object { $_ -match '^v(\d+)\.(\d+)\.(\d+)$' } |
    ForEach-Object { [pscustomobject]@{ Tag = $_; Version = [version]($_.Substring(1)) } } |
    Sort-Object Version
if (@($tags).Count -eq 0) { & $fallback; exit 0 }

$rootCommit = (Invoke-Git @('rev-list', '--max-parents=0', 'HEAD')) | Select-Object -Last 1
if (-not $rootCommit) { & $fallback; exit 0 }

$sections = New-Object System.Collections.ArrayList
$previous = $rootCommit
foreach ($t in $tags) {
    $stamp = (Invoke-Git @('log', '-1', '--format=%ct', $t.Tag)) | Select-Object -First 1
    $date = if ($stamp) { [DateTimeOffset]::FromUnixTimeSeconds([long]$stamp).UtcDateTime.ToString('yyyy-MM-dd') } else { '' }
    [void]$sections.Insert(0, (Format-Section $t.Version.ToString() $date (Get-Fragments $previous $t.Tag) 'No user-facing changes.'))
    $previous = $t.Tag
}

if ($Head -and -not ($tags | Where-Object { $_.Version -eq [version]$Head })) {
    [void]$sections.Insert(0, (Format-Section $Head $today (Get-Fragments $previous 'HEAD') 'No user-facing changes.'))
}

Write-Changelog $sections
