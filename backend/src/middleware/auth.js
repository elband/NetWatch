import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';
import { pool } from '../db/pool.js';

export async function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Token tidak ditemukan' });
  let payload;
  try {
    payload = jwt.verify(token, env.jwtSecret);
  } catch {
    return res.status(401).json({ error: 'Token tidak valid atau kedaluwarsa' });
  }
  // Verifikasi akun masih ada & aktif — akses dashboard langsung hilang bila di-nonaktifkan/dihapus.
  try {
    const [rows] = await pool.query('SELECT active FROM users WHERE id = ? LIMIT 1', [payload.id]);
    if (!rows[0] || !rows[0].active) return res.status(401).json({ error: 'Akun nonaktif atau telah dihapus. Silakan hubungi admin.' });
  } catch {
    return res.status(500).json({ error: 'Gagal memverifikasi akun.' });
  }
  req.user = payload;
  next();
}

export function requireRole(...roles) {
  return (req, res, next) => {
    const userRoles = req.user?.roles?.length ? req.user.roles : (req.user?.role ? [req.user.role] : []);
    if (!userRoles.some((r) => roles.includes(r))) {
      return res.status(403).json({ error: 'Tidak punya akses' });
    }
    next();
  };
}

export function requirePerm(perm) {
  return (req, res, next) => {
    if (!req.user || !req.user.perms?.includes(perm)) {
      return res.status(403).json({ error: 'Tidak punya izin akses fitur ini' });
    }
    next();
  };
}
