'use strict';

require('dotenv').config();

const express    = require('express');
const cors       = require('cors');
const path       = require('path');
const { v4: uuidv4 } = require('uuid');
const db         = require('./db');
const { hashPassword } = require('./security');
const requireApiKey = require('./middleware/apiKey');
const requireAuth = require('./middleware/auth');
const authRouter = require('./routes/auth');
const profilesRouter = require('./routes/profiles');
const dialsRouter    = require('./routes/dials');

const app  = express();
const PORT = parseInt(process.env.PORT || '3737', 10);

function maskSecret(value) {
  const text = String(value || '');
  if (!text) return '';
  if (text.length <= 4) return '*'.repeat(text.length);
  return `${text.slice(0, 2)}***${text.slice(-2)}`;
}

function sanitizeBody(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return body;
  const clone = { ...body };
  const sensitiveKeys = ['password', 'current_password', 'new_password', 'confirm_password', 'sync_password', 'api_key'];
  for (const key of sensitiveKeys) {
    if (key in clone) {
      clone[key] = maskSecret(clone[key]);
    }
  }
  return clone;
}

function logHttp(event, payload) {
  const timestamp = new Date().toISOString();
  console.log(`${timestamp} [HTTP] ${event} ${JSON.stringify(payload)}`);
}

// ─── CORS ─────────────────────────────────────────────────────────────────────
// Allow requests from Chrome/Brave extension pages and localhost dev tools.
const allowedOrigins = /^chrome-extension:\/\/|^https?:\/\/localhost|^https?:\/\/127\.0\.0\.1/;

