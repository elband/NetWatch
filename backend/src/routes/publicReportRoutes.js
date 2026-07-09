import { Router } from 'express';
import multer from 'multer';
import { randName } from '../middleware/upload.js';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { pool } from '../db/pool.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { unitScope, unitFilter, rowInUnit, insertUnitId } from '../middleware/unitScope.js';
import { queueWaNotification, queueWaRaw } from '../jobs/waQueue.js';
import { escapeLike } from '../utils/sql.js';
import { notifyRoles } from '../services/notify.js';
import { snapshotAndNotifyOnDuty } from '../controllers/incidentController.js';
import { isNotifyEnabledForUser } from '../services/notifyPrefs.js';
import { nextIncidentId } from '../utils/incidentId.js';

const normPhone = (p) => { const d = String(p || '').replace(/[^\d]/g, ''); return d.length >= 8 ? d : null; };

const router = Router();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const RDIR = path.join(__dirname, '..', '..', 'uploads', 'reports');
fs.mkdirSync(RDIR, { recursive: true });
const upload = multer({
  storage: multer.diskStorage({ destination: (q, f, cb) => cb(null, RDIR), filename: (q, f, cb) => cb(null, randName('R', f.originalname)) }),
  limits: { fileSize: 25 * 1024 * 1024, files: 6 },
});
async function nextReportId(conn) {
  const [rows] = await conn.query('SELECT COUNT(*) as c FROM public_reports');
  return 'LAP-' + String(rows[0].c + 1).padStart(4, '0');
}

