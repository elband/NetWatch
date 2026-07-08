import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { hasRole } from '../utils/roles';
import type { Shift, User } from '../types';

// Kode & label resmi (selaras dengan Laporan Bulanan): N = Dinas Kantor, P = Pagi, S = Siang, L = Libur.
const SHIFT_COLOR: Record<string, string> = { pagi: 'text-success bg-success/10', siang: 'text-warn bg-warn/10', malam: 'text-accent2 bg-accent2/10', libur: 'text-danger bg-danger/10', dinas_luar: 'text-[#a78bfa] bg-[#a78bfa]/10', cuti: 'text-[#f472b6] bg-[#f472b6]/10' };
const SHIFT_ABBR: Record<string, string> = { pagi: 'P', siang: 'S', malam: 'N', libur: 'L', dinas_luar: 'DL', cuti: 'C' };
const SHIFT_LABEL: Record<string, string> = { pagi: 'Dinas Pagi', siang: 'Dinas Siang', malam: 'Dinas Kantor', libur: 'Libur', dinas_luar: 'Dinas Luar', cuti: 'Cuti' };
// DL (dinas_luar) tidak masuk siklus klik — hanya lewat pengajuan teknisi + persetujuan koordinator.
const SHIFTS = ['malam', 'pagi', 'siang', 'libur'];

// Pakai komponen tanggal lokal (bukan toISOString) agar tidak bergeser akibat
// konversi ke UTC (WIB = UTC+7 menyebabkan tanggal lokal mundur 1 hari).
function dateKey(d: Date) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

const DAY_NAMES = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', "Jum'at", 'Sabtu'];

export default function Jadwal() {
  const { user } = useAuth();
  const canEdit = hasRole(user, 'admin', 'koordinator');
  const [monthOffset, setMonthOffset] = useState(0);
  const [techs, setTechs] = useState<User[]>([]);
  const [shifts, setShifts] = useState<Shift[]>([]);
  const [msg, setMsg] = useState('');
  const [showRules, setShowRules] = useState(false);
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
        <div>
          <div className="text-[17px] font-bold">📅 Jadwal Dinas Teknisi</div>
          <div className="text-[11px] text-text2 mt-0.5">Hari ini {DAY_NAMES[today.getDay()]}, {today.getDate()} {monthNames[today.getMonth()]} {today.getFullYear()}</div>
        </div>
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
            <button onClick={() => setShowRules(true)} className="border border-accent2/40 text-accent2 rounded-md px-3 py-1.5 text-xs font-semibold">⏰ Atur Jam Dinas</button>
            <button onClick={downloadTemplate} className="border border-border text-text2 rounded-md px-3 py-1.5 text-xs hover:text-text">⬇️ Template Excel</button>
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
                    <span className="text-success">{c.pagi}</span>/<span className="text-warn">{c.siang}</span>/<span className="text-accent2">{c.malam}</span>/<span className="text-danger">{c.libur}</span>
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

      {showRules && <ShiftRulesModal onClose={() => setShowRules(false)} />}
    </div>
  );
}

// ===================== ATUR JAM DINAS (SHIFT WINDOWS) =====================
type ShiftKey = 'pagi' | 'siang' | 'malam';
interface Win { start: number; end: number }
// Pagi & Siang wajib (selalu jendela on-duty). Dinas Kantor (N) opsional —
// ditambahkan koordinator lewat tombol "+ Tambah Aturan".
const OPTIONAL_KEYS: ShiftKey[] = ['malam'];
const ROW_ORDER: ShiftKey[] = ['pagi', 'siang', 'malam'];
const ROW_META: Record<ShiftKey, { abbr: string; label: string; color: string }> = {
  pagi: { abbr: 'P', label: 'Dinas Pagi', color: 'var(--color-success)' },
  siang: { abbr: 'S', label: 'Dinas Siang', color: 'var(--color-warn)' },
  malam: { abbr: 'N', label: 'Dinas Kantor', color: 'var(--color-accent2)' },
};
const hourToTime = (h: number) => {
  const hh = Math.floor(h); const mm = Math.round((h - hh) * 60);
  return `${String(hh).padStart(2, '0')}:${String(mm % 60).padStart(2, '0')}`;
};
const timeToHour = (t: string) => {
  const [hh, mm] = (t || '0:0').split(':').map(Number);
  return (hh || 0) + (mm || 0) / 60;
};
// Opsi waktu 24 jam tiap 30 menit — dropdown deterministik 24 jam (tak bergantung locale browser).
const TIME_OPTIONS = Array.from({ length: 48 }, (_, i) => hourToTime(i / 2));

// Dropdown jam 24 jam. Bila nilai saat ini tak ada di grid 30 menit, sisipkan sebagai opsi.
function TimeSelect({ value, onChange }: { value: number; onChange: (t: string) => void }) {
  const cur = hourToTime(value);
  const opts = TIME_OPTIONS.includes(cur) ? TIME_OPTIONS : [...TIME_OPTIONS, cur].sort();
  return (
    <select
      value={cur}
      onChange={(e) => onChange(e.target.value)}
      className="bg-surface border border-border rounded px-2 py-1 text-xs tabular-nums"
    >
      {opts.map((t) => <option key={t} value={t}>{t}</option>)}
    </select>
  );
}

