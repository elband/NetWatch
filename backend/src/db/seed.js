import bcrypt from 'bcryptjs';
import { pool } from './pool.js';

const ROLE_PERMS = {
  admin: ['dashboard', 'devices', 'monitor', 'incidents', 'jadwal', 'users', 'reports', 'ssh', 'wa', 'settings', 'publik-reports'],
  koordinator: ['dashboard', 'devices', 'monitor', 'incidents', 'jadwal', 'reports', 'wa', 'performa', 'publik-reports'],
  teknisi: ['my-dashboard', 'devices', 'monitor', 'my-incidents', 'jadwal'],
  viewer: ['dashboard', 'devices', 'monitor'],
};

// `pin` = PIN bootstrap login pertama kali (UI hanya menerima PIN). WAJIB diganti
// dari Pengaturan → Edit Profil setelah login pertama. Harus unik antar-user.
// Nilai disamakan dengan DEMO_PINS di migrate.js agar satu konvensi.
const USERS = [
  { name: 'Ahmad Fauzi', username: 'admin', email: 'admin@netwatch.id', pass: 'admin123', pin: '111111', phone: '+628987654321', role: 'admin', jabatan: 'IT Manager', emoji: '👑' },
  { name: 'Siti Rahayu', username: 'koordinator', email: 'siti@netwatch.id', pass: 'koord123', pin: '222222', phone: '+628811223344', role: 'koordinator', jabatan: 'Koordinator Jaringan', emoji: '👩‍💼' },
  { name: 'Budi Santoso', username: 'budi', email: 'budi@netwatch.id', pass: 'budi123', pin: '333333', phone: '+628111222333', role: 'teknisi', jabatan: 'Senior Network Engineer', emoji: '👨‍💻' },
  { name: 'Dian Pratama', username: 'dian', email: 'dian@netwatch.id', pass: 'dian123', pin: '444444', phone: '+628222333444', role: 'teknisi', jabatan: 'Network Engineer', emoji: '👩‍💻' },
  { name: 'Rina Wijaya', username: 'rina', email: 'rina@netwatch.id', pass: 'rina123', pin: '555555', phone: '+628333444555', role: 'teknisi', jabatan: 'Junior Technician', emoji: '👩‍🔧' },
  { name: 'Hendra Kusuma', username: 'hendra', email: 'hendra@netwatch.id', pass: 'hendra123', pin: '666666', phone: '+628444555666', role: 'teknisi', jabatan: 'Network Engineer', emoji: '👨‍🔧' },
  { name: 'Viewer Umum', username: 'viewer', email: 'viewer@netwatch.id', pass: 'view123', pin: '777777', phone: '', role: 'viewer', jabatan: 'Stakeholder', emoji: '👁️' },
];

const DEVICES = [
  ['SW-Core-01', '192.168.1.1', 'Switch', 'Gedung A - Lt.1'],
  ['SW-Core-02', '192.168.1.2', 'Switch', 'Gedung A - Lt.2'],
  ['RTR-Edge-01', '10.0.0.1', 'Router', 'Server Room'],
  ['FW-Main-01', '10.0.0.254', 'Firewall', 'Server Room'],
  ['AP-Lobby-01', '192.168.10.5', 'AP', 'Lobby Utama'],
  ['AP-R2-01', '192.168.10.6', 'AP', 'Ruang Rapat 2'],
  ['SRV-App-01', '10.10.1.10', 'Server', 'Data Center'],
  ['SRV-DB-01', '10.10.1.11', 'Server', 'Data Center'],
  ['NAS-Store-01', '10.10.2.5', 'NAS', 'Storage Room'],
  ['SW-Dist-01', '192.168.2.1', 'Switch', 'Gedung B - Lt.1'],
  ['RTR-Branch-01', '172.16.0.1', 'Router', 'Cabang Selatan'],
  ['AP-Canteen-01', '192.168.10.12', 'AP', 'Kantin'],
  ['SRV-Backup-01', '10.10.1.20', 'Server', 'Data Center'],
  ['FW-Branch-01', '172.16.0.254', 'Firewall', 'Cabang Selatan'],
  ['SW-Access-B2', '192.168.3.1', 'Switch', 'Gedung B - Lt.2'],
];

