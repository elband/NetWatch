export type Role = 'admin' | 'koordinator' | 'teknisi' | 'viewer';

// Unit kerja (multi-unit): ELB / AAB / WPS. Role admin = Super Admin lintas unit (unit_id null).
export interface Unit {
  id: number;
  code: string;
  name: string;
  description?: string | null;
  icon?: string | null;
  active?: number | boolean;
}

export interface User {
  id: number;
  name: string;
  username: string;
  email: string;
  phone: string | null;
  nip?: string | null;
  role: Role;
  roles: Role[];
  jabatan: string | null;
  emoji: string;
  avatar_url?: string | null;
  active: boolean;
  unit_id?: number | null;
  perms: string[];
  has_pin?: boolean;
}

export type NotifPriority = 'kritis' | 'warning' | 'selesai' | 'info';
export interface AppNotification {
  id: number;
  user_id: number;
  title: string;
  message: string | null;
  type: string;
  priority: NotifPriority;
  reference_id: string | null;
  reference_type: string | null;
  link: string | null;
  is_read: number;
  created_at: string;
}

export type DeviceStatus = 'online' | 'warning' | 'offline';

export interface Device {
  id: number;
  name: string;
  ip: string;
  type: string;
  category: string | null;
  icon: string | null;
  loc: string | null;
  location_id?: number | null;
  location_name?: string | null;
  location_lat?: number | null;
  location_lng?: number | null;
  inspect_required?: number;
  always_on?: number;
  status: DeviceStatus;
  off_reason?: string | null;
  monitor_enabled?: number;
  ping_ms: number;
  cpu: number;
  mem: number;
  ssh_host: string | null;
  ssh_port: number;
  ssh_username: string | null;
  lat: number | null;
  lng: number | null;
  check_type?: 'ping' | 'tcp' | 'http';
  check_port?: number | null;
  check_url?: string | null;
  snmp_enabled?: number;
  snmp_community?: string | null;
  snmp_port?: number;
  under_maintenance?: number;
}

export interface DeviceMetricPoint {
  t: string;
  avg_ping: number | null;
  max_ping: number | null;
  avg_cpu: number | null;
  avg_mem: number | null;
  up_pct: number | null;
  maint: number;
}

export interface SlaDevice {
  id: number;
  name: string;
  ip: string;
  loc: string | null;
  type: string;
  status: DeviceStatus;
  uptime_pct: number | null;
  avg_ping: number | null;
  max_ping: number | null;
  down_seconds: number;
  samples: number;
  incidents: number;
  mttr_sec: number | null;
}

export interface MaintenanceWindow {
  id: number;
  device_id: number | null;
  location_id: number | null;
  title: string;
  reason: string | null;
  starts_at: string;
  ends_at: string;
  created_by: number | null;
  created_at: string;
  device_name?: string | null;
  location_name?: string | null;
  created_by_name?: string | null;
  is_active?: number;
  status?: 'terjadwal' | 'selesai';
  done_note?: string | null;
  done_by?: number | null;
  done_by_name?: string | null;
  done_at?: string | null;
  photo_count?: number;
}

export type IncidentPriority = 'kritis' | 'tinggi' | 'sedang';
export type IncidentStatus = 'aktif' | 'proses' | 'selesai';

export interface IncidentNote {
  id: number;
  incident_id: string;
  step: number;
  note: string;
  doc_url: string | null;
  created_at: string;
}

export type RepairResult = 'berhasil' | 'sebagian' | 'gagal';

