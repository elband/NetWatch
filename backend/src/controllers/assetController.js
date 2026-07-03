import crypto from 'crypto';
import { pool } from '../db/pool.js';
import { unitFilter, unitFilterShared, rowInUnit, insertUnitId } from '../middleware/unitScope.js';

// Aset non-IP (Fase 2 multi-unit): peralatan fisik AAB/WPS dimodelkan sebagai baris
// `devices` dgn asset_class='physical' — mewarisi insiden, logbook, inspeksi via device_id.
// Aset fisik: ip='N/A-<id>', monitor_enabled=0 → dilewati ping worker (pingService.js).

const OP_STATUS = ['operasional', 'standby', 'rusak', 'perbaikan'];
const newQrToken = () => crypto.randomBytes(16).toString('hex'); // 32 hex chars

// Catat perubahan status aset → sumber laporan availability/MTBF/MTTR (Fase 3).
// Menerima pool atau koneksi transaksi.
export async function logAssetStatus(db, deviceId, unitId, opStatus, userId = null) {
  await db.query(
    'INSERT INTO asset_status_log (device_id, unit_id, op_status, changed_by) VALUES (?,?,?,?)',
    [deviceId, unitId ?? null, opStatus, userId]
  );
}

// ————— Aset fisik —————

export async function listAssets(req, res) {
  const uf = unitFilter(req.unitId, 'd.unit_id');
  const [rows] = await pool.query(
    `SELECT d.id, d.unit_id, d.name, d.category, d.type, d.merk, d.model, d.serial, d.tahun,
            d.icon, d.photo_url, d.loc, d.location_id, d.op_status, d.qr_token, d.created_at,
            loc.name AS location_name, u.code AS unit_code
       FROM devices d
       LEFT JOIN locations loc ON loc.id = d.location_id
       LEFT JOIN units u ON u.id = d.unit_id
      WHERE d.asset_class = 'physical'${uf.clause}
      ORDER BY d.name`,
    uf.params
  );
  res.json({ assets: rows });
}

export async function getAsset(req, res) {
  const id = Number(req.params.id);
  const [[asset]] = await pool.query(
    `SELECT d.*, loc.name AS location_name, u.code AS unit_code, u.name AS unit_name
       FROM devices d LEFT JOIN locations loc ON loc.id = d.location_id
       LEFT JOIN units u ON u.id = d.unit_id
      WHERE d.id = ? AND d.asset_class = 'physical'`,
    [id]
  );
  if (!asset || !rowInUnit(asset, req.unitId)) return res.status(404).json({ error: 'Aset tidak ditemukan' });
  const latest = await latestReadingsFor(id);
  res.json({ asset, latest });
}

export async function createAsset(req, res) {
  const { name, category, type, merk, model, serial, tahun, icon, loc, location_id, op_status } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: 'Nama aset wajib diisi' });
  const unitId = insertUnitId(req);
  if (unitId == null) return res.status(400).json({ error: 'Pilih unit terlebih dahulu.' });
  const locId = location_id === '' || location_id == null ? null : Number(location_id);
  const opStatus = OP_STATUS.includes(op_status) ? op_status : 'operasional';
  const conn = await pool.getConnection();
  try {
    // ip sementara 'N/A' → diganti 'N/A-<id>' setelah dapat insertId. monitor_enabled=0 wajib.
    const [result] = await conn.query(
      `INSERT INTO devices (unit_id, asset_class, name, ip, type, category, merk, model, serial, tahun,
         icon, photo_url, loc, location_id, op_status, qr_token, monitor_enabled, inspect_required, status)
       VALUES (?, 'physical', ?, 'N/A', ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, 0, 1, 'offline')`,
      [unitId, name.trim(), (type?.trim() || category?.trim() || 'Peralatan'), category?.trim() || null,
       merk?.trim() || null, model?.trim() || null, serial?.trim() || null, tahun?.toString().trim() || null,
       icon?.trim() || '🔧', loc?.trim() || null, locId, opStatus, newQrToken()]
    );
    await conn.query("UPDATE devices SET ip = CONCAT('N/A-', id) WHERE id = ?", [result.insertId]);
    await logAssetStatus(conn, result.insertId, unitId, opStatus, req.user.id);
    const [[asset]] = await conn.query('SELECT * FROM devices WHERE id = ?', [result.insertId]);
    res.status(201).json({ asset });
  } finally {
    conn.release();
  }
}

