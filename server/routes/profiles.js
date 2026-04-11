'use strict';

const express  = require('express');
const { v4: uuidv4 } = require('uuid');
const db       = require('../db');

const router = express.Router();

// ─── List profiles ───────────────────────────────────────────────────────────
router.get('/', async (req, res) => {
  try {
    const userId = req.auth.userId;
    const [rows] = await db.execute(
      'SELECT id, user_id, name, position, created_at FROM profiles WHERE user_id = ? ORDER BY position ASC, created_at ASC',
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
  const { name, position } = req.body ?? {};
  const userId = req.auth.userId;
  if (!name || typeof name !== 'string' || name.trim().length === 0) {
    return res.status(400).json({ error: 'name is required' });
  }
  if (name.trim().length > 100) {
    return res.status(400).json({ error: 'name too long (max 100 chars)' });
  }

  const id  = uuidv4();
  const pos = Number.isInteger(position) ? position : 0;

  try {
    await db.execute(
      'INSERT INTO profiles (id, user_id, name, position) VALUES (?, ?, ?, ?)',
      [id, userId, name.trim(), pos]
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
  const { name, position } = req.body ?? {};

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
