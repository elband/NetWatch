import { pool } from '../db/pool.js';
import { unitFilter, rowInUnit, insertUnitId } from '../middleware/unitScope.js';

// Fase 4: sparepart & stok per unit. Stok = kolom stock_qty, diperbarui transaksional
// bersama pencatatan sparepart_moves (masuk/keluar/adjust).

export async function listSpareparts(req, res) {
  const uf = unitFilter(req.unitId, 's.unit_id');
  const [rows] = await pool.query(
    `SELECT s.*, (s.stock_qty <= s.min_qty) AS low, c.name AS category_name
       FROM spareparts s LEFT JOIN sparepart_categories c ON c.id = s.category_id
      WHERE s.active = 1${uf.clause} ORDER BY s.name`,
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
  const { name, part_no, sku, category, category_id, satuan, stock_qty, min_qty, location, notes } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: 'Nama sparepart wajib diisi.' });
  const unitId = insertUnitId(req);
  if (unitId == null) return res.status(400).json({ error: 'Pilih unit terlebih dahulu.' });
  const catId = category_id ? Number(category_id) : null;
  const [r] = await pool.query(
    `INSERT INTO spareparts (unit_id, name, part_no, category, category_id, satuan, stock_qty, min_qty, location, notes)
     VALUES (?,?,?,?,?,?,?,?,?,?)`,
    [unitId, name.trim(), part_no?.trim() || null, category?.trim() || null, catId, satuan?.trim() || 'pcs',
     Number(stock_qty) || 0, Number(min_qty) || 0, location?.trim() || null, notes?.trim() || null]
  );
  // SKU untuk QR/barcode: pakai input bila diisi (unik), else auto SP000123 dari id.
  const finalSku = sku?.trim() || `SP${String(r.insertId).padStart(6, '0')}`;
  await pool.query('UPDATE spareparts SET sku = ? WHERE id = ?', [finalSku, r.insertId]);
  res.status(201).json({ id: r.insertId, sku: finalSku });
}

