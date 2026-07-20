import { Router } from 'express';
import crypto from 'crypto';
import multer from 'multer';
import { randName } from '../middleware/upload.js';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { pool } from '../db/pool.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { unitScope, unitFilter, rowInUnit, insertUnitId } from '../middleware/unitScope.js';
import { audit } from '../services/audit.js';
import { DATA_SOURCES, buildSnapshot } from '../services/skpDataSources.js';

const router = Router();

const ASPEK = ['Kuantitas', 'Kualitas', 'Waktu', 'Biaya'];
const KLASIFIKASI = ['utama', 'tambahan'];
const STATUSES = ['draft', 'diajukan', 'dinilai'];
const genToken = () => crypto.randomBytes(16).toString('hex');
const isAdmin = (u) => (u?.roles?.length ? u.roles : [u?.role]).includes('admin');
const isKoor = (u) => (u?.roles?.length ? u.roles : [u?.role]).includes('koordinator');
const isMonth = (s) => /^\d{4}-\d{2}$/.test(s || '');
const currentMonth = () => new Date().toISOString().slice(0, 7);
// Bulan aktif dari query/body; fallback ke bulan berjalan.
const pickBulan = (req) => {
  const b = req.query?.bulan || req.body?.bulan;
  return isMonth(b) ? b : currentMonth();
};

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DIR = path.join(__dirname, '..', '..', 'uploads', 'skp');
fs.mkdirSync(DIR, { recursive: true });
const upload = multer({
  storage: multer.diskStorage({
    destination: (q, f, cb) => cb(null, DIR),
    filename: (q, f, cb) => cb(null, randName('S', f.originalname)),
  }),
  limits: { fileSize: 20 * 1024 * 1024 },
});

// Susun SKP lengkap untuk SATU bulan: RHK & indikator (rencana tahunan) +
// realisasi/feedback (skp_realisasi) + bukti (skp_bukti) untuk bulan tsb.
// Mengembalikan juga daftar bulan yang sudah punya data & info status bulan.
async function fetchFull(skp, bulanParam) {
  if (!skp) return null;
  // Bulan-bulan yang sudah punya realisasi / bukti / status.
  const [mr] = await pool.query(
    `SELECT bulan FROM skp_realisasi WHERE skp_id=? AND bulan IS NOT NULL
     UNION SELECT bulan FROM skp_bukti WHERE skp_id=? AND bulan IS NOT NULL
     UNION SELECT bulan FROM skp_bulan WHERE skp_id=?`, [skp.id, skp.id, skp.id]);
  const months = [...new Set(mr.map((r) => r.bulan).filter(Boolean))].sort().reverse();
  const bulan = isMonth(bulanParam) ? bulanParam : (months[0] || currentMonth());

  const [rhks] = await pool.query('SELECT * FROM skp_rhk WHERE skp_id=? ORDER BY urutan, id', [skp.id]);
  const [inds] = await pool.query('SELECT * FROM skp_indikator WHERE skp_id=? ORDER BY urutan, id', [skp.id]);
  const [real] = await pool.query('SELECT indikator_id, realisasi, feedback FROM skp_realisasi WHERE skp_id=? AND bulan=?', [skp.id, bulan]);
  const realMap = Object.fromEntries(real.map((r) => [r.indikator_id, r]));
  // snapshot (JSON besar) tidak diambil di sini — hanya untuk halaman publik bukti.
  const [bukti] = await pool.query(
    'SELECT id, indikator_id, skp_id, bulan, urutan, deskripsi, kind, source, params, url, file_url, public_token, created_at FROM skp_bukti WHERE skp_id=? AND bulan=? ORDER BY urutan, id', [skp.id, bulan]);
  const [[bi]] = await pool.query('SELECT bulan, status, tanggal_pengajuan FROM skp_bulan WHERE skp_id=? AND bulan=?', [skp.id, bulan]);

  const indFull = inds.map((i) => ({
    ...i,
    realisasi: realMap[i.id]?.realisasi ?? null,
    feedback: realMap[i.id]?.feedback ?? null,
    bukti: bukti.filter((b) => b.indikator_id === i.id),
  }));
  return {
    ...skp,
    bulan,
    months,
    bulanInfo: bi || { bulan, status: 'draft', tanggal_pengajuan: null },
    // Laporan bulanan pendukung mengikuti unit pemilik SKP (bukan unit requester).
    laporanBulanan: await signedLaporanBulanan(bulan, skp.unit_id ?? null),
    rhk: rhks.map((r) => ({ ...r, indikator: indFull.filter((i) => i.rhk_id === r.id) })),
  };
}