export async function updateAsset(req, res) {
  const id = Number(req.params.id);
  const [[existing]] = await pool.query("SELECT * FROM devices WHERE id = ? AND asset_class = 'physical'", [id]);
  if (!existing || !rowInUnit(existing, req.unitId)) return res.status(404).json({ error: 'Aset tidak ditemukan' });
  const { name, category, type, merk, model, serial, tahun, icon, loc, location_id, op_status } = req.body;
  const opStatus = op_status === undefined ? existing.op_status : (OP_STATUS.includes(op_status) ? op_status : existing.op_status);
  await pool.query(
    `UPDATE devices SET name=?, type=?, category=?, merk=?, model=?, serial=?, tahun=?, icon=?, loc=?, location_id=?, op_status=?
      WHERE id = ?`,
    [
      name?.trim() ?? existing.name,
      type?.trim() ?? existing.type,
      category === '' ? null : (category?.trim() ?? existing.category),
      merk === '' ? null : (merk?.trim() ?? existing.merk),
      model === '' ? null : (model?.trim() ?? existing.model),
      serial === '' ? null : (serial?.trim() ?? existing.serial),
      tahun === '' ? null : (tahun?.toString().trim() ?? existing.tahun),
      icon?.trim() ?? existing.icon,
      loc === '' ? null : (loc?.trim() ?? existing.loc),
      location_id === undefined ? existing.location_id : (location_id === '' || location_id == null ? null : Number(location_id)),
      opStatus,
      id,
    ]
  );
  const [[asset]] = await pool.query('SELECT * FROM devices WHERE id = ?', [id]);
  res.json({ asset });
}

export async function setAssetStatus(req, res) {
  const id = Number(req.params.id);
  const { op_status } = req.body;
  if (!OP_STATUS.includes(op_status)) return res.status(400).json({ error: 'Status tidak valid.' });
  const [[existing]] = await pool.query("SELECT id, unit_id FROM devices WHERE id = ? AND asset_class = 'physical'", [id]);
  if (!existing || !rowInUnit(existing, req.unitId)) return res.status(404).json({ error: 'Aset tidak ditemukan' });
  await pool.query('UPDATE devices SET op_status = ? WHERE id = ?', [op_status, id]);
  await logAssetStatus(pool, id, existing.unit_id, op_status, req.user.id);
  res.json({ ok: true, op_status });
}

export async function deleteAsset(req, res) {
  const id = Number(req.params.id);
  const [[existing]] = await pool.query("SELECT id, unit_id FROM devices WHERE id = ? AND asset_class = 'physical'", [id]);
  if (!existing || !rowInUnit(existing, req.unitId)) return res.status(404).json({ error: 'Aset tidak ditemukan' });
  await pool.query('DELETE FROM devices WHERE id = ?', [id]); // asset_readings CASCADE
  res.json({ ok: true });
}

// Regenerasi token QR (mis. bila stiker lama hilang/diganti).
export async function regenerateQr(req, res) {
  const id = Number(req.params.id);
  const [[existing]] = await pool.query("SELECT id, unit_id FROM devices WHERE id = ? AND asset_class = 'physical'", [id]);
  if (!existing || !rowInUnit(existing, req.unitId)) return res.status(404).json({ error: 'Aset tidak ditemukan' });
  const token = newQrToken();
  await pool.query('UPDATE devices SET qr_token = ? WHERE id = ?', [token, id]);
  res.json({ qr_token: token });
}

// ————— Pembacaan meter —————

