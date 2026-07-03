import { pool } from '../db/pool.js';
import { unitFilter, unitFilterShared, rowInUnit, insertUnitId } from '../middleware/unitScope.js';
import { logAssetStatus } from './assetController.js';
import { nextIncidentId } from '../utils/incidentId.js';
import { snapshotAndNotifyOnDuty } from './incidentController.js';
import { recordMove } from './sparepartController.js';

// Fase 3 — checklist inspeksi, preventive maintenance (interval jam/kalender),
// dan laporan availability (MTBF/MTTR) untuk aset fisik (asset_class='physical').

// Verifikasi aset milik unit request (anti-IDOR). Kembalikan baris atau null.
async function assetInUnit(id, unitId) {
  const [[a]] = await pool.query("SELECT id, unit_id, name, op_status FROM devices WHERE id = ? AND asset_class = 'physical'", [id]);
  if (!a || !rowInUnit(a, unitId)) return null;
  return a;
}

// ─────────────────── 3a. Checklist templates ───────────────────

export async function listTemplates(req, res) {
  const uf = unitFilterShared(req.unitId, 't.unit_id');
  const [rows] = await pool.query(
    `SELECT t.*, (SELECT COUNT(*) FROM checklist_template_items i WHERE i.template_id = t.id) AS item_count
       FROM checklist_templates t WHERE 1=1${uf.clause} ORDER BY t.name`,
    uf.params
  );
  // Sertakan item agar frontend bisa langsung menampilkan/isi.
  for (const t of rows) {
    const [items] = await pool.query('SELECT id, label, category, sort_order FROM checklist_template_items WHERE template_id = ? ORDER BY sort_order, id', [t.id]);
    t.items = items;
  }
  res.json({ templates: rows });
}

export async function createTemplate(req, res) {
  const { name, category, items } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: 'Nama template wajib diisi.' });
  const unitId = insertUnitId(req);
  if (unitId == null) return res.status(400).json({ error: 'Pilih unit terlebih dahulu.' });
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [r] = await conn.query('INSERT INTO checklist_templates (unit_id, name, category) VALUES (?,?,?)', [unitId, name.trim(), category?.trim() || null]);
    await insertItems(conn, r.insertId, items);
    await conn.commit();
    res.status(201).json({ id: r.insertId });
  } catch (e) { await conn.rollback(); throw e; }
  finally { conn.release(); }
}

export async function updateTemplate(req, res) {
  const id = Number(req.params.id);
  const [[t]] = await pool.query('SELECT * FROM checklist_templates WHERE id = ?', [id]);
  if (!t || !rowInUnit(t, req.unitId)) return res.status(404).json({ error: 'Template tidak ditemukan' });
  const { name, category, active, items } = req.body;
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    await conn.query('UPDATE checklist_templates SET name=COALESCE(?,name), category=?, active=? WHERE id=?',
      [name?.trim() || null, category?.trim() || null, active == null ? t.active : (active ? 1 : 0), id]);
    if (Array.isArray(items)) {
      await conn.query('DELETE FROM checklist_template_items WHERE template_id = ?', [id]);
      await insertItems(conn, id, items);
    }
    await conn.commit();
    res.json({ ok: true });
  } catch (e) { await conn.rollback(); throw e; }
  finally { conn.release(); }
}

export async function deleteTemplate(req, res) {
  const id = Number(req.params.id);
  const [[t]] = await pool.query('SELECT id, unit_id FROM checklist_templates WHERE id = ?', [id]);
  if (!t || !rowInUnit(t, req.unitId)) return res.status(404).json({ error: 'Template tidak ditemukan' });
  await pool.query('DELETE FROM checklist_templates WHERE id = ?', [id]);
  res.json({ ok: true });
}

async function insertItems(conn, templateId, items) {
  if (!Array.isArray(items)) return;
  let i = 0;
  for (const it of items) {
    const label = (typeof it === 'string' ? it : it?.label)?.trim();
    const category = typeof it === 'object' && it?.category ? String(it.category).trim().slice(0, 60) : null;
    if (label) { await conn.query('INSERT INTO checklist_template_items (template_id, label, category, sort_order) VALUES (?,?,?,?)', [templateId, label, category, i]); i++; }
  }
}

// ─────────────────── 3a. Checklist runs (per aset) ───────────────────

