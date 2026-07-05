import { pool } from '../db/pool.js';
import { SLA_MINUTES } from '../config/shifts.js';
import { unitFilter } from '../middleware/unitScope.js';

// =============================================================================
// perfScore — skor performa PERSEN (0–100) berbasis komponen, untuk teknisi &
// koordinator. Setiap komponen bernilai 0–100% (di-cap). Komponen "kosong"
// (pembagi 0, tak ada tugasnya) DIBUANG dan bobotnya dibagi ulang ke komponen
// aktif. Bila SEMUA komponen kosong → skor null ("Belum dinilai").
// Formula, bobot, & skala grade dikunci dari diskusi (lihat memory performa-persen).
// =============================================================================

const GRADES = [[90, 'Sangat Baik'], [75, 'Baik'], [60, 'Cukup'], [50, 'Kurang'], [0, 'Perlu Pembinaan']];
export function gradeOfPct(score) {
  for (const [min, label] of GRADES) if (score >= min) return label;
  return 'Perlu Pembinaan';
}

// Persentase aman: null bila pembagi 0 (komponen dianggap kosong → dinormalisasi).
const pct = (num, den) => (den > 0 ? (Number(num) / den) * 100 : null);
const clamp = (v) => Math.max(0, Math.min(100, v));

// Gabungkan komponen dgn normalisasi bobot atas komponen AKTIF (value != null).
function combine(components) {
  const active = components.filter((c) => c.value != null);
  const wsum = active.reduce((s, c) => s + c.weight, 0);
  const shaped = components.map((c) => ({ ...c, value: c.value == null ? null : Math.round(clamp(c.value)) }));
  if (!wsum) return { score: null, grade: 'Belum dinilai', components: shaped };
  const score = Math.round(active.reduce((s, c) => s + c.weight * clamp(c.value), 0) / wsum);
  return { score, grade: gradeOfPct(score), components: shaped };
}

// ————————————————————— TEKNISI —————————————————————
// SLA 35% (diambil tepat waktu ÷ total diambil) · Penyelesaian 25% (selesai ÷ diambil)
// · Inspeksi 20% (inspeksi ÷ hari dinas) · PM 20% (PM selesai ÷ PM jatuh tempo per teknisi).
export async function scoreTeknisi(userId, start, end, unitId) {
  const uf = unitFilter(unitId);
  const [[t]] = await pool.query(
    `SELECT COUNT(*) taken, SUM(TIMESTAMPDIFF(MINUTE,created_at,taken_at)<=?) onTime
       FROM incidents WHERE tech_id=? AND taken_at IS NOT NULL AND taken_at>=? AND taken_at<?${uf.clause}`,
    [SLA_MINUTES, userId, start, end, ...uf.params]
  );
  const [[d]] = await pool.query(
    `SELECT COUNT(*) done FROM incidents WHERE tech_id=? AND status='selesai' AND resolved_at>=? AND resolved_at<?${uf.clause}`,
    [userId, start, end, ...uf.params]
  );
  const [[ins]] = await pool.query(
    'SELECT COUNT(*) c FROM equipment_inspections WHERE inspected_by=? AND inspect_date>=? AND inspect_date<?',
    [userId, start, end]
  );
  // Target inspeksi = jumlah HARI DINAS teknisi bulan itu (shift kerja pagi/siang/malam).
  const [[hd]] = await pool.query(
    "SELECT COUNT(DISTINCT shift_date) d FROM shifts WHERE user_id=? AND shift_type IN ('pagi','siang','malam') AND shift_date>=? AND shift_date<?",
    [userId, start, end]
  );
  const hariDinas = Number(hd.d) || 0;
  // PM: rencana bersifat per-unit, bukan per-teknisi. Target per teknisi = beban PM unit
  // dibagi jumlah teknisi aktif (pembagian merata). Kosong bila unit tak punya rencana PM.
  const [[pmDoneRow]] = await pool.query(
    "SELECT COUNT(*) c FROM equipment_maintenance WHERE done_by=? AND status='selesai' AND done_at>=? AND done_at<?",
    [userId, start, end]
  );
  const pmDone = Number(pmDoneRow.c) || 0;
  const pmTarget = await pmTargetPerTech(unitId);

  const taken = Number(t.taken) || 0, onTime = Number(t.onTime) || 0, done = Number(d.done) || 0, insC = Number(ins.c) || 0;
  return combine([
    { key: 'sla', label: 'Ketepatan SLA', weight: 35, value: pct(onTime, taken), num: onTime, den: taken,
      note: taken ? `${onTime} dari ${taken} tiket diambil ≤ ${SLA_MINUTES} menit` : 'Belum ambil tiket bulan ini' },
    { key: 'selesai', label: 'Penyelesaian', weight: 25, value: pct(done, taken), num: done, den: taken,
      note: taken ? `${done} dari ${taken} tiket yang diambil sudah selesai` : 'Belum ambil tiket bulan ini' },
    { key: 'inspeksi', label: 'Inspeksi', weight: 20, value: pct(insC, hariDinas), num: insC, den: hariDinas,
      note: hariDinas ? `${insC} inspeksi dari ${hariDinas} hari dinas` : 'Tidak ada hari dinas terjadwal' },
    { key: 'pm', label: 'Pemeliharaan (PM)', weight: 20, value: pct(pmDone, pmTarget), num: pmDone, den: pmTarget,
      note: pmTarget ? `${pmDone} PM selesai dari target ${pmTarget}` : 'Tidak ada rencana PM di unit' },
  ]);
}

