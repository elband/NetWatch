import { Router } from 'express';
import { pool } from '../db/pool.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { queueWaRaw } from '../jobs/waQueue.js';
import { env } from '../config/env.js';
import { normalizeWaNumber } from '../utils/phone.js';

const router = Router();
router.use(requireAuth);

router.get('/', async (req, res) => {
  const [rows] = await pool.query('SELECT * FROM wa_log ORDER BY created_at DESC LIMIT 200');
  res.json({ waLog: rows });
});

// Kirim pesan test ke nomor WA untuk memverifikasi konfigurasi gateway.
// Pesan masuk ke antrian & tercatat di Log WhatsApp seperti notifikasi biasa.
router.post('/test', requireRole('admin', 'koordinator'), async (req, res) => {
  if (!env.waGateway.apiKey) {
    return res.status(400).json({ error: 'Gateway WA belum dikonfigurasi (WAGATEWAY_API_KEY).' });
  }
  // Default ke nomor pengirim bila kosong. Normalisasi final dilakukan saat pengiriman.
  const phone = normalizeWaNumber(req.body?.phone || req.user?.phone || '');
  if (!phone) return res.status(400).json({ error: 'Nomor WhatsApp tujuan wajib diisi.' });

  const text = String(req.body?.message || '').trim()
    || `🔔 Test WhatsApp NetWatch\nPesan uji dari ${req.user?.name || 'sistem'} pada ${new Date().toLocaleString('id-ID')}.\nJika Anda menerima ini, gateway WA berfungsi normal.`;

  try {
    const waLogId = await queueWaRaw({ type: 'other', toLabel: `Test WA (${req.user?.name || 'sistem'})`, phone, message: text });
    res.json({ ok: true, waLogId });
  } catch (e) {
    res.status(500).json({ error: e?.message || 'Gagal mengantrikan pesan test.' });
  }
});

export default router;
