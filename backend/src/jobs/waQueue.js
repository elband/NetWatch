import { Queue } from 'bullmq';
import { redisConnection } from './queueConnection.js';
import { pool } from '../db/pool.js';

export const waQueue = new Queue('wa-notifications', { connection: redisConnection });

export async function queueWaNotification({ type, toUserId, message, relatedIncidentId }) {
  const [rows] = await pool.query('SELECT name, role, phone FROM users WHERE id = ?', [toUserId]);
  const user = rows[0];
  const toLabel = user ? `${user.name} (${user.role})` : `User #${toUserId}`;
  const phone = user?.phone || null;

  const [result] = await pool.query(
    `INSERT INTO wa_log (type, to_user_id, to_label, phone, message, status, related_incident_id)
     VALUES (?, ?, ?, ?, ?, 'pending', ?)`,
    [type, toUserId, toLabel, phone, message, relatedIncidentId || null]
  );
  const waLogId = result.insertId;

  await waQueue.add(
    'send',
    { waLogId, phone, message },
    { attempts: 5, backoff: { type: 'exponential', delay: 5000 } }
  );

  return waLogId;
}

// Kirim WA ke nomor lepas (mis. Kepala Seksi yang bukan akun sistem).
export async function queueWaRaw({ type = 'other', toLabel, phone, message, relatedIncidentId }) {
  const [result] = await pool.query(
    `INSERT INTO wa_log (type, to_user_id, to_label, phone, message, status, related_incident_id)
     VALUES (?, NULL, ?, ?, ?, 'pending', ?)`,
    [type, toLabel || phone || 'Eksternal', phone || null, message, relatedIncidentId || null]
  );
  const waLogId = result.insertId;
  await waQueue.add('send', { waLogId, phone, message }, { attempts: 5, backoff: { type: 'exponential', delay: 5000 } });
  return waLogId;
}
