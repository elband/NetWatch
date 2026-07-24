import { useEffect, useState } from 'react';
import { api, getActiveUnitId } from '../api/client';
import { hasRole, userRoles } from '../utils/roles';
import type { Role, Unit, User } from '../types';

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
    { section: 'Monitoring' }, { id: 'devices', icon: '🖥️', label: 'Perangkat' }, { id: 'aset', icon: '🔧', label: 'Peralatan' }, { id: 'sparepart', icon: '🧰', label: 'Manajemen Suku Cadang' }, { id: 'obat-air', icon: '💧', label: 'Obat Air' }, { id: 'peminjaman', icon: '📦', label: 'Peminjaman Peralatan' }, { id: 'aset-availability', icon: '📈', label: 'Performa Peralatan' }, { id: 'monitor', icon: '📡', label: 'Live Monitor' }, { id: 'peta', icon: '🗺️', label: 'Peta Perangkat' }, { id: 'sla', icon: '📊', label: 'Laporan SLA' },
    { section: 'Insiden' }, { id: 'incidents', icon: '⚠️', label: 'Insiden' }, { id: 'reports', icon: '📋', label: 'Laporan' },
    { section: 'SDM' }, { id: 'jadwal', icon: '📅', label: 'Jadwal Dinas' }, { id: 'performa', icon: '🏆', label: 'Performa Teknisi' }, { id: 'equipment', icon: '🛠️', label: 'Performa Peralatan' }, { id: 'logbook', icon: '📒', label: 'Logbook Peralatan' },
    { section: 'Admin' }, { id: 'perencanaan', icon: '🎯', label: 'Perencanaan Unit' }, { id: 'users', icon: '👥', label: 'Manajemen User' }, { id: 'attendance', icon: '🕒', label: 'Absensi' }, { id: 'diklat', icon: '🎓', label: 'Pengajuan Diklat' }, { id: 'kegiatan-nr', icon: '📝', label: 'Kegiatan Non-Rutin' }, { id: 'dokumen', icon: '📚', label: 'Manajemen Dokumen' }, { id: 'master', icon: '🗂️', label: 'Master Data' }, { id: 'surat', icon: '📤', label: 'Surat Keluar' }, { id: 'laporan-bulanan', icon: '🗓️', label: 'Laporan Bulanan' }, { id: 'laporan-kinerja', icon: '📊', label: 'Laporan Unjuk Hasil' }, { id: 'laporan-aab', icon: '🚜', label: 'Laporan Bulanan AAB' }, { id: 'skp', icon: '📋', label: 'SKP / e-Kinerja' }, { id: 'pelaporan-qr', icon: '📱', label: 'Pelaporan Fasilitas QR' }, { id: 'wa', icon: '📲', label: 'Log WhatsApp' }, { id: 'settings', icon: '⚙️', label: 'Pengaturan' }, { id: 'notification-settings', icon: '🔔', label: 'Pengaturan Notifikasi' }, { id: 'audit', icon: '🛡️', label: 'Audit Log' }, { id: 'publik-reports', icon: '📬', label: 'Laporan Publik' }, { id: 'api-docs', icon: '🔌', label: 'Dokumentasi API' },
  ],
  koordinator: [
    { section: 'Overview' }, { id: 'dashboard', icon: '📊', label: 'Dashboard' }, { id: 'notifikasi', icon: '🔔', label: 'Notifikasi' },
    { section: 'Monitoring' }, { id: 'devices', icon: '🖥️', label: 'Perangkat' }, { id: 'aset', icon: '🔧', label: 'Peralatan' }, { id: 'sparepart', icon: '🧰', label: 'Manajemen Suku Cadang' }, { id: 'obat-air', icon: '💧', label: 'Obat Air' }, { id: 'peminjaman', icon: '📦', label: 'Peminjaman Peralatan' }, { id: 'aset-availability', icon: '📈', label: 'Performa Peralatan' }, { id: 'monitor', icon: '📡', label: 'Live Monitor' }, { id: 'peta', icon: '🗺️', label: 'Peta Perangkat' }, { id: 'sla', icon: '📊', label: 'Laporan SLA' },
    { section: 'Insiden' }, { id: 'incidents', icon: '⚠️', label: 'Insiden' }, { id: 'reports', icon: '📋', label: 'Laporan' },
    { section: 'SDM' }, { id: 'jadwal', icon: '📅', label: 'Jadwal Dinas' }, { id: 'performa', icon: '🏆', label: 'Performa Teknisi' }, { id: 'equipment', icon: '🛠️', label: 'Performa Peralatan' }, { id: 'logbook', icon: '📒', label: 'Logbook Peralatan' },
    // Koordinator = admin unitnya sendiri: kelola user & master data unit (dibatasi backend).
    { section: 'Administrasi' }, { id: 'perencanaan', icon: '🎯', label: 'Perencanaan Unit' }, { id: 'users', icon: '👥', label: 'Manajemen User' }, { id: 'master', icon: '🗂️', label: 'Master Data' }, { id: 'surat', icon: '📤', label: 'Surat Keluar' }, { id: 'laporan-bulanan', icon: '🗓️', label: 'Laporan Bulanan' }, { id: 'laporan-kinerja', icon: '📊', label: 'Laporan Unjuk Hasil' }, { id: 'laporan-aab', icon: '🚜', label: 'Laporan Bulanan AAB' }, { id: 'skp', icon: '📋', label: 'SKP / e-Kinerja' }, { id: 'attendance', icon: '🕒', label: 'Absensi' }, { id: 'diklat', icon: '🎓', label: 'Pengajuan Diklat' }, { id: 'kegiatan-nr', icon: '📝', label: 'Kegiatan Non-Rutin' }, { id: 'dokumen', icon: '📚', label: 'Manajemen Dokumen' },
    { section: 'Log' }, { id: 'pelaporan-qr', icon: '📱', label: 'Pelaporan Fasilitas QR' }, { id: 'wa', icon: '📲', label: 'Log WhatsApp' }, { id: 'publik-reports', icon: '📬', label: 'Laporan Publik' }, { id: 'api-docs', icon: '🔌', label: 'Dokumentasi API' },
  ],
  teknisi: [
    { section: 'Saya' }, { id: 'my-dashboard', icon: '📊', label: 'Dashboard Saya' }, { id: 'notifikasi', icon: '🔔', label: 'Notifikasi' }, { id: 'skp', icon: '📋', label: 'SKP / e-Kinerja' },
    { section: 'Pekerjaan' }, { id: 'my-incidents', icon: '⚠️', label: 'Insiden Saya' }, { id: 'kegiatan-saya', icon: '🗂️', label: 'Kegiatan Saya' }, { id: 'aset', icon: '🔧', label: 'Peralatan' }, { id: 'sparepart', icon: '🧰', label: 'Manajemen Suku Cadang' }, { id: 'obat-air', icon: '💧', label: 'Obat Air' }, { id: 'peminjaman', icon: '📦', label: 'Peminjaman Peralatan' }, { id: 'equipment', icon: '🛠️', label: 'Performa Peralatan' }, { id: 'logbook', icon: '📒', label: 'Logbook Peralatan' }, { id: 'jadwal', icon: '📅', label: 'Jadwal Dinas' }, { id: 'diklat', icon: '🎓', label: 'Pengajuan Diklat' }, { id: 'kegiatan-nr', icon: '📝', label: 'Kegiatan Non-Rutin' }, { id: 'dokumen', icon: '📚', label: 'Dokumen & SOP' },
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
  aset: ['AAB'], 'aset-availability': ['AAB'], 'obat-air': ['AAB'], 'laporan-aab': ['AAB'], peminjaman: ['AAB'],
  // Manajemen Suku Cadang: dipakai AAB & ELB (modul sparepart diperluas: scan QR/barcode, kategori, laporan).
  sparepart: ['AAB', 'ELB'],
  // "Performa Peralatan" versi inspeksi harian/maintenance (EquipmentPerf) khusus ELB —
  // AAB memakai 'aset-availability' sbg Performa Peralatan-nya. Cegah label ganda.
  equipment: ['ELB'],
  // Khusus ELB (jaringan/perangkat ber-IP + laporan bulanan Kemenhub & unjuk hasil)
  devices: ['ELB'], monitor: ['ELB'], peta: ['ELB'], sla: ['ELB'], 'laporan-bulanan': ['ELB'], 'laporan-kinerja': ['ELB'],
};

