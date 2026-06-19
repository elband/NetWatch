import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { pool } from '../db/pool.js';
import { env } from '../config/env.js';

function toPublicUser(u) {
  let roles;
  try {
    const parsed = typeof u.roles === 'string' ? JSON.parse(u.roles) : u.roles;
    roles = Array.isArray(parsed) && parsed.length ? parsed : [u.role];
  } catch {
    roles = [u.role];
  }
  return {
    id: u.id,
    name: u.name,
    username: u.username,
    email: u.email,
    phone: u.phone,
    nip: u.nip ?? null,
    role: u.role,      // peran utama (untuk emoji/redirect)
    roles,             // semua peran yang dimiliki
    jabatan: u.jabatan,
    emoji: u.emoji,
    avatar_url: u.avatar_url ?? null,
    active: !!u.active,
    perms: typeof u.perms === 'string' ? JSON.parse(u.perms) : u.perms,
  };
}

function signToken(u) {
  const pub = toPublicUser(u);
  return jwt.sign(pub, env.jwtSecret, { expiresIn: env.jwtExpiresIn });
}

export async function login(req, res) {
  const { identifier, password } = req.body;
  if (!identifier || !password) return res.status(400).json({ error: 'Username/email dan password wajib diisi' });

  const [rows] = await pool.query(
    'SELECT * FROM users WHERE (username = ? OR email = ?) AND active = 1 LIMIT 1',
    [identifier, identifier]
  );
  const user = rows[0];
  if (!user) return res.status(401).json({ error: 'Username atau password salah' });

  const ok = await bcrypt.compare(password, user.password_hash);
  if (!ok) return res.status(401).json({ error: 'Username atau password salah' });

  const token = signToken(user);
  res.json({ token, user: toPublicUser(user) });
}

// Login hanya dengan PIN: cocokkan PIN ke seluruh user aktif yang punya PIN.
export async function loginPin(req, res) {
  const pin = String(req.body.pin || '').trim();
  if (!/^\d{4,6}$/.test(pin)) return res.status(400).json({ error: 'PIN harus 4–6 digit angka.' });

  const [rows] = await pool.query('SELECT * FROM users WHERE active = 1 AND pin_hash IS NOT NULL');
  for (const user of rows) {
    if (await bcrypt.compare(pin, user.pin_hash)) {
      const token = signToken(user);
      return res.json({ token, user: toPublicUser(user) });
    }
  }
  return res.status(401).json({ error: 'PIN salah atau tidak terdaftar.' });
}

export async function me(req, res) {
  const [rows] = await pool.query('SELECT * FROM users WHERE id = ?', [req.user.id]);
  if (!rows[0]) return res.status(404).json({ error: 'User tidak ditemukan' });
  res.json({ user: toPublicUser(rows[0]) });
}

// Edit profil sendiri (info umum + ganti PIN). Mengembalikan token baru karena klaim berubah.
export async function updateProfile(req, res) {
  const id = req.user.id;
  const [rows] = await pool.query('SELECT * FROM users WHERE id = ?', [id]);
  const u = rows[0];
  if (!u) return res.status(404).json({ error: 'User tidak ditemukan' });
  const { name, email, phone, jabatan, pin } = req.body;
  const newName = (name ?? u.name)?.trim();
  if (!newName) return res.status(400).json({ error: 'Nama wajib diisi.' });
  const newEmail = (email ?? u.email)?.trim();
  if (newEmail) {
    const [dup] = await pool.query('SELECT id FROM users WHERE email = ? AND id <> ?', [newEmail, id]);
    if (dup.length) return res.status(400).json({ error: 'Email sudah dipakai akun lain.' });
  }
  let pinHash = u.pin_hash;
  if (pin) {
    if (!/^\d{4,6}$/.test(String(pin))) return res.status(400).json({ error: 'PIN harus 4–6 digit angka.' });
    const [others] = await pool.query('SELECT pin_hash FROM users WHERE id <> ? AND pin_hash IS NOT NULL', [id]);
    for (const o of others) { if (await bcrypt.compare(String(pin), o.pin_hash)) return res.status(400).json({ error: 'PIN sudah digunakan akun lain, pilih yang lain.' }); }
    pinHash = await bcrypt.hash(String(pin), 10);
  }
  // Foto profil opsional (multipart, field 'photo'); removePhoto=1 → kembali ke emoji.
  const avatarUrl = req.file ? `/uploads/avatars/${req.file.filename}` : (req.body.removePhoto === '1' ? null : u.avatar_url);
  await pool.query('UPDATE users SET name=?, email=?, phone=?, jabatan=?, pin_hash=?, avatar_url=? WHERE id=?',
    [newName, newEmail || u.email, phone ?? u.phone, jabatan ?? u.jabatan, pinHash, avatarUrl, id]);
  const [updated] = await pool.query('SELECT * FROM users WHERE id = ?', [id]);
  res.json({ token: signToken(updated[0]), user: toPublicUser(updated[0]) });
}

export async function loginAs(req, res) {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Hanya admin yang bisa login-as' });
  const targetId = Number(req.params.id);
  const [rows] = await pool.query('SELECT * FROM users WHERE id = ? AND active = 1', [targetId]);
  const target = rows[0];
  if (!target) return res.status(404).json({ error: 'User tidak ditemukan atau nonaktif' });
  const token = signToken(target);
  res.json({ token, user: toPublicUser(target) });
}

export { toPublicUser };