// Publik — tanpa login. Lokasi otomatis dari QR (room_code). Tiket & insiden dibuat otomatis.
router.post('/', upload.array('foto', 6), async (req, res) => {
  const b = req.body;
  if (!b.judul || !b.jenis || !b.detail) return res.status(400).json({ error: 'Kategori, perangkat/judul, dan deskripsi gangguan wajib diisi.' });
  const conn = await pool.getConnection();
  try {
    let gedung = b.gedung || null, ruang = b.ruang || null, roomId = null;
    if (b.room_code) {
      const [rm] = await conn.query('SELECT * FROM rooms WHERE kode=? AND active=1', [b.room_code]);
      if (rm[0]) { roomId = rm[0].id; gedung = rm[0].gedung || gedung; ruang = `${rm[0].nama}${rm[0].lantai ? ` · ${rm[0].lantai}` : ''}${rm[0].area ? ` · ${rm[0].area}` : ''}`; }
    }
    // Multi-unit: unit tujuan dari form (harus unit aktif); kosong/invalid
    // default ke unit ELB (id 1) agar QR/link lama tetap berfungsi.
    let unitId = 1;
    const reqUnit = Number(b.unit_id);
    if (Number.isInteger(reqUnit) && reqUnit > 0) {
      const [un] = await conn.query('SELECT id FROM units WHERE id=? AND active=1', [reqUnit]);
      if (un[0]) unitId = un[0].id;
    }
    // Nama unit tujuan untuk narasi WA ke pelapor (mengikuti unit yang dipilih).
    const [[unitRow]] = await conn.query('SELECT name FROM units WHERE id=?', [unitId]);
    const unitName = unitRow?.name || 'Elektronika Bandara';
    // Deteksi otomatis perangkat: bila laporan berasal dari scan QR aset, kaitkan device_id
    // agar aset ber-status "Rusak" otomatis selama laporan/insiden belum tuntas.
    let deviceId = null, assetName = null;
    if (b.aset_token && /^[a-f0-9]{32}$/.test(b.aset_token)) {
      const [[dv]] = await conn.query("SELECT id, name FROM devices WHERE qr_token=? AND unit_id=? LIMIT 1", [b.aset_token, unitId]);
      if (dv) { deviceId = dv.id; assetName = dv.name; }
    }
    const id = await nextReportId(conn);
    await conn.query(
      `INSERT INTO public_reports (id, nama, nip, unit, hp, judul, jenis, merk, inv, gedung, ruang, room_id, room_code, urgensi, detail, status, unit_id, device_id)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?, 'menunggu', ?, ?)`,
      [id, b.nama?.trim() || 'Pelapor Umum', b.nip || null, b.unit?.trim() || (ruang ? `Pengguna ${ruang}` : 'Umum'), b.hp || '-', b.judul.trim(), b.jenis,
        b.merk || null, b.inv || null, gedung, ruang, roomId, b.room_code || null, ['kritis', 'tinggi', 'sedang', 'rendah'].includes(b.urgensi) ? b.urgensi : 'sedang', b.detail, unitId, deviceId]
    );
    for (const f of req.files || []) await conn.query('INSERT INTO report_attachments (report_id, file_url, mimetype) VALUES (?,?,?)', [id, `/uploads/reports/${f.filename}`, f.mimetype]);
    // Tiket otomatis → insiden ke pool + notifikasi on-duty.
    const incId = await nextIncidentId(conn);
    const deviceName = assetName || `${b.jenis}${ruang ? ` - ${ruang}` : ''}`;
    const issue = `${b.judul.trim()} (Laporan QR ${id})`;
    const prio = b.urgensi === 'kritis' ? 'kritis' : b.urgensi === 'tinggi' ? 'tinggi' : 'sedang';
    await conn.query(`INSERT INTO incidents (id, device_id, device_name, ip, issue, priority, tech_id, status, step, source, public_report_id, unit_id) VALUES (?,?,?,?,?,?,NULL,'aktif',0,'public_report',?,?)`, [incId, deviceId, deviceName, 'N/A (Laporan QR)', issue, prio, id, unitId]);
    await conn.query('INSERT INTO incident_notes (incident_id, step, note) VALUES (?,0,?)', [incId, `Laporan fasilitas via QR (${b.room_code || '-'}): ${b.detail}`]);
    await conn.query('UPDATE public_reports SET incident_id=? WHERE id=?', [incId, id]);
    try { await snapshotAndNotifyOnDuty(conn, { id: incId, priority: prio, deviceName, issue }); } catch { /* abaikan */ }
    try { await notifyRoles(['koordinator', 'admin'], { type: b.urgensi === 'kritis' ? 'public_critical' : 'public_new', title: `Laporan publik${b.urgensi === 'kritis' ? ' KRITIS' : ''}: ${b.judul.trim()}`, message: `${id} · ${ruang || gedung || 'Umum'} — ${b.jenis}`, refId: id, refType: 'public_report', link: `/incidents?focus=${incId}` }, { unitId }); } catch { /* abaikan */ }
    // Notifikasi WA ke pelapor (bila menyertakan nomor HP) — narasi + tautan lacak.
    const reporterPhone = normPhone(b.hp);
    if (reporterPhone) {
      const base = String(b.baseUrl || req.headers.origin || '').replace(/\/$/, '');
      const trackUrl = `${base}/lapor?track=${id}`;
      const sapaan = b.nama?.trim() ? ` ${b.nama.trim()}` : '';
      const prioLabel = { kritis: 'Kritis 🔴', tinggi: 'Tinggi 🟠', sedang: 'Sedang 🟡', rendah: 'Rendah 🟢' }[prio] || 'Sedang';
      const msg = `Halo${sapaan} 🙏\n\nTerima kasih telah melaporkan gangguan fasilitas. Laporan Anda *telah kami terima* dan diteruskan ke tim teknisi Unit ${unitName}.\n\n📋 *Nomor Tiket:* ${id}\n🔧 *Gangguan:* ${b.judul.trim()}\n📍 *Lokasi:* ${ruang || gedung || '-'}\n⚡ *Prioritas:* ${prioLabel}\n⏱️ *Status:* Menunggu penanganan\n\n🔎 Pantau perkembangan laporan Anda:\n${trackUrl}\n\nTim kami akan segera menindaklanjuti. Terima kasih atas partisipasinya menjaga kelancaran layanan bandara. 🛫\n\n— Seksi Teknik dan Operasi\nBandara A.P.T Pranoto`;
      try { await queueWaRaw({ type: 'other', toLabel: `Pelapor ${b.nama?.trim() || id}`, phone: reporterPhone, message: msg, relatedIncidentId: incId }); } catch { /* abaikan */ }
    }
    res.status(201).json({ id, incident_id: incId });
  } finally { conn.release(); }
});

