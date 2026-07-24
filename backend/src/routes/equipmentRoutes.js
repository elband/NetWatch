import { Router } from 'express';
import multer from 'multer';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { aoaToBuffer, bufferToAoa, xlsxDateToYmd } from '../utils/xlsx.js';
import exifr from 'exifr';
import { pool } from '../db/pool.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { unitScope, unitFilter, rowInUnit, insertUnitId } from '../middleware/unitScope.js';
import { getDutyStatus, dateKey, shiftOpenGate, WORK_SHIFT_TYPES } from '../config/shifts.js';
import { withInspectionPhoto, INSPECTION_DIR, randName, randToken } from '../middleware/upload.js';
import { queueWaNotification } from '../jobs/waQueue.js';
import { isNotifyEnabledForUser } from '../services/notifyPrefs.js';

const router = Router();
router.use(requireAuth);
router.use(unitScope);

const SLOTS = ['09', '12', '15'];
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

// Penyimpanan dokumentasi maintenance (foto/PDF) ke disk.
const MAINT_DIR = path.join(path.dirname(INSPECTION_DIR), 'maintenance');
fs.mkdirSync(MAINT_DIR, { recursive: true });
const maintUpload = multer({
  storage: multer.diskStorage({
    destination: (req, f, cb) => cb(null, MAINT_DIR),
    filename: (req, f, cb) => cb(null, randName('M', f.originalname)),
  }),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, f, cb) => cb(null, ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'application/pdf'].includes(f.mimetype)),
});

// Ambang verifikasi anti-foto-palsu.
const FRESH_MINUTES = 30;   // foto harus diambil <= 30 menit dari sekarang (dari EXIF)
const DEFAULT_RADIUS_M = 200; // radius kerja default (m); dapat diubah admin di Pengaturan
const STRICT_VERIFY = false; // true = tolak bila tak terverifikasi; false = simpan tapi ditandai

// Radius kerja (meter) untuk verifikasi proximity foto ke perangkat — diatur admin lewat
// Pengaturan (settings key 'inspect_radius_m'). Dipakai konsisten oleh verifikasi backend
// & panel "Jarak Saat Ini" di halaman kamera inspeksi. Fallback ke DEFAULT_RADIUS_M.
async function getInspectRadius() {
  try {
    const [r] = await pool.query("SELECT setting_value FROM settings WHERE setting_key='inspect_radius_m'");
    const v = r[0]?.setting_value;
    const n = Number(typeof v === 'string' ? JSON.parse(v) : v);
    return Number.isFinite(n) && n > 0 ? Math.round(n) : DEFAULT_RADIUS_M;
  } catch { return DEFAULT_RADIUS_M; }
}

// Jarak dua titik (meter) — formula haversine.
function haversine(lat1, lng1, lat2, lng2) {
  const R = 6371000, toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1), dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return Math.round(R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
}

