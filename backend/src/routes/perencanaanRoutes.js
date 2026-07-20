import { Router } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { pool } from '../db/pool.js';
import { randName } from '../middleware/upload.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { unitScope, unitFilter, rowInUnit, insertUnitId } from '../middleware/unitScope.js';

// Perencanaan Unit = Program/Rencana Kerja tingkat unit (bukan per-individu seperti SKP).
// Hanya pengelola unit yang boleh: koordinator (= admin unitnya sendiri) & super admin.
const router = Router();
router.use(requireAuth);
router.use(unitScope);
router.use(requireRole('admin', 'koordinator'));

const KATEGORI = ['pemeliharaan', 'pengadaan', 'sdm', 'pengembangan', 'administrasi', 'lainnya'];
const PRIORITAS = ['tinggi', 'sedang', 'rendah'];
const STATUS = ['rencana', 'berjalan', 'selesai', 'tertunda', 'batal'];
// Siklus program: begitu dimasukkan, program DIANGGAP DISETUJUI dan langsung berjalan
// pada tahap Pelaksanaan. Tidak ada lagi tahap pengajuan/persetujuan.
const TAHAP = ['pelaksanaan', 'monitoring', 'evaluasi', 'penyelesaian', 'arsip'];
const NILAI = ['berhasil', 'sebagian', 'tidak_tercapai'];
const JENIS_FILE = ['dokumentasi', 'laporan', 'bukti'];

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PLAN_DIR = path.join(__dirname, '..', '..', 'uploads', 'perencanaan');
fs.mkdirSync(PLAN_DIR, { recursive: true });
const upload = multer({
  storage: multer.diskStorage({
    destination: (q, f, cb) => cb(null, PLAN_DIR),
    filename: (q, f, cb) => cb(null, randName('P', f.originalname)),
  }),
  limits: { fileSize: 20 * 1024 * 1024 },
});

// Ambil program + pastikan berada di unit efektif requester.
async function getPlan(id, unitId) {
  const [rows] = await pool.query('SELECT * FROM unit_plans WHERE id=?', [Number(id)]);
  const p = rows[0];
  if (!p || !rowInUnit(p, unitId)) return null;
  return p;
}
async function planWithDetail(id) {
  const [[plan]] = await pool.query('SELECT * FROM unit_plans WHERE id=?', [Number(id)]);
  const [logs] = await pool.query('SELECT * FROM unit_plan_logs WHERE plan_id=? ORDER BY tanggal DESC, id DESC', [Number(id)]);
  const [files] = await pool.query('SELECT * FROM unit_plan_files WHERE plan_id=? ORDER BY id', [Number(id)]);
  return { plan, logs, files };
}
// Naikkan tahap hanya bila maju (tidak pernah memundurkan tahap secara otomatis).
const majuTahap = (kini, target) => (TAHAP.indexOf(target) > TAHAP.indexOf(kini) ? target : kini);
const clamp = (v, a, b) => Math.min(Math.max(a, Number.isFinite(v) ? v : a), b);
const rupiah = (v) => { const n = Math.round(Number(v)); return Number.isFinite(n) && n > 0 ? n : 0; };
const numOrNull = (v) => (v == null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));

