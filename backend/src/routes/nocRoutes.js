import { Router } from 'express';
import crypto from 'crypto';
import { pool } from '../db/pool.js';
import { requireAuth, requireRole } from '../middleware/auth.js';

// Wallboard Publik (NOC): halaman layar-dinding TANPA login, digerbangi token rahasia
// di URL (?key=…) & di-scope ke satu unit (?unit=KODE). Data lengkap (dgn IP) sesuai
// keputusan operasional — link hanya dibagikan ke layar NOC.
const router = Router();

async function readToken() {
  const [r] = await pool.query("SELECT setting_value FROM settings WHERE setting_key='noc_token'");
  let v = r[0]?.setting_value;
  if (typeof v === 'string') { try { v = JSON.parse(v); } catch { /* raw string */ } }
  return typeof v === 'string' ? v : (v?.token || null);
}
async function writeToken(tok) {
  await pool.query(
    "INSERT INTO settings (setting_key, setting_value) VALUES ('noc_token', ?) ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value)",
    [JSON.stringify(tok)]
  );
}
async function ensureToken() {
  let t = await readToken();
  if (!t) { t = crypto.randomBytes(18).toString('base64url'); await writeToken(t); }
  return t;
}

// Validasi gerbang publik (token + unit) — dipakai semua route publik.
async function validatePublic(req) {
  const token = await readToken();
  if (!token || String(req.query.key || '') !== token) return { err: [403, 'Link wallboard tidak valid.'] };
  const unitCode = String(req.query.unit || '').trim().toUpperCase();
  if (!unitCode) return { err: [400, 'Parameter unit wajib diisi.'] };
  const [[unit]] = await pool.query('SELECT id, code, name, icon FROM units WHERE code = ? AND active = 1 LIMIT 1', [unitCode]);
  if (!unit) return { err: [404, 'Unit tidak ditemukan / nonaktif.'] };
  return { unit };
}
const n = (v) => Number(v) || 0;

