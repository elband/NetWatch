// Gauge lingkaran (donut) untuk skor performa persen 0–100 + grade.
// Warna mengikuti grade. score null → "Belum dinilai".
export interface ScoreComponent { key: string; label: string; weight: number; value: number | null }

const gradeColor = (score: number) =>
  score >= 90 ? '#16a34a' : score >= 75 ? '#22a355' : score >= 60 ? '#d97706' : score >= 50 ? '#ea580c' : '#dc2626';

export default function ScoreGauge({ score, grade, size = 128, label }: { score: number | null; grade: string; size?: number; label?: string }) {
  const stroke = Math.round(size * 0.1);
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const pctVal = score == null ? 0 : Math.max(0, Math.min(100, score));
  const color = score == null ? '#94a3b8' : gradeColor(score);
  const dash = (pctVal / 100) * c;

  return (
    <div className="inline-flex flex-col items-center" style={{ width: size }}>
      <div className="relative" style={{ width: size, height: size }}>
        <svg width={size} height={size} className="-rotate-90">
          <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="currentColor" className="text-border/60" strokeWidth={stroke} />
          <circle
            cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth={stroke} strokeLinecap="round"
            strokeDasharray={`${dash} ${c - dash}`} style={{ transition: 'stroke-dasharray .5s ease' }}
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          {score == null ? (
            <span className="text-[11px] font-semibold text-text2 text-center px-2">Belum dinilai</span>
          ) : (
            <>
              <span className="font-extrabold leading-none" style={{ fontSize: size * 0.3, color }}>{score}</span>
              <span className="uppercase tracking-wide font-semibold mt-0.5" style={{ fontSize: size * 0.09, color }}>{grade}</span>
            </>
          )}
        </div>
      </div>
      {label && <div className="text-[12px] font-semibold text-text mt-1 text-center max-w-[140px] truncate">{label}</div>}
    </div>
  );
}

// Rincian komponen skor (progress bar per komponen) — untuk popover/detail.
export function ScoreBreakdown({ components }: { components: ScoreComponent[] }) {
  return (
    <div className="space-y-1.5">
      {components.map((c) => (
        <div key={c.key} className="text-[11px]">
          <div className="flex items-center justify-between">
            <span className="text-text2">{c.label} <span className="opacity-60">({c.weight}%)</span></span>
            <span className="font-semibold">{c.value == null ? '–' : `${c.value}%`}</span>
          </div>
          <div className="h-1.5 rounded-full bg-border/50 mt-0.5 overflow-hidden">
            <div className="h-full rounded-full" style={{ width: `${c.value ?? 0}%`, background: c.value == null ? '#94a3b8' : gradeColor(c.value) }} />
          </div>
        </div>
      ))}
      {components.some((c) => c.value == null) && (
        <div className="text-[10px] text-text2 italic pt-0.5">Komponen "–" tidak ada tugasnya bulan ini → tidak dihitung (bobot dibagi ke komponen lain).</div>
      )}
    </div>
  );
}
