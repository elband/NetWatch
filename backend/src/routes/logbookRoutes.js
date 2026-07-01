import { Router } from 'express';
import { pool } from '../db/pool.js';
import { requireAuth } from '../middleware/auth.js';
import { jsonToBuffer } from '../utils/xlsx.js';

// Logbook peralatan: rekap bulanan per perangkat yang menggabungkan inspeksi harian,
// hidupkan/matikan peralatan, maintenance, dan insiden/gangguan menjadi satu kronologi.
const router = Router();
router.use(requireAuth);

function monthRange(month) {
  const m = /^\d{4}-\d{2}$/.test(month) ? month : new Date().toISOString().slice(0, 7);
  const [y, mo] = m.split('-').map(Number);
  const ny = mo === 12 ? y + 1 : y;
  const nm = mo === 12 ? 1 : mo + 1;
  return { month: m, start: `${m}-01`, end: `${ny}-${String(nm).padStart(2, '0')}-01` };
}
const dstr = (v) => (v ? String(v).slice(0, 10) : '');
const tstr = (v) => { if (!v) return ''; const d = new Date(String(v).replace(' ', 'T')); return isNaN(d.getTime()) ? '' : d.toTimeString().slice(0, 5); };

// Kumpulkan semua data bulan tsb lalu susun per perangkat + kronologi + rekap.
async function buildLogbook(month, q) {
  const { month: mm, start, end } = monthRange(month);

  const [insp] = await pool.query(
    'SELECT device_id, inspect_date, slot, status, note, photo_url, verified, inspector_name, created_at FROM equipment_inspections WHERE inspect_date >= ? AND inspect_date < ?',
    [start, end]
  );
  const [pon] = await pool.query(
    'SELECT device_id, on_date, state, note, photo_url, verified, done_by_name, created_at FROM equipment_poweron WHERE on_date >= ? AND on_date < ?',
    [start, end]
  );
  const [maint] = await pool.query(
    `SELECT m.device_id, m.scheduled_date, m.task, m.status, m.note, m.done_at, u.name AS done_by_name,
            (SELECT COUNT(*) FROM equipment_maintenance_photos p WHERE p.maintenance_id = m.id) AS photo_count
       FROM equipment_maintenance m LEFT JOIN users u ON u.id = m.done_by
      WHERE m.plan_month = ?`,
    [mm]
  );
  const [inc] = await pool.query(
    "SELECT id, device_id, issue, priority, status, created_at, resolved_at, duration_min FROM incidents WHERE device_id IS NOT NULL AND created_at >= ? AND created_at < ?",
    [start, end]
  );

  // Perangkat yang punya aktivitas bulan ini (union) — beserta info dasarnya.
  const ids = [...new Set([...insp, ...pon, ...maint, ...inc].map((r) => r.device_id).filter(Boolean))];
  if (!ids.length) return { month: mm, devices: [] };
  const [devs] = await pool.query(`SELECT id, name, ip, type, loc FROM devices WHERE id IN (${ids.map(() => '?').join(',')})`, ids);

  const map = new Map(devs.map((d) => [d.id, {
    ...d,
    recap: { inspeksi: { total: 0, baik: 0, perhatian: 0, rusak: 0 }, power: { on: 0, off: 0 }, maintenance: { total: 0, selesai: 0 }, insiden: { total: 0, downtime_min: 0 } },
    events: [],
  }]));

  for (const r of insp) {
    const d = map.get(r.device_id); if (!d) continue;
    d.recap.inspeksi.total++; d.recap.inspeksi[r.status] = (d.recap.inspeksi[r.status] || 0) + 1;
    d.events.push({ date: dstr(r.inspect_date), time: tstr(r.created_at), kind: 'inspeksi', label: `Inspeksi ${r.slot}:00`, status: r.status, detail: r.note || '', by: r.inspector_name || '', photo_url: r.photo_url || '', verified: !!r.verified });
  }
  for (const r of pon) {
    const d = map.get(r.device_id); if (!d) continue;
    if (r.state === 'off') d.recap.power.off++; else d.recap.power.on++;
    d.events.push({ date: dstr(r.on_date), time: tstr(r.created_at), kind: 'power', label: r.state === 'off' ? 'Peralatan dimatikan' : 'Peralatan dihidupkan', status: r.state === 'off' ? 'mati' : 'hidup', detail: r.note || '', by: r.done_by_name || '', photo_url: r.photo_url || '', verified: !!r.verified });
  }
  for (const r of maint) {
    const d = map.get(r.device_id); if (!d) continue;
    d.recap.maintenance.total++; if (r.status === 'selesai') d.recap.maintenance.selesai++;
    d.events.push({ date: dstr(r.scheduled_date), time: tstr(r.done_at), kind: 'maintenance', label: r.task, status: r.status, detail: r.note || (r.photo_count ? `${r.photo_count} foto dokumentasi` : ''), by: r.done_by_name || '', photo_url: '', verified: false });
  }
  for (const r of inc) {
    const d = map.get(r.device_id); if (!d) continue;
    d.recap.insiden.total++; d.recap.insiden.downtime_min += Number(r.duration_min) || 0;
    d.events.push({ date: dstr(r.created_at), time: tstr(r.created_at), kind: 'insiden', label: `${r.id} · ${r.issue}`, status: r.status, detail: `Prioritas ${r.priority}${r.duration_min ? ` · downtime ${r.duration_min} mnt` : ''}`, by: '', photo_url: '', verified: false });
  }

  let list = [...map.values()];
  if (q && q.trim()) {
    const k = q.trim().toLowerCase();
    list = list.filter((d) => `${d.name} ${d.ip} ${d.type} ${d.loc || ''}`.toLowerCase().includes(k));
  }
  // Urutkan event tiap perangkat (tanggal, lalu jam) & perangkat by nama.
  for (const d of list) d.events.sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));
  list.sort((a, b) => a.name.localeCompare(b.name));
  return { month: mm, devices: list };
}

router.get('/', async (req, res) => {
  res.json(await buildLogbook(req.query.month, req.query.q));
});

router.get('/export', async (req, res) => {
  const { month, devices } = await buildLogbook(req.query.month, req.query.q);
  const KIND = { inspeksi: 'Inspeksi Harian', power: 'Hidupkan/Matikan', maintenance: 'Maintenance', insiden: 'Insiden' };
  const rows = [];
  for (const d of devices) {
    for (const e of d.events) {
      rows.push({
        Perangkat: d.name, IP: d.ip, Lokasi: d.loc || '-', Tanggal: e.date, Jam: e.time || '-',
        Jenis: KIND[e.kind] || e.kind, Uraian: e.label, Status: e.status || '-', Catatan: e.detail || '-', Oleh: e.by || '-',
      });
    }
  }
  const buf = await jsonToBuffer(`Logbook ${month}`, rows.length ? rows : [{ Perangkat: '(tidak ada aktivitas)', IP: '', Lokasi: '', Tanggal: '', Jam: '', Jenis: '', Uraian: '', Status: '', Catatan: '', Oleh: '' }]);
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="logbook-peralatan-${month}.xlsx"`);
  res.send(buf);
});

export default router;
