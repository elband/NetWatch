/**
 * Migrasi data historis antar zona waktu (one-off, OPT-IN, ber-pengaman).
 * Logika inti ada di src/services/tzMigration.js (dipakai juga oleh UI Pengaturan).
 *
 * KAPAN DIPAKAI: HANYA bila kolom timestamp mesin (created_at, sent_at, dll)
 * sebelumnya tersimpan sebagai UTC (mis. server Linux/Docker ber-TZ UTC) dan
 * Anda ingin menggesernya ke zona server baru (mis. +8 jam ke WITA).
 * Cek dulu: `SELECT NOW(), UTC_TIMESTAMP();` — selisih 0 = data UTC (mungkin perlu),
 * selisih 8 = sudah WITA (TIDAK perlu).
 *
 * Pemakaian:
 *   node scripts/migrate-timezone.mjs --shift=8                 # dry-run
 *   node scripts/migrate-timezone.mjs --shift=8 --apply         # eksekusi (BACKUP DULU)
 *   node scripts/migrate-timezone.mjs --shift=8 --exclude=tbl.col,tbl2.col --apply
 */
import { runTzMigration, diagnoseTz } from '../src/services/tzMigration.js';
import { pool } from '../src/db/pool.js';

const args = Object.fromEntries(process.argv.slice(2).map((a) => {
  const m = /^--([^=]+)(?:=(.*))?$/.exec(a);
  return m ? [m[1], m[2] ?? true] : [a, true];
}));

try {
  const diag = await diagnoseTz();
  console.log(`\nDiagnosa: global.time_zone=${diag.globalTz} system_time_zone=${diag.systemTz} sessionOffset=${diag.sessionOffsetHours}j` +
    (diag.alreadyDone ? ` · SUDAH PERNAH migrasi (${JSON.stringify(diag.alreadyDone)})` : ''));

  const exclude = String(args.exclude || '').split(',').map((s) => s.trim()).filter(Boolean);
  const result = await runTzMigration({ shift: args.shift, apply: !!args.apply, exclude, force: !!args.force });

  console.log(`\n=== Migrasi Zona Waktu — geser ${result.shift > 0 ? '+' : ''}${result.shift} jam ===`);
  console.log(`Mode: ${result.mode === 'applied' ? '🔴 APPLIED (data diubah)' : '🟢 DRY-RUN (tidak diubah)'}`);
  for (const c of result.columns) console.log(`  ${c.key}: ${c.n} baris  (${c.min ?? '-'} … ${c.max ?? '-'})`);
  console.log(`\nTotal ${result.totalColumns} kolom, ${result.totalRows} nilai.`);
  if (result.mode === 'applied') console.log('✅ APPLIED. Flag tz_migration_done diset.');
  else console.log('🟢 DRY-RUN selesai. Tinjau, BACKUP, lalu jalankan ulang dengan --apply.');
} catch (e) {
  console.error('ERROR:', e.message);
  process.exitCode = 1;
} finally {
  await pool.end();
}
