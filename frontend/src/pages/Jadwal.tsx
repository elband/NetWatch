import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { hasRole } from '../utils/roles';
import type { Shift, User } from '../types';

// Kode & label resmi (selaras dengan Laporan Bulanan): N = Dinas Kantor, P = Pagi, S = Siang, L = Libur.
const SHIFT_COLOR: Record<string, string> = { pagi: 'text-success bg-success/10', siang: 'text-warn bg-warn/10', malam: 'text-accent2 bg-accent2/10', libur: 'text-text2 bg-border/30', dinas_luar: 'text-[#a78bfa] bg-[#a78bfa]/10', cuti: 'text-[#f472b6] bg-[#f472b6]/10' };
const SHIFT_ABBR: Record<string, string> = { pagi: 'P', siang: 'S', malam: 'N', libur: 'L', dinas_luar: 'DL', cuti: 'C' };
const SHIFT_LABEL: Record<string, string> = { pagi: 'Dinas Pagi', siang: 'Dinas Siang', malam: 'Dinas Kantor', libur: 'Libur', dinas_luar: 'Dinas Luar', cuti: 'Cuti' };
// DL (dinas_luar) tidak masuk siklus klik — hanya lewat pengajuan teknisi + persetujuan koordinator.
const SHIFTS = ['malam', 'pagi', 'siang', 'libur'];

function dateKey(d: Date) {
  return d.toISOString().slice(0, 10);
}

