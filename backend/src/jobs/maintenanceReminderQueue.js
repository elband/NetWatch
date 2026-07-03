import { Queue, Worker } from 'bullmq';
import { redisConnection } from './queueConnection.js';
import { pool } from '../db/pool.js';
import { queueWaNotification } from './waQueue.js';
import { logger } from '../config/logger.js';
import { isNotifyEnabledForUser } from '../services/notifyPrefs.js';
import { computeDuePlans } from '../controllers/assetOpsController.js';
import { computeLowStock } from '../controllers/sparepartController.js';

const inUnit = (rowUnit, userUnit) => rowUnit == null || userUnit == null || Number(rowUnit) === Number(userUnit);

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

  // Fase 3: preventive maintenance aset (interval jam/kalender) yang jatuh tempo, semua unit.
  const duePm = await computeDuePlans(null).catch(() => []);
  // Fase 4: sparepart stok menipis (<= min), semua unit.
  const lowStock = await computeLowStock(null).catch(() => []);

  if (maint.length === 0 && duePm.length === 0 && lowStock.length === 0) return { sent: 0, technicians: 0, pmDue: 0, lowStock: 0 };

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
  // Koordinator per unit (penerima reminder PM walau tidak dinas).
  const [coords] = await pool.query(
    `SELECT id, unit_id FROM users
      WHERE (role = 'koordinator' OR JSON_CONTAINS(roles, '"koordinator"'))
        AND phone IS NOT NULL AND phone <> ''`
  );

  // Multi-unit: tiap penerima hanya menerima daftar unitnya sendiri
  // (baris lama tanpa unit dianggap milik semua unit agar tidak terlewat).
  const buildMessage = (rows) =>
    `Pengingat Maintenance Peralatan - Hari Ini\n\n` +
    `Berikut rencana maintenance peralatan yang dijadwalkan hari ini:\n` +
    rows.map((m) => `- ${m.device_name}${m.device_loc ? ` (${m.device_loc})` : ''}: ${m.task}`).join('\n') +
    `\n\nSilakan koordinasi pelaksanaan dengan tim. Terima kasih.`;
  const buildPmMessage = (rows) =>
    `Preventive Maintenance - Jatuh Tempo\n\n` +
    `Aset berikut telah mencapai jadwal preventive maintenance:\n` +
    rows.map((d) => {
      const s = d.status || {};
      const det = s.kind === 'hours' ? ` (${Math.round(s.current)} jam, tiap ${Math.round(s.interval)} jam)` : (s.due_date ? ` (jatuh tempo ${s.due_date})` : '');
      return `- ${d.asset_name}${d.asset_loc ? ` (${d.asset_loc})` : ''}: ${d.name}${det}`;
    }).join('\n') +
    `\n\nSegera jadwalkan pelaksanaan & catat penyelesaiannya di aplikasi. Terima kasih.`;

  let sent = 0;
  const notify = async (userId, message) => {
    if (!(await isNotifyEnabledForUser('maintenance_reminder', userId))) return;
    try { await queueWaNotification({ type: 'other', toUserId: userId, message }); sent += 1; }
    catch (err) { logger.error({ err: err?.message, userId }, '[maintenanceReminder] gagal queue WA'); }
  };

  // Teknisi on-duty: maintenance + PM jatuh tempo unitnya.
  for (const t of techs) {
    const mRows = maint.filter((m) => inUnit(m.unit_id, t.unit_id));
    const pRows = duePm.filter((d) => inUnit(d.unit_id, t.unit_id));
    if (!mRows.length && !pRows.length) continue;
    const parts = [mRows.length ? buildMessage(mRows) : null, pRows.length ? buildPmMessage(pRows) : null].filter(Boolean);
    await notify(t.id, parts.join('\n\n'));
  }
  const buildLowStockMessage = (rows) =>
    `Stok Sparepart Menipis\n\n` +
    `Sparepart berikut sudah mencapai/di bawah stok minimum:\n` +
    rows.map((s) => `- ${s.name}${s.part_no ? ` (${s.part_no})` : ''}: sisa ${Number(s.stock_qty)} / min ${Number(s.min_qty)} ${s.satuan}`).join('\n') +
    `\n\nSegera ajukan pengadaan. Terima kasih.`;

  // Koordinator: PM jatuh tempo + stok menipis unitnya (maintenance harian tetap ke teknisi).
  for (const c of coords) {
    const pRows = duePm.filter((d) => inUnit(d.unit_id, c.unit_id));
    const sRows = lowStock.filter((s) => inUnit(s.unit_id, c.unit_id));
    if (!pRows.length && !sRows.length) continue;
    const parts = [pRows.length ? buildPmMessage(pRows) : null, sRows.length ? buildLowStockMessage(sRows) : null].filter(Boolean);
    await notify(c.id, parts.join('\n\n'));
  }

  return { sent, technicians: techs.length, pmDue: duePm.length, lowStock: lowStock.length };
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