async function latestReadingsFor(deviceId) {
  const [rows] = await pool.query(
    `SELECT r.metric, r.value, r.recorded_at
       FROM asset_readings r
       JOIN (SELECT metric, MAX(recorded_at) AS mx FROM asset_readings WHERE device_id = ? GROUP BY metric) t
         ON t.metric = r.metric AND t.mx = r.recorded_at
      WHERE r.device_id = ?`,
    [deviceId, deviceId]
  );
  return rows;
}

const READING_RANGE = { '30d': 30, '90d': 90, '1y': 365, all: null };

export async function listReadings(req, res) {
  const id = Number(req.params.id);
  const [[asset]] = await pool.query("SELECT id, unit_id FROM devices WHERE id = ? AND asset_class = 'physical'", [id]);
  if (!asset || !rowInUnit(asset, req.unitId)) return res.status(404).json({ error: 'Aset tidak ditemukan' });
  const metric = String(req.query.metric || '').trim();
  const days = READING_RANGE[req.query.range] !== undefined ? READING_RANGE[req.query.range] : 90;
  const where = ['device_id = ?'];
  const params = [id];
  if (metric) { where.push('metric = ?'); params.push(metric); }
  if (days) { where.push('recorded_at >= (NOW() - INTERVAL ? DAY)'); params.push(days); }
  const [rows] = await pool.query(
    `SELECT id, metric, value, note, photo_url, recorded_by, recorded_at
       FROM asset_readings WHERE ${where.join(' AND ')} ORDER BY recorded_at ASC`,
    params
  );
  res.json({ readings: rows });
}

export async function latestReadings(req, res) {
  const id = Number(req.params.id);
  const [[asset]] = await pool.query("SELECT id, unit_id FROM devices WHERE id = ? AND asset_class = 'physical'", [id]);
  if (!asset || !rowInUnit(asset, req.unitId)) return res.status(404).json({ error: 'Aset tidak ditemukan' });
  res.json({ latest: await latestReadingsFor(id) });
}

export async function addReading(req, res) {
  const id = Number(req.params.id);
  const [[asset]] = await pool.query("SELECT id, unit_id FROM devices WHERE id = ? AND asset_class = 'physical'", [id]);
  if (!asset || !rowInUnit(asset, req.unitId)) return res.status(404).json({ error: 'Aset tidak ditemukan' });
  const { metric, value, note, recorded_at } = req.body;
  if (!metric?.trim()) return res.status(400).json({ error: 'Metrik wajib dipilih.' });
  const num = Number(value);
  if (!Number.isFinite(num)) return res.status(400).json({ error: 'Nilai pembacaan harus berupa angka.' });
  // Metrik harus terdaftar untuk unit aset (atau global).
  const [[mt]] = await pool.query(
    'SELECT id FROM asset_metric_types WHERE metric_key = ? AND active = 1 AND (unit_id = ? OR unit_id IS NULL) LIMIT 1',
    [metric.trim(), asset.unit_id]
  );
  if (!mt) return res.status(400).json({ error: 'Metrik tidak dikenal untuk unit ini.' });
  const photoUrl = req.file ? `/uploads/assets/${req.file.filename}` : null;
  const when = recorded_at ? new Date(recorded_at) : null;
  const [r] = await pool.query(
    `INSERT INTO asset_readings (device_id, unit_id, metric, value, note, photo_url, recorded_by, recorded_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ${when && !isNaN(when) ? '?' : 'NOW()'})`,
    when && !isNaN(when)
      ? [id, asset.unit_id, metric.trim(), num, note?.trim() || null, photoUrl, req.user.id, when]
      : [id, asset.unit_id, metric.trim(), num, note?.trim() || null, photoUrl, req.user.id]
  );
  res.status(201).json({ id: r.insertId, photo_url: photoUrl });
}

// ————— Definisi metrik per unit —————

export async function listMetricTypes(req, res) {
  const uf = unitFilterShared(req.unitId); // global (NULL) + milik unit
  const [rows] = await pool.query(
    `SELECT * FROM asset_metric_types WHERE 1=1${uf.clause} ORDER BY sort_order, label`,
    uf.params
  );
  res.json({ metricTypes: rows });
}