app.use(cors({
  origin: (origin, callback) => {
    // Allow requests with no origin (e.g. curl, Postman) in development.
    if (!origin || allowedOrigins.test(origin)) {
      callback(null, true);
    } else {
      callback(new Error('CORS: origin not allowed'));
    }
  },
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));

// ─── Body parsing ─────────────────────────────────────────────────────────────
app.use(express.json({ limit: '15mb' }));

// ─── Request logging ──────────────────────────────────────────────────────────
app.use((req, res, next) => {
  const startedAt = Date.now();
  const authHeader = String(req.headers.authorization || '');
  const maskedAuth = authHeader.startsWith('Bearer ')
    ? `Bearer ${maskSecret(authHeader.slice(7).trim())}`
    : authHeader;
  const maskedSyncPassword = req.headers['x-sync-password']
    ? maskSecret(req.headers['x-sync-password'])
    : '';

  logHttp('incoming', {
    method: req.method,
    path: req.originalUrl,
    auth: maskedAuth,
    syncUser: String(req.headers['x-sync-user'] || ''),
    syncPassword: maskedSyncPassword,
    body: sanitizeBody(req.body),
  });

  res.on('finish', () => {
    logHttp('completed', {
      method: req.method,
      path: req.originalUrl,
      status: res.statusCode,
      durationMs: Date.now() - startedAt,
    });
  });

  next();
});

// ─── Static uploads ───────────────────────────────────────────────────────────
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// ─── Registration route (API key only) ───────────────────────────────────────
app.use('/api/auth', requireApiKey, authRouter);

// ─── Auth on all /api routes ──────────────────────────────────────────────────
app.use('/api', requireAuth);

// ─── Profile & dial CRUD ──────────────────────────────────────────────────────
app.use('/api/profiles', profilesRouter);
app.use('/api/profiles/:profileId/dials', dialsRouter);
// Also allow flat dial routes (update / delete / icon — no profileId needed)
app.use('/api/dials', dialsRouter);

// ─── Full-state sync — GET ────────────────────────────────────────────────────
app.get('/api/sync', async (req, res) => {
  try {
    const userId = req.auth.userId;
    const [userRows] = await db.execute(
      'SELECT settings_json FROM users WHERE id = ? LIMIT 1',
      [userId]
    );
    let userSettings = {};
    if (userRows.length > 0 && typeof userRows[0].settings_json === 'string' && userRows[0].settings_json.trim()) {
      try {
        const parsed = JSON.parse(userRows[0].settings_json);
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          userSettings = parsed;
        }
      } catch {
        // Ignore malformed JSON and keep defaults.
      }
    }

    const [profiles] = await db.execute(
      'SELECT id, user_id, name, position, properties_json, created_at FROM profiles WHERE user_id = ? ORDER BY position ASC, created_at ASC',
      [userId]
    );
    const [dials] = await db.execute(
      `SELECT d.*
       FROM dials d
       INNER JOIN profiles p ON p.id = d.profile_id
       WHERE p.user_id = ?
       ORDER BY d.position ASC, d.created_at ASC`,
      [userId]
    );

    // Nest dials inside their profile
    const dialsByProfile = {};
    for (const dial of dials) {
      if (!dialsByProfile[dial.profile_id]) dialsByProfile[dial.profile_id] = [];
      dialsByProfile[dial.profile_id].push(dial);
    }

    const result = profiles.map(p => ({
      ...p,
      dials: dialsByProfile[p.id] ?? [],
    }));

    res.json({
      profiles: result,
      settings: userSettings,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch sync state' });
  }
});

// ─── Full-state sync — POST (full replace from extension) ────────────────────
/**
 * Body: Array of profiles, each with an optional `dials` array.
 * [
 *   {
 *     "id": "uuid",
 *     "name": "Work",
 *     "position": 0,
 *     "dials": [
 *       { "id": "uuid", "title": "GitHub", "url": "https://github.com", "position": 0, "icon_path": null }
 *     ]
 *   }
 * ]
 *
 * Strategy: upsert profiles + dials, then delete rows whose IDs were not included.
 * Server-stored icon files for deleted dials are cleaned up.
 */
app.post('/api/sync', async (req, res) => {
  const payload = req.body;
  const userId = req.auth.userId;
  let profilesPayload = [];
  let incomingSettings = null;

  if (Array.isArray(payload)) {
    // Backward-compatible shape from older clients
    profilesPayload = payload;
  } else if (payload && typeof payload === 'object' && !Array.isArray(payload)) {
    if (!Array.isArray(payload.profiles)) {
      return res.status(400).json({ error: 'Body.profiles must be an array' });
    }
    profilesPayload = payload.profiles;
    if (payload.settings !== undefined) {
      if (!payload.settings || typeof payload.settings !== 'object' || Array.isArray(payload.settings)) {
        return res.status(400).json({ error: 'Body.settings must be an object' });
      }
      incomingSettings = payload.settings;
    }
    if (payload.settings_json !== undefined) {
      if (typeof payload.settings_json !== 'string') {
        return res.status(400).json({ error: 'Body.settings_json must be a JSON string' });
      }
      try {
        const parsed = JSON.parse(payload.settings_json);
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
          return res.status(400).json({ error: 'Body.settings_json must encode an object' });
        }
        incomingSettings = { ...(incomingSettings || {}), ...parsed };
      } catch {
        return res.status(400).json({ error: 'Body.settings_json is invalid JSON' });
      }
    }
  } else {
    return res.status(400).json({ error: 'Body must be an array or object with profiles[]' });
  }

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    const incomingProfileIds = [];
    const incomingDialIds    = [];

    for (const profile of profilesPayload) {
      if (!profile.id || typeof profile.id !== 'string') continue;
      if (!profile.name || typeof profile.name !== 'string') continue;

      incomingProfileIds.push(profile.id);

      let profileProperties = {};
      if (profile.properties && typeof profile.properties === 'object' && !Array.isArray(profile.properties)) {
        profileProperties = { ...profile.properties };
      }
      if (typeof profile.properties_json === 'string' && profile.properties_json.trim()) {
        try {
          const parsed = JSON.parse(profile.properties_json);
          if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
            profileProperties = { ...profileProperties, ...parsed };
          }
        } catch {
          // Ignore malformed JSON and keep parsed object from properties.
        }
      }
      const profilePropertiesJson = JSON.stringify(profileProperties);

      // Upsert profile
      await conn.execute(
        `INSERT INTO profiles (id, user_id, name, position, properties_json)
         VALUES (?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE
           user_id = VALUES(user_id),
           name = VALUES(name),
           position = VALUES(position),
           properties_json = VALUES(properties_json)`,
        [profile.id, userId, profile.name.trim().slice(0, 100), Number(profile.position) || 0, profilePropertiesJson]
      );

      const dials = Array.isArray(profile.dials) ? profile.dials : [];
      for (const dial of dials) {
        if (!dial.id || typeof dial.id !== 'string') continue;
        if (!dial.url || typeof dial.url !== 'string') continue;

        // Basic URL validation
        let cleanUrl;
        try {
          const u = new URL(dial.url);
          if (u.protocol !== 'http:' && u.protocol !== 'https:') continue;
          cleanUrl = u.href;
        } catch {
          continue;
        }

        incomingDialIds.push(dial.id);

        let settingsObj = {};
        if (dial.settings && typeof dial.settings === 'object' && !Array.isArray(dial.settings)) {
          settingsObj = { ...dial.settings };
        }
        if (typeof dial.settings_json === 'string' && dial.settings_json.trim()) {
          try {
            const parsed = JSON.parse(dial.settings_json);
            if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
              settingsObj = { ...settingsObj, ...parsed };
            }
          } catch {
            // Ignore invalid JSON from client and keep other settings.
          }
        }
        if (typeof dial.icon_bg === 'string' && dial.icon_bg) {
          settingsObj.icon_bg = dial.icon_bg;
        }
        const settingsJson = JSON.stringify(settingsObj);

        await conn.execute(
          `INSERT INTO dials (id, profile_id, title, url, position, icon_path, settings_json)
           VALUES (?, ?, ?, ?, ?, ?, ?)
           ON DUPLICATE KEY UPDATE
             profile_id = VALUES(profile_id),
             title      = VALUES(title),
             url        = VALUES(url),
             position   = VALUES(position),
             icon_path  = COALESCE(icon_path, VALUES(icon_path)),
             settings_json = VALUES(settings_json)`,
          [
            dial.id,
            profile.id,
            (dial.title ?? '').toString().trim().slice(0, 200),
            cleanUrl,
            Number(dial.position) || 0,
            dial.icon_path ?? null,
            settingsJson,
          ]
        );
      }
    }

    // Delete dials not in the incoming payload (and clean up their icon files)
    if (incomingDialIds.length > 0) {
      const placeholders = incomingDialIds.map(() => '?').join(',');
      const [orphanDials] = await conn.execute(
        `SELECT d.id, d.icon_path
         FROM dials d
         INNER JOIN profiles p ON p.id = d.profile_id
         WHERE p.user_id = ? AND d.id NOT IN (${placeholders})`,
        [userId, ...incomingDialIds]
      );
      for (const d of orphanDials) {
        if (d.icon_path) {
          const fs   = require('fs');
          const path = require('path');
          const full = path.join(__dirname, 'uploads', path.basename(d.icon_path));
          fs.unlink(full, () => {});
        }
      }
      await conn.execute(
        `DELETE d
         FROM dials d
         INNER JOIN profiles p ON p.id = d.profile_id
         WHERE p.user_id = ? AND d.id NOT IN (${placeholders})`,
        [userId, ...incomingDialIds]
      );
    } else {
      // No dials at all — delete everything
      const [allDials] = await conn.execute(
        `SELECT d.id, d.icon_path
         FROM dials d
         INNER JOIN profiles p ON p.id = d.profile_id
         WHERE p.user_id = ?`,
        [userId]
      );
      for (const d of allDials) {
        if (d.icon_path) {
          const fs   = require('fs');
          const path = require('path');
          const full = path.join(__dirname, 'uploads', path.basename(d.icon_path));
          fs.unlink(full, () => {});
        }
      }
      await conn.execute(
        `DELETE d
         FROM dials d
         INNER JOIN profiles p ON p.id = d.profile_id
         WHERE p.user_id = ?`,
        [userId]
      );
    }

    // Delete profiles not in the incoming payload
    if (incomingProfileIds.length > 0) {
      const placeholders = incomingProfileIds.map(() => '?').join(',');
      await conn.execute(
        `DELETE FROM profiles WHERE user_id = ? AND id NOT IN (${placeholders})`,
        [userId, ...incomingProfileIds]
      );
    } else {
      await conn.execute('DELETE FROM profiles WHERE user_id = ?', [userId]);
    }

    if (incomingSettings && typeof incomingSettings === 'object' && !Array.isArray(incomingSettings)) {
      await conn.execute(
        'UPDATE users SET settings_json = ? WHERE id = ?',
        [JSON.stringify(incomingSettings), userId]
      );
    }

    await conn.commit();
    res.status(204).end();
  } catch (err) {
    await conn.rollback();
    console.error(err);
    res.status(500).json({ error: 'Sync failed' });
  } finally {
    conn.release();
  }
});

