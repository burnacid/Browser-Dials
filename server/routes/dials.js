'use strict';

const express  = require('express');
const multer   = require('multer');
const path     = require('path');
const fs       = require('fs');
const { v4: uuidv4 } = require('uuid');
const db       = require('../db');
const { ensureJsonObjectBody, validateWith } = require('../middleware/validate');
const { sendError } = require('../lib/http');

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

function validateCreateDialPayload(req) {
  const { title, url } = req.body ?? {};

  if (!url || typeof url !== 'string') {
    return 'url is required';
  }
  if (typeof title === 'string' && title.length > 200) {
    return 'title too long (max 200 chars)';
  }

  return null;
}

function validateUpdateDialPayload(req) {
  const { title, url, position } = req.body ?? {};

  if (url === undefined && title === undefined && position === undefined) {
    return 'Nothing to update';
  }
  if (position !== undefined && !Number.isInteger(position)) {
    return 'position must be an integer';
  }
  if (title !== undefined && String(title).length > 200) {
    return 'title too long (max 200 chars)';
  }

  return null;
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
    return sendError(res, 500, 'LIST_DIALS_FAILED', 'Failed to list dials');
  }
});

// ─── Create dial ──────────────────────────────────────────────────────────────
router.post('/', ensureJsonObjectBody, validateWith(validateCreateDialPayload), async (req, res) => {
  const { profileId } = req.params;
  const userId = req.auth.userId;
  const { title, url, position } = req.body ?? {};

  const cleanUrl = validateUrl(url.trim());
  if (!cleanUrl) {
    return sendError(res, 400, 'INVALID_URL', 'url must be a valid http/https URL');
  }

  const [profileRows] = await db.execute(
    'SELECT id FROM profiles WHERE id = ? AND user_id = ?',
    [profileId, userId]
  );
  if (profileRows.length === 0) {
    return sendError(res, 404, 'PROFILE_NOT_FOUND', 'Profile not found');
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
    return sendError(res, 500, 'CREATE_DIAL_FAILED', 'Failed to create dial');
  }
});

// ─── Update dial ──────────────────────────────────────────────────────────────
router.put('/:dialId', ensureJsonObjectBody, validateWith(validateUpdateDialPayload), async (req, res) => {
  const { dialId } = req.params;
  const userId = req.auth.userId;
  const { title, url, position } = req.body ?? {};

  const fields = [];
  const values = [];

  if (url !== undefined) {
    const cleanUrl = validateUrl(String(url).trim());
    if (!cleanUrl) {
      return sendError(res, 400, 'INVALID_URL', 'url must be a valid http/https URL');
    }
    fields.push('url = ?');
    values.push(cleanUrl);
  }

  if (title !== undefined) {
    fields.push('title = ?');
    values.push(String(title).trim());
  }

  if (position !== undefined) {
    fields.push('position = ?');
    values.push(position);
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
      return sendError(res, 404, 'DIAL_NOT_FOUND', 'Dial not found');
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
    return sendError(res, 500, 'UPDATE_DIAL_FAILED', 'Failed to update dial');
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
      return sendError(res, 404, 'DIAL_NOT_FOUND', 'Dial not found');
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
    return sendError(res, 500, 'DELETE_DIAL_FAILED', 'Failed to delete dial');
  }
});

// ─── Upload custom icon ───────────────────────────────────────────────────────
router.post('/:dialId/icon', upload.single('icon'), async (req, res) => {
  const { dialId } = req.params;
  const userId = req.auth.userId;
  if (!req.file) {
    return sendError(res, 400, 'MISSING_ICON_FILE', 'No file uploaded');
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
      return sendError(res, 404, 'DIAL_NOT_FOUND', 'Dial not found');
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
    return sendError(res, 500, 'SAVE_ICON_FAILED', 'Failed to save icon');
  }
});

// multer error handler for this router
router.use((err, req, res, next) => {
  if (err instanceof multer.MulterError || err.message === 'Only image files are allowed') {
    return sendError(res, 400, 'INVALID_ICON_UPLOAD', err.message);
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
      return sendError(res, 404, 'DIAL_NOT_FOUND', 'Dial not found');
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
    return sendError(res, 500, 'DELETE_ICON_FAILED', 'Failed to delete icon');
  }
});

module.exports = router;
