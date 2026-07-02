import { Router } from 'express';
import multer from 'multer';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { pool } from '../db/pool.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { unitScope, unitFilter, unitFilterShared, rowInUnit, insertUnitId } from '../middleware/unitScope.js';
import { computeServices } from '../services/servicesStatus.js';

const router = Router();
router.use(requireAuth, unitScope);

// Upload gambar peta lokasi (disimpan di uploads/maps, URL di settings).
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MAP_DIR = path.join(__dirname, '..', '..', 'uploads', 'maps');
fs.mkdirSync(MAP_DIR, { recursive: true });
const mapUpload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, MAP_DIR),
    filename: (req, file, cb) => cb(null, `map-${Date.now()}${path.extname(file.originalname).toLowerCase() || '.png'}`),
  }),
  fileFilter: (req, file, cb) => (/^image\//.test(file.mimetype) ? cb(null, true) : cb(new Error('Harus gambar.'))),
  limits: { fileSize: 8 * 1024 * 1024 },
}).single('map');

async function getMapUrl() {
  const [r] = await pool.query("SELECT setting_value FROM settings WHERE setting_key = 'location_map_url'");
  if (!r[0]) return null;
  try { const v = typeof r[0].setting_value === 'string' ? JSON.parse(r[0].setting_value) : r[0].setting_value; return v?.url || null; } catch { return null; }
}

// ===================== ASSETS / INVENTARIS =====================
// Aset milik user yang login (untuk dashboard teknisi).
router.get('/assets/mine', async (req, res) => {
  const [rows] = await pool.query(
    'SELECT * FROM assets WHERE holder_user_id = ? ORDER BY name', [req.user.id]
  );
  res.json({ assets: rows });
});

// Semua aset (admin/koordinator), opsional ?holder=ID
router.get('/assets', requireRole('admin', 'koordinator'), async (req, res) => {
  const { holder } = req.query;
  const uf = unitFilter(req.unitId, 'a.unit_id');
  let sql = `SELECT a.*, u.name AS holder_name FROM assets a LEFT JOIN users u ON u.id = a.holder_user_id WHERE 1=1${uf.clause}`;
  const params = [...uf.params];
  if (holder) { sql += ' AND a.holder_user_id = ?'; params.push(Number(holder)); }
  sql += ' ORDER BY a.name';
  const [rows] = await pool.query(sql, params);
  res.json({ assets: rows });
});

