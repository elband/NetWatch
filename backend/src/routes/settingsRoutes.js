import { Router } from 'express';
import { pool } from '../db/pool.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { unitScope } from '../middleware/unitScope.js';
import { applyTimezone, isValidTz, serverTimeInfo } from '../services/timezone.js';
import { diagnoseTz, runTzMigration } from '../services/tzMigration.js';
import { mergeUnitLkp, getUnitConfig } from '../services/unitConfig.js';

const router = Router();
router.use(requireAuth);

// Waktu server saat ini + zona aktif (untuk panel "Waktu Server").
router.get('/server-time', (req, res) => res.json(serverTimeInfo()));

// Diagnosa apakah migrasi data historis diperlukan (admin).
router.get('/tz-migration/status', requireRole('admin'), async (req, res) => {
  try { res.json(await diagnoseTz()); } catch (e) { res.status(500).json({ error: e.message }); }
});

// Preview (dry-run) / jalankan migrasi data historis (admin).
router.post('/tz-migration', requireRole('admin'), async (req, res) => {
  try {
    const result = await runTzMigration({
      shift: req.body?.shift,
      apply: !!req.body?.apply,
      exclude: Array.isArray(req.body?.exclude) ? req.body.exclude : [],
      force: !!req.body?.force,
    });
    res.json(result);
  } catch (e) { res.status(400).json({ error: e.message }); }
});

router.get('/', unitScope, async (req, res) => {
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
  // Fase 4: untuk unit aktif, timpa field surat per-unit (kode/kop/koordinator) ke lkp,
  // dan sajikan naratif Program Kerja per-unit (terisolasi per unit; kosong = pakai bawaan).
  if (req.unitId != null) {
    const uc = await getUnitConfig(req.unitId);
    map.lkp = mergeUnitLkp(map.lkp || {}, uc);
    map.unit_config = uc; // agar editor bisa tampilkan nilai override saja
    map.program_kerja = uc.program_kerja || {};
  }
  res.json({ settings: map });
});

router.put('/', requireRole('admin'), async (req, res) => {
  const entries = Object.entries(req.body || {});
  // Validasi zona waktu sebelum disimpan.
  if (Object.prototype.hasOwnProperty.call(req.body || {}, 'app_timezone') && !isValidTz(req.body.app_timezone)) {
    return res.status(400).json({ error: 'Zona waktu tidak valid (gunakan format IANA, mis. Asia/Makassar).' });
  }
  for (const [key, value] of entries) {
    await pool.query(
      `INSERT INTO settings (setting_key, setting_value) VALUES (?, ?)
       ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value)`,
      [key, JSON.stringify(value)]
    );
  }
  // Terapkan zona waktu langsung (koneksi baru pakai offset baru; restart utk konsistensi penuh).
  if (req.body?.app_timezone) {
    try { await applyTimezone(req.body.app_timezone); } catch { /* sudah divalidasi */ }
  }
  res.json({ ok: true, ...(req.body?.app_timezone ? { serverTime: serverTimeInfo() } : {}) });
});

export default router;
