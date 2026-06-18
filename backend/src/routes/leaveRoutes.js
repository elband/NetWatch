import { Router } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { pool } from '../db/pool.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { queueWaNotification } from '../jobs/waQueue.js';
import { audit } from '../services/audit.js';

const router = Router();
router.use(requireAuth);

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DIR = path.join(__dirname, '..', '..', 'uploads', 'leave');
fs.mkdirSync(DIR, { recursive: true });
const upload = multer({
  storage: multer.diskStorage({ destination: (q, f, cb) => cb(null, DIR), filename: (q, f, cb) => cb(null, `L${Date.now()}-${Math.round(Math.random() * 1e9)}${path.extname(f.originalname).toLowerCase()}`) }),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (q, f, cb) => cb(null, ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'].includes(f.mimetype)),
});
const TYPES = ['izin', 'sakit', 'cuti', 'dinas_luar'];

// Ajukan izin/sakit/cuti/dinas luar (teknisi).
router.post('/', upload.single('doc'), async (req, res) => {
  const { type, startDate, endDate, reason } = req.body;
  if (!TYPES.includes(type)) return res.status(400).json({ error: 'Jenis tidak valid.' });
  if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate || '') || !/^\d{4}-\d{2}-\d{2}$/.test(endDate || '')) return res.status(400).json({ error: 'Tanggal mulai & selesai wajib (YYYY-MM-DD).' });
  if (endDate < startDate) return res.status(400).json({ error: 'Tanggal selesai sebelum tanggal mulai.' });
  const docUrl = req.file ? `/uploads/leave/${req.file.filename}` : null;
  const [r] = await pool.query(
    'INSERT INTO leave_requests (user_id, type, start_date, end_date, reason, doc_url) VALUES (?,?,?,?,?,?)',
    [req.user.id, type, startDate, endDate, reason?.trim() || null, docUrl]
  );
  await audit(req.user, 'leave_request', 'leave', r.insertId, `${type} ${startDate}..${endDate}`);
  // Beri tahu koordinator.
  const [coords] = await pool.query("SELECT id FROM users WHERE active=1 AND (role='koordinator' OR JSON_CONTAINS(roles,'\"koordinator\"'))");
  for (const c of coords) { try { await queueWaNotification({ type: 'other', toUserId: c.id, message: `📝 *Pengajuan ${type}*\n${req.user.name}: ${startDate} s/d ${endDate}\nAlasan: ${reason || '-'}\nMohon ditinjau di sistem.` }); } catch { /* abaikan */ } }
  res.status(201).json({ id: r.insertId, doc_url: docUrl });
});

// Riwayat pengajuan sendiri.
router.get('/me', async (req, res) => {
  const [rows] = await pool.query('SELECT * FROM leave_requests WHERE user_id=? ORDER BY created_at DESC LIMIT 50', [req.user.id]);
  res.json({ leave: rows });
});

// Daftar pengajuan (koordinator/admin). ?status=menunggu untuk yang perlu ditinjau.
router.get('/', requireRole('admin', 'koordinator'), async (req, res) => {
  let sql = 'SELECT l.*, u.name, u.jabatan FROM leave_requests l JOIN users u ON u.id=l.user_id WHERE 1=1';
  const params = [];
  if (['menunggu', 'disetujui', 'ditolak'].includes(req.query.status)) { sql += ' AND l.status=?'; params.push(req.query.status); }
  if (/^\d{4}-\d{2}$/.test(req.query.month)) { sql += " AND (DATE_FORMAT(l.start_date,'%Y-%m')=? OR DATE_FORMAT(l.end_date,'%Y-%m')=?)"; params.push(req.query.month, req.query.month); }
  sql += ' ORDER BY l.created_at DESC LIMIT 200';
  const [rows] = await pool.query(sql, params);
  res.json({ leave: rows });
});

// Setujui / tolak (koordinator/admin).
router.patch('/:id', requireRole('admin', 'koordinator'), async (req, res) => {
  const status = req.body.status;
  if (!['disetujui', 'ditolak'].includes(status)) return res.status(400).json({ error: 'Status tidak valid.' });
  const [[lv]] = await pool.query('SELECT l.*, u.name FROM leave_requests l JOIN users u ON u.id=l.user_id WHERE l.id=?', [Number(req.params.id)]);
  if (!lv) return res.status(404).json({ error: 'Pengajuan tidak ditemukan.' });
  await pool.query('UPDATE leave_requests SET status=?, approved_by=?, approver_name=?, approved_at=NOW(), coord_note=? WHERE id=?',
    [status, req.user.id, req.user.name, req.body.note?.trim() || null, Number(req.params.id)]);
  // Dinas Luar / Cuti yang DISETUJUI → otomatis isi jadwal (DL / C) pada rentang tanggalnya.
  const shiftByType = { dinas_luar: 'dinas_luar', cuti: 'cuti' };
  if (status === 'disetujui' && shiftByType[lv.type]) {
    const st = shiftByType[lv.type];
    let cur = new Date(`${String(lv.start_date).slice(0, 10)}T00:00:00Z`);
    const last = new Date(`${String(lv.end_date).slice(0, 10)}T00:00:00Z`);
    while (cur <= last) {
      const ds = cur.toISOString().slice(0, 10);
      await pool.query('INSERT INTO shifts (user_id, shift_date, shift_type) VALUES (?,?,?) ON DUPLICATE KEY UPDATE shift_type=VALUES(shift_type)', [lv.user_id, ds, st]);
      cur = new Date(cur.getTime() + 86400000);
    }
  }
  await audit(req.user, status === 'disetujui' ? 'leave_approve' : 'leave_reject', 'leave', req.params.id, `${lv.name} ${lv.type} ${String(lv.start_date).slice(0, 10)}..${String(lv.end_date).slice(0, 10)}`);
  try { await queueWaNotification({ type: 'other', toUserId: lv.user_id, message: `Pengajuan ${lv.type} Anda (${String(lv.start_date).slice(0, 10)} s/d ${String(lv.end_date).slice(0, 10)}) *${status}*${req.body.note ? `\nCatatan: ${req.body.note}` : ''}.` }); } catch { /* abaikan */ }
  res.json({ ok: true });
});

export default router;