router.post('/assets', requireRole('admin'), async (req, res) => {
  const { name, code, category, qty, unit, icon, holderUserId, status, notes } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: 'Nama aset wajib diisi' });
  const unitId = insertUnitId(req);
  if (unitId == null) return res.status(400).json({ error: 'Pilih unit terlebih dahulu.' });
  const [r] = await pool.query(
    `INSERT INTO assets (unit_id, name, code, category, qty, unit, icon, holder_user_id, status, notes)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [unitId, name.trim(), code || null, category || null, qty || 1, unit || 'Unit', icon || '📦', holderUserId || null, status || 'baik', notes || null]
  );
  res.status(201).json({ id: r.insertId });
});

router.put('/assets/:id', requireRole('admin'), async (req, res) => {
  const { name, code, category, qty, unit, icon, holderUserId, status, notes } = req.body;
  const uf = unitFilter(req.unitId);
  await pool.query(
    `UPDATE assets SET name=COALESCE(?,name), code=?, category=?, qty=COALESCE(?,qty), unit=COALESCE(?,unit),
       icon=COALESCE(?,icon), holder_user_id=?, status=COALESCE(?,status), notes=? WHERE id=?${uf.clause}`,
    [name || null, code || null, category || null, qty || null, unit || null, icon || null, holderUserId || null, status || null, notes || null, req.params.id, ...uf.params]
  );
  res.json({ ok: true });
});

router.delete('/assets/:id', requireRole('admin'), async (req, res) => {
  const uf = unitFilter(req.unitId);
  await pool.query(`DELETE FROM assets WHERE id = ?${uf.clause}`, [req.params.id, ...uf.params]);
  res.json({ ok: true });
});

// ===================== SERVICES / LAYANAN KRITIS =====================
router.get('/services', async (req, res) => {
  // computeServices() global; saring kartu layanan tersimpan sesuai unit request.
  const services = (await computeServices()).filter((s) => rowInUnit(s, req.unitId));
  res.json({ services });
});

router.post('/services', requireRole('admin'), async (req, res) => {
  const { name, icon, status, isOk, detail, sortOrder } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: 'Nama layanan wajib diisi' });
  const unitId = insertUnitId(req);
  if (unitId == null) return res.status(400).json({ error: 'Pilih unit terlebih dahulu.' });
  const [r] = await pool.query(
    'INSERT INTO services (unit_id, name, icon, status, is_ok, detail, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?)',
    [unitId, name.trim(), icon || '🟢', status || 'Online', isOk ? 1 : 0, detail || null, sortOrder || 0]
  );
  res.status(201).json({ id: r.insertId });
});

router.put('/services/:id', requireRole('admin'), async (req, res) => {
  const { name, icon, status, isOk, detail, sortOrder } = req.body;
  const uf = unitFilter(req.unitId);
  await pool.query(
    `UPDATE services SET name=COALESCE(?,name), icon=COALESCE(?,icon), status=COALESCE(?,status),
       is_ok=?, detail=?, sort_order=COALESCE(?,sort_order) WHERE id=?${uf.clause}`,
    [name || null, icon || null, status || null, isOk ? 1 : 0, detail || null, sortOrder ?? null, req.params.id, ...uf.params]
  );
  res.json({ ok: true });
});

router.delete('/services/:id', requireRole('admin'), async (req, res) => {
  const uf = unitFilter(req.unitId);
  await pool.query(`DELETE FROM services WHERE id = ?${uf.clause}`, [req.params.id, ...uf.params]);
  res.json({ ok: true });
});

// ===================== LOCATIONS / PETA GANGGUAN =====================
// Termasuk jumlah insiden aktif per lokasi.
router.get('/locations', async (req, res) => {
  const uf = unitFilterShared(req.unitId, 'l.unit_id'); // NULL = lokasi milik bersama
  const ufi = unitFilter(req.unitId, 'i.unit_id');
  const [rows] = await pool.query(
    `SELECT l.*, (SELECT COUNT(*) FROM incidents i WHERE i.location_id = l.id AND i.status != 'selesai'${ufi.clause}) AS active_count
       FROM locations l WHERE 1=1${uf.clause} ORDER BY l.sort_order, l.id`,
    [...ufi.params, ...uf.params]
  );
  res.json({ locations: rows, mapUrl: await getMapUrl() });
});

// Unggah gambar peta (admin).
router.post('/locations/map', requireRole('admin'), (req, res) => {
  mapUpload(req, res, async (err) => {
    if (err) return res.status(400).json({ error: err.message });
    if (!req.file) return res.status(400).json({ error: 'File gambar peta wajib diunggah.' });
    const url = `/uploads/maps/${req.file.filename}`;
    await pool.query(
      `INSERT INTO settings (setting_key, setting_value) VALUES ('location_map_url', ?)
       ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value)`,
      [JSON.stringify({ url })]
    );
    res.json({ mapUrl: url });
  });
});

router.post('/locations', requireRole('admin'), async (req, res) => {
  const { name, icon, sortOrder } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: 'Nama lokasi wajib diisi' });
  // Master bersama: NULL = global, hanya terjadi saat admin mode "Semua Unit".
  const unitId = insertUnitId(req);
  const [r] = await pool.query(
    'INSERT INTO locations (unit_id, name, icon, sort_order) VALUES (?, ?, ?, ?)',
    [unitId, name.trim(), icon || '📍', sortOrder || 0]
  );
  res.status(201).json({ id: r.insertId });
});

router.put('/locations/:id', requireRole('admin'), async (req, res) => {
  const { name, icon, sortOrder } = req.body;
  const uf = unitFilterShared(req.unitId);
  await pool.query(
    `UPDATE locations SET name=COALESCE(?,name), icon=COALESCE(?,icon), sort_order=COALESCE(?,sort_order) WHERE id=?${uf.clause}`,
    [name || null, icon || null, sortOrder ?? null, req.params.id, ...uf.params]
  );
  res.json({ ok: true });
});

// Set / hapus posisi titik lokasi pada peta (admin).
// Peta live: kirim lat/lng (null = hapus). Legacy gambar: kirim mapX/mapY persen 0–100.
router.put('/locations/:id/marker', requireRole('admin'), async (req, res) => {
  const { mapX, mapY, lat, lng } = req.body;
  const uf = unitFilterShared(req.unitId);
  if (lat !== undefined || lng !== undefined) {
    const la = lat == null ? null : Number(lat);
    const ln = lng == null ? null : Number(lng);
    await pool.query(`UPDATE locations SET lat=?, lng=? WHERE id=?${uf.clause}`, [la, ln, req.params.id, ...uf.params]);
    return res.json({ ok: true });
  }
  const x = mapX == null ? null : Math.max(0, Math.min(100, Number(mapX)));
  const y = mapY == null ? null : Math.max(0, Math.min(100, Number(mapY)));
  await pool.query(`UPDATE locations SET map_x=?, map_y=? WHERE id=?${uf.clause}`, [x, y, req.params.id, ...uf.params]);
  res.json({ ok: true });
});

router.delete('/locations/:id', requireRole('admin'), async (req, res) => {
  const uf = unitFilterShared(req.unitId);
  await pool.query(`DELETE FROM locations WHERE id = ?${uf.clause}`, [req.params.id, ...uf.params]);
  res.json({ ok: true });
});

// ===================== DEVICE TYPES / TIPE PERANGKAT =====================
// Dipakai sebagai sumber dropdown "Tipe" pada form perangkat (variabel terhubung).
router.get('/device-types', async (req, res) => {
  const uf = unitFilterShared(req.unitId); // NULL = tipe milik bersama
  const [rows] = await pool.query(`SELECT * FROM device_types WHERE 1=1${uf.clause} ORDER BY sort_order, name`, uf.params);
  res.json({ deviceTypes: rows });
});

router.post('/device-types', requireRole('admin'), async (req, res) => {
  const { name, icon, sortOrder } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: 'Nama tipe wajib diisi' });
  // Master bersama: NULL = global, hanya terjadi saat admin mode "Semua Unit".
  const unitId = insertUnitId(req);
  try {
    const [r] = await pool.query(
      'INSERT INTO device_types (unit_id, name, icon, sort_order) VALUES (?, ?, ?, ?)',
      [unitId, name.trim(), icon || null, sortOrder || 0]
    );
    res.status(201).json({ id: r.insertId });
  } catch (e) {
    if (e.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'Tipe dengan nama itu sudah ada.' });
    res.status(500).json({ error: 'Gagal menyimpan tipe.' });
  }
});

router.put('/device-types/:id', requireRole('admin'), async (req, res) => {
  const { name, icon, sortOrder } = req.body;
  const uf = unitFilterShared(req.unitId);
  try {
    // Bila nama diubah, sinkronkan perangkat yang masih memakai nama lama.
    if (name?.trim()) {
      const [[old]] = await pool.query('SELECT name, unit_id FROM device_types WHERE id = ?', [req.params.id]);
      if (old && !rowInUnit(old, req.unitId)) return res.status(404).json({ error: 'Tipe tidak ditemukan' });
      if (old && old.name !== name.trim()) {
        await pool.query('UPDATE devices SET type = ? WHERE type = ?', [name.trim(), old.name]);
      }
    }
    await pool.query(
      `UPDATE device_types SET name=COALESCE(?,name), icon=?, sort_order=COALESCE(?,sort_order) WHERE id=?${uf.clause}`,
      [name?.trim() || null, icon || null, sortOrder ?? null, req.params.id, ...uf.params]
    );
    res.json({ ok: true });
  } catch (e) {
    if (e.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'Tipe dengan nama itu sudah ada.' });
    res.status(500).json({ error: 'Gagal memperbarui tipe.' });
  }
});

router.delete('/device-types/:id', requireRole('admin'), async (req, res) => {
  const [[t]] = await pool.query('SELECT name, unit_id FROM device_types WHERE id = ?', [req.params.id]);
  if (t && !rowInUnit(t, req.unitId)) return res.status(404).json({ error: 'Tipe tidak ditemukan' });
  if (t) {
    // Cek pemakaian di SEMUA unit — tipe bersama tak boleh hilang selagi dipakai unit lain.
    const [[c]] = await pool.query('SELECT COUNT(*) AS n FROM devices WHERE type = ?', [t.name]);
    if (c.n > 0) return res.status(409).json({ error: `Tipe "${t.name}" masih dipakai ${c.n} perangkat. Ubah perangkat itu dulu.` });
  }
  await pool.query('DELETE FROM device_types WHERE id = ?', [req.params.id]);
  res.json({ ok: true });
});

export default router;
