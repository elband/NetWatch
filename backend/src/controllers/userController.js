import bcrypt from 'bcryptjs';
import { pool } from '../db/pool.js';
import { toPublicUser } from './authController.js';

const EMOJI_MAP = { admin: '👑', koordinator: '👨‍💼', teknisi: '🔧', viewer: '👁️' };
const VALID_ROLES = ['admin', 'koordinator', 'teknisi', 'viewer'];

// Normalisasi daftar peran: terima `roles` (array) atau `role` (string), buang
// yang tak valid, urutkan berdasar prioritas, pastikan minimal 1.
function normalizeRoles(roles, role) {
  let list = Array.isArray(roles) ? roles : role ? [role] : [];
  list = [...new Set(list.filter((r) => VALID_ROLES.includes(r)))];
  list.sort((a, b) => VALID_ROLES.indexOf(a) - VALID_ROLES.indexOf(b));
  return list;
}

// PIN harus 4–6 digit & unik antar user (karena login hanya pakai PIN).
async function validatePin(pin, exceptId = null) {
  if (!/^\d{4,6}$/.test(pin)) return { error: 'PIN harus 4–6 digit angka.' };
  const [rows] = await pool.query('SELECT id, pin_hash FROM users WHERE pin_hash IS NOT NULL');
  for (const u of rows) {
    if (exceptId && u.id === exceptId) continue;
    if (await bcrypt.compare(pin, u.pin_hash)) return { error: 'PIN sudah dipakai user lain. Gunakan PIN berbeda.' };
  }
  return { hash: await bcrypt.hash(pin, 10) };
}

function withHasPin(u) {
  return { ...toPublicUser(u), has_pin: !!u.pin_hash };
}

export async function listUsers(req, res) {
  const [rows] = await pool.query('SELECT * FROM users ORDER BY id');
  res.json({ users: rows.map(withHasPin) });
}

export async function createUser(req, res) {
  const { name, username, email, password, pin, phone, role, roles, jabatan, perms } = req.body;
  const roleList = normalizeRoles(roles, role);
  if (!name || !username || !email || roleList.length === 0) {
    return res.status(400).json({ error: 'Nama, username, email, dan minimal 1 peran wajib diisi' });
  }
  // PIN wajib saat membuat user (login hanya pakai PIN).
  if (!pin) return res.status(400).json({ error: 'PIN wajib diisi (4–6 digit) — dipakai untuk login.' });
  const pinRes = await validatePin(String(pin).trim());
  if (pinRes.error) return res.status(400).json({ error: pinRes.error });

  const primary = roleList[0];
  const hash = await bcrypt.hash(password || 'pass123', 10);
  const emoji = EMOJI_MAP[primary] || '👤';
  try {
    const [result] = await pool.query(
      `INSERT INTO users (name, username, email, password_hash, pin_hash, phone, role, roles, jabatan, emoji, active, perms)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)`,
      [name, username, email, hash, pinRes.hash, phone || null, primary, JSON.stringify(roleList), jabatan || null, emoji, JSON.stringify(perms || [])]
    );
    const [rows] = await pool.query('SELECT * FROM users WHERE id = ?', [result.insertId]);
    res.status(201).json({ user: withHasPin(rows[0]) });
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'Username atau email sudah dipakai' });
    throw err;
  }
}

export async function updateUser(req, res) {
  const id = Number(req.params.id);
  const { name, username, email, password, pin, phone, role, roles, jabatan, perms, active } = req.body;
  const [existingRows] = await pool.query('SELECT * FROM users WHERE id = ?', [id]);
  if (!existingRows[0]) return res.status(404).json({ error: 'User tidak ditemukan' });

  // Ubah PIN bila diisi (kosong = PIN tidak diubah).
  if (pin) {
    const pinRes = await validatePin(String(pin).trim(), id);
    if (pinRes.error) return res.status(400).json({ error: pinRes.error });
    await pool.query('UPDATE users SET pin_hash = ? WHERE id = ?', [pinRes.hash, id]);
  }

  // Peran: hanya diubah bila roles/role dikirim; minimal 1.
  let roleList = null;
  if (roles !== undefined || role !== undefined) {
    roleList = normalizeRoles(roles, role);
    if (roleList.length === 0) return res.status(400).json({ error: 'Minimal 1 peran harus dipilih.' });
  }
  const primary = roleList ? roleList[0] : existingRows[0].role;
  const rolesJson = roleList ? JSON.stringify(roleList) : (existingRows[0].roles ? (typeof existingRows[0].roles === 'string' ? existingRows[0].roles : JSON.stringify(existingRows[0].roles)) : JSON.stringify([primary]));
  const emoji = roleList ? (EMOJI_MAP[primary] || existingRows[0].emoji) : existingRows[0].emoji;

  const fields = {
    name: name ?? existingRows[0].name,
    username: username ?? existingRows[0].username,
    email: email ?? existingRows[0].email,
    phone: phone ?? existingRows[0].phone,
    role: primary,
    rolesJson,
    jabatan: jabatan ?? existingRows[0].jabatan,
    emoji,
    active: active === undefined ? existingRows[0].active : active ? 1 : 0,
    perms: JSON.stringify(perms ?? (typeof existingRows[0].perms === 'string' ? JSON.parse(existingRows[0].perms) : existingRows[0].perms)),
  };

  if (password) {
    fields.password_hash = await bcrypt.hash(password, 10);
    await pool.query(
      `UPDATE users SET name=?, username=?, email=?, phone=?, role=?, roles=?, jabatan=?, emoji=?, active=?, perms=?, password_hash=? WHERE id=?`,
      [fields.name, fields.username, fields.email, fields.phone, fields.role, fields.rolesJson, fields.jabatan, fields.emoji, fields.active, fields.perms, fields.password_hash, id]
    );
  } else {
    await pool.query(
      `UPDATE users SET name=?, username=?, email=?, phone=?, role=?, roles=?, jabatan=?, emoji=?, active=?, perms=? WHERE id=?`,
      [fields.name, fields.username, fields.email, fields.phone, fields.role, fields.rolesJson, fields.jabatan, fields.emoji, fields.active, fields.perms, id]
    );
  }

  const [rows] = await pool.query('SELECT * FROM users WHERE id = ?', [id]);
  res.json({ user: withHasPin(rows[0]) });
}

export async function deleteUser(req, res) {
  const id = Number(req.params.id);
  if (id === req.user.id) return res.status(400).json({ error: 'Tidak dapat menghapus akun Anda sendiri.' });
  const [rows] = await pool.query('SELECT id, name FROM users WHERE id = ?', [id]);
  if (!rows[0]) return res.status(404).json({ error: 'User tidak ditemukan' });
  try {
    await pool.query('DELETE FROM users WHERE id = ?', [id]);
  } catch {
    return res.status(409).json({ error: 'Akun tidak bisa dihapus karena masih tertaut data. Nonaktifkan saja.' });
  }
  res.json({ ok: true });
}

export async function toggleUserActive(req, res) {
  const id = Number(req.params.id);
  const [rows] = await pool.query('SELECT * FROM users WHERE id = ?', [id]);
  if (!rows[0]) return res.status(404).json({ error: 'User tidak ditemukan' });
  const newActive = rows[0].active ? 0 : 1;
  await pool.query('UPDATE users SET active = ? WHERE id = ?', [newActive, id]);
  const [updated] = await pool.query('SELECT * FROM users WHERE id = ?', [id]);
  res.json({ user: withHasPin(updated[0]) });
}
