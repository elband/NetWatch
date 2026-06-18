import crypto from 'crypto';
import { pool } from '../db/pool.js';
import { env } from '../config/env.js';
import { queueWaNotification } from '../jobs/waQueue.js';
import { createNotification, notifyRoles } from '../services/notify.js';
import { getOnDutyTechIds, getDutyStatus } from '../config/shifts.js';
import { remindOnDutyTechs } from '../services/coordWatcher.js';

// Alur tindakan insiden berbasis pilihan/cabang (solusi perbaikan peralatan):
// - Ber-IP: "Coba Lewat SSH" → bila gagal "Visit ke Perangkat".
// - Lanjut: "Analisa Kerusakan" → pilih "Menunggu Suku Cadang" / "Selesai – Normal Kembali".
// Tiap akhir (menunggu suku cadang / selesai) otomatis kirim WA ke koordinator.
const FINAL_STEP = 4;
const STEP_BY_ACTION = { ssh: 1, visit: 2, analisa: 3 };
// Ber-IP valid (IPv4) → boleh jalur SSH. Placeholder ("N/A …") dianggap tanpa IP.
const hasValidIp = (ip) => !!ip && /^\d{1,3}(\.\d{1,3}){3}$/.test(String(ip).trim());
const ACTION_LABEL = {
  ssh: '💻 Dicoba Lewat SSH',
  visit: '📍 Visit ke Perangkat',
  analisa: '🔧 Analisa Kerusakan',
  awaiting: '📦 Menunggu Suku Cadang',
  resolve: '✅ Selesai – Peralatan Normal Kembali',
};

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
    await queueWaNotification({ type, toUserId: uid, message, relatedIncidentId: incident.id });
  }
}

async function notifyCoordinatorsDone(conn, incident, duration) {
  await notifyCoordinators(conn, incident, `✅ PERALATAN NORMAL KEMBALI\n${incident.id} | ${incident.device_name}\nMasalah: ${incident.issue}\nDurasi: ${duration} menit`, 'done');
  await notifyRoles(['koordinator', 'admin'], { type: 'ticket_done', title: `Insiden selesai: ${incident.device_name}`, message: `${incident.id} ditangani dalam ${duration} menit`, refId: incident.id, refType: 'incident', link: '/reports' });
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
    await queueWaNotification({
      type: 'alert',
      toUserId: uid,
      message: `🚨 INSIDEN BARU (${(priority || 'sedang').toUpperCase()})\n${id} | ${deviceName}\nMasalah: ${issue}\nSegera AMBIL di aplikasi NetWatch.`,
      relatedIncidentId: id,
    });
    await createNotification({ userId: uid, type: 'ticket_assigned', priority: prio, title: `Tiket baru: ${deviceName}`, message: issue, refId: id, refType: 'incident', link: '/my-incidents' });
  }
  // Koordinator & admin: tiket helpdesk baru masuk.
  await notifyRoles(['koordinator', 'admin'], { type: 'ticket_new', priority: prio, title: `Insiden baru (${(priority || 'sedang').toUpperCase()})`, message: `${id} · ${deviceName} — ${issue}`, refId: id, refType: 'incident', link: '/incidents' });
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
  const byIncident = {};
  for (const n of notes) {
    (byIncident[n.incident_id] ||= []).push(n);
  }
  const reportByIncident = {};
  for (const r of reports) {
    reportByIncident[r.incident_id] = r;
  }
  return incidents.map((i) => ({
    ...i,
    notes: byIncident[i.id] || [],
    report: reportByIncident[i.id] || null,
  }));
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
    res.json({
      duty,
      pool: await attachNotes(poolRows),
      mine: await attachNotes(mineRows),
    });
  } finally {
    conn.release();
  }
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

    if (req.user.role === 'teknisi') {
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

  const n = await remindOnDutyTechs(incident, { manual: true, by: req.user.name });
  const [updated] = await pool.query('SELECT * FROM incidents WHERE id = ?', [id]);
  res.json({
    incident: (await attachNotes(updated))[0],
    remindedCount: n,
    message: n ? `Pengingat dikirim ke ${n} teknisi on-duty.` : 'Tidak ada teknisi on-duty saat ini.',
  });
}

