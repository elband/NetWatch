import bcrypt from 'bcryptjs';
import { pool } from '../db/pool.js';
import { toPublicUser } from './authController.js';
import { audit } from '../services/audit.js';
import { isAdminUser, unitFilter } from '../middleware/unitScope.js';

const EMOJI_MAP = { admin: '👑', koordinator: '👨‍💼', teknisi: '🔧', viewer: '👁️' };
const VALID_ROLES = ['admin', 'koordinator', 'teknisi', 'viewer'];

// True bila baris user (dari DB) memiliki peran admin/super admin.
function rowIsAdmin(u) {
  try {
    const roles = typeof u.roles === 'string' ? JSON.parse(u.roles) : u.roles;
    if (Array.isArray(roles) && roles.includes('admin')) return true;
  } catch { /* fallback role tunggal */ }
  return u.role === 'admin';
}

// Pagar koordinator (admin unit): hanya boleh menyentuh user unitnya sendiri,
// dan tidak boleh menyentuh/memberi peran admin (super admin).
// Return pesan error atau null bila boleh.
function coordGuard(req, { targetRow = null, roleList = null } = {}) {
  if (isAdminUser(req.user)) return null; // super admin bebas
  if (targetRow) {
    if (rowIsAdmin(targetRow)) return 'Tidak boleh mengubah akun Super Admin.';
    if (targetRow.unit_id == null || Number(targetRow.unit_id) !== Number(req.user.unit_id)) {
      return 'User tersebut bukan anggota unit Anda.';
    }
  }
  if (roleList && roleList.includes('admin')) return 'Hanya Super Admin yang boleh memberi peran admin.';
  return null;
}

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
  // Ter-scope unit: koordinator = unitnya; admin = semua atau unit terpilih (X-Unit-Id).
  // Akun super admin (unit NULL) hanya terlihat oleh admin dalam mode "Semua Unit".
  const uf = unitFilter(req.unitId);
  const [rows] = await pool.query(`SELECT * FROM users WHERE 1=1 ${uf.clause} ORDER BY id`, uf.params);
  res.json({ users: rows.map(withHasPin) });
}

