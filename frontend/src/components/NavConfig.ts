import type { Role } from '../types';

export interface NavItem {
  id: string;
  icon: string;
  label: string;
  section?: never;
}
export interface NavSection {
  section: string;
}
export type NavEntry = NavItem | NavSection;

export const NAV_ITEMS: Record<Role, NavEntry[]> = {
  admin: [
    { section: 'Overview' }, { id: 'dashboard', icon: '📊', label: 'Dashboard' }, { id: 'notifikasi', icon: '🔔', label: 'Notifikasi' },
    { section: 'Monitoring' }, { id: 'devices', icon: '🖥️', label: 'Perangkat' }, { id: 'aset', icon: '🔧', label: 'Peralatan' }, { id: 'sparepart', icon: '🧰', label: 'Sparepart & Stok' }, { id: 'obat-air', icon: '💧', label: 'Obat Air' }, { id: 'peminjaman', icon: '📦', label: 'Peminjaman Peralatan' }, { id: 'aset-availability', icon: '📈', label: 'Performa Peralatan' }, { id: 'monitor', icon: '📡', label: 'Live Monitor' }, { id: 'peta', icon: '🗺️', label: 'Peta Perangkat' }, { id: 'sla', icon: '📊', label: 'Laporan SLA' },
    { section: 'Insiden' }, { id: 'incidents', icon: '🚨', label: 'Insiden' }, { id: 'reports', icon: '📋', label: 'Laporan' },
    { section: 'SDM' }, { id: 'jadwal', icon: '📅', label: 'Jadwal Dinas' }, { id: 'performa', icon: '🏆', label: 'Performa Teknisi' }, { id: 'equipment', icon: '🛠️', label: 'Performa Peralatan' }, { id: 'logbook', icon: '📒', label: 'Logbook Peralatan' },
    { section: 'Admin' }, { id: 'perencanaan', icon: '🎯', label: 'Perencanaan Unit' }, { id: 'users', icon: '👥', label: 'Manajemen User' }, { id: 'attendance', icon: '🕒', label: 'Absensi' }, { id: 'diklat', icon: '🎓', label: 'Pengajuan Diklat' }, { id: 'kegiatan-nr', icon: '📝', label: 'Kegiatan Non-Rutin' }, { id: 'dokumen', icon: '📚', label: 'Manajemen Dokumen' }, { id: 'master', icon: '🗂️', label: 'Master Data' }, { id: 'surat', icon: '📤', label: 'Surat Keluar' }, { id: 'laporan-bulanan', icon: '🗓️', label: 'Laporan Bulanan' }, { id: 'laporan-kinerja', icon: '📊', label: 'Laporan Unjuk Hasil' }, { id: 'laporan-aab', icon: '🚜', label: 'Laporan Bulanan AAB' }, { id: 'skp', icon: '📋', label: 'SKP / e-Kinerja' }, { id: 'pelaporan-qr', icon: '📱', label: 'Pelaporan Fasilitas QR' }, { id: 'wa', icon: '📲', label: 'Log WhatsApp' }, { id: 'settings', icon: '⚙️', label: 'Pengaturan' }, { id: 'notification-settings', icon: '🔔', label: 'Pengaturan Notifikasi' }, { id: 'audit', icon: '🛡️', label: 'Audit Log' }, { id: 'publik-reports', icon: '📬', label: 'Laporan Publik' }, { id: 'api-docs', icon: '🔌', label: 'Dokumentasi API' },
  ],
  koordinator: [
    { section: 'Overview' }, { id: 'dashboard', icon: '📊', label: 'Dashboard' }, { id: 'notifikasi', icon: '🔔', label: 'Notifikasi' },
    { section: 'Monitoring' }, { id: 'devices', icon: '🖥️', label: 'Perangkat' }, { id: 'aset', icon: '🔧', label: 'Peralatan' }, { id: 'sparepart', icon: '🧰', label: 'Sparepart & Stok' }, { id: 'obat-air', icon: '💧', label: 'Obat Air' }, { id: 'peminjaman', icon: '📦', label: 'Peminjaman Peralatan' }, { id: 'aset-availability', icon: '📈', label: 'Performa Peralatan' }, { id: 'monitor', icon: '📡', label: 'Live Monitor' }, { id: 'peta', icon: '🗺️', label: 'Peta Perangkat' }, { id: 'sla', icon: '📊', label: 'Laporan SLA' },
    { section: 'Insiden' }, { id: 'incidents', icon: '🚨', label: 'Insiden' }, { id: 'reports', icon: '📋', label: 'Laporan' },
    { section: 'SDM' }, { id: 'jadwal', icon: '📅', label: 'Jadwal Dinas' }, { id: 'performa', icon: '🏆', label: 'Performa Teknisi' }, { id: 'equipment', icon: '🛠️', label: 'Performa Peralatan' }, { id: 'logbook', icon: '📒', label: 'Logbook Peralatan' },
    // Koordinator = admin unitnya sendiri: kelola user & master data unit (dibatasi backend).
    { section: 'Administrasi' }, { id: 'perencanaan', icon: '🎯', label: 'Perencanaan Unit' }, { id: 'users', icon: '👥', label: 'Manajemen User' }, { id: 'master', icon: '🗂️', label: 'Master Data' }, { id: 'surat', icon: '📤', label: 'Surat Keluar' }, { id: 'laporan-bulanan', icon: '🗓️', label: 'Laporan Bulanan' }, { id: 'laporan-kinerja', icon: '📊', label: 'Laporan Unjuk Hasil' }, { id: 'laporan-aab', icon: '🚜', label: 'Laporan Bulanan AAB' }, { id: 'skp', icon: '📋', label: 'SKP / e-Kinerja' }, { id: 'attendance', icon: '🕒', label: 'Absensi' }, { id: 'diklat', icon: '🎓', label: 'Pengajuan Diklat' }, { id: 'kegiatan-nr', icon: '📝', label: 'Kegiatan Non-Rutin' }, { id: 'dokumen', icon: '📚', label: 'Manajemen Dokumen' },
    { section: 'Log' }, { id: 'pelaporan-qr', icon: '📱', label: 'Pelaporan Fasilitas QR' }, { id: 'wa', icon: '📲', label: 'Log WhatsApp' }, { id: 'publik-reports', icon: '📬', label: 'Laporan Publik' }, { id: 'api-docs', icon: '🔌', label: 'Dokumentasi API' },
  ],
  teknisi: [
    { section: 'Saya' }, { id: 'my-dashboard', icon: '📊', label: 'Dashboard Saya' }, { id: 'notifikasi', icon: '🔔', label: 'Notifikasi' },
    { section: 'Pekerjaan' }, { id: 'my-incidents', icon: '🚨', label: 'Insiden Saya' }, { id: 'aset', icon: '🔧', label: 'Peralatan' }, { id: 'sparepart', icon: '🧰', label: 'Sparepart & Stok' }, { id: 'obat-air', icon: '💧', label: 'Obat Air' }, { id: 'peminjaman', icon: '📦', label: 'Peminjaman Peralatan' }, { id: 'equipment', icon: '🛠️', label: 'Performa Peralatan' }, { id: 'logbook', icon: '📒', label: 'Logbook Peralatan' }, { id: 'jadwal', icon: '📅', label: 'Jadwal Dinas' }, { id: 'diklat', icon: '🎓', label: 'Pengajuan Diklat' }, { id: 'kegiatan-nr', icon: '📝', label: 'Kegiatan Non-Rutin' }, { id: 'dokumen', icon: '📚', label: 'Dokumen & SOP' },
    { section: 'Monitoring' }, { id: 'devices', icon: '🖥️', label: 'Perangkat' }, { id: 'monitor', icon: '📡', label: 'Live Monitor' }, { id: 'peta', icon: '🗺️', label: 'Peta Perangkat' }, { id: 'sla', icon: '📊', label: 'Laporan SLA' },
  ],
  viewer: [
    { section: 'Monitoring' }, { id: 'dashboard', icon: '📊', label: 'Dashboard' }, { id: 'notifikasi', icon: '🔔', label: 'Notifikasi' }, { id: 'devices', icon: '🖥️', label: 'Perangkat' }, { id: 'monitor', icon: '📡', label: 'Live Monitor' }, { id: 'peta', icon: '🗺️', label: 'Peta Perangkat' }, { id: 'sla', icon: '📊', label: 'Laporan SLA' },
  ],
};

