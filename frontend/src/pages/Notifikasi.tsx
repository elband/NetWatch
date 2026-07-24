import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api/client';
import { getSocket } from '../api/socket';
import ConfirmDialog from '../components/ConfirmDialog';
import type { AppNotification, NotifPriority } from '../types';

const PRIO: Record<NotifPriority, { color: string; label: string; emoji: string }> = {
  kritis: { color: 'var(--color-danger)', label: 'Kritis', emoji: '🛑' },
  warning: { color: 'var(--color-warn)', label: 'Perhatian', emoji: '⚠️' },
  selesai: { color: 'var(--color-success)', label: 'Selesai', emoji: '✅' },
  info: { color: 'var(--color-accent2)', label: 'Info', emoji: 'ℹ️' },
};
const PRIO_KEYS: NotifPriority[] = ['kritis', 'warning', 'selesai', 'info'];

const ICON: Record<string, string> = {
  ticket_new: '⚠️', ticket_assigned: '🎫', ticket_sla: '⏰', ticket_done: '✅', ticket_collab: '👥',
  diklat_new: '🎓', diklat_approved: '🎓', diklat_rejected: '🎓',
  public_new: '📩', public_critical: '🛑', doc_review: '📄', sop_new: '📘', sop_expiring: '📘',
  knr_new: '📝', approval_pending: '🗳️',
};

