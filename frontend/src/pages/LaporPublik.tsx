import { useEffect, useState } from 'react';
import { api } from '../api/client';

const KATEGORI = ['Komputer', 'Printer', 'Internet', 'WiFi', 'CCTV', 'Access Control', 'FIDS', 'Telepon', 'Monitor Informasi', 'Server', 'Keamanan', 'Operasional', 'Umum', 'Lainnya'];
const URG: Record<string, string> = { kritis: '🔴 Kritis', tinggi: '🟠 Tinggi', sedang: '🟡 Sedang', rendah: '🟢 Rendah' };
const emptyForm = { nama: '', hp: '', jenis: 'Komputer', judul: '', urgensi: 'sedang', detail: '', gedung: '', ruang: '' };

interface Room { kode: string; nama: string; gedung: string | null; lantai: string | null; area: string | null }

export default function LaporPublik() {
  const params = new URLSearchParams(window.location.search);
  const roomCode = params.get('room') || '';
  const trackParam = params.get('track') || '';
  const [room, setRoom] = useState<Room | null>(null);
  const [roomErr, setRoomErr] = useState('');
  const [form, setForm] = useState(emptyForm);
  const [files, setFiles] = useState<File[]>([]);
  const [submitted, setSubmitted] = useState<{ id: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [trackId, setTrackId] = useState(trackParam);
  const [track, setTrack] = useState<any>(null);
  const [showTrack, setShowTrack] = useState(!!trackParam);

  useEffect(() => {
    if (!roomCode) return;
    api.get(`/rooms/public/${encodeURIComponent(roomCode)}`).then((r) => setRoom(r.data.room)).catch(() => setRoomErr('Kode ruangan tidak dikenali. Anda tetap dapat mengisi lokasi manual.'));
  }, [roomCode]);
  // Dari tautan WA: ?track=ID → langsung lacak.
  useEffect(() => { if (trackParam) doTrack(); /* eslint-disable-next-line */ }, []);

  async function submit() {
    if (!form.judul.trim() || !form.detail.trim()) { setError('Perangkat/judul & deskripsi gangguan wajib diisi.'); return; }
    setBusy(true); setError('');
    try {
      const fd = new FormData();
      Object.entries(form).forEach(([k, v]) => v && fd.append(k, v));
      if (roomCode) fd.append('room_code', roomCode);
      fd.append('baseUrl', location.origin);
      files.forEach((f) => fd.append('foto', f));
      const res = await api.post('/public-reports', fd, { headers: { 'Content-Type': 'multipart/form-data' } });
      setSubmitted({ id: res.data.id }); setForm(emptyForm); setFiles([]);
    } catch (e: any) { setError(e?.response?.data?.error || 'Gagal mengirim laporan.'); }
    finally { setBusy(false); }
  }
  async function doTrack(idArg?: string) {
    const tid = (idArg ?? trackId).trim();
    if (!tid) return;
    setTrack(null);
    try { const r = await api.get(`/public-reports/track/${encodeURIComponent(tid)}`); setTrack(r.data.ticket); }
    catch (e: any) { setTrack({ error: e?.response?.data?.error || 'Tiket tidak ditemukan.' }); }
  }

  const STAGE: Record<string, string> = { Menunggu: 'text-warn bg-warn/10', Diproses: 'text-accent2 bg-accent2/10', 'Dalam Penanganan': 'text-orange-400 bg-orange-400/10', Selesai: 'text-success bg-success/10' };

  return (
    <div className="min-h-screen p-4 sm:p-6" style={{ background: 'radial-gradient(900px 500px at 50% -8%, #16243f 0%, #0b1220 45%, #070b14 100%)' }}>
      <div className="max-w-lg mx-auto">
        <div className="flex items-center gap-3 mb-4 text-white">
          <div className="w-11 h-11 rounded-xl flex items-center justify-center text-2xl shadow-lg" style={{ background: 'linear-gradient(135deg,#3b82f6,#22d3ee)' }}>📱</div>
          <div><div className="text-base font-bold">Pelaporan Fasilitas</div><div className="text-[11px] text-slate-400">Unit Elektronika Bandara · A.P.T. Pranoto</div></div>
        </div>

        {/* Lokasi dari QR */}
        {room && (
          <div className="rounded-xl border border-sky-500/30 bg-sky-500/5 p-3.5 mb-3 text-white">
            <div className="text-[10px] text-sky-300 uppercase tracking-wide">📍 Lokasi (dari QR)</div>
            <div className="text-sm font-bold">{room.nama}</div>
            <div className="text-[11px] text-slate-400">{[room.gedung, room.lantai, room.area].filter(Boolean).join(' · ')}</div>
          </div>
        )}
        {roomErr && <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 text-amber-300 p-3 mb-3 text-[11px]">{roomErr}</div>}

        <div className="bg-[#0d1526] border border-white/10 rounded-2xl p-5">
          {submitted ? (
            <div className="text-center py-4">
              <div className="text-5xl mb-2">✅</div>
              <div className="text-emerald-400 font-bold text-lg">Laporan Terkirim!</div>
              <div className="text-[12px] text-slate-400 mt-1">Tiket Anda telah dibuat & diteruskan ke teknisi on-duty.</div>
              <div className="mt-3 bg-black/30 rounded-lg p-3 inline-block"><div className="text-[10px] text-slate-500">Nomor Tiket</div><div className="font-mono text-sky-300 text-lg font-bold">{submitted.id}</div></div>
              <div className="text-[11px] text-emerald-300/80 mt-2">📲 Notifikasi & tautan pemantauan telah dikirim ke WhatsApp Anda (bila nomor diisi).</div>
              <button onClick={() => { setTrackId(submitted.id); setShowTrack(true); doTrack(submitted.id); }} className="mt-3 block mx-auto text-[12px] bg-sky-500/15 text-sky-300 border border-sky-500/30 rounded-md px-3 py-1.5">🔎 Tinjau Status Laporan</button>
              <button onClick={() => setSubmitted(null)} className="mt-2 text-[11px] border border-white/15 rounded-md px-3 py-1.5 text-slate-300">Kirim laporan lain</button>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2 text-[12px] font-semibold text-white">Laporkan Gangguan</div>
              <input className="bg-black/30 border border-white/10 rounded-md px-3 py-2 text-xs text-white" placeholder="Nama (opsional)" value={form.nama} onChange={(e) => setForm({ ...form, nama: e.target.value })} />
              <input className="bg-black/30 border border-white/10 rounded-md px-3 py-2 text-xs text-white" placeholder="No. HP/WA (opsional)" value={form.hp} onChange={(e) => setForm({ ...form, hp: e.target.value })} />
              <select className="bg-black/30 border border-white/10 rounded-md px-3 py-2 text-xs text-white" value={form.jenis} onChange={(e) => setForm({ ...form, jenis: e.target.value })}>{KATEGORI.map((k) => <option key={k} value={k}>{k}</option>)}</select>
              <select className="bg-black/30 border border-white/10 rounded-md px-3 py-2 text-xs text-white" value={form.urgensi} onChange={(e) => setForm({ ...form, urgensi: e.target.value })}>{Object.entries(URG).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
              <input className="col-span-2 bg-black/30 border border-white/10 rounded-md px-3 py-2 text-xs text-white" placeholder="Perangkat/Judul gangguan *" value={form.judul} onChange={(e) => setForm({ ...form, judul: e.target.value })} />
              {!room && <>
                <input className="bg-black/30 border border-white/10 rounded-md px-3 py-2 text-xs text-white" placeholder="Gedung" value={form.gedung} onChange={(e) => setForm({ ...form, gedung: e.target.value })} />
                <input className="bg-black/30 border border-white/10 rounded-md px-3 py-2 text-xs text-white" placeholder="Ruang/Area" value={form.ruang} onChange={(e) => setForm({ ...form, ruang: e.target.value })} />
              </>}
              <textarea className="col-span-2 bg-black/30 border border-white/10 rounded-md px-3 py-2 text-xs text-white min-h-[70px]" placeholder="Deskripsi gangguan *" value={form.detail} onChange={(e) => setForm({ ...form, detail: e.target.value })} />
              <div className="col-span-2">
                <label className="block text-[11px] text-slate-400 mb-1">📷 Upload Foto/Video (opsional)</label>
                <input type="file" multiple accept="image/*,video/*" capture="environment" onChange={(e) => setFiles(Array.from(e.target.files || []))} className="w-full text-[11px] text-slate-400 file:mr-2 file:py-1.5 file:px-3 file:rounded-md file:border-0 file:text-xs file:bg-black/30 file:text-white" />
                {files.length > 0 && <div className="text-[10px] text-sky-300 mt-1">{files.length} file dipilih</div>}
              </div>
              {error && <div className="col-span-2 text-xs text-rose-400">⚠️ {error}</div>}
              <button onClick={submit} disabled={busy} className="col-span-2 text-white rounded-md py-2.5 text-xs font-bold mt-1 disabled:opacity-50" style={{ background: 'linear-gradient(135deg,#3b82f6,#22d3ee)' }}>{busy ? 'Mengirim…' : 'Kirim Laporan →'}</button>
            </div>
          )}
        </div>

        {/* Tracking tiket */}
        <div className="bg-[#0d1526] border border-white/10 rounded-2xl p-4 mt-3">
          <button onClick={() => setShowTrack((v) => !v)} className="w-full flex items-center justify-between text-[12px] text-slate-300 font-semibold"><span>🔎 Lacak Status Tiket</span><span>{showTrack ? '▴' : '▾'}</span></button>
          {showTrack && (
            <div className="mt-3">
              <div className="flex gap-2"><input value={trackId} onChange={(e) => setTrackId(e.target.value)} placeholder="No. Tiket (mis. LAP-0001)" className="flex-1 bg-black/30 border border-white/10 rounded-md px-3 py-2 text-xs text-white" /><button onClick={() => doTrack()} className="bg-sky-500 text-white rounded-md px-3 text-xs font-semibold">Lacak</button></div>
              {track && (track.error ? <div className="text-rose-400 text-[11px] mt-2">{track.error}</div> : (
                <div className="mt-3 text-[12px] text-slate-300 space-y-1">
                  <div className="flex justify-between"><span className="text-slate-500">Status</span><span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold ${STAGE[track.stage] || 'bg-slate-500/10'}`}>{track.stage}</span></div>
                  <div className="flex justify-between"><span className="text-slate-500">Gangguan</span><span>{track.judul}</span></div>
                  <div className="flex justify-between"><span className="text-slate-500">Lokasi</span><span>{track.ruang || track.gedung || '-'}</span></div>
                  <div className="flex justify-between"><span className="text-slate-500">Teknisi</span><span>{track.tech_name || '— (menunggu diambil)'}</span></div>
                  {track.resolved_at && <div className="flex justify-between"><span className="text-slate-500">Selesai</span><span>{new Date(track.resolved_at).toLocaleString('id-ID')}</span></div>}
                  {track.perbaikan && <div className="bg-black/20 rounded p-2 text-[11px]"><span className="text-slate-500">Catatan: </span>{track.perbaikan}</div>}
                </div>
              ))}
            </div>
          )}
        </div>
        <div className="text-center text-[10px] text-slate-600 mt-3">Tanpa login · Laporan langsung diteruskan ke teknisi on-duty</div>
      </div>
    </div>
  );
}
