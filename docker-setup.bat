@echo off
REM Quick Docker setup script for Browser Dials Server on Windows

setlocal enabledelayedexpansion

echo.
echo ============================================================
echo Browser Dials Server - Docker Quick Setup
echo ============================================================
echo.

REM Check if Docker is installed
docker --version >nul 2>&1
if errorlevel 1 (
    echo [ERROR] Docker is not installed or not in PATH
    echo Please install Docker Desktop from https://www.docker.com/products/docker-desktop
    pause
    exit /b 1
)

docker-compose --version >nul 2>&1
if errorlevel 1 (
    echo [ERROR] Docker Compose is not installed or not in PATH
    echo Please install Docker Desktop which includes Docker Compose
    pause
    exit /b 1
)

echo [OK] Docker and Docker Compose found
echo.

REM Check if .env exists
if not exist ".env" (
    echo [INFO] Creating .env from .env.docker template
    copy .env.docker .env >nul
    echo [OK] .env created - please edit it with your passwords!
    echo.
    pause
)

echo [INFO] Starting Docker containers...
echo.

docker-compose up -d

echo.
echo ============================================================
echo Docker containers starting...
echo ============================================================
echo.
echo Services:
echo   - Database: browser-dials-db (MariaDB)
echo   - Server:   browser-dials-server (Node.js)
echo.
echo Waiting for services to be healthy...
echo (This may take 10-30 seconds on first start)
echo.

REM Wait and check health
setlocal enabledelayedexpansion
for /L %%i in (1,1,30) do (
    docker-compose ps | find "healthy" >nul
    if !errorlevel! equ 0 (
        echo [OK] All services are healthy!
        echo.
        echo ============================================================
        echo Setup Complete!
        echo ============================================================
        echo.
        echo Server is running at: http://localhost:3737
        echo Database is accessible at: localhost:3306
        echo.
        echo Next steps:
        echo   1. Get your API key: type .env and find API_KEY
        echo   2. Open the Browser Dials extension settings
        echo   3. Enable sync and enter:
        echo      - Server: http://localhost:3737
        echo      - API Key: (value from .env)
        echo.
        echo Useful commands:
        echo   - View logs:        docker-compose logs -f
        echo   - Stop:             docker-compose down
        echo   - Restart:          docker-compose restart
        echo   - Enter DB:         docker exec -it browser-dials-db mysql -u browser_dials -p browser_dials
        echo.
        pause
        exit /b 0
    )
    echo [!] Waiting... %%i/30
    timeout /t 1 /nobreak >nul
)

echo [WARNING] Services may not be fully healthy yet
docker-compose ps
echo.
echo Check logs with: docker-compose logs -f
pause
