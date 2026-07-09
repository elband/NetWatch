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
  // Auto-resolve insiden: jejak siapa/cara penutupan + validasi pemulihan (anti-flapping).
  await addColumnIfMissing(conn, env.db.database, 'incidents', 'resolved_by', "VARCHAR(64) DEFAULT NULL AFTER duration_min");
  await addColumnIfMissing(conn, env.db.database, 'incidents', 'resolution_type', "VARCHAR(16) DEFAULT NULL AFTER resolved_by");
  await addColumnIfMissing(conn, env.db.database, 'incidents', 'recovered_at', 'DATETIME DEFAULT NULL AFTER resolution_type');
  await addColumnIfMissing(conn, env.db.database, 'incidents', 'auto_recovery_since', 'DATETIME DEFAULT NULL AFTER recovered_at');
  await addColumnIfMissing(conn, env.db.database, 'equipment_inspections', 'photo_url', 'VARCHAR(255) DEFAULT NULL AFTER note');
  await addColumnIfMissing(conn, env.db.database, 'equipment_inspections', 'photo_hash', 'CHAR(64) DEFAULT NULL AFTER photo_url');
  await addColumnIfMissing(conn, env.db.database, 'equipment_inspections', 'verified', 'TINYINT(1) NOT NULL DEFAULT 0 AFTER photo_hash');
  await addColumnIfMissing(conn, env.db.database, 'equipment_inspections', 'distance_m', 'INT DEFAULT NULL AFTER verified');
  await addColumnIfMissing(conn, env.db.database, 'equipment_inspections', 'flagged', 'TINYINT(1) NOT NULL DEFAULT 0 AFTER distance_m');
  await addColumnIfMissing(conn, env.db.database, 'devices', 'lat', 'DECIMAL(10,7) DEFAULT NULL AFTER ssh_username');
  await addColumnIfMissing(conn, env.db.database, 'devices', 'lng', 'DECIMAL(10,7) DEFAULT NULL AFTER lat');
  await addColumnIfMissing(conn, env.db.database, 'devices', 'category', 'VARCHAR(80) DEFAULT NULL AFTER type');
  await addColumnIfMissing(conn, env.db.database, 'devices', 'icon', 'VARCHAR(10) DEFAULT NULL AFTER category');
  // Tag lokasi terstruktur — tautan perangkat ke titik di peta gangguan.
  await addColumnIfMissing(conn, env.db.database, 'devices', 'location_id', 'INT DEFAULT NULL AFTER loc');
  await addColumnIfMissing(conn, env.db.database, 'locations', 'map_x', 'FLOAT DEFAULT NULL');
  await addColumnIfMissing(conn, env.db.database, 'locations', 'map_y', 'FLOAT DEFAULT NULL');
  // Koordinat GPS untuk peta live (satelit). map_x/map_y dipertahankan utk kompatibilitas.
  await addColumnIfMissing(conn, env.db.database, 'locations', 'lat', 'DECIMAL(10,7) DEFAULT NULL');
  await addColumnIfMissing(conn, env.db.database, 'locations', 'lng', 'DECIMAL(10,7) DEFAULT NULL');
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
  // Status pengiriman ke SiKeren (verifikasi dokumen Laporan Bulanan a.n. Kepala Seksi).
  await addColumnIfMissing(conn, env.db.database, 'nota_dinas', 'sikeren_status', "VARCHAR(20) DEFAULT NULL");
  await addColumnIfMissing(conn, env.db.database, 'nota_dinas', 'sikeren_ref', 'VARCHAR(120) DEFAULT NULL');
  await addColumnIfMissing(conn, env.db.database, 'nota_dinas', 'sikeren_url', 'VARCHAR(255) DEFAULT NULL');
  await addColumnIfMissing(conn, env.db.database, 'nota_dinas', 'sikeren_at', 'DATETIME DEFAULT NULL');
  await addColumnIfMissing(conn, env.db.database, 'nota_dinas', 'sikeren_note', 'VARCHAR(255) DEFAULT NULL');

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
  // Perangkat selalu aktif 24 jam — dikecualikan dari alur Hidupkan/Matikan peralatan.
  await addColumnIfMissing(conn, env.db.database, 'devices', 'always_on', 'TINYINT(1) NOT NULL DEFAULT 0 AFTER inspect_required');
  // Mode standby: saat 0, perangkat tidak di-ping/dimonitor otomatis dan tidak memicu insiden otomatis.
  await addColumnIfMissing(conn, env.db.database, 'devices', 'monitor_enabled', 'TINYINT(1) NOT NULL DEFAULT 1 AFTER alarm_override');
  // Debounce auto-deteksi offline: kapan perangkat MULAI offline (untuk syarat
  // "offline stabil X waktu" sebelum tiket otomatis dibuat). NULL = sedang tidak offline.
  await addColumnIfMissing(conn, env.db.database, 'devices', 'offline_since', 'DATETIME DEFAULT NULL AFTER last_checked_at');
  // Pemantauan lanjutan: SNMP (CPU/mem/uptime riil) & health-check service (HTTP/TCP) selain ICMP.
  await addColumnIfMissing(conn, env.db.database, 'devices', 'check_type', "ENUM('ping','tcp','http') NOT NULL DEFAULT 'ping' AFTER monitor_enabled");
  await addColumnIfMissing(conn, env.db.database, 'devices', 'check_port', 'INT DEFAULT NULL AFTER check_type');
  await addColumnIfMissing(conn, env.db.database, 'devices', 'check_url', 'VARCHAR(255) DEFAULT NULL AFTER check_port');
  await addColumnIfMissing(conn, env.db.database, 'devices', 'snmp_enabled', 'TINYINT(1) NOT NULL DEFAULT 0 AFTER check_url');
  await addColumnIfMissing(conn, env.db.database, 'devices', 'snmp_community', "VARCHAR(80) DEFAULT 'public' AFTER snmp_enabled");
  await addColumnIfMissing(conn, env.db.database, 'devices', 'snmp_port', 'INT NOT NULL DEFAULT 161 AFTER snmp_community');
  // Idempotent untuk DB yang sudah memiliki device_metrics versi awal (tanpa in_maint).
  await addColumnIfMissing(conn, env.db.database, 'device_metrics', 'in_maint', 'TINYINT(1) NOT NULL DEFAULT 0 AFTER mem');
  // Dokumentasi (foto/PDF) untuk rencana/pelaksanaan maintenance.
  await addColumnIfMissing(conn, env.db.database, 'equipment_maintenance', 'doc_url', 'VARCHAR(255) DEFAULT NULL AFTER note');
  // equipment_poweron: dukung state on/off (dokumentasi wajib untuk keduanya). Kolom + unique key.
  await addColumnIfMissing(conn, env.db.database, 'equipment_poweron', 'state', "ENUM('on','off') NOT NULL DEFAULT 'on' AFTER on_date");
  // Foto hidupkan/matikan mencurigakan (di luar radius/tanpa GPS) yang tetap disimpan → penalti performa 20%.
  await addColumnIfMissing(conn, env.db.database, 'equipment_poweron', 'flagged', 'TINYINT(1) NOT NULL DEFAULT 0 AFTER distance_m');
  await ensurePoweronUnique(conn, env.db.database);
  // Jendela maintenance: penyelesaian pekerjaan (status selesai + dokumentasi foto).
  await addColumnIfMissing(conn, env.db.database, 'maintenance_windows', 'status', "ENUM('terjadwal','selesai') NOT NULL DEFAULT 'terjadwal' AFTER ends_at");
  await addColumnIfMissing(conn, env.db.database, 'maintenance_windows', 'done_note', 'VARCHAR(255) DEFAULT NULL AFTER status');
  await addColumnIfMissing(conn, env.db.database, 'maintenance_windows', 'done_by', 'INT DEFAULT NULL AFTER done_note');
  await addColumnIfMissing(conn, env.db.database, 'maintenance_windows', 'done_at', 'DATETIME DEFAULT NULL AFTER done_by');
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
  // Kegiatan Rapat/Dinas Luar: dokumentasi kegiatan (banyak foto/PDF) untuk penyelesaian setelah disetujui.
  await addColumnIfMissing(conn, env.db.database, 'activities', 'doc_urls', 'JSON DEFAULT NULL AFTER bukti_url');
  await addColumnIfMissing(conn, env.db.database, 'activities', 'doc_note', 'VARCHAR(255) DEFAULT NULL AFTER doc_urls');
  await addColumnIfMissing(conn, env.db.database, 'activities', 'completed_at', 'DATETIME DEFAULT NULL AFTER approved_at');

  // Perencanaan: kelengkapan rencana (tujuan, keluaran, indikator, jadwal mulai, sumber dana, metode).
  await addColumnIfMissing(conn, env.db.database, 'unit_plans', 'tujuan', 'VARCHAR(500) DEFAULT NULL AFTER deskripsi');
  await addColumnIfMissing(conn, env.db.database, 'unit_plans', 'keluaran', 'VARCHAR(500) DEFAULT NULL AFTER tujuan');
  await addColumnIfMissing(conn, env.db.database, 'unit_plans', 'volume', 'VARCHAR(120) DEFAULT NULL AFTER keluaran');
  await addColumnIfMissing(conn, env.db.database, 'unit_plans', 'indikator', 'VARCHAR(500) DEFAULT NULL AFTER volume');
  await addColumnIfMissing(conn, env.db.database, 'unit_plans', 'sumber_dana', 'VARCHAR(40) DEFAULT NULL AFTER realisasi_biaya');
  await addColumnIfMissing(conn, env.db.database, 'unit_plans', 'start_date', 'DATE DEFAULT NULL AFTER sumber_dana');
  await addColumnIfMissing(conn, env.db.database, 'unit_plans', 'metode', 'VARCHAR(40) DEFAULT NULL AFTER pic_nama');

  // Wallboard NOC: tandai satu perangkat sebagai sumber internet/uplink (Mikrotik) per unit.
  await addColumnIfMissing(conn, env.db.database, 'devices', 'is_uplink', 'TINYINT(1) NOT NULL DEFAULT 0 AFTER inspect_required');
  await addColumnIfMissing(conn, env.db.database, 'devices', 'uplink_ifindex', 'INT DEFAULT NULL AFTER is_uplink');

  // SKP bukti dukung: tipe data aplikasi (snapshot beku dari isi NetWatch).
  await addColumnIfMissing(conn, env.db.database, 'skp_bukti', 'kind', "VARCHAR(10) NOT NULL DEFAULT 'link' AFTER deskripsi");
  await addColumnIfMissing(conn, env.db.database, 'skp_bukti', 'source', 'VARCHAR(40) DEFAULT NULL AFTER kind');
  await addColumnIfMissing(conn, env.db.database, 'skp_bukti', 'params', 'JSON DEFAULT NULL AFTER source');
  await addColumnIfMissing(conn, env.db.database, 'skp_bukti', 'snapshot', 'JSON DEFAULT NULL AFTER params');
  // SKP bulanan: 1 SKP tahunan dipakai 12 bulan. Realisasi/feedback/bukti per bulan.
  await addColumnIfMissing(conn, env.db.database, 'skp_bukti', 'bulan', 'VARCHAR(7) DEFAULT NULL AFTER skp_id');
  await dropColumnIfExists(conn, env.db.database, 'skp_indikator', 'realisasi'); // pindah ke skp_realisasi
  await dropColumnIfExists(conn, env.db.database, 'skp_indikator', 'feedback');  // pindah ke skp_realisasi

  // Pelaporan QR: kolom tautan ruangan + seed contoh ruangan.
  await addColumnIfMissing(conn, env.db.database, 'public_reports', 'room_id', 'INT DEFAULT NULL');
  await addColumnIfMissing(conn, env.db.database, 'public_reports', 'room_code', 'VARCHAR(40) DEFAULT NULL');
  // Deteksi otomatis aset rusak: laporan lewat QR aset menyimpan device_id perangkat yang dipindai.
  await addColumnIfMissing(conn, env.db.database, 'public_reports', 'device_id', 'INT DEFAULT NULL');
  await addIndexIfMissing(conn, env.db.database, 'public_reports', 'idx_pr_device', '(device_id)');
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

  // ── Multi-unit (Fase 1): seed unit + kolom unit_id + backfill data lama ke ELB ──
  // Catatan: unit WPS (Water & Pump System) DIGABUNG ke AAB — air/pompa berada di
  // bawah Unit Alat-Alat Besar (sesuai laporan bulanan AAB). Lihat blok konsolidasi
  // di bawah yang memindahkan data WPS lama ke AAB & menghapus unitnya.
  const UNITS = [
    ['ELB', 'Elektronika Bandara', 'Fasilitas elektronika & jaringan bandara', '🖥️'],
    ['AAB', 'Alat-Alat Besar', 'Kendaraan, alat berat, serta sistem air & pompa bandara', '🚜'],
  ];
  for (const [code, name, description, icon] of UNITS) {
    await conn.query('INSERT IGNORE INTO units (code, name, description, icon) VALUES (?,?,?,?)', [code, name, description, icon]);
  }
  const [[elb]] = await conn.query("SELECT id FROM units WHERE code = 'ELB' LIMIT 1");

  // Tabel operasional & master: wajib ber-unit (backfill baris NULL lama ke ELB).
  // ISOLASI KETAT: locations, device_types, documents kini per-unit (tiap unit hanya
  // melihat miliknya) — data lama = ELB. Hanya wa_log yang tetap global (log WA sistem).
  const UNIT_SCOPED = [
    'users', 'devices', 'incidents', 'shifts', 'attendance', 'absence_reviews', 'leave_requests',
    'maintenance_windows', 'public_reports', 'pengajuan_diklat', 'diklat_history',
    'kegiatan_non_rutin', 'nota_dinas', 'activities', 'equipment_inspections',
    'equipment_maintenance', 'equipment_poweron', 'skp', 'assets', 'services', 'rooms',
    'locations', 'device_types', 'documents',
  ];
  const UNIT_GLOBAL = ['wa_log'];
  for (const table of [...UNIT_SCOPED, ...UNIT_GLOBAL]) {
    await addColumnIfMissing(conn, env.db.database, table, 'unit_id', 'INT DEFAULT NULL');
    await addIndexIfMissing(conn, env.db.database, table, `idx_${table}_unit`, '(unit_id)');
  }
  for (const table of UNIT_SCOPED) {
    if (table === 'users') {
      // Super admin (role admin) tetap NULL = lintas unit; sisanya masuk ELB.
      await conn.query(
        "UPDATE users SET unit_id = ? WHERE unit_id IS NULL AND role <> 'admin' AND NOT JSON_CONTAINS(COALESCE(roles, JSON_ARRAY()), JSON_QUOTE('admin'))",
        [elb.id]
      );
    } else {
      await conn.query(`UPDATE \`${table}\` SET unit_id = ? WHERE unit_id IS NULL`, [elb.id]);
    }
  }

  // ── Aset non-IP (Fase 2): peralatan fisik AAB/WPS di atas tabel `devices` ──
  // Pembeda network vs physical; aset fisik: ip='N/A-<id>', monitor_enabled=0 (dilewati ping worker).
  await addColumnIfMissing(conn, env.db.database, 'devices', 'asset_class', "ENUM('network','physical') NOT NULL DEFAULT 'network' AFTER type");
  await addColumnIfMissing(conn, env.db.database, 'devices', 'model', 'VARCHAR(120) DEFAULT NULL AFTER merk');
  await addColumnIfMissing(conn, env.db.database, 'devices', 'photo_url', 'VARCHAR(255) DEFAULT NULL AFTER icon');
  await addColumnIfMissing(conn, env.db.database, 'devices', 'op_status', "ENUM('operasional','standby','rusak','perbaikan') DEFAULT NULL AFTER status");
  await addColumnIfMissing(conn, env.db.database, 'devices', 'qr_token', 'CHAR(32) DEFAULT NULL AFTER op_status');
  await addIndexIfMissing(conn, env.db.database, 'devices', 'idx_dev_asset_class', '(asset_class)');
  await addUniqueIndexIfMissing(conn, env.db.database, 'devices', 'uniq_dev_qr_token', '(qr_token)');

  // Pembacaan meter manual (time-series) — dasar grafik tren jam operasi/BBM/tekanan/debit/level.
  await conn.query(`CREATE TABLE IF NOT EXISTS asset_readings (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    device_id INT NOT NULL,
    unit_id INT DEFAULT NULL,
    metric VARCHAR(40) NOT NULL,
    value DECIMAL(12,2) NOT NULL,
    note VARCHAR(255) DEFAULT NULL,
    photo_url VARCHAR(255) DEFAULT NULL,
    recorded_by INT DEFAULT NULL,
    recorded_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_ar_device_metric_time (device_id, metric, recorded_at),
    INDEX idx_ar_unit (unit_id),
    CONSTRAINT fk_ar_device FOREIGN KEY (device_id) REFERENCES devices(id) ON DELETE CASCADE,
    CONSTRAINT fk_ar_user FOREIGN KEY (recorded_by) REFERENCES users(id) ON DELETE SET NULL
  ) ENGINE=InnoDB`);

  // Definisi metrik meter per unit (dikonfigurasi koordinator). unit_id NULL = default global.
  await conn.query(`CREATE TABLE IF NOT EXISTS asset_metric_types (
    id INT AUTO_INCREMENT PRIMARY KEY,
    unit_id INT DEFAULT NULL,
    metric_key VARCHAR(40) NOT NULL,
    label VARCHAR(80) NOT NULL,
    satuan VARCHAR(20) DEFAULT NULL,
    is_cumulative TINYINT(1) NOT NULL DEFAULT 0,
    sort_order INT NOT NULL DEFAULT 0,
    active TINYINT(1) NOT NULL DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uniq_amt (unit_id, metric_key)
  ) ENGINE=InnoDB`);

  // Seed metrik default AAB — mencakup alat berat/kendaraan (jam operasi, BBM) DAN
  // sistem air/pompa (jam pompa, tekanan, debit, level air) karena WPS kini bagian AAB.
  const [[aab]] = await conn.query("SELECT id FROM units WHERE code = 'AAB' LIMIT 1");
  const METRICS = [
    // metric_key, label, satuan, is_cumulative, sort
    ['jam_operasi', 'Jam Operasi (Hour Meter)', 'jam', 1, 0],
    ['bbm', 'Konsumsi BBM', 'liter', 0, 1],
    ['jam_pompa', 'Jam Operasi Pompa', 'jam', 1, 2],
    ['tekanan', 'Tekanan', 'bar', 0, 3],
    ['debit', 'Debit', 'm³/j', 0, 4],
    ['level_air', 'Level Air', '%', 0, 5],
  ];
  if (aab?.id) {
    for (const [key, label, satuan, cumulative, sort] of METRICS) {
      await conn.query(
        'INSERT IGNORE INTO asset_metric_types (unit_id, metric_key, label, satuan, is_cumulative, sort_order) VALUES (?,?,?,?,?,?)',
        [aab.id, key, label, satuan, cumulative, sort]
      );
    }
  }

  // ── Konsolidasi: gabungkan unit WPS lama ke AAB (idempoten; hanya jalan bila WPS masih ada) ──
  const [[wpsUnit]] = await conn.query("SELECT id FROM units WHERE code = 'WPS' LIMIT 1");
  if (wpsUnit && aab?.id && wpsUnit.id !== aab.id) {
    const [unitTables] = await conn.query(
      "SELECT TABLE_NAME AS t FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = ? AND COLUMN_NAME = 'unit_id'",
      [env.db.database]
    );
    for (const { t } of unitTables) {
      if (t === 'asset_metric_types') {
        // Pindahkan metrik WPS yang belum ada di AAB; sisa duplikat dihapus.
        await conn.query('UPDATE IGNORE asset_metric_types SET unit_id = ? WHERE unit_id = ?', [aab.id, wpsUnit.id]);
        await conn.query('DELETE FROM asset_metric_types WHERE unit_id = ?', [wpsUnit.id]);
      } else {
        await conn.query(`UPDATE \`${t}\` SET unit_id = ? WHERE unit_id = ?`, [aab.id, wpsUnit.id]);
      }
    }
    await conn.query('DELETE FROM units WHERE id = ?', [wpsUnit.id]);
    console.log(`  ~ unit WPS (id ${wpsUnit.id}) digabung ke AAB (id ${aab.id}) & dihapus`);
  }

  // ── Fase 3: checklist inspeksi, preventive maintenance & riwayat status aset ──
  // Checklist: template per unit (+item) & pelaksanaan per aset (+item snapshot).
  await conn.query(`CREATE TABLE IF NOT EXISTS checklist_templates (
    id INT AUTO_INCREMENT PRIMARY KEY,
    unit_id INT DEFAULT NULL,
    name VARCHAR(120) NOT NULL,
    category VARCHAR(80) DEFAULT NULL,
    active TINYINT(1) NOT NULL DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_ct_unit (unit_id)
  ) ENGINE=InnoDB`);
  await conn.query(`CREATE TABLE IF NOT EXISTS checklist_template_items (
    id INT AUTO_INCREMENT PRIMARY KEY,
    template_id INT NOT NULL,
    label VARCHAR(160) NOT NULL,
    sort_order INT NOT NULL DEFAULT 0,
    CONSTRAINT fk_cti_tpl FOREIGN KEY (template_id) REFERENCES checklist_templates(id) ON DELETE CASCADE
  ) ENGINE=InnoDB`);
  await conn.query(`CREATE TABLE IF NOT EXISTS checklist_runs (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    device_id INT NOT NULL,
    unit_id INT DEFAULT NULL,
    template_id INT DEFAULT NULL,
    run_date DATE NOT NULL,
    overall ENUM('baik','perhatian','rusak') NOT NULL DEFAULT 'baik',
    note VARCHAR(255) DEFAULT NULL,
    photo_url VARCHAR(255) DEFAULT NULL,
    done_by INT DEFAULT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_cr_device_date (device_id, run_date),
    CONSTRAINT fk_cr_device FOREIGN KEY (device_id) REFERENCES devices(id) ON DELETE CASCADE
  ) ENGINE=InnoDB`);
  await conn.query(`CREATE TABLE IF NOT EXISTS checklist_run_items (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    run_id BIGINT NOT NULL,
    label VARCHAR(160) NOT NULL,
    result ENUM('ok','tidak','na') NOT NULL DEFAULT 'ok',
    note VARCHAR(255) DEFAULT NULL,
    CONSTRAINT fk_cri_run FOREIGN KEY (run_id) REFERENCES checklist_runs(id) ON DELETE CASCADE
  ) ENGINE=InnoDB`);

  // Preventive maintenance: rencana interval (jam operasi/kalender) + riwayat penyelesaian.
  await conn.query(`CREATE TABLE IF NOT EXISTS asset_pm_plans (
    id INT AUTO_INCREMENT PRIMARY KEY,
    device_id INT NOT NULL,
    unit_id INT DEFAULT NULL,
    name VARCHAR(120) NOT NULL,
    trigger_type ENUM('hours','calendar') NOT NULL DEFAULT 'hours',
    metric_key VARCHAR(40) DEFAULT NULL,
    interval_hours DECIMAL(10,2) DEFAULT NULL,
    interval_days INT DEFAULT NULL,
    anchor_value DECIMAL(12,2) DEFAULT NULL,
    anchor_date DATE DEFAULT NULL,
    active TINYINT(1) NOT NULL DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_pm_device (device_id), INDEX idx_pm_unit (unit_id),
    CONSTRAINT fk_pm_device FOREIGN KEY (device_id) REFERENCES devices(id) ON DELETE CASCADE
  ) ENGINE=InnoDB`);
  await conn.query(`CREATE TABLE IF NOT EXISTS asset_pm_history (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    plan_id INT NOT NULL,
    device_id INT NOT NULL,
    done_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    meter_value DECIMAL(12,2) DEFAULT NULL,
    note VARCHAR(255) DEFAULT NULL,
    done_by INT DEFAULT NULL,
    INDEX idx_pmh_plan (plan_id),
    CONSTRAINT fk_pmh_plan FOREIGN KEY (plan_id) REFERENCES asset_pm_plans(id) ON DELETE CASCADE
  ) ENGINE=InnoDB`);

  // Riwayat perubahan status aset — sumber availability / MTBF / MTTR.
  await conn.query(`CREATE TABLE IF NOT EXISTS asset_status_log (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    device_id INT NOT NULL,
    unit_id INT DEFAULT NULL,
    op_status ENUM('operasional','standby','rusak','perbaikan') NOT NULL,
    changed_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    changed_by INT DEFAULT NULL,
    INDEX idx_asl_device_time (device_id, changed_at),
    CONSTRAINT fk_asl_device FOREIGN KEY (device_id) REFERENCES devices(id) ON DELETE CASCADE
  ) ENGINE=InnoDB`);
  // Seed baris status awal untuk aset fisik yang belum punya log (agar availability sejak dibuat).
  await conn.query(`INSERT INTO asset_status_log (device_id, unit_id, op_status, changed_at)
    SELECT d.id, d.unit_id, COALESCE(d.op_status,'operasional'), d.created_at
      FROM devices d
     WHERE d.asset_class='physical'
       AND NOT EXISTS (SELECT 1 FROM asset_status_log a WHERE a.device_id=d.id)`);

  // ── Fase 4: identitas surat per unit + sparepart/stok ──
  // Override identitas surat per unit (kode, kop, nama unit, koordinator penandatangan).
  // lkp efektif = { ...settings.lkp global, ...units.config }.
  await addColumnIfMissing(conn, env.db.database, 'units', 'config', 'JSON DEFAULT NULL');

  await conn.query(`CREATE TABLE IF NOT EXISTS spareparts (
    id INT AUTO_INCREMENT PRIMARY KEY,
    unit_id INT DEFAULT NULL,
    name VARCHAR(150) NOT NULL,
    part_no VARCHAR(80) DEFAULT NULL,
    category VARCHAR(80) DEFAULT NULL,
    satuan VARCHAR(20) NOT NULL DEFAULT 'pcs',
    stock_qty DECIMAL(12,2) NOT NULL DEFAULT 0,
    min_qty DECIMAL(12,2) NOT NULL DEFAULT 0,
    location VARCHAR(120) DEFAULT NULL,
    notes VARCHAR(255) DEFAULT NULL,
    active TINYINT(1) NOT NULL DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_sp_unit (unit_id)
  ) ENGINE=InnoDB`);
  await conn.query(`CREATE TABLE IF NOT EXISTS sparepart_moves (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    sparepart_id INT NOT NULL,
    unit_id INT DEFAULT NULL,
    type ENUM('masuk','keluar','adjust') NOT NULL,
    qty DECIMAL(12,2) NOT NULL,
    device_id INT DEFAULT NULL,
    note VARCHAR(255) DEFAULT NULL,
    moved_by INT DEFAULT NULL,
    moved_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_spm_part (sparepart_id),
    CONSTRAINT fk_spm_part FOREIGN KEY (sparepart_id) REFERENCES spareparts(id) ON DELETE CASCADE
  ) ENGINE=InnoDB`);

  // ── Fase 5 (AAB): kondisi B/RR/RB, grup fasilitas, kebutuhan; checklist berkategori; obat air ──
  // 5a. Aset fisik: klasifikasi kondisi inventaris (berdampingan dgn op_status), grup fasilitas, kebutuhan pengadaan.
  await addColumnIfMissing(conn, env.db.database, 'devices', 'kondisi', "ENUM('B','RR','RB') DEFAULT NULL AFTER op_status");
  await addColumnIfMissing(conn, env.db.database, 'devices', 'fasilitas', 'VARCHAR(80) DEFAULT NULL AFTER kondisi');
  await addColumnIfMissing(conn, env.db.database, 'devices', 'kebutuhan', 'VARCHAR(255) DEFAULT NULL AFTER fasilitas');

  // Master grup fasilitas per unit (dropdown "Fasilitas" pada aset & pengelompokan laporan).
  await conn.query(`CREATE TABLE IF NOT EXISTS asset_facilities (
    id INT AUTO_INCREMENT PRIMARY KEY,
    unit_id INT DEFAULT NULL,
    name VARCHAR(80) NOT NULL,
    sort_order INT NOT NULL DEFAULT 0,
    active TINYINT(1) NOT NULL DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uniq_af (unit_id, name)
  ) ENGINE=InnoDB`);
  if (aab?.id) {
    const FACILITIES = ['Alat & Tools', 'Kendaraan & Alat Besar', 'GWT (Ground Water Tank)', 'WTP / STP', 'SWP Kawasan', 'SWP Unit', 'Intake'];
    for (let i = 0; i < FACILITIES.length; i++) {
      await conn.query('INSERT IGNORE INTO asset_facilities (unit_id, name, sort_order) VALUES (?,?,?)', [aab.id, FACILITIES[i], i]);
    }
  }

  // 5b. Checklist berkategori (Mesin/Body/Elektronik/Kemudi/Rem/dst.) — kolom category + snapshot.
  await addColumnIfMissing(conn, env.db.database, 'checklist_template_items', 'category', 'VARCHAR(60) DEFAULT NULL AFTER label');
  await addColumnIfMissing(conn, env.db.database, 'checklist_run_items', 'category', 'VARCHAR(60) DEFAULT NULL AFTER label');

  // 5d. Checklist BULANAN (status Serviceable/Unserviceable). frequency menandai template
  // harian vs bulanan; run bulanan menyimpan period (YYYY-MM) + serviceable (1=S,0=US).
  await addColumnIfMissing(conn, env.db.database, 'checklist_templates', 'frequency', "ENUM('harian','bulanan') NOT NULL DEFAULT 'harian' AFTER category");
  await addColumnIfMissing(conn, env.db.database, 'checklist_runs', 'frequency', "ENUM('harian','bulanan') NOT NULL DEFAULT 'harian' AFTER template_id");
  await addColumnIfMissing(conn, env.db.database, 'checklist_runs', 'period', 'VARCHAR(7) DEFAULT NULL AFTER run_date');
  await addColumnIfMissing(conn, env.db.database, 'checklist_runs', 'serviceable', 'TINYINT(1) DEFAULT NULL AFTER overall');

  // 5c. Obat air: master bahan kimia (dgn harga) + pemakaian harian → laporan biaya periodik.
  await conn.query(`CREATE TABLE IF NOT EXISTS water_chemicals (
    id INT AUTO_INCREMENT PRIMARY KEY,
    unit_id INT DEFAULT NULL,
    name VARCHAR(120) NOT NULL,
    satuan VARCHAR(20) NOT NULL DEFAULT 'kg',
    harga_satuan DECIMAL(12,2) NOT NULL DEFAULT 0,
    active TINYINT(1) NOT NULL DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_wc_unit (unit_id)
  ) ENGINE=InnoDB`);
  await conn.query(`CREATE TABLE IF NOT EXISTS water_chemical_usage (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    chemical_id INT NOT NULL,
    unit_id INT DEFAULT NULL,
    usage_date DATE NOT NULL,
    volume DECIMAL(12,2) NOT NULL,
    note VARCHAR(255) DEFAULT NULL,
    recorded_by INT DEFAULT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_wcu_chem_date (chemical_id, usage_date),
    INDEX idx_wcu_unit_date (unit_id, usage_date),
    CONSTRAINT fk_wcu_chem FOREIGN KEY (chemical_id) REFERENCES water_chemicals(id) ON DELETE CASCADE
  ) ENGINE=InnoDB`);

  // 5b. Seed template "Checklist Harian Kendaraan" AAB (berkategori, sesuai form riil).
  // Hanya dibuat sekali (bila belum ada) — edit koordinator tidak tertimpa.
  if (aab?.id) {
    const [[existTpl]] = await conn.query("SELECT id FROM checklist_templates WHERE unit_id=? AND name='Checklist Harian Kendaraan' LIMIT 1", [aab.id]);
    if (!existTpl) {
      const [tpl] = await conn.query('INSERT INTO checklist_templates (unit_id, name, category) VALUES (?,?,NULL)', [aab.id, 'Checklist Harian Kendaraan']);
      const ITEMS = [
        ['Mesin', 'Nyalakan mesin & periksa kebocoran oli'],
        ['Mesin', 'Penambahan bahan bakar sampai tangki FULL'],
        ['Mesin', 'Periksa Battery Accu dan terminalnya'],
        ['Mesin', 'Periksa tekanan angin & kondisi ban'],
        ['Body', 'Periksa & amankan Cover Body, Arm Rest, Inner Door Panel'],
        ['Body', 'Periksa fungsionalitas kunci pada semua pintu'],
        ['Elektronik', 'Periksa seluruh fungsionalitas lampu'],
        ['Elektronik', 'Periksa fungsi semua saklar & lampu indikator'],
        ['Elektronik', 'Periksa fungsionalitas Cable Body'],
        ['Elektronik', 'Periksa fungsionalitas dari setiap Outlet'],
        ['Elektronik', 'Periksa sambungan ground pada semua sirkuit'],
        ['Elektronik', 'Periksa fungsionalitas semua Eksterior'],
        ['Kemudi', 'Periksa sistem kemudi & kelurusan'],
        ['Rem', 'Periksa pengoperasian rem dan baut velg'],
        ['Rem', 'Periksa pengoperasian klakson'],
        ['Penghasil Listrik', 'Periksa fungsi penghasil listrik / genset'],
        ['First Aid', 'Periksa fungsionalitas & kelengkapan P3K'],
        ['First Aid', 'Periksa laju aliran oksigen di setiap outlet'],
      ];
      for (let i = 0; i < ITEMS.length; i++) {
        await conn.query('INSERT INTO checklist_template_items (template_id, label, category, sort_order) VALUES (?,?,?,?)', [tpl.insertId, ITEMS[i][1], ITEMS[i][0], i]);
      }
      console.log('  + seed checklist "Checklist Harian Kendaraan" (AAB)');
    }
    // 5d. Seed template BULANAN "Checklist Bulanan (Serviceable)" AAB — status kelayakan
    // per aset per bulan. Sekali saja; edit koordinator tidak tertimpa.
    const [[existMonthly]] = await conn.query("SELECT id FROM checklist_templates WHERE unit_id=? AND name='Checklist Bulanan (Serviceable)' LIMIT 1", [aab.id]);
    if (!existMonthly) {
      const [tplM] = await conn.query("INSERT INTO checklist_templates (unit_id, name, category, frequency) VALUES (?,?,NULL,'bulanan')", [aab.id, 'Checklist Bulanan (Serviceable)']);
      const MITEMS = [
        'Kondisi fisik & struktur baik (tidak ada kerusakan berarti)',
        'Fungsi operasional normal sesuai peruntukan',
        'Kelengkapan komponen & aksesori utuh',
        'Kebersihan & perawatan rutin terpenuhi',
        'Dokumen/log pemeliharaan terkini',
      ];
      for (let i = 0; i < MITEMS.length; i++) {
        await conn.query('INSERT INTO checklist_template_items (template_id, label, category, sort_order) VALUES (?,?,NULL,?)', [tplM.insertId, MITEMS[i], i]);
      }
      console.log('  + seed checklist "Checklist Bulanan (Serviceable)" (AAB)');
    }
  }

  // Peminjaman peralatan (AAB): pengajuan publik via scan QR di alat → koordinator kelola.
  await conn.query(`CREATE TABLE IF NOT EXISTS equipment_loans (
    id INT AUTO_INCREMENT PRIMARY KEY,
    device_id INT NOT NULL,
    unit_id INT DEFAULT NULL,
    borrower_name VARCHAR(150) NOT NULL,
    borrower_unit VARCHAR(150) DEFAULT NULL,
    borrower_phone VARCHAR(30) DEFAULT NULL,
    purpose VARCHAR(255) DEFAULT NULL,
    loan_date DATE NOT NULL,
    expected_return DATE DEFAULT NULL,
    status ENUM('menunggu','dipinjam','dikembalikan','ditolak') NOT NULL DEFAULT 'menunggu',
    approved_by INT DEFAULT NULL,
    approver_name VARCHAR(120) DEFAULT NULL,
    approved_at DATETIME DEFAULT NULL,
    returned_at DATETIME DEFAULT NULL,
    note VARCHAR(255) DEFAULT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_el_device (device_id), INDEX idx_el_unit (unit_id), INDEX idx_el_status (status),
    CONSTRAINT fk_el_device FOREIGN KEY (device_id) REFERENCES devices(id) ON DELETE CASCADE
  ) ENGINE=InnoDB`);

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

