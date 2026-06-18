import { Router } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import * as XLSX from 'xlsx';
import { pool } from '../db/pool.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { queueWaNotification } from '../jobs/waQueue.js';
import { audit } from '../services/audit.js';

const router = Router();
router.use(requireAuth);

const ROMAN = ['', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII'];
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DIR = path.join(__dirname, '..', '..', 'uploads', 'diklat');
fs.mkdirSync(DIR, { recursive: true });
const upload = multer({
  storage: multer.diskStorage({ destination: (q, f, cb) => cb(null, DIR), filename: (q, f, cb) => cb(null, `DK${Date.now()}-${Math.round(Math.random() * 1e9)}${path.extname(f.originalname).toLowerCase()}`) }),
  limits: { fileSize: 15 * 1024 * 1024 },
  fileFilter: (q, f, cb) => cb(null, ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'].includes(f.mimetype)),
});

const isManager = (u) => ['admin', 'koordinator'].some((r) => (u.roles?.length ? u.roles : [u.role]).includes(r));
async function getLkp() {
  const [r] = await pool.query("SELECT setting_value FROM settings WHERE setting_key='lkp'");
  try { const v = r[0]?.setting_value; return (typeof v === 'string' ? JSON.parse(v) : v) || {}; } catch { return {}; }
}

// Nomor pengajuan otomatis: {seq}/DIKLAT/{kode}/{ROMAN bulan}/{tahun}, seq per tahun.
async function nextNomorPengajuan(conn) {
  const lkp = await getLkp();
  const kode = (lkp.nd_kode || 'ELBAND/APTP').trim();
  const now = new Date(), tahun = now.getFullYear(), bulan = now.getMonth() + 1;
  const [[r]] = await conn.query('SELECT COALESCE(MAX(seq),0)+1 s FROM pengajuan_diklat WHERE tahun=?', [tahun]);
  return { nomor: `${String(r.s).padStart(3, '0')}/DIKLAT/${kode}/${ROMAN[bulan]}/${tahun}`, seq: r.s, tahun };
}

// Workflow transitions yang diizinkan.
const FLOW = { draft: ['diajukan'], diajukan: ['diverifikasi', 'ditolak'], diverifikasi: ['disetujui', 'ditolak'], disetujui: ['selesai'], ditolak: [], selesai: [] };

async function withDetail(rows) {
  if (!rows.length) return rows;
  const ids = rows.map((r) => r.id);
  const [nd] = await pool.query(`SELECT id, sign_token, signer_name, signer_nip, signed_at FROM nota_dinas WHERE id IN (${rows.filter((r) => r.nota_dinas_id).map(() => '?').join(',') || 'NULL'})`, rows.filter((r) => r.nota_dinas_id).map((r) => r.nota_dinas_id));
  const ndMap = new Map(nd.map((n) => [n.id, n]));
  const [hist] = await pool.query(`SELECT * FROM diklat_history WHERE diklat_id IN (${ids.map(() => '?').join(',')}) ORDER BY id`, ids);
  return rows.map((r) => ({ ...r, nota: r.nota_dinas_id ? ndMap.get(r.nota_dinas_id) || null : null, history: hist.filter((h) => h.diklat_id === r.id) }));
}

async function logHistory(diklatId, user, status, note) {
  await pool.query('INSERT INTO diklat_history (diklat_id, user_id, user_name, status, note) VALUES (?,?,?,?,?)', [diklatId, user?.id || null, user?.name || null, status, note || null]);
}
async function notifyCoords(message) {
  const [c] = await pool.query("SELECT id FROM users WHERE active=1 AND (role='koordinator' OR JSON_CONTAINS(roles,'\"koordinator\"'))");
  for (const x of c) { try { await queueWaNotification({ type: 'other', toUserId: x.id, message }); } catch { /* abaikan */ } }
}

// ===== Dashboard statistik =====
router.get('/stats', async (req, res) => {
  const scope = isManager(req.user) ? '' : ' AND created_by=?';
  const params = isManager(req.user) ? [] : [req.user.id];
  const [[r]] = await pool.query(
    `SELECT COUNT(*) total,
            SUM(status IN ('diajukan','diverifikasi')) menunggu,
            SUM(status='disetujui') disetujui,
            SUM(status='ditolak') ditolak,
            SUM(status='selesai') selesai,
            SUM(status='draft') draft
       FROM pengajuan_diklat WHERE 1=1${scope}`, params);
  res.json({ stats: { total: r.total || 0, menunggu: Number(r.menunggu) || 0, disetujui: Number(r.disetujui) || 0, ditolak: Number(r.ditolak) || 0, selesai: Number(r.selesai) || 0, draft: Number(r.draft) || 0 } });
});

// ===== Daftar (filter tahun/status/pencarian) =====
function buildList(req) {
  let sql = 'SELECT * FROM pengajuan_diklat WHERE 1=1';
  const params = [];
  if (!isManager(req.user)) { sql += ' AND created_by=?'; params.push(req.user.id); }
  if (/^\d{4}$/.test(req.query.year)) { sql += ' AND tahun=?'; params.push(Number(req.query.year)); }
  if (['draft', 'diajukan', 'diverifikasi', 'disetujui', 'ditolak', 'selesai'].includes(req.query.status)) { sql += ' AND status=?'; params.push(req.query.status); }
  if (req.query.q) { sql += ' AND (nama_diklat LIKE ? OR pegawai_nama LIKE ? OR nomor_pengajuan LIKE ? OR penyelenggara LIKE ?)'; const k = `%${req.query.q}%`; params.push(k, k, k, k); }
  return { sql, params };
}
router.get('/', async (req, res) => {
  const { sql, params } = buildList(req);
  const [rows] = await pool.query(sql + ' ORDER BY created_at DESC', params);
  res.json({ diklat: await withDetail(rows) });
});

// ===== Export Excel =====
router.get('/export', requireRole('admin', 'koordinator'), async (req, res) => {
  const { sql, params } = buildList(req);
  const [rows] = await pool.query(sql + ' ORDER BY tanggal_pengajuan DESC', params);
  const data = rows.map((r) => ({
    'No. Pengajuan': r.nomor_pengajuan, 'Tgl Pengajuan': r.tanggal_pengajuan, 'Pegawai': r.pegawai_nama, 'NIP': r.nip, 'Jabatan': r.jabatan,
    'Unit Kerja': r.unit_kerja, 'Nama Diklat': r.nama_diklat, 'Penyelenggara': r.penyelenggara, 'Lokasi': r.lokasi,
    'Mulai': r.tanggal_mulai, 'Selesai': r.tanggal_selesai, 'Durasi': r.durasi, 'Biaya': r.biaya, 'Status': r.status, 'No. Nota Dinas': r.nomor_nota_dinas || '-',
  }));
  const ws = XLSX.utils.json_to_sheet(data);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Pengajuan Diklat');
  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', 'attachment; filename="pengajuan-diklat.xlsx"');
  res.send(buf);
});

// ===== Detail =====
router.get('/:id', async (req, res) => {
  const [rows] = await pool.query('SELECT * FROM pengajuan_diklat WHERE id=?', [Number(req.params.id)]);
  if (!rows[0]) return res.status(404).json({ error: 'Pengajuan tidak ditemukan' });
  if (!isManager(req.user) && rows[0].created_by !== req.user.id) return res.status(403).json({ error: 'Tidak punya akses.' });
  res.json({ diklat: (await withDetail(rows))[0] });
});

// ===== Buat (status draft) =====
router.post('/', upload.single('file'), async (req, res) => {
  const b = req.body;
  if (!b.nama_diklat?.trim()) return res.status(400).json({ error: 'Nama diklat wajib diisi.' });
  const conn = await pool.getConnection();
  try {
    const { nomor, seq, tahun } = await nextNomorPengajuan(conn);
    const file = req.file ? `/uploads/diklat/${req.file.filename}` : null;
    const [r] = await conn.query(
      `INSERT INTO pengajuan_diklat (nomor_pengajuan, seq, tahun, tanggal_pengajuan, pegawai_id, pegawai_nama, nip, jabatan, unit_kerja, nama_diklat, penyelenggara, lokasi, tanggal_mulai, tanggal_selesai, durasi, biaya, tujuan, keterangan, file_pendukung, status, created_by, creator_name)
       VALUES (?,?,?,CURDATE(),?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'draft',?,?)`,
      [nomor, seq, tahun, b.pegawai_id || req.user.id, b.pegawai_nama || req.user.name, b.nip || null, b.jabatan || null, b.unit_kerja || null,
        b.nama_diklat.trim(), b.penyelenggara || null, b.lokasi || null, b.tanggal_mulai || null, b.tanggal_selesai || null, b.durasi || null,
        Number(b.biaya) || 0, b.tujuan || null, b.keterangan || null, file, req.user.id, req.user.name]
    );
    await logHistory(r.insertId, req.user, 'draft', 'Pengajuan dibuat');
    const [rows] = await conn.query('SELECT * FROM pengajuan_diklat WHERE id=?', [r.insertId]);
    res.status(201).json({ diklat: (await withDetail(rows))[0] });
  } finally { conn.release(); }
});

// ===== Edit (pemilik saat draft/diajukan, atau manager) =====
router.put('/:id', upload.single('file'), async (req, res) => {
  const id = Number(req.params.id);
  const [rows] = await pool.query('SELECT * FROM pengajuan_diklat WHERE id=?', [id]);
  const d = rows[0];
  if (!d) return res.status(404).json({ error: 'Pengajuan tidak ditemukan' });
  if (!isManager(req.user) && (d.created_by !== req.user.id || !['draft', 'diajukan'].includes(d.status))) return res.status(403).json({ error: 'Tidak bisa mengubah pengajuan ini.' });
  const b = req.body;
  const file = req.file ? `/uploads/diklat/${req.file.filename}` : null;
  await pool.query(
    `UPDATE pengajuan_diklat SET pegawai_nama=?, nip=?, jabatan=?, unit_kerja=?, nama_diklat=?, penyelenggara=?, lokasi=?, tanggal_mulai=?, tanggal_selesai=?, durasi=?, biaya=?, tujuan=?, keterangan=?, file_pendukung=COALESCE(?,file_pendukung) WHERE id=?`,
    [b.pegawai_nama || d.pegawai_nama, b.nip ?? d.nip, b.jabatan ?? d.jabatan, b.unit_kerja ?? d.unit_kerja, b.nama_diklat?.trim() || d.nama_diklat, b.penyelenggara ?? d.penyelenggara,
      b.lokasi ?? d.lokasi, b.tanggal_mulai || d.tanggal_mulai, b.tanggal_selesai || d.tanggal_selesai, b.durasi ?? d.durasi, Number(b.biaya) || d.biaya, b.tujuan ?? d.tujuan, b.keterangan ?? d.keterangan, file, id]
  );
  const [u] = await pool.query('SELECT * FROM pengajuan_diklat WHERE id=?', [id]);
  res.json({ diklat: (await withDetail(u))[0] });
});

// ===== Workflow: ubah status =====
router.patch('/:id/status', async (req, res) => {
  const id = Number(req.params.id);
  const next = req.body.status;
  const note = (req.body.note || '').slice(0, 255) || null;
  const [rows] = await pool.query('SELECT * FROM pengajuan_diklat WHERE id=?', [id]);
  const d = rows[0];
  if (!d) return res.status(404).json({ error: 'Pengajuan tidak ditemukan' });
  if (!FLOW[d.status]?.includes(next)) return res.status(400).json({ error: `Transisi ${d.status} → ${next} tidak valid.` });
  if (next === 'selesai' && !d.laporan_url) return res.status(400).json({ error: 'Unggah laporan hasil diklat terlebih dahulu sebelum menandai Selesai.' });
  // Hak akses: 'diajukan' oleh pengusul/manager; sisanya oleh koordinator/admin.
  if (next === 'diajukan') { if (d.created_by !== req.user.id && !isManager(req.user)) return res.status(403).json({ error: 'Hanya pengusul yang dapat mengajukan.' }); }
  else if (!isManager(req.user)) return res.status(403).json({ error: 'Hanya koordinator/admin.' });

  const setApprove = next === 'disetujui' ? ', approved_by=?, approver_name=?, approved_at=NOW()' : '';
  const params = next === 'disetujui' ? [next, req.user.id, req.user.name, id] : [next, id];
  await pool.query(`UPDATE pengajuan_diklat SET status=?${setApprove} WHERE id=?`, params);
  await logHistory(id, req.user, next, note);
  await audit(req.user, `diklat_${next}`, 'diklat', id, `${d.nomor_pengajuan} · ${d.nama_diklat}`);
  // Notifikasi
  if (next === 'diajukan') await notifyCoords(`📚 *Pengajuan Diklat Baru*\n${d.pegawai_nama}: ${d.nama_diklat}\nNo. ${d.nomor_pengajuan}\nMohon ditinjau.`);
  if (['disetujui', 'ditolak', 'selesai'].includes(next) && d.created_by) {
    try { await queueWaNotification({ type: 'other', toUserId: d.created_by, message: `Pengajuan diklat "${d.nama_diklat}" (${d.nomor_pengajuan}) berstatus *${next}*${note ? `\nCatatan: ${note}` : ''}.` }); } catch { /* abaikan */ }
  }
  const [u] = await pool.query('SELECT * FROM pengajuan_diklat WHERE id=?', [id]);
  res.json({ diklat: (await withDetail(u))[0] });
});

// ===== Generate Nota Dinas (otomatis nomor, masuk registri Surat Keluar + bisa TTE) =====
router.post('/:id/nota-dinas', requireRole('admin', 'koordinator'), async (req, res) => {
  const id = Number(req.params.id);
  const [rows] = await pool.query('SELECT * FROM pengajuan_diklat WHERE id=?', [id]);
  const d = rows[0];
  if (!d) return res.status(404).json({ error: 'Pengajuan tidak ditemukan' });
  if (d.nota_dinas_id) { const [nd] = await pool.query('SELECT * FROM nota_dinas WHERE id=?', [d.nota_dinas_id]); if (nd[0]) return res.json({ ok: true, nota: nd[0], reused: true }); }
  const conn = await pool.getConnection();
  try {
    const lkp = await getLkp();
    const kode = (lkp.nd_kode || 'ELBAND/APTP').trim();
    const now = new Date(), bulan = now.getMonth() + 1, tahun = now.getFullYear();
    const [[s]] = await conn.query('SELECT COALESCE(MAX(seq),0)+1 s FROM nota_dinas WHERE bulan=? AND tahun=?', [bulan, tahun]);
    const nomor = `${String(s.s).padStart(3, '0')}/${kode}/${ROMAN[bulan]}/${tahun}`;
    const hal = `Permohonan Pelaksanaan Diklat ${d.nama_diklat} a.n. ${d.pegawai_nama}`;
    const body = `Dengan ini diajukan permohonan pelaksanaan diklat "${d.nama_diklat}" yang diselenggarakan oleh ${d.penyelenggara || '-'} di ${d.lokasi || '-'} pada ${d.tanggal_mulai || '-'} s/d ${d.tanggal_selesai || '-'} a.n. ${d.pegawai_nama} (${d.nip || '-'}), dan mohon persetujuannya guna proses lebih lanjut.`;
    const [r] = await conn.query(
      `INSERT INTO nota_dinas (jenis, nomor, seq, bulan, tahun, hal, body, tanggal, created_by, creator_name) VALUES ('Nota Dinas',?,?,?,?,?,?,CURDATE(),?,?)`,
      [nomor, s.s, bulan, tahun, hal, body, req.user.id, req.user.name]
    );
    await conn.query('UPDATE pengajuan_diklat SET nomor_nota_dinas=?, nota_dinas_id=? WHERE id=?', [nomor, r.insertId, id]);
    const [nd] = await conn.query('SELECT * FROM nota_dinas WHERE id=?', [r.insertId]);
    res.status(201).json({ ok: true, nota: nd[0] });
  } finally { conn.release(); }
});

// ===== Upload laporan hasil diklat =====
router.post('/:id/laporan', upload.single('laporan'), async (req, res) => {
  const id = Number(req.params.id);
  const [rows] = await pool.query('SELECT * FROM pengajuan_diklat WHERE id=?', [id]);
  const d = rows[0];
  if (!d) return res.status(404).json({ error: 'Pengajuan tidak ditemukan' });
  if (!isManager(req.user) && d.created_by !== req.user.id) return res.status(403).json({ error: 'Tidak punya akses.' });
  if (!['disetujui', 'selesai'].includes(d.status)) return res.status(400).json({ error: 'Laporan hanya bisa diunggah setelah pengajuan disetujui.' });
  if (!req.file) return res.status(400).json({ error: 'File laporan wajib diunggah.' });
  const url = `/uploads/diklat/${req.file.filename}`;
  await pool.query('UPDATE pengajuan_diklat SET laporan_url=?, laporan_at=NOW() WHERE id=?', [url, id]);
  await logHistory(id, req.user, d.status, 'Laporan hasil diklat diunggah');
  await audit(req.user, 'diklat_laporan', 'diklat', id, d.nomor_pengajuan);
  await notifyCoords(`📄 *Laporan Diklat Diunggah*\n${d.pegawai_nama}: ${d.nama_diklat}\nNo. ${d.nomor_pengajuan}`);
  const [u] = await pool.query('SELECT * FROM pengajuan_diklat WHERE id=?', [id]);
  res.json({ diklat: (await withDetail(u))[0] });
});

// ===== Hapus =====
router.delete('/:id', async (req, res) => {
  const id = Number(req.params.id);
  const [rows] = await pool.query('SELECT created_by, status, file_pendukung FROM pengajuan_diklat WHERE id=?', [id]);
  const d = rows[0];
  if (!d) return res.status(404).json({ error: 'Pengajuan tidak ditemukan' });
  if (!isManager(req.user) && (d.created_by !== req.user.id || d.status !== 'draft')) return res.status(403).json({ error: 'Hanya draft milik sendiri yang bisa dihapus.' });
  await pool.query('DELETE FROM pengajuan_diklat WHERE id=?', [id]);
  if (d.file_pendukung) { try { fs.unlinkSync(path.join(DIR, path.basename(d.file_pendukung))); } catch { /* abaikan */ } }
  await audit(req.user, 'diklat_delete', 'diklat', id, null);
  res.json({ ok: true });
});

export default router;
