import { Queue, Worker } from 'bullmq';
import { redisConnection } from './queueConnection.js';
import { pool } from '../db/pool.js';
import { queueWaNotification } from './waQueue.js';
import { logger } from '../config/logger.js';
import { isNotifyEnabledForUser } from '../services/notifyPrefs.js';

const inUnit = (rowUnit, userUnit) => rowUnit == null || userUnit == null || Number(rowUnit) === Number(userUnit);

// Pengingat WA sore hari: peralatan yang tercatat DIHIDUPKAN hari ini tapi belum ada
// catatan "dimatikan" → kirim HANYA ke KOORDINATOR (pengawas) agar dipastikan dicatat
// power-off (logbook lengkap: tiap hidup punya pasangan mati). Teknisi tidak dikirimi.
export const poweroffReminderQueue = new Queue('poweroff-reminder', { connection: redisConnection });

export async function schedulePoweroffReminder() {
  await poweroffReminderQueue.add(
    'remind',
    {},
    {
      // Jam 19:00 setiap hari (akhir operasional), mengikuti TZ proses (config/env.js).
      repeat: { pattern: '0 19 * * *' },
      jobId: 'recurring-poweroff-reminder',
      attempts: 2,
      backoff: { type: 'fixed', delay: 5000 },
      removeOnComplete: true,
      removeOnFail: { count: 50 },
    }
  );
}

// Perangkat yang HARI INI dihidupkan tapi belum dimatikan (tidak termasuk yang
// ditandai selalu aktif 24 jam). Kembalikan baris {id, name, loc, unit_id}.
// Log append-only: bisa ada beberapa siklus on/off sehari — yang menentukan status
// terkini adalah entri power TERBARU hari ini. Ingatkan bila state terakhir = 'on'.
export async function pendingPoweroffDevices() {
  const [rows] = await pool.query(
    `SELECT d.id, d.name, d.loc, d.unit_id
       FROM devices d
      WHERE d.always_on = 0
        AND (
          SELECT ep.state FROM equipment_poweron ep
           WHERE ep.device_id = d.id AND ep.on_date = CURDATE()
           ORDER BY ep.created_at DESC, ep.id DESC LIMIT 1
        ) = 'on'
      ORDER BY d.name ASC`
  );
  return rows;
}

// Dipanggil worker (dan bisa manual/test) — query + kirim WA.
export async function sendPoweroffReminders() {
  const pending = await pendingPoweroffDevices();
  if (pending.length === 0) return { sent: 0, devices: 0, coordinators: 0 };

  // HANYA koordinator (pengawas) per unit yang menerima pengingat — teknisi tidak dikirimi.
  const [coords] = await pool.query(
    `SELECT id, unit_id FROM users
      WHERE (role = 'koordinator' OR JSON_CONTAINS(roles, '"koordinator"'))
        AND phone IS NOT NULL AND phone <> ''`
  );

  const buildMessage = (rows) =>
    `Pengingat: Catat Mematikan Peralatan\n\n` +
    `Peralatan berikut tercatat DIHIDUPKAN hari ini tapi belum ada catatan "dimatikan":\n` +
    rows.map((d) => `- ${d.name}${d.loc ? ` (${d.loc})` : ''}`).join('\n') +
    `\n\nMohon pastikan teknisi mencatat mematikan lewat menu Peralatan → tombol Matikan (wajib foto), atau catat sendiri sebagai pengawas. ` +
    `Bila peralatan memang beroperasi 24 jam, tandai "Selalu aktif" di Master Data. Terima kasih.`;

  let sent = 0;
  const notify = async (userId, rows) => {
    if (!rows.length) return;
    if (!(await isNotifyEnabledForUser('peralatan_matikan_reminder', userId))) return;
    try { await queueWaNotification({ type: 'other', toUserId: userId, message: buildMessage(rows) }); sent += 1; }
    catch (err) { logger.error({ err: err?.message, userId }, '[poweroffReminder] gagal queue WA'); }
  };

  for (const c of coords) await notify(c.id, pending.filter((d) => inUnit(d.unit_id, c.unit_id)));

  return { sent, devices: pending.length, coordinators: coords.length };
}

export function startPoweroffReminderWorker() {
  const worker = new Worker(
    'poweroff-reminder',
    async () => {
      const result = await sendPoweroffReminders();
      logger.info(result, '[poweroffReminder] selesai');
      return result;
    },
    { connection: redisConnection, concurrency: 1 }
  );
  worker.on('failed', (job, err) => logger.error({ err: err?.message }, '[poweroffReminder] gagal'));
  worker.on('error', (err) => logger.error({ err: err?.message }, '[poweroffReminder] error'));
  return worker;
}
