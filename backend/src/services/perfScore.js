import { pool } from '../db/pool.js';
import { SLA_MINUTES, WORK_SHIFT_TYPES } from '../config/shifts.js';
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

// Saran peningkatan per komponen (keyed by component.key) — dipakai untuk komponen
// aktif yang masih di bawah target. `c` = komponen yang sudah dibentuk (value/num/den).
const TIP_MAP = {
  sla: (c) => `Ambil tiket lebih sigap saat on-duty — baru ${c.num}/${c.den} tiket diambil tepat waktu. Setiap tiket telat menurunkan skor terbesar.`,
  selesai: (c) => `Tuntaskan tiket yang masih terbuka — ${Math.max(0, c.den - c.num)} dari ${c.den} tiket yang diambil belum selesai.`,
  inspeksi: (c) => `Lakukan & catat inspeksi harian — baru ${c.num} dari ${c.den} hari dinas terisi inspeksi.`,
  pm: (c) => `Selesaikan maintenance bulanan yang direncanakan — baru ${c.num} dari ${c.den} tugas selesai.`,
  persetujuan: (c) => `Putuskan pengajuan tim lebih cepat (≤ 2 hari kerja) — baru ${c.num} dari ${c.den} tepat waktu.`,
  uptimeUnit: (c) => `Tingkatkan ketersediaan alat unit (kini ${c.value}%) — percepat pemulihan gangguan & jalankan PM rutin.`,
  eskalasi: (c) => `Tuntaskan insiden yang tereskalasi — baru ${c.num} dari ${c.den} tertangani.`,
  dokumen: (c) => `Lengkapi & perbarui dokumen unit — baru ${c.num} dari ${c.den} dokumen sah & berlaku (sahkan draft, perbarui yang kadaluarsa).`,
};

// Gabungkan komponen dgn normalisasi bobot atas komponen AKTIF (value != null).
function combine(components) {
  const active = components.filter((c) => c.value != null);
  const wsum = active.reduce((s, c) => s + c.weight, 0);
  const shaped = components.map((c) => ({ ...c, value: c.value == null ? null : Math.round(clamp(c.value)) }));
  if (!wsum) return { score: null, grade: 'Belum dinilai', components: shaped, tips: ['Belum ada tugas tercatat bulan ini. Ambil tiket, catat inspeksi, dan lengkapi kegiatan agar mulai dinilai.'] };
  const score = Math.round(active.reduce((s, c) => s + c.weight * clamp(c.value), 0) / wsum);
  // Saran: komponen aktif di bawah target, diprioritaskan dari yg PALING berdampak
  // (bobot × selisih ke 100). Ambil maksimal 3 saran paling bermanfaat.
  const shapedActive = shaped.filter((c) => c.value != null);
  const tips = shapedActive
    .filter((c) => c.value < 90 && TIP_MAP[c.key])
    .sort((a, b) => b.weight * (100 - b.value) - a.weight * (100 - a.value))
    .slice(0, 3)
    .map((c) => TIP_MAP[c.key](c));
  if (!tips.length) tips.push('Pertahankan! Semua komponen sudah di atas target. 👍');
  return { score, grade: gradeOfPct(score), components: shaped, tips };
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
    'SELECT COUNT(DISTINCT shift_date) d FROM shifts WHERE user_id=? AND shift_type IN (?) AND shift_date>=? AND shift_date<?',
    [userId, WORK_SHIFT_TYPES, start, end]
  );
  const hariDinas = Number(hd.d) || 0;
  // PM: dinilai dari Maintenance Bulanan (equipment_maintenance) yang dikelola di tab
  // Maintenance. Target per teknisi = tugas maintenance unit yang direncanakan pada rentang
  // ÷ jumlah teknisi aktif; nilai = tugas yang sudah diselesaikan (done_by) teknisi ini.
  const ufmd = unitFilter(unitId, 'd.unit_id');
  const [[pmDoneRow]] = await pool.query(
    `SELECT COUNT(*) c FROM equipment_maintenance m JOIN devices d ON d.id=m.device_id
      WHERE m.done_by=? AND m.status='selesai' AND m.scheduled_date>=? AND m.scheduled_date<?${ufmd.clause}`,
    [userId, start, end, ...ufmd.params]
  );
  const pmDone = Number(pmDoneRow.c) || 0;
  const pmTarget = await pmTargetPerTech(unitId, start, end);

  const taken = Number(t.taken) || 0, onTime = Number(t.onTime) || 0, done = Number(d.done) || 0, insC = Number(ins.c) || 0;
  return combine([
    { key: 'sla', label: 'Ketepatan SLA', weight: 35, value: pct(onTime, taken), num: onTime, den: taken,
      note: taken ? `${onTime} dari ${taken} tiket diambil ≤ ${SLA_MINUTES} menit` : 'Belum ambil tiket bulan ini' },
    { key: 'selesai', label: 'Penyelesaian', weight: 25, value: pct(done, taken), num: done, den: taken,
      note: taken ? `${done} dari ${taken} tiket yang diambil sudah selesai` : 'Belum ambil tiket bulan ini' },
    { key: 'inspeksi', label: 'Inspeksi', weight: 20, value: pct(insC, hariDinas), num: insC, den: hariDinas,
      note: hariDinas ? `${insC} inspeksi dari ${hariDinas} hari dinas` : 'Tidak ada hari dinas terjadwal' },
    { key: 'pm', label: 'Pemeliharaan (PM)', weight: 20, value: pct(pmDone, pmTarget), num: pmDone, den: pmTarget,
      note: pmTarget ? `${pmDone} maintenance selesai dari target ${pmTarget}` : 'Tidak ada rencana maintenance bulan ini' },
  ]);
}

