import { pool } from '../db/pool.js';
import { snapshotAndNotifyOnDuty, notifyAutoResolved } from '../controllers/incidentController.js';
import { computeServices } from './servicesStatus.js';
import { probeDevice } from './monitorProbe.js';
import { loadActiveMaintenance } from './maintenanceService.js';
import { logger } from '../config/logger.js';
import { nextIncidentId } from '../utils/incidentId.js';

// Step final insiden (selaras dengan incidentController.FINAL_STEP).
const FINAL_STEP = 2;

function meterFromStatus(prevStatus, alive, avgMs, thresholds) {
  if (!alive) return { status: 'offline', pingMs: 0 };
  const pingMs = Math.round(avgMs || 0);
  if (pingMs > thresholds.pingTimeoutMs) return { status: 'warning', pingMs };
  return { status: 'online', pingMs };
}

async function getThresholds() {
  const [rows] = await pool.query(
    "SELECT setting_key, setting_value FROM settings WHERE setting_key IN ('threshold_ping_timeout_ms','threshold_cpu','threshold_mem','auto_resolve_stable_sec','auto_detect_offline_sec')"
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
    // Lama perangkat harus stabil ONLINE (detik) sebelum insiden auto-otomatis
    // ditutup. Default 300 dtk (5 menit). 0 = tutup begitu online (lama).
    autoResolveStableSec: map.auto_resolve_stable_sec ?? 300,
    // Lama perangkat harus terus OFFLINE (detik) sebelum tiket otomatis dibuat
    // (debounce anti-flapping). Default 120 dtk (2 menit). 0 = buat tiket seketika.
    autoDetectOfflineSec: map.auto_detect_offline_sec ?? 120,
  };
}

