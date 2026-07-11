import { Router } from 'express';
import multer from 'multer';
import { aoaToBuffer, bufferToAoa } from '../utils/xlsx.js';
import { pool } from '../db/pool.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { unitScope, unitFilter, rowInUnit, insertUnitId } from '../middleware/unitScope.js';
import { dateKey, SHIFT_WINDOWS, DEFAULT_SHIFT_WINDOWS, loadShiftWindows, getUnitWindows, ALL_SHIFT_TYPES } from '../config/shifts.js';

const router = Router();
router.use(requireAuth);
router.use(unitScope);

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });
// Kode resmi selaras Laporan Bulanan: N = Dinas Kantor (disimpan sbg 'Normal'), P = Pagi, S = Siang, L = Libur.
const ABBR = { pagi: 'P', siang: 'S', Normal: 'N', libur: 'L', dinas_luar: 'DL', cuti: 'C' };
// Terima singkatan (N/P/S/L/DL/C; M & 'malam' tetap diterima utk kompatibilitas impor lama) maupun
// kata penuh, tidak peka huruf besar/kecil.
const SHIFT_FROM = {
  p: 'pagi', pagi: 'pagi',
  s: 'siang', siang: 'siang',
  n: 'Normal', normal: 'Normal', m: 'Normal', malam: 'Normal', kantor: 'Normal',
  l: 'libur', libur: 'libur',
  dl: 'dinas_luar', dinas_luar: 'dinas_luar', 'dinas luar': 'dinas_luar',
  c: 'cuti', cuti: 'cuti',
};

function monthRange(month) {
  const [y, m] = month.split('-').map(Number);
  const days = new Date(y, m, 0).getDate();
  const pad = (n) => String(n).padStart(2, '0');
  const dates = Array.from({ length: days }, (_, i) => `${y}-${pad(m)}-${pad(i + 1)}`);
  return { start: `${y}-${pad(m)}-01`, end: `${m === 12 ? y + 1 : y}-${pad(m === 12 ? 1 : m + 1)}-01`, dates };
}

router.get('/', async (req, res) => {
  const { from, to } = req.query;
  const uf = unitFilter(req.unitId, 's.unit_id');
  let sql = `SELECT s.*, u.name as user_name FROM shifts s JOIN users u ON u.id = s.user_id WHERE 1=1${uf.clause}`;
  const params = [...uf.params];
  if (from) { sql += ' AND s.shift_date >= ?'; params.push(from); }
  if (to) { sql += ' AND s.shift_date <= ?'; params.push(to); }
  sql += ' ORDER BY s.shift_date';
  const [rows] = await pool.query(sql, params);
  res.json({ shifts: rows });
});

// ----- Aturan jam dinas (shift windows) -----
// GET: jam dinas efektif unit aktif + default (untuk modal "Atur Jam Dinas").
router.get('/shift-windows', (req, res) => {
  res.json({ windows: getUnitWindows(req.unitId), defaults: DEFAULT_SHIFT_WINDOWS, perUnit: req.unitId != null });
});

// PUT: ubah jam dinas PER UNIT (admin/koordinator). Simpan ke units.config.shift_windows.
router.put('/shift-windows', requireRole('admin', 'koordinator'), async (req, res) => {
  const unitId = insertUnitId(req);
  if (unitId == null) return res.status(400).json({ error: 'Pilih unit terlebih dahulu untuk mengatur jam dinasnya.' });
  const body = req.body || {};
  const out = {};
  for (const k of ['pagi', 'siang']) {
    const o = body[k];
    if (!o || typeof o !== 'object') return res.status(400).json({ error: `Jam untuk shift "${k}" wajib diisi.` });
    const start = Number(o.start), end = Number(o.end);
    if (![start, end].every((n) => Number.isFinite(n) && n >= 0 && n <= 24)) {
      return res.status(400).json({ error: `Jam shift "${k}" tidak valid (gunakan 0–24).` });
    }
    if (start === end) return res.status(400).json({ error: `Jam mulai & selesai shift "${k}" tidak boleh sama.` });
    out[k] = { start, end };
  }
  // Dinas Kantor (Normal) opsional — hanya disimpan bila dikirim & valid. Tidak dikirim = dinonaktifkan.
  const m = body.Normal;
  if (m && typeof m === 'object' && (m.start != null || m.end != null)) {
    const start = Number(m.start), end = Number(m.end);
    if (![start, end].every((n) => Number.isFinite(n) && n >= 0 && n <= 24)) {
      return res.status(400).json({ error: 'Jam shift "Dinas Kantor" tidak valid (gunakan 0–24).' });
    }
    if (start === end) return res.status(400).json({ error: 'Jam mulai & selesai shift "Dinas Kantor" tidak boleh sama.' });
    out.Normal = { start, end };
  }
  // Simpan ke units.config.shift_windows (per unit).
  const [[u]] = await pool.query('SELECT config FROM units WHERE id = ?', [unitId]);
  let cfg = u?.config;
  if (typeof cfg === 'string') { try { cfg = JSON.parse(cfg); } catch { cfg = {}; } }
  cfg = cfg && typeof cfg === 'object' ? cfg : {};
  cfg.shift_windows = out;
  await pool.query('UPDATE units SET config = ? WHERE id = ?', [JSON.stringify(cfg), unitId]);
  await loadShiftWindows(pool); // terapkan langsung tanpa restart
  res.json({ ok: true, windows: getUnitWindows(unitId) });
});