// Versi publik bukti dukung (lean) — sembunyikan kolom internal & snapshot besar.
function publicBuktiView(b) {
  return { id: b.id, deskripsi: b.deskripsi, kind: b.kind || 'link', source: b.source, url: b.url, file_url: b.file_url, public_token: b.public_token, created_at: b.created_at };
}

// Dokumen Laporan Bulanan ber-TTE LENGKAP (Koordinator + Kepala Seksi) untuk satu bulan.
// Dipakai sebagai dokumen resmi pendukung di halaman publik SKP/bukti. Unduh PDF via verify-tte.
async function signedLaporanBulanan(bulan, unitId = null) {
  if (!isMonth(bulan)) return null;
  const uf = unitFilter(unitId);
  const [rows] = await pool.query(
    `SELECT nomor, hal, sign_token, signer_name, signed_at, kasi_sign_token, kasi_signer_name, kasi_signed_at
       FROM nota_dinas
      WHERE report_month=? AND sign_token IS NOT NULL AND kasi_status='disetujui' AND kasi_sign_token IS NOT NULL${uf.clause}
      ORDER BY signed_at DESC, created_at DESC LIMIT 1`, [bulan, ...uf.params]);
  const s = rows[0];
  if (!s) return null;
  return {
    nomor: s.nomor, hal: s.hal,
    pdf_url: `/api/verify-tte/${s.sign_token}/document.pdf`,
    verify_url: `/verify-tte?token=${s.sign_token}`,
    koordinator: { nama: s.signer_name, signed_at: s.signed_at },
    kasi: { nama: s.kasi_signer_name, signed_at: s.kasi_signed_at },
  };
}

// =================== PUBLIK (tanpa auth) — wajib sebelum requireAuth ===================

// Halaman publik seluruh SKP (read-only) untuk satu bulan. ?bulan=YYYY-MM (default: bulan terbaru berdata).
router.get('/public/:token', async (req, res) => {
  const [rows] = await pool.query('SELECT * FROM skp WHERE public_token=? LIMIT 1', [req.params.token]);
  if (!rows[0]) return res.status(404).json({ valid: false, error: 'SKP tidak ditemukan.' });
  const full = await fetchFull(rows[0], req.query.bulan);
  res.json({
    valid: true,
    laporanBulanan: full.laporanBulanan,
    skp: {
      id: full.id, periode: full.periode, tahun: full.tahun, pendekatan: full.pendekatan,
      pegawai_nama: full.pegawai_nama, pegawai_nip: full.pegawai_nip, pegawai_jabatan: full.pegawai_jabatan, pegawai_unit: full.pegawai_unit,
      penilai_nama: full.penilai_nama, penilai_nip: full.penilai_nip, penilai_jabatan: full.penilai_jabatan,
      bulan: full.bulan, months: full.months, bulanInfo: full.bulanInfo,
      rhk: full.rhk.map((r) => ({
        id: r.id, urutan: r.urutan, klasifikasi: r.klasifikasi, rhk: r.rhk,
        indikator: r.indikator.map((i) => ({
          id: i.id, aspek: i.aspek, indikator: i.indikator, target: i.target,
          renaksi: i.renaksi, realisasi: i.realisasi, feedback: i.feedback,
          bukti: i.bukti.map(publicBuktiView),
        })),
      })),
    },
  });
});

// Berkas /uploads yang WAJIB LOGIN bila diakses langsung (lihat PROTECTED_UPLOADS di
// app.js). Pada halaman publik bukti, berkas semacam ini tidak ditautkan apa adanya
// melainkan lewat proxy ber-token di bawah — jadi yang terbuka hanya berkas yang memang
// tercantum dalam snapshot bukti itu, bukan seluruh isi foldernya.
const GATED_DIRS = ['/uploads/leave/', '/uploads/diklat/', '/uploads/activities/', '/uploads/kegiatan/'];
const isGated = (u) => GATED_DIRS.some((d) => String(u).startsWith(d));
const UPLOAD_ROOT = path.join(__dirname, '..', '..', 'uploads');

