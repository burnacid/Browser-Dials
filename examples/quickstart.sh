#!/bin/bash
# Browser Dials Server - Quick Setup Script
# For Linux/macOS users deploying from published Docker image
# Usage: ./examples/quickstart.sh [mode]
# Modes: simple (default) or production

set -e

MODE="${1:-simple}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}Browser Dials Server - Quick Setup${NC}"
echo "Mode: $MODE"
echo ""

# Validate Docker and Docker Compose
if ! command -v docker &> /dev/null; then
    echo -e "${RED}✗ Docker not found. Please install Docker.${NC}"
    exit 1
fi

if ! command -v docker-compose &> /dev/null; then
    echo -e "${RED}✗ Docker Compose not found. Please install Docker Compose.${NC}"
    exit 1
fi

echo -e "${GREEN}✓ Docker and Docker Compose found${NC}"

# Copy compose file
if [ "$MODE" = "production" ]; then
    echo -e "${BLUE}Setting up production deployment...${NC}"
    
    if [ ! -f "$PROJECT_DIR/docker-compose.yml" ]; then
        cp "$SCRIPT_DIR/docker-compose.production.yml" "$PROJECT_DIR/docker-compose.yml"
        echo -e "${GREEN}✓ Copied production docker-compose.yml${NC}"
    else
        echo -e "${YELLOW}⚠ docker-compose.yml already exists, skipping copy${NC}"
    fi
    
    if [ ! -f "$PROJECT_DIR/.env" ]; then
        cp "$SCRIPT_DIR/.env.production" "$PROJECT_DIR/.env"
        chmod 600 "$PROJECT_DIR/.env"
        echo -e "${GREEN}✓ Copied production environment file${NC}"
        echo -e "${YELLOW}⚠ IMPORTANT: Edit .env and generate secure secrets!${NC}"
        echo -e "${YELLOW}   Run: openssl rand -base64 32${NC}"
        echo ""
    else
        echo -e "${YELLOW}⚠ .env already exists, skipping copy${NC}"
    fi
    
    if [ ! -f "$PROJECT_DIR/nginx.conf" ]; then
        cp "$SCRIPT_DIR/nginx.conf" "$PROJECT_DIR/nginx.conf"
        echo -e "${GREEN}✓ Copied nginx configuration${NC}"
        echo -e "${YELLOW}⚠ Update your domain in nginx.conf${NC}"
    fi
    
    echo ""
    echo -e "${BLUE}Production Setup Steps:${NC}"
    echo "1. Edit .env with generated secrets (min 32 chars each)"
    echo "2. Place SSL certs in ./certs/ directory:"
    echo "   ./certs/fullchain.pem"
    echo "   ./certs/privkey.pem"
    echo "3. Update domain in nginx.conf"
    echo "4. Start: docker-compose up -d"
    echo "5. Verify: docker-compose ps"
    
else
    # Simple mode (default)
    echo -e "${BLUE}Setting up simple development deployment...${NC}"
    
    if [ ! -f "$PROJECT_DIR/docker-compose.yml" ]; then
        cp "$SCRIPT_DIR/docker-compose.simple.yml" "$PROJECT_DIR/docker-compose.yml"
        echo -e "${GREEN}✓ Copied simple docker-compose.yml${NC}"
    else
        echo -e "${YELLOW}⚠ docker-compose.yml already exists, skipping copy${NC}"
    fi
    
    if [ ! -f "$PROJECT_DIR/.env" ]; then
        cp "$SCRIPT_DIR/.env.simple" "$PROJECT_DIR/.env"
        echo -e "${GREEN}✓ Copied simple environment file${NC}"
        echo -e "${YELLOW}⚠ Edit .env with your desired passwords${NC}"
    else
        echo -e "${YELLOW}⚠ .env already exists, skipping copy${NC}"
    fi
    
    echo ""
    echo -e "${BLUE}Simple Setup Steps:${NC}"
    echo "1. Edit .env with your passwords"
    echo "2. Start: docker-compose up -d"
    echo "3. Wait for services to be healthy: docker-compose ps"
    echo "4. Create user: docker-compose exec server node scripts/create-user.js admin password"
    echo "5. Access API: curl http://localhost:3737/api/sync"
fi

echo ""
echo -e "${GREEN}Setup complete! Next steps:${NC}"
echo "1. Edit .env file"
if [ "$MODE" = "production" ]; then
    echo "2. Set up SSL certificates"
fi
echo "2. Run: cd $PROJECT_DIR && docker-compose up -d"
echo "3. Monitor logs: docker-compose logs -f"