export const PAGE_TITLES: Record<string, string> = {
  dashboard: 'Dashboard', notifikasi: 'Pusat Notifikasi', devices: 'Manajemen Perangkat', aset: 'Peralatan', 'aset-availability': 'Performa Peralatan', sparepart: 'Manajemen Suku Cadang', 'obat-air': 'Obat Air / Bahan Kimia', peminjaman: 'Peminjaman Peralatan', 'laporan-aab': 'Laporan Bulanan AAB', 'laporan-kinerja': 'Laporan Bulanan Unjuk Hasil', monitor: 'Live Monitor', peta: 'Peta Perangkat', sla: 'Laporan SLA & Uptime', maintenance: 'Jendela Maintenance',
  incidents: 'Manajemen Insiden', reports: 'Laporan Selesai', jadwal: 'Jadwal Dinas',
  users: 'Manajemen User', wa: 'Log WhatsApp', settings: 'Pengaturan', 'notification-settings': 'Pengaturan Notifikasi',
  'publik-reports': 'Laporan Publik (Unit Lain)', master: 'Master Data', perencanaan: 'Perencanaan Unit',
  'my-dashboard': 'Dashboard Saya', 'coord-dashboard': 'Dashboard Koordinator', 'my-incidents': 'Insiden Saya', 'kegiatan-saya': 'Kegiatan Saya', performa: 'Performa Teknisi',
  ssh: 'SSH Terminal', audit: 'Audit Log', equipment: 'Performa Peralatan', logbook: 'Logbook Peralatan', 'api-docs': 'Dokumentasi API', surat: 'Manajemen Surat Keluar', 'laporan-bulanan': 'Susun Laporan Bulanan', attendance: 'Manajemen Absensi', diklat: 'Pengajuan Diklat', dokumen: 'Manajemen Dokumen & Knowledge Base', 'kegiatan-nr': 'Laporan Kegiatan Non-Rutin', 'pelaporan-qr': 'Pelaporan Fasilitas QR', skp: 'SKP / e-Kinerja',
};