// Semua path berkas yang boleh diakses lewat token bukti ini (dari snapshot-nya).
function allowedFiles(snapshot) {
  const out = new Set();
  for (const list of snapshot?.rowPhotos || []) for (const u of list || []) out.add(String(u));
  return out;
}
// Tulis ulang path berkas terproteksi → tautan proxy ber-token.
function publicPhotoUrls(snapshot, token) {
  if (!snapshot?.rowPhotos) return snapshot;
  const rowPhotos = snapshot.rowPhotos.map((list) => (list || []).map((u) => (
    isGated(u) ? `/api/skp/bukti/public/${token}/berkas?p=${encodeURIComponent(u)}` : u
  )));
  return { ...snapshot, rowPhotos };
}

// Sajikan satu berkas bukti (mis. foto kegiatan) untuk halaman publik. Hanya berkas yang
// tercantum di snapshot bukti bertoken ini yang dilayani — path lain ditolak.
router.get('/bukti/public/:token/berkas', async (req, res) => {
  const [rows] = await pool.query('SELECT snapshot FROM skp_bukti WHERE public_token=? LIMIT 1', [req.params.token]);
  if (!rows[0]) return res.status(404).json({ error: 'Bukti tidak ditemukan.' });
  const snap = typeof rows[0].snapshot === 'string' ? JSON.parse(rows[0].snapshot || 'null') : rows[0].snapshot;
  const p = String(req.query.p || '');
  if (!allowedFiles(snap).has(p)) return res.status(403).json({ error: 'Berkas tidak termasuk dalam bukti ini.' });
  // Cegah path traversal: hasil resolve wajib berada di dalam folder uploads.
  const abs = path.resolve(UPLOAD_ROOT, '.' + p.replace('/uploads', ''));
  if (!abs.startsWith(path.resolve(UPLOAD_ROOT))) return res.status(400).json({ error: 'Path tidak valid.' });
  if (!fs.existsSync(abs)) return res.status(404).json({ error: 'Berkas tidak ditemukan.' });
  res.sendFile(abs);
});

// Halaman publik satu item bukti dukung.
router.get('/bukti/public/:token', async (req, res) => {
  const [rows] = await pool.query('SELECT * FROM skp_bukti WHERE public_token=? LIMIT 1', [req.params.token]);
  if (!rows[0]) return res.status(404).json({ valid: false, error: 'Bukti dukung tidak ditemukan.' });
  const b = rows[0];
  const [[ind]] = await pool.query('SELECT aspek, indikator FROM skp_indikator WHERE id=?', [b.indikator_id]);
  const [[skp]] = await pool.query('SELECT periode, tahun, pegawai_nama, pegawai_nip, pegawai_jabatan, unit_id FROM skp WHERE id=?', [b.skp_id]);
  const raw = b.kind === 'data' ? (typeof b.snapshot === 'string' ? JSON.parse(b.snapshot || 'null') : b.snapshot) : null;
  // Berkas terproteksi ditautkan lewat proxy ber-token agar tetap tampil di halaman publik
  // tanpa membuka folder /uploads yang bersifat pribadi.
  const snapshot = raw ? publicPhotoUrls(raw, req.params.token) : null;
  // Laporan bulanan pendukung mengikuti unit pemilik SKP (bukan lintas unit).
  res.json({ valid: true, bukti: { ...publicBuktiView(b), bulan: b.bulan, snapshot }, indikator: ind || null, skp: skp || null, laporanBulanan: await signedLaporanBulanan(b.bulan, skp?.unit_id ?? null) });
});

// =================== TERPROTEKSI (admin/koordinator/teknisi) ===================
router.use(requireAuth);
router.use(unitScope); // scoping multi-unit — route publik di atas tidak terpengaruh
router.use(requireRole('admin', 'koordinator', 'teknisi'));

// Aturan akses SKP:
// • Pemilik (pembuat) & admin  → lihat + ubah.
// • Koordinator                → LIHAT SKP seluruh personel se-unit (atasan langsung),
//                                tetapi tidak boleh mengubah milik orang lain.
// • Teknisi                    → hanya SKP miliknya sendiri; SKP teknisi lain tidak
//                                terlihat sama sekali (bukan sekadar read-only).
const canEditSkp = (skp, user) => skp.created_by === user.id || isAdmin(user);
const canViewSkp = (skp, user) => canEditSkp(skp, user) || isKoor(user);

