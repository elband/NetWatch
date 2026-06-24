import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import mysql from 'mysql2/promise';
import bcrypt from 'bcryptjs';
import { env } from '../config/env.js';

// PIN demo untuk user seed (hanya diset bila belum punya PIN).
const DEMO_PINS = { admin: '111111', koordinator: '222222', budi: '333333', dian: '444444', rina: '555555', hendra: '666666', viewer: '777777' };

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function migrate() {
  const sql = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
  const conn = await mysql.createConnection({
    host: env.db.host,
    port: env.db.port,
    user: env.db.user,
    password: env.db.password,
    multipleStatements: true,
  });
  console.log('Running schema migration...');
  await conn.query(sql);

  // Idempotent column additions (MySQL 8 tidak mendukung ADD COLUMN IF NOT EXISTS).
  await addColumnIfMissing(conn, env.db.database, 'incidents', 'taken_at', 'DATETIME DEFAULT NULL AFTER public_report_id');
  await addColumnIfMissing(conn, env.db.database, 'incidents', 'location_id', 'INT DEFAULT NULL AFTER ip');
  await addColumnIfMissing(conn, env.db.database, 'incidents', 'awaiting_part', "TINYINT(1) NOT NULL DEFAULT 0 AFTER status");
  await addColumnIfMissing(conn, env.db.database, 'incident_notes', 'doc_url', 'VARCHAR(255) DEFAULT NULL AFTER note');
  await addColumnIfMissing(conn, env.db.database, 'incidents', 'coord_alerted', 'TINYINT(1) NOT NULL DEFAULT 0 AFTER awaiting_part');
  await addColumnIfMissing(conn, env.db.database, 'incidents', 'tech_reminded', 'TINYINT(1) NOT NULL DEFAULT 0 AFTER coord_alerted');
  await addColumnIfMissing(conn, env.db.database, 'equipment_inspections', 'photo_url', 'VARCHAR(255) DEFAULT NULL AFTER note');
  await addColumnIfMissing(conn, env.db.database, 'equipment_inspections', 'photo_hash', 'CHAR(64) DEFAULT NULL AFTER photo_url');
  await addColumnIfMissing(conn, env.db.database, 'equipment_inspections', 'verified', 'TINYINT(1) NOT NULL DEFAULT 0 AFTER photo_hash');
  await addColumnIfMissing(conn, env.db.database, 'equipment_inspections', 'distance_m', 'INT DEFAULT NULL AFTER verified');
  await addColumnIfMissing(conn, env.db.database, 'devices', 'lat', 'DECIMAL(10,7) DEFAULT NULL AFTER ssh_username');
  await addColumnIfMissing(conn, env.db.database, 'devices', 'lng', 'DECIMAL(10,7) DEFAULT NULL AFTER lat');
  await addColumnIfMissing(conn, env.db.database, 'devices', 'category', 'VARCHAR(80) DEFAULT NULL AFTER type');
  await addColumnIfMissing(conn, env.db.database, 'devices', 'icon', 'VARCHAR(10) DEFAULT NULL AFTER category');
  await addColumnIfMissing(conn, env.db.database, 'locations', 'map_x', 'FLOAT DEFAULT NULL');
  await addColumnIfMissing(conn, env.db.database, 'locations', 'map_y', 'FLOAT DEFAULT NULL');
  await addColumnIfMissing(conn, env.db.database, 'incident_reports', 'signed_by', 'INT DEFAULT NULL');
  await addColumnIfMissing(conn, env.db.database, 'incident_reports', 'signer_name', 'VARCHAR(120) DEFAULT NULL');
  await addColumnIfMissing(conn, env.db.database, 'incident_reports', 'signer_nip', 'VARCHAR(40) DEFAULT NULL');
  await addColumnIfMissing(conn, env.db.database, 'incident_reports', 'signed_at', 'DATETIME DEFAULT NULL');
  await addColumnIfMissing(conn, env.db.database, 'incident_reports', 'sign_token', 'VARCHAR(80) DEFAULT NULL');
  // Nota dinas → registri surat keluar (umum + ber-TTE).
  await addColumnIfMissing(conn, env.db.database, 'nota_dinas', 'jenis', "VARCHAR(40) NOT NULL DEFAULT 'Nota Dinas' AFTER id");
  await addColumnIfMissing(conn, env.db.database, 'nota_dinas', 'tujuan', 'VARCHAR(200) DEFAULT NULL AFTER hal');
  await addColumnIfMissing(conn, env.db.database, 'nota_dinas', 'body', 'TEXT DEFAULT NULL AFTER tujuan');
  await addColumnIfMissing(conn, env.db.database, 'nota_dinas', 'signed_by', 'INT DEFAULT NULL');
  await addColumnIfMissing(conn, env.db.database, 'nota_dinas', 'signer_name', 'VARCHAR(120) DEFAULT NULL');
  await addColumnIfMissing(conn, env.db.database, 'nota_dinas', 'signer_nip', 'VARCHAR(40) DEFAULT NULL');
  await addColumnIfMissing(conn, env.db.database, 'nota_dinas', 'signed_at', 'DATETIME DEFAULT NULL');
  await addColumnIfMissing(conn, env.db.database, 'nota_dinas', 'sign_token', 'VARCHAR(80) DEFAULT NULL');
  // Persetujuan & TTE Kepala Seksi pada surat keluar (alur kirim WA → halaman TTD).
  await addColumnIfMissing(conn, env.db.database, 'nota_dinas', 'kasi_token', 'VARCHAR(80) DEFAULT NULL');
  await addColumnIfMissing(conn, env.db.database, 'nota_dinas', 'kasi_status', "VARCHAR(20) DEFAULT NULL");
  await addColumnIfMissing(conn, env.db.database, 'nota_dinas', 'kasi_requested_at', 'DATETIME DEFAULT NULL');
  await addColumnIfMissing(conn, env.db.database, 'nota_dinas', 'kasi_signer_name', 'VARCHAR(120) DEFAULT NULL');
  await addColumnIfMissing(conn, env.db.database, 'nota_dinas', 'kasi_signer_nip', 'VARCHAR(40) DEFAULT NULL');
  await addColumnIfMissing(conn, env.db.database, 'nota_dinas', 'kasi_signed_at', 'DATETIME DEFAULT NULL');
  await addColumnIfMissing(conn, env.db.database, 'nota_dinas', 'kasi_sign_token', 'VARCHAR(80) DEFAULT NULL');
  await addColumnIfMissing(conn, env.db.database, 'nota_dinas', 'kasi_note', 'VARCHAR(255) DEFAULT NULL');
  // Penanda bahwa surat adalah pengantar Laporan Bulanan periode tertentu (YYYY-MM) → TTD tampilkan laporan penuh.
  await addColumnIfMissing(conn, env.db.database, 'nota_dinas', 'report_month', 'VARCHAR(7) DEFAULT NULL');

  await addColumnIfMissing(conn, env.db.database, 'users', 'pin_hash', 'VARCHAR(255) DEFAULT NULL AFTER password_hash');
  await addColumnIfMissing(conn, env.db.database, 'users', 'roles', 'JSON DEFAULT NULL AFTER role');
  await addColumnIfMissing(conn, env.db.database, 'users', 'avatar_url', "VARCHAR(255) DEFAULT NULL AFTER emoji");
  await conn.query('UPDATE users SET roles = JSON_ARRAY(role) WHERE roles IS NULL');

  // Data personil untuk Laporan Bulanan (format resmi Kemenhub).
  await addColumnIfMissing(conn, env.db.database, 'users', 'nip', 'VARCHAR(40) DEFAULT NULL AFTER jabatan');
  await addColumnIfMissing(conn, env.db.database, 'users', 'pangkat', 'VARCHAR(60) DEFAULT NULL AFTER nip');
  await addColumnIfMissing(conn, env.db.database, 'users', 'ttl', 'VARCHAR(80) DEFAULT NULL AFTER pangkat');
  // Data inventaris untuk Laporan Bulanan.
  await addColumnIfMissing(conn, env.db.database, 'devices', 'merk', 'VARCHAR(80) DEFAULT NULL AFTER type');
  await addColumnIfMissing(conn, env.db.database, 'devices', 'serial', 'VARCHAR(80) DEFAULT NULL AFTER merk');
  await addColumnIfMissing(conn, env.db.database, 'devices', 'tahun', 'VARCHAR(20) DEFAULT NULL AFTER serial');
  // Kategori offline: 'dimatikan' bila perangkat non-server padam pada jam malam (tidak dialarmkan).
  await addColumnIfMissing(conn, env.db.database, 'devices', 'off_reason', "VARCHAR(20) DEFAULT NULL AFTER status");
  // Override manual: paksa alarmkan perangkat non-server walau di jam malam (sekali pakai sampai online lagi).
  await addColumnIfMissing(conn, env.db.database, 'devices', 'alarm_override', 'TINYINT(1) NOT NULL DEFAULT 0 AFTER off_reason');
  await addColumnIfMissing(conn, env.db.database, 'devices', 'inspect_required', 'TINYINT(1) NOT NULL DEFAULT 1 AFTER loc');
  // Dokumentasi (foto/PDF) untuk rencana/pelaksanaan maintenance.
  await addColumnIfMissing(conn, env.db.database, 'equipment_maintenance', 'doc_url', 'VARCHAR(255) DEFAULT NULL AFTER note');
  // Device binding & akurasi GPS untuk absensi ketat.
  await addColumnIfMissing(conn, env.db.database, 'users', 'device_id', 'VARCHAR(80) DEFAULT NULL');
  await addColumnIfMissing(conn, env.db.database, 'attendance', 'accuracy_m', 'INT DEFAULT NULL');
  await addColumnIfMissing(conn, env.db.database, 'attendance', 'device_id', 'VARCHAR(80) DEFAULT NULL');
  // Tambah status 'dinas_luar' pada jadwal (aturan = Libur: tidak on-duty).
  try { await conn.query("ALTER TABLE shifts MODIFY COLUMN shift_type ENUM('pagi','siang','malam','libur','dinas_luar','cuti') NOT NULL DEFAULT 'libur'"); } catch { /* sudah */ }
  // Laporan hasil diklat (diunggah setelah pelaksanaan).
  await addColumnIfMissing(conn, env.db.database, 'pengajuan_diklat', 'laporan_url', 'VARCHAR(255) DEFAULT NULL AFTER file_pendukung');
  await addColumnIfMissing(conn, env.db.database, 'pengajuan_diklat', 'laporan_at', 'DATETIME DEFAULT NULL AFTER laporan_url');
  // Master data tipe perangkat: pastikan tabel ada (idempoten, di luar batch schema)
  // + seed daftar default. INSERT IGNORE agar edit/penghapusan oleh user tidak tertimpa.
  await conn.query(`CREATE TABLE IF NOT EXISTS device_types (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(80) NOT NULL UNIQUE,
    icon VARCHAR(10) DEFAULT NULL,
    sort_order INT NOT NULL DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  ) ENGINE=InnoDB`);
  const DEV_TYPES = [['Switch', '🔀'], ['Router', '📡'], ['Firewall', '🧱'], ['AP', '📶'], ['Server', '🖥️'], ['NAS', '💾'], ['CCTV', '📹'], ['PC Client', '💻'], ['Printer', '🖨️']];
  for (let i = 0; i < DEV_TYPES.length; i++) {
    await conn.query('INSERT IGNORE INTO device_types (name, icon, sort_order) VALUES (?, ?, ?)', [DEV_TYPES[i][0], DEV_TYPES[i][1], i]);
  }

  // Seed kategori dokumen (12 kategori default).
  const DOC_CATS = ['SOP', 'Work Instruction', 'Knowledge Base', 'Materi Diklat', 'Dokumentasi Sistem', 'Dokumentasi Infrastruktur', 'Troubleshooting Guide', 'Diagram Jaringan', 'Form dan Template', 'Kebijakan dan Regulasi', 'Manual Vendor', 'Video Tutorial'];
  for (let i = 0; i < DOC_CATS.length; i++) {
    await conn.query('INSERT INTO document_categories (name, sort_order) VALUES (?, ?) ON DUPLICATE KEY UPDATE sort_order=VALUES(sort_order)', [DOC_CATS[i], i]);
  }
  // Seed kategori kegiatan non-rutin (21 kategori).
  const KNR = ['Pengembangan Aplikasi', 'Pengembangan Sistem', 'Integrasi Sistem', 'Implementasi Perangkat Baru', 'Upgrade Server', 'Upgrade Jaringan', 'Migrasi Sistem', 'Instalasi Perangkat', 'Pendampingan Audit', 'Pendampingan Vendor', 'Pendampingan Regulator', 'Pelatihan / Diklat', 'Penyusunan SOP', 'Penyusunan Dokumen', 'Meeting Proyek', 'Survey Lapangan', 'Penanganan Gangguan Besar', 'Uji Coba Sistem', 'Project Khusus', 'Inovasi Digital', 'Lainnya'];
  for (let i = 0; i < KNR.length; i++) {
    await conn.query('INSERT INTO kegiatan_non_rutin_categories (name, sort_order) VALUES (?, ?) ON DUPLICATE KEY UPDATE sort_order=VALUES(sort_order)', [KNR[i], i]);
  }
  // Pengajuan kegiatan lain: lampiran bukti dukung (foto/PDF).
  await addColumnIfMissing(conn, env.db.database, 'activities', 'bukti_url', 'VARCHAR(255) DEFAULT NULL AFTER end_time');

  // Pelaporan QR: kolom tautan ruangan + seed contoh ruangan.
  await addColumnIfMissing(conn, env.db.database, 'public_reports', 'room_id', 'INT DEFAULT NULL');
  await addColumnIfMissing(conn, env.db.database, 'public_reports', 'room_code', 'VARCHAR(40) DEFAULT NULL');
  const ROOMS = [
    ['RUANG-SERVER', 'Ruang Server', 'Terminal', 'Lantai 2', 'Data Center'], ['RUANG-NOC', 'Ruang NOC', 'Terminal', 'Lantai 2', 'Monitoring'],
    ['RUANG-ADM', 'Ruang Administrasi', 'Administrasi', 'Lantai 1', 'Perkantoran'], ['RUANG-MEETING', 'Ruang Meeting', 'Administrasi', 'Lantai 2', 'Rapat'],
    ['GATE-BRKT', 'Gate Keberangkatan', 'Terminal', 'Lantai 1', 'Keberangkatan'], ['GATE-DTNG', 'Gate Kedatangan', 'Terminal', 'Lantai 1', 'Kedatangan'],
    ['RUANG-TUNGGU', 'Ruang Tunggu', 'Terminal', 'Lantai 1', 'Boarding'], ['AREA-CHECKIN', 'Area Check-In', 'Terminal', 'Lantai 1', 'Check-In'],
    ['AREA-SCP', 'Area SCP', 'Terminal', 'Lantai 1', 'Security Check Point'], ['AREA-TRANSIT', 'Area Transit', 'Terminal', 'Lantai 1', 'Transit'],
  ];
  for (const [kode, nama, gedung, lantai, area] of ROOMS) {
    await conn.query('INSERT INTO rooms (kode, nama, gedung, lantai, area) VALUES (?,?,?,?,?) ON DUPLICATE KEY UPDATE nama=VALUES(nama)', [kode, nama, gedung, lantai, area]);
  }

  // Set PIN demo untuk user seed yang belum punya PIN.
  const [needPin] = await conn.query('SELECT id, username FROM users WHERE pin_hash IS NULL');
  for (const u of needPin) {
    const pin = DEMO_PINS[u.username];
    if (pin) {
      await conn.query('UPDATE users SET pin_hash = ? WHERE id = ?', [await bcrypt.hash(pin, 10), u.id]);
      console.log(`  + set PIN demo untuk ${u.username}`);
    }
  }

  // ── Index untuk performa query (dashboard, laporan bulanan, filter status) ──
  await addIndexIfMissing(conn, env.db.database, 'incidents', 'idx_inc_created_at', '(created_at)');
  await addIndexIfMissing(conn, env.db.database, 'incidents', 'idx_inc_status', '(status)');
  await addIndexIfMissing(conn, env.db.database, 'incidents', 'idx_inc_device', '(device_id)');
  await addIndexIfMissing(conn, env.db.database, 'incidents', 'idx_inc_tech', '(tech_id)');
  await addIndexIfMissing(conn, env.db.database, 'incidents', 'idx_inc_location', '(location_id)');
  await addIndexIfMissing(conn, env.db.database, 'incident_notes', 'idx_note_incident', '(incident_id)');
  await addIndexIfMissing(conn, env.db.database, 'incident_reports', 'idx_report_incident', '(incident_id)');
  await addIndexIfMissing(conn, env.db.database, 'nota_dinas', 'idx_nd_created_at', '(created_at)');
  await addIndexIfMissing(conn, env.db.database, 'nota_dinas', 'idx_nd_report_month', '(report_month)');
  await addIndexIfMissing(conn, env.db.database, 'wa_log', 'idx_wa_status', '(status)');
  await addIndexIfMissing(conn, env.db.database, 'wa_log', 'idx_wa_incident', '(related_incident_id)');
  await addIndexIfMissing(conn, env.db.database, 'pengajuan_diklat', 'idx_diklat_tahun_status', '(tahun, status)');
  await addIndexIfMissing(conn, env.db.database, 'public_reports', 'idx_pubrep_status', '(status)');

  console.log('Migration complete.');
  await conn.end();
}

// Tambah index idempoten (MySQL 8 tidak punya ADD INDEX IF NOT EXISTS).
// Toleran: bila kolom tak ada / tabel beda, dilewati dengan peringatan (tidak menggagalkan migrasi).
async function addIndexIfMissing(conn, dbName, table, indexName, colsExpr) {
  try {
    const [rows] = await conn.query(
      `SELECT 1 FROM INFORMATION_SCHEMA.STATISTICS
        WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND INDEX_NAME = ? LIMIT 1`,
      [dbName, table, indexName]
    );
    if (rows.length === 0) {
      await conn.query(`ALTER TABLE \`${table}\` ADD INDEX \`${indexName}\` ${colsExpr}`);
      console.log(`  + index ${table}.${indexName}`);
    }
  } catch (e) {
    console.warn(`  ! lewati index ${table}.${indexName}: ${e.message}`);
  }
}

async function addColumnIfMissing(conn, dbName, table, column, definition) {
  const [rows] = await conn.query(
    `SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
    [dbName, table, column]
  );
  if (rows.length === 0) {
    await conn.query(`ALTER TABLE \`${table}\` ADD COLUMN \`${column}\` ${definition}`);
    console.log(`  + added ${table}.${column}`);
  }
}

migrate().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
