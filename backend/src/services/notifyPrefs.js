import { pool } from '../db/pool.js';

// Katalog jenis notifikasi yang bisa diatur admin di halaman Pengaturan Notifikasi.
// `roles` = peran yang relevan menerima event ini (dipakai frontend utk menentukan
// kolom peran mana yang tampil checkbox-nya; peran di luar daftar ini selalu "—").
export const NOTIF_EVENTS = [
  { key: 'absensi_vpn_lokasi', label: 'Absensi tidak wajar (lokasi/GPS/perangkat asing)', roles: ['koordinator'] },
  { key: 'absensi_duplikat_perangkat', label: 'Perangkat absensi dipakai bersama (duplikat)', roles: ['teknisi', 'admin'] },
  { key: 'maintenance_reminder', label: 'Pengingat maintenance peralatan (harian 08:00)', roles: ['teknisi'] },
  { key: 'insiden_koordinator', label: 'Insiden: notifikasi ke koordinator (baru/selesai/eskalasi SLA)', roles: ['koordinator'] },
  { key: 'insiden_teknisi', label: 'Insiden: notifikasi ke teknisi (tiket baru/pengingat/perintah/diajak bersama)', roles: ['teknisi'] },
  { key: 'pengajuan_review_koordinator', label: 'Pengajuan/laporan baru menunggu review koordinator (izin, diklat, dokumen, kegiatan non-rutin, inspeksi & maintenance peralatan)', roles: ['koordinator'] },
  { key: 'pengajuan_keputusan', label: 'Hasil keputusan pengajuan dikirim ke pengaju (izin, diklat, dokumen, kegiatan non-rutin)', roles: ['teknisi', 'koordinator'] },
  { key: 'absensi_keputusan_alpa', label: 'Hasil keputusan absen (ALPA/dimaafkan) dikirim ke teknisi', roles: ['teknisi'] },
];

// Peran yang ditampilkan sebagai kolom pada matriks pengaturan notifikasi.
export const NOTIF_ROLES = ['admin', 'koordinator', 'teknisi', 'viewer'];

// Preferensi disimpan per-PERAN (bukan per-user): settings.notification_prefs =
// { [eventKey]: { [role]: boolean } }. Tidak diatur = anggap aktif (default true).
export async function getNotifyPrefs() {
  const [r] = await pool.query("SELECT setting_value FROM settings WHERE setting_key='notification_prefs'");
  const v = r[0]?.setting_value;
  try { return typeof v === 'string' ? JSON.parse(v) : (v || {}); } catch { return {}; }
}

// Kumpulkan semua peran yang dimiliki user (kolom legacy `role` + JSON `roles`).
function rolesOf(row) {
  const set = new Set();
  if (row.role) set.add(row.role);
  let arr = row.roles;
  if (typeof arr === 'string') { try { arr = JSON.parse(arr); } catch { arr = null; } }
  if (Array.isArray(arr)) arr.forEach((r) => r && set.add(r));
  return [...set];
}

// Apakah user (lewat peran-nya) berhak menerima notifikasi WA untuk event ini.
// Pengaturan per-peran: user dikirimi notif bila MINIMAL SATU peran-nya tidak
// dimatikan untuk event tersebut. Belum diatur / peran tak dikenal = default aktif.
export async function isNotifyEnabledForUser(eventKey, userId) {
  if (!userId) return true;
  const prefs = await getNotifyPrefs();
  const evPrefs = prefs[eventKey];
  if (!evPrefs) return true; // event belum pernah diatur → aktif
  const [rows] = await pool.query('SELECT role, roles FROM users WHERE id=?', [userId]);
  if (!rows.length) return true;
  const roles = rolesOf(rows[0]);
  if (roles.length === 0) return true;
  return roles.some((r) => evPrefs[r] !== false);
}
