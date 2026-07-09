// Koreksi data absensi lama yang SALAH TANGGAL akibat bug todayKey() (dulu pakai UTC).
// Absen pagi (± 00:00–08:00 WITA) ter-record dengan work_date = tanggal KEMARIN, padahal
// check_in_at (WITA) menunjukkan hari yang benar. Perbaikan: work_date = DATE(check_in_at),
// aman terhadap UNIQUE(user_id, work_date) — baris yang akan bentrok dilewati untuk ditinjau.
//
// Jalankan dari folder backend/:
//   node scripts/fix-attendance-workdate.mjs           → DRY-RUN (hanya laporan, tak mengubah)
//   node scripts/fix-attendance-workdate.mjs --apply    → TERAPKAN perbaikan
import { pool } from '../src/db/pool.js';

const APPLY = process.argv.includes('--apply');

try {
  const [rows] = await pool.query(
    `SELECT a.id, a.user_id, u.name, a.work_date, a.check_in_at, DATE(a.check_in_at) AS correct
       FROM attendance a LEFT JOIN users u ON u.id = a.user_id
      WHERE a.check_in_at IS NOT NULL AND a.work_date <> DATE(a.check_in_at)
      ORDER BY a.check_in_at`
  );
  console.log(`Mode: ${APPLY ? 'APPLY (menerapkan)' : 'DRY-RUN (tanpa mengubah)'}`);
  console.log(`Record absensi salah tanggal: ${rows.length}\n`);

  let fixed = 0, skipped = 0;
  for (const r of rows) {
    const [[dup]] = await pool.query(
      'SELECT id FROM attendance WHERE user_id=? AND work_date=? AND id<>? LIMIT 1',
      [r.user_id, r.correct, r.id]
    );
    const collision = !!dup;
    const status = collision ? '⚠️ BENTROK (dilewati — tinjau manual)' : (APPLY ? '✅ diperbaiki' : '→ akan diperbaiki');
    console.log(`  #${r.id} ${r.name || 'user ' + r.user_id}: ${r.work_date} → ${r.correct}  (check_in ${r.check_in_at})  ${status}`);
    if (collision) { skipped++; continue; }
    if (APPLY) { await pool.query('UPDATE attendance SET work_date=? WHERE id=?', [r.correct, r.id]); fixed++; }
  }

  const willFix = rows.length - skipped;
  console.log(`\n${APPLY ? `Selesai: ${fixed} diperbaiki` : `DRY-RUN: ${willFix} akan diperbaiki`}, ${skipped} bentrok dilewati.`);
  if (!APPLY && willFix > 0) console.log('Jalankan ulang dengan --apply untuk menerapkan.');
} catch (e) {
  console.error('ERR:', e.code || e.message);
  process.exitCode = 1;
} finally {
  await pool.end();
}
