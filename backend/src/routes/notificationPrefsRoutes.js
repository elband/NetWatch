import { Router } from 'express';
import { pool } from '../db/pool.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { NOTIF_EVENTS, getNotifyPrefs } from '../services/notifyPrefs.js';
import { audit } from '../services/audit.js';

const router = Router();
router.use(requireAuth);

// Daftar jenis notifikasi WA + pengaturan penerima per-user saat ini (admin saja).
router.get('/', requireRole('admin'), async (req, res) => {
  const prefs = await getNotifyPrefs();
  const [users] = await pool.query("SELECT id, name, role, roles FROM users WHERE active=1 ORDER BY role, name");
  res.json({ events: NOTIF_EVENTS, prefs, users });
});

router.put('/', requireRole('admin'), async (req, res) => {
  const prefs = req.body?.prefs;
  if (!prefs || typeof prefs !== 'object') return res.status(400).json({ error: 'prefs wajib diisi.' });
  await pool.query(
    `INSERT INTO settings (setting_key, setting_value) VALUES ('notification_prefs', ?)
     ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value)`,
    [JSON.stringify(prefs)]
  );
  await audit(req.user, 'notification_prefs_update', 'settings', null, 'Pengaturan notifikasi diperbarui');
  res.json({ ok: true });
});

export default router;