// Template yang cocok untuk aset (kategori sama atau template unit tanpa kategori) + riwayat run.
export async function assetChecklist(req, res) {
  const asset = await assetInUnit(Number(req.params.id), req.unitId);
  if (!asset) return res.status(404).json({ error: 'Aset tidak ditemukan' });
  const [[dev]] = await pool.query('SELECT category, type FROM devices WHERE id = ?', [asset.id]);
  const uf = unitFilterShared(req.unitId, 'unit_id');
  const [templates] = await pool.query(
    `SELECT * FROM checklist_templates WHERE active=1${uf.clause} AND (category IS NULL OR category = ? OR category = ?) ORDER BY name`,
    [...uf.params, dev?.category || '', dev?.type || '']
  );
  for (const t of templates) {
    const [items] = await pool.query('SELECT id, label, category FROM checklist_template_items WHERE template_id = ? ORDER BY sort_order, id', [t.id]);
    t.items = items;
  }
  const [runs] = await pool.query(
    `SELECT r.*, u.name AS done_by_name FROM checklist_runs r LEFT JOIN users u ON u.id = r.done_by
      WHERE r.device_id = ? ORDER BY r.created_at DESC LIMIT 30`, [asset.id]
  );
  for (const run of runs) {
    const [items] = await pool.query('SELECT label, category, result, note FROM checklist_run_items WHERE run_id = ?', [run.id]);
    run.items = items;
  }
  res.json({ templates, runs });
}

export async function createRun(req, res) {
  const asset = await assetInUnit(Number(req.params.id), req.unitId);
  if (!asset) return res.status(404).json({ error: 'Aset tidak ditemukan' });
  const overall = ['baik', 'perhatian', 'rusak'].includes(req.body.overall) ? req.body.overall : 'baik';
  let items = req.body.items;
  if (typeof items === 'string') { try { items = JSON.parse(items); } catch { items = []; } }
  const note = req.body.note?.trim() || null;
  const photoUrl = req.file ? `/uploads/assets/${req.file.filename}` : null;
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [r] = await conn.query(
      `INSERT INTO checklist_runs (device_id, unit_id, template_id, run_date, overall, note, photo_url, done_by)
       VALUES (?,?,?,CURDATE(),?,?,?,?)`,
      [asset.id, asset.unit_id, req.body.template_id ? Number(req.body.template_id) : null, overall, note, photoUrl, req.user.id]
    );
    for (const it of (Array.isArray(items) ? items : [])) {
      if (!it?.label) continue;
      const result = ['ok', 'tidak', 'na'].includes(it.result) ? it.result : 'ok';
      await conn.query('INSERT INTO checklist_run_items (run_id, label, category, result, note) VALUES (?,?,?,?,?)', [r.insertId, String(it.label).slice(0, 160), it.category ? String(it.category).slice(0,60) : null, result, it.note?.trim() || null]);
    }
    // Keputusan user: overall='rusak' → set op_status='rusak' + tawarkan insiden.
    let incidentId = null;
    if (overall === 'rusak') {
      if (asset.op_status !== 'rusak') {
        await conn.query("UPDATE devices SET op_status='rusak' WHERE id=?", [asset.id]);
        await logAssetStatus(conn, asset.id, asset.unit_id, 'rusak', req.user.id);
      }
      // Buat insiden bila diminta (create_incident=1) & belum ada insiden aktif.
      if (String(req.body.create_incident) === '1') {
        const [ex] = await conn.query("SELECT id FROM incidents WHERE device_id=? AND status<>'selesai' LIMIT 1", [asset.id]);
        if (!ex.length) {
          incidentId = await nextIncidentId(conn);
          const issue = `Kerusakan terdeteksi saat checklist: ${note || 'lihat detail checklist'}`;
          await conn.query(
            `INSERT INTO incidents (id, unit_id, device_id, device_name, ip, issue, priority, tech_id, status, step, source)
             VALUES (?,?,?,?,?,?, 'tinggi', NULL, 'aktif', 0, 'manual')`,
            [incidentId, asset.unit_id, asset.id, asset.name, `N/A-${asset.id}`, issue]
          );
          await conn.query('INSERT INTO incident_notes (incident_id, step, note) VALUES (?,0,?)', [incidentId, `Insiden dibuat dari checklist rusak oleh ${req.user.name}.`]);
        }
      }
    }
    await conn.commit();
    // Notifikasi on-duty di luar transaksi (best-effort).
    if (incidentId) { try { await snapshotAndNotifyOnDuty(pool, { id: incidentId, priority: 'tinggi', deviceName: asset.name, issue: 'Kerusakan dari checklist' }); } catch { /* abaikan */ } }
    res.status(201).json({ id: r.insertId, incidentId });
  } catch (e) { await conn.rollback(); throw e; }
  finally { conn.release(); }
}

