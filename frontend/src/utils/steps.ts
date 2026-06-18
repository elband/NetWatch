import type { Incident } from '../types';

// Tahap insiden (untuk progress bar & label). Alur berbasis tindakan:
// 0 Belum Mulai → 1 Dicoba via SSH → 2 Visit ke Perangkat → 3 Diserahkan ke Teknisi → 4 Selesai.
const LABELS = ['Belum Mulai', 'Dicoba via SSH', 'Visit ke Perangkat', 'Analisa Kerusakan', 'Selesai'];
const MAX = 4;

// Perangkat dianggap ber-IP (boleh jalur SSH) hanya bila IP-nya format IPv4 valid.
// Placeholder seperti "N/A (Laporan Publik)" dianggap TIDAK ber-IP → langsung Visit.
export function hasIp(ip: string | null | undefined): boolean {
  return !!ip && /^\d{1,3}(\.\d{1,3}){3}$/.test(ip.trim());
}

export function stepLabels(_inc?: unknown): string[] {
  return LABELS;
}
export function maxStep(_inc?: unknown): number {
  return MAX;
}

export function stepLabel(inc: Pick<Incident, 'awaiting_part' | 'status'>, step: number): string {
  if (inc.awaiting_part && inc.status !== 'selesai' && step >= 3 && step < MAX) return 'Menunggu Suku Cadang';
  return LABELS[step] ?? `Tahap ${step}`;
}

export function progressPct(inc: Pick<Incident, 'step'>): number {
  return Math.round((inc.step / MAX) * 100);
}

// Label tombol "lanjut" pada kartu (modal menampilkan pilihan lengkap).
export function nextStepLabel(inc: Pick<Incident, 'ip' | 'step' | 'status'>): string {
  if (inc.status === 'selesai') return 'Selesai';
  const s = inc.step || 0;
  if (s === 0) return hasIp(inc.ip) ? 'Coba Lewat SSH' : 'Visit ke Perangkat';
  if (s === 1) return 'Lanjutkan Tindakan';
  if (s === 2) return 'Analisa Kerusakan';
  return 'Selesaikan / Suku Cadang';
}
