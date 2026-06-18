import { useEffect, useState } from 'react';
import { api } from '../api/client';
import { IncidentStatusBadge, PriorityBadge } from '../components/StatusBadge';
import IncidentReportModal from '../components/IncidentReportModal';
import ProgressUpdateModal from '../components/ProgressUpdateModal';
import { downtimeMs, fmtDowntime, downtimeColor } from '../utils/downtime';
import { stepLabels as stepLabelsFor, maxStep as maxStepFor } from '../utils/steps';
import type { Incident } from '../types';

export default function Incidents() {
  const [incidents, setIncidents] = useState<Incident[]>([]);
  const [filter, setFilter] = useState('all');
  const [selected, setSelected] = useState<Incident | null>(null);
  const [reportFor, setReportFor] = useState<Incident | null>(null);
  const [progressFor, setProgressFor] = useState<Incident | null>(null);
  const [now, setNow] = useState(() => Date.now());

  function load() {
    api.get('/incidents').then((res) => {
      setIncidents(res.data.incidents);
      setSelected((cur) => (cur ? res.data.incidents.find((i: Incident) => i.id === cur.id) || null : cur));
    });
  }
  useEffect(load, []);
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30000);
    return () => clearInterval(t);
  }, []);

  async function resolve(id: string) {
    await api.post(`/incidents/${id}/resolve`);
    load();
    setSelected(null);
  }

  const filtered = filter === 'all' ? incidents : incidents.filter((i) => i.status === filter);
  const stepLabels = selected ? stepLabelsFor(selected) : [];
  const maxStep = selected ? maxStepFor(selected) : 0;

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <div>
          <div className="text-[17px] font-bold">🚨 Manajemen Insiden</div>
          <div className="text-[11px] text-text2 mt-0.5">{incidents.filter((i) => i.status !== 'selesai').length} insiden aktif</div>
        </div>
        <select className="bg-surface2 border border-border rounded-md px-3 py-2 text-xs" value={filter} onChange={(e) => setFilter(e.target.value)}>
          <option value="all">Semua</option><option value="aktif">Aktif</option><option value="proses">Dalam Proses</option><option value="selesai">Selesai</option>
        </select>
      </div>
      <div className="bg-surface border border-border rounded-[10px] overflow-x-auto">
        <table className="w-full text-xs">
          <thead><tr className="text-text2 uppercase text-[10px] border-b border-border">
            {['ID', 'Perangkat', 'Masalah', 'Prioritas', 'Terputus', 'Waktu', 'Status', 'Aksi'].map((h) => <th key={h} className="px-3.5 py-2.5 text-left">{h}</th>)}
          </tr></thead>
          <tbody>
            {filtered.map((i) => (
              <tr key={i.id} className="border-b border-border/50">
                <td className="px-3.5 py-2.5 font-mono text-accent2 text-[10px]">{i.id}</td>
                <td className="px-3.5 py-2.5"><strong>{i.device_name}</strong><br /><span className="text-[10px] text-text2 font-mono">{i.ip}</span></td>
                <td className="px-3.5 py-2.5 text-text2 max-w-[160px]">{i.issue}</td>
                <td className="px-3.5 py-2.5"><PriorityBadge priority={i.priority} /></td>
                <td className={`px-3.5 py-2.5 font-mono font-semibold ${downtimeColor(i, downtimeMs(i, now))}`}>⏱️ {fmtDowntime(downtimeMs(i, now))}</td>
                <td className="px-3.5 py-2.5 text-text2 font-mono text-[10px]">{i.created_at}</td>
                <td className="px-3.5 py-2.5"><IncidentStatusBadge status={i.status} /></td>
                <td className="px-3.5 py-2.5">
                  <div className="flex gap-1.5">
                    <button className="text-text2 hover:text-white border border-border rounded px-2 py-0.5" onClick={() => setSelected(i)}>Detail →</button>
                    <button className={`border rounded px-2 py-0.5 ${i.report ? 'text-success border-success/40' : 'text-accent2 border-accent2/40'}`} onClick={() => setReportFor(i)}>
                      {i.report ? '📝 Laporan ✓' : '📝 Laporan'}
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {selected && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-[200]" onClick={() => setSelected(null)}>
          <div className="bg-surface border border-border rounded-xl p-6 w-[560px] max-w-[95vw] max-h-[85vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="flex justify-between items-center mb-4">
              <span className="text-[15px] font-bold">{selected.id} — {selected.device_name}</span>
              <button onClick={() => setSelected(null)} className="text-text2 hover:text-white">✕</button>
            </div>
            <div className="flex gap-2 items-center mb-3.5 flex-wrap">
              <PriorityBadge priority={selected.priority} />
              <IncidentStatusBadge status={selected.status} />
              <span className="text-[11px] text-text2">{selected.created_at}</span>
            </div>
            <div className="bg-surface2 border border-border rounded-lg p-3 mb-3.5 text-xs">
              <strong>Masalah:</strong> {selected.issue}<br />
              <span className="text-text2">IP: {selected.ip || '-'}</span><br />
              <span className={downtimeColor(selected, downtimeMs(selected, now))}>
                ⏱️ Jam terputus: <strong>{fmtDowntime(downtimeMs(selected, now))}</strong>{selected.status !== 'selesai' && ' (berjalan)'}
              </span>
              {selected.resolved_at && <><br /><span className="text-success">Selesai: {selected.resolved_at} · Durasi: {selected.duration_min} menit</span></>}
            </div>
            <div className="flex gap-1 mb-1.5">
              {stepLabels.slice(1).map((_, idx) => (
                <div key={idx} className={`flex-1 h-1.5 rounded ${idx + 1 < selected.step ? 'bg-success' : idx + 1 === selected.step ? 'bg-warn' : 'bg-border'}`} />
              ))}
            </div>
            <div className="text-[10px] text-text2 mb-3.5">Langkah {selected.step}/{maxStep} — {stepLabels[selected.step]}</div>
            <div className="text-xs font-semibold mb-2">📋 Kronologi</div>
            <div className="border-l-2 border-border pl-3.5 mb-3.5">
              {selected.notes.map((n) => (
                <div key={n.id} className="mb-2.5">
                  <div className="text-[10px] text-accent font-mono">{n.created_at} · {stepLabels[n.step] || `Step ${n.step}`}</div>
                  <div className="text-[11px] text-text2">{n.note}</div>
                  {n.doc_url && (
                    <a href={n.doc_url} target="_blank" rel="noreferrer" className="inline-block mt-1">
                      <img src={n.doc_url} alt="dokumentasi" className="max-h-24 rounded border border-border object-contain" />
                    </a>
                  )}
                </div>
              ))}
            </div>
            <div className="flex gap-2 flex-wrap">
              {selected.status !== 'selesai' && (
                <>
                  <button className="bg-accent text-bg rounded-md px-3 py-1.5 text-xs font-medium" onClick={() => setProgressFor(selected)}>▶ {stepLabels[Math.min(selected.step + 1, maxStep)]}</button>
                  <button className="bg-success/10 text-success border border-success/30 rounded-md px-3 py-1.5 text-xs font-medium" onClick={() => resolve(selected.id)}>✅ Tutup Insiden</button>
                </>
              )}
              <button className="bg-accent2/10 text-accent2 border border-accent2/30 rounded-md px-3 py-1.5 text-xs font-medium" onClick={() => setReportFor(selected)}>
                {selected.report ? '📝 Lihat/Edit Laporan' : '📝 Laporan Kerusakan & Perbaikan'}
              </button>
            </div>
          </div>
        </div>
      )}

      {reportFor && (
        <IncidentReportModal
          incident={reportFor}
          onClose={() => setReportFor(null)}
          onSaved={(report) => {
            setIncidents((prev) => prev.map((i) => (i.id === reportFor.id ? { ...i, report } : i)));
            setSelected((s) => (s && s.id === reportFor.id ? { ...s, report } : s));
          }}
        />
      )}

      {progressFor && (
        <ProgressUpdateModal
          incident={progressFor}
          onClose={() => setProgressFor(null)}
          onDone={load}
        />
      )}
    </div>
  );
}
