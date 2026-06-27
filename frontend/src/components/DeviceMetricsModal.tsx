import { useEffect, useState } from 'react';
import { api } from '../api/client';
import type { Device, DeviceMetricPoint } from '../types';

type Range = '24h' | '7d' | '30d';
const RANGES: { key: Range; label: string }[] = [
  { key: '24h', label: '24 Jam' },
  { key: '7d', label: '7 Hari' },
  { key: '30d', label: '30 Hari' },
];

interface Summary { samples: number; up_pct: number | null; avg_ping: number | null; max_ping: number | null }

// Grafik garis sederhana berbasis SVG (tanpa dependensi chart).
function LineChart({ series, accessor, color, unit, height = 120 }: {
  series: DeviceMetricPoint[];
  accessor: (p: DeviceMetricPoint) => number | null;
  color: string;
  unit: string;
  height?: number;
}) {
  const W = 600, H = height, padL = 36, padB = 18, padT = 8, padR = 8;
  const pts = series.map((p) => accessor(p)).map((v) => (v == null ? null : Number(v)));
  const valid = pts.filter((v): v is number => v != null);
  if (!valid.length) {
    return <div className="text-[11px] text-text2 py-8 text-center">Belum ada data pada rentang ini.</div>;
  }
  const max = Math.max(...valid, 1);
  const min = Math.min(...valid, 0);
  const span = max - min || 1;
  const innerW = W - padL - padR, innerH = H - padT - padB;
  const x = (i: number) => padL + (series.length <= 1 ? innerW / 2 : (i / (series.length - 1)) * innerW);
  const y = (v: number) => padT + innerH - ((v - min) / span) * innerH;

  // Bangun path hanya untuk titik valid (putus saat null = data hilang).
  let d = '';
  pts.forEach((v, i) => {
    if (v == null) { d += ''; return; }
    d += `${d && pts[i - 1] != null ? 'L' : 'M'}${x(i).toFixed(1)} ${y(v).toFixed(1)} `;
  });

  const ticks = [min, min + span / 2, max];
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" preserveAspectRatio="none" style={{ height }}>
      {ticks.map((t, i) => (
        <g key={i}>
          <line x1={padL} x2={W - padR} y1={y(t)} y2={y(t)} stroke="var(--color-border)" strokeWidth="0.5" />
          <text x={padL - 4} y={y(t) + 3} textAnchor="end" fontSize="9" fill="var(--color-text2)">{Math.round(t)}{unit}</text>
        </g>
      ))}
      <path d={d.trim()} fill="none" stroke={color} strokeWidth="1.5" strokeLinejoin="round" />
    </svg>
  );
}

export default function DeviceMetricsModal({ device, onClose }: { device: Device; onClose: () => void }) {
  const [range, setRange] = useState<Range>('24h');
  const [series, setSeries] = useState<DeviceMetricPoint[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    api.get(`/devices/${device.id}/metrics`, { params: { range } })
      .then((r) => { if (!alive) return; setSeries(r.data.series || []); setSummary(r.data.summary || null); })
      .catch(() => { if (alive) { setSeries([]); setSummary(null); } })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [device.id, range]);

  const hasSnmp = series.some((p) => p.avg_cpu != null || p.avg_mem != null);
  const uptime = summary?.up_pct;
  const uptimeColor = uptime == null ? 'text-text2' : uptime >= 99 ? 'text-success' : uptime >= 95 ? 'text-warn' : 'text-danger';

  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-surface border border-border rounded-xl w-full max-w-2xl max-h-[90vh] flex flex-col overflow-hidden" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 pt-5 pb-3 border-b border-border shrink-0">
          <div className="min-w-0">
            <h3 className="text-sm font-bold truncate">📈 Tren Metrik — {device.name}</h3>
            <div className="text-[10px] text-text2 font-mono mt-0.5">{device.ip}</div>
          </div>
          <button type="button" className="text-text2 hover:text-text text-lg leading-none" onClick={onClose}>×</button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
          {/* Rentang */}
          <div className="flex gap-1">
            {RANGES.map((r) => (
              <button key={r.key} onClick={() => setRange(r.key)}
                className={`px-3 py-1 rounded-md text-[11px] border ${range === r.key ? 'bg-accent text-bg border-accent font-semibold' : 'bg-surface2 text-text2 border-border'}`}>
                {r.label}
              </button>
            ))}
          </div>

          {/* Ringkasan */}
          <div className="grid grid-cols-3 gap-2">
            <Stat label="Uptime" value={uptime == null ? '–' : `${uptime}%`} className={uptimeColor} />
            <Stat label="Latency rata-rata" value={summary?.avg_ping == null ? '–' : `${summary.avg_ping} ms`} />
            <Stat label="Latency maks" value={summary?.max_ping == null ? '–' : `${summary.max_ping} ms`} />
          </div>

          {loading ? (
            <div className="text-[11px] text-text2 py-8 text-center">Memuat…</div>
          ) : (
            <>
              <ChartBlock title="Latency (ms)">
                <LineChart series={series} accessor={(p) => p.avg_ping} color="var(--color-accent2)" unit="" />
              </ChartBlock>
              <ChartBlock title="Uptime per bucket (%)">
                <LineChart series={series} accessor={(p) => p.up_pct} color="var(--color-success)" unit="" />
              </ChartBlock>
              {hasSnmp && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <ChartBlock title="CPU (%) · SNMP">
                    <LineChart series={series} accessor={(p) => p.avg_cpu} color="var(--color-warn)" unit="" height={100} />
                  </ChartBlock>
                  <ChartBlock title="Memori (%) · SNMP">
                    <LineChart series={series} accessor={(p) => p.avg_mem} color="var(--color-danger)" unit="" height={100} />
                  </ChartBlock>
                </div>
              )}
              {!hasSnmp && (
                <div className="text-[10px] text-text2 bg-surface2 border border-border rounded-md px-3 py-2">
                  💡 CPU/Memori riil belum tersedia. Aktifkan <b>SNMP</b> pada pengaturan perangkat untuk merekam beban CPU & memori.
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value, className }: { label: string; value: string; className?: string }) {
  return (
    <div className="bg-surface2 border border-border rounded-md px-3 py-2">
      <div className="text-[10px] text-text2">{label}</div>
      <div className={`text-sm font-bold mt-0.5 ${className || ''}`}>{value}</div>
    </div>
  );
}

function ChartBlock({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-[11px] text-text2 mb-1">{title}</div>
      <div className="bg-surface2 border border-border rounded-md p-2">{children}</div>
    </div>
  );
}