export type InspectStatus = 'baik' | 'perhatian' | 'rusak';
export interface Inspection {
  id: number;
  device_id: number;
  inspect_date: string;
  slot: '09' | '12' | '15';
  status: InspectStatus;
  note: string | null;
  photo_url: string | null;
  photo_hash: string | null;
  verified: number;
  distance_m: number | null;
  inspected_by: number | null;
  inspector_name: string | null;
}
export interface PowerOn {
  id: number;
  device_id: number;
  on_date: string;
  note: string | null;
  photo_url: string | null;
  photo_hash: string | null;
  verified: number;
  distance_m: number | null;
  done_by: number | null;
  done_by_name: string | null;
}
export interface EquipmentRow {
  id: number;
  name: string;
  ip: string;
  type: string;
  loc: string | null;
  status: string;
  monitor_enabled?: number;
  off_reason?: string | null;
  always_on?: number;
  inspections: Partial<Record<'09' | '12' | '15', Inspection>>;
  poweron?: PowerOn | null;
  poweroff?: PowerOn | null;
}
export interface MaintenanceRow {
  id: number;
  device_id: number;
  device_name: string;
  device_ip: string;
  device_type: string;
  plan_month: string;
  scheduled_date: string;
  task: string;
  status: 'rencana' | 'selesai' | 'batal';
  note: string | null;
  doc_url?: string | null;
  done_by: number | null;
  done_by_name: string | null;
  done_at: string | null;
  photo_count?: number;
}

export interface IncidentReport {
  incident_id: string;
  kerusakan: string;
  penyebab: string | null;
  perbaikan: string;
  sparepart: string | null;
  hasil: RepairResult;
  reported_by: number | null;
  reporter_name: string | null;
  signed_by?: number | null;
  signer_name?: string | null;
  signer_nip?: string | null;
  signed_at?: string | null;
  sign_token?: string | null;
  created_at: string;
  updated_at: string;
}

export interface Incident {
  id: string;
  device_id: number | null;
  device_name: string;
  ip: string | null;
  issue: string;
  priority: IncidentPriority;
  tech_id: number | null;
  tech_name?: string | null;
  coord_id: number | null;
  status: IncidentStatus;
  step: number;
  source: 'auto' | 'manual' | 'public_report';
  location_id: number | null;
  awaiting_part: number;
  taken_at: string | null;
  resolved_at: string | null;
  duration_min: number | null;
  created_at: string;
  notes: IncidentNote[];
  report: IncidentReport | null;
  collaborators?: { user_id: number; name: string; emoji: string | null }[];
}

export type ShiftType = 'pagi' | 'siang' | 'malam' | 'libur';

export interface DutyStatus {
  onDuty: boolean;
  shift: ShiftType | null;
  onDutyCount: number;
}

export interface IncidentQueue {
  duty: DutyStatus;
  pool: Incident[];
  mine: Incident[];
  collab?: Incident[];
}

export interface Shift {
  id: number;
  user_id: number;
  user_name: string;
  shift_date: string;
  shift_type: 'pagi' | 'siang' | 'malam' | 'libur';
}

export interface WaLogEntry {
  id: number;
  type: 'alert' | 'done' | 'report' | 'other';
  to_label: string;
  phone: string | null;
  message: string;
  status: 'pending' | 'sent' | 'failed';
  attempts: number;
  error: string | null;
  related_incident_id: string | null;
  created_at: string;
  sent_at: string | null;
}

export interface PerformaRow {
  techId: number;
  name: string;
  jabatan: string | null;
  emoji: string;
  done: number;
  active: number;
  avgDur: number;
  kritisDone: number;
  taken: number;
  onTime: number;
  avgResp: number;
  breaches: number;
  pm: number;
  dokumentasi: number;
  eskalasi: number;
  reopen: number;
  absen: number;
  inspections: number;
  vpnDays?: number;
  vpnFlag?: boolean;
  raw: number;
  scoreBeforePenalty?: number;
  score: number;
  grade: string;
  gradeLabel: string;
}

export interface Attendance {
  id: number;
  user_id: number;
  name?: string;
  jabatan?: string | null;
  work_date: string;
  check_in_at: string | null;
  check_in_lat: number | string | null;
  check_in_lng: number | string | null;
  check_in_dist_m: number | null;
  check_in_ip?: string | null;
  check_in_vpn: number;
  check_out_at: string | null;
  check_out_lat: number | string | null;
  check_out_lng: number | string | null;
  check_out_ip?: string | null;
  flagged: number;
  reason: string | null;
}

