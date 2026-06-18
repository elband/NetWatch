import { Router } from 'express';
import { pool } from '../db/pool.js';
import { requireAuth } from '../middleware/auth.js';
import { SLA_MINUTES } from '../config/shifts.js';

const router = Router();
router.use(requireAuth);

// ===== Aturan penilaian baru (skor 0–100) =====
// Skor = 30 + selesai×2 + tepatSLA×4 + kritis×6 + PM×3 + dok×5 − pelanggaran×10 − eskalasi×5 − reopen×8 − absen×15
const W = { base: 30, done: 2, onTime: 4, kritis: 6, pm: 3, dok: 5, breach: -10, eskalasi: -5, reopen: -8, absen: -15 };
export function calcScore(m) {
  const raw = W.base + m.done * W.done + m.onTime * W.onTime + m.kritisDone * W.kritis + m.pm * W.pm + m.dokumentasi * W.dok
    + m.breaches * W.breach + m.eskalasi * W.eskalasi + m.reopen * W.reopen + m.absen * W.absen;
  return { raw, score: Math.max(0, Math.min(100, raw)) };
}
export function gradeOf(s) {
  if (s >= 90) return { grade: 'A+', label: 'Outstanding' };
  if (s >= 80) return { grade: 'A', label: 'Sangat Baik' };
  if (s >= 70) return { grade: 'B', label: 'Baik' };
  if (s >= 60) return { grade: 'C', label: 'Cukup' };
  if (s >= 50) return { grade: 'D', label: 'Kurang' };
  return { grade: 'E', label: 'Perlu Pembinaan' };
}
// Bobot layanan (untuk peringkat layanan & insight kekritisan).
const SERVICE_WEIGHTS = {
  'FIDS': 3, 'Flight Information Server': 3, 'Access Control': 3,
  'Jaringan Core': 2, 'Internet Bandara': 2, 'CCTV': 2, 'Printer': 1, 'PC User': 1,
};
const svcWeight = (name) => {
  const n = String(name || '').toLowerCase();
  for (const [k, v] of Object.entries(SERVICE_WEIGHTS)) if (n.includes(k.toLowerCase())) return v;
  return 1;
};

function monthRange(month) {
  if (month && /^\d{4}-\d{2}$/.test(month)) {
    const [y, m] = month.split('-').map(Number);
    return { start: `${y}-${String(m).padStart(2, '0')}-01`, end: `${m === 12 ? y + 1 : y}-${String(m === 12 ? 1 : m + 1).padStart(2, '0')}-01` };
  }
  return { start: '1970-01-01', end: '2999-01-01' };
}