// Beban PM per teknisi = tugas Maintenance Bulanan unit yang direncanakan pada rentang
// (status rencana/selesai, bukan batal) ÷ jumlah teknisi aktif unit (≥1). 0 bila unit
// tak punya tugas maintenance pada rentang → komponen PM diabaikan (bobot dibagi ulang).
async function pmTargetPerTech(unitId, start, end) {
  const ufd = unitFilter(unitId, 'd.unit_id');
  const [[p]] = await pool.query(
    `SELECT COUNT(*) c FROM equipment_maintenance m JOIN devices d ON d.id=m.device_id
      WHERE m.status IN ('rencana','selesai') AND m.scheduled_date>=? AND m.scheduled_date<?${ufd.clause}`,
    [start, end, ...ufd.params]
  );
  const tasks = Number(p.c) || 0;
  if (!tasks) return 0;
  const ufU = unitFilter(unitId, 'unit_id');
  const [[u]] = await pool.query(
    `SELECT COUNT(*) c FROM users WHERE active=1 AND (role='teknisi' OR JSON_CONTAINS(roles,'"teknisi"'))${ufU.clause}`,
    ufU.params
  );
  const techs = Math.max(1, Number(u.c) || 1);
  return Math.max(1, Math.round(tasks / techs));
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
  // 4) Kelengkapan dokumen unit: dokumen sah & masih berlaku ÷ total dokumen aktif (bukan arsip).
  const ufDoc = unitFilter(unitId, 'unit_id');
  const [[doc]] = await pool.query(
    `SELECT COUNT(*) total,
            SUM(status IN ('aktif','disetujui') AND (tanggal_review IS NULL OR tanggal_review >= CURDATE())) ok
       FROM documents WHERE status <> 'arsip'${ufDoc.clause}`,
    ufDoc.params
  );
  const docTotal = Number(doc.total) || 0, docOk = Number(doc.ok) || 0;

  const esMasuk = Number(es.masuk) || 0, esSelesai = Number(es.selesai) || 0;
  return combine([
    { key: 'persetujuan', label: 'Kecepatan Persetujuan', weight: 30, value: pct(apOnTime, apTotal), num: apOnTime, den: apTotal,
      note: apTotal ? `${apOnTime} dari ${apTotal} pengajuan diputus ≤ 2 hari kerja` : 'Tidak ada pengajuan diputus bulan ini' },
    { key: 'uptimeUnit', label: 'Ketersediaan Peralatan Unit', weight: 30, value: pct(up.up_ish, upBase), num: Number(up.up_ish), den: upBase,
      note: upBase > 0 ? 'Rata-rata ketersediaan perangkat unit dari pemantauan' : 'Belum ada data pemantauan' },
    { key: 'eskalasi', label: 'Penanganan Eskalasi', weight: 25, value: pct(esSelesai, esMasuk), num: esSelesai, den: esMasuk,
      note: esMasuk ? `${esSelesai} dari ${esMasuk} insiden eskalasi tertangani` : 'Tidak ada eskalasi bulan ini' },
    { key: 'dokumen', label: 'Kelengkapan Dokumen', weight: 15, value: pct(docOk, docTotal), num: docOk, den: docTotal,
      note: docTotal ? `${docOk} dari ${docTotal} dokumen sah & masih berlaku` : 'Belum ada dokumen di unit' },
  ]);
}

// Skor sesuai peran. roles: array/string. Koordinator diutamakan bila punya kedua peran.
export async function scoreForUser(user, start, end, unitId) {
  const roles = Array.isArray(user.roles) ? user.roles : (user.roles ? JSON.parse(user.roles) : (user.role ? [user.role] : []));
  const isKoor = roles.includes('koordinator');
  const scoped = unitId ?? user.unit_id ?? null;
  return isKoor ? scoreKoordinator(user.id, start, end, scoped) : scoreTeknisi(user.id, start, end, scoped);
}