// Verifikasi anti-foto-palsu untuk foto dokumentasi lapangan (inspeksi & menghidupkan
// peralatan): hash SHA-256 (dedup), kesegaran waktu, dan proximity GPS ke perangkat.
// `device` butuh { lat, lng }; `bodyLat/bodyLng` = fallback geolokasi browser dari form.
// `capturedAt` (ms epoch) = waktu tangkap dari klien (file.lastModified) — dipakai bila
// EXIF kosong, sebab kamera langsung via browser umumnya membuang metadata EXIF.
// Mengembalikan { hash, verified, distance, warning }.
async function verifyPhoto(buffer, device, bodyLat, bodyLng, capturedAt, radiusM = DEFAULT_RADIUS_M) {
  const hash = crypto.createHash('sha256').update(buffer).digest('hex');

  let exifTime = null, exifGps = null;
  try { const p = await exifr.parse(buffer, ['DateTimeOriginal', 'CreateDate']); if (p) exifTime = p.DateTimeOriginal || p.CreateDate || null; } catch { /* abaikan */ }
  try { exifGps = await exifr.gps(buffer); } catch { /* abaikan */ }

  // Sumber waktu tangkap: EXIF (paling kuat), lalu waktu tangkap klien (file.lastModified).
  let captureTime = exifTime ? new Date(exifTime) : null;
  if (!captureTime && capturedAt) {
    const t = Number(capturedAt);
    if (Number.isFinite(t) && t > 0) captureTime = new Date(t);
  }

  let freshOk = false, freshReason = 'Foto tanpa waktu tangkap — ambil foto langsung dari kamera.';
  if (captureTime && !Number.isNaN(captureTime.getTime())) {
    const diffMin = Math.abs(Date.now() - captureTime.getTime()) / 60000;
    freshOk = diffMin <= FRESH_MINUTES;
    if (!freshOk) freshReason = `Foto diambil ${Math.round(diffMin)} menit lalu (maks ${FRESH_MINUTES} menit) — bukan foto saat ini.`;
  }

  // Sumber lokasi foto: EXIF GPS, lalu fallback geolokasi browser (lat/lng form).
  const photoLat = exifGps?.latitude ?? (bodyLat ? Number(bodyLat) : null);
  const photoLng = exifGps?.longitude ?? (bodyLng ? Number(bodyLng) : null);
  let distance = null, proxOk = true, proxReason = '';
  if (device.lat != null && device.lng != null) {
    if (photoLat != null && photoLng != null && !Number.isNaN(photoLat) && !Number.isNaN(photoLng)) {
      distance = haversine(Number(device.lat), Number(device.lng), photoLat, photoLng);
      proxOk = distance <= radiusM;
      if (!proxOk) proxReason = `Lokasi foto ${distance} m dari perangkat (maks ${radiusM} m).`;
    } else {
      proxOk = false; proxReason = 'Lokasi foto tidak terdeteksi (aktifkan GPS/izin lokasi).';
    }
  }

  const verified = freshOk && proxOk;
  const warning = verified ? null : [!freshOk && freshReason, !proxOk && proxReason].filter(Boolean).join(' ');
  return { hash, verified, distance, warning };
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

// ===== Override inspeksi koordinator =====
// Bila absen ter-record salah tanggal (mis. bug timezone) teknisi tak lolos gerbang
// "sudah absen hari ini" → tak bisa inspeksi/hidupkan/matikan. Koordinator/admin bisa
// membuka akses untuk unit-nya HARI INI dengan alasan. Dicatat APPEND-ONLY di tabel
// equipment_inspect_overrides (catatan permanen → tampil di Laporan Bulanan).
// Override AKTIF (work_date = hari ini) untuk unit tsb (atau global unit_id NULL) → baris, else null.
async function inspectOverrideFor(unitId) {
  const [rows] = await pool.query(
    `SELECT reason, created_by_name AS by_name, created_at AS at, work_date
       FROM equipment_inspect_overrides WHERE work_date=? AND (unit_id=? OR unit_id IS NULL) ORDER BY id DESC LIMIT 1`,
    [dateKey(new Date()), unitId ?? null]
  );
  return rows[0] || null;
}
// Terjadwal dinas (pagi/siang/malam) hari ini?
async function hasWorkShiftToday(userId) {
  const [rows] = await pool.query(
    'SELECT 1 FROM shifts WHERE user_id=? AND shift_date=? AND shift_type IN (?) LIMIT 1',
    [userId, dateKey(new Date()), WORK_SHIFT_TYPES]
  );
  return rows.length > 0;
}

// Bolehkah user input inspeksi? Teknisi harus on-duty; koord/admin selalu boleh.
async function canInspect(user) {
  if (user.role === 'admin' || user.role === 'koordinator') return true;
  if (user.role === 'teknisi') {
    const { onDuty } = await getDutyStatus(pool, user.id);
    if (onDuty) return true;
    // Override koordinator: teknisi terjadwal boleh inspeksi walau absen salah/belum ter-record.
    if ((await hasWorkShiftToday(user.id)) && (await inspectOverrideFor(user.unit_id))) return true;
    return false;
  }
  return false;
}

// Sudah absen masuk hari ini? Koordinator/admin dikecualikan (tidak wajib absen).
// Dipakai untuk menggerbang "menghidupkan peralatan" — teknisi harus absen dulu.
async function hasAttendedToday(user) {
  const roles = user.roles?.length ? user.roles : (user.role ? [user.role] : []);
  if (roles.includes('admin') || roles.includes('koordinator')) return true;
  const [rows] = await pool.query(
    'SELECT 1 FROM attendance WHERE user_id=? AND work_date=? AND check_in_at IS NOT NULL LIMIT 1',
    [user.id, dateKey(new Date())]
  );
  if (rows.length > 0) return true;
  // Override koordinator: dianggap sudah absen untuk unit ini hari ini.
  return !!(await inspectOverrideFor(user.unit_id));
}

// Status gerbang "Menghidupkan peralatan" untuk user ini — dicerminkan ke tombol ⚡ Hidupkan
// di frontend agar tak tampak aktif lalu ditolak backend. Teknisi: harus terjadwal dinas hari
// ini DAN sudah masuk jendela "buka 1 jam sebelum jam dinas" (shiftOpenGate, per unit).
// Admin/koordinator: dikecualikan (selalu boleh). Selaras dengan gate di POST /poweron.
async function powerGateFor(user) {
  const roles = user.roles?.length ? user.roles : (user.role ? [user.role] : []);
  if (roles.includes('admin') || roles.includes('koordinator')) {
    return { hasShift: true, allowed: true, opensAt: null };
  }
  const g = await shiftOpenGate(pool, user.id);
  return { hasShift: g.hasShift, allowed: g.allowed, opensAt: g.opensAt };
}

// Auto-Hidup saat override: membuka/memperbarui izin inspeksi juga MELANJUTKAN monitoring
// HANYA peralatan yang padam di JAM MALAM (off_reason='dimatikan') di unit tsb — tanpa alur
// foto Hidupkan; koordinator menanggung alasannya (tercatat append-only). Peralatan yang
// SENGAJA dimatikan lewat tombol Matikan bertanda off_reason='poweroff' → TIDAK ikut ter-resume
// (tetap dijeda sampai di-Hidupkan manual), agar tak dideteksi offline & dibuatkan insiden lagi.
// Aset fisik/standby (monitor_enabled=0 tanpa off_reason='dimatikan') & always-on juga tak tersentuh.
// Mengembalikan jumlah perangkat yang dilanjutkan + emit device:update utk tampilan real-time.
async function resumeDimatikanForUnit(req, unitId) {
  const uf = unitFilter(unitId, 'unit_id');
  const [paused] = await pool.query(
    `SELECT id FROM devices WHERE off_reason='dimatikan'${uf.clause}`,
    uf.params
  );
  if (!paused.length) return 0;
  const ids = paused.map((r) => r.id);
  await pool.query(
    'UPDATE devices SET monitor_enabled=1, alarm_override=0, offline_since=NULL, off_reason=NULL WHERE id IN (?)',
    [ids]
  );
  const io = req.app.get('io');
  if (io) {
    const [rows] = await pool.query('SELECT * FROM devices WHERE id IN (?)', [ids]);
    for (const d of rows) io.emit('device:update', d);
  }
  return ids.length;
}

// ===================== INSPEKSI HARIAN =====================
router.get('/inspections', async (req, res) => {
  const date = /^\d{4}-\d{2}-\d{2}$/.test(req.query.date) ? req.query.date : dateKey(new Date());
  // Scoping unit lewat daftar perangkat: inspeksi/poweron dipetakan per device_id,
  // sehingga baris milik unit lain otomatis tak ikut tampil.
  const ufd = unitFilter(req.unitId, 'd.unit_id');
  // Koordinat inspeksi: pakai koordinat PERANGKAT; bila kosong ikut koordinat LOKASI-nya
  // (marker di Peta / Master Data → Lokasi). Jadi cukup set titik lokasi sekali, semua
  // perangkat di lokasi itu otomatis punya koordinat untuk cek jarak/radius.
  const [devices] = await pool.query(`SELECT d.id, d.name, d.ip, d.type, d.loc, d.status, d.monitor_enabled, d.off_reason, d.always_on,
      COALESCE(d.lat, loc.lat) AS lat, COALESCE(d.lng, loc.lng) AS lng
      FROM devices d LEFT JOIN locations loc ON loc.id = d.location_id
      WHERE d.inspect_required=1${ufd.clause} ORDER BY d.name`, ufd.params);
  const [insp] = await pool.query('SELECT * FROM equipment_inspections WHERE inspect_date = ?', [date]);
  const byDevice = {};
  for (const r of insp) (byDevice[r.device_id] ||= {})[r.slot] = r;
  // Bukti Hidup/Mati di kartu = catatan power TERBARU tiap state, LINTAS TANGGAL (bukan hanya
  // tanggal terpilih). Status on/off perangkat berlaku "saat ini", jadi buktinya jangan ikut
  // hilang hanya karena berganti hari. Ambil baris dgn id terbesar per (device, state).
  const [pons] = await pool.query(
    `SELECT ep.* FROM equipment_poweron ep
       JOIN (SELECT device_id, state, MAX(id) AS mid FROM equipment_poweron GROUP BY device_id, state) t
         ON t.mid = ep.id`
  );
  const ponByDevice = {};
  for (const r of pons) (ponByDevice[r.device_id] ||= {})[r.state] = r;
  const list = devices.map((d) => ({
    ...d,
    inspections: byDevice[d.id] || {},
    poweron: ponByDevice[d.id]?.on || null,
    poweroff: ponByDevice[d.id]?.off || null,
  }));
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
    attended: await hasAttendedToday(req.user),
    powerGate: await powerGateFor(req.user),
    inspectOverride: await inspectOverrideFor(req.unitId),
    inspectRadiusM: await getInspectRadius(),
    devices: list,
  });
});