export async function updateSparepart(req, res) {
  const id = Number(req.params.id);
  const [[sp]] = await pool.query('SELECT * FROM spareparts WHERE id = ?', [id]);
  if (!sp || !rowInUnit(sp, req.unitId)) return res.status(404).json({ error: 'Sparepart tidak ditemukan' });
  const { name, part_no, category, category_id, satuan, min_qty, location, notes, active } = req.body;
  // stock_qty TIDAK diubah di sini — hanya lewat /move agar kartu stok akurat.
  await pool.query(
    `UPDATE spareparts SET name=COALESCE(?,name), part_no=?, category=?, category_id=?, satuan=COALESCE(?,satuan),
       min_qty=COALESCE(?,min_qty), location=?, notes=?, active=? WHERE id=?`,
    [name?.trim() || null, part_no?.trim() || null, category?.trim() || null,
     category_id ? Number(category_id) : null, satuan?.trim() || null,
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

// ── Scan QR/barcode → resolve item dari kode (sku, atau fallback part_no) ──
export async function lookupSparepart(req, res) {
  const code = String(req.query.code || '').trim();
  if (!code) return res.status(400).json({ error: 'Kode kosong.' });
  const uf = unitFilter(req.unitId);
  const [rows] = await pool.query(
    `SELECT s.*, c.name AS category_name FROM spareparts s
       LEFT JOIN sparepart_categories c ON c.id = s.category_id
      WHERE s.active = 1 AND (s.sku = ? OR s.part_no = ?)${uf.clause} LIMIT 1`,
    [code, code, ...uf.params]
  );
  if (!rows.length) return res.status(404).json({ error: `Barang dengan kode "${code}" tidak ditemukan.` });
  res.json({ sparepart: rows[0] });
}

// ── Statistik dashboard inventaris (per unit) ──
export async function stats(req, res) {
  const uf = unitFilter(req.unitId);
  const [[agg]] = await pool.query(
    `SELECT COUNT(*) AS total_items,
            COALESCE(SUM(stock_qty), 0) AS total_stock,
            SUM(CASE WHEN min_qty > 0 AND stock_qty <= min_qty THEN 1 ELSE 0 END) AS low_count,
            SUM(CASE WHEN stock_qty <= 0 THEN 1 ELSE 0 END) AS out_count
       FROM spareparts WHERE active = 1${uf.clause}`,
    uf.params
  );
  const ufm = unitFilter(req.unitId);
  const [[mv]] = await pool.query(
    `SELECT SUM(CASE WHEN type='masuk' THEN 1 ELSE 0 END) AS masuk,
            SUM(CASE WHEN type='keluar' THEN 1 ELSE 0 END) AS keluar
       FROM sparepart_moves
      WHERE YEAR(moved_at)=YEAR(CURDATE()) AND MONTH(moved_at)=MONTH(CURDATE())${ufm.clause}`,
    ufm.params
  );
  const ufc = unitFilter(req.unitId, 's.unit_id');
  const [byCat] = await pool.query(
    `SELECT COALESCE(c.name, s.category, '(Tanpa kategori)') AS category, COUNT(*) AS items,
            COALESCE(SUM(s.stock_qty),0) AS stock
       FROM spareparts s LEFT JOIN sparepart_categories c ON c.id = s.category_id
      WHERE s.active = 1${ufc.clause}
      GROUP BY COALESCE(c.name, s.category, '(Tanpa kategori)') ORDER BY items DESC`,
    ufc.params
  );
  res.json({
    total_items: Number(agg.total_items) || 0,
    total_stock: Number(agg.total_stock) || 0,
    low_count: Number(agg.low_count) || 0,
    out_count: Number(agg.out_count) || 0,
    moves_month: { masuk: Number(mv?.masuk) || 0, keluar: Number(mv?.keluar) || 0 },
    by_category: byCat,
    low_items: await computeLowStock(req.unitId),
  });
}

// ── Master kategori barang/sparepart (per unit) ──
export async function listCategories(req, res) {
  const uf = unitFilter(req.unitId);
  const [rows] = await pool.query(
    `SELECT c.*, (SELECT COUNT(*) FROM spareparts s WHERE s.category_id = c.id) AS items
       FROM sparepart_categories c WHERE 1=1${uf.clause} ORDER BY c.name`,
    uf.params
  );
  res.json({ categories: rows });
}

export async function createCategory(req, res) {
  const name = String(req.body.name || '').trim();
  if (!name) return res.status(400).json({ error: 'Nama kategori wajib diisi.' });
  const unitId = insertUnitId(req);
  if (unitId == null) return res.status(400).json({ error: 'Pilih unit terlebih dahulu.' });
  try {
    const [r] = await pool.query('INSERT INTO sparepart_categories (unit_id, name) VALUES (?,?)', [unitId, name]);
    res.status(201).json({ id: r.insertId, name });
  } catch (e) {
    if (e.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'Kategori ini sudah ada.' });
    throw e;
  }
}

export async function deleteCategory(req, res) {
  const id = Number(req.params.id);
  const [[c]] = await pool.query('SELECT id, unit_id FROM sparepart_categories WHERE id = ?', [id]);
  if (!c || !rowInUnit(c, req.unitId)) return res.status(404).json({ error: 'Kategori tidak ditemukan' });
  await pool.query('UPDATE spareparts SET category_id = NULL WHERE category_id = ?', [id]);
  await pool.query('DELETE FROM sparepart_categories WHERE id = ?', [id]);
  res.json({ ok: true });
}

// ── Data laporan (dipakai JSON utk halaman cetak-PDF & sebagai sumber Excel) ──
async function buildReport(unitId, from, to) {
  const uf = unitFilter(unitId, 's.unit_id');
  const [items] = await pool.query(
    `SELECT s.name, s.sku, s.part_no, COALESCE(c.name, s.category, '') AS category,
            s.satuan, s.stock_qty, s.min_qty, s.location,
            (s.min_qty > 0 AND s.stock_qty <= s.min_qty) AS low
       FROM spareparts s LEFT JOIN sparepart_categories c ON c.id = s.category_id
      WHERE s.active = 1${uf.clause} ORDER BY category, s.name`,
    uf.params
  );
  const ufm = unitFilter(unitId, 'm.unit_id');
  const params = [];
  let dateClause = '';
  if (from) { dateClause += ' AND m.moved_at >= ?'; params.push(`${from} 00:00:00`); }
  if (to) { dateClause += ' AND m.moved_at <= ?'; params.push(`${to} 23:59:59`); }
  const [moves] = await pool.query(
    `SELECT m.moved_at, m.type, m.qty, m.note, s.name AS sparepart_name, s.sku, s.satuan,
            u.name AS moved_by_name, d.name AS device_name
       FROM sparepart_moves m
       JOIN spareparts s ON s.id = m.sparepart_id
       LEFT JOIN users u ON u.id = m.moved_by
       LEFT JOIN devices d ON d.id = m.device_id
      WHERE 1=1${ufm.clause}${dateClause} ORDER BY m.moved_at DESC LIMIT 2000`,
    [...ufm.params, ...params]
  );
  return { items, moves, from: from || null, to: to || null };
}

export async function reportJson(req, res) {
  res.json(await buildReport(req.unitId, req.query.from, req.query.to));
}

export async function reportXlsx(req, res) {
  const { default: ExcelJS } = await import('exceljs');
  const { items, moves, from, to } = await buildReport(req.unitId, req.query.from, req.query.to);
  const wb = new ExcelJS.Workbook();
  const ws1 = wb.addWorksheet('Stok');
  ws1.addRow(['Nama', 'SKU', 'Part No', 'Kategori', 'Stok', 'Min', 'Satuan', 'Lokasi', 'Status']);
  for (const s of items) {
    ws1.addRow([s.name, s.sku || '', s.part_no || '', s.category || '', Number(s.stock_qty),
      Number(s.min_qty), s.satuan, s.location || '', Number(s.low) ? 'MENIPIS' : 'Aman']);
  }
  [26, 14, 14, 18, 8, 8, 8, 18, 10].forEach((w, i) => { ws1.getColumn(i + 1).width = w; });
  const ws2 = wb.addWorksheet('Mutasi');
  ws2.addRow(['Waktu', 'Jenis', 'Barang', 'SKU', 'Jumlah', 'Satuan', 'Perangkat', 'Catatan', 'Oleh']);
  for (const m of moves) {
    ws2.addRow([new Date(m.moved_at).toLocaleString('id-ID'), m.type, m.sparepart_name, m.sku || '',
      Number(m.qty), m.satuan, m.device_name || '', m.note || '', m.moved_by_name || '']);
  }
  [20, 10, 26, 14, 8, 8, 18, 24, 18].forEach((w, i) => { ws2.getColumn(i + 1).width = w; });
  const buf = Buffer.from(await wb.xlsx.writeBuffer());
  const period = from || to ? `-${from || '...'}_${to || '...'}` : '';
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="suku-cadang${period}.xlsx"`);
  res.send(buf);
}
