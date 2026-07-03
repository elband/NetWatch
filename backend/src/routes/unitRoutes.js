import { Router } from 'express';
import multer from 'multer';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { pool } from '../db/pool.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { audit } from '../services/audit.js';
import { isAdminUser } from '../middleware/unitScope.js';
import { PER_UNIT_LKP_FIELDS, getUnitConfig } from '../services/unitConfig.js';

const router = Router();

// Kop/letterhead per unit → simpan di uploads/surat (dibaca DocPrint saat render).
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SURAT_DIR = path.join(__dirname, '..', '..', 'uploads', 'surat');
fs.mkdirSync(SURAT_DIR, { recursive: true });
const kopUpload = multer({
  storage: multer.diskStorage({
    destination: (q, f, cb) => cb(null, SURAT_DIR),
    filename: (q, f, cb) => cb(null, `kop-unit-${q.params.id}-${Date.now()}${path.extname(f.originalname).toLowerCase() || '.png'}`),
  }),
  fileFilter: (q, f, cb) => (/^image\/(jpe?g|png|webp|gif)$/.test(f.mimetype) ? cb(null, true) : cb(new Error('Kop harus gambar (JPG/PNG/WebP/GIF).'))),
  limits: { fileSize: 8 * 1024 * 1024 },
}).single('kop');

// Boleh edit identitas surat unit: super admin (unit mana pun) atau koordinator unitnya sendiri.
function canEditUnit(req, id) {
  if (isAdminUser(req.user)) return true;
  const roles = req.user?.roles || (req.user?.role ? [req.user.role] : []);
  return roles.includes('koordinator') && Number(req.user.unit_id) === Number(id);
}
async function writeUnitConfig(id, config) {
  await pool.query('UPDATE units SET config = ? WHERE id = ?', [JSON.stringify(config), id]);
}

// Daftar unit — dipakai semua role (label unit di header/sidebar, dropdown form).
router.get('/', requireAuth, async (_req, res) => {
  const [rows] = await pool.query('SELECT id, code, name, description, icon, active FROM units ORDER BY id');
  res.json({ units: rows });
});

// Daftar unit aktif untuk form publik /lapor (tanpa auth, data non-sensitif).
router.get('/public', async (_req, res) => {
  const [rows] = await pool.query('SELECT id, code, name, icon FROM units WHERE active = 1 ORDER BY id');
  res.json({ units: rows });
});

// Ringkasan lintas unit untuk dashboard Super Admin (mode "Semua Unit"):
// perangkat up/down, insiden aktif, jumlah personel per unit.
router.get('/summary', requireAuth, requireRole('admin'), async (_req, res) => {
  const [rows] = await pool.query(`
    SELECT un.id, un.code, un.name, un.icon, un.active,
      (SELECT COUNT(*) FROM devices d WHERE d.unit_id = un.id AND d.asset_class = 'network') AS devices_total,
      (SELECT COUNT(*) FROM devices d WHERE d.unit_id = un.id AND d.asset_class = 'network' AND d.status = 'online') AS devices_online,
      (SELECT COUNT(*) FROM devices d WHERE d.unit_id = un.id AND d.asset_class = 'network' AND d.status = 'offline') AS devices_offline,
      (SELECT COUNT(*) FROM devices d WHERE d.unit_id = un.id AND d.asset_class = 'physical') AS assets_total,
      (SELECT COUNT(*) FROM devices d WHERE d.unit_id = un.id AND d.asset_class = 'physical' AND d.op_status IN ('rusak','perbaikan')) AS assets_down,
      (SELECT COUNT(*) FROM incidents i WHERE i.unit_id = un.id AND i.status <> 'selesai') AS incidents_active,
      (SELECT COUNT(*) FROM incidents i WHERE i.unit_id = un.id AND i.status <> 'selesai' AND i.tech_id IS NULL) AS incidents_pool,
      (SELECT COUNT(*) FROM users u WHERE u.unit_id = un.id AND u.active = 1) AS users_total
    FROM units un ORDER BY un.id`);
  res.json({ summary: rows });
});

// CRUD unit — hanya Super Admin.
router.post('/', requireAuth, requireRole('admin'), async (req, res) => {
  const { code, name, description, icon } = req.body;
  if (!code?.trim() || !name?.trim()) return res.status(400).json({ error: 'Kode dan nama unit wajib diisi.' });
  try {
    const [result] = await pool.query(
      'INSERT INTO units (code, name, description, icon) VALUES (?,?,?,?)',
      [code.trim().toUpperCase(), name.trim(), description || null, icon || '🏢']
    );
    await audit(req.user, 'create_unit', 'unit', result.insertId, `Buat unit ${code} (${name})`);
    const [rows] = await pool.query('SELECT * FROM units WHERE id = ?', [result.insertId]);
    res.status(201).json({ unit: rows[0] });
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'Kode unit sudah dipakai.' });
    throw err;
  }
});

