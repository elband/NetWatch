import type { DeviceStatus } from '../types';

/**
 * Nada status perangkat — SATU sumber untuk badge status dan pita tepi kartu,
 * supaya keduanya tak pernah berbeda saat aturan di bawah berubah.
 *
 * Urutan pemeriksaan harus sama persis dengan DeviceStatusBadge: maintenance
 * terjadwal & perangkat yang sengaja dimatikan/dijeda BUKAN alarm, jadi harus
 * dicek lebih dulu daripada status ping mentahnya.
 *
 * Berada di utils/ (bukan di StatusBadge.tsx) karena file komponen yang juga
 * mengekspor konstanta/fungsi mematikan fast refresh Vite untuk file itu.
 */
export type DeviceTone = 'maintenance' | 'paused' | 'online' | 'offline' | 'warning';

export interface DeviceToneInput {
  status: DeviceStatus;
  offReason?: string | null;
  monitorEnabled?: number;
  underMaintenance?: number | boolean;
}

export function deviceTone({ status, offReason, monitorEnabled, underMaintenance }: DeviceToneInput): DeviceTone {
  if (underMaintenance) return 'maintenance';
  if (offReason === 'dimatikan' || offReason === 'poweroff') return 'paused';
  if (monitorEnabled === 0) return 'paused';
  if (status === 'online') return 'online';
  if (status === 'warning') return 'warning';
  return 'offline';
}

export const TONE_BAR: Record<DeviceTone, string> = {
  maintenance: 'bg-amber-400',
  paused: 'bg-slate-500',
  online: 'bg-success',
  warning: 'bg-warn',
  offline: 'bg-danger',
};
