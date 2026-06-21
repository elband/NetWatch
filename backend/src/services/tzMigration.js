// Logika migrasi zona waktu data historis — dipakai bersama oleh CLI
// (scripts/migrate-timezone.mjs) dan API (Pengaturan UI).
import { pool } from '../db/pool.js';
import { env } from '../config/env.js';

// Kolom DATETIME yang lazimnya DIISI MANUAL (kalender), bukan timestamp mesin → jangan digeser.
export const DEFAULT_EXCLUDE = [
  'shifts.shift_date', 'attendance.work_date', 'absence_reviews.work_date',
  'leave_requests.start_date', 'leave_requests.end_date',
  'equipment_maintenance.scheduled_date', 'equipment_inspections.inspect_date',
  'activities.activity_date', 'pengajuan_diklat.tanggal_mulai', 'pengajuan_diklat.tanggal_selesai',
  'pengajuan_diklat.tanggal_pengajuan', 'nota_dinas.tanggal', 'public_reports.report_date',
];

// Diagnosa: bantu admin memutuskan apakah migrasi diperlukan.
export async function diagnoseTz() {
  const [r] = await pool.query('SELECT @@global.time_zone gtz, @@system_time_zone systz');
  const [d] = await pool.query('SELECT NOW() now_session, UTC_TIMESTAMP() utc');
  const [f] = await pool.query("SELECT setting_value v FROM settings WHERE setting_key='tz_migration_done'");
  let done = null;
  if (f.length) { let v = f[0].v; if (typeof v === 'string') { try { v = JSON.parse(v); } catch { /* keep */ } } done = v; }
  const sessionOffsetHours = Math.round(
    (new Date(d[0].now_session.replace(' ', 'T')) - new Date(d[0].utc.replace(' ', 'T'))) / 3600000
  );
  return { globalTz: r[0].gtz, systemTz: r[0].systz, sessionOffsetHours, alreadyDone: done };
}

async function discoverColumns(exclude = []) {
  const ex = new Set([...DEFAULT_EXCLUDE, ...exclude]);
  const [cols] = await pool.query(
    `SELECT TABLE_NAME t, COLUMN_NAME col FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = ? AND DATA_TYPE IN ('datetime','timestamp')
      ORDER BY TABLE_NAME, COLUMN_NAME`, [env.db.database]
  );
  // Nama tabel/kolom berasal dari metadata DB (bukan input user) → aman di-interpolasi.
  return cols.map((r) => ({ key: `${r.t}.${r.col}`, t: r.t, col: r.col })).filter((x) => !ex.has(x.key));
}

// Jalankan migrasi (dry-run bila apply=false). Mengembalikan rencana + ringkasan.
export async function runTzMigration({ shift, apply = false, exclude = [], force = false }) {
  shift = Number(shift);
  if (!Number.isFinite(shift) || shift === 0) throw new Error('Geser (jam) wajib diisi dan tidak boleh 0.');
  if (Math.abs(shift) > 23) throw new Error('Geser di luar rentang wajar (-23..23 jam).');
  if (apply && !force) {
    const [f] = await pool.query("SELECT 1 FROM settings WHERE setting_key='tz_migration_done'");
    if (f.length) throw new Error('Migrasi sudah pernah dijalankan. Centang "Paksa" bila benar-benar yakin.');
  }
  const targets = await discoverColumns(exclude);
  const columns = [];
  let totalRows = 0;
  for (const x of targets) {
    const [c] = await pool.query(`SELECT COUNT(\`${x.col}\`) n, MIN(\`${x.col}\`) mn, MAX(\`${x.col}\`) mx FROM \`${x.t}\``);
    columns.push({ key: x.key, n: c[0].n, min: c[0].mn, max: c[0].mx });
    totalRows += c[0].n;
    if (apply && c[0].n > 0) {
      await pool.query(`UPDATE \`${x.t}\` SET \`${x.col}\` = \`${x.col}\` + INTERVAL ? HOUR WHERE \`${x.col}\` IS NOT NULL`, [shift]);
    }
  }
  if (apply) {
    await pool.query(
      `INSERT INTO settings (setting_key, setting_value) VALUES ('tz_migration_done', ?)
       ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value)`,
      [JSON.stringify({ shift, at: new Date().toISOString() })]
    );
  }
  return { mode: apply ? 'applied' : 'dry-run', shift, totalColumns: targets.length, totalRows, columns, excluded: [...new Set([...DEFAULT_EXCLUDE, ...exclude])] };
}