// Publik — lacak status tiket tanpa login.
router.get('/track/:id', async (req, res) => {
  const [rows] = await pool.query(
    `SELECT pr.id, pr.judul, pr.jenis, pr.ruang, pr.gedung, pr.urgensi, pr.status, pr.created_at,
            i.status inc_status, i.taken_at, i.resolved_at, i.duration_min, u.name tech_name, r.perbaikan, r.hasil
       FROM public_reports pr LEFT JOIN incidents i ON i.id=pr.incident_id LEFT JOIN users u ON u.id=i.tech_id LEFT JOIN incident_reports r ON r.incident_id=i.id
      WHERE pr.id=? LIMIT 1`, [req.params.id.toUpperCase()]);
  if (!rows[0]) return res.status(404).json({ error: 'Nomor tiket tidak ditemukan.' });
  const t = rows[0];
  const stage = t.resolved_at ? 'Selesai' : t.taken_at ? 'Dalam Penanganan' : t.inc_status ? 'Diproses' : 'Menunggu';
  res.json({ ticket: { ...t, stage } });
});

router.use(requireAuth);
router.use(unitScope);

router.get('/', requireRole('admin', 'koordinator'), async (req, res) => {
  const uf = unitFilter(req.unitId);
  const [rows] = await pool.query(`SELECT * FROM public_reports WHERE 1=1${uf.clause} ORDER BY created_at DESC`, uf.params);
  res.json({ reports: rows });
});

router.put('/:id', requireRole('admin', 'koordinator'), async (req, res) => {
  const { status, techNote } = req.body;
  const [chk] = await pool.query('SELECT id, unit_id FROM public_reports WHERE id = ?', [req.params.id]);
  if (!chk[0] || !rowInUnit(chk[0], req.unitId)) return res.status(404).json({ error: 'Laporan tidak ditemukan' });
  await pool.query('UPDATE public_reports SET status = COALESCE(?, status), tech_note = COALESCE(?, tech_note) WHERE id = ?', [
    status || null, techNote ?? null, req.params.id,
  ]);
  const [rows] = await pool.query('SELECT * FROM public_reports WHERE id = ?', [req.params.id]);
  res.json({ report: rows[0] });
});

router.post('/:id/assign-incident', requireRole('admin', 'koordinator'), async (req, res) => {
  // techId opsional: jika diisi, insiden langsung ditugaskan; jika kosong,
  // insiden masuk ke POOL dan dikirim ke semua teknisi on-duty.
  const { techId } = req.body;
  const [rows] = await pool.query('SELECT * FROM public_reports WHERE id = ?', [req.params.id]);
  const report = rows[0];
  if (!report || !rowInUnit(report, req.unitId)) return res.status(404).json({ error: 'Laporan tidak ditemukan' });

  const assigned = techId || null;
  const priority = report.urgensi === 'rendah' ? 'sedang' : report.urgensi;
  const deviceName = report.merk ? `${report.jenis} (${report.merk})` : report.jenis;
  const conn = await pool.getConnection();
  try {
    // Petakan gedung laporan ke lokasi (best-effort) untuk peta gangguan.
    let locationId = null;
    if (report.gedung) {
      const [locRows] = await conn.query("SELECT id FROM locations WHERE name LIKE ? ESCAPE '\\\\' LIMIT 1", [`%${escapeLike(report.gedung)}%`]);
      locationId = locRows[0]?.id || null;
    }
    const incId = await nextIncidentId(conn);
    // Unit insiden mengikuti unit laporan publik; laporan lama tanpa unit
    // memakai unit efektif request sebagai cadangan.
    const incUnit = report.unit_id ?? insertUnitId(req);
    await conn.query(
      `INSERT INTO incidents (id, device_name, ip, location_id, issue, priority, tech_id, status, step, source, public_report_id, unit_id, taken_at)
       VALUES (?, ?, 'N/A (Laporan Publik)', ?, ?, ?, ?, ?, 0, 'public_report', ?, ?, ${assigned ? 'NOW()' : 'NULL'})`,
      [incId, deviceName, locationId, report.judul, priority, assigned, assigned ? 'proses' : 'aktif', report.id, incUnit]
    );
    await conn.query('INSERT INTO incident_notes (incident_id, step, note) VALUES (?, 0, ?)', [
      incId, `Dibuat dari laporan publik ${report.id} oleh ${report.nama} (${report.unit}).`,
    ]);

    if (assigned) {
      if (await isNotifyEnabledForUser('insiden_teknisi', assigned)) await queueWaNotification({
        type: 'alert', toUserId: assigned, relatedIncidentId: incId,
        message: `🚨 ALERT ${priority.toUpperCase()}\n${deviceName}\nMasalah: ${report.judul}`,
      });
    } else {
      const n = await snapshotAndNotifyOnDuty(conn, { id: incId, priority, deviceName, issue: report.judul });
      await conn.query('INSERT INTO incident_notes (incident_id, step, note) VALUES (?, 0, ?)', [
        incId, n ? `Notifikasi dikirim ke ${n} teknisi on-duty.` : 'Tidak ada teknisi on-duty saat ini — insiden menunggu di pool.',
      ]);
    }

    await conn.query("UPDATE public_reports SET status='diproses', incident_id=?, tech_note=? WHERE id=?", [
      incId, `Insiden ${incId} dibuat.`, report.id,
    ]);
    res.json({ incidentId: incId });
  } finally {
    conn.release();
  }
});