// Hitung semua metrik 1 teknisi pada rentang [start, end).
export async function metricsFor(id, start, end) {
  const [[d]] = await pool.query("SELECT COUNT(*) done, SUM(priority='kritis') kritis, COALESCE(AVG(duration_min),0) avgDur FROM incidents WHERE tech_id=? AND status='selesai' AND resolved_at>=? AND resolved_at<?", [id, start, end]);
  const [[t]] = await pool.query('SELECT COUNT(*) taken, SUM(TIMESTAMPDIFF(MINUTE,created_at,taken_at)<=?) onTime, COALESCE(AVG(TIMESTAMPDIFF(MINUTE,created_at,taken_at)),0) avgResp FROM incidents WHERE tech_id=? AND taken_at IS NOT NULL AND taken_at>=? AND taken_at<?', [SLA_MINUTES, id, start, end]);
  const [[a]] = await pool.query("SELECT COUNT(*) active FROM incidents WHERE tech_id=? AND status!='selesai'", [id]);
  const [[br]] = await pool.query(
    `SELECT COUNT(*) c FROM incident_duty d JOIN incidents i ON i.id=d.incident_id
      WHERE d.user_id=? AND i.created_at>=? AND i.created_at<?
        AND ((i.taken_at IS NOT NULL AND TIMESTAMPDIFF(MINUTE,i.created_at,i.taken_at)>?) OR (i.taken_at IS NULL AND TIMESTAMPDIFF(MINUTE,i.created_at,NOW())>?))`,
    [id, start, end, SLA_MINUTES, SLA_MINUTES]
  );
  const [[es]] = await pool.query('SELECT COUNT(*) c FROM incident_duty d JOIN incidents i ON i.id=d.incident_id WHERE d.user_id=? AND i.coord_alerted=1 AND i.created_at>=? AND i.created_at<?', [id, start, end]);
  const [[pm]] = await pool.query("SELECT COUNT(*) c FROM equipment_maintenance WHERE done_by=? AND status='selesai' AND done_at>=? AND done_at<?", [id, start, end]);
  const [[dk]] = await pool.query('SELECT COUNT(*) c FROM incident_reports WHERE reported_by=? AND created_at>=? AND created_at<?', [id, start, end]);
  const [[ins]] = await pool.query('SELECT COUNT(*) c FROM equipment_inspections WHERE inspected_by=? AND inspect_date>=? AND inspect_date<?', [id, start, end]);

  // Absen: HANYA ketidakhadiran yang sudah dikonfirmasi 'penalti' oleh koordinator
  // (lihat absence_reviews). Tanpa konfirmasi → tidak memotong skor.
  const [[ab]] = await pool.query("SELECT COUNT(*) c FROM absence_reviews WHERE user_id=? AND status='penalti' AND work_date>=? AND work_date<?", [id, start, end]);
  const absen = ab.c;
  // Pelanggaran lokasi/VPN saat absensi → penalti 50% pada skor akhir.
  const [[vp]] = await pool.query('SELECT COUNT(*) c FROM attendance WHERE user_id=? AND flagged=1 AND work_date>=? AND work_date<?', [id, start, end]);
  const vpnDays = vp.c, vpnFlag = vp.c > 0;

  const m = {
    done: d.done, active: a.active, taken: t.taken, onTime: Number(t.onTime) || 0, kritisDone: Number(d.kritis) || 0,
    pm: pm.c, dokumentasi: dk.c, breaches: br.c, eskalasi: es.c, reopen: 0, absen, inspections: ins.c,
    vpnDays, vpnFlag, avgResp: Math.round(t.avgResp), avgDur: Math.round(d.avgDur),
  };
  const { raw, score: base } = calcScore(m);
  const score = vpnFlag ? Math.round(base * 0.5) : base;
  const g = gradeOf(score);
  return { ...m, raw, scoreBeforePenalty: base, score, grade: g.grade, gradeLabel: g.label };
}

async function allTechs() {
  const [rows] = await pool.query("SELECT id, name, jabatan, emoji FROM users WHERE active=1 AND (role='teknisi' OR JSON_CONTAINS(roles, '\"teknisi\"')) ORDER BY name");
  return rows;
}

// Daftar performa semua teknisi (tabel + ranking).
router.get('/', async (req, res) => {
  const { start, end } = monthRange(req.query.month);
  const techs = await allTechs();
  const rows = [];
  for (const t of techs) {
    const m = await metricsFor(t.id, start, end);
    rows.push({ techId: t.id, name: t.name, jabatan: t.jabatan, emoji: t.emoji, ...m });
  }
  rows.sort((a, b) => b.score - a.score);
  res.json({ performa: rows, slaMinutes: SLA_MINUTES, month: req.query.month || null, weights: W, serviceWeights: SERVICE_WEIGHTS });
});