// Tutup insiden otomatis (source='auto') setelah perangkat terbukti pulih & stabil.
// Mencatat timeline, resolved_by=SYSTEM, resolution_type=AUTO, waktu pulih
// (recovered_at), durasi downtime, lalu notifikasi koordinator & teknisi.
async function autoResolveIncident(io, device, inc, stableSec) {
  const conn = await pool.getConnection();
  try {
    // Downtime dihitung sampai WAKTU PULIH (auto_recovery_since), bukan saat ini,
    // agar durasi mencerminkan lama perangkat benar-benar terputus.
    const [r] = await conn.query(
      `UPDATE incidents SET status='selesai', step=?, resolved_at=NOW(),
         recovered_at=COALESCE(auto_recovery_since, NOW()),
         resolved_by='SYSTEM', resolution_type='AUTO',
         duration_min=GREATEST(1, TIMESTAMPDIFF(MINUTE, created_at, COALESCE(auto_recovery_since, NOW())))
       WHERE id=? AND status<>'selesai'`,
      [FINAL_STEP, inc.id]
    );
    if (!r.affectedRows) return; // sudah ditutup proses lain → hindari notif ganda
    const [[fresh]] = await conn.query('SELECT * FROM incidents WHERE id=?', [inc.id]);
    const dur = fresh?.duration_min || 0;
    const stableMin = Math.round(stableSec / 60);
    const recovTxt = fresh?.recovered_at ? new Date(fresh.recovered_at).toLocaleString('id-ID') : '-';
    await conn.query('INSERT INTO incident_notes (incident_id, step, note) VALUES (?, ?, ?)', [
      inc.id, FINAL_STEP,
      `🤖 Auto-Resolved oleh SISTEM. Perangkat "${device.name}" kembali ONLINE & stabil ≥ ${stableMin} mnt tanpa flapping. Waktu pulih: ${recovTxt}. Total downtime: ${Math.floor(dur / 60)}j ${dur % 60}m.`,
    ]);
    await notifyAutoResolved(conn, fresh, { durationMin: dur, stableMin, recoveredAt: fresh?.recovered_at });
    io?.emit('incident:update', { id: inc.id, device: device.name, status: 'selesai', resolution_type: 'AUTO' });
    io?.emit('incident:resolved', { id: inc.id, device: device.name, auto: true });
  } finally {
    conn.release();
  }
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
    // (bukan acak) hanya untuk tampilan. 0 saat perangkat mati.
    const cpu = alive ? (probe.cpu ?? device.cpu ?? 0) : 0;
    const mem = alive ? (probe.mem ?? device.mem ?? 0) : 0;
    // Warning CPU/mem HANYA saat ada pembacaan SNMP NYATA pada sweep ini (probe.cpu/probe.mem),
    // bukan dari nilai lama tersimpan — cegah "warning palsu" untuk perangkat tanpa SNMP
    // (mis. AP ping 1ms tapi punya nilai cpu/mem basi > ambang → terus ditandai warning).
    const overload = (probe.cpu != null && probe.cpu > thresholds.cpu) || (probe.mem != null && probe.mem > thresholds.mem);
    const finalStatus = alive && overload ? 'warning' : status;
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

    // Lacak kapan perangkat MULAI offline (offline_since): set saat offline pertama,
    // pertahankan selama masih offline, kosongkan saat tidak offline lagi. Dipakai
    // sebagai debounce "offline stabil X waktu" sebelum tiket otomatis dibuat.
    await pool.query(
      `UPDATE devices SET status=?, off_reason=?, alarm_override=?, ping_ms=?, cpu=?, mem=?,
         offline_since = CASE WHEN ?='offline' THEN COALESCE(offline_since, NOW()) ELSE NULL END,
         last_checked_at=NOW() WHERE id=?`,
      [finalStatus, offReason, override, pingMs, cpu, mem, finalStatus, device.id]
    );

    // Rekam metrik time-series (bulk insert setelah loop).
    metricRows.push([device.id, finalStatus, pingMs, probe.cpu, probe.mem, underMaint ? 1 : 0]);

    const updated = { ...device, status: finalStatus, off_reason: offReason, alarm_override: override, ping_ms: pingMs, cpu, mem };
    io?.emit('device:update', updated);

    // Debounce auto-deteksi: berapa lama perangkat ini SUDAH terus-menerus offline
    // (berdasarkan offline_since SEBELUM sweep ini). Pada sweep offline pertama nilainya
    // null → 0 dtk → belum dibuat tiket (memberi waktu perangkat yang cuma flap pulih).
    const offlineSec = device.offline_since ? (Date.now() - new Date(device.offline_since).getTime()) / 1000 : 0;

    // Perangkat yang OFFLINE STABIL (≥ ambang) & belum punya insiden aktif → otomatis
    // dibuatkan insiden ke POOL, lalu notifikasi ke teknisi on-duty. Dengan begitu
    // insiden muncul di dashboard teknisi on-duty (pool) & koordinator. Tidak dibuat
    // bila kategori "dimatikan"/maintenance, atau belum cukup lama offline (anti-flap).
    if (finalStatus === 'offline' && !offReason && offlineSec >= thresholds.autoDetectOfflineSec) {
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
            `INSERT INTO incidents (id, device_id, device_name, ip, issue, priority, tech_id, status, step, source, unit_id)
             VALUES (?, ?, ?, ?, ?, 'kritis', NULL, 'aktif', 0, 'auto', ?)`,
            [id, device.id, device.name, device.ip, issue, device.unit_id ?? null]
          );
          const sinceTxt = device.offline_since ? ` sejak ${new Date(device.offline_since).toLocaleString('id-ID')}` : '';
          const stabilMnt = Math.round(thresholds.autoDetectOfflineSec / 60);
          await conn.query('INSERT INTO incident_notes (incident_id, step, note) VALUES (?, 0, ?)', [
            id, `Deteksi otomatis: perangkat OFFLINE stabil${thresholds.autoDetectOfflineSec ? ` ≥ ${stabilMnt} mnt` : ''}${sinceTxt} (lolos debounce anti-flapping).`,
          ]);
          const n = await snapshotAndNotifyOnDuty(conn, { id, priority: 'kritis', deviceName: device.name, issue });
          await conn.query('INSERT INTO incident_notes (incident_id, step, note) VALUES (?, 0, ?)', [
            id, n ? `Notifikasi dikirim ke ${n} teknisi on-duty.` : 'Tidak ada teknisi on-duty — insiden menunggu di pool.',
          ]);
          io?.emit('incident:new', { id, device: device.name });
        }
      } catch (e) {
        // Kegagalan membuat insiden untuk SATU perangkat tidak boleh menjatuhkan
        // seluruh sweep (perangkat lain harus tetap dipantau). Catat & lanjut.
        logger.error({ err: e?.message || String(e), deviceId: device.id }, '[pingSweep] gagal membuat insiden otomatis');
      } finally {
        conn.release();
      }
    }

    // === Auto-Resolve berbasis stabilitas (anti-flapping) ====================
    // Insiden offline yang dibuat OTOMATIS (source='auto') hanya ditutup setelah
    // perangkat terbukti ONLINE & STABIL selama `autoResolveStableSec`. Jendela
    // validasi dilacak di kolom auto_recovery_since:
    //   • Online pertama kali sejak insiden → set auto_recovery_since = sekarang.
    //   • Tetap online sampai ambang batas terlampaui → AUTO-RESOLVE.
    //   • Tidak online (offline/warning) saat validasi → reset (batalkan), tiket
    //     tetap aktif. Ini mencegah perangkat yang flapping ditutup prematur.
    // Insiden manual / aduan publik tidak tersentuh (bukan source='auto').
    try {
      const [autoIncs] = await pool.query(
        "SELECT id, auto_recovery_since FROM incidents WHERE device_id=? AND source='auto' AND status<>'selesai'",
        [device.id]
      );
      if (autoIncs.length) {
        if (finalStatus !== 'online') {
          // Batalkan validasi yang sedang berjalan (perangkat tidak stabil/flapping).
          const active = autoIncs.filter((i) => i.auto_recovery_since);
          if (active.length) {
            await pool.query(
              "UPDATE incidents SET auto_recovery_since=NULL WHERE device_id=? AND source='auto' AND status<>'selesai'",
              [device.id]
            );
            for (const i of active) {
              await pool.query('INSERT INTO incident_notes (incident_id, step, note) VALUES (?, 0, ?)', [
                i.id, `Auto-resolve dibatalkan: perangkat kembali tidak stabil (${finalStatus}) saat masa validasi. Tiket tetap aktif.`,
              ]);
              io?.emit('incident:update', { id: i.id, device: device.name });
            }
          }
        } else {
          const stableSec = thresholds.autoResolveStableSec;
          for (const inc of autoIncs) {
            if (!inc.auto_recovery_since) {
              // Mulai jendela validasi pemulihan.
              await pool.query('UPDATE incidents SET auto_recovery_since=NOW() WHERE id=? AND auto_recovery_since IS NULL', [inc.id]);
              io?.emit('incident:update', { id: inc.id, device: device.name });
              continue;
            }
            const elapsedSec = (Date.now() - new Date(inc.auto_recovery_since).getTime()) / 1000;
            if (elapsedSec >= stableSec) await autoResolveIncident(io, device, inc, stableSec);
          }
        }
      }
    } catch { /* jangan ganggu sweep bila proses auto-resolve gagal */ }
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
