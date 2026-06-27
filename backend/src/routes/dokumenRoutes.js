import { Router } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { pool } from '../db/pool.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { queueWaNotification } from '../jobs/waQueue.js';
import { audit } from '../services/audit.js';
import { isNotifyEnabledForUser } from '../services/notifyPrefs.js';

const router = Router();
router.use(requireAuth);

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DIR = path.join(__dirname, '..', '..', 'uploads', 'documents');
fs.mkdirSync(DIR, { recursive: true });
const upload = multer({
  storage: multer.diskStorage({ destination: (q, f, cb) => cb(null, DIR), filename: (q, f, cb) => cb(null, `D${Date.now()}-${Math.round(Math.random() * 1e9)}${path.extname(f.originalname).toLowerCase()}`) }),
  limits: { fileSize: 50 * 1024 * 1024 },
});
const STATUSES = ['draft', 'review', 'disetujui', 'aktif', 'kadaluarsa', 'arsip'];
const isManager = (u) => ['admin', 'koordinator'].some((r) => (u.roles?.length ? u.roles : [u.role]).includes(r));
const splitTags = (s) => String(s || '').split(',').map((t) => t.trim()).filter(Boolean).slice(0, 20);

async function syncTags(id, tags) {
  await pool.query('DELETE FROM document_tags WHERE document_id=?', [id]);
  for (const t of tags) await pool.query('INSERT INTO document_tags (document_id, tag) VALUES (?,?)', [id, t.slice(0, 60)]);
}
async function notifyCoords(message) {
  const [c] = await pool.query("SELECT id FROM users WHERE active=1 AND (role='koordinator' OR JSON_CONTAINS(roles,'\"koordinator\"'))");
  for (const x of c) {
    if (!(await isNotifyEnabledForUser('pengajuan_review_koordinator', x.id))) continue;
    try { await queueWaNotification({ type: 'other', toUserId: x.id, message }); } catch { /* abaikan */ }
  }
}

// ===== Kategori =====
router.get('/categories', async (req, res) => {
  const [rows] = await pool.query('SELECT c.*, (SELECT COUNT(*) FROM documents d WHERE d.kategori=c.name) AS jumlah FROM document_categories c ORDER BY sort_order, name');
  res.json({ categories: rows });
});
router.post('/categories', requireRole('admin'), async (req, res) => {
  if (!req.body.name?.trim()) return res.status(400).json({ error: 'Nama kategori wajib.' });
  await pool.query('INSERT INTO document_categories (name) VALUES (?) ON DUPLICATE KEY UPDATE name=VALUES(name)', [req.body.name.trim()]);
  res.json({ ok: true });
});
router.delete('/categories/:id', requireRole('admin'), async (req, res) => {
  await pool.query('DELETE FROM document_categories WHERE id=?', [Number(req.params.id)]);
  res.json({ ok: true });
});

// ===== Dashboard statistik =====
router.get('/stats', async (req, res) => {
  const [[s]] = await pool.query(
    `SELECT COUNT(*) total,
            SUM(kategori='SOP') sop,
            SUM(kategori='Knowledge Base') kb,
            SUM(kategori='Materi Diklat') materi,
            SUM(status IN ('draft','review')) belum_review,
            SUM(status='kadaluarsa' OR (tanggal_review IS NOT NULL AND tanggal_review < CURDATE() AND status NOT IN ('arsip','kadaluarsa'))) kadaluarsa
       FROM documents`);
  const [terbaru] = await pool.query("SELECT id, judul, kategori, status, created_at FROM documents ORDER BY created_at DESC LIMIT 5");
  const [terpopuler] = await pool.query("SELECT id, judul, kategori, views FROM documents ORDER BY views DESC, id DESC LIMIT 5");
  const [kontributor] = await pool.query('SELECT creator_name name, COUNT(*) jumlah FROM documents WHERE creator_name IS NOT NULL GROUP BY creator_name ORDER BY jumlah DESC LIMIT 5');
  const [aktivitas] = await pool.query(
    `SELECT v.created_at, v.user_name, d.judul FROM document_views v JOIN documents d ON d.id=v.document_id ORDER BY v.id DESC LIMIT 8`);
  const insight = [];
  const expSoon = (await pool.query("SELECT COUNT(*) c FROM documents WHERE tanggal_review IS NOT NULL AND tanggal_review BETWEEN CURDATE() AND DATE_ADD(CURDATE(), INTERVAL 30 DAY) AND status='aktif'"))[0][0].c;
  insight.push({ type: 'info', text: `${s.total || 0} dokumen total · ${s.sop || 0} SOP · ${s.kb || 0} Knowledge Base · ${s.materi || 0} Materi Diklat.` });
  if (Number(s.belum_review) > 0) insight.push({ type: 'warn', text: `${s.belum_review} dokumen menunggu review/persetujuan.` });
  if (Number(s.kadaluarsa) > 0) insight.push({ type: 'bad', text: `${s.kadaluarsa} dokumen kadaluarsa — perlu diperbarui.` });
  if (expSoon > 0) insight.push({ type: 'warn', text: `${expSoon} SOP/dokumen akan jatuh tempo review dalam 30 hari.` });
  if (!insight.some((i) => i.type !== 'info')) insight.push({ type: 'good', text: 'Semua dokumen terkelola baik — tidak ada yang kadaluarsa atau tertunda.' });
  res.json({
    stats: { total: s.total || 0, sop: Number(s.sop) || 0, kb: Number(s.kb) || 0, materi: Number(s.materi) || 0, belumReview: Number(s.belum_review) || 0, kadaluarsa: Number(s.kadaluarsa) || 0 },
    terbaru, terpopuler, kontributor, aktivitas, insight,
  });
});