async function getOwned(skpId, user, unitId, mode = 'edit') {
  const [rows] = await pool.query('SELECT * FROM skp WHERE id=?', [Number(skpId)]);
  const skp = rows[0];
  if (!skp) return { error: 404 };
  if (!rowInUnit(skp, unitId)) return { error: 404 }; // beda unit = seolah tidak ada
  if (mode === 'view') {
    if (!canViewSkp(skp, user)) return { error: 404 }; // sesama teknisi: seolah tidak ada
    return { skp };
  }
  if (!canEditSkp(skp, user)) return { error: canViewSkp(skp, user) ? 403 : 404 };
  return { skp };
}
async function ownedByChild(table, childId, user, unitId, mode = 'edit') {
  const [rows] = await pool.query(`SELECT skp_id FROM ${table} WHERE id=?`, [Number(childId)]);
  if (!rows[0]) return { error: 404 };
  return getOwned(rows[0].skp_id, user, unitId, mode);
}
const reply = async (res, req, skp, bulan, status = 200) =>
  res.status(status).json({ skp: { ...(await fetchFull(skp, bulan)), can_edit: canEditSkp(skp, req.user) } });

router.get('/data-sources', (req, res) => res.json({ sources: DATA_SOURCES }));

// Daftar SKP: teknisi hanya miliknya sendiri; koordinator & admin melihat SKP
// seluruh personel unit (SKP anggota tim tampil read-only, ditandai can_edit=false).
router.get('/', async (req, res) => {
  let sql = `SELECT s.*, u.name AS pemilik_nama,
       (SELECT COUNT(*) FROM skp_rhk r WHERE r.skp_id=s.id) AS jml_rhk,
       (SELECT COUNT(*) FROM skp_bukti b WHERE b.skp_id=s.id) AS jml_bukti
     FROM skp s LEFT JOIN users u ON u.id=s.created_by WHERE 1=1`;
  const params = [];
  const uf = unitFilter(req.unitId, 's.unit_id');
  sql += uf.clause; params.push(...uf.params);
  if (!isAdmin(req.user) && !isKoor(req.user)) { sql += ' AND s.created_by=?'; params.push(req.user.id); }
  sql += ' ORDER BY (s.created_by=?) DESC, s.tahun DESC, s.id DESC';
  params.push(req.user.id);
  const [rows] = await pool.query(sql, params);
  res.json({ skp: rows.map((r) => ({ ...r, can_edit: canEditSkp(r, req.user) })) });
});