export async function createMetricType(req, res) {
  const { metric_key, label, satuan, is_cumulative, sort_order } = req.body;
  if (!metric_key?.trim() || !label?.trim()) return res.status(400).json({ error: 'Kunci & label metrik wajib diisi.' });
  const unitId = insertUnitId(req);
  if (unitId == null) return res.status(400).json({ error: 'Pilih unit terlebih dahulu.' });
  const key = metric_key.trim().toLowerCase().replace(/[^a-z0-9_]/g, '_');
  try {
    const [r] = await pool.query(
      'INSERT INTO asset_metric_types (unit_id, metric_key, label, satuan, is_cumulative, sort_order) VALUES (?,?,?,?,?,?)',
      [unitId, key, label.trim(), satuan?.trim() || null, is_cumulative ? 1 : 0, Number(sort_order) || 0]
    );
    res.status(201).json({ id: r.insertId, metric_key: key });
  } catch (e) {
    if (e.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'Metrik dengan kunci itu sudah ada untuk unit ini.' });
    throw e;
  }
}

export async function updateMetricType(req, res) {
  const id = Number(req.params.id);
  const [[mt]] = await pool.query('SELECT * FROM asset_metric_types WHERE id = ?', [id]);
  if (!mt || !rowInUnit(mt, req.unitId)) return res.status(404).json({ error: 'Metrik tidak ditemukan' });
  const { label, satuan, is_cumulative, sort_order, active } = req.body;
  await pool.query(
    `UPDATE asset_metric_types SET label=COALESCE(?,label), satuan=?, is_cumulative=?, sort_order=COALESCE(?,sort_order), active=? WHERE id=?`,
    [label?.trim() || null, satuan?.trim() || null, is_cumulative ? 1 : 0, sort_order == null ? null : Number(sort_order),
     active == null ? mt.active : (active ? 1 : 0), id]
  );
  res.json({ ok: true });
}

export async function deleteMetricType(req, res) {
  const id = Number(req.params.id);
  const [[mt]] = await pool.query('SELECT * FROM asset_metric_types WHERE id = ?', [id]);
  if (!mt || !rowInUnit(mt, req.unitId)) return res.status(404).json({ error: 'Metrik tidak ditemukan' });
  await pool.query('DELETE FROM asset_metric_types WHERE id = ?', [id]);
  res.json({ ok: true });
}

// ————— Publik: landing scan QR (tanpa auth) —————

export async function getPublicAsset(req, res) {
  const token = String(req.params.token || '').trim();
  if (!/^[a-f0-9]{32}$/.test(token)) return res.status(404).json({ error: 'Kode QR tidak valid.' });
  const [[a]] = await pool.query(
    `SELECT d.id, d.name, d.category, d.type, d.merk, d.model, d.serial, d.loc, d.op_status, d.photo_url,
            d.unit_id, u.code AS unit_code, u.name AS unit_name
       FROM devices d LEFT JOIN units u ON u.id = d.unit_id
      WHERE d.qr_token = ? AND d.asset_class = 'physical' LIMIT 1`,
    [token]
  );
  if (!a) return res.status(404).json({ error: 'Aset tidak ditemukan.' });
  // Hanya data non-sensitif + payload prefill untuk form lapor kerusakan.
  res.json({
    asset: {
      id: a.id, name: a.name, category: a.category, type: a.type, merk: a.merk, model: a.model,
      serial: a.serial, loc: a.loc, op_status: a.op_status, photo_url: a.photo_url,
      unit_id: a.unit_id, unit_code: a.unit_code, unit_name: a.unit_name,
    },
    prefill: {
      unit_id: a.unit_id, jenis: a.type || a.category || 'Peralatan',
      merk: [a.merk, a.model].filter(Boolean).join(' ') || null, inv: a.serial || null,
      judul: `Kerusakan ${a.name}`, ruang: a.loc || null,
    },
  });
}
