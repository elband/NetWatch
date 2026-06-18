import { pool } from '../db/pool.js';
import { snapshotAndNotifyOnDuty } from './incidentController.js';

export async function listDevices(req, res) {
  const [rows] = await pool.query('SELECT * FROM devices ORDER BY id');
  res.json({ devices: rows });
}

export async function createDevice(req, res) {
  const { name, ip, type, category, icon, loc, ssh_host, ssh_port, ssh_username, lat, lng, inspect_required } = req.body;
  if (!name || !ip || !type) return res.status(400).json({ error: 'Nama, IP, tipe wajib diisi' });
  const inspReq = inspect_required == null ? 1 : (inspect_required ? 1 : 0);
  const [result] = await pool.query(
    `INSERT INTO devices (name, ip, type, category, icon, loc, inspect_required, status, ssh_host, ssh_port, ssh_username, lat, lng)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'offline', ?, ?, ?, ?, ?)`,
    [name, ip, type, category?.trim() || null, icon?.trim() || null, loc || null, inspReq, ssh_host || ip, ssh_port || 22, ssh_username || null,
     lat === '' || lat == null ? null : Number(lat), lng === '' || lng == null ? null : Number(lng)]
  );
  const [rows] = await pool.query('SELECT * FROM devices WHERE id = ?', [result.insertId]);
  res.status(201).json({ device: rows[0] });
}

export async function updateDevice(req, res) {
  const id = Number(req.params.id);
  const { name, ip, type, category, icon, loc, ssh_host, ssh_port, ssh_username, lat, lng, inspect_required } = req.body;
  const [existing] = await pool.query('SELECT * FROM devices WHERE id = ?', [id]);
  if (!existing[0]) return res.status(404).json({ error: 'Perangkat tidak ditemukan' });
  await pool.query(
    `UPDATE devices SET name=?, ip=?, type=?, category=?, icon=?, loc=?, inspect_required=?, ssh_host=?, ssh_port=?, ssh_username=?, lat=?, lng=? WHERE id=?`,
    [
      name ?? existing[0].name,
      ip ?? existing[0].ip,
      type ?? existing[0].type,
      category === '' ? null : (category ?? existing[0].category),
      icon === '' ? null : (icon ?? existing[0].icon),
      loc ?? existing[0].loc,
      inspect_required == null ? existing[0].inspect_required : (inspect_required ? 1 : 0),
      ssh_host ?? existing[0].ssh_host,
      ssh_port ?? existing[0].ssh_port,
      ssh_username ?? existing[0].ssh_username,
      lat === '' ? null : (lat ?? existing[0].lat),
      lng === '' ? null : (lng ?? existing[0].lng),
      id,
    ]
  );
  const [rows] = await pool.query('SELECT * FROM devices WHERE id = ?', [id]);
  res.json({ device: rows[0] });
}

export async function deleteDevice(req, res) {
  const id = Number(req.params.id);
  await pool.query('DELETE FROM devices WHERE id = ?', [id]);
  res.json({ ok: true });
}

// Minta perangkat (non-server) dialarmkan walau pada jam malam ("dimatikan").
// Set override agar tidak dikategorikan dimatikan lagi, lalu buatkan insiden alarm + notifikasi on-duty.
export async function requestAlarm(req, res) {
  const id = Number(req.params.id);
  const [rows] = await pool.query('SELECT * FROM devices WHERE id = ?', [id]);
  const device = rows[0];
  if (!device) return res.status(404).json({ error: 'Perangkat tidak ditemukan' });
  const conn = await pool.getConnection();
  try {
    await conn.query('UPDATE devices SET alarm_override=1, off_reason=NULL WHERE id=?', [id]);
    let incidentId = null, notified = 0;
    if (device.status === 'offline') {
      const [ex] = await conn.query("SELECT id FROM incidents WHERE device_id=? AND status!='selesai' LIMIT 1", [id]);
      if (ex.length) incidentId = ex[0].id;
      else {
        const [[c]] = await conn.query('SELECT COUNT(*) c FROM incidents');
        incidentId = 'INC-' + String(c.c + 1).padStart(3, '0');
        const issue = 'Perangkat tidak merespons - dialarmkan manual (override jam malam)';
        await conn.query(
          `INSERT INTO incidents (id, device_id, device_name, ip, issue, priority, tech_id, status, step, source)
           VALUES (?, ?, ?, ?, ?, 'kritis', NULL, 'aktif', 0, 'manual')`,
          [incidentId, id, device.name, device.ip, issue]
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
