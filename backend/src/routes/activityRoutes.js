import { Router } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { pool } from '../db/pool.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { unitScope, unitFilter, rowInUnit, insertUnitId } from '../middleware/unitScope.js';
import { queueWaNotification } from '../jobs/waQueue.js';
import { createNotification, notifyRoles } from '../services/notify.js';
import { isNotifyEnabledForUser } from '../services/notifyPrefs.js';

const router = Router();
router.use(requireAuth);
router.use(unitScope);

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DIR = path.join(__dirname, '..', '..', 'uploads', 'activities');
fs.mkdirSync(DIR, { recursive: true });
const upload = multer({
  storage: multer.diskStorage({ destination: (q, f, cb) => cb(null, DIR), filename: (q, f, cb) => cb(null, `A${Date.now()}-${Math.round(Math.random() * 1e9)}${path.extname(f.originalname).toLowerCase()}`) }),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (q, f, cb) => cb(null, ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'].includes(f.mimetype)),
});

const TYPES = ['rapat', 'lembur', 'izin', 'dinas-luar', 'lainnya'];
const TYPE_LABEL = { rapat: 'Rapat', lembur: 'Lembur', izin: 'Izin', 'dinas-luar': 'Dinas Luar', lainnya: 'Kegiatan Lain' };

function fmtWhen(a) {
  const t = a.start_time ? ` ${a.start_time}${a.end_time ? `–${a.end_time}` : ''}` : '';
  return `${a.activity_date}${t}`;
}

// Kegiatan milik user yang login (untuk dashboard teknisi).
router.get('/mine', async (req, res) => {
  const [rows] = await pool.query('SELECT * FROM activities WHERE user_id = ? ORDER BY created_at DESC', [req.user.id]);
  res.json({ activities: rows });
});

// Semua kegiatan (koordinator/admin) — opsional ?status=menunggu.
router.get('/', requireRole('koordinator', 'admin'), async (req, res) => {
  const { status } = req.query;
  const uf = unitFilter(req.unitId, 'a.unit_id');
  let sql = `SELECT a.*, u.name AS user_name, u.emoji AS user_emoji FROM activities a JOIN users u ON u.id = a.user_id WHERE 1=1${uf.clause}`;
  const params = [...uf.params];
  if (status) { sql += ' AND a.status = ?'; params.push(status); }
  sql += ' ORDER BY FIELD(a.status,"menunggu","disetujui","ditolak"), a.created_at DESC';
  const [rows] = await pool.query(sql, params);
  res.json({ activities: rows });
});

// Teknisi mengajukan kegiatan (+ bukti dukung opsional) → notifikasi WA ke koordinator.
router.post('/', upload.single('bukti'), async (req, res) => {
  const { type, title, detail, activityDate, startTime, endTime } = req.body;
  const t = TYPES.includes(type) ? type : 'lainnya';
  if (!title?.trim() || !/^\d{4}-\d{2}-\d{2}$/.test(activityDate || '')) {
    return res.status(400).json({ error: 'Judul kegiatan dan tanggal (YYYY-MM-DD) wajib diisi.' });
  }
  const buktiUrl = req.file ? `/uploads/activities/${req.file.filename}` : null;
  // unit_id kegiatan = unit milik user sendiri (pengajuan pribadi).
  const [r] = await pool.query(
    `INSERT INTO activities (user_id, type, title, detail, activity_date, start_time, end_time, bukti_url, unit_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [req.user.id, t, title.trim(), detail?.trim() || null, activityDate, startTime || null, endTime || null, buktiUrl, req.user.unit_id ?? insertUnitId(req)]
  );
  const [rows] = await pool.query('SELECT * FROM activities WHERE id = ?', [r.insertId]);
  const act = rows[0];

  // Hanya koordinator unit pengaju (+ super admin) yang diberi tahu — bukan lintas unit.
  const [coords] = await pool.query(
    "SELECT id FROM users WHERE active = 1 AND (role = 'koordinator' OR JSON_CONTAINS(roles, '\"koordinator\"')) AND (unit_id IS NULL OR unit_id = ?)",
    [act.unit_id ?? null]
  );
  for (const c of coords) {
    if (!(await isNotifyEnabledForUser('pengajuan_review_koordinator', c.id))) continue;
    await queueWaNotification({
      type: 'other',
      toUserId: c.id,
      message: `📋 PENGAJUAN KEGIATAN — ${TYPE_LABEL[t]}\n${title.trim()}\nOleh: ${req.user.name}\nWaktu: ${fmtWhen(act)}${detail?.trim() ? `\n${detail.trim()}` : ''}${buktiUrl ? '\n📎 Ada bukti dukung terlampir.' : ''}\nMohon persetujuan di aplikasi NetWatch.`,
    });
  }
  await notifyRoles(['koordinator', 'admin'], { type: 'approval_pending', title: `Persetujuan menunggu: ${TYPE_LABEL[t]}`, message: `${title.trim()} — oleh ${req.user.name}`, refId: act.id, refType: 'activity', link: '/coord-dashboard' }, { unitId: act.unit_id });
  res.status(201).json({ activity: act });
});

async function decide(req, res, status) {
  const id = Number(req.params.id);
  const note = (req.body.note || '').trim() || null;
  const [rows] = await pool.query('SELECT a.*, u.name AS user_name FROM activities a JOIN users u ON u.id = a.user_id WHERE a.id = ?', [id]);
  const act = rows[0];
  if (!act || !rowInUnit(act, req.unitId)) return res.status(404).json({ error: 'Kegiatan tidak ditemukan' });
  if (act.status !== 'menunggu') return res.status(400).json({ error: 'Kegiatan sudah diproses.' });

  await pool.query(
    'UPDATE activities SET status=?, approved_by=?, approver_name=?, approved_at=NOW(), coord_note=? WHERE id=?',
    [status, req.user.id, req.user.name, note, id]
  );

  const label = TYPE_LABEL[act.type] || 'Kegiatan';
  const msg = status === 'disetujui'
    ? `✅ KEGIATAN DISETUJUI — ${label}\n${act.title}\nWaktu: ${fmtWhen(act)}\nDisetujui oleh ${req.user.name}.${note ? `\nCatatan: ${note}` : ''}`
    : `❌ KEGIATAN DITOLAK — ${label}\n${act.title}\nOleh ${req.user.name}.${note ? `\nAlasan: ${note}` : ''}`;
  if (await isNotifyEnabledForUser('pengajuan_keputusan', act.user_id)) await queueWaNotification({ type: 'other', toUserId: act.user_id, message: msg });

  const [updated] = await pool.query('SELECT * FROM activities WHERE id = ?', [id]);
  res.json({ activity: updated[0] });
}

router.patch('/:id/approve', requireRole('koordinator', 'admin'), (req, res) => decide(req, res, 'disetujui'));
router.patch('/:id/reject', requireRole('koordinator', 'admin'), (req, res) => decide(req, res, 'ditolak'));

export default router;
