import { Router } from 'express';
import { pool } from '../db/pool.js';
import { requireAuth } from '../middleware/auth.js';
import { SLA_MINUTES, COORD_SLA_MINUTES, COORD_BREACH_MINUTES } from '../config/shifts.js';

const router = Router();
router.use(requireAuth);

// Deret harian per metrik performa koordinator (untuk sparkline).
router.get('/coordinator-sparkline', async (req, res) => {
  const month = /^\d{4}-\d{2}$/.test(req.query.month) ? req.query.month
    : `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}`;
  const [y, m] = month.split('-').map(Number);
  const days = new Date(y, m, 0).getDate();
  const start = `${y}-${String(m).padStart(2, '0')}-01`;
  const end = `${m === 12 ? y + 1 : y}-${String(m === 12 ? 1 : m + 1).padStart(2, '0')}-01`;
  const zeros = () => Array.from({ length: days }, () => 0);
  const out = { totalIn: zeros(), taken: zeros(), takenOnTime: zeros(), breaches: zeros(), reminders: zeros(), avgClaim: zeros() };

  const [d1] = await pool.query('SELECT DAY(created_at) d, COUNT(*) c FROM incidents WHERE created_at>=? AND created_at<? GROUP BY DAY(created_at)', [start, end]);
  for (const r of d1) out.totalIn[r.d - 1] = r.c;
  const [d2] = await pool.query('SELECT DAY(taken_at) d, COUNT(*) c, SUM(TIMESTAMPDIFF(MINUTE,created_at,taken_at)<=?) ot, SUM(TIMESTAMPDIFF(MINUTE,created_at,taken_at)>?) lt, AVG(TIMESTAMPDIFF(MINUTE,created_at,taken_at)) ac FROM incidents WHERE taken_at IS NOT NULL AND taken_at>=? AND taken_at<? GROUP BY DAY(taken_at)', [COORD_BREACH_MINUTES, COORD_BREACH_MINUTES, start, end]);
  for (const r of d2) { out.taken[r.d - 1] = r.c; out.takenOnTime[r.d - 1] = Number(r.ot) || 0; out.breaches[r.d - 1] = Number(r.lt) || 0; out.avgClaim[r.d - 1] = Math.round(r.ac || 0); }
  const [d3] = await pool.query('SELECT DAY(created_at) d, COUNT(*) c FROM incident_notes WHERE created_at>=? AND created_at<? AND note LIKE ? GROUP BY DAY(created_at)', [start, end, `%Pengingat manual dikirim oleh ${req.user.name}%`]);
  for (const r of d3) out.reminders[r.d - 1] = r.c;

  res.json({ month, days, spark: out });
});

// Dashboard koordinator: pantau SEMUA insiden + penilaian performa koordinator
// berbasis kecepatan insiden diambil teknisi (ambang COORD_SLA_MINUTES).
router.get('/coordinator', async (req, res) => {
  let month = req.query.month;
  if (!month || !/^\d{4}-\d{2}$/.test(month)) {
    const now = new Date();
    month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  }
  const [y, m] = month.split('-').map(Number);
  const start = `${y}-${String(m).padStart(2, '0')}-01`;
  const nextY = m === 12 ? y + 1 : y;
  const nextM = m === 12 ? 1 : m + 1;
  const end = `${nextY}-${String(nextM).padStart(2, '0')}-01`;

  // Semua insiden aktif (belum selesai), prioritas tinggi dulu lalu terlama.
  const [active] = await pool.query(
    `SELECT i.*, u.name AS tech_name FROM incidents i
       LEFT JOIN users u ON u.id = i.tech_id
      WHERE i.status != 'selesai'
      ORDER BY FIELD(i.priority,'kritis','tinggi','sedang'), i.created_at ASC`
  );

  const overMin = (inc) => Math.floor((Date.now() - new Date(inc.created_at).getTime()) / 60000);
  const unclaimed = active.filter((i) => !i.tech_id);
  const breaching = unclaimed.filter((i) => overMin(i) >= COORD_SLA_MINUTES);
  const inProgress = active.filter((i) => i.tech_id);

  const [doneTodayRows] = await pool.query(
    "SELECT COUNT(*) c FROM incidents WHERE status='selesai' AND DATE(resolved_at) = CURDATE()"
  );

  // Performa koordinator bulan ini: berapa insiden masuk, berapa diambil <=10m,
  // berapa telat/tak diambil dalam 10m (pelanggaran), rata-rata waktu ambil.
  const [monthRows] = await pool.query(
    'SELECT created_at, taken_at FROM incidents WHERE created_at >= ? AND created_at < ?',
    [start, end]
  );
  // "Telat diambil" pada penilaian koordinator memakai ambang 30 menit.
  let totalIn = monthRows.length, takenOnTime = 0, breaches = 0, claimSum = 0, claimN = 0;
  for (const r of monthRows) {
    if (r.taken_at) {
      const mins = Math.floor((new Date(r.taken_at) - new Date(r.created_at)) / 60000);
      claimSum += mins; claimN++;
      if (mins <= COORD_BREACH_MINUTES) takenOnTime++; else breaches++;
    } else {
      const mins = Math.floor((Date.now() - new Date(r.created_at).getTime()) / 60000);
      if (mins > COORD_BREACH_MINUTES) breaches++;
    }
  }
  const avgClaim = claimN ? Math.round(claimSum / claimN) : 0;
  const taken = claimN; // insiden yang berhasil diambil teknisi bulan ini

  // "Mengingatkan": jumlah pengingat manual yang dikirim koordinator ini.
  const [remRows] = await pool.query(
    'SELECT COUNT(*) c FROM incident_notes WHERE created_at >= ? AND created_at < ? AND note LIKE ?',
    [start, end, `%Pengingat manual dikirim oleh ${req.user.name}%`]
  );
  const reminders = remRows[0].c;

  // Skor: mulai 100, −10 per insiden telat diambil, +2 per insiden diambil
  // tepat waktu, +2 per pengingat manual (proaktif), maksimum 100.
  const score = Math.max(0, Math.min(100, 100 - breaches * 10 + takenOnTime * 2 + Math.min(reminders, 10) * 2));

  res.json({
    month,
    coordSlaMinutes: COORD_SLA_MINUTES,
    coordBreachMinutes: COORD_BREACH_MINUTES,
    slaMinutes: SLA_MINUTES,
    active,
    stats: {
      totalActive: active.length,
      unclaimed: unclaimed.length,
      breaching: breaching.length,
      inProgress: inProgress.length,
      doneToday: doneTodayRows[0].c,
    },
    performa: { totalIn, taken, takenOnTime, reminders, breaches, avgClaim, score },
  });
});

