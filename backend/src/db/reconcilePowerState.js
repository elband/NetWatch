// ============================================================================
// Koreksi data status peralatan.
//
// Memperbaiki perangkat yang tampil "⚫ Dimatikan" (monitor_enabled=0) padahal catatan
// power TERAKHIR-nya = 'on' (dihidupkan) — jadi seharusnya "🟢 Monitoring aktif".
// Kondisi ini muncul bila monitor_enabled pernah diubah di LUAR alur Hidupkan/Matikan
// (toggle standby, edit manual DB, atau tulis separuh sebelum hardening transaksi).
//
// Hanya arah AMAN yang dikoreksi: catatan terakhir 'on' → nyalakan monitoring. Arah
// sebaliknya TIDAK disentuh (agar tak mematikan perangkat yang sengaja di-Auto-Hidup
// koordinator tanpa catatan). Aman diulang (idempoten).
//
// Jalankan:  node src/db/reconcilePowerState.js            (terapkan)
//            node src/db/reconcilePowerState.js --dry       (pratinjau saja)
// atau lewat npm:  npm run reconcile:power  /  npm run reconcile:power -- --dry
// ============================================================================
import { pool } from './pool.js';

const DRY = process.argv.includes('--dry');

async function main() {
  const [rows] = await pool.query(`
    SELECT d.id, d.name, d.ip, d.off_reason
      FROM devices d
      JOIN (
        SELECT ep.device_id, ep.state
          FROM equipment_poweron ep
          JOIN (SELECT device_id, MAX(id) mid FROM equipment_poweron GROUP BY device_id) t
            ON t.mid = ep.id
      ) lp ON lp.device_id = d.id
     WHERE (d.always_on IS NULL OR d.always_on = 0)
       AND d.monitor_enabled = 0
       AND lp.state = 'on'
     ORDER BY d.name`);

  console.log(`Perangkat tak sinkron (kartu "Dimatikan" tapi aksi power terakhir = Hidup): ${rows.length}`);
  for (const r of rows) console.log(`  #${r.id} ${r.name} (${r.ip}) off_reason=${r.off_reason ?? 'NULL'}`);

  if (!rows.length) { console.log('Tidak ada yang perlu diperbaiki. ✅'); return; }
  if (DRY) { console.log('\n(--dry) tidak ada perubahan ditulis.'); return; }

  const ids = rows.map((r) => r.id);
  const [res] = await pool.query(
    'UPDATE devices SET monitor_enabled=1, off_reason=NULL, alarm_override=0, offline_since=NULL WHERE id IN (?)',
    [ids]
  );
  console.log(`\n✅ Diperbaiki ${res.affectedRows} perangkat → Monitoring aktif (status riil ditentukan ping berikutnya).`);
}

main().then(() => pool.end()).catch((e) => { console.error('error:', e.message); pool.end(); process.exitCode = 1; });
