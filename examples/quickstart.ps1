#!/usr/bin/env pwsh
# Browser Dials Server - Quick Setup Script (PowerShell)
# For Windows users deploying from published Docker image
# Usage: .\examples\quickstart.ps1 [-Mode simple|production]

param(
    [ValidateSet("simple", "production")]
    [string]$Mode = "simple"
)

$ErrorActionPreference = "Stop"

# Colors
$Colors = @{
    Red    = "Red"
    Green  = "Green"
    Yellow = "Yellow"
    Blue   = "Cyan"
}

function Write-Status {
    param([string]$Message, [string]$Color = "White")
    Write-Host $Message -ForegroundColor $Color
}

Write-Status "Browser Dials Server - Quick Setup" -Color $Colors.Blue
Write-Status "Mode: $Mode" -Color $Colors.Blue
Write-Host ""

# Validate Docker
try {
    $null = docker --version
    Write-Status "✓ Docker found" -Color $Colors.Green
}
catch {
    Write-Status "✗ Docker not found. Please install Docker Desktop." -Color $Colors.Red
    exit 1
}

try {
    $null = docker-compose --version
    Write-Status "✓ Docker Compose found" -Color $Colors.Green
}
catch {
    Write-Status "✗ Docker Compose not found. Please install Docker Desktop." -Color $Colors.Red
    exit 1
}

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$ProjectDir = Split-Path -Parent $ScriptDir

# Copy files based on mode
if ($Mode -eq "production") {
    Write-Status "Setting up production deployment..." -Color $Colors.Blue
    
    $ComposeFile = Join-Path $ProjectDir "docker-compose.yml"
    if (-not (Test-Path $ComposeFile)) {
        Copy-Item (Join-Path $ScriptDir "docker-compose.production.yml") $ComposeFile
        Write-Status "✓ Copied production docker-compose.yml" -Color $Colors.Green
    }
    else {
        Write-Status "⚠ docker-compose.yml already exists, skipping" -Color $Colors.Yellow
    }
    
    $EnvFile = Join-Path $ProjectDir ".env"
    if (-not (Test-Path $EnvFile)) {
        Copy-Item (Join-Path $ScriptDir ".env.production") $EnvFile
        Write-Status "✓ Copied production environment file" -Color $Colors.Green
        Write-Status "⚠ IMPORTANT: Edit .env and generate secure secrets!" -Color $Colors.Yellow
        Write-Status "   Generate with: [convert]::ToBase64String((1..32 | % {[byte](Get-Random -Max 256)}))" -Color $Colors.Yellow
    }
    else {
        Write-Status "⚠ .env already exists, skipping" -Color $Colors.Yellow
    }
    
    $NginxFile = Join-Path $ProjectDir "nginx.conf"
    if (-not (Test-Path $NginxFile)) {
        Copy-Item (Join-Path $ScriptDir "nginx.conf") $NginxFile
        Write-Status "✓ Copied nginx configuration" -Color $Colors.Green
        Write-Status "⚠ Update your domain in nginx.conf" -Color $Colors.Yellow
    }
    
    Write-Host ""
    Write-Status "Production Setup Steps:" -Color $Colors.Blue
    Write-Host "1. Edit .env with generated secrets (min 32 chars each)"
    Write-Host "2. Place SSL certificates in .\certs\ directory:"
    Write-Host "   .\certs\fullchain.pem"
    Write-Host "   .\certs\privkey.pem"
    Write-Host "3. Update domain in nginx.conf"
    Write-Host "4. Start: docker-compose up -d"
    Write-Host "5. Verify: docker-compose ps"
}
else {
    # Simple mode (default)
    Write-Status "Setting up simple development deployment..." -Color $Colors.Blue
    
    $ComposeFile = Join-Path $ProjectDir "docker-compose.yml"
    if (-not (Test-Path $ComposeFile)) {
        Copy-Item (Join-Path $ScriptDir "docker-compose.simple.yml") $ComposeFile
        Write-Status "✓ Copied simple docker-compose.yml" -Color $Colors.Green
    }
    else {
        Write-Status "⚠ docker-compose.yml already exists, skipping" -Color $Colors.Yellow
    }
    
    $EnvFile = Join-Path $ProjectDir ".env"
    if (-not (Test-Path $EnvFile)) {
        Copy-Item (Join-Path $ScriptDir ".env.simple") $EnvFile
        Write-Status "✓ Copied simple environment file" -Color $Colors.Green
        Write-Status "⚠ Edit .env with your desired passwords" -Color $Colors.Yellow
    }
    else {
        Write-Status "⚠ .env already exists, skipping" -Color $Colors.Yellow
    }
    
    Write-Host ""
    Write-Status "Simple Setup Steps:" -Color $Colors.Blue
    Write-Host "1. Edit .env with your passwords"
    Write-Host "2. Start: docker-compose up -d"
    Write-Host "3. Wait for services: docker-compose ps"
    Write-Host "4. Create user: docker-compose exec server node scripts/create-user.js admin password"
    Write-Host "5. Test API: curl http://localhost:3737/api/sync"
}

Write-Host ""
Write-Status "Setup complete! Next steps:" -Color $Colors.Green
Write-Host "1. Edit .env file"
if ($Mode -eq "production") {
    Write-Host "2. Place SSL certificates in .\certs\"
}
Write-Host "3. Run: cd '$ProjectDir' && docker-compose up -d"
Write-Host "4. Monitor: docker-compose logs -f"
