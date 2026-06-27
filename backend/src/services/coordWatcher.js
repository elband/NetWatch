import { pool } from '../db/pool.js';
import { env } from '../config/env.js';
import { queueWaNotification } from '../jobs/waQueue.js';
import { createNotification } from './notify.js';
import { COORD_SLA_MINUTES, REMIND_MINUTES, getOnDutyTechIds } from '../config/shifts.js';
import { isNotifyEnabledForUser } from './notifyPrefs.js';

const takeLink = (id) => `${env.appUrl}/my-incidents?focus=${id}&action=take`;
const remindLink = (id) => `${env.appUrl}/incidents?focus=${id}&action=remind`;

// Kirim WA pengingat ke teknisi on-duty agar insiden segera diambil.
// Dipakai oleh auto-reminder (coordWatcher) maupun tombol manual koordinator.
// Mengembalikan jumlah teknisi yang diingatkan.
export async function remindOnDutyTechs(inc, { manual = false, by = null } = {}) {
  let targetIds = await getOnDutyTechIds(pool);
  // Fallback: bila tidak ada teknisi on-duty, ingatkan SEMUA teknisi aktif
  // agar pengingat tetap sampai (WA + notifikasi sistem).
  let fallback = false;
  if (!targetIds.length) {
    const [techs] = await pool.query("SELECT id FROM users WHERE active = 1 AND (role = 'teknisi' OR JSON_CONTAINS(roles, '\"teknisi\"'))");
    targetIds = techs.map((t) => t.id);
    fallback = true;
  }
  const mins = Math.max(1, Math.floor((Date.now() - new Date(inc.created_at).getTime()) / 60000));
  for (const uid of targetIds) {
    if (await isNotifyEnabledForUser('insiden_teknisi', uid)) {
      await queueWaNotification({
        type: 'alert',
        toUserId: uid,
        message: `🔔 PENGINGAT — SEGERA AMBIL INSIDEN (${(inc.priority || 'sedang').toUpperCase()})\n${inc.id} | ${inc.device_name}\nMasalah: ${inc.issue}\nSudah ${mins} menit belum diambil. Mohon segera AMBIL: ${takeLink(inc.id)}`,
        relatedIncidentId: inc.id,
      });
    }
    await createNotification({ userId: uid, type: 'ticket_sla', priority: 'warning', title: `Reminder SLA: ${inc.device_name}`, message: `${inc.id} belum diambil ${mins} menit — segera tangani.`, refId: inc.id, refType: 'incident', link: '/my-incidents' });
  }
  await pool.query('UPDATE incidents SET tech_reminded = 1 WHERE id = ?', [inc.id]);
  const label = manual ? `Pengingat manual dikirim${by ? ` oleh ${by}` : ''}` : 'Pengingat otomatis dikirim';
  await pool.query('INSERT INTO incident_notes (incident_id, step, note) VALUES (?, ?, ?)', [
    inc.id, inc.step || 0,
    targetIds.length
      ? `🔔 ${label} ke ${targetIds.length} teknisi${fallback ? ' aktif (tidak ada yang on-duty saat ini)' : ' on-duty'} (insiden belum diambil).`
      : `🔔 ${label}, namun tidak ada teknisi aktif sama sekali.`,
  ]);
  return targetIds.length;
}

// Pengecekan berkala: (1) pengingat ke teknisi on-duty bila insiden belum
// diambil >= REMIND_MINUTES, (2) eskalasi ke koordinator bila >= COORD_SLA_MINUTES.
export async function checkUnclaimedIncidents(io) {
  // (1) Pengingat otomatis ke teknisi on-duty (5 menit).
  const [toRemind] = await pool.query(
    `SELECT * FROM incidents
      WHERE tech_id IS NULL AND status = 'aktif' AND tech_reminded = 0
        AND TIMESTAMPDIFF(MINUTE, created_at, NOW()) >= ?`,
    [REMIND_MINUTES]
  );
  for (const inc of toRemind) {
    await remindOnDutyTechs(inc, { manual: false });
    io?.emit('incident:reminded', { id: inc.id, device: inc.device_name });
  }

  // (2) Eskalasi ke koordinator (10 menit).
  const [toEscalate] = await pool.query(
    `SELECT * FROM incidents
      WHERE tech_id IS NULL AND status = 'aktif' AND coord_alerted = 0
        AND TIMESTAMPDIFF(MINUTE, created_at, NOW()) >= ?`,
    [COORD_SLA_MINUTES]
  );
  if (toEscalate.length === 0) return;

  const [coords] = await pool.query("SELECT id FROM users WHERE active = 1 AND (role = 'koordinator' OR JSON_CONTAINS(roles, '\"koordinator\"'))");
  for (const inc of toEscalate) {
    await pool.query('UPDATE incidents SET coord_alerted = 1 WHERE id = ?', [inc.id]);
    const mins = Math.max(COORD_SLA_MINUTES, Math.floor((Date.now() - new Date(inc.created_at).getTime()) / 60000));
    await pool.query('INSERT INTO incident_notes (incident_id, step, note) VALUES (?, ?, ?)', [
      inc.id, inc.step || 0,
      `⚠️ Insiden belum diambil teknisi >${COORD_SLA_MINUTES} menit — eskalasi ke koordinator.`,
    ]);
    for (const c of coords) {
      if (await isNotifyEnabledForUser('insiden_koordinator', c.id)) {
        await queueWaNotification({
          type: 'alert',
          toUserId: c.id,
          message: `⏰ INSIDEN BELUM DIAMBIL (${(inc.priority || 'sedang').toUpperCase()})\n${inc.id} | ${inc.device_name}\nMasalah: ${inc.issue}\nSudah ${mins} menit tanpa teknisi. Ingatkan teknisi: ${remindLink(inc.id)}`,
          relatedIncidentId: inc.id,
        });
      }
      await createNotification({ userId: c.id, type: 'ticket_sla', priority: 'kritis', title: `Tiket melewati SLA: ${inc.device_name}`, message: `${inc.id} belum diambil ${mins} menit (>${COORD_SLA_MINUTES} mnt). Perlu koordinasi.`, refId: inc.id, refType: 'incident', link: `/incidents?focus=${inc.id}` });
    }
    io?.emit('incident:escalated', { id: inc.id, device: inc.device_name });
  }
}

// Jalankan pengecekan tiap 60 detik.
export function startCoordWatcher(io) {
  const tick = () => checkUnclaimedIncidents(io).catch((e) => console.error('coordWatcher:', e.message));
  tick();
  return setInterval(tick, 60_000);
}