// ─── Health check ─────────────────────────────────────────────────────────────
app.get('/health', (req, res) => res.json({ ok: true }));

// ─── Global error handler ─────────────────────────────────────────────────────
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err.message);
  res.status(500).json({ error: 'Internal server error' });
});

// ─── Startup ──────────────────────────────────────────────────────────────────
async function seedInitialApiKey() {
  const key = process.env.API_KEY;
  if (!key) return;
  try {
    await db.execute(
      `INSERT IGNORE INTO api_keys (id, key_value, label) VALUES (?, ?, ?)`,
      [uuidv4(), key, 'default']
    );
  } catch (err) {
    console.warn('Could not seed API key:', err.message);
  }
}

async function ensureSchema() {
  await db.execute(
    `CREATE TABLE IF NOT EXISTS api_keys (
      id VARCHAR(36) NOT NULL,
      key_value VARCHAR(128) NOT NULL,
      label VARCHAR(100) NOT NULL DEFAULT '',
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      UNIQUE KEY uq_key_value (key_value)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`
  );

  await db.execute(
    `CREATE TABLE IF NOT EXISTS users (
      id VARCHAR(36) NOT NULL,
      username VARCHAR(100) NOT NULL,
      password_hash VARCHAR(255) NOT NULL,
      is_active TINYINT(1) NOT NULL DEFAULT 1,
      settings_json LONGTEXT NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      UNIQUE KEY uq_users_username (username)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`
  );

  await db.execute(
    `CREATE TABLE IF NOT EXISTS profiles (
      id VARCHAR(36) NOT NULL,
      user_id VARCHAR(36) NULL,
      name VARCHAR(100) NOT NULL,
      position INT NOT NULL DEFAULT 0,
      properties_json LONGTEXT NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`
  );

  await db.execute(
    `CREATE TABLE IF NOT EXISTS dials (
      id VARCHAR(36) NOT NULL,
      profile_id VARCHAR(36) NOT NULL,
      title VARCHAR(200) NOT NULL DEFAULT '',
      url VARCHAR(2048) NOT NULL,
      position INT NOT NULL DEFAULT 0,
      icon_path VARCHAR(512) NULL,
      settings_json LONGTEXT NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`
  );

  const [columns] = await db.execute(
    `SELECT COLUMN_NAME
     FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'profiles' AND COLUMN_NAME = 'user_id'`
  );

  if (columns.length === 0) {
    await db.execute('ALTER TABLE profiles ADD COLUMN user_id VARCHAR(36) NULL AFTER id');
  }

  const [userSettingsColumns] = await db.execute(
    `SELECT COLUMN_NAME
     FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users' AND COLUMN_NAME = 'settings_json'`
  );
  if (userSettingsColumns.length === 0) {
    await db.execute('ALTER TABLE users ADD COLUMN settings_json LONGTEXT NULL AFTER is_active');
  }

  const [profileIndexRows] = await db.execute(
    `SELECT INDEX_NAME
     FROM INFORMATION_SCHEMA.STATISTICS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'profiles' AND INDEX_NAME = 'idx_profiles_user'`
  );
  if (profileIndexRows.length === 0) {
    await db.execute('CREATE INDEX idx_profiles_user ON profiles(user_id)');
  }

  const [profilePositionIndexRows] = await db.execute(
    `SELECT INDEX_NAME
     FROM INFORMATION_SCHEMA.STATISTICS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'profiles' AND INDEX_NAME = 'idx_profiles_user_position'`
  );
  if (profilePositionIndexRows.length === 0) {
    await db.execute('CREATE INDEX idx_profiles_user_position ON profiles(user_id, position, created_at)');
  }

  const [profilePropertiesColumns] = await db.execute(
    `SELECT COLUMN_NAME
     FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'profiles' AND COLUMN_NAME = 'properties_json'`
  );
  if (profilePropertiesColumns.length === 0) {
    await db.execute('ALTER TABLE profiles ADD COLUMN properties_json LONGTEXT NULL AFTER position');
  }

  const [dialSettingsColumns] = await db.execute(
    `SELECT COLUMN_NAME
     FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'dials' AND COLUMN_NAME = 'settings_json'`
  );
  if (dialSettingsColumns.length === 0) {
    await db.execute('ALTER TABLE dials ADD COLUMN settings_json LONGTEXT NULL AFTER icon_path');
  }

  const [dialPositionIndexRows] = await db.execute(
    `SELECT INDEX_NAME
     FROM INFORMATION_SCHEMA.STATISTICS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'dials' AND INDEX_NAME = 'idx_dials_profile_position'`
  );
  if (dialPositionIndexRows.length === 0) {
    await db.execute('CREATE INDEX idx_dials_profile_position ON dials(profile_id, position, created_at)');
  }

  const [dialFkRows] = await db.execute(
    `SELECT CONSTRAINT_NAME
     FROM INFORMATION_SCHEMA.REFERENTIAL_CONSTRAINTS
     WHERE CONSTRAINT_SCHEMA = DATABASE() AND TABLE_NAME = 'dials' AND CONSTRAINT_NAME = 'fk_dials_profile'`
  );
  if (dialFkRows.length === 0) {
    try {
      await db.execute(
        `ALTER TABLE dials
         ADD CONSTRAINT fk_dials_profile
         FOREIGN KEY (profile_id) REFERENCES profiles(id)
         ON DELETE CASCADE ON UPDATE CASCADE`
      );
    } catch (err) {
      console.warn('Could not add fk_dials_profile yet:', err.message);
    }
  }

  const [fkRows] = await db.execute(
    `SELECT CONSTRAINT_NAME
     FROM INFORMATION_SCHEMA.REFERENTIAL_CONSTRAINTS
     WHERE CONSTRAINT_SCHEMA = DATABASE() AND TABLE_NAME = 'profiles' AND CONSTRAINT_NAME = 'fk_profiles_user'`
  );
  if (fkRows.length === 0) {
    try {
      await db.execute(
        `ALTER TABLE profiles
         ADD CONSTRAINT fk_profiles_user
         FOREIGN KEY (user_id) REFERENCES users(id)
         ON DELETE CASCADE ON UPDATE CASCADE`
      );
    } catch (err) {
      console.warn('Could not add fk_profiles_user yet:', err.message);
    }
  }
}

