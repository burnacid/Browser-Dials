# Browser Dials Server - Docker Deployment Guide

## Quick Start with Published Image

The easiest way to get started is using example deployment configurations that use the published Docker image `burnacid/browser-dials-server:latest`.

### For Development/Testing (Simple)

```bash
# Linux/macOS
./examples/quickstart.sh simple

# Windows
.\examples\quickstart.ps1 -Mode simple

# Then:
nano .env          # Edit your passwords
docker-compose up -d
```

### For Production (With SSL & Reverse Proxy)

```bash
# Linux/macOS
./examples/quickstart.sh production

# Windows
.\examples\quickstart.ps1 -Mode production

# Then:
nano .env               # Generate & set secrets
certbot certonly ...    # Get SSL certs
docker-compose up -d
```

See [examples/README.md](examples/README.md) for complete deployment scenarios and configurations.

### Files Created

1. **Dockerfile** - Multi-stage build for the Node.js server
   - Uses Alpine Linux for minimal size
   - Includes health checks
   - Production-optimized

2. **docker-compose.yml** - Orchestrates two services:
   - **db**: MariaDB 11.4 (Alpine) with auto-schema initialization
   - **server**: Node.js Express server

3. **.env.docker** - Docker environment template
   - Copy to `.env` and customize with your passwords
   - Includes all required configuration

4. **.dockerignore** - Optimizes Docker build context

5. **DOCKER.md** - Comprehensive Docker documentation
   - Quick start guide
   - Common commands
   - Troubleshooting
   - Security notes

6. **docker-setup.bat** - Windows quick-start script
7. **docker-setup.sh** - Linux/macOS quick-start script

## Quick Start

### Windows

```bash
# 1. Run the setup script
.\docker-setup.bat

# Or manually:
# 1. Copy environment template
copy .env.docker .env

# 2. Edit .env with your passwords

# 3. Start everything
docker-compose up -d
```

### Linux/macOS

```bash
# 1. Make script executable
chmod +x docker-setup.sh

# 2. Run the setup script
./docker-setup.sh

# Or manually:
# 1. Copy environment template
cp .env.docker .env

# 2. Edit .env with your passwords

# 3. Start everything
docker-compose up -d
```

## Database Details

### Current Setup: MariaDB 11.4 (Recommended)

- **Image**: `mariadb:11.4-alpine`
- **Container**: `browser-dials-db`
- **Port**: 3306
- **Persistence**: Docker volume `db-data`
- **Auto-initialization**: Schema from `server/schema.sql`

**Why MariaDB?**
- Drop-in replacement for MySQL
- Smaller Alpine image
- Better performance
- Open source
- Fully compatible with current schema

### Alternative Option: SQLite

To use SQLite instead (single-file database, no separate container):

1. **Install SQLite support in server**:
   ```bash
   cd server
   npm install better-sqlite3
   cd ..
   ```

2. **Update server/db.js** to use SQLite:
   ```javascript
   const Database = require('better-sqlite3');
   const path = require('path');
   
   const db = new Database(path.join(__dirname, 'browser_dials.db'));
   
   module.exports = {
     query: async (sql, params) => {
       return db.prepare(sql).all(...(params || []));
     },
     // ... other methods
   };
   ```

3. **Remove database service from docker-compose.yml**:
   - Remove the entire `db:` service
   - Remove `browser-dials-net` network
   - Update `server:` to not depend on `db`

4. **Rebuild**:
   ```bash
   docker-compose down
   docker-compose up -d --build
   ```

**SQLite Pros:**
- No separate database container
- Simpler deployment
- Good for single-user/low-traffic scenarios

**SQLite Cons:**
- Limited concurrency
- No remote access
- Harder to scale

## Configuration

### Essential Environment Variables (.env)

```env
# Database Credentials
DB_USER=browser_dials
DB_PASS=your-secure-password
DB_ROOT_PASS=your-root-password

# API Security
API_KEY=generate-with-openssl-rand-base64-32

# Server Port
SERVER_PORT=3737

# Node Environment
NODE_ENV=production
```

### Generate Secure API Key

**Windows (PowerShell)**:
```powershell
[convert]::ToBase64String((1..32 | % {[byte](Get-Random -Max 256)})) | Out-String
```

**Linux/macOS**:
```bash
openssl rand -base64 32
```

## Accessing Services

### Server API
```bash
curl http://localhost:3737/api/sync
# Returns: {"message":"Unauthorized"} (expected without API key)
```

### Database Console
```bash
# MariaDB
docker exec -it browser-dials-db mysql -u browser_dials -p browser_dials

# Once logged in, you can:
# SHOW TABLES;
# INSERT INTO profiles VALUES (...);
# SELECT * FROM profiles;
```

### Server Logs
```bash
docker-compose logs -f server
```

### All Logs
```bash
docker-compose logs -f
```

## Common Operations

### Stop Everything
```bash
docker-compose down
```

### Stop and Remove Data
```bash
docker-compose down -v
```

### Rebuild After Code Changes
```bash
docker-compose build --no-cache
docker-compose up -d
```

### Restart a Service
```bash
docker-compose restart server
docker-compose restart db
```

### Access Container Shell
```bash
docker exec -it browser-dials-server sh
```

### View Container Status
```bash
docker-compose ps
```

## Volumes

### db-data
- **Purpose**: Stores MariaDB database files
- **Persistence**: Yes (survives container restart)
- **Location**: Managed by Docker (varies by OS)

### uploads
- **Purpose**: Stores user uploads
- **Location**: `/app/uploads` inside container
- **Persistence**: Yes

## Production Checklist

- [ ] Use strong, random passwords in `.env`
- [ ] Use a random 32+ character API key
- [ ] Don't commit `.env` to git (it's in `.gitignore`)
- [ ] Set `NODE_ENV=production`
- [ ] Use a reverse proxy (nginx, Traefik) for SSL/TLS
- [ ] Enable database backups
- [ ] Monitor logs and health status
- [ ] Keep Docker images updated
- [ ] Use private networks in production
- [ ] Consider managed database services for reliability

## Extension Configuration

Once the server is running:

1. Open Browser Dials extension settings
2. Find the Sync section
3. Enter:
   - **Server URL**: `http://localhost:3737` (or your server's IP/domain)
   - **API Key**: (from your `.env` file's `API_KEY` value)
4. Click Save
5. Dials should now sync to the server

## Troubleshooting

### Containers won't start
```bash
docker-compose logs
```

Check for error messages, most commonly:
- Port already in use: Change `SERVER_PORT` in `.env`
- Not enough memory: Check Docker Desktop settings

### Server can't connect to database
```bash
docker-compose restart server
```

MariaDB may take longer to initialize on first start. Wait 10-15 seconds.

### Permission errors on Windows
- Ensure Docker Desktop is running
- Run terminal as Administrator
- Check Docker resource limits

### Database initialization failed
- Verify `server/schema.sql` exists and is readable
- Check MariaDB logs: `docker-compose logs db`
- Manually create schema access container: see DOCKER.md

(See DOCKER.md for more troubleshooting tips)

## Next Steps

1. Run one of the setup scripts or manually start: `docker-compose up -d`
2. Wait for services to report "healthy" status
3. Configure the extension with your API key
4. Test by syncing dials between instances
5. Read DOCKER.md for detailed documentation

## Support Files

- **DOCKER.md** - Complete Docker documentation
- **docker-compose.yml** - Service configuration
- **Dockerfile** - Server image definition
- **.env.docker** - Environment template
- **server/schema.sql** - Database schema (auto-loaded)

Enjoy your containerized Browser Dials server!
