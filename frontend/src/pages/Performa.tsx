import { useEffect, useMemo, useState } from 'react';
import { api } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { hasRole } from '../utils/roles';
import PerformaDetailModal from '../components/PerformaDetailModal';
import type { PerformaDashboard } from '../types';

function recentMonths(count = 12) {
  const now = new Date();
  const out: { value: string; label: string }[] = [{ value: '', label: 'Seluruh waktu' }];
  for (let i = 0; i < count; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    out.push({ value: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`, label: d.toLocaleDateString('id-ID', { month: 'long', year: 'numeric' }) });
  }
  return out;
}

const scoreColor = (s: number) => (s >= 70 ? '#22c55e' : s >= 50 ? '#eab308' : '#ef4444');
const gradeColor = (g: string) => (g.startsWith('A') ? '#22c55e' : g === 'B' ? '#4ade80' : g === 'C' ? '#eab308' : g === 'D' ? '#f97316' : '#ef4444');

// Gauge lingkaran ber-animasi.
function Gauge({ score, grade, label }: { score: number; grade: string; label: string }) {
  const [val, setVal] = useState(0);
  useEffect(() => { const t = setTimeout(() => setVal(score), 60); return () => clearTimeout(t); }, [score]);
  const r = 70, c = 2 * Math.PI * r, off = c * (1 - val / 100);
  const col = scoreColor(score);
  return (
    <div className="relative w-[180px] h-[180px]">
      <svg viewBox="0 0 180 180" className="w-full h-full -rotate-90">
        <circle cx="90" cy="90" r={r} fill="none" stroke="#1e293b" strokeWidth="14" />
        <circle cx="90" cy="90" r={r} fill="none" stroke={col} strokeWidth="14" strokeLinecap="round" strokeDasharray={c} strokeDashoffset={off} style={{ transition: 'stroke-dashoffset 1s cubic-bezier(.4,0,.2,1)', filter: `drop-shadow(0 0 6px ${col}80)` }} />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <div className="text-[40px] font-extrabold leading-none" style={{ color: col }}>{score}</div>
        <div className="text-[10px] text-slate-400 mt-0.5">/ 100</div>
        <div className="mt-1 px-2.5 py-0.5 rounded-full text-[11px] font-bold" style={{ background: `${gradeColor(grade)}22`, color: gradeColor(grade) }}>{grade} · {label}</div>
      </div>
    </div>
  );
}

function StatCard({ label, value, tone, icon }: { label: string; value: number; tone: 'good' | 'warn' | 'bad' | 'neutral'; icon: string }) {
  const c = tone === 'good' ? '#22c55e' : tone === 'warn' ? '#eab308' : tone === 'bad' ? '#ef4444' : '#60a5fa';
  return (
    <div className="nw-card rounded-xl border p-3.5 bg-[#0f1729]" style={{ borderColor: `${c}30` }}>
      <div className="flex items-center justify-between">
        <span className="text-[11px] text-slate-400">{label}</span>
        <span className="text-sm">{icon}</span>
      </div>
      <div className="text-[26px] font-extrabold mt-1" style={{ color: c }}>{value}</div>
      <div className="h-1 rounded-full mt-1.5" style={{ background: `${c}25` }}><div className="h-full rounded-full" style={{ background: c, width: `${Math.min(100, value * 8)}%` }} /></div>
    </div>
  );
}

// Area chart sederhana (SVG) untuk trend 30 hari.
function AreaChart({ data }: { data: { date: string; points: number }[] }) {
  const W = 720, H = 150, pad = 4;
  const vals = data.map((d) => d.points);
  const max = Math.max(1, ...vals), min = Math.min(0, ...vals);
  const range = max - min || 1;
  const x = (i: number) => pad + (i * (W - pad * 2)) / Math.max(1, data.length - 1);
  const y = (v: number) => H - pad - ((v - min) / range) * (H - pad * 2 - 12);
  const line = data.map((d, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(d.points).toFixed(1)}`).join(' ');
  const area = `${line} L${x(data.length - 1).toFixed(1)},${H - pad} L${x(0).toFixed(1)},${H - pad} Z`;
  const zeroY = y(0);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" preserveAspectRatio="none" style={{ height: 150 }}>
      <defs><linearGradient id="ar" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#60a5fa" stopOpacity="0.45" /><stop offset="100%" stopColor="#60a5fa" stopOpacity="0" /></linearGradient></defs>
      {min < 0 && <line x1={pad} y1={zeroY} x2={W - pad} y2={zeroY} stroke="#334155" strokeWidth="1" strokeDasharray="3 3" />}
      <path d={area} fill="url(#ar)" />
      <path d={line} fill="none" stroke="#60a5fa" strokeWidth="2" />
    </svg>
  );
}

export default function Performa() {
  const { user } = useAuth();
  const canPick = hasRole(user, 'admin', 'koordinator');
  const months = useMemo(() => recentMonths(), []);
  const [month, setMonth] = useState('');
  const [techId, setTechId] = useState<number | undefined>(undefined);
  const [data, setData] = useState<PerformaDashboard | null>(null);
  const [detailFor, setDetailFor] = useState<number | null>(null);

  useEffect(() => {
    const q = new URLSearchParams();
    if (month) q.set('month', month);
    if (techId) q.set('techId', String(techId));
    api.get(`/performa/dashboard?${q.toString()}`).then((r) => setData(r.data)).catch(() => setData(null));
  }, [month, techId]);

  const s = data?.self;
  const insightColor = (t: string) => (t === 'good' ? 'border-emerald-500/30 bg-emerald-500/5 text-emerald-300' : t === 'warn' ? 'border-amber-500/30 bg-amber-500/5 text-amber-300' : 'border-rose-500/30 bg-rose-500/5 text-rose-300');

  return (
    <div className="text-slate-200">
      <div className="flex items-center justify-between mb-4 gap-3 flex-wrap">
        <div>
          <div className="text-[18px] font-bold tracking-tight">📊 Performa Teknisi · NOC Dashboard</div>
          <div className="text-[11px] text-slate-400 mt-0.5">Penilaian skor 0–100 · target SLA {data?.slaMinutes ?? 30} menit{s ? ` · Peringkat #${data?.rankPos}/${data?.totalTechs}` : ''}</div>
        </div>
        <div className="flex items-center gap-2">
          {canPick && data && (
            <select className="bg-[#0f1729] border border-slate-700 rounded-md px-3 py-2 text-xs" value={techId ?? ''} onChange={(e) => setTechId(e.target.value ? Number(e.target.value) : undefined)}>
              {data.ranking.map((r) => <option key={r.techId} value={r.techId}>{r.name}</option>)}
            </select>
          )}
          <select className="bg-[#0f1729] border border-slate-700 rounded-md px-3 py-2 text-xs" value={month} onChange={(e) => setMonth(e.target.value)}>
            {months.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
          </select>
        </div>
      </div>

      {!data || !s ? (
        <div className="text-center text-slate-500 py-20 text-sm">Memuat data performa…</div>
      ) : (
        <div className="space-y-4 nw-stagger">
          {s.vpnFlag && (
            <div className="rounded-xl border border-rose-500/40 bg-rose-500/10 text-rose-300 px-4 py-3 text-[12px] font-semibold">
              ⚠️ Penalti aktif: terdeteksi {s.vpnDays} hari absensi memakai VPN / lokasi tidak sesuai. Skor performa bulan ini dikurangi 50% (dari {s.scoreBeforePenalty} → {s.score}).
            </div>
          )}
          {/* Baris 1: Gauge + Stat cards */}
          <div className="grid lg:grid-cols-[300px_1fr] gap-4">
            <div className="nw-card rounded-2xl border border-slate-800 bg-[#0b1220] p-5 flex flex-col items-center justify-center">
              <div className="text-[12px] text-slate-400 mb-2 font-semibold">{s.emoji} {s.name}</div>
              <Gauge score={s.score} grade={s.grade} label={s.gradeLabel} />
              <button onClick={() => setDetailFor(s.techId)} className="mt-3 text-[11px] text-sky-300 hover:underline">🔍 Rincian perhitungan skor</button>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 content-start nw-stagger">
              <StatCard label="Tiket Selesai" value={s.done} tone="good" icon="✅" />
              <StatCard label="Tepat SLA" value={s.onTime} tone="good" icon="⏱️" />
              <StatCard label="Pelanggaran SLA" value={s.breaches} tone={s.breaches > 0 ? 'bad' : 'neutral'} icon="🚫" />
              <StatCard label="Insiden Kritis" value={s.kritisDone} tone="good" icon="🔥" />
              <StatCard label="Preventive Maint." value={s.pm} tone={s.pm > 0 ? 'good' : 'warn'} icon="🛠️" />
              <StatCard label="Dokumentasi" value={s.dokumentasi} tone={s.dokumentasi > 0 ? 'good' : 'warn'} icon="📑" />
              <StatCard label="Eskalasi" value={s.eskalasi} tone={s.eskalasi > 0 ? 'warn' : 'neutral'} icon="⤴️" />
              <StatCard label="Reopen" value={s.reopen} tone={s.reopen > 0 ? 'bad' : 'neutral'} icon="🔁" />
            </div>
          </div>

          {/* Baris 2: Trend 30 hari + SLA bulanan */}
          <div className="grid lg:grid-cols-[1fr_360px] gap-4">
            <div className="nw-card rounded-2xl border border-slate-800 bg-[#0b1220] p-4">
              <div className="text-[12px] font-semibold text-slate-300 mb-1">📈 Trend Performa 30 Hari <span className="text-slate-500 font-normal">(poin bersih harian)</span></div>
              <AreaChart data={data.trend30} />
              <div className="flex justify-between text-[9px] text-slate-500 mt-1"><span>{data.trend30[0]?.date.slice(5)}</span><span>{data.trend30[data.trend30.length - 1]?.date.slice(5)}</span></div>
            </div>
            <div className="nw-card rounded-2xl border border-slate-800 bg-[#0b1220] p-4">
              <div className="text-[12px] font-semibold text-slate-300 mb-3">📊 SLA Bulanan</div>
              <div className="flex items-end justify-between gap-2 h-[130px]">
                {data.slaMonthly.map((m) => {
                  const pct = m.pct ?? 0;
                  const col = m.pct == null ? '#334155' : pct >= 90 ? '#22c55e' : pct >= 70 ? '#eab308' : '#ef4444';
                  return (
                    <div key={m.month} className="flex-1 flex flex-col items-center gap-1">
                      <div className="text-[9px]" style={{ color: col }}>{m.pct == null ? '–' : `${pct}%`}</div>
                      <div className="w-full rounded-t" style={{ height: `${Math.max(3, pct)}%`, background: col, minHeight: 3 }} />
                      <div className="text-[9px] text-slate-500">{m.label}</div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          {/* Baris 3: AI Insight + Top5 teknisi + Top5 layanan */}
          <div className="grid lg:grid-cols-3 gap-4">
            <div className="nw-card rounded-2xl border border-slate-800 bg-[#0b1220] p-4">
              <div className="text-[12px] font-semibold text-slate-300 mb-3">🤖 AI Insight & Rekomendasi</div>
              <div className="space-y-2">
                {data.insight.map((ins, i) => (
                  <div key={i} className={`text-[11px] rounded-lg border px-3 py-2 ${insightColor(ins.type)}`}>{ins.type === 'good' ? '✓ ' : ins.type === 'warn' ? '⚠ ' : '✗ '}{ins.text}</div>
                ))}
                {!data.insight.length && <div className="text-slate-500 text-[11px]">Belum ada data cukup untuk insight.</div>}
              </div>
            </div>

            <div className="nw-card rounded-2xl border border-slate-800 bg-[#0b1220] p-4">
              <div className="text-[12px] font-semibold text-slate-300 mb-3">🏆 Top 5 Teknisi Terbaik</div>
              <div className="space-y-1.5">
                {data.top5.map((r, i) => (
                  <button key={r.techId} onClick={() => setTechId(r.techId)} className={`w-full flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-left ${r.techId === s.techId ? 'bg-sky-500/10 border border-sky-500/30' : 'hover:bg-white/5'}`}>
                    <span className={`w-5 text-center font-bold ${i === 0 ? 'text-amber-400' : 'text-slate-500'}`}>{i + 1}</span>
                    <span className="flex-1 text-[12px] truncate">{r.emoji} {r.name}</span>
                    <span className="text-[10px] px-1.5 py-0.5 rounded font-bold" style={{ background: `${gradeColor(r.grade)}22`, color: gradeColor(r.grade) }}>{r.grade}</span>
                    <span className="font-bold text-[13px] w-7 text-right" style={{ color: scoreColor(r.score) }}>{r.score}</span>
                  </button>
                ))}
              </div>
            </div>

            <div className="nw-card rounded-2xl border border-slate-800 bg-[#0b1220] p-4">
              <div className="text-[12px] font-semibold text-slate-300 mb-3">🖥️ Top 5 Layanan Ditangani</div>
              <div className="space-y-2">
                {data.topServices.map((sv) => {
                  const maxN = Math.max(1, ...data.topServices.map((x) => x.count));
                  return (
                    <div key={sv.name}>
                      <div className="flex items-center justify-between text-[11px] mb-0.5">
                        <span className="truncate">{sv.name} <span className="text-[9px] text-slate-500">bobot {sv.weight}</span></span>
                        <span className="font-bold text-slate-300">{sv.count}</span>
                      </div>
                      <div className="h-1.5 rounded-full bg-slate-800"><div className="h-full rounded-full bg-sky-500" style={{ width: `${(sv.count / maxN) * 100}%` }} /></div>
                    </div>
                  );
                })}
                {!data.topServices.length && <div className="text-slate-500 text-[11px]">Belum ada insiden tertangani.</div>}
              </div>
            </div>
          </div>

          {/* Ranking lengkap */}
          <div className="nw-card rounded-2xl border border-slate-800 bg-[#0b1220] overflow-x-auto">
            <div className="text-[12px] font-semibold text-slate-300 px-4 pt-4 pb-2">📋 Ranking Teknisi</div>
            <table className="w-full text-xs">
              <thead><tr className="text-slate-500 uppercase text-[10px] border-b border-slate-800">
                {['#', 'Teknisi', 'Selesai', 'Tepat SLA', 'Kritis', 'PM', 'Dok', 'Langgar', 'Eskalasi', 'Grade', 'Skor', ''].map((h) => <th key={h} className="px-3 py-2 text-left">{h}</th>)}
              </tr></thead>
              <tbody>
                {data.ranking.map((r, i) => (
                  <tr key={r.techId} className={`border-b border-slate-800/60 ${r.techId === s.techId ? 'bg-sky-500/5' : ''}`}>
                    <td className="px-3 py-2 font-bold text-slate-500">{i + 1}</td>
                    <td className="px-3 py-2">{r.emoji} <strong>{r.name}</strong></td>
                    <td className="px-3 py-2 text-center text-emerald-400">{r.done}</td>
                    <td className="px-3 py-2 text-center text-emerald-400">{r.onTime}</td>
                    <td className="px-3 py-2 text-center">{r.kritisDone}</td>
                    <td className="px-3 py-2 text-center text-sky-400">{r.pm}</td>
                    <td className="px-3 py-2 text-center text-sky-400">{r.dokumentasi}</td>
                    <td className={`px-3 py-2 text-center ${r.breaches > 0 ? 'text-rose-400' : 'text-slate-500'}`}>{r.breaches}</td>
                    <td className={`px-3 py-2 text-center ${r.eskalasi > 0 ? 'text-amber-400' : 'text-slate-500'}`}>{r.eskalasi}</td>
                    <td className="px-3 py-2 text-center"><span className="px-1.5 py-0.5 rounded font-bold text-[10px]" style={{ background: `${gradeColor(r.grade)}22`, color: gradeColor(r.grade) }}>{r.grade}</span></td>
                    <td className="px-3 py-2 font-extrabold" style={{ color: scoreColor(r.score) }}>{r.score}</td>
                    <td className="px-3 py-2"><button onClick={() => setDetailFor(r.techId)} className="text-slate-500 hover:text-text text-[10px] border border-slate-700 rounded px-1.5 py-0.5">🔍</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="text-[10px] text-slate-500">
            Rumus: 30 + selesai×2 + tepat SLA×4 + kritis×6 + PM×3 + dok×5 − pelanggaran×10 − eskalasi×5 − reopen×8 − absen×15 (dibatasi 0–100). Grade: A+ ≥90 · A ≥80 · B ≥70 · C ≥60 · D ≥50 · E &lt;50.
          </div>
        </div>
      )}

      {detailFor != null && <PerformaDetailModal techId={detailFor} month={month || undefined} onClose={() => setDetailFor(null)} />}
    </div>
  );
}
