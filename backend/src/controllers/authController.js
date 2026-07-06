import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { pool } from '../db/pool.js';
import { env } from '../config/env.js';
import { audit } from '../services/audit.js';
import { redisConnection } from '../jobs/queueConnection.js';
import { queueWaNotification } from '../jobs/waQueue.js';

function toPublicUser(u) {
  let roles;
  try {
    const parsed = typeof u.roles === 'string' ? JSON.parse(u.roles) : u.roles;
    roles = Array.isArray(parsed) && parsed.length ? parsed : [u.role];
  } catch {
    roles = [u.role];
  }
  let perms;
  try {
    const parsed = typeof u.perms === 'string' ? JSON.parse(u.perms) : u.perms;
    perms = Array.isArray(parsed) ? parsed : [];
  } catch {
    perms = [];
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
    unit_id: u.unit_id ?? null, // NULL = super admin lintas unit
    perms,
  };
}

function signToken(u) {
  const pub = toPublicUser(u);
  return jwt.sign(pub, env.jwtSecret, { expiresIn: env.jwtExpiresIn, algorithm: 'HS256' });
}

// Nama & masa berlaku cookie sesi (selaras dengan masa berlaku JWT).
export const AUTH_COOKIE = 'netwatch_token';
function cookieMaxAgeMs() {
  const m = /^(\d+)\s*([smhd])$/.exec(String(env.jwtExpiresIn || '8h'));
  if (!m) return 8 * 3600 * 1000;
  return Number(m[1]) * { s: 1e3, m: 6e4, h: 3.6e6, d: 8.64e7 }[m[2]];
}
function cookieOpts() {
  return { httpOnly: true, sameSite: 'strict', secure: env.isProd, path: '/', maxAge: cookieMaxAgeMs() };
}
// Set cookie HttpOnly berisi JWT — tidak bisa dibaca JavaScript (mitigasi XSS token theft).
function setAuthCookie(res, token) {
  res.cookie(AUTH_COOKIE, token, cookieOpts());
}

export function logout(_req, res) {
  res.clearCookie(AUTH_COOKIE, { httpOnly: true, sameSite: 'strict', secure: env.isProd, path: '/' });
  res.json({ ok: true });
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
  setAuthCookie(res, token);
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
      setAuthCookie(res, token);
      return res.json({ token, user: toPublicUser(user) });
    }
  }
  return res.status(401).json({ error: 'PIN salah atau tidak terdaftar.' });
}

// ===== Reset PIN via OTP WhatsApp (untuk user yang lupa PIN & terkunci) =====
const OTP_TTL = 600;          // 10 menit
const OTP_MAX_ATTEMPTS = 5;   // percobaan verifikasi per OTP

async function findUserByIdentifier(identifier) {
  const id = String(identifier || '').trim();
  if (!id) return null;
  const [rows] = await pool.query(
    'SELECT * FROM users WHERE active = 1 AND (username = ? OR email = ? OR phone = ?) LIMIT 1',
    [id, id, id]
  );
  return rows[0] || null;
}

// Minta OTP: kirim kode ke WhatsApp user. Respons SELALU generik (anti user-enumeration).
export async function forgotPin(req, res) {
  const generic = { ok: true, message: 'Jika akun terdaftar dan memiliki nomor WhatsApp, kode OTP telah dikirim.' };
  const user = await findUserByIdentifier(req.body.identifier);
  if (!user || !user.phone) return res.json(generic);
  const otp = String(crypto.randomInt(100000, 1000000)); // 6 digit acak kripto
  const otpHash = await bcrypt.hash(otp, 10);
  try {
    await redisConnection.set(`pinreset:${user.id}`, otpHash, 'EX', OTP_TTL);
    await redisConnection.del(`pinreset_att:${user.id}`);
  } catch { return res.status(500).json({ error: 'Gagal memproses. Coba lagi.' }); }
  await queueWaNotification({
    type: 'other',
    toUserId: user.id,
    message: `🔐 RESET PIN NETWATCH\nKode OTP Anda: *${otp}*\nBerlaku 10 menit. JANGAN bagikan kode ini ke siapa pun.\nAbaikan pesan ini bila Anda tidak meminta reset PIN.`,
  });
  return res.json(generic);
}

