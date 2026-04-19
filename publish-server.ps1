$ErrorActionPreference = "Stop"

$version = Read-Host "Enter version (e.g. 1.0.1)"

if ([string]::IsNullOrWhiteSpace($version)) {
    Write-Error "Version cannot be empty."
    exit 1
}

function Set-JsonVersion {
    param(
        [string]$Path,
        [string]$Version
    )

    if (-not (Test-Path $Path)) {
        throw "JSON file not found at $Path"
    }

    $json = Get-Content $Path -Raw | ConvertFrom-Json
    $json.version = $Version
    $json | ConvertTo-Json -Depth 10 | Set-Content $Path -Encoding utf8
}

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$rootPackageJson = Join-Path $scriptDir "package.json"
$serverPackageJson = Join-Path $scriptDir "server\package.json"
$extensionManifestJson = Join-Path $scriptDir "extension\manifest.json"

Write-Host "`nUpdating package versions ..." -ForegroundColor Cyan
try {
    Set-JsonVersion -Path $rootPackageJson -Version $version
    Set-JsonVersion -Path $serverPackageJson -Version $version
    Set-JsonVersion -Path $extensionManifestJson -Version $version
}
catch {
    Write-Error "Failed to update package versions: $($_.Exception.Message)"
    exit 1
}

$packageScript = Join-Path $scriptDir "package-extension.ps1"

Write-Host "`nPackaging extension release artifact ..." -ForegroundColor Cyan
try {
    & $packageScript -Version $version
}
catch {
    Write-Error "Extension packaging failed: $($_.Exception.Message)"
    exit 1
}

$image = "burnacid/browser-dials-server"

Write-Host "`nBuilding $image`:$version ..." -ForegroundColor Cyan
docker build -t "$image`:$version" -t "$image`:latest" .
if ($LASTEXITCODE -ne 0) { Write-Error "Build failed."; exit 1 }

Write-Host "`nPushing $image`:$version ..." -ForegroundColor Cyan
docker push "$image`:$version"
if ($LASTEXITCODE -ne 0) { Write-Error "Push failed."; exit 1 }

Write-Host "`nPushing $image`:latest ..." -ForegroundColor Cyan
docker push "$image`:latest"
if ($LASTEXITCODE -ne 0) { Write-Error "Push failed."; exit 1 }

Write-Host "`nBuilding and pushing multi-platform image ..." -ForegroundColor Cyan
docker buildx build --platform linux/amd64,linux/arm64 -t "$image`:$version" -t "$image`:latest" --push .
if ($LASTEXITCODE -ne 0) { Write-Error "Buildx failed."; exit 1 }

Write-Host "`nDone! Packaged the extension and published $image`:$version and $image`:latest" -ForegroundColor Green
