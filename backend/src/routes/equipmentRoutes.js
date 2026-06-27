import { Router } from 'express';
import multer from 'multer';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { aoaToBuffer, bufferToAoa, xlsxDateToYmd } from '../utils/xlsx.js';
import exifr from 'exifr';
import { pool } from '../db/pool.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { getDutyStatus, dateKey } from '../config/shifts.js';
import { withInspectionPhoto, INSPECTION_DIR } from '../middleware/upload.js';
import { queueWaNotification } from '../jobs/waQueue.js';
import { isNotifyEnabled } from '../services/notifyPrefs.js';

const router = Router();
router.use(requireAuth);

const SLOTS = ['09', '12', '15'];
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

// Penyimpanan dokumentasi maintenance (foto/PDF) ke disk.
const MAINT_DIR = path.join(path.dirname(INSPECTION_DIR), 'maintenance');
fs.mkdirSync(MAINT_DIR, { recursive: true });
const maintUpload = multer({
  storage: multer.diskStorage({
    destination: (req, f, cb) => cb(null, MAINT_DIR),
    filename: (req, f, cb) => cb(null, `M${Date.now()}-${Math.round(Math.random() * 1e9)}${path.extname(f.originalname).toLowerCase()}`),
  }),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, f, cb) => cb(null, ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'application/pdf'].includes(f.mimetype)),
});

// Ambang verifikasi anti-foto-palsu.
const FRESH_MINUTES = 30;   // foto harus diambil <= 30 menit dari sekarang (dari EXIF)
const PROXIMITY_M = 200;    // lokasi foto harus <= 200 m dari koordinat perangkat
const STRICT_VERIFY = false; // true = tolak bila tak terverifikasi; false = simpan tapi ditandai

// Jarak dua titik (meter) — formula haversine.
function haversine(lat1, lng1, lat2, lng2) {
  const R = 6371000, toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1), dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return Math.round(R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
}

// Jendela jam tiap slot inspeksi (jam desimal). Inspeksi hanya boleh diisi
// dalam jendelanya dan untuk hari ini; setelah lewat, slot terkunci.
const SLOT_WINDOWS = { '09': [8.5, 11], '12': [11, 14], '15': [14, 17] };
function slotOpen(slot, d = new Date()) {
  const w = SLOT_WINDOWS[slot];
  if (!w) return false;
  const h = d.getHours() + d.getMinutes() / 60;
  return h >= w[0] && h < w[1];
}
function openSlots(d = new Date()) {
  return SLOTS.filter((s) => slotOpen(s, d));
}

// Slot inspeksi yang sedang berjalan berdasarkan jam (untuk highlight & validasi ringan).
function currentSlot(d = new Date()) {
  const h = d.getHours();
  if (h < 11) return '09';
  if (h < 14) return '12';
  return '15';
}

// Bolehkah user input inspeksi? Teknisi harus on-duty; koord/admin selalu boleh.
async function canInspect(user) {
  if (user.role === 'admin' || user.role === 'koordinator') return true;
  if (user.role === 'teknisi') {
    const { onDuty } = await getDutyStatus(pool, user.id);
    return onDuty;
  }
  return false;
}

// ===================== INSPEKSI HARIAN =====================
router.get('/inspections', async (req, res) => {
  const date = /^\d{4}-\d{2}-\d{2}$/.test(req.query.date) ? req.query.date : dateKey(new Date());
  const [devices] = await pool.query('SELECT id, name, ip, type, loc, status FROM devices WHERE inspect_required=1 ORDER BY name');
  const [insp] = await pool.query('SELECT * FROM equipment_inspections WHERE inspect_date = ?', [date]);
  const byDevice = {};
  for (const r of insp) (byDevice[r.device_id] ||= {})[r.slot] = r;
  const list = devices.map((d) => ({ ...d, inspections: byDevice[d.id] || {} }));
  const today = dateKey(new Date());
  res.json({
    date,
    today,
    isToday: date === today,
    slots: SLOTS,
    slotWindows: SLOT_WINDOWS,
    currentSlot: currentSlot(),
    openSlots: openSlots(),
    canInput: await canInspect(req.user),
    devices: list,
  });
});

