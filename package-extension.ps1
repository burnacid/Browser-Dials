param(
    [string]$Version,
    [switch]$KeepStaging
)

$ErrorActionPreference = "Stop"

if ([string]::IsNullOrWhiteSpace($Version)) {
    $Version = Read-Host "Enter extension version (e.g. 1.0.1)"
}

if ([string]::IsNullOrWhiteSpace($Version)) {
    throw "Version cannot be empty."
}

if ($Version -notmatch '^\d+(\.\d+){0,3}$') {
    throw "Version must use Chromium extension format: 1 to 4 dot-separated integers."
}

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$extensionDir = Join-Path $scriptDir "extension"
$manifestPath = Join-Path $extensionDir "manifest.json"
$distDir = Join-Path $scriptDir "dist"
$stagingDir = Join-Path $distDir "browser-dials-extension-$Version"
$zipPath = Join-Path $distDir "browser-dials-extension-$Version.zip"

if (-not (Test-Path $manifestPath)) {
    throw "Extension manifest not found at $manifestPath"
}

Write-Host "`nPackaging extension version $Version ..." -ForegroundColor Cyan

New-Item -ItemType Directory -Path $distDir -Force | Out-Null

if (Test-Path $stagingDir) {
    Remove-Item $stagingDir -Recurse -Force
}

if (Test-Path $zipPath) {
    Remove-Item $zipPath -Force
}

New-Item -ItemType Directory -Path $stagingDir -Force | Out-Null
Copy-Item (Join-Path $extensionDir '*') $stagingDir -Recurse -Force

$manifest = Get-Content $manifestPath -Raw | ConvertFrom-Json
$manifest.version = $Version
$manifest | ConvertTo-Json -Depth 10 | Set-Content (Join-Path $stagingDir "manifest.json") -Encoding utf8

Push-Location $stagingDir
try {
    Compress-Archive -Path * -DestinationPath $zipPath -Force
}
finally {
    Pop-Location
}

if (-not $KeepStaging) {
    Remove-Item $stagingDir -Recurse -Force
}

Write-Host "Extension package created at $zipPath" -ForegroundColor Green