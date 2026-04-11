'use strict';

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const { v4: uuidv4 } = require('uuid');
const db = require('../db');
const { hashPassword } = require('../security');

async function run() {
  const username = (process.argv[2] || '').trim();
  const password = process.argv[3] || '';

  if (!username || !password) {
    console.error('Usage: node scripts/create-user.js <username> <password>');
    process.exit(1);
  }

  try {
    const [existing] = await db.execute('SELECT id FROM users WHERE username = ? LIMIT 1', [username]);
    if (existing.length > 0) {
      console.error(`User already exists: ${username}`);
      process.exit(1);
    }

    await db.execute(
      'INSERT INTO users (id, username, password_hash, is_active) VALUES (?, ?, ?, 1)',
      [uuidv4(), username, hashPassword(password)]
    );
    console.log(`Created user: ${username}`);
    process.exit(0);
  } catch (err) {
    console.error('Failed to create user:', err.message);
    process.exit(1);
  }
}

run();
