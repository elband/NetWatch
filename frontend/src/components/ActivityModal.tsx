import { useState } from 'react';
import { api } from '../api/client';

const TYPES = [
  { v: 'rapat', l: '📅 Rapat' },
  { v: 'lembur', l: '🌙 Lembur' },
  { v: 'izin', l: '📝 Izin' },
  { v: 'dinas-luar', l: '🚗 Dinas Luar' },
  { v: 'lainnya', l: '📌 Lainnya' },
];
const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

export default function ActivityModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [type, setType] = useState('rapat');
  const [title, setTitle] = useState('');
  const [detail, setDetail] = useState('');
  const [date, setDate] = useState(today());
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');
  const [bukti, setBukti] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  async function submit() {
    if (!title.trim()) return setErr('Judul kegiatan wajib diisi.');
    setBusy(true); setErr('');
    try {
      const fd = new FormData();
      fd.append('type', type);
      fd.append('title', title.trim());
      if (detail.trim()) fd.append('detail', detail.trim());
      fd.append('activityDate', date);
      if (start) fd.append('startTime', start);
      if (end) fd.append('endTime', end);
      if (bukti) fd.append('bukti', bukti);
      await api.post('/activities', fd, { headers: { 'Content-Type': 'multipart/form-data' } });
      onDone(); onClose();
    } catch (e: any) {
      setErr(e?.response?.data?.error || 'Gagal mengajukan kegiatan.');
    } finally { setBusy(false); }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-surface border border-border rounded-xl w-full max-w-md p-5 max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-bold">📋 Ajukan Kegiatan Lain</h3>
          <button type="button" className="text-text2 hover:text-text text-lg leading-none" onClick={onClose}>×</button>
        </div>
        <label className="block text-[11px] text-text2 mb-1">Jenis kegiatan</label>
        <div className="flex flex-wrap gap-1.5 mb-3">
          {TYPES.map((t) => (
            <button key={t.v} type="button" onClick={() => setType(t.v)} className={`px-2.5 py-1 rounded-md text-[11px] border ${type === t.v ? 'border-accent bg-accent/15 text-accent font-semibold' : 'border-border text-text2'}`}>{t.l}</button>
          ))}
        </div>
        <label className="block text-[11px] text-text2 mb-1">Judul *</label>
        <input className="w-full bg-surface2 border border-border rounded-md px-3 py-2 text-xs mb-3" placeholder="mis. Rapat koordinasi shift" value={title} onChange={(e) => setTitle(e.target.value)} />
        <div className="grid grid-cols-3 gap-2 mb-3">
          <div><label className="block text-[11px] text-text2 mb-1">Tanggal *</label><input type="date" className="w-full bg-surface2 border border-border rounded-md px-2 py-2 text-xs" value={date} onChange={(e) => setDate(e.target.value)} /></div>
          <div><label className="block text-[11px] text-text2 mb-1">Mulai</label><input type="time" className="w-full bg-surface2 border border-border rounded-md px-2 py-2 text-xs" value={start} onChange={(e) => setStart(e.target.value)} /></div>
          <div><label className="block text-[11px] text-text2 mb-1">Selesai</label><input type="time" className="w-full bg-surface2 border border-border rounded-md px-2 py-2 text-xs" value={end} onChange={(e) => setEnd(e.target.value)} /></div>
        </div>
        <label className="block text-[11px] text-text2 mb-1">Keterangan</label>
        <textarea className="w-full bg-surface2 border border-border rounded-md px-3 py-2 text-xs mb-3 min-h-[60px]" placeholder="Detail kegiatan (opsional)…" value={detail} onChange={(e) => setDetail(e.target.value)} />
        <label className="block text-[11px] text-text2 mb-1">📎 Bukti Dukung <span className="text-text2/60">(foto/PDF, opsional)</span></label>
        <input
          type="file"
          accept="image/*,application/pdf"
          capture="environment"
          onChange={(e) => setBukti(e.target.files?.[0] || null)}
          className="w-full text-[11px] text-text2 file:mr-2 file:py-1.5 file:px-3 file:rounded-md file:border-0 file:text-xs file:bg-surface2 file:text-text mb-1"
        />
        {bukti && <div className="text-[10px] text-accent2 mb-3">✓ {bukti.name} ({Math.round(bukti.size / 1024)} KB)</div>}
        {!bukti && <div className="mb-3" />}
        {err && <div className="bg-danger/10 border border-danger/30 rounded-md px-3 py-2 text-[11px] text-danger mb-3">⚠️ {err}</div>}
        <div className="text-[10px] text-text2 mb-3">Pengajuan dikirim ke koordinator via WhatsApp untuk disetujui.</div>
        <div className="flex gap-2 justify-end">
          <button type="button" className="border border-border text-text2 rounded-md px-3 py-1.5 text-xs hover:text-text" onClick={onClose} disabled={busy}>Batal</button>
          <button type="button" className="bg-accent text-bg rounded-md px-3 py-1.5 text-xs font-semibold disabled:opacity-50" onClick={submit} disabled={busy}>{busy ? 'Mengirim…' : 'Ajukan'}</button>
        </div>
      </div>
    </div>
  );
}

export function activityStatusBadge(status: string) {
  if (status === 'disetujui') return { c: 'text-success', bg: 'bg-success/15', t: '✓ Disetujui' };
  if (status === 'ditolak') return { c: 'text-danger', bg: 'bg-danger/15', t: '✕ Ditolak' };
  return { c: 'text-warn', bg: 'bg-warn/15', t: '⏳ Menunggu' };
}
