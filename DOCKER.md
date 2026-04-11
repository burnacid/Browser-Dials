# Docker Setup for Browser Dials Server

This guide explains how to run the Browser Dials server and MariaDB database in Docker containers.

## Prerequisites

- Docker (version 20+)
- Docker Compose (version 2.0+)
- Git

## Quick Start

### 1. Clone and Navigate

```bash
cd d:\Workspace\Browser-Dials
```

### 2. Configure Environment

Copy the Docker environment file:

```bash
cp .env.docker .env
```

**Edit `.env` and customize:**

```env
DB_PASS=your-secure-password
DB_ROOT_PASS=your-root-password
API_KEY=your-generated-secret
```

Generate a secure API key:

```bash
# Windows (PowerShell)
$env:TEMP | % {powershell -Command "[convert]::ToBase64String((1..32 | % {[byte](Get-Random -Max 256)})) | Out-String"}

# Linux/Mac
openssl rand -base64 32
```

### 3. Start Services

```bash
# Build and start all containers
docker-compose up -d

# View logs
docker-compose logs -f

# Check service status
docker-compose ps
```

### 4. Verify Setup

The MariaDB database will auto-initialize with the schema from `server/schema.sql`.

Check that both services are healthy:

```bash
docker-compose ps
```

Status should show:
- `browser-dials-db`: healthy ✓
- `browser-dials-server`: healthy ✓

Access the server API:

```bash
curl http://localhost:3737/api/sync
# Should return: {"message":"Unauthorized"}
```

## Services

### Database (MariaDB)

- **Container name:** `browser-dials-db`
- **Host:** `localhost`
- **Port:** `3306`
- **Database:** `browser_dials`
- **User:** `browser_dials`
- **Data persisted in:** Docker volume `db-data`

**Connect to database:**

```bash
docker exec -it browser-dials-db mysql -u browser_dials -p browser_dials
# Enter password when prompted
```

### Server (Node.js)

- **Container name:** `browser-dials-server`
- **Host:** `localhost`
- **Port:** `3737`
- **Uploads persisted in:** Docker volume `uploads`

**View server logs:**

```bash
docker-compose logs -f server
```

## Common Commands

### Stop Services

```bash
docker-compose down
```

### Stop and Remove Data

```bash
docker-compose down -v
```

### Rebuild After Code Changes

```bash
docker-compose down
docker-compose up -d --build
```

### View Database Logs

```bash
docker-compose logs -f db
```

### Access Server Container

```bash
docker exec -it browser-dials-server sh
```

## Switching Databases

The current setup uses **MariaDB 11.4**. To use a different database:

### Option 1: Use MySQL Instead

Edit `docker-compose.yml`, change the db image:

```yaml
db:
  image: mysql:8.0-alpine  # Instead of mariadb:11.4-alpine
```

### Option 2: Use SQLite (Single Container)

For SQLite, you'll need to:

1. Install SQLite support in server:
   ```bash
   npm install --save better-sqlite3  # in server/ directory
   ```

2. Update `server/db.js` to use SQLite instead of MySQL

3. Create SQLite initialization script in `server/`

4. Update `docker-compose.yml` to not include a database service

Currently, the setup is configured for **MariaDB/MySQL** via the connection pool in `server/db.js`. To switch databases requires code changes to the server.

## Volumes

### `db-data`

Stores MariaDB database files. Persists between container restarts.

### `uploads`

Stores user uploads. Mounted at `/app/uploads` in the server container.

## Networks

Services communicate over the `browser-dials-net` bridge network. The hostname `db` is used internally for database connections.

## Troubleshooting

### Server can't connect to database

```bash
# Check if db is healthy
docker-compose ps

# View database logs
docker-compose logs db
```

**Solution:** Wait 10-15 seconds for MariaDB to fully start, then restart server:

```bash
docker-compose restart server
```

### Permission denied errors on Windows

Ensure Docker Desktop is running and has necessary permissions.

### Port already in use

Change ports in `.env`:

```env
SERVER_PORT=3738
DB_PORT=3307
```

Then restart:

```bash
docker-compose down
docker-compose up -d
```

### Database not initializing

The schema file is auto-imported from `server/schema.sql`. Check:

1. File exists and is readable
2. No syntax errors in SQL
3. View initialization logs: `docker-compose logs db | grep -i schema`

## Extension Configuration

1. Get the API key from `.env`
2. Open the extension settings
3. Set the sync server to: `http://localhost:3737`
4. Enter the API key from `.env` (`API_KEY` value)
5. Save settings

## Production Deployment

For production, consider:

- Use environment-specific `.env` files
- Enable SSL/TLS with a reverse proxy (nginx, Traefik)
- Set `NODE_ENV=production`
- Use strong, randomly-generated API keys
- Implement backup strategy for database volumes
- Monitor container health and logs
- Use managed database services if possible

## Security Notes

- Change all default passwords in `.env`
- Generate a strong API key (32+ characters)
- Don't commit `.env` to version control
- Use private networks in production
- Enable authentication on database access
- Keep Docker images updated
