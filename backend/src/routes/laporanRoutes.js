import { Router } from 'express';
import { pool } from '../db/pool.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { unitScope, unitFilter } from '../middleware/unitScope.js';
import { SLA_MINUTES, COORD_BREACH_MINUTES } from '../config/shifts.js';
import { metricsFor } from './performaRoutes.js';
import { scoreTeknisi, scoreKoordinator } from '../services/perfScore.js';
import { buildLogbook } from './logbookRoutes.js';
import { computeReport as obatAirReport } from '../controllers/waterChemController.js';
import { effectiveLkp } from '../services/unitConfig.js';

// Baca lkp global (settings) → objek; dipakai buildAabReport untuk kop & TTD.
async function readGlobalLkp() {
  const [r] = await pool.query("SELECT setting_value FROM settings WHERE setting_key='lkp'");
  try { const v = r[0]?.setting_value; return (typeof v === 'string' ? JSON.parse(v) : v) || {}; } catch { return {}; }
}

const router = Router();
router.use(requireAuth);
router.use(unitScope); // scoping multi-unit

const BULAN = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];
const HARI = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];
const SHIFT_CODE = { pagi: 'P', siang: 'S', Normal: 'N', libur: 'L', dinas_luar: 'DL', cuti: 'C' };
// Jam operasional harian peralatan (05:00–20:00 = 15 jam) untuk evaluasi kinerja.
const OPS_HOURS_PER_DAY = 15;

