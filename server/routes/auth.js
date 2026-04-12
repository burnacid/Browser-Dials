'use strict';

const express = require('express');
const { v4: uuidv4 } = require('uuid');
const db = require('../db');
const { hashPassword, verifyPassword } = require('../security');

const router = express.Router();

router.post('/register', async (req, res) => {
  const username = String(req.body?.username || '').trim();
  const password = String(req.body?.password || '');

  if (!username || !password) {
    return res.status(400).json({ error: 'username and password are required' });
  }
  if (username.length < 3 || username.length > 100) {
    return res.status(400).json({ error: 'username must be 3-100 characters' });
  }
  if (!/^[a-zA-Z0-9._-]+$/.test(username)) {
    return res.status(400).json({ error: 'username contains invalid characters' });
  }
  if (password.length < 8 || password.length > 200) {
    return res.status(400).json({ error: 'password must be 8-200 characters' });
  }

  try {
    const [existing] = await db.execute('SELECT id FROM users WHERE username = ? LIMIT 1', [username]);
    if (existing.length > 0) {
      return res.status(409).json({ error: 'username already exists' });
    }

    await db.execute(
      'INSERT INTO users (id, username, password_hash, is_active) VALUES (?, ?, ?, 1)',
      [uuidv4(), username, hashPassword(password)]
    );

    return res.status(201).json({ ok: true, username });
  } catch (err) {
    console.error('Register error:', err.message);
    return res.status(500).json({ error: 'could not create user' });
  }
});

router.post('/change-password', async (req, res) => {
  const username = String(req.headers['x-sync-user'] || req.body?.username || '').trim();
  const currentPassword = String(req.body?.current_password || '');
  const nextPassword = String(req.body?.new_password || '');

  if (!username || !currentPassword || !nextPassword) {
    return res.status(400).json({ error: 'username, current_password and new_password are required' });
  }
  if (nextPassword.length < 8 || nextPassword.length > 200) {
    return res.status(400).json({ error: 'new_password must be 8-200 characters' });
  }

  try {
    const [rows] = await db.execute(
      'SELECT id, password_hash, is_active FROM users WHERE username = ? LIMIT 1',
      [username]
    );
    if (rows.length === 0) {
      return res.status(404).json({ error: 'user not found' });
    }

    const user = rows[0];
    if (!user.is_active) {
      return res.status(403).json({ error: 'user is disabled' });
    }
    if (!verifyPassword(currentPassword, user.password_hash)) {
      return res.status(403).json({ error: 'current password is incorrect' });
    }
    if (verifyPassword(nextPassword, user.password_hash)) {
      return res.status(400).json({ error: 'new password must differ from current password' });
    }

    await db.execute('UPDATE users SET password_hash = ? WHERE id = ?', [hashPassword(nextPassword), user.id]);
    return res.json({ ok: true });
  } catch (err) {
    console.error('Change password error:', err.message);
    return res.status(500).json({ error: 'could not change password' });
  }
});

module.exports = router;