// Status override inspeksi hari ini untuk unit efektif (null bila tak ada).
router.get('/inspect-override', async (req, res) => {
  res.json({ override: await inspectOverrideFor(req.unitId) });
});

// Koordinator/admin: BUKA akses inspeksi + hidupkan/matikan untuk unit ini HARI INI walau
// absen belum/salah tanggal. Wajib alasan; berlaku untuk teknisi yang terjadwal dinas hari ini.
router.post('/inspect-override', requireRole('admin', 'koordinator'), async (req, res) => {
  const reason = String(req.body?.reason || '').trim();
  if (!reason) return res.status(400).json({ error: 'Alasan wajib diisi.' });
  const unitId = req.unitId != null ? Number(req.unitId) : null;
  // Append-only: tiap pembukaan tercatat permanen (untuk Laporan Bulanan & audit).
  await pool.query(
    'INSERT INTO equipment_inspect_overrides (unit_id, work_date, reason, created_by, created_by_name) VALUES (?,?,?,?,?)',
    [unitId, dateKey(new Date()), reason, req.user.id, req.user.name]
  );
  // Auto-Hidup: lanjutkan monitoring peralatan yang sebelumnya "dimatikan" di unit ini.
  const resumed = await resumeDimatikanForUnit(req, unitId);
  res.json({ ok: true, override: await inspectOverrideFor(unitId), resumed });
});

