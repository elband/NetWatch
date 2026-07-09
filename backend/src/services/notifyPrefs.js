import { pool } from '../db/pool.js';
import { queueWaRaw } from '../jobs/waQueue.js';

// Katalog jenis notifikasi yang bisa diatur admin di halaman Pengaturan Notifikasi.
// `roles` = peran yang relevan menerima event ini (dipakai frontend utk menentukan
// kolom peran mana yang tampil checkbox-nya; peran di luar daftar ini selalu "—").
// Catatan: 'kasi' (Kepala Seksi) BUKAN peran/akun — ia penerima eksternal (nomor di
// Pengaturan). Bila 'kasi' ada di daftar roles sebuah event, notifikasi event itu juga
// bisa di-CC ke nomor Kepala Seksi (default MATI / opt-in, lihat isNotifyEnabledForKasi).
export const NOTIF_EVENTS = [
  { key: 'absensi_vpn_lokasi', label: 'Absensi tidak wajar (lokasi/GPS/perangkat asing)', roles: ['koordinator'] },
  { key: 'absensi_duplikat_perangkat', label: 'Perangkat absensi dipakai bersama (duplikat)', roles: ['teknisi', 'admin'] },
  { key: 'maintenance_reminder', label: 'Pengingat maintenance peralatan (harian 08:00)', roles: ['teknisi'] },
  { key: 'peralatan_matikan_reminder', label: 'Pengingat mematikan peralatan (sore, peralatan masih tercatat hidup) — hanya koordinator', roles: ['koordinator'] },
  { key: 'insiden_koordinator', label: 'Insiden: notifikasi ke koordinator (baru/selesai/eskalasi SLA)', roles: ['koordinator', 'kasi'] },
  { key: 'insiden_teknisi', label: 'Insiden: notifikasi ke teknisi (tiket baru/pengingat/perintah/diajak bersama)', roles: ['teknisi'] },
  { key: 'pengajuan_review_koordinator', label: 'Pengajuan/laporan baru menunggu review koordinator (izin, diklat, dokumen, kegiatan non-rutin, inspeksi & maintenance peralatan)', roles: ['koordinator'] },
  { key: 'pengajuan_keputusan', label: 'Hasil keputusan pengajuan dikirim ke pengaju (izin, diklat, dokumen, kegiatan non-rutin)', roles: ['teknisi', 'koordinator'] },
  { key: 'absensi_keputusan_alpa', label: 'Hasil keputusan absen (ALPA/dimaafkan) dikirim ke teknisi', roles: ['teknisi'] },
];

// Kolom pada matriks pengaturan notifikasi. 'kasi' = Kepala Seksi (penerima eksternal).
export const NOTIF_ROLES = ['admin', 'koordinator', 'teknisi', 'viewer', 'kasi'];

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

// Apakah Kepala Seksi (Kasi) harus di-CC untuk event ini. Berbeda dgn peran user:
// Kasi adalah penerima eksternal & bersifat OPT-IN — default MATI sampai admin
// mencentang kolom "Kasi" untuk event tersebut.
export async function isNotifyEnabledForKasi(eventKey) {
  const prefs = await getNotifyPrefs();
  return prefs?.[eventKey]?.kasi === true;
}

// Ambil nomor & nama Kepala Seksi dari Pengaturan (settings.lkp). Mendukung kunci
// lama (kepala_*) maupun baru (kasie_*).
async function getKasiContact() {
  const [r] = await pool.query("SELECT setting_value FROM settings WHERE setting_key='lkp'");
  let lkp = {};
  try { const v = r[0]?.setting_value; lkp = (typeof v === 'string' ? JSON.parse(v) : v) || {}; } catch { lkp = {}; }
  return {
    phone: lkp.kasie_phone || lkp.kepala_phone || '',
    nama: lkp.kasie_nama || lkp.kepala_nama || 'Kepala Seksi',
  };
}

// Kirim WA ke Kepala Seksi bila event-nya diaktifkan untuk Kasi & nomornya tersedia.
// Mengembalikan true bila pesan diantrikan.
export async function notifyKasiIfEnabled(eventKey, { type = 'alert', message, relatedIncidentId = null } = {}) {
  if (!(await isNotifyEnabledForKasi(eventKey))) return false;
  const { phone, nama } = await getKasiContact();
  if (!phone) return false; // nomor Kasi belum diatur → lewati diam-diam
  try {
    await queueWaRaw({ type, toLabel: `Kepala Seksi (${nama})`, phone, message, relatedIncidentId });
    return true;
  } catch {
    return false;
  }
}
