import { useEffect, useState } from 'react';
import { api } from '../api/client';
import type { Attendance } from '../types';

const jam = (s: string | null) => (s ? new Date(s.replace(' ', 'T')).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' }) : '--:--');
const LEAVE_LABEL: Record<string, string> = { izin: 'Izin', sakit: 'Sakit', cuti: 'Cuti', dinas_luar: 'Dinas Luar' };

function deviceId() {
  let id = localStorage.getItem('nw_device');
  if (!id) { id = (crypto as any).randomUUID ? crypto.randomUUID() : 'd' + Math.random().toString(36).slice(2) + Date.now(); localStorage.setItem('nw_device', id!); }
  return id!;
}
function getPos(): Promise<{ lat: number | null; lng: number | null; accuracy: number | null }> {
  return new Promise((resolve) => {
    if (!navigator.geolocation) return resolve({ lat: null, lng: null, accuracy: null });
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy }),
      () => resolve({ lat: null, lng: null, accuracy: null }),
      { enableHighAccuracy: true, timeout: 8000, maximumAge: 0 }
    );
  });
}

interface Leave { id: number; type: string; start_date: string; end_date: string; status: string }

export default function AbsenCard() {
  const [att, setAtt] = useState<Attendance | null>(null);
  const [leaves, setLeaves] = useState<Leave[]>([]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ type: 'ok' | 'warn'; text: string } | null>(null);
  const [showLeave, setShowLeave] = useState(false);
  const [geo, setGeo] = useState<{ status: 'checking' | 'ok' | 'denied'; pos: { lat: number | null; lng: number | null; accuracy: number | null } | null }>({ status: 'checking', pos: null });

  function load() {
    api.get('/attendance/today').then((r) => setAtt(r.data.attendance)).catch(() => {});
    api.get('/leave/me').then((r) => setLeaves(r.data.leave.slice(0, 3))).catch(() => {});
  }
  async function checkGeo() {
    setGeo({ status: 'checking', pos: null });
    const pos = await getPos();
    setGeo(pos.lat != null && pos.lng != null ? { status: 'ok', pos } : { status: 'denied', pos: null });
  }
  useEffect(load, []);
  useEffect(() => { checkGeo(); }, []);

  async function act(kind: 'check-in' | 'check-out') {
    setBusy(true); setMsg(null);
    try {
      const pos = geo.pos || (await getPos());
      const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
      const r = await api.post(`/attendance/${kind}`, { ...pos, tz, deviceId: deviceId() });
      load();
      if (r.data.warning) setMsg({ type: 'warn', text: r.data.warning });
      else setMsg({ type: 'ok', text: kind === 'check-in' ? 'Absen masuk tercatat. Selamat bertugas!' : 'Absen pulang tercatat. Terima kasih!' });
    } catch (e: any) { setMsg({ type: 'warn', text: e?.response?.data?.error || 'Gagal absen.' }); }
    finally { setBusy(false); }
  }

  const masuk = !!att?.check_in_at;
  const pulang = !!att?.check_out_at;
  const geoReady = geo.status === 'ok';

  return (
    <div className="bg-surface border border-border rounded-xl p-4">
      <div className="flex items-center justify-between mb-3">
        <div className="text-sm font-bold">🕒 Absensi Hari Ini</div>
        {att?.flagged ? <span className="text-[10px] px-2 py-0.5 rounded-full bg-danger/15 text-danger font-semibold">⚠️ Terindikasi VPN/lokasi</span>
          : masuk ? <span className="text-[10px] px-2 py-0.5 rounded-full bg-success/15 text-success font-semibold">● Hadir</span>
          : <span className="text-[10px] px-2 py-0.5 rounded-full bg-border text-text2">Belum absen</span>}
      </div>

      <div className="grid grid-cols-2 gap-2 mb-3">
        <div className="bg-surface2 rounded-lg p-2.5 text-center"><div className="text-[10px] text-text2">Masuk</div><div className="text-lg font-bold text-success">{jam(att?.check_in_at ?? null)}</div></div>
        <div className="bg-surface2 rounded-lg p-2.5 text-center"><div className="text-[10px] text-text2">Pulang</div><div className="text-lg font-bold text-accent2">{jam(att?.check_out_at ?? null)}</div></div>
      </div>

      {geo.status === 'denied' && (
        <div className="mb-3 rounded-md px-3 py-2 text-[11px] border bg-danger/10 border-danger/30 text-danger flex items-center justify-between gap-2">
          <span>📍 Aktifkan GPS/lokasi perangkat untuk bisa absen masuk/pulang.</span>
          <button onClick={checkGeo} className="shrink-0 border border-danger/40 rounded px-2 py-1 text-[10px] font-semibold hover:bg-danger/10">🔄 Coba Lagi</button>
        </div>
      )}
      {geo.status === 'checking' && (
        <div className="mb-3 rounded-md px-3 py-2 text-[11px] border bg-border/30 border-border text-text2">📍 Memeriksa GPS…</div>
      )}

      <div className="flex gap-2">
        <button onClick={() => act('check-in')} disabled={busy || masuk || !geoReady} title={!geoReady ? 'Aktifkan GPS dulu' : undefined} className="flex-1 bg-success text-bg rounded-lg py-2 text-xs font-semibold disabled:opacity-40">{busy && !masuk ? 'Memproses…' : '✅ Absen Masuk'}</button>
        <button onClick={() => act('check-out')} disabled={busy || !masuk || pulang || !geoReady} title={!geoReady ? 'Aktifkan GPS dulu' : undefined} className="flex-1 bg-accent2 text-bg rounded-lg py-2 text-xs font-semibold disabled:opacity-40">🏁 Absen Pulang</button>
        <button onClick={() => setShowLeave(true)} className="border border-border text-text2 hover:text-text rounded-lg py-2 px-3 text-xs">📝 Izin/Cuti</button>
      </div>

      {msg && <div className={`mt-3 rounded-md px-3 py-2 text-[11px] border ${msg.type === 'ok' ? 'bg-success/10 border-success/30 text-success' : 'bg-danger/10 border-danger/30 text-danger'}`}>{msg.type === 'ok' ? '✓ ' : '⚠️ '}{msg.text}</div>}

      {leaves.length > 0 && (
        <div className="mt-3 border-t border-border pt-2">
          <div className="text-[10px] text-text2 mb-1">Pengajuan Terakhir</div>
          {leaves.map((l) => (
            <div key={l.id} className="flex items-center justify-between text-[11px] py-0.5">
              <span>{LEAVE_LABEL[l.type]} · {l.start_date}{l.end_date !== l.start_date ? `–${l.end_date}` : ''}</span>
              <span className={l.status === 'disetujui' ? 'text-success' : l.status === 'ditolak' ? 'text-danger' : 'text-warn'}>{l.status}</span>
            </div>
          ))}
        </div>
      )}
      <div className="text-[9px] text-text2 mt-2">Lokasi GPS & perangkat diverifikasi. VPN / lokasi palsu / perangkat asing otomatis terdeteksi & menurunkan performa 50%.</div>

      {showLeave && <LeaveModal onClose={() => setShowLeave(false)} onSaved={() => { setShowLeave(false); load(); }} />}
    </div>
  );
}