// ─────────────────── 3b. Preventive maintenance ───────────────────

// Nilai kumulatif terakhir suatu metrik untuk sebuah aset (untuk PM 'hours').
async function latestMetricValue(deviceId, metricKey) {
  if (!metricKey) return null;
  const [[r]] = await pool.query(
    'SELECT value FROM asset_readings WHERE device_id = ? AND metric = ? ORDER BY recorded_at DESC LIMIT 1',
    [deviceId, metricKey]
  );
  return r ? Number(r.value) : null;
}

// Hitung status jatuh tempo sebuah plan (tidak disimpan — selalu segar).
function pmStatus(plan, current, today) {
  if (plan.trigger_type === 'hours') {
    const interval = plan.interval_hours == null ? null : Number(plan.interval_hours);
    const anchor = plan.anchor_value == null ? null : Number(plan.anchor_value);
    if (current == null || anchor == null || !interval) return { kind: 'hours', current, due: false, incomplete: true };
    const dueAt = anchor + interval;
    const remaining = dueAt - current;
    return { kind: 'hours', current, anchor, interval, due_at_value: dueAt, remaining, progress: Math.max(0, Math.min(1, (current - anchor) / interval)), due: remaining <= 0 };
  }
  // calendar
  const days = plan.interval_days == null ? null : Number(plan.interval_days);
  if (!plan.anchor_date || !days) return { kind: 'calendar', due: false, incomplete: true };
  const anchor = new Date(plan.anchor_date);
  const dueDate = new Date(anchor.getTime() + days * 86400000);
  const remainingDays = Math.ceil((dueDate - today) / 86400000);
  return { kind: 'calendar', due_date: dueDate.toISOString().slice(0, 10), remaining_days: remainingDays, progress: Math.max(0, Math.min(1, 1 - remainingDays / days)), due: today >= dueDate };
}

export async function listPm(req, res) {
  const asset = await assetInUnit(Number(req.params.id), req.unitId);
  if (!asset) return res.status(404).json({ error: 'Aset tidak ditemukan' });
  const [plans] = await pool.query('SELECT * FROM asset_pm_plans WHERE device_id = ? ORDER BY active DESC, name', [asset.id]);
  const today = new Date();
  for (const p of plans) {
    const cur = p.trigger_type === 'hours' ? await latestMetricValue(asset.id, p.metric_key) : null;
    p.status = pmStatus(p, cur, today);
    const [hist] = await pool.query('SELECT h.*, u.name AS done_by_name FROM asset_pm_history h LEFT JOIN users u ON u.id=h.done_by WHERE h.plan_id = ? ORDER BY h.done_at DESC LIMIT 10', [p.id]);
    p.history = hist;
  }
  res.json({ plans });
}

export async function createPm(req, res) {
  const asset = await assetInUnit(Number(req.params.id), req.unitId);
  if (!asset) return res.status(404).json({ error: 'Aset tidak ditemukan' });
  const { name, trigger_type, metric_key, interval_hours, interval_days, anchor_value, anchor_date } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: 'Nama PM wajib diisi.' });
  const type = trigger_type === 'calendar' ? 'calendar' : 'hours';
  if (type === 'hours' && (!interval_hours || !metric_key)) return res.status(400).json({ error: 'PM jam operasi butuh metrik & interval jam.' });
  if (type === 'calendar' && !interval_days) return res.status(400).json({ error: 'PM kalender butuh interval hari.' });
  // Anchor default: nilai meter terkini / hari ini.
  const anchorVal = type === 'hours' ? (anchor_value != null && anchor_value !== '' ? Number(anchor_value) : (await latestMetricValue(asset.id, metric_key) ?? 0)) : null;
  const anchorDate = type === 'calendar' ? (anchor_date || new Date().toISOString().slice(0, 10)) : null;
  const [r] = await pool.query(
    `INSERT INTO asset_pm_plans (device_id, unit_id, name, trigger_type, metric_key, interval_hours, interval_days, anchor_value, anchor_date)
     VALUES (?,?,?,?,?,?,?,?,?)`,
    [asset.id, asset.unit_id, name.trim(), type, type === 'hours' ? metric_key : null,
     type === 'hours' ? Number(interval_hours) : null, type === 'calendar' ? Number(interval_days) : null, anchorVal, anchorDate]
  );
  res.status(201).json({ id: r.insertId });
}

