import type { ReactNode } from 'react';
import type { Incident } from '../types';

const COLORS: Record<string, string> = {
  accent2: 'var(--color-accent2)', success: 'var(--color-success)', danger: 'var(--color-danger)',
  warn: 'var(--color-warn)', purple: '#a78bfa', accent: 'var(--color-accent)',
};

// Label & warna mutu skor (untuk ring berpendar).
export function scoreMeta(score: number): { label: string; color: string } {
  if (score >= 85) return { label: 'EXCELLENT', color: 'var(--color-success)' };
  if (score >= 70) return { label: 'BAIK', color: 'var(--color-success)' };
  if (score >= 40) return { label: 'CUKUP', color: 'var(--color-warn)' };
  return { label: 'KURANG', color: 'var(--color-danger)' };
}

// Badge perubahan vs bulan lalu (▲/▼ %). lowerBetter: nilai turun = bagus.
export function DeltaBadge({ cur, prev, lowerBetter = false }: { cur: number; prev: number; lowerBetter?: boolean }) {
  if (prev === 0 && cur === 0) return <span className="text-[9px] text-text2">— vs bln lalu</span>;
  const pct = prev === 0 ? (cur > 0 ? 100 : 0) : Math.round(((cur - prev) / Math.abs(prev)) * 100);
  if (pct === 0) return <span className="text-[9px] text-text2">0% vs bln lalu</span>;
  const up = pct > 0;
  const good = lowerBetter ? !up : up;
  return <span className={`text-[9px] font-semibold ${good ? 'text-success' : 'text-danger'}`}>{up ? '▲' : '▼'} {Math.abs(pct)}% <span className="text-text2 font-normal">vs bln lalu</span></span>;
}

// Sparkline mini untuk kartu metrik.
export function Spark({ data, color = 'accent2' }: { data?: number[]; color?: string }) {
  if (!data || data.length < 2 || data.every((v) => v === 0)) return null;
  const max = Math.max(...data, 1);
  const pts = data.map((v, i) => `${(i / (data.length - 1)) * 100},${16 - (v / max) * 14}`).join(' ');
  return (
    <svg viewBox="0 0 100 16" preserveAspectRatio="none" className="w-full h-4">
      <polyline points={pts} fill="none" stroke={COLORS[color] || color} strokeWidth="1.5" vectorEffect="non-scaling-stroke" opacity="0.9" />
    </svg>
  );
}

function Card({ title, right, children }: { title: string; right?: ReactNode; children: ReactNode }) {
  return (
    <div className="bg-surface border border-border rounded-xl p-4 h-full">
      <div className="flex items-center justify-between mb-3">
        <span className="text-[12px] font-bold tracking-wide">{title}</span>
        {right}
      </div>
      {children}
    </div>
  );
}

// ---- Trend multi-seri (garis) ----
export function TrendChart({ title, series, xLabels }: { title: string; series: { label: string; data: number[]; color: string }[]; xLabels?: string[] }) {
  const allVals = series.flatMap((s) => s.data);
  const max = Math.max(1, ...allVals);
  const toPts = (data: number[]) => data.map((v, i) => `${(i / Math.max(1, data.length - 1)) * 100},${36 - (v / max) * 32}`).join(' ');
  return (
    <Card title={title} right={
      <div className="flex gap-3 text-[10px] text-text2">
        {series.map((s) => <span key={s.label} className="flex items-center gap-1"><span className="w-2 h-2 rounded-full inline-block" style={{ background: COLORS[s.color] || s.color }} />{s.label}</span>)}
      </div>
    }>
      {allVals.every((v) => v === 0) ? (
        <div className="text-[11px] text-text2 py-8 text-center">Belum ada data tren.</div>
      ) : (
        <>
          <svg viewBox="0 0 100 40" preserveAspectRatio="none" className="w-full h-40">
            {[0.25, 0.5, 0.75].map((g) => <line key={g} x1="0" x2="100" y1={36 * g + 2} y2={36 * g + 2} stroke="var(--color-border)" strokeWidth="0.3" />)}
            {series.map((s) => (
              <polyline key={s.label} points={toPts(s.data)} fill="none" stroke={COLORS[s.color] || s.color} strokeWidth="1.4" vectorEffect="non-scaling-stroke" />
            ))}
          </svg>
          {xLabels && <div className="flex justify-between text-[9px] text-text2 mt-1">{xLabels.map((l, i) => <span key={i}>{l}</span>)}</div>}
        </>
      )}
    </Card>
  );
}