// Menu yang hanya relevan untuk unit tertentu (berdasarkan KODE unit). Item yang
// tidak tercantum di sini tampil untuk semua unit. Dipakai AppLayout untuk menyaring
// sidebar sesuai unit aktif (koordinator = unitnya; super admin = unit di switcher,
// "Semua Unit" = tampil semua). ELB = jaringan; AAB = alat berat, kendaraan, air/pompa.
export const UNIT_ONLY: Record<string, string[]> = {
  // Khusus AAB (peralatan/alat berat non-IP, air/pompa)
  aset: ['AAB'], 'aset-availability': ['AAB'], sparepart: ['AAB'], 'obat-air': ['AAB'], 'laporan-aab': ['AAB'], peminjaman: ['AAB'],
  // "Performa Peralatan" versi inspeksi harian/maintenance (EquipmentPerf) khusus ELB —
  // AAB memakai 'aset-availability' sbg Performa Peralatan-nya. Cegah label ganda.
  equipment: ['ELB'],
  // Khusus ELB (jaringan/perangkat ber-IP + laporan bulanan Kemenhub & unjuk hasil)
  devices: ['ELB'], monitor: ['ELB'], peta: ['ELB'], sla: ['ELB'], 'laporan-bulanan': ['ELB'], 'laporan-kinerja': ['ELB'],
};

