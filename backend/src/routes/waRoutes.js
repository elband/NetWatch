import { Router } from 'express';
import { pool } from '../db/pool.js';
import { requireAuth } from '../middleware/auth.js';

const router = Router();
router.use(requireAuth);

router.get('/', async (req, res) => {
  const [rows] = await pool.query('SELECT * FROM wa_log ORDER BY created_at DESC LIMIT 200');
  res.json({ waLog: rows });
});

export default router;