router.put('/:userId/:date', requireRole('admin', 'koordinator'), async (req, res) => {
  const { userId, date } = req.params;
  const { shiftType } = req.body;
  if (!ALL_SHIFT_TYPES.includes(shiftType)) {
    return res.status(400).json({ error: 'shiftType tidak valid' });
  }
  // Unit shift mengikuti unit milik USER TARGET; teknisi di luar scope unit = tidak terlihat (404).
  const [[target]] = await pool.query('SELECT id, unit_id FROM users WHERE id=?', [Number(userId)]);
  if (!target || !rowInUnit(target, req.unitId)) return res.status(404).json({ error: 'Teknisi tidak ditemukan.' });
  const unitId = target.unit_id ?? insertUnitId(req);
  if (unitId == null) return res.status(400).json({ error: 'Pilih unit terlebih dahulu.' });
  await pool.query(
    `INSERT INTO shifts (user_id, shift_date, shift_type, unit_id) VALUES (?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE shift_type = VALUES(shift_type), unit_id = VALUES(unit_id)`,
    [userId, date, shiftType, unitId]
  );
  res.json({ ok: true });
});

// ----- Template Excel jadwal (grid: baris=teknisi, kolom=tanggal bulan terpilih) -----
router.get('/template', requireRole('admin', 'koordinator'), async (req, res) => {
  const month = /^\d{4}-\d{2}$/.test(req.query.month)
    ? req.query.month
    : `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}`;
  const { start, end, dates } = monthRange(month);

  const ufU = unitFilter(req.unitId, 'unit_id');
  const [techs] = await pool.query(`SELECT id, username, name FROM users WHERE active=1 AND (role='teknisi' OR JSON_CONTAINS(roles, '"teknisi"'))${ufU.clause} ORDER BY name`, ufU.params);
  const [shifts] = await pool.query('SELECT user_id, shift_date, shift_type FROM shifts WHERE shift_date >= ? AND shift_date < ?', [start, end]);
  const map = {};
  for (const s of shifts) (map[s.user_id] ||= {})[dateKey(s.shift_date)] = s.shift_type;

  const header = ['username', 'nama', ...dates];
  const rows = techs.map((t) => [t.username, t.name, ...dates.map((d) => (map[t.id]?.[d] ? ABBR[map[t.id][d]] : ''))]);
  const note = ['# Isi sel dengan N=Dinas Kantor, P=Pagi, S=Siang, L=Libur. Kosongkan = tidak diubah. Jangan ubah kolom username.'];

  const buf = await aoaToBuffer('Jadwal ' + month, [note, header, ...rows], [14, 20, ...dates.map(() => 5)]);
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="template-jadwal-${month}.xlsx"`);
  res.send(buf);
});

// ----- Impor Excel jadwal (global) -----
router.post('/import', requireRole('admin', 'koordinator'), upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'File Excel wajib diunggah.' });
  let grid;
  try {
    grid = await bufferToAoa(req.file.buffer);
  } catch {
    return res.status(400).json({ error: 'File tidak dapat dibaca sebagai Excel.' });
  }
  // Cari baris header (yang sel pertamanya 'username').
  const headerIdx = grid.findIndex((r) => String(r?.[0] ?? '').toLowerCase().trim() === 'username');
  if (headerIdx < 0) return res.status(400).json({ error: 'Header tidak ditemukan (butuh kolom "username"). Gunakan template.' });
  const header = grid[headerIdx];
  // Petakan kolom tanggal: indeks → 'YYYY-MM-DD'.
  const dateCols = [];
  for (let c = 0; c < header.length; c++) {
    const v = String(header[c] ?? '').trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(v)) dateCols.push({ c, date: v });
  }
  if (dateCols.length === 0) return res.status(400).json({ error: 'Tidak ada kolom tanggal (format YYYY-MM-DD) pada header.' });

  // Hanya teknisi dalam scope unit request yang bisa diimpor.
  const ufU = unitFilter(req.unitId, 'unit_id');
  const [users] = await pool.query(`SELECT id, username, name, unit_id FROM users WHERE (role='teknisi' OR JSON_CONTAINS(roles, '"teknisi"'))${ufU.clause}`, ufU.params);
  const byUser = new Map(users.map((u) => [String(u.username).toLowerCase().trim(), u]));
  const byName = new Map(users.map((u) => [String(u.name).toLowerCase().trim(), u]));
  const fallbackUnit = insertUnitId(req); // dipakai bila user target belum punya unit

  let updated = 0;
  const errors = [];
  for (let i = headerIdx + 1; i < grid.length; i++) {
    const row = grid[i];
    if (!row || row.every((c) => c === '' || c == null)) continue;
    const key = String(row[0] ?? '').toLowerCase().trim();
    if (key.startsWith('#')) continue;
    const tu = byUser.get(key) || byName.get(key);
    if (!tu) { errors.push(`Baris ${i + 1}: teknisi "${row[0]}" tidak ditemukan`); continue; }
    const unitId = tu.unit_id ?? fallbackUnit;
    if (unitId == null) { errors.push(`Baris ${i + 1}: unit teknisi "${row[0]}" belum ditentukan — pilih unit terlebih dahulu`); continue; }

    for (const { c, date } of dateCols) {
      const raw = String(row[c] ?? '').toLowerCase().trim();
      if (!raw) continue; // kosong = tidak diubah
      const shift = SHIFT_FROM[raw];
      if (!shift) { errors.push(`Baris ${i + 1} (${date}): nilai "${row[c]}" tidak dikenal (pakai N/P/S/L)`); continue; }
      await pool.query(
        `INSERT INTO shifts (user_id, shift_date, shift_type, unit_id) VALUES (?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE shift_type = VALUES(shift_type), unit_id = VALUES(unit_id)`,
        [tu.id, date, shift, unitId]
      );
      updated++;
    }
  }
  res.json({ updated, errors });
});

export default router;
