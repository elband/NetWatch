import { pool } from '../db/pool.js';
import { unitFilter, rowInUnit, insertUnitId } from '../middleware/unitScope.js';

// Fase 5c (AAB): obat air / bahan kimia — master (dgn harga) + pemakaian harian →
// laporan biaya periodik (volume × harga satuan). Ter-scope unit.

export async function listChemicals(req, res) {
  const uf = unitFilter(req.unitId);
  const [rows] = await pool.query(`SELECT * FROM water_chemicals WHERE active = 1${uf.clause} ORDER BY name`, uf.params);
  res.json({ chemicals: rows });
}

export async function createChemical(req, res) {
  const { name, satuan, harga_satuan } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: 'Nama bahan wajib diisi.' });
  const unitId = insertUnitId(req);
  if (unitId == null) return res.status(400).json({ error: 'Pilih unit terlebih dahulu.' });
  const [r] = await pool.query(
    'INSERT INTO water_chemicals (unit_id, name, satuan, harga_satuan) VALUES (?,?,?,?)',
    [unitId, name.trim(), satuan?.trim() || 'kg', Number(harga_satuan) || 0]
  );
  res.status(201).json({ id: r.insertId });
}

export async function updateChemical(req, res) {
  const id = Number(req.params.id);
  const [[c]] = await pool.query('SELECT * FROM water_chemicals WHERE id = ?', [id]);
  if (!c || !rowInUnit(c, req.unitId)) return res.status(404).json({ error: 'Bahan tidak ditemukan' });
  const { name, satuan, harga_satuan, active } = req.body;
  await pool.query(
    'UPDATE water_chemicals SET name=COALESCE(?,name), satuan=COALESCE(?,satuan), harga_satuan=COALESCE(?,harga_satuan), active=? WHERE id=?',
    [name?.trim() || null, satuan?.trim() || null, harga_satuan == null || harga_satuan === '' ? null : Number(harga_satuan), active == null ? c.active : (active ? 1 : 0), id]
  );
  res.json({ ok: true });
}

export async function deleteChemical(req, res) {
  const id = Number(req.params.id);
  const [[c]] = await pool.query('SELECT id, unit_id FROM water_chemicals WHERE id = ?', [id]);
  if (!c || !rowInUnit(c, req.unitId)) return res.status(404).json({ error: 'Bahan tidak ditemukan' });
  await pool.query('DELETE FROM water_chemicals WHERE id = ?', [id]);
  res.json({ ok: true });
}

export async function recordUsage(req, res) {
  const id = Number(req.params.id);
  const [[c]] = await pool.query('SELECT * FROM water_chemicals WHERE id = ?', [id]);
  if (!c || !rowInUnit(c, req.unitId)) return res.status(404).json({ error: 'Bahan tidak ditemukan' });
  const vol = Number(req.body.volume);
  if (!Number.isFinite(vol) || vol < 0) return res.status(400).json({ error: 'Volume harus angka ≥ 0.' });
  const date = req.body.usage_date && !isNaN(new Date(req.body.usage_date)) ? req.body.usage_date : null;
  const [r] = await pool.query(
    `INSERT INTO water_chemical_usage (chemical_id, unit_id, usage_date, volume, note, recorded_by)
     VALUES (?,?,${date ? '?' : 'CURDATE()'},?,?,?)`,
    date ? [id, c.unit_id, date, vol, req.body.note?.trim() || null, req.user.id]
         : [id, c.unit_id, vol, req.body.note?.trim() || null, req.user.id]
  );
  res.status(201).json({ id: r.insertId });
}

export async function listUsage(req, res) {
  const id = Number(req.params.id);
  const [[c]] = await pool.query('SELECT id, unit_id FROM water_chemicals WHERE id = ?', [id]);
  if (!c || !rowInUnit(c, req.unitId)) return res.status(404).json({ error: 'Bahan tidak ditemukan' });
  const [rows] = await pool.query(
    `SELECT u.*, usr.name AS recorded_by_name FROM water_chemical_usage u LEFT JOIN users usr ON usr.id = u.recorded_by
      WHERE u.chemical_id = ? ORDER BY u.usage_date DESC, u.id DESC LIMIT 200`, [id]
  );
  res.json({ usage: rows });
}

// Laporan biaya periode: per bahan (total volume & biaya) + total keseluruhan.
export async function report(req, res) {
  const to = req.query.to || new Date().toISOString().slice(0, 10);
  const from = req.query.from || `${to.slice(0, 7)}-01`;
  const rows = await computeReport(req.unitId, from, to);
  const grand_total = rows.reduce((s, r) => s + Number(r.biaya || 0), 0);
  res.json({ from, to, rows, grand_total });
}

// Dipakai endpoint & generator laporan bulanan AAB (5d).
export async function computeReport(unitId, from, to) {
  const uf = unitFilter(unitId, 'c.unit_id');
  const [rows] = await pool.query(
    `SELECT c.id, c.name, c.satuan, c.harga_satuan,
            COALESCE(SUM(u.volume), 0) AS total_volume,
            ROUND(COALESCE(SUM(u.volume), 0) * c.harga_satuan, 2) AS biaya
       FROM water_chemicals c
       LEFT JOIN water_chemical_usage u ON u.chemical_id = c.id AND u.usage_date BETWEEN ? AND ?
      WHERE c.active = 1${uf.clause}
      GROUP BY c.id ORDER BY c.name`,
    [from, to, ...uf.params]
  );
  return rows;
}
