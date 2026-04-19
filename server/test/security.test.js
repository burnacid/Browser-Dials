'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { hashPassword, verifyPassword } = require('../security');

test('hashPassword creates a PBKDF2 formatted hash', () => {
  const hash = hashPassword('correct horse battery staple');
  assert.match(hash, /^pbkdf2\$\d+\$[a-f0-9]+\$[a-f0-9]+$/);
});

test('verifyPassword returns true for matching password', () => {
  const plain = 'super-secret-password';
  const hash = hashPassword(plain);

  assert.equal(verifyPassword(plain, hash), true);
});

test('verifyPassword returns false for wrong password', () => {
  const hash = hashPassword('right-password');

  assert.equal(verifyPassword('wrong-password', hash), false);
});

test('verifyPassword returns false for malformed hash input', () => {
  assert.equal(verifyPassword('password', ''), false);
  assert.equal(verifyPassword('password', 'not-a-hash'), false);
  assert.equal(verifyPassword('password', 'pbkdf2$abc$bad$hash'), false);
});
