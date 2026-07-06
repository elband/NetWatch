import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api/client';
import { getSocket } from '../api/socket';
import type { Device, ServiceItem } from '../types';

// Mode Wallboard/TV — tampilan layar dinding ruang kontrol (NOC). Tema gelap
// kontras-tinggi, font besar, auto-rotate halaman perangkat, update real-time via socket.
const PAGE_SIZE = 24;      // perangkat per halaman
const ROTATE_MS = 12000;   // ganti halaman tiap 12 dtk
const STATUS_ORDER: Record<string, number> = { offline: 0, warning: 1, online: 2 };

const C = {
  online: '#22c55e', warning: '#f59e0b', offline: '#ef4444', dim: '#64748b',
};

export default function Wallboard() {
  const nav = useNavigate();
  const [devices, setDevices] = useState<Device[]>([]);
  const [services, setServices] = useState<ServiceItem[]>([]);
  const [now, setNow] = useState(() => new Date());
  const [page, setPage] = useState(0);
  const [fs, setFs] = useState(false);

  useEffect(() => {
    const load = () => {
      api.get('/devices').then((r) => setDevices(r.data.devices)).catch(() => {});
      api.get('/services').then((r) => setServices(r.data.services)).catch(() => {});
    };
    load();
    const socket = getSocket();
    const onUpdate = (d: Device) => setDevices((prev) => prev.map((x) => (x.id === d.id ? { ...x, ...d } : x)));
    const onServices = (list: ServiceItem[]) => setServices(list);
    socket.on('device:update', onUpdate);
    socket.on('services:update', onServices);
    const poll = setInterval(load, 30000);
    return () => { socket.off('device:update', onUpdate); socket.off('services:update', onServices); clearInterval(poll); };
  }, []);

  useEffect(() => { const t = setInterval(() => setNow(new Date()), 1000); return () => clearInterval(t); }, []);

  const sorted = useMemo(() => [...devices].sort((a, b) => (STATUS_ORDER[a.status] ?? 3) - (STATUS_ORDER[b.status] ?? 3) || a.name.localeCompare(b.name)), [devices]);
  const totalPages = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));

  // Auto-rotate halaman.
  useEffect(() => {
    if (totalPages <= 1) { setPage(0); return; }
    const t = setInterval(() => setPage((p) => (p + 1) % totalPages), ROTATE_MS);
    return () => clearInterval(t);
  }, [totalPages]);

  useEffect(() => {
    const onFs = () => setFs(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', onFs);
    return () => document.removeEventListener('fullscreenchange', onFs);
  }, []);
  const toggleFs = () => { if (document.fullscreenElement) document.exitFullscreen(); else document.documentElement.requestFullscreen?.(); };

  const online = devices.filter((d) => d.status === 'online').length;
  const warning = devices.filter((d) => d.status === 'warning').length;
  const offline = devices.filter((d) => d.status === 'offline').length;
  const pageDevices = sorted.slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE);
  const healthy = offline === 0 && warning === 0;

  return (
    <div style={{ minHeight: '100vh', background: '#0b0f14', color: '#e2e8f0', fontFamily: 'system-ui, sans-serif' }} className="p-5">
      {/* Header */}
      <div className="flex items-center justify-between gap-4 mb-4">
        <div className="flex items-center gap-3">
          <span style={{ fontSize: 30 }}>📡</span>
          <div>
            <div style={{ fontSize: 22, fontWeight: 800, letterSpacing: 0.5 }}>NetWatch <span style={{ color: '#38bdf8' }}>NOC</span></div>
            <div style={{ fontSize: 12, color: '#64748b' }}>Live Operations Wallboard</div>
          </div>
        </div>
        <div className="flex items-center gap-4">
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontSize: 30, fontWeight: 800, fontVariantNumeric: 'tabular-nums', lineHeight: 1 }}>{now.toLocaleTimeString('id-ID')}</div>
            <div style={{ fontSize: 12, color: '#94a3b8' }}>{now.toLocaleDateString('id-ID', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}</div>
          </div>
          <button onClick={toggleFs} title="Layar penuh" style={{ border: '1px solid #1e293b', borderRadius: 10, padding: '8px 12px', color: '#94a3b8', background: '#111823' }}>{fs ? '🗕' : '⛶'}</button>
          <button onClick={() => nav('/monitor')} title="Keluar" style={{ border: '1px solid #1e293b', borderRadius: 10, padding: '8px 12px', color: '#94a3b8', background: '#111823' }}>✕</button>
        </div>
      </div>

      {/* Banner kesehatan */}
      <div style={{
        borderRadius: 14, padding: '14px 20px', marginBottom: 16, fontWeight: 800, fontSize: 22, letterSpacing: 0.5,
        background: healthy ? 'rgba(34,197,94,0.12)' : offline > 0 ? 'rgba(239,68,68,0.14)' : 'rgba(245,158,11,0.14)',
        border: `1px solid ${healthy ? C.online : offline > 0 ? C.offline : C.warning}55`,
        color: healthy ? C.online : offline > 0 ? C.offline : C.warning,
      }}>
        {healthy ? '✓ SEMUA PERANGKAT OPERASIONAL' : offline > 0 ? `⚠ ${offline} PERANGKAT OFFLINE` : `● ${warning} PERANGKAT WARNING`}
      </div>

      {/* KPI besar */}
      <div className="grid grid-cols-4 gap-4 mb-4">
        {[
          { label: 'TOTAL', v: devices.length, c: '#e2e8f0' },
          { label: 'ONLINE', v: online, c: C.online },
          { label: 'WARNING', v: warning, c: C.warning },
          { label: 'OFFLINE', v: offline, c: C.offline },
        ].map((k) => (
          <div key={k.label} style={{ background: '#111823', border: '1px solid #1e293b', borderRadius: 14, padding: '16px 20px' }}>
            <div style={{ fontSize: 12, color: '#64748b', letterSpacing: 1, fontWeight: 700 }}>{k.label}</div>
            <div style={{ fontSize: 46, fontWeight: 900, color: k.c, lineHeight: 1.1, fontVariantNumeric: 'tabular-nums' }}>{k.v}</div>
          </div>
        ))}
      </div>

      {/* Layanan kritis */}
      {services.length > 0 && (
        <div className="flex gap-2 mb-4 flex-wrap">
          {services.map((s) => (
            <div key={s.id} style={{
              display: 'flex', alignItems: 'center', gap: 8, borderRadius: 10, padding: '8px 14px', fontSize: 14, fontWeight: 700,
              background: s.is_ok ? 'rgba(34,197,94,0.10)' : 'rgba(239,68,68,0.12)',
              border: `1px solid ${s.is_ok ? C.online : C.offline}44`, color: s.is_ok ? C.online : C.offline,
            }}>
              <span>{s.icon}</span>{s.name}
              <span style={{ color: s.is_ok ? C.online : C.offline }}>{s.is_ok ? '●' : '○'}</span>
            </div>
          ))}
        </div>
      )}

      {/* Grid perangkat (auto-rotate halaman) */}
      <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(230px, 1fr))' }}>
        {pageDevices.map((d) => {
          const c = d.status === 'offline' ? C.offline : d.status === 'warning' ? C.warning : C.online;
          return (
            <div key={d.id} style={{ background: '#111823', border: `1px solid #1e293b`, borderLeft: `4px solid ${c}`, borderRadius: 12, padding: '12px 14px' }}>
              <div className="flex items-center justify-between gap-2">
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 15, fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{d.name}</div>
                  <div style={{ fontSize: 11, color: '#64748b', fontFamily: 'monospace' }}>{d.ip}</div>
                </div>
                <span style={{ width: 12, height: 12, borderRadius: 999, background: c, boxShadow: `0 0 10px ${c}`, flexShrink: 0 }} />
              </div>
              {d.status !== 'offline' ? (
                <div className="flex gap-3 mt-2" style={{ fontSize: 12, color: '#94a3b8', fontVariantNumeric: 'tabular-nums' }}>
                  <span>CPU <b style={{ color: '#e2e8f0' }}>{d.cpu}%</b></span>
                  <span>RAM <b style={{ color: '#e2e8f0' }}>{d.mem}%</b></span>
                  <span>{d.ping_ms}ms</span>
                </div>
              ) : (
                <div style={{ fontSize: 12, color: C.offline, fontWeight: 700, marginTop: 8 }}>TIDAK MERESPONS</div>
              )}
            </div>
          );
        })}
      </div>

      {/* Footer: indikator halaman + live */}
      <div className="flex items-center justify-between mt-5" style={{ fontSize: 12, color: '#64748b' }}>
        <span className="flex items-center gap-2">
          <span style={{ position: 'relative', display: 'inline-flex', width: 8, height: 8 }}>
            <span style={{ position: 'absolute', inset: 0, borderRadius: 999, background: C.online, opacity: 0.6 }} className="animate-ping" />
            <span style={{ position: 'relative', width: 8, height: 8, borderRadius: 999, background: C.online }} />
          </span>
          Real-time via WebSocket
        </span>
        {totalPages > 1 && (
          <span className="flex items-center gap-1.5">
            {Array.from({ length: totalPages }).map((_, i) => (
              <span key={i} style={{ width: i === page ? 22 : 8, height: 6, borderRadius: 999, background: i === page ? '#38bdf8' : '#1e293b', transition: 'all .3s' }} />
            ))}
            <span style={{ marginLeft: 8 }}>Halaman {page + 1}/{totalPages}</span>
          </span>
        )}
      </div>
    </div>
  );
}