export const PAGE_TITLES: Record<string, string> = {
  dashboard: 'Dashboard', notifikasi: 'Pusat Notifikasi', devices: 'Manajemen Perangkat', aset: 'Peralatan', 'aset-availability': 'Performa Peralatan', sparepart: 'Sparepart & Stok', 'obat-air': 'Obat Air / Bahan Kimia', peminjaman: 'Peminjaman Peralatan', 'laporan-aab': 'Laporan Bulanan AAB', 'laporan-kinerja': 'Laporan Bulanan Unjuk Hasil', monitor: 'Live Monitor', peta: 'Peta Perangkat', sla: 'Laporan SLA & Uptime', maintenance: 'Jendela Maintenance',
  incidents: 'Manajemen Insiden', reports: 'Laporan Selesai', jadwal: 'Jadwal Dinas',
  users: 'Manajemen User', wa: 'Log WhatsApp', settings: 'Pengaturan', 'notification-settings': 'Pengaturan Notifikasi',
  'publik-reports': 'Laporan Publik (Unit Lain)', master: 'Master Data', perencanaan: 'Perencanaan Unit',
  'my-dashboard': 'Dashboard Saya', 'coord-dashboard': 'Dashboard Koordinator', 'my-incidents': 'Insiden Saya', performa: 'Performa Teknisi',
  ssh: 'SSH Terminal', audit: 'Audit Log', equipment: 'Performa Peralatan', logbook: 'Logbook Peralatan', 'api-docs': 'Dokumentasi API', surat: 'Manajemen Surat Keluar', 'laporan-bulanan': 'Susun Laporan Bulanan', attendance: 'Manajemen Absensi', diklat: 'Pengajuan Diklat', dokumen: 'Manajemen Dokumen & Knowledge Base', 'kegiatan-nr': 'Laporan Kegiatan Non-Rutin', 'pelaporan-qr': 'Pelaporan Fasilitas QR', skp: 'SKP / e-Kinerja',
};
