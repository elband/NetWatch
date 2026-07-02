import { Queue } from 'bullmq';
import { redisConnection } from './queueConnection.js';
import { pool } from '../db/pool.js';
import { maskPhone } from '../utils/privacy.js';

export const waQueue = new Queue('wa-notifications', { connection: redisConnection });

const JOB_OPTS = { attempts: 5, backoff: { type: 'exponential', delay: 5000 }, removeOnComplete: { age: 3600 }, removeOnFail: { age: 86400 } };

export async function queueWaNotification({ type, toUserId, message, relatedIncidentId }) {
  const [rows] = await pool.query('SELECT name, role, phone, unit_id FROM users WHERE id = ?', [toUserId]);
  const user = rows[0];
  const toLabel = user ? `${user.name} (${user.role})` : `User #${toUserId}`;
  const phone = user?.phone || null;

  // Simpan nomor TER-MASK di DB; nomor asli hanya ada di payload job untuk pengiriman.
  // unit_id log mengikuti unit penerima (filter Log WA per unit; NULL = global/super admin).
  const [result] = await pool.query(
    `INSERT INTO wa_log (type, to_user_id, to_label, phone, message, status, related_incident_id, unit_id)
     VALUES (?, ?, ?, ?, ?, 'pending', ?, ?)`,
    [type, toUserId, toLabel, maskPhone(phone), message, relatedIncidentId || null, user?.unit_id ?? null]
  );
  const waLogId = result.insertId;

  await waQueue.add('send', { waLogId, phone, message }, JOB_OPTS);

  return waLogId;
}

// Kirim WA ke nomor lepas (mis. Kepala Seksi yang bukan akun sistem).
export async function queueWaRaw({ type = 'other', toLabel, phone, message, relatedIncidentId }) {
  const [result] = await pool.query(
    `INSERT INTO wa_log (type, to_user_id, to_label, phone, message, status, related_incident_id)
     VALUES (?, NULL, ?, ?, ?, 'pending', ?)`,
    [type, toLabel || maskPhone(phone) || 'Eksternal', maskPhone(phone), message, relatedIncidentId || null]
  );
  const waLogId = result.insertId;
  await waQueue.add('send', { waLogId, phone, message }, JOB_OPTS);
  return waLogId;
}

// Retensi: hapus log WA terkirim yang lebih tua dari N hari (kepatuhan PDP).
export async function purgeOldWaLogs(days = Number(process.env.WA_LOG_RETENTION_DAYS || 90)) {
  const [r] = await pool.query(
    "DELETE FROM wa_log WHERE status = 'sent' AND created_at < (NOW() - INTERVAL ? DAY)",
    [days]
  );
  return r.affectedRows;
}
