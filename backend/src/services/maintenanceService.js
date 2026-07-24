import { pool } from '../db/pool.js';

// =============================================================================
// maintenanceService — jendela maintenance terjadwal.
// Saat sebuah perangkat berada dalam jendela aktif: tidak memicu insiden/alarm
// otomatis dan sampel metrik ditandai "maintenance" (tidak menurunkan SLA).
// =============================================================================

// Muat seluruh jendela maintenance yang sedang aktif (sekali per sweep),
// lalu kembalikan predikat isUnder(device) untuk dipakai di loop pingService.
export async function loadActiveMaintenance() {
  // Dua sumber jendela downtime aktif (union):
  //  1. equipment_maintenance — entri maintenance terpadu yang punya jendela
  //     (starts_at/ends_at) & belum dibatalkan. Ini jalur baru pasca-unifikasi.
  //  2. maintenance_windows — sisa jendela lokasi/site-wide (tanpa device_id)
  //     yang tak bisa dipindah ke equipment_maintenance (butuh device_id).
  const [rows] = await pool.query(
    `SELECT device_id, location_id, loc_name FROM (
        SELECT em.device_id, NULL AS location_id, NULL AS loc_name
          FROM equipment_maintenance em
         WHERE em.starts_at IS NOT NULL AND em.ends_at IS NOT NULL
           AND em.status <> 'batal'
           AND NOW() BETWEEN em.starts_at AND em.ends_at
        UNION ALL
        SELECT mw.device_id, mw.location_id, l.name AS loc_name
          FROM maintenance_windows mw
          LEFT JOIN locations l ON l.id = mw.location_id
         WHERE NOW() BETWEEN mw.starts_at AND mw.ends_at
      ) w`
  );
  const deviceIds = new Set();
  const locNames = new Set();
  let siteWide = false;
  for (const r of rows) {
    if (r.device_id) deviceIds.add(r.device_id);
    else if (r.location_id) locNames.add(String(r.loc_name || '').toLowerCase());
    else siteWide = true; // device_id & location_id NULL = maintenance seluruh site
  }
  return {
    active: rows.length > 0,
    siteWide,
    isUnder(device) {
      if (siteWide) return true;
      if (deviceIds.has(device.id)) return true;
      if (device.loc && locNames.has(String(device.loc).toLowerCase())) return true;
      return false;
    },
  };
}

// Cek satu perangkat (dipakai endpoint/cek ad-hoc).
export async function isDeviceUnderMaintenance(device) {
  const m = await loadActiveMaintenance();
  return m.isUnder(device);
}
