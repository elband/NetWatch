import { Router } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { pool } from '../db/pool.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { queueWaNotification, queueWaRaw } from '../jobs/waQueue.js';
import { notifyRoles } from '../services/notify.js';
import { snapshotAndNotifyOnDuty } from '../controllers/incidentController.js';

const normPhone = (p) => { const d = String(p || '').replace(/[^\d]/g, ''); return d.length >= 8 ? d : null; };

const router = Router();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const RDIR = path.join(__dirname, '..', '..', 'uploads', 'reports');
fs.mkdirSync(RDIR, { recursive: true });
const upload = multer({
  storage: multer.diskStorage({ destination: (q, f, cb) => cb(null, RDIR), filename: (q, f, cb) => cb(null, `R${Date.now()}-${Math.round(Math.random() * 1e9)}${path.extname(f.originalname).toLowerCase()}`) }),
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
    const id = await nextReportId(conn);
    await conn.query(
      `INSERT INTO public_reports (id, nama, nip, unit, hp, judul, jenis, merk, inv, gedung, ruang, room_id, room_code, urgensi, detail, status)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?, 'menunggu')`,
      [id, b.nama?.trim() || 'Pelapor Umum', b.nip || null, b.unit?.trim() || (ruang ? `Pengguna ${ruang}` : 'Umum'), b.hp || '-', b.judul.trim(), b.jenis,
        b.merk || null, b.inv || null, gedung, ruang, roomId, b.room_code || null, ['kritis', 'tinggi', 'sedang', 'rendah'].includes(b.urgensi) ? b.urgensi : 'sedang', b.detail]
    );
    for (const f of req.files || []) await conn.query('INSERT INTO report_attachments (report_id, file_url, mimetype) VALUES (?,?,?)', [id, `/uploads/reports/${f.filename}`, f.mimetype]);
    // Tiket otomatis → insiden ke pool + notifikasi on-duty.
    const [[c]] = await conn.query('SELECT COUNT(*) c FROM incidents');
    const incId = 'INC-' + String(c.c + 1).padStart(3, '0');
    const deviceName = `${b.jenis}${ruang ? ` - ${ruang}` : ''}`;
    const issue = `${b.judul.trim()} (Laporan QR ${id})`;
    const prio = b.urgensi === 'kritis' ? 'kritis' : b.urgensi === 'tinggi' ? 'tinggi' : 'sedang';
    await conn.query(`INSERT INTO incidents (id, device_name, ip, issue, priority, tech_id, status, step, source, public_report_id) VALUES (?,?,?,?,?,NULL,'aktif',0,'public_report',?)`, [incId, deviceName, 'N/A (Laporan QR)', issue, prio, id]);
    await conn.query('INSERT INTO incident_notes (incident_id, step, note) VALUES (?,0,?)', [incId, `Laporan fasilitas via QR (${b.room_code || '-'}): ${b.detail}`]);
    await conn.query('UPDATE public_reports SET incident_id=? WHERE id=?', [incId, id]);
    try { await snapshotAndNotifyOnDuty(conn, { id: incId, priority: prio, deviceName, issue }); } catch { /* abaikan */ }
    try { await notifyRoles(['koordinator', 'admin'], { type: b.urgensi === 'kritis' ? 'public_critical' : 'public_new', title: `Laporan publik${b.urgensi === 'kritis' ? ' KRITIS' : ''}: ${b.judul.trim()}`, message: `${id} · ${ruang || gedung || 'Umum'} — ${b.jenis}`, refId: id, refType: 'public_report', link: `/incidents?focus=${incId}` }); } catch { /* abaikan */ }
    // Notifikasi WA ke pelapor (bila menyertakan nomor HP) — narasi + tautan lacak.
    const reporterPhone = normPhone(b.hp);
    if (reporterPhone) {
      const base = String(b.baseUrl || req.headers.origin || '').replace(/\/$/, '');
      const trackUrl = `${base}/lapor?track=${id}`;
      const sapaan = b.nama?.trim() ? ` ${b.nama.trim()}` : '';
      const prioLabel = { kritis: 'Kritis 🔴', tinggi: 'Tinggi 🟠', sedang: 'Sedang 🟡', rendah: 'Rendah 🟢' }[prio] || 'Sedang';
      const msg = `Halo${sapaan} 🙏\n\nTerima kasih telah melaporkan gangguan fasilitas. Laporan Anda *telah kami terima* dan diteruskan ke tim teknisi Unit Elektronika Bandara.\n\n📋 *Nomor Tiket:* ${id}\n🔧 *Gangguan:* ${b.judul.trim()}\n📍 *Lokasi:* ${ruang || gedung || '-'}\n⚡ *Prioritas:* ${prioLabel}\n⏱️ *Status:* Menunggu penanganan\n\n🔎 Pantau perkembangan laporan Anda:\n${trackUrl}\n\nTim kami akan segera menindaklanjuti. Terima kasih atas partisipasinya menjaga kelancaran layanan bandara. 🛫\n\n— Unit Elektronika Bandara\nA.P.T. Pranoto Samarinda`;
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

router.get('/', requireRole('admin', 'koordinator'), async (req, res) => {
  const [rows] = await pool.query('SELECT * FROM public_reports ORDER BY created_at DESC');
  res.json({ reports: rows });
});

router.put('/:id', requireRole('admin', 'koordinator'), async (req, res) => {
  const { status, techNote } = req.body;
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
  if (!report) return res.status(404).json({ error: 'Laporan tidak ditemukan' });

  const assigned = techId || null;
  const priority = report.urgensi === 'rendah' ? 'sedang' : report.urgensi;
  const deviceName = report.merk ? `${report.jenis} (${report.merk})` : report.jenis;
  const conn = await pool.getConnection();
  try {
    // Petakan gedung laporan ke lokasi (best-effort) untuk peta gangguan.
    let locationId = null;
    if (report.gedung) {
      const [locRows] = await conn.query('SELECT id FROM locations WHERE name LIKE ? LIMIT 1', [`%${report.gedung}%`]);
      locationId = locRows[0]?.id || null;
    }
    const [countRows] = await conn.query('SELECT COUNT(*) as c FROM incidents');
    const incId = 'INC-' + String(countRows[0].c + 1).padStart(3, '0');
    await conn.query(
      `INSERT INTO incidents (id, device_name, ip, location_id, issue, priority, tech_id, status, step, source, public_report_id, taken_at)
       VALUES (?, ?, 'N/A (Laporan Publik)', ?, ?, ?, ?, ?, 0, 'public_report', ?, ${assigned ? 'NOW()' : 'NULL'})`,
      [incId, deviceName, locationId, report.judul, priority, assigned, assigned ? 'proses' : 'aktif', report.id]
    );
    await conn.query('INSERT INTO incident_notes (incident_id, step, note) VALUES (?, 0, ?)', [
      incId, `Dibuat dari laporan publik ${report.id} oleh ${report.nama} (${report.unit}).`,
    ]);

    if (assigned) {
      await queueWaNotification({
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
  const conn = await pool.getConnection();
  try {
    let created = 0;
    for (const r of DEMO_REPORTS) {
      const id = await nextReportId(conn);
      await conn.query(
        `INSERT INTO public_reports (id, nama, nip, unit, hp, judul, jenis, merk, inv, gedung, ruang, urgensi, detail, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'menunggu')`,
        [id, r.nama, r.nip, r.unit, r.hp, r.judul, r.jenis, r.merk, r.inv, r.gedung, r.ruang, r.urgensi, r.detail]
      );
      created++;
    }
    res.status(201).json({ created });
  } finally {
    conn.release();
  }
});

router.delete('/', requireRole('admin'), async (req, res) => {
  const [result] = await pool.query('DELETE FROM public_reports');
  res.json({ deleted: result.affectedRows });
});

export default router;
