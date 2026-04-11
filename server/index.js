'use strict';

require('dotenv').config();

const express    = require('express');
const cors       = require('cors');
const path       = require('path');
const { v4: uuidv4 } = require('uuid');
const db         = require('./db');
const requireAuth = require('./middleware/auth');
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
    const [profiles] = await db.execute(
      'SELECT id, name, position, created_at FROM profiles ORDER BY position ASC, created_at ASC'
    );
    const [dials] = await db.execute(
      'SELECT * FROM dials ORDER BY position ASC, created_at ASC'
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
        `INSERT INTO profiles (id, name, position)
         VALUES (?, ?, ?)
         ON DUPLICATE KEY UPDATE name = VALUES(name), position = VALUES(position)`,
        [profile.id, profile.name.trim().slice(0, 100), Number(profile.position) || 0]
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

        await conn.execute(
          `INSERT INTO dials (id, profile_id, title, url, position, icon_path)
           VALUES (?, ?, ?, ?, ?, ?)
           ON DUPLICATE KEY UPDATE
             profile_id = VALUES(profile_id),
             title      = VALUES(title),
             url        = VALUES(url),
             position   = VALUES(position),
             icon_path  = COALESCE(icon_path, VALUES(icon_path))`,
          [
            dial.id,
            profile.id,
            (dial.title ?? '').toString().trim().slice(0, 200),
            cleanUrl,
            Number(dial.position) || 0,
            dial.icon_path ?? null,
          ]
        );
      }
    }

    // Delete dials not in the incoming payload (and clean up their icon files)
    if (incomingDialIds.length > 0) {
      const placeholders = incomingDialIds.map(() => '?').join(',');
      const [orphanDials] = await conn.execute(
        `SELECT id, icon_path FROM dials WHERE id NOT IN (${placeholders})`,
        incomingDialIds
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
        `DELETE FROM dials WHERE id NOT IN (${placeholders})`,
        incomingDialIds
      );
    } else {
      // No dials at all — delete everything
      const [allDials] = await conn.execute('SELECT id, icon_path FROM dials');
      for (const d of allDials) {
        if (d.icon_path) {
          const fs   = require('fs');
          const path = require('path');
          const full = path.join(__dirname, 'uploads', path.basename(d.icon_path));
          fs.unlink(full, () => {});
        }
      }
      await conn.execute('DELETE FROM dials');
    }

    // Delete profiles not in the incoming payload
    if (incomingProfileIds.length > 0) {
      const placeholders = incomingProfileIds.map(() => '?').join(',');
      await conn.execute(
        `DELETE FROM profiles WHERE id NOT IN (${placeholders})`,
        incomingProfileIds
      );
    } else {
      await conn.execute('DELETE FROM profiles');
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
    // Table may not exist yet; user must run schema.sql first.
    console.warn('Could not seed API key (run schema.sql first):', err.message);
  }
}

app.listen(PORT, async () => {
  console.log(`Browser Dials server listening on port ${PORT}`);
  await seedInitialApiKey();
});

module.exports = app; // for testing
