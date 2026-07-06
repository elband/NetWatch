import { Router } from 'express';
import { pool } from '../db/pool.js';
import { requireAuth, requireRole } from '../middleware/auth.js';

// Audit trail (read-only) — hanya admin. Menampilkan jejak aksi sensitif yang
// dicatat services/audit.js (login_as, ssh_connect, ssh_command, dll).
const router = Router();
router.use(requireAuth, requireRole('admin'));

// Daftar log dengan filter + pagination cursor (id menurun).
// ?action= ?actor= ?from=YYYY-MM-DD ?to=YYYY-MM-DD ?before=<id> ?limit=
router.get('/', async (req, res) => {
  const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 50));
  const before = Number(req.query.before) || 0;
  const { action, actor, from, to } = req.query;
  let sql = 'SELECT id, actor_id, actor_name, action, target_type, target_id, detail, created_at FROM audit_log WHERE 1=1';
  const params = [];
  if (action) { sql += ' AND action = ?'; params.push(action); }
  if (actor) { sql += ' AND (actor_name LIKE ? OR actor_id = ?)'; params.push(`%${actor}%`, Number(actor) || 0); }
  if (from) { sql += ' AND created_at >= ?'; params.push(`${from} 00:00:00`); }
  if (to) { sql += ' AND created_at <= ?'; params.push(`${to} 23:59:59`); }
  if (before > 0) { sql += ' AND id < ?'; params.push(before); }
  sql += ' ORDER BY id DESC LIMIT ?';
  params.push(limit + 1);
  const [rows] = await pool.query(sql, params);
  const hasMore = rows.length > limit;
  res.json({ logs: hasMore ? rows.slice(0, limit) : rows, hasMore });
});

// Daftar jenis aksi unik (untuk dropdown filter).
router.get('/actions', async (_req, res) => {
  const [rows] = await pool.query('SELECT DISTINCT action FROM audit_log ORDER BY action');
  res.json({ actions: rows.map((r) => r.action) });
});

export default router;
