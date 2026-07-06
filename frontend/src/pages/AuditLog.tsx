import { useEffect, useState, useCallback } from 'react';
import { api } from '../api/client';

interface Log {
  id: number;
  actor_id: number | null;
  actor_name: string | null;
  action: string;
  target_type: string | null;
  target_id: string | null;
  detail: string | null;
  created_at: string;
}

// Warna badge per jenis aksi (yang sensitif dibuat mencolok).
function actionStyle(a: string): string {
  if (/login_as|delete|hapus/i.test(a)) return 'bg-danger/15 text-danger';
  if (/ssh/i.test(a)) return 'bg-warn/15 text-warn';
  if (/create|tambah|approve|setuju/i.test(a)) return 'bg-success/15 text-success';
  return 'bg-accent2/15 text-accent2';
}

const fmtWaktu = (t: string) => new Date(t.replace(' ', 'T')).toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: 'medium' });

export default function AuditLog() {
  const [logs, setLogs] = useState<Log[]>([]);
  const [actions, setActions] = useState<string[]>([]);
  const [action, setAction] = useState('');
  const [actor, setActor] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    api.get('/audit/actions').then((r) => setActions(r.data.actions || [])).catch(() => {});
  }, []);

  const load = useCallback((before?: number) => {
    setLoading(true);
    const params = new URLSearchParams();
    if (action) params.set('action', action);
    if (actor) params.set('actor', actor);
    if (from) params.set('from', from);
    if (to) params.set('to', to);
    if (before) params.set('before', String(before));
    api.get(`/audit?${params.toString()}`)
      .then((r) => {
        setLogs((prev) => (before ? [...prev, ...r.data.logs] : r.data.logs));
        setHasMore(r.data.hasMore);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [action, actor, from, to]);

  // Muat ulang saat filter berubah (reset daftar).
  useEffect(() => { load(); }, [load]);

  const reset = () => { setAction(''); setActor(''); setFrom(''); setTo(''); };

  return (
    <div>
      <div className="flex items-center justify-between gap-3 mb-4 flex-wrap">
        <div>
          <div className="text-[17px] font-bold flex items-center gap-2">🛡️ Audit Log</div>
          <div className="text-[11px] text-text2 mt-0.5">Jejak aksi sensitif — login-as, akses & perintah SSH, dan lainnya (hanya admin).</div>
        </div>
      </div>

      {/* Filter */}
      <div className="bg-surface2 border border-border rounded-xl p-3 mb-4 flex items-end gap-2 flex-wrap">
        <label className="text-[11px] text-text2">Aksi
          <select value={action} onChange={(e) => setAction(e.target.value)} className="block mt-0.5 bg-surface border border-border rounded-md px-2 py-1.5 text-xs min-w-[150px]">
            <option value="">Semua aksi</option>
            {actions.map((a) => <option key={a} value={a}>{a}</option>)}
          </select>
        </label>
        <label className="text-[11px] text-text2">Aktor
          <input value={actor} onChange={(e) => setActor(e.target.value)} placeholder="nama / id" className="block mt-0.5 bg-surface border border-border rounded-md px-2 py-1.5 text-xs w-[140px]" />
        </label>
        <label className="text-[11px] text-text2">Dari
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="block mt-0.5 bg-surface border border-border rounded-md px-2 py-1.5 text-xs" />
        </label>
        <label className="text-[11px] text-text2">Sampai
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="block mt-0.5 bg-surface border border-border rounded-md px-2 py-1.5 text-xs" />
        </label>
        {(action || actor || from || to) && (
          <button onClick={reset} className="border border-border text-text2 rounded-md px-3 py-1.5 text-xs hover:text-text">Reset</button>
        )}
      </div>

      {/* Tabel */}
      <div className="bg-surface border border-border rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead><tr className="text-text2 uppercase text-[10px] border-b border-border bg-surface2/50">
              {['Waktu', 'Aktor', 'Aksi', 'Target', 'Detail'].map((h) => <th key={h} className="px-3 py-2.5 text-left whitespace-nowrap">{h}</th>)}
            </tr></thead>
            <tbody>
              {logs.length === 0 && !loading ? (
                <tr><td colSpan={5} className="text-center py-8 text-text2">Tidak ada catatan audit.</td></tr>
              ) : logs.map((l) => (
                <tr key={l.id} className="border-b border-border/40 hover:bg-surface2/40">
                  <td className="px-3 py-2 font-mono text-[10px] whitespace-nowrap text-text2">{fmtWaktu(l.created_at)}</td>
                  <td className="px-3 py-2 whitespace-nowrap">{l.actor_name || <span className="text-text2 italic">sistem</span>}{l.actor_id ? <span className="text-text2 text-[10px]"> #{l.actor_id}</span> : ''}</td>
                  <td className="px-3 py-2"><span className={`text-[10px] px-1.5 py-0.5 rounded font-semibold whitespace-nowrap ${actionStyle(l.action)}`}>{l.action}</span></td>
                  <td className="px-3 py-2 whitespace-nowrap text-text2">{l.target_type ? `${l.target_type}${l.target_id ? ` #${l.target_id}` : ''}` : '—'}</td>
                  <td className="px-3 py-2 max-w-[420px]"><div className="truncate" title={l.detail || ''}>{l.detail || '—'}</div></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {hasMore && (
          <div className="p-3 text-center border-t border-border">
            <button onClick={() => load(logs[logs.length - 1]?.id)} disabled={loading} className="border border-accent2/40 text-accent2 rounded-md px-4 py-1.5 text-xs font-semibold hover:bg-accent2/10 disabled:opacity-50">
              {loading ? 'Memuat…' : 'Muat lebih banyak'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