// Buat SKP tahunan baru. Otomatis dapat public_token.
router.post('/', async (req, res) => {
  const b = req.body;
  if (!b.periode?.trim()) return res.status(400).json({ error: 'Periode wajib diisi.' });
  const unitId = insertUnitId(req);
  if (unitId == null) return res.status(400).json({ error: 'Pilih unit terlebih dahulu.' });
  const tahun = Number(b.tahun) || new Date().getFullYear();
  const [r] = await pool.query(
    `INSERT INTO skp (periode, tahun, pendekatan, pegawai_id, pegawai_nama, pegawai_nip, pegawai_jabatan, pegawai_unit,
       penilai_nama, penilai_nip, penilai_jabatan, public_token, created_by, creator_name, unit_id)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [b.periode.trim(), tahun, b.pendekatan || 'Kuantitatif', b.pegawai_id || req.user.id,
      b.pegawai_nama || req.user.name, b.pegawai_nip || null, b.pegawai_jabatan || null, b.pegawai_unit || 'Unit Elektronika Bandara',
      b.penilai_nama || null, b.penilai_nip || null, b.penilai_jabatan || null, genToken(), req.user.id, req.user.name, unitId]
  );
  await audit(req.user, 'skp_create', 'skp', r.insertId, `${b.periode} ${tahun}`);
  const [rows] = await pool.query('SELECT * FROM skp WHERE id=?', [r.insertId]);
  await reply(res, req, rows[0], pickBulan(req), 201);
});

// Detail SKP untuk bulan tertentu (?bulan=YYYY-MM). Mode 'view': koordinator boleh
// membuka SKP anggota unitnya (read-only); teknisi lain dapat 404.
router.get('/:id', async (req, res) => {
  const { skp, error } = await getOwned(req.params.id, req.user, req.unitId, 'view');
  if (error) return res.status(error).json({ error: error === 404 ? 'SKP tidak ditemukan' : 'Tidak punya akses.' });
  await reply(res, req, skp, req.query.bulan);
});

// Ubah identitas header SKP (tahunan).
router.put('/:id', async (req, res) => {
  const { skp, error } = await getOwned(req.params.id, req.user, req.unitId);
  if (error) return res.status(error).json({ error: error === 404 ? 'SKP tidak ditemukan' : 'Tidak punya akses.' });
  const b = req.body;
  await pool.query(
    `UPDATE skp SET periode=?, tahun=?, pendekatan=?, pegawai_nama=?, pegawai_nip=?, pegawai_jabatan=?, pegawai_unit=?,
       penilai_nama=?, penilai_nip=?, penilai_jabatan=? WHERE id=?`,
    [b.periode?.trim() || skp.periode, Number(b.tahun) || skp.tahun, b.pendekatan || skp.pendekatan,
      b.pegawai_nama ?? skp.pegawai_nama, b.pegawai_nip ?? skp.pegawai_nip, b.pegawai_jabatan ?? skp.pegawai_jabatan, b.pegawai_unit ?? skp.pegawai_unit,
      b.penilai_nama ?? skp.penilai_nama, b.penilai_nip ?? skp.penilai_nip, b.penilai_jabatan ?? skp.penilai_jabatan, skp.id]
  );
  const [rows] = await pool.query('SELECT * FROM skp WHERE id=?', [skp.id]);
  await reply(res, req, rows[0], pickBulan(req));
});

// Status penilaian PER BULAN (draft → diajukan → dinilai). 'diajukan' isi tanggal bila kosong.
router.patch('/:id/bulan-status', async (req, res) => {
  const { skp, error } = await getOwned(req.params.id, req.user, req.unitId);
  if (error) return res.status(error).json({ error: error === 404 ? 'SKP tidak ditemukan' : 'Tidak punya akses.' });
  const bulan = pickBulan(req);
  const next = req.body.status;
  if (!STATUSES.includes(next)) return res.status(400).json({ error: 'Status tidak valid.' });
  const [[ex]] = await pool.query('SELECT id, tanggal_pengajuan FROM skp_bulan WHERE skp_id=? AND bulan=?', [skp.id, bulan]);
  const setTgl = next === 'diajukan';
  if (ex) {
    await pool.query(`UPDATE skp_bulan SET status=?${setTgl && !ex.tanggal_pengajuan ? ', tanggal_pengajuan=CURDATE()' : ''} WHERE id=?`, [next, ex.id]);
  } else {
    await pool.query(`INSERT INTO skp_bulan (skp_id, bulan, status, tanggal_pengajuan) VALUES (?,?,?,${setTgl ? 'CURDATE()' : 'NULL'})`, [skp.id, bulan, next]);
  }
  await audit(req.user, `skp_${next}`, 'skp', skp.id, `${skp.periode} ${skp.tahun} · ${bulan}`);
  await reply(res, req, skp, bulan);
});

router.post('/:id/reshare', async (req, res) => {
  const { skp, error } = await getOwned(req.params.id, req.user, req.unitId);
  if (error) return res.status(error).json({ error: error === 404 ? 'SKP tidak ditemukan' : 'Tidak punya akses.' });
  const token = genToken();
  await pool.query('UPDATE skp SET public_token=? WHERE id=?', [token, skp.id]);
  res.json({ public_token: token });
});

router.delete('/:id', async (req, res) => {
  const { skp, error } = await getOwned(req.params.id, req.user, req.unitId);
  if (error) return res.status(error).json({ error: error === 404 ? 'SKP tidak ditemukan' : 'Tidak punya akses.' });
  const [files] = await pool.query('SELECT file_url FROM skp_bukti WHERE skp_id=? AND file_url IS NOT NULL', [skp.id]);
  await pool.query('DELETE FROM skp WHERE id=?', [skp.id]); // cascade RHK/indikator/realisasi/bukti/bulan
  for (const f of files) { try { fs.unlinkSync(path.join(DIR, path.basename(f.file_url))); } catch { /* abaikan */ } }
  await audit(req.user, 'skp_delete', 'skp', skp.id, `${skp.periode} ${skp.tahun}`);
  res.json({ ok: true });
});

// ===== RHK (rencana tahunan) =====
router.post('/:id/rhk', async (req, res) => {
  const { skp, error } = await getOwned(req.params.id, req.user, req.unitId);
  if (error) return res.status(error).json({ error: error === 404 ? 'SKP tidak ditemukan' : 'Tidak punya akses.' });
  if (!req.body.rhk?.trim()) return res.status(400).json({ error: 'Teks RHK wajib diisi.' });
  const klas = KLASIFIKASI.includes(req.body.klasifikasi) ? req.body.klasifikasi : 'utama';
  const [[m]] = await pool.query('SELECT COALESCE(MAX(urutan),0)+1 u FROM skp_rhk WHERE skp_id=?', [skp.id]);
  await pool.query('INSERT INTO skp_rhk (skp_id, urutan, klasifikasi, rhk) VALUES (?,?,?,?)', [skp.id, m.u, klas, req.body.rhk.trim()]);
  await reply(res, req, skp, pickBulan(req), 201);
});
router.put('/rhk/:rhkId', async (req, res) => {
  const { skp, error } = await ownedByChild('skp_rhk', req.params.rhkId, req.user, req.unitId);
  if (error) return res.status(error).json({ error: 'Tidak ditemukan / tidak punya akses.' });
  const b = req.body;
  await pool.query('UPDATE skp_rhk SET rhk=COALESCE(?,rhk), klasifikasi=COALESCE(?,klasifikasi), urutan=COALESCE(?,urutan) WHERE id=?',
    [b.rhk?.trim() || null, KLASIFIKASI.includes(b.klasifikasi) ? b.klasifikasi : null, b.urutan != null ? Number(b.urutan) : null, Number(req.params.rhkId)]);
  await reply(res, req, skp, pickBulan(req));
});
router.delete('/rhk/:rhkId', async (req, res) => {
  const { skp, error } = await ownedByChild('skp_rhk', req.params.rhkId, req.user, req.unitId);
  if (error) return res.status(error).json({ error: 'Tidak ditemukan / tidak punya akses.' });
  await pool.query('DELETE FROM skp_rhk WHERE id=?', [Number(req.params.rhkId)]);
  await reply(res, req, skp, pickBulan(req));
});

// ===== Indikator (rencana tahunan: aspek/indikator/target/renaksi) =====
router.post('/rhk/:rhkId/indikator', async (req, res) => {
  const { skp, error } = await ownedByChild('skp_rhk', req.params.rhkId, req.user, req.unitId);
  if (error) return res.status(error).json({ error: 'Tidak ditemukan / tidak punya akses.' });
  if (!req.body.indikator?.trim()) return res.status(400).json({ error: 'Teks indikator wajib diisi.' });
  const aspek = ASPEK.includes(req.body.aspek) ? req.body.aspek : 'Kuantitas';
  const [[m]] = await pool.query('SELECT COALESCE(MAX(urutan),0)+1 u FROM skp_indikator WHERE rhk_id=?', [Number(req.params.rhkId)]);
  await pool.query(
    'INSERT INTO skp_indikator (rhk_id, skp_id, urutan, aspek, indikator, target, renaksi) VALUES (?,?,?,?,?,?,?)',
    [Number(req.params.rhkId), skp.id, m.u, aspek, req.body.indikator.trim(), req.body.target || null, req.body.renaksi || null]
  );
  await reply(res, req, skp, pickBulan(req), 201);
});
router.put('/indikator/:indId', async (req, res) => {
  const { skp, error } = await ownedByChild('skp_indikator', req.params.indId, req.user, req.unitId);
  if (error) return res.status(error).json({ error: 'Tidak ditemukan / tidak punya akses.' });
  const b = req.body;
  await pool.query(
    `UPDATE skp_indikator SET aspek=COALESCE(?,aspek), indikator=COALESCE(?,indikator), target=?, renaksi=? WHERE id=?`,
    [ASPEK.includes(b.aspek) ? b.aspek : null, b.indikator?.trim() || null, b.target ?? null, b.renaksi ?? null, Number(req.params.indId)]
  );
  await reply(res, req, skp, pickBulan(req));
});
router.delete('/indikator/:indId', async (req, res) => {
  const { skp, error } = await ownedByChild('skp_indikator', req.params.indId, req.user, req.unitId);
  if (error) return res.status(error).json({ error: 'Tidak ditemukan / tidak punya akses.' });
  await pool.query('DELETE FROM skp_indikator WHERE id=?', [Number(req.params.indId)]);
  await reply(res, req, skp, pickBulan(req));
});

// ===== Realisasi & feedback PER BULAN (upsert) =====
router.put('/indikator/:indId/realisasi', async (req, res) => {
  const { skp, error } = await ownedByChild('skp_indikator', req.params.indId, req.user, req.unitId);
  if (error) return res.status(error).json({ error: 'Tidak ditemukan / tidak punya akses.' });
  const bulan = pickBulan(req);
  if (!isMonth(bulan)) return res.status(400).json({ error: 'Bulan tidak valid.' });
  await pool.query(
    `INSERT INTO skp_realisasi (indikator_id, skp_id, bulan, realisasi, feedback) VALUES (?,?,?,?,?)
     ON DUPLICATE KEY UPDATE realisasi=VALUES(realisasi), feedback=VALUES(feedback)`,
    [Number(req.params.indId), skp.id, bulan, req.body.realisasi ?? null, req.body.feedback ?? null]
  );
  await reply(res, req, skp, bulan);
});

// ===== Salin realisasi dari bulan lain =====
// Rencana aksi (renaksi) & indikator bersifat TAHUNAN sehingga otomatis terbawa tiap
// bulan; yang perlu disalin hanya isian realisasi per indikator. Baris yang sudah terisi
// di bulan tujuan dilewati kecuali overwrite=true.
router.post('/:id/salin-realisasi', async (req, res) => {
  const { skp, error } = await getOwned(req.params.id, req.user, req.unitId);
  if (error) return res.status(error).json({ error: error === 404 ? 'SKP tidak ditemukan' : 'Tidak punya akses.' });
  const dari = isMonth(req.body.dari) ? req.body.dari : null;
  const ke = pickBulan(req);
  if (!dari) return res.status(400).json({ error: 'Bulan sumber tidak valid.' });
  if (dari === ke) return res.status(400).json({ error: 'Bulan sumber dan tujuan sama.' });
  const overwrite = !!req.body.overwrite;

  const [src] = await pool.query(
    'SELECT r.indikator_id, r.realisasi, r.feedback FROM skp_realisasi r JOIN skp_indikator i ON i.id=r.indikator_id WHERE r.skp_id=? AND r.bulan=?',
    [skp.id, dari]
  );
  const [tgt] = await pool.query('SELECT indikator_id, realisasi FROM skp_realisasi WHERE skp_id=? AND bulan=?', [skp.id, ke]);
  const terisi = new Set(tgt.filter((t) => String(t.realisasi || '').trim()).map((t) => t.indikator_id));

  let disalin = 0, dilewati = 0;
  for (const r of src) {
    if (!String(r.realisasi || '').trim()) continue;
    if (terisi.has(r.indikator_id) && !overwrite) { dilewati++; continue; }
    await pool.query(
      `INSERT INTO skp_realisasi (indikator_id, skp_id, bulan, realisasi, feedback) VALUES (?,?,?,?,?)
       ON DUPLICATE KEY UPDATE realisasi=VALUES(realisasi), feedback=VALUES(feedback)`,
      [r.indikator_id, skp.id, ke, r.realisasi, r.feedback]
    );
    disalin++;
  }
  if (!disalin && !dilewati) return res.status(400).json({ error: `Tidak ada realisasi yang bisa disalin dari ${dari}.` });
  res.json({ skp: { ...(await fetchFull(skp, ke)), can_edit: canEditSkp(skp, req.user) }, disalin, dilewati });
});

// ===== Bukti Dukung PER BULAN (tautan / berkas) =====
router.post('/indikator/:indId/bukti', upload.single('file'), async (req, res) => {
  const { skp, error } = await ownedByChild('skp_indikator', req.params.indId, req.user, req.unitId);
  if (error) return res.status(error).json({ error: 'Tidak ditemukan / tidak punya akses.' });
  if (!req.body.deskripsi?.trim()) return res.status(400).json({ error: 'Deskripsi bukti wajib diisi.' });
  const bulan = pickBulan(req);
  const fileUrl = req.file ? `/uploads/skp/${req.file.filename}` : null;
  const [[m]] = await pool.query('SELECT COALESCE(MAX(urutan),0)+1 u FROM skp_bukti WHERE indikator_id=? AND bulan=?', [Number(req.params.indId), bulan]);
  await pool.query(
    'INSERT INTO skp_bukti (indikator_id, skp_id, bulan, urutan, deskripsi, url, file_url, public_token) VALUES (?,?,?,?,?,?,?,?)',
    [Number(req.params.indId), skp.id, bulan, m.u, req.body.deskripsi.trim().slice(0, 255), req.body.url?.trim() || null, fileUrl, genToken()]
  );
  await reply(res, req, skp, bulan, 201);
});
// Bukti tipe 'data': snapshot beku dari sumber data aplikasi NetWatch. Bulan bukti = periode snapshot.
router.post('/indikator/:indId/bukti-data', async (req, res) => {
  const { skp, error } = await ownedByChild('skp_indikator', req.params.indId, req.user, req.unitId);
  if (error) return res.status(error).json({ error: 'Tidak ditemukan / tidak punya akses.' });
  const source = req.body.source;
  const srcDef = DATA_SOURCES.find((s) => s.key === source);
  if (!srcDef) return res.status(400).json({ error: 'Sumber data tidak dikenali.' });
  // Bulan bukti: untuk sumber berbasis bulan pakai periode snapshot; selain itu pakai bulan aktif.
  const bulan = pickBulan(req);
  let snapshot;
  try {
    snapshot = await buildSnapshot(source, { bulan });
  } catch (e) {
    return res.status(400).json({ error: e.message || 'Gagal membangun snapshot data.' });
  }
  const deskripsi = (req.body.deskripsi?.trim() || snapshot.title).slice(0, 255);
  const params = { bulan: srcDef.period === 'month' ? bulan : null };
  const [[m]] = await pool.query('SELECT COALESCE(MAX(urutan),0)+1 u FROM skp_bukti WHERE indikator_id=? AND bulan=?', [Number(req.params.indId), bulan]);
  await pool.query(
    'INSERT INTO skp_bukti (indikator_id, skp_id, bulan, urutan, deskripsi, kind, source, params, snapshot, public_token) VALUES (?,?,?,?,?,?,?,?,?,?)',
    [Number(req.params.indId), skp.id, bulan, m.u, deskripsi, 'data', source, JSON.stringify(params), JSON.stringify(snapshot), genToken()]
  );
  await reply(res, req, skp, bulan, 201);
});

router.put('/bukti/:buktiId', upload.single('file'), async (req, res) => {
  const { skp, error } = await ownedByChild('skp_bukti', req.params.buktiId, req.user, req.unitId);
  if (error) return res.status(error).json({ error: 'Tidak ditemukan / tidak punya akses.' });
  const [cur] = await pool.query('SELECT file_url, bulan FROM skp_bukti WHERE id=?', [Number(req.params.buktiId)]);
  const fileUrl = req.file ? `/uploads/skp/${req.file.filename}` : cur[0]?.file_url || null;
  if (req.file && cur[0]?.file_url) { try { fs.unlinkSync(path.join(DIR, path.basename(cur[0].file_url))); } catch { /* abaikan */ } }
  const b = req.body;
  await pool.query('UPDATE skp_bukti SET deskripsi=COALESCE(?,deskripsi), url=?, file_url=? WHERE id=?',
    [b.deskripsi?.trim()?.slice(0, 255) || null, b.url?.trim() || null, fileUrl, Number(req.params.buktiId)]);
  await reply(res, req, skp, cur[0]?.bulan);
});
router.delete('/bukti/:buktiId', async (req, res) => {
  const { skp, error } = await ownedByChild('skp_bukti', req.params.buktiId, req.user, req.unitId);
  if (error) return res.status(error).json({ error: 'Tidak ditemukan / tidak punya akses.' });
  const [cur] = await pool.query('SELECT file_url, bulan FROM skp_bukti WHERE id=?', [Number(req.params.buktiId)]);
  await pool.query('DELETE FROM skp_bukti WHERE id=?', [Number(req.params.buktiId)]);
  if (cur[0]?.file_url) { try { fs.unlinkSync(path.join(DIR, path.basename(cur[0].file_url))); } catch { /* abaikan */ } }
  await reply(res, req, skp, cur[0]?.bulan);
});

export default router;