// Beban PM per teknisi = rencana PM aktif unit ÷ jumlah teknisi aktif unit (≥1).
// 0 bila unit tak punya rencana PM aktif → komponen PM diabaikan.
async function pmTargetPerTech(unitId) {
  const ufP = unitFilter(unitId, 'unit_id');
  const [[p]] = await pool.query(`SELECT COUNT(*) c FROM asset_pm_plans WHERE active=1${ufP.clause}`, ufP.params);
  const plans = Number(p.c) || 0;
  if (!plans) return 0;
  const ufU = unitFilter(unitId, 'unit_id');
  const [[u]] = await pool.query(
    `SELECT COUNT(*) c FROM users WHERE active=1 AND (role='teknisi' OR JSON_CONTAINS(roles,'"teknisi"'))${ufU.clause}`,
    ufU.params
  );
  const techs = Math.max(1, Number(u.c) || 1);
  return Math.max(1, Math.round(plans / techs));
}

// ————————————————————— KOORDINATOR —————————————————————
// Kecepatan Persetujuan 30% · Ketersediaan Peralatan Unit 30% · Penanganan Eskalasi 25%
// · Kelengkapan Jadwal Dinas 15%. Semua ter-scope unit efektif.
const APPROVAL_TABLES = ['activities', 'pengajuan_diklat', 'documents', 'kegiatan_non_rutin', 'leave_requests'];
const APPROVAL_TARGET_HOURS = 48; // ≤ 2 hari kerja (disederhanakan 48 jam)