export default function Jadwal() {
  const { user } = useAuth();
  const canEdit = hasRole(user, 'admin', 'koordinator');
  const [monthOffset, setMonthOffset] = useState(0);
  const [techs, setTechs] = useState<User[]>([]);
  const [shifts, setShifts] = useState<Shift[]>([]);
  const [msg, setMsg] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  const today = new Date();
  const viewDate = new Date(today.getFullYear(), today.getMonth() + monthOffset, 1);
  const year = viewDate.getFullYear();
  const month = viewDate.getMonth();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const monthNames =['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];

  // Sertakan teknisi + koordinator (koordinator tampil paling atas).
  const isRole = (u: User, r: string) => u.role === r || (u.roles || []).includes(r as any);
  useEffect(() => {
    if (canEdit) api.get('/users').then((res) => {
      const us: User[] = (res.data.users as User[]).filter((u) => u.active && (isRole(u, 'teknisi') || isRole(u, 'koordinator')));
      us.sort((a, b) => (isRole(b, 'koordinator') ? 1 : 0) - (isRole(a, 'koordinator') ? 1 : 0) || a.name.localeCompare(b.name));
      setTechs(us);
    });
  }, [canEdit]);

  useEffect(() => {
    const from = dateKey(new Date(year, month, 1));
    const to = dateKey(new Date(year, month, daysInMonth));
    api.get(`/jadwal?from=${from}&to=${to}`).then((res) => setShifts(res.data.shifts));
  }, [year, month, daysInMonth]);

  const shiftMap = useMemo(() => {
    const map: Record<string, Record<number, string>> = {};
    for (const s of shifts) {
      (map[s.shift_date] ||= {})[s.user_id] = s.shift_type;
    }
    return map;
  }, [shifts]);

  const monthStr = `${year}-${String(month + 1).padStart(2, '0')}`;
  function reload() {
    const from = dateKey(new Date(year, month, 1));
    const to = dateKey(new Date(year, month, daysInMonth));
    api.get(`/jadwal?from=${from}&to=${to}`).then((res) => setShifts(res.data.shifts));
  }

  async function toggleShift(userId: number, dateStr: string) {
    if (!canEdit) return;
    const cur = shiftMap[dateStr]?.[userId] || 'libur';
    const next = SHIFTS[(SHIFTS.indexOf(cur) + 1) % SHIFTS.length];
    await api.put(`/jadwal/${userId}/${dateStr}`, { shiftType: next });
    reload();
  }

  async function downloadTemplate() {
    const res = await api.get(`/jadwal/template?month=${monthStr}`, { responseType: 'blob' });
    const url = URL.createObjectURL(res.data);
    const a = document.createElement('a');
    a.href = url; a.download = `template-jadwal-${monthStr}.xlsx`; a.click();
    URL.revokeObjectURL(url);
  }
  async function importFile(file: File) {
    setMsg('Mengimpor…');
    try {
      const fd = new FormData();
      fd.append('file', file);
      const res = await api.post('/jadwal/import', fd, { headers: { 'Content-Type': 'multipart/form-data' } });
      const { updated, errors } = res.data;
      setMsg(`✓ ${updated} sel jadwal diperbarui.${errors?.length ? ` ${errors.length} dilewati.` : ''}`);
      if (errors?.length) console.warn('Import jadwal:', errors);
      reload();
    } catch (e: any) {
      setMsg(e?.response?.data?.error || 'Gagal mengimpor.');
    } finally {
      setTimeout(() => setMsg(''), 6000);
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  const techNames = Array.from(new Set(shifts.map((s) => s.user_id))).map((id) => {
    const found = shifts.find((s) => s.user_id === id);
    return { id, name: found?.user_name || '' };
  });
  const rowTechs = canEdit ? techs.map((t) => ({ id: t.id, name: t.name })) : techNames;

  return (
    <div>
      <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
        <div><div className="text-[17px] font-bold">📅 Jadwal Dinas Teknisi</div></div>
        <div className="flex items-center gap-2">
          <button className="border border-border text-text2 rounded-md px-2.5 py-1 text-xs" onClick={() => setMonthOffset((m) => m - 1)}>← Bulan Lalu</button>
          <span className="text-[13px] font-semibold min-w-[130px] text-center">{monthNames[month]} {year}</span>
          <button className="border border-border text-text2 rounded-md px-2.5 py-1 text-xs" onClick={() => setMonthOffset((m) => m + 1)}>Bulan Depan →</button>
        </div>
      </div>

      <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
        <div className="flex items-center gap-3 text-[10px] text-text2">
          {(['malam', 'pagi', 'siang', 'libur', 'dinas_luar', 'cuti'] as const).map((s) => (
            <span key={s} className={`px-2 py-0.5 rounded font-bold ${SHIFT_COLOR[s]}`}>{SHIFT_ABBR[s]} = {SHIFT_LABEL[s]}</span>
          ))}
          {canEdit && <span className="text-text2">· klik sel untuk ganti shift · DL & C (Cuti) hanya dari pengajuan teknisi yang disetujui</span>}
        </div>
        {canEdit && (
          <div className="flex items-center gap-2">
            <button onClick={downloadTemplate} className="border border-border text-text2 rounded-md px-3 py-1.5 text-xs hover:text-white">⬇️ Template Excel</button>
            <button onClick={() => fileRef.current?.click()} className="border border-accent2/40 text-accent2 rounded-md px-3 py-1.5 text-xs font-semibold">⬆️ Import Excel</button>
            <input ref={fileRef} type="file" accept=".xlsx,.xls" className="hidden" onChange={(e) => e.target.files?.[0] && importFile(e.target.files[0])} />
          </div>
        )}
      </div>
      {msg && <div className="bg-accent2/10 border border-accent2/30 rounded-md px-3 py-2 text-[11px] text-accent2 mb-3">{msg}</div>}

      <div className="bg-surface border border-border rounded-[10px] overflow-x-auto">
        <table className="border-collapse text-center select-none" style={{ minWidth: 'max-content' }}>
          <thead>
            <tr>
              <th className="sticky left-0 z-10 bg-surface2 text-left text-[11px] font-semibold text-text2 px-3 py-2 border-b border-r border-border min-w-[130px]">Teknisi</th>
              {Array.from({ length: daysInMonth }).map((_, i) => {
                const d = i + 1;
                const dow = new Date(year, month, d).getDay();
                const weekend = dow === 0 || dow === 6;
                const isToday = dateKey(new Date(year, month, d)) === dateKey(today);
                return (
                  <th key={d} className={`px-0 py-1 border-b border-border text-[10px] font-semibold ${weekend ? 'text-danger/80' : 'text-text2'} ${isToday ? 'bg-accent/20' : ''}`} style={{ minWidth: 26 }}>
                    <div className="leading-none">{d}</div>
                    <div className="text-[8px] font-normal opacity-70">{['Min', 'Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab'][dow]}</div>
                  </th>
                );
              })}
              <th className="px-2 py-1 border-b border-l border-border text-[9px] font-semibold text-text2 min-w-[92px]">Rekap (P/S/N/L)</th>
            </tr>
          </thead>
          <tbody>
            {rowTechs.map((t) => {
              const c = { pagi: 0, siang: 0, malam: 0, libur: 0 } as Record<string, number>;
              return (
                <tr key={t.id} className="hover:bg-surface2/40">
                  <td className="sticky left-0 z-10 bg-surface text-left text-[12px] px-3 py-1.5 border-b border-r border-border whitespace-nowrap">{t.name}</td>
                  {Array.from({ length: daysInMonth }).map((_, i) => {
                    const d = i + 1;
                    const dt = new Date(year, month, d);
                    const k = dateKey(dt);
                    const shift = shiftMap[k]?.[t.id] || 'libur';
                    c[shift] = (c[shift] || 0) + 1;
                    const isToday = k === dateKey(today);
                    return (
                      <td key={k} className="border-b border-border/40 p-[2px]">
                        <button
                          onClick={() => toggleShift(t.id, k)}
                          disabled={!canEdit}
                          title={`${t.name} · ${d} ${monthNames[month]} · ${SHIFT_LABEL[shift]}`}
                          className={`w-full h-7 rounded text-[11px] font-bold ${SHIFT_COLOR[shift]} ${isToday ? 'ring-1 ring-accent' : ''} ${canEdit ? 'cursor-pointer hover:opacity-80' : 'cursor-default'}`}
                        >{SHIFT_ABBR[shift]}</button>
                      </td>
                    );
                  })}
                  <td className="border-b border-l border-border text-[9px] text-text2 px-1.5 py-1.5 whitespace-nowrap">
                    <span className="text-success">{c.pagi}</span>/<span className="text-warn">{c.siang}</span>/<span className="text-accent2">{c.malam}</span>/<span className="text-text2">{c.libur}</span>
                  </td>
                </tr>
              );
            })}
            {rowTechs.length === 0 && (
              <tr><td colSpan={daysInMonth + 2} className="text-center text-text2 text-xs py-6">Belum ada jadwal untuk bulan ini.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