router.post('/inspections', withInspectionPhoto, async (req, res) => {
  const { deviceId, slot, status, note } = req.body;
  if (!deviceId || !SLOTS.includes(String(slot))) return res.status(400).json({ error: 'Perangkat & slot wajib valid.' });
  const validStatus = ['baik', 'perhatian', 'rusak'];
  const st = validStatus.includes(status) ? status : 'baik';
  if (!(await canInspect(req.user))) return res.status(403).json({ error: 'Hanya teknisi on-duty (atau koordinator/admin) yang bisa input inspeksi.' });

  // Waktu ditentukan SERVER, bukan klien: hanya hari ini & dalam jendela slot.
  const today = dateKey(new Date());
  const date = req.body.date || today;
  if (date !== today) return res.status(403).json({ error: 'Inspeksi hanya bisa diisi untuk hari ini (tidak boleh backdate).' });
  if (!slotOpen(String(slot))) {
    const [a, b] = SLOT_WINDOWS[String(slot)];
    const fmt = (x) => `${String(Math.floor(x)).padStart(2, '0')}:${String(Math.round((x % 1) * 60)).padStart(2, '0')}`;
    return res.status(403).json({ error: `Slot ${slot}:00 hanya bisa diisi pukul ${fmt(a)}–${fmt(b)}. Slot di luar jam ini terkunci.` });
  }

  // Foto dokumentasi WAJIB.
  if (!req.file) return res.status(400).json({ error: 'Foto dokumentasi inspeksi wajib diunggah.' });

  // Anti-foto-palsu: tolak bila foto identik (hash sama) sudah pernah dipakai
  // pada inspeksi lain (mencegah pakai ulang foto yang sama).
  const hash = crypto.createHash('sha256').update(req.file.buffer).digest('hex');
  const [dups] = await pool.query(
    `SELECT id FROM equipment_inspections
      WHERE photo_hash = ? AND NOT (device_id = ? AND inspect_date = ? AND slot = ?) LIMIT 1`,
    [hash, deviceId, date, String(slot)]
  );
  if (dups.length) return res.status(409).json({ error: 'Foto ini sudah pernah dipakai pada inspeksi lain. Gunakan foto baru hasil pengecekan saat ini.' });

  // Ambil koordinat perangkat (untuk cek GPS proximity).
  const [devRows] = await pool.query('SELECT name, lat, lng FROM devices WHERE id = ?', [deviceId]);
  const device = devRows[0];
  if (!device) return res.status(404).json({ error: 'Perangkat tidak ditemukan.' });

  // ---- EXIF freshness ----
  let exifTime = null, exifGps = null;
  try { const p = await exifr.parse(req.file.buffer, ['DateTimeOriginal', 'CreateDate']); if (p) exifTime = p.DateTimeOriginal || p.CreateDate || null; } catch { /* abaikan */ }
  try { exifGps = await exifr.gps(req.file.buffer); } catch { /* abaikan */ }

  let freshOk = false, freshReason = 'Foto tanpa metadata waktu (EXIF) — gunakan foto kamera langsung.';
  if (exifTime) {
    const diffMin = Math.abs(Date.now() - new Date(exifTime).getTime()) / 60000;
    freshOk = diffMin <= FRESH_MINUTES;
    if (!freshOk) freshReason = `Foto diambil ${Math.round(diffMin)} menit lalu (maks ${FRESH_MINUTES} menit) — bukan foto saat ini.`;
  }

  // ---- GPS proximity ----
  // Sumber lokasi foto: EXIF GPS, lalu fallback geolokasi browser (lat/lng form).
  const photoLat = exifGps?.latitude ?? (req.body.lat ? Number(req.body.lat) : null);
  const photoLng = exifGps?.longitude ?? (req.body.lng ? Number(req.body.lng) : null);
  let distance = null, proxOk = true, proxReason = '';
  if (device.lat != null && device.lng != null) {
    if (photoLat != null && photoLng != null && !Number.isNaN(photoLat) && !Number.isNaN(photoLng)) {
      distance = haversine(Number(device.lat), Number(device.lng), photoLat, photoLng);
      proxOk = distance <= PROXIMITY_M;
      if (!proxOk) proxReason = `Lokasi foto ${distance} m dari perangkat (maks ${PROXIMITY_M} m).`;
    } else {
      proxOk = false; proxReason = 'Lokasi foto tidak terdeteksi (aktifkan GPS/izin lokasi).';
    }
  }

  const verified = freshOk && proxOk;
  if (STRICT_VERIFY && !verified) {
    return res.status(422).json({ error: `Verifikasi gagal: ${[!freshOk && freshReason, !proxOk && proxReason].filter(Boolean).join(' ')}` });
  }

  // Tulis file ke disk setelah lolos validasi.
  const ext = (path.extname(req.file.originalname).toLowerCase() || '.jpg').replace(/[^.a-z0-9]/g, '');
  const filename = `insp-${deviceId}-${date}-${slot}-${Date.now()}${ext}`;
  fs.writeFileSync(path.join(INSPECTION_DIR, filename), req.file.buffer);
  const photoUrl = `/uploads/inspections/${filename}`;

  await pool.query(
    `INSERT INTO equipment_inspections (device_id, inspect_date, slot, status, note, photo_url, photo_hash, verified, distance_m, inspected_by, inspector_name)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE status=VALUES(status), note=VALUES(note),
       photo_url=VALUES(photo_url), photo_hash=VALUES(photo_hash), verified=VALUES(verified),
       distance_m=VALUES(distance_m), inspected_by=VALUES(inspected_by), inspector_name=VALUES(inspector_name)`,
    [deviceId, date, String(slot), st, note?.trim() || null, photoUrl, hash, verified ? 1 : 0, distance, req.user.id, req.user.name]
  );

  // Notifikasi otomatis ke koordinator bahwa perangkat sudah diinspeksi.
  if (await isNotifyEnabled('pengajuan_review_koordinator', 'koordinator')) {
    const [coords] = await pool.query("SELECT id FROM users WHERE active = 1 AND (role = 'koordinator' OR JSON_CONTAINS(roles, '\"koordinator\"'))");
    const stEmoji = st === 'rusak' ? '🔴' : st === 'perhatian' ? '🟡' : '🟢';
    const verifyTag = verified ? '✅ terverifikasi' : '⚠️ belum terverifikasi';
    for (const c of coords) {
      await queueWaNotification({
        type: 'other',
        toUserId: c.id,
        message: `🔍 INSPEKSI ${stEmoji} ${st.toUpperCase()}\n${device.name} · slot ${slot}:00\nOleh: ${req.user.name}\nFoto: ${verifyTag}${distance != null ? ` · ${distance} m` : ''}${note?.trim() ? `\nCatatan: ${note.trim()}` : ''}`,
      });
    }
  }

  const [rows] = await pool.query(
    'SELECT * FROM equipment_inspections WHERE device_id=? AND inspect_date=? AND slot=?',
    [deviceId, date, String(slot)]
  );
  res.json({ inspection: rows[0], verified, distance, warning: verified ? null : [!freshOk && freshReason, !proxOk && proxReason].filter(Boolean).join(' ') });
});

