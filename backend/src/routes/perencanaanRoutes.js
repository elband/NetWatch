import { Router } from 'express';
import { pool } from '../db/pool.js';
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
const clamp = (v, a, b) => Math.min(Math.max(a, Number.isFinite(v) ? v : a), b);
const rupiah = (v) => { const n = Math.round(Number(v)); return Number.isFinite(n) && n > 0 ? n : 0; };
const numOrNull = (v) => (v == null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));

// Susun nilai kolom dari body request. `prev` = baris lama (dipakai saat update
// agar field yang tidak dikirim tetap memakai nilai sebelumnya).
function fields(b, prev = {}) {
  const status = STATUS.includes(b.status) ? b.status : (prev.status || 'rencana');
  let progres = b.progres != null && b.progres !== '' ? clamp(Number(b.progres), 0, 100) : (prev.progres ?? 0);
  if (status === 'selesai' && (b.progres == null || b.progres === '')) progres = 100; // selesai → 100%
  const raw = b.realisasi_biaya;
  const realisasi = raw == null || raw === ''
    ? (raw === '' ? null : (prev.realisasi_biaya ?? null))   // '' = kosongkan; undefined = pertahankan
    : rupiah(raw);
  return {
    tahun: Number(b.tahun) || prev.tahun || new Date().getFullYear(),
    kuartal: [0, 1, 2, 3, 4].includes(Number(b.kuartal)) ? Number(b.kuartal) : (prev.kuartal ?? 0),
    kategori: KATEGORI.includes(b.kategori) ? b.kategori : (prev.kategori || 'lainnya'),
    judul: (b.judul ?? prev.judul ?? '').toString().trim(),
    deskripsi: b.deskripsi != null ? (String(b.deskripsi).trim() || null) : (prev.deskripsi ?? null),
    prioritas: PRIORITAS.includes(b.prioritas) ? b.prioritas : (prev.prioritas || 'sedang'),
    status,
    progres,
    estimasi_biaya: b.estimasi_biaya != null ? rupiah(b.estimasi_biaya) : (prev.estimasi_biaya ?? 0),
    realisasi_biaya: realisasi,
    target_date: b.target_date !== undefined ? (b.target_date || null) : (prev.target_date ?? null),
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
    `INSERT INTO unit_plans (unit_id, tahun, kuartal, kategori, judul, deskripsi, prioritas, status, progres, estimasi_biaya, realisasi_biaya, target_date, pic_nama, catatan, created_by, creator_name)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [unitId, f.tahun, f.kuartal, f.kategori, f.judul, f.deskripsi, f.prioritas, f.status, f.progres, f.estimasi_biaya, f.realisasi_biaya, f.target_date, f.pic_nama, f.catatan, req.user.id, req.user.name]
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
    `UPDATE unit_plans SET tahun=?, kuartal=?, kategori=?, judul=?, deskripsi=?, prioritas=?, status=?, progres=?, estimasi_biaya=?, realisasi_biaya=?, target_date=?, pic_nama=?, catatan=? WHERE id=?`,
    [f.tahun, f.kuartal, f.kategori, f.judul, f.deskripsi, f.prioritas, f.status, f.progres, f.estimasi_biaya, f.realisasi_biaya, f.target_date, f.pic_nama, f.catatan, id]
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

export default router;
