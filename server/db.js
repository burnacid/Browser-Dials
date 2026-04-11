/**
 * Shared MySQL2 connection pool.
 * All modules `require('../db')` to get the same pool instance.
 */

'use strict';

const mysql = require('mysql2/promise');

const pool = mysql.createPool({
  host:     process.env.DB_HOST     || 'localhost',
  port:     parseInt(process.env.DB_PORT || '3306', 10),
  user:     process.env.DB_USER     || 'browser_dials',
  password: process.env.DB_PASS     || '',
  database: process.env.DB_NAME     || 'browser_dials',
  waitForConnections: true,
  connectionLimit:    10,
  queueLimit:         0,
  charset:            'utf8mb4',
});

module.exports = pool;
