import { pool } from '../db/pool.js';
import { unitFilter } from '../middleware/unitScope.js';

// =============================================================================
// slaController — laporan SLA / uptime per perangkat.
// Sumber utama: device_uptime_daily (rollup harian, tahan terhadap retensi
// metrik mentah). MTTR/MTBF & jumlah insiden dihitung dari tabel incidents.
// Waktu maintenance dikeluarkan dari basis perhitungan availability.
// =============================================================================

function isoDate(d) { return d.toISOString().slice(0, 10); }

export async function getSlaReport(req, res) {
  // Default rentang: 30 hari terakhir (termasuk hari ini).
  const to = req.query.to || isoDate(new Date());
  const fromDefault = new Date(Date.now() - 29 * 86400000);
  const from = req.query.from || isoDate(fromDefault);
  const loc = (req.query.loc || '').trim();

  const uf = unitFilter(req.unitId, 'd.unit_id');
  const params = [from, to];
  let locFilter = '';
  if (loc) { locFilter = ' AND d.loc = ?'; params.push(loc); }
  params.push(...uf.params);

  // Agregasi uptime per perangkat dari rollup harian.
  const [rows] = await pool.query(
    `SELECT d.id, d.name, d.ip, d.loc, d.type, d.status,
            COALESCE(SUM(u.samples), 0)       AS samples,
            COALESCE(SUM(u.up_samples), 0)    AS up_samples,
            COALESCE(SUM(u.warn_samples), 0)  AS warn_samples,
            COALESCE(SUM(u.down_samples), 0)  AS down_samples,
            COALESCE(SUM(u.maint_samples), 0) AS maint_samples,
            COALESCE(SUM(u.down_seconds), 0)  AS down_seconds,
            ROUND(AVG(u.avg_ping))            AS avg_ping,
            MAX(u.max_ping)                   AS max_ping
       FROM devices d
       LEFT JOIN device_uptime_daily u
         ON u.device_id = d.id AND u.day BETWEEN ? AND ?
      WHERE 1=1${locFilter}${uf.clause}
      GROUP BY d.id
      ORDER BY d.name ASC`,
    params
  );

  // Insiden & MTTR per perangkat dalam periode (deteksi otomatis & manual).
  const incParams = [from, to];
  let incLoc = '';
  if (loc) { incLoc = ' AND d.loc = ?'; incParams.push(loc); }
  incParams.push(...uf.params);
  const [incRows] = await pool.query(
    `SELECT i.device_id,
            COUNT(*) AS incidents,
            SUM(i.status = 'selesai') AS resolved,
            AVG(CASE WHEN i.resolved_at IS NOT NULL
                     THEN TIMESTAMPDIFF(SECOND, i.created_at, i.resolved_at) END) AS mttr_sec
       FROM incidents i
       JOIN devices d ON d.id = i.device_id
      WHERE i.device_id IS NOT NULL
        AND DATE(i.created_at) BETWEEN ? AND ?${incLoc}${uf.clause}
      GROUP BY i.device_id`,
    incParams
  );
  const incMap = new Map(incRows.map((r) => [r.device_id, r]));

  const devices = rows.map((r) => {
    const base = Number(r.samples) - Number(r.maint_samples); // kecualikan maintenance
    const upish = Number(r.up_samples) + Number(r.warn_samples);
    const uptimePct = base > 0 ? Math.round((upish / base) * 10000) / 100 : null;
    const inc = incMap.get(r.id);
    const incidents = inc ? Number(inc.incidents) : 0;
    const mttrSec = inc && inc.mttr_sec != null ? Math.round(Number(inc.mttr_sec)) : null;
    return {
      id: r.id, name: r.name, ip: r.ip, loc: r.loc, type: r.type, status: r.status,
      uptime_pct: uptimePct,
      avg_ping: r.avg_ping != null ? Number(r.avg_ping) : null,
      max_ping: r.max_ping != null ? Number(r.max_ping) : null,
      down_seconds: Number(r.down_seconds),
      maint_seconds: null, // tersedia bila dibutuhkan (maint_samples * interval)
      samples: Number(r.samples),
      incidents,
      mttr_sec: mttrSec,
    };
  });

  // Ringkasan keseluruhan.
  const rated = devices.filter((d) => d.uptime_pct != null);
  const avgUptime = rated.length
    ? Math.round((rated.reduce((a, d) => a + d.uptime_pct, 0) / rated.length) * 100) / 100
    : null;
  const totalIncidents = devices.reduce((a, d) => a + d.incidents, 0);
  const mttrVals = devices.filter((d) => d.mttr_sec != null).map((d) => d.mttr_sec);
  const avgMttr = mttrVals.length ? Math.round(mttrVals.reduce((a, b) => a + b, 0) / mttrVals.length) : null;

  res.json({
    from, to,
    summary: { devices: devices.length, avg_uptime_pct: avgUptime, total_incidents: totalIncidents, avg_mttr_sec: avgMttr },
    devices,
  });
}
