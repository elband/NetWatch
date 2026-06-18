import { Router } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { pool } from '../db/pool.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { queueWaNotification } from '../jobs/waQueue.js';
import { notifyRoles } from '../services/notify.js';
import { audit } from '../services/audit.js';

const router = Router();
router.use(requireAuth);

const ROMAN = ['', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII'];
const WEIGHT = { rendah: 1, sedang: 3, tinggi: 5, kritis: 10 };
const STATUSES = ['draft', 'diajukan', 'diverifikasi', 'disetujui', 'ditolak', 'selesai'];
const FLOW = { draft: ['diajukan'], diajukan: ['diverifikasi', 'ditolak'], diverifikasi: ['disetujui', 'ditolak'], disetujui: ['selesai'], ditolak: [], selesai: [] };
const isManager = (u) => ['admin', 'koordinator'].some((r) => (u.roles?.length ? u.roles : [u.role]).includes(r));

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DIR = path.join(__dirname, '..', '..', 'uploads', 'kegiatan');
fs.mkdirSync(DIR, { recursive: true });
const upload = multer({
  storage: multer.diskStorage({ destination: (q, f, cb) => cb(null, DIR), filename: (q, f, cb) => cb(null, `K${Date.now()}-${Math.round(Math.random() * 1e9)}${path.extname(f.originalname).toLowerCase()}`) }),
  limits: { fileSize: 20 * 1024 * 1024, files: 20 },
});
const uploadFields = upload.fields([{ name: 'foto', maxCount: 10 }, { name: 'dokumen', maxCount: 10 }]);

async function getLkp() {
  const [r] = await pool.query("SELECT setting_value FROM settings WHERE setting_key='lkp'");
  try { const v = r[0]?.setting_value; return (typeof v === 'string' ? JSON.parse(v) : v) || {}; } catch { return {}; }
}
async function nextNomor(conn) {
  const lkp = await getLkp(); const kode = (lkp.nd_kode || 'ELBAND/APTP').trim();
  const now = new Date(), tahun = now.getFullYear(), bulan = now.getMonth() + 1;
  const [[r]] = await conn.query('SELECT COALESCE(MAX(seq),0)+1 s FROM kegiatan_non_rutin WHERE tahun=?', [tahun]);
  return { nomor: `${String(r.s).padStart(3, '0')}/KNR/${kode}/${ROMAN[bulan]}/${tahun}`, seq: r.s, tahun };
}
async function withDetail(rows) {
  if (!rows.length) return rows;
  const ids = rows.map((r) => r.id);
  const [files] = await pool.query(`SELECT * FROM kegiatan_non_rutin_files WHERE kegiatan_id IN (${ids.map(() => '?').join(',')})`, ids);
  const [appr] = await pool.query(`SELECT * FROM kegiatan_non_rutin_approval WHERE kegiatan_id IN (${ids.map(() => '?').join(',')}) ORDER BY id`, ids);
  return rows.map((r) => ({ ...r, files: files.filter((f) => f.kegiatan_id === r.id), approval: appr.filter((a) => a.kegiatan_id === r.id) }));
}
async function logApproval(id, user, status, note, poin) {
  await pool.query('INSERT INTO kegiatan_non_rutin_approval (kegiatan_id, user_id, user_name, status, note, poin) VALUES (?,?,?,?,?,?)', [id, user?.id || null, user?.name || null, status, note || null, poin ?? null]);
}
async function notifyCoords(message) {
  const [c] = await pool.query("SELECT id FROM users WHERE active=1 AND (role='koordinator' OR JSON_CONTAINS(roles,'\"koordinator\"'))");
  for (const x of c) { try { await queueWaNotification({ type: 'other', toUserId: x.id, message }); } catch { /* abaikan */ } }
}
function monthRange(month) {
  const [y, m] = month.split('-').map(Number);
  return { start: `${month}-01`, end: `${m === 12 ? y + 1 : y}-${String(m === 12 ? 1 : m + 1).padStart(2, '0')}-01`, y, m };
}

// ===== Kategori =====
router.get('/categories', async (req, res) => {
  const [rows] = await pool.query('SELECT * FROM kegiatan_non_rutin_categories ORDER BY sort_order, name');
  res.json({ categories: rows });
});
router.post('/categories', requireRole('admin'), async (req, res) => { if (!req.body.name?.trim()) return res.status(400).json({ error: 'Nama wajib.' }); await pool.query('INSERT INTO kegiatan_non_rutin_categories (name) VALUES (?) ON DUPLICATE KEY UPDATE name=VALUES(name)', [req.body.name.trim()]); res.json({ ok: true }); });
router.delete('/categories/:id', requireRole('admin'), async (req, res) => { await pool.query('DELETE FROM kegiatan_non_rutin_categories WHERE id=?', [Number(req.params.id)]); res.json({ ok: true }); });

// ===== Dashboard =====
router.get('/stats', async (req, res) => {
  const month = /^\d{4}-\d{2}$/.test(req.query.month) ? req.query.month : new Date().toISOString().slice(0, 7);
  const { start, end } = monthRange(month);
  const [[s]] = await pool.query(
    `SELECT COUNT(*) total, SUM(status='selesai') selesai, SUM(status IN ('diajukan','diverifikasi')) menunggu,
            COALESCE(SUM(durasi_jam),0) jam, COALESCE(SUM(poin),0) poin, SUM(tingkat_kesulitan='kritis') kritis
       FROM kegiatan_non_rutin WHERE tanggal_kegiatan>=? AND tanggal_kegiatan<?`, [start, end]);
  const [topKontrib] = await pool.query('SELECT petugas_nama nama, COUNT(*) jumlah, COALESCE(SUM(poin),0) poin FROM kegiatan_non_rutin WHERE tanggal_kegiatan>=? AND tanggal_kegiatan<? GROUP BY petugas_nama ORDER BY poin DESC LIMIT 5', [start, end]);
  const [topKategori] = await pool.query('SELECT kategori, COUNT(*) jumlah FROM kegiatan_non_rutin WHERE tanggal_kegiatan>=? AND tanggal_kegiatan<? GROUP BY kategori ORDER BY jumlah DESC LIMIT 5', [start, end]);
  const insight = [];
  const total = s.total || 0;
  if (total > 0) {
    insight.push(`Pada periode ini terdapat ${total} kegiatan non-rutin dengan total ${Number(s.jam)} jam kontribusi dan ${Number(s.poin)} poin kinerja tambahan.`);
    if (topKategori[0]) insight.push(`Kegiatan terbanyak adalah ${topKategori[0].kategori} sebanyak ${topKategori[0].jumlah} kegiatan.`);
    if (topKontrib[0]?.nama) insight.push(`Kontributor tertinggi adalah ${topKontrib[0].nama} dengan ${topKontrib[0].poin} poin.`);
    if (Number(s.kritis) > 0) insight.push(`Terdapat ${s.kritis} kegiatan tingkat kritis yang berhasil ditangani.`);
  } else insight.push('Belum ada kegiatan non-rutin pada periode ini.');
  res.json({
    month,
    stats: { total, selesai: Number(s.selesai) || 0, menunggu: Number(s.menunggu) || 0, jam: Number(s.jam) || 0, poin: Number(s.poin) || 0, kritis: Number(s.kritis) || 0 },
    topKontributor: topKontrib, topKategori, insight: insight.join(' '),
  });
});

// ===== Rekap bulanan =====
router.get('/recap', requireRole('admin', 'koordinator'), async (req, res) => {
  const month = /^\d{4}-\d{2}$/.test(req.query.month) ? req.query.month : new Date().toISOString().slice(0, 7);
  const { start, end } = monthRange(month);
  const [[tot]] = await pool.query('SELECT COUNT(*) total, COALESCE(SUM(durasi_jam),0) jam, COALESCE(SUM(poin),0) poin FROM kegiatan_non_rutin WHERE tanggal_kegiatan>=? AND tanggal_kegiatan<?', [start, end]);
  const [perKategori] = await pool.query('SELECT kategori, COUNT(*) jumlah, COALESCE(SUM(poin),0) poin FROM kegiatan_non_rutin WHERE tanggal_kegiatan>=? AND tanggal_kegiatan<? GROUP BY kategori ORDER BY jumlah DESC', [start, end]);
  const [perTeknisi] = await pool.query('SELECT petugas_nama nama, COUNT(*) jumlah, COALESCE(SUM(durasi_jam),0) jam, COALESCE(SUM(poin),0) poin FROM kegiatan_non_rutin WHERE tanggal_kegiatan>=? AND tanggal_kegiatan<? GROUP BY petugas_nama ORDER BY poin DESC', [start, end]);
  // Tren 6 bulan.
  const tren = [];
  const base = new Date(`${month}-01T00:00:00`);
  for (let i = 5; i >= 0; i--) {
    const dt = new Date(base.getFullYear(), base.getMonth() - i, 1);
    const r = monthRange(`${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}`);
    const [[c]] = await pool.query('SELECT COUNT(*) c, COALESCE(SUM(poin),0) p FROM kegiatan_non_rutin WHERE tanggal_kegiatan>=? AND tanggal_kegiatan<?', [r.start, r.end]);
    tren.push({ label: dt.toLocaleDateString('id-ID', { month: 'short' }), jumlah: c.c, poin: Number(c.p) });
  }
  res.json({ month, total: tot.total, jam: Number(tot.jam), poin: Number(tot.poin), perKategori, perTeknisi, tren });
});

// ===== Daftar =====
router.get('/', async (req, res) => {
  let sql = 'SELECT * FROM kegiatan_non_rutin WHERE 1=1';
  const params = [];
  if (!isManager(req.user)) { sql += ' AND created_by=?'; params.push(req.user.id); }
  if (/^\d{4}-\d{2}$/.test(req.query.month)) { const r = monthRange(req.query.month); sql += ' AND tanggal_kegiatan>=? AND tanggal_kegiatan<?'; params.push(r.start, r.end); }
  if (STATUSES.includes(req.query.status)) { sql += ' AND status=?'; params.push(req.query.status); }
  if (req.query.kategori) { sql += ' AND kategori=?'; params.push(req.query.kategori); }
  if (req.query.q) { const k = `%${req.query.q}%`; sql += ' AND (judul LIKE ? OR petugas_nama LIKE ? OR nomor LIKE ? OR lokasi LIKE ?)'; params.push(k, k, k, k); }
  const [rows] = await pool.query(sql + ' ORDER BY tanggal_kegiatan DESC, id DESC', params);
  res.json({ kegiatan: await withDetail(rows) });
});

// ===== Detail =====
router.get('/:id', async (req, res) => {
  const [rows] = await pool.query('SELECT * FROM kegiatan_non_rutin WHERE id=?', [Number(req.params.id)]);
  if (!rows[0]) return res.status(404).json({ error: 'Kegiatan tidak ditemukan' });
  if (!isManager(req.user) && rows[0].created_by !== req.user.id) return res.status(403).json({ error: 'Tidak punya akses.' });
  res.json({ kegiatan: (await withDetail(rows))[0] });
});

// ===== Buat =====
router.post('/', uploadFields, async (req, res) => {
  const b = req.body;
  if (!b.judul?.trim() || !b.kategori?.trim()) return res.status(400).json({ error: 'Judul & kategori wajib diisi.' });
  const tingkat = WEIGHT[b.tingkat_kesulitan] ? b.tingkat_kesulitan : 'rendah';
  const conn = await pool.getConnection();
  try {
    const { nomor, seq, tahun } = await nextNomor(conn);
    const [r] = await conn.query(
      `INSERT INTO kegiatan_non_rutin (nomor, seq, tahun, tanggal_kegiatan, petugas_id, petugas_nama, unit_kerja, kategori, judul, lokasi, uraian, hasil, durasi_jam, jumlah_personel, tingkat_kesulitan, poin, status, created_by, creator_name)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'draft',?,?)`,
      [nomor, seq, tahun, b.tanggal_kegiatan || new Date().toISOString().slice(0, 10), b.petugas_id || req.user.id, b.petugas_nama || req.user.name, b.unit_kerja || 'Unit Elektronika Bandara',
        b.kategori.trim(), b.judul.trim(), b.lokasi || null, b.uraian || null, b.hasil || null, Number(b.durasi_jam) || 0, Number(b.jumlah_personel) || 1, tingkat, WEIGHT[tingkat], req.user.id, req.user.name]
    );
    for (const f of req.files?.foto || []) await conn.query('INSERT INTO kegiatan_non_rutin_files (kegiatan_id, file_url, filename, mimetype, jenis) VALUES (?,?,?,?,?)', [r.insertId, `/uploads/kegiatan/${f.filename}`, f.originalname.slice(0, 200), f.mimetype, 'foto']);
    for (const f of req.files?.dokumen || []) await conn.query('INSERT INTO kegiatan_non_rutin_files (kegiatan_id, file_url, filename, mimetype, jenis) VALUES (?,?,?,?,?)', [r.insertId, `/uploads/kegiatan/${f.filename}`, f.originalname.slice(0, 200), f.mimetype, 'dokumen']);
    await logApproval(r.insertId, req.user, 'draft', 'Kegiatan dibuat', null);
    const [rows] = await conn.query('SELECT * FROM kegiatan_non_rutin WHERE id=?', [r.insertId]);
    res.status(201).json({ kegiatan: (await withDetail(rows))[0] });
  } finally { conn.release(); }
});

// ===== Edit =====
router.put('/:id', uploadFields, async (req, res) => {
  const id = Number(req.params.id);
  const [rows] = await pool.query('SELECT * FROM kegiatan_non_rutin WHERE id=?', [id]);
  const d = rows[0];
  if (!d) return res.status(404).json({ error: 'Kegiatan tidak ditemukan' });
  if (!isManager(req.user) && (d.created_by !== req.user.id || !['draft', 'diajukan'].includes(d.status))) return res.status(403).json({ error: 'Tidak bisa mengubah kegiatan ini.' });
  const b = req.body;
  const tingkat = WEIGHT[b.tingkat_kesulitan] ? b.tingkat_kesulitan : d.tingkat_kesulitan;
  await pool.query(
    `UPDATE kegiatan_non_rutin SET tanggal_kegiatan=?, petugas_nama=?, unit_kerja=?, kategori=?, judul=?, lokasi=?, uraian=?, hasil=?, durasi_jam=?, jumlah_personel=?, tingkat_kesulitan=?, poin=? WHERE id=?`,
    [b.tanggal_kegiatan || d.tanggal_kegiatan, b.petugas_nama || d.petugas_nama, b.unit_kerja ?? d.unit_kerja, b.kategori || d.kategori, b.judul?.trim() || d.judul, b.lokasi ?? d.lokasi, b.uraian ?? d.uraian, b.hasil ?? d.hasil, Number(b.durasi_jam) || d.durasi_jam, Number(b.jumlah_personel) || d.jumlah_personel, tingkat, WEIGHT[tingkat], id]
  );
  for (const f of req.files?.foto || []) await pool.query('INSERT INTO kegiatan_non_rutin_files (kegiatan_id, file_url, filename, mimetype, jenis) VALUES (?,?,?,?,?)', [id, `/uploads/kegiatan/${f.filename}`, f.originalname.slice(0, 200), f.mimetype, 'foto']);
  for (const f of req.files?.dokumen || []) await pool.query('INSERT INTO kegiatan_non_rutin_files (kegiatan_id, file_url, filename, mimetype, jenis) VALUES (?,?,?,?,?)', [id, `/uploads/kegiatan/${f.filename}`, f.originalname.slice(0, 200), f.mimetype, 'dokumen']);
  const [u] = await pool.query('SELECT * FROM kegiatan_non_rutin WHERE id=?', [id]);
  res.json({ kegiatan: (await withDetail(u))[0] });
});

// ===== Workflow (+ catatan + bobot/poin) =====
router.patch('/:id/status', async (req, res) => {
  const id = Number(req.params.id);
  const next = req.body.status;
  const note = (req.body.note || '').slice(0, 255) || null;
  const poinOverride = req.body.poin != null && req.body.poin !== '' ? Number(req.body.poin) : null;
  const [rows] = await pool.query('SELECT * FROM kegiatan_non_rutin WHERE id=?', [id]);
  const d = rows[0];
  if (!d) return res.status(404).json({ error: 'Kegiatan tidak ditemukan' });
  if (!FLOW[d.status]?.includes(next)) return res.status(400).json({ error: `Transisi ${d.status} → ${next} tidak valid.` });
  if (next === 'diajukan') { if (d.created_by !== req.user.id && !isManager(req.user)) return res.status(403).json({ error: 'Hanya pengusul yang dapat mengajukan.' }); }
  else if (!isManager(req.user)) return res.status(403).json({ error: 'Hanya koordinator/admin.' });

  const conn = await pool.getConnection();
  try {
    const fields = ['status=?']; const params = [next];
    if (poinOverride != null && isManager(req.user)) { fields.push('poin=?'); params.push(poinOverride); }
    if (note && isManager(req.user)) { fields.push('catatan_koordinator=?'); params.push(note); }
    if (next === 'disetujui') { fields.push('approved_by=?', 'approver_name=?', 'approved_at=NOW()'); params.push(req.user.id, req.user.name); }
    params.push(id);
    await conn.query(`UPDATE kegiatan_non_rutin SET ${fields.join(', ')} WHERE id=?`, params);
    await logApproval(id, req.user, next, note, poinOverride);
    // Disetujui → otomatis catat Nota Dinas keluar (jika belum).
    if (next === 'disetujui' && !d.nota_dinas_id) {
      const lkp = await getLkp(); const kode = (lkp.nd_kode || 'ELBAND/APTP').trim();
      const now = new Date(), bulan = now.getMonth() + 1, tahun = now.getFullYear();
      const [[s]] = await conn.query('SELECT COALESCE(MAX(seq),0)+1 s FROM nota_dinas WHERE bulan=? AND tahun=?', [bulan, tahun]);
      const ndNomor = `${String(s.s).padStart(3, '0')}/${kode}/${ROMAN[bulan]}/${tahun}`;
      const hal = `Laporan Kegiatan Non-Rutin: ${d.judul}`;
      const body = `Dengan ini dilaporkan pelaksanaan kegiatan non-rutin "${d.judul}" (${d.kategori}) di ${d.lokasi || '-'} pada ${d.tanggal_kegiatan} oleh ${d.petugas_nama}. Hasil: ${d.hasil || '-'}.`;
      const [nd] = await conn.query(`INSERT INTO nota_dinas (jenis, nomor, seq, bulan, tahun, hal, body, tanggal, created_by, creator_name) VALUES ('Nota Dinas',?,?,?,?,?,?,CURDATE(),?,?)`, [ndNomor, s.s, bulan, tahun, hal, body, req.user.id, req.user.name]);
      await conn.query('UPDATE kegiatan_non_rutin SET nomor_nota_dinas=?, nota_dinas_id=? WHERE id=?', [ndNomor, nd.insertId, id]);
    }
  } finally { conn.release(); }
  await audit(req.user, `knr_${next}`, 'kegiatan', id, `${d.nomor} · ${d.judul}`);
  if (next === 'diajukan') {
    await notifyCoords(`📝 *Kegiatan Non-Rutin Baru*\n${d.petugas_nama}: ${d.judul}\nNo. ${d.nomor}\nMohon ditinjau.`);
    await notifyRoles(['koordinator', 'admin'], { type: 'knr_new', title: `Kegiatan non-rutin baru: ${d.judul}`, message: `${d.petugas_nama} · ${d.nomor} — mohon ditinjau.`, refId: id, refType: 'kegiatan', link: `/kegiatan-nr?focus=${id}` });
  }
  if (['disetujui', 'ditolak', 'selesai'].includes(next) && d.created_by) { try { await queueWaNotification({ type: 'other', toUserId: d.created_by, message: `Kegiatan "${d.judul}" (${d.nomor}) berstatus *${next}*${note ? `\nCatatan: ${note}` : ''}.` }); } catch { /* abaikan */ } }
  const [u] = await pool.query('SELECT * FROM kegiatan_non_rutin WHERE id=?', [id]);
  res.json({ kegiatan: (await withDetail(u))[0] });
});

// ===== Hapus =====
router.delete('/:id', async (req, res) => {
  const [rows] = await pool.query('SELECT created_by, status FROM kegiatan_non_rutin WHERE id=?', [Number(req.params.id)]);
  const d = rows[0];
  if (!d) return res.status(404).json({ error: 'Kegiatan tidak ditemukan' });
  if (!isManager(req.user) && (d.created_by !== req.user.id || d.status !== 'draft')) return res.status(403).json({ error: 'Hanya draft milik sendiri yang bisa dihapus.' });
  const [files] = await pool.query('SELECT file_url FROM kegiatan_non_rutin_files WHERE kegiatan_id=?', [Number(req.params.id)]);
  await pool.query('DELETE FROM kegiatan_non_rutin WHERE id=?', [Number(req.params.id)]);
  for (const f of files) { try { fs.unlinkSync(path.join(DIR, path.basename(f.file_url))); } catch { /* abaikan */ } }
  await audit(req.user, 'knr_delete', 'kegiatan', req.params.id, null);
  res.json({ ok: true });
});

export default router;
