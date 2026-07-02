import { Router } from 'express';
import crypto from 'crypto';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { pool } from '../db/pool.js';
import { env } from '../config/env.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { unitScope, unitFilter, rowInUnit, insertUnitId } from '../middleware/unitScope.js';
import { queueWaRaw } from '../jobs/waQueue.js';
import { buildLaporanData } from './laporanRoutes.js';
import { createNotification } from '../services/notify.js';
import { renderDocPdf } from '../services/pdfRenderer.js';
import { sendToSiKeren, isSiKerenConfigured } from '../services/siKerenService.js';

const router = Router();
router.use(requireAuth);
router.use(unitScope); // scoping multi-unit — endpoint publik (by token) diekspor terpisah, tidak lewat router ini

const ROMAN = ['', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII'];

// Penyimpanan lampiran bukti dukung surat keluar.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const UPLOAD_DIR = path.join(__dirname, '..', '..', 'uploads', 'surat');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });
const ALLOWED = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'application/pdf'];
const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, UPLOAD_DIR),
    filename: (req, file, cb) => cb(null, `${Date.now()}-${Math.round(Math.random() * 1e9)}${path.extname(file.originalname).toLowerCase()}`),
  }),
  limits: { fileSize: 10 * 1024 * 1024, files: 10 },
  fileFilter: (req, file, cb) => cb(null, ALLOWED.includes(file.mimetype)),
});

// Sisipkan daftar lampiran ke tiap surat.
async function withLampiran(rows) {
  if (!rows.length) return rows;
  const ids = rows.map((r) => r.id);
  const [lamp] = await pool.query(`SELECT id, surat_id, file_url, filename, mimetype FROM surat_lampiran WHERE surat_id IN (${ids.map(() => '?').join(',')}) ORDER BY id`, ids);
  const byId = new Map(rows.map((r) => [r.id, { ...r, lampiran: [] }]));
  for (const l of lamp) byId.get(l.surat_id)?.lampiran.push(l);
  return [...byId.values()];
}

// Penomoran surat PER UNIT: nomor urut (seq) dihitung terpisah untuk tiap unit.
async function nextNomor(conn, jenis = 'Nota Dinas', unitId) {
  const [sRows] = await conn.query("SELECT setting_value FROM settings WHERE setting_key = 'lkp'");
  let lkp = {};
  try { const v = sRows[0]?.setting_value; lkp = (typeof v === 'string' ? JSON.parse(v) : v) || {}; } catch { /* default */ }
  const kode = (lkp.nd_kode || 'ELBAND/APTP').trim();
  const now = new Date();
  const bulan = now.getMonth() + 1, tahun = now.getFullYear();
  if (jenis === 'Surat Pernyataan') {
    const [seqRows] = await conn.query("SELECT COALESCE(MAX(seq),0)+1 AS s FROM nota_dinas WHERE tahun=? AND jenis='Surat Pernyataan' AND unit_id = ?", [tahun, unitId]);
    const seq = seqRows[0].s;
    return { nomor: `SPL/${String(seq).padStart(3, '0')}/TEKOPS/APTP-${tahun}`, seq, bulan, tahun };
  }
  if (jenis === 'Permintaan Barang') {
    // Nomor urut dikosongkan (titik-titik) agar diisi manual saat dokumen dicetak.
    const [seqRows] = await conn.query("SELECT COALESCE(MAX(seq),0)+1 AS s FROM nota_dinas WHERE tahun=? AND jenis='Permintaan Barang' AND unit_id = ?", [tahun, unitId]);
    const seq = seqRows[0].s;
    return { nomor: `PL.108/..................../APTP/${tahun}`, seq, bulan, tahun };
  }
  const [seqRows] = await conn.query('SELECT COALESCE(MAX(seq),0)+1 AS s FROM nota_dinas WHERE bulan = ? AND tahun = ? AND unit_id = ?', [bulan, tahun, unitId]);
  const seq = seqRows[0].s;
  return { nomor: `${String(seq).padStart(3, '0')}/${kode}/${ROMAN[bulan]}/${tahun}`, seq, bulan, tahun };
}

