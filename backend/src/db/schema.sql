CREATE DATABASE IF NOT EXISTS netwatch_erp CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE netwatch_erp;

-- Unit kerja (multi-unit): Elektronika Bandara, Alat-Alat Besar, Water & Pump System.
-- Semua data operasional ber-unit_id (ditambahkan via migrate.js). unit_id NULL pada
-- users = super admin lintas unit; pada tabel master (locations/device_types/documents) = global.
CREATE TABLE IF NOT EXISTS units (
  id INT AUTO_INCREMENT PRIMARY KEY,
  code VARCHAR(20) NOT NULL UNIQUE,
  name VARCHAR(120) NOT NULL,
  description VARCHAR(255) DEFAULT NULL,
  icon VARCHAR(10) DEFAULT '🏢',
  active TINYINT(1) NOT NULL DEFAULT 1,
  config JSON DEFAULT NULL, -- Fase 4: override identitas surat per unit (kode, kop, koordinator)
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS users (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(120) NOT NULL,
  username VARCHAR(60) NOT NULL UNIQUE,
  email VARCHAR(150) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  pin_hash VARCHAR(255) DEFAULT NULL,
  phone VARCHAR(30) DEFAULT NULL,
  role ENUM('admin','koordinator','teknisi','viewer') NOT NULL DEFAULT 'viewer',
  roles JSON DEFAULT NULL,
  jabatan VARCHAR(120) DEFAULT NULL,
  emoji VARCHAR(10) DEFAULT '👤',
  avatar_url VARCHAR(255) DEFAULT NULL,
  active TINYINT(1) NOT NULL DEFAULT 1,
  perms JSON NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS devices (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(120) NOT NULL,
  ip VARCHAR(45) NOT NULL,
  type VARCHAR(60) NOT NULL,
  category VARCHAR(80) DEFAULT NULL,
  icon VARCHAR(10) DEFAULT NULL,
  loc VARCHAR(150) DEFAULT NULL,
  location_id INT DEFAULT NULL,
  inspect_required TINYINT(1) NOT NULL DEFAULT 1,
  is_uplink TINYINT(1) NOT NULL DEFAULT 0,          -- sumber internet/uplink (Mikrotik) — 1 per unit
  uplink_ifindex INT DEFAULT NULL,                  -- ifIndex SNMP interface WAN/SFP untuk baca kecepatan real
  always_on TINYINT(1) NOT NULL DEFAULT 0,
  status ENUM('online','warning','offline') NOT NULL DEFAULT 'offline',
  ping_ms INT DEFAULT 0,
  cpu INT DEFAULT 0,
  mem INT DEFAULT 0,
  ssh_host VARCHAR(45) DEFAULT NULL,
  ssh_port INT DEFAULT 22,
  ssh_username VARCHAR(60) DEFAULT NULL,
  ssh_password_enc VARCHAR(255) DEFAULT NULL,
  lat DECIMAL(10,7) DEFAULT NULL,
  lng DECIMAL(10,7) DEFAULT NULL,
  last_checked_at DATETIME DEFAULT NULL,
  offline_since DATETIME DEFAULT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB;

-- Riwayat metrik perangkat (time-series) — dasar grafik tren latency/CPU/mem
-- dan perhitungan SLA/uptime. Satu baris per perangkat per sweep ping.
CREATE TABLE IF NOT EXISTS device_metrics (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  device_id INT NOT NULL,
  status ENUM('online','warning','offline') NOT NULL,
  ping_ms INT NOT NULL DEFAULT 0,
  cpu INT DEFAULT NULL,
  mem INT DEFAULT NULL,
  in_maint TINYINT(1) NOT NULL DEFAULT 0,
  recorded_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_dm_device_time (device_id, recorded_at),
  CONSTRAINT fk_dm_device FOREIGN KEY (device_id) REFERENCES devices(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- Rollup harian uptime per perangkat — sumber laporan SLA jangka panjang
-- (tetap akurat walau metrik mentah sudah dipangkas retensi).
CREATE TABLE IF NOT EXISTS device_uptime_daily (
  device_id INT NOT NULL,
  day DATE NOT NULL,
  samples INT NOT NULL DEFAULT 0,
  up_samples INT NOT NULL DEFAULT 0,
  warn_samples INT NOT NULL DEFAULT 0,
  down_samples INT NOT NULL DEFAULT 0,
  maint_samples INT NOT NULL DEFAULT 0,
  avg_ping INT DEFAULT NULL,
  max_ping INT DEFAULT NULL,
  incidents INT NOT NULL DEFAULT 0,
  down_seconds INT NOT NULL DEFAULT 0,
  PRIMARY KEY (device_id, day),
  CONSTRAINT fk_dud_device FOREIGN KEY (device_id) REFERENCES devices(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- Jendela maintenance terjadwal — saat aktif, perangkat tidak memicu insiden
-- otomatis/alarm WA dan sampel dihitung "maintenance" (tidak menurunkan SLA).
CREATE TABLE IF NOT EXISTS maintenance_windows (
  id INT AUTO_INCREMENT PRIMARY KEY,
  device_id INT DEFAULT NULL,
  location_id INT DEFAULT NULL,
  title VARCHAR(160) NOT NULL,
  reason TEXT DEFAULT NULL,
  starts_at DATETIME NOT NULL,
  ends_at DATETIME NOT NULL,
  status ENUM('terjadwal','selesai') NOT NULL DEFAULT 'terjadwal',
  done_note VARCHAR(255) DEFAULT NULL,
  done_by INT DEFAULT NULL,
  done_at DATETIME DEFAULT NULL,
  created_by INT DEFAULT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_mw_window (starts_at, ends_at),
  INDEX idx_mw_device (device_id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS incidents (
  id VARCHAR(20) PRIMARY KEY,
  device_id INT DEFAULT NULL,
  device_name VARCHAR(120) NOT NULL,
  ip VARCHAR(45) DEFAULT NULL,
  issue VARCHAR(255) NOT NULL,
  priority ENUM('kritis','tinggi','sedang') NOT NULL DEFAULT 'sedang',
  tech_id INT DEFAULT NULL,
  coord_id INT DEFAULT NULL,
  status ENUM('aktif','proses','selesai') NOT NULL DEFAULT 'aktif',
  awaiting_part TINYINT(1) NOT NULL DEFAULT 0,
  coord_alerted TINYINT(1) NOT NULL DEFAULT 0,
  tech_reminded TINYINT(1) NOT NULL DEFAULT 0,
  step INT NOT NULL DEFAULT 1,
  source ENUM('auto','manual','public_report') NOT NULL DEFAULT 'manual',
  public_report_id VARCHAR(20) DEFAULT NULL,
  taken_at DATETIME DEFAULT NULL,
  resolved_at DATETIME DEFAULT NULL,
  duration_min INT DEFAULT NULL,
  resolved_by VARCHAR(64) DEFAULT NULL,
  resolution_type VARCHAR(16) DEFAULT NULL,
  recovered_at DATETIME DEFAULT NULL,
  auto_recovery_since DATETIME DEFAULT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (device_id) REFERENCES devices(id) ON DELETE SET NULL,
  FOREIGN KEY (tech_id) REFERENCES users(id) ON DELETE SET NULL,
  FOREIGN KEY (coord_id) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS incident_notes (
  id INT AUTO_INCREMENT PRIMARY KEY,
  incident_id VARCHAR(20) NOT NULL,
  step INT NOT NULL,
  note TEXT NOT NULL,
  doc_url VARCHAR(255) DEFAULT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (incident_id) REFERENCES incidents(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- Snapshot teknisi yang sedang on-duty saat insiden masuk (untuk perhitungan SLA).
CREATE TABLE IF NOT EXISTS incident_duty (
  incident_id VARCHAR(20) NOT NULL,
  user_id INT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (incident_id, user_id),
  FOREIGN KEY (incident_id) REFERENCES incidents(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS incident_reports (
  incident_id VARCHAR(20) PRIMARY KEY,
  kerusakan TEXT NOT NULL,
  penyebab TEXT DEFAULT NULL,
  perbaikan TEXT NOT NULL,
  sparepart TEXT DEFAULT NULL,
  hasil ENUM('berhasil','sebagian','gagal') NOT NULL DEFAULT 'berhasil',
  reported_by INT DEFAULT NULL,
  reporter_name VARCHAR(120) DEFAULT NULL,
  signed_by INT DEFAULT NULL,
  signer_name VARCHAR(120) DEFAULT NULL,
  signer_nip VARCHAR(40) DEFAULT NULL,
  signed_at DATETIME DEFAULT NULL,
  sign_token VARCHAR(80) DEFAULT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (incident_id) REFERENCES incidents(id) ON DELETE CASCADE,
  FOREIGN KEY (reported_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS shifts (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  shift_date DATE NOT NULL,
  shift_type ENUM('pagi','siang','malam','libur','dinas_luar','cuti') NOT NULL DEFAULT 'libur',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uniq_user_date (user_id, shift_date),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS wa_log (
  id INT AUTO_INCREMENT PRIMARY KEY,
  type ENUM('alert','done','report','other') NOT NULL DEFAULT 'other',
  to_user_id INT DEFAULT NULL,
  to_label VARCHAR(150) DEFAULT NULL,
  phone VARCHAR(30) DEFAULT NULL,
  message TEXT NOT NULL,
  status ENUM('pending','sent','failed') NOT NULL DEFAULT 'pending',
  attempts INT NOT NULL DEFAULT 0,
  error TEXT DEFAULT NULL,
  related_incident_id VARCHAR(20) DEFAULT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  sent_at DATETIME DEFAULT NULL,
  FOREIGN KEY (to_user_id) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS public_reports (
  id VARCHAR(20) PRIMARY KEY,
  nama VARCHAR(150) NOT NULL,
  nip VARCHAR(50) DEFAULT NULL,
  unit VARCHAR(150) NOT NULL,
  hp VARCHAR(30) NOT NULL,
  judul VARCHAR(255) NOT NULL,
  jenis VARCHAR(100) NOT NULL,
  merk VARCHAR(100) DEFAULT NULL,
  inv VARCHAR(100) DEFAULT NULL,
  gedung VARCHAR(150) DEFAULT NULL,
  ruang VARCHAR(150) DEFAULT NULL,
  urgensi ENUM('kritis','tinggi','sedang','rendah') NOT NULL DEFAULT 'sedang',
  detail TEXT NOT NULL,
  status ENUM('menunggu','diproses','selesai') NOT NULL DEFAULT 'menunggu',
  tech_note TEXT DEFAULT NULL,
  incident_id VARCHAR(20) DEFAULT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (incident_id) REFERENCES incidents(id) ON DELETE SET NULL
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS public_report_photos (
  id INT AUTO_INCREMENT PRIMARY KEY,
  report_id VARCHAR(20) NOT NULL,
  file_path VARCHAR(255) NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (report_id) REFERENCES public_reports(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- Aset/inventaris yang dipegang teknisi (dikelola admin).
CREATE TABLE IF NOT EXISTS assets (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(150) NOT NULL,
  code VARCHAR(80) DEFAULT NULL,
  category VARCHAR(80) DEFAULT NULL,
  qty INT NOT NULL DEFAULT 1,
  unit VARCHAR(30) NOT NULL DEFAULT 'Unit',
  icon VARCHAR(10) DEFAULT '📦',
  holder_user_id INT DEFAULT NULL,
  status ENUM('baik','rusak','perbaikan','hilang') NOT NULL DEFAULT 'baik',
  notes VARCHAR(255) DEFAULT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (holder_user_id) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB;

-- Layanan kritis yang dimonitor (dikelola admin).
CREATE TABLE IF NOT EXISTS services (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(120) NOT NULL,
  icon VARCHAR(10) DEFAULT '🟢',
  status VARCHAR(60) NOT NULL DEFAULT 'Online',
  is_ok TINYINT(1) NOT NULL DEFAULT 1,
  detail VARCHAR(120) DEFAULT NULL,
  sort_order INT NOT NULL DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB;

-- Lokasi/area untuk peta gangguan (dikelola admin).
CREATE TABLE IF NOT EXISTS locations (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(120) NOT NULL,
  icon VARCHAR(10) DEFAULT '📍',
  map_x FLOAT DEFAULT NULL,
  map_y FLOAT DEFAULT NULL,
  lat DECIMAL(10,7) DEFAULT NULL,
  lng DECIMAL(10,7) DEFAULT NULL,
  sort_order INT NOT NULL DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB;

-- Master data tipe perangkat (dropdown "Tipe" pada form perangkat).
CREATE TABLE IF NOT EXISTS device_types (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(80) NOT NULL UNIQUE,
  icon VARCHAR(10) DEFAULT NULL,
  sort_order INT NOT NULL DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS settings (
  setting_key VARCHAR(80) PRIMARY KEY,
  setting_value JSON NOT NULL,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB;

-- Nota Dinas (memo pengantar) dari koordinator untuk laporan kerusakan.
CREATE TABLE IF NOT EXISTS nota_dinas (
  id INT AUTO_INCREMENT PRIMARY KEY,
  nomor VARCHAR(60) NOT NULL,
  seq INT NOT NULL,
  bulan INT NOT NULL,
  tahun INT NOT NULL,
  incident_id VARCHAR(20) DEFAULT NULL,
  hal VARCHAR(255) NOT NULL,
  tanggal DATE NOT NULL,
  created_by INT DEFAULT NULL,
  creator_name VARCHAR(120) DEFAULT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (incident_id) REFERENCES incidents(id) ON DELETE SET NULL,
  FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB;

-- Absensi teknisi (hadir masuk & pulang) dengan deteksi lokasi/VPN.
CREATE TABLE IF NOT EXISTS attendance (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  work_date DATE NOT NULL,
  check_in_at DATETIME DEFAULT NULL,
  check_in_lat DECIMAL(10,7) DEFAULT NULL,
  check_in_lng DECIMAL(10,7) DEFAULT NULL,
  check_in_dist_m INT DEFAULT NULL,
  check_in_ip VARCHAR(60) DEFAULT NULL,
  check_in_vpn TINYINT(1) NOT NULL DEFAULT 0,
  check_out_at DATETIME DEFAULT NULL,
  check_out_lat DECIMAL(10,7) DEFAULT NULL,
  check_out_lng DECIMAL(10,7) DEFAULT NULL,
  check_out_ip VARCHAR(60) DEFAULT NULL,
  check_out_vpn TINYINT(1) NOT NULL DEFAULT 0,
  flagged TINYINT(1) NOT NULL DEFAULT 0,
  reason VARCHAR(255) DEFAULT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uniq_user_day (user_id, work_date),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- Tinjauan absen oleh koordinator: penalti performa absen HANYA berlaku setelah
-- dikonfirmasi 'penalti'. Tanpa baris = belum ditinjau (tidak dipenalti).
CREATE TABLE IF NOT EXISTS absence_reviews (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  work_date DATE NOT NULL,
  status ENUM('penalti','dimaafkan') NOT NULL,
  note VARCHAR(255) DEFAULT NULL,
  decided_by INT DEFAULT NULL,
  decided_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uniq_absence (user_id, work_date),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (decided_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB;

-- Pengajuan izin/sakit/cuti/dinas luar (dengan persetujuan koordinator).
CREATE TABLE IF NOT EXISTS leave_requests (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  type ENUM('izin','sakit','cuti','dinas_luar') NOT NULL DEFAULT 'izin',
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  reason VARCHAR(255) DEFAULT NULL,
  doc_url VARCHAR(255) DEFAULT NULL,
  status ENUM('menunggu','disetujui','ditolak') NOT NULL DEFAULT 'menunggu',
  approved_by INT DEFAULT NULL,
  approver_name VARCHAR(120) DEFAULT NULL,
  approved_at DATETIME DEFAULT NULL,
  coord_note VARCHAR(255) DEFAULT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (approved_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB;

-- Pengajuan Diklat (training application) — alur seperti modul Laporan Bulanan/Nota Dinas.
CREATE TABLE IF NOT EXISTS pengajuan_diklat (
  id INT AUTO_INCREMENT PRIMARY KEY,
  nomor_pengajuan VARCHAR(60) NOT NULL,
  seq INT NOT NULL,
  tahun INT NOT NULL,
  nomor_nota_dinas VARCHAR(60) DEFAULT NULL,
  nota_dinas_id INT DEFAULT NULL,
  tanggal_pengajuan DATE NOT NULL,
  pegawai_id INT DEFAULT NULL,
  pegawai_nama VARCHAR(120) DEFAULT NULL,
  nip VARCHAR(40) DEFAULT NULL,
  jabatan VARCHAR(120) DEFAULT NULL,
  unit_kerja VARCHAR(120) DEFAULT NULL,
  nama_diklat VARCHAR(200) NOT NULL,
  penyelenggara VARCHAR(160) DEFAULT NULL,
  lokasi VARCHAR(160) DEFAULT NULL,
  tanggal_mulai DATE DEFAULT NULL,
  tanggal_selesai DATE DEFAULT NULL,
  durasi VARCHAR(60) DEFAULT NULL,
  biaya BIGINT DEFAULT 0,
  tujuan TEXT DEFAULT NULL,
  keterangan TEXT DEFAULT NULL,
  file_pendukung VARCHAR(255) DEFAULT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'draft',
  created_by INT DEFAULT NULL,
  creator_name VARCHAR(120) DEFAULT NULL,
  approved_by INT DEFAULT NULL,
  approver_name VARCHAR(120) DEFAULT NULL,
  approved_at DATETIME DEFAULT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (pegawai_id) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB;

-- Riwayat persetujuan pengajuan diklat.
CREATE TABLE IF NOT EXISTS diklat_history (
  id INT AUTO_INCREMENT PRIMARY KEY,
  diklat_id INT NOT NULL,
  user_id INT DEFAULT NULL,
  user_name VARCHAR(120) DEFAULT NULL,
  status VARCHAR(20) NOT NULL,
  note VARCHAR(255) DEFAULT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (diklat_id) REFERENCES pengajuan_diklat(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- ===== Pelaporan Fasilitas berbasis QR =====
CREATE TABLE IF NOT EXISTS rooms (
  id INT AUTO_INCREMENT PRIMARY KEY,
  kode VARCHAR(40) NOT NULL UNIQUE,
  nama VARCHAR(120) NOT NULL,
  gedung VARCHAR(80) DEFAULT NULL,
  lantai VARCHAR(40) DEFAULT NULL,
  area VARCHAR(80) DEFAULT NULL,
  penanggung_jawab VARCHAR(120) DEFAULT NULL,
  active TINYINT(1) NOT NULL DEFAULT 1,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS report_attachments (
  id INT AUTO_INCREMENT PRIMARY KEY,
  report_id VARCHAR(20) NOT NULL,
  file_url VARCHAR(255) NOT NULL,
  mimetype VARCHAR(100) DEFAULT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (report_id) REFERENCES public_reports(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- ===== Laporan Kegiatan Non-Rutin =====
CREATE TABLE IF NOT EXISTS kegiatan_non_rutin_categories (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(80) NOT NULL UNIQUE,
  sort_order INT DEFAULT 0
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS kegiatan_non_rutin (
  id INT AUTO_INCREMENT PRIMARY KEY,
  nomor VARCHAR(60) NOT NULL,
  seq INT NOT NULL,
  tahun INT NOT NULL,
  tanggal_kegiatan DATE NOT NULL,
  petugas_id INT DEFAULT NULL,
  petugas_nama VARCHAR(120) DEFAULT NULL,
  unit_kerja VARCHAR(120) DEFAULT NULL,
  kategori VARCHAR(80) NOT NULL,
  judul VARCHAR(200) NOT NULL,
  lokasi VARCHAR(160) DEFAULT NULL,
  uraian TEXT DEFAULT NULL,
  hasil TEXT DEFAULT NULL,
  durasi_jam DECIMAL(6,1) DEFAULT 0,
  jumlah_personel INT DEFAULT 1,
  tingkat_kesulitan VARCHAR(20) NOT NULL DEFAULT 'rendah',
  poin INT NOT NULL DEFAULT 1,
  status VARCHAR(20) NOT NULL DEFAULT 'draft',
  catatan_koordinator VARCHAR(255) DEFAULT NULL,
  nomor_nota_dinas VARCHAR(60) DEFAULT NULL,
  nota_dinas_id INT DEFAULT NULL,
  created_by INT DEFAULT NULL,
  creator_name VARCHAR(120) DEFAULT NULL,
  approved_by INT DEFAULT NULL,
  approver_name VARCHAR(120) DEFAULT NULL,
  approved_at DATETIME DEFAULT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (petugas_id) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS kegiatan_non_rutin_files (
  id INT AUTO_INCREMENT PRIMARY KEY,
  kegiatan_id INT NOT NULL,
  file_url VARCHAR(255) NOT NULL,
  filename VARCHAR(200) DEFAULT NULL,
  mimetype VARCHAR(100) DEFAULT NULL,
  jenis VARCHAR(20) DEFAULT 'dokumen',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (kegiatan_id) REFERENCES kegiatan_non_rutin(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS kegiatan_non_rutin_approval (
  id INT AUTO_INCREMENT PRIMARY KEY,
  kegiatan_id INT NOT NULL,
  user_id INT DEFAULT NULL,
  user_name VARCHAR(120) DEFAULT NULL,
  status VARCHAR(20) NOT NULL,
  note VARCHAR(255) DEFAULT NULL,
  poin INT DEFAULT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (kegiatan_id) REFERENCES kegiatan_non_rutin(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- ===== Perencanaan Unit (Program Kerja / Rencana Kerja tingkat unit) =====
CREATE TABLE IF NOT EXISTS unit_plans (
  id INT AUTO_INCREMENT PRIMARY KEY,
  unit_id INT DEFAULT NULL,
  tahun SMALLINT NOT NULL,
  kuartal TINYINT NOT NULL DEFAULT 0,                 -- 0 = tahunan, 1..4 = Triwulan I..IV
  kategori VARCHAR(24) NOT NULL DEFAULT 'lainnya',    -- pemeliharaan|pengadaan|sdm|pengembangan|administrasi|lainnya
  judul VARCHAR(200) NOT NULL,
  deskripsi TEXT DEFAULT NULL,
  tujuan VARCHAR(500) DEFAULT NULL,                   -- sasaran/tujuan rencana
  keluaran VARCHAR(500) DEFAULT NULL,                 -- output/keluaran konkret
  volume VARCHAR(120) DEFAULT NULL,                   -- jumlah/satuan (mis. "10 set")
  indikator VARCHAR(500) DEFAULT NULL,               -- indikator keberhasilan
  prioritas VARCHAR(8) NOT NULL DEFAULT 'sedang',     -- tinggi|sedang|rendah
  status VARCHAR(12) NOT NULL DEFAULT 'rencana',      -- rencana|berjalan|selesai|tertunda|batal
  progres TINYINT NOT NULL DEFAULT 0,                 -- 0..100
  estimasi_biaya BIGINT NOT NULL DEFAULT 0,           -- rupiah
  realisasi_biaya BIGINT DEFAULT NULL,                -- rupiah (kosong = belum terealisasi)
  sumber_dana VARCHAR(40) DEFAULT NULL,               -- BLU|DIPA (RM)|PNBP|Hibah|Lainnya
  start_date DATE DEFAULT NULL,
  target_date DATE DEFAULT NULL,
  metode VARCHAR(40) DEFAULT NULL,                    -- Swakelola|Pengadaan Langsung|Tender|E-Katalog|Lainnya
  pic_user_id INT DEFAULT NULL,                       -- opsional: tautan ke user (untuk fase lanjut)
  pic_nama VARCHAR(120) DEFAULT NULL,
  catatan VARCHAR(500) DEFAULT NULL,
  created_by INT DEFAULT NULL,
  creator_name VARCHAR(120) DEFAULT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_unit_plans_unit (unit_id),
  INDEX idx_unit_plans_tahun (tahun)
) ENGINE=InnoDB;

-- Target & KPI unit (Tahap 2 Perencanaan): target + realisasi per tahun.
CREATE TABLE IF NOT EXISTS unit_kpi_targets (
  id INT AUTO_INCREMENT PRIMARY KEY,
  unit_id INT DEFAULT NULL,
  tahun SMALLINT NOT NULL,
  label VARCHAR(120) NOT NULL,
  satuan VARCHAR(20) DEFAULT NULL,
  target DECIMAL(12,2) DEFAULT NULL,
  realisasi DECIMAL(12,2) DEFAULT NULL,
  arah VARCHAR(8) NOT NULL DEFAULT 'naik',            -- 'naik' = makin tinggi makin baik; 'turun' = makin rendah makin baik (mis. MTTR)
  catatan VARCHAR(300) DEFAULT NULL,
  sort_order INT DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_ukt_unit (unit_id),
  INDEX idx_ukt_tahun (tahun)
) ENGINE=InnoDB;

-- ===== Manajemen Dokumen / Knowledge Base =====
CREATE TABLE IF NOT EXISTS document_categories (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(80) NOT NULL UNIQUE,
  sort_order INT DEFAULT 0
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS documents (
  id INT AUTO_INCREMENT PRIMARY KEY,
  nomor VARCHAR(80) DEFAULT NULL,
  judul VARCHAR(200) NOT NULL,
  kategori VARCHAR(80) NOT NULL,
  sub_kategori VARCHAR(80) DEFAULT NULL,
  deskripsi TEXT DEFAULT NULL,
  tags VARCHAR(255) DEFAULT NULL,
  versi VARCHAR(20) DEFAULT '1.0',
  tanggal_berlaku DATE DEFAULT NULL,
  tanggal_review DATE DEFAULT NULL,
  pemilik VARCHAR(120) DEFAULT NULL,
  unit_kerja VARCHAR(120) DEFAULT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'draft',
  file_url VARCHAR(255) DEFAULT NULL,
  file_name VARCHAR(200) DEFAULT NULL,
  video_url VARCHAR(255) DEFAULT NULL,
  link_ref VARCHAR(255) DEFAULT NULL,
  catatan_revisi VARCHAR(255) DEFAULT NULL,
  views INT NOT NULL DEFAULT 0,
  created_by INT DEFAULT NULL,
  creator_name VARCHAR(120) DEFAULT NULL,
  approved_by INT DEFAULT NULL,
  approver_name VARCHAR(120) DEFAULT NULL,
  approved_at DATETIME DEFAULT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS document_versions (
  id INT AUTO_INCREMENT PRIMARY KEY,
  document_id INT NOT NULL,
  versi VARCHAR(20) DEFAULT NULL,
  file_url VARCHAR(255) DEFAULT NULL,
  catatan VARCHAR(255) DEFAULT NULL,
  created_by INT DEFAULT NULL,
  creator_name VARCHAR(120) DEFAULT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS document_comments (
  id INT AUTO_INCREMENT PRIMARY KEY,
  document_id INT NOT NULL,
  user_id INT DEFAULT NULL,
  user_name VARCHAR(120) DEFAULT NULL,
  body VARCHAR(1000) NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS document_favorites (
  id INT AUTO_INCREMENT PRIMARY KEY,
  document_id INT NOT NULL,
  user_id INT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uniq_fav (document_id, user_id),
  FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS document_views (
  id INT AUTO_INCREMENT PRIMARY KEY,
  document_id INT NOT NULL,
  user_id INT DEFAULT NULL,
  user_name VARCHAR(120) DEFAULT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS document_tags (
  id INT AUTO_INCREMENT PRIMARY KEY,
  document_id INT NOT NULL,
  tag VARCHAR(60) NOT NULL,
  FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- Jejak audit perubahan (absensi, izin, device binding, dll.).
CREATE TABLE IF NOT EXISTS audit_log (
  id INT AUTO_INCREMENT PRIMARY KEY,
  actor_id INT DEFAULT NULL,
  actor_name VARCHAR(120) DEFAULT NULL,
  action VARCHAR(60) NOT NULL,
  target_type VARCHAR(40) DEFAULT NULL,
  target_id VARCHAR(40) DEFAULT NULL,
  detail VARCHAR(255) DEFAULT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;

-- Lampiran bukti dukung untuk surat keluar (gambar/PDF).
CREATE TABLE IF NOT EXISTS surat_lampiran (
  id INT AUTO_INCREMENT PRIMARY KEY,
  surat_id INT NOT NULL,
  file_url VARCHAR(255) NOT NULL,
  filename VARCHAR(200) DEFAULT NULL,
  mimetype VARCHAR(100) DEFAULT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (surat_id) REFERENCES nota_dinas(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- Kegiatan lain teknisi (rapat, lembur, dll) yang perlu disetujui koordinator.
CREATE TABLE IF NOT EXISTS activities (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  type VARCHAR(40) NOT NULL DEFAULT 'lainnya',
  title VARCHAR(150) NOT NULL,
  detail TEXT DEFAULT NULL,
  activity_date DATE NOT NULL,
  start_time VARCHAR(5) DEFAULT NULL,
  end_time VARCHAR(5) DEFAULT NULL,
  bukti_url VARCHAR(255) DEFAULT NULL,
  doc_urls JSON DEFAULT NULL,
  doc_note VARCHAR(255) DEFAULT NULL,
  status ENUM('menunggu','disetujui','ditolak') NOT NULL DEFAULT 'menunggu',
  approved_by INT DEFAULT NULL,
  approver_name VARCHAR(120) DEFAULT NULL,
  approved_at DATETIME DEFAULT NULL,
  completed_at DATETIME DEFAULT NULL,
  coord_note VARCHAR(255) DEFAULT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (approved_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB;

-- Inspeksi harian peralatan pada 3 slot waktu (09:00, 12:00, 15:00).
-- Diisi oleh teknisi yang sedang on-duty.
CREATE TABLE IF NOT EXISTS equipment_inspections (
  id INT AUTO_INCREMENT PRIMARY KEY,
  device_id INT NOT NULL,
  inspect_date DATE NOT NULL,
  slot ENUM('09','12','15') NOT NULL,
  status ENUM('baik','perhatian','rusak') NOT NULL DEFAULT 'baik',
  note VARCHAR(255) DEFAULT NULL,
  photo_url VARCHAR(255) DEFAULT NULL,
  photo_hash CHAR(64) DEFAULT NULL,
  verified TINYINT(1) NOT NULL DEFAULT 0,
  distance_m INT DEFAULT NULL,
  flagged TINYINT(1) NOT NULL DEFAULT 0,
  inspected_by INT DEFAULT NULL,
  inspector_name VARCHAR(120) DEFAULT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uniq_insp (device_id, inspect_date, slot),
  FOREIGN KEY (device_id) REFERENCES devices(id) ON DELETE CASCADE,
  FOREIGN KEY (inspected_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB;

-- Rencana & pelaksanaan maintenance bulanan peralatan.
-- Direncanakan koordinator/admin (bisa via impor Excel), dieksekusi teknisi.
CREATE TABLE IF NOT EXISTS equipment_maintenance (
  id INT AUTO_INCREMENT PRIMARY KEY,
  device_id INT NOT NULL,
  plan_month VARCHAR(7) NOT NULL,
  scheduled_date DATE NOT NULL,
  task VARCHAR(255) NOT NULL,
  status ENUM('rencana','selesai','batal') NOT NULL DEFAULT 'rencana',
  note VARCHAR(255) DEFAULT NULL,
  created_by INT DEFAULT NULL,
  done_by INT DEFAULT NULL,
  done_at DATETIME DEFAULT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (device_id) REFERENCES devices(id) ON DELETE CASCADE,
  FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL,
  FOREIGN KEY (done_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB;

-- Dokumentasi foto maintenance (banyak foto per rencana maintenance).
CREATE TABLE IF NOT EXISTS equipment_maintenance_photos (
  id INT AUTO_INCREMENT PRIMARY KEY,
  maintenance_id INT NOT NULL,
  url VARCHAR(255) NOT NULL,
  caption VARCHAR(255) DEFAULT NULL,
  uploaded_by INT DEFAULT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_mphoto_maint (maintenance_id),
  FOREIGN KEY (maintenance_id) REFERENCES equipment_maintenance(id) ON DELETE CASCADE,
  FOREIGN KEY (uploaded_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB;

-- Catatan menghidupkan/mematikan peralatan harian (1x per perangkat per state per hari).
-- Kedua aksi (on/off) wajib foto dokumentasi + verifikasi anti-foto-palsu (waktu tangkap & GPS).
CREATE TABLE IF NOT EXISTS equipment_poweron (
  id INT AUTO_INCREMENT PRIMARY KEY,
  device_id INT NOT NULL,
  on_date DATE NOT NULL,
  state ENUM('on','off') NOT NULL DEFAULT 'on',
  note VARCHAR(255) DEFAULT NULL,
  photo_url VARCHAR(255) DEFAULT NULL,
  photo_hash CHAR(64) DEFAULT NULL,
  verified TINYINT(1) NOT NULL DEFAULT 0,
  distance_m INT DEFAULT NULL,
  flagged TINYINT(1) NOT NULL DEFAULT 0,
  done_by INT DEFAULT NULL,
  done_by_name VARCHAR(120) DEFAULT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uniq_poweron (device_id, on_date, state),
  FOREIGN KEY (device_id) REFERENCES devices(id) ON DELETE CASCADE,
  FOREIGN KEY (done_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB;

-- Dokumentasi foto penyelesaian jendela maintenance (banyak foto per jendela).
CREATE TABLE IF NOT EXISTS maintenance_window_photos (
  id INT AUTO_INCREMENT PRIMARY KEY,
  window_id INT NOT NULL,
  url VARCHAR(255) NOT NULL,
  uploaded_by INT DEFAULT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_mwphoto_window (window_id),
  FOREIGN KEY (window_id) REFERENCES maintenance_windows(id) ON DELETE CASCADE,
  FOREIGN KEY (uploaded_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB;

-- Notification Center: notifikasi per-user, dikirim real-time via Socket.IO.
CREATE TABLE IF NOT EXISTS notifications (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  title VARCHAR(160) NOT NULL,
  message VARCHAR(400) DEFAULT NULL,
  type VARCHAR(40) NOT NULL,
  priority ENUM('kritis','warning','selesai','info') NOT NULL DEFAULT 'info',
  reference_id VARCHAR(40) DEFAULT NULL,
  reference_type VARCHAR(40) DEFAULT NULL,
  link VARCHAR(200) DEFAULT NULL,
  is_read TINYINT(1) NOT NULL DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_notif_user_read (user_id, is_read),
  INDEX idx_notif_user_cursor (user_id, id),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- Kolaborasi insiden ("Kerjakan Bersama"): teknisi pemilik job mengajak teknisi
-- lain untuk diberi tahu & bisa melihat insiden (read-only).
CREATE TABLE IF NOT EXISTS incident_collaborators (
  id INT AUTO_INCREMENT PRIMARY KEY,
  incident_id VARCHAR(20) NOT NULL,
  user_id INT NOT NULL,
  invited_by INT DEFAULT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uniq_collab (incident_id, user_id),
  FOREIGN KEY (incident_id) REFERENCES incidents(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (invited_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB;

-- ===== SKP (Sasaran Kinerja Pegawai / e-Kinerja) =====
-- Header SKP per pegawai per periode. public_token → halaman publik read-only seluruh SKP.
CREATE TABLE IF NOT EXISTS skp (
  id INT AUTO_INCREMENT PRIMARY KEY,
  periode VARCHAR(40) NOT NULL,
  tahun INT NOT NULL,
  pendekatan VARCHAR(30) NOT NULL DEFAULT 'Kuantitatif',
  pegawai_id INT DEFAULT NULL,
  pegawai_nama VARCHAR(120) DEFAULT NULL,
  pegawai_nip VARCHAR(40) DEFAULT NULL,
  pegawai_jabatan VARCHAR(160) DEFAULT NULL,
  pegawai_unit VARCHAR(160) DEFAULT NULL,
  penilai_nama VARCHAR(120) DEFAULT NULL,
  penilai_nip VARCHAR(40) DEFAULT NULL,
  penilai_jabatan VARCHAR(160) DEFAULT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'draft',
  tanggal_pengajuan DATE DEFAULT NULL,
  public_token VARCHAR(80) DEFAULT NULL,
  created_by INT DEFAULT NULL,
  creator_name VARCHAR(120) DEFAULT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uniq_skp_token (public_token),
  INDEX idx_skp_owner (created_by),
  FOREIGN KEY (pegawai_id) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB;

-- Rencana Hasil Kerja (RHK). Satu RHK punya >=1 indikator.
CREATE TABLE IF NOT EXISTS skp_rhk (
  id INT AUTO_INCREMENT PRIMARY KEY,
  skp_id INT NOT NULL,
  urutan INT NOT NULL DEFAULT 0,
  klasifikasi VARCHAR(20) NOT NULL DEFAULT 'utama',
  rhk TEXT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_skp_rhk_skp (skp_id),
  FOREIGN KEY (skp_id) REFERENCES skp(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- Indikator Kinerja Individu (IKI) + rencana aksi (renaksi) = DEFINISI TAHUNAN (dipakai tiap bulan).
-- Realisasi & feedback bersifat bulanan → tabel skp_realisasi.
CREATE TABLE IF NOT EXISTS skp_indikator (
  id INT AUTO_INCREMENT PRIMARY KEY,
  rhk_id INT NOT NULL,
  skp_id INT NOT NULL,
  urutan INT NOT NULL DEFAULT 0,
  aspek VARCHAR(20) NOT NULL DEFAULT 'Kuantitas',
  indikator TEXT NOT NULL,
  target VARCHAR(200) DEFAULT NULL,
  renaksi TEXT DEFAULT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_skp_ind_rhk (rhk_id),
  INDEX idx_skp_ind_skp (skp_id),
  FOREIGN KEY (rhk_id) REFERENCES skp_rhk(id) ON DELETE CASCADE,
  FOREIGN KEY (skp_id) REFERENCES skp(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- Status & tanggal pengajuan penilaian PER BULAN (1 SKP tahunan dipakai 12 bulan).
CREATE TABLE IF NOT EXISTS skp_bulan (
  id INT AUTO_INCREMENT PRIMARY KEY,
  skp_id INT NOT NULL,
  bulan VARCHAR(7) NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'draft',
  tanggal_pengajuan DATE DEFAULT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uniq_skp_bulan (skp_id, bulan),
  FOREIGN KEY (skp_id) REFERENCES skp(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- Realisasi & feedback per indikator PER BULAN.
CREATE TABLE IF NOT EXISTS skp_realisasi (
  id INT AUTO_INCREMENT PRIMARY KEY,
  indikator_id INT NOT NULL,
  skp_id INT NOT NULL,
  bulan VARCHAR(7) NOT NULL,
  realisasi TEXT DEFAULT NULL,
  feedback TEXT DEFAULT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uniq_skp_real (indikator_id, bulan),
  INDEX idx_skp_real_skp_bulan (skp_id, bulan),
  FOREIGN KEY (indikator_id) REFERENCES skp_indikator(id) ON DELETE CASCADE,
  FOREIGN KEY (skp_id) REFERENCES skp(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- Bukti Data Dukung per indikator. public_token → halaman publik verifikasi item.
-- kind: 'link' (URL eksternal) | 'file' (unggahan) | 'data' (snapshot data aplikasi).
-- Untuk 'data': source = kunci sumber, params = filter (mis. {bulan}), snapshot = data beku saat dibuat.
CREATE TABLE IF NOT EXISTS skp_bukti (
  id INT AUTO_INCREMENT PRIMARY KEY,
  indikator_id INT NOT NULL,
  skp_id INT NOT NULL,
  bulan VARCHAR(7) DEFAULT NULL,
  urutan INT NOT NULL DEFAULT 0,
  deskripsi VARCHAR(255) NOT NULL,
  kind VARCHAR(10) NOT NULL DEFAULT 'link',
  source VARCHAR(40) DEFAULT NULL,
  params JSON DEFAULT NULL,
  snapshot JSON DEFAULT NULL,
  url VARCHAR(500) DEFAULT NULL,
  file_url VARCHAR(255) DEFAULT NULL,
  public_token VARCHAR(80) DEFAULT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uniq_skp_bukti_token (public_token),
  INDEX idx_skp_bukti_ind (indikator_id),
  INDEX idx_skp_bukti_skp (skp_id),
  FOREIGN KEY (indikator_id) REFERENCES skp_indikator(id) ON DELETE CASCADE,
  FOREIGN KEY (skp_id) REFERENCES skp(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- ===== Aset non-IP (Fase 2 multi-unit) =====
-- Peralatan fisik (AAB/WPS) dimodelkan sebagai baris `devices` dgn asset_class='physical'.
-- Kolom aset (asset_class, model, photo_url, op_status, qr_token) & unit_id ditambahkan
-- via migrate.js (idempoten). Dua tabel pendukung di bawah.

-- Pembacaan meter manual (time-series): jam operasi, BBM, tekanan, debit, level air, dst.
CREATE TABLE IF NOT EXISTS asset_readings (
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
) ENGINE=InnoDB;

-- Definisi metrik meter per unit (dikonfigurasi koordinator). unit_id NULL = default global.
CREATE TABLE IF NOT EXISTS asset_metric_types (
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
) ENGINE=InnoDB;

-- ===== Fase 3: checklist inspeksi, preventive maintenance & riwayat status =====
CREATE TABLE IF NOT EXISTS checklist_templates (
  id INT AUTO_INCREMENT PRIMARY KEY,
  unit_id INT DEFAULT NULL,
  name VARCHAR(120) NOT NULL,
  category VARCHAR(80) DEFAULT NULL,
  frequency ENUM('harian','bulanan') NOT NULL DEFAULT 'harian',
  active TINYINT(1) NOT NULL DEFAULT 1,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_ct_unit (unit_id)
) ENGINE=InnoDB;
CREATE TABLE IF NOT EXISTS checklist_template_items (
  id INT AUTO_INCREMENT PRIMARY KEY,
  template_id INT NOT NULL,
  label VARCHAR(160) NOT NULL,
  category VARCHAR(60) DEFAULT NULL,
  sort_order INT NOT NULL DEFAULT 0,
  CONSTRAINT fk_cti_tpl FOREIGN KEY (template_id) REFERENCES checklist_templates(id) ON DELETE CASCADE
) ENGINE=InnoDB;
CREATE TABLE IF NOT EXISTS checklist_runs (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  device_id INT NOT NULL,
  unit_id INT DEFAULT NULL,
  template_id INT DEFAULT NULL,
  frequency ENUM('harian','bulanan') NOT NULL DEFAULT 'harian',
  run_date DATE NOT NULL,
  period VARCHAR(7) DEFAULT NULL,
  overall ENUM('baik','perhatian','rusak') NOT NULL DEFAULT 'baik',
  serviceable TINYINT(1) DEFAULT NULL,
  note VARCHAR(255) DEFAULT NULL,
  photo_url VARCHAR(255) DEFAULT NULL,
  done_by INT DEFAULT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_cr_device_date (device_id, run_date),
  CONSTRAINT fk_cr_device FOREIGN KEY (device_id) REFERENCES devices(id) ON DELETE CASCADE
) ENGINE=InnoDB;
CREATE TABLE IF NOT EXISTS checklist_run_items (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  run_id BIGINT NOT NULL,
  label VARCHAR(160) NOT NULL,
  category VARCHAR(60) DEFAULT NULL,
  result ENUM('ok','tidak','na') NOT NULL DEFAULT 'ok',
  note VARCHAR(255) DEFAULT NULL,
  CONSTRAINT fk_cri_run FOREIGN KEY (run_id) REFERENCES checklist_runs(id) ON DELETE CASCADE
) ENGINE=InnoDB;
CREATE TABLE IF NOT EXISTS asset_pm_plans (
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
) ENGINE=InnoDB;
CREATE TABLE IF NOT EXISTS asset_pm_history (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  plan_id INT NOT NULL,
  device_id INT NOT NULL,
  done_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  meter_value DECIMAL(12,2) DEFAULT NULL,
  note VARCHAR(255) DEFAULT NULL,
  done_by INT DEFAULT NULL,
  INDEX idx_pmh_plan (plan_id),
  CONSTRAINT fk_pmh_plan FOREIGN KEY (plan_id) REFERENCES asset_pm_plans(id) ON DELETE CASCADE
) ENGINE=InnoDB;
CREATE TABLE IF NOT EXISTS asset_status_log (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  device_id INT NOT NULL,
  unit_id INT DEFAULT NULL,
  op_status ENUM('operasional','standby','rusak','perbaikan') NOT NULL,
  changed_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  changed_by INT DEFAULT NULL,
  INDEX idx_asl_device_time (device_id, changed_at),
  CONSTRAINT fk_asl_device FOREIGN KEY (device_id) REFERENCES devices(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- ===== Fase 4: sparepart & stok (per unit) =====
CREATE TABLE IF NOT EXISTS spareparts (
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
) ENGINE=InnoDB;
CREATE TABLE IF NOT EXISTS sparepart_moves (
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
) ENGINE=InnoDB;

-- ===== Fase 5 (AAB): grup fasilitas & obat air =====
-- Kolom devices (kondisi B/RR/RB, fasilitas, kebutuhan) ditambahkan via migrate.js.
CREATE TABLE IF NOT EXISTS asset_facilities (
  id INT AUTO_INCREMENT PRIMARY KEY,
  unit_id INT DEFAULT NULL,
  name VARCHAR(80) NOT NULL,
  sort_order INT NOT NULL DEFAULT 0,
  active TINYINT(1) NOT NULL DEFAULT 1,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uniq_af (unit_id, name)
) ENGINE=InnoDB;
CREATE TABLE IF NOT EXISTS water_chemicals (
  id INT AUTO_INCREMENT PRIMARY KEY,
  unit_id INT DEFAULT NULL,
  name VARCHAR(120) NOT NULL,
  satuan VARCHAR(20) NOT NULL DEFAULT 'kg',
  harga_satuan DECIMAL(12,2) NOT NULL DEFAULT 0,
  active TINYINT(1) NOT NULL DEFAULT 1,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_wc_unit (unit_id)
) ENGINE=InnoDB;
CREATE TABLE IF NOT EXISTS water_chemical_usage (
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
) ENGINE=InnoDB;
-- Peminjaman peralatan (AAB): pengajuan publik via scan QR di alat.
CREATE TABLE IF NOT EXISTS equipment_loans (
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
) ENGINE=InnoDB;
