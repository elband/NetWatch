import { pool } from '../db/pool.js';
import { snapshotAndNotifyOnDuty } from '../controllers/incidentController.js';
import { computeServices } from './servicesStatus.js';
import { probeDevice } from './monitorProbe.js';
import { loadActiveMaintenance } from './maintenanceService.js';

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
  for (const r of rows) {
    try { map[r.setting_key] = typeof r.setting_value === 'string' ? JSON.parse(r.setting_value) : r.setting_value; }
    catch { map[r.setting_key] = r.setting_value; }
  }
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
  const maint = await loadActiveMaintenance();
  const [devices] = await pool.query('SELECT * FROM devices');

  // Kumpulan baris metrik time-series untuk satu sweep → satu bulk insert di akhir.
  const metricRows = [];

  for (const device of devices) {
    // Perangkat tanpa IP (ip diawali "N/A") tidak bisa di-ping dan tidak boleh
    // dideteksi otomatis offline/insiden. Tiket untuk perangkat ini hanya aktif
    // lewat aduan publik (lapor), bukan deteksi sistem.
    if (!device.ip || device.ip.startsWith('N/A')) continue;
    // Mode standby (monitor_enabled=0): perangkat sengaja dijeda dari monitoring otomatis.
    if (!device.monitor_enabled) continue;

    // Probe sesuai check_type (ping/tcp/http) + pengayaan SNMP bila aktif.
    const probe = await probeDevice(device);
    const alive = probe.alive;
    const avgMs = probe.avgMs;

    const { status, pingMs } = meterFromStatus(device.status, alive, avgMs, thresholds);
    // CPU/mem riil dari SNMP bila tersedia; jika tidak, pertahankan nilai terakhir
    // (bukan acak) agar tidak menimbulkan warning palsu. 0 saat perangkat mati.
    const cpu = alive ? (probe.cpu ?? device.cpu ?? 0) : 0;
    const mem = alive ? (probe.mem ?? device.mem ?? 0) : 0;
    const finalStatus = alive && (cpu > thresholds.cpu || mem > thresholds.mem) ? 'warning' : status;
    const underMaint = maint.isUnder(device);

    // Aturan jam malam: perangkat NON-SERVER yang offline pada 20:00–06:00 dianggap
    // "dimatikan" (bukan alarm). Jika masih offline ≥06:00 → alarm/insiden seperti biasa.
    // Server selalu dialarmkan kapan pun offline.
    const hour = new Date().getHours();
    const isServer = /server/i.test(device.type || '');
    // Override manual ("Alarmkan") membatalkan kategori dimatikan. Reset saat perangkat online lagi.
    const override = alive ? 0 : device.alarm_override;
    const dimatikanWindow = !isServer && (hour >= 20 || hour < 6) && !override;
    let offReason = finalStatus === 'offline' && dimatikanWindow ? 'dimatikan' : null;
    // Jendela maintenance terjadwal menang atas alarm: tandai "maintenance" agar
    // tidak memicu insiden (guard `!offReason` di bawah) & tampil jelas di UI.
    if (underMaint && finalStatus !== 'online') offReason = 'maintenance';

    await pool.query(
      'UPDATE devices SET status=?, off_reason=?, alarm_override=?, ping_ms=?, cpu=?, mem=?, last_checked_at=NOW() WHERE id=?',
      [finalStatus, offReason, override, pingMs, cpu, mem, device.id]
    );

    // Rekam metrik time-series (bulk insert setelah loop).
    metricRows.push([device.id, finalStatus, pingMs, probe.cpu, probe.mem, underMaint ? 1 : 0]);

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

    // Pemulihan otomatis: perangkat kembali ONLINE → tutup insiden yang dibuat
    // OTOMATIS oleh sistem (source='auto') yang masih MENGGANTUNG DI POOL
    // (tech_id IS NULL). Insiden yang sudah diambil teknisi, insiden manual, atau
    // aduan publik TIDAK ikut ditutup — itu harus diselesaikan teknisi dengan
    // dokumentasi. Mencegah insiden palsu (mis. false-offline) menumpuk.
    if (finalStatus === 'online') {
      try {
        const [openAuto] = await pool.query(
          "SELECT id FROM incidents WHERE device_id=? AND source='auto' AND status<>'selesai' AND tech_id IS NULL",
          [device.id]
        );
        for (const inc of openAuto) {
          await pool.query(
            `UPDATE incidents SET status='selesai', step=2, resolved_at=NOW(),
               duration_min=GREATEST(1, TIMESTAMPDIFF(MINUTE, created_at, NOW())) WHERE id=?`,
            [inc.id]
          );
          await pool.query('INSERT INTO incident_notes (incident_id, step, note) VALUES (?, 2, ?)', [
            inc.id, 'Perangkat kembali online — insiden deteksi otomatis ditutup oleh sistem.',
          ]);
          io?.emit('incident:update', { id: inc.id, device: device.name, status: 'selesai' });
        }
      } catch { /* jangan ganggu sweep bila gagal menutup insiden */ }
    }
  }

  // Bulk insert riwayat metrik (satu query untuk seluruh perangkat).
  if (metricRows.length) {
    try {
      await pool.query(
        'INSERT INTO device_metrics (device_id, status, ping_ms, cpu, mem, in_maint) VALUES ?',
        [metricRows]
      );
    } catch { /* jangan ganggu sweep bila tabel metrik bermasalah */ }
  }

  // Setelah semua perangkat diperbarui, kirim status layanan kritis terbaru
  // ke semua klien (kartu Monitoring Layanan Kritis update real-time).
  try {
    io?.emit('services:update', await computeServices());
  } catch { /* abaikan */ }
}