function relTime(s: string): string {
  const d = new Date(s.replace(' ', 'T'));
  const diff = Math.floor((Date.now() - d.getTime()) / 1000);
  if (diff < 45) return 'baru saja';
  if (diff < 3600) return `${Math.floor(diff / 60)} mnt lalu`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} jam lalu`;
  if (diff < 7 * 86400) return `${Math.floor(diff / 86400)} hari lalu`;
  return d.toLocaleDateString('id-ID', { day: 'numeric', month: 'short' });
}

const GROUP_ORDER = ['Hari ini', 'Kemarin', '7 hari terakhir', 'Lebih lama'] as const;
function groupOf(s: string): (typeof GROUP_ORDER)[number] {
  const t = new Date(s.replace(' ', 'T')).getTime();
  const now = new Date();
  const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  if (t >= startToday) return 'Hari ini';
  if (t >= startToday - 86400000) return 'Kemarin';
  if (t >= startToday - 7 * 86400000) return '7 hari terakhir';
  return 'Lebih lama';
}

export default function Notifikasi() {
  const nav = useNavigate();
  const [items, setItems] = useState<AppNotification[]>([]);
  const [unread, setUnread] = useState(0);
  const [tab, setTab] = useState<'all' | 'unread'>('all');
  const [prio, setPrio] = useState<NotifPriority | 'all'>('all');
  const [q, setQ] = useState('');
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  const [busy, setBusy] = useState(false);
  const loadingRef = useRef(false);

  useEffect(() => {
    load(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  // Real-time: sisipkan notifikasi baru di puncak.
  useEffect(() => {
    const s = getSocket();
    const onNew = (p: { notification: AppNotification; unread: number }) => {
      setUnread(p.unread);
      setItems((prev) => [p.notification, ...prev.filter((n) => n.id !== p.notification.id)]);
    };
    s.on('notification:new', onNew);
    return () => { s.off('notification:new', onNew); };
  }, []);

  async function load(reset: boolean) {
    if (loadingRef.current) return;
    loadingRef.current = true; setLoading(true);
    const before = reset ? 0 : (items[items.length - 1]?.id || 0);
    try {
      const r = await api.get('/notifications', { params: { limit: 25, filter: tab, ...(before ? { before } : {}) } });
      setItems(reset ? r.data.notifications : (prev) => [...prev, ...r.data.notifications]);
      setHasMore(r.data.hasMore); setUnread(r.data.unread);
    } catch { /* abaikan */ } finally { loadingRef.current = false; setLoading(false); }
  }

  async function markRead(id: number) {
    setItems((prev) => prev.map((n) => (n.id === id ? { ...n, is_read: 1 } : n)));
    try { const r = await api.patch(`/notifications/${id}/read`); setUnread(r.data.unread); } catch { /* abaikan */ }
  }
  async function markAll() {
    setItems((prev) => prev.map((n) => ({ ...n, is_read: 1 })));
    try { const r = await api.post('/notifications/read-all'); setUnread(r.data.unread); } catch { /* abaikan */ }
    if (tab === 'unread') load(true);
  }
  async function remove(id: number) {
    setItems((prev) => prev.filter((n) => n.id !== id));
    try { const r = await api.delete(`/notifications/${id}`); setUnread(r.data.unread); } catch { /* abaikan */ }
  }
  async function clearAll() {
    setBusy(true);
    try {
      await api.delete('/notifications');
      setItems([]); setUnread(0); setHasMore(false);
    } catch { /* abaikan */ } finally { setBusy(false); setConfirmClear(false); }
  }
  function open(n: AppNotification) {
    if (!n.is_read) markRead(n.id);
    if (n.link) nav(n.link);
  }

  // Filter klien: prioritas + pencarian (di atas hasil server tab all/unread).
  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return items.filter((n) => {
      if (prio !== 'all' && n.priority !== prio) return false;
      if (needle && !(`${n.title} ${n.message ?? ''}`.toLowerCase().includes(needle))) return false;
      return true;
    });
  }, [items, prio, q]);

  // Hitung breakdown prioritas dari item yang sudah dimuat.
  const counts = useMemo(() => {
    const c: Record<NotifPriority, number> = { kritis: 0, warning: 0, selesai: 0, info: 0 };
    for (const n of items) c[n.priority] = (c[n.priority] || 0) + 1;
    return c;
  }, [items]);

  const grouped = useMemo(() => {
    const map = new Map<string, AppNotification[]>();
    for (const n of shown) {
      const g = groupOf(n.created_at);
      (map.get(g) || map.set(g, []).get(g)!).push(n);
    }
    return GROUP_ORDER.filter((g) => map.has(g)).map((g) => [g, map.get(g)!] as const);
  }, [shown]);

  return (
    <div className="max-w-3xl mx-auto">
      {/* ===== Hero ringkasan ===== */}
      <div
        className="nw-rise relative overflow-hidden rounded-2xl border border-border p-5 mb-4"
        style={{ background: 'linear-gradient(135deg, color-mix(in srgb, var(--color-accent) 14%, var(--color-surface)) 0%, var(--color-surface) 60%)' }}
      >
        <div className="absolute -top-10 -right-8 w-40 h-40 rounded-full blur-3xl opacity-30" style={{ background: 'var(--color-accent)' }} />
        <div className="relative flex items-center justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-4">
            <div className="w-14 h-14 rounded-2xl flex items-center justify-center text-3xl shrink-0"
              style={{ background: 'color-mix(in srgb, var(--color-accent) 20%, transparent)' }}>🔔</div>
            <div>
              <div className="flex items-baseline gap-2">
                <span className="nw-fluid-num" style={{ color: unread ? 'var(--color-accent)' : 'var(--color-text)' }}>{unread}</span>
                <span className="text-sm text-text2 font-medium">belum dibaca</span>
              </div>
              <div className="text-[11px] text-text2 mt-0.5">
                {items.length} notifikasi dimuat{hasMore ? ' · ada lagi di bawah' : ''}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={markAll} disabled={!unread}
              className="px-3 py-2 rounded-lg text-[12px] font-semibold border border-border bg-surface2 hover:border-accent hover:text-accent transition disabled:opacity-40">
              ✓ Tandai semua dibaca
            </button>
            <button onClick={() => setConfirmClear(true)} disabled={!items.length}
              className="px-3 py-2 rounded-lg text-[12px] font-semibold border border-border text-text2 hover:border-danger hover:text-danger transition disabled:opacity-40">
              🗑️ Hapus semua
            </button>
          </div>
        </div>

        {/* breakdown prioritas */}
        <div className="relative flex flex-wrap gap-2 mt-4">
          {PRIO_KEYS.map((k) => (
            <div key={k} className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-medium"
              style={{ background: `color-mix(in srgb, ${PRIO[k].color} 14%, transparent)`, color: PRIO[k].color }}>
              <span>{PRIO[k].emoji}</span>{PRIO[k].label}
              <span className="font-bold">{counts[k]}</span>
            </div>
          ))}
        </div>
      </div>

      {/* ===== Toolbar: tab + cari ===== */}
      <div className="flex items-center gap-2 mb-3 flex-wrap">
        <div className="flex bg-surface2 border border-border rounded-lg p-0.5">
          {(['all', 'unread'] as const).map((k) => (
            <button key={k} onClick={() => setTab(k)}
              className={`px-3 py-1.5 rounded-md text-[12px] font-semibold transition ${tab === k ? 'bg-accent/15 text-accent' : 'text-text2 hover:text-text'}`}>
              {k === 'all' ? 'Semua' : `Belum dibaca${unread ? ` (${unread})` : ''}`}
            </button>
          ))}
        </div>
        <div className="relative flex-1 min-w-[180px]">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-text2 text-xs">🔍</span>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Cari judul / isi notifikasi…"
            className="w-full bg-surface2 border border-border rounded-lg pl-8 pr-3 py-2 text-[12px] outline-none focus:border-accent transition" />
        </div>
      </div>

      {/* ===== Chip prioritas ===== */}
      <div className="flex flex-wrap gap-1.5 mb-4">
        <button onClick={() => setPrio('all')}
          className={`px-2.5 py-1 rounded-full text-[11px] font-semibold border transition ${prio === 'all' ? 'border-accent text-accent bg-accent/10' : 'border-border text-text2 hover:text-text'}`}>
          Semua prioritas
        </button>
        {PRIO_KEYS.map((k) => (
          <button key={k} onClick={() => setPrio((p) => (p === k ? 'all' : k))}
            className="px-2.5 py-1 rounded-full text-[11px] font-semibold border transition"
            style={prio === k
              ? { borderColor: PRIO[k].color, color: PRIO[k].color, background: `color-mix(in srgb, ${PRIO[k].color} 12%, transparent)` }
              : { borderColor: 'var(--color-border)', color: 'var(--color-text2)' }}>
            {PRIO[k].emoji} {PRIO[k].label}
          </button>
        ))}
      </div>

      {/* ===== Daftar ===== */}
      {grouped.length === 0 && !loading && (
        <div className="text-center py-16 text-text2">
          <div className="text-5xl mb-3">{tab === 'unread' ? '🎉' : '📭'}</div>
          <div className="text-sm font-semibold">{tab === 'unread' ? 'Semua sudah dibaca' : 'Belum ada notifikasi'}</div>
          <div className="text-[11px] mt-1">{q || prio !== 'all' ? 'Tidak ada yang cocok dengan filter.' : 'Notifikasi baru akan muncul di sini secara real-time.'}</div>
        </div>
      )}

      {grouped.map(([g, list]) => (
        <div key={g} className="mb-5">
          <div className="text-[10px] font-bold uppercase tracking-[1.5px] text-text2 mb-2 px-1">{g}</div>
          <div className="nw-stagger space-y-2">
            {list.map((n) => {
              const p = PRIO[n.priority] || PRIO.info;
              return (
                <div key={n.id}
                  className={`nw-card group relative flex gap-3 p-3.5 rounded-xl border border-border cursor-pointer ${n.is_read ? 'bg-surface/60 opacity-80' : 'bg-surface'}`}
                  style={{ borderLeft: `3px solid ${p.color}` }}
                  onClick={() => open(n)}>
                  <div className="w-10 h-10 rounded-xl flex items-center justify-center text-lg shrink-0"
                    style={{ background: `color-mix(in srgb, ${p.color} 16%, transparent)` }}>
                    {ICON[n.type] || '🔔'}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      {!n.is_read && <span className="w-2 h-2 rounded-full shrink-0" style={{ background: p.color, boxShadow: `0 0 7px ${p.color}` }} />}
                      <div className={`text-[13px] truncate ${n.is_read ? 'font-semibold' : 'font-bold'}`}>{n.title}</div>
                      <span className="ml-auto text-[9px] text-text2 shrink-0 whitespace-nowrap">{relTime(n.created_at)}</span>
                    </div>
                    {n.message && <div className="text-[11.5px] text-text2 mt-1 line-clamp-2">{n.message}</div>}
                    <div className="flex items-center gap-2 mt-2">
                      <span className="text-[9px] px-1.5 py-0.5 rounded font-semibold"
                        style={{ background: `color-mix(in srgb, ${p.color} 14%, transparent)`, color: p.color }}>{p.label}</span>
                      {n.link && <span className="text-[9px] text-accent2">↗ buka detail</span>}
                    </div>
                  </div>
                  {/* aksi hover */}
                  <div className="flex flex-col gap-1 opacity-0 group-hover:opacity-100 transition self-start">
                    {!n.is_read && (
                      <button title="Tandai dibaca" onClick={(e) => { e.stopPropagation(); markRead(n.id); }}
                        className="text-text2 hover:text-success text-sm leading-none">✓</button>
                    )}
                    <button title="Hapus" onClick={(e) => { e.stopPropagation(); remove(n.id); }}
                      className="text-text2 hover:text-danger text-base leading-none">×</button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ))}

      {loading && <div className="text-center text-text2 text-[12px] py-4">Memuat…</div>}
      {!loading && hasMore && (
        <button onClick={() => load(false)}
          className="w-full py-2.5 rounded-lg border border-border text-[12px] font-semibold text-accent2 hover:border-accent2 hover:bg-accent2/5 transition">
          Muat lebih banyak
        </button>
      )}

      <ConfirmDialog
        open={confirmClear}
        variant="danger"
        icon="🗑️"
        title="Hapus semua notifikasi?"
        message="Seluruh notifikasimu akan dihapus permanen dan tidak bisa dikembalikan."
        confirmText="Ya, hapus semua"
        loading={busy}
        onConfirm={clearAll}
        onCancel={() => setConfirmClear(false)}
      />
    </div>
  );
}