// Tambah UNIQUE index idempoten. Nilai NULL tidak melanggar UNIQUE di MySQL,
// jadi aman untuk kolom seperti qr_token yang kosong pada perangkat jaringan.
async function addUniqueIndexIfMissing(conn, dbName, table, indexName, colsExpr) {
  try {
    const [rows] = await conn.query(
      `SELECT 1 FROM INFORMATION_SCHEMA.STATISTICS
        WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND INDEX_NAME = ? LIMIT 1`,
      [dbName, table, indexName]
    );
    if (rows.length === 0) {
      await conn.query(`ALTER TABLE \`${table}\` ADD UNIQUE INDEX \`${indexName}\` ${colsExpr}`);
      console.log(`  + unique index ${table}.${indexName}`);
    }
  } catch (e) {
    console.warn(`  ! lewati unique index ${table}.${indexName}: ${e.message}`);
  }
}

// Pastikan unique key equipment_poweron mencakup kolom `state` (device_id, on_date, state)
// agar catatan on & off bisa berdampingan di hari yang sama. Untuk DB lama yang masih
// memakai unique (device_id, on_date), index diganti; DB baru (dari schema.sql) dilewati.
async function ensurePoweronUnique(conn, dbName) {
  try {
    const [cols] = await conn.query(
      `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.STATISTICS
        WHERE TABLE_SCHEMA=? AND TABLE_NAME='equipment_poweron' AND INDEX_NAME='uniq_poweron'
        ORDER BY SEQ_IN_INDEX`, [dbName]
    );
    if (cols.length && !cols.some((c) => c.COLUMN_NAME === 'state')) {
      await conn.query('ALTER TABLE equipment_poweron DROP INDEX uniq_poweron');
      await conn.query('ALTER TABLE equipment_poweron ADD UNIQUE KEY uniq_poweron (device_id, on_date, state)');
      console.log('  ~ equipment_poweron.uniq_poweron → sertakan state');
    }
  } catch (e) {
    console.warn(`  ! lewati fix uniq_poweron: ${e.message}`);
  }
}

async function dropColumnIfExists(conn, dbName, table, column) {
  const [rows] = await conn.query(
    `SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
    [dbName, table, column]
  );
  if (rows.length > 0) {
    await conn.query(`ALTER TABLE \`${table}\` DROP COLUMN \`${column}\``);
    console.log(`  - dropped ${table}.${column}`);
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