export async function scoreKoordinator(userId, start, end, unitId) {
  // 1) Kecepatan persetujuan: dari item yang DIPUTUS pada periode, % diputus ≤ target.
  let apTotal = 0, apOnTime = 0;
  for (const tbl of APPROVAL_TABLES) {
    const uf = unitFilter(unitId);
    const [[r]] = await pool.query(
      `SELECT COUNT(*) total, SUM(TIMESTAMPDIFF(HOUR,created_at,approved_at)<=?) ontime
         FROM ${tbl} WHERE approved_at IS NOT NULL AND approved_at>=? AND approved_at<?${uf.clause}`,
      [APPROVAL_TARGET_HOURS, start, end, ...uf.params]
    );
    apTotal += Number(r.total) || 0;
    apOnTime += Number(r.ontime) || 0;
  }
  // 2) Ketersediaan peralatan unit (online+warning)/(sampel−maintenance).
  const ufd = unitFilter(unitId, 'd.unit_id');
  const [[up]] = await pool.query(
    `SELECT COALESCE(SUM(u.up_samples + u.warn_samples),0) up_ish, COALESCE(SUM(u.samples),0) tot, COALESCE(SUM(u.maint_samples),0) maint
       FROM device_uptime_daily u JOIN devices d ON d.id=u.device_id
      WHERE u.day>=? AND u.day<?${ufd.clause}`,
    [start, end, ...ufd.params]
  );
  const upBase = Number(up.tot) - Number(up.maint);
  // 3) Penanganan eskalasi: insiden coord_alerted=1 selesai ÷ masuk (periode).
  const uf = unitFilter(unitId);
  const [[es]] = await pool.query(
    `SELECT COUNT(*) masuk, SUM(status='selesai') selesai
       FROM incidents WHERE coord_alerted=1 AND created_at>=? AND created_at<?${uf.clause}`,
    [start, end, ...uf.params]
  );
  // 4) Kelengkapan jadwal: hari yang ada shift kerja ÷ hari yang seharusnya (elapsed utk bulan berjalan).
  const ufs = unitFilter(unitId, 's.unit_id');
  const [[jd]] = await pool.query(
    `SELECT COUNT(DISTINCT s.shift_date) d FROM shifts s
      WHERE s.shift_type IN ('pagi','siang','malam') AND s.shift_date>=? AND s.shift_date<?${ufs.clause}`,
    [start, end, ...ufs.params]
  );
  const expectedDays = expectedDaysInRange(start, end);

  const esMasuk = Number(es.masuk) || 0, esSelesai = Number(es.selesai) || 0, jdDays = Number(jd.d) || 0;
  return combine([
    { key: 'persetujuan', label: 'Kecepatan Persetujuan', weight: 30, value: pct(apOnTime, apTotal), num: apOnTime, den: apTotal,
      note: apTotal ? `${apOnTime} dari ${apTotal} pengajuan diputus ≤ 2 hari kerja` : 'Tidak ada pengajuan diputus bulan ini' },
    { key: 'uptimeUnit', label: 'Ketersediaan Peralatan Unit', weight: 30, value: pct(up.up_ish, upBase), num: Number(up.up_ish), den: upBase,
      note: upBase > 0 ? 'Rata-rata ketersediaan perangkat unit dari pemantauan' : 'Belum ada data pemantauan' },
    { key: 'eskalasi', label: 'Penanganan Eskalasi', weight: 25, value: pct(esSelesai, esMasuk), num: esSelesai, den: esMasuk,
      note: esMasuk ? `${esSelesai} dari ${esMasuk} insiden eskalasi tertangani` : 'Tidak ada eskalasi bulan ini' },
    { key: 'jadwal', label: 'Kelengkapan Jadwal Dinas', weight: 15, value: pct(jdDays, expectedDays), num: Math.min(jdDays, expectedDays), den: expectedDays,
      note: `${Math.min(jdDays, expectedDays)} dari ${expectedDays} hari sudah terisi jadwal` },
  ]);
}

// Jumlah hari yang "seharusnya" ada dalam rentang [start,end): untuk bulan berjalan
// hanya sampai hari ini (jangan hukum hari yang belum tiba).
function expectedDaysInRange(start, end) {
  const s = new Date(`${start}T00:00:00`);
  const e = new Date(`${end}T00:00:00`);
  const now = new Date();
  const cap = now < e ? now : e;
  if (cap <= s) return 0;
  return Math.max(0, Math.round((cap - s) / 86400000));
}

// Skor sesuai peran. roles: array/string. Koordinator diutamakan bila punya kedua peran.
export async function scoreForUser(user, start, end, unitId) {
  const roles = Array.isArray(user.roles) ? user.roles : (user.roles ? JSON.parse(user.roles) : (user.role ? [user.role] : []));
  const isKoor = roles.includes('koordinator');
  const scoped = unitId ?? user.unit_id ?? null;
  return isKoor ? scoreKoordinator(user.id, start, end, scoped) : scoreTeknisi(user.id, start, end, scoped);
}
