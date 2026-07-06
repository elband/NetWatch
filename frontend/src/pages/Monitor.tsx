import { useEffect, useMemo, useState } from 'react';
import { api } from '../api/client';
import { getSocket } from '../api/socket';
import { DeviceStatusBadge } from '../components/StatusBadge';
import type { Device } from '../types';

type Filter = 'all' | 'online' | 'warning' | 'offline';

function meterColor(v: number) {
  return v > 85 ? 'bg-danger' : v > 70 ? 'bg-warn' : 'bg-success';
}
function pingColor(ms: number) {
  return ms > 50 ? 'bg-danger' : ms > 20 ? 'bg-warn' : 'bg-success';
}
// Ikon per tipe perangkat — sekadar pemanis visual (tak memengaruhi data).
function typeIcon(type = '') {
  const t = type.toLowerCase();
  if (t.includes('router')) return '📡';
  if (t.includes('switch')) return '🔀';
  if (t.includes('server')) return '🖥️';
  if (t.includes('access') || t.includes('wifi') || t.includes('wireless')) return '📶';
  if (t.includes('firewall')) return '🛡️';
  if (t.includes('camera') || t.includes('cctv')) return '📷';
  if (t.includes('ups')) return '🔋';
  if (t.includes('printer')) return '🖨️';
  return '🌐';
}

// Urutan tampil: masalah dulu (offline → warning → online) agar cepat terlihat.
const STATUS_ORDER: Record<string, number> = { offline: 0, warning: 1, online: 2 };

