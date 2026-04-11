$ErrorActionPreference = "Stop"

$version = Read-Host "Enter version (e.g. 1.0.1)"

if ([string]::IsNullOrWhiteSpace($version)) {
    Write-Error "Version cannot be empty."
    exit 1
}

$packageScript = Join-Path (Split-Path -Parent $MyInvocation.MyCommand.Path) "package-extension.ps1"

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
