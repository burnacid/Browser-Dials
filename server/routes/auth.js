'use strict';

const express = require('express');
const { v4: uuidv4 } = require('uuid');
const db = require('../db');
const { hashPassword, verifyPassword } = require('../security');
const { ensureJsonObjectBody, validateWith } = require('../middleware/validate');
const { sendError } = require('../lib/http');

const router = express.Router();

function validateRegisterPayload(req) {
  const username = String(req.body?.username || '').trim();
  const password = String(req.body?.password || '');

  if (!username || !password) {
    return 'username and password are required';
  }
  if (username.length < 3 || username.length > 100) {
    return 'username must be 3-100 characters';
  }
  if (!/^[a-zA-Z0-9._-]+$/.test(username)) {
    return 'username contains invalid characters';
  }
  if (password.length < 8 || password.length > 200) {
    return 'password must be 8-200 characters';
  }

  return null;
}

function validateChangePasswordPayload(req) {
  const username = String(req.headers['x-sync-user'] || req.body?.username || '').trim();
  const currentPassword = String(req.body?.current_password || '');
  const nextPassword = String(req.body?.new_password || '');

  if (!username || !currentPassword || !nextPassword) {
    return 'username, current_password and new_password are required';
  }
  if (nextPassword.length < 8 || nextPassword.length > 200) {
    return 'new_password must be 8-200 characters';
  }

  return null;
}

router.post('/register', ensureJsonObjectBody, validateWith(validateRegisterPayload), async (req, res) => {
  const username = String(req.body?.username || '').trim();
  const password = String(req.body?.password || '');

  try {
    const [existing] = await db.execute('SELECT id FROM users WHERE username = ? LIMIT 1', [username]);
    if (existing.length > 0) {
      return sendError(res, 409, 'USERNAME_EXISTS', 'username already exists');
    }

    await db.execute(
      'INSERT INTO users (id, username, password_hash, is_active) VALUES (?, ?, ?, 1)',
      [uuidv4(), username, hashPassword(password)]
    );

    return res.status(201).json({ ok: true, username });
  } catch (err) {
    console.error('Register error:', err.message);
    return sendError(res, 500, 'REGISTER_FAILED', 'could not create user');
  }
});

router.post('/change-password', ensureJsonObjectBody, validateWith(validateChangePasswordPayload), async (req, res) => {
  const username = String(req.headers['x-sync-user'] || req.body?.username || '').trim();
  const currentPassword = String(req.body?.current_password || '');
  const nextPassword = String(req.body?.new_password || '');

  try {
    const [rows] = await db.execute(
      'SELECT id, password_hash, is_active FROM users WHERE username = ? LIMIT 1',
      [username]
    );
    if (rows.length === 0) {
      return sendError(res, 404, 'USER_NOT_FOUND', 'user not found');
    }

    const user = rows[0];
    if (!user.is_active) {
      return sendError(res, 403, 'USER_DISABLED', 'user is disabled');
    }
    if (!verifyPassword(currentPassword, user.password_hash)) {
      return sendError(res, 403, 'INVALID_CURRENT_PASSWORD', 'current password is incorrect');
    }
    if (verifyPassword(nextPassword, user.password_hash)) {
      return sendError(res, 400, 'PASSWORD_UNCHANGED', 'new password must differ from current password');
    }

    await db.execute('UPDATE users SET password_hash = ? WHERE id = ?', [hashPassword(nextPassword), user.id]);
    return res.json({ ok: true });
  } catch (err) {
    console.error('Change password error:', err.message);
    return sendError(res, 500, 'CHANGE_PASSWORD_FAILED', 'could not change password');
  }
});

module.exports = router;
