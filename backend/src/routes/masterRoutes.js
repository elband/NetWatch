import { Router } from 'express';
import multer from 'multer';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { pool } from '../db/pool.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { computeServices } from '../services/servicesStatus.js';

const router = Router();
router.use(requireAuth);

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
  let sql = `SELECT a.*, u.name AS holder_name FROM assets a LEFT JOIN users u ON u.id = a.holder_user_id WHERE 1=1`;
  const params = [];
  if (holder) { sql += ' AND a.holder_user_id = ?'; params.push(Number(holder)); }
  sql += ' ORDER BY a.name';
  const [rows] = await pool.query(sql, params);
  res.json({ assets: rows });
});

router.post('/assets', requireRole('admin'), async (req, res) => {
  const { name, code, category, qty, unit, icon, holderUserId, status, notes } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: 'Nama aset wajib diisi' });
  const [r] = await pool.query(
    `INSERT INTO assets (name, code, category, qty, unit, icon, holder_user_id, status, notes)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [name.trim(), code || null, category || null, qty || 1, unit || 'Unit', icon || '📦', holderUserId || null, status || 'baik', notes || null]
  );
  res.status(201).json({ id: r.insertId });
});

router.put('/assets/:id', requireRole('admin'), async (req, res) => {
  const { name, code, category, qty, unit, icon, holderUserId, status, notes } = req.body;
  await pool.query(
    `UPDATE assets SET name=COALESCE(?,name), code=?, category=?, qty=COALESCE(?,qty), unit=COALESCE(?,unit),
       icon=COALESCE(?,icon), holder_user_id=?, status=COALESCE(?,status), notes=? WHERE id=?`,
    [name || null, code || null, category || null, qty || null, unit || null, icon || null, holderUserId || null, status || null, notes || null, req.params.id]
  );
  res.json({ ok: true });
});

router.delete('/assets/:id', requireRole('admin'), async (req, res) => {
  await pool.query('DELETE FROM assets WHERE id = ?', [req.params.id]);
  res.json({ ok: true });
});

// ===================== SERVICES / LAYANAN KRITIS =====================
router.get('/services', async (req, res) => {
  res.json({ services: await computeServices() });
});

router.post('/services', requireRole('admin'), async (req, res) => {
  const { name, icon, status, isOk, detail, sortOrder } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: 'Nama layanan wajib diisi' });
  const [r] = await pool.query(
    'INSERT INTO services (name, icon, status, is_ok, detail, sort_order) VALUES (?, ?, ?, ?, ?, ?)',
    [name.trim(), icon || '🟢', status || 'Online', isOk ? 1 : 0, detail || null, sortOrder || 0]
  );
  res.status(201).json({ id: r.insertId });
});

router.put('/services/:id', requireRole('admin'), async (req, res) => {
  const { name, icon, status, isOk, detail, sortOrder } = req.body;
  await pool.query(
    `UPDATE services SET name=COALESCE(?,name), icon=COALESCE(?,icon), status=COALESCE(?,status),
       is_ok=?, detail=?, sort_order=COALESCE(?,sort_order) WHERE id=?`,
    [name || null, icon || null, status || null, isOk ? 1 : 0, detail || null, sortOrder ?? null, req.params.id]
  );
  res.json({ ok: true });
});

router.delete('/services/:id', requireRole('admin'), async (req, res) => {
  await pool.query('DELETE FROM services WHERE id = ?', [req.params.id]);
  res.json({ ok: true });
});

// ===================== LOCATIONS / PETA GANGGUAN =====================
// Termasuk jumlah insiden aktif per lokasi.
router.get('/locations', async (req, res) => {
  const [rows] = await pool.query(
    `SELECT l.*, (SELECT COUNT(*) FROM incidents i WHERE i.location_id = l.id AND i.status != 'selesai') AS active_count
       FROM locations l ORDER BY l.sort_order, l.id`
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
  const [r] = await pool.query(
    'INSERT INTO locations (name, icon, sort_order) VALUES (?, ?, ?)',
    [name.trim(), icon || '📍', sortOrder || 0]
  );
  res.status(201).json({ id: r.insertId });
});

router.put('/locations/:id', requireRole('admin'), async (req, res) => {
  const { name, icon, sortOrder } = req.body;
  await pool.query(
    'UPDATE locations SET name=COALESCE(?,name), icon=COALESCE(?,icon), sort_order=COALESCE(?,sort_order) WHERE id=?',
    [name || null, icon || null, sortOrder ?? null, req.params.id]
  );
  res.json({ ok: true });
});

// Set / hapus posisi titik lokasi pada peta (admin). mapX/mapY = persen 0–100, null = hapus.
router.put('/locations/:id/marker', requireRole('admin'), async (req, res) => {
  const { mapX, mapY } = req.body;
  const x = mapX == null ? null : Math.max(0, Math.min(100, Number(mapX)));
  const y = mapY == null ? null : Math.max(0, Math.min(100, Number(mapY)));
  await pool.query('UPDATE locations SET map_x=?, map_y=? WHERE id=?', [x, y, req.params.id]);
  res.json({ ok: true });
});

router.delete('/locations/:id', requireRole('admin'), async (req, res) => {
  await pool.query('DELETE FROM locations WHERE id = ?', [req.params.id]);
  res.json({ ok: true });
});

export default router;