export interface PerformaDashboard {
  month: string | null;
  slaMinutes: number;
  techId: number;
  rankPos: number;
  totalTechs: number;
  self: PerformaRow | null;
  ranking: PerformaRow[];
  top5: PerformaRow[];
  topServices: { name: string; count: number; weight: number }[];
  slaMonthly: { month: string; label: string; pct: number | null; total: number }[];
  trend30: { date: string; points: number }[];
  insight: { type: 'good' | 'warn' | 'bad'; text: string }[];
}

export interface Surat {
  id: number;
  jenis: string;
  nomor: string;
  incident_id: string | null;
  hal: string;
  tujuan: string | null;
  body: string | null;
  tanggal: string;
  creator_name: string | null;
  signer_name: string | null;
  signer_nip: string | null;
  signed_at: string | null;
  sign_token: string | null;
  created_at: string;
  lampiran?: SuratLampiran[];
  kasi_status?: 'menunggu' | 'disetujui' | 'ditolak' | null;
  kasi_signer_name?: string | null;
  kasi_signer_nip?: string | null;
  kasi_signed_at?: string | null;
  kasi_sign_token?: string | null;
  kasi_note?: string | null;
  report_month?: string | null;
  sikeren_status?: 'terkirim' | 'gagal' | null;
  sikeren_ref?: string | null;
  sikeren_url?: string | null;
  sikeren_at?: string | null;
  sikeren_note?: string | null;
}

export interface SuratLampiran {
  id: number;
  surat_id: number;
  file_url: string;
  filename: string | null;
  mimetype: string | null;
}

export type DiklatStatus = 'draft' | 'diajukan' | 'diverifikasi' | 'disetujui' | 'ditolak' | 'selesai';
export interface DiklatHistory { id: number; user_name: string | null; status: string; note: string | null; created_at: string }
export interface DiklatNota { id: number; sign_token: string | null; signer_name: string | null; signer_nip: string | null; signed_at: string | null }
export interface PengajuanDiklat {
  id: number;
  nomor_pengajuan: string;
  nomor_nota_dinas: string | null;
  nota_dinas_id: number | null;
  tanggal_pengajuan: string;
  pegawai_id: number | null;
  pegawai_nama: string | null;
  nip: string | null;
  jabatan: string | null;
  unit_kerja: string | null;
  nama_diklat: string;
  penyelenggara: string | null;
  lokasi: string | null;
  tanggal_mulai: string | null;
  tanggal_selesai: string | null;
  durasi: string | null;
  biaya: number;
  tujuan: string | null;
  keterangan: string | null;
  file_pendukung: string | null;
  laporan_url: string | null;
  laporan_at: string | null;
  status: DiklatStatus;
  created_by: number | null;
  creator_name: string | null;
  approver_name: string | null;
  approved_at: string | null;
  created_at: string;
  nota: DiklatNota | null;
  history: DiklatHistory[];
}

export type DocStatus = 'draft' | 'review' | 'disetujui' | 'aktif' | 'kadaluarsa' | 'arsip';
export interface DocCategory { id: number; name: string; jumlah: number }
export interface DocComment { id: number; user_name: string | null; body: string; created_at: string }
export interface DocVersion { id: number; versi: string | null; file_url: string | null; catatan: string | null; creator_name: string | null; created_at: string }
export interface Dokumen {
  id: number;
  nomor: string | null;
  judul: string;
  kategori: string;
  sub_kategori: string | null;
  deskripsi: string | null;
  tags: string | null;
  versi: string | null;
  tanggal_berlaku: string | null;
  tanggal_review: string | null;
  pemilik: string | null;
  unit_kerja: string | null;
  status: DocStatus;
  file_url: string | null;
  file_name: string | null;
  video_url: string | null;
  link_ref: string | null;
  catatan_revisi: string | null;
  views: number;
  creator_name: string | null;
  approver_name: string | null;
  created_at: string;
  updated_at: string;
}
export interface DokumenStats {
  stats: { total: number; sop: number; kb: number; materi: number; belumReview: number; kadaluarsa: number };
  terbaru: { id: number; judul: string; kategori: string; status: DocStatus; created_at: string }[];
  terpopuler: { id: number; judul: string; kategori: string; views: number }[];
  kontributor: { name: string; jumlah: number }[];
  aktivitas: { created_at: string; user_name: string | null; judul: string }[];
  insight: { type: string; text: string }[];
}