// ===== Menu gabungan lintas-peran =====

export const ROLE_ORDER: Role[] = ['admin', 'koordinator', 'teknisi', 'viewer'];
export type NavLeaf = Extract<NavEntry, { id: string }>;

// Gabungkan menu dari semua peran user: item unik per id (dan per label, agar
// "Dashboard" admin & koordinator tidak muncul dobel), dikelompokkan per section
// (kemunculan pertama), section kosong dibuang. Item eksklusif-unit yang bukan
// unit aktif disaring DI SINI, sebelum dedup label — supaya dua item beda unit
// yang berbagi label (mis. "Performa Peralatan": equipment=ELB vs
// aset-availability=AAB) tidak saling menggugurkan. unitCode null = tak disaring.
export function mergedNav(roles: Role[], unitCode: string | null): NavEntry[] {
  const seen = new Set<string>();
  const seenLabels = new Set<string>();
  const groups = new Map<string, NavLeaf[]>();
  const order: string[] = [];
  let cur = 'Menu';
  for (const role of ROLE_ORDER) {
    if (!roles.includes(role)) continue;
    for (const e of NAV_ITEMS[role] || []) {
      if ('section' in e && e.section) {
        cur = e.section;
        if (!groups.has(cur)) { groups.set(cur, []); order.push(cur); }
      } else if ('id' in e) {
        // Buang item milik unit lain lebih dulu, agar ia tak "mengklaim" id/label
        // lalu tersaring (bikin menu unit aktif kehilangan item berlabel sama).
        if (unitCode && UNIT_ONLY[e.id] && !UNIT_ONLY[e.id].includes(unitCode)) continue;
        if (seen.has(e.id) || seenLabels.has(e.label)) continue;
        seen.add(e.id);
        seenLabels.add(e.label);
        if (!groups.has(cur)) { groups.set(cur, []); order.push(cur); }
        groups.get(cur)!.push(e);
      }
    }
  }
  const out: NavEntry[] = [];
  for (const title of order) {
    const its = groups.get(title)!;
    if (its.length) { out.push({ section: title }); out.push(...its); }
  }
  return out;
}

// Menu efektif untuk user aktif (sudah disaring per unit). Dipakai AppLayout
// (sidebar/bottom-nav) dan QuickAccess, supaya keduanya tak pernah berbeda isi.
export function useNavItems(user: User | null): NavEntry[] {
  const [units, setUnits] = useState<Unit[]>([]);
  useEffect(() => { api.get('/units').then((r) => setUnits(r.data.units || [])).catch(() => {}); }, []);
  if (!user) return [];
  // Unit aktif: super admin pakai pilihan switcher (null = Semua Unit → tak disaring);
  // role lain terkunci ke unitnya sendiri. Kode unit dipetakan dari daftar unit.
  const effUnitId = hasRole(user, 'admin') ? getActiveUnitId() : (user.unit_id ?? null);
  const effUnitCode = effUnitId ? (units.find((u) => u.id === effUnitId)?.code ?? null) : null;
  const merged = mergedNav(userRoles(user), effUnitCode);
  return merged.length ? merged : NAV_ITEMS.viewer;
}

