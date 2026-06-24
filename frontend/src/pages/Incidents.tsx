import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api } from '../api/client';
import { IncidentStatusBadge, PriorityBadge } from '../components/StatusBadge';
import IncidentReportModal from '../components/IncidentReportModal';
import ProgressUpdateModal from '../components/ProgressUpdateModal';
import InviteCollabModal from '../components/InviteCollabModal';
import IncidentDetailModal from '../components/IncidentDetailModal';
import { downtimeMs, fmtDowntime, downtimeColor } from '../utils/downtime';
import type { Incident } from '../types';

type SortKey = 'id' | 'device_name' | 'priority' | 'downtime' | 'created_at' | 'status';
type SortDir = 'asc' | 'desc';

const PRIORITY_ORDER: Record<string, number> = { kritis: 0, tinggi: 1, sedang: 2 };
const STATUS_ORDER: Record<string, number> = { aktif: 0, proses: 1, selesai: 2 };

export default function Incidents() {
  const [incidents, setIncidents] = useState<Incident[]>([]);
  const [filter, setFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [sortKey, setSortKey] = useState<SortKey>('created_at');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Incident | null>(null);
  const [reportFor, setReportFor] = useState<Incident | null>(null);
  const [progressFor, setProgressFor] = useState<Incident | null>(null);
  const [inviteFor, setInviteFor] = useState<Incident | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [searchParams] = useSearchParams();
  const focusId = searchParams.get('focus');
  const lastFocus = useRef<string | null>(null);

  function load() {
    api.get('/incidents').then((res) => {
      setIncidents(res.data.incidents);
      setSelected((cur) => (cur ? res.data.incidents.find((i: Incident) => i.id === cur.id) || null : cur));
      setLoading(false);
    });
  }

  useEffect(() => { load(); }, []);

  // Downtime ticker every 30s
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30000);
    return () => clearInterval(t);
  }, []);

  // Auto-refresh data every 30s
  useEffect(() => {
    const t = setInterval(load, 30000);
    return () => clearInterval(t);
  }, []);

  // Auto-open incident from notification link (?focus=INC-…)
  useEffect(() => {
    if (!focusId || !incidents.length || lastFocus.current === focusId) return;
    const inc = incidents.find((i) => i.id === focusId);
    if (inc) { setSelected(inc); lastFocus.current = focusId; }
  }, [incidents, focusId]);

  // Close modal on Escape
  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') setSelected(null); }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  async function resolve(id: string) {
    await api.post(`/incidents/${id}/resolve`);
    load();
    setSelected(null);
  }

  function toggleSort(key: SortKey) {
    if (sortKey === key) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else { setSortKey(key); setSortDir('asc'); }
  }

  // Stats
  const active = incidents.filter((i) => i.status === 'aktif').length;
  const inProgress = incidents.filter((i) => i.status === 'proses').length;
  const done = incidents.filter((i) => i.status === 'selesai').length;
  const kritis = incidents.filter((i) => i.priority === 'kritis' && i.status !== 'selesai').length;

  // Filter + search + sort
  const q = search.trim().toLowerCase();
  const filtered = incidents
    .filter((i) => filter === 'all' || i.status === filter)
    .filter((i) => !q || i.id.toLowerCase().includes(q) || i.device_name.toLowerCase().includes(q) || i.issue.toLowerCase().includes(q))
    .sort((a, b) => {
      let cmp = 0;
      if (sortKey === 'id') cmp = a.id.localeCompare(b.id);
      else if (sortKey === 'device_name') cmp = a.device_name.localeCompare(b.device_name);
      else if (sortKey === 'priority') cmp = (PRIORITY_ORDER[a.priority] ?? 9) - (PRIORITY_ORDER[b.priority] ?? 9);
      else if (sortKey === 'status') cmp = (STATUS_ORDER[a.status] ?? 9) - (STATUS_ORDER[b.status] ?? 9);
      else if (sortKey === 'downtime') cmp = downtimeMs(a, now) - downtimeMs(b, now);
      else if (sortKey === 'created_at') cmp = a.created_at.localeCompare(b.created_at);
      return sortDir === 'asc' ? cmp : -cmp;
    });

  function SortIcon({ k }: { k: SortKey }) {
    if (sortKey !== k) return <span className="text-text2 opacity-30 ml-1">↕</span>;
    return <span className="text-accent ml-1">{sortDir === 'asc' ? '↑' : '↓'}</span>;
  }

  function Th({ label, k }: { label: string; k?: SortKey }) {
    if (!k) return <th className="px-3.5 py-2.5 text-left">{label}</th>;
    return (
      <th
        className="px-3.5 py-2.5 text-left cursor-pointer hover:text-text select-none"
        onClick={() => toggleSort(k)}
      >
        {label}<SortIcon k={k} />
      </th>
    );
  }

  const rowTint: Record<string, string> = {
    kritis: 'bg-danger/[0.04] hover:bg-danger/[0.08]',
    tinggi: 'bg-warn/[0.03] hover:bg-warn/[0.06]',
    sedang: 'hover:bg-white/[0.03]',
  };

  return (
    <div>
      {/* ===== Header ===== */}
      <div className="flex items-center justify-between mb-4 gap-3 flex-wrap">
        <div>
          <div className="text-[17px] font-bold">🚨 Manajemen Insiden</div>
          <div className="text-[11px] text-text2 mt-0.5">{active + inProgress} insiden aktif</div>
        </div>
        <button
          onClick={() => { setLoading(true); load(); }}
          className="text-xs text-text2 hover:text-text border border-border rounded px-2.5 py-1 flex items-center gap-1.5"
        >
          {loading ? <span className="animate-spin">⟳</span> : '⟳'} Muat Ulang
        </button>
      </div>

      {/* ===== Stats cards ===== */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
        <StatCard label="AKTIF" value={active} color="text-danger" accent="border-danger/30" dot="bg-danger" onClick={() => setFilter('aktif')} active={filter === 'aktif'} />
        <StatCard label="DALAM PROSES" value={inProgress} color="text-warn" accent="border-warn/30" dot="bg-warn" onClick={() => setFilter('proses')} active={filter === 'proses'} />
        <StatCard label="KRITIS (AKTIF)" value={kritis} color="text-danger" accent="border-danger/40" dot="bg-danger" pulse onClick={() => { setFilter('all'); setSearch(''); setSortKey('priority'); setSortDir('asc'); }} active={false} />
        <StatCard label="SELESAI" value={done} color="text-success" accent="border-success/30" dot="bg-success" onClick={() => setFilter('selesai')} active={filter === 'selesai'} />
      </div>

      {/* ===== Search + Filter bar ===== */}
      <div className="flex gap-2 mb-3 flex-wrap">
        <div className="relative flex-1 min-w-[180px]">
          <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-text2 text-xs">🔍</span>
          <input
            className="w-full bg-surface2 border border-border rounded-md pl-7 pr-3 py-2 text-xs focus:outline-none focus:border-accent placeholder-text2"
            placeholder="Cari ID, perangkat, atau masalah…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          {search && (
            <button className="absolute right-2.5 top-1/2 -translate-y-1/2 text-text2 hover:text-text" onClick={() => setSearch('')}>✕</button>
          )}
        </div>
        <select
          className="bg-surface2 border border-border rounded-md px-3 py-2 text-xs"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        >
          <option value="all">Semua Status</option>
          <option value="aktif">Aktif</option>
          <option value="proses">Dalam Proses</option>
          <option value="selesai">Selesai</option>
        </select>
        {(filter !== 'all' || search) && (
          <button
            className="text-xs text-text2 hover:text-text border border-border rounded px-2.5 py-1"
            onClick={() => { setFilter('all'); setSearch(''); }}
          >
            Reset ✕
          </button>
        )}
      </div>

      {/* ===== Table ===== */}
      <div className="bg-surface border border-border rounded-[10px] overflow-x-auto">
        {loading ? (
          <div className="py-16 text-center text-text2 text-xs animate-pulse">Memuat data insiden…</div>
        ) : filtered.length === 0 ? (
          <div className="py-16 text-center text-text2 text-xs">
            {search ? `Tidak ada hasil untuk "${search}"` : 'Tidak ada insiden.'}
          </div>
        ) : (
          <table className="w-full text-xs" style={{ minWidth: '860px' }}>
            <thead>
              <tr className="text-text2 uppercase text-[10px] border-b border-border">
                <Th label="ID" k="id" />
                <Th label="Perangkat" k="device_name" />
                <Th label="Masalah" />
                <Th label="Prioritas" k="priority" />
                <Th label="Terputus" k="downtime" />
                <Th label="Waktu" k="created_at" />
                <Th label="Status" k="status" />
                <Th label="Aksi" />
              </tr>
            </thead>
            <tbody>
              {filtered.map((i) => (
                <tr
                  key={i.id}
                  className={`border-b border-border/50 cursor-pointer transition-colors ${rowTint[i.priority] || 'hover:bg-white/[0.03]'}`}
                  onClick={() => setSelected(i)}
                >
                  {/* ID */}
                  <td className="px-3.5 py-2.5 font-mono text-accent2 text-[10px] whitespace-nowrap">
                    <span className="flex items-center gap-1.5">
                      {i.id}
                      {i.status === 'aktif' && (
                        <span className="relative flex h-1.5 w-1.5 flex-shrink-0">
                          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-danger opacity-75" />
                          <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-danger" />
                        </span>
                      )}
                    </span>
                  </td>

                  {/* Perangkat — fixed width, satu baris truncate + tooltip */}
                  <td className="px-3.5 py-2.5" style={{ maxWidth: '180px', width: '180px' }}>
                    <div className="truncate font-semibold" title={i.device_name}>{i.device_name}</div>
                    <div className="truncate text-[10px] text-text2 font-mono mt-0.5" title={i.ip || '—'}>{i.ip || '—'}</div>
                  </td>

                  {/* Masalah — satu baris truncate + tooltip */}
                  <td className="px-3.5 py-2.5 text-text2" style={{ maxWidth: '180px', width: '180px' }}>
                    <div className="truncate" title={i.issue}>{i.issue}</div>
                  </td>

                  {/* Prioritas */}
                  <td className="px-3.5 py-2.5 whitespace-nowrap">
                    <PriorityBadge priority={i.priority} />
                  </td>

                  {/* Terputus — teks murni, tanpa emoji besar */}
                  <td className={`px-3.5 py-2.5 font-mono font-semibold whitespace-nowrap ${downtimeColor(i, downtimeMs(i, now))}`}>
                    {fmtDowntime(downtimeMs(i, now))}
                  </td>

                  {/* Waktu */}
                  <td className="px-3.5 py-2.5 text-text2 font-mono text-[10px] whitespace-nowrap">{i.created_at}</td>

                  {/* Status */}
                  <td className="px-3.5 py-2.5 whitespace-nowrap">
                    <IncidentStatusBadge status={i.status} />
                  </td>

                  {/* Aksi */}
                  <td className="px-3.5 py-2.5 whitespace-nowrap" onClick={(e) => e.stopPropagation()}>
                    <div className="flex gap-1.5">
                      <button
                        className="text-text2 hover:text-text border border-border rounded px-2 py-0.5 hover:border-accent/40 transition-colors"
                        onClick={() => setSelected(i)}
                      >
                        Detail →
                      </button>
                      <button
                        className={`border rounded px-2 py-0.5 transition-colors ${i.report ? 'text-success border-success/40 hover:bg-success/10' : 'text-accent2 border-accent2/40 hover:bg-accent2/10'}`}
                        onClick={() => setReportFor(i)}
                      >
                        {i.report ? 'Laporan ✓' : 'Laporan'}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* ===== Result count ===== */}
      {!loading && filtered.length > 0 && (
        <div className="text-[10px] text-text2 mt-2 text-right">
          {filtered.length} dari {incidents.length} insiden ditampilkan
        </div>
      )}

      {/* ===== Modals ===== */}
      {selected && (
        <IncidentDetailModal
          incident={selected}
          now={now}
          onClose={() => setSelected(null)}
          onProgress={() => setProgressFor(selected)}
          onReport={() => setReportFor(selected)}
          onInvite={() => setInviteFor(selected)}
          onResolve={() => resolve(selected.id)}
        />
      )}

      {inviteFor && (
        <InviteCollabModal
          incident={inviteFor}
          onClose={() => setInviteFor(null)}
          onDone={(inc) => {
            setIncidents((prev) => prev.map((i) => (i.id === inc.id ? { ...i, collaborators: inc.collaborators } : i)));
            setSelected((s) => (s && s.id === inc.id ? { ...s, collaborators: inc.collaborators } : s));
          }}
        />
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

function StatCard({
  label, value, color, accent, dot, pulse, onClick, active,
}: {
  label: string; value: number; color: string; accent: string; dot: string;
  pulse?: boolean; onClick: () => void; active: boolean;
}) {
  return (
    <button
      onClick={onClick}
      className={`text-left bg-surface border rounded-xl p-4 transition-all hover:scale-[1.02] ${active ? `${accent} shadow-sm` : 'border-border hover:border-border/80'}`}
    >
      <div className="flex items-center gap-2 mb-2">
        <span className={`relative flex h-2 w-2 flex-shrink-0`}>
          {pulse && <span className={`animate-ping absolute inline-flex h-full w-full rounded-full ${dot} opacity-75`} />}
          <span className={`relative inline-flex rounded-full h-2 w-2 ${dot}`} />
        </span>
        <span className="text-[10px] text-text2 uppercase font-semibold tracking-wide">{label}</span>
      </div>
      <div className={`text-2xl font-extrabold ${color}`}>{value}</div>
    </button>
  );
}
