import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { pool } from '../db/pool.js';

// =============================================================================
// maintenanceController — jendela maintenance terjadwal.
// Saat aktif, perangkat terkait tidak memicu insiden/alarm otomatis dan
// sampel metriknya tidak menurunkan SLA (lihat services/maintenanceService.js).
// =============================================================================

// Direktori dokumentasi foto penyelesaian jendela maintenance.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const MW_PHOTO_DIR = path.join(__dirname, '..', '..', 'uploads', 'maintenance-windows');
fs.mkdirSync(MW_PHOTO_DIR, { recursive: true });

export async function listMaintenanceWindows(req, res) {
  const scope = req.query.scope || 'all';
  let where = '';
  if (scope === 'active') where = 'WHERE NOW() BETWEEN mw.starts_at AND mw.ends_at';
  else if (scope === 'upcoming') where = 'WHERE mw.ends_at >= NOW()';
  const [rows] = await pool.query(
    `SELECT mw.*, d.name AS device_name, l.name AS location_name, u.name AS created_by_name,
            ud.name AS done_by_name,
            (NOW() BETWEEN mw.starts_at AND mw.ends_at) AS is_active,
            (SELECT COUNT(*) FROM maintenance_window_photos p WHERE p.window_id = mw.id) AS photo_count
       FROM maintenance_windows mw
       LEFT JOIN devices d ON d.id = mw.device_id
       LEFT JOIN locations l ON l.id = mw.location_id
       LEFT JOIN users u ON u.id = mw.created_by
       LEFT JOIN users ud ON ud.id = mw.done_by
       ${where}
      ORDER BY mw.starts_at DESC`
  );
  res.json({ windows: rows });
}

// Daftar foto dokumentasi sebuah jendela maintenance.
export async function listWindowPhotos(req, res) {
  const [photos] = await pool.query(
    `SELECT p.id, p.url, p.created_at, u.name AS uploaded_by_name
       FROM maintenance_window_photos p
       LEFT JOIN users u ON u.id = p.uploaded_by
      WHERE p.window_id = ? ORDER BY p.id ASC`,
    [req.params.id]
  );
  res.json({ photos });
}

// Unggah satu/banyak foto dokumentasi untuk sebuah jendela maintenance.
export async function addWindowPhotos(req, res) {
  const [[mw]] = await pool.query('SELECT id FROM maintenance_windows WHERE id = ?', [req.params.id]);
  if (!mw) return res.status(404).json({ error: 'Jendela maintenance tidak ditemukan.' });
  const files = req.files || [];
  if (!files.length) return res.status(400).json({ error: 'Tidak ada foto yang diunggah.' });
  for (const f of files) {
    await pool.query(
      'INSERT INTO maintenance_window_photos (window_id, url, uploaded_by) VALUES (?, ?, ?)',
      [req.params.id, `/uploads/maintenance-windows/${f.filename}`, req.user?.id || null]
    );
  }
  const [photos] = await pool.query(
    `SELECT p.id, p.url, p.created_at, u.name AS uploaded_by_name
       FROM maintenance_window_photos p LEFT JOIN users u ON u.id = p.uploaded_by
      WHERE p.window_id = ? ORDER BY p.id ASC`,
    [req.params.id]
  );
  res.status(201).json({ photos });
}

// Hapus satu foto dokumentasi (+ berkas di disk).
export async function removeWindowPhoto(req, res) {
  const [[ph]] = await pool.query('SELECT url FROM maintenance_window_photos WHERE id = ?', [req.params.photoId]);
  if (!ph) return res.status(404).json({ error: 'Foto tidak ditemukan.' });
  await pool.query('DELETE FROM maintenance_window_photos WHERE id = ?', [req.params.photoId]);
  try { fs.unlinkSync(path.join(MW_PHOTO_DIR, path.basename(ph.url))); } catch { /* berkas mungkin sudah tiada */ }
  res.json({ ok: true });
}

// Selesaikan pekerjaan jendela maintenance — WAJIB minimal 1 foto dokumentasi.
export async function completeMaintenanceWindow(req, res) {
  const id = Number(req.params.id);
  const [[mw]] = await pool.query('SELECT id, status FROM maintenance_windows WHERE id = ?', [id]);
  if (!mw) return res.status(404).json({ error: 'Jendela maintenance tidak ditemukan.' });
  const [[pc]] = await pool.query('SELECT COUNT(*) AS c FROM maintenance_window_photos WHERE window_id = ?', [id]);
  if (pc.c === 0) return res.status(400).json({ error: 'Unggah minimal 1 foto dokumentasi sebelum menyelesaikan pekerjaan.' });
  await pool.query(
    "UPDATE maintenance_windows SET status='selesai', done_note=?, done_by=?, done_at=NOW() WHERE id=?",
    [req.body.note?.trim() || null, req.user?.id || null, id]
  );
  const [rows] = await pool.query('SELECT * FROM maintenance_windows WHERE id = ?', [id]);
  res.json({ window: rows[0] });
}

export async function createMaintenanceWindow(req, res) {
  const { device_id, location_id, title, reason, starts_at, ends_at } = req.body;
  if (!title || !starts_at || !ends_at) {
    return res.status(400).json({ error: 'Judul, waktu mulai, dan waktu selesai wajib diisi' });
  }
  if (new Date(ends_at) <= new Date(starts_at)) {
    return res.status(400).json({ error: 'Waktu selesai harus setelah waktu mulai' });
  }
  const [result] = await pool.query(
    `INSERT INTO maintenance_windows (device_id, location_id, title, reason, starts_at, ends_at, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [device_id || null, location_id || null, title.trim(), reason?.trim() || null, starts_at, ends_at, req.user?.id || null]
  );
  const [rows] = await pool.query('SELECT * FROM maintenance_windows WHERE id = ?', [result.insertId]);
  res.status(201).json({ window: rows[0] });
}

export async function updateMaintenanceWindow(req, res) {
  const id = Number(req.params.id);
  const [existing] = await pool.query('SELECT * FROM maintenance_windows WHERE id = ?', [id]);
  if (!existing[0]) return res.status(404).json({ error: 'Jendela maintenance tidak ditemukan' });
  const { device_id, location_id, title, reason, starts_at, ends_at } = req.body;
  const next = {
    device_id: device_id === undefined ? existing[0].device_id : (device_id || null),
    location_id: location_id === undefined ? existing[0].location_id : (location_id || null),
    title: title === undefined ? existing[0].title : title.trim(),
    reason: reason === undefined ? existing[0].reason : (reason?.trim() || null),
    starts_at: starts_at ?? existing[0].starts_at,
    ends_at: ends_at ?? existing[0].ends_at,
  };
  if (new Date(next.ends_at) <= new Date(next.starts_at)) {
    return res.status(400).json({ error: 'Waktu selesai harus setelah waktu mulai' });
  }
  await pool.query(
    `UPDATE maintenance_windows SET device_id=?, location_id=?, title=?, reason=?, starts_at=?, ends_at=? WHERE id=?`,
    [next.device_id, next.location_id, next.title, next.reason, next.starts_at, next.ends_at, id]
  );
  const [rows] = await pool.query('SELECT * FROM maintenance_windows WHERE id = ?', [id]);
  res.json({ window: rows[0] });
}

export async function deleteMaintenanceWindow(req, res) {
  const id = Number(req.params.id);
  await pool.query('DELETE FROM maintenance_windows WHERE id = ?', [id]);
  res.json({ ok: true });
}