// Daftar surat keluar (koordinator/admin). Opsional ?signed=1 untuk yang ber-TTE.
router.get('/', requireRole('koordinator', 'admin'), async (req, res) => {
  // Ambil nama pembuat TERKINI dari akun (created_by); fallback ke snapshot bila akun terhapus.
  let sql = 'SELECT n.*, u.name AS creator_current FROM nota_dinas n LEFT JOIN users u ON u.id = n.created_by WHERE 1=1';
  const params = [];
  const uf = unitFilter(req.unitId, 'n.unit_id');
  sql += uf.clause; params.push(...uf.params);
  if (req.query.signed === '1') sql += ' AND n.sign_token IS NOT NULL';
  sql += ' ORDER BY n.created_at DESC';
  const [rows] = await pool.query(sql, params);
  for (const r of rows) { if (r.creator_current) r.creator_name = r.creator_current; delete r.creator_current; }
  res.json({ surat: await withLampiran(rows) });
});

// Buat surat keluar baru (mis. Nota Dinas umum). Nomor otomatis + lampiran bukti dukung (opsional).
router.post('/', requireRole('koordinator', 'admin'), upload.array('files', 10), async (req, res) => {
  const { jenis, hal, tujuan, body, report_month, incident_id: rawIncId } = req.body;
  if (!hal?.trim()) return res.status(400).json({ error: 'Hal/perihal surat wajib diisi.' });
  const unitId = insertUnitId(req);
  if (unitId == null) return res.status(400).json({ error: 'Pilih unit terlebih dahulu.' });
  const incId = rawIncId?.trim() || null;
  if (incId) {
    const [ch] = await pool.query('SELECT id, unit_id FROM incidents WHERE id = ?', [incId]);
    if (!ch[0] || !rowInUnit(ch[0], req.unitId)) return res.status(400).json({ error: `Insiden ${incId} tidak ditemukan.` });
  }
  const conn = await pool.getConnection();
  try {
    const { nomor, seq, bulan, tahun } = await nextNomor(conn, (jenis || 'Nota Dinas').trim(), unitId);
    const tanggal = new Date().toISOString().slice(0, 10);
    const rm = /^\d{4}-\d{2}$/.test(report_month || '') ? report_month : null;
    const [r] = await conn.query(
      `INSERT INTO nota_dinas (jenis, nomor, seq, bulan, tahun, hal, tujuan, body, tanggal, created_by, creator_name, report_month, incident_id, unit_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [(jenis || 'Nota Dinas').trim(), nomor, seq, bulan, tahun, hal.trim(), tujuan?.trim() || null, body?.trim() || null, tanggal, req.user.id, req.user.name, rm, incId, unitId]
    );
    for (const f of req.files || []) {
      await conn.query('INSERT INTO surat_lampiran (surat_id, file_url, filename, mimetype) VALUES (?, ?, ?, ?)',
        [r.insertId, `/uploads/surat/${f.filename}`, f.originalname.slice(0, 200), f.mimetype]);
    }
    const [rows] = await conn.query('SELECT * FROM nota_dinas WHERE id = ?', [r.insertId]);
    res.status(201).json({ surat: (await withLampiran(rows))[0] });
  } finally {
    conn.release();
  }
});

// Tautkan / lepas tautan insiden (dan LKP-nya) dari sebuah surat.
router.patch('/:id/incident', requireRole('koordinator', 'admin'), async (req, res) => {
  const id = Number(req.params.id);
  const incId = String(req.body.incident_id || '').trim() || null;
  if (incId) {
    const [ch] = await pool.query('SELECT id, unit_id FROM incidents WHERE id = ?', [incId]);
    if (!ch[0] || !rowInUnit(ch[0], req.unitId)) return res.status(404).json({ error: `Insiden ${incId} tidak ditemukan.` });
  }
  const [s] = await pool.query('SELECT id, unit_id FROM nota_dinas WHERE id = ?', [id]);
  if (!s[0] || !rowInUnit(s[0], req.unitId)) return res.status(404).json({ error: 'Surat tidak ditemukan.' });
  await pool.query('UPDATE nota_dinas SET incident_id = ? WHERE id = ?', [incId, id]);
  const [rows] = await pool.query('SELECT * FROM nota_dinas WHERE id = ?', [id]);
  res.json({ surat: (await withLampiran(rows))[0] });
});

// Tambah lampiran bukti dukung ke surat yang sudah ada.
router.post('/:id/lampiran', requireRole('koordinator', 'admin'), upload.array('files', 10), async (req, res) => {
  const id = Number(req.params.id);
  const [s] = await pool.query('SELECT id, unit_id FROM nota_dinas WHERE id = ?', [id]);
  if (!s[0] || !rowInUnit(s[0], req.unitId)) return res.status(404).json({ error: 'Surat tidak ditemukan' });
  if (!req.files?.length) return res.status(400).json({ error: 'Tidak ada file diunggah.' });
  for (const f of req.files) {
    await pool.query('INSERT INTO surat_lampiran (surat_id, file_url, filename, mimetype) VALUES (?, ?, ?, ?)',
      [id, `/uploads/surat/${f.filename}`, f.originalname.slice(0, 200), f.mimetype]);
  }
  const [rows] = await pool.query('SELECT * FROM nota_dinas WHERE id = ?', [id]);
  res.json({ surat: (await withLampiran(rows))[0] });
});

// Hapus satu lampiran.
router.delete('/:id/lampiran/:lampId', requireRole('koordinator', 'admin'), async (req, res) => {
  // Scope via induk: lampiran hanya boleh dihapus bila suratnya milik unit aktif.
  const [s] = await pool.query('SELECT id, unit_id FROM nota_dinas WHERE id = ?', [Number(req.params.id)]);
  if (!s[0] || !rowInUnit(s[0], req.unitId)) return res.status(404).json({ error: 'Surat tidak ditemukan' });
  await pool.query('DELETE FROM surat_lampiran WHERE id = ? AND surat_id = ?', [Number(req.params.lampId), Number(req.params.id)]);
  res.json({ ok: true });
});

// ---- Kop / letterhead dokumen (didefinisikan SEBELUM route '/:id' agar tidak tertangkap sebagai id) ----
// Helper: baca & tulis objek lkp di tabel settings.
async function readLkpRaw() {
  const [r] = await pool.query("SELECT setting_value FROM settings WHERE setting_key='lkp'");
  let lkp = {};
  try { const v = r[0]?.setting_value; lkp = (typeof v === 'string' ? JSON.parse(v) : v) || {}; } catch { lkp = {}; }
  return lkp;
}
async function writeLkpRaw(lkp) {
  await pool.query(
    "INSERT INTO settings (setting_key, setting_value) VALUES ('lkp', ?) ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value)",
    [JSON.stringify(lkp)]
  );
}

// Unggah gambar kop/letterhead → simpan URL ke settings.lkp.kop_url (dipakai saat generate dokumen).
router.post('/kop', requireRole('koordinator', 'admin'), upload.single('kop'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Tidak ada gambar diunggah.' });
  if (!req.file.mimetype.startsWith('image/')) {
    try { fs.unlinkSync(path.join(UPLOAD_DIR, req.file.filename)); } catch { /* abaikan */ }
    return res.status(400).json({ error: 'Kop harus berupa gambar (JPG/PNG/WebP/GIF).' });
  }
  const lkp = await readLkpRaw();
  // Hapus berkas kop lama bila ada (agar tidak menumpuk di disk).
  if (lkp.kop_url && lkp.kop_url.startsWith('/uploads/surat/')) {
    try { fs.unlinkSync(path.join(UPLOAD_DIR, path.basename(lkp.kop_url))); } catch { /* abaikan */ }
  }
  lkp.kop_url = `/uploads/surat/${req.file.filename}`;
  await writeLkpRaw(lkp);
  res.json({ ok: true, kop_url: lkp.kop_url, lkp });
});

// Hapus kop yang tersimpan → kembali ke dokumen tanpa header.
router.delete('/kop', requireRole('koordinator', 'admin'), async (req, res) => {
  const lkp = await readLkpRaw();
  if (lkp.kop_url && lkp.kop_url.startsWith('/uploads/surat/')) {
    try { fs.unlinkSync(path.join(UPLOAD_DIR, path.basename(lkp.kop_url))); } catch { /* abaikan */ }
  }
  delete lkp.kop_url;
  await writeLkpRaw(lkp);
  res.json({ ok: true, lkp });
});

// Hapus surat keluar (beserta lampiran & berkasnya).
router.delete('/:id', requireRole('koordinator', 'admin'), async (req, res) => {
  const id = Number(req.params.id);
  const [s] = await pool.query('SELECT id, unit_id FROM nota_dinas WHERE id = ?', [id]);
  if (!s[0] || !rowInUnit(s[0], req.unitId)) return res.status(404).json({ error: 'Surat tidak ditemukan' });
  const [lamp] = await pool.query('SELECT file_url FROM surat_lampiran WHERE surat_id = ?', [id]);
  const [del] = await pool.query('DELETE FROM nota_dinas WHERE id = ?', [id]); // surat_lampiran terhapus via ON DELETE CASCADE
  if (!del.affectedRows) return res.status(404).json({ error: 'Surat tidak ditemukan' });
  for (const l of lamp) { try { fs.unlinkSync(path.join(UPLOAD_DIR, path.basename(l.file_url))); } catch { /* abaikan */ } }
  res.json({ ok: true });
});

// TTE: sahkan surat keluar.
router.post('/:id/sign', requireRole('koordinator', 'admin'), async (req, res) => {
  const id = Number(req.params.id);
  const [rows] = await pool.query('SELECT * FROM nota_dinas WHERE id = ?', [id]);
  const s = rows[0];
  if (!s || !rowInUnit(s, req.unitId)) return res.status(404).json({ error: 'Surat tidak ditemukan' });
  if (s.sign_token) return res.status(400).json({ error: 'Surat sudah disahkan (TTE).' });
  const name = (req.body.signerName || req.user.name || '').trim();
  const nip = (req.body.signerNip || '').trim() || null;
  const signedAt = new Date();
  const payload = `SURAT|${s.nomor}|${s.hal}|${req.user.id}|${name}|${signedAt.toISOString()}`;
  const token = 'NS' + crypto.createHmac('sha256', env.jwtSecret).update(payload).digest('hex').slice(0, 22).toUpperCase();
  await pool.query('UPDATE nota_dinas SET signed_by=?, signer_name=?, signer_nip=?, signed_at=?, sign_token=? WHERE id=?',
    [req.user.id, name, nip, signedAt, token, id]);
  let [updated] = await pool.query('SELECT * FROM nota_dinas WHERE id = ?', [id]);
  // Laporan Bulanan → otomatis kirim ke SiKeren untuk verifikasi (best-effort; tidak menggagalkan TTE).
  if (updated[0]?.report_month && isSiKerenConfigured()) {
    try { await pushSuratSiKeren(updated[0]); }
    catch (e) { await pool.query("UPDATE nota_dinas SET sikeren_status='gagal', sikeren_note=? WHERE id=?", [String(e?.message || e).slice(0, 255), id]); }
    [updated] = await pool.query('SELECT * FROM nota_dinas WHERE id = ?', [id]);
  }
  res.json({ surat: (await withLampiran(updated))[0] });
});

// Kirim manual dokumen ke SiKeren untuk verifikasi (a.n. Kepala Seksi/Murdoko).
router.post('/:id/kirim-sikeren', requireRole('koordinator', 'admin'), async (req, res) => {
  if (!isSiKerenConfigured()) return res.status(400).json({ error: 'Integrasi SiKeren belum dikonfigurasi di server (SIKEREN_BASE_URL & SIKEREN_API_KEY).' });
  const [rows] = await pool.query('SELECT * FROM nota_dinas WHERE id = ?', [Number(req.params.id)]);
  const s = rows[0];
  if (!s || !rowInUnit(s, req.unitId)) return res.status(404).json({ error: 'Surat tidak ditemukan' });
  try {
    const r = await pushSuratSiKeren(s);
    const [u] = await pool.query('SELECT * FROM nota_dinas WHERE id = ?', [s.id]);
    res.json({ surat: (await withLampiran(u))[0], sikeren: r });
  } catch (e) {
    await pool.query("UPDATE nota_dinas SET sikeren_status='gagal', sikeren_note=? WHERE id=?", [String(e?.message || e).slice(0, 255), s.id]);
    res.status(502).json({ error: e?.message || 'Gagal mengirim ke SiKeren.' });
  }
});

// Baca pengaturan kop/penanda-tangan (LKP) dari tabel settings.
// Normalisasi: Settings memakai kepala_*, laporan memakai kasie_* — samakan agar konsisten.
async function getLkp() {
  const [r] = await pool.query("SELECT setting_value FROM settings WHERE setting_key='lkp'");
  let lkp = {};
  try { const v = r[0]?.setting_value; lkp = (typeof v === 'string' ? JSON.parse(v) : v) || {}; } catch { lkp = {}; }
  lkp.kasie_nama = lkp.kasie_nama || lkp.kepala_nama || 'MURDOKO';
  lkp.kasie_nip = lkp.kasie_nip || lkp.kepala_nip || '';
  lkp.kasie_jabatan = lkp.kasie_jabatan || lkp.kepala_jabatan || 'KEPALA SEKSI TEKNIK DAN OPERASI';
  lkp.kasie_phone = lkp.kasie_phone || lkp.kepala_phone || '';
  return lkp;
}

// Kirim surat (Laporan Bulanan ber-TTE) ke SiKeren untuk verifikasi a.n. Kepala Seksi.
// Render PDF dari halaman cetak publik lalu POST berkas + metadata + tautan verifikasi.
// Menyimpan status ke kolom sikeren_*; melempar error bila gagal (dipakai manual & auto).
async function pushSuratSiKeren(s) {
  if (!s.sign_token) throw new Error('Surat belum di-TTE — sahkan dulu sebelum kirim ke SiKeren.');
  const lkp = await getLkp();
  const { buffer } = await renderDocPdf(s.sign_token);
  const periode = s.report_month || '';
  const verifyUrl = `${env.appUrl}/verify-tte?token=${s.sign_token}`;
  const metadata = {
    jenis: s.jenis, nomor: s.nomor, hal: s.hal, periode,
    penandatangan_nama: s.signer_name || '', penandatangan_nip: s.signer_nip || '',
    verifikator_nama: lkp.kasie_nama || 'MURDOKO', verifikator_nip: lkp.kasie_nip || '',
  };
  const filename = `laporan-${(periode || s.nomor).replace(/[^\w-]+/g, '-')}.pdf`;
  const r = await sendToSiKeren({ pdfBuffer: buffer, filename, metadata, verifyUrl });
  await pool.query(
    'UPDATE nota_dinas SET sikeren_status=?, sikeren_ref=?, sikeren_url=?, sikeren_at=NOW(), sikeren_note=NULL WHERE id=?',
    ['terkirim', r.ref || null, r.url || null, s.id]
  );
  return r;
}

// Kirim permohonan TTD ke Kepala Seksi via WhatsApp (berisi tautan halaman TTD).
router.post('/:id/request-kasi', requireRole('koordinator', 'admin'), async (req, res) => {
  const id = Number(req.params.id);
  const [rows] = await pool.query('SELECT * FROM nota_dinas WHERE id = ?', [id]);
  const s = rows[0];
  if (!s || !rowInUnit(s, req.unitId)) return res.status(404).json({ error: 'Surat tidak ditemukan' });
  const lkp = await getLkp();
  const phone = String(req.body.phone || lkp.kasie_phone || '').trim();
  if (!phone) return res.status(400).json({ error: 'Nomor WA Kepala Seksi belum diatur. Isi di Pengaturan (kasie_phone) atau kirim nomornya.' });
  // Token akses deterministik agar pengiriman ulang memakai tautan yang sama.
  const token = s.kasi_token || ('AK' + crypto.createHmac('sha256', env.jwtSecret).update(`TTD|${id}|${s.nomor}`).digest('hex').slice(0, 22).toUpperCase());
  await pool.query("UPDATE nota_dinas SET kasi_token=?, kasi_status='menunggu', kasi_requested_at=NOW() WHERE id=?", [token, id]);
  const base = String(req.body.baseUrl || req.headers.origin || '').replace(/\/$/, '');
  const link = `${base}/ttd?token=${token}`;
  const msg = `*Permohonan Tanda Tangan Elektronik*\n\nYth. ${lkp.kasie_nama || 'Kepala Seksi'},\nMohon persetujuan & TTE dokumen berikut:\n\n• ${s.jenis} No. ${s.nomor}\n• Hal: ${s.hal}\n\nTinjau & tandatangani melalui tautan:\n${link}\n\nHormat kami,\n${lkp.koord_jabatan || 'Koordinator Unit Elektronika Bandara'}`;
  let waQueued = false;
  try { await queueWaRaw({ type: 'report', toLabel: `Kepala Seksi (${lkp.kasie_nama || '-'})`, phone, message: msg, relatedIncidentId: s.incident_id }); waQueued = true; } catch { /* tetap kembalikan tautan */ }
  const [u] = await pool.query('SELECT * FROM nota_dinas WHERE id = ?', [id]);
  res.json({ surat: (await withLampiran(u))[0], link, phone, waQueued });
});

// Daftar pegawai aktif untuk picker SPL (dibatasi ke unit aktif).
router.get('/users', async (req, res) => {
  const uf = unitFilter(req.unitId);
  const [rows] = await pool.query(`SELECT id, name, nip, emoji, pangkat, jabatan, phone FROM users WHERE active = 1${uf.clause} ORDER BY name`, uf.params);
  res.json({ users: rows });
});

// Kirim notifikasi TTD ke setiap pelaksana lembur (generate token per pegawai, simpan di body JSON).
router.post('/:id/notify-pelaksana', requireRole('koordinator', 'admin'), async (req, res) => {
  const id = Number(req.params.id);
  const [rows] = await pool.query('SELECT * FROM nota_dinas WHERE id = ?', [id]);
  const s = rows[0];
  if (!s || !rowInUnit(s, req.unitId)) return res.status(404).json({ error: 'Surat tidak ditemukan.' });
  if (s.jenis !== 'Surat Pernyataan') return res.status(400).json({ error: 'Bukan Surat Pernyataan Lembur.' });
  let body = {};
  try { body = JSON.parse(s.body || '{}'); } catch {}
  const pegawai = Array.isArray(body.pegawai) ? body.pegawai : [];
  const baseUrl = String(req.body.baseUrl || req.headers.origin || '').replace(/\/$/, '');
  const links = [];
  for (const p of pegawai) {
    if (!String(p?.nama || '').trim()) continue; // lewati baris pegawai kosong (belum dipilih)
    if (!p.pelaksana_token) {
      const raw = `PELAKSANA|${id}|${p.user_id ?? p.nama}|${s.nomor}`;
      p.pelaksana_token = 'PL' + crypto.createHmac('sha256', env.jwtSecret).update(raw).digest('hex').slice(0, 22).toUpperCase();
    }
    const link = `${baseUrl}/ttd-pelaksana?token=${p.pelaksana_token}`;
    links.push({ nama: p.nama, token: p.pelaksana_token, link });
    if (p.user_id) {
      try {
        await createNotification({ userId: p.user_id, title: `Tanda Tangan Diperlukan: ${s.hal}`, message: `Mohon tanda tangani ${s.jenis} No. ${s.nomor}. Klik untuk membuka halaman TTD.`, type: 'spl_ttd', priority: 'warning', link: `/ttd-pelaksana?token=${p.pelaksana_token}`, refId: String(id), refType: 'surat' });
      } catch { /* abaikan */ }
      try {
        const [[u]] = await pool.query('SELECT phone FROM users WHERE id = ?', [p.user_id]);
        if (u?.phone) {
          const msg = `*Permohonan Tanda Tangan*\n\nYth. ${p.nama},\nAnda dimohon menandatangani:\n\n• ${s.jenis} No. ${s.nomor}\n• Hal: ${s.hal}\n\nSilakan buka:\n${link}\n\nTerima kasih.`;
          await queueWaRaw({ type: 'report', toLabel: p.nama, phone: u.phone, message: msg });
        }
      } catch { /* abaikan */ }
    }
  }
  body.pegawai = pegawai;
  await pool.query('UPDATE nota_dinas SET body = ? WHERE id = ?', [JSON.stringify(body), id]);
  const [updated] = await pool.query('SELECT * FROM nota_dinas WHERE id = ?', [id]);
  res.json({ surat: (await withLampiran(updated))[0], links });
});

// ---- Publik (tanpa login): halaman TTD Kepala Seksi ----
export async function getTtdDoc(req, res) {
  const token = String(req.params.token || '').trim();
  const [rows] = await pool.query('SELECT * FROM nota_dinas WHERE kasi_token = ? LIMIT 1', [token]);
  const s = rows[0];
  if (!s) return res.json({ valid: false });
  const [lamp] = await pool.query('SELECT id, file_url, filename, mimetype FROM surat_lampiran WHERE surat_id = ? ORDER BY id', [s.id]);
  const lkp = await getLkp();
  // Bila surat adalah pengantar Laporan Bulanan → sertakan data laporan penuh agar bisa ditinjau per halaman.
  // report_month diutamakan; cover lama di-parse dari teks Hal.
  let rm = s.report_month;
  if (!rm) {
    const BLN = ['januari', 'februari', 'maret', 'april', 'mei', 'juni', 'juli', 'agustus', 'september', 'oktober', 'november', 'desember'];
    const mm = /laporan bulanan.*?\b(januari|februari|maret|april|mei|juni|juli|agustus|september|oktober|november|desember)\s+(\d{4})/i.exec(s.hal || '');
    if (mm) rm = `${mm[2]}-${String(BLN.indexOf(mm[1].toLowerCase()) + 1).padStart(2, '0')}`;
  }
  let laporan = null;
  // Data laporan mengikuti unit pemilik surat (bukan scoping requester — akses token tetap publik).
  if (rm) { try { laporan = await buildLaporanData(rm, s.unit_id ?? null); } catch { laporan = null; } }
  res.json({
    valid: true,
    doc: {
      jenis: s.jenis, nomor: s.nomor, hal: s.hal, tujuan: s.tujuan, body: s.body, tanggal: s.tanggal,
      creator_name: s.creator_name, signer_name: s.signer_name, signer_nip: s.signer_nip, sign_token: s.sign_token, signed_at: s.signed_at,
      kasi_status: s.kasi_status, kasi_signer_name: s.kasi_signer_name, kasi_signer_nip: s.kasi_signer_nip,
      kasi_signed_at: s.kasi_signed_at, kasi_sign_token: s.kasi_sign_token, kasi_note: s.kasi_note,
      report_month: s.report_month, lampiran: lamp,
    },
    laporan,
    kasi: { nama: lkp.kasie_nama || '', nip: lkp.kasie_nip || '', jabatan: lkp.kasie_jabatan || 'Kepala Seksi Teknik dan Operasi' },
    header: { kantor: lkp.kantor || '', koord_jabatan: lkp.koord_jabatan || 'Koordinator Unit Elektronika Bandara', nd_dari: lkp.nd_dari || '' },
    lkp: {
      kantor: lkp.kantor || 'BANDAR UDARA A.P.T. PRANOTO - SAMARINDA', kota: lkp.kota || 'Samarinda', bandara: lkp.bandara || 'Aji Pangeran Tumenggung Pranoto Samarinda',
      koord_jabatan: lkp.koord_jabatan || 'KOORDINATOR UNIT ELEKTRONIKA BANDARA', koord_nama: lkp.koord_nama || s.signer_name || 'PRAYUDA ELFANDRO', koord_nip: lkp.koord_nip || s.signer_nip || '',
      kasie_jabatan: lkp.kasie_jabatan, kasie_nama: lkp.kasie_nama, kasie_nip: lkp.kasie_nip,
      nd_yth: lkp.nd_yth || 'Kepala Seksi Teknik dan Operasi Penerbangan', nd_dari: lkp.nd_dari || 'Koordinator Elektronika Bandara',
    },
  });
}

export async function submitTtd(req, res) {
  const token = String(req.params.token || '').trim();
  const [rows] = await pool.query('SELECT * FROM nota_dinas WHERE kasi_token = ? LIMIT 1', [token]);
  const s = rows[0];
  if (!s) return res.status(404).json({ error: 'Tautan tidak valid / dokumen tidak ditemukan.' });
  if (s.kasi_status === 'disetujui') return res.status(400).json({ error: 'Dokumen sudah ditandatangani Kepala Seksi.' });
  const lkp = await getLkp();
  if (req.body.action === 'reject') {
    await pool.query("UPDATE nota_dinas SET kasi_status='ditolak', kasi_note=? WHERE id=?", [String(req.body.note || '').slice(0, 255) || null, s.id]);
    return res.json({ ok: true, status: 'ditolak' });
  }
  const name = String(req.body.name || lkp.kasie_nama || 'Kepala Seksi').trim();
  const nip = String(req.body.nip || lkp.kasie_nip || '').trim() || null;
  const signedAt = new Date();
  const payload = `KASI|${s.nomor}|${s.hal}|${name}|${signedAt.toISOString()}`;
  const signTok = 'NK' + crypto.createHmac('sha256', env.jwtSecret).update(payload).digest('hex').slice(0, 22).toUpperCase();
  await pool.query("UPDATE nota_dinas SET kasi_status='disetujui', kasi_signer_name=?, kasi_signer_nip=?, kasi_signed_at=?, kasi_sign_token=?, kasi_note=NULL WHERE id=?",
    [name, nip, signedAt, signTok, s.id]);
  res.json({ ok: true, status: 'disetujui', kasi_sign_token: signTok });
}

// ---- Publik (tanpa login): halaman TTD Pelaksana Lembur ----
export async function getPelaksanaSignDoc(req, res) {
  const token = String(req.params.token || '').trim();
  if (!token) return res.json({ valid: false });
  const [rows] = await pool.query("SELECT * FROM nota_dinas WHERE jenis='Surat Pernyataan' AND body LIKE ? LIMIT 1", [`%${token}%`]);
  const s = rows[0];
  if (!s) return res.json({ valid: false });
  let body = {};
  try { body = JSON.parse(s.body || '{}'); } catch {}
  const pegawai = Array.isArray(body.pegawai) ? body.pegawai : [];
  const p = pegawai.find((x) => x.pelaksana_token === token);
  if (!p) return res.json({ valid: false });
  res.json({
    valid: true,
    doc: { nomor: s.nomor, hal: s.hal, jenis: s.jenis, tanggal: s.tanggal },
    pelaksana: { nama: p.nama, nip: p.nip, mulai: p.mulai, selesai: p.selesai, signed_at: p.signed_at || null, sign_token: p.sign_token || null },
  });
}

export async function submitPelaksanaSign(req, res) {
  const token = String(req.params.token || '').trim();
  if (!token) return res.status(400).json({ error: 'Token tidak valid.' });
  const [rows] = await pool.query("SELECT * FROM nota_dinas WHERE jenis='Surat Pernyataan' AND body LIKE ? LIMIT 1", [`%${token}%`]);
  const s = rows[0];
  if (!s) return res.status(404).json({ error: 'Token tidak ditemukan.' });
  let body = {};
  try { body = JSON.parse(s.body || '{}'); } catch {}
  const pegawai = Array.isArray(body.pegawai) ? body.pegawai : [];
  const p = pegawai.find((x) => x.pelaksana_token === token);
  if (!p) return res.status(404).json({ error: 'Token tidak valid.' });
  if (p.signed_at) return res.status(400).json({ error: 'Sudah ditandatangani sebelumnya.' });
  const signedAt = new Date();
  const raw = `PLK|${s.nomor}|${p.nama}|${signedAt.toISOString()}`;
  p.sign_token = 'PK' + crypto.createHmac('sha256', env.jwtSecret).update(raw).digest('hex').slice(0, 22).toUpperCase();
  p.signed_at = signedAt.toISOString();
  body.pegawai = pegawai;
  await pool.query('UPDATE nota_dinas SET body = ? WHERE id = ?', [JSON.stringify(body), s.id]);
  res.json({ ok: true, sign_token: p.sign_token });
}

export default router;
