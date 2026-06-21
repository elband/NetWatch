import mysql from 'mysql2/promise';
import { env } from '../config/env.js';

export const pool = mysql.createPool({
  host: env.db.host,
  port: env.db.port,
  user: env.db.user,
  password: env.db.password,
  database: env.db.database,
  waitForConnections: true,
  connectionLimit: Number(process.env.DB_POOL_LIMIT || 20), // dinaikkan dari 10; bisa di-override via env
  maxIdle: 10,                  // tutup koneksi idle berlebih
  idleTimeout: 60000,           // 60s
  enableKeepAlive: true,        // jaga koneksi agar tidak putus saat idle
  keepAliveInitialDelay: 0,
  queueLimit: 0,
  dateStrings: true,
});