export async function updatePm(req, res) {
  const id = Number(req.params.planId);
  const [[p]] = await pool.query('SELECT * FROM asset_pm_plans WHERE id = ?', [id]);
  if (!p || !rowInUnit(p, req.unitId)) return res.status(404).json({ error: 'PM tidak ditemukan' });
  const { name, interval_hours, interval_days, metric_key, anchor_value, anchor_date, active } = req.body;
  await pool.query(
    `UPDATE asset_pm_plans SET name=COALESCE(?,name), metric_key=COALESCE(?,metric_key),
       interval_hours=COALESCE(?,interval_hours), interval_days=COALESCE(?,interval_days),
       anchor_value=COALESCE(?,anchor_value), anchor_date=COALESCE(?,anchor_date), active=? WHERE id=?`,
    [name?.trim() || null, metric_key || null,
     interval_hours == null || interval_hours === '' ? null : Number(interval_hours),
     interval_days == null || interval_days === '' ? null : Number(interval_days),
     anchor_value == null || anchor_value === '' ? null : Number(anchor_value),
     anchor_date || null, active == null ? p.active : (active ? 1 : 0), id]
  );
  res.json({ ok: true });
}

export async function deletePm(req, res) {
  const id = Number(req.params.planId);
  const [[p]] = await pool.query('SELECT id, unit_id FROM asset_pm_plans WHERE id = ?', [id]);
  if (!p || !rowInUnit(p, req.unitId)) return res.status(404).json({ error: 'PM tidak ditemukan' });
  await pool.query('DELETE FROM asset_pm_plans WHERE id = ?', [id]);
  res.json({ ok: true });
}

// Tandai PM selesai → catat riwayat + reset anchor (siklus berikutnya mulai dari sini).
export async function donePm(req, res) {
  const id = Number(req.params.planId);
  const [[p]] = await pool.query('SELECT * FROM asset_pm_plans WHERE id = ?', [id]);
  if (!p || !rowInUnit(p, req.unitId)) return res.status(404).json({ error: 'PM tidak ditemukan' });
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    let meterVal = null;
    if (p.trigger_type === 'hours') {
      meterVal = req.body.meter_value != null && req.body.meter_value !== '' ? Number(req.body.meter_value) : await latestMetricValue(p.device_id, p.metric_key);
      await conn.query('UPDATE asset_pm_plans SET anchor_value = ? WHERE id = ?', [meterVal ?? p.anchor_value, id]);
    } else {
      await conn.query('UPDATE asset_pm_plans SET anchor_date = CURDATE() WHERE id = ?', [id]);
    }
    await conn.query('INSERT INTO asset_pm_history (plan_id, device_id, meter_value, note, done_by) VALUES (?,?,?,?,?)',
      [id, p.device_id, meterVal, req.body.note?.trim() || null, req.user.id]);
    // Fase 4: sparepart terpakai saat PM → move 'keluar' ref aset (kurangi stok).
    let parts = req.body.parts;
    if (typeof parts === 'string') { try { parts = JSON.parse(parts); } catch { parts = []; } }
    for (const pt of (Array.isArray(parts) ? parts : [])) {
      const spId = Number(pt?.sparepart_id); const qty = Number(pt?.qty);
      if (!spId || !Number.isFinite(qty) || qty <= 0) continue;
      const [[sp]] = await conn.query('SELECT * FROM spareparts WHERE id = ? AND (unit_id = ? OR unit_id IS NULL)', [spId, p.unit_id]);
      if (!sp) throw new Error('Sparepart tidak valid untuk unit ini.');
      await recordMove(sp, { type: 'keluar', qty, deviceId: p.device_id, note: `Dipakai PM: ${p.name}`, userId: req.user.id }, conn);
    }
    await conn.commit();
    res.json({ ok: true });
  } catch (e) { await conn.rollback(); throw e; }
  finally { conn.release(); }
}

