import { useEffect, useState } from 'react';
import { api } from '../api/client';
import type { Incident } from '../types';

// Modal "Kerjakan Bersama": pemilik job (atau koordinator/admin) mengajak teknisi
// lain — yang diajak diberi tahu (WA + notifikasi) & bisa melihat insiden.
export default function InviteCollabModal({ incident, onClose, onDone }: { incident: Incident; onClose: () => void; onDone?: (inc: Incident) => void }) {
  const [techs, setTechs] = useState<{ id: number; name: string; emoji: string | null }[]>([]);
  const [sel, setSel] = useState<number[]>([]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const already = new Set((incident.collaborators || []).map((c) => c.user_id));

  useEffect(() => { api.get('/incidents/teknisi-list').then((r) => setTechs(r.data.teknisi || [])).catch(() => {}); }, []);
  const toggle = (id: number) => setSel((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));

  async function submit() {
    if (!sel.length) { setMsg('Pilih minimal satu teknisi.'); return; }
    setBusy(true); setMsg('');
    try {
      const r = await api.post(`/incidents/${incident.id}/collaborators`, { techIds: sel });
      setMsg(`${r.data.invited} teknisi diajak — notifikasi WA & sistem terkirim.`);
      onDone?.(r.data.incident);
      setTimeout(onClose, 1000);
    } catch (e: any) { setMsg(e?.response?.data?.error || 'Gagal mengajak teknisi.'); }
    finally { setBusy(false); }
  }

  const candidates = techs.filter((t) => t.id !== incident.tech_id);
  return (
    <div className="fixed inset-0 z-[210] bg-black/60 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-surface border border-border rounded-xl w-full max-w-sm p-5 max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-1"><h3 className="text-sm font-bold">👥 Ajak Kerjakan Bersama</h3><button onClick={onClose} className="text-text2 hover:text-text text-lg leading-none">×</button></div>
        <div className="text-[11px] text-text2 mb-3">{incident.id} · {incident.device_name}. Teknisi yang diajak akan <b>diberi tahu (WA + notifikasi)</b> dan bisa melihat insiden ini.</div>
        <div className="max-h-[46vh] overflow-y-auto -mx-1 px-1">
          {candidates.length === 0 && <div className="text-text2 text-xs py-4 text-center">Tidak ada teknisi lain.</div>}
          {candidates.map((t) => {
            const done = already.has(t.id);
            return (
              <label key={t.id} className={`flex items-center gap-2.5 px-2 py-2 rounded-md text-xs ${done ? 'opacity-50' : 'hover:bg-white/5 cursor-pointer'}`}>
                <input type="checkbox" disabled={done} checked={done || sel.includes(t.id)} onChange={() => toggle(t.id)} />
                <span>{t.emoji} {t.name}</span>
                {done && <span className="ml-auto text-[10px] text-success">✓ sudah diajak</span>}
              </label>
            );
          })}
        </div>
        {msg && <div className="text-[11px] text-accent2 mt-2">{msg}</div>}
        <div className="flex gap-2 justify-end mt-3">
          <button className="border border-border text-text2 rounded-md px-3 py-1.5 text-xs" onClick={onClose} disabled={busy}>Tutup</button>
          <button className="bg-accent text-bg rounded-md px-3 py-1.5 text-xs font-semibold disabled:opacity-50" onClick={submit} disabled={busy || !sel.length}>{busy ? '…' : 'Ajak & Beri Tahu'}</button>
        </div>
      </div>
    </div>
  );
}