// Ambil item ber-id dari menu efektif sesuai urutan `ids` (item yang tersaring
// unit otomatis hilang), dibatasi `max`. Basis bottom-nav & kartu akses cepat.
export function pickNav(items: NavEntry[], ids: string[], max: number): NavLeaf[] {
  const byId = new Map(items.filter((e): e is NavLeaf => 'id' in e).map((e) => [e.id, e]));
  const out: NavLeaf[] = [];
  for (const id of ids) {
    const hit = byId.get(id);
    if (hit) out.push(hit);
    if (out.length >= max) break;
  }
  return out;
}

// Label pendek khusus bottom-nav — lima kolom di layar 390px hanya muat ±10
// karakter, jadi "Dashboard Saya"/"Performa Peralatan" harus dipangkas manual
// (bukan dengan ellipsis, yang membuat semua tab terbaca sama).
export const SHORT_LABELS: Record<string, string> = {
  'my-dashboard': 'Dashboard', 'coord-dashboard': 'Dashboard',
  'my-incidents': 'Insiden', incidents: 'Insiden',
  'kegiatan-saya': 'Kegiatan', 'kegiatan-nr': 'Non-Rutin',
  equipment: 'Peralatan', 'aset-availability': 'Peralatan', aset: 'Peralatan',
  sparepart: 'Suku Cadang', 'obat-air': 'Obat Air', peminjaman: 'Pinjam Alat',
  jadwal: 'Jadwal', performa: 'Performa', devices: 'Perangkat', monitor: 'Monitor',
  peta: 'Peta', sla: 'SLA', reports: 'Laporan', logbook: 'Logbook',
  'laporan-bulanan': 'Lap. Bulanan', 'laporan-kinerja': 'Unjuk Hasil', 'laporan-aab': 'Lap. AAB',
  attendance: 'Absensi', perencanaan: 'Rencana', dokumen: 'Dokumen', diklat: 'Diklat',
  users: 'User', master: 'Master', surat: 'Surat', settings: 'Setelan',
};
export const shortLabel = (n: NavLeaf) => SHORT_LABELS[n.id] ?? n.label;

// Kandidat tab bawah (mobile), urut prioritas. Hanya 4 pertama yang tersedia
// dipakai — sisanya masuk tab "Menu". Daftar sengaja lebih panjang dari 4 agar
// unit yang menyaring sebagian menu tetap dapat 4 tab penuh.
export const BOTTOM_IDS: Record<Role, string[]> = {
  teknisi: ['my-dashboard', 'my-incidents', 'kegiatan-saya', 'aset', 'equipment', 'jadwal', 'devices', 'skp'],
  koordinator: ['dashboard', 'incidents', 'jadwal', 'performa', 'devices', 'reports'],
  admin: ['dashboard', 'incidents', 'jadwal', 'performa', 'devices', 'reports'],
  viewer: ['dashboard', 'devices', 'monitor', 'peta', 'sla'],
};

// Kandidat kartu "Akses Cepat" di dashboard, urut prioritas (maks 8 tampil).
export const QUICK_IDS: Record<Role, string[]> = {
  teknisi: ['my-incidents', 'kegiatan-saya', 'aset', 'equipment', 'sparepart', 'logbook', 'jadwal', 'skp', 'dokumen', 'diklat', 'devices', 'peta'],
  koordinator: ['incidents', 'jadwal', 'performa', 'attendance', 'surat', 'laporan-bulanan', 'skp', 'perencanaan', 'users', 'devices', 'sla', 'master'],
  admin: ['incidents', 'jadwal', 'performa', 'attendance', 'surat', 'laporan-bulanan', 'users', 'perencanaan', 'devices', 'sla', 'master', 'settings'],
  viewer: ['devices', 'monitor', 'peta', 'sla', 'notifikasi'],
};

// Gabung kandidat dari semua peran user (urutan peran mengikuti ROLE_ORDER),
// tanpa duplikat — user multi-peran tetap dapat pintasan dari tiap perannya.
export function idsForRoles(map: Record<Role, string[]>, roles: Role[]): string[] {
  const out: string[] = [];
  for (const r of ROLE_ORDER) {
    if (!roles.includes(r)) continue;
    for (const id of map[r] || []) if (!out.includes(id)) out.push(id);
  }
  return out;
}