export type KnrStatus = 'draft' | 'diajukan' | 'diverifikasi' | 'disetujui' | 'ditolak' | 'selesai';
export interface KnrFile { id: number; file_url: string; filename: string | null; mimetype: string | null; jenis: string }
export interface KnrApproval { id: number; user_name: string | null; status: string; note: string | null; poin: number | null; created_at: string }
export interface KegiatanNr {
  id: number; nomor: string; tahun: number; tanggal_kegiatan: string;
  petugas_id: number | null; petugas_nama: string | null; unit_kerja: string | null;
  kategori: string; judul: string; lokasi: string | null; uraian: string | null; hasil: string | null;
  durasi_jam: number; jumlah_personel: number; tingkat_kesulitan: string; poin: number;
  status: KnrStatus; catatan_koordinator: string | null;
  nomor_nota_dinas: string | null; nota_dinas_id: number | null;
  created_by: number | null; creator_name: string | null; approver_name: string | null; approved_at: string | null;
  created_at: string;
  files: KnrFile[]; approval: KnrApproval[];
}
export interface KnrStats {
  month: string;
  stats: { total: number; selesai: number; menunggu: number; jam: number; poin: number; kritis: number };
  topKontributor: { nama: string | null; jumlah: number; poin: number }[];
  topKategori: { kategori: string; jumlah: number }[];
  insight: string;
}
export interface KnrRecap {
  month: string; total: number; jam: number; poin: number;
  perKategori: { kategori: string; jumlah: number; poin: number }[];
  perTeknisi: { nama: string | null; jumlah: number; jam: number; poin: number }[];
  tren: { label: string; jumlah: number; poin: number }[];
}

export interface Room { id: number; kode: string; nama: string; gedung: string | null; lantai: string | null; area: string | null; penanggung_jawab: string | null; active: number; total_laporan?: number; gangguan_aktif?: number }
export interface QrStats {
  stats: { hariIni: number; bulanIni: number; menunggu: number; diproses: number; selesai: number; mttr: number; sla: number };
  topLokasi: { lokasi: string; jumlah: number }[];
  topKategori: { kategori: string; jumlah: number }[];
  peta: { id: number; kode: string; nama: string; gedung: string | null; area: string | null; indikator: 'hijau' | 'kuning' | 'merah' }[];
  insight: string;
}

export type ActivityStatus = 'menunggu' | 'disetujui' | 'ditolak';
export interface Activity {
  id: number;
  user_id: number;
  user_name?: string;
  user_emoji?: string;
  type: string;
  title: string;
  detail: string | null;
  activity_date: string;
  start_time: string | null;
  end_time: string | null;
  bukti_url: string | null;
  status: ActivityStatus;
  approved_by: number | null;
  approver_name: string | null;
  approved_at: string | null;
  coord_note: string | null;
  created_at: string;
}

export interface Asset {
  id: number;
  name: string;
  code: string | null;
  category: string | null;
  qty: number;
  unit: string;
  icon: string;
  holder_user_id: number | null;
  holder_name?: string | null;
  status: 'baik' | 'rusak' | 'perbaikan' | 'hilang';
  notes: string | null;
}

