import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api/client';
import { hasIp } from '../utils/steps';
import type { Incident } from '../types';

// Definisi tindakan. `key` = nilai dikirim ke backend (action).
interface ActionDef { id: string; key: string; label: string; desc: string; final?: boolean; ssh?: boolean }
const ACTIONS: Record<string, ActionDef> = {
  ssh: { id: 'ssh', key: 'ssh', label: '💻 Coba Lewat SSH', desc: 'Coba atasi dari jarak jauh via SSH terlebih dulu.', ssh: true },
  visit: { id: 'visit', key: 'visit', label: '📍 Visit ke Perangkat', desc: 'Datang langsung ke lokasi perangkat (unggah dokumentasi).' },
  analisa: { id: 'analisa', key: 'analisa', label: '🔧 Analisa Kerusakan', desc: 'Analisa & dokumentasikan penanganan kerusakan.' },
  awaiting: { id: 'awaiting', key: 'awaiting', label: '📦 Menunggu Suku Cadang', desc: 'Tunda — menunggu sparepart. Insiden tetap terbuka, koordinator diberi tahu.' },
  resolve_ssh: { id: 'resolve_ssh', key: 'resolve', label: '✅ Teratasi via SSH (Selesai)', desc: 'Masalah beres dari remote, tutup insiden.', final: true },
  resolve_fixed: { id: 'resolve_fixed', key: 'resolve', label: '✅ Selesai – Peralatan Normal Kembali', desc: 'Perbaikan selesai & peralatan normal, tutup insiden.', final: true },
};

// Pilihan tindakan berdasarkan tahap insiden + ketersediaan IP.
function actionsFor(inc: Incident): ActionDef[] {
  if (inc.status === 'selesai') return [];
  const s = inc.step || 0;
  if (s === 0) return hasIp(inc.ip) ? [ACTIONS.ssh] : [ACTIONS.visit];
  if (s === 1) return [ACTIONS.resolve_ssh, ACTIONS.visit];   // setelah SSH dicoba
  if (s === 2) return [ACTIONS.analisa];                      // setelah visit
  return inc.awaiting_part ? [ACTIONS.resolve_fixed] : [ACTIONS.awaiting, ACTIONS.resolve_fixed]; // setelah analisa
}

export default function ProgressUpdateModal({ incident, onClose, onDone }: { incident: Incident; onClose: () => void; onDone: () => void }) {
  const options = actionsFor(incident);
  const [selId, setSelId] = useState(options[0]?.id || '');
  const sel = options.find((o) => o.id === selId) || options[0];
  const [note, setNote] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  function pick(f: File | null) {
    setFile(f); setErr('');
    setPreview(f ? URL.createObjectURL(f) : null);
  }

  async function submit() {
    if (!sel) return;
    if (!file) return setErr('Dokumentasi (foto) wajib diunggah.');
    if (!note.trim()) return setErr('Penjelasan tindakan wajib diisi.');
    setBusy(true); setErr('');
    try {
      const fd = new FormData();
      fd.append('action', sel.key);
      fd.append('note', note.trim());
      fd.append('doc', file);
      await api.post(`/incidents/${incident.id}/advance`, fd, { headers: { 'Content-Type': 'multipart/form-data' } });
      onDone();
      onClose();
    } catch (e: any) {
      setErr(e?.response?.data?.error || 'Gagal menyimpan tindakan.');
    } finally { setBusy(false); }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-surface border border-border rounded-xl w-full max-w-md max-h-[90vh] overflow-y-auto p-5" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-1">
          <h3 className="text-sm font-bold">Tindakan · {incident.device_name}</h3>
          <button type="button" className="text-text2 hover:text-text text-lg leading-none" onClick={onClose}>×</button>
        </div>
        <p className="text-[11px] text-text2 mb-3">Pilih tindakan yang dilakukan{!hasIp(incident.ip) && ' (perangkat tanpa IP — langsung visit)'}:</p>

        {options.length === 0 ? (
          <div className="text-success text-xs py-4 text-center">✅ Insiden sudah selesai.</div>
        ) : (
          <>
            <div className="space-y-2 mb-3">
              {options.map((o) => (
                <label key={o.id} className={`flex items-start gap-2 border rounded-lg p-2.5 cursor-pointer ${selId === o.id ? (o.final ? 'border-success/50 bg-success/10' : 'border-accent/50 bg-accent/10') : 'border-border'}`}>
                  <input type="radio" name="act" className="mt-0.5" checked={selId === o.id} onChange={() => { setSelId(o.id); setErr(''); }} />
                  <div>
                    <div className="text-xs font-semibold">{o.label}</div>
                    <div className="text-[10px] text-text2">{o.desc}</div>
                  </div>
                </label>
              ))}
            </div>

            {sel?.ssh && (
              <div className="bg-accent2/10 border border-accent2/30 rounded-md px-3 py-2 mb-3 text-[11px] text-accent2 flex items-center justify-between gap-2">
                <span>Remote dulu, lalu unggah tangkapan layar sesi sebagai dokumentasi.</span>
                {incident.device_id && <Link to={`/ssh?device=${incident.device_id}&incident=${incident.id}`} target="_blank" className="border border-accent2/40 rounded px-2 py-1 font-semibold whitespace-nowrap hover:bg-accent2/10">🖥️ Buka SSH</Link>}
              </div>
            )}

            <label className="block text-[11px] text-text2 mb-1">Foto dokumentasi <span className="text-danger">*</span></label>
            <input type="file" accept="image/*" capture="environment" className="block w-full text-[11px] text-text2 mb-1 file:mr-3 file:py-1.5 file:px-3 file:rounded file:border-0 file:bg-accent file:text-bg file:text-[11px] file:font-semibold" onChange={(e) => pick(e.target.files?.[0] || null)} />
            {preview && <img src={preview} alt="preview" className="mt-1 mb-2 max-h-36 rounded border border-border object-contain" />}

            <label className="block text-[11px] text-text2 mb-1 mt-2">Penjelasan <span className="text-danger">*</span></label>
            <textarea className="w-full bg-surface2 border border-border rounded-md px-3 py-2 text-xs mb-3 min-h-[70px]" placeholder="Jelaskan tindakan / hasilnya…" value={note} onChange={(e) => setNote(e.target.value)} />

            {err && <div className="bg-danger/10 border border-danger/30 rounded-md px-3 py-2 text-[11px] text-danger mb-3">⚠️ {err}</div>}

            <div className="flex gap-2 justify-end">
              <button type="button" className="border border-border text-text2 rounded-md px-3 py-1.5 text-xs hover:text-text" onClick={onClose} disabled={busy}>Batal</button>
              <button type="button" className={`rounded-md px-3 py-1.5 text-xs font-semibold text-bg disabled:opacity-50 ${sel?.final ? 'bg-success' : 'bg-accent'}`} onClick={submit} disabled={busy}>{busy ? 'Menyimpan…' : sel?.final ? '✅ Selesaikan' : 'Simpan Tindakan'}</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