// Daftar PM jatuh tempo untuk unit (badge/dashboard + dipakai reminder).
export async function listDue(req, res) {
  res.json({ due: await computeDuePlans(req.unitId) });
}

// Dipakai juga oleh job reminder — kembalikan plan yang due beserta info aset.
export async function computeDuePlans(unitId) {
  const uf = unitFilter(unitId, 'p.unit_id');
  const [plans] = await pool.query(
    `SELECT p.*, d.name AS asset_name, d.loc AS asset_loc
       FROM asset_pm_plans p JOIN devices d ON d.id = p.device_id
      WHERE p.active = 1${uf.clause}`, uf.params
  );
  const today = new Date();
  const due = [];
  for (const p of plans) {
    const cur = p.trigger_type === 'hours' ? await latestMetricValue(p.device_id, p.metric_key) : null;
    const st = pmStatus(p, cur, today);
    if (st.due) due.push({ id: p.id, device_id: p.device_id, unit_id: p.unit_id, name: p.name, asset_name: p.asset_name, asset_loc: p.asset_loc, status: st });
  }
  return due;
}

// ─────────────────── 3c. Availability / MTBF / MTTR ───────────────────

// Standby = netral (keputusan user): availability = operasional / (total − standby).
export async function availability(req, res) {
  const to = req.query.to ? new Date(req.query.to + 'T23:59:59') : new Date();
  const from = req.query.from ? new Date(req.query.from + 'T00:00:00') : new Date(to.getTime() - 30 * 86400000);
  const uf = unitFilter(req.unitId, 'd.unit_id');
  const [assets] = await pool.query(
    `SELECT d.id, d.name, d.op_status, d.loc FROM devices d WHERE d.asset_class='physical'${uf.clause} ORDER BY d.name`, uf.params
  );
  if (!assets.length) return res.json({ from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10), rows: [] });
  const ids = assets.map((a) => a.id);
  const [logs] = await pool.query(
    'SELECT device_id, op_status, changed_at FROM asset_status_log WHERE device_id IN (?) AND changed_at <= ? ORDER BY device_id, changed_at ASC',
    [ids, to]
  );
  const byDev = {};
  for (const l of logs) (byDev[l.device_id] ||= []).push(l);

  const rows = assets.map((a) => {
    const evs = byDev[a.id] || [];
    const dur = { operasional: 0, standby: 0, rusak: 0, perbaikan: 0 };
    let failures = 0, repairEpisodes = 0, prevUnplanned = false;
    // Status memasuki window = status dari event terakhir <= from.
    let idx = 0, stateAtFrom = null, lastBeforeIdx = -1;
    for (let i = 0; i < evs.length; i++) { if (evs[i].changed_at <= from) { stateAtFrom = evs[i].op_status; lastBeforeIdx = i; } }
    let cursor = from, state = stateAtFrom;
    idx = lastBeforeIdx + 1;
    if (state == null) {
      // Aset belum ada saat `from` → mulai dari event pertama dalam window.
      if (idx < evs.length) { cursor = evs[idx].changed_at > to ? to : evs[idx].changed_at; state = evs[idx].op_status; if (isUnplanned(state)) { failures += state === 'rusak' ? 1 : 0; repairEpisodes++; prevUnplanned = true; } idx++; }
    } else if (isUnplanned(state)) { prevUnplanned = true; }
    for (; idx < evs.length; idx++) {
      const ev = evs[idx];
      const t = ev.changed_at > to ? to : ev.changed_at;
      if (state != null && t > cursor) dur[state] += (t - cursor) / 1000;
      // transisi
      const nowUnplanned = isUnplanned(ev.op_status);
      if (ev.op_status === 'rusak' && state !== 'rusak') failures++;
      if (nowUnplanned && !prevUnplanned) repairEpisodes++;
      prevUnplanned = nowUnplanned;
      state = ev.op_status; cursor = t;
      if (t >= to) break;
    }
    if (state != null && to > cursor) dur[state] += (to - cursor) / 1000;

    const total = dur.operasional + dur.standby + dur.rusak + dur.perbaikan;
    const denom = total - dur.standby; // standby netral
    const unplanned = dur.rusak + dur.perbaikan;
    // Span terukur ~0 (mis. aset baru dibuat, periode berakhir "sekarang"): pakai status kini.
    const availPct = denom > 0
      ? (dur.operasional / denom) * 100
      : (a.op_status === 'standby' ? null : (a.op_status === 'operasional' ? 100 : 0));
    const mttr = repairEpisodes > 0 ? unplanned / repairEpisodes : null; // detik
    const mtbf = failures > 0 ? dur.operasional / failures : null; // detik
    return {
      id: a.id, name: a.name, loc: a.loc, op_status: a.op_status,
      availability_pct: availPct == null ? null : Math.round(availPct * 100) / 100,
      operasional_sec: Math.round(dur.operasional), standby_sec: Math.round(dur.standby),
      down_sec: Math.round(unplanned), failures,
      mttr_sec: mttr == null ? null : Math.round(mttr), mtbf_sec: mtbf == null ? null : Math.round(mtbf),
    };
  });
  res.json({ from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10), rows });
}

