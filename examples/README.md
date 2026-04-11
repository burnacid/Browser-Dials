# Browser Dials Server - Deployment Examples

This directory contains example configurations for deploying the Browser Dials server using the published Docker image `burnacid/browser-dials-server:latest`.

## Quick Start: Simple Deployment

For development, testing, or small single-user deployments:

```bash
# 1. Copy the simple compose file
cp examples/docker-compose.simple.yml docker-compose.yml

# 2. Create environment file
cp examples/.env.simple .env

# 3. Edit .env with your passwords
nano .env

# 4. Start services
docker-compose up -d

# 5. Create first user
docker-compose exec server node scripts/create-user.js admin password

# 6. Access the API
curl -H "Authorization: Bearer $(cat .env | grep API_KEY | cut -d= -f2)" \
     -H "X-Sync-User: admin" \
     -H "X-Sync-Password: password" \
     http://localhost:3737/api/sync
```

## Production Deployment

For production environments with SSL termination, reverse proxy, and hardened security:

```bash
# 1. Copy the production compose file
cp examples/docker-compose.production.yml docker-compose.yml

# 2. Copy production environment template
cp examples/.env.production .env

# 3. Generate secure secrets
openssl rand -base64 32  # For each password in .env

# 4. Edit .env with generated secrets
nano .env
chmod 600 .env

# 5. Set up SSL certificates
# Option A: Using Let's Encrypt (manual)
certbot certonly --manual -d your-domain.com
# Copy certs to ./certs/

# Option B: Place existing certs in ./certs/ directory:
# ./certs/fullchain.pem
# ./certs/privkey.pem

# 6. Update nginx.conf with your domain
sed -i 's/your-domain.com/your-actual-domain.com/g' examples/nginx.conf

# 7. Copy nginx config
cp examples/nginx.conf nginx.conf

# 8. Start services
docker-compose up -d

# 9. Create first user
docker-compose exec server node scripts/create-user.js admin password

# 10. Verify SSL
curl https://your-domain.com/health
```

## Included Files

### Docker Compose Files

#### `docker-compose.simple.yml`
- **Purpose**: Quick testing and development
- **Services**: MariaDB database + Node.js server
- **Database**: Exposed on localhost:3306 (for dev access)
- **Server**: Exposed on localhost:3737
- **Best for**: Local development, testing, single-user scenarios

#### `docker-compose.production.yml`
- **Purpose**: Production-ready deployment
- **Services**: MariaDB database + Node.js server + nginx reverse proxy
- **Database**: Internal network only (not exposed)
- **Server**: Internal network only (not exposed)
- **Reverse Proxy**: Handles SSL/TLS, rate limiting, security headers
- **Best for**: Production environments, multi-user deployments, public internet access

### Environment Files

#### `.env.simple`
- Minimal configuration for development
- Has reasonable defaults where safe
- Comments explain each variable

#### `.env.production`
- Production security checklist
- All secrets must be replaced before deployment
- Detailed instructions for generating secure values
- Must be kept outside version control

### Nginx Configuration

#### `nginx.conf`
- Production-grade reverse proxy configuration
- SSL/TLS termination
- Security headers (HSTS, CSP, etc.)
- Rate limiting for API and upload endpoints
- Gzip compression
- HTTP to HTTPS redirect

---

## Deployment Scenarios

### Scenario 1: Local Testing
```bash
cp examples/docker-compose.simple.yml docker-compose.yml
cp examples/.env.simple .env
# Edit .env with simple passwords
docker-compose up -d
```

### Scenario 2: Self-Hosted on VPS
```bash
cp examples/docker-compose.production.yml docker-compose.yml
cp examples/.env.production .env
# Generate strong secrets and populate .env
certbot certonly --manual -d mydomain.com
cp examples/nginx.conf nginx.conf
docker-compose up -d
```

### Scenario 3: Docker Swarm or Kubernetes
For orchestrated deployments, adapt the provided compose files:
- Remove `build` context (use published image)
- Remove `container_name` (orchestrator manages naming)
- Use secrets management instead of .env files
- Adjust resource limits as needed

---

## Common Operations

### View Logs
```bash
# All services
docker-compose logs -f

# Specific service
docker-compose logs -f server
docker-compose logs -f db
```

### Connect to Database
```bash
docker-compose exec db mysql -u browser_dials -p browser_dials
```

### Create New User
```bash
docker-compose exec server node scripts/create-user.js username password
```

### Backup Database
```bash
docker-compose exec db mysqldump -u browser_dials -p browser_dials > backup.sql
```

### Update to Latest Image Version
```bash
docker-compose down
docker pull burnacid/browser-dials-server:latest
docker-compose up -d
```

### Stop Services
```bash
docker-compose down       # Stop and remove containers
docker-compose down -v    # Stop and remove containers + volumes
```

---

## Security Considerations

### Required for Production

- [ ] Generate secure random passwords (32+ characters)
- [ ] Use SSL/TLS certificates (self-signed or Let's Encrypt)
- [ ] Keep `.env` file outside version control
- [ ] Set restrictive file permissions: `chmod 600 .env`
- [ ] Use strong API keys (min 32 characters, cryptographically random)
- [ ] Enable nginx security headers (included in `nginx.conf`)
- [ ] Implement database backups
- [ ] Monitor logs and health checks
- [ ] Keep Docker images updated

### Network Security

- **Simple deployment**: Database exposed on localhost only
- **Production deployment**: Database on internal network only, server only accessible through nginx reverse proxy
- Rate limiting enabled on API and upload endpoints
- CORS headers configured as needed

---

## Troubleshooting

### Server can't connect to database
```bash
docker-compose logs db
docker-compose ps  # Check if db is healthy
docker-compose restart server
```

### SSL certificate issues
```bash
# Verify cert is readable
ls -la certs/

# Check certificate expiration
openssl x509 -in certs/fullchain.pem -text -noout | grep -A 2 "Validity"
```

### Port already in use
Edit `.env` and change `SERVER_PORT` or `DB_PORT`:
```env
SERVER_PORT=3738
DB_PORT=3307
```

### Verify API is working
```bash
curl -H "Authorization: Bearer YOUR_API_KEY" \
     -H "X-Sync-User: admin" \
     -H "X-Sync-Password: yourpassword" \
     http://localhost:3737/api/sync
```

---

## Next Steps

1. **Review** the relevant compose file and environment template
2. **Generate** secure credentials
3. **Copy** files to your deployment directory
4. **Edit** configuration for your environment
5. **Test** by bringing up services: `docker-compose up -d`
6. **Verify** health checks pass: `docker-compose ps`
7. **Create** your first user and test the API
8. **Monitor** logs and container health

---

## Support

For issues or questions:
- Check [DEPLOYMENT.md](../DEPLOYMENT.md) for additional setup information
- Review [DOCKER.md](../DOCKER.md) for Docker-specific documentation
- Consult service logs: `docker-compose logs`
- Verify all `.env` variables are set correctly
