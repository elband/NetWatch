import { Queue, Worker } from 'bullmq';
import { redisConnection } from './queueConnection.js';
import { pool } from '../db/pool.js';
import { env } from '../config/env.js';
import { logger } from '../config/logger.js';

// =============================================================================
// metricsQueue — pemeliharaan riwayat metrik:
//   1) rollup harian device_metrics → device_uptime_daily (sumber laporan SLA),
//   2) retensi: pangkas device_metrics mentah yang melewati batas hari.
// Dijadwalkan harian 00:10 (setelah hari berganti) + dipanggil sekali saat start.
// =============================================================================

export const metricsQueue = new Queue('metrics-maintenance', { connection: redisConnection });

export async function scheduleMetricsMaintenance() {
  await metricsQueue.add(
    'rollup-and-purge',
    {},
    {
      repeat: { pattern: '10 0 * * *' }, // 00:10 setiap hari (TZ proses)
      jobId: 'recurring-metrics-maintenance',
      removeOnComplete: true,
      removeOnFail: { count: 30 },
    }
  );
}

async function getRetentionDays() {
  const [rows] = await pool.query(
    "SELECT setting_value FROM settings WHERE setting_key = 'metrics_retention_days'"
  );
  if (!rows.length) return 14;
  try {
    const v = typeof rows[0].setting_value === 'string' ? JSON.parse(rows[0].setting_value) : rows[0].setting_value;
    const n = Number(v);
    return Number.isFinite(n) && n >= 1 ? Math.floor(n) : 14;
  } catch { return 14; }
}

// Hitung rollup harian untuk rentang [fromDate, toDate) — default: kemarin & hari ini.
// Idempotent (ON DUPLICATE KEY UPDATE) sehingga aman dijalankan ulang.
export async function rollupUptimeDaily(days = 2) {
  const intervalSec = Math.max(1, Math.round((env.pingIntervalMs || 15000) / 1000));
  const [res] = await pool.query(
    `INSERT INTO device_uptime_daily
       (device_id, day, samples, up_samples, warn_samples, down_samples, maint_samples, avg_ping, max_ping, down_seconds)
     SELECT device_id, DATE(recorded_at) AS day,
            COUNT(*),
            SUM(status='online'),
            SUM(status='warning'),
            SUM(status='offline' AND in_maint=0),
            SUM(in_maint=1),
            ROUND(AVG(ping_ms)),
            MAX(ping_ms),
            SUM(status='offline' AND in_maint=0) * ?
       FROM device_metrics
      WHERE recorded_at >= (CURDATE() - INTERVAL ? DAY)
      GROUP BY device_id, DATE(recorded_at)
     ON DUPLICATE KEY UPDATE
       samples=VALUES(samples), up_samples=VALUES(up_samples), warn_samples=VALUES(warn_samples),
       down_samples=VALUES(down_samples), maint_samples=VALUES(maint_samples),
       avg_ping=VALUES(avg_ping), max_ping=VALUES(max_ping), down_seconds=VALUES(down_seconds)`,
    [intervalSec, days]
  );
  return res.affectedRows || 0;
}

export async function purgeOldDeviceMetrics() {
  const days = await getRetentionDays();
  const [res] = await pool.query(
    'DELETE FROM device_metrics WHERE recorded_at < (NOW() - INTERVAL ? DAY)',
    [days]
  );
  return res.affectedRows || 0;
}

export async function runMetricsMaintenance() {
  const rolled = await rollupUptimeDaily(2);
  const purged = await purgeOldDeviceMetrics();
  return { rolled, purged };
}

export function startMetricsWorker() {
  const worker = new Worker(
    'metrics-maintenance',
    async () => {
      const result = await runMetricsMaintenance();
      logger.info(result, '[metrics] rollup & retensi selesai');
      return result;
    },
    { connection: redisConnection, concurrency: 1 }
  );
  worker.on('failed', (job, err) => logger.error({ err: err?.message }, '[metrics] gagal'));
  worker.on('error', (err) => logger.error({ err: err?.message }, '[metrics] error'));
  return worker;
}
