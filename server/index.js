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
app.use(express.json({ limit: '1mb' }));

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
    const [profiles] = await db.execute(
      'SELECT id, user_id, name, position, created_at FROM profiles WHERE user_id = ? ORDER BY position ASC, created_at ASC',
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

    res.json(result);
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
  if (!Array.isArray(payload)) {
    return res.status(400).json({ error: 'Body must be an array of profiles' });
  }

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    const incomingProfileIds = [];
    const incomingDialIds    = [];

    for (const profile of payload) {
      if (!profile.id || typeof profile.id !== 'string') continue;
      if (!profile.name || typeof profile.name !== 'string') continue;

      incomingProfileIds.push(profile.id);

      // Upsert profile
      await conn.execute(
        `INSERT INTO profiles (id, user_id, name, position)
         VALUES (?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE
           user_id = VALUES(user_id),
           name = VALUES(name),
           position = VALUES(position)`,
        [profile.id, userId, profile.name.trim().slice(0, 100), Number(profile.position) || 0]
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

  const [profileIndexRows] = await db.execute(
    `SELECT INDEX_NAME
     FROM INFORMATION_SCHEMA.STATISTICS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'profiles' AND INDEX_NAME = 'idx_profiles_user'`
  );
  if (profileIndexRows.length === 0) {
    await db.execute('CREATE INDEX idx_profiles_user ON profiles(user_id)');
  }

  const [dialSettingsColumns] = await db.execute(
    `SELECT COLUMN_NAME
     FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'dials' AND COLUMN_NAME = 'settings_json'`
  );
  if (dialSettingsColumns.length === 0) {
    await db.execute('ALTER TABLE dials ADD COLUMN settings_json LONGTEXT NULL AFTER icon_path');
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

app.listen(PORT, async () => {
  console.log(`Browser Dials server listening on port ${PORT}`);
  await ensureSchema();
  await seedInitialApiKey();
  await seedInitialUser();
  await backfillLegacyProfilesToDefaultUser();
});

module.exports = app; // for testing
