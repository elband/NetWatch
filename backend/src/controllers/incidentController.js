import crypto from 'crypto';
import { pool } from '../db/pool.js';
import { env } from '../config/env.js';
import { queueWaNotification } from '../jobs/waQueue.js';
import { createNotification, notifyRoles } from '../services/notify.js';
import { getOnDutyTechIds, getDutyStatus } from '../config/shifts.js';
import { remindOnDutyTechs } from '../services/coordWatcher.js';
import { isNotifyEnabledForUser } from '../services/notifyPrefs.js';
import { nextIncidentId } from '../utils/incidentId.js';

// Alur tindakan insiden berbasis pilihan/cabang (solusi perbaikan peralatan):
// - Mulai: "Coba SSH" (bila ber-IP) atau "Langsung Kunjungan".
// - SSH berhasil → langsung selesai. SSH gagal / kunjungan → "Bongkar & Analisa".
// - Setelah Bongkar & Analisa, laporan kerusakan WAJIB diisi dulu sebelum bisa
//   "Selesai" atau "Tidak Bisa Ditangani" (menunggu suku cadang).
// Tiap akhir (menunggu suku cadang / selesai) otomatis kirim WA ke koordinator.
const FINAL_STEP = 2;
const STEP_BY_ACTION = { ssh_fail: 1, visit: 1 };
// Ber-IP valid (IPv4) → boleh jalur SSH. Placeholder ("N/A …") dianggap tanpa IP.
const hasValidIp = (ip) => !!ip && /^\d{1,3}(\.\d{1,3}){3}$/.test(String(ip).trim());
const ACTION_LABEL = {
  ssh_fail: '💻 Dicoba via SSH (gagal, lanjut Bongkar & Analisa)',
  ssh_ok: '✅ SSH Berhasil – Peralatan Normal Kembali',
  visit: '📍 Langsung Kunjungan – Bongkar & Analisa',
  awaiting: '📦 Tidak Bisa Ditangani – Menunggu Suku Cadang',
  resolve: '✅ Selesai – Peralatan Normal Kembali',
};

// Link "klik untuk ambil" (teknisi) — buka NetWatch & langsung eksekusi aksi take.
const takeLink = (id) => `${env.appUrl}/my-incidents?focus=${id}&action=take`;
// Link "klik untuk mengingatkan" (koordinator) — ingatkan teknisi on-duty
// (atau yang sudah ditugaskan langsung, bila insiden sudah punya tech_id).
const remindLink = (id) => `${env.appUrl}/incidents?focus=${id}&action=remind`;

// Kirim WA ke koordinator (pakai coord_id bila ada, jika tidak broadcast ke
// semua koordinator aktif).
async function notifyCoordinators(conn, incident, message, type = 'alert') {
  let targetIds = [];
  if (incident.coord_id) {
    targetIds = [incident.coord_id];
  } else {
    const [coords] = await conn.query("SELECT id FROM users WHERE active = 1 AND (role = 'koordinator' OR JSON_CONTAINS(roles, '\"koordinator\"'))");
    targetIds = coords.map((c) => c.id);
  }
  for (const uid of targetIds) {
    if (!(await isNotifyEnabledForUser('insiden_koordinator', uid))) continue;
    await queueWaNotification({ type, toUserId: uid, message, relatedIncidentId: incident.id });
  }
}

async function notifyCoordinatorsDone(conn, incident, duration) {
  await notifyCoordinators(conn, incident, `✅ PERALATAN NORMAL KEMBALI\n${incident.id} | ${incident.device_name}\nMasalah: ${incident.issue}\nDurasi: ${duration} menit`, 'done');
  await notifyRoles(['koordinator', 'admin'], { type: 'ticket_done', title: `Insiden selesai: ${incident.device_name}`, message: `${incident.id} ditangani dalam ${duration} menit`, refId: incident.id, refType: 'incident', link: `/incidents?focus=${incident.id}` });
}

// Notifikasi saat insiden ditutup OTOMATIS oleh sistem (perangkat pulih & stabil).
// Mengingatkan koordinator/admin & memberi tahu teknisi yang menangani tiket
// (beserta kolaborator), agar semua tahu tiket ditutup tanpa intervensi manual.
export async function notifyAutoResolved(conn, incident, info = {}) {
  const { durationMin = 0, stableMin, recoveredAt } = info;
  const durTxt = `${Math.floor(durationMin / 60)}j ${durationMin % 60}m`;
  const recovTxt = recoveredAt ? new Date(recoveredAt).toLocaleString('id-ID') : '-';
  const msg = `🤖✅ AUTO-RESOLVED (oleh SISTEM)\n${incident.id} | ${incident.device_name}\nMasalah: ${incident.issue}\nPerangkat kembali ONLINE & stabil${stableMin ? ` ≥ ${stableMin} mnt` : ''} tanpa flapping.\nWaktu pulih: ${recovTxt}\nTotal downtime: ${durTxt}`;

  // Koordinator (pengingat) + lonceng in-app koordinator & admin.
  await notifyCoordinators(conn, incident, msg, 'done');
  await notifyRoles(['koordinator', 'admin'], { type: 'ticket_auto_resolved', title: `Auto-resolved: ${incident.device_name}`, message: `${incident.id} ditutup otomatis oleh sistem (downtime ${durTxt})`, refId: incident.id, refType: 'incident', link: `/incidents?focus=${incident.id}` });

  // Teknisi penanggung jawab + kolaborator (bila tiket sudah diambil/dibagikan).
  const techIds = new Set();
  if (incident.tech_id) techIds.add(incident.tech_id);
  try {
    const [collab] = await conn.query('SELECT user_id FROM incident_collaborators WHERE incident_id = ?', [incident.id]);
    for (const c of collab) techIds.add(c.user_id);
  } catch { /* tabel kolaborator opsional */ }
  for (const uid of techIds) {
    if (await isNotifyEnabledForUser('insiden_teknisi', uid)) {
      await queueWaNotification({ type: 'done', toUserId: uid, message: `${msg}\n\nTiket ditutup otomatis oleh sistem. Mohon verifikasi bila masih ada pekerjaan tersisa.`, relatedIncidentId: incident.id });
    }
    await createNotification({ userId: uid, type: 'ticket_auto_resolved', title: `Tiket auto-resolved: ${incident.device_name}`, message: `${incident.id} ditutup otomatis — perangkat pulih & stabil.`, refId: incident.id, refType: 'incident', link: '/my-incidents' });
  }
}