// Susun nilai kolom dari body request. `prev` = baris lama (dipakai saat update
// agar field yang tidak dikirim tetap memakai nilai sebelumnya).
function fields(b, prev = {}) {
  // Default status program baru = 'berjalan' (dianggap disetujui saat dimasukkan).
  const status = STATUS.includes(b.status) ? b.status : (prev.status || 'berjalan');
  let progres = b.progres != null && b.progres !== '' ? clamp(Number(b.progres), 0, 100) : (prev.progres ?? 0);
  if (status === 'selesai' && (b.progres == null || b.progres === '')) progres = 100; // selesai → 100%
  const raw = b.realisasi_biaya;
  const realisasi = raw == null || raw === ''
    ? (raw === '' ? null : (prev.realisasi_biaya ?? null))   // '' = kosongkan; undefined = pertahankan
    : rupiah(raw);
  const txt = (v, prevV, max = 500) => (v != null ? (String(v).trim().slice(0, max) || null) : (prevV ?? null));
  return {
    tahun: Number(b.tahun) || prev.tahun || new Date().getFullYear(),
    kuartal: [0, 1, 2, 3, 4].includes(Number(b.kuartal)) ? Number(b.kuartal) : (prev.kuartal ?? 0),
    kategori: KATEGORI.includes(b.kategori) ? b.kategori : (prev.kategori || 'lainnya'),
    judul: (b.judul ?? prev.judul ?? '').toString().trim(),
    deskripsi: b.deskripsi != null ? (String(b.deskripsi).trim() || null) : (prev.deskripsi ?? null),
    tujuan: txt(b.tujuan, prev.tujuan),
    keluaran: txt(b.keluaran, prev.keluaran),
    volume: txt(b.volume, prev.volume, 120),
    indikator: txt(b.indikator, prev.indikator),
    prioritas: PRIORITAS.includes(b.prioritas) ? b.prioritas : (prev.prioritas || 'sedang'),
    status,
    progres,
    estimasi_biaya: b.estimasi_biaya != null ? rupiah(b.estimasi_biaya) : (prev.estimasi_biaya ?? 0),
    realisasi_biaya: realisasi,
    sumber_dana: txt(b.sumber_dana, prev.sumber_dana, 40),
    start_date: b.start_date !== undefined ? (b.start_date || null) : (prev.start_date ?? null),
    target_date: b.target_date !== undefined ? (b.target_date || null) : (prev.target_date ?? null),
    metode: txt(b.metode, prev.metode, 40),
    pic_nama: b.pic_nama != null ? (String(b.pic_nama).trim() || null) : (prev.pic_nama ?? null),
    catatan: b.catatan != null ? (String(b.catatan).trim() || null) : (prev.catatan ?? null),
  };
}

async function distinctYears(unitId) {
  const uf = unitFilter(unitId, 'unit_id');
  const [rows] = await pool.query(`SELECT DISTINCT tahun FROM unit_plans WHERE 1=1${uf.clause} ORDER BY tahun DESC`, uf.params);
  return rows.map((r) => r.tahun);
}

// ===== Daftar rencana (per tahun + filter opsional) =====
router.get('/', async (req, res) => {
  const uf = unitFilter(req.unitId, 'unit_id');
  const tahun = Number(req.query.tahun) || new Date().getFullYear();
  let sql = `SELECT * FROM unit_plans WHERE tahun=?${uf.clause}`;
  const params = [tahun, ...uf.params];
  if (KATEGORI.includes(req.query.kategori)) { sql += ' AND kategori=?'; params.push(req.query.kategori); }
  if (STATUS.includes(req.query.status)) { sql += ' AND status=?'; params.push(req.query.status); }
  if (PRIORITAS.includes(req.query.prioritas)) { sql += ' AND prioritas=?'; params.push(req.query.prioritas); }
  if (['0', '1', '2', '3', '4'].includes(String(req.query.kuartal))) { sql += ' AND kuartal=?'; params.push(Number(req.query.kuartal)); }
  if (TAHAP.includes(req.query.tahap)) { sql += ' AND tahap=?'; params.push(req.query.tahap); }
  // Program terarsip disembunyikan dari daftar aktif kecuali diminta (?arsip=1 / ?tahap=arsip).
  else if (req.query.arsip !== '1') sql += " AND tahap<>'arsip'";
  if (req.query.q) { const k = `%${req.query.q}%`; sql += ' AND (judul LIKE ? OR deskripsi LIKE ? OR pic_nama LIKE ?)'; params.push(k, k, k); }
  sql += ' ORDER BY kuartal, FIELD(prioritas,"tinggi","sedang","rendah"), FIELD(status,"berjalan","rencana","tertunda","selesai","batal"), id DESC';
  const [rows] = await pool.query(sql, params);
  res.json({ plans: rows, years: await distinctYears(req.unitId) });
});