// ===== Daftar (full-text + filter) =====
router.get('/', async (req, res) => {
  let sql = 'SELECT * FROM documents WHERE 1=1';
  const params = [];
  if (req.query.q) { const k = `%${req.query.q}%`; sql += ' AND (judul LIKE ? OR deskripsi LIKE ? OR tags LIKE ? OR nomor LIKE ? OR catatan_revisi LIKE ?)'; params.push(k, k, k, k, k); }
  if (req.query.kategori) { sql += ' AND kategori=?'; params.push(req.query.kategori); }
  if (STATUSES.includes(req.query.status)) { sql += ' AND status=?'; params.push(req.query.status); }
  if (req.query.penulis) { sql += ' AND creator_name=?'; params.push(req.query.penulis); }
  if (req.query.tag) { sql += ' AND id IN (SELECT document_id FROM document_tags WHERE tag=?)'; params.push(req.query.tag); }
  const sort = req.query.sort === 'populer' ? 'views DESC' : req.query.sort === 'judul' ? 'judul ASC' : 'updated_at DESC';
  sql += ` ORDER BY ${sort}`;
  const [rows] = await pool.query(sql, params);
  res.json({ documents: rows });
});

// Bookmark & riwayat milik sendiri.
router.get('/favorites', async (req, res) => {
  const [rows] = await pool.query('SELECT d.* FROM document_favorites f JOIN documents d ON d.id=f.document_id WHERE f.user_id=? ORDER BY f.id DESC', [req.user.id]);
  res.json({ documents: rows });
});
router.get('/recent', async (req, res) => {
  const [rows] = await pool.query('SELECT d.*, MAX(v.created_at) last_view FROM document_views v JOIN documents d ON d.id=v.document_id WHERE v.user_id=? GROUP BY d.id ORDER BY last_view DESC LIMIT 15', [req.user.id]);
  res.json({ documents: rows });
});

// ===== AI Knowledge Assistant (pencarian berbasis kata kunci atas isi metadata dokumen) =====
router.post('/assistant', async (req, res) => {
  const q = String(req.body.q || '').trim();
  if (!q) return res.json({ answer: 'Silakan ketik pertanyaan, mis. "Bagaimana prosedur restart FIDS?"', docs: [] });
  const terms = q.toLowerCase().replace(/[^\w\s]/g, ' ').split(/\s+/).filter((t) => t.length > 2);
  const [rows] = await pool.query("SELECT id, judul, kategori, deskripsi, tags, status FROM documents WHERE status IN ('aktif','disetujui') LIMIT 500");
  const scored = rows.map((d) => {
    const hay = `${d.judul} ${d.kategori} ${d.deskripsi || ''} ${d.tags || ''}`.toLowerCase();
    const score = terms.reduce((a, t) => a + (hay.includes(t) ? 1 : 0), 0);
    return { d, score };
  }).filter((x) => x.score > 0).sort((a, b) => b.score - a.score).slice(0, 5);
  const docs = scored.map((x) => ({ id: x.d.id, judul: x.d.judul, kategori: x.d.kategori, deskripsi: x.d.deskripsi }));
  const answer = docs.length
    ? `Ditemukan ${docs.length} dokumen relevan. Yang paling sesuai: "${docs[0].judul}" (${docs[0].kategori}). Buka dokumen untuk langkah lengkapnya.`
    : 'Belum ada dokumen aktif yang cocok dengan pertanyaan tersebut. Coba kata kunci lain atau tambahkan dokumennya.';
  res.json({ answer, docs });
});