// Dashboard performa lengkap untuk 1 teknisi + agregat tim.
router.get('/dashboard', async (req, res) => {
  const month = /^\d{4}-\d{2}$/.test(req.query.month) ? req.query.month : null;
  const { start, end } = monthRange(month);
  const techs = await allTechs();

  // Ranking semua teknisi.
  const ranking = [];
  for (const t of techs) ranking.push({ techId: t.id, name: t.name, jabatan: t.jabatan, emoji: t.emoji, ...(await metricsFor(t.id, start, end)) });
  ranking.sort((a, b) => b.score - a.score);

  // Teknisi terpilih: teknisi → diri sendiri; lainnya → query / peringkat teratas.
  let techId = req.query.techId ? Number(req.query.techId) : (req.user.role === 'teknisi' ? req.user.id : (ranking[0]?.techId || req.user.id));
  if (req.user.role === 'teknisi') techId = req.user.id;
  const self = ranking.find((r) => r.techId === techId) || ranking[0] || null;
  const rankPos = ranking.findIndex((r) => r.techId === techId) + 1;

  // Top 5 layanan paling banyak ditangani (insiden selesai), dengan bobot.
  const [svc] = await pool.query(
    `SELECT COALESCE(NULLIF(d.category,''), i.device_name) svc, COUNT(*) n
       FROM incidents i LEFT JOIN devices d ON d.id=i.device_id
      WHERE i.status='selesai' AND i.resolved_at>=? AND i.resolved_at<? ${techId ? 'AND i.tech_id=?' : ''}
      GROUP BY svc ORDER BY n DESC LIMIT 5`,
    techId ? [start, end, techId] : [start, end]
  );
  const topServices = svc.map((s) => ({ name: s.svc || 'Lainnya', count: s.n, weight: svcWeight(s.svc) }));

  // SLA bulanan (6 bulan terakhir) untuk teknisi terpilih.
  const slaMonthly = [];
  const base = month ? new Date(`${month}-01T00:00:00`) : new Date();
  for (let i = 5; i >= 0; i--) {
    const dt = new Date(base.getFullYear(), base.getMonth() - i, 1);
    const ms = `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}`;
    const r = monthRange(ms);
    const [[row]] = await pool.query('SELECT COUNT(*) tot, SUM(TIMESTAMPDIFF(MINUTE,created_at,taken_at)<=?) ot FROM incidents WHERE tech_id=? AND taken_at IS NOT NULL AND taken_at>=? AND taken_at<?', [SLA_MINUTES, techId, r.start, r.end]);
    slaMonthly.push({ month: ms, label: dt.toLocaleDateString('id-ID', { month: 'short' }), pct: row.tot ? Math.round((Number(row.ot) / row.tot) * 100) : null, total: row.tot });
  }

  // Trend performa 30 hari (poin bersih per hari) untuk teknisi terpilih.
  const today = new Date();
  const s30 = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 29);
  const e30 = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1);
  const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const idx = {};
  const trend30 = [];
  for (let i = 0; i < 30; i++) { const d = new Date(s30.getFullYear(), s30.getMonth(), s30.getDate() + i); idx[ymd(d)] = i; trend30.push({ date: ymd(d), points: 0 }); }
  const add = (rows, field, mult) => { for (const r of rows) { const k = idx[String(r.k).slice(0, 10)]; if (k != null) trend30[k].points += (Number(r.v) || 0) * mult; } };
  const ws = ymd(s30), we = ymd(e30);
  add((await pool.query("SELECT DATE(resolved_at) k, COUNT(*) v FROM incidents WHERE tech_id=? AND status='selesai' AND resolved_at>=? AND resolved_at<? GROUP BY DATE(resolved_at)", [techId, ws, we]))[0], 'done', W.done);
  add((await pool.query("SELECT DATE(resolved_at) k, SUM(priority='kritis') v FROM incidents WHERE tech_id=? AND status='selesai' AND resolved_at>=? AND resolved_at<? GROUP BY DATE(resolved_at)", [techId, ws, we]))[0], 'kritis', W.kritis);
  add((await pool.query('SELECT DATE(taken_at) k, SUM(TIMESTAMPDIFF(MINUTE,created_at,taken_at)<=?) v FROM incidents WHERE tech_id=? AND taken_at IS NOT NULL AND taken_at>=? AND taken_at<? GROUP BY DATE(taken_at)', [SLA_MINUTES, techId, ws, we]))[0], 'onTime', W.onTime);
  add((await pool.query("SELECT DATE(done_at) k, COUNT(*) v FROM equipment_maintenance WHERE done_by=? AND status='selesai' AND done_at>=? AND done_at<? GROUP BY DATE(done_at)", [techId, ws, we]))[0], 'pm', W.pm);
  add((await pool.query('SELECT DATE(created_at) k, COUNT(*) v FROM incident_reports WHERE reported_by=? AND created_at>=? AND created_at<? GROUP BY DATE(created_at)', [techId, ws, we]))[0], 'dok', W.dok);
  add((await pool.query(`SELECT DATE(i.created_at) k, COUNT(*) v FROM incident_duty d JOIN incidents i ON i.id=d.incident_id WHERE d.user_id=? AND i.created_at>=? AND i.created_at<? AND ((i.taken_at IS NOT NULL AND TIMESTAMPDIFF(MINUTE,i.created_at,i.taken_at)>?) OR (i.taken_at IS NULL AND TIMESTAMPDIFF(MINUTE,i.created_at,NOW())>?)) GROUP BY DATE(i.created_at)`, [techId, ws, we, SLA_MINUTES, SLA_MINUTES]))[0], 'breach', W.breach);

  // AI insight & rekomendasi.
  const insight = [];
  if (self) {
    if (self.score >= 80) insight.push({ type: 'good', text: `Performa ${self.gradeLabel.toLowerCase()} (grade ${self.grade}). Pertahankan konsistensi penyelesaian & kepatuhan SLA.` });
    else if (self.score >= 60) insight.push({ type: 'warn', text: `Performa cukup (grade ${self.grade}). Tingkatkan ketepatan SLA dan kurangi eskalasi untuk naik kelas.` });
    else insight.push({ type: 'bad', text: `Performa perlu pembinaan (grade ${self.grade}). Fokus tangani tiket lebih cepat & dokumentasikan perbaikan.` });
    if (self.breaches > 0) insight.push({ type: 'bad', text: `${self.breaches} pelanggaran SLA (−${self.breaches * 10} poin). Ambil tiket ≤ ${SLA_MINUTES} menit saat on-duty.` });
    if (self.eskalasi > 0) insight.push({ type: 'warn', text: `${self.eskalasi} tiket tereskalasi ke koordinator (−${self.eskalasi * 5}). Respons lebih sigap agar tak naik.` });
    if (self.pm === 0) insight.push({ type: 'warn', text: 'Belum ada Preventive Maintenance bulan ini. Setiap PM menambah +3 poin.' });
    else insight.push({ type: 'good', text: `${self.pm} Preventive Maintenance terlaksana (+${self.pm * 3}).` });
    if (self.dokumentasi === 0) insight.push({ type: 'warn', text: 'Belum ada laporan/dokumentasi perbaikan. Tiap dokumentasi +5 poin.' });
    if (self.onTime > 0) insight.push({ type: 'good', text: `${self.onTime} tiket tepat SLA (+${self.onTime * 4}). Kerja bagus!` });
  }

  res.json({
    month, slaMinutes: SLA_MINUTES, techId, rankPos, totalTechs: ranking.length,
    self, ranking, top5: ranking.slice(0, 5), topServices, slaMonthly, trend30, insight,
    weights: W, serviceWeights: SERVICE_WEIGHTS,
  });
});

