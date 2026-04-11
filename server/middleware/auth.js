/**
 * Auth middleware — validates Bearer token against api_keys table.
 * Usage: router.use(requireAuth);
 */

'use strict';

const db = require('../db');

async function requireAuth(req, res, next) {
  const header = req.headers['authorization'] ?? '';
  if (!header.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing authorization header' });
  }

  const token = header.slice(7).trim();
  if (!token) {
    return res.status(401).json({ error: 'Empty token' });
  }

  try {
    const [rows] = await db.execute(
      'SELECT id FROM api_keys WHERE key_value = ? LIMIT 1',
      [token]
    );
    if (rows.length === 0) {
      return res.status(403).json({ error: 'Invalid API key' });
    }
    next();
  } catch (err) {
    console.error('Auth DB error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

module.exports = requireAuth;