// Snapshot teknisi on-duty saat insiden masuk + kirim notifikasi ke mereka.
// Mengembalikan jumlah teknisi yang diberi notifikasi.
export async function snapshotAndNotifyOnDuty(conn, { id, priority, deviceName, issue }) {
  const onDutyIds = await getOnDutyTechIds(conn);
  for (const uid of onDutyIds) {
    await conn.query('INSERT IGNORE INTO incident_duty (incident_id, user_id) VALUES (?, ?)', [id, uid]);
  }
  const prio = priority === 'kritis' ? 'kritis' : 'warning';
  for (const uid of onDutyIds) {
    if (await isNotifyEnabledForUser('insiden_teknisi', uid)) {
      await queueWaNotification({
        type: 'alert',
        toUserId: uid,
        message: `🚨 INSIDEN BARU (${(priority || 'sedang').toUpperCase()})\n${id} | ${deviceName}\nMasalah: ${issue}\nSegera AMBIL: ${takeLink(id)}`,
        relatedIncidentId: id,
      });
    }
    await createNotification({ userId: uid, type: 'ticket_assigned', priority: prio, title: `Tiket baru: ${deviceName}`, message: issue, refId: id, refType: 'incident', link: '/my-incidents' });
  }
  // Koordinator & admin: tiket helpdesk baru masuk.
  await notifyRoles(['koordinator', 'admin'], { type: 'ticket_new', priority: prio, title: `Insiden baru (${(priority || 'sedang').toUpperCase()})`, message: `${id} · ${deviceName} — ${issue}`, refId: id, refType: 'incident', link: `/incidents?focus=${id}` });
  return onDutyIds.length;
}

async function attachNotes(incidents) {
  if (incidents.length === 0) return incidents;
  const ids = incidents.map((i) => i.id);
  const [notes] = await pool.query(
    `SELECT * FROM incident_notes WHERE incident_id IN (?) ORDER BY created_at ASC`,
    [ids]
  );
  const [reports] = await pool.query(
    `SELECT * FROM incident_reports WHERE incident_id IN (?)`,
    [ids]
  );
  const [collabs] = await pool.query(
    `SELECT c.incident_id, c.user_id, u.name, u.emoji FROM incident_collaborators c JOIN users u ON u.id = c.user_id WHERE c.incident_id IN (?)`,
    [ids]
  );
  const byIncident = {};
  for (const n of notes) {
    (byIncident[n.incident_id] ||= []).push(n);
  }
  const reportByIncident = {};
  for (const r of reports) {
    reportByIncident[r.incident_id] = r;
  }
  const collabByIncident = {};
  for (const c of collabs) {
    (collabByIncident[c.incident_id] ||= []).push({ user_id: c.user_id, name: c.name, emoji: c.emoji });
  }
  return incidents.map((i) => ({
    ...i,
    notes: byIncident[i.id] || [],
    report: reportByIncident[i.id] || null,
    collaborators: collabByIncident[i.id] || [],
  }));
}

export async function getIncident(req, res) {
  const id = req.params.id;
  const [rows] = await pool.query('SELECT * FROM incidents WHERE id = ?', [id]);
  if (!rows[0]) return res.status(404).json({ error: 'Insiden tidak ditemukan' });
  res.json({ incident: (await attachNotes(rows))[0] });
}

export async function listIncidents(req, res) {
  const { status, techId, unassigned } = req.query;
  let sql = 'SELECT * FROM incidents WHERE 1=1';
  const params = [];
  if (status) { sql += ' AND status = ?'; params.push(status); }
  if (techId) { sql += ' AND tech_id = ?'; params.push(Number(techId)); }
  if (unassigned === '1' || unassigned === 'true') { sql += " AND tech_id IS NULL AND status != 'selesai'"; }
  sql += ' ORDER BY created_at DESC';
  const [rows] = await pool.query(sql, params);
  res.json({ incidents: await attachNotes(rows) });
}