// ===== Detail (catat view) =====
router.get('/:id', async (req, res) => {
  const id = Number(req.params.id);
  const [rows] = await pool.query('SELECT * FROM documents WHERE id=?', [id]);
  const d = rows[0];
  if (!d) return res.status(404).json({ error: 'Dokumen tidak ditemukan' });
  await pool.query('UPDATE documents SET views=views+1 WHERE id=?', [id]);
  await pool.query('INSERT INTO document_views (document_id, user_id, user_name) VALUES (?,?,?)', [id, req.user.id, req.user.name]);
  const [versions] = await pool.query('SELECT * FROM document_versions WHERE document_id=? ORDER BY id DESC', [id]);
  const [comments] = await pool.query('SELECT * FROM document_comments WHERE document_id=? ORDER BY id', [id]);
  const [[fav]] = await pool.query('SELECT COUNT(*) c FROM document_favorites WHERE document_id=? AND user_id=?', [id, req.user.id]);
  res.json({ document: { ...d, views: d.views + 1 }, versions, comments, favorited: fav.c > 0 });
});

// ===== Buat (koordinator/admin) =====
router.post('/', requireRole('admin', 'koordinator'), upload.single('file'), async (req, res) => {
  const b = req.body;
  if (!b.judul?.trim() || !b.kategori?.trim()) return res.status(400).json({ error: 'Judul & kategori wajib diisi.' });
  const fileUrl = req.file ? `/uploads/documents/${req.file.filename}` : null;
  const tags = splitTags(b.tags);
  const [r] = await pool.query(
    `INSERT INTO documents (nomor, judul, kategori, sub_kategori, deskripsi, tags, versi, tanggal_berlaku, tanggal_review, pemilik, unit_kerja, status, file_url, file_name, video_url, link_ref, catatan_revisi, created_by, creator_name)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [b.nomor || null, b.judul.trim(), b.kategori.trim(), b.sub_kategori || null, b.deskripsi || null, tags.join(', '), b.versi || '1.0', b.tanggal_berlaku || null, b.tanggal_review || null,
      b.pemilik || req.user.name, b.unit_kerja || 'Unit Elektronika Bandara', STATUSES.includes(b.status) ? b.status : 'draft', fileUrl, req.file?.originalname || null, b.video_url || null, b.link_ref || null, b.catatan_revisi || null, req.user.id, req.user.name]
  );
  await syncTags(r.insertId, tags);
  if (fileUrl) await pool.query('INSERT INTO document_versions (document_id, versi, file_url, catatan, created_by, creator_name) VALUES (?,?,?,?,?,?)', [r.insertId, b.versi || '1.0', fileUrl, 'Versi awal', req.user.id, req.user.name]);
  await audit(req.user, 'doc_create', 'document', r.insertId, b.judul);
  await notifyCoords(`📄 *Dokumen Baru*\n${b.judul} (${b.kategori}) oleh ${req.user.name}.`);
  const [rows] = await pool.query('SELECT * FROM documents WHERE id=?', [r.insertId]);
  res.status(201).json({ document: rows[0] });
});

// ===== Edit (file baru → versi baru) =====
router.put('/:id', requireRole('admin', 'koordinator'), upload.single('file'), async (req, res) => {
  const id = Number(req.params.id);
  const [rows] = await pool.query('SELECT * FROM documents WHERE id=?', [id]);
  const d = rows[0];
  if (!d) return res.status(404).json({ error: 'Dokumen tidak ditemukan' });
  const b = req.body;
  const fileUrl = req.file ? `/uploads/documents/${req.file.filename}` : null;
  const versi = b.versi || d.versi;
  const tags = b.tags != null ? splitTags(b.tags) : null;
  await pool.query(
    `UPDATE documents SET nomor=?, judul=?, kategori=?, sub_kategori=?, deskripsi=?, tags=?, versi=?, tanggal_berlaku=?, tanggal_review=?, pemilik=?, unit_kerja=?, video_url=?, link_ref=?, catatan_revisi=?, file_url=COALESCE(?,file_url), file_name=COALESCE(?,file_name) WHERE id=?`,
    [b.nomor ?? d.nomor, b.judul?.trim() || d.judul, b.kategori || d.kategori, b.sub_kategori ?? d.sub_kategori, b.deskripsi ?? d.deskripsi, tags ? tags.join(', ') : d.tags, versi,
      b.tanggal_berlaku || d.tanggal_berlaku, b.tanggal_review || d.tanggal_review, b.pemilik ?? d.pemilik, b.unit_kerja ?? d.unit_kerja, b.video_url ?? d.video_url, b.link_ref ?? d.link_ref, b.catatan_revisi ?? d.catatan_revisi, fileUrl, req.file?.originalname || null, id]
  );
  if (tags) await syncTags(id, tags);
  if (fileUrl) await pool.query('INSERT INTO document_versions (document_id, versi, file_url, catatan, created_by, creator_name) VALUES (?,?,?,?,?,?)', [id, versi, fileUrl, b.catatan_revisi || 'Revisi', req.user.id, req.user.name]);
  await audit(req.user, 'doc_update', 'document', id, b.judul || d.judul);
  const [u] = await pool.query('SELECT * FROM documents WHERE id=?', [id]);
  res.json({ document: u[0] });
});

// ===== Ubah status (workflow approval) =====
router.patch('/:id/status', requireRole('admin', 'koordinator'), async (req, res) => {
  const id = Number(req.params.id);
  const next = req.body.status;
  if (!STATUSES.includes(next)) return res.status(400).json({ error: 'Status tidak valid.' });
  const [rows] = await pool.query('SELECT judul, created_by, status FROM documents WHERE id=?', [id]);
  if (!rows[0]) return res.status(404).json({ error: 'Dokumen tidak ditemukan' });
  const ap = ['disetujui', 'aktif'].includes(next) ? ', approved_by=?, approver_name=?, approved_at=NOW()' : '';
  const params = ap ? [next, req.user.id, req.user.name, id] : [next, id];
  await pool.query(`UPDATE documents SET status=?${ap} WHERE id=?`, params);
  await audit(req.user, `doc_${next}`, 'document', id, rows[0].judul);
  if (rows[0].created_by && ['disetujui', 'aktif'].includes(next)) {
    try { if (await isNotifyEnabledForUser('pengajuan_keputusan', rows[0].created_by)) await queueWaNotification({ type: 'other', toUserId: rows[0].created_by, message: `Dokumen "${rows[0].judul}" berstatus *${next}*.` }); } catch { /* abaikan */ }
  }
  const [u] = await pool.query('SELECT * FROM documents WHERE id=?', [id]);
  res.json({ document: u[0] });
});

// ===== Komentar =====
router.post('/:id/comment', async (req, res) => {
  if (!req.body.body?.trim()) return res.status(400).json({ error: 'Komentar kosong.' });
  await pool.query('INSERT INTO document_comments (document_id, user_id, user_name, body) VALUES (?,?,?,?)', [Number(req.params.id), req.user.id, req.user.name, req.body.body.trim().slice(0, 1000)]);
  const [comments] = await pool.query('SELECT * FROM document_comments WHERE document_id=? ORDER BY id', [Number(req.params.id)]);
  res.json({ comments });
});

// ===== Favorit (toggle) =====
router.post('/:id/favorite', async (req, res) => {
  const id = Number(req.params.id);
  const [[ex]] = await pool.query('SELECT id FROM document_favorites WHERE document_id=? AND user_id=?', [id, req.user.id]);
  if (ex) { await pool.query('DELETE FROM document_favorites WHERE id=?', [ex.id]); return res.json({ favorited: false }); }
  await pool.query('INSERT INTO document_favorites (document_id, user_id) VALUES (?,?)', [id, req.user.id]);
  res.json({ favorited: true });
});

// ===== Hapus =====
router.delete('/:id', requireRole('admin', 'koordinator'), async (req, res) => {
  const [rows] = await pool.query('SELECT file_url, judul FROM documents WHERE id=?', [Number(req.params.id)]);
  if (!rows[0]) return res.status(404).json({ error: 'Dokumen tidak ditemukan' });
  await pool.query('DELETE FROM documents WHERE id=?', [Number(req.params.id)]);
  if (rows[0].file_url) { try { fs.unlinkSync(path.join(DIR, path.basename(rows[0].file_url))); } catch { /* abaikan */ } }
  await audit(req.user, 'doc_delete', 'document', req.params.id, rows[0].judul);
  res.json({ ok: true });
});

export default router;
