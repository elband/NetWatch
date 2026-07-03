import { pool } from '../db/pool.js';
import { unitFilter, rowInUnit, insertUnitId } from '../middleware/unitScope.js';

// Fase 4: sparepart & stok per unit. Stok = kolom stock_qty, diperbarui transaksional
// bersama pencatatan sparepart_moves (masuk/keluar/adjust).

export async function listSpareparts(req, res) {
  const uf = unitFilter(req.unitId);
  const [rows] = await pool.query(
    `SELECT *, (stock_qty <= min_qty) AS low FROM spareparts WHERE active = 1${uf.clause} ORDER BY name`,
    uf.params
  );
  res.json({ spareparts: rows });
}

export async function getSparepart(req, res) {
  const id = Number(req.params.id);
  const [[sp]] = await pool.query('SELECT * FROM spareparts WHERE id = ?', [id]);
  if (!sp || !rowInUnit(sp, req.unitId)) return res.status(404).json({ error: 'Sparepart tidak ditemukan' });
  const [moves] = await pool.query(
    `SELECT m.*, u.name AS moved_by_name, d.name AS device_name
       FROM sparepart_moves m LEFT JOIN users u ON u.id = m.moved_by LEFT JOIN devices d ON d.id = m.device_id
      WHERE m.sparepart_id = ? ORDER BY m.moved_at DESC LIMIT 100`, [id]
  );
  res.json({ sparepart: sp, moves });
}

export async function createSparepart(req, res) {
  const { name, part_no, category, satuan, stock_qty, min_qty, location, notes } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: 'Nama sparepart wajib diisi.' });
  const unitId = insertUnitId(req);
  if (unitId == null) return res.status(400).json({ error: 'Pilih unit terlebih dahulu.' });
  const [r] = await pool.query(
    `INSERT INTO spareparts (unit_id, name, part_no, category, satuan, stock_qty, min_qty, location, notes)
     VALUES (?,?,?,?,?,?,?,?,?)`,
    [unitId, name.trim(), part_no?.trim() || null, category?.trim() || null, satuan?.trim() || 'pcs',
     Number(stock_qty) || 0, Number(min_qty) || 0, location?.trim() || null, notes?.trim() || null]
  );
  res.status(201).json({ id: r.insertId });
}

export async function updateSparepart(req, res) {
  const id = Number(req.params.id);
  const [[sp]] = await pool.query('SELECT * FROM spareparts WHERE id = ?', [id]);
  if (!sp || !rowInUnit(sp, req.unitId)) return res.status(404).json({ error: 'Sparepart tidak ditemukan' });
  const { name, part_no, category, satuan, min_qty, location, notes, active } = req.body;
  // stock_qty TIDAK diubah di sini — hanya lewat /move agar kartu stok akurat.
  await pool.query(
    `UPDATE spareparts SET name=COALESCE(?,name), part_no=?, category=?, satuan=COALESCE(?,satuan),
       min_qty=COALESCE(?,min_qty), location=?, notes=?, active=? WHERE id=?`,
    [name?.trim() || null, part_no?.trim() || null, category?.trim() || null, satuan?.trim() || null,
     min_qty == null || min_qty === '' ? null : Number(min_qty), location?.trim() || null, notes?.trim() || null,
     active == null ? sp.active : (active ? 1 : 0), id]
  );
  res.json({ ok: true });
}

export async function deleteSparepart(req, res) {
  const id = Number(req.params.id);
  const [[sp]] = await pool.query('SELECT id, unit_id FROM spareparts WHERE id = ?', [id]);
  if (!sp || !rowInUnit(sp, req.unitId)) return res.status(404).json({ error: 'Sparepart tidak ditemukan' });
  await pool.query('DELETE FROM spareparts WHERE id = ?', [id]);
  res.json({ ok: true });
}

// Catat pergerakan stok. Dipakai juga oleh PM (Fase 3) → dieksport recordMove.
export async function move(req, res) {
  const id = Number(req.params.id);
  const [[sp]] = await pool.query('SELECT * FROM spareparts WHERE id = ?', [id]);
  if (!sp || !rowInUnit(sp, req.unitId)) return res.status(404).json({ error: 'Sparepart tidak ditemukan' });
  try {
    const result = await recordMove(sp, {
      type: req.body.type, qty: req.body.qty, deviceId: req.body.device_id,
      note: req.body.note, userId: req.user.id,
    });
    res.status(201).json(result);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
}

// Inti pencatatan stok (transaksional). type: masuk|keluar|adjust.
// - masuk: stock += qty · keluar: stock -= qty (tolak bila kurang) · adjust: stock = qty
export async function recordMove(sp, { type, qty, deviceId = null, note = null, userId = null }, conn = null) {
  if (!['masuk', 'keluar', 'adjust'].includes(type)) throw new Error('Jenis pergerakan tidak valid.');
  const n = Number(qty);
  if (!Number.isFinite(n) || n < 0) throw new Error('Jumlah harus angka ≥ 0.');
  const cur = Number(sp.stock_qty);
  let next;
  if (type === 'masuk') next = cur + n;
  else if (type === 'keluar') { if (n > cur) throw new Error(`Stok tidak cukup (tersisa ${cur} ${sp.satuan}).`); next = cur - n; }
  else next = n; // adjust
  const own = !conn;
  const c = own ? await pool.getConnection() : conn;
  try {
    if (own) await c.beginTransaction();
    await c.query('UPDATE spareparts SET stock_qty = ? WHERE id = ?', [next, sp.id]);
    await c.query(
      'INSERT INTO sparepart_moves (sparepart_id, unit_id, type, qty, device_id, note, moved_by) VALUES (?,?,?,?,?,?,?)',
      [sp.id, sp.unit_id, type, n, deviceId || null, note?.trim?.() || note || null, userId]
    );
    if (own) await c.commit();
  } catch (e) { if (own) await c.rollback(); throw e; }
  finally { if (own) c.release(); }
  return { ok: true, stock_qty: next };
}

export async function listMoves(req, res) {
  const id = Number(req.params.id);
  const [[sp]] = await pool.query('SELECT id, unit_id FROM spareparts WHERE id = ?', [id]);
  if (!sp || !rowInUnit(sp, req.unitId)) return res.status(404).json({ error: 'Sparepart tidak ditemukan' });
  const [moves] = await pool.query(
    `SELECT m.*, u.name AS moved_by_name, d.name AS device_name
       FROM sparepart_moves m LEFT JOIN users u ON u.id = m.moved_by LEFT JOIN devices d ON d.id = m.device_id
      WHERE m.sparepart_id = ? ORDER BY m.moved_at DESC LIMIT 200`, [id]
  );
  res.json({ moves });
}

export async function lowStock(req, res) {
  res.json({ items: await computeLowStock(req.unitId) });
}

// Dipakai endpoint + job reminder harian.
export async function computeLowStock(unitId) {
  const uf = unitFilter(unitId);
  const [rows] = await pool.query(
    `SELECT id, unit_id, name, part_no, stock_qty, min_qty, satuan FROM spareparts
      WHERE active = 1 AND stock_qty <= min_qty AND min_qty > 0${uf.clause} ORDER BY name`,
    uf.params
  );
  return rows;
}