function isUnplanned(s) { return s === 'rusak' || s === 'perbaikan'; }

// ─────────────────── 5a. Grup fasilitas (master) & daftar pengadaan ───────────────────

export async function listFacilities(req, res) {
  const uf = unitFilterShared(req.unitId);
  const [rows] = await pool.query(`SELECT * FROM asset_facilities WHERE 1=1${uf.clause} ORDER BY sort_order, name`, uf.params);
  res.json({ facilities: rows });
}

export async function createFacility(req, res) {
  const { name, sort_order } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: 'Nama fasilitas wajib diisi.' });
  const unitId = insertUnitId(req);
  if (unitId == null) return res.status(400).json({ error: 'Pilih unit terlebih dahulu.' });
  try {
    const [r] = await pool.query('INSERT INTO asset_facilities (unit_id, name, sort_order) VALUES (?,?,?)', [unitId, name.trim(), Number(sort_order) || 0]);
    res.status(201).json({ id: r.insertId });
  } catch (e) {
    if (e.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'Fasilitas dengan nama itu sudah ada.' });
    throw e;
  }
}

export async function updateFacility(req, res) {
  const id = Number(req.params.id);
  const [[f]] = await pool.query('SELECT * FROM asset_facilities WHERE id = ?', [id]);
  if (!f || !rowInUnit(f, req.unitId)) return res.status(404).json({ error: 'Fasilitas tidak ditemukan' });
  const { name, sort_order, active } = req.body;
  // Sinkronkan aset yang memakai nama lama bila nama diubah.
  if (name?.trim() && name.trim() !== f.name) {
    await pool.query('UPDATE devices SET fasilitas = ? WHERE fasilitas = ? AND unit_id = ?', [name.trim(), f.name, f.unit_id]);
  }
  await pool.query('UPDATE asset_facilities SET name=COALESCE(?,name), sort_order=COALESCE(?,sort_order), active=? WHERE id=?',
    [name?.trim() || null, sort_order == null ? null : Number(sort_order), active == null ? f.active : (active ? 1 : 0), id]);
  res.json({ ok: true });
}

export async function deleteFacility(req, res) {
  const id = Number(req.params.id);
  const [[f]] = await pool.query('SELECT * FROM asset_facilities WHERE id = ?', [id]);
  if (!f || !rowInUnit(f, req.unitId)) return res.status(404).json({ error: 'Fasilitas tidak ditemukan' });
  await pool.query('DELETE FROM asset_facilities WHERE id = ?', [id]);
  res.json({ ok: true });
}

// Daftar kebutuhan pengadaan: aset kondisi RR/RB atau ber-catatan kebutuhan.
export async function procurement(req, res) {
  const uf = unitFilter(req.unitId, 'd.unit_id');
  const [rows] = await pool.query(
    `SELECT d.id, d.name, d.merk, d.model, d.serial, d.tahun, d.fasilitas, d.kondisi, d.kebutuhan, d.op_status
       FROM devices d
      WHERE d.asset_class = 'physical' AND (d.kondisi IN ('RR','RB') OR (d.kebutuhan IS NOT NULL AND d.kebutuhan <> ''))${uf.clause}
      ORDER BY FIELD(d.kondisi,'RB','RR','B'), d.fasilitas, d.name`,
    uf.params
  );
  res.json({ items: rows });
}
