import { Router } from 'express';
import { pool } from '../db/pool.js';
import { requireAuth } from '../middleware/auth.js';
import { unitScope, unitFilter } from '../middleware/unitScope.js';
import { jsonToBuffer } from '../utils/xlsx.js';

// Logbook peralatan: rekap bulanan per perangkat yang menggabungkan inspeksi harian,
// hidupkan/matikan peralatan, maintenance, dan insiden/gangguan menjadi satu kronologi.
const router = Router();
router.use(requireAuth);
router.use(unitScope);

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
// unitId opsional (null = semua unit) — pemanggil lama (laporanRoutes) tetap kompatibel.
export async function buildLogbook(month, q, unitId = null) {
  const { month: mm, start, end } = monthRange(month);

  // Filter unit tiap query lewat unit PERANGKAT-nya (subquery devices) — konsisten
  // dgn sumber unit saat INSERT & aman untuk baris legacy yang unit_id-nya kosong.
  const devUnit = (col = 'device_id') =>
    unitId != null
      ? { clause: ` AND ${col} IN (SELECT id FROM devices WHERE unit_id = ?)`, params: [unitId] }
      : { clause: '', params: [] };

  const du = devUnit();
  const [insp] = await pool.query(
    `SELECT device_id, inspect_date, slot, status, note, photo_url, verified, inspector_name, created_at FROM equipment_inspections WHERE inspect_date >= ? AND inspect_date < ?${du.clause}`,
    [start, end, ...du.params]
  );
  const [pon] = await pool.query(
    `SELECT device_id, on_date, state, note, photo_url, verified, done_by_name, created_at FROM equipment_poweron WHERE on_date >= ? AND on_date < ?${du.clause}`,
    [start, end, ...du.params]
  );
  const dum = devUnit('m.device_id');
  const [maint] = await pool.query(
    `SELECT m.device_id, m.scheduled_date, m.task, m.status, m.note, m.done_at, u.name AS done_by_name,
            (SELECT COUNT(*) FROM equipment_maintenance_photos p WHERE p.maintenance_id = m.id) AS photo_count,
            (SELECT p.url FROM equipment_maintenance_photos p WHERE p.maintenance_id = m.id ORDER BY p.id ASC LIMIT 1) AS first_photo
       FROM equipment_maintenance m LEFT JOIN users u ON u.id = m.done_by
      WHERE m.plan_month = ?${dum.clause}`,
    [mm, ...dum.params]
  );
  const [inc] = await pool.query(
    `SELECT id, device_id, issue, priority, status, created_at, resolved_at, duration_min FROM incidents WHERE device_id IS NOT NULL AND created_at >= ? AND created_at < ?${du.clause}`,
    [start, end, ...du.params]
  );
  // Metrik pemantauan bulan tsb per perangkat: uptime%, latency rata-rata & maks.
  // Sumber = rollup harian device_uptime_daily (bukan device_metrics mentah yang dipangkas
  // retensi), dengan rumus ketersediaan yang SAMA dengan Laporan SLA & Laporan Bulanan:
  // (online + warning) ÷ (sampel − sampel maintenance). Ini menjaga angka uptime di logbook
  // identik dengan Seksi VII/VIII laporan bulanan, termasuk untuk bulan-bulan lama.
  const [metrics] = await pool.query(
    `SELECT device_id, SUM(samples) AS samples_raw, SUM(maint_samples) AS maint_samples,
            SUM(up_samples + warn_samples) AS up_ish,
            ROUND(AVG(avg_ping)) AS avg_ping, MAX(max_ping) AS max_ping
       FROM device_uptime_daily WHERE day >= ? AND day < ?${du.clause} GROUP BY device_id`,
    [start, end, ...du.params]
  );
  for (const m of metrics) {
    const base = Number(m.samples_raw) - Number(m.maint_samples);
    m.samples = base;
    m.up_pct = base > 0 ? Math.round((Number(m.up_ish) / base) * 10000) / 100 : null;
  }
  const metricMap = new Map(metrics.map((m) => [m.device_id, m]));

  // Perangkat yang punya aktivitas ATAU metrik pemantauan bulan ini (union) — beserta info dasarnya.
  const ids = [...new Set([...insp, ...pon, ...maint, ...inc, ...metrics].map((r) => r.device_id).filter(Boolean))];
  if (!ids.length) return { month: mm, devices: [] };
  const ufd = unitFilter(unitId, 'unit_id');
  const [devs] = await pool.query(`SELECT id, name, ip, type, loc FROM devices WHERE id IN (${ids.map(() => '?').join(',')})${ufd.clause}`, [...ids, ...ufd.params]);

  // Perangkat tanpa IP tidak benar-benar dipantau ping — sampel "offline"-nya tidak bermakna,
  // jadi metrik uptime/latensinya tidak ditampilkan (selaras Seksi II & VII laporan bulanan).
  const hasIp = (d) => !!(d.ip && String(d.ip).trim() && !/^n\/?a/i.test(String(d.ip).trim()));
  const map = new Map(devs.map((d) => {
    const mt = hasIp(d) ? metricMap.get(d.id) : null;
    return [d.id, {
      ...d,
      recap: {
        inspeksi: { total: 0, baik: 0, perhatian: 0, rusak: 0 }, power: { on: 0, off: 0 }, maintenance: { total: 0, selesai: 0 }, insiden: { total: 0, downtime_min: 0 },
        // metrik null bila tak ada sampel efektif (mis. seluruh bulan dalam maintenance) → tampil "–", bukan 0%.
        metrik: mt && mt.up_pct != null ? { up_pct: Number(mt.up_pct), avg_ping: Number(mt.avg_ping) || 0, max_ping: Number(mt.max_ping) || 0, samples: Number(mt.samples) || 0 } : null,
      },
      events: [],
    }];
  }));

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
    d.events.push({ date: dstr(r.scheduled_date), time: tstr(r.done_at), kind: 'maintenance', label: r.task, status: r.status, detail: r.note || (r.photo_count ? `${r.photo_count} foto dokumentasi` : ''), by: r.done_by_name || '', photo_url: r.first_photo || '', verified: false });
  }
  for (const r of inc) {
    const d = map.get(r.device_id); if (!d) continue;
    d.recap.insiden.total++; d.recap.insiden.downtime_min += Number(r.duration_min) || 0;
    d.events.push({ date: dstr(r.created_at), time: tstr(r.created_at), kind: 'insiden', label: `${r.id} · ${r.issue}`, status: r.status, detail: `Prioritas ${r.priority}${r.duration_min ? ` · downtime ${r.duration_min} mnt` : ''}`, by: '', photo_url: '', verified: false });
  }

  // Buang perangkat yang masuk hanya karena punya baris pemantauan tetapi metriknya
  // tidak ditampilkan (tanpa IP) dan tidak ada aktivitas apa pun bulan ini.
  let list = [...map.values()].filter((d) => d.events.length || d.recap.metrik);
  if (q && q.trim()) {
    const k = q.trim().toLowerCase();
    list = list.filter((d) => `${d.name} ${d.ip} ${d.type} ${d.loc || ''}`.toLowerCase().includes(k));
  }
  // Urutkan event tiap perangkat (tanggal, lalu jam) & perangkat by nama.
  for (const d of list) d.events.sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));
  list.sort((a, b) => a.name.localeCompare(b.name));
  return { month: mm, devices: list };
}

