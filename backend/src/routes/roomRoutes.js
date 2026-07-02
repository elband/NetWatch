import { Router } from 'express';
import { pool } from '../db/pool.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { unitScope, unitFilter, rowInUnit, insertUnitId } from '../middleware/unitScope.js';

const router = Router();

// Publik — info ruangan dari kode QR (tanpa login).
router.get('/public/:kode', async (req, res) => {
  const [rows] = await pool.query('SELECT kode, nama, gedung, lantai, area FROM rooms WHERE kode=? AND active=1 LIMIT 1', [req.params.kode]);
  if (!rows[0]) return res.status(404).json({ error: 'Ruangan tidak ditemukan / nonaktif.' });
  res.json({ room: rows[0] });
});

router.use(requireAuth, unitScope);

// Daftar ruangan (admin/koordinator).
router.get('/', requireRole('admin', 'koordinator'), async (req, res) => {
  const uf = unitFilter(req.unitId, 'r.unit_id');
  const [rows] = await pool.query(
    `SELECT r.*, (SELECT COUNT(*) FROM public_reports p WHERE p.room_id=r.id) AS total_laporan,
            (SELECT COUNT(*) FROM public_reports p JOIN incidents i ON i.id=p.incident_id WHERE p.room_id=r.id AND i.status!='selesai') AS gangguan_aktif
       FROM rooms r WHERE 1=1${uf.clause} ORDER BY r.gedung, r.nama`, uf.params);
  res.json({ rooms: rows });
});

router.post('/', requireRole('admin', 'koordinator'), async (req, res) => {
  const b = req.body;
  if (!b.nama?.trim()) return res.status(400).json({ error: 'Nama ruangan wajib.' });
  const unitId = insertUnitId(req);
  if (unitId == null) return res.status(400).json({ error: 'Pilih unit terlebih dahulu.' });
  let kode = (b.kode || '').trim().toUpperCase().replace(/[^A-Z0-9-]/g, '-');
  if (!kode) kode = 'RM-' + b.nama.trim().toUpperCase().replace(/[^A-Z0-9]+/g, '-').slice(0, 20) + '-' + Math.floor(1000 + Math.random() * 9000);
  const [dup] = await pool.query('SELECT id FROM rooms WHERE kode=?', [kode]);
  if (dup.length) return res.status(400).json({ error: 'Kode ruangan sudah dipakai.' });
  const [r] = await pool.query('INSERT INTO rooms (unit_id, kode, nama, gedung, lantai, area, penanggung_jawab, active) VALUES (?,?,?,?,?,?,?,1)',
    [unitId, kode, b.nama.trim(), b.gedung || null, b.lantai || null, b.area || null, b.penanggung_jawab || null]);
  const [rows] = await pool.query('SELECT * FROM rooms WHERE id=?', [r.insertId]);
  res.status(201).json({ room: rows[0] });
});

router.put('/:id', requireRole('admin', 'koordinator'), async (req, res) => {
  const b = req.body;
  const [rows] = await pool.query('SELECT * FROM rooms WHERE id=?', [Number(req.params.id)]);
  if (!rows[0] || !rowInUnit(rows[0], req.unitId)) return res.status(404).json({ error: 'Ruangan tidak ditemukan' });
  await pool.query('UPDATE rooms SET nama=?, gedung=?, lantai=?, area=?, penanggung_jawab=?, active=? WHERE id=?',
    [b.nama?.trim() || rows[0].nama, b.gedung ?? rows[0].gedung, b.lantai ?? rows[0].lantai, b.area ?? rows[0].area, b.penanggung_jawab ?? rows[0].penanggung_jawab, b.active != null ? (b.active ? 1 : 0) : rows[0].active, Number(req.params.id)]);
  const [u] = await pool.query('SELECT * FROM rooms WHERE id=?', [Number(req.params.id)]);
  res.json({ room: u[0] });
});

router.delete('/:id', requireRole('admin', 'koordinator'), async (req, res) => {
  const uf = unitFilter(req.unitId);
  await pool.query(`DELETE FROM rooms WHERE id=?${uf.clause}`, [Number(req.params.id), ...uf.params]);
  res.json({ ok: true });
});

