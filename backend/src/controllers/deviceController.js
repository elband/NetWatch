import { pool } from '../db/pool.js';
import { snapshotAndNotifyOnDuty } from './incidentController.js';
import { nextIncidentId } from '../utils/incidentId.js';
import { unitFilter, rowInUnit, insertUnitId } from '../middleware/unitScope.js';
import { listSnmpInterfaces } from '../services/snmpInterfaces.js';

export async function listDevices(req, res) {
  // under_maintenance = perangkat sedang dalam jendela maintenance aktif
  // (cocok per-device, per-lokasi via nama, atau site-wide bila kedua kolom NULL).
  const uf = unitFilter(req.unitId, 'd.unit_id');
  const [rows] = await pool.query(
    `SELECT d.*, loc.name AS location_name, loc.lat AS location_lat, loc.lng AS location_lng, EXISTS(
        SELECT 1 FROM maintenance_windows mw
        LEFT JOIN locations l ON l.id = mw.location_id
        WHERE NOW() BETWEEN mw.starts_at AND mw.ends_at
          AND (mw.device_id = d.id
               OR (mw.device_id IS NULL AND mw.location_id IS NULL)
               OR (mw.location_id IS NOT NULL AND (mw.location_id = d.location_id OR l.name = d.loc)))
      ) AS under_maintenance
     FROM devices d
     LEFT JOIN locations loc ON loc.id = d.location_id
     WHERE d.asset_class = 'network'${uf.clause}
     ORDER BY d.id`,
    uf.params
  );
  res.json({ devices: rows });
}

const CHECK_TYPES = ['ping', 'tcp', 'http'];
function normCheckType(v) { return CHECK_TYPES.includes(v) ? v : 'ping'; }

// Validasi URL health-check (anti-SSRF): kosong OK; wajib http/https; tolak host
// metadata cloud/link-local. RFC1918 privat diizinkan (monitoring internal sah).
function validateCheckUrl(u) {
  const s = (u ?? '').toString().trim();
  if (!s) return null;
  let url; try { url = new URL(s); } catch { return 'URL health-check tidak valid.'; }
  if (!/^https?:$/.test(url.protocol)) return 'URL health-check harus berskema http/https.';
  const h = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (h === 'metadata.google.internal' || h === '0.0.0.0' || h.startsWith('169.254.')) {
    return 'Host URL health-check tidak diizinkan (metadata/link-local).';
  }
  return null;
}

