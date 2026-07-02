import { Queue, Worker } from 'bullmq';
import { redisConnection } from './queueConnection.js';
import { pool } from '../db/pool.js';
import { queueWaNotification } from './waQueue.js';
import { logger } from '../config/logger.js';
import { isNotifyEnabledForUser } from '../services/notifyPrefs.js';

// Pengingat WA harian utk teknisi yang dinas hari ini ttg maintenance peralatan terjadwal.
export const maintenanceReminderQueue = new Queue('maintenance-reminder', { connection: redisConnection });

export async function scheduleMaintenanceReminder() {
  await maintenanceReminderQueue.add(
    'remind',
    {},
    {
      // Jam 08:00 setiap hari, mengikuti TZ proses (process.env.TZ, lihat config/env.js).
      repeat: { pattern: '0 8 * * *' },
      jobId: 'recurring-maintenance-reminder',
      attempts: 2,
      backoff: { type: 'fixed', delay: 5000 },
      removeOnComplete: true,
      removeOnFail: { count: 50 },
    }
  );
}

// Dipanggil oleh worker (dan bisa dipanggil manual/test) — query + kirim WA.
export async function sendDailyMaintenanceReminders() {
  const [maint] = await pool.query(
    `SELECT em.id, em.scheduled_date, em.task, em.status, em.unit_id, d.name AS device_name, d.loc AS device_loc
     FROM equipment_maintenance em
     JOIN devices d ON d.id = em.device_id
     WHERE em.scheduled_date = CURDATE() AND em.status = 'rencana'
     ORDER BY d.name ASC`
  );

  if (maint.length === 0) return { sent: 0, technicians: 0 };

  // Teknisi yang dinas hari ini (bukan libur/cuti/dinas_luar).
  const [techs] = await pool.query(
    `SELECT u.id, u.unit_id
     FROM users u
     JOIN shifts s ON s.user_id = u.id
     WHERE s.shift_date = CURDATE()
       AND s.shift_type IN ('pagi', 'siang', 'malam')
       AND (u.role = 'teknisi' OR JSON_CONTAINS(u.roles, '"teknisi"'))
       AND u.phone IS NOT NULL AND u.phone <> ''`
  );

  // Multi-unit: tiap teknisi hanya menerima daftar maintenance unitnya sendiri
  // (baris lama tanpa unit dianggap milik semua unit agar tidak terlewat).
  const buildMessage = (rows) =>
    `Pengingat Maintenance Peralatan - Hari Ini\n\n` +
    `Berikut rencana maintenance peralatan yang dijadwalkan hari ini:\n` +
    rows.map((m) => `- ${m.device_name}${m.device_loc ? ` (${m.device_loc})` : ''}: ${m.task}`).join('\n') +
    `\n\nSilakan koordinasi pelaksanaan dengan tim. Terima kasih.`;

  let sent = 0;
  for (const t of techs) {
    const rows = maint.filter((m) => m.unit_id == null || t.unit_id == null || Number(m.unit_id) === Number(t.unit_id));
    if (!rows.length) continue;
    if (!(await isNotifyEnabledForUser('maintenance_reminder', t.id))) continue;
    try {
      await queueWaNotification({ type: 'other', toUserId: t.id, message: buildMessage(rows) });
      sent += 1;
    } catch (err) {
      logger.error({ err: err?.message, userId: t.id }, '[maintenanceReminder] gagal queue WA');
    }
  }

  return { sent, technicians: techs.length };
}

export function startMaintenanceReminderWorker() {
  const worker = new Worker(
    'maintenance-reminder',
    async () => {
      const result = await sendDailyMaintenanceReminders();
      logger.info(result, '[maintenanceReminder] selesai');
      return result;
    },
    { connection: redisConnection, concurrency: 1 }
  );
  worker.on('failed', (job, err) => logger.error({ err: err?.message }, '[maintenanceReminder] gagal'));
  worker.on('error', (err) => logger.error({ err: err?.message }, '[maintenanceReminder] error'));
  return worker;
}