// Antrian kerja untuk teknisi: status on-duty + insiden pool (belum diambil)
// + insiden milik sendiri.
export async function incidentQueue(req, res) {
  const conn = await pool.getConnection();
  try {
    const duty = await getDutyStatus(conn, req.user.id);
    const [poolRows] = await conn.query(
      "SELECT * FROM incidents WHERE tech_id IS NULL AND status != 'selesai' ORDER BY FIELD(priority,'kritis','tinggi','sedang'), created_at ASC"
    );
    const [mineRows] = await conn.query(
      'SELECT * FROM incidents WHERE tech_id = ? ORDER BY created_at DESC',
      [req.user.id]
    );
    // Insiden yang saya diajak (kolaborasi, read-only) — bukan milik saya.
    const [collabRows] = await conn.query(
      `SELECT i.* FROM incidents i JOIN incident_collaborators c ON c.incident_id = i.id
        WHERE c.user_id = ? AND (i.tech_id IS NULL OR i.tech_id <> ?) ORDER BY i.created_at DESC`,
      [req.user.id, req.user.id]
    );
    res.json({
      duty,
      pool: await attachNotes(poolRows),
      mine: await attachNotes(mineRows),
      collab: await attachNotes(collabRows),
    });
  } finally {
    conn.release();
  }
}

// Daftar teknisi aktif (untuk pemilih "Ajak Teknisi").
export async function listTeknisi(req, res) {
  const [rows] = await pool.query("SELECT id, name, emoji FROM users WHERE active = 1 AND (role = 'teknisi' OR JSON_CONTAINS(roles, '\"teknisi\"')) ORDER BY name");
  res.json({ teknisi: rows });
}

// "Kerjakan Bersama": teknisi pemilik job (atau koordinator/admin) mengajak teknisi lain.
// Teknisi yang diajak diberi tahu (WA + notifikasi sistem) & bisa melihat insiden.
export async function inviteCollaborators(req, res) {
  const id = req.params.id;
  const techIds = Array.isArray(req.body.techIds) ? req.body.techIds.map(Number).filter(Boolean) : [];
  const [rows] = await pool.query('SELECT * FROM incidents WHERE id = ?', [id]);
  const incident = rows[0];
  if (!incident) return res.status(404).json({ error: 'Insiden tidak ditemukan' });
  const roles = req.user.roles?.length ? req.user.roles : [req.user.role];
  const isManager = roles.some((r) => r === 'admin' || r === 'koordinator');
  if (incident.tech_id !== req.user.id && !isManager) return res.status(403).json({ error: 'Hanya teknisi pemilik job (atau koordinator/admin) yang bisa mengajak teknisi lain.' });
  if (!techIds.length) return res.status(400).json({ error: 'Pilih minimal satu teknisi.' });

  const invited = [];
  for (const uid of techIds) {
    if (uid === incident.tech_id) continue;
    const [r] = await pool.query('INSERT IGNORE INTO incident_collaborators (incident_id, user_id, invited_by) VALUES (?, ?, ?)', [id, uid, req.user.id]);
    if (!r.affectedRows) continue;
    invited.push(uid);
    if (await isNotifyEnabledForUser('insiden_teknisi', uid)) await queueWaNotification({ type: 'other', toUserId: uid, relatedIncidentId: id, message: `👥 DIAJAK KERJAKAN BERSAMA\n${id} | ${incident.device_name}\nMasalah: ${incident.issue}\nAnda diajak oleh ${req.user.name} untuk membantu menangani insiden ini. Lihat di aplikasi NetWatch.` });
    await createNotification({ userId: uid, type: 'ticket_collab', priority: incident.priority === 'kritis' ? 'kritis' : 'info', title: `Diajak kerjakan bersama: ${incident.device_name}`, message: `${id} — diajak oleh ${req.user.name}. ${incident.issue}`, refId: id, refType: 'incident', link: '/my-dashboard' });
  }
  if (invited.length) {
    const [names] = await pool.query('SELECT name FROM users WHERE id IN (?)', [invited]);
    await pool.query('INSERT INTO incident_notes (incident_id, step, note) VALUES (?, ?, ?)', [id, incident.step || 0, `👥 ${req.user.name} mengajak ${names.map((n) => n.name).join(', ')} untuk kerjakan bersama.`]);
  }
  const [updated] = await pool.query('SELECT * FROM incidents WHERE id = ?', [id]);
  res.json({ incident: (await attachNotes(updated))[0], invited: invited.length });
}

export async function dutyStatus(req, res) {
  const conn = await pool.getConnection();
  try {
    res.json(await getDutyStatus(conn, req.user.id));
  } finally {
    conn.release();
  }
}

// Teknisi mengambil insiden dari pool.
export async function takeIncident(req, res) {
  const id = req.params.id;
  const conn = await pool.getConnection();
  try {
    const [rows] = await conn.query('SELECT * FROM incidents WHERE id = ?', [id]);
    const incident = rows[0];
    if (!incident) return res.status(404).json({ error: 'Insiden tidak ditemukan' });
    if (incident.status === 'selesai') return res.status(400).json({ error: 'Insiden sudah selesai' });
    if (incident.tech_id) return res.status(409).json({ error: 'Insiden sudah diambil teknisi lain' });

    // Gate on-duty untuk teknisi (cek array roles, bukan hanya peran utama).
    // Koordinator/admin dikecualikan agar tetap bisa menugaskan/mengambil kapan saja.
    const takerRoles = req.user.roles?.length ? req.user.roles : [req.user.role];
    const isManager = takerRoles.some((r) => r === 'admin' || r === 'koordinator');
    if (!isManager) {
      const { onDuty } = await getDutyStatus(conn, req.user.id);
      if (!onDuty) return res.status(403).json({ error: 'Anda sedang tidak on-duty, tidak bisa mengambil insiden' });
    }

    // Diambil tidak menggeser progres; progres dimulai saat teknisi klik
    // "Update Progress" (Datang ke Lokasi → Diserahkan ke Teknisi → Selesai).
    await conn.query(
      "UPDATE incidents SET tech_id = ?, taken_at = NOW(), status = 'proses' WHERE id = ?",
      [req.user.id, id]
    );
    await conn.query('INSERT INTO incident_notes (incident_id, step, note) VALUES (?, ?, ?)', [
      id, incident.step, `Insiden diambil & ditangani oleh ${req.user.name}.`,
    ]);
    const [updated] = await conn.query('SELECT * FROM incidents WHERE id = ?', [id]);
    res.json({ incident: (await attachNotes(updated))[0] });
  } finally {
    conn.release();
  }
}