// Deret harian per metrik (untuk sparkline di kartu MyDashboard).
router.get('/sparkline', async (req, res) => {
  const techId = req.query.techId ? Number(req.query.techId) : req.user.id;
  const month = /^\d{4}-\d{2}$/.test(req.query.month) ? req.query.month : `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}`;
  const [y, m] = month.split('-').map(Number);
  const days = new Date(y, m, 0).getDate();
  const start = `${y}-${String(m).padStart(2, '0')}-01`;
  const end = `${m === 12 ? y + 1 : y}-${String(m === 12 ? 1 : m + 1).padStart(2, '0')}-01`;
  const zeros = () => Array.from({ length: days }, () => 0);
  const out = { done: zeros(), taken: zeros(), onTime: zeros(), inspections: zeros(), breaches: zeros(), avgResp: zeros(), avgDur: zeros() };
  const [d1] = await pool.query("SELECT DAY(resolved_at) d, COUNT(*) c, AVG(duration_min) ad FROM incidents WHERE tech_id=? AND status='selesai' AND resolved_at>=? AND resolved_at<? GROUP BY DAY(resolved_at)", [techId, start, end]);
  for (const r of d1) { out.done[r.d - 1] = r.c; out.avgDur[r.d - 1] = Math.round(r.ad || 0); }
  const [d2] = await pool.query("SELECT DAY(taken_at) d, COUNT(*) c, SUM(TIMESTAMPDIFF(MINUTE,created_at,taken_at)<=?) ot, AVG(TIMESTAMPDIFF(MINUTE,created_at,taken_at)) ar FROM incidents WHERE tech_id=? AND taken_at IS NOT NULL AND taken_at>=? AND taken_at<? GROUP BY DAY(taken_at)", [SLA_MINUTES, techId, start, end]);
  for (const r of d2) { out.taken[r.d - 1] = r.c; out.onTime[r.d - 1] = Number(r.ot) || 0; out.avgResp[r.d - 1] = Math.round(r.ar || 0); }
  const [d3] = await pool.query('SELECT DAY(inspect_date) d, COUNT(*) c FROM equipment_inspections WHERE inspected_by=? AND inspect_date>=? AND inspect_date<? GROUP BY DAY(inspect_date)', [techId, start, end]);
  for (const r of d3) out.inspections[r.d - 1] = r.c;
  const [d4] = await pool.query(
    `SELECT DAY(i.created_at) d, COUNT(*) c FROM incident_duty du JOIN incidents i ON i.id=du.incident_id
      WHERE du.user_id=? AND i.created_at>=? AND i.created_at<?
        AND ((i.taken_at IS NOT NULL AND TIMESTAMPDIFF(MINUTE,i.created_at,i.taken_at)>?) OR (i.taken_at IS NULL AND TIMESTAMPDIFF(MINUTE,i.created_at,NOW())>?))
      GROUP BY DAY(i.created_at)`,
    [techId, start, end, SLA_MINUTES, SLA_MINUTES]
  );
  for (const r of d4) out.breaches[r.d - 1] = r.c;
  res.json({ month, days, spark: out });
});