async function seed() {
  const conn = await pool.getConnection();
  try {
    const [existing] = await conn.query('SELECT COUNT(*) as c FROM users');
    if (existing[0].c > 0) {
      console.log('Users already seeded, skipping.');
      return;
    }

    for (const u of USERS) {
      const hash = await bcrypt.hash(u.pass, 10);
      const pinHash = await bcrypt.hash(u.pin, 10);
      await conn.query(
        `INSERT INTO users (name, username, email, password_hash, pin_hash, phone, role, jabatan, emoji, active, perms)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)`,
        [u.name, u.username, u.email, hash, pinHash, u.phone, u.role, u.jabatan, u.emoji, JSON.stringify(ROLE_PERMS[u.role])]
      );
    }
    console.log(`Seeded ${USERS.length} users.`);
    console.log('\n⚠️  PIN BOOTSTRAP (login pertama via keypad) — WAJIB GANTI setelah login:');
    for (const u of USERS) console.log(`   ${u.username.padEnd(12)} role=${u.role.padEnd(11)} PIN=${u.pin}`);
    console.log('   Ganti dari: Pengaturan → Edit Profil. PIN harus unik antar-user.\n');

    for (const [name, ip, type, loc] of DEVICES) {
      await conn.query(
        `INSERT INTO devices (name, ip, type, loc, status, ping_ms, cpu, mem) VALUES (?, ?, ?, ?, 'offline', 0, 0, 0)`,
        [name, ip, type, loc]
      );
    }
    console.log(`Seeded ${DEVICES.length} devices.`);

    const [techRows] = await conn.query("SELECT id FROM users WHERE role='teknisi' ORDER BY id");
    const techIds = techRows.map((r) => r.id);
    const patterns = [
      ['pagi', 'pagi', 'malam', 'malam', 'siang', 'siang', 'libur'],
      ['siang', 'siang', 'pagi', 'pagi', 'libur', 'malam', 'malam'],
      ['malam', 'libur', 'siang', 'siang', 'pagi', 'pagi', 'siang'],
      ['libur', 'malam', 'malam', 'libur', 'malam', 'libur', 'pagi'],
    ];
    const today = new Date();
    let shiftRows = 0;
    for (let mo = -1; mo <= 3; mo++) {
      const year = today.getFullYear();
      const month = today.getMonth() + mo;
      const days = new Date(year, month + 1, 0).getDate();
      for (let d = 1; d <= days; d++) {
        const dt = new Date(year, month, d);
        const dow = dt.getDay();
        const pi = dow === 0 ? 6 : dow - 1;
        const dateKey = dt.toISOString().slice(0, 10);
        for (let ti = 0; ti < techIds.length; ti++) {
          const shift = patterns[ti % patterns.length][pi];
          await conn.query(
            `INSERT INTO shifts (user_id, shift_date, shift_type) VALUES (?, ?, ?)
             ON DUPLICATE KEY UPDATE shift_type = VALUES(shift_type)`,
            [techIds[ti], dateKey, shift]
          );
          shiftRows++;
        }
      }
    }
    console.log(`Seeded ${shiftRows} shift rows.`);

    await conn.query(
      `INSERT INTO settings (setting_key, setting_value) VALUES
       ('wa_provider', '"gateway"'),
       ('wa_coord_phone', '"+628987654321"'),
       ('threshold_cpu', '80'),
       ('threshold_mem', '85'),
       ('threshold_ping_timeout_ms', '3000')`
    );
    console.log('Seeded settings.');
  } finally {
    conn.release();
    await pool.end();
  }
}

seed().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