const emptyRecap = () => ({
  inspeksi: { total: 0, baik: 0, perhatian: 0, rusak: 0 }, power: { on: 0, off: 0 },
  maintenance: { total: 0, selesai: 0 }, insiden: { total: 0, downtime_min: 0 }, metrik: null,
});

// Detail SATU perangkat: info perangkat lengkap + rekap & kronologi bulan tsb. Rekap/kronologi
// dipinjam dari buildLogbook (logika identik & ter-scope unit); info perangkat di-query terpisah
// agar halaman tetap tampil meski perangkat tak punya aktivitas bulan itu.
export async function buildLogbookDevice(month, deviceId, unitId = null) {
  const id = Number(deviceId);
  if (!Number.isInteger(id) || id <= 0) return null;
  const ufd = unitFilter(unitId, 'd.unit_id');
  const [[dev]] = await pool.query(
    `SELECT d.id, d.name, d.ip, d.type, d.category, d.icon, d.loc, d.status, d.cpu, d.mem, d.ping_ms,
            d.monitor_enabled, d.off_reason, d.always_on, d.inspect_required, d.last_checked_at, d.offline_since,
            COALESCE(d.lat, loc.lat) AS lat, COALESCE(d.lng, loc.lng) AS lng
       FROM devices d LEFT JOIN locations loc ON loc.id = d.location_id
      WHERE d.id = ?${ufd.clause}`,
    [id, ...ufd.params]
  );
  if (!dev) return null; // tak ada / di luar unit
  const { month: mm, devices } = await buildLogbook(month, '', unitId);
  const base = devices.find((d) => d.id === id);
  // Tren uptime harian dari device_metrics (kecualikan sampel dalam jendela maintenance).
  const { start, end } = monthRange(month);
  const [drows] = await pool.query(
    `SELECT day d, samples, maint_samples, (up_samples + warn_samples) up_ish, avg_ping
       FROM device_uptime_daily WHERE device_id = ? AND day >= ? AND day < ? ORDER BY day`,
    [id, start, end]
  );
  const daily = drows
    .map((r) => { const base = Number(r.samples) - Number(r.maint_samples); return { date: dstr(r.d), up_pct: base > 0 ? Math.round((Number(r.up_ish) / base) * 10000) / 100 : 0, avg_ping: Number(r.avg_ping) || 0, samples: base }; })
    .filter((r) => r.samples > 0);
  return { month: mm, device: { ...dev, recap: base?.recap || emptyRecap(), events: base?.events || [], daily } };
}

