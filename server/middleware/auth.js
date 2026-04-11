/**
 * Auth middleware — validates Bearer API key and per-user credentials.
 * Required headers:
 * - Authorization: Bearer <api_key>
 * - X-Sync-User: <username>
 * - X-Sync-Password: <password>
 */

'use strict';

const db = require('../db');
const { verifyPassword } = require('../security');

async function requireAuth(req, res, next) {
  const header = req.headers['authorization'] ?? '';
  const username = String(req.headers['x-sync-user'] ?? '').trim();
  const password = String(req.headers['x-sync-password'] ?? '');

  if (!header.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing authorization header' });
  }

  const token = header.slice(7).trim();
  if (!token) {
    return res.status(401).json({ error: 'Empty token' });
  }
  if (!username || !password) {
    return res.status(401).json({ error: 'Missing user credentials' });
  }

  try {
    const [keyRows] = await db.execute(
      'SELECT id FROM api_keys WHERE key_value = ? LIMIT 1',
      [token]
    );
    if (keyRows.length === 0) {
      return res.status(403).json({ error: 'Invalid API key' });
    }

    const [userRows] = await db.execute(
      'SELECT id, username, password_hash, is_active FROM users WHERE username = ? LIMIT 1',
      [username]
    );
    if (userRows.length === 0) {
      return res.status(403).json({ error: 'Invalid user credentials' });
    }

    const user = userRows[0];
    if (!user.is_active) {
      return res.status(403).json({ error: 'User is disabled' });
    }
    if (!verifyPassword(password, user.password_hash)) {
      return res.status(403).json({ error: 'Invalid user credentials' });
    }

    req.auth = {
      apiKeyId: keyRows[0].id,
      userId: user.id,
      username: user.username,
    };
    next();
  } catch (err) {
    console.error('Auth DB error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

module.exports = requireAuth;