// Tambah catatan bebas ke kronologi insiden (mis. komentar teknisi dari
// sesi SSH Terminal). Sumber opsional untuk memberi prefiks pada catatan.
export async function addIncidentNote(req, res) {
  const id = req.params.id;
  const note = (req.body.note || '').trim();
  const source = req.body.source === 'ssh' ? 'ssh' : null;
  if (!note) return res.status(400).json({ error: 'Catatan tidak boleh kosong.' });

  const [rows] = await pool.query('SELECT id, step FROM incidents WHERE id = ?', [id]);
  if (!rows[0]) return res.status(404).json({ error: 'Insiden tidak ditemukan' });

  const prefix = source === 'ssh' ? '💻 Catatan SSH' : '📝 Catatan';
  await pool.query('INSERT INTO incident_notes (incident_id, step, note) VALUES (?, ?, ?)', [
    id, rows[0].step || 0, `${prefix} (oleh ${req.user.name}): ${note}`,
  ]);
  const [updated] = await pool.query('SELECT * FROM incidents WHERE id = ?', [id]);
  res.json({ incident: (await attachNotes(updated))[0] });
}

// Koordinator mengingatkan teknisi on-duty agar segera mengambil insiden.
export async function remindIncident(req, res) {
  const id = req.params.id;
  const [rows] = await pool.query('SELECT * FROM incidents WHERE id = ?', [id]);
  const incident = rows[0];
  if (!incident) return res.status(404).json({ error: 'Insiden tidak ditemukan' });
  if (incident.tech_id) return res.status(400).json({ error: 'Insiden sudah diambil teknisi.' });
  if (incident.status === 'selesai') return res.status(400).json({ error: 'Insiden sudah selesai.' });

  const techId = Number(req.body.techId) || null;
  const note = String(req.body.note || '').trim();

  // Perintah penanganan ke SATU teknisi tertentu yang dipilih koordinator.
  if (techId) {
    const [[tech]] = await pool.query(
      "SELECT id, name FROM users WHERE id = ? AND active = 1 AND (role = 'teknisi' OR JSON_CONTAINS(roles, '\"teknisi\"'))",
      [techId]
    );
    if (!tech) return res.status(400).json({ error: 'Teknisi tidak ditemukan / bukan teknisi aktif.' });
    const mins = Math.max(1, Math.floor((Date.now() - new Date(incident.created_at).getTime()) / 60000));
    const prio = incident.priority === 'kritis' ? 'kritis' : 'warning';
    if (await isNotifyEnabledForUser('insiden_teknisi', techId)) await queueWaNotification({
      type: 'alert',
      toUserId: techId,
      message: `📋 PERINTAH PENANGANAN (${(incident.priority || 'sedang').toUpperCase()})\n${incident.id} | ${incident.device_name}\nMasalah: ${incident.issue}\nSudah ${mins} menit belum diambil.${note ? `\nCatatan: ${note}` : ''}\nDitugaskan oleh ${req.user.name} — mohon segera AMBIL: ${takeLink(incident.id)}`,
      relatedIncidentId: incident.id,
    });
    await createNotification({
      userId: techId, type: 'ticket_sla', priority: prio,
      title: `Perintah penanganan: ${incident.device_name}`,
      message: `${incident.id} — ditugaskan oleh ${req.user.name}.${note ? ` ${note}` : ''} Segera ambil & tangani.`,
      refId: incident.id, refType: 'incident', link: '/my-incidents',
    });
    await pool.query('UPDATE incidents SET tech_reminded = 1 WHERE id = ?', [incident.id]);
    await pool.query('INSERT INTO incident_notes (incident_id, step, note) VALUES (?, ?, ?)', [
      incident.id, incident.step || 0,
      `📋 Perintah penanganan dikirim ke ${tech.name} oleh ${req.user.name}.${note ? ` Catatan: ${note}` : ''}`,
    ]);
    const [updated] = await pool.query('SELECT * FROM incidents WHERE id = ?', [id]);
    return res.json({ incident: (await attachNotes(updated))[0], remindedCount: 1, message: `Perintah dikirim ke ${tech.name}.` });
  }

  // Default: ingatkan SEMUA teknisi on-duty.
  const n = await remindOnDutyTechs(incident, { manual: true, by: req.user.name });
  const [updated] = await pool.query('SELECT * FROM incidents WHERE id = ?', [id]);
  res.json({
    incident: (await attachNotes(updated))[0],
    remindedCount: n,
    message: n ? `Pengingat dikirim ke ${n} teknisi on-duty.` : 'Tidak ada teknisi on-duty saat ini.',
  });
}