router.get('/', async (req, res) => {
  res.json(await buildLogbook(req.query.month, req.query.q, req.unitId));
});

router.get('/device/:id', async (req, res) => {
  const data = await buildLogbookDevice(req.query.month, req.params.id, req.unitId);
  if (!data) return res.status(404).json({ error: 'Perangkat tidak ditemukan.' });
  res.json(data);
});

// Excel khusus satu perangkat (kronologi bulan tsb).
router.get('/device/:id/export', async (req, res) => {
  const data = await buildLogbookDevice(req.query.month, req.params.id, req.unitId);
  if (!data) return res.status(404).json({ error: 'Perangkat tidak ditemukan.' });
  const d = data.device;
  const KIND = { inspeksi: 'Inspeksi Harian', power: 'Hidupkan/Matikan', maintenance: 'Maintenance', insiden: 'Insiden' };
  const rows = d.events.length
    ? d.events.map((e) => ({
        Tanggal: e.date, Jam: e.time || '-',
        Jenis: e.kind === 'power' ? (e.status === 'mati' ? 'Matikan' : 'Hidupkan') : (KIND[e.kind] || e.kind),
        Uraian: e.label, Status: e.status || '-', Catatan: e.detail || '-', Oleh: e.by || '-',
      }))
    : [{ Tanggal: '-', Jam: '-', Jenis: '-', Uraian: '(tidak ada aktivitas)', Status: '-', Catatan: '-', Oleh: '-' }];
  const buf = await jsonToBuffer(`Logbook ${data.month}`, rows);
  const safe = String(d.name).replace(/[^a-z0-9]+/gi, '-').replace(/^-+|-+$/g, '').toLowerCase() || 'perangkat';
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="logbook-${safe}-${data.month}.xlsx"`);
  res.send(buf);
});

router.get('/export', async (req, res) => {
  const { month, devices } = await buildLogbook(req.query.month, req.query.q, req.unitId);
  const KIND = { inspeksi: 'Inspeksi Harian', power: 'Hidupkan/Matikan', maintenance: 'Maintenance', insiden: 'Insiden' };
  const rows = [];
  for (const d of devices) {
    const mk = d.recap.metrik;
    const up = mk ? `${mk.up_pct}%` : '-', la = mk ? `${mk.avg_ping} ms` : '-', lm = mk ? `${mk.max_ping} ms` : '-';
    const base = { Perangkat: d.name, IP: d.ip, Lokasi: d.loc || '-', 'Uptime': up, 'Latensi rata-rata': la, 'Latensi maks': lm };
    if (!d.events.length) {
      rows.push({ ...base, Tanggal: '-', Jam: '-', Jenis: '-', Uraian: '(tidak ada aktivitas)', Status: '-', Catatan: '-', Oleh: '-' });
      continue;
    }
    for (const e of d.events) {
      // Aksi power dipisah jadi Hidupkan/Matikan (bukan kategori gabungan "Hidupkan/Matikan").
      const jenis = e.kind === 'power' ? (e.status === 'mati' ? 'Matikan' : 'Hidupkan') : (KIND[e.kind] || e.kind);
      rows.push({ ...base, Tanggal: e.date, Jam: e.time || '-', Jenis: jenis, Uraian: e.label, Status: e.status || '-', Catatan: e.detail || '-', Oleh: e.by || '-' });
    }
  }
  const buf = await jsonToBuffer(`Logbook ${month}`, rows.length ? rows : [{ Perangkat: '(tidak ada aktivitas)', IP: '', Lokasi: '', Tanggal: '', Jam: '', Jenis: '', Uraian: '', Status: '', Catatan: '', Oleh: '' }]);
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="logbook-peralatan-${month}.xlsx"`);
  res.send(buf);
});

export default router;