// ===== Buat rencana =====
router.post('/', async (req, res) => {
  const f = fields(req.body);
  if (!f.judul) return res.status(400).json({ error: 'Judul rencana wajib diisi.' });
  const unitId = insertUnitId(req);
  if (unitId == null) return res.status(400).json({ error: 'Pilih unit terlebih dahulu (via pemilih unit di header).' });
  const [r] = await pool.query(
    `INSERT INTO unit_plans (unit_id, tahun, kuartal, kategori, judul, deskripsi, tujuan, keluaran, volume, indikator, prioritas, status, progres, estimasi_biaya, realisasi_biaya, sumber_dana, start_date, target_date, metode, pic_nama, catatan, created_by, creator_name)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [unitId, f.tahun, f.kuartal, f.kategori, f.judul, f.deskripsi, f.tujuan, f.keluaran, f.volume, f.indikator, f.prioritas, f.status, f.progres, f.estimasi_biaya, f.realisasi_biaya, f.sumber_dana, f.start_date, f.target_date, f.metode, f.pic_nama, f.catatan, req.user.id, req.user.name]
  );
  const [rows] = await pool.query('SELECT * FROM unit_plans WHERE id=?', [r.insertId]);
  res.status(201).json({ plan: rows[0] });
});

// ===== Edit rencana (penuh) =====
router.put('/:id', async (req, res) => {
  const id = Number(req.params.id);
  const [rows] = await pool.query('SELECT * FROM unit_plans WHERE id=?', [id]);
  const d = rows[0];
  if (!d || !rowInUnit(d, req.unitId)) return res.status(404).json({ error: 'Rencana tidak ditemukan' });
  const f = fields(req.body, d);
  if (!f.judul) return res.status(400).json({ error: 'Judul rencana wajib diisi.' });
  await pool.query(
    `UPDATE unit_plans SET tahun=?, kuartal=?, kategori=?, judul=?, deskripsi=?, tujuan=?, keluaran=?, volume=?, indikator=?, prioritas=?, status=?, progres=?, estimasi_biaya=?, realisasi_biaya=?, sumber_dana=?, start_date=?, target_date=?, metode=?, pic_nama=?, catatan=? WHERE id=?`,
    [f.tahun, f.kuartal, f.kategori, f.judul, f.deskripsi, f.tujuan, f.keluaran, f.volume, f.indikator, f.prioritas, f.status, f.progres, f.estimasi_biaya, f.realisasi_biaya, f.sumber_dana, f.start_date, f.target_date, f.metode, f.pic_nama, f.catatan, id]
  );
  const [u] = await pool.query('SELECT * FROM unit_plans WHERE id=?', [id]);
  res.json({ plan: u[0] });
});

// ===== Ubah cepat status / progres (dari kartu, tanpa buka modal) =====
router.patch('/:id', async (req, res) => {
  const id = Number(req.params.id);
  const [rows] = await pool.query('SELECT * FROM unit_plans WHERE id=?', [id]);
  const d = rows[0];
  if (!d || !rowInUnit(d, req.unitId)) return res.status(404).json({ error: 'Rencana tidak ditemukan' });
  const status = STATUS.includes(req.body.status) ? req.body.status : d.status;
  let progres = req.body.progres != null ? clamp(Number(req.body.progres), 0, 100) : d.progres;
  if (status === 'selesai' && req.body.progres == null) progres = 100;
  await pool.query('UPDATE unit_plans SET status=?, progres=? WHERE id=?', [status, progres, id]);
  const [u] = await pool.query('SELECT * FROM unit_plans WHERE id=?', [id]);
  res.json({ plan: u[0] });
});

// ===== Hapus rencana =====
router.delete('/:id', async (req, res) => {
  const [rows] = await pool.query('SELECT unit_id FROM unit_plans WHERE id=?', [Number(req.params.id)]);
  if (!rows[0] || !rowInUnit(rows[0], req.unitId)) return res.status(404).json({ error: 'Rencana tidak ditemukan' });
  await pool.query('DELETE FROM unit_plans WHERE id=?', [Number(req.params.id)]);
  res.json({ ok: true });
});

// ===== Kandidat Peremajaan / Pengadaan (dari inventaris unit) =====
// Tandai perangkat/aset yang perlu diganti berdasarkan UMUR (devices.tahun) atau
// KONDISI (devices.kondisi RB / op_status rusak; assets.status rusak). Ter-scope unit.
router.get('/peremajaan', async (req, res) => {
  const umurMax = Math.max(1, Number(req.query.umurMax) || 5);
  const nowY = new Date().getFullYear();
  const uf = unitFilter(req.unitId, 'unit_id');
  const [devs] = await pool.query(
    `SELECT id, name, type, merk, tahun, kondisi, op_status, loc FROM devices WHERE 1=1${uf.clause} ORDER BY name`, uf.params);
  const [asetRows] = await pool.query(
    `SELECT id, name, category, status FROM assets WHERE 1=1${uf.clause} ORDER BY name`, uf.params);
  const items = [];
  for (const d of devs) {
    const umur = /^\d{4}$/.test(String(d.tahun || '')) ? nowY - Number(d.tahun) : null;
    const alasan = [];
    if (umur != null && umur >= umurMax) alasan.push(`Umur ${umur} th (≥ ${umurMax})`);
    if (d.kondisi === 'RB') alasan.push('Rusak Berat');
    else if (d.kondisi === 'RR') alasan.push('Rusak Ringan');
    if (d.op_status === 'rusak') alasan.push('Status rusak');
    else if (d.op_status === 'perbaikan') alasan.push('Sedang perbaikan');
    if (!alasan.length) continue;
    items.push({ sumber: 'perangkat', id: d.id, nama: d.name, tipe: d.merk || d.type || '-', tahun: d.tahun || null, umur, kondisi: d.kondisi || null, lokasi: d.loc || null, alasan: alasan.join(' · ') });
  }
  for (const a of asetRows) {
    const alasan = [];
    if (a.status === 'rusak') alasan.push('Kondisi rusak');
    else if (a.status === 'perbaikan') alasan.push('Sedang perbaikan');
    else if (a.status === 'hilang') alasan.push('Hilang');
    if (!alasan.length) continue;
    items.push({ sumber: 'aset', id: a.id, nama: a.name, tipe: a.category || '-', tahun: null, umur: null, kondisi: a.status, lokasi: null, alasan: alasan.join(' · ') });
  }
  items.sort((x, y) => (y.umur ?? -1) - (x.umur ?? -1) || String(x.nama).localeCompare(String(y.nama)));
  res.json({ items, umurMax, tahunKini: nowY });
});

// ===== Target & KPI Unit =====
router.get('/kpi', async (req, res) => {
  const uf = unitFilter(req.unitId, 'unit_id');
  const tahun = Number(req.query.tahun) || new Date().getFullYear();
  const [rows] = await pool.query(`SELECT * FROM unit_kpi_targets WHERE tahun=?${uf.clause} ORDER BY sort_order, id`, [tahun, ...uf.params]);
  res.json({ kpi: rows });
});

router.post('/kpi', async (req, res) => {
  const b = req.body;
  if (!b.label?.trim()) return res.status(400).json({ error: 'Label KPI wajib diisi.' });
  const unitId = insertUnitId(req);
  if (unitId == null) return res.status(400).json({ error: 'Pilih unit terlebih dahulu.' });
  const [r] = await pool.query(
    `INSERT INTO unit_kpi_targets (unit_id, tahun, label, satuan, target, realisasi, arah, catatan, sort_order) VALUES (?,?,?,?,?,?,?,?,?)`,
    [unitId, Number(b.tahun) || new Date().getFullYear(), b.label.trim(), b.satuan?.trim() || null, numOrNull(b.target), numOrNull(b.realisasi), b.arah === 'turun' ? 'turun' : 'naik', b.catatan?.trim() || null, Number(b.sort_order) || 0]);
  const [rows] = await pool.query('SELECT * FROM unit_kpi_targets WHERE id=?', [r.insertId]);
  res.status(201).json({ kpi: rows[0] });
});

router.put('/kpi/:id', async (req, res) => {
  const id = Number(req.params.id);
  const [rows] = await pool.query('SELECT * FROM unit_kpi_targets WHERE id=?', [id]);
  const d = rows[0];
  if (!d || !rowInUnit(d, req.unitId)) return res.status(404).json({ error: 'KPI tidak ditemukan' });
  const b = req.body;
  await pool.query(
    `UPDATE unit_kpi_targets SET label=?, satuan=?, target=?, realisasi=?, arah=?, catatan=? WHERE id=?`,
    [b.label?.trim() || d.label,
     b.satuan !== undefined ? (b.satuan?.trim() || null) : d.satuan,
     b.target !== undefined ? numOrNull(b.target) : d.target,
     b.realisasi !== undefined ? numOrNull(b.realisasi) : d.realisasi,
     b.arah === 'turun' ? 'turun' : (b.arah === 'naik' ? 'naik' : d.arah),
     b.catatan !== undefined ? (b.catatan?.trim() || null) : d.catatan, id]);
  const [u] = await pool.query('SELECT * FROM unit_kpi_targets WHERE id=?', [id]);
  res.json({ kpi: u[0] });
});

router.delete('/kpi/:id', async (req, res) => {
  const [rows] = await pool.query('SELECT unit_id FROM unit_kpi_targets WHERE id=?', [Number(req.params.id)]);
  if (!rows[0] || !rowInUnit(rows[0], req.unitId)) return res.status(404).json({ error: 'KPI tidak ditemukan' });
  await pool.query('DELETE FROM unit_kpi_targets WHERE id=?', [Number(req.params.id)]);
  res.json({ ok: true });
});

// ===== Data untuk cetak dokumen resmi "Program Kerja Unit" =====
// Personil (dari akun), peralatan per kategori (devices), & jadwal perawatan nyata
// (maintenance_windows tahun ini → month/week). Rencana & KPI diambil via endpoint lain.
router.get('/program-kerja-data', async (req, res) => {
  const tahun = Number(req.query.tahun) || new Date().getFullYear();
  const uf = unitFilter(req.unitId, 'unit_id');

  // Personil: koordinator + teknisi aktif (ter-scope unit), koordinator diurut lebih dulu.
  const ufU = unitFilter(req.unitId, 'unit_id');
  const [users] = await pool.query(
    `SELECT id, name, nip, pangkat, ttl, jabatan FROM users
     WHERE active=1 AND (role IN ('koordinator','teknisi') OR JSON_CONTAINS(roles,'"koordinator"') OR JSON_CONTAINS(roles,'"teknisi"'))${ufU.clause}
     ORDER BY (role='koordinator' OR JSON_CONTAINS(roles,'"koordinator"')) DESC, name`,
    ufU.params
  );
  const personil = users.map((u, i) => ({ no: i + 1, name: u.name, nip: u.nip, pangkat: u.pangkat, ttl: u.ttl, jabatan: u.jabatan }));

  // Peralatan dikelompokkan per kategori (fallback: type).
  const [devs] = await pool.query(
    `SELECT id, name, type, category, loc FROM devices WHERE 1=1${uf.clause} ORDER BY category, name`, uf.params);
  const groups = new Map();
  const devIds = new Set();
  for (const d of devs) {
    devIds.add(d.id);
    const cat = d.category || d.type || 'Lainnya';
    if (!groups.has(cat)) groups.set(cat, []);
    groups.get(cat).push({ id: d.id, name: d.name, type: d.type, loc: d.loc });
  }
  const equipment = [...groups.entries()].map(([category, items]) => ({ category, items }));

  // Jadwal perawatan nyata dari maintenance_windows tahun ini (hanya untuk perangkat unit).
  const [mw] = await pool.query(
    'SELECT device_id, starts_at FROM maintenance_windows WHERE device_id IS NOT NULL AND starts_at >= ? AND starts_at < ?',
    [`${tahun}-01-01`, `${tahun + 1}-01-01`]);
  const maintenance = mw
    .filter((w) => devIds.has(w.device_id))
    .map((w) => {
      const dt = new Date(w.starts_at);
      return { device_id: w.device_id, month: dt.getMonth(), week: Math.min(3, Math.floor((dt.getDate() - 1) / 7)) };
    });

  res.json({ personil, equipment, maintenance });
});

// ===================== SIKLUS PROGRAM =====================
// Pelaksanaan → Monitoring → Evaluasi → Penyelesaian → Arsip.
// Diletakkan setelah rute spesifik (/peremajaan, /kpi, …) agar '/:id' tidak menangkapnya.

// Detail satu program + kronologi aktivitas + berkas.
router.get('/:id', async (req, res) => {
  const p = await getPlan(req.params.id, req.unitId);
  if (!p) return res.status(404).json({ error: 'Program tidak ditemukan' });
  res.json(await planWithDetail(p.id));
});

// --- Pelaksanaan: catat aktivitas/progres (+ unggah dokumentasi sekaligus) ---
router.post('/:id/log', upload.array('files', 10), async (req, res) => {
  const p = await getPlan(req.params.id, req.unitId);
  if (!p) return res.status(404).json({ error: 'Program tidak ditemukan' });
  if (p.tahap === 'arsip') return res.status(400).json({ error: 'Program sudah diarsipkan.' });
  const catatan = String(req.body.catatan || '').trim();
  if (!catatan) return res.status(400).json({ error: 'Catatan aktivitas wajib diisi.' });
  const tanggal = /^\d{4}-\d{2}-\d{2}$/.test(req.body.tanggal || '') ? req.body.tanggal : new Date().toISOString().slice(0, 10);
  const progres = req.body.progres != null && req.body.progres !== '' ? clamp(Number(req.body.progres), 0, 100) : null;

  const [r] = await pool.query(
    'INSERT INTO unit_plan_logs (plan_id, tanggal, catatan, progres, created_by, creator_name) VALUES (?,?,?,?,?,?)',
    [p.id, tanggal, catatan, progres, req.user.id, req.user.name]
  );
  for (const f of req.files || []) {
    await pool.query(
      'INSERT INTO unit_plan_files (plan_id, log_id, jenis, url, filename, uploaded_by, uploader_name) VALUES (?,?,?,?,?,?,?)',
      [p.id, r.insertId, 'dokumentasi', `/uploads/perencanaan/${f.filename}`, f.originalname?.slice(0, 200) || null, req.user.id, req.user.name]
    );
  }
  // Progres terbaru ikut memperbarui program; status tetap berjalan selama belum selesai.
  if (progres != null) {
    await pool.query("UPDATE unit_plans SET progres=?, status=IF(status IN ('selesai','batal'), status, 'berjalan') WHERE id=?", [progres, p.id]);
  }
  res.status(201).json(await planWithDetail(p.id));
});

router.delete('/log/:logId', async (req, res) => {
  const [[log]] = await pool.query('SELECT * FROM unit_plan_logs WHERE id=?', [Number(req.params.logId)]);
  if (!log) return res.status(404).json({ error: 'Catatan tidak ditemukan' });
  const p = await getPlan(log.plan_id, req.unitId);
  if (!p) return res.status(404).json({ error: 'Program tidak ditemukan' });
  const [files] = await pool.query('SELECT url FROM unit_plan_files WHERE log_id=?', [log.id]);
  await pool.query('DELETE FROM unit_plan_files WHERE log_id=?', [log.id]);
  await pool.query('DELETE FROM unit_plan_logs WHERE id=?', [log.id]);
  for (const f of files) { try { fs.unlinkSync(path.join(PLAN_DIR, path.basename(f.url))); } catch { /* abaikan */ } }
  res.json(await planWithDetail(p.id));
});

// --- Berkas lepas: dokumentasi / laporan akhir / bukti penyelesaian ---
router.post('/:id/files', upload.array('files', 10), async (req, res) => {
  const p = await getPlan(req.params.id, req.unitId);
  if (!p) return res.status(404).json({ error: 'Program tidak ditemukan' });
  const jenis = JENIS_FILE.includes(req.body.jenis) ? req.body.jenis : 'dokumentasi';
  if (!(req.files || []).length) return res.status(400).json({ error: 'Tidak ada berkas yang diunggah.' });
  const ket = String(req.body.keterangan || '').trim().slice(0, 255) || null;
  for (const f of req.files) {
    await pool.query(
      'INSERT INTO unit_plan_files (plan_id, jenis, url, filename, keterangan, uploaded_by, uploader_name) VALUES (?,?,?,?,?,?,?)',
      [p.id, jenis, `/uploads/perencanaan/${f.filename}`, f.originalname?.slice(0, 200) || null, ket, req.user.id, req.user.name]
    );
  }
  res.status(201).json(await planWithDetail(p.id));
});

router.delete('/files/:fileId', async (req, res) => {
  const [[file]] = await pool.query('SELECT * FROM unit_plan_files WHERE id=?', [Number(req.params.fileId)]);
  if (!file) return res.status(404).json({ error: 'Berkas tidak ditemukan' });
  const p = await getPlan(file.plan_id, req.unitId);
  if (!p) return res.status(404).json({ error: 'Program tidak ditemukan' });
  await pool.query('DELETE FROM unit_plan_files WHERE id=?', [file.id]);
  try { fs.unlinkSync(path.join(PLAN_DIR, path.basename(file.url))); } catch { /* abaikan */ }
  res.json(await planWithDetail(p.id));
});

// --- Monitoring: persentase progres, kendala, solusi/tindak lanjut ---
router.put('/:id/monitoring', async (req, res) => {
  const p = await getPlan(req.params.id, req.unitId);
  if (!p) return res.status(404).json({ error: 'Program tidak ditemukan' });
  const progres = req.body.progres != null && req.body.progres !== '' ? clamp(Number(req.body.progres), 0, 100) : p.progres;
  const txt = (v, prev) => (v != null ? (String(v).trim() || null) : (prev ?? null));
  await pool.query(
    'UPDATE unit_plans SET progres=?, kendala=?, tindak_lanjut=?, tahap=? WHERE id=?',
    [progres, txt(req.body.kendala, p.kendala), txt(req.body.tindak_lanjut, p.tindak_lanjut), majuTahap(p.tahap, 'monitoring'), p.id]
  );
  res.json(await planWithDetail(p.id));
});

// --- Evaluasi: target vs hasil, penilaian keberhasilan, catatan evaluasi ---
router.put('/:id/evaluasi', async (req, res) => {
  const p = await getPlan(req.params.id, req.unitId);
  if (!p) return res.status(404).json({ error: 'Program tidak ditemukan' });
  const txt = (v, prev) => (v != null ? (String(v).trim() || null) : (prev ?? null));
  const nilai = NILAI.includes(req.body.nilai_keberhasilan) ? req.body.nilai_keberhasilan : (req.body.nilai_keberhasilan === '' ? null : p.nilai_keberhasilan);
  await pool.query(
    'UPDATE unit_plans SET hasil=?, nilai_keberhasilan=?, evaluasi_catatan=?, tahap=? WHERE id=?',
    [txt(req.body.hasil, p.hasil), nilai, txt(req.body.evaluasi_catatan, p.evaluasi_catatan), majuTahap(p.tahap, 'evaluasi'), p.id]
  );
  res.json(await planWithDetail(p.id));
});

// --- Penyelesaian: wajib ada laporan akhir → status Selesai ---
router.post('/:id/selesai', async (req, res) => {
  const p = await getPlan(req.params.id, req.unitId);
  if (!p) return res.status(404).json({ error: 'Program tidak ditemukan' });
  const [[c]] = await pool.query("SELECT COUNT(*) c FROM unit_plan_files WHERE plan_id=? AND jenis='laporan'", [p.id]);
  if (!Number(c.c)) return res.status(400).json({ error: 'Unggah laporan akhir terlebih dahulu sebelum menandai program selesai.' });
  const realisasi = req.body.realisasi_biaya != null && req.body.realisasi_biaya !== '' ? rupiah(req.body.realisasi_biaya) : p.realisasi_biaya;
  await pool.query(
    "UPDATE unit_plans SET status='selesai', progres=100, tahap='penyelesaian', realisasi_biaya=?, selesai_at=COALESCE(selesai_at, NOW()) WHERE id=?",
    [realisasi, p.id]
  );
  res.json(await planWithDetail(p.id));
});

// --- Arsip: hanya program yang sudah Selesai; tetap bisa dilihat & dicetak ---
router.post('/:id/arsip', async (req, res) => {
  const p = await getPlan(req.params.id, req.unitId);
  if (!p) return res.status(404).json({ error: 'Program tidak ditemukan' });
  if (p.status !== 'selesai') return res.status(400).json({ error: 'Program harus berstatus Selesai sebelum diarsipkan.' });
  await pool.query("UPDATE unit_plans SET tahap='arsip', arsip_at=COALESCE(arsip_at, NOW()) WHERE id=?", [p.id]);
  res.json(await planWithDetail(p.id));
});

// Keluarkan dari arsip (koreksi) — kembali ke tahap penyelesaian.
router.post('/:id/buka-arsip', async (req, res) => {
  const p = await getPlan(req.params.id, req.unitId);
  if (!p) return res.status(404).json({ error: 'Program tidak ditemukan' });
  await pool.query("UPDATE unit_plans SET tahap='penyelesaian', arsip_at=NULL WHERE id=?", [p.id]);
  res.json(await planWithDetail(p.id));
});

export default router;
