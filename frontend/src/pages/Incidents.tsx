import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api } from '../api/client';
import { IncidentStatusBadge, PriorityBadge } from '../components/StatusBadge';
import IncidentReportModal from '../components/IncidentReportModal';
import ProgressUpdateModal from '../components/ProgressUpdateModal';
import InviteCollabModal from '../components/InviteCollabModal';
import IncidentDetailModal from '../components/IncidentDetailModal';
import { confirmDialog } from '../components/dialog';
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
  const [searchParams, setSearchParams] = useSearchParams();
  const focusId = searchParams.get('focus');
  const focusAction = searchParams.get('action');
  const lastFocus = useRef<string | null>(null);
  const lastAutoRemind = useRef<string | null>(null);
  const [toast, setToast] = useState('');

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

  // Klik link "INGATKAN" dari notifikasi WA koordinator (?focus=INC-…&action=remind):
  // ingatkan teknisi on-duty, atau teknisi yang sudah ditugaskan langsung bila ada.
  useEffect(() => {
    if (!focusId || focusAction !== 'remind' || !incidents.length || lastAutoRemind.current === focusId) return;
    const inc = incidents.find((i) => i.id === focusId);
    if (!inc) return;
    lastAutoRemind.current = focusId;
    if (inc.status === 'selesai') {
      setToast('Insiden ini sudah selesai.');
    } else if (inc.tech_id) {
      // Sudah diambil/ditugaskan ke teknisi — tidak perlu mengingatkan lagi.
      setToast(`Insiden sudah ditangani teknisi #${inc.tech_id}.`);
    } else {
      api.post(`/incidents/${focusId}/remind`, {})
        .then((res) => setToast(res.data?.message || 'Pengingat dikirim.'))
        .catch((e) => setToast(e?.response?.data?.error || 'Gagal mengirim pengingat.'))
        .finally(load);
    }
    setTimeout(() => setToast(''), 5000);
    setSearchParams((p) => { p.delete('action'); return p; }, { replace: true });
  }, [incidents, focusId, focusAction]);

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

  async function remove(id: string) {
    const ok = await confirmDialog({
      title: 'Hapus Insiden',
      message: `Hapus insiden ${id} secara permanen? Tindakan ini tidak dapat dibatalkan.`,
      variant: 'danger',
      confirmText: 'Ya, hapus',
    });
    if (!ok) return;
    await api.delete(`/incidents/${id}`);
    load();
    setSelected(null);
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

  const cardTint: Record<string, string> = {
    kritis: 'border-danger/30 bg-danger/[0.04] hover:border-danger/50',
    tinggi: 'border-warn/30 bg-warn/[0.03] hover:border-warn/50',
    sedang: 'border-border hover:border-accent/40',
  };

  return (
    <div>
      {toast && <div className="bg-accent2/10 border border-accent2/30 rounded-md px-3 py-2 text-[11px] text-accent2 mb-3">🔔 {toast}</div>}
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
        <div className="flex">
          <select
            className="bg-surface2 border border-border rounded-l-md border-r-0 px-3 py-2 text-xs"
            value={sortKey}
            onChange={(e) => setSortKey(e.target.value as SortKey)}
            title="Urutkan berdasarkan"
          >
            <option value="created_at">Waktu</option>
            <option value="priority">Prioritas</option>
            <option value="downtime">Terputus</option>
            <option value="device_name">Perangkat</option>
            <option value="status">Status</option>
            <option value="id">ID</option>
          </select>
          <button
            className="bg-surface2 border border-border rounded-r-md px-2.5 py-2 text-xs text-text2 hover:text-text"
            onClick={() => setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))}
            title={sortDir === 'asc' ? 'Naik' : 'Turun'}
          >
            {sortDir === 'asc' ? '↑' : '↓'}
          </button>
        </div>
        {(filter !== 'all' || search) && (
          <button
            className="text-xs text-text2 hover:text-text border border-border rounded px-2.5 py-1"
            onClick={() => { setFilter('all'); setSearch(''); }}
          >
            Reset ✕
          </button>
        )}
      </div>

      {/* ===== Cards ===== */}
      {loading ? (
        <div className="bg-surface border border-border rounded-[10px] py-16 text-center text-text2 text-xs animate-pulse">Memuat data insiden…</div>
      ) : filtered.length === 0 ? (
        <div className="bg-surface border border-border rounded-[10px] py-16 text-center text-text2 text-xs">
          {search ? `Tidak ada hasil untuk "${search}"` : 'Tidak ada insiden.'}
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
          {filtered.map((i) => (
            <div
              key={i.id}
              onClick={() => setSelected(i)}
              className={`bg-surface border rounded-xl p-3.5 flex flex-col gap-2.5 cursor-pointer transition-colors ${cardTint[i.priority] || 'border-border hover:border-accent/40'}`}
            >
              {/* Header: perangkat + id */}
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="font-semibold text-sm truncate" title={i.device_name}>{i.device_name}</div>
                  <div className="text-[10px] text-text2 font-mono truncate mt-0.5" title={i.ip || '—'}>{i.ip || '—'}</div>
                </div>
                <span className="shrink-0 font-mono text-accent2 text-[10px] flex items-center gap-1.5">
                  {i.id}
                  {i.status === 'aktif' && (
                    <span className="relative flex h-1.5 w-1.5">
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-danger opacity-75" />
                      <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-danger" />
                    </span>
                  )}
                </span>
              </div>

              {/* Masalah */}
              <div className="text-text2 text-[11px] line-clamp-2" title={i.issue}>{i.issue}</div>

              {/* Badges */}
              <div className="flex items-center gap-2 flex-wrap">
                <PriorityBadge priority={i.priority} />
                <IncidentStatusBadge status={i.status} />
              </div>

              {/* Meta: terputus + waktu */}
              <div className="flex items-center justify-between text-[10px] pt-2 border-t border-border/50">
                <span className={`font-mono font-semibold ${downtimeColor(i, downtimeMs(i, now))}`}>⏱ {fmtDowntime(downtimeMs(i, now))}</span>
                <span className="text-text2 font-mono">{i.created_at}</span>
              </div>

              {/* Aksi */}
              <div className="flex gap-1.5 text-xs" onClick={(e) => e.stopPropagation()}>
                <button
                  className="flex-1 text-text2 hover:text-text border border-border rounded px-2 py-1 hover:border-accent/40 transition-colors"
                  onClick={() => setSelected(i)}
                >
                  Detail →
                </button>
                <button
                  className={`flex-1 border rounded px-2 py-1 transition-colors ${i.report ? 'text-success border-success/40 hover:bg-success/10' : 'text-accent2 border-accent2/40 hover:bg-accent2/10'}`}
                  onClick={() => setReportFor(i)}
                >
                  {i.report ? 'Laporan ✓' : 'Laporan'}
                </button>
                <button
                  className="text-danger border border-danger/40 rounded px-2 py-1 hover:bg-danger/10 transition-colors"
                  title="Hapus insiden"
                  onClick={() => remove(i.id)}
                >
                  🗑️
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

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