async function seedInitialUser() {
  const username = (process.env.SYNC_DEFAULT_USERNAME || '').trim();
  const password = process.env.SYNC_DEFAULT_PASSWORD || '';
  if (!username || !password) return;

  try {
    const [rows] = await db.execute('SELECT id FROM users WHERE username = ? LIMIT 1', [username]);
    if (rows.length > 0) return;
    await db.execute(
      'INSERT INTO users (id, username, password_hash, is_active) VALUES (?, ?, ?, 1)',
      [uuidv4(), username, hashPassword(password)]
    );
    console.log(`Seeded default sync user: ${username}`);
  } catch (err) {
    console.warn('Could not seed default user (ensure users table exists):', err.message);
  }
}

async function backfillLegacyProfilesToDefaultUser() {
  const username = (process.env.SYNC_DEFAULT_USERNAME || '').trim();
  if (!username) return;

  const [rows] = await db.execute('SELECT id FROM users WHERE username = ? LIMIT 1', [username]);
  if (rows.length === 0) return;

  const userId = rows[0].id;
  await db.execute('UPDATE profiles SET user_id = ? WHERE user_id IS NULL OR user_id = ""', [userId]);

  try {
    await db.execute('ALTER TABLE profiles MODIFY COLUMN user_id VARCHAR(36) NOT NULL');
  } catch (err) {
    console.warn('Could not enforce NOT NULL on profiles.user_id:', err.message);
  }
}

