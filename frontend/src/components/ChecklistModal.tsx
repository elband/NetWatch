import { useCallback, useEffect, useState } from 'react';
import { api } from '../api/client';
import type { PhysicalAsset, ChecklistTemplate, ChecklistRun, ChecklistResult } from '../types';

const RESULTS: { key: ChecklistResult; label: string; cls: string }[] = [
  { key: 'ok', label: 'OK', cls: 'text-success' },
  { key: 'tidak', label: 'Tidak', cls: 'text-danger' },
  { key: 'na', label: 'N/A', cls: 'text-text2' },
];
const OVERALL: Record<string, string> = { baik: '🟢 Baik', perhatian: '🟡 Perhatian', rusak: '🔴 Rusak' };

interface ItemState { label: string; result: ChecklistResult; note: string }

export default function ChecklistModal({ asset, onClose, onSaved }: { asset: PhysicalAsset; onClose: () => void; onSaved?: () => void }) {
  const [templates, setTemplates] = useState<ChecklistTemplate[]>([]);
  const [runs, setRuns] = useState<ChecklistRun[]>([]);
  const [tplId, setTplId] = useState<number | null>(null);
  const [items, setItems] = useState<ItemState[]>([]);
  const [overall, setOverall] = useState<'baik' | 'perhatian' | 'rusak'>('baik');
  const [note, setNote] = useState('');
  const [photo, setPhoto] = useState<File | null>(null);
  const [createIncident, setCreateIncident] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(() => {
    api.get(`/aset/${asset.id}/checklist`).then((r) => {
      const tpls: ChecklistTemplate[] = r.data.templates || [];
      setTemplates(tpls); setRuns(r.data.runs || []);
      setTplId((cur) => {
        if (cur != null) return cur;
        if (tpls.length) { setItems((tpls[0].items || []).map((i) => ({ label: i.label, result: 'ok', note: '' }))); return tpls[0].id; }
        return null;
      });
    }).catch(() => {});
  }, [asset.id]);
  useEffect(() => { load(); }, [load]);

  function pickTemplate(t: ChecklistTemplate) {
    setTplId(t.id);
    setItems((t.items || []).map((i) => ({ label: i.label, result: 'ok', note: '' })));
  }
  function setItem(idx: number, patch: Partial<ItemState>) {
    setItems((prev) => prev.map((it, i) => (i === idx ? { ...it, ...patch } : it)));
  }

  async function save() {
    setBusy(true); setError('');
    try {
      const fd = new FormData();
      if (tplId) fd.append('template_id', String(tplId));
      fd.append('overall', overall);
      if (note.trim()) fd.append('note', note.trim());
      fd.append('items', JSON.stringify(items));
      if (overall === 'rusak' && createIncident) fd.append('create_incident', '1');
      if (photo) fd.append('photo', photo);
      const r = await api.post(`/aset/${asset.id}/checklist`, fd, { headers: { 'Content-Type': 'multipart/form-data' } });
      setNote(''); setPhoto(null); setOverall('baik');
      const t = templates.find((x) => x.id === tplId); if (t) pickTemplate(t);
      load(); onSaved?.();
      setError(r.data.incidentId ? `✅ Tersimpan. Insiden ${r.data.incidentId} dibuat.` : '✅ Checklist tersimpan.');
    } catch (e: any) { setError(e?.response?.data?.error || 'Gagal menyimpan checklist.'); }
    finally { setBusy(false); }
  }

  const inp = 'w-full bg-surface2 border border-border rounded-md px-2 py-1.5 text-xs outline-none focus:border-accent';

  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-surface border border-border rounded-xl w-full max-w-2xl max-h-[90vh] flex flex-col overflow-hidden" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 pt-5 pb-3 border-b border-border shrink-0">
          <h3 className="text-sm font-bold truncate">✅ Checklist Inspeksi — {asset.name}</h3>
          <button className="text-text2 hover:text-text text-lg" onClick={onClose}>×</button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
          {templates.length === 0 ? (
            <div className="text-[12px] text-text2 bg-surface2 border border-border rounded-md px-3 py-4 text-center">
              Belum ada template checklist untuk unit ini. Buat di <b>Master Data → Checklist</b>.
            </div>
          ) : (
            <>
              <div className="flex flex-wrap gap-1">
                {templates.map((t) => (
                  <button key={t.id} onClick={() => pickTemplate(t)}
                    className={`px-3 py-1 rounded-md text-[11px] border ${tplId === t.id ? 'bg-accent text-bg border-accent font-semibold' : 'bg-surface2 text-text2 border-border'}`}>
                    {t.name}
                  </button>
                ))}
              </div>

              <div className="space-y-1.5">
                {items.map((it, idx) => (
                  <div key={idx} className="bg-surface2 border border-border rounded-md p-2">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-medium">{it.label}</span>
                      <div className="flex gap-1 shrink-0">
                        {RESULTS.map((r) => (
                          <button key={r.key} onClick={() => setItem(idx, { result: r.key })}
                            className={`px-2 py-0.5 rounded text-[10px] border ${it.result === r.key ? `bg-surface border-accent ${r.cls} font-semibold` : 'bg-surface border-border text-text2'}`}>
                            {r.label}
                          </button>
                        ))}
                      </div>
                    </div>
                    {it.result === 'tidak' && (
                      <input className={`${inp} mt-1.5`} placeholder="Catatan masalah…" value={it.note} onChange={(e) => setItem(idx, { note: e.target.value })} />
                    )}
                  </div>
                ))}
                {items.length === 0 && <div className="text-[11px] text-text2 text-center py-3">Template ini belum punya item.</div>}
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 border-t border-border pt-3">
                <label className="block"><span className="text-[10px] text-text2">Hasil keseluruhan</span>
                  <select className={inp} value={overall} onChange={(e) => setOverall(e.target.value as 'baik' | 'perhatian' | 'rusak')}>
                    {Object.entries(OVERALL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                  </select></label>
                <label className="block"><span className="text-[10px] text-text2">Foto bukti (opsional)</span>
                  <input type="file" accept="image/*" capture="environment" className="block w-full text-[11px] text-text2 file:mr-2 file:rounded file:border-0 file:bg-surface2 file:px-2 file:py-1 file:text-text2" onChange={(e) => setPhoto(e.target.files?.[0] || null)} /></label>
                <label className="block sm:col-span-2"><span className="text-[10px] text-text2">Catatan</span>
                  <input className={inp} placeholder="Catatan inspeksi (opsional)" value={note} onChange={(e) => setNote(e.target.value)} /></label>
                {overall === 'rusak' && (
                  <label className="flex items-center gap-2 text-[11px] text-warn sm:col-span-2">
                    <input type="checkbox" checked={createIncident} onChange={(e) => setCreateIncident(e.target.checked)} />
                    Set status aset “Rusak” &amp; buat tiket insiden otomatis
                  </label>
                )}
              </div>
              {error && <div className={`text-[12px] ${error.startsWith('✅') ? 'text-success' : 'text-danger'}`}>{error}</div>}
              <button onClick={save} disabled={busy} className="bg-accent text-bg font-semibold rounded-md px-4 py-2 text-sm disabled:opacity-50">{busy ? 'Menyimpan…' : '+ Simpan Checklist'}</button>

              {runs.length > 0 && (
                <div className="border-t border-border pt-3">
                  <div className="text-[11px] font-semibold text-text2 mb-2">Riwayat inspeksi</div>
                  <div className="space-y-1.5">
                    {runs.map((run) => (
                      <div key={run.id} className="bg-surface2 border border-border rounded-md px-3 py-2 text-[11px]">
                        <div className="flex items-center justify-between">
                          <span>{new Date(run.created_at).toLocaleString('id-ID')} · {run.done_by_name || '—'}</span>
                          <span>{OVERALL[run.overall]}</span>
                        </div>
                        {run.items.some((i) => i.result === 'tidak') && (
                          <div className="text-danger mt-1">⚠ {run.items.filter((i) => i.result === 'tidak').map((i) => i.label).join(', ')}</div>
                        )}
                        {run.note && <div className="text-text2 mt-0.5">{run.note}</div>}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
