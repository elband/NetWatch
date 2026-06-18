import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api/client';
import { getSocket } from '../api/socket';
import type { AppNotification, NotifPriority } from '../types';

const PRIO: Record<NotifPriority, { color: string; label: string }> = {
  kritis: { color: '#ef4444', label: 'Kritis' },
  warning: { color: '#d29922', label: 'Perhatian' },
  selesai: { color: '#3fb950', label: 'Selesai' },
  info: { color: '#58a6ff', label: 'Info' },
};
const ICON: Record<string, string> = {
  ticket_new: '🚨', ticket_assigned: '🎫', ticket_sla: '⏰', ticket_done: '✅', ticket_collab: '👥',
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

let _audioCtx: AudioContext | null = null;
function ping() {
  try {
    const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    _audioCtx = _audioCtx || new Ctx();
    const ctx = _audioCtx;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.connect(g); g.connect(ctx.destination);
    o.type = 'sine'; o.frequency.value = 880;
    g.gain.setValueAtTime(0.0001, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.14, ctx.currentTime + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.25);
    o.start(); o.stop(ctx.currentTime + 0.26);
  } catch { /* abaikan */ }
}

export default function NotificationCenter() {
  const nav = useNavigate();
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<AppNotification[]>([]);
  const [unread, setUnread] = useState(0);
  const [filter, setFilter] = useState<'all' | 'unread'>('all');
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [muted, setMuted] = useState(() => localStorage.getItem('nw_notif_mute') === '1');
  const wrapRef = useRef<HTMLDivElement>(null);
  const loadingRef = useRef(false);
  const openRef = useRef(open); openRef.current = open;
  const mutedRef = useRef(muted); mutedRef.current = muted;

  // Hitung unread awal + dengarkan notifikasi real-time.
  useEffect(() => {
    api.get('/notifications/unread-count').then((r) => setUnread(r.data.unread)).catch(() => {});
    const s = getSocket();
    const onNew = (p: { notification: AppNotification; unread: number }) => {
      setUnread(p.unread);
      if (openRef.current) setItems((prev) => [p.notification, ...prev.filter((n) => n.id !== p.notification.id)]);
      if (!mutedRef.current) ping();
    };
    s.on('notification:new', onNew);
    return () => { s.off('notification:new', onNew); };
  }, []);

  // Muat daftar saat panel dibuka atau filter berubah.
  useEffect(() => { if (open) load(true); /* eslint-disable-next-line */ }, [open, filter]);

  // Tutup saat klik di luar.
  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) { if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false); }
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  async function load(reset: boolean) {
    if (loadingRef.current) return;
    loadingRef.current = true; setLoading(true);
    const before = reset ? 0 : (items[items.length - 1]?.id || 0);
    try {
      const r = await api.get('/notifications', { params: { limit: 20, filter, ...(before ? { before } : {}) } });
      setItems(reset ? r.data.notifications : (prev) => [...prev, ...r.data.notifications]);
      setHasMore(r.data.hasMore); setUnread(r.data.unread);
    } catch { /* abaikan */ } finally { loadingRef.current = false; setLoading(false); }
  }

  function onScroll(e: React.UIEvent<HTMLDivElement>) {
    const el = e.currentTarget;
    if (hasMore && !loadingRef.current && el.scrollTop + el.clientHeight >= el.scrollHeight - 48) load(false);
  }

  async function markRead(id: number) {
    setItems((prev) => prev.map((n) => (n.id === id ? { ...n, is_read: 1 } : n)));
    try { const r = await api.patch(`/notifications/${id}/read`); setUnread(r.data.unread); } catch { /* abaikan */ }
  }
  async function markAll() {
    setItems((prev) => prev.map((n) => ({ ...n, is_read: 1 })));
    try { const r = await api.post('/notifications/read-all'); setUnread(r.data.unread); } catch { /* abaikan */ }
    if (filter === 'unread') load(true);
  }
  async function remove(id: number, e: React.MouseEvent) {
    e.stopPropagation();
    setItems((prev) => prev.filter((n) => n.id !== id));
    try { const r = await api.delete(`/notifications/${id}`); setUnread(r.data.unread); } catch { /* abaikan */ }
  }
  function clickItem(n: AppNotification) {
    if (!n.is_read) markRead(n.id);
    setOpen(false);
    if (n.link) nav(n.link);
  }
  function toggleMute() { setMuted((m) => { const v = !m; localStorage.setItem('nw_notif_mute', v ? '1' : '0'); return v; }); }

  const shown = filter === 'unread' ? items.filter((n) => !n.is_read) : items;

  return (
    <div ref={wrapRef} className="relative z-[45]">
      <button onClick={() => setOpen((o) => !o)} title="Notifikasi" aria-label="Notifikasi"
        className="relative text-base hover:opacity-80 leading-none p-1">
        🔔
        {unread > 0 && <span className="absolute -top-1 -right-1 bg-danger text-white text-[8px] font-bold rounded-full min-w-[15px] h-[15px] flex items-center justify-center px-0.5 animate-pulse">{unread > 99 ? '99+' : unread}</span>}
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-2 w-[360px] max-w-[92vw] rounded-xl border border-white/10 shadow-2xl overflow-hidden nw-pop"
          style={{ background: 'rgba(22,27,34,0.92)', backdropFilter: 'blur(16px)', WebkitBackdropFilter: 'blur(16px)' }}>
          {/* Header */}
          <div className="flex items-center justify-between px-3.5 py-2.5 border-b border-white/10">
            <div className="text-sm font-bold flex items-center gap-2">🔔 Notifikasi {unread > 0 && <span className="text-[10px] font-semibold text-danger">({unread} baru)</span>}</div>
            <div className="flex items-center gap-2">
              <button onClick={toggleMute} title={muted ? 'Bunyikan notifikasi' : 'Bisukan notifikasi'} className="text-text2 hover:text-white text-[13px]">{muted ? '🔕' : '🔔'}</button>
              <button onClick={markAll} disabled={!unread} className="text-[10px] text-accent2 hover:underline disabled:opacity-40 disabled:no-underline">Tandai semua dibaca</button>
            </div>
          </div>
          {/* Filter */}
          <div className="flex gap-1 px-3.5 py-2 border-b border-white/10">
            {(['all', 'unread'] as const).map((k) => (
              <button key={k} onClick={() => setFilter(k)} className={`px-2.5 py-1 rounded-md text-[11px] ${filter === k ? 'bg-accent/15 text-accent font-semibold' : 'text-text2 hover:bg-white/5'}`}>
                {k === 'all' ? 'Semua' : 'Belum dibaca'}
              </button>
            ))}
          </div>
          {/* List */}
          <div onScroll={onScroll} className="overflow-y-auto" style={{ maxHeight: '62vh' }}>
            {shown.length === 0 && !loading && (
              <div className="text-center text-text2 text-xs py-10">{filter === 'unread' ? 'Tidak ada notifikasi belum dibaca 🎉' : 'Belum ada notifikasi.'}</div>
            )}
            {shown.map((n) => {
              const p = PRIO[n.priority] || PRIO.info;
              return (
                <div key={n.id} onClick={() => clickItem(n)}
                  className={`group relative flex gap-2.5 px-3.5 py-2.5 border-b border-white/5 cursor-pointer hover:bg-white/5 ${n.is_read ? 'opacity-70' : ''}`}
                  style={{ borderLeft: `3px solid ${p.color}` }}>
                  <div className="w-7 h-7 rounded-full flex items-center justify-center text-sm shrink-0" style={{ background: `${p.color}22` }}>{ICON[n.type] || '🔔'}</div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5">
                      {!n.is_read && <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: p.color }} />}
                      <div className={`text-[12px] truncate ${n.is_read ? 'font-medium' : 'font-bold'}`}>{n.title}</div>
                    </div>
                    {n.message && <div className="text-[11px] text-text2 mt-0.5 line-clamp-2">{n.message}</div>}
                    <div className="text-[9px] text-text2 mt-1">{relTime(n.created_at)}</div>
                  </div>
                  <button onClick={(e) => remove(n.id, e)} title="Hapus" className="opacity-0 group-hover:opacity-100 text-text2 hover:text-danger text-sm self-start transition">×</button>
                </div>
              );
            })}
            {loading && <div className="text-center text-text2 text-[11px] py-3">Memuat…</div>}
            {!loading && hasMore && <button onClick={() => load(false)} className="w-full text-center text-[11px] text-accent2 hover:underline py-3">Muat lebih banyak</button>}
          </div>
        </div>
      )}
    </div>
  );
}