export default function Monitor() {
  const [devices, setDevices] = useState<Device[]>([]);
  const [filter, setFilter] = useState<Filter>('all');
  const [q, setQ] = useState('');

  useEffect(() => {
    api.get('/devices').then((res) => setDevices(res.data.devices));
    const socket = getSocket();
    const onUpdate = (d: Device) => setDevices((prev) => prev.map((x) => (x.id === d.id ? { ...x, ...d } : x)));
    socket.on('device:update', onUpdate);
    return () => { socket.off('device:update', onUpdate); };
  }, []);

  const counts = useMemo(() => {
    const c = { all: devices.length, online: 0, warning: 0, offline: 0 };
    for (const d of devices) if (d.status === 'online' || d.status === 'warning' || d.status === 'offline') c[d.status]++;
    return c;
  }, [devices]);

  const shown = useMemo(() => {
    const term = q.trim().toLowerCase();
    return devices
      .filter((d) => filter === 'all' || d.status === filter)
      .filter((d) => !term || d.name.toLowerCase().includes(term) || (d.ip || '').toLowerCase().includes(term) || (d.type || '').toLowerCase().includes(term))
      .sort((a, b) => (STATUS_ORDER[a.status] ?? 3) - (STATUS_ORDER[b.status] ?? 3) || a.name.localeCompare(b.name));
  }, [devices, filter, q]);

  const tiles: { k: Filter; label: string; n: number; dot: string; ring: string; tint: string; text: string }[] = [
    { k: 'all', label: 'Total', n: counts.all, dot: 'bg-accent2', ring: 'ring-accent2/40', tint: 'bg-accent2/10', text: 'text-accent2' },
    { k: 'online', label: 'Online', n: counts.online, dot: 'bg-success', ring: 'ring-success/40', tint: 'bg-success/10', text: 'text-success' },
    { k: 'warning', label: 'Warning', n: counts.warning, dot: 'bg-warn', ring: 'ring-warn/40', tint: 'bg-warn/10', text: 'text-warn' },
    { k: 'offline', label: 'Offline', n: counts.offline, dot: 'bg-danger', ring: 'ring-danger/40', tint: 'bg-danger/10', text: 'text-danger' },
  ];

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between gap-3 mb-4 flex-wrap">
        <div>
          <div className="text-[17px] font-bold flex items-center gap-2">
            📡 Live Monitor
            <span className="relative flex h-2 w-2" title="Real-time aktif">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-success/70" />
              <span className="relative inline-flex rounded-full h-2 w-2 bg-success" />
            </span>
          </div>
          <div className="text-[11px] text-text2 mt-0.5">Update real-time via WebSocket</div>
        </div>
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="🔍 Cari nama / IP / tipe…"
          className="bg-surface2 border border-border rounded-lg px-3 py-2 text-xs w-full sm:w-64 outline-none focus:border-accent transition-colors"
        />
      </div>

      {/* Ringkasan status — sekaligus tombol filter */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 mb-4">
        {tiles.map((t) => {
          const active = filter === t.k;
          return (
            <button
              key={t.k}
              type="button"
              onClick={() => setFilter(t.k)}
              className={`text-left rounded-xl px-4 py-3 transition-all ${active ? `${t.tint} ring-2 ${t.ring}` : 'bg-surface2 border border-border hover:border-text2/30 hover:-translate-y-0.5'}`}
            >
              <div className="flex items-center gap-1.5 mb-1">
                <span className={`h-2 w-2 rounded-full ${t.dot}`} />
                <span className="text-[10px] uppercase tracking-wide text-text2">{t.label}</span>
              </div>
              <div className={`text-2xl font-bold leading-none ${active ? t.text : 'text-text'}`}>{t.n}</div>
            </button>
          );
        })}
      </div>

      {/* Grid perangkat */}
      {shown.length === 0 ? (
        <div className="text-center py-12 text-text2 text-xs">Tidak ada perangkat yang cocok.</div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3.5">
          {shown.map((d) => {
            const crit = d.status === 'offline';
            const warn = d.status === 'warning';
            const box = crit ? 'border-danger/40 border-l-danger' : warn ? 'border-border border-l-warn' : 'border-border border-l-success';
            return (
              <div
                key={d.id}
                className={`bg-surface2 border border-l-4 ${box} rounded-xl p-4 min-w-0 shadow-sm hover:shadow-md hover:-translate-y-0.5 transition-all`}
              >
                <div className="flex justify-between items-start gap-2 mb-3">
                  <div className="flex items-center gap-2.5 min-w-0">
                    <div className="h-9 w-9 rounded-lg bg-surface border border-border flex items-center justify-center text-base flex-shrink-0">{typeIcon(d.type)}</div>
                    <div className="min-w-0">
                      <div className="text-xs font-semibold truncate">{d.name}</div>
                      <div className="text-[10px] text-text2 font-mono truncate">{d.ip} · {d.type}</div>
                    </div>
                  </div>
                  <div className="flex-shrink-0"><DeviceStatusBadge status={d.status} offReason={d.off_reason} monitorEnabled={d.monitor_enabled} underMaintenance={d.under_maintenance} /></div>
                </div>
                {!crit ? (
                  <div className="space-y-2">
                    {([['CPU', d.cpu], ['RAM', d.mem]] as [string, number][]).map(([label, val]) => (
                      <Meter key={label} label={label} value={`${val}%`} pct={val} color={meterColor(val)} />
                    ))}
                    <Meter label="Ping" value={`${d.ping_ms}ms`} pct={Math.min(d.ping_ms * 2, 100)} color={pingColor(d.ping_ms)} />
                  </div>
                ) : (
                  <div className="flex flex-col items-center justify-center py-5 gap-1">
                    <div className="text-2xl">⚠️</div>
                    <div className="text-danger text-xs font-semibold">Tidak Merespons</div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// Bar metrik: label + nilai + progress halus (animasi saat nilai berubah via socket).
function Meter({ label, value, pct, color }: { label: string; value: string; pct: number; color: string }) {
  return (
    <div>
      <div className="flex justify-between text-[10px] mb-1">
        <span className="text-text2">{label}</span>
        <span className="font-mono font-semibold">{value}</span>
      </div>
      <div className="h-1.5 bg-border/70 rounded-full overflow-hidden">
        <div className={`h-full ${color} rounded-full transition-[width] duration-500 ease-out`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}
