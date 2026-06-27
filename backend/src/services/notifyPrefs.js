import { pool } from '../db/pool.js';

// Katalog jenis notifikasi yang bisa diatur admin di halaman Pengaturan Notifikasi.
// `roles` = peran yang relevan menerima event ini (dipakai frontend utk menentukan
// kolom user mana yang tampil checkbox-nya; user di luar peran ini selalu "—").
export const NOTIF_EVENTS = [
  { key: 'absensi_vpn_lokasi', label: 'Absensi tidak wajar (lokasi/GPS/perangkat asing)', roles: ['koordinator'] },
  { key: 'absensi_duplikat_perangkat', label: 'Perangkat absensi dipakai bersama (duplikat)', roles: ['teknisi', 'admin'] },
  { key: 'maintenance_reminder', label: 'Pengingat maintenance peralatan (harian 08:00)', roles: ['teknisi'] },
  { key: 'insiden_koordinator', label: 'Insiden: notifikasi ke koordinator (baru/selesai/eskalasi SLA)', roles: ['koordinator'] },
  { key: 'insiden_teknisi', label: 'Insiden: notifikasi ke teknisi (tiket baru/pengingat/perintah/diajak bersama)', roles: ['teknisi'] },
  { key: 'pengajuan_review_koordinator', label: 'Pengajuan/laporan baru menunggu review koordinator (izin, diklat, dokumen, kegiatan non-rutin, inspeksi & maintenance peralatan)', roles: ['koordinator'] },
  { key: 'pengajuan_keputusan', label: 'Hasil keputusan pengajuan dikirim ke pengaju (izin, diklat, dokumen, kegiatan non-rutin)', roles: ['teknisi', 'koordinator'] },
];

// Preferensi disimpan per-USER (bukan per-peran): settings.notification_prefs =
// { [eventKey]: { [userId]: boolean } }. Tidak diatur = anggap aktif (default true).
export async function getNotifyPrefs() {
  const [r] = await pool.query("SELECT setting_value FROM settings WHERE setting_key='notification_prefs'");
  const v = r[0]?.setting_value;
  try { return typeof v === 'string' ? JSON.parse(v) : (v || {}); } catch { return {}; }
}

export async function isNotifyEnabledForUser(eventKey, userId) {
  if (!userId) return true;
  const prefs = await getNotifyPrefs();
  return prefs[eventKey]?.[userId] !== false;
}
