// =====================================================================
// Aturan shift / jam dinas teknisi.
// Ubah di SATU tempat ini saja jika aturan berubah (jam mulai/selesai,
// tambah/hapus shift, atau ambang SLA).
// Jam dalam format 24 jam (0-24). Jika `start > end`, shift dianggap
// melewati tengah malam (mis. malam 20:00 -> 05:00 keesokan hari).
// =====================================================================

// Nilai default pabrik — dipakai bila belum ada pengaturan kustom di DB.
// Pagi & Siang SELALU jadi jendela on-duty. Dinas Kantor (N/malam) OPSIONAL:
// hanya jadi jendela on-duty bila koordinator menambahkannya lewat "Atur Jam Dinas"
// (default jam di bawah dipakai sebagai nilai awal saat aturan ditambahkan).
export const DEFAULT_SHIFT_WINDOWS = {
  pagi: { start: 5, end: 13 },   // 05:00 - 13:00
  siang: { start: 12, end: 20 }, // 12:00 - 20:00
  malam: { start: 20, end: 5 },  // 20:00 - 05:00 (lintas tengah malam) — nilai awal bila diaktifkan
};

// Shift wajib (selalu punya jendela) vs opsional (hanya bila dikonfigurasi).
// Kunci opsional HARUS 'malam' agar selaras dgn enum DB shift_type, "Atur Jam Dinas"
// (jadwalRoutes menyimpan units.config.shift_windows.malam) & frontend (Jadwal.tsx).
const REQUIRED_WINS = ['pagi', 'siang'];
const OPTIONAL_WINS = ['malam'];

// ===== Tipe shift — SATU sumber kebenaran =====
// Semua logika "hari dinas / on-duty" HARUS mengacu ke daftar ini, jangan meng-hardcode
// literal ('pagi','siang','malam') di query/route lain — itu sumber bug bila daftar berubah.
// WORK = shift kerja (dihitung on-duty & target inspeksi); NONWORK = tak punya jam dinas.
export const WORK_SHIFT_TYPES = [...REQUIRED_WINS, ...OPTIONAL_WINS]; // ['pagi','siang','malam']
export const NONWORK_SHIFT_TYPES = ['libur', 'dinas_luar', 'cuti'];
export const ALL_SHIFT_TYPES = [...WORK_SHIFT_TYPES, ...NONWORK_SHIFT_TYPES]; // selaras enum DB


// Window aktif yang dipakai seluruh logika on-duty. Bisa di-override Koordinator
// dari UI Jadwal (tersimpan di settings.shift_windows). Objek ini di-MUTASI in-place
// oleh loadShiftWindows() agar binding yang sudah di-import ikut melihat nilai terbaru.
// Default: hanya pagi & siang (malam tidak on-duty kecuali diaktifkan).
export const SHIFT_WINDOWS = {
  pagi: { ...DEFAULT_SHIFT_WINDOWS.pagi },
  siang: { ...DEFAULT_SHIFT_WINDOWS.siang },
};

// Jam dinas PER UNIT (Fase jam-dinas). Diisi dari units.config.shift_windows.
// { [unitId]: { pagi:{start,end}, siang:{start,end}, malam?:{start,end} } }.
// Unit tanpa override memakai SHIFT_WINDOWS global.
export const UNIT_SHIFT_WINDOWS = {};

// Normalisasi objek windows dari sumber apa pun → pagi/siang wajib (fallback ke base),
// malam opsional. `base` = nilai fallback bila field tidak valid.
function normalizeWindows(v, base) {
  const out = {};
  for (const k of REQUIRED_WINS) {
    const d = base[k] || DEFAULT_SHIFT_WINDOWS[k];
    const o = v && typeof v === 'object' ? v[k] : null;
    const start = o && Number.isFinite(Number(o.start)) ? Number(o.start) : d.start;
    const end = o && Number.isFinite(Number(o.end)) ? Number(o.end) : d.end;
    out[k] = { start, end };
  }
  for (const k of OPTIONAL_WINS) {
    const o = v && typeof v === 'object' ? v[k] : null;
    if (o && Number.isFinite(Number(o.start)) && Number.isFinite(Number(o.end))) {
      out[k] = { start: Number(o.start), end: Number(o.end) };
    }
  }
  return out;
}

/**
 * Muat jam dinas global (settings 'shift_windows') + per-unit (units.config.shift_windows).
 * Aman dipanggil ulang. Global dipertahankan sbg fallback untuk unit tanpa override.
 */
export async function loadShiftWindows(conn) {
  try {
    const [rows] = await conn.query("SELECT setting_value FROM settings WHERE setting_key = 'shift_windows' LIMIT 1");
    let v = rows[0]?.setting_value;
    if (typeof v === 'string') { try { v = JSON.parse(v); } catch { v = null; } }
    const g = normalizeWindows(v, DEFAULT_SHIFT_WINDOWS);
    SHIFT_WINDOWS.pagi = g.pagi; SHIFT_WINDOWS.siang = g.siang;
    if (g.malam) SHIFT_WINDOWS.malam = g.malam; else delete SHIFT_WINDOWS.malam;
  } catch { /* pertahankan nilai global saat ini */ }
  // Per-unit dari units.config.shift_windows.
  try {
    const [units] = await conn.query('SELECT id, config FROM units');
    for (const k of Object.keys(UNIT_SHIFT_WINDOWS)) delete UNIT_SHIFT_WINDOWS[k];
    for (const u of units) {
      let cfg = u.config;
      if (typeof cfg === 'string') { try { cfg = JSON.parse(cfg); } catch { cfg = null; } }
      const sw = cfg && typeof cfg === 'object' ? cfg.shift_windows : null;
      if (sw && typeof sw === 'object') UNIT_SHIFT_WINDOWS[u.id] = normalizeWindows(sw, SHIFT_WINDOWS);
    }
  } catch { /* abaikan; unit pakai global */ }
  return SHIFT_WINDOWS;
}