// ===================== MAINTENANCE BULANAN =====================
router.get('/maintenance', async (req, res) => {
  const month = /^\d{4}-\d{2}$/.test(req.query.month)
    ? req.query.month
    : `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}`;
  const [rows] = await pool.query(
    `SELECT m.*, d.name AS device_name, d.ip AS device_ip, d.type AS device_type,
            ub.name AS done_by_name,
            (SELECT COUNT(*) FROM equipment_maintenance_photos p WHERE p.maintenance_id = m.id) AS photo_count
       FROM equipment_maintenance m
       JOIN devices d ON d.id = m.device_id
       LEFT JOIN users ub ON ub.id = m.done_by
      WHERE m.plan_month = ?
      ORDER BY m.scheduled_date ASC, d.name ASC`,
    [month]
  );
  res.json({ month, maintenance: rows });
});

router.post('/maintenance', requireRole('admin', 'koordinator'), maintUpload.single('doc'), async (req, res) => {
  const { deviceId, scheduledDate, task, note } = req.body;
  if (!deviceId || !/^\d{4}-\d{2}-\d{2}$/.test(scheduledDate || '') || !task?.trim()) {
    return res.status(400).json({ error: 'Perangkat, tanggal (YYYY-MM-DD), dan tugas wajib diisi.' });
  }
  const month = scheduledDate.slice(0, 7);
  const docUrl = req.file ? `/uploads/maintenance/${req.file.filename}` : null;
  const [r] = await pool.query(
    `INSERT INTO equipment_maintenance (device_id, plan_month, scheduled_date, task, note, doc_url, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [deviceId, month, scheduledDate, task.trim(), note?.trim() || null, docUrl, req.user.id]
  );
  res.status(201).json({ id: r.insertId, doc_url: docUrl });
});

// Update status (teknisi boleh menandai selesai/batal saat eksekusi) + dokumentasi.
// Saat menandai SELESAI wajib ada dokumentasi (upload/kamera) → lalu notifikasi ke koordinator.
router.put('/maintenance/:id', maintUpload.single('doc'), async (req, res) => {
  const { status, note } = req.body;
  const valid = ['rencana', 'selesai', 'batal'];
  if (!valid.includes(status)) return res.status(400).json({ error: 'Status tidak valid.' });
  const [rows] = await pool.query(
    'SELECT m.*, d.name AS device_name FROM equipment_maintenance m JOIN devices d ON d.id=m.device_id WHERE m.id=?',
    [req.params.id]
  );
  const m = rows[0];
  if (!m) return res.status(404).json({ error: 'Data maintenance tidak ditemukan.' });
  const docUrl = req.file ? `/uploads/maintenance/${req.file.filename}` : null;

  if (status === 'selesai') {
    const [[pc]] = await pool.query('SELECT COUNT(*) AS c FROM equipment_maintenance_photos WHERE maintenance_id = ?', [req.params.id]);
    if (pc.c === 0 && !docUrl && !m.doc_url) return res.status(400).json({ error: 'Unggah minimal 1 foto dokumentasi sebelum menandai maintenance selesai.' });
    await pool.query(
      'UPDATE equipment_maintenance SET status=?, note=COALESCE(?, note), doc_url=COALESCE(?, doc_url), done_by=?, done_at=NOW() WHERE id=?',
      [status, note?.trim() || null, docUrl, req.user.id, req.params.id]
    );
    // Notifikasi ke seluruh koordinator (WA + tercatat di Log WhatsApp).
    const [coords] = await pool.query("SELECT id FROM users WHERE active=1 AND (role='koordinator' OR JSON_CONTAINS(roles,'\"koordinator\"'))");
    const when = new Date().toLocaleString('id-ID', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
    const docInfo = pc.c > 0 ? `${pc.c} foto dokumentasi dilampirkan` : 'Dokumentasi telah dilampirkan';
    const msg = `🛠️ *Maintenance Selesai*\nPerangkat: ${m.device_name}\nTugas: ${m.task}\nOleh: ${req.user.name}\nWaktu: ${when}\n${docInfo} di sistem.`;
    if (await isNotifyEnabled('pengajuan_review_koordinator', 'koordinator')) {
      for (const c of coords) { try { await queueWaNotification({ type: 'report', toUserId: c.id, message: msg }); } catch { /* abaikan */ } }
    }
    req.app.get('io')?.emit('maintenance:done', { id: m.id, device: m.device_name, by: req.user.name });
    return res.json({ ok: true, doc_url: docUrl, notified: coords.length });
  }

  await pool.query(
    'UPDATE equipment_maintenance SET status=?, note=COALESCE(?, note), doc_url=COALESCE(?, doc_url), done_by=NULL, done_at=NULL WHERE id=?',
    [status, note?.trim() || null, docUrl, req.params.id]
  );
  res.json({ ok: true, doc_url: docUrl });
});

// ── Dokumentasi foto maintenance (banyak foto per rencana) ──
// Daftar foto sebuah maintenance.
router.get('/maintenance/:id/photos', async (req, res) => {
  const [photos] = await pool.query(
    `SELECT p.id, p.url, p.caption, p.created_at, u.name AS uploaded_by_name
       FROM equipment_maintenance_photos p
       LEFT JOIN users u ON u.id = p.uploaded_by
      WHERE p.maintenance_id = ? ORDER BY p.id ASC`,
    [req.params.id]
  );
  res.json({ photos });
});

// Unggah satu/banyak foto sekaligus untuk sebuah maintenance.
router.post('/maintenance/:id/photos', maintUpload.array('photos', 20), async (req, res) => {
  const [[m]] = await pool.query('SELECT id FROM equipment_maintenance WHERE id = ?', [req.params.id]);
  if (!m) return res.status(404).json({ error: 'Data maintenance tidak ditemukan.' });
  const files = req.files || [];
  if (!files.length) return res.status(400).json({ error: 'Tidak ada foto yang diunggah.' });
  for (const f of files) {
    await pool.query(
      'INSERT INTO equipment_maintenance_photos (maintenance_id, url, uploaded_by) VALUES (?, ?, ?)',
      [req.params.id, `/uploads/maintenance/${f.filename}`, req.user.id]
    );
  }
  const [photos] = await pool.query(
    `SELECT p.id, p.url, p.caption, p.created_at, u.name AS uploaded_by_name
       FROM equipment_maintenance_photos p LEFT JOIN users u ON u.id = p.uploaded_by
      WHERE p.maintenance_id = ? ORDER BY p.id ASC`,
    [req.params.id]
  );
  res.status(201).json({ photos });
});

// Hapus satu foto dokumentasi (+ berkas di disk).
router.delete('/maintenance/photos/:photoId', async (req, res) => {
  const [[ph]] = await pool.query('SELECT url FROM equipment_maintenance_photos WHERE id = ?', [req.params.photoId]);
  if (!ph) return res.status(404).json({ error: 'Foto tidak ditemukan.' });
  await pool.query('DELETE FROM equipment_maintenance_photos WHERE id = ?', [req.params.photoId]);
  try { fs.unlinkSync(path.join(MAINT_DIR, path.basename(ph.url))); } catch { /* berkas mungkin sudah tiada */ }
  res.json({ ok: true });
});

router.delete('/maintenance/:id', requireRole('admin', 'koordinator'), async (req, res) => {
  await pool.query('DELETE FROM equipment_maintenance WHERE id = ?', [req.params.id]);
  res.json({ ok: true });
});

// ----- Template Excel (download) -----
router.get('/maintenance/template', requireRole('admin', 'koordinator'), async (req, res) => {
  const [devices] = await pool.query('SELECT name, ip FROM devices ORDER BY name LIMIT 3');
  const header = ['nama_perangkat', 'tanggal (YYYY-MM-DD)', 'tugas', 'catatan'];
  const example = devices.map((d) => [d.name, `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}-15`, 'Pembersihan & cek kondisi', '']);
  const aoa = [header, ...(example.length ? example : [['SW-Core-01', '2026-06-15', 'Pembersihan & cek kondisi', '']])];
  const buf = await aoaToBuffer('Maintenance', aoa, [22, 20, 34, 24]);
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', 'attachment; filename="template-maintenance.xlsx"');
  res.send(buf);
});

// ----- Impor Excel (global) -----
router.post('/maintenance/import', requireRole('admin', 'koordinator'), upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'File Excel wajib diunggah.' });
  let rows;
  try {
    rows = await bufferToAoa(req.file.buffer);
  } catch {
    return res.status(400).json({ error: 'File tidak dapat dibaca sebagai Excel.' });
  }
  if (!rows || rows.length < 2) return res.status(400).json({ error: 'File kosong atau tanpa data.' });

  const [devices] = await pool.query('SELECT id, name, ip FROM devices');
  const byName = new Map(devices.map((d) => [String(d.name).toLowerCase().trim(), d.id]));
  const byIp = new Map(devices.map((d) => [String(d.ip).toLowerCase().trim(), d.id]));

  let inserted = 0;
  const errors = [];
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    if (!row || row.every((c) => c === '' || c == null)) continue;
    const [devCell, dateCell, taskCell, noteCell] = row;
    const key = String(devCell ?? '').toLowerCase().trim();
    const deviceId = byName.get(key) || byIp.get(key);
    let dateStr = '';
    if (dateCell instanceof Date) dateStr = xlsxDateToYmd(dateCell);
    else if (typeof dateCell === 'number') dateStr = xlsxDateToYmd(new Date(Math.round((dateCell - 25569) * 86400 * 1000)));
    else dateStr = String(dateCell ?? '').trim();

    if (!deviceId) { errors.push(`Baris ${i + 1}: perangkat "${devCell}" tidak ditemukan`); continue; }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) { errors.push(`Baris ${i + 1}: tanggal "${dateCell}" tidak valid (pakai YYYY-MM-DD)`); continue; }
    if (!String(taskCell ?? '').trim()) { errors.push(`Baris ${i + 1}: tugas kosong`); continue; }

    await pool.query(
      `INSERT INTO equipment_maintenance (device_id, plan_month, scheduled_date, task, note, created_by)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [deviceId, dateStr.slice(0, 7), dateStr, String(taskCell).trim(), String(noteCell ?? '').trim() || null, req.user.id]
    );
    inserted++;
  }
  res.json({ inserted, errors, total: rows.length - 1 });
});

export default router;
