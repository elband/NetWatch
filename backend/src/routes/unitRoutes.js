import { Router } from 'express';
import { pool } from '../db/pool.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { audit } from '../services/audit.js';

const router = Router();

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
      (SELECT COUNT(*) FROM devices d WHERE d.unit_id = un.id) AS devices_total,
      (SELECT COUNT(*) FROM devices d WHERE d.unit_id = un.id AND d.status = 'online') AS devices_online,
      (SELECT COUNT(*) FROM devices d WHERE d.unit_id = un.id AND d.status = 'offline') AS devices_offline,
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

export default router;