// Statistik bulanan (agregasi tiket harian) untuk grafik dashboard.
// ?month=YYYY-MM (default: bulan berjalan).
router.get('/monthly', async (req, res) => {
  let month = req.query.month;
  if (!month || !/^\d{4}-\d{2}$/.test(month)) {
    const now = new Date();
    month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  }
  const [y, m] = month.split('-').map(Number);
  const daysInMonth = new Date(y, m, 0).getDate();
  const start = `${y}-${String(m).padStart(2, '0')}-01`;
  const nextY = m === 12 ? y + 1 : y;
  const nextM = m === 12 ? 1 : m + 1;
  const end = `${nextY}-${String(nextM).padStart(2, '0')}-01`;

  const zeros = () => Array.from({ length: daysInMonth }, () => 0);
  const ticketsIn = zeros();
  const ticketsDone = zeros();
  const slaTrend = zeros();       // % tepat SLA per hari
  const mttrTrend = zeros();      // rata-rata durasi (menit) per hari

  const [inRows] = await pool.query(
    'SELECT DAY(created_at) d, COUNT(*) c FROM incidents WHERE created_at >= ? AND created_at < ? GROUP BY DAY(created_at)',
    [start, end]
  );
  for (const r of inRows) ticketsIn[r.d - 1] = r.c;

  const [doneRows] = await pool.query(
    "SELECT DAY(resolved_at) d, COUNT(*) c, AVG(duration_min) avg FROM incidents WHERE status='selesai' AND resolved_at >= ? AND resolved_at < ? GROUP BY DAY(resolved_at)",
    [start, end]
  );
  for (const r of doneRows) {
    ticketsDone[r.d - 1] = r.c;
    mttrTrend[r.d - 1] = Math.round(r.avg || 0);
  }

  const [slaRows] = await pool.query(
    `SELECT DAY(taken_at) d,
            SUM(TIMESTAMPDIFF(MINUTE, created_at, taken_at) <= ?) onTime,
            COUNT(*) tot
       FROM incidents WHERE taken_at IS NOT NULL AND taken_at >= ? AND taken_at < ?
      GROUP BY DAY(taken_at)`,
    [SLA_MINUTES, start, end]
  );
  for (const r of slaRows) slaTrend[r.d - 1] = r.tot ? Math.round((r.onTime / r.tot) * 100) : 0;

  const totalIn = ticketsIn.reduce((a, b) => a + b, 0);
  const totalDone = ticketsDone.reduce((a, b) => a + b, 0);
  const mttrVals = mttrTrend.filter((v) => v > 0);
  const avgMttr = mttrVals.length ? Math.round(mttrVals.reduce((a, b) => a + b, 0) / mttrVals.length) : 0;
  const slaVals = slaTrend.filter((_, i) => ticketsIn[i] > 0 || slaTrend[i] > 0);
  const avgSla = slaVals.length ? Math.round(slaVals.reduce((a, b) => a + b, 0) / slaVals.length) : 100;

  res.json({
    month, daysInMonth,
    ticketsIn, ticketsDone, slaTrend, mttrTrend,
    totals: { totalIn, totalDone, avgSla, avgMttr },
    slaMinutes: SLA_MINUTES,
  });
});

export default router;
