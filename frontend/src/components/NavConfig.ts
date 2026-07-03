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
    { section: 'Monitoring' }, { id: 'devices', icon: '🖥️', label: 'Perangkat' }, { id: 'aset', icon: '🔧', label: 'Aset & Peralatan' }, { id: 'sparepart', icon: '🧰', label: 'Sparepart & Stok' }, { id: 'aset-availability', icon: '📈', label: 'Availability Aset' }, { id: 'monitor', icon: '📡', label: 'Live Monitor' }, { id: 'peta', icon: '🗺️', label: 'Peta Perangkat' }, { id: 'sla', icon: '📊', label: 'Laporan SLA' },
    { section: 'Insiden' }, { id: 'incidents', icon: '🚨', label: 'Insiden' }, { id: 'reports', icon: '📋', label: 'Laporan' },
    { section: 'SDM' }, { id: 'jadwal', icon: '📅', label: 'Jadwal Dinas' }, { id: 'performa', icon: '🏆', label: 'Performa Teknisi' }, { id: 'equipment', icon: '🛠️', label: 'Performa Peralatan' }, { id: 'logbook', icon: '📒', label: 'Logbook Peralatan' },
    { section: 'Admin' }, { id: 'users', icon: '👥', label: 'Manajemen User' }, { id: 'attendance', icon: '🕒', label: 'Absensi' }, { id: 'diklat', icon: '🎓', label: 'Pengajuan Diklat' }, { id: 'kegiatan-nr', icon: '📝', label: 'Kegiatan Non-Rutin' }, { id: 'dokumen', icon: '📚', label: 'Manajemen Dokumen' }, { id: 'master', icon: '🗂️', label: 'Master Data' }, { id: 'surat', icon: '📤', label: 'Surat Keluar' }, { id: 'laporan-bulanan', icon: '🗓️', label: 'Laporan Bulanan' }, { id: 'skp', icon: '📋', label: 'SKP / e-Kinerja' }, { id: 'pelaporan-qr', icon: '📱', label: 'Pelaporan Fasilitas QR' }, { id: 'wa', icon: '📲', label: 'Log WhatsApp' }, { id: 'settings', icon: '⚙️', label: 'Pengaturan' }, { id: 'notification-settings', icon: '🔔', label: 'Pengaturan Notifikasi' }, { id: 'publik-reports', icon: '📬', label: 'Laporan Publik' }, { id: 'api-docs', icon: '🔌', label: 'Dokumentasi API' },
  ],
  koordinator: [
    { section: 'Overview' }, { id: 'dashboard', icon: '📊', label: 'Dashboard' }, { id: 'notifikasi', icon: '🔔', label: 'Notifikasi' },
    { section: 'Monitoring' }, { id: 'devices', icon: '🖥️', label: 'Perangkat' }, { id: 'aset', icon: '🔧', label: 'Aset & Peralatan' }, { id: 'sparepart', icon: '🧰', label: 'Sparepart & Stok' }, { id: 'aset-availability', icon: '📈', label: 'Availability Aset' }, { id: 'monitor', icon: '📡', label: 'Live Monitor' }, { id: 'peta', icon: '🗺️', label: 'Peta Perangkat' }, { id: 'sla', icon: '📊', label: 'Laporan SLA' },
    { section: 'Insiden' }, { id: 'incidents', icon: '🚨', label: 'Insiden' }, { id: 'reports', icon: '📋', label: 'Laporan' },
    { section: 'SDM' }, { id: 'jadwal', icon: '📅', label: 'Jadwal Dinas' }, { id: 'performa', icon: '🏆', label: 'Performa Teknisi' }, { id: 'equipment', icon: '🛠️', label: 'Performa Peralatan' }, { id: 'logbook', icon: '📒', label: 'Logbook Peralatan' },
    // Koordinator = admin unitnya sendiri: kelola user & master data unit (dibatasi backend).
    { section: 'Administrasi' }, { id: 'users', icon: '👥', label: 'Manajemen User' }, { id: 'master', icon: '🗂️', label: 'Master Data' }, { id: 'surat', icon: '📤', label: 'Surat Keluar' }, { id: 'laporan-bulanan', icon: '🗓️', label: 'Laporan Bulanan' }, { id: 'skp', icon: '📋', label: 'SKP / e-Kinerja' }, { id: 'attendance', icon: '🕒', label: 'Absensi' }, { id: 'diklat', icon: '🎓', label: 'Pengajuan Diklat' }, { id: 'kegiatan-nr', icon: '📝', label: 'Kegiatan Non-Rutin' }, { id: 'dokumen', icon: '📚', label: 'Manajemen Dokumen' },
    { section: 'Log' }, { id: 'pelaporan-qr', icon: '📱', label: 'Pelaporan Fasilitas QR' }, { id: 'wa', icon: '📲', label: 'Log WhatsApp' }, { id: 'publik-reports', icon: '📬', label: 'Laporan Publik' }, { id: 'api-docs', icon: '🔌', label: 'Dokumentasi API' },
  ],
  teknisi: [
    { section: 'Saya' }, { id: 'my-dashboard', icon: '📊', label: 'Dashboard Saya' }, { id: 'notifikasi', icon: '🔔', label: 'Notifikasi' },
    { section: 'Pekerjaan' }, { id: 'my-incidents', icon: '🚨', label: 'Insiden Saya' }, { id: 'aset', icon: '🔧', label: 'Aset & Peralatan' }, { id: 'sparepart', icon: '🧰', label: 'Sparepart & Stok' }, { id: 'equipment', icon: '🛠️', label: 'Performa Peralatan' }, { id: 'logbook', icon: '📒', label: 'Logbook Peralatan' }, { id: 'jadwal', icon: '📅', label: 'Jadwal Dinas' }, { id: 'diklat', icon: '🎓', label: 'Pengajuan Diklat' }, { id: 'kegiatan-nr', icon: '📝', label: 'Kegiatan Non-Rutin' }, { id: 'dokumen', icon: '📚', label: 'Dokumen & SOP' },
    { section: 'Monitoring' }, { id: 'devices', icon: '🖥️', label: 'Perangkat' }, { id: 'monitor', icon: '📡', label: 'Live Monitor' }, { id: 'peta', icon: '🗺️', label: 'Peta Perangkat' }, { id: 'sla', icon: '📊', label: 'Laporan SLA' },
  ],
  viewer: [
    { section: 'Monitoring' }, { id: 'dashboard', icon: '📊', label: 'Dashboard' }, { id: 'notifikasi', icon: '🔔', label: 'Notifikasi' }, { id: 'devices', icon: '🖥️', label: 'Perangkat' }, { id: 'monitor', icon: '📡', label: 'Live Monitor' }, { id: 'peta', icon: '🗺️', label: 'Peta Perangkat' }, { id: 'sla', icon: '📊', label: 'Laporan SLA' },
  ],
};

