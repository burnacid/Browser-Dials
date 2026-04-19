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
const { sendError } = require('../lib/http');

async function requireAuth(req, res, next) {
  const header = req.headers['authorization'] ?? '';
  const username = String(req.headers['x-sync-user'] ?? '').trim();
  const password = String(req.headers['x-sync-password'] ?? '');

  if (!header.startsWith('Bearer ')) {
    return sendError(res, 401, 'MISSING_AUTH_HEADER', 'Missing authorization header');
  }

  const token = header.slice(7).trim();
  if (!token) {
    return sendError(res, 401, 'EMPTY_AUTH_TOKEN', 'Empty token');
  }
  if (!username || !password) {
    return sendError(res, 401, 'MISSING_USER_CREDENTIALS', 'Missing user credentials');
  }

  try {
    const [keyRows] = await db.execute(
      'SELECT id FROM api_keys WHERE key_value = ? LIMIT 1',
      [token]
    );
    if (keyRows.length === 0) {
      return sendError(res, 403, 'INVALID_API_KEY', 'Invalid API key');
    }

    const [userRows] = await db.execute(
      'SELECT id, username, password_hash, is_active FROM users WHERE username = ? LIMIT 1',
      [username]
    );
    if (userRows.length === 0) {
      return sendError(res, 403, 'INVALID_USER_CREDENTIALS', 'Invalid user credentials');
    }

    const user = userRows[0];
    if (!user.is_active) {
      return sendError(res, 403, 'USER_DISABLED', 'User is disabled');
    }
    if (!verifyPassword(password, user.password_hash)) {
      return sendError(res, 403, 'INVALID_USER_CREDENTIALS', 'Invalid user credentials');
    }

    req.auth = {
      apiKeyId: keyRows[0].id,
      userId: user.id,
      username: user.username,
    };
    next();
  } catch (err) {
    console.error('Auth DB error:', err.message);
    return sendError(res, 500, 'INTERNAL_SERVER_ERROR', 'Internal server error');
  }
}

module.exports = requireAuth;