let serverInstance = null;

function validateRuntimeConfig() {
  if (!Number.isInteger(PORT) || PORT <= 0 || PORT > 65535) {
    throw new Error('PORT must be an integer between 1 and 65535');
  }
}

async function startServer() {
  validateRuntimeConfig();
  await ensureSchema();
  await seedInitialApiKey();
  await seedInitialUser();
  await backfillLegacyProfilesToDefaultUser();

  await new Promise((resolve, reject) => {
    serverInstance = app.listen(PORT, () => {
      console.log(`Browser Dials server listening on port ${PORT}`);
      resolve();
    });
    serverInstance.once('error', reject);
  });

  return serverInstance;
}

async function stopServer() {
  if (!serverInstance) return;
  await new Promise((resolve, reject) => {
    serverInstance.close(err => (err ? reject(err) : resolve()));
  });
  serverInstance = null;
}

function installSignalHandlers() {
  const shutdown = async (signal) => {
    try {
      console.log(`Received ${signal}, shutting down...`);
      await stopServer();
      await db.end();
      process.exit(0);
    } catch (err) {
      console.error('Shutdown error:', err.message);
      process.exit(1);
    }
  };

  process.on('SIGINT', () => {
    void shutdown('SIGINT');
  });
  process.on('SIGTERM', () => {
    void shutdown('SIGTERM');
  });
}

if (require.main === module) {
  installSignalHandlers();
  startServer().catch((err) => {
    console.error('Startup failed:', err.message);
    process.exit(1);
  });
}

module.exports = app;
module.exports.startServer = startServer;
module.exports.stopServer = stopServer;