// Rincian transparan skor 1 teknisi + log kejadian.
router.get('/breakdown', async (req, res) => {
  const techId = req.query.techId ? Number(req.query.techId) : req.user.id;
  if (req.user.role === 'teknisi' && techId !== req.user.id) return res.status(403).json({ error: 'Hanya bisa melihat rincian milik sendiri.' });
  const { start, end } = monthRange(req.query.month);

  const [tech] = await pool.query('SELECT id, name, jabatan FROM users WHERE id=?', [techId]);
  if (!tech[0]) return res.status(404).json({ error: 'Teknisi tidak ditemukan' });
  const m = await metricsFor(techId, start, end);

  const [done] = await pool.query("SELECT id, device_name, resolved_at, duration_min, priority FROM incidents WHERE tech_id=? AND status='selesai' AND resolved_at>=? AND resolved_at<? ORDER BY resolved_at DESC", [techId, start, end]);
  const [taken] = await pool.query('SELECT id, device_name, created_at, taken_at, TIMESTAMPDIFF(MINUTE, created_at, taken_at) AS resp FROM incidents WHERE tech_id=? AND taken_at IS NOT NULL AND taken_at>=? AND taken_at<? ORDER BY taken_at DESC', [techId, start, end]);
  const [breaches] = await pool.query(
    `SELECT i.id, i.device_name, i.created_at, i.taken_at, CASE WHEN i.taken_at IS NOT NULL THEN TIMESTAMPDIFF(MINUTE, i.created_at, i.taken_at) ELSE TIMESTAMPDIFF(MINUTE, i.created_at, NOW()) END AS mins
       FROM incident_duty d JOIN incidents i ON i.id = d.incident_id
      WHERE d.user_id=? AND i.created_at>=? AND i.created_at<?
        AND ((i.taken_at IS NOT NULL AND TIMESTAMPDIFF(MINUTE, i.created_at, i.taken_at) > ?) OR (i.taken_at IS NULL AND TIMESTAMPDIFF(MINUTE, i.created_at, NOW()) > ?)) ORDER BY i.created_at DESC`,
    [techId, start, end, SLA_MINUTES, SLA_MINUTES]
  );

  const components = [
    { label: 'Skor dasar', detail: 'titik awal setiap teknisi', value: W.base },
    { label: `Tiket selesai × ${W.done}`, detail: `${m.done} tiket selesai`, value: m.done * W.done },
    { label: `Tepat SLA × ${W.onTime}`, detail: `${m.onTime} diambil ≤ ${SLA_MINUTES} menit`, value: m.onTime * W.onTime },
    { label: `Insiden kritis × ${W.kritis}`, detail: `${m.kritisDone} insiden kritis selesai`, value: m.kritisDone * W.kritis },
    { label: `Preventive Maintenance × ${W.pm}`, detail: `${m.pm} PM terlaksana`, value: m.pm * W.pm },
    { label: `Dokumentasi × ${W.dok}`, detail: `${m.dokumentasi} laporan/dokumentasi`, value: m.dokumentasi * W.dok },
    { label: `Pelanggaran SLA × ${W.breach}`, detail: `${m.breaches} insiden telat saat on-duty`, value: m.breaches * W.breach },
    { label: `Eskalasi × ${W.eskalasi}`, detail: `${m.eskalasi} tiket naik ke koordinator`, value: m.eskalasi * W.eskalasi },
    { label: `Reopen × ${W.reopen}`, detail: `${m.reopen} tiket dibuka ulang`, value: m.reopen * W.reopen },
    { label: `Absen dikonfirmasi × ${W.absen}`, detail: `${m.absen} alpa dikonfirmasi koordinator`, value: m.absen * W.absen },
  ];
  if (m.vpnFlag) components.push({ label: 'Penalti Lokasi/VPN (−50%)', detail: `${m.vpnDays} hari absensi terindikasi VPN/lokasi palsu`, value: m.score - m.scoreBeforePenalty });

  res.json({
    techId, name: tech[0].name, jabatan: tech[0].jabatan, month: req.query.month || null,
    slaMinutes: SLA_MINUTES, raw: m.raw, score: m.score, grade: m.grade, gradeLabel: m.gradeLabel, clamped: m.raw !== m.score,
    vpnFlag: m.vpnFlag, vpnDays: m.vpnDays, metrics: m, components,
    logs: { done, taken, breaches },
  });
});

export default router;
