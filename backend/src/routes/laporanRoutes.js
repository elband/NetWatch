import { Router } from 'express';
import { pool } from '../db/pool.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { SLA_MINUTES, COORD_BREACH_MINUTES } from '../config/shifts.js';
import { metricsFor } from './performaRoutes.js';

const router = Router();
router.use(requireAuth);

const BULAN = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];
const HARI = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];
const SHIFT_CODE = { pagi: 'P', siang: 'S', malam: 'N', libur: 'L', dinas_luar: 'DL', cuti: 'C' };
// Jam operasional harian peralatan (05:00–20:00 = 15 jam) untuk evaluasi kinerja.
const OPS_HOURS_PER_DAY = 15;

// Laporan Bulanan format resmi (Kemenhub) — semua seksi dihimpun dari data unit.
// Dipakai oleh route ber-auth /bulanan & oleh halaman TTD publik (Kepala Seksi).
export async function buildLaporanData(monthIn) {
  const month = /^\d{4}-\d{2}$/.test(monthIn)
    ? monthIn
    : `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}`;
  const [y, m] = month.split('-').map(Number);
  const daysInMonth = new Date(y, m, 0).getDate();
  const start = `${y}-${String(m).padStart(2, '0')}-01`;
  const end = `${m === 12 ? y + 1 : y}-${String(m === 12 ? 1 : m + 1).padStart(2, '0')}-01`;
  const monthName = `${BULAN[m - 1]} ${y}`;
  // Bulan berikutnya untuk Jadwal Dinas.
  const nm = m === 12 ? 1 : m + 1;
  const ny = m === 12 ? y + 1 : y;
  const nextMonthKey = `${ny}-${String(nm).padStart(2, '0')}`;
  const nextMonthName = `${BULAN[nm - 1]} ${ny}`;
  const nextDays = new Date(ny, nm, 0).getDate();

  const pad2 = (n) => String(n).padStart(2, '0');
  const dmy = (d) => { if (!d) return '-'; const t = new Date(d); return `${pad2(t.getDate())}-${pad2(t.getMonth() + 1)}-${t.getFullYear()}`; };
  const jam = (d) => { if (!d) return '-'; const t = new Date(d); return `${pad2(t.getHours())}:${pad2(t.getMinutes())}`; };

  // ===== I. Data Personil Teknisi =====
  const [personil] = await pool.query(
    "SELECT name, nip, jabatan, pangkat, ttl FROM users WHERE active=1 AND (role='teknisi' OR role='koordinator' OR JSON_CONTAINS(roles,'\"teknisi\"') OR JSON_CONTAINS(roles,'\"koordinator\"')) ORDER BY (role='koordinator' OR JSON_CONTAINS(roles,'\"koordinator\"')) DESC, name"
  );

  // ===== II. Daftar / Inventaris Peralatan =====
  const [inventaris] = await pool.query('SELECT name, type, merk, serial, tahun, loc, status, category FROM devices ORDER BY category, name');
  const kondisi = (s) => (s === 'online' ? 'Baik' : s === 'warning' ? 'Perlu Perhatian' : 'Tidak Aktif/Rusak');

  // ===== III. Jadwal Dinas — bulan ini & bulan berikutnya =====
  const buildJadwal = async (rangeStart, rangeEnd, days, label) => {
    const [rows] = await pool.query(
      'SELECT s.user_id, u.name, DAY(s.shift_date) d, s.shift_type FROM shifts s JOIN users u ON u.id=s.user_id WHERE s.shift_date>=? AND s.shift_date<? ORDER BY u.name',
      [rangeStart, rangeEnd]
    );
    const map = new Map();
    for (const r of rows) {
      if (!map.has(r.user_id)) map.set(r.user_id, { nama: r.name, cells: Array(days).fill('') });
      map.get(r.user_id).cells[r.d - 1] = SHIFT_CODE[r.shift_type] || '';
    }
    return { month: label, days, rows: [...map.values()] };
  };
  const jadwalBulanIni = await buildJadwal(start, end, daysInMonth, monthName);
  const nextEnd = `${nm === 12 ? ny + 1 : ny}-${pad2(nm === 12 ? 1 : nm + 1)}-01`;
  const jadwal = await buildJadwal(`${nextMonthKey}-01`, nextEnd, nextDays, nextMonthName);

  // ===== IV. Laporan Kegiatan dalam 1 Bulan (log harian) =====
  const [insp] = await pool.query(
    'SELECT e.inspect_date, e.slot, e.status, e.inspector_name, d.name dev FROM equipment_inspections e LEFT JOIN devices d ON d.id=e.device_id WHERE e.inspect_date>=? AND e.inspect_date<? ORDER BY e.inspect_date, e.slot',
    [start, end]
  );
  const [incDay] = await pool.query(
    "SELECT i.created_at, i.resolved_at, i.device_name, i.issue, i.status, u.name tech, r.hasil FROM incidents i LEFT JOIN users u ON u.id=i.tech_id LEFT JOIN incident_reports r ON r.incident_id=i.id WHERE (i.created_at>=? AND i.created_at<?) OR (i.resolved_at>=? AND i.resolved_at<?) ORDER BY i.created_at",
    [start, end, start, end]
  );
  const [actDay] = await pool.query(
    'SELECT a.activity_date, a.type, a.title, a.start_time, u.name FROM activities a JOIN users u ON u.id=a.user_id WHERE a.activity_date>=? AND a.activity_date<? ORDER BY a.activity_date',
    [start, end]
  );
  const [maintDay] = await pool.query(
    `SELECT m.scheduled_date, m.done_at, m.task, m.status, d.name dev, ub.name done_by, cb.name created_by
       FROM equipment_maintenance m LEFT JOIN devices d ON d.id=m.device_id
       LEFT JOIN users ub ON ub.id=m.done_by LEFT JOIN users cb ON cb.id=m.created_by
      WHERE m.plan_month=? OR (m.done_at>=? AND m.done_at<?) ORDER BY m.scheduled_date`,
    [month, start, end]
  );
  const hariMap = new Map(); // key: YYYY-MM-DD
  const ensureDay = (dateStr) => {
    const key = String(dateStr).slice(0, 10);
    if (!hariMap.has(key)) {
      const dt = new Date(key);
      hariMap.set(key, { tanggal: key, hari: HARI[dt.getDay()], petugas: new Set(), items: [] });
    }
    return hariMap.get(key);
  };
  for (const r of insp) {
    const d = ensureDay(r.inspect_date);
    if (r.inspector_name) d.petugas.add(r.inspector_name);
    d.items.push({ jam: `${r.slot}:00`, peralatan: r.dev || 'Peralatan Elband', kegiatan: 'Inspeksi peralatan di Unit Elektronika Bandara', hasil: r.status === 'baik' ? 'Baik' : r.status === 'perhatian' ? 'Perlu Perhatian' : 'Rusak' });
  }
  for (const r of incDay) {
    const ev = r.resolved_at && r.resolved_at >= start && r.resolved_at < end ? r.resolved_at : r.created_at;
    const d = ensureDay(ev);
    if (r.tech) d.petugas.add(r.tech);
    d.items.push({ jam: jam(ev), peralatan: r.device_name, kegiatan: r.status === 'selesai' ? `Perbaikan: ${r.issue}` : `Penanganan gangguan: ${r.issue}`, hasil: r.status === 'selesai' ? (r.hasil || 'Selesai') : 'Proses' });
  }
  for (const r of actDay) {
    const d = ensureDay(r.activity_date);
    if (r.name) d.petugas.add(r.name);
    d.items.push({ jam: r.start_time ? String(r.start_time).slice(0, 5) : '-', peralatan: '-', kegiatan: `${r.type}: ${r.title}`, hasil: 'Baik' });
  }
  for (const r of maintDay) {
    const ev = r.done_at && r.done_at >= start && r.done_at < end ? r.done_at : r.scheduled_date;
    const d = ensureDay(ev);
    if (r.done_by || r.created_by) d.petugas.add(r.done_by || r.created_by);
    d.items.push({ jam: r.done_at ? jam(r.done_at) : '-', peralatan: r.dev || '-', kegiatan: `Maintenance/Pemeliharaan: ${r.task}`, hasil: r.status === 'selesai' ? 'Selesai' : r.status === 'batal' ? 'Batal' : 'Rencana' });
  }
  const kegiatanHarian = [...hariMap.values()].sort((a, b) => a.tanggal.localeCompare(b.tanggal)).map((d) => ({
    tanggal: d.tanggal, hari: d.hari, petugas: [...d.petugas].join(', ') || 'Elband',
    items: d.items.sort((a, b) => a.jam.localeCompare(b.jam)),
  }));

  // ===== Dokumentasi Kegiatan (foto yang diunggah ke sistem) =====
  const DOC_LIMIT = 60;
  const [docInsp] = await pool.query(
    'SELECT e.inspect_date d, e.slot, e.photo_url url, dv.name dev, e.inspector_name oleh FROM equipment_inspections e LEFT JOIN devices dv ON dv.id=e.device_id WHERE e.photo_url IS NOT NULL AND e.inspect_date>=? AND e.inspect_date<? ORDER BY e.inspect_date, e.slot',
    [start, end]
  );
  const [docNote] = await pool.query(
    'SELECT n.created_at d, n.doc_url url, n.note, i.device_name dev FROM incident_notes n JOIN incidents i ON i.id=n.incident_id WHERE n.doc_url IS NOT NULL AND n.created_at>=? AND n.created_at<? ORDER BY n.created_at',
    [start, end]
  );
  const dokumentasiAll = [
    ...docNote.map((r) => ({ url: r.url, tanggal: dmy(r.d), jenis: 'Tindakan/Perbaikan', peralatan: r.dev, ket: (r.note || '').slice(0, 80), oleh: '' })),
    ...docInsp.map((r) => ({ url: r.url, tanggal: dmy(r.d), jenis: `Inspeksi ${r.slot}:00`, peralatan: r.dev || 'Peralatan', ket: '', oleh: r.oleh || '' })),
  ];
  const dokumentasi = dokumentasiAll.slice(0, DOC_LIMIT);
  const dokumentasiTruncated = Math.max(0, dokumentasiAll.length - DOC_LIMIT);

  // ===== V. Laporan Unjuk Hasil / Performance (peralatan × hari) =====
  // 'x' = operasi terputus (ada insiden offline hari itu), kosong = normal.
  const [incPerDev] = await pool.query(
    "SELECT device_id, device_name, DAY(created_at) d FROM incidents WHERE created_at>=? AND created_at<? AND device_id IS NOT NULL",
    [start, end]
  );
  const downMap = new Map(); // device_id -> Set(day)
  for (const r of incPerDev) {
    if (!downMap.has(r.device_id)) downMap.set(r.device_id, new Set());
    downMap.get(r.device_id).add(r.d);
  }
  const [devList] = await pool.query('SELECT id, name, status FROM devices ORDER BY category, name');
  const unjukHasil = {
    days: daysInMonth,
    rows: devList.map((dev, i) => {
      const down = downMap.get(dev.id) || new Set();
      const cells = Array.from({ length: daysInMonth }, (_, k) => (down.has(k + 1) ? 'x' : dev.status === 'offline' ? 'x' : ''));
      return { no: i + 1, nama: dev.name, cells, ket: kondisi(dev.status) };
    }),
  };

  // ===== VI. Evaluasi Kinerja Fasilitas (uptime %) =====
  const terjadwalJam = daysInMonth * OPS_HOURS_PER_DAY;
  const [evalRows] = await pool.query(
    `SELECT d.id, d.name, COUNT(i.id) gagal, COALESCE(SUM(i.duration_min),0) downMin
       FROM devices d LEFT JOIN incidents i ON i.device_id=d.id AND i.status='selesai' AND i.resolved_at>=? AND i.resolved_at<?
      WHERE d.category IS NOT NULL GROUP BY d.id, d.name ORDER BY d.name`,
    [start, end]
  );
  const evaluasi = evalRows.map((r, i) => {
    const kegagalanJam = Math.round((Number(r.downMin) / 60) * 10) / 10;
    const operasiJam = Math.max(0, Math.round((terjadwalJam - kegagalanJam) * 10) / 10);
    const perf = terjadwalJam ? Math.round((operasiJam / terjadwalJam) * 1000) / 10 : 100;
    return { no: i + 1, fasilitas: r.name, terjadwalJam, operasiJam, kegagalanJam, jumlahKegagalan: r.gagal, performancePct: perf, ket: r.gagal ? 'Ada gangguan' : 'Normal' };
  });

  // ===== VII. Daftar Kegiatan Perbaikan & Kerusakan =====
  const [perbaikan] = await pool.query(
    `SELECT i.id, i.device_name, i.issue, i.created_at, i.resolved_at, i.duration_min, i.status, i.priority,
            l.name lokasi, r.kerusakan, r.perbaikan, r.penyebab, r.sparepart, r.hasil
       FROM incidents i LEFT JOIN locations l ON l.id=i.location_id LEFT JOIN incident_reports r ON r.incident_id=i.id
      WHERE (i.created_at>=? AND i.created_at<?) OR (i.resolved_at>=? AND i.resolved_at<?) ORDER BY i.created_at`,
    [start, end, start, end]
  );
  const perbaikanRows = perbaikan.map((r, i) => ({
    no: i + 1, tanggal: dmy(r.created_at), peralatan: r.device_name, lokasi: r.lokasi || '-',
    kategori: r.priority === 'kritis' ? 'RB' : 'RR', bagian: r.kerusakan || '-',
    kerusakan: r.kerusakan || r.issue, tindakan: r.perbaikan || '-',
    tglKerusakan: `${dmy(r.created_at)} ${jam(r.created_at)}`,
    tglSelesai: r.resolved_at ? `${dmy(r.resolved_at)} ${jam(r.resolved_at)}` : '-',
    jam: r.duration_min ? `${Math.round(r.duration_min / 60 * 10) / 10}` : '-',
    ket: r.status === 'selesai' ? (r.hasil || 'Selesai') : 'Ops. Terputus',
  }));

  // ===== VIII. LKP per kerusakan (insiden selesai dengan laporan) =====
  const [lkpItems] = await pool.query(
    `SELECT i.id, i.device_name, i.issue, i.created_at, i.resolved_at, i.priority,
            l.name lokasi, r.kerusakan, r.penyebab, r.perbaikan, r.sparepart, r.hasil, r.reporter_name, r.signer_name, r.signer_nip
       FROM incidents i LEFT JOIN locations l ON l.id=i.location_id JOIN incident_reports r ON r.incident_id=i.id
      WHERE i.resolved_at>=? AND i.resolved_at<? ORDER BY i.resolved_at`,
    [start, end]
  );
  const lkp = lkpItems.map((r) => ({
    incidentId: r.id, tanggal: dmy(r.created_at), lokasi: r.lokasi || '-', peralatan: r.device_name,
    bagian: r.kerusakan ? r.kerusakan.slice(0, 40) : '-', kategori: r.priority === 'kritis' ? 'RB' : 'RR',
    uraian: r.kerusakan || r.issue, tindakan: r.perbaikan || '-', penyebab: r.penyebab || '-', oleh: r.reporter_name || '-',
    tglKerusakan: `${dmy(r.created_at)}/${jam(r.created_at)}`, tglSelesai: r.resolved_at ? `${dmy(r.resolved_at)}/${jam(r.resolved_at)}` : '-',
    sparepart: r.sparepart || '-', hasil: r.hasil || '-',
  }));

  // ===== Rekap & performa (lampiran) =====
  const [[inRow]] = await pool.query('SELECT COUNT(*) c FROM incidents WHERE created_at>=? AND created_at<?', [start, end]);
  const [[doneRow]] = await pool.query("SELECT COUNT(*) c, AVG(duration_min) mttr FROM incidents WHERE status='selesai' AND resolved_at>=? AND resolved_at<?", [start, end]);
  const [[slaRow]] = await pool.query('SELECT SUM(TIMESTAMPDIFF(MINUTE,created_at,taken_at)<=?) ot, COUNT(*) tot FROM incidents WHERE taken_at IS NOT NULL AND taken_at>=? AND taken_at<?', [SLA_MINUTES, start, end]);
  const [[esc]] = await pool.query('SELECT COUNT(*) c FROM incidents WHERE coord_alerted=1 AND created_at>=? AND created_at<?', [start, end]);
  const recap = { tiketIn: inRow.c, tiketDone: doneRow.c, mttr: Math.round(doneRow.mttr || 0), slaPct: slaRow.tot ? Math.round((Number(slaRow.ot) / slaRow.tot) * 100) : 100, escalations: esc.c };

  const [techs] = await pool.query("SELECT id, name, jabatan FROM users WHERE active=1 AND (role='teknisi' OR JSON_CONTAINS(roles,'\"teknisi\"')) ORDER BY name");
  const performaTeknisi = [];
  for (const t of techs) {
    // Skor identik dengan dashboard performa (mesin penilaian tunggal: base 30 + bobot baru, penalti VPN −50%).
    const m = await metricsFor(t.id, start, end);
    const [[ins]] = await pool.query('SELECT COUNT(*) total, COALESCE(SUM(verified),0) v FROM equipment_inspections WHERE inspected_by=? AND inspect_date>=? AND inspect_date<?', [t.id, start, end]);
    performaTeknisi.push({
      name: t.name, jabatan: t.jabatan,
      done: m.done, onTime: m.onTime, taken: m.taken, kritisDone: m.kritisDone,
      inspeksi: Number(ins.total) || 0, inspeksiV: Number(ins.v) || 0,
      breaches: m.breaches, score: m.score, grade: m.grade,
    });
  }
  performaTeknisi.sort((a, b) => b.score - a.score);

  const [coords] = await pool.query("SELECT id, name, jabatan FROM users WHERE active=1 AND (role='koordinator' OR JSON_CONTAINS(roles,'\"koordinator\"')) ORDER BY name");
  const performaKoordinator = [];
  for (const c of coords) {
    const [[ap]] = await pool.query("SELECT COUNT(*) c FROM activities WHERE approved_by=? AND status!='menunggu' AND approved_at>=? AND approved_at<?", [c.id, start, end]);
    const [[rp]] = await pool.query('SELECT COUNT(*) c FROM incident_reports WHERE signed_by=? AND signed_at>=? AND signed_at<?', [c.id, start, end]);
    const [[sc]] = await pool.query('SELECT COUNT(*) c FROM nota_dinas WHERE created_by=? AND created_at>=? AND created_at<?', [c.id, start, end]);
    const [[ss]] = await pool.query('SELECT COUNT(*) c FROM nota_dinas WHERE signed_by=? AND signed_at>=? AND signed_at<?', [c.id, start, end]);
    const approvals = ap.c, reportsSigned = rp.c, suratCreated = sc.c, suratSigned = ss.c;
    const score = Math.max(0, Math.min(100, 50 + approvals * 2 + reportsSigned * 3 + suratCreated + suratSigned * 2 - recap.escalations * 3));
    performaKoordinator.push({ name: c.name, jabatan: c.jabatan, approvals, reportsSigned, suratCreated, suratSigned, escalations: recap.escalations, score });
  }
  performaKoordinator.sort((a, b) => b.score - a.score);

  return {
    month, monthName, year: y, nextMonthName,
    personil: personil.map((p, i) => ({ no: i + 1, ...p })),
    inventaris: inventaris.map((d, i) => ({ no: i + 1, nama: d.name, merk: d.merk || d.type || '-', serial: d.serial || '-', tahun: d.tahun || '-', lokasi: d.loc || '-', kondisi: kondisi(d.status), ket: d.category || '-' })),
    jadwalBulanIni, jadwal, kegiatanHarian, dokumentasi, dokumentasiTruncated, unjukHasil, evaluasi, perbaikan: perbaikanRows, lkp,
    recap, performaTeknisi, performaKoordinator, coordBreachMinutes: COORD_BREACH_MINUTES, opsHoursPerDay: OPS_HOURS_PER_DAY,
  };
}

router.get('/bulanan', requireRole('koordinator', 'admin'), async (req, res) => {
  res.json(await buildLaporanData(req.query.month));
});

export default router;
