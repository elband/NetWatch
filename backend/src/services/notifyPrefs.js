import { pool } from '../db/pool.js';

// Katalog jenis notifikasi yang bisa diatur admin di halaman Pengaturan Notifikasi.
// `roles` = penerima yang relevan untuk event ini (checkbox lain disembunyikan di UI).
export const NOTIF_EVENTS = [
  { key: 'absensi_vpn_lokasi', label: 'Absensi tidak wajar (lokasi/GPS/perangkat asing)', roles: ['koordinator'] },
  { key: 'absensi_duplikat_perangkat', label: 'Perangkat absensi dipakai bersama (duplikat)', roles: ['teknisi', 'admin'] },
  { key: 'maintenance_reminder', label: 'Pengingat maintenance peralatan (harian 08:00)', roles: ['teknisi'] },
  { key: 'insiden_koordinator', label: 'Insiden: notifikasi ke koordinator (baru/selesai/eskalasi SLA)', roles: ['koordinator'] },
  { key: 'insiden_teknisi', label: 'Insiden: notifikasi ke teknisi (tiket baru/pengingat/perintah/diajak bersama)', roles: ['teknisi'] },
  { key: 'pengajuan_review_koordinator', label: 'Pengajuan/laporan baru menunggu review koordinator (izin, diklat, dokumen, kegiatan non-rutin, inspeksi & maintenance peralatan)', roles: ['koordinator'] },
  { key: 'pengajuan_keputusan', label: 'Hasil keputusan pengajuan dikirim ke pengaju (izin, diklat, dokumen, kegiatan non-rutin)', roles: ['teknisi', 'koordinator'] },
];
export const NOTIF_ROLES = ['admin', 'koordinator', 'teknisi'];

function defaultPrefs() {
  const p = {};
  for (const e of NOTIF_EVENTS) p[e.key] = Object.fromEntries(e.roles.map((r) => [r, true]));
  return p;
}

// Gabungkan default (semua aktif) dengan yang tersimpan di settings.notification_prefs,
// supaya event baru otomatis aktif sampai admin menonaktifkannya secara eksplisit.
export async function getNotifyPrefs() {
  const [r] = await pool.query("SELECT setting_value FROM settings WHERE setting_key='notification_prefs'");
  const v = r[0]?.setting_value;
  let stored = {};
  try { stored = typeof v === 'string' ? JSON.parse(v) : (v || {}); } catch { stored = {}; }
  const merged = defaultPrefs();
  for (const k of Object.keys(merged)) merged[k] = { ...merged[k], ...(stored[k] || {}) };
  return merged;
}

export async function isNotifyEnabled(eventKey, role) {
  const prefs = await getNotifyPrefs();
  return prefs[eventKey]?.[role] !== false; // belum diatur = anggap aktif
}

// Untuk notifikasi 1:1 ke user tertentu (mis. hasil keputusan ke pengaju) yang
// perannya tidak diketahui pemanggil — lihat peran asli user lalu cek preferensi.
export async function isNotifyEnabledForUser(eventKey, userId) {
  const [[u]] = await pool.query('SELECT role FROM users WHERE id=?', [userId]);
  if (!u?.role) return true;
  return isNotifyEnabled(eventKey, u.role);
}
