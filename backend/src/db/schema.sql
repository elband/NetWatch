CREATE DATABASE IF NOT EXISTS netwatch_erp CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE netwatch_erp;

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
  inspect_required TINYINT(1) NOT NULL DEFAULT 1,
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
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
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
  status ENUM('menunggu','disetujui','ditolak') NOT NULL DEFAULT 'menunggu',
  approved_by INT DEFAULT NULL,
  approver_name VARCHAR(120) DEFAULT NULL,
  approved_at DATETIME DEFAULT NULL,
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