/** Jendela jam dinas efektif untuk sebuah unit (override unit → global). */
export function getUnitWindows(unitId) {
  return (unitId != null && UNIT_SHIFT_WINDOWS[unitId]) || SHIFT_WINDOWS;
}

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

/** Apakah jam `when` berada dalam window sebuah shift_type untuk unit tsb. (tanpa cek tanggal) */
export function hourInWindow(shiftType, when = new Date(), unitId = null) {
  const w = getUnitWindows(unitId)[shiftType];
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
    `SELECT s.user_id, s.shift_date, s.shift_type, u.unit_id
       FROM shifts s JOIN users u ON u.id = s.user_id
      WHERE u.active = 1 AND (u.role = 'teknisi' OR JSON_CONTAINS(u.roles, '"teknisi"')) AND s.shift_date IN (?, ?)`,
    [todayKey, ydayKey]
  );
  const h = when.getHours() + when.getMinutes() / 60;
  const onDuty = new Set();
  for (const r of rows) {
    const w = getUnitWindows(r.unit_id)[r.shift_type]; // jam dinas per unit
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

/**
 * Seperti getOnDutyTechIds, tapi HANYA teknisi yang SUDAH ABSEN MASUK hari ini
 * (attendance.check_in_at terisi). Dipakai untuk notifikasi insiden — hanya teknisi
 * yang benar-benar hadir yang diberi tahu; bila kosong, pemanggil mengeskalasi ke koordinator.
 */
export async function getOnDutyCheckedInTechIds(conn, when = new Date()) {
  const onDuty = await getOnDutyTechIds(conn, when);
  if (!onDuty.length) return [];
  const [rows] = await conn.query(
    'SELECT DISTINCT user_id FROM attendance WHERE user_id IN (?) AND work_date = ? AND check_in_at IS NOT NULL',
    [onDuty, dateKey(when)]
  );
  return rows.map((r) => r.user_id);
}

/** Status on-duty untuk satu user pada waktu `when`. */
export async function getDutyStatus(conn, userId, when = new Date()) {
  const ids = await getOnDutyTechIds(conn, when);
  const onDuty = ids.includes(Number(userId));
  let shift = null;
  if (onDuty) {
    const [[u]] = await conn.query('SELECT unit_id FROM users WHERE id = ? LIMIT 1', [userId]);
    const [rows] = await conn.query(
      `SELECT shift_type, shift_date FROM shifts
        WHERE user_id = ? AND shift_date IN (?, ?)`,
      [userId, dateKey(when), dateKey(new Date(when.getTime() - 86400000))]
    );
    const active = rows.find((r) => hourInWindow(r.shift_type, when, u?.unit_id));
    shift = active ? active.shift_type : null;
  }
  return { onDuty, shift, onDutyCount: ids.length };
}

// ===== Gate "buka 1 jam sebelum jam dinas" (absensi & hidupkan-peralatan) =====
const OPEN_BEFORE_MIN = 60;

const fmtHour = (h) => {
  const norm = ((h % 24) + 24) % 24;
  const hh = Math.floor(norm);
  const mm = Math.round((norm - hh) * 60);
  return `${String(hh).padStart(2, '0')}:${String(mm % 60).padStart(2, '0')}`;
};

/**
 * Cek apakah user boleh absen/menghidupkan peralatan pada `when`.
 * Aturan: hanya mulai OPEN_BEFORE_MIN menit sebelum jam mulai shift dinasnya hari ini
 * (jam dinas per unit). Bila user tidak terjadwal dinas hari ini → tidak digating.
 * Mengembalikan { hasShift, allowed, opensAt, shiftType }.
 */
export async function shiftOpenGate(conn, userId, when = new Date()) {
  const [[u]] = await conn.query('SELECT unit_id FROM users WHERE id = ? LIMIT 1', [userId]);
  const [rows] = await conn.query(
    'SELECT shift_type FROM shifts WHERE user_id = ? AND shift_date = ? AND shift_type IN (?)',
    [userId, dateKey(when), WORK_SHIFT_TYPES]
  );
  if (!rows.length) return { hasShift: false, allowed: true, opensAt: null, shiftType: null };
  const win = getUnitWindows(u?.unit_id);
  // Ambil shift dgn jam buka paling awal (bila kebetulan ada >1).
  let best = null;
  for (const r of rows) {
    const w = win[r.shift_type];
    if (!w || !WORK_SHIFT_TYPES.includes(r.shift_type)) continue;
    const openH = w.start - OPEN_BEFORE_MIN / 60;
    if (best == null || openH < best.openH) best = { openH, start: w.start, shiftType: r.shift_type };
  }
  if (!best) return { hasShift: false, allowed: true, opensAt: null, shiftType: null };
  const h = when.getHours() + when.getMinutes() / 60;
  return { hasShift: true, allowed: h >= best.openH, opensAt: fmtHour(best.openH), shiftType: best.shiftType };
}
