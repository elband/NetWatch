import { useEffect, useState } from 'react';
import { api } from '../api/client';
import { downtimeMs, fmtDowntime } from '../utils/downtime';
import { confirmDialog } from './dialog';
import type { Incident } from '../types';

// Papan Kanban insiden — tarik-geser antar kolom Baru (Pool) → Diproses → Selesai.
// Transisi memanggil aksi backend yang sesuai (assign / lepas ke pool / resolve).
type Col = 'baru' | 'proses' | 'selesai';
const COLS: { key: Col; label: string; icon: string }[] = [
  { key: 'baru', label: 'Baru (Pool)', icon: '📥' },
  { key: 'proses', label: 'Diproses', icon: '🔧' },
  { key: 'selesai', label: 'Selesai', icon: '✅' },
];
const colOf = (i: Incident): Col => (i.status === 'selesai' ? 'selesai' : i.tech_id ? 'proses' : 'baru');
const prioBorder = (p: string) => (p === 'kritis' ? 'var(--color-danger)' : p === 'tinggi' ? 'var(--color-warn)' : 'var(--color-border)');

export default function IncidentKanban({ incidents, now, onChanged, onOpen, onToast }: {
  incidents: Incident[]; now: number; onChanged: () => void; onOpen: (i: Incident) => void; onToast: (m: string) => void;
}) {
  const [techs, setTechs] = useState<{ id: number; name: string; emoji?: string | null }[]>([]);
  const [dragId, setDragId] = useState<string | null>(null);
  const [overCol, setOverCol] = useState<Col | null>(null);
  const [assignFor, setAssignFor] = useState<Incident | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => { api.get('/incidents/teknisi-list').then((r) => setTechs(r.data.teknisi || [])).catch(() => {}); }, []);

  async function assign(inc: Incident, techId: number | null) {
    setBusy(true);
    try {
      await api.post(`/incidents/${inc.id}/assign`, { techId });
      onToast(techId ? 'Insiden ditugaskan — notifikasi terkirim ke teknisi.' : 'Insiden dikembalikan ke pool.');
      onChanged();
    } catch (e: any) { onToast(e?.response?.data?.error || 'Gagal menugaskan insiden.'); }
    finally { setBusy(false); setAssignFor(null); }
  }

  async function handleDrop(target: Col, e: React.DragEvent) {
    setOverCol(null);
    const id = e.dataTransfer.getData('text/plain') || dragId;
    setDragId(null);
    const inc = incidents.find((i) => i.id === id);
    if (!inc) return;
    const from = colOf(inc);
    if (from === target) return;
    if (target === 'proses' && from === 'baru') setAssignFor(inc);
    else if (target === 'baru' && from === 'proses') {
      if (await confirmDialog({ title: 'Kembalikan ke pool?', message: `${inc.id} akan dilepas dari ${inc.tech_name || 'teknisi'} dan kembali ke pool.`, confirmText: 'Ya, lepas' })) assign(inc, null);
    } else if (target === 'selesai') {
      // Menutup insiden wajib melampirkan foto bukti → arahkan langsung ke detail
      // (tanpa panggilan gagal). Penyelesaian dilakukan dari modal detail insiden.
      onToast('Unggah foto bukti lalu tutup insiden dari detail.');
      onOpen(inc);
    }
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-3 items-start">
      {COLS.map((c) => {
        const items = incidents.filter((i) => colOf(i) === c.key);
        return (
          <div
            key={c.key}
            onDragOver={(e) => { e.preventDefault(); setOverCol(c.key); }}
            onDragLeave={() => setOverCol((o) => (o === c.key ? null : o))}
            onDrop={(e) => handleDrop(c.key, e)}
            className={`rounded-xl border p-2.5 min-h-[220px] transition-colors ${overCol === c.key ? 'border-accent bg-accent/5' : 'border-border bg-surface2/40'}`}
          >
            <div className="flex items-center justify-between px-1 mb-2">
              <span className="text-[12px] font-bold flex items-center gap-1.5">{c.icon} {c.label}</span>
              <span className="text-[10px] text-text2 bg-surface border border-border rounded-full px-2 py-0.5">{items.length}</span>
            </div>
            <div className="space-y-2">
              {items.length === 0 ? (
                <div className="text-center text-[11px] text-text2 py-8">{c.key === 'baru' ? 'Pool kosong' : '—'}</div>
              ) : items.map((i) => (
                <div
                  key={i.id}
                  draggable={!busy && i.status !== 'selesai'}
                  onDragStart={(e) => { setDragId(i.id); e.dataTransfer.setData('text/plain', i.id); e.dataTransfer.effectAllowed = 'move'; }}
                  onDragEnd={() => { setDragId(null); setOverCol(null); }}
                  onClick={() => onOpen(i)}
                  className={`bg-surface border rounded-lg p-2.5 cursor-pointer hover:border-accent/50 transition-all ${dragId === i.id ? 'opacity-40' : ''} ${i.status !== 'selesai' ? 'active:scale-[0.98]' : ''}`}
                  style={{ borderLeft: `3px solid ${prioBorder(i.priority)}` }}
                  title={i.status !== 'selesai' ? 'Seret ke kolom lain, atau klik untuk detail' : 'Klik untuk detail'}
                >
                  <div className="flex items-center justify-between gap-2 mb-1">
                    <span className="font-mono text-[10px] text-text2">{i.id}</span>
                    <span className={`text-[9px] px-1.5 py-0.5 rounded font-bold uppercase ${i.priority === 'kritis' ? 'bg-danger/15 text-danger' : i.priority === 'tinggi' ? 'bg-warn/15 text-warn' : 'bg-success/15 text-success'}`}>{i.priority}</span>
                  </div>
                  <div className="text-xs font-semibold truncate">{i.device_name}</div>
                  <div className="text-[10px] text-text2 truncate">{i.issue}</div>
                  <div className="flex items-center justify-between mt-1.5 text-[10px]">
                    <span className="text-text2 truncate">{i.tech_id ? `👤 ${i.tech_name || 'Teknisi'}` : '📥 Pool'}</span>
                    {i.status !== 'selesai' && <span className="font-mono text-text2 flex-shrink-0">⏱ {fmtDowntime(downtimeMs(i, now))}</span>}
                  </div>
                </div>
              ))}
            </div>
          </div>
        );
      })}

      {/* Modal pilih teknisi saat assign (Baru → Diproses) */}
      {assignFor && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4" onClick={() => setAssignFor(null)}>
          <div className="bg-surface border border-border rounded-xl w-full max-w-sm p-5" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-1">
              <h3 className="text-sm font-bold">🎯 Tugaskan ke Teknisi</h3>
              <button onClick={() => setAssignFor(null)} className="text-text2 hover:text-text text-xl leading-none">×</button>
            </div>
            <div className="text-[11px] text-text2 mb-3">{assignFor.id} · {assignFor.device_name}</div>
            {techs.length === 0 ? (
              <div className="text-xs text-text2 py-3 text-center">Belum ada teknisi terdaftar.</div>
            ) : (
              <div className="space-y-1.5 max-h-[50vh] overflow-y-auto">
                {techs.map((t) => (
                  <button key={t.id} disabled={busy} onClick={() => assign(assignFor, t.id)} className="w-full text-left border border-border rounded-lg px-3 py-2 text-xs hover:border-accent/50 hover:bg-accent/5 disabled:opacity-50">
                    {t.emoji || '🔧'} {t.name}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