// Laporan Bulanan format resmi (Kemenhub) — semua seksi dihimpun dari data unit.
// Dipakai oleh route ber-auth /bulanan & oleh halaman TTD publik (Kepala Seksi).
// unitId: batasi data ke satu unit (null = semua unit, mode Super Admin).
export async function buildLaporanData(monthIn, unitId = null) {
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

  // Filter unit — klausa kosong bila unitId null (semua unit).
  const uf = unitFilter(unitId); // kolom polos `unit_id`

  // ===== I. Data Personil Teknisi =====
  const [personil] = await pool.query(
    // Urutan: koordinator dulu, OJT paling bawah, sisanya per nama.
    `SELECT id, role, roles, name, nip, jabatan, pangkat, ttl FROM users WHERE active=1 AND (role='teknisi' OR role='koordinator' OR JSON_CONTAINS(roles,'"teknisi"') OR JSON_CONTAINS(roles,'"koordinator"'))${uf.clause} ORDER BY (role='koordinator' OR JSON_CONTAINS(roles,'"koordinator"')) DESC, (jabatan LIKE '%OJT%') ASC, name`,
    uf.params
  );
  // Skor performa persen (0–100 + grade) per personil — komponen sesuai peran.
  for (const p of personil) {
    const roles = p.roles ? (typeof p.roles === 'string' ? JSON.parse(p.roles) : p.roles) : (p.role ? [p.role] : []);
    p.isKoor = roles.includes('koordinator');
    const s = p.isKoor ? await scoreKoordinator(p.id, start, end, unitId) : await scoreTeknisi(p.id, start, end, unitId);
    p.skor = s.score; p.grade = s.grade;
    // key/num/den ikut dibawa agar lampiran bisa menampilkan BUKTI ANGKA (mis. 8/10 tiket)
    // dari komponen yang sama persis dengan seksi Rincian Penilaian — satu sumber angka.
    p.komponen = s.components.map((c) => ({ key: c.key, label: c.label, weight: c.weight, value: c.value, num: c.num ?? null, den: c.den ?? null, note: c.note || null }));
    p.tips = s.tips || [];
  }
  // Rincian penilaian performa (per personil) untuk section terpisah di laporan.
  const performaRinci = personil.map((p, i) => ({
    no: i + 1, name: p.name, jabatan: p.jabatan, role: p.isKoor ? 'koordinator' : 'teknisi',
    skor: p.skor ?? null, grade: p.grade || 'Belum dinilai', komponen: p.komponen || [], tips: p.tips || [],
  }));

  // ===== II. Daftar / Inventaris Peralatan =====
  const [inventaris] = await pool.query(`SELECT id, name, type, merk, serial, tahun, loc, status, category, ip FROM devices WHERE 1=1${uf.clause} ORDER BY category, name`, uf.params);
  const kondisi = (s) => (s === 'online' ? 'Baik' : s === 'warning' ? 'Perlu Perhatian' : 'Tidak Aktif/Rusak');
  // Perangkat tanpa IP tidak bisa dipantau via ping, sehingga status 'offline' dari
  // monitoring TIDAK bermakna (selalu offline). Untuk perangkat ini, kondisi rusak
  // hanya ditentukan oleh insiden/laporan yang tercatat untuk perangkat tsb — bukan
  // status ping. Perangkat ber-IP tetap memakai status pemantauan seperti biasa.
  const [openIncRows] = await pool.query(`SELECT DISTINCT device_id FROM incidents WHERE device_id IS NOT NULL AND status<>'selesai'${uf.clause}`, uf.params);
  const openIncSet = new Set(openIncRows.map((r) => r.device_id));
  const hasIp = (dev) => !!(dev.ip && String(dev.ip).trim() && String(dev.ip).trim().toUpperCase() !== 'N/A');
  const devKondisi = (dev) => (hasIp(dev) ? kondisi(dev.status) : (openIncSet.has(dev.id) ? 'Tidak Aktif/Rusak' : 'Baik'));

  // ===== III. Jadwal Dinas — bulan ini & bulan berikutnya =====
  const ufShift = unitFilter(unitId, 's.unit_id');
  const buildJadwal = async (rangeStart, rangeEnd, days, label) => {
    const [rows] = await pool.query(
      // Urutan baris jadwal mengikuti Data Personil: koordinator dulu, OJT paling bawah, lalu per nama.
      `SELECT s.user_id, u.name, DAY(s.shift_date) d, s.shift_type FROM shifts s JOIN users u ON u.id=s.user_id
        WHERE s.shift_date>=? AND s.shift_date<?${ufShift.clause}
        ORDER BY (u.role='koordinator' OR JSON_CONTAINS(u.roles,'"koordinator"')) DESC, (u.jabatan LIKE '%OJT%') ASC, u.name`,
      [rangeStart, rangeEnd, ...ufShift.params]
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
  const ufE = unitFilter(unitId, 'e.unit_id');
  const ufI = unitFilter(unitId, 'i.unit_id');
  const ufA = unitFilter(unitId, 'a.unit_id');
  const ufM = unitFilter(unitId, 'm.unit_id');
  const [insp] = await pool.query(
    `SELECT e.inspect_date, e.slot, e.status, e.inspector_name, d.name dev FROM equipment_inspections e LEFT JOIN devices d ON d.id=e.device_id WHERE e.inspect_date>=? AND e.inspect_date<?${ufE.clause} ORDER BY e.inspect_date, e.slot`,
    [start, end, ...ufE.params]
  );
  const [incDay] = await pool.query(
    // Kurung ekstra: kondisi OR asli dibungkus agar filter unit berlaku ke seluruh baris.
    `SELECT i.created_at, i.resolved_at, i.device_name, i.issue, i.status, u.name tech, r.hasil FROM incidents i LEFT JOIN users u ON u.id=i.tech_id LEFT JOIN incident_reports r ON r.incident_id=i.id WHERE ((i.created_at>=? AND i.created_at<?) OR (i.resolved_at>=? AND i.resolved_at<?))${ufI.clause} ORDER BY i.created_at`,
    [start, end, start, end, ...ufI.params]
  );
  const [actDay] = await pool.query(
    // Hanya kegiatan yang SUDAH DISETUJUI koordinator yang masuk laporan resmi —
    // yang masih 'menunggu' atau 'ditolak' tidak dicantumkan di log harian.
    `SELECT a.activity_date, a.type, a.title, a.start_time, u.name FROM activities a JOIN users u ON u.id=a.user_id WHERE a.status='disetujui' AND a.activity_date>=? AND a.activity_date<?${ufA.clause} ORDER BY a.activity_date`,
    [start, end, ...ufA.params]
  );
  const [maintDay] = await pool.query(
    `SELECT m.scheduled_date, m.done_at, m.task, m.status, d.name dev, ub.name done_by, cb.name created_by
       FROM equipment_maintenance m LEFT JOIN devices d ON d.id=m.device_id
       LEFT JOIN users ub ON ub.id=m.done_by LEFT JOIN users cb ON cb.id=m.created_by
      WHERE (m.plan_month=? OR (m.done_at>=? AND m.done_at<?))${ufM.clause} ORDER BY m.scheduled_date`,
    [month, start, end, ...ufM.params]
  );
  // Jendela Maintenance (downtime terencana) — pekerjaan pemeliharaan nyata teknisi yang
  // juga dinilai pada komponen PM, jadi harus ikut tercatat di log kegiatan bulanan.
  const ufMw = unitFilter(unitId, 'mw.unit_id');
  const [mwDay] = await pool.query(
    `SELECT mw.starts_at, mw.done_at, mw.title, mw.status, mw.done_note, d.name dev, ud.name done_by, uc.name created_by
       FROM maintenance_windows mw LEFT JOIN devices d ON d.id=mw.device_id
       LEFT JOIN users ud ON ud.id=mw.done_by LEFT JOIN users uc ON uc.id=mw.created_by
      WHERE ((mw.starts_at>=? AND mw.starts_at<?) OR (mw.done_at>=? AND mw.done_at<?))${ufMw.clause} ORDER BY mw.starts_at`,
    [start, end, start, end, ...ufMw.params]
  );
  // Override koordinator (buka akses inspeksi) — dicatat sebagai kegiatan harian di laporan.
  const [ovrDay] = await pool.query(
    `SELECT work_date, reason, created_by_name, created_at FROM equipment_inspect_overrides
      WHERE work_date>=? AND work_date<?${uf.clause} ORDER BY work_date`,
    [start, end, ...uf.params]
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
  for (const r of mwDay) {
    const ev = r.done_at && r.done_at >= start && r.done_at < end ? r.done_at : r.starts_at;
    const d = ensureDay(ev);
    if (r.done_by || r.created_by) d.petugas.add(r.done_by || r.created_by);
    d.items.push({
      jam: jam(ev), peralatan: r.dev || '-',
      kegiatan: `Pemeliharaan terjadwal (jendela maintenance): ${r.title}`,
      hasil: r.status === 'selesai' ? (r.done_note || 'Selesai') : 'Terjadwal',
    });
  }
  for (const r of ovrDay) {
    const d = ensureDay(r.work_date);
    if (r.created_by_name) d.petugas.add(r.created_by_name);
    d.items.push({ jam: r.created_at ? jam(r.created_at) : '-', peralatan: '-', kegiatan: `Koordinator membuka akses inspeksi hari ini (absen belum/salah tercatat) — alasan: ${r.reason}`, hasil: 'Izin' });
  }
  const kegiatanHarian = [...hariMap.values()].sort((a, b) => a.tanggal.localeCompare(b.tanggal)).map((d) => ({
    tanggal: d.tanggal, hari: d.hari, petugas: [...d.petugas].join(', ') || 'Elband',
    items: d.items.sort((a, b) => a.jam.localeCompare(b.jam)),
  }));

  // ===== Dokumentasi Kegiatan (foto yang diunggah ke sistem) =====
  const DOC_LIMIT = 60;
  const [docInsp] = await pool.query(
    `SELECT e.inspect_date d, e.slot, e.photo_url url, dv.name dev, e.inspector_name oleh FROM equipment_inspections e LEFT JOIN devices dv ON dv.id=e.device_id WHERE e.photo_url IS NOT NULL AND e.inspect_date>=? AND e.inspect_date<?${ufE.clause} ORDER BY e.inspect_date, e.slot`,
    [start, end, ...ufE.params]
  );
  const [docNote] = await pool.query(
    // incident_notes tidak ber-unit — scope via induk incidents (i.unit_id).
    `SELECT n.created_at d, n.doc_url url, n.note, i.device_name dev FROM incident_notes n JOIN incidents i ON i.id=n.incident_id WHERE n.doc_url IS NOT NULL AND n.created_at>=? AND n.created_at<?${ufI.clause} ORDER BY n.created_at`,
    [start, end, ...ufI.params]
  );
  // Foto dokumentasi Jendela Maintenance (bukti pekerjaan pemeliharaan yang dinilai di komponen PM).
  const [docMw] = await pool.query(
    `SELECT p.url, p.created_at d, mw.title, dv.name dev, u.name oleh
       FROM maintenance_window_photos p JOIN maintenance_windows mw ON mw.id=p.window_id
       LEFT JOIN devices dv ON dv.id=mw.device_id LEFT JOIN users u ON u.id=p.uploaded_by
      WHERE p.created_at>=? AND p.created_at<?${ufMw.clause} ORDER BY p.created_at`,
    [start, end, ...ufMw.params]
  );
  const dokumentasiAll = [
    ...docNote.map((r) => ({ url: r.url, tanggal: dmy(r.d), jenis: 'Tindakan/Perbaikan', peralatan: r.dev, ket: (r.note || '').slice(0, 80), oleh: '' })),
    ...docMw.map((r) => ({ url: r.url, tanggal: dmy(r.d), jenis: 'Pemeliharaan', peralatan: r.dev || '-', ket: (r.title || '').slice(0, 80), oleh: r.oleh || '' })),
    ...docInsp.map((r) => ({ url: r.url, tanggal: dmy(r.d), jenis: `Inspeksi ${r.slot}:00`, peralatan: r.dev || 'Peralatan', ket: '', oleh: r.oleh || '' })),
  ];
  const dokumentasi = dokumentasiAll.slice(0, DOC_LIMIT);
  const dokumentasiTruncated = Math.max(0, dokumentasiAll.length - DOC_LIMIT);

  // ===== V. Laporan Unjuk Hasil / Performance (peralatan × hari) =====
  // 'x' = operasi terputus (ada insiden offline hari itu), kosong = normal.
  const [incPerDev] = await pool.query(
    `SELECT device_id, device_name, DAY(created_at) d FROM incidents WHERE created_at>=? AND created_at<? AND device_id IS NOT NULL${uf.clause}`,
    [start, end, ...uf.params]
  );
  const downMap = new Map(); // device_id -> Set(day)
  for (const r of incPerDev) {
    if (!downMap.has(r.device_id)) downMap.set(r.device_id, new Set());
    downMap.get(r.device_id).add(r.d);
  }
  // Grid harian unjuk hasil DARI DATA PEMANTAUAN RIIL (device_uptime_daily) — sumber sama
  // dengan halaman Laporan Unjuk Hasil. Ketersediaan harian = (online+warning)/(sampel−maintenance).
  const ufUp = unitFilter(unitId, 'd.unit_id');
  const [upDayRows] = await pool.query(
    `SELECT u.device_id, DAY(u.day) d, u.samples, (u.up_samples + u.warn_samples) up_ish, u.maint_samples
       FROM device_uptime_daily u JOIN devices d ON d.id=u.device_id
      WHERE u.day>=? AND u.day<?${ufUp.clause}`,
    [start, end, ...ufUp.params]
  );
  const dayAvail = new Map(); // device_id -> Map(day -> availabilityFraksi|null)
  const monAgg = new Map();   // device_id -> { base, up } untuk ketersediaan bulanan
  for (const r of upDayRows) {
    const base = Number(r.samples) - Number(r.maint_samples);
    if (!dayAvail.has(r.device_id)) dayAvail.set(r.device_id, new Map());
    dayAvail.get(r.device_id).set(r.d, base > 0 ? Number(r.up_ish) / base : null);
    const mm = monAgg.get(r.device_id) || { base: 0, up: 0 };
    mm.base += Math.max(0, base); mm.up += Number(r.up_ish);
    monAgg.set(r.device_id, mm);
  }
  // Kondisi (Ket) perangkat ber-IP dari ketersediaan bulanan terukur; tanpa IP dari insiden/laporan.
  const monthlyKet = (dev) => {
    if (!hasIp(dev)) return devKondisi(dev);
    const mm = monAgg.get(dev.id);
    if (!mm || mm.base <= 0) return devKondisi(dev); // belum ada data pantau → status kini
    const pct = (mm.up / mm.base) * 100;
    return pct >= 95 ? 'Baik' : pct >= 50 ? 'Perlu Perhatian' : 'Tidak Aktif/Rusak';
  };
  const [devList] = await pool.query(`SELECT id, name, status, ip FROM devices WHERE 1=1${uf.clause} ORDER BY category, name`, uf.params);
  const unjukHasil = {
    days: daysInMonth,
    rows: devList.map((dev, i) => {
      const dmap = dayAvail.get(dev.id);
      const cells = Array.from({ length: daysInMonth }, (_, k) => {
        if (hasIp(dev)) {
          // Sel 'x' = ketersediaan hari itu < 50% (perangkat mati mayoritas hari); kosong = baik/tak terpantau.
          const av = dmap ? dmap.get(k + 1) : undefined;
          return (av != null && av < 0.5) ? 'x' : '';
        }
        // Tanpa IP (tidak terpantau ping): 'x' pada hari ada insiden tercatat.
        return (downMap.get(dev.id) || new Set()).has(k + 1) ? 'x' : '';
      });
      return { no: i + 1, nama: dev.name, cells, ket: monthlyKet(dev) };
    }),
  };

  // ===== VI. Evaluasi Kinerja Fasilitas (uptime %) =====
  const terjadwalJam = daysInMonth * OPS_HOURS_PER_DAY;
  const ufD = unitFilter(unitId, 'd.unit_id');
  const [evalRows] = await pool.query(
    `SELECT d.id, d.name, COUNT(i.id) gagal, COALESCE(SUM(i.duration_min),0) downMin
       FROM devices d LEFT JOIN incidents i ON i.device_id=d.id AND i.status='selesai' AND i.resolved_at>=? AND i.resolved_at<?
      WHERE d.category IS NOT NULL${ufD.clause} GROUP BY d.id, d.name ORDER BY d.name`,
    [start, end, ...ufD.params]
  );
  // Uptime TERUKUR dari monitoring (device_uptime_daily) — akurat berbasis sampel
  // ping, mengecualikan waktu maintenance terjadwal. Null bila belum ada data
  // metrik (mis. bulan sebelum fitur monitoring aktif) → laporan tampilkan "–".
  const [slaRows] = await pool.query(
    `SELECT device_id,
            SUM(samples) samples, SUM(up_samples + warn_samples) up_ish, SUM(maint_samples) maint,
            ROUND(AVG(avg_ping)) avg_ping, SUM(down_seconds) down_seconds
       FROM device_uptime_daily WHERE day >= ? AND day < ? GROUP BY device_id`,
    [start, end]
  );
  const slaMap = new Map();
  for (const r of slaRows) {
    const base = Number(r.samples) - Number(r.maint);
    slaMap.set(r.device_id, {
      uptimePct: base > 0 ? Math.round((Number(r.up_ish) / base) * 1000) / 10 : null,
      avgPing: r.avg_ping != null ? Number(r.avg_ping) : null,
      downHours: Math.round((Number(r.down_seconds) / 3600) * 10) / 10,
    });
  }
  const evaluasi = evalRows.map((r, i) => {
    const kegagalanJam = Math.round((Number(r.downMin) / 60) * 10) / 10;
    const operasiJam = Math.max(0, Math.round((terjadwalJam - kegagalanJam) * 10) / 10);
    const perf = terjadwalJam ? Math.round((operasiJam / terjadwalJam) * 1000) / 10 : 100;
    const m = slaMap.get(r.id) || {};
    return {
      no: i + 1, fasilitas: r.name, terjadwalJam, operasiJam, kegagalanJam, jumlahKegagalan: r.gagal,
      performancePct: perf, ket: r.gagal ? 'Ada gangguan' : 'Normal',
      measuredUptimePct: m.uptimePct ?? null, avgPingMs: m.avgPing ?? null,
    };
  });
  // Rata-rata uptime terukur lintas fasilitas kritis (untuk ringkasan lampiran).
  const measuredVals = evaluasi.map((e) => e.measuredUptimePct).filter((v) => v != null);
  const measuredUptimePct = measuredVals.length
    ? Math.round((measuredVals.reduce((a, b) => a + b, 0) / measuredVals.length) * 10) / 10
    : null;

  // ===== VII. Daftar Kegiatan Perbaikan & Kerusakan =====
  const [perbaikan] = await pool.query(
    `SELECT i.id, i.device_name, i.issue, i.created_at, i.resolved_at, i.duration_min, i.status, i.priority,
            l.name lokasi, r.kerusakan, r.perbaikan, r.penyebab, r.sparepart, r.hasil
       FROM incidents i LEFT JOIN locations l ON l.id=i.location_id LEFT JOIN incident_reports r ON r.incident_id=i.id
      WHERE ((i.created_at>=? AND i.created_at<?) OR (i.resolved_at>=? AND i.resolved_at<?))${ufI.clause} ORDER BY i.created_at`,
    [start, end, start, end, ...ufI.params]
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
      WHERE i.resolved_at>=? AND i.resolved_at<?${ufI.clause} ORDER BY i.resolved_at`,
    [start, end, ...ufI.params]
  );
  const lkp = lkpItems.map((r) => ({
    incidentId: r.id, tanggal: dmy(r.created_at), lokasi: r.lokasi || '-', peralatan: r.device_name,
    bagian: r.kerusakan ? r.kerusakan.slice(0, 40) : '-', kategori: r.priority === 'kritis' ? 'RB' : 'RR',
    uraian: r.kerusakan || r.issue, tindakan: r.perbaikan || '-', penyebab: r.penyebab || '-', oleh: r.reporter_name || '-',
    tglKerusakan: `${dmy(r.created_at)}/${jam(r.created_at)}`, tglSelesai: r.resolved_at ? `${dmy(r.resolved_at)}/${jam(r.resolved_at)}` : '-',
    sparepart: r.sparepart || '-', hasil: r.hasil || '-',
  }));

  // ===== Rekap & performa (lampiran) =====
  const [[inRow]] = await pool.query(`SELECT COUNT(*) c FROM incidents WHERE created_at>=? AND created_at<?${uf.clause}`, [start, end, ...uf.params]);
  const [[doneRow]] = await pool.query(`SELECT COUNT(*) c, AVG(duration_min) mttr FROM incidents WHERE status='selesai' AND resolved_at>=? AND resolved_at<?${uf.clause}`, [start, end, ...uf.params]);
  const [[slaRow]] = await pool.query(`SELECT SUM(TIMESTAMPDIFF(MINUTE,created_at,taken_at)<=?) ot, COUNT(*) tot FROM incidents WHERE taken_at IS NOT NULL AND taken_at>=? AND taken_at<?${uf.clause}`, [SLA_MINUTES, start, end, ...uf.params]);
  const [[esc]] = await pool.query(`SELECT COUNT(*) c FROM incidents WHERE coord_alerted=1 AND created_at>=? AND created_at<?${uf.clause}`, [start, end, ...uf.params]);
  const recap = {
    tiketIn: inRow.c, tiketDone: doneRow.c, mttr: Math.round(doneRow.mttr || 0),
    // null bila tak ada insiden yang diambil pada periode → laporan tampilkan "–", bukan 100%.
    slaPct: slaRow.tot ? Math.round((Number(slaRow.ot) / slaRow.tot) * 100) : null,
    slaOnTime: Number(slaRow.ot) || 0, slaTaken: Number(slaRow.tot) || 0,
    escalations: esc.c, measuredUptimePct,
    // Angka penyilang untuk catatan kaki lampiran agar bisa dicocokkan dengan seksi lain.
    perbaikanRows: perbaikanRows.length,  // seksi IX (dibuat ATAU selesai pada periode)
    lkpRows: lkp.length,                  // seksi X (selesai pada periode & ber-LKP)
    uptimeFasilitas: measuredVals.length, // jumlah fasilitas berdata pantau di seksi VIII
    evaluasiFasilitas: evaluasi.length,
  };

  // Performa untuk LAMPIRAN memakai mesin skor yang SAMA dengan seksi I (Data Personil) &
  // XII (Rincian Penilaian), yaitu perfScore persen — bukan lagi mesin poin lama
  // (metricsFor) / rumus ad-hoc koordinator, yang membuat orang yang sama tampil dengan
  // skor berbeda antar halaman pada dokumen yang sama.
  const perfRow = (p) => ({
    name: p.name, jabatan: p.jabatan,
    skor: p.skor ?? null, grade: p.grade || 'Belum dinilai',
    komponen: p.komponen || [],
  });
  const bySkor = (a, b) => (b.skor ?? -1) - (a.skor ?? -1); // "Belum dinilai" di bawah
  const performaTeknisi = personil.filter((p) => !p.isKoor).map(perfRow).sort(bySkor);
  const performaKoordinator = personil.filter((p) => p.isKoor).map(perfRow).sort(bySkor);

  // Logbook peralatan: rekap bulanan per perangkat (uptime/latency + inspeksi/on-off/maint/insiden).
  const lb = await buildLogbook(month, undefined, unitId);
  const logbook = lb.devices.map((d, i) => ({
    no: i + 1, peralatan: d.name, ip: d.ip,
    uptimePct: d.recap.metrik ? d.recap.metrik.up_pct : null,
    avgPing: d.recap.metrik ? d.recap.metrik.avg_ping : null,
    maxPing: d.recap.metrik ? d.recap.metrik.max_ping : null,
    inspeksi: d.recap.inspeksi.total, baik: d.recap.inspeksi.baik, perhatian: d.recap.inspeksi.perhatian, rusak: d.recap.inspeksi.rusak,
    hidup: d.recap.power.on, mati: d.recap.power.off,
    maintenance: d.recap.maintenance.total, maintSelesai: d.recap.maintenance.selesai,
    insiden: d.recap.insiden.total, downtimeMin: d.recap.insiden.downtime_min,
  }));

  return {
    month, monthName, year: y, nextMonthName,
    personil: personil.map((p, i) => ({ no: i + 1, name: p.name, nip: p.nip, jabatan: p.jabatan, pangkat: p.pangkat, ttl: p.ttl, skor: p.skor ?? null, grade: p.grade || 'Belum dinilai' })),
    performaRinci,
    // Kondisi peralatan memakai penilaian PERIODE (monthlyKet) — sama dengan kolom "Ket"
    // pada Seksi VII Unjuk Hasil, agar satu perangkat tidak tampil "Baik" di Seksi II
    // sementara "Rusak" di Seksi VII hanya karena Seksi II dulu memakai status saat ini.
    inventaris: inventaris.map((d, i) => ({ no: i + 1, nama: d.name, merk: d.merk || d.type || '-', serial: d.serial || '-', tahun: d.tahun || '-', lokasi: d.loc || '-', kondisi: monthlyKet(d), ket: d.category || '-' })),
    jadwalBulanIni, jadwal, kegiatanHarian, dokumentasi, dokumentasiTruncated, unjukHasil, evaluasi, perbaikan: perbaikanRows, lkp, logbook,
    recap, performaTeknisi, performaKoordinator, coordBreachMinutes: COORD_BREACH_MINUTES, opsHoursPerDay: OPS_HOURS_PER_DAY,
  };
}

router.get('/bulanan', requireRole('koordinator', 'admin'), async (req, res) => {
  res.json(await buildLaporanData(req.query.month, req.unitId));
});

// ===== Laporan Bulanan AAB (Fase 5d) — seksi berbasis data unit AAB =====
export async function buildAabReport(monthIn, unitId) {
  const now = new Date();
  const month = /^\d{4}-\d{2}$/.test(monthIn) ? monthIn : `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const [y, m] = month.split('-').map(Number);
  const daysInMonth = new Date(y, m, 0).getDate();
  const p2 = (n) => String(n).padStart(2, '0');
  const start = `${y}-${p2(m)}-01`;
  const end = `${m === 12 ? y + 1 : y}-${p2(m === 12 ? 1 : m + 1)}-01`;
  const lastDay = `${y}-${p2(m)}-${p2(daysInMonth)}`;
  const monthName = `${BULAN[m - 1]} ${y}`;
  const uf = unitFilter(unitId);

  // I. Personil
  const [personil] = await pool.query(
    `SELECT name, nip, jabatan FROM users WHERE active=1 AND (role='teknisi' OR role='koordinator' OR JSON_CONTAINS(roles,'"teknisi"') OR JSON_CONTAINS(roles,'"koordinator"'))${uf.clause}
      ORDER BY (role='koordinator' OR JSON_CONTAINS(roles,'"koordinator"')) DESC, name`, uf.params
  );

  // II. Inventaris per fasilitas (kondisi B/RR/RB + kebutuhan)
  const [assets] = await pool.query(
    `SELECT name, merk, model, serial, tahun, loc, kondisi, kebutuhan, COALESCE(fasilitas,'Lainnya') AS fasilitas
       FROM devices WHERE asset_class='physical'${uf.clause} ORDER BY fasilitas IS NULL, fasilitas, name`, uf.params
  );
  const grup = {};
  for (const a of assets) (grup[a.fasilitas] ||= []).push(a);
  const inventaris = Object.entries(grup).map(([fasilitas, items]) => ({ fasilitas, items }));
  const kondisiRekap = { B: 0, RR: 0, RB: 0, '-': 0 };
  for (const a of assets) kondisiRekap[a.kondisi || '-']++;

  // III. Rekap checklist bulan berjalan
  const ufc = unitFilter(unitId, 'unit_id');
  const [[chkTot]] = await pool.query(
    `SELECT COUNT(*) AS total, COUNT(DISTINCT device_id) AS aset FROM checklist_runs WHERE run_date>=? AND run_date<?${ufc.clause}`,
    [start, end, ...ufc.params]
  );
  const [chkByOverall] = await pool.query(
    `SELECT overall, COUNT(*) n FROM checklist_runs WHERE frequency='harian' AND run_date>=? AND run_date<?${ufc.clause} GROUP BY overall`,
    [start, end, ...ufc.params]
  );

  // III-b. Status kelayakan (checklist BULANAN Serviceable/Unserviceable) — status TERAKHIR per aset pada periode.
  const ufsv = unitFilter(unitId, 'cr.unit_id');
  const [svcRows] = await pool.query(
    `SELECT cr.device_id, d.name, cr.serviceable, cr.note
       FROM checklist_runs cr JOIN devices d ON d.id=cr.device_id
      WHERE cr.frequency='bulanan' AND cr.period=?${ufsv.clause}
      ORDER BY cr.device_id, cr.id DESC`,
    [month, ...ufsv.params]
  );
  const svcLatest = new Map();
  for (const r of svcRows) if (!svcLatest.has(r.device_id)) svcLatest.set(r.device_id, r);
  const serviceability = [...svcLatest.values()].map((r) => ({ name: r.name, serviceable: r.serviceable ? 1 : 0, note: r.note || null }));
  const svcRekap = { serviceable: 0, unserviceable: 0 };
  for (const r of serviceability) (r.serviceable ? svcRekap.serviceable++ : svcRekap.unserviceable++);

  // III-c. Grid checklist HARIAN per aset/kendaraan (baris aset × kolom tanggal, kode hasil).
  const ufcg = unitFilter(unitId, 'cr.unit_id');
  const [dailyRuns] = await pool.query(
    `SELECT cr.device_id, d.name, DAY(cr.run_date) AS day, cr.overall
       FROM checklist_runs cr JOIN devices d ON d.id=cr.device_id
      WHERE cr.frequency='harian' AND cr.run_date>=? AND cr.run_date<?${ufcg.clause}
      ORDER BY d.name, cr.run_date`,
    [start, end, ...ufcg.params]
  );
  const OV_CODE = { baik: '✓', perhatian: '△', rusak: '✗' };
  const gmap = new Map();
  for (const r of dailyRuns) {
    if (!gmap.has(r.device_id)) gmap.set(r.device_id, { nama: r.name, cells: Array(daysInMonth).fill('') });
    gmap.get(r.device_id).cells[r.day - 1] = OV_CODE[r.overall] || '';
  }
  const checklistGrid = { days: daysInMonth, rows: [...gmap.values()] };

  // IV. Obat air (biaya periode)
  const obatAir = await obatAirReport(unitId, start, lastDay);
  const obatTotal = obatAir.reduce((s, r) => s + Number(r.biaya || 0), 0);

  // V. Daftar kebutuhan pengadaan (kondisi RR/RB atau ada catatan kebutuhan)
  const procurement = assets.filter((a) => a.kondisi === 'RR' || a.kondisi === 'RB' || (a.kebutuhan && a.kebutuhan.trim()));

  // VI. Kegiatan pemeliharaan bulan ini
  const ufk = unitFilter(unitId, 'unit_id');
  const [kegiatan] = await pool.query(
    `SELECT tanggal_kegiatan, judul, lokasi, hasil, petugas_nama FROM kegiatan_non_rutin
      WHERE tanggal_kegiatan>=? AND tanggal_kegiatan<?${ufk.clause} ORDER BY tanggal_kegiatan`,
    [start, end, ...ufk.params]
  );

  // VII. Jadwal dinas bulan ini (grid)
  const ufs = unitFilter(unitId, 's.unit_id');
  const [shiftRows] = await pool.query(
    `SELECT s.user_id, u.name, DAY(s.shift_date) d, s.shift_type FROM shifts s JOIN users u ON u.id=s.user_id
      WHERE s.shift_date>=? AND s.shift_date<?${ufs.clause}
      ORDER BY (u.role='koordinator' OR JSON_CONTAINS(u.roles,'"koordinator"')) DESC, u.name`,
    [start, end, ...ufs.params]
  );
  const jmap = new Map();
  for (const r of shiftRows) {
    if (!jmap.has(r.user_id)) jmap.set(r.user_id, { nama: r.name, cells: Array(daysInMonth).fill('') });
    jmap.get(r.user_id).cells[r.d - 1] = SHIFT_CODE[r.shift_type] || '';
  }

  // Identitas surat efektif (kop, koordinator) untuk letterhead & blok tanda tangan.
  const lkp = await effectiveLkp(await readGlobalLkp(), unitId);
  const tglCetak = `${now.getDate()} ${BULAN[now.getMonth()]} ${now.getFullYear()}`;

  return {
    month, monthName, daysInMonth,
    personil: personil.map((p, i) => ({ no: i + 1, ...p })),
    inventaris, kondisiRekap,
    checklist: { total: chkTot.total, aset: chkTot.aset, byOverall: chkByOverall },
    serviceability, svcRekap,
    checklistGrid,
    obatAir, obatTotal,
    procurement,
    kegiatan,
    jadwal: { days: daysInMonth, rows: [...jmap.values()] },
    lkp: {
      kop_url: lkp.kop_url || null,
      kantor: lkp.kantor || 'BANDAR UDARA A.P.T. PRANOTO - SAMARINDA',
      kota: lkp.kota || 'Samarinda',
      koord_nama: lkp.koord_nama || '',
      koord_nip: lkp.koord_nip || '',
      koord_jabatan: lkp.koord_jabatan || 'KOORDINATOR UNIT ALAT-ALAT BESAR',
    },
    tglCetak,
  };
}

router.get('/aab', requireRole('koordinator', 'admin'), async (req, res) => {
  res.json(await buildAabReport(req.query.month, req.unitId));
});

// Pilih builder Laporan Bulanan menurut unit: AAB → buildAabReport, selain itu → buildLaporanData.
// Kembalikan { kind, data } — `kind='aab'` dipakai frontend (TTD/DocPrint) memilih renderer HTML.
export async function buildMonthlyReport(month, unitId) {
  let code = null;
  if (unitId != null) {
    const [[u]] = await pool.query('SELECT code FROM units WHERE id=? LIMIT 1', [unitId]);
    code = u?.code || null;
  }
  if (code === 'AAB') return { kind: 'aab', data: await buildAabReport(month, unitId) };
  return { kind: 'default', data: await buildLaporanData(month, unitId) };
}

// Laporan bulanan unit-aware ({kind, data}) — dipakai "Cetak"/preview di Surat Keluar
// agar pengantar Laporan Bulanan AAB memakai renderer AAB.
router.get('/monthly', requireRole('koordinator', 'admin'), async (req, res) => {
  res.json(await buildMonthlyReport(req.query.month, req.unitId));
});

// ===== Laporan Bulanan Unjuk Hasil / Kinerja (ELB — unit jaringan) =====
export async function buildKinerjaReport(monthIn, unitId) {
  const now = new Date();
  const month = /^\d{4}-\d{2}$/.test(monthIn) ? monthIn : `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const [y, m] = month.split('-').map(Number);
  const p2 = (n) => String(n).padStart(2, '0');
  const start = `${y}-${p2(m)}-01`;
  const end = `${m === 12 ? y + 1 : y}-${p2(m === 12 ? 1 : m + 1)}-01`;
  const lastDay = `${y}-${p2(m)}-${p2(new Date(y, m, 0).getDate())}`;
  const monthName = `${BULAN[m - 1]} ${y}`;
  const uf = unitFilter(unitId);            // incidents.unit_id
  const ufd = unitFilter(unitId, 'd.unit_id');

  // I. KPI insiden
  const [[inc]] = await pool.query(
    `SELECT COUNT(*) total, SUM(status='selesai') selesai, SUM(status<>'selesai') aktif,
            SUM(priority='kritis') kritis, SUM(priority='tinggi') tinggi, SUM(priority='sedang') sedang
       FROM incidents WHERE created_at>=? AND created_at<?${uf.clause}`, [start, end, ...uf.params]);
  const [[mt]] = await pool.query(
    `SELECT ROUND(AVG(duration_min)) mttr FROM incidents WHERE status='selesai' AND resolved_at>=? AND resolved_at<?${uf.clause}`, [start, end, ...uf.params]);
  const [[rp]] = await pool.query(
    `SELECT ROUND(AVG(TIMESTAMPDIFF(MINUTE,created_at,taken_at))) avgResp,
            ROUND(100*AVG(TIMESTAMPDIFF(MINUTE,created_at,taken_at)<=?),1) onTimePct
       FROM incidents WHERE taken_at IS NOT NULL AND taken_at>=? AND taken_at<?${uf.clause}`, [SLA_MINUTES, start, end, ...uf.params]);

  // II. Uptime/ketersediaan per perangkat (rollup harian)
  const [devRows] = await pool.query(
    `SELECT d.id, d.name, d.ip, d.loc,
            COALESCE(SUM(u.up_samples + u.warn_samples),0) up_ish, COALESCE(SUM(u.samples),0) tot_s, COALESCE(SUM(u.maint_samples),0) maint_s,
            COALESCE(SUM(u.down_seconds),0) down_sec, COALESCE(SUM(u.incidents),0) inc
       FROM devices d LEFT JOIN device_uptime_daily u ON u.device_id=d.id AND u.day BETWEEN ? AND ?
      WHERE d.asset_class='network'${ufd.clause}
      GROUP BY d.id ORDER BY d.name`, [start, lastDay, ...ufd.params]);
  // Availability = (online + warning) / (samples − maintenance): perangkat yang MERESPONS
  // dianggap tersedia (warning = hidup, hanya perlu perhatian), selaras dgn laporan SLA & bulanan.
  const devices = devRows.map((d) => { const base = Number(d.tot_s) - Number(d.maint_s); return { id: d.id, name: d.name, ip: d.ip, loc: d.loc, down_sec: Number(d.down_sec), inc: Number(d.inc), uptime: base > 0 ? Math.round(1000 * d.up_ish / base) / 10 : null }; });
  const withU = devices.filter((d) => d.uptime != null);
  const avgUptime = withU.length ? Math.round(10 * withU.reduce((s, d) => s + d.uptime, 0) / withU.length) / 10 : null;
  const worst = [...withU].sort((a, b) => a.uptime - b.uptime).slice(0, 5);

  // III. Perangkat/layanan paling sering bermasalah
  const [topIssues] = await pool.query(
    `SELECT COALESCE(NULLIF(device_name,''),'-') nama, COUNT(*) n FROM incidents
      WHERE created_at>=? AND created_at<?${uf.clause} GROUP BY device_name ORDER BY n DESC LIMIT 8`, [start, end, ...uf.params]);

  // IV. Daftar SEMUA aset unit + status. Aturan: perangkat TANPA IP dianggap "aktif",
  // kecuali ada insiden aktif (mis. dari laporan publik) → "rusak". Perangkat ber-IP ikut
  // pemantauan (uptime/ping); insiden aktif menurunkan status ke "gangguan".
  const [assetRows] = await pool.query(
    `SELECT d.id, d.name, d.ip, d.loc, d.type, d.status AS live, d.monitor_enabled, d.asset_class,
            COALESCE(SUM(u.up_samples + u.warn_samples),0) up_ish, COALESCE(SUM(u.samples),0) tot_s, COALESCE(SUM(u.maint_samples),0) maint_s,
            (SELECT COUNT(*) FROM incidents i WHERE i.device_id=d.id AND i.status<>'selesai') open_inc,
            (SELECT COUNT(*) FROM public_reports pr WHERE pr.device_id=d.id AND pr.status<>'selesai') open_rep
       FROM devices d LEFT JOIN device_uptime_daily u ON u.device_id=d.id AND u.day BETWEEN ? AND ?
      WHERE 1=1${ufd.clause}
      GROUP BY d.id ORDER BY d.name`, [start, lastDay, ...ufd.params]);
  const assets = assetRows.map((d) => {
    const noIp = !d.ip || /^n\/?a/i.test(String(d.ip));
    const base = Number(d.tot_s) - Number(d.maint_s);
    const uptime = base > 0 ? Math.round(1000 * d.up_ish / base) / 10 : null;
    const openInc = Number(d.open_inc) || 0;
    // "Dilaporkan rusak" terdeteksi otomatis dari laporan publik (via QR aset) atau insiden aktif.
    const reportedBroken = openInc > 0 || Number(d.open_rep) > 0;
    let status;
    if (noIp) status = reportedBroken ? 'rusak' : 'aktif';           // tanpa IP: aktif kecuali dilaporkan rusak
    else if (uptime != null) status = uptime >= 95 ? 'aktif' : 'gangguan';
    else status = d.live === 'up' ? 'aktif' : d.live === 'down' ? 'rusak' : 'tidak_dipantau';
    if (!noIp && reportedBroken && status === 'aktif') status = 'gangguan'; // ber-IP + dilaporkan bermasalah
    return { id: d.id, name: d.name, ip: noIp ? null : d.ip, loc: d.loc, type: d.type, hasIp: !noIp, uptime, openInc, status };
  });
  const assetSummary = assets.reduce((a, x) => { a[x.status] = (a[x.status] || 0) + 1; return a; }, {});

  // IV. Kinerja teknisi (ranking)
  const uft = unitFilter(unitId);
  const [techs] = await pool.query(`SELECT id, name, jabatan FROM users WHERE active=1 AND (role='teknisi' OR JSON_CONTAINS(roles,'"teknisi"'))${uft.clause} ORDER BY name`, uft.params);
  const teknisi = [];
  for (const t of techs) { const mm = await metricsFor(t.id, start, end, unitId); teknisi.push({ name: t.name, jabatan: t.jabatan, done: mm.done, onTime: mm.onTime, taken: mm.taken, avgResp: mm.avgResp, avgDur: mm.avgDur, pm: mm.pm, dokumentasi: mm.dokumentasi, inspections: mm.inspections, score: mm.score, grade: mm.grade }); }
  teknisi.sort((a, b) => (b.score || 0) - (a.score || 0));

  // V. Pemeliharaan
  const [[maint]] = await pool.query(`SELECT SUM(status='selesai') done, COUNT(*) total FROM equipment_maintenance WHERE plan_month=?${uf.clause}`, [month, ...uf.params]);
  const [[insp]] = await pool.query(`SELECT COUNT(*) c FROM equipment_inspections WHERE inspect_date>=? AND inspect_date<?${uf.clause}`, [start, end, ...uf.params]);

  const selesai = Number(inc.selesai) || 0;
  return {
    month, monthName,
    kpi: {
      total: inc.total, selesai, aktif: Number(inc.aktif) || 0,
      selesaiPct: inc.total ? Math.round(1000 * selesai / inc.total) / 10 : null,
      mttr: mt.mttr, avgResp: rp.avgResp, onTimePct: rp.onTimePct, avgUptime,
      kritis: Number(inc.kritis) || 0, tinggi: Number(inc.tinggi) || 0, sedang: Number(inc.sedang) || 0,
      jumlahPerangkat: devices.length, maintDone: Number(maint.done) || 0, maintTotal: Number(maint.total) || 0, inspeksi: insp.c,
    },
    worst, topIssues, teknisi, assets, assetSummary,
  };
}

router.get('/kinerja', requireRole('koordinator', 'admin'), async (req, res) => {
  res.json(await buildKinerjaReport(req.query.month, req.unitId));
});

export default router;