const DEMO_REPORTS = [
  { nama: 'Rudi Hartono', nip: '198503152010011002', unit: 'Bagian Keuangan', hp: '+628121111001', judul: 'Printer tidak bisa mencetak', jenis: 'Printer', merk: 'Epson L3210', inv: 'INV-PRN-014', gedung: 'Gedung A', ruang: 'Lt.2 - Ruang Keuangan', urgensi: 'sedang', detail: 'Printer menyala tetapi hasil cetak kosong/bergaris. Sudah dicoba ganti kertas tetap tidak keluar tinta.' },
  { nama: 'Maya Sari', nip: '199007222015032001', unit: 'Bagian Kepegawaian', hp: '+628121111002', judul: 'Komputer sering restart sendiri', jenis: 'PC Desktop', merk: 'HP ProDesk', inv: 'INV-PC-088', gedung: 'Gedung A', ruang: 'Lt.3 - Ruang Kepegawaian', urgensi: 'tinggi', detail: 'PC tiba-tiba mati dan restart sendiri terutama saat membuka aplikasi berat. Pekerjaan jadi terganggu.' },
  { nama: 'Andi Wijaya', nip: null, unit: 'Bagian Umum', hp: '+628121111003', judul: 'Wifi lambat di ruang rapat', jenis: 'Jaringan / Wifi', merk: null, inv: null, gedung: 'Gedung B', ruang: 'Lt.1 - Ruang Rapat Utama', urgensi: 'kritis', detail: 'Koneksi wifi sangat lambat dan sering putus saat rapat zoom dengan pusat. Mohon segera dicek karena ada agenda penting besok.' },
  { nama: 'Dewi Lestari', nip: '199512012018012003', unit: 'Bagian Arsip', hp: '+628121111004', judul: 'Scanner dokumen error', jenis: 'Scanner', merk: 'Canon DR-C225', inv: 'INV-SCN-005', gedung: 'Gedung A', ruang: 'Lt.1 - Ruang Arsip', urgensi: 'rendah', detail: 'Scanner menampilkan pesan error saat dinyalakan. Lampu indikator berkedip merah terus menerus.' },
  { nama: 'Bayu Saputra', nip: '198811102012011005', unit: 'Bagian Pelayanan', hp: '+628121111005', judul: 'Monitor mati total', jenis: 'Monitor', merk: 'LG 24"', inv: 'INV-MON-201', gedung: 'Gedung B', ruang: 'Lt.2 - Loket Pelayanan 3', urgensi: 'tinggi', detail: 'Monitor di loket pelayanan tidak menyala sama sekali walaupun kabel sudah dicek. Mengganggu pelayanan publik.' },
];

router.post('/seed-demo', requireRole('admin'), async (req, res) => {
  const unitId = insertUnitId(req);
  if (unitId == null) return res.status(400).json({ error: 'Pilih unit terlebih dahulu.' });
  const conn = await pool.getConnection();
  try {
    let created = 0;
    for (const r of DEMO_REPORTS) {
      const id = await nextReportId(conn);
      await conn.query(
        `INSERT INTO public_reports (id, nama, nip, unit, hp, judul, jenis, merk, inv, gedung, ruang, urgensi, detail, status, unit_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'menunggu', ?)`,
        [id, r.nama, r.nip, r.unit, r.hp, r.judul, r.jenis, r.merk, r.inv, r.gedung, r.ruang, r.urgensi, r.detail, unitId]
      );
      created++;
    }
    res.status(201).json({ created });
  } finally {
    conn.release();
  }
});

router.delete('/', requireRole('admin'), async (req, res) => {
  const uf = unitFilter(req.unitId);
  const [result] = await pool.query(`DELETE FROM public_reports WHERE 1=1${uf.clause}`, uf.params);
  res.json({ deleted: result.affectedRows });
});

export default router;