// Verifikasi OTP + set PIN baru (6 digit, unik lintas user seperti updateProfile).
export async function resetPin(req, res) {
  const { identifier, otp, newPin } = req.body;
  const user = await findUserByIdentifier(identifier);
  if (!user) return res.status(400).json({ error: 'OTP salah atau kedaluwarsa.' });
  if (!/^\d{6}$/.test(String(newPin || ''))) return res.status(400).json({ error: 'PIN baru harus 6 digit angka.' });
  let attempts;
  try {
    attempts = await redisConnection.incr(`pinreset_att:${user.id}`);
    if (attempts === 1) await redisConnection.expire(`pinreset_att:${user.id}`, OTP_TTL);
  } catch { return res.status(500).json({ error: 'Gagal memproses. Coba lagi.' }); }
  if (attempts > OTP_MAX_ATTEMPTS) {
    await redisConnection.del(`pinreset:${user.id}`);
    return res.status(429).json({ error: 'Terlalu banyak percobaan. Minta OTP baru.' });
  }
  const otpHash = await redisConnection.get(`pinreset:${user.id}`);
  if (!otpHash) return res.status(400).json({ error: 'OTP kedaluwarsa. Minta kode baru.' });
  if (!(await bcrypt.compare(String(otp || ''), otpHash))) return res.status(400).json({ error: 'OTP salah.' });
  // PIN wajib unik antar user (selaras dgn updateProfile).
  const [others] = await pool.query('SELECT pin_hash FROM users WHERE id <> ? AND pin_hash IS NOT NULL', [user.id]);
  for (const o of others) { if (await bcrypt.compare(String(newPin), o.pin_hash)) return res.status(400).json({ error: 'PIN sudah digunakan akun lain, pilih yang lain.' }); }
  const pinHash = await bcrypt.hash(String(newPin), 10);
  await pool.query('UPDATE users SET pin_hash = ? WHERE id = ?', [pinHash, user.id]);
  await redisConnection.del(`pinreset:${user.id}`, `pinreset_att:${user.id}`);
  await audit(user, 'pin_reset', 'user', user.id, 'Reset PIN via OTP WhatsApp');
  return res.json({ ok: true, message: 'PIN berhasil diperbarui. Silakan login dengan PIN baru.' });
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
    if (!/^\d{6}$/.test(String(pin))) return res.status(400).json({ error: 'PIN baru harus 6 digit angka (untuk keamanan).' });
    const [others] = await pool.query('SELECT pin_hash FROM users WHERE id <> ? AND pin_hash IS NOT NULL', [id]);
    for (const o of others) { if (await bcrypt.compare(String(pin), o.pin_hash)) return res.status(400).json({ error: 'PIN sudah digunakan akun lain, pilih yang lain.' }); }
    pinHash = await bcrypt.hash(String(pin), 10);
  }
  // Foto profil opsional (multipart, field 'photo'); removePhoto=1 → kembali ke emoji.
  const avatarUrl = req.file ? `/uploads/avatars/${req.file.filename}` : (req.body.removePhoto === '1' ? null : u.avatar_url);
  await pool.query('UPDATE users SET name=?, email=?, phone=?, jabatan=?, pin_hash=?, avatar_url=? WHERE id=?',
    [newName, newEmail || u.email, phone ?? u.phone, jabatan ?? u.jabatan, pinHash, avatarUrl, id]);
  const [updated] = await pool.query('SELECT * FROM users WHERE id = ?', [id]);
  const newToken = signToken(updated[0]);
  setAuthCookie(res, newToken);
  res.json({ token: newToken, user: toPublicUser(updated[0]) });
}

export async function loginAs(req, res) {
  // Cek peran admin pada SELURUH peran (bukan hanya role utama).
  const roles = req.user?.roles?.length ? req.user.roles : (req.user?.role ? [req.user.role] : []);
  if (!roles.includes('admin')) return res.status(403).json({ error: 'Hanya admin yang bisa login-as' });
  const targetId = Number(req.params.id);
  const [rows] = await pool.query('SELECT * FROM users WHERE id = ? AND active = 1', [targetId]);
  const target = rows[0];
  if (!target) return res.status(404).json({ error: 'User tidak ditemukan atau nonaktif' });
  // Jejak audit non-repudiation: siapa menyamar jadi siapa.
  await audit(req.user, 'login_as', 'user', target.id, `${req.user.name} login-as ${target.name} (${target.username})`);
  const token = signToken(target);
  setAuthCookie(res, token);
  res.json({ token, user: toPublicUser(target) });
}

export { toPublicUser };