export async function createIncident(req, res) {
  const { deviceId, deviceName, ip, issue, priority, techId, coordId, source, locationId } = req.body;
  const conn = await pool.getConnection();
  try {
    const id = await nextIncidentId(conn);
    const assigned = techId || null;
    // Model pool: tanpa penugasan langsung, insiden masuk ke pool (aktif) dan
    // dikirim ke semua teknisi on-duty. Jika koordinator menugaskan langsung,
    // insiden langsung jadi milik teknisi tsb.
    await conn.query(
      `INSERT INTO incidents (id, device_id, device_name, ip, location_id, issue, priority, tech_id, coord_id, status, step, source, taken_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ${assigned ? 'NOW()' : 'NULL'})`,
      [id, deviceId || null, deviceName, ip || null, locationId || null, issue, priority || 'sedang', assigned, coordId || null, assigned ? 'proses' : 'aktif', source || 'manual']
    );
    await conn.query(`INSERT INTO incident_notes (incident_id, step, note) VALUES (?, 0, ?)`, [id, 'Insiden dibuat.']);

    await notifyCoordinators(conn, { id, coord_id: coordId || null }, `🚨 INSIDEN BARU (${(priority || 'sedang').toUpperCase()})\n${id} | ${deviceName}\nMasalah: ${issue}\nIngatkan teknisi: ${remindLink(id)}`, 'alert');

    if (assigned) {
      if (await isNotifyEnabledForUser('insiden_teknisi', assigned)) await queueWaNotification({
        type: 'alert',
        toUserId: assigned,
        message: `🚨 ALERT ${(priority || 'sedang').toUpperCase()}\nPerangkat: ${deviceName}\nMasalah: ${issue}`,
        relatedIncidentId: id,
      });
    } else {
      const n = await snapshotAndNotifyOnDuty(conn, { id, priority, deviceName, issue });
      await conn.query('INSERT INTO incident_notes (incident_id, step, note) VALUES (?, 0, ?)', [
        id, n ? `Notifikasi dikirim ke ${n} teknisi on-duty.` : 'Tidak ada teknisi on-duty saat ini — insiden menunggu di pool.',
      ]);
    }

    const [rows] = await conn.query('SELECT * FROM incidents WHERE id = ?', [id]);
    const incident = (await attachNotes(rows))[0];
    res.status(201).json({ incident });
  } finally {
    conn.release();
  }
}

// Catat satu tindakan pada insiden. body.action ∈ ssh_fail|ssh_ok|visit|awaiting|resolve.
// Tiap tindakan wajib foto + penjelasan. SSH hanya untuk perangkat ber-IP.
// "resolve"/"awaiting" (setelah Bongkar & Analisa) wajib laporan kerusakan
// sudah diisi lebih dulu — kecuali "ssh_ok" yang menutup insiden langsung dari step 0.
export async function advanceStep(req, res) {
  const id = req.params.id;
  const action = req.body.action || '';
  const explanation = (req.body.note || '').trim();
  const docUrl = req.file ? `/uploads/incidents/${req.file.filename}` : null;
  if (!ACTION_LABEL[action]) return res.status(400).json({ error: 'Tindakan tidak valid.' });
  if (!docUrl) return res.status(400).json({ error: 'Dokumentasi (foto) wajib diunggah untuk setiap tindakan.' });
  if (!explanation) return res.status(400).json({ error: 'Penjelasan tindakan wajib diisi.' });

  const conn = await pool.getConnection();
  try {
    const [rows] = await conn.query('SELECT * FROM incidents WHERE id = ?', [id]);
    const incident = rows[0];
    if (!incident) return res.status(404).json({ error: 'Insiden tidak ditemukan' });
    if (incident.status === 'selesai') return res.status(400).json({ error: 'Insiden sudah selesai.' });
    if ((action === 'ssh_fail' || action === 'ssh_ok') && !hasValidIp(incident.ip)) {
      return res.status(400).json({ error: 'Tindakan SSH hanya untuk perangkat yang punya IP valid.' });
    }
    if ((action === 'resolve' || action === 'awaiting') && incident.step !== FINAL_STEP - 1) {
      const [repRows] = await conn.query('SELECT id FROM incident_reports WHERE incident_id = ?', [id]);
      if (!repRows[0]) return res.status(400).json({ error: 'Laporan Kerusakan & Perbaikan wajib diisi sebelum menutup/menunda insiden.' });
    }

    const label = ACTION_LABEL[action];

    if (action === 'resolve' || action === 'ssh_ok') {
      // Selesai diperbaiki / teratasi: tutup insiden + WA koordinator.
      await conn.query(
        `UPDATE incidents SET step = ?, status = 'selesai', awaiting_part = 0, resolved_at = NOW(),
           resolution_type = 'MANUAL', resolved_by = ?,
           duration_min = GREATEST(1, TIMESTAMPDIFF(MINUTE, created_at, NOW())) WHERE id = ?`,
        [FINAL_STEP, req.user.name, id]
      );
      const [durRows] = await conn.query('SELECT duration_min FROM incidents WHERE id = ?', [id]);
      const duration = durRows[0]?.duration_min || 0;
      await conn.query('INSERT INTO incident_notes (incident_id, step, note, doc_url) VALUES (?, ?, ?, ?)', [
        id, FINAL_STEP, `${label} (oleh ${req.user.name}): ${explanation} — insiden ditutup. Durasi: ${Math.floor(duration / 60)}j ${duration % 60}m.`, docUrl,
      ]);
      await notifyCoordinatorsDone(conn, incident, duration);
    } else if (action === 'awaiting') {
      // Tidak bisa ditangani / menunggu suku cadang: tetap terbuka. WA ke koordinator.
      await conn.query("UPDATE incidents SET awaiting_part = 1, status = 'proses' WHERE id = ?", [id]);
      await conn.query('INSERT INTO incident_notes (incident_id, step, note, doc_url) VALUES (?, ?, ?, ?)', [
        id, incident.step || 0, `${label} (oleh ${req.user.name}): ${explanation}`, docUrl,
      ]);
      await notifyCoordinators(conn, incident, `📦 MENUNGGU SUKU CADANG\n${incident.id} | ${incident.device_name}\nMasalah: ${incident.issue}\nOleh ${req.user.name}: ${explanation}\nMohon koordinasi pengadaan suku cadang.`);
    } else {
      // ssh_fail / visit → masuk ke tahap "Bongkar & Analisa".
      const step = STEP_BY_ACTION[action];
      await conn.query("UPDATE incidents SET step = ?, status = 'proses' WHERE id = ?", [step, id]);
      await conn.query('INSERT INTO incident_notes (incident_id, step, note, doc_url) VALUES (?, ?, ?, ?)', [
        id, step, `${label} (oleh ${req.user.name}): ${explanation}`, docUrl,
      ]);
    }

    const [updated] = await conn.query('SELECT * FROM incidents WHERE id = ?', [id]);
    res.json({ incident: (await attachNotes(updated))[0] });
  } finally {
    conn.release();
  }
}

