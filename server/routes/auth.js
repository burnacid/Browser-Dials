'use strict';

const express = require('express');
const { v4: uuidv4 } = require('uuid');
const db = require('../db');
const { hashPassword } = require('../security');

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

module.exports = router;