export async function createUser(req, res) {
  const { name, username, email, password, pin, phone, nip, role, roles, jabatan, perms, unit_id } = req.body;
  const roleList = normalizeRoles(roles, role);
  if (!name || !username || !email || roleList.length === 0) {
    return res.status(400).json({ error: 'Nama, username, email, dan minimal 1 peran wajib diisi' });
  }
  const guardErr = coordGuard(req, { roleList });
  if (guardErr) return res.status(403).json({ error: guardErr });
  // Unit: koordinator selalu membuat user untuk unitnya sendiri; admin memilih via body.
  // Peran non-admin wajib punya unit; unit NULL hanya untuk super admin.
  const unitId = isAdminUser(req.user) ? (unit_id ? Number(unit_id) : null) : req.user.unit_id;
  if (unitId == null && !roleList.includes('admin')) {
    return res.status(400).json({ error: 'Pilih unit untuk user ini (hanya Super Admin yang boleh tanpa unit).' });
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
      `INSERT INTO users (name, username, email, password_hash, pin_hash, phone, nip, role, roles, jabatan, emoji, active, perms, unit_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
      [name, username, email, hash, pinRes.hash, phone || null, nip || null, primary, JSON.stringify(roleList), jabatan || null, emoji, JSON.stringify(perms || []), unitId]
    );
    const [rows] = await pool.query('SELECT * FROM users WHERE id = ?', [result.insertId]);
    await audit(req.user, 'create_user', 'user', result.insertId, `Buat user ${username} (peran: ${roleList.join(',')})`);
    res.status(201).json({ user: withHasPin(rows[0]) });
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'Username atau email sudah dipakai' });
    throw err;
  }
}

export async function updateUser(req, res) {
  const id = Number(req.params.id);
  const { name, username, email, password, pin, phone, nip, role, roles, jabatan, perms, active, unit_id } = req.body;
  const [existingRows] = await pool.query('SELECT * FROM users WHERE id = ?', [id]);
  if (!existingRows[0]) return res.status(404).json({ error: 'User tidak ditemukan' });

  const preRoles = (roles !== undefined || role !== undefined) ? normalizeRoles(roles, role) : null;
  const guardErr = coordGuard(req, { targetRow: existingRows[0], roleList: preRoles });
  if (guardErr) return res.status(403).json({ error: guardErr });

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
    nip: nip ?? existingRows[0].nip,
    role: primary,
    rolesJson,
    jabatan: jabatan ?? existingRows[0].jabatan,
    emoji,
    active: active === undefined ? existingRows[0].active : active ? 1 : 0,
    perms: JSON.stringify(perms ?? (typeof existingRows[0].perms === 'string' ? JSON.parse(existingRows[0].perms) : existingRows[0].perms)),
    // Pindah unit hanya oleh Super Admin ('' = jadikan lintas unit/NULL); koordinator tidak bisa.
    unit_id: isAdminUser(req.user) && unit_id !== undefined
      ? (unit_id === null || unit_id === '' ? null : Number(unit_id))
      : existingRows[0].unit_id,
  };

  if (password) {
    fields.password_hash = await bcrypt.hash(password, 10);
    await pool.query(
      `UPDATE users SET name=?, username=?, email=?, phone=?, nip=?, role=?, roles=?, jabatan=?, emoji=?, active=?, perms=?, unit_id=?, password_hash=? WHERE id=?`,
      [fields.name, fields.username, fields.email, fields.phone, fields.nip, fields.role, fields.rolesJson, fields.jabatan, fields.emoji, fields.active, fields.perms, fields.unit_id, fields.password_hash, id]
    );
  } else {
    await pool.query(
      `UPDATE users SET name=?, username=?, email=?, phone=?, nip=?, role=?, roles=?, jabatan=?, emoji=?, active=?, perms=?, unit_id=? WHERE id=?`,
      [fields.name, fields.username, fields.email, fields.phone, fields.nip, fields.role, fields.rolesJson, fields.jabatan, fields.emoji, fields.active, fields.perms, fields.unit_id, id]
    );
  }

  const [rows] = await pool.query('SELECT * FROM users WHERE id = ?', [id]);
  await audit(req.user, 'update_user', 'user', id, `Ubah user ${fields.username}${password ? ' (+password)' : ''}${pin ? ' (+PIN)' : ''}${roleList ? ` (peran: ${roleList.join(',')})` : ''}`);
  res.json({ user: withHasPin(rows[0]) });
}

export async function deleteUser(req, res) {
  const id = Number(req.params.id);
  if (id === req.user.id) return res.status(400).json({ error: 'Tidak dapat menghapus akun Anda sendiri.' });
  const [rows] = await pool.query('SELECT id, name, username, role, roles, unit_id FROM users WHERE id = ?', [id]);
  if (!rows[0]) return res.status(404).json({ error: 'User tidak ditemukan' });
  const guardErr = coordGuard(req, { targetRow: rows[0] });
  if (guardErr) return res.status(403).json({ error: guardErr });
  try {
    await pool.query('DELETE FROM users WHERE id = ?', [id]);
  } catch {
    return res.status(409).json({ error: 'Akun tidak bisa dihapus karena masih tertaut data. Nonaktifkan saja.' });
  }
  await audit(req.user, 'delete_user', 'user', id, `Hapus user ${rows[0].username} (${rows[0].name})`);
  res.json({ ok: true });
}

export async function toggleUserActive(req, res) {
  const id = Number(req.params.id);
  const [rows] = await pool.query('SELECT * FROM users WHERE id = ?', [id]);
  if (!rows[0]) return res.status(404).json({ error: 'User tidak ditemukan' });
  const guardErr = coordGuard(req, { targetRow: rows[0] });
  if (guardErr) return res.status(403).json({ error: guardErr });
  const newActive = rows[0].active ? 0 : 1;
  await pool.query('UPDATE users SET active = ? WHERE id = ?', [newActive, id]);
  const [updated] = await pool.query('SELECT * FROM users WHERE id = ?', [id]);
  await audit(req.user, newActive ? 'activate_user' : 'deactivate_user', 'user', id, `${newActive ? 'Aktifkan' : 'Nonaktifkan'} user ${rows[0].username}`);
  res.json({ user: withHasPin(updated[0]) });
}
