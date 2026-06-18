import { useEffect, useState } from 'react';
import { api } from '../api/client';

interface Component { label: string; detail: string; value: number }
interface Breakdown {
  name: string;
  jabatan: string | null;
  month: string | null;
  slaMinutes: number;
  raw: number;
  score: number;
  clamped: boolean;
  components: Component[];
  logs: {
    done: Array<{ id: string; device_name: string; resolved_at: string; duration_min: number | null; priority: string }>;
    taken: Array<{ id: string; device_name: string; created_at: string; taken_at: string; resp: number | null }>;
    breaches: Array<{ id: string; device_name: string; created_at: string; taken_at: string | null; mins: number }>;
  };
}

const fmtDur = (m: number | null) => (m == null ? '-' : m >= 60 ? `${Math.floor(m / 60)}j ${m % 60}m` : `${m}m`);

export default function PerformaDetailModal({ techId, month, onClose }: { techId: number; month?: string; onClose: () => void }) {
  const [data, setData] = useState<Breakdown | null>(null);
  const [err, setErr] = useState('');
  const [tab, setTab] = useState<'done' | 'taken' | 'breaches'>('done');

  useEffect(() => {
    const q = new URLSearchParams();
    q.set('techId', String(techId));
    if (month) q.set('month', month);
    api.get(`/performa/breakdown?${q.toString()}`).then((r) => setData(r.data)).catch((e) => setErr(e?.response?.data?.error || 'Gagal memuat rincian.'));
  }, [techId, month]);

  const sign = (v: number) => (v > 0 ? `+${v}` : `${v}`);
  const monthLabel = data?.month ? new Date(data.month + '-01').toLocaleDateString('id-ID', { month: 'long', year: 'numeric' }) : 'Semua waktu';

  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-surface border border-border rounded-xl w-full max-w-2xl max-h-[88vh] overflow-y-auto p-5" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-bold">🔍 Rincian Perhitungan Skor {data && `· ${data.name}`}</h3>
          <button className="text-text2 hover:text-white text-lg leading-none" onClick={onClose}>×</button>
        </div>

        {err && <div className="bg-danger/10 border border-danger/30 rounded-md px-3 py-2 text-[11px] text-danger">⚠️ {err}</div>}
        {!data && !err && <div className="text-text2 text-xs py-6 text-center">Memuat…</div>}

        {data && (
          <>
            <p className="text-[11px] text-text2 mb-3">Periode: {monthLabel} · Target SLA {data.slaMinutes} menit</p>

            {/* Rumus / perhitungan */}
            <div className="border border-border rounded-lg overflow-hidden mb-2">
              <table className="w-full text-xs">
                <thead><tr className="text-text2 uppercase text-[10px] border-b border-border bg-surface2">
                  <th className="px-3 py-2 text-left">Komponen</th>
                  <th className="px-3 py-2 text-left">Dasar</th>
                  <th className="px-3 py-2 text-right">Nilai</th>
                </tr></thead>
                <tbody>
                  {data.components.map((c, i) => (
                    <tr key={i} className="border-b border-border/40">
                      <td className="px-3 py-2 font-medium">{c.label}</td>
                      <td className="px-3 py-2 text-text2 text-[11px]">{c.detail}</td>
                      <td className={`px-3 py-2 text-right font-mono font-semibold ${c.value < 0 ? 'text-danger' : c.value > 0 ? 'text-success' : 'text-text2'}`}>{sign(c.value)}</td>
                    </tr>
                  ))}
                  <tr className="bg-surface2">
                    <td className="px-3 py-2 font-bold" colSpan={2}>Total {data.clamped && <span className="text-[10px] text-text2 font-normal">(dibatasi 0–100, mentah {data.raw})</span>}</td>
                    <td className="px-3 py-2 text-right font-mono font-extrabold text-accent">{data.score}</td>
                  </tr>
                </tbody>
              </table>
            </div>
            <div className="text-[10px] text-text2 mb-4">Rumus: 30 + (selesai×2) + (tepat SLA×4) + (kritis×6) + (PM×3) + (dokumentasi×5) − (pelanggaran×10) − (eskalasi×5) − (reopen×8) − (absen×15), dibatasi 0–100.</div>

            {/* Log kejadian */}
            <div className="flex gap-1 mb-2 flex-wrap">
              {([['done', `Selesai (${data.logs.done.length})`], ['taken', `Diambil (${data.logs.taken.length})`], ['breaches', `Pelanggaran SLA (${data.logs.breaches.length})`]] as const).map(([k, lbl]) => (
                <button key={k} onClick={() => setTab(k)} className={`px-2.5 py-1 text-[11px] rounded-md ${tab === k ? 'bg-accent text-bg font-semibold' : 'bg-surface2 text-text2'}`}>{lbl}</button>
              ))}
            </div>

            <div className="border border-border rounded-lg overflow-x-auto max-h-[34vh] overflow-y-auto">
              <table className="w-full text-[11px]">
                {tab === 'done' && (
                  <>
                    <thead><tr className="text-text2 uppercase text-[10px] border-b border-border bg-surface2"><th className="px-3 py-2 text-left">ID</th><th className="px-3 py-2 text-left">Perangkat</th><th className="px-3 py-2 text-left">Prioritas</th><th className="px-3 py-2 text-left">Durasi</th><th className="px-3 py-2 text-left">Selesai</th></tr></thead>
                    <tbody>{data.logs.done.map((r) => <tr key={r.id} className="border-b border-border/30"><td className="px-3 py-1.5 font-mono text-accent2">{r.id}</td><td className="px-3 py-1.5">{r.device_name}</td><td className="px-3 py-1.5 capitalize">{r.priority}</td><td className="px-3 py-1.5">{fmtDur(r.duration_min)}</td><td className="px-3 py-1.5 text-text2 font-mono">{r.resolved_at}</td></tr>)}
                    {data.logs.done.length === 0 && <tr><td colSpan={5} className="px-3 py-4 text-center text-text2">—</td></tr>}</tbody>
                  </>
                )}
                {tab === 'taken' && (
                  <>
                    <thead><tr className="text-text2 uppercase text-[10px] border-b border-border bg-surface2"><th className="px-3 py-2 text-left">ID</th><th className="px-3 py-2 text-left">Perangkat</th><th className="px-3 py-2 text-left">Respons</th><th className="px-3 py-2 text-left">Status</th></tr></thead>
                    <tbody>{data.logs.taken.map((r) => { const ok = r.resp != null && r.resp <= data.slaMinutes; return <tr key={r.id} className="border-b border-border/30"><td className="px-3 py-1.5 font-mono text-accent2">{r.id}</td><td className="px-3 py-1.5">{r.device_name}</td><td className="px-3 py-1.5 font-mono">{r.resp}m</td><td className={`px-3 py-1.5 font-semibold ${ok ? 'text-success' : 'text-danger'}`}>{ok ? `Tepat ≤${data.slaMinutes}m` : 'Lewat SLA'}</td></tr>; })}
                    {data.logs.taken.length === 0 && <tr><td colSpan={4} className="px-3 py-4 text-center text-text2">—</td></tr>}</tbody>
                  </>
                )}
                {tab === 'breaches' && (
                  <>
                    <thead><tr className="text-text2 uppercase text-[10px] border-b border-border bg-surface2"><th className="px-3 py-2 text-left">ID</th><th className="px-3 py-2 text-left">Perangkat</th><th className="px-3 py-2 text-left">Telat</th><th className="px-3 py-2 text-left">Masuk</th></tr></thead>
                    <tbody>{data.logs.breaches.map((r) => <tr key={r.id} className="border-b border-border/30"><td className="px-3 py-1.5 font-mono text-accent2">{r.id}</td><td className="px-3 py-1.5">{r.device_name}</td><td className="px-3 py-1.5 font-mono text-danger">{r.mins}m {r.taken_at ? '' : '(blm diambil)'}</td><td className="px-3 py-1.5 text-text2 font-mono">{r.created_at}</td></tr>)}
                    {data.logs.breaches.length === 0 && <tr><td colSpan={4} className="px-3 py-4 text-center text-success">Tidak ada pelanggaran 🎉</td></tr>}</tbody>
                  </>
                )}
              </table>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
