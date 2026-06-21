import { Worker } from 'bullmq';
import { redisConnection } from './queueConnection.js';
import { pool } from '../db/pool.js';
import { sendFonnteMessage } from '../services/fonnteService.js';

export function startWaWorker(io) {
  const worker = new Worker(
    'wa-notifications',
    async (job) => {
      const { waLogId, phone, message } = job.data;
      // Idempoten: bila job di-retry setelah pengiriman sukses (mis. ack gagal),
      // jangan kirim ulang ke Fonnte.
      const [cur] = await pool.query('SELECT status FROM wa_log WHERE id = ?', [waLogId]);
      if (!cur[0]) return { ok: false, missing: true };
      if (cur[0].status === 'sent') return { ok: true, skipped: true };
      await pool.query('UPDATE wa_log SET attempts = attempts + 1 WHERE id = ?', [waLogId]);
      await sendFonnteMessage(phone, message);
      await pool.query("UPDATE wa_log SET status='sent', sent_at=NOW(), error=NULL WHERE id=?", [waLogId]);
      const [rows] = await pool.query('SELECT * FROM wa_log WHERE id = ?', [waLogId]);
      io?.emit('wa:sent', rows[0]);
      return { ok: true };
    },
    { connection: redisConnection, concurrency: 3 }
  );

  worker.on('failed', async (job, err) => {
    if (!job) return;
    const { waLogId } = job.data;
    await pool.query("UPDATE wa_log SET status='failed', error=? WHERE id=?", [err.message, waLogId]);
    const [rows] = await pool.query('SELECT * FROM wa_log WHERE id = ?', [waLogId]);
    io?.emit('wa:failed', rows[0]);
  });

  return worker;
}
