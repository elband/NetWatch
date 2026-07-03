import { useCallback, useEffect, useState } from 'react';
import { api } from '../api/client';
import { confirmDialog } from './dialog';
import type { PhysicalAsset, AssetMetricType, PmPlan, Sparepart } from '../types';

interface UsedPart { sparepart_id: number; qty: string }

export default function PmModal({ asset, metricTypes, onClose, onSaved }: {
  asset: PhysicalAsset; metricTypes: AssetMetricType[]; onClose: () => void; onSaved?: () => void;
}) {
  const cumulative = metricTypes.filter((m) => m.active && m.is_cumulative);
  const [plans, setPlans] = useState<PmPlan[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ name: '', trigger_type: 'hours' as 'hours' | 'calendar', metric_key: cumulative[0]?.metric_key || '', interval_hours: '', interval_days: '', anchor_value: '', anchor_date: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [spareparts, setSpareparts] = useState<Sparepart[]>([]);
  const [doneTarget, setDoneTarget] = useState<PmPlan | null>(null);
  const [doneNote, setDoneNote] = useState('');
  const [usedParts, setUsedParts] = useState<UsedPart[]>([]);

  const load = useCallback(() => {
    api.get(`/aset/${asset.id}/pm`).then((r) => setPlans(r.data.plans || [])).catch(() => setPlans([]));
  }, [asset.id]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { api.get('/spareparts').then((r) => setSpareparts(r.data.spareparts || [])).catch(() => {}); }, []);

  async function add() {
    if (!form.name.trim()) { setError('Nama PM wajib diisi.'); return; }
    setBusy(true); setError('');
    try {
      await api.post(`/aset/${asset.id}/pm`, form);
      setForm({ name: '', trigger_type: 'hours', metric_key: cumulative[0]?.metric_key || '', interval_hours: '', interval_days: '', anchor_value: '', anchor_date: '' });
      setShowForm(false); load(); onSaved?.();
    } catch (e: any) { setError(e?.response?.data?.error || 'Gagal menyimpan PM.'); }
    finally { setBusy(false); }
  }
  function openDone(p: PmPlan) { setDoneTarget(p); setDoneNote(''); setUsedParts([]); }
  async function submitDone() {
    if (!doneTarget) return;
    const parts = usedParts.filter((u) => u.sparepart_id && Number(u.qty) > 0).map((u) => ({ sparepart_id: u.sparepart_id, qty: Number(u.qty) }));
    await api.post(`/aset/pm/${doneTarget.id}/done`, { note: doneNote, parts });
    setDoneTarget(null); load(); onSaved?.();
  }
  async function del(p: PmPlan) {
    if (!await confirmDialog(`Hapus rencana PM "${p.name}"?`)) return;
    await api.delete(`/aset/pm/${p.id}`);
    load();
  }

  const inp = 'w-full bg-surface2 border border-border rounded-md px-2 py-1.5 text-xs outline-none focus:border-accent';

  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-surface border border-border rounded-xl w-full max-w-2xl max-h-[90vh] flex flex-col overflow-hidden" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 pt-5 pb-3 border-b border-border shrink-0">
          <h3 className="text-sm font-bold truncate">🔧 Preventive Maintenance — {asset.name}</h3>
          <button className="text-text2 hover:text-text text-lg" onClick={onClose}>×</button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-3">
          {plans.length === 0 && <div className="text-[12px] text-text2 text-center py-4">Belum ada rencana PM untuk aset ini.</div>}

          {plans.map((p) => {
            const s = p.status || { due: false, kind: p.trigger_type } as any;
            const pct = Math.round((s.progress ?? 0) * 100);
            const barColor = s.due ? 'bg-danger' : pct >= 80 ? 'bg-warn' : 'bg-success';
            return (
              <div key={p.id} className={`border rounded-lg p-3 ${s.due ? 'border-danger/40 bg-danger/5' : 'border-border bg-surface2'}`}>
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <div className="text-sm font-semibold truncate">{p.name} {p.active ? '' : <span className="text-text2 text-[10px]">(nonaktif)</span>}</div>
                    <div className="text-[10px] text-text2">
                      {p.trigger_type === 'hours'
                        ? `Tiap ${Number(p.interval_hours)} ${cumulative.find((m) => m.metric_key === p.metric_key)?.satuan || 'jam'} · anchor ${Number(p.anchor_value)}`
                        : `Tiap ${p.interval_days} hari · sejak ${p.anchor_date}`}
                    </div>
                  </div>
                  {s.due && <span className="shrink-0 text-[10px] px-2 py-0.5 rounded-full border border-danger/40 text-danger bg-danger/10 font-semibold">JATUH TEMPO</span>}
                </div>

                <div className="mt-2 h-1.5 rounded-full bg-border overflow-hidden">
                  <div className={`h-full ${barColor}`} style={{ width: `${Math.min(100, pct)}%` }} />
                </div>
                <div className="text-[10px] text-text2 mt-1">
                  {p.trigger_type === 'hours'
                    ? (s.incomplete ? 'Belum ada pembacaan meter.' : (s.due ? `Terlewat ${Math.abs(Math.round(s.remaining))} jam (kini ${Math.round(s.current)})` : `Sisa ${Math.round(s.remaining)} jam (kini ${Math.round(s.current)} / ${Math.round(s.due_at_value)})`))
                    : (s.incomplete ? 'Interval belum lengkap.' : (s.due ? `Terlewat ${Math.abs(s.remaining_days)} hari` : `Jatuh tempo ${s.due_date} (${s.remaining_days} hari lagi)`))}
                </div>

                <div className="mt-2 flex items-center gap-1.5">
                  <button className="px-2 py-1 rounded-md bg-accent/15 text-accent border border-accent/30 text-[11px] font-medium" onClick={() => openDone(p)}>✔ Tandai Selesai</button>
                  <button className="px-2 py-1 rounded-md border border-border text-danger text-[11px]" onClick={() => del(p)}>🗑️</button>
                  {p.history?.length > 0 && <span className="text-[10px] text-text2 ml-1">Terakhir: {new Date(p.history[0].done_at).toLocaleDateString('id-ID')}</span>}
                </div>
              </div>
            );
          })}

          {!showForm ? (
            <button onClick={() => setShowForm(true)} className="w-full border border-dashed border-border rounded-lg py-2 text-xs text-text2 hover:text-text">+ Tambah Rencana PM</button>
          ) : (
            <div className="border border-border rounded-lg p-3 space-y-2">
              <div className="text-[11px] font-semibold text-text2">Rencana PM baru</div>
              <input className={inp} placeholder="Nama (mis. Ganti oli 250 jam)" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
              <div className="flex gap-1">
                {(['hours', 'calendar'] as const).map((t) => (
                  <button key={t} onClick={() => setForm({ ...form, trigger_type: t })}
                    className={`px-3 py-1 rounded-md text-[11px] border ${form.trigger_type === t ? 'bg-accent text-bg border-accent font-semibold' : 'bg-surface2 text-text2 border-border'}`}>
                    {t === 'hours' ? 'Interval Jam Operasi' : 'Interval Kalender'}
                  </button>
                ))}
              </div>
              {form.trigger_type === 'hours' ? (
                cumulative.length === 0 ? (
                  <div className="text-[11px] text-warn">Belum ada metrik kumulatif (mis. jam operasi). Tambahkan di Master Data → Metrik Aset (centang “Kumulatif”).</div>
                ) : (
                  <div className="grid grid-cols-2 gap-2">
                    <label className="block"><span className="text-[10px] text-text2">Metrik</span>
                      <select className={inp} value={form.metric_key} onChange={(e) => setForm({ ...form, metric_key: e.target.value })}>
                        {cumulative.map((m) => <option key={m.metric_key} value={m.metric_key}>{m.label}</option>)}
                      </select></label>
                    <label className="block"><span className="text-[10px] text-text2">Interval (jam)</span>
                      <input className={inp} inputMode="decimal" placeholder="mis. 250" value={form.interval_hours} onChange={(e) => setForm({ ...form, interval_hours: e.target.value })} /></label>
                    <label className="block col-span-2"><span className="text-[10px] text-text2">Nilai meter saat servis terakhir (opsional, default = pembacaan terkini)</span>
                      <input className={inp} inputMode="decimal" placeholder="anchor" value={form.anchor_value} onChange={(e) => setForm({ ...form, anchor_value: e.target.value })} /></label>
                  </div>
                )
              ) : (
                <div className="grid grid-cols-2 gap-2">
                  <label className="block"><span className="text-[10px] text-text2">Interval (hari)</span>
                    <input className={inp} inputMode="numeric" placeholder="mis. 30" value={form.interval_days} onChange={(e) => setForm({ ...form, interval_days: e.target.value })} /></label>
                  <label className="block"><span className="text-[10px] text-text2">Servis terakhir (opsional, default hari ini)</span>
                    <input type="date" className={inp} value={form.anchor_date} onChange={(e) => setForm({ ...form, anchor_date: e.target.value })} /></label>
                </div>
              )}
              {error && <div className="text-[12px] text-danger">⚠️ {error}</div>}
              <div className="flex gap-2">
                <button onClick={add} disabled={busy} className="bg-accent text-bg font-semibold rounded-md px-3 py-1.5 text-xs disabled:opacity-50">{busy ? 'Menyimpan…' : '+ Simpan'}</button>
                <button onClick={() => { setShowForm(false); setError(''); }} className="border border-border text-text2 rounded-md px-3 py-1.5 text-xs">Batal</button>
              </div>
            </div>
          )}
        </div>

        {doneTarget && (
          <div className="border-t border-border p-4 bg-surface2 shrink-0">
            <div className="text-[12px] font-semibold mb-2">Selesaikan: {doneTarget.name}</div>
            <input className={`${inp} mb-2`} placeholder="Catatan (opsional)" value={doneNote} onChange={(e) => setDoneNote(e.target.value)} />
            <div className="text-[10px] text-text2 mb-1">Sparepart terpakai (opsional — stok otomatis berkurang):</div>
            <div className="space-y-1.5">
              {usedParts.map((u, i) => (
                <div key={i} className="flex gap-1.5">
                  <select className={inp} value={u.sparepart_id || ''} onChange={(e) => setUsedParts((p) => p.map((x, j) => (j === i ? { ...x, sparepart_id: Number(e.target.value) } : x)))}>
                    <option value="">— pilih sparepart —</option>
                    {spareparts.map((s) => <option key={s.id} value={s.id}>{s.name} (stok {Number(s.stock_qty)} {s.satuan})</option>)}
                  </select>
                  <input className={`${inp} w-20`} inputMode="decimal" placeholder="qty" value={u.qty} onChange={(e) => setUsedParts((p) => p.map((x, j) => (j === i ? { ...x, qty: e.target.value } : x)))} />
                  <button className="px-2 text-danger" onClick={() => setUsedParts((p) => p.filter((_, j) => j !== i))}>✕</button>
                </div>
              ))}
            </div>
            {spareparts.length > 0 && <button className="text-[11px] text-accent mt-1.5" onClick={() => setUsedParts((p) => [...p, { sparepart_id: 0, qty: '' }])}>+ tambah sparepart</button>}
            <div className="flex gap-2 mt-3">
              <button onClick={submitDone} className="bg-accent text-bg font-semibold rounded-md px-3 py-1.5 text-xs">✔ Konfirmasi Selesai</button>
              <button onClick={() => setDoneTarget(null)} className="border border-border text-text2 rounded-md px-3 py-1.5 text-xs">Batal</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
