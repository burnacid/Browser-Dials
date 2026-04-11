'use strict';

const crypto = require('crypto');

const PBKDF2_ITERATIONS = 120000;
const KEY_LEN = 32;
const DIGEST = 'sha256';

function hashPassword(plain) {
  const salt = crypto.randomBytes(16);
  const derived = crypto.pbkdf2Sync(String(plain), salt, PBKDF2_ITERATIONS, KEY_LEN, DIGEST);
  return `pbkdf2$${PBKDF2_ITERATIONS}$${salt.toString('hex')}$${derived.toString('hex')}`;
}

function verifyPassword(plain, encoded) {
  if (typeof encoded !== 'string') return false;
  const parts = encoded.split('$');
  if (parts.length !== 4 || parts[0] !== 'pbkdf2') return false;

  const iterations = parseInt(parts[1], 10);
  const salt = Buffer.from(parts[2], 'hex');
  const expected = Buffer.from(parts[3], 'hex');
  if (!iterations || !salt.length || !expected.length) return false;

  const actual = crypto.pbkdf2Sync(String(plain), salt, iterations, expected.length, DIGEST);
  if (actual.length !== expected.length) return false;
  return crypto.timingSafeEqual(actual, expected);
}

module.exports = {
  hashPassword,
  verifyPassword,
};
