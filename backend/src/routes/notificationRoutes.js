import { Router } from 'express';
import { pool } from '../db/pool.js';
import { requireAuth } from '../middleware/auth.js';

const router = Router();
router.use(requireAuth);

async function unreadCount(userId) {
  const [[c]] = await pool.query('SELECT COUNT(*) c FROM notifications WHERE user_id = ? AND is_read = 0', [userId]);
  return c.c;
}

// Jumlah belum dibaca (untuk badge).
router.get('/unread-count', async (req, res) => {
  res.json({ unread: await unreadCount(req.user.id) });
});

// Daftar notifikasi + filter + pagination berbasis cursor id (infinite scroll).
// ?filter=all|unread|<type>  ?before=<id>  ?limit=20
router.get('/', async (req, res) => {
  const limit = Math.min(50, Math.max(1, Number(req.query.limit) || 20));
  const before = Number(req.query.before) || 0;
  const filter = req.query.filter;
  let sql = 'SELECT * FROM notifications WHERE user_id = ?';
  const params = [req.user.id];
  if (filter === 'unread') sql += ' AND is_read = 0';
  else if (filter && filter !== 'all') { sql += ' AND type = ?'; params.push(filter); }
  if (before > 0) { sql += ' AND id < ?'; params.push(before); }
  sql += ' ORDER BY id DESC LIMIT ?';
  params.push(limit + 1);
  const [rows] = await pool.query(sql, params);
  const hasMore = rows.length > limit;
  res.json({ notifications: hasMore ? rows.slice(0, limit) : rows, hasMore, unread: await unreadCount(req.user.id) });
});

// Tandai satu notifikasi dibaca (hanya milik sendiri).
router.patch('/:id/read', async (req, res) => {
  await pool.query('UPDATE notifications SET is_read = 1 WHERE id = ? AND user_id = ?', [Number(req.params.id), req.user.id]);
  res.json({ ok: true, unread: await unreadCount(req.user.id) });
});

// Tandai semua dibaca.
router.post('/read-all', async (req, res) => {
  await pool.query('UPDATE notifications SET is_read = 1 WHERE user_id = ? AND is_read = 0', [req.user.id]);
  res.json({ ok: true, unread: 0 });
});

// Hapus satu notifikasi.
router.delete('/:id', async (req, res) => {
  await pool.query('DELETE FROM notifications WHERE id = ? AND user_id = ?', [Number(req.params.id), req.user.id]);
  res.json({ ok: true, unread: await unreadCount(req.user.id) });
});

// Bersihkan semua notifikasi milik user.
router.delete('/', async (req, res) => {
  await pool.query('DELETE FROM notifications WHERE user_id = ?', [req.user.id]);
  res.json({ ok: true, unread: 0 });
});

export default router;