export async function createDevice(req, res) {
  const { name, ip, type, category, icon, loc, location_id, ssh_host, ssh_port, ssh_username, lat, lng, inspect_required, is_uplink, uplink_ifindex,
    check_type, check_port, check_url, snmp_enabled, snmp_community, snmp_port, snmp_host } = req.body;
  if (!name || !ip || !type) return res.status(400).json({ error: 'Nama, IP, tipe wajib diisi' });
  const urlErr = validateCheckUrl(check_url);
  if (urlErr) return res.status(400).json({ error: urlErr });
  const unitId = insertUnitId(req);
  if (unitId == null) return res.status(400).json({ error: 'Pilih unit terlebih dahulu.' });
  const inspReq = inspect_required == null ? 1 : (inspect_required ? 1 : 0);
  const locId = location_id === '' || location_id == null ? null : Number(location_id);
  const [result] = await pool.query(
    `INSERT INTO devices (unit_id, name, ip, type, category, icon, loc, location_id, inspect_required, is_uplink, uplink_ifindex, status, ssh_host, ssh_port, ssh_username, lat, lng,
       check_type, check_port, check_url, snmp_enabled, snmp_community, snmp_port, snmp_host)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'offline', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [unitId, name, ip, type, category?.trim() || null, icon?.trim() || null, loc || null, locId, inspReq, is_uplink ? 1 : 0, uplink_ifindex ? Number(uplink_ifindex) : null, ssh_host || ip, ssh_port || 22, ssh_username || null,
     lat === '' || lat == null ? null : Number(lat), lng === '' || lng == null ? null : Number(lng),
     normCheckType(check_type), check_port ? Number(check_port) : null, check_url?.trim() || null,
     snmp_enabled ? 1 : 0, snmp_community?.trim() || 'public', snmp_port ? Number(snmp_port) : 161, snmp_host?.trim() || null]
  );
  // Hanya satu uplink per unit: bila perangkat ini ditandai uplink, matikan flag di perangkat lain.
  if (is_uplink) await pool.query('UPDATE devices SET is_uplink=0 WHERE unit_id=? AND id<>?', [unitId, result.insertId]);
  const [rows] = await pool.query('SELECT * FROM devices WHERE id = ?', [result.insertId]);
  res.status(201).json({ device: rows[0] });
}

export async function updateDevice(req, res) {
  const id = Number(req.params.id);
  const { name, ip, type, category, icon, loc, location_id, ssh_host, ssh_port, ssh_username, lat, lng, inspect_required, is_uplink, uplink_ifindex,
    check_type, check_port, check_url, snmp_enabled, snmp_community, snmp_port, snmp_host } = req.body;
  if (check_url !== undefined) {
    const urlErr = validateCheckUrl(check_url);
    if (urlErr) return res.status(400).json({ error: urlErr });
  }
  const [existing] = await pool.query('SELECT * FROM devices WHERE id = ?', [id]);
  if (!existing[0] || !rowInUnit(existing[0], req.unitId)) return res.status(404).json({ error: 'Perangkat tidak ditemukan' });
  await pool.query(
    `UPDATE devices SET name=?, ip=?, type=?, category=?, icon=?, loc=?, location_id=?, inspect_required=?, is_uplink=?, uplink_ifindex=?, ssh_host=?, ssh_port=?, ssh_username=?, lat=?, lng=?,
       check_type=?, check_port=?, check_url=?, snmp_enabled=?, snmp_community=?, snmp_port=?, snmp_host=? WHERE id=?`,
    [
      name ?? existing[0].name,
      ip ?? existing[0].ip,
      type ?? existing[0].type,
      category === '' ? null : (category ?? existing[0].category),
      icon === '' ? null : (icon ?? existing[0].icon),
      loc ?? existing[0].loc,
      location_id === undefined ? existing[0].location_id : (location_id === '' || location_id == null ? null : Number(location_id)),
      inspect_required == null ? existing[0].inspect_required : (inspect_required ? 1 : 0),
      is_uplink === undefined ? existing[0].is_uplink : (is_uplink ? 1 : 0),
      uplink_ifindex === undefined ? existing[0].uplink_ifindex : (uplink_ifindex === '' || uplink_ifindex == null ? null : Number(uplink_ifindex)),
      ssh_host ?? existing[0].ssh_host,
      ssh_port ?? existing[0].ssh_port,
      ssh_username ?? existing[0].ssh_username,
      lat === '' ? null : (lat ?? existing[0].lat),
      lng === '' ? null : (lng ?? existing[0].lng),
      check_type === undefined ? existing[0].check_type : normCheckType(check_type),
      check_port === undefined ? existing[0].check_port : (check_port ? Number(check_port) : null),
      check_url === undefined ? existing[0].check_url : (check_url?.trim() || null),
      snmp_enabled === undefined ? existing[0].snmp_enabled : (snmp_enabled ? 1 : 0),
      snmp_community === undefined ? existing[0].snmp_community : (snmp_community?.trim() || 'public'),
      snmp_port === undefined ? existing[0].snmp_port : (snmp_port ? Number(snmp_port) : 161),
      snmp_host === undefined ? existing[0].snmp_host : (snmp_host?.trim() || null),
      id,
    ]
  );
  // Hanya satu uplink per unit.
  if (is_uplink) await pool.query('UPDATE devices SET is_uplink=0 WHERE unit_id=? AND id<>?', [existing[0].unit_id, id]);
  const [rows] = await pool.query('SELECT * FROM devices WHERE id = ?', [id]);
  res.json({ device: rows[0] });
}

// Foto perangkat: thumbnail kartu di menu Peralatan. Tanpa foto, kartu fallback ke emoji `icon`.
export async function uploadDevicePhoto(req, res) {
  const id = Number(req.params.id);
  const [rows] = await pool.query('SELECT * FROM devices WHERE id = ?', [id]);
  const device = rows[0];
  if (!device || !rowInUnit(device, req.unitId)) return res.status(404).json({ error: 'Perangkat tidak ditemukan' });
  if (!req.file) return res.status(400).json({ error: 'Berkas foto wajib diunggah.' });
  const photoUrl = `/uploads/devices/${req.file.filename}`;
  await pool.query('UPDATE devices SET photo_url=? WHERE id=?', [photoUrl, id]);
  const [updated] = await pool.query('SELECT * FROM devices WHERE id = ?', [id]);
  res.json({ device: updated[0] });
}

export async function removeDevicePhoto(req, res) {
  const id = Number(req.params.id);
  const [rows] = await pool.query('SELECT * FROM devices WHERE id = ?', [id]);
  const device = rows[0];
  if (!device || !rowInUnit(device, req.unitId)) return res.status(404).json({ error: 'Perangkat tidak ditemukan' });
  await pool.query('UPDATE devices SET photo_url=NULL WHERE id=?', [id]);
  const [updated] = await pool.query('SELECT * FROM devices WHERE id = ?', [id]);
  res.json({ device: updated[0] });
}

export async function deleteDevice(req, res) {
  const id = Number(req.params.id);
  const uf = unitFilter(req.unitId);
  await pool.query(`DELETE FROM devices WHERE id = ?${uf.clause}`, [id, ...uf.params]);
  res.json({ ok: true });
}

// Minta perangkat (non-server) dialarmkan walau pada jam malam ("dimatikan").
// Set override agar tidak dikategorikan dimatikan lagi, lalu buatkan insiden alarm + notifikasi on-duty.
export async function requestAlarm(req, res) {
  const id = Number(req.params.id);
  const [rows] = await pool.query('SELECT * FROM devices WHERE id = ?', [id]);
  const device = rows[0];
  if (!device || !rowInUnit(device, req.unitId)) return res.status(404).json({ error: 'Perangkat tidak ditemukan' });
  const conn = await pool.getConnection();
  try {
    await conn.query('UPDATE devices SET alarm_override=1, off_reason=NULL WHERE id=?', [id]);
    let incidentId = null, notified = 0;
    if (device.status === 'offline') {
      const [ex] = await conn.query("SELECT id FROM incidents WHERE device_id=? AND status!='selesai' LIMIT 1", [id]);
      if (ex.length) incidentId = ex[0].id;
      else {
        incidentId = await nextIncidentId(conn);
        const issue = 'Perangkat tidak merespons - dialarmkan manual (override jam malam)';
        await conn.query(
          `INSERT INTO incidents (id, unit_id, device_id, device_name, ip, issue, priority, tech_id, status, step, source)
           VALUES (?, ?, ?, ?, ?, ?, 'kritis', NULL, 'aktif', 0, 'manual')`,
          [incidentId, device.unit_id ?? null, id, device.name, device.ip, issue]
        );
        await conn.query('INSERT INTO incident_notes (incident_id, step, note) VALUES (?, 0, ?)', [incidentId, `Alarm diminta manual oleh ${req.user.name} (override aturan jam malam).`]);
        notified = (await snapshotAndNotifyOnDuty(conn, { id: incidentId, priority: 'kritis', deviceName: device.name, issue })) || 0;
      }
    }
    const [updated] = await conn.query('SELECT * FROM devices WHERE id = ?', [id]);
    res.json({ device: updated[0], incidentId, notified });
  } finally {
    conn.release();
  }
}

// Toggle mode standby: saat standby (monitor_enabled=0), perangkat tidak di-ping
// otomatis dan tidak memicu insiden otomatis (lihat services/pingService.js).
export async function toggleMonitor(req, res) {
  const id = Number(req.params.id);
  const [rows] = await pool.query('SELECT * FROM devices WHERE id = ?', [id]);
  const device = rows[0];
  if (!device || !rowInUnit(device, req.unitId)) return res.status(404).json({ error: 'Perangkat tidak ditemukan' });
  const next = device.monitor_enabled ? 0 : 1;
  await pool.query('UPDATE devices SET monitor_enabled=? WHERE id=?', [next, id]);
  const [updated] = await pool.query('SELECT * FROM devices WHERE id = ?', [id]);
  res.json({ device: updated[0] });
}

// Deteksi interface perangkat via SNMP (untuk memilih ifIndex uplink WAN dari daftar,
// tanpa menebak angka). IP diambil dari perangkat tersimpan; community/port boleh
// dioverride dari form agar bisa dites sebelum disimpan.
export async function snmpInterfaces(req, res) {
  const id = Number(req.params.id);
  const [rows] = await pool.query('SELECT * FROM devices WHERE id = ?', [id]);
  const device = rows[0];
  if (!device || !rowInUnit(device, req.unitId)) return res.status(404).json({ error: 'Perangkat tidak ditemukan' });
  // SNMP dibaca dari snmp_host bila diisi (mis. Sub Mikrotik di LAN), else IP perangkat.
  // Override dari body agar bisa dites sebelum perangkat disimpan.
  const snmpHost = String(req.body?.snmp_host || device.snmp_host || device.ip || '').trim();
  if (!snmpHost || snmpHost.startsWith('N/A')) return res.status(400).json({ error: 'Tidak ada host SNMP — isi SNMP Host atau IP perangkat.' });
  const community = req.body?.snmp_community || device.snmp_community || 'public';
  const port = Number(req.body?.snmp_port || device.snmp_port || 161);
  try {
    const interfaces = await listSnmpInterfaces({ ip: snmpHost, community, port });
    if (!interfaces.length) return res.status(502).json({ error: 'Tidak ada interface terbaca. Pastikan SNMP aktif & community/izin IP benar.' });
    res.json({ interfaces });
  } catch (e) {
    res.status(502).json({ error: e?.message || 'Gagal membaca SNMP.' });
  }
}

// Toggle "selalu aktif 24 jam": perangkat dikecualikan dari alur Hidupkan/Matikan
// peralatan (tidak boleh dimatikan maupun dihidupkan manual — mis. Masterclock/server).
export async function toggleAlwaysOn(req, res) {
  const id = Number(req.params.id);
  const [rows] = await pool.query('SELECT * FROM devices WHERE id = ?', [id]);
  const device = rows[0];
  if (!device || !rowInUnit(device, req.unitId)) return res.status(404).json({ error: 'Perangkat tidak ditemukan' });
  const next = device.always_on ? 0 : 1;
  // Saat ditandai selalu aktif, pastikan monitoring hidup & bersihkan status "dimatikan".
  if (next) await pool.query("UPDATE devices SET always_on=1, monitor_enabled=1, off_reason = CASE WHEN off_reason='dimatikan' THEN NULL ELSE off_reason END WHERE id=?", [id]);
  else await pool.query('UPDATE devices SET always_on=0 WHERE id=?', [id]);
  const [updated] = await pool.query('SELECT * FROM devices WHERE id = ?', [id]);
  res.json({ device: updated[0] });
}

// Riwayat metrik (time-series) untuk grafik tren. Rentang 24h/7d/30d di-downsample
// ke bucket waktu agar payload tetap ringan.
const RANGE = {
  '24h': { hours: 24, bucketSec: 300 },     // 5 menit
  '7d': { hours: 24 * 7, bucketSec: 3600 },  // 1 jam
  '30d': { hours: 24 * 30, bucketSec: 21600 }, // 6 jam
};

export async function getDeviceMetrics(req, res) {
  const id = Number(req.params.id);
  // Scope metrik lewat perangkat induknya (device_metrics tidak ber-unit).
  const [[device]] = await pool.query('SELECT id, unit_id FROM devices WHERE id = ?', [id]);
  if (!device || !rowInUnit(device, req.unitId)) return res.status(404).json({ error: 'Perangkat tidak ditemukan' });
  const range = RANGE[req.query.range] ? req.query.range : '24h';
  const { hours, bucketSec } = RANGE[range];
  const [rows] = await pool.query(
    `SELECT FROM_UNIXTIME(FLOOR(UNIX_TIMESTAMP(recorded_at)/?)*?) AS t,
            ROUND(AVG(ping_ms)) AS avg_ping,
            MAX(ping_ms) AS max_ping,
            ROUND(AVG(NULLIF(cpu, 0))) AS avg_cpu,
            ROUND(AVG(NULLIF(mem, 0))) AS avg_mem,
            ROUND(AVG(status <> 'offline') * 100, 2) AS up_pct,
            SUM(in_maint) AS maint
       FROM device_metrics
      WHERE device_id = ? AND recorded_at >= (NOW() - INTERVAL ? HOUR)
      GROUP BY t ORDER BY t ASC`,
    [bucketSec, bucketSec, id, hours]
  );
  // Ringkasan periode: uptime%, latency rata-rata/maks.
  const [[summary]] = await pool.query(
    `SELECT COUNT(*) AS samples,
            ROUND(AVG(status <> 'offline') * 100, 2) AS up_pct,
            ROUND(AVG(ping_ms)) AS avg_ping,
            MAX(ping_ms) AS max_ping
       FROM device_metrics
      WHERE device_id = ? AND recorded_at >= (NOW() - INTERVAL ? HOUR) AND in_maint = 0`,
    [id, hours]
  );
  res.json({ range, series: rows, summary });
}
