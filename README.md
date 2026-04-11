# Browser Dials

A Chromium browser extension that replaces the new tab page with a customizable speed-dial dashboard. Works fully offline (local-only mode) or syncs with a self-hosted server.

---

## Features

- Speed-dial grid on every new tab
- Multiple named **profiles** to organize your dials
- **Local-only** storage — no account required
- Optional **self-hosted sync server** to keep dials in sync across browsers
- Custom splash background (upload your own image or use a public photo service)
- Built-in search bar with configurable search engine
- Custom icons per dial (upload or auto-fetched favicon)


---

## Extension Setup

### Load in Chrome / Brave

1. Open `chrome://extensions` (or `brave://extensions`)
2. Enable **Developer mode** (top-right toggle)
3. Click **Load unpacked** and select the `extension/` folder
4. Open a new tab — Browser Dials is now your new tab page

### Configuration

Open the extension settings via the toolbar icon or by navigating to the **Settings** link on the new tab page.

| Setting | Description |
|---|---|
| Storage Mode | Local only (default) or Sync to server |
| Splash Background | Upload an image or use Picsum / Unsplash |
| Search Bar | Toggle visibility and choose a default search engine |
| Profiles | Create, rename, and delete dial profiles |
| Backup / Restore | Export and import your dials as JSON |

---

## Sync Server

The optional sync server lets you keep your dials consistent across multiple browsers or devices. It is a Node.js/Express application backed by **MariaDB**.

### Authentication

Every API request requires:

| Header | Value |
|---|---|
| `Authorization` | `Bearer <api_key>` |
| `X-Sync-User` | Your username |
| `X-Sync-Password` | Your password |

Passwords are stored as PBKDF2-SHA256 hashes (120 000 iterations).

### Running with Docker (recommended)

**Prerequisites:** Docker 20+, Docker Compose 2.0+

Choose a deployment option based on your needs:

#### Quick Start (Local Development)

```bash
cp examples/docker-compose.simple.yml docker-compose.yml
cp examples/.env.simple .env
# Edit .env with your passwords
docker-compose up -d
docker-compose exec server node scripts/create-user.js admin password
```

#### Production Deployment

```bash
cp examples/docker-compose.production.yml docker-compose.yml
cp examples/.env.production .env
# Generate secure secrets and edit .env
openssl rand -base64 32
# Set up SSL certificates, then:
docker-compose up -d
docker-compose exec server node scripts/create-user.js admin password
```

See [examples/README.md](examples/README.md) for detailed deployment scenarios and configurations.

The server listens on **port 3737** by default (`SERVER_PORT` in `.env` to override).

#### Building from Source (Development)

To build and run the image locally from the Dockerfile:

```bash
cp .env.docker .env
# Edit .env with your values
docker-compose up -d --build
```

### Running without Docker

```bash
cd server
npm install

# Create a .env file (see .env.docker for all variables)
cp ../.env.docker .env

# Run database migrations
mysql -u root -p browser_dials < schema.sql

# Start the server
npm start
# or for development with auto-reload:
npm run dev
```

### Create a user manually

```bash
cd server
node scripts/create-user.js <username> <password>
```

### Environment Variables

| Variable | Default | Description |
|---|---|---|
| `PORT` | `3737` | HTTP port the server listens on |
| `DB_HOST` | `db` | Database hostname |
| `DB_PORT` | `3306` | Database port |
| `DB_USER` | `browser_dials` | Database user |
| `DB_PASS` | *(required)* | Database password |
| `DB_NAME` | `browser_dials` | Database name |
| `API_KEY` | *(required)* | Shared secret used to authenticate requests |

### API Endpoints

| Method | Path | Description |
|---|---|---|
| `POST` | `/api/auth/login` | Log in, verify credentials |
| `POST` | `/api/auth/register` | Register a new account (API key required) |
| `GET` | `/api/sync` | Fetch all profiles + dials for the user |
| `POST` | `/api/sync` | Push all profiles + dials (full replace) |
| `GET` | `/api/profiles` | List profiles |
| `POST` | `/api/profiles` | Create a profile |
| `PUT` | `/api/profiles/:id` | Update a profile |
| `DELETE` | `/api/profiles/:id` | Delete a profile |
| `GET` | `/api/profiles/:id/dials` | List dials in a profile |
| `POST` | `/api/profiles/:id/dials` | Create a dial |
| `PUT` | `/api/dials/:id` | Update a dial |
| `DELETE` | `/api/dials/:id` | Delete a dial |
| `POST` | `/api/dials/:id/icon` | Upload a custom icon |

---

## Development

### Generate Icons

```bash
npm run icons
```

Requires the `canvas` package. Generates all required icon sizes into `extension/icons/`.

### Package the Extension

Use the PowerShell packaging script to build a release zip with the extension files at the archive root and the packaged `manifest.json` version set correctly:

```powershell
.\package-extension.ps1
```

The packaged artifact is written to `dist/browser-dials-extension-<version>.zip`.

### Publish a Release

```powershell
.\publish-server.ps1
```

This now packages the extension first, then publishes the server Docker image tags for the same version.

---

## License

MIT
