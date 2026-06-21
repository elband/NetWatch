import { Router } from 'express';
import multer from 'multer';
import { aoaToBuffer, bufferToAoa } from '../utils/xlsx.js';
import { pool } from '../db/pool.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { dateKey } from '../config/shifts.js';

const router = Router();
router.use(requireAuth);

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });
// Kode resmi selaras Laporan Bulanan: N = Dinas Kantor (disimpan sbg 'malam'), P = Pagi, S = Siang, L = Libur.
const ABBR = { pagi: 'P', siang: 'S', malam: 'N', libur: 'L', dinas_luar: 'DL', cuti: 'C' };
// Terima singkatan (N/P/S/L/DL/C; M tetap diterima utk kompatibilitas) maupun kata penuh, tidak peka huruf besar/kecil.
const SHIFT_FROM = {
  p: 'pagi', pagi: 'pagi',
  s: 'siang', siang: 'siang',
  n: 'malam', m: 'malam', malam: 'malam', kantor: 'malam',
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
  let sql = 'SELECT s.*, u.name as user_name FROM shifts s JOIN users u ON u.id = s.user_id WHERE 1=1';
  const params = [];
  if (from) { sql += ' AND s.shift_date >= ?'; params.push(from); }
  if (to) { sql += ' AND s.shift_date <= ?'; params.push(to); }
  sql += ' ORDER BY s.shift_date';
  const [rows] = await pool.query(sql, params);
  res.json({ shifts: rows });
});

router.put('/:userId/:date', requireRole('admin', 'koordinator'), async (req, res) => {
  const { userId, date } = req.params;
  const { shiftType } = req.body;
  if (!['pagi', 'siang', 'malam', 'libur', 'dinas_luar', 'cuti'].includes(shiftType)) {
    return res.status(400).json({ error: 'shiftType tidak valid' });
  }
  await pool.query(
    `INSERT INTO shifts (user_id, shift_date, shift_type) VALUES (?, ?, ?)
     ON DUPLICATE KEY UPDATE shift_type = VALUES(shift_type)`,
    [userId, date, shiftType]
  );
  res.json({ ok: true });
});

// ----- Template Excel jadwal (grid: baris=teknisi, kolom=tanggal bulan terpilih) -----
router.get('/template', requireRole('admin', 'koordinator'), async (req, res) => {
  const month = /^\d{4}-\d{2}$/.test(req.query.month)
    ? req.query.month
    : `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}`;
  const { start, end, dates } = monthRange(month);

  const [techs] = await pool.query("SELECT id, username, name FROM users WHERE active=1 AND (role='teknisi' OR JSON_CONTAINS(roles, '\"teknisi\"')) ORDER BY name");
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

  const [users] = await pool.query("SELECT id, username, name FROM users WHERE role='teknisi' OR JSON_CONTAINS(roles, '\"teknisi\"')");
  const byUser = new Map(users.map((u) => [String(u.username).toLowerCase().trim(), u.id]));
  const byName = new Map(users.map((u) => [String(u.name).toLowerCase().trim(), u.id]));

  let updated = 0;
  const errors = [];
  for (let i = headerIdx + 1; i < grid.length; i++) {
    const row = grid[i];
    if (!row || row.every((c) => c === '' || c == null)) continue;
    const key = String(row[0] ?? '').toLowerCase().trim();
    if (key.startsWith('#')) continue;
    const uid = byUser.get(key) || byName.get(key);
    if (!uid) { errors.push(`Baris ${i + 1}: teknisi "${row[0]}" tidak ditemukan`); continue; }

    for (const { c, date } of dateCols) {
      const raw = String(row[c] ?? '').toLowerCase().trim();
      if (!raw) continue; // kosong = tidak diubah
      const shift = SHIFT_FROM[raw];
      if (!shift) { errors.push(`Baris ${i + 1} (${date}): nilai "${row[c]}" tidak dikenal (pakai N/P/S/L)`); continue; }
      await pool.query(
        `INSERT INTO shifts (user_id, shift_date, shift_type) VALUES (?, ?, ?)
         ON DUPLICATE KEY UPDATE shift_type = VALUES(shift_type)`,
        [uid, date, shift]
      );
      updated++;
    }
  }
  res.json({ updated, errors });
});

export default router;