router.put('/:id', requireAuth, requireRole('admin'), async (req, res) => {
  const id = Number(req.params.id);
  const [rows] = await pool.query('SELECT * FROM units WHERE id = ?', [id]);
  if (!rows[0]) return res.status(404).json({ error: 'Unit tidak ditemukan.' });
  const u = rows[0];
  const { code, name, description, icon, active } = req.body;
  try {
    await pool.query('UPDATE units SET code=?, name=?, description=?, icon=?, active=? WHERE id=?', [
      (code ?? u.code).trim().toUpperCase(), (name ?? u.name).trim(),
      description === undefined ? u.description : (description || null),
      icon ?? u.icon, active === undefined ? u.active : (active ? 1 : 0), id,
    ]);
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'Kode unit sudah dipakai.' });
    throw err;
  }
  await audit(req.user, 'update_unit', 'unit', id, `Ubah unit ${u.code}`);
  const [updated] = await pool.query('SELECT * FROM units WHERE id = ?', [id]);
  res.json({ unit: updated[0] });
});

// Hapus unit hanya bila kosong (tidak ada user/data tertaut) — cegah data yatim.
router.delete('/:id', requireAuth, requireRole('admin'), async (req, res) => {
  const id = Number(req.params.id);
  const [rows] = await pool.query('SELECT * FROM units WHERE id = ?', [id]);
  if (!rows[0]) return res.status(404).json({ error: 'Unit tidak ditemukan.' });
  const [[{ n }]] = await pool.query('SELECT COUNT(*) n FROM users WHERE unit_id = ?', [id]);
  if (n > 0) return res.status(409).json({ error: `Unit masih punya ${n} user. Pindahkan/nonaktifkan dulu, atau nonaktifkan unit saja.` });
  try {
    await pool.query('DELETE FROM units WHERE id = ?', [id]);
  } catch {
    return res.status(409).json({ error: 'Unit masih tertaut data operasional. Nonaktifkan saja.' });
  }
  await audit(req.user, 'delete_unit', 'unit', id, `Hapus unit ${rows[0].code}`);
  res.json({ ok: true });
});

// ── Fase 4: identitas surat per unit (config JSON) ──
// Baca config unit (untuk editor). Koordinator: unitnya; super admin: mana pun.
router.get('/:id/config', requireAuth, async (req, res) => {
  const id = Number(req.params.id);
  if (!canEditUnit(req, id)) return res.status(403).json({ error: 'Tidak berhak mengubah identitas surat unit ini.' });
  res.json({ config: await getUnitConfig(id), fields: PER_UNIT_LKP_FIELDS });
});

// Simpan override identitas surat (hanya field per-unit yang diizinkan).
router.put('/:id/config', requireAuth, async (req, res) => {
  const id = Number(req.params.id);
  if (!canEditUnit(req, id)) return res.status(403).json({ error: 'Tidak berhak mengubah identitas surat unit ini.' });
  const [[u]] = await pool.query('SELECT id FROM units WHERE id = ?', [id]);
  if (!u) return res.status(404).json({ error: 'Unit tidak ditemukan.' });
  const cur = await getUnitConfig(id);
  for (const k of PER_UNIT_LKP_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(req.body || {}, k)) {
      const v = req.body[k];
      if (v === '' || v == null) delete cur[k]; else cur[k] = String(v).slice(0, 255);
    }
  }
  await writeUnitConfig(id, cur);
  await audit(req.user, 'update_unit_config', 'unit', id, 'Ubah identitas surat unit');
  res.json({ config: cur });
});

// Unggah kop/letterhead unit → config.kop_url.
router.post('/:id/kop', requireAuth, (req, res) => {
  const id = Number(req.params.id);
  if (!canEditUnit(req, id)) return res.status(403).json({ error: 'Tidak berhak.' });
  kopUpload(req, res, async (err) => {
    if (err) return res.status(400).json({ error: err.message });
    if (!req.file) return res.status(400).json({ error: 'File gambar kop wajib diunggah.' });
    const cur = await getUnitConfig(id);
    // Hapus kop lama milik unit ini bila ada.
    if (cur.kop_url && cur.kop_url.startsWith('/uploads/surat/')) {
      try { fs.unlinkSync(path.join(SURAT_DIR, path.basename(cur.kop_url))); } catch { /* abaikan */ }
    }
    cur.kop_url = `/uploads/surat/${req.file.filename}`;
    await writeUnitConfig(id, cur);
    res.json({ ok: true, kop_url: cur.kop_url, config: cur });
  });
});

export default router;