// Tandai / batalkan status "menunggu sparepart" pada insiden.
export async function setAwaitingPart(req, res) {
  const id = req.params.id;
  const value = req.body.value ? 1 : 0;
  const [rows] = await pool.query('SELECT id, step FROM incidents WHERE id = ?', [id]);
  if (!rows[0]) return res.status(404).json({ error: 'Insiden tidak ditemukan' });
  await pool.query('UPDATE incidents SET awaiting_part = ? WHERE id = ?', [value, id]);
  await pool.query('INSERT INTO incident_notes (incident_id, step, note) VALUES (?, ?, ?)', [
    id, rows[0].step || 0,
    value ? `Insiden ditandai MENUNGGU SPAREPART oleh ${req.user.name}.` : `Status menunggu sparepart dibatalkan oleh ${req.user.name}.`,
  ]);
  const [updated] = await pool.query('SELECT * FROM incidents WHERE id = ?', [id]);
  res.json({ incident: (await attachNotes(updated))[0] });
}

export async function getIncidentReport(req, res) {
  const id = req.params.id;
  const [rows] = await pool.query('SELECT * FROM incident_reports WHERE incident_id = ?', [id]);
  res.json({ report: rows[0] || null });
}

export async function saveIncidentReport(req, res) {
  const id = req.params.id;
  const { kerusakan, penyebab, perbaikan, sparepart, hasil } = req.body;
  if (!kerusakan?.trim() || !perbaikan?.trim()) {
    return res.status(400).json({ error: 'Deskripsi kerusakan dan tindakan perbaikan wajib diisi' });
  }
  const [incRows] = await pool.query('SELECT id, step FROM incidents WHERE id = ?', [id]);
  if (!incRows[0]) return res.status(404).json({ error: 'Insiden tidak ditemukan' });

  const validHasil = ['berhasil', 'sebagian', 'gagal'];
  const hasilVal = validHasil.includes(hasil) ? hasil : 'berhasil';

  await pool.query(
    `INSERT INTO incident_reports (incident_id, kerusakan, penyebab, perbaikan, sparepart, hasil, reported_by, reporter_name)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       kerusakan = VALUES(kerusakan), penyebab = VALUES(penyebab), perbaikan = VALUES(perbaikan),
       sparepart = VALUES(sparepart), hasil = VALUES(hasil),
       reported_by = VALUES(reported_by), reporter_name = VALUES(reporter_name)`,
    [id, kerusakan.trim(), penyebab?.trim() || null, perbaikan.trim(), sparepart?.trim() || null,
     hasilVal, req.user.id, req.user.name]
  );

  await pool.query('INSERT INTO incident_notes (incident_id, step, note) VALUES (?, ?, ?)', [
    id,
    incRows[0].step || 0,
    `Laporan kerusakan & perbaikan disimpan oleh ${req.user.name}.`,
  ]);

  const [rows] = await pool.query('SELECT * FROM incident_reports WHERE incident_id = ?', [id]);
  res.json({ report: rows[0] });
}