async function nextIncidentId(conn) {
  const [rows] = await conn.query('SELECT COUNT(*) as c FROM incidents');
  return 'INC-' + String(rows[0].c + 1).padStart(3, '0');
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

    if (assigned) {
      await queueWaNotification({
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

// Catat satu tindakan pada insiden. body.action ∈ ssh|visit|handover|awaiting|resolve.
// Tiap tindakan wajib foto + penjelasan. SSH hanya untuk perangkat ber-IP.
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
    if (action === 'ssh' && !hasValidIp(incident.ip)) return res.status(400).json({ error: 'Tindakan SSH hanya untuk perangkat yang punya IP valid.' });

    const label = ACTION_LABEL[action];

    if (action === 'resolve') {
      // Selesai diperbaiki / teratasi: tutup insiden + WA koordinator.
      await conn.query(
        `UPDATE incidents SET step = ?, status = 'selesai', awaiting_part = 0, resolved_at = NOW(),
           duration_min = GREATEST(1, TIMESTAMPDIFF(MINUTE, created_at, NOW())) WHERE id = ?`,
        [FINAL_STEP, id]
      );
      const [durRows] = await conn.query('SELECT duration_min FROM incidents WHERE id = ?', [id]);
      const duration = durRows[0]?.duration_min || 0;
      await conn.query('INSERT INTO incident_notes (incident_id, step, note, doc_url) VALUES (?, ?, ?, ?)', [
        id, FINAL_STEP, `${label} (oleh ${req.user.name}): ${explanation} — insiden ditutup. Durasi: ${Math.floor(duration / 60)}j ${duration % 60}m.`, docUrl,
      ]);
      await notifyCoordinatorsDone(conn, incident, duration);
    } else if (action === 'awaiting') {
      // Menunggu suku cadang: tetap terbuka, ditandai pending. WA ke koordinator.
      await conn.query("UPDATE incidents SET awaiting_part = 1, status = 'proses' WHERE id = ?", [id]);
      await conn.query('INSERT INTO incident_notes (incident_id, step, note, doc_url) VALUES (?, ?, ?, ?)', [
        id, incident.step || 0, `${label} (oleh ${req.user.name}): ${explanation}`, docUrl,
      ]);
      await notifyCoordinators(conn, incident, `📦 MENUNGGU SUKU CADANG\n${incident.id} | ${incident.device_name}\nMasalah: ${incident.issue}\nOleh ${req.user.name}: ${explanation}\nMohon koordinasi pengadaan suku cadang.`);
    } else {
      // ssh / visit / handover.
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
  const [updated] = await pool.query('SELECT * FROM incident_reports WHERE incident_id = ?', [id]);
  res.json({ report: updated[0] });
}

const ROMAN = ['', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII'];

// Buat (atau ambil) Nota Dinas pengantar untuk laporan kerusakan sebuah insiden.
// Nomor otomatis berurut per bulan: {seq}/{kode}/{bulan-romawi}/{tahun}.
export async function createNotaDinas(req, res) {
  const id = req.params.id;
  const [incRows] = await pool.query(
    'SELECT i.*, d.loc AS device_loc FROM incidents i LEFT JOIN devices d ON d.id = i.device_id WHERE i.id = ?',
    [id]
  );
  const incident = incRows[0];
  if (!incident) return res.status(404).json({ error: 'Insiden tidak ditemukan' });

  // Sudah ada untuk insiden ini → pakai yang lama (nomor tidak berubah).
  const [exist] = await pool.query('SELECT * FROM nota_dinas WHERE incident_id = ? ORDER BY id DESC LIMIT 1', [id]);
  if (exist[0]) return res.json({ nota: exist[0], reused: true });

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
    `INSERT INTO nota_dinas (nomor, seq, bulan, tahun, incident_id, hal, tanggal, created_by, creator_name)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [nomor, seq, bulan, tahun, id, hal, tanggal, req.user.id, req.user.name]
  );
  const [rows] = await pool.query('SELECT * FROM nota_dinas WHERE id = ?', [r.insertId]);
  res.status(201).json({ nota: rows[0] });
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

  res.json({ valid: false });
}

export async function resolveIncident(req, res) {
  const id = req.params.id;
  const { durationMin } = req.body;
  const [rows] = await pool.query('SELECT * FROM incidents WHERE id = ?', [id]);
  const incident = rows[0];
  if (!incident) return res.status(404).json({ error: 'Insiden tidak ditemukan' });
  const finalStep = FINAL_STEP;

  // Durasi = lama perangkat terputus (created_at → sekarang), dihitung otomatis.
  // Bisa dioverride lewat durationMin bila perlu koreksi manual.
  if (durationMin) {
    await pool.query(
      `UPDATE incidents SET status='selesai', step=?, resolved_at=NOW(), duration_min=? WHERE id=?`,
      [finalStep, durationMin, id]
    );
  } else {
    await pool.query(
      `UPDATE incidents SET status='selesai', step=?, resolved_at=NOW(),
         duration_min=GREATEST(1, TIMESTAMPDIFF(MINUTE, created_at, NOW())) WHERE id=?`,
      [finalStep, id]
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
