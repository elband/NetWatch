import { Router } from 'express';
import { pool } from '../db/pool.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { queueWaNotification } from '../jobs/waQueue.js';
import { audit } from '../services/audit.js';
import { isNotifyEnabledForUser } from '../services/notifyPrefs.js';

const router = Router();
router.use(requireAuth);

// Lokasi kantor & ambang (diatur admin via Pengaturan, key 'office').
const OFFICE_DEFAULT = { lat: -0.3748, lng: 117.2536, radius_m: 400, acc_m: 150, enabled: true };
async function getOffice() {
  const [r] = await pool.query("SELECT setting_value FROM settings WHERE setting_key='office'");
  try { const v = r[0]?.setting_value; return { ...OFFICE_DEFAULT, ...(typeof v === 'string' ? JSON.parse(v) : v || {}) }; } catch { return OFFICE_DEFAULT; }
}
const haversine = (la1, lo1, la2, lo2) => {
  const R = 6371000, toRad = (d) => (d * Math.PI) / 180;
  const dLa = toRad(la2 - la1), dLo = toRad(lo2 - lo1);
  const a = Math.sin(dLa / 2) ** 2 + Math.cos(toRad(la1)) * Math.cos(toRad(la2)) * Math.sin(dLo / 2) ** 2;
  return Math.round(R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
};
const clientIp = (req) => (req.headers['x-forwarded-for']?.split(',')[0].trim()) || req.socket?.remoteAddress || '';
const todayKey = () => new Date().toISOString().slice(0, 10);
const ymd = (s) => String(s).slice(0, 10);

// Anomali lokasi/perangkat: luar radius, akurasi rendah, zona waktu tak wajar, GPS mati, perangkat tak dikenal.
function locationReasons({ lat, lng, tz, accuracy }, office) {
  const reasons = [];
  let dist = null;
  if (lat == null || lng == null) reasons.push('Lokasi GPS tidak tersedia');
  else {
    dist = haversine(Number(lat), Number(lng), office.lat, office.lng);
    if (office.enabled && dist > office.radius_m) reasons.push(`Di luar area kantor (${dist} m > ${office.radius_m} m)`);
    if (accuracy != null && Number(accuracy) > (office.acc_m || 150)) reasons.push(`Akurasi GPS rendah (${Math.round(accuracy)} m)`);
  }
  if (tz && !/^Asia\/(Jakarta|Pontianak|Makassar|Jayapura)$/.test(String(tz))) reasons.push(`Zona waktu tidak wajar (${tz})`);
  return { reasons, dist };
}

async function notifyCoords(message) {
  const [coords] = await pool.query("SELECT id FROM users WHERE active=1 AND (role='koordinator' OR JSON_CONTAINS(roles,'\"koordinator\"'))");
  let n = 0;
  for (const c of coords) {
    if (!(await isNotifyEnabledForUser('absensi_vpn_lokasi', c.id))) continue;
    try { await queueWaNotification({ type: 'alert', toUserId: c.id, message }); n++; } catch { /* abaikan */ }
  }
  return n;
}

async function notifyAdmins(message) {
  const [admins] = await pool.query("SELECT id FROM users WHERE active=1 AND (role='admin' OR JSON_CONTAINS(roles,'\"admin\"'))");
  let n = 0;
  for (const a of admins) {
    if (!(await isNotifyEnabledForUser('absensi_duplikat_perangkat', a.id))) continue;
    try { await queueWaNotification({ type: 'alert', toUserId: a.id, message }); n++; } catch { /* abaikan */ }
  }
  return n;
}

// Deteksi perangkat absensi yang sama dipakai oleh dua teknisi berbeda pada hari
// yang sama (indikasi titip absen). Penalti (flagged) dikenakan ke ABSEN PERTAMA
// (pemilik/pemegang perangkat), karena dialah yang membiarkan perangkatnya dipakai
// lagi setelah dia sendiri absen. Notifikasi WA tetap mengikuti pengaturan admin.
async function checkDuplicateDevice(currentUserId, currentUserName, deviceId, date) {
  if (!deviceId) return;
  const [dup] = await pool.query(
    `SELECT a.id, a.user_id, u.name FROM attendance a JOIN users u ON u.id=a.user_id
      WHERE a.work_date=? AND a.device_id=? AND a.user_id<>? AND a.check_in_at IS NOT NULL
      ORDER BY a.check_in_at ASC LIMIT 1`,
    [date, deviceId, currentUserId]
  );
  const first = dup[0];
  if (!first) return;
  const note = `Perangkat absensi dipakai bersama dengan ${currentUserName}`;
  await pool.query(
    "UPDATE attendance SET flagged=1, reason=CONCAT(COALESCE(reason,''), CASE WHEN reason IS NULL OR reason='' THEN '' ELSE '; ' END, ?) WHERE id=?",
    [note, first.id]
  );
  await audit({ id: currentUserId, name: currentUserName }, 'attendance_duplicate_device', 'attendance', first.id, `${first.name} & ${currentUserName} memakai perangkat sama (${date})`);
  if (await isNotifyEnabledForUser('absensi_duplikat_perangkat', first.user_id)) {
    const msg = `⚠️ *Perangkat Absensi Duplikat*\nPerangkat yang Anda pakai absen pada ${date} terdeteksi juga dipakai oleh ${currentUserName}.\nAbsensi Anda ditandai & performa bulan ini dikurangi 50%.`;
    try { await queueWaNotification({ type: 'alert', toUserId: first.user_id, message: msg }); } catch { /* abaikan */ }
  }
  const adminMsg = `🚨 *Duplikasi Perangkat Absensi*\n${first.name} (absen pertama) dan ${currentUserName} memakai perangkat absensi yang sama pada ${date}.\n${first.name} ditandai & performa bulan ini dikurangi 50%.`;
  await notifyAdmins(adminMsg);
}

router.get('/today', async (req, res) => {
  const [rows] = await pool.query('SELECT * FROM attendance WHERE user_id=? AND work_date=? LIMIT 1', [req.user.id, todayKey()]);
  const [[u]] = await pool.query('SELECT device_id FROM users WHERE id=?', [req.user.id]);
  res.json({ attendance: rows[0] || null, deviceBound: !!u?.device_id });
});

router.get('/me', async (req, res) => {
  const month = /^\d{4}-\d{2}$/.test(req.query.month) ? req.query.month : todayKey().slice(0, 7);
  const [rows] = await pool.query("SELECT * FROM attendance WHERE user_id=? AND DATE_FORMAT(work_date,'%Y-%m')=? ORDER BY work_date DESC", [req.user.id, month]);
  res.json({ attendance: rows });
});

// Cek & ikat perangkat. Kembalikan {deviceOk, reason}.
async function checkDevice(userId, incoming) {
  if (!incoming) return { ok: false, reason: 'ID perangkat tidak terkirim' };
  const [[u]] = await pool.query('SELECT device_id FROM users WHERE id=?', [userId]);
  if (!u?.device_id) { await pool.query('UPDATE users SET device_id=? WHERE id=?', [incoming, userId]); return { ok: true, reason: null, bound: true }; }
  if (u.device_id === incoming) return { ok: true, reason: null };
  return { ok: false, reason: 'Perangkat tidak dikenal (kemungkinan dititipkan)' };
}

// Absen MASUK.
router.post('/check-in', async (req, res) => {
  const office = await getOffice();
  const { lat, lng, tz, accuracy, deviceId } = req.body || {};
  const { reasons, dist } = locationReasons({ lat, lng, tz, accuracy }, office);
  const dev = await checkDevice(req.user.id, deviceId);
  if (!dev.ok && dev.reason) reasons.push(dev.reason);
  const vpn = reasons.length > 0;
  const reason = reasons.join('; ') || null;
  const ip = clientIp(req);
  const date = todayKey();

  const [exist] = await pool.query('SELECT id, check_in_at FROM attendance WHERE user_id=? AND work_date=?', [req.user.id, date]);
  if (exist[0]?.check_in_at) return res.status(400).json({ error: 'Anda sudah absen masuk hari ini.' });
  const acc = accuracy != null ? Math.round(accuracy) : null;
  const fl = vpn ? 1 : 0;
  if (exist[0]) {
    await pool.query('UPDATE attendance SET check_in_at=NOW(), check_in_lat=?, check_in_lng=?, check_in_dist_m=?, accuracy_m=?, check_in_ip=?, device_id=?, check_in_vpn=?, flagged=GREATEST(flagged,?), reason=? WHERE id=?',
      [lat ?? null, lng ?? null, dist, acc, ip, deviceId || null, fl, fl, reason, exist[0].id]);
  } else {
    await pool.query('INSERT INTO attendance (user_id, work_date, check_in_at, check_in_lat, check_in_lng, check_in_dist_m, accuracy_m, check_in_ip, device_id, check_in_vpn, flagged, reason) VALUES (?,?,NOW(),?,?,?,?,?,?,?,?,?)',
      [req.user.id, date, lat ?? null, lng ?? null, dist, acc, ip, deviceId || null, fl, fl, reason]);
  }
  await audit(req.user, 'attendance_checkin', 'attendance', null, vpn ? `flagged: ${reason}` : 'OK');
  if (vpn) await notifyCoords(`⚠️ *Absensi Mencurigakan*\n${req.user.name} absen masuk dengan anomali.\nAlasan: ${reason}\nPerforma bulan ini dikurangi 50%.`);
  if (deviceId) await checkDuplicateDevice(req.user.id, req.user.name, deviceId, date);
  res.json({ ok: true, vpn, reason, distance: dist, deviceBound: dev.bound || false, warning: vpn ? `Absensi ditandai: ${reason}. Performa bulan ini dikurangi 50% & koordinator diberi tahu.` : null });
});

// Absen PULANG.
router.post('/check-out', async (req, res) => {
  const office = await getOffice();
  const { lat, lng, tz, accuracy, deviceId } = req.body || {};
  const { reasons } = locationReasons({ lat, lng, tz, accuracy }, office);
  const dev = await checkDevice(req.user.id, deviceId);
  if (!dev.ok && dev.reason) reasons.push(dev.reason);
  const vpn = reasons.length > 0;
  const reason = reasons.join('; ') || null;
  const ip = clientIp(req);
  const date = todayKey();
  const [exist] = await pool.query('SELECT id, check_in_at, check_out_at FROM attendance WHERE user_id=? AND work_date=?', [req.user.id, date]);
  if (!exist[0]?.check_in_at) return res.status(400).json({ error: 'Anda belum absen masuk hari ini.' });
  if (exist[0]?.check_out_at) return res.status(400).json({ error: 'Anda sudah absen pulang hari ini.' });
  await pool.query('UPDATE attendance SET check_out_at=NOW(), check_out_lat=?, check_out_lng=?, check_out_ip=?, check_out_vpn=?, flagged=GREATEST(flagged,?), reason=COALESCE(reason,?) WHERE id=?',
    [lat ?? null, lng ?? null, ip, vpn ? 1 : 0, vpn ? 1 : 0, reason, exist[0].id]);
  await audit(req.user, 'attendance_checkout', 'attendance', null, vpn ? `flagged: ${reason}` : 'OK');
  if (vpn) await notifyCoords(`⚠️ *Absensi Mencurigakan*\n${req.user.name} absen pulang dengan anomali.\nAlasan: ${reason}`);
  res.json({ ok: true, vpn, reason, warning: vpn ? `Absensi ditandai: ${reason}.` : null });
});

// ===== Manajemen (admin/koordinator) =====
router.get('/', requireRole('admin', 'koordinator'), async (req, res) => {
  const month = /^\d{4}-\d{2}$/.test(req.query.month) ? req.query.month : todayKey().slice(0, 7);
  const [rows] = await pool.query(
    `SELECT a.*, u.name, u.jabatan FROM attendance a JOIN users u ON u.id=a.user_id
      WHERE DATE_FORMAT(a.work_date,'%Y-%m')=? ${req.query.userId ? 'AND a.user_id=?' : ''} ${req.query.flagged === '1' ? 'AND a.flagged=1' : ''}
      ORDER BY a.work_date DESC, u.name`,
    req.query.userId ? [month, Number(req.query.userId)] : [month]
  );
  res.json({ attendance: rows, office: await getOffice() });
});

// Rekap bulanan per teknisi (hadir/alpa/izin/sakit/cuti/dinas luar/ditandai).
router.get('/recap', requireRole('admin', 'koordinator'), async (req, res) => {
  const month = /^\d{4}-\d{2}$/.test(req.query.month) ? req.query.month : todayKey().slice(0, 7);
  const [y, m] = month.split('-').map(Number);
  const start = `${month}-01`, end = `${m === 12 ? y + 1 : y}-${String(m === 12 ? 1 : m + 1).padStart(2, '0')}-01`;
  const today = todayKey();
  const [techs] = await pool.query("SELECT id, name, jabatan, active FROM users WHERE (role='teknisi' OR JSON_CONTAINS(roles,'\"teknisi\"')) ORDER BY active DESC, name");
  const recap = [];
  for (const t of techs) {
    const [[at]] = await pool.query('SELECT COUNT(check_in_at) hadir, COALESCE(SUM(flagged),0) flagged FROM attendance WHERE user_id=? AND work_date>=? AND work_date<?', [t.id, start, end]);
    const [present] = await pool.query("SELECT DATE_FORMAT(work_date,'%Y-%m-%d') d FROM attendance WHERE user_id=? AND check_in_at IS NOT NULL AND work_date>=? AND work_date<?", [t.id, start, end]);
    const presentSet = new Set(present.map((r) => r.d));
    const [shifts] = await pool.query("SELECT DATE_FORMAT(shift_date,'%Y-%m-%d') d FROM shifts WHERE user_id=? AND shift_type NOT IN ('libur','dinas_luar','cuti') AND shift_date>=? AND shift_date<? AND shift_date<=?", [t.id, start, end, today]);
    const [leaves] = await pool.query("SELECT type, DATE_FORMAT(start_date,'%Y-%m-%d') s, DATE_FORMAT(end_date,'%Y-%m-%d') e FROM leave_requests WHERE user_id=? AND status='disetujui' AND start_date<? AND end_date>=?", [t.id, end, start]);
    const leaveSet = new Set();
    const byType = { izin: 0, sakit: 0, cuti: 0, dinas_luar: 0 };
    for (const lv of leaves) {
      let cur = new Date(`${lv.s}T00:00:00Z`);
      const last = new Date(`${lv.e}T00:00:00Z`);
      while (cur <= last) {
        const ds = cur.toISOString().slice(0, 10);
        if (ds >= start && ds < end) { if (!leaveSet.has(ds)) byType[lv.type] = (byType[lv.type] || 0) + 1; leaveSet.add(ds); }
        cur = new Date(cur.getTime() + 86400000);
      }
    }
    let alpa = 0;
    for (const s of shifts) if (!presentSet.has(s.d) && !leaveSet.has(s.d)) alpa++;
    recap.push({ techId: t.id, name: t.name, jabatan: t.jabatan, active: !!t.active, hadir: Number(at.hadir) || 0, flagged: Number(at.flagged) || 0, alpa, ...byType });
  }
  res.json({ month, recap });
});

// ===== Tinjauan absen (penalti performa perlu persetujuan koordinator) =====
// Kandidat absen sebulan: hari on-duty (bukan libur/DL/cuti, sudah lewat) tanpa
// check-in & tanpa izin disetujui — lengkap dengan status tinjauannya.
router.get('/absences', requireRole('admin', 'koordinator'), async (req, res) => {
  const month = /^\d{4}-\d{2}$/.test(req.query.month) ? req.query.month : todayKey().slice(0, 7);
  const [y, m] = month.split('-').map(Number);
  const start = `${month}-01`, end = `${m === 12 ? y + 1 : y}-${String(m === 12 ? 1 : m + 1).padStart(2, '0')}-01`;
  const [rows] = await pool.query(
    `SELECT s.user_id, u.name, u.jabatan, DATE_FORMAT(s.shift_date,'%Y-%m-%d') work_date, s.shift_type,
            ar.status, ar.note, ar.decided_at, du.name AS decided_by_name
       FROM shifts s
       JOIN users u ON u.id=s.user_id AND (u.role='teknisi' OR JSON_CONTAINS(u.roles,'"teknisi"'))
       LEFT JOIN attendance a ON a.user_id=s.user_id AND a.work_date=s.shift_date AND a.check_in_at IS NOT NULL
       LEFT JOIN absence_reviews ar ON ar.user_id=s.user_id AND ar.work_date=s.shift_date
       LEFT JOIN users du ON du.id=ar.decided_by
      WHERE s.shift_type NOT IN ('libur','dinas_luar','cuti')
        AND s.shift_date>=? AND s.shift_date<? AND s.shift_date<CURDATE()
        AND a.id IS NULL
        AND NOT EXISTS (SELECT 1 FROM leave_requests lr WHERE lr.user_id=s.user_id AND lr.status='disetujui' AND s.shift_date BETWEEN lr.start_date AND lr.end_date)
      ORDER BY (ar.status IS NULL) DESC, s.shift_date DESC, u.name`,
    [start, end]
  );
  res.json({ month, absences: rows });
});

// Putuskan satu absen: 'penalti' (potong skor −15) / 'dimaafkan' / 'reset' (batalkan tinjauan).
router.post('/absences/decide', requireRole('admin', 'koordinator'), async (req, res) => {
  const userId = Number(req.body.userId);
  const workDate = String(req.body.workDate || '');
  const status = req.body.status;
  const note = (req.body.note || '').trim() || null;
  if (!userId || !/^\d{4}-\d{2}-\d{2}$/.test(workDate)) return res.status(400).json({ error: 'userId & workDate (YYYY-MM-DD) wajib.' });
  const [[u]] = await pool.query('SELECT name FROM users WHERE id=?', [userId]);
  if (!u) return res.status(404).json({ error: 'Teknisi tidak ditemukan.' });

  if (status === 'reset') {
    await pool.query('DELETE FROM absence_reviews WHERE user_id=? AND work_date=?', [userId, workDate]);
    await audit(req.user, 'absence_reset', 'attendance', null, `${u.name} ${workDate}`);
    return res.json({ ok: true, status: null });
  }
  if (status !== 'penalti' && status !== 'dimaafkan') return res.status(400).json({ error: 'status tidak valid.' });
  await pool.query(
    `INSERT INTO absence_reviews (user_id, work_date, status, note, decided_by) VALUES (?,?,?,?,?)
     ON DUPLICATE KEY UPDATE status=VALUES(status), note=VALUES(note), decided_by=VALUES(decided_by), decided_at=NOW()`,
    [userId, workDate, status, note, req.user.id]
  );
  await audit(req.user, status === 'penalti' ? 'absence_penalti' : 'absence_excuse', 'attendance', null, `${u.name} ${workDate}${note ? ' · ' + note : ''}`);
  const msg = status === 'penalti'
    ? `⚠️ *Absen Dikonfirmasi*\nKetidakhadiran Anda pada ${workDate} dikonfirmasi koordinator sebagai ALPA.\nSkor performa bulan ini dipotong −15.${note ? `\nCatatan: ${note}` : ''}`
    : `ℹ️ *Absen Dimaafkan*\nKetidakhadiran Anda pada ${workDate} ditandai dimaafkan (tanpa penalti).${note ? `\nCatatan: ${note}` : ''}`;
  try { if (await isNotifyEnabledForUser('absensi_keputusan_alpa', userId)) await queueWaNotification({ type: 'other', toUserId: userId, message: msg }); } catch { /* abaikan */ }
  res.json({ ok: true, status });
});

// Tandai ulang VPN/wajar (admin) + audit.
router.patch('/:id', requireRole('admin'), async (req, res) => {
  const flagged = req.body.flagged ? 1 : 0;
  const [[a]] = await pool.query('SELECT a.work_date, u.name FROM attendance a JOIN users u ON u.id=a.user_id WHERE a.id=?', [Number(req.params.id)]);
  await pool.query('UPDATE attendance SET flagged=?, reason=COALESCE(?,reason) WHERE id=?', [flagged, req.body.reason || null, Number(req.params.id)]);
  await audit(req.user, flagged ? 'attendance_flag' : 'attendance_unflag', 'attendance', req.params.id, `${a?.name || ''} ${a ? ymd(a.work_date) : ''}${req.body.reason ? ' · ' + req.body.reason : ''}`);
  res.json({ ok: true });
});

// Jejak audit (admin).
router.get('/audit', requireRole('admin'), async (req, res) => {
  const [rows] = await pool.query('SELECT * FROM audit_log ORDER BY id DESC LIMIT 200');
  res.json({ audit: rows });
});

// Reset device binding (admin) — agar teknisi bisa ikat ulang perangkat baru.
router.post('/reset-device/:userId', requireRole('admin'), async (req, res) => {
  const [[u]] = await pool.query('SELECT name FROM users WHERE id=?', [Number(req.params.userId)]);
  await pool.query('UPDATE users SET device_id=NULL WHERE id=?', [Number(req.params.userId)]);
  await audit(req.user, 'device_reset', 'user', req.params.userId, `Reset perangkat absensi: ${u?.name || ''}`);
  res.json({ ok: true });
});

export default router;
