import ping from 'ping';
import { pool } from '../db/pool.js';
import { snapshotAndNotifyOnDuty } from '../controllers/incidentController.js';
import { computeServices } from './servicesStatus.js';

function meterFromStatus(prevStatus, alive, avgMs, thresholds) {
  if (!alive) return { status: 'offline', pingMs: 0 };
  const pingMs = Math.round(avgMs || 0);
  if (pingMs > thresholds.pingTimeoutMs) return { status: 'warning', pingMs };
  return { status: 'online', pingMs };
}

async function getThresholds() {
  const [rows] = await pool.query(
    "SELECT setting_key, setting_value FROM settings WHERE setting_key IN ('threshold_ping_timeout_ms','threshold_cpu','threshold_mem')"
  );
  const map = {};
  for (const r of rows) map[r.setting_key] = JSON.parse(r.setting_value);
  return {
    pingTimeoutMs: map.threshold_ping_timeout_ms ?? 3000,
    cpu: map.threshold_cpu ?? 80,
    mem: map.threshold_mem ?? 85,
  };
}

async function nextIncidentId(conn) {
  const [rows] = await conn.query('SELECT COUNT(*) as c FROM incidents');
  return 'INC-' + String(rows[0].c + 1).padStart(3, '0');
}

export async function checkAllDevices(io) {
  const thresholds = await getThresholds();
  const [devices] = await pool.query('SELECT * FROM devices');

  for (const device of devices) {
    let alive = false;
    let avgMs = 0;
    try {
      const result = await ping.promise.probe(device.ip, { timeout: 2 });
      alive = result.alive;
      avgMs = parseFloat(result.time) || 0;
    } catch {
      alive = false;
    }

    const { status, pingMs } = meterFromStatus(device.status, alive, avgMs, thresholds);
    const cpu = alive ? Math.max(10, Math.min(99, (device.cpu || 30) + Math.round(Math.random() * 10 - 5))) : 0;
    const mem = alive ? Math.max(10, Math.min(99, (device.mem || 40) + Math.round(Math.random() * 6 - 3))) : 0;
    const finalStatus = alive && (cpu > thresholds.cpu || mem > thresholds.mem) ? 'warning' : status;

    // Aturan jam malam: perangkat NON-SERVER yang offline pada 20:00–06:00 dianggap
    // "dimatikan" (bukan alarm). Jika masih offline ≥06:00 → alarm/insiden seperti biasa.
    // Server selalu dialarmkan kapan pun offline.
    const hour = new Date().getHours();
    const isServer = /server/i.test(device.type || '');
    // Override manual ("Alarmkan") membatalkan kategori dimatikan. Reset saat perangkat online lagi.
    const override = alive ? 0 : device.alarm_override;
    const dimatikanWindow = !isServer && (hour >= 20 || hour < 6) && !override;
    const offReason = finalStatus === 'offline' && dimatikanWindow ? 'dimatikan' : null;

    await pool.query(
      'UPDATE devices SET status=?, off_reason=?, alarm_override=?, ping_ms=?, cpu=?, mem=?, last_checked_at=NOW() WHERE id=?',
      [finalStatus, offReason, override, pingMs, cpu, mem, device.id]
    );

    const updated = { ...device, status: finalStatus, off_reason: offReason, alarm_override: override, ping_ms: pingMs, cpu, mem };
    io?.emit('device:update', updated);

    // Setiap perangkat yang OFFLINE & belum punya insiden aktif → otomatis
    // dibuatkan insiden ke POOL, lalu notifikasi ke teknisi on-duty. Dengan
    // begitu insiden muncul di dashboard teknisi on-duty (pool) & koordinator.
    // Hanya buat insiden bila bukan kategori "dimatikan" (jam malam, non-server).
    if (finalStatus === 'offline' && !offReason) {
      const conn = await pool.getConnection();
      try {
        const [existing] = await conn.query(
          "SELECT id FROM incidents WHERE device_id = ? AND status != 'selesai' LIMIT 1",
          [device.id]
        );
        if (!existing.length) {
          const id = await nextIncidentId(conn);
          const issue = 'Perangkat tidak merespons - deteksi otomatis';
          await conn.query(
            `INSERT INTO incidents (id, device_id, device_name, ip, issue, priority, tech_id, status, step, source)
             VALUES (?, ?, ?, ?, ?, 'kritis', NULL, 'aktif', 0, 'auto')`,
            [id, device.id, device.name, device.ip, issue]
          );
          await conn.query('INSERT INTO incident_notes (incident_id, step, note) VALUES (?, 0, ?)', [
            id, 'Deteksi otomatis: perangkat offline.',
          ]);
          const n = await snapshotAndNotifyOnDuty(conn, { id, priority: 'kritis', deviceName: device.name, issue });
          await conn.query('INSERT INTO incident_notes (incident_id, step, note) VALUES (?, 0, ?)', [
            id, n ? `Notifikasi dikirim ke ${n} teknisi on-duty.` : 'Tidak ada teknisi on-duty — insiden menunggu di pool.',
          ]);
          io?.emit('incident:new', { id, device: device.name });
        }
      } finally {
        conn.release();
      }
    }
  }

  // Setelah semua perangkat diperbarui, kirim status layanan kritis terbaru
  // ke semua klien (kartu Monitoring Layanan Kritis update real-time).
  try {
    io?.emit('services:update', await computeServices());
  } catch { /* abaikan */ }
}
