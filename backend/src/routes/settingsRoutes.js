import { Router } from 'express';
import { pool } from '../db/pool.js';
import { requireAuth, requireRole } from '../middleware/auth.js';

const router = Router();
router.use(requireAuth);

router.get('/', async (req, res) => {
  const [rows] = await pool.query('SELECT * FROM settings');
  const map = {};
  for (const r of rows) {
    // mysql2 already deserializes JSON columns; only parse if a raw string slipped through.
    let value = r.setting_value;
    if (typeof value === 'string') {
      try { value = JSON.parse(value); } catch { /* keep raw string */ }
    }
    map[r.setting_key] = value;
  }
  res.json({ settings: map });
});

router.put('/', requireRole('admin'), async (req, res) => {
  const entries = Object.entries(req.body || {});
  for (const [key, value] of entries) {
    await pool.query(
      `INSERT INTO settings (setting_key, setting_value) VALUES (?, ?)
       ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value)`,
      [key, JSON.stringify(value)]
    );
  }
  res.json({ ok: true });
});

export default router;