function LeaveModal({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const today = new Date().toISOString().slice(0, 10);
  const [type, setType] = useState('izin');
  const [startDate, setStart] = useState(today);
  const [endDate, setEnd] = useState(today);
  const [reason, setReason] = useState('');
  const [doc, setDoc] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  async function submit() {
    if (endDate < startDate) return setErr('Tanggal selesai sebelum mulai.');
    setBusy(true); setErr('');
    try {
      const fd = new FormData();
      fd.append('type', type); fd.append('startDate', startDate); fd.append('endDate', endDate);
      if (reason.trim()) fd.append('reason', reason.trim());
      if (doc) fd.append('doc', doc);
      await api.post('/leave', fd, { headers: { 'Content-Type': 'multipart/form-data' } });
      onSaved();
    } catch (e: any) { setErr(e?.response?.data?.error || 'Gagal mengirim.'); }
    finally { setBusy(false); }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-surface border border-border rounded-xl w-full max-w-sm p-5 max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-sm font-bold mb-4">📝 Pengajuan Izin / Cuti</h3>
        <label className="block text-[11px] text-text2 mb-1">Jenis</label>
        <select className="w-full bg-surface2 border border-border rounded-md px-3 py-2 text-xs mb-3" value={type} onChange={(e) => setType(e.target.value)}>
          {Object.entries(LEAVE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <div className="grid grid-cols-2 gap-2 mb-3">
          <div><label className="block text-[11px] text-text2 mb-1">Mulai</label><input type="date" className="w-full bg-surface2 border border-border rounded-md px-2 py-2 text-xs" value={startDate} onChange={(e) => setStart(e.target.value)} /></div>
          <div><label className="block text-[11px] text-text2 mb-1">Selesai</label><input type="date" className="w-full bg-surface2 border border-border rounded-md px-2 py-2 text-xs" value={endDate} onChange={(e) => setEnd(e.target.value)} /></div>
        </div>
        <label className="block text-[11px] text-text2 mb-1">Alasan</label>
        <input className="w-full bg-surface2 border border-border rounded-md px-3 py-2 text-xs mb-3" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Keperluan…" />
        <label className="block text-[11px] text-text2 mb-1">📎 Bukti (surat sakit/tugas — opsional)</label>
        <input type="file" accept="image/*,application/pdf" capture="environment" onChange={(e) => setDoc(e.target.files?.[0] || null)} className="w-full text-[11px] text-text2 mb-3 file:mr-2 file:py-1.5 file:px-3 file:rounded-md file:border-0 file:text-xs file:bg-surface2 file:text-text" />
        {err && <div className="bg-danger/10 border border-danger/30 rounded-md px-3 py-2 text-[11px] text-danger mb-3">⚠️ {err}</div>}
        <div className="flex gap-2 justify-end">
          <button className="border border-border text-text2 rounded-md px-3 py-1.5 text-xs" onClick={onClose} disabled={busy}>Batal</button>
          <button className="bg-accent text-bg rounded-md px-3 py-1.5 text-xs font-semibold disabled:opacity-50" onClick={submit} disabled={busy}>{busy ? 'Mengirim…' : 'Ajukan'}</button>
        </div>
      </div>
    </div>
  );
}