export interface ServiceItem {
  id: number;
  name: string;
  icon: string;
  status: string;
  is_ok: number;
  detail: string | null;
  sort_order: number;
}

export interface LocationItem {
  id: number;
  name: string;
  icon: string;
  map_x: number | null;
  map_y: number | null;
  lat: number | null;
  lng: number | null;
  sort_order: number;
  active_count: number;
}

export interface MonthlyStats {
  month: string;
  daysInMonth: number;
  ticketsIn: number[];
  ticketsDone: number[];
  slaTrend: number[];
  mttrTrend: number[];
  totals: { totalIn: number; totalDone: number; avgSla: number; avgMttr: number };
  slaMinutes: number;
}

export interface PublicReport {
  id: string;
  nama: string;
  nip: string | null;
  unit: string;
  hp: string;
  judul: string;
  jenis: string;
  merk: string | null;
  inv: string | null;
  gedung: string | null;
  ruang: string | null;
  urgensi: 'kritis' | 'tinggi' | 'sedang' | 'rendah';
  detail: string;
  status: 'menunggu' | 'diproses' | 'selesai';
  tech_note: string | null;
  incident_id: string | null;
  created_at: string;
}

// ===== SKP (Sasaran Kinerja Pegawai / e-Kinerja) =====
export type SkpStatus = 'draft' | 'diajukan' | 'dinilai';
export type SkpAspek = 'Kuantitas' | 'Kualitas' | 'Waktu' | 'Biaya';

export type SkpBuktiKind = 'link' | 'file' | 'data';
export interface SkpSnapshot {
  source: string;
  sourceLabel: string;
  title: string;
  period: string | null;
  summary: { label: string; value: string | number }[];
  columns: string[];
  rows: (string | number)[][];
  generatedAt: string;
}
export interface SkpDataSource { key: string; label: string; period: 'month' | 'none' }
export interface SkpBukti {
  id: number;
  indikator_id?: number;
  bulan?: string | null;
  deskripsi: string;
  kind: SkpBuktiKind;
  source?: string | null;
  params?: { bulan?: string | null } | null;
  snapshot?: SkpSnapshot | null;
  url: string | null;
  file_url: string | null;
  public_token: string | null;
  created_at?: string;
}
export interface SkpBulanInfo { bulan: string; status: SkpStatus; tanggal_pengajuan: string | null }
export interface SkpLaporanBulanan {
  nomor: string; hal: string; pdf_url: string; verify_url: string;
  koordinator: { nama: string | null; signed_at: string | null };
  kasi: { nama: string | null; signed_at: string | null };
}
export interface SkpIndikator {
  id: number;
  rhk_id?: number;
  urutan?: number;
  aspek: SkpAspek;
  indikator: string;
  target: string | null;
  renaksi: string | null;
  realisasi: string | null;
  feedback: string | null;
  bukti: SkpBukti[];
}
export interface SkpRhk {
  id: number;
  urutan?: number;
  klasifikasi: 'utama' | 'tambahan';
  rhk: string;
  indikator: SkpIndikator[];
}
export interface Skp {
  id: number;
  periode: string;
  tahun: number;
  pendekatan: string;
  pegawai_id?: number | null;
  pegawai_nama: string | null;
  pegawai_nip: string | null;
  pegawai_jabatan: string | null;
  pegawai_unit: string | null;
  penilai_nama: string | null;
  penilai_nip: string | null;
  penilai_jabatan: string | null;
  status: SkpStatus;
  tanggal_pengajuan: string | null;
  public_token: string | null;
  creator_name?: string | null;
  created_at?: string;
  updated_at?: string;
  jml_rhk?: number;
  jml_bukti?: number;
  rhk?: SkpRhk[];
  // Konteks bulanan (saat detail dimuat untuk satu bulan).
  bulan?: string;
  months?: string[];
  bulanInfo?: SkpBulanInfo;
  laporanBulanan?: SkpLaporanBulanan | null;
}