// Koordinator/admin mengesahkan laporan (TTE). Server membuat token ber-hash
// (HMAC) yang bisa diverifikasi publik via QR.
export async function signIncidentReport(req, res) {
  const id = req.params.id;
  const [rows] = await pool.query('SELECT * FROM incident_reports WHERE incident_id = ?', [id]);
  const report = rows[0];
  if (!report) return res.status(404).json({ error: 'Laporan belum dibuat — tidak bisa disahkan.' });
  if (report.sign_token) return res.status(400).json({ error: 'Laporan sudah disahkan (TTE).' });

  const { signerName, signerNip } = req.body;
  const name = (signerName || req.user.name || '').trim();
  const nip = (signerNip || '').trim() || null;
  const signedAt = new Date();
  // Token = HMAC dari isi laporan + penanda tangan + waktu (anti-pemalsuan).
  const payload = `${id}|${report.kerusakan}|${report.perbaikan}|${req.user.id}|${name}|${signedAt.toISOString()}`;
  const token = 'NW' + crypto.createHmac('sha256', env.jwtSecret).update(payload).digest('hex').slice(0, 22).toUpperCase();

  await pool.query(
    `UPDATE incident_reports SET signed_by=?, signer_name=?, signer_nip=?, signed_at=?, sign_token=? WHERE incident_id=?`,
    [req.user.id, name, nip, signedAt, token, id]
  );

  // Otomatis masuk Surat Keluar dan sahkan nota_dinas sekaligus.
  const nd = await ensureNotaDinasSurat(id, req.user);
  if (nd && !nd.nota.sign_token) {
    const spayload = `SURAT|${nd.nota.nomor}|${nd.nota.hal}|${req.user.id}|${name}|${signedAt.toISOString()}`;
    const stoken = 'NS' + crypto.createHmac('sha256', env.jwtSecret).update(spayload).digest('hex').slice(0, 22).toUpperCase();
    await pool.query(
      `UPDATE nota_dinas SET signed_by=?, signer_name=?, signer_nip=?, signed_at=?, sign_token=? WHERE id=?`,
      [req.user.id, name, nip, signedAt, stoken, nd.nota.id]
    );
  }

  const [updated] = await pool.query('SELECT * FROM incident_reports WHERE incident_id = ?', [id]);
  res.json({ report: updated[0] });
}

