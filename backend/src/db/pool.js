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

// Selaraskan sesi MySQL dengan zona waktu server (process.env.TZ) agar
// NOW()/CURRENT_TIMESTAMP tersimpan & terbaca dalam zona itu — bukan UTC.
pool.on('connection', (conn) => {
  const off = -new Date().getTimezoneOffset(); // menit di depan UTC
  const sign = off >= 0 ? '+' : '-';
  const tz = `${sign}${String(Math.floor(Math.abs(off) / 60)).padStart(2, '0')}:${String(Math.abs(off) % 60).padStart(2, '0')}`;
  conn.query(`SET time_zone = '${tz}'`, (e) => { if (e) console.error('[pool] gagal set time_zone:', e.message); });
});
