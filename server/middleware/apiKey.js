'use strict';

const db = require('../db');
const { sendError } = require('../lib/http');

async function requireApiKey(req, res, next) {
  const header = req.headers['authorization'] ?? '';
  if (!header.startsWith('Bearer ')) {
    return sendError(res, 401, 'MISSING_AUTH_HEADER', 'Missing authorization header');
  }

  const token = header.slice(7).trim();
  if (!token) {
    return sendError(res, 401, 'EMPTY_AUTH_TOKEN', 'Empty token');
  }

  try {
    const [rows] = await db.execute(
      'SELECT id FROM api_keys WHERE key_value = ? LIMIT 1',
      [token]
    );
    if (rows.length === 0) {
      return sendError(res, 403, 'INVALID_API_KEY', 'Invalid API key');
    }

    req.apiKeyId = rows[0].id;
    next();
  } catch (err) {
    console.error('API key check error:', err.message);
    return sendError(res, 500, 'INTERNAL_SERVER_ERROR', 'Internal server error');
  }
}

module.exports = requireApiKey;