export const PAGE_TITLES: Record<string, string> = {
  dashboard: 'Dashboard', notifikasi: 'Pusat Notifikasi', devices: 'Manajemen Perangkat', aset: 'Aset & Peralatan', 'aset-availability': 'Availability Aset', sparepart: 'Sparepart & Stok', monitor: 'Live Monitor', peta: 'Peta Perangkat', sla: 'Laporan SLA & Uptime', maintenance: 'Jendela Maintenance',
  incidents: 'Manajemen Insiden', reports: 'Laporan Selesai', jadwal: 'Jadwal Dinas',
  users: 'Manajemen User', wa: 'Log WhatsApp', settings: 'Pengaturan', 'notification-settings': 'Pengaturan Notifikasi',
  'publik-reports': 'Laporan Publik (Unit Lain)', master: 'Master Data',
  'my-dashboard': 'Dashboard Saya', 'coord-dashboard': 'Dashboard Koordinator', 'my-incidents': 'Insiden Saya', performa: 'Performa Teknisi',
  ssh: 'SSH Terminal', equipment: 'Performa Peralatan', logbook: 'Logbook Peralatan', 'api-docs': 'Dokumentasi API', surat: 'Manajemen Surat Keluar', 'laporan-bulanan': 'Susun Laporan Bulanan', attendance: 'Manajemen Absensi', diklat: 'Pengajuan Diklat', dokumen: 'Manajemen Dokumen & Knowledge Base', 'kegiatan-nr': 'Laporan Kegiatan Non-Rutin', 'pelaporan-qr': 'Pelaporan Fasilitas QR', skp: 'SKP / e-Kinerja',
};
