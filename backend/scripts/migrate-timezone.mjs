/**
 * Migrasi data historis antar zona waktu (one-off, OPT-IN, ber-pengaman).
 *
 * KAPAN DIPAKAI: HANYA bila kolom timestamp mesin (created_at, sent_at, dll)
 * sebelumnya tersimpan sebagai UTC (mis. server Linux/Docker ber-TZ UTC) dan
 * Anda ingin menggesernya ke zona server baru (mis. +8 jam ke WITA).
 *
 * JANGAN dipakai bila MySQL sudah menyimpan waktu lokal (cek: NOW() == UTC_TIMESTAMP() ?
 * 0 jam = UTC → mungkin perlu migrasi; +8 jam = sudah WITA → TIDAK perlu).
 *
 * AMAN BY DEFAULT:
 *  - Tanpa --apply: hanya DRY-RUN (menampilkan rencana, tidak mengubah apa pun).
 *  - Hanya kolom DATETIME/TIMESTAMP (kolom DATE/TIME tidak disentuh).
 *  - Kolom tanggal yang DIISI MANUAL user (jadwal, kegiatan, dll) di-exclude default.
 *  - Idempoten: menolak jalan dua kali (flag settings.tz_migration_done), kecuali --force.
 *
 * Pemakaian:
 *   node scripts/migrate-timezone.mjs --shift=8                 # dry-run, geser +8 jam
 *   node scripts/migrate-timezone.mjs --shift=8 --apply         # eksekusi
 *   node scripts/migrate-timezone.mjs --shift=8 --exclude=incidents.foo --apply
 *
 * WAJIB: backup DB dulu (backend/scripts/backup-mysql.sh) sebelum --apply.
 */
import mysql from 'mysql2/promise';
import { env } from '../src/config/env.js';

const args = Object.fromEntries(process.argv.slice(2).map((a) => {
  const m = /^--([^=]+)(?:=(.*))?$/.exec(a);
  return m ? [m[1], m[2] ?? true] : [a, true];
}));
const shift = Number(args.shift);
const apply = !!args.apply;
const force = !!args.force;
const userExclude = new Set(String(args.exclude || '').split(',').map((s) => s.trim()).filter(Boolean));

// Kolom DATETIME yang lazimnya DIISI MANUAL (kalender), bukan timestamp UTC mesin → jangan digeser.
const DEFAULT_EXCLUDE = new Set([
  'shifts.shift_date', 'attendance.work_date', 'absence_reviews.work_date',
  'leave_requests.start_date', 'leave_requests.end_date',
  'equipment_maintenance.scheduled_date', 'equipment_inspections.inspect_date',
  'activities.activity_date', 'pengajuan_diklat.tanggal_mulai', 'pengajuan_diklat.tanggal_selesai',
  'pengajuan_diklat.tanggal_pengajuan', 'nota_dinas.tanggal', 'public_reports.report_date',
]);

if (!Number.isFinite(shift) || shift === 0) {
  console.error('ERROR: wajib --shift=<jam> (mis. --shift=8 untuk UTC→WITA). Bukan 0.');
  process.exit(1);
}

const c = await mysql.createConnection({
  host: env.db.host, port: env.db.port, user: env.db.user, password: env.db.password,
  database: env.db.database, dateStrings: true, multipleStatements: false,
});

// Guard idempoten.
try {
  const [f] = await c.query("SELECT 1 FROM settings WHERE setting_key='tz_migration_done'");
  if (f.length && !force) {
    console.error('ERROR: migrasi sudah pernah dijalankan (settings.tz_migration_done). Pakai --force bila yakin.');
    await c.end(); process.exit(1);
  }
} catch { /* tabel settings mungkin belum ada */ }

// Temukan semua kolom DATETIME/TIMESTAMP (kecualikan DATE/TIME/YEAR).
const [cols] = await c.query(
  `SELECT TABLE_NAME t, COLUMN_NAME col, DATA_TYPE dt
     FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = ? AND DATA_TYPE IN ('datetime','timestamp')
    ORDER BY TABLE_NAME, COLUMN_NAME`, [env.db.database]
);

const targets = cols
  .map((r) => ({ key: `${r.t}.${r.col}`, t: r.t, col: r.col }))
  .filter((x) => !DEFAULT_EXCLUDE.has(x.key) && !userExclude.has(x.key));

console.log(`\n=== Migrasi Zona Waktu — geser ${shift > 0 ? '+' : ''}${shift} jam ===`);
console.log(`DB: ${env.db.database} · Mode: ${apply ? '🔴 APPLY (mengubah data)' : '🟢 DRY-RUN (aman, tidak mengubah)'}`);
console.log(`Dikecualikan (default+user): ${[...DEFAULT_EXCLUDE, ...userExclude].length} kolom\n`);

let totalRows = 0;
for (const x of targets) {
  const [cnt] = await c.query(`SELECT COUNT(\`${x.col}\`) n, MIN(\`${x.col}\`) mn, MAX(\`${x.col}\`) mx FROM \`${x.t}\``);
  const n = cnt[0].n;
  totalRows += n;
  console.log(`  ${x.key}: ${n} baris  (${cnt[0].mn ?? '-'} … ${cnt[0].mx ?? '-'})`);
  if (apply && n > 0) {
    await c.query(`UPDATE \`${x.t}\` SET \`${x.col}\` = \`${x.col}\` + INTERVAL ? HOUR WHERE \`${x.col}\` IS NOT NULL`, [shift]);
  }
}

console.log(`\nTotal ${targets.length} kolom, ${totalRows} nilai.`);
if (apply) {
  await c.query(
    `INSERT INTO settings (setting_key, setting_value) VALUES ('tz_migration_done', ?)
     ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value)`,
    [JSON.stringify({ shift, at: new Date().toISOString() })]
  );
  console.log('✅ APPLIED. Flag tz_migration_done diset.');
} else {
  console.log('🟢 DRY-RUN selesai. Tinjau daftar di atas, BACKUP dulu, lalu jalankan ulang dengan --apply.');
  console.log('   Tambah --exclude=tabel.kolom untuk melewati kolom datetime yang diisi manual.');
}
await c.end();
