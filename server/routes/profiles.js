'use strict';

const express  = require('express');
const { v4: uuidv4 } = require('uuid');
const db       = require('../db');

const router = express.Router();
const PROFILE_THEME_MODES = new Set(['auto', 'light', 'dark', 'custom']);
const PROFILE_THEME_KEYS = new Set(['bg', 'surface', 'surface2', 'border', 'text', 'textMuted', 'accent', 'accentDark']);

function isHexColour(value) {
  return typeof value === 'string' && /^#[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$/.test(value);
}

function sanitizeProfileProperties(input, { defaultThemeMode = false } = {}) {
  const next = (input && typeof input === 'object' && !Array.isArray(input)) ? { ...input } : {};

  if (next.color_scheme_mode !== undefined) {
    if (typeof next.color_scheme_mode !== 'string') {
      return { error: 'color_scheme_mode must be a string' };
    }
    const mode = next.color_scheme_mode.toLowerCase();
    if (!PROFILE_THEME_MODES.has(mode)) {
      return { error: 'color_scheme_mode must be one of: auto, light, dark, custom' };
    }
    next.color_scheme_mode = mode;
  } else if (defaultThemeMode) {
    next.color_scheme_mode = 'auto';
  }

  if (next.color_scheme !== undefined) {
    if (!next.color_scheme || typeof next.color_scheme !== 'object' || Array.isArray(next.color_scheme)) {
      return { error: 'color_scheme must be an object' };
    }
    const scheme = {};
    for (const key of Object.keys(next.color_scheme)) {
      if (!PROFILE_THEME_KEYS.has(key)) continue;
      const colour = next.color_scheme[key];
      if (!isHexColour(colour)) {
        return { error: `color_scheme.${key} must be a hex color` };
      }
      scheme[key] = colour;
    }
    if (Object.keys(scheme).length > 0) {
      next.color_scheme = scheme;
    } else {
      delete next.color_scheme;
    }
  }

  return { properties: next };
}

// ─── List profiles ───────────────────────────────────────────────────────────
router.get('/', async (req, res) => {
  try {
    const userId = req.auth.userId;
    const [rows] = await db.execute(
      'SELECT id, user_id, name, position, properties_json, created_at FROM profiles WHERE user_id = ? ORDER BY position ASC, created_at ASC',
      [userId]
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to list profiles' });
  }
});

// ─── Create profile ───────────────────────────────────────────────────────────
router.post('/', async (req, res) => {
  const { name, position, properties, properties_json } = req.body ?? {};
  const userId = req.auth.userId;
  if (!name || typeof name !== 'string' || name.trim().length === 0) {
    return res.status(400).json({ error: 'name is required' });
  }
  if (name.trim().length > 100) {
    return res.status(400).json({ error: 'name too long (max 100 chars)' });
  }

  const id  = uuidv4();
  const pos = Number.isInteger(position) ? position : 0;

  let profileProperties = {};
  if (properties && typeof properties === 'object' && !Array.isArray(properties)) {
    profileProperties = { ...properties };
  }
  if (typeof properties_json === 'string' && properties_json.trim()) {
    try {
      const parsed = JSON.parse(properties_json);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        profileProperties = { ...profileProperties, ...parsed };
      }
    } catch {
      return res.status(400).json({ error: 'properties_json must be valid JSON object' });
    }
  }

  const sanitized = sanitizeProfileProperties(profileProperties, { defaultThemeMode: true });
  if (sanitized.error) {
    return res.status(400).json({ error: sanitized.error });
  }
  profileProperties = sanitized.properties;

  try {
    await db.execute(
      'INSERT INTO profiles (id, user_id, name, position, properties_json) VALUES (?, ?, ?, ?, ?)',
      [id, userId, name.trim(), pos, JSON.stringify(profileProperties)]
    );
    const [rows] = await db.execute('SELECT * FROM profiles WHERE id = ? AND user_id = ?', [id, userId]);
    res.status(201).json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to create profile' });
  }
});

// ─── Update profile ───────────────────────────────────────────────────────────
router.put('/:id', async (req, res) => {
  const { id } = req.params;
  const userId = req.auth.userId;
  const { name, position, properties, properties_json } = req.body ?? {};

  const fields = [];
  const values = [];

  if (name !== undefined) {
    if (typeof name !== 'string' || name.trim().length === 0) {
      return res.status(400).json({ error: 'name must be a non-empty string' });
    }
    if (name.trim().length > 100) {
      return res.status(400).json({ error: 'name too long (max 100 chars)' });
    }
    fields.push('name = ?');
    values.push(name.trim());
  }

  if (position !== undefined) {
    if (!Number.isInteger(position)) {
      return res.status(400).json({ error: 'position must be an integer' });
    }
    fields.push('position = ?');
    values.push(position);
  }

  if (properties !== undefined || properties_json !== undefined) {
    let profileProperties = {};
    if (properties !== undefined) {
      if (!properties || typeof properties !== 'object' || Array.isArray(properties)) {
        return res.status(400).json({ error: 'properties must be an object' });
      }
      profileProperties = { ...properties };
    }
    if (properties_json !== undefined) {
      if (typeof properties_json !== 'string') {
        return res.status(400).json({ error: 'properties_json must be a string' });
      }
      try {
        const parsed = JSON.parse(properties_json);
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
          return res.status(400).json({ error: 'properties_json must encode an object' });
        }
        profileProperties = { ...profileProperties, ...parsed };
      } catch {
        return res.status(400).json({ error: 'properties_json must be valid JSON object' });
      }
    }

    const sanitized = sanitizeProfileProperties(profileProperties);
    if (sanitized.error) {
      return res.status(400).json({ error: sanitized.error });
    }
    profileProperties = sanitized.properties;

    fields.push('properties_json = ?');
    values.push(JSON.stringify(profileProperties));
  }

  if (fields.length === 0) {
    return res.status(400).json({ error: 'Nothing to update' });
  }

  values.push(id);

  try {
    const [result] = await db.execute(
      `UPDATE profiles SET ${fields.join(', ')} WHERE id = ? AND user_id = ?`,
      [...values, userId]
    );
    if (result.affectedRows === 0) {
      return res.status(404).json({ error: 'Profile not found' });
    }
    const [rows] = await db.execute('SELECT * FROM profiles WHERE id = ? AND user_id = ?', [id, userId]);
    res.json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to update profile' });
  }
});

// ─── Delete profile ───────────────────────────────────────────────────────────
router.delete('/:id', async (req, res) => {
  const { id } = req.params;
  const userId = req.auth.userId;
  try {
    const [result] = await db.execute('DELETE FROM profiles WHERE id = ? AND user_id = ?', [id, userId]);
    if (result.affectedRows === 0) {
      return res.status(404).json({ error: 'Profile not found' });
    }
    res.status(204).end();
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to delete profile' });
  }
});

module.exports = router;