function ShiftRulesModal({ onClose }: { onClose: () => void }) {
  const [wins, setWins] = useState<Partial<Record<ShiftKey, Win>> | null>(null);
  const [defaults, setDefaults] = useState<Partial<Record<ShiftKey, Win>>>({});
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [ok, setOk] = useState(false);

  useEffect(() => {
    api.get('/jadwal/shift-windows')
      .then((r) => { setWins(r.data.windows || {}); setDefaults(r.data.defaults || {}); })
      .catch(() => setErr('Gagal memuat aturan jam.'));
  }, []);

  function setField(key: ShiftKey, field: 'start' | 'end', time: string) {
    setWins((w) => (w ? { ...w, [key]: { ...(w[key] as Win), [field]: timeToHour(time) } } : w));
    setOk(false);
  }
  function addRule(key: ShiftKey) {
    setWins((w) => (w ? { ...w, [key]: defaults[key] || { start: 20, end: 5 } } : w));
    setOk(false);
  }
  function removeRule(key: ShiftKey) {
    setWins((w) => { if (!w) return w; const n = { ...w }; delete n[key]; return n; });
    setOk(false);
  }

  async function save() {
    if (!wins) return;
    setBusy(true); setErr(''); setOk(false);
    try {
      await api.put('/jadwal/shift-windows', wins);
      setOk(true);
      setTimeout(onClose, 900);
    } catch (e: any) {
      setErr(e?.response?.data?.error || 'Gagal menyimpan.');
    } finally { setBusy(false); }
  }

  // Aturan opsional yang belum aktif (bisa ditambahkan).
  const addable = wins ? OPTIONAL_KEYS.filter((k) => !wins[k]) : [];

  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-surface border border-border rounded-xl w-full max-w-md p-5 max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-1">
          <h3 className="text-sm font-bold">⏰ Atur Jam Dinas</h3>
          <button onClick={onClose} className="text-text2 hover:text-text text-lg leading-none">×</button>
        </div>
        <p className="text-[11px] text-text2 mb-4 leading-relaxed">
          Jam dinas <b>khusus unit ini</b>. Menentukan siapa teknisi <b>on-duty</b> (penerima insiden &amp; SLA), dan jam mulai ini juga membuka <b>absensi masuk</b> &amp; <b>menghidupkan peralatan</b> 1 jam sebelumnya. Pagi &amp; Siang wajib; Dinas Kantor (N) opsional. Libur, Dinas Luar, dan Cuti tidak punya jam dinas.
        </p>

        {!wins ? (
          <div className="text-text2 text-xs py-6 text-center">{err || 'Memuat…'}</div>
        ) : (
          <>
            <div className="space-y-2.5">
              {ROW_ORDER.filter((k) => wins[k]).map((key) => {
                const w = wins[key] as Win;
                const { abbr, label, color } = ROW_META[key];
                const overnight = w.start > w.end;
                const removable = OPTIONAL_KEYS.includes(key);
                return (
                  <div key={key} className="flex items-center gap-2.5 bg-surface2 border border-border rounded-lg px-3 py-2.5">
                    <span className="w-7 h-7 shrink-0 rounded-md flex items-center justify-center text-[12px] font-bold" style={{ background: `color-mix(in srgb, ${color} 18%, transparent)`, color }}>{abbr}</span>
                    <div className="flex-1 min-w-0">
                      <div className="text-xs font-semibold leading-tight">{label}</div>
                      {overnight && <div className="text-[9px] text-warn">↦ lintas tengah malam</div>}
                    </div>
                    <TimeSelect value={w.start} onChange={(t) => setField(key, 'start', t)} />
                    <span className="text-text2 text-xs">–</span>
                    <TimeSelect value={w.end} onChange={(t) => setField(key, 'end', t)} />
                    {removable
                      ? <button onClick={() => removeRule(key)} title="Hapus aturan" className="text-text2 hover:text-danger text-lg leading-none px-0.5 shrink-0">×</button>
                      : <span className="w-[18px] shrink-0" />}
                  </div>
                );
              })}
            </div>

            {addable.map((key) => (
              <button
                key={key}
                onClick={() => addRule(key)}
                className="mt-2.5 w-full border border-dashed border-border hover:border-accent2/50 text-text2 hover:text-accent2 rounded-lg px-3 py-2 text-xs font-semibold transition-colors"
              >
                + Tambah Aturan: {ROW_META[key].label} ({ROW_META[key].abbr})
              </button>
            ))}

            <div className="text-[10px] text-text2 mt-3 leading-relaxed">💡 Jika jam <b>mulai &gt; selesai</b> (mis. 20:00–05:00), shift dianggap melewati tengah malam. Perubahan langsung berlaku tanpa restart.</div>
            {err && <div className="bg-danger/10 border border-danger/30 rounded-md px-3 py-2 text-[11px] text-danger mt-3">⚠️ {err}</div>}
            {ok && <div className="bg-success/10 border border-success/30 rounded-md px-3 py-2 text-[11px] text-success mt-3">✓ Tersimpan & diterapkan.</div>}
            <div className="flex gap-2 justify-end mt-4">
              <button className="border border-border text-text2 rounded-md px-3 py-1.5 text-xs" onClick={onClose} disabled={busy}>Tutup</button>
              <button className="bg-accent text-bg rounded-md px-3 py-1.5 text-xs font-semibold disabled:opacity-50" onClick={save} disabled={busy}>{busy ? 'Menyimpan…' : 'Simpan'}</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
