import rateLimit from 'express-rate-limit';
import { env } from '../config/env.js';

// Batas dilonggarkan di dev agar tidak mengganggu pengujian lokal; ketat di production.
// Pembatas ketat untuk endpoint autentikasi (anti brute-force login & PIN).
export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 menit
  max: env.isProd ? 10 : 50,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Terlalu banyak percobaan login. Coba lagi dalam beberapa menit.' },
});

// Pembatas EKSTRA ketat khusus login PIN: satu PIN dicocokkan ke seluruh basis user,
// sehingga rawan brute-force lintas-akun. Batasi agresif per-IP.
export const pinLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: env.isProd ? 5 : 50,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Terlalu banyak percobaan PIN. Coba lagi dalam beberapa menit.' },
});

// Pembatas umum untuk seluruh API (anti abuse/DoS ringan).
export const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: env.isProd ? 300 : 2000,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Terlalu banyak permintaan. Coba lagi sebentar.' },
});
