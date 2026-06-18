import type { Incident } from '../types';

/** Lama perangkat terputus (ms): dari insiden dibuat sampai selesai, atau sampai `nowMs` jika masih aktif. */
export function downtimeMs(inc: Incident, nowMs: number): number {
  const start = new Date(inc.created_at.replace(' ', 'T')).getTime();
  const end = inc.status === 'selesai' && inc.resolved_at ? new Date(inc.resolved_at.replace(' ', 'T')).getTime() : nowMs;
  return Math.max(0, end - start);
}

/** Format durasi terputus menjadi "Xj Ym" (jam & menit). */
export function fmtDowntime(ms: number): string {
  const totalMin = Math.floor(ms / 60000);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return h > 0 ? `${h}j ${m}m` : `${m}m`;
}

/** Warna teks berdasarkan lama terputus & status (merah jika lama & masih aktif). */
export function downtimeColor(inc: Incident, ms: number): string {
  if (inc.status === 'selesai') return 'text-text2';
  const hours = ms / 3600000;
  return hours >= 4 ? 'text-danger' : hours >= 1 ? 'text-warn' : 'text-text2';
}
