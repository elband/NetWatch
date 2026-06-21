import { pool } from '../db/pool.js';
import { env } from '../config/env.js';

// Zona waktu aktif (IANA, mis. 'Asia/Makassar'). Sumber kebenaran runtime.
let currentTz = env.appTz;

export function isValidTz(tz) {
  try { new Intl.DateTimeFormat('en-US', { timeZone: String(tz) }); return true; } catch { return false; }
}

export function getCurrentTz() { return currentTz; }

// Offset numerik (mis. '+08:00') untuk SET time_zone MySQL — diturunkan dari
// process.env.TZ yang sudah aktif (tidak butuh tabel zona waktu MySQL).
export function mysqlOffset() {
  const off = -new Date().getTimezoneOffset(); // menit di depan UTC
  const sign = off >= 0 ? '+' : '-';
  const hh = String(Math.floor(Math.abs(off) / 60)).padStart(2, '0');
  const mm = String(Math.abs(off) % 60).padStart(2, '0');
  return `${sign}${hh}:${mm}`;
}

// Terapkan zona waktu: set process.env.TZ (memengaruhi semua Date/toLocale/NOW
// via offset) dan selaraskan sesi MySQL koneksi-koneksi pool yang ada.
export async function applyTimezone(tz) {
  if (!isValidTz(tz)) throw new Error('Zona waktu tidak valid');
  currentTz = String(tz);
  process.env.TZ = currentTz;
  // Koneksi pool baru otomatis dapat offset benar (lihat db/pool.js).
  // Untuk koneksi yang sudah terbuka, dorong SET time_zone sekali.
  try { await pool.query(`SET time_zone = '${mysqlOffset()}'`); } catch { /* abaikan */ }
  return currentTz;
}

export function serverTimeInfo() {
  const now = new Date();
  return {
    tz: currentTz,
    offset: mysqlOffset(),
    epoch: now.getTime(),
    iso_utc: now.toISOString(),
    local: now.toLocaleString('id-ID', { dateStyle: 'full', timeStyle: 'medium' }),
  };
}

// Saat startup: pulihkan zona waktu dari Pengaturan (bila ada), lalu pastikan
// sesi MySQL selaras.
export async function initTimezoneFromSettings() {
  try {
    const [rows] = await pool.query("SELECT setting_value FROM settings WHERE setting_key = 'app_timezone'");
    let tz = null;
    if (rows[0]) {
      let v = rows[0].setting_value;
      if (typeof v === 'string') { try { v = JSON.parse(v); } catch { /* keep */ } }
      if (typeof v === 'string' && isValidTz(v)) tz = v;
    }
    await applyTimezone(tz || currentTz);
  } catch { /* abaikan */ }
}
