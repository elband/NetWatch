// Satu sumber kebenaran tipe shift & format jam dinas di frontend — selaras dengan enum
// DB shift_type dan konstanta backend (config/shifts.js). Jangan meng-hardcode daftar tipe
// shift atau JAM shift di komponen lain: jam dinas bersifat dinamis per-unit ("Atur Jam
// Dinas"), jadi ambil dari useShiftWindows() agar label tak pernah lepas-sinkron.
import { useEffect, useState } from 'react';
import { api } from '../api/client';

export type ShiftKey = 'pagi' | 'siang' | 'Normal';
export interface ShiftWin { start: number; end: number }
export type ShiftWindows = Partial<Record<ShiftKey, ShiftWin>>;

// WORK = shift kerja (on-duty); NONWORK = tak punya jam dinas. Selaras backend WORK/NONWORK.
export const WORK_SHIFT_TYPES = ['pagi', 'siang', 'Normal'] as const;
export const NONWORK_SHIFT_TYPES = ['libur', 'dinas_luar', 'cuti'] as const;
export const ALL_SHIFT_TYPES = [...WORK_SHIFT_TYPES, ...NONWORK_SHIFT_TYPES] as const;

// Nama tampilan shift (tanpa jam).
export const SHIFT_NAME: Record<string, string> = {
  pagi: 'Pagi', siang: 'Siang', Normal: 'Normal', libur: 'Libur', dinas_luar: 'Dinas Luar', cuti: 'Cuti',
};

// Jam desimal → "HH.MM" (5 → "05.00", 13.5 → "13.30").
export function fmtHour(h: number, sep = '.'): string {
  const norm = ((h % 24) + 24) % 24;
  const hh = Math.floor(norm);
  const mm = Math.round((norm - hh) * 60);
  return `${String(hh).padStart(2, '0')}${sep}${String(mm % 60).padStart(2, '0')}`;
}

// Window → "05.00–13.00"; null bila window tak ada.
export function fmtWindow(w?: ShiftWin, sep = '.'): string | null {
  if (!w) return null;
  return `${fmtHour(w.start, sep)}–${fmtHour(w.end, sep)}`;
}

// Label lengkap, mis. "Pagi · 05.00–13.00" (jam dari window dinamis; fallback nama saja).
export function shiftLabel(shiftType: string | null | undefined, windows: ShiftWindows, joiner = ' · '): string {
  if (!shiftType) return '-';
  const name = SHIFT_NAME[shiftType] || shiftType;
  const hrs = fmtWindow(windows[shiftType as ShiftKey]);
  return hrs ? `${name}${joiner}${hrs}` : name;
}

// Ambil jam dinas EFEKTIF unit user (dari GET /jadwal/shift-windows), sekali per mount.
// Kosong bila gagal → label jatuh ke nama shift tanpa jam.
export function useShiftWindows(): ShiftWindows {
  const [windows, setWindows] = useState<ShiftWindows>({});
  useEffect(() => {
    let alive = true;
    api.get('/jadwal/shift-windows')
      .then((r) => { if (alive) setWindows(r.data?.windows || {}); })
      .catch(() => { /* biarkan kosong → fallback nama tanpa jam */ });
    return () => { alive = false; };
  }, []);
  return windows;
}