router.post('/inspections', withInspectionPhoto, async (req, res) => {
  const { deviceId, slot, status, note } = req.body;
  if (!deviceId || !SLOTS.includes(String(slot))) return res.status(400).json({ error: 'Perangkat & slot wajib valid.' });
  const validStatus = ['baik', 'perhatian', 'rusak'];
  const st = validStatus.includes(status) ? status : 'baik';
  if (!(await canInspect(req.user))) return res.status(403).json({ error: 'Hanya teknisi on-duty (atau koordinator/admin) yang bisa input inspeksi.' });
  // Alur harian: absen masuk dulu (sama seperti hidupkan/matikan peralatan). Koord/admin dikecualikan.
  if (!(await hasAttendedToday(req.user))) return res.status(403).json({ error: 'Absen masuk dulu hari ini sebelum inspeksi (buka Dashboard → Absensi).' });

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

  // Ambil koordinat perangkat (untuk cek GPS proximity) + unit_id (scoping).
  const [devRows] = await pool.query('SELECT d.name, COALESCE(d.lat, loc.lat) AS lat, COALESCE(d.lng, loc.lng) AS lng, d.unit_id FROM devices d LEFT JOIN locations loc ON loc.id = d.location_id WHERE d.id = ?', [deviceId]);
  const device = devRows[0];
  if (!device || !rowInUnit(device, req.unitId)) return res.status(404).json({ error: 'Perangkat tidak ditemukan.' });

  // Unit baris inspeksi mengikuti unit perangkatnya.
  const rowUnitId = device.unit_id ?? insertUnitId(req);
  if (rowUnitId == null) return res.status(400).json({ error: 'Pilih unit terlebih dahulu.' });

  // Anti-foto-palsu: hash + kesegaran waktu tangkap + proximity GPS (radius dari Pengaturan).
  const radiusM = await getInspectRadius();
  const { hash, verified, distance, warning } = await verifyPhoto(req.file.buffer, device, req.body.lat, req.body.lng, req.body.capturedAt, radiusM);

  // Tolak bila foto identik (hash sama) sudah pernah dipakai pada inspeksi lain.
  const [dups] = await pool.query(
    `SELECT id FROM equipment_inspections
      WHERE photo_hash = ? AND NOT (device_id = ? AND inspect_date = ? AND slot = ?) LIMIT 1`,
    [hash, deviceId, date, String(slot)]
  );
  if (dups.length) return res.status(409).json({ error: 'Foto ini sudah pernah dipakai pada inspeksi lain. Gunakan foto baru hasil pengecekan saat ini.' });

  if (STRICT_VERIFY && !verified) {
    return res.status(422).json({ error: `Verifikasi gagal: ${warning}` });
  }

  // Foto mencurigakan (gagal verifikasi lokasi/kesegaran) → minta konfirmasi eksplisit
  // sebelum disimpan. Bila teknisi tetap yakin menyimpan, foto ditandai (flagged=1) dan
  // performa bulan ini dipotong 20% (lihat performaRoutes/metricsFor).
  const confirmSuspicious = req.body.confirmSuspicious === '1' || req.body.confirmSuspicious === 'true';
  if (!verified && !confirmSuspicious) {
    return res.status(409).json({ needConfirm: true, suspicious: true, warning: warning || 'Foto tidak lolos verifikasi lokasi/kesegaran.' });
  }
  const flagged = (!verified && confirmSuspicious) ? 1 : 0;

  // Tulis file ke disk setelah lolos validasi.
  const ext = (path.extname(req.file.originalname).toLowerCase() || '.jpg').replace(/[^.a-z0-9]/g, '');
  const filename = `insp-${deviceId}-${date}-${slot}-${randToken()}${ext}`;
  fs.writeFileSync(path.join(INSPECTION_DIR, filename), req.file.buffer);
  const photoUrl = `/uploads/inspections/${filename}`;

  await pool.query(
    `INSERT INTO equipment_inspections (device_id, inspect_date, slot, status, note, photo_url, photo_hash, verified, distance_m, flagged, inspected_by, inspector_name, unit_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE status=VALUES(status), note=VALUES(note),
       photo_url=VALUES(photo_url), photo_hash=VALUES(photo_hash), verified=VALUES(verified),
       distance_m=VALUES(distance_m), flagged=VALUES(flagged), inspected_by=VALUES(inspected_by), inspector_name=VALUES(inspector_name), unit_id=VALUES(unit_id)`,
    [deviceId, date, String(slot), st, note?.trim() || null, photoUrl, hash, verified ? 1 : 0, distance, flagged, req.user.id, req.user.name, rowUnitId]
  );

  // Notifikasi otomatis ke koordinator bahwa perangkat sudah diinspeksi.
  {
    const [coords] = await pool.query("SELECT id FROM users WHERE active = 1 AND (role = 'koordinator' OR JSON_CONTAINS(roles, '\"koordinator\"')) AND (unit_id IS NULL OR unit_id = ?)", [rowUnitId]);
    const stEmoji = st === 'rusak' ? '🔴' : st === 'perhatian' ? '🟡' : '🟢';
    const verifyTag = verified ? '✅ terverifikasi' : (flagged ? '🚫 mencurigakan — disimpan atas konfirmasi teknisi (performa −20%)' : '⚠️ belum terverifikasi');
    for (const c of coords) {
      if (!(await isNotifyEnabledForUser('pengajuan_review_koordinator', c.id))) continue;
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
  res.json({ inspection: rows[0], verified, distance, warning, flagged });
});

// ===================== MENGHIDUPKAN PERALATAN (HARIAN) =====================
// Catatan "peralatan dihidupkan" 1x per perangkat per hari, wajib foto dokumentasi
// + verifikasi anti-foto-palsu, lalu notifikasi ke koordinator. Boleh diisi kapan
// saja pada hari ini oleh teknisi on-duty (atau koordinator/admin).
router.post('/poweron', withInspectionPhoto, async (req, res) => {
  const { deviceId, note } = req.body;
  if (!deviceId) return res.status(400).json({ error: 'Perangkat wajib valid.' });
  // Gate: teknisi hanya bisa menghidupkan peralatan mulai 1 jam sebelum jam dinasnya
  // (per unit). Koordinator/admin dikecualikan.
  const roles = req.user.roles?.length ? req.user.roles : (req.user.role ? [req.user.role] : []);
  if (!roles.includes('admin') && !roles.includes('koordinator')) {
    const gate = await shiftOpenGate(pool, req.user.id);
    if (!gate.hasShift) return res.status(403).json({ error: 'Anda tidak terjadwal dinas hari ini.' });
    if (!gate.allowed) return res.status(403).json({ error: `Menghidupkan peralatan dibuka pukul ${gate.opensAt} (1 jam sebelum jam dinas Anda).` });
    // Gate: wajib absen masuk dulu sebelum menghidupkan peralatan (absensi buka 1 jam sebelum jam dinas).
    if (!(await hasAttendedToday(req.user))) return res.status(403).json({ error: 'Absen masuk dulu sebelum menghidupkan peralatan. Buka Dashboard → Absensi.' });
  }

  const date = dateKey(new Date()); // hanya hari ini (waktu ditentukan server)
  if (!req.file) return res.status(400).json({ error: 'Foto dokumentasi wajib diunggah.' });

  const [devRows] = await pool.query('SELECT d.name, COALESCE(d.lat, loc.lat) AS lat, COALESCE(d.lng, loc.lng) AS lng, d.always_on, d.unit_id FROM devices d LEFT JOIN locations loc ON loc.id = d.location_id WHERE d.id = ?', [deviceId]);
  const device = devRows[0];
  if (!device || !rowInUnit(device, req.unitId)) return res.status(404).json({ error: 'Perangkat tidak ditemukan.' });
  if (device.always_on) return res.status(400).json({ error: 'Perangkat ini ditandai selalu aktif (24 jam) — tidak untuk dihidupkan/dimatikan.' });

  // Unit baris mengikuti unit perangkatnya.
  const rowUnitId = device.unit_id ?? insertUnitId(req);
  if (rowUnitId == null) return res.status(400).json({ error: 'Pilih unit terlebih dahulu.' });

  const radiusM = await getInspectRadius();
  const { hash, verified, distance, warning } = await verifyPhoto(req.file.buffer, device, req.body.lat, req.body.lng, req.body.capturedAt, radiusM);

  // Log append-only → setiap foto harus baru: tolak bila foto identik sudah pernah dipakai.
  const [dups] = await pool.query('SELECT id FROM equipment_poweron WHERE photo_hash = ? LIMIT 1', [hash]);
  if (dups.length) return res.status(409).json({ error: 'Foto ini sudah pernah dipakai. Gunakan foto baru hasil saat ini.' });

  if (STRICT_VERIFY && !verified) {
    return res.status(422).json({ error: `Verifikasi gagal: ${warning}` });
  }

  // Foto di luar radius / tanpa GPS → minta konfirmasi eksplisit sebelum disimpan; bila
  // teknisi tetap yakin, foto ditandai (flagged=1) & performa bulan ini dipotong 20%.
  const confirmSuspicious = req.body.confirmSuspicious === '1' || req.body.confirmSuspicious === 'true';
  if (!verified && !confirmSuspicious) {
    return res.status(409).json({ needConfirm: true, suspicious: true, warning: warning || 'Foto tidak lolos verifikasi lokasi/kesegaran.' });
  }
  const flagged = (!verified && confirmSuspicious) ? 1 : 0;

  const ext = (path.extname(req.file.originalname).toLowerCase() || '.jpg').replace(/[^.a-z0-9]/g, '');
  const filename = `poweron-${deviceId}-${date}-${randToken()}${ext}`;
  fs.writeFileSync(path.join(INSPECTION_DIR, filename), req.file.buffer);
  const photoUrl = `/uploads/inspections/${filename}`;

  // Catatan power + status perangkat ditulis ATOMIK (satu transaksi): mencegah kondisi
  // "kartu Dimatikan padahal catatan terakhir Hidup" bila salah satu query gagal.
  // Append entri baru (tidak menimpa catatan Hidup/Mati sebelumnya di hari yang sama).
  const conn = await pool.getConnection();
  let insertId;
  try {
    await conn.beginTransaction();
    const [ins] = await conn.query(
      `INSERT INTO equipment_poweron (device_id, on_date, state, note, photo_url, photo_hash, verified, distance_m, flagged, done_by, done_by_name, unit_id)
       VALUES (?, ?, 'on', ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [deviceId, date, note?.trim() || null, photoUrl, hash, verified ? 1 : 0, distance, flagged, req.user.id, req.user.name, rowUnitId]
    );
    insertId = ins.insertId;
    // Menghidupkan peralatan = mulai monitoring: aktifkan pantauan otomatis & bersihkan
    // kategori "dimatikan"/override agar ping berikutnya menentukan status riil.
    await conn.query(
      "UPDATE devices SET monitor_enabled=1, alarm_override=0, offline_since=NULL, off_reason = CASE WHEN off_reason IN ('dimatikan','poweroff') THEN NULL ELSE off_reason END WHERE id=?",
      [deviceId]
    );
    await conn.commit();
  } catch (e) {
    try { await conn.rollback(); } catch { /* abaikan */ }
    conn.release();
    return res.status(500).json({ error: 'Gagal menyimpan status peralatan. Silakan coba lagi.' });
  }
  conn.release();
  const [[updatedDev]] = await pool.query('SELECT * FROM devices WHERE id=?', [deviceId]);
  req.app.get('io')?.emit('device:update', updatedDev);

  // Notifikasi ke koordinator bahwa peralatan sudah dihidupkan.
  {
    const [coords] = await pool.query("SELECT id FROM users WHERE active = 1 AND (role = 'koordinator' OR JSON_CONTAINS(roles, '\"koordinator\"')) AND (unit_id IS NULL OR unit_id = ?)", [rowUnitId]);
    const verifyTag = verified ? '✅ terverifikasi' : (flagged ? '🚫 mencurigakan — disimpan atas konfirmasi teknisi (performa −20%)' : '⚠️ belum terverifikasi');
    for (const c of coords) {
      if (!(await isNotifyEnabledForUser('pengajuan_review_koordinator', c.id))) continue;
      await queueWaNotification({
        type: 'other',
        toUserId: c.id,
        message: `⚡ PERALATAN DIHIDUPKAN (monitoring aktif)\n${device.name}\nOleh: ${req.user.name}\nFoto: ${verifyTag}${distance != null ? ` · ${distance} m` : ''}${note?.trim() ? `\nCatatan: ${note.trim()}` : ''}`,
      });
    }
  }

  const [rows] = await pool.query('SELECT * FROM equipment_poweron WHERE id=?', [insertId]);
  res.json({ poweron: rows[0], device: updatedDev, verified, distance, warning, flagged });
});

// Mematikan peralatan = hentikan monitoring: perangkat ditandai "dimatikan" (status
// offline tanpa alarm) & dijeda dari ping/insiden otomatis. WAJIB foto dokumentasi +
// verifikasi anti-foto-palsu, oleh teknisi on-duty (atau koordinator/admin).
router.post('/poweroff', withInspectionPhoto, async (req, res) => {
  const { deviceId, note } = req.body;
  if (!deviceId) return res.status(400).json({ error: 'Perangkat wajib valid.' });
  // Mematikan boleh oleh teknisi yang SUDAH ABSEN MASUK hari ini (tak harus masih dalam
  // jam dinas) — peralatan sering dimatikan di akhir hari/di luar window shift. Koord/admin
  // bebas. Foto + verifikasi GPS anti-foto-palsu tetap wajib (di bawah).
  if (!(await hasAttendedToday(req.user))) return res.status(403).json({ error: 'Absen masuk dulu hari ini untuk mencatat mematikan peralatan (buka Dashboard → Absensi).' });

  const date = dateKey(new Date()); // hanya hari ini (waktu ditentukan server)
  if (!req.file) return res.status(400).json({ error: 'Foto dokumentasi wajib diunggah.' });

  const [[device]] = await pool.query('SELECT d.id, d.name, COALESCE(d.lat, loc.lat) AS lat, COALESCE(d.lng, loc.lng) AS lng, d.always_on, d.unit_id FROM devices d LEFT JOIN locations loc ON loc.id = d.location_id WHERE d.id=?', [deviceId]);
  if (!device || !rowInUnit(device, req.unitId)) return res.status(404).json({ error: 'Perangkat tidak ditemukan.' });
  if (device.always_on) return res.status(400).json({ error: 'Perangkat ini ditandai selalu aktif (24 jam) — tidak untuk dihidupkan/dimatikan.' });

  // Unit baris mengikuti unit perangkatnya.
  const rowUnitId = device.unit_id ?? insertUnitId(req);
  if (rowUnitId == null) return res.status(400).json({ error: 'Pilih unit terlebih dahulu.' });

  const radiusM = await getInspectRadius();
  const { hash, verified, distance, warning } = await verifyPhoto(req.file.buffer, device, req.body.lat, req.body.lng, req.body.capturedAt, radiusM);

  // Log append-only → setiap foto harus baru: tolak bila foto identik sudah pernah dipakai.
  const [dups] = await pool.query('SELECT id FROM equipment_poweron WHERE photo_hash = ? LIMIT 1', [hash]);
  if (dups.length) return res.status(409).json({ error: 'Foto ini sudah pernah dipakai. Gunakan foto baru hasil saat ini.' });

  if (STRICT_VERIFY && !verified) {
    return res.status(422).json({ error: `Verifikasi gagal: ${warning}` });
  }

  // Foto di luar radius / tanpa GPS → minta konfirmasi eksplisit sebelum disimpan; bila
  // teknisi tetap yakin, foto ditandai (flagged=1) & performa bulan ini dipotong 20%.
  const confirmSuspicious = req.body.confirmSuspicious === '1' || req.body.confirmSuspicious === 'true';
  if (!verified && !confirmSuspicious) {
    return res.status(409).json({ needConfirm: true, suspicious: true, warning: warning || 'Foto tidak lolos verifikasi lokasi/kesegaran.' });
  }
  const flagged = (!verified && confirmSuspicious) ? 1 : 0;

  const ext = (path.extname(req.file.originalname).toLowerCase() || '.jpg').replace(/[^.a-z0-9]/g, '');
  const filename = `poweroff-${deviceId}-${date}-${randToken()}${ext}`;
  fs.writeFileSync(path.join(INSPECTION_DIR, filename), req.file.buffer);
  const photoUrl = `/uploads/inspections/${filename}`;

  // Catatan power + status perangkat ditulis ATOMIK (satu transaksi) agar tak divergen.
  // Append entri baru (tidak menimpa catatan Hidup/Mati sebelumnya di hari yang sama).
  const conn = await pool.getConnection();
  let insertId;
  try {
    await conn.beginTransaction();
    const [ins] = await conn.query(
      `INSERT INTO equipment_poweron (device_id, on_date, state, note, photo_url, photo_hash, verified, distance_m, flagged, done_by, done_by_name, unit_id)
       VALUES (?, ?, 'off', ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [deviceId, date, note?.trim() || null, photoUrl, hash, verified ? 1 : 0, distance, flagged, req.user.id, req.user.name, rowUnitId]
    );
    insertId = ins.insertId;
    // off_reason='poweroff' (BUKAN 'dimatikan') menandai peralatan yang SENGAJA dimatikan
    // lewat tombol Matikan. Kategori ini TIDAK ikut ter-resume oleh Auto-Hidup koordinator
    // (resumeDimatikanForUnit hanya menyentuh 'dimatikan' jam malam) → tak dideteksi ulang.
    await conn.query(
      "UPDATE devices SET monitor_enabled=0, off_reason='poweroff', status='offline', alarm_override=0, offline_since=NULL WHERE id=?",
      [deviceId]
    );
    await conn.commit();
  } catch (e) {
    try { await conn.rollback(); } catch { /* abaikan */ }
    conn.release();
    return res.status(500).json({ error: 'Gagal menyimpan status peralatan. Silakan coba lagi.' });
  }
  conn.release();
  const [[updatedDev]] = await pool.query('SELECT * FROM devices WHERE id=?', [deviceId]);
  req.app.get('io')?.emit('device:update', updatedDev);

  // Notifikasi ke koordinator bahwa peralatan dimatikan (monitoring dijeda).
  {
    const [coords] = await pool.query("SELECT id FROM users WHERE active = 1 AND (role = 'koordinator' OR JSON_CONTAINS(roles, '\"koordinator\"')) AND (unit_id IS NULL OR unit_id = ?)", [rowUnitId]);
    const verifyTag = verified ? '✅ terverifikasi' : (flagged ? '🚫 mencurigakan — disimpan atas konfirmasi teknisi (performa −20%)' : '⚠️ belum terverifikasi');
    for (const c of coords) {
      if (!(await isNotifyEnabledForUser('pengajuan_review_koordinator', c.id))) continue;
      await queueWaNotification({
        type: 'other',
        toUserId: c.id,
        message: `⏻ PERALATAN DIMATIKAN (monitoring dijeda)\n${device.name}\nOleh: ${req.user.name}\nFoto: ${verifyTag}${distance != null ? ` · ${distance} m` : ''}${note?.trim() ? `\nCatatan: ${note.trim()}` : ''}`,
      });
    }
  }

  const [rows] = await pool.query('SELECT * FROM equipment_poweron WHERE id=?', [insertId]);
  res.json({ poweroff: rows[0], device: updatedDev, verified, distance, warning, flagged });
});

// ===================== MAINTENANCE BULANAN =====================
router.get('/maintenance', async (req, res) => {
  const month = /^\d{4}-\d{2}$/.test(req.query.month)
    ? req.query.month
    : `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}`;
  // Filter unit lewat unit perangkat (JOIN devices sudah ada) — sumber unit paling andal.
  const uf = unitFilter(req.unitId, 'd.unit_id');
  const [rows] = await pool.query(
    `SELECT m.*, d.name AS device_name, d.ip AS device_ip, d.type AS device_type,
            ub.name AS done_by_name,
            (SELECT COUNT(*) FROM equipment_maintenance_photos p WHERE p.maintenance_id = m.id) AS photo_count
       FROM equipment_maintenance m
       JOIN devices d ON d.id = m.device_id
       LEFT JOIN users ub ON ub.id = m.done_by
      WHERE m.plan_month = ?${uf.clause}
      ORDER BY m.scheduled_date ASC, d.name ASC`,
    [month, ...uf.params]
  );
  // Peserta diambil sekali untuk semua baris (bukan per baris) supaya tidak jadi
  // N+1 query saat rencana sebulan berisi puluhan tugas.
  if (rows.length) {
    const ids = rows.map((r) => r.id);
    const [mem] = await pool.query(
      `SELECT mm.maintenance_id, u.id, u.name
         FROM equipment_maintenance_members mm JOIN users u ON u.id = mm.user_id
        WHERE mm.maintenance_id IN (?) ORDER BY u.name`,
      [ids]
    );
    const byId = new Map(ids.map((id) => [id, []]));
    for (const m of mem) byId.get(m.maintenance_id)?.push({ id: m.id, name: m.name });
    for (const r of rows) r.members = byId.get(r.id) || [];
  }
  res.json({ month, maintenance: rows });
});

// Tetapkan peserta maintenance (koordinator/admin). Menggantikan seluruh daftar,
// bukan menambah — UI mengirim keadaan akhir centangan.
router.put('/maintenance/:id/members', requireRole('admin', 'koordinator'), async (req, res) => {
  const [[m]] = await pool.query(
    'SELECT m.id, m.unit_id, d.unit_id AS device_unit_id FROM equipment_maintenance m JOIN devices d ON d.id=m.device_id WHERE m.id = ?',
    [req.params.id]
  );
  if (!m || !rowInUnit({ unit_id: m.unit_id ?? m.device_unit_id }, req.unitId)) {
    return res.status(404).json({ error: 'Data maintenance tidak ditemukan.' });
  }
  const raw = Array.isArray(req.body.userIds) ? req.body.userIds : [];
  const ids = [...new Set(raw.map(Number).filter((n) => Number.isInteger(n) && n > 0))];

  // Hanya user aktif di unit yang sama yang boleh jadi peserta — tanpa ini
  // koordinator bisa mengkreditkan PM ke teknisi unit lain.
  let valid = [];
  if (ids.length) {
    const unitId = m.unit_id ?? m.device_unit_id ?? null;
    const [ok] = await pool.query(
      'SELECT id FROM users WHERE active=1 AND id IN (?) AND (unit_id IS NULL OR unit_id = ?)',
      [ids, unitId]
    );
    valid = ok.map((u) => u.id);
  }

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    await conn.query('DELETE FROM equipment_maintenance_members WHERE maintenance_id = ?', [m.id]);
    if (valid.length) {
      await conn.query(
        'INSERT INTO equipment_maintenance_members (maintenance_id, user_id, assigned_by) VALUES ?',
        [valid.map((uid) => [m.id, uid, req.user.id])]
      );
    }
    await conn.commit();
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }

  const [members] = await pool.query(
    `SELECT u.id, u.name FROM equipment_maintenance_members mm JOIN users u ON u.id = mm.user_id
      WHERE mm.maintenance_id = ? ORDER BY u.name`,
    [m.id]
  );
  res.json({ ok: true, members, skipped: ids.length - valid.length });
});

router.post('/maintenance', requireRole('admin', 'koordinator'), maintUpload.single('doc'), async (req, res) => {
  const { deviceId, scheduledDate, task, note } = req.body;
  if (!deviceId || !/^\d{4}-\d{2}-\d{2}$/.test(scheduledDate || '') || !task?.trim()) {
    return res.status(400).json({ error: 'Perangkat, tanggal (YYYY-MM-DD), dan tugas wajib diisi.' });
  }
  // Perangkat harus ada & berada di unit request; unit baris mengikuti unit perangkat.
  const [[dev]] = await pool.query('SELECT unit_id FROM devices WHERE id = ?', [deviceId]);
  if (!dev || !rowInUnit(dev, req.unitId)) return res.status(404).json({ error: 'Perangkat tidak ditemukan.' });
  const rowUnitId = dev.unit_id ?? insertUnitId(req);
  if (rowUnitId == null) return res.status(400).json({ error: 'Pilih unit terlebih dahulu.' });
  const month = scheduledDate.slice(0, 7);
  const docUrl = req.file ? `/uploads/maintenance/${req.file.filename}` : null;
  const [r] = await pool.query(
    `INSERT INTO equipment_maintenance (device_id, plan_month, scheduled_date, task, note, doc_url, created_by, unit_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [deviceId, month, scheduledDate, task.trim(), note?.trim() || null, docUrl, req.user.id, rowUnitId]
  );
  res.status(201).json({ id: r.insertId, doc_url: docUrl });
});

// Update status (teknisi boleh menandai selesai/batal saat eksekusi) + dokumentasi.
// Saat menandai SELESAI wajib ada dokumentasi (upload/kamera) → lalu notifikasi ke koordinator.
router.put('/maintenance/:id', requireRole('admin', 'koordinator', 'teknisi'), maintUpload.single('doc'), async (req, res) => {
  const { status, note } = req.body;
  const valid = ['rencana', 'selesai', 'batal'];
  if (!valid.includes(status)) return res.status(400).json({ error: 'Status tidak valid.' });
  const [rows] = await pool.query(
    'SELECT m.*, d.name AS device_name, d.unit_id AS device_unit_id FROM equipment_maintenance m JOIN devices d ON d.id=m.device_id WHERE m.id=?',
    [req.params.id]
  );
  const m = rows[0];
  // Fallback ke unit perangkat bila unit_id baris lama masih kosong (data legacy).
  if (!m || !rowInUnit({ unit_id: m.unit_id ?? m.device_unit_id }, req.unitId)) return res.status(404).json({ error: 'Data maintenance tidak ditemukan.' });
  const docUrl = req.file ? `/uploads/maintenance/${req.file.filename}` : null;

  if (status === 'selesai') {
    const [[pc]] = await pool.query('SELECT COUNT(*) AS c FROM equipment_maintenance_photos WHERE maintenance_id = ?', [req.params.id]);
    if (pc.c === 0 && !docUrl && !m.doc_url) return res.status(400).json({ error: 'Unggah minimal 1 foto dokumentasi sebelum menandai maintenance selesai.' });
    await pool.query(
      'UPDATE equipment_maintenance SET status=?, note=COALESCE(?, note), doc_url=COALESCE(?, doc_url), done_by=?, done_at=NOW() WHERE id=?',
      [status, note?.trim() || null, docUrl, req.user.id, req.params.id]
    );
    // Penekan tombol Selesai otomatis tercatat sebagai peserta. IGNORE karena
    // koordinator mungkin sudah mendaftarkannya lebih dulu (UNIQUE per pasangan).
    await pool.query(
      'INSERT IGNORE INTO equipment_maintenance_members (maintenance_id, user_id, assigned_by) VALUES (?, ?, ?)',
      [req.params.id, req.user.id, req.user.id]
    );
    // Notifikasi ke koordinator unit perangkat (+ super admin), bukan lintas unit.
    const [coords] = await pool.query("SELECT id FROM users WHERE active=1 AND (role='koordinator' OR JSON_CONTAINS(roles,'\"koordinator\"')) AND (unit_id IS NULL OR unit_id = ?)", [m.unit_id ?? m.device_unit_id ?? null]);
    const when = new Date().toLocaleString('id-ID', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
    const docInfo = pc.c > 0 ? `${pc.c} foto dokumentasi dilampirkan` : 'Dokumentasi telah dilampirkan';
    const msg = `🛠️ *Maintenance Selesai*\nPerangkat: ${m.device_name}\nTugas: ${m.task}\nOleh: ${req.user.name}\nWaktu: ${when}\n${docInfo} di sistem.`;
    for (const c of coords) {
      if (!(await isNotifyEnabledForUser('pengajuan_review_koordinator', c.id))) continue;
      try { await queueWaNotification({ type: 'report', toUserId: c.id, message: msg }); } catch { /* abaikan */ }
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
  // Scope via induk: maintenance harus berada di unit request (fallback unit perangkat).
  const [[parent]] = await pool.query(
    'SELECT m.unit_id, d.unit_id AS device_unit_id FROM equipment_maintenance m JOIN devices d ON d.id=m.device_id WHERE m.id = ?',
    [req.params.id]
  );
  if (!parent || !rowInUnit({ unit_id: parent.unit_id ?? parent.device_unit_id }, req.unitId)) {
    return res.status(404).json({ error: 'Data maintenance tidak ditemukan.' });
  }
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
router.post('/maintenance/:id/photos', requireRole('admin', 'koordinator', 'teknisi'), maintUpload.array('photos', 20), async (req, res) => {
  // Scope via induk (fallback unit perangkat untuk baris legacy).
  const [[m]] = await pool.query(
    'SELECT m.id, m.unit_id, d.unit_id AS device_unit_id FROM equipment_maintenance m JOIN devices d ON d.id=m.device_id WHERE m.id = ?',
    [req.params.id]
  );
  if (!m || !rowInUnit({ unit_id: m.unit_id ?? m.device_unit_id }, req.unitId)) return res.status(404).json({ error: 'Data maintenance tidak ditemukan.' });
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
router.delete('/maintenance/photos/:photoId', requireRole('admin', 'koordinator', 'teknisi'), async (req, res) => {
  // Scope via induk maintenance (fallback unit perangkat).
  const [[ph]] = await pool.query(
    `SELECT p.url, m.unit_id, d.unit_id AS device_unit_id
       FROM equipment_maintenance_photos p
       JOIN equipment_maintenance m ON m.id = p.maintenance_id
       JOIN devices d ON d.id = m.device_id
      WHERE p.id = ?`,
    [req.params.photoId]
  );
  if (!ph || !rowInUnit({ unit_id: ph.unit_id ?? ph.device_unit_id }, req.unitId)) return res.status(404).json({ error: 'Foto tidak ditemukan.' });
  await pool.query('DELETE FROM equipment_maintenance_photos WHERE id = ?', [req.params.photoId]);
  try { fs.unlinkSync(path.join(MAINT_DIR, path.basename(ph.url))); } catch { /* berkas mungkin sudah tiada */ }
  res.json({ ok: true });
});

router.delete('/maintenance/:id', requireRole('admin', 'koordinator'), async (req, res) => {
  // Cegah hapus lintas unit (fallback unit perangkat untuk baris legacy).
  const [[m]] = await pool.query(
    'SELECT m.unit_id, d.unit_id AS device_unit_id FROM equipment_maintenance m JOIN devices d ON d.id=m.device_id WHERE m.id = ?',
    [req.params.id]
  );
  if (m && !rowInUnit({ unit_id: m.unit_id ?? m.device_unit_id }, req.unitId)) {
    return res.status(404).json({ error: 'Data maintenance tidak ditemukan.' });
  }
  await pool.query('DELETE FROM equipment_maintenance WHERE id = ?', [req.params.id]);
  res.json({ ok: true });
});

// ----- Template Excel (download) -----
router.get('/maintenance/template', requireRole('admin', 'koordinator'), async (req, res) => {
  const uf = unitFilter(req.unitId, 'unit_id');
  const [devices] = await pool.query(`SELECT name, ip FROM devices WHERE 1=1${uf.clause} ORDER BY name LIMIT 3`, uf.params);
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

  // Hanya perangkat dalam unit request yang bisa dirujuk saat impor.
  const ufi = unitFilter(req.unitId, 'unit_id');
  const [devices] = await pool.query(`SELECT id, name, ip, unit_id FROM devices WHERE 1=1${ufi.clause}`, ufi.params);
  const byName = new Map(devices.map((d) => [String(d.name).toLowerCase().trim(), d]));
  const byIp = new Map(devices.map((d) => [String(d.ip).toLowerCase().trim(), d]));

  let inserted = 0;
  const errors = [];
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    if (!row || row.every((c) => c === '' || c == null)) continue;
    const [devCell, dateCell, taskCell, noteCell] = row;
    const key = String(devCell ?? '').toLowerCase().trim();
    const dev = byName.get(key) || byIp.get(key);
    const deviceId = dev?.id;
    let dateStr = '';
    if (dateCell instanceof Date) dateStr = xlsxDateToYmd(dateCell);
    else if (typeof dateCell === 'number') dateStr = xlsxDateToYmd(new Date(Math.round((dateCell - 25569) * 86400 * 1000)));
    else dateStr = String(dateCell ?? '').trim();

    if (!deviceId) { errors.push(`Baris ${i + 1}: perangkat "${devCell}" tidak ditemukan`); continue; }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) { errors.push(`Baris ${i + 1}: tanggal "${dateCell}" tidak valid (pakai YYYY-MM-DD)`); continue; }
    if (!String(taskCell ?? '').trim()) { errors.push(`Baris ${i + 1}: tugas kosong`); continue; }

    // Unit baris mengikuti unit perangkatnya (fallback unit efektif request).
    const rowUnitId = dev.unit_id ?? insertUnitId(req);
    if (rowUnitId == null) { errors.push(`Baris ${i + 1}: perangkat "${devCell}" belum punya unit — pilih unit terlebih dahulu`); continue; }

    await pool.query(
      `INSERT INTO equipment_maintenance (device_id, plan_month, scheduled_date, task, note, created_by, unit_id)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [deviceId, dateStr.slice(0, 7), dateStr, String(taskCell).trim(), String(noteCell ?? '').trim() || null, req.user.id, rowUnitId]
    );
    inserted++;
  }
  res.json({ inserted, errors, total: rows.length - 1 });
});

export default router;
