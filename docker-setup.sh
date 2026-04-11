#!/usr/bin/env bash
# Quick Docker setup script for Browser Dials Server on Linux/macOS

set -e

echo ""
echo "============================================================"
echo "Browser Dials Server - Docker Quick Setup"
echo "============================================================"
echo ""

# Check if Docker is installed
if ! command -v docker &> /dev/null; then
    echo "[ERROR] Docker is not installed"
    echo "Please install Docker from https://docs.docker.com/get-docker/"
    exit 1
fi

# Check if Docker Compose is installed
if ! command -v docker-compose &> /dev/null; then
    echo "[ERROR] Docker Compose is not installed"
    echo "Please install Docker Compose from https://docs.docker.com/compose/install/"
    exit 1
fi

echo "[OK] Docker and Docker Compose found"
echo ""

# Check if .env exists
if [ ! -f .env ]; then
    echo "[INFO] Creating .env from .env.docker template"
    cp .env.docker .env
    echo "[OK] .env created - please edit it with your passwords!"
    echo ""
    read -p "Press Enter to continue..."
fi

echo "[INFO] Starting Docker containers..."
echo ""

docker-compose up -d

echo ""
echo "============================================================"
echo "Docker containers starting..."
echo "============================================================"
echo ""
echo "Services:"
echo "  - Database: browser-dials-db (MariaDB)"
echo "  - Server:   browser-dials-server (Node.js)"
echo ""
echo "Waiting for services to be healthy..."
echo "(This may take 10-30 seconds on first start)"
echo ""

# Wait for services to be healthy
COUNTER=0
MAX_ATTEMPTS=30

while [ $COUNTER -lt $MAX_ATTEMPTS ]; do
    if docker-compose ps | grep -q "healthy"; then
        echo "[OK] All services are healthy!"
        echo ""
        echo "============================================================"
        echo "Setup Complete!"
        echo "============================================================"
        echo ""
        echo "Server is running at: http://localhost:3737"
        echo "Database is accessible at: localhost:3306"
        echo ""
        echo "Next steps:"
        echo "  1. Get your API key: cat .env | grep API_KEY"
        echo "  2. Open the Browser Dials extension settings"
        echo "  3. Enable sync and enter:"
        echo "     - Server: http://localhost:3737"
        echo "     - API Key: (value from .env)"
        echo ""
        echo "Useful commands:"
        echo "  - View logs:        docker-compose logs -f"
        echo "  - Stop:             docker-compose down"
        echo "  - Restart:          docker-compose restart"
        echo "  - Enter DB:         docker exec -it browser-dials-db mysql -u browser_dials -p browser_dials"
        echo ""
        exit 0
    fi
    
    echo "[*] Waiting... $COUNTER/$MAX_ATTEMPTS"
    sleep 1
    COUNTER=$((COUNTER + 1))
done

echo "[WARNING] Services may not be fully healthy yet"
docker-compose ps
echo ""
echo "Check logs with: docker-compose logs -f"
