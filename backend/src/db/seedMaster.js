import { pool } from './pool.js';

const SERVICES = [
  ['FIDS', '🖥️', 'Online', 1, '2 Layar', 1],
  ['Flight Info Server', '✈️', 'Online', 1, 'Response: 120ms', 2],
  ['SI-Keren BLU', '🗄️', 'Online', 1, 'Response: 98ms', 3],
  ['Internet Bandara', '🌐', 'Online', 1, 'Speed: 200 Mbps', 4],
  ['Link Antar Gedung', '🔗', 'Up', 1, '4 Link Aktif', 5],
  ['CCTV', '📹', '3 Offline', 0, 'Total: 158 Kamera', 6],
  ['Access Control', '🚪', 'Online', 1, '32 Pintu', 7],
  ['PAS (Public Address)', '📢', 'Online', 1, 'Zone: 12', 8],
];

const LOCATIONS = [
  ['Terminal Domestik', '🛫', 1],
  ['Terminal International', '🛬', 2],
  ['Transit', '🔄', 3],
  ['Cargo', '📦', 4],
  ['Gedung Admin', '🏢', 5],
];

const ASSETS = [
  ['Laptop Dell Latitude 5400', 'AST-LT-001', 'Komputer', 1, 'Unit', '💻', 'baik'],
  ['Fluke Network Tester', 'AST-TL-002', 'Alat Ukur', 1, 'Unit', '🧰', 'baik'],
  ['Crimping Tool', 'AST-TL-003', 'Alat', 1, 'Unit', '🔧', 'baik'],
  ['Kabel UTP Cat6 50m', 'AST-MT-004', 'Material', 2, 'Roll', '🧵', 'baik'],
  ['Access Card Server Room', 'AST-AC-005', 'Akses', 1, 'Unit', '🔑', 'baik'],
];

async function seedMaster() {
  const conn = await pool.getConnection();
  try {
    const [[svc]] = await conn.query('SELECT COUNT(*) c FROM services');
    if (svc.c === 0) {
      for (const s of SERVICES) {
        await conn.query('INSERT INTO services (name, icon, status, is_ok, detail, sort_order) VALUES (?, ?, ?, ?, ?, ?)', s);
      }
      console.log(`Seeded ${SERVICES.length} services.`);
    } else console.log('Services already present, skipping.');

    const [[loc]] = await conn.query('SELECT COUNT(*) c FROM locations');
    if (loc.c === 0) {
      for (const l of LOCATIONS) {
        await conn.query('INSERT INTO locations (name, icon, sort_order) VALUES (?, ?, ?)', l);
      }
      console.log(`Seeded ${LOCATIONS.length} locations.`);
    } else console.log('Locations already present, skipping.');

    const [[ast]] = await conn.query('SELECT COUNT(*) c FROM assets');
    if (ast.c === 0) {
      // Bagikan aset contoh ke teknisi pertama agar dashboard tampak terisi.
      const [techs] = await conn.query("SELECT id FROM users WHERE role='teknisi' ORDER BY id LIMIT 1");
      const holder = techs[0]?.id || null;
      for (const a of ASSETS) {
        await conn.query(
          'INSERT INTO assets (name, code, category, qty, unit, icon, status, holder_user_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
          [...a, holder]
        );
      }
      console.log(`Seeded ${ASSETS.length} assets (holder user #${holder}).`);
    } else console.log('Assets already present, skipping.');
  } finally {
    conn.release();
    await pool.end();
  }
}

seedMaster().catch((err) => {
  console.error('Seed master failed:', err);
  process.exit(1);
});