// Bulk generate — buat beberapa ruangan sekaligus (array).
router.post('/bulk', requireRole('admin', 'koordinator'), async (req, res) => {
  const unitId = insertUnitId(req);
  if (unitId == null) return res.status(400).json({ error: 'Pilih unit terlebih dahulu.' });
  const list = Array.isArray(req.body.rooms) ? req.body.rooms : [];
  let created = 0;
  for (const b of list) {
    if (!b.nama?.trim()) continue;
    let kode = (b.kode || '').trim().toUpperCase().replace(/[^A-Z0-9-]/g, '-') || ('RM-' + b.nama.trim().toUpperCase().replace(/[^A-Z0-9]+/g, '-').slice(0, 16) + '-' + Math.floor(1000 + Math.random() * 9000));
    try { await pool.query('INSERT INTO rooms (unit_id, kode, nama, gedung, lantai, area) VALUES (?,?,?,?,?,?)', [unitId, kode, b.nama.trim(), b.gedung || null, b.lantai || null, b.area || null]); created++; } catch { /* lewati duplikat */ }
  }
  res.json({ created });
});

// Dashboard Pelaporan QR.
router.get('/stats', requireRole('admin', 'koordinator'), async (req, res) => {
  const uf = unitFilter(req.unitId);
  const ufr = unitFilter(req.unitId, 'r.unit_id');
  const [[s]] = await pool.query(
    `SELECT SUM(DATE(created_at)=CURDATE()) hari_ini, SUM(DATE_FORMAT(created_at,'%Y-%m')=DATE_FORMAT(CURDATE(),'%Y-%m')) bulan_ini,
            SUM(status='menunggu') menunggu, SUM(status='diproses') diproses, SUM(status='selesai') selesai FROM public_reports WHERE 1=1${uf.clause}`, uf.params);
  const [[inc]] = await pool.query(
    `SELECT AVG(duration_min) mttr, SUM(TIMESTAMPDIFF(MINUTE,created_at,taken_at)<=30) ot, COUNT(taken_at) tot
       FROM incidents WHERE source='public_report' AND created_at>=DATE_SUB(CURDATE(), INTERVAL 30 DAY)${uf.clause}`, uf.params);
  const [topLokasi] = await pool.query(`SELECT COALESCE(ruang,'Tanpa lokasi') lokasi, COUNT(*) jumlah FROM public_reports WHERE 1=1${uf.clause} GROUP BY ruang ORDER BY jumlah DESC LIMIT 5`, uf.params);
  const [topKategori] = await pool.query(`SELECT jenis kategori, COUNT(*) jumlah FROM public_reports WHERE 1=1${uf.clause} GROUP BY jenis ORDER BY jumlah DESC LIMIT 5`, uf.params);
  const [rooms] = await pool.query(
    `SELECT r.id, r.kode, r.nama, r.gedung, r.area,
            (SELECT MAX(i.priority) FROM public_reports p JOIN incidents i ON i.id=p.incident_id WHERE p.room_id=r.id AND i.status!='selesai') AS prio_aktif
       FROM rooms r WHERE r.active=1${ufr.clause}`, ufr.params);
  const peta = rooms.map((r) => ({ ...r, indikator: r.prio_aktif === 'kritis' ? 'merah' : r.prio_aktif ? 'kuning' : 'hijau' }));
  const insight = [];
  if (topLokasi[0]) insight.push(`Lokasi dengan laporan terbanyak: ${topLokasi[0].lokasi} (${topLokasi[0].jumlah} laporan).`);
  if (topKategori[0]) insight.push(`Perangkat/kategori paling sering dilaporkan: ${topKategori[0].kategori} (${topKategori[0].jumlah}).`);
  const merah = peta.filter((p) => p.indikator === 'merah').length;
  if (merah > 0) insight.push(`${merah} lokasi berstatus gangguan kritis — prioritaskan penanganan & jadwalkan preventive maintenance.`);
  else insight.push('Tidak ada gangguan kritis aktif. Pertahankan jadwal preventive maintenance rutin.');
  res.json({
    stats: { hariIni: Number(s.hari_ini) || 0, bulanIni: Number(s.bulan_ini) || 0, menunggu: Number(s.menunggu) || 0, diproses: Number(s.diproses) || 0, selesai: Number(s.selesai) || 0, mttr: Math.round(inc.mttr || 0), sla: inc.tot ? Math.round((Number(inc.ot) / inc.tot) * 100) : 100 },
    topLokasi, topKategori, peta, insight: insight.join(' '),
  });
});

export default router;
