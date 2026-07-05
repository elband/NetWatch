// Gauge lingkaran (donut) untuk skor performa persen 0–100 + grade.
// Warna mengikuti grade. score null → "Belum dinilai".
export interface ScoreComponent { key: string; label: string; weight: number; value: number | null; num?: number; den?: number; note?: string }

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

// Penjelasan LENGKAP perhitungan skor: angka mentah tiap komponen + kontribusi ke skor akhir.
// Dipakai teknisi untuk memahami dari mana angka performanya berasal.
export function ScoreExplain({ score, grade, components }: { score: number | null; grade: string; components: ScoreComponent[] }) {
  const active = components.filter((c) => c.value != null);
  const wsum = active.reduce((s, c) => s + c.weight, 0);
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-4">
        <ScoreGauge score={score} grade={grade} size={104} />
        <div className="text-[12px] text-text2">
          Skor = <b className="text-text">rata-rata pencapaian target</b> tiap komponen, ditimbang bobotnya.
          {active.length < components.length && <> Komponen tanpa tugas bulan ini <b>tidak dihitung</b> — bobotnya dibagi ke komponen lain.</>}
        </div>
      </div>
      <div className="space-y-2">
        {components.map((c) => {
          const contrib = c.value == null || !wsum ? null : Math.round((c.weight / wsum) * c.value * 10) / 10;
          const effW = c.value == null || !wsum ? 0 : Math.round((c.weight / wsum) * 100);
          return (
            <div key={c.key} className={`rounded-lg border p-2.5 ${c.value == null ? 'border-border/50 bg-surface2/50' : 'border-border bg-surface2'}`}>
              <div className="flex items-center justify-between text-[12px]">
                <span className="font-semibold">{c.label}</span>
                <span className="font-bold">{c.value == null ? '– (tidak dihitung)' : `${c.value}%`}</span>
              </div>
              {c.note && <div className="text-[11px] text-text2 mt-0.5">{c.note}{c.den ? ` → ${c.value}%` : ''}</div>}
              <div className="flex items-center justify-between text-[10px] text-text2 mt-1">
                <span>Bobot {c.weight}%{c.value != null && effW !== c.weight ? ` → efektif ${effW}%` : ''}</span>
                {contrib != null && <span>Menyumbang <b className="text-text">+{contrib}</b> ke skor</span>}
              </div>
            </div>
          );
        })}
      </div>
      {score != null && (
        <div className="text-[11px] text-text2 border-t border-border pt-2">
          Total kontribusi = <b className="text-text">{score}</b> → grade <b className="text-text">{grade}</b>.
          Skala: ≥90 Sangat Baik · 75–89 Baik · 60–74 Cukup · 50–59 Kurang · &lt;50 Perlu Pembinaan.
        </div>
      )}
    </div>
  );
}
