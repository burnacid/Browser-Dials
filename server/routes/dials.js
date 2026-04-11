'use strict';

const express  = require('express');
const multer   = require('multer');
const path     = require('path');
const fs       = require('fs');
const { v4: uuidv4 } = require('uuid');
const db       = require('../db');

const router = express.Router({ mergeParams: true });

// ─── Multer setup ─────────────────────────────────────────────────────────────
const UPLOADS_DIR = path.join(__dirname, '..', 'uploads');

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOADS_DIR),
  filename:    (req, file, cb) => {
    const ext  = path.extname(file.originalname).toLowerCase();
    const safe = uuidv4() + ext;
    cb(null, safe);
  },
});

const ALLOWED_MIME = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/svg+xml', 'image/x-icon']);

const upload = multer({
  storage,
  limits: { fileSize: 2 * 1024 * 1024 }, // 2 MB
  fileFilter: (req, file, cb) => {
    if (ALLOWED_MIME.has(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Only image files are allowed'));
    }
  },
});

// ─── Helpers ──────────────────────────────────────────────────────────────────
function safeDeleteFile(filePath) {
  if (!filePath) return;
  const full = path.join(UPLOADS_DIR, path.basename(filePath));
  fs.unlink(full, () => {}); // best-effort, ignore errors
}

function validateUrl(raw) {
  try {
    const u = new URL(raw);
    return (u.protocol === 'http:' || u.protocol === 'https:') ? u.href : null;
  } catch {
    return null;
  }
}

// ─── List dials for a profile ─────────────────────────────────────────────────
router.get('/', async (req, res) => {
  const { profileId } = req.params;
  const userId = req.auth.userId;
  try {
    const [rows] = await db.execute(
      `SELECT d.*
       FROM dials d
       INNER JOIN profiles p ON p.id = d.profile_id
       WHERE d.profile_id = ? AND p.user_id = ?
       ORDER BY d.position ASC, d.created_at ASC`,
      [profileId, userId]
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to list dials' });
  }
});

// ─── Create dial ──────────────────────────────────────────────────────────────
router.post('/', async (req, res) => {
  const { profileId } = req.params;
  const userId = req.auth.userId;
  const { title, url, position } = req.body ?? {};

  if (!url || typeof url !== 'string') {
    return res.status(400).json({ error: 'url is required' });
  }
  const cleanUrl = validateUrl(url.trim());
  if (!cleanUrl) {
    return res.status(400).json({ error: 'url must be a valid http/https URL' });
  }
  if (title && title.length > 200) {
    return res.status(400).json({ error: 'title too long (max 200 chars)' });
  }

  const [profileRows] = await db.execute(
    'SELECT id FROM profiles WHERE id = ? AND user_id = ?',
    [profileId, userId]
  );
  if (profileRows.length === 0) {
    return res.status(404).json({ error: 'Profile not found' });
  }

  const id  = uuidv4();
  const pos = Number.isInteger(position) ? position : 0;

  try {
    await db.execute(
      'INSERT INTO dials (id, profile_id, title, url, position) VALUES (?, ?, ?, ?, ?)',
      [id, profileId, (title ?? '').trim(), cleanUrl, pos]
    );
    const [rows] = await db.execute('SELECT * FROM dials WHERE id = ?', [id]);
    res.status(201).json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to create dial' });
  }
});

// ─── Update dial ──────────────────────────────────────────────────────────────
router.put('/:dialId', async (req, res) => {
  const { dialId } = req.params;
  const userId = req.auth.userId;
  const { title, url, position } = req.body ?? {};

  const fields = [];
  const values = [];

  if (url !== undefined) {
    const cleanUrl = validateUrl(String(url).trim());
    if (!cleanUrl) {
      return res.status(400).json({ error: 'url must be a valid http/https URL' });
    }
    fields.push('url = ?');
    values.push(cleanUrl);
  }

  if (title !== undefined) {
    if (String(title).length > 200) {
      return res.status(400).json({ error: 'title too long (max 200 chars)' });
    }
    fields.push('title = ?');
    values.push(String(title).trim());
  }

  if (position !== undefined) {
    if (!Number.isInteger(position)) {
      return res.status(400).json({ error: 'position must be an integer' });
    }
    fields.push('position = ?');
    values.push(position);
  }

  if (fields.length === 0) {
    return res.status(400).json({ error: 'Nothing to update' });
  }

  values.push(dialId);

  try {
    const [result] = await db.execute(
      `UPDATE dials d
       INNER JOIN profiles p ON p.id = d.profile_id
       SET ${fields.join(', ')}
       WHERE d.id = ? AND p.user_id = ?`,
      [...values, userId]
    );
    if (result.affectedRows === 0) {
      return res.status(404).json({ error: 'Dial not found' });
    }
    const [rows] = await db.execute(
      `SELECT d.*
       FROM dials d
       INNER JOIN profiles p ON p.id = d.profile_id
       WHERE d.id = ? AND p.user_id = ?`,
      [dialId, userId]
    );
    res.json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to update dial' });
  }
});

// ─── Delete dial ──────────────────────────────────────────────────────────────
router.delete('/:dialId', async (req, res) => {
  const { dialId } = req.params;
  const userId = req.auth.userId;
  try {
    const [existing] = await db.execute(
      `SELECT d.icon_path
       FROM dials d
       INNER JOIN profiles p ON p.id = d.profile_id
       WHERE d.id = ? AND p.user_id = ?`,
      [dialId, userId]
    );
    if (existing.length === 0) {
      return res.status(404).json({ error: 'Dial not found' });
    }
    safeDeleteFile(existing[0].icon_path);
    await db.execute(
      `DELETE d
       FROM dials d
       INNER JOIN profiles p ON p.id = d.profile_id
       WHERE d.id = ? AND p.user_id = ?`,
      [dialId, userId]
    );
    res.status(204).end();
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to delete dial' });
  }
});

// ─── Upload custom icon ───────────────────────────────────────────────────────
router.post('/:dialId/icon', upload.single('icon'), async (req, res) => {
  const { dialId } = req.params;
  const userId = req.auth.userId;
  if (!req.file) {
    return res.status(400).json({ error: 'No file uploaded' });
  }

  try {
    const [existing] = await db.execute(
      `SELECT d.icon_path
       FROM dials d
       INNER JOIN profiles p ON p.id = d.profile_id
       WHERE d.id = ? AND p.user_id = ?`,
      [dialId, userId]
    );
    if (existing.length === 0) {
      safeDeleteFile(req.file.filename);
      return res.status(404).json({ error: 'Dial not found' });
    }
    // Remove old icon file if any
    safeDeleteFile(existing[0].icon_path);

    const iconPath = req.file.filename;
    await db.execute(
      `UPDATE dials d
       INNER JOIN profiles p ON p.id = d.profile_id
       SET d.icon_path = ?
       WHERE d.id = ? AND p.user_id = ?`,
      [iconPath, dialId, userId]
    );
    const [rows] = await db.execute(
      `SELECT d.*
       FROM dials d
       INNER JOIN profiles p ON p.id = d.profile_id
       WHERE d.id = ? AND p.user_id = ?`,
      [dialId, userId]
    );
    res.json(rows[0]);
  } catch (err) {
    safeDeleteFile(req.file?.filename);
    console.error(err);
    res.status(500).json({ error: 'Failed to save icon' });
  }
});

// multer error handler for this router
router.use((err, req, res, next) => {
  if (err instanceof multer.MulterError || err.message === 'Only image files are allowed') {
    return res.status(400).json({ error: err.message });
  }
  next(err);
});

// ─── Delete custom icon ───────────────────────────────────────────────────────
router.delete('/:dialId/icon', async (req, res) => {
  const { dialId } = req.params;
  const userId = req.auth.userId;
  try {
    const [existing] = await db.execute(
      `SELECT d.icon_path
       FROM dials d
       INNER JOIN profiles p ON p.id = d.profile_id
       WHERE d.id = ? AND p.user_id = ?`,
      [dialId, userId]
    );
    if (existing.length === 0) {
      return res.status(404).json({ error: 'Dial not found' });
    }
    safeDeleteFile(existing[0].icon_path);
    await db.execute(
      `UPDATE dials d
       INNER JOIN profiles p ON p.id = d.profile_id
       SET d.icon_path = NULL
       WHERE d.id = ? AND p.user_id = ?`,
      [dialId, userId]
    );
    res.status(204).end();
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to delete icon' });
  }
});

module.exports = router;
