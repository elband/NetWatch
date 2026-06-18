// =====================================================================
// Aturan shift / jam dinas teknisi.
// Ubah di SATU tempat ini saja jika aturan berubah (jam mulai/selesai,
// tambah/hapus shift, atau ambang SLA).
// Jam dalam format 24 jam (0-24). Jika `start > end`, shift dianggap
// melewati tengah malam (mis. malam 20:00 -> 05:00 keesokan hari).
// =====================================================================

export const SHIFT_WINDOWS = {
  pagi: { start: 5, end: 13 },   // 05:00 - 13:00
  siang: { start: 12, end: 20 }, // 12:00 - 20:00
  malam: { start: 20, end: 5 },  // 20:00 - 05:00 (lintas tengah malam) — cadangan
};

// Batas waktu (menit) sebuah insiden harus sudah diambil/ditangani oleh
// teknisi yang sedang on-duty. Lewat dari ini = pelanggaran SLA.
export const SLA_MINUTES = 30;

// Batas waktu (menit) eskalasi ke koordinator: bila insiden belum diambil
// sampai menit ini, koordinator diberi notifikasi — ini CUE bagi koordinator
// untuk menekan tombol "Ingatkan" manual.
export const COORD_SLA_MINUTES = 10;

// Batas waktu (menit) "telat diambil" pada PENILAIAN performa koordinator:
// insiden dianggap telat (pelanggaran) bila belum diambil teknisi dalam waktu
// ini. Diambil ≤ batas ini = tepat waktu.
export const COORD_BREACH_MINUTES = 30;

// Batas waktu (menit) pengingat otomatis: bila insiden belum diambil sampai
// menit ini, kirim WA pengingat ke teknisi yang sedang on-duty.
export const REMIND_MINUTES = 5;

/** Format Date / string apa pun menjadi 'YYYY-MM-DD' waktu lokal. */
export function dateKey(d) {
  const dt = d instanceof Date ? d : new Date(d);
  const y = dt.getFullYear();
  const m = String(dt.getMonth() + 1).padStart(2, '0');
  const day = String(dt.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** Apakah jam `when` berada dalam window sebuah shift_type. (tanpa cek tanggal) */
export function hourInWindow(shiftType, when = new Date()) {
  const w = SHIFT_WINDOWS[shiftType];
  if (!w) return false;
  const h = when.getHours() + when.getMinutes() / 60;
  return w.start <= w.end ? h >= w.start && h < w.end : h >= w.start || h < w.end;
}

/**
 * Daftar user_id teknisi yang SEDANG on-duty pada waktu `when`,
 * berdasarkan jadwal (tabel shifts) + window jam shift.
 */
export async function getOnDutyTechIds(conn, when = new Date()) {
  const todayKey = dateKey(when);
  const ydayKey = dateKey(new Date(when.getTime() - 86400000));
  const [rows] = await conn.query(
    `SELECT s.user_id, s.shift_date, s.shift_type
       FROM shifts s JOIN users u ON u.id = s.user_id
      WHERE u.active = 1 AND (u.role = 'teknisi' OR JSON_CONTAINS(u.roles, '"teknisi"')) AND s.shift_date IN (?, ?)`,
    [todayKey, ydayKey]
  );
  const h = when.getHours() + when.getMinutes() / 60;
  const onDuty = new Set();
  for (const r of rows) {
    const w = SHIFT_WINDOWS[r.shift_type];
    if (!w) continue;
    const rowKey = dateKey(r.shift_date);
    if (w.start <= w.end) {
      // shift normal: hanya berlaku di tanggalnya sendiri
      if (rowKey === todayKey && h >= w.start && h < w.end) onDuty.add(r.user_id);
    } else {
      // shift lintas tengah malam: malam ini ditutup baris hari ini (jam >= start),
      // dini hari ditutup baris kemarin (jam < end)
      if (rowKey === todayKey && h >= w.start) onDuty.add(r.user_id);
      if (rowKey === ydayKey && h < w.end) onDuty.add(r.user_id);
    }
  }
  return [...onDuty];
}

/** Status on-duty untuk satu user pada waktu `when`. */
export async function getDutyStatus(conn, userId, when = new Date()) {
  const ids = await getOnDutyTechIds(conn, when);
  const onDuty = ids.includes(Number(userId));
  let shift = null;
  if (onDuty) {
    const [rows] = await conn.query(
      `SELECT shift_type, shift_date FROM shifts
        WHERE user_id = ? AND shift_date IN (?, ?)`,
      [userId, dateKey(when), dateKey(new Date(when.getTime() - 86400000))]
    );
    const active = rows.find((r) => hourInWindow(r.shift_type, when));
    shift = active ? active.shift_type : null;
  }
  return { onDuty, shift, onDutyCount: ids.length };
}