// ---- SLA & Ketepatan (donut + breakdown) ----
export function SlaBreakdown({ pct, target = 95, bars }: { pct: number; target?: number; bars: { label: string; value: number; color: string }[] }) {
  const ok = pct >= target;
  const ring = ok ? COLORS.success : COLORS.warn;
  return (
    <Card title="SLA & KETEPATAN">
      <div className="flex items-center gap-5">
        <div className="relative w-[110px] h-[110px] flex-shrink-0">
          <div className="w-full h-full rounded-full" style={{ background: `conic-gradient(${ring} ${pct * 3.6}deg, var(--color-border) 0deg)` }} />
          <div className="absolute inset-[12px] rounded-full bg-surface flex flex-col items-center justify-center">
            <div className={`text-2xl font-extrabold ${ok ? 'text-success' : 'text-warn'}`}>{pct}%</div>
            <div className="text-[8px] text-text2 uppercase">SLA Tercapai</div>
          </div>
        </div>
        <div className="flex-1 space-y-2.5">
          {bars.map((b) => (
            <div key={b.label}>
              <div className="flex justify-between text-[11px] mb-0.5"><span>{b.label}</span><span className="font-semibold">{b.value}%</span></div>
              <div className="h-1.5 bg-border rounded-full overflow-hidden"><div className="h-full rounded-full" style={{ width: `${Math.min(100, b.value)}%`, background: COLORS[b.color] || b.color }} /></div>
            </div>
          ))}
          <div className="text-[10px] text-text2 pt-1">🎯 Target SLA: <span className="text-accent2 font-semibold">{target}%</span></div>
        </div>
      </div>
    </Card>
  );
}

// ---- AI Insight ----
export function AIInsight({ items }: { items: { tone: 'ok' | 'warn' | 'danger' | 'info'; text: string }[] }) {
  const icon: Record<string, string> = { ok: '✅', warn: '⚠️', danger: '🔴', info: '💡' };
  return (
    <Card title="AI INSIGHT" right={<span className="text-[8px] px-1.5 py-0.5 rounded-full bg-accent2/20 text-accent2 font-bold">BETA</span>}>
      <ul className="space-y-2">
        {items.map((it, i) => (
          <li key={i} className="flex items-start gap-2 text-[11px]">
            <span>{icon[it.tone]}</span>
            <span className={it.tone === 'danger' ? 'text-danger' : it.tone === 'warn' ? 'text-warn' : 'text-text2'}>{it.text}</span>
          </li>
        ))}
      </ul>
      <div className="text-[9px] text-text2 mt-3 italic">* Analisis otomatis dari data — modul AI penuh belum aktif.</div>
    </Card>
  );
}

// ---- Insiden Terbaru ----
function ago(dateStr: string, now: number): string {
  const t = new Date(dateStr.replace(' ', 'T')).getTime();
  const m = Math.floor((now - t) / 60000);
  if (m < 1) return 'baru saja';
  if (m < 60) return `${m} menit lalu`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} jam lalu`;
  return `${Math.floor(h / 24)} hari lalu`;
}
const PRIO_BADGE: Record<string, string> = { kritis: 'bg-danger/15 text-danger', tinggi: 'bg-warn/15 text-warn', sedang: 'bg-success/15 text-success' };
const ST_BADGE: Record<string, string> = { aktif: 'bg-accent2/15 text-accent2', proses: 'bg-warn/15 text-warn', selesai: 'bg-success/15 text-success' };
const ST_LABEL: Record<string, string> = { aktif: 'Menunggu', proses: 'Dalam Proses', selesai: 'Selesai' };

export function RecentIncidents({ incidents, now, right }: { incidents: Incident[]; now: number; right?: ReactNode }) {
  const rows = [...incidents].sort((a, b) => new Date(b.created_at.replace(' ', 'T')).getTime() - new Date(a.created_at.replace(' ', 'T')).getTime()).slice(0, 6);
  return (
    <Card title="INSIDEN TERBARU" right={right}>
      {rows.length === 0 ? (
        <div className="text-[11px] text-text2 py-6 text-center">Belum ada insiden.</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-[11px]">
            <tbody>
              {rows.map((i) => (
                <tr key={i.id} className="border-b border-border/40 last:border-0">
                  <td className="py-1.5 pr-2"><span className={`text-[9px] px-1.5 py-0.5 rounded font-bold uppercase ${PRIO_BADGE[i.priority] || ''}`}>{i.priority}</span></td>
                  <td className="py-1.5 pr-2"><div className="font-semibold truncate max-w-[200px]">{i.issue}</div><div className="text-text2 text-[10px] truncate max-w-[200px]">{i.device_name}</div></td>
                  <td className="py-1.5 pr-2 text-text2 whitespace-nowrap">{ago(i.created_at, now)}</td>
                  <td className="py-1.5"><span className={`text-[9px] px-1.5 py-0.5 rounded font-semibold ${ST_BADGE[i.status] || ''}`}>{ST_LABEL[i.status] || i.status}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}