// ===== PUBLIK (tanpa auth) — data lengkap command-center per unit =====
router.get('/public', async (req, res) => {
  const v = await validatePublic(req);
  if (v.err) return res.status(v.err[0]).json({ error: v.err[1] });
  const uid = v.unit.id;

  const [devices] = await pool.query(
    `SELECT id, name, ip, type, category, icon, loc, location_id, status, cpu, mem, ping_ms, lat, lng, last_checked_at, offline_since
       FROM devices WHERE unit_id = ? AND (asset_class = 'network' OR asset_class IS NULL) ORDER BY name`, [uid]);
  const [locations] = await pool.query(
    'SELECT id, name, icon, lat, lng, sort_order FROM locations WHERE unit_id = ? ORDER BY sort_order, name', [uid]);
  const [today] = await pool.query(
    `SELECT i.id, i.device_id, i.device_name, i.ip, i.issue, i.priority, i.status, i.created_at, i.resolved_at, d.location_id
       FROM incidents i LEFT JOIN devices d ON d.id = i.device_id
      WHERE i.unit_id = ? AND DATE(i.created_at) = CURDATE()
      ORDER BY FIELD(i.status,'aktif','proses','selesai'), i.created_at DESC`, [uid]);
  const [activeInc] = await pool.query(
    `SELECT i.id, i.device_id, i.device_name, i.ip, i.issue, i.priority, i.status, i.created_at, i.resolved_at, i.public_report_id, d.location_id, u.name AS tech_name
       FROM incidents i LEFT JOIN devices d ON d.id = i.device_id LEFT JOIN users u ON u.id = i.tech_id
      WHERE i.unit_id = ? AND i.status <> 'selesai'
      ORDER BY FIELD(i.priority,'kritis','tinggi','sedang'), i.created_at ASC`, [uid]);
  // Aktivitas inspeksi teknisi HARI INI (rinci) — untuk panel feed di wallboard.
  const [inspections] = await pool.query(
    `SELECT ei.id, ei.status, ei.slot, ei.note, ei.inspector_name, ei.verified, ei.created_at, d.name AS device_name, d.icon AS device_icon
       FROM equipment_inspections ei LEFT JOIN devices d ON d.id = ei.device_id
      WHERE ei.unit_id = ? AND ei.inspect_date = CURDATE()
      ORDER BY ei.created_at DESC LIMIT 80`, [uid]);
  const [techs] = await pool.query(
    `SELECT u.id, u.name, u.emoji,
        (SELECT s.shift_type FROM shifts s WHERE s.user_id = u.id AND s.shift_date = CURDATE() LIMIT 1) AS shift_type,
        (SELECT COUNT(*) FROM incidents i WHERE i.tech_id = u.id AND i.status <> 'selesai' AND i.unit_id = ?) AS handling
       FROM users u
      WHERE u.active = 1 AND u.unit_id = ? AND (u.role = 'teknisi' OR JSON_CONTAINS(u.roles, '"teknisi"'))
      ORDER BY u.name`, [uid, uid]);
  const [statRows] = await pool.query(
    `SELECT COALESCE(NULLIF(category,''), NULLIF(type,''), 'Lainnya') AS kategori,
        COUNT(*) total, SUM(status='online') online, SUM(status='warning') warning, SUM(status='offline') offline
       FROM devices WHERE unit_id = ? AND (asset_class='network' OR asset_class IS NULL)
      GROUP BY kategori ORDER BY total DESC`, [uid]);
  const [locStat] = await pool.query(
    `SELECT l.id, l.name, l.icon,
        (SELECT COUNT(*) FROM devices d WHERE d.location_id = l.id) total,
        (SELECT COUNT(*) FROM devices d WHERE d.location_id = l.id AND d.status='offline') offline
       FROM locations l WHERE l.unit_id = ?`, [uid]);
  const [services] = await pool.query(
    'SELECT id, name, icon, status, is_ok, detail FROM services WHERE unit_id = ? ORDER BY sort_order, name', [uid]);
  const [trendRows] = await pool.query(
    `SELECT DATE(created_at) d, COUNT(*) c FROM incidents
      WHERE unit_id = ? AND created_at >= DATE_SUB(CURDATE(), INTERVAL 6 DAY) GROUP BY DATE(created_at)`, [uid]);

  const deviceStats = statRows.map((r) => ({ kategori: r.kategori, total: n(r.total), online: n(r.online), warning: n(r.warning), offline: n(r.offline) }));
  const topLocations = locStat.map((r) => ({ id: r.id, name: r.name, icon: r.icon, total: n(r.total), offline: n(r.offline) }))
    .filter((r) => r.offline > 0).sort((a, b) => b.offline - a.offline).slice(0, 8);
  // Tren 7 hari (jumlah insiden/hari).
  const trendMap = {}; for (const r of trendRows) trendMap[String(r.d).slice(0, 10)] = n(r.c);
  const trend = []; const base = new Date();
  for (let i = 6; i >= 0; i--) { const dt = new Date(base); dt.setDate(base.getDate() - i); const key = dt.toISOString().slice(0, 10); trend.push({ date: key, count: trendMap[key] || 0 }); }

  const total = devices.length;
  const online = devices.filter((d) => d.status === 'online').length;
  const warning = devices.filter((d) => d.status === 'warning').length;
  const offline = devices.filter((d) => d.status === 'offline').length;
  const teknisiOn = techs.filter((t) => ['pagi', 'siang', 'malam'].includes(t.shift_type)).length;
  const kpi = { total, online, warning, offline, activeInc: activeInc.length, teknisiOn, availability: total ? Math.round((online / total) * 100) : 100 };

  // Sumber internet / uplink (Mikrotik/SFP/WAN): perangkat yang namanya/tipe/kategorinya
  // menandakan uplink internet — dipantau via ping. Status "UP" bila minimal satu online.
  const UPLINK_RE = /mikrotik|uplink|internet|wan|gateway|sfp|isp/i;
  const uplink = devices
    .filter((d) => UPLINK_RE.test(`${d.name} ${d.type || ''} ${d.category || ''}`))
    .map((d) => ({ id: d.id, name: d.name, ip: d.ip, type: d.type, status: d.status, ping_ms: d.ping_ms }));
  const internetSvc = services.find((s) => /internet/i.test(s.name));
  const upPings = uplink.filter((u) => u.status === 'online').map((u) => u.ping_ms).sort((a, b) => a - b);
  const internet = {
    ok: uplink.length ? uplink.some((u) => u.status === 'online') : (internetSvc ? !!internetSvc.is_ok : null),
    ping: upPings.length ? upPings[0] : null,
  };

  res.json({ unit: v.unit, devices, locations, today, activeIncidents: activeInc, technicians: techs, deviceStats, topLocations, services, trend, kpi, uplink, internet, inspections, ts: Date.now() });
});

// Telemetri per perangkat (riwayat metrik singkat) — untuk panel telemetri saat diklik.
router.get('/public/device-metrics', async (req, res) => {
  const v = await validatePublic(req);
  if (v.err) return res.status(v.err[0]).json({ error: v.err[1] });
  const id = Number(req.query.id);
  const [[dev]] = await pool.query('SELECT id, name, ip, type, category, status, cpu, mem, ping_ms FROM devices WHERE id = ? AND unit_id = ?', [id, v.unit.id]);
  if (!dev) return res.status(404).json({ error: 'Perangkat tidak ditemukan.' });
  const [rows] = await pool.query(
    'SELECT status, ping_ms, cpu, mem, recorded_at FROM device_metrics WHERE device_id = ? ORDER BY recorded_at DESC LIMIT 40', [id]);
  res.json({ device: dev, metrics: rows.reverse() });
});

// ===== ADMIN — lihat/regenerasi token link =====
router.use(requireAuth);
router.get('/token', requireRole('admin'), async (_req, res) => res.json({ token: await ensureToken() }));
router.post('/token/regenerate', requireRole('admin'), async (_req, res) => {
  const t = crypto.randomBytes(18).toString('base64url');
  await writeToken(t);
  res.json({ token: t });
});

export default router;