const ROMAN = ['', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII'];

// Pastikan ada entry nota_dinas untuk insiden ini. Kalau sudah ada, kembalikan
// yang lama. Dipakai oleh signIncidentReport (auto) dan createNotaDinas (manual).
async function ensureNotaDinasSurat(incidentId, user) {
  const [exist] = await pool.query('SELECT * FROM nota_dinas WHERE incident_id = ? ORDER BY id DESC LIMIT 1', [incidentId]);
  if (exist[0]) return { nota: exist[0], reused: true };

  const [incRows] = await pool.query(
    'SELECT i.*, d.loc AS device_loc FROM incidents i LEFT JOIN devices d ON d.id = i.device_id WHERE i.id = ?',
    [incidentId]
  );
  const incident = incRows[0];
  if (!incident) return null;

  const [sRows] = await pool.query("SELECT setting_value FROM settings WHERE setting_key = 'lkp'");
  let lkp = {};
  try { const v = sRows[0]?.setting_value; lkp = (typeof v === 'string' ? JSON.parse(v) : v) || {}; } catch { /* default */ }
  const kode = (lkp.nd_kode || 'ELBAND/APTP').trim();

  const now = new Date();
  const bulan = now.getMonth() + 1, tahun = now.getFullYear();
  const [seqRows] = await pool.query('SELECT COALESCE(MAX(seq),0)+1 AS s FROM nota_dinas WHERE bulan = ? AND tahun = ?', [bulan, tahun]);
  const seq = seqRows[0].s;
  const nomor = `${String(seq).padStart(3, '0')}/${kode}/${ROMAN[bulan]}/${tahun}`;
  const loc = incident.device_loc ? ` di ${incident.device_loc}` : '';
  const hal = `Laporan Kerusakan dan Perbaikan ${incident.device_name}${loc}`;
  const tanggal = now.toISOString().slice(0, 10);

  const [r] = await pool.query(
    `INSERT INTO nota_dinas (jenis, nomor, seq, bulan, tahun, incident_id, hal, tanggal, created_by, creator_name)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ['LKP', nomor, seq, bulan, tahun, incidentId, hal, tanggal, user.id, user.name]
  );
  const [rows] = await pool.query('SELECT * FROM nota_dinas WHERE id = ?', [r.insertId]);
  return { nota: rows[0], reused: false };
}

// Buat (atau ambil) Nota Dinas pengantar untuk laporan kerusakan sebuah insiden.
export async function createNotaDinas(req, res) {
  const id = req.params.id;
  const [incCheck] = await pool.query('SELECT id FROM incidents WHERE id = ?', [id]);
  if (!incCheck[0]) return res.status(404).json({ error: 'Insiden tidak ditemukan' });

  const result = await ensureNotaDinasSurat(id, req.user);
  if (!result) return res.status(500).json({ error: 'Gagal membuat nota dinas' });

  // Jika LKP sudah di-TTE tapi nota_dinas belum disahkan, auto-sahkan sekarang.
  if (!result.nota.sign_token) {
    const [rptRows] = await pool.query(
      'SELECT signed_by, signer_name, signer_nip, signed_at FROM incident_reports WHERE incident_id = ? AND sign_token IS NOT NULL LIMIT 1',
      [id]
    );
    if (rptRows[0]) {
      const rpt = rptRows[0];
      const ts = new Date(rpt.signed_at);
      const spayload = `SURAT|${result.nota.nomor}|${result.nota.hal}|${rpt.signed_by}|${rpt.signer_name}|${ts.toISOString()}`;
      const stoken = 'NS' + crypto.createHmac('sha256', env.jwtSecret).update(spayload).digest('hex').slice(0, 22).toUpperCase();
      await pool.query(
        `UPDATE nota_dinas SET signed_by=?, signer_name=?, signer_nip=?, signed_at=?, sign_token=? WHERE id=?`,
        [rpt.signed_by, rpt.signer_name, rpt.signer_nip, ts, stoken, result.nota.id]
      );
      const [upd] = await pool.query('SELECT * FROM nota_dinas WHERE id = ?', [result.nota.id]);
      result.nota = upd[0];
    }
  }

  res.status(result.reused ? 200 : 201).json(result);
}

// Verifikasi publik TTE via token (tanpa auth). Dipakai saat QR dipindai.
export async function verifyTte(req, res) {
  const token = String(req.params.token || '').trim();
  const [rows] = await pool.query(
    `SELECT r.incident_id, r.signer_name, r.signer_nip, r.signed_at, r.hasil, r.reporter_name,
            i.device_name, i.ip, i.issue, i.priority, i.resolved_at
       FROM incident_reports r JOIN incidents i ON i.id = r.incident_id
      WHERE r.sign_token = ? LIMIT 1`,
    [token]
  );
  if (rows[0]) return res.json({ valid: true, jenis: 'LKP', token, ...rows[0] });

  // Cek juga surat keluar / nota dinas ber-TTE.
  const [srows] = await pool.query(
    'SELECT jenis, nomor, hal, tanggal, signer_name, signer_nip, signed_at, creator_name FROM nota_dinas WHERE sign_token = ? LIMIT 1',
    [token]
  );
  if (srows[0]) return res.json({ valid: true, jenis: srows[0].jenis || 'Surat', token, ...srows[0] });

  // TTE Kepala Seksi (pengesahan) — token berawalan NK.
  const [krows] = await pool.query(
    'SELECT jenis, nomor, hal, tanggal, creator_name, kasi_signer_name AS signer_name, kasi_signer_nip AS signer_nip, kasi_signed_at AS signed_at FROM nota_dinas WHERE kasi_sign_token = ? LIMIT 1',
    [token]
  );
  if (krows[0]) return res.json({ valid: true, jenis: `Pengesahan Kepala Seksi · ${krows[0].jenis || 'Surat'}`, token, ...krows[0] });

  // TTD Pelaksana Lembur — token berawalan PK, tersimpan di body JSON Surat Pernyataan.
  if (token.startsWith('PK')) {
    const [prows] = await pool.query(
      "SELECT nomor, hal, tanggal, jenis, body FROM nota_dinas WHERE jenis='Surat Pernyataan' AND body LIKE ? LIMIT 1",
      [`%${token}%`]
    );
    if (prows[0]) {
      let body = {};
      try { body = JSON.parse(prows[0].body || '{}'); } catch { body = {}; }
      const p = (Array.isArray(body.pegawai) ? body.pegawai : []).find((x) => x.sign_token === token);
      if (p) {
        return res.json({
          valid: true,
          jenis: `TTD Pelaksana Lembur · ${prows[0].jenis}`,
          token,
          nomor: prows[0].nomor, hal: prows[0].hal, tanggal: prows[0].tanggal,
          signer_name: p.nama, signer_nip: p.nip || null, signed_at: p.signed_at || null,
        });
      }
    }
  }

  res.json({ valid: false });
}

export async function resolveIncident(req, res) {
  const id = req.params.id;
  const { durationMin } = req.body;
  const [rows] = await pool.query('SELECT * FROM incidents WHERE id = ?', [id]);
  const incident = rows[0];
  if (!incident) return res.status(404).json({ error: 'Insiden tidak ditemukan' });
  if (incident.status === 'selesai') return res.status(400).json({ error: 'Insiden sudah selesai.' });
  // Wajib dibuktikan dengan dokumentasi: minimal 1 foto bukti pada kronologi.
  const [[doc]] = await pool.query('SELECT COUNT(*) c FROM incident_notes WHERE incident_id = ? AND doc_url IS NOT NULL', [id]);
  if (!doc.c) return res.status(400).json({ error: 'Unggah dokumentasi (foto bukti) penyelesaian terlebih dahulu — gunakan "Update Progress" dan lampirkan foto sebelum menutup insiden.' });
  const finalStep = FINAL_STEP;

  // Durasi = lama perangkat terputus (created_at → sekarang), dihitung otomatis.
  // Bisa dioverride lewat durationMin bila perlu koreksi manual.
  const resolverName = req.user?.name || 'MANUAL';
  if (durationMin) {
    await pool.query(
      `UPDATE incidents SET status='selesai', step=?, resolved_at=NOW(), resolution_type='MANUAL', resolved_by=?, duration_min=? WHERE id=?`,
      [finalStep, resolverName, durationMin, id]
    );
  } else {
    await pool.query(
      `UPDATE incidents SET status='selesai', step=?, resolved_at=NOW(), resolution_type='MANUAL', resolved_by=?,
         duration_min=GREATEST(1, TIMESTAMPDIFF(MINUTE, created_at, NOW())) WHERE id=?`,
      [finalStep, resolverName, id]
    );
  }
  const [durRows] = await pool.query('SELECT duration_min FROM incidents WHERE id = ?', [id]);
  const duration = durRows[0]?.duration_min || 0;
  await pool.query('INSERT INTO incident_notes (incident_id, step, note) VALUES (?, ?, ?)', [
    id, finalStep, `Insiden ditutup. Total perangkat terputus: ${Math.floor(duration / 60)}j ${duration % 60}m.`,
  ]);

  await notifyCoordinatorsDone(pool, incident, duration);

  const [updated] = await pool.query('SELECT * FROM incidents WHERE id = ?', [id]);
  res.json({ incident: (await attachNotes(updated))[0] });
}

export async function deleteIncident(req, res) {
  const id = req.params.id;
  const [rows] = await pool.query('SELECT * FROM incidents WHERE id = ?', [id]);
  if (!rows[0]) return res.status(404).json({ error: 'Insiden tidak ditemukan' });
  await pool.query('DELETE FROM incidents WHERE id = ?', [id]);
  res.json({ ok: true });
}
