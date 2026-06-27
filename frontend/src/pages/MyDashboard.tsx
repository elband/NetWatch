import { useEffect, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api/client';
import { useAuth } from '../context/AuthContext';
import ProgressUpdateModal from '../components/ProgressUpdateModal';
import InviteCollabModal from '../components/InviteCollabModal';
import PerformaDetailModal from '../components/PerformaDetailModal';
import ActivityModal, { activityStatusBadge } from '../components/ActivityModal';
import LocationMap from '../components/LocationMap';
import AbsenCard from '../components/AbsenCard';
import { TrendChart, SlaBreakdown, AIInsight, RecentIncidents, scoreMeta, DeltaBadge, Spark } from '../components/DashboardExtras';
import { getSocket } from '../api/socket';
import { stepLabel, nextStepLabel, progressPct, maxStep } from '../utils/steps';
import type { Incident, IncidentQueue, PerformaRow, Device, Asset, ServiceItem, LocationItem, MonthlyStats, Activity } from '../types';

const PURPLE = '#a78bfa';

const thisMonth = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
};
const dateKey = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const fmtDur = (min: number) => (min >= 60 ? `${Math.floor(min / 60)}j ${min % 60}m` : `${min}m`);
const slaHours = (p: string) => (p === 'kritis' ? 1 : p === 'tinggi' ? 2 : 4);
function slaDeadline(inc: Incident) {
  return new Date(inc.created_at.replace(' ', 'T')).getTime() + slaHours(inc.priority) * 3600000;
}
function fmtCountdown(ms: number) {
  if (ms <= 0) return 'LEWAT';
  const s = Math.floor(ms / 1000);
  const hh = String(Math.floor(s / 3600)).padStart(2, '0');
  const mm = String(Math.floor((s % 3600) / 60)).padStart(2, '0');
  const ss = String(s % 60).padStart(2, '0');
  return `${hh}:${mm}:${ss}`;
}

export default function MyDashboard() {
  const { user } = useAuth();
  const [queue, setQueue] = useState<IncidentQueue | null>(null);
  const [perf, setPerf] = useState<PerformaRow | null>(null);
  const [slaMin, setSlaMin] = useState(30);
  const [devices, setDevices] = useState<Device[]>([]);
  const [assets, setAssets] = useState<Asset[]>([]);
  const [services, setServices] = useState<ServiceItem[]>([]);
  const [locations, setLocations] = useState<LocationItem[]>([]);
  const [stats, setStats] = useState<MonthlyStats | null>(null);
  const [now, setNow] = useState(() => new Date());
  const [busy, setBusy] = useState<string | null>(null);
  const [progressFor, setProgressFor] = useState<Incident | null>(null);
  const [inviteFor, setInviteFor] = useState<Incident | null>(null);
  const [showDetail, setShowDetail] = useState(false);
  const [activities, setActivities] = useState<Activity[]>([]);
  const [showActivity, setShowActivity] = useState(false);
  const [prevPerf, setPrevPerf] = useState<PerformaRow | null>(null);
  const [spark, setSpark] = useState<Record<string, number[]>>({});
  const month = thisMonth();
  const prevMonth = (() => { const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() - 1); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; })();

  function load() {
    api.get('/incidents/queue').then((res) => setQueue(res.data));
    api.get('/devices').then((res) => setDevices(res.data.devices));
    api.get('/assets/mine').then((res) => setAssets(res.data.assets));
    api.get('/services').then((res) => setServices(res.data.services));
    api.get('/locations').then((res) => { setLocations(res.data.locations); });
    api.get('/activities/mine').then((res) => setActivities(res.data.activities));
    api.get(`/dashboard/monthly?month=${month}`).then((res) => setStats(res.data));
    if (user) {
      api.get(`/performa?month=${month}`).then((res) => {
        setSlaMin(res.data.slaMinutes || 30);
        setPerf(res.data.performa.find((p: PerformaRow) => p.techId === user.id) || null);
      });
      api.get(`/performa?month=${prevMonth}`).then((res) => {
        setPrevPerf(res.data.performa.find((p: PerformaRow) => p.techId === user.id) || null);
      }).catch(() => {});
      api.get(`/performa/sparkline?month=${month}`).then((res) => setSpark(res.data.spark)).catch(() => {});
    }
  }
  useEffect(load, [user]);
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);
  useEffect(() => {
    const socket = getSocket();
    const onServices = (list: ServiceItem[]) => setServices(list);
    socket.on('services:update', onServices);
    return () => { socket.off('services:update', onServices); };
  }, []);

  async function action(id: string, kind: 'take' | 'advance') {
    setBusy(id + kind);
    try {
      await api.post(`/incidents/${id}/${kind}`);
      load();
    } finally {
      setBusy(null);
    }
  }

  function exportCsv() {
    const rows: [string, string | number][] = [
      ['Periode', month], ['Teknisi', user?.name || ''], ['Skor', perf?.score ?? 0],
      ['Selesai', perf?.done ?? 0], ['Diambil', perf?.taken ?? 0], ['Tepat SLA', perf?.onTime ?? 0],
      ['Inspeksi', perf?.inspections ?? 0], ['Langgar SLA', perf?.breaches ?? 0],
      ['Avg Respons (menit)', perf?.avgResp ?? 0], ['Avg Durasi (menit)', perf?.avgDur ?? 0],
    ];
    const csv = 'Metrik,Nilai\n' + rows.map(([k, v]) => `"${k}",${v}`).join('\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8;' }));
    const a = document.createElement('a'); a.href = url; a.download = `performa-${user?.username || 'saya'}-${month}.csv`; a.click();
    URL.revokeObjectURL(url);
  }

  const duty = queue?.duty;
  const pool = queue?.pool || [];
  const mine = queue?.mine || [];
  const mineActive = mine.filter((i) => i.status !== 'selesai');
  const todayKey = dateKey(now);
  const doneToday = mine.filter((i) => i.status === 'selesai' && i.resolved_at?.startsWith(todayKey)).length;
  const waitingSparepart = mine.filter((i) => i.awaiting_part && i.status !== 'selesai').length;
  const slaPct = perf && perf.onTime + perf.breaches > 0 ? Math.round((perf.onTime / (perf.onTime + perf.breaches)) * 100) : 100;
  const score = perf?.score ?? 0;
  const scoreColor = score >= 70 ? 'text-success' : score >= 40 ? 'text-warn' : 'text-danger';
  const scoreRing = score >= 70 ? 'var(--color-success)' : score >= 40 ? 'var(--color-warn)' : 'var(--color-danger)';
  const monthLabel = new Date(month + '-01').toLocaleDateString('id-ID', { month: 'long', year: 'numeric' });

  // gabungan insiden untuk panel (yang saya tangani + pool), prioritas dulu
  const activeAll = [...mineActive, ...pool].sort(
    (a, b) => ['kritis', 'tinggi', 'sedang'].indexOf(a.priority) - ['kritis', 'tinggi', 'sedang'].indexOf(b.priority)
  );
  const byPrio = (p: string) => activeAll.filter((i) => i.priority === p);

  // perangkat untuk donut & legend
  const onlineCount = devices.filter((d) => d.status !== 'offline').length;
  const offlineCount = devices.filter((d) => d.status === 'offline').length;
  const typeEmoji: Record<string, string> = { Switch: '🔀', Router: '📶', AP: '📡', 'Access Point': '📡', Server: '🖧', Firewall: '🧱', NAS: '💾', CCTV: '📹' };
  const types = [...new Set(devices.map((d) => d.type))];
  const donutDeg = devices.length ? Math.round((onlineCount / devices.length) * 360) : 0;

  return (
    <div className="space-y-4 nw-stagger">
      {/* ===== Absensi hari ini ===== */}
      <AbsenCard />

      {/* ===== Performa bulan ini ===== */}
      <div className="nw-card bg-gradient-to-br from-accent/10 to-accent2/8 border border-accent/25 rounded-xl p-5">
        <div className="flex items-center justify-between mb-4 gap-2 flex-wrap">
          <span className="text-[13px] font-bold">📊 Performa Bulan Ini · {monthLabel}</span>
          <div className="flex items-center gap-3">
            <button onClick={() => setShowDetail(true)} className="border border-accent/40 text-accent rounded-md px-2.5 py-1 text-[11px] font-semibold hover:bg-accent/10">🔍 Detail Perhitungan</button>
            <button onClick={exportCsv} className="border border-accent2/40 text-accent2 rounded-md px-2.5 py-1 text-[11px] font-semibold hover:bg-accent2/10">⬇️ Ekspor</button>
            <span className="text-[10px] text-text2">Target SLA {slaMin} menit</span>
          </div>
        </div>
        <div className="flex items-center gap-6 flex-wrap">
          <div className="relative w-[112px] h-[112px] flex-shrink-0">
            <div className="w-full h-full rounded-full" style={{ background: `conic-gradient(${scoreRing} ${score * 3.6}deg, var(--color-border) 0deg)`, boxShadow: `0 0 22px ${scoreRing}66` }} />
            <div className="absolute inset-[12px] rounded-full bg-surface flex flex-col items-center justify-center">
              <div className={`text-3xl font-extrabold ${scoreColor}`}>{score}</div>
              <div className="text-[8px] font-bold tracking-wide" style={{ color: scoreRing }}>{scoreMeta(score).label}</div>
            </div>
          </div>
          <div className="flex-1 grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-3 min-w-[260px]">
            <Metric label="Selesai" value={perf?.done ?? 0} color="text-success" spark={spark.done} sparkColor="success" extra={<DeltaBadge cur={perf?.done ?? 0} prev={prevPerf?.done ?? 0} />} />
            <Metric label="Diambil" value={perf?.taken ?? 0} color="text-accent2" spark={spark.taken} sparkColor="accent2" extra={<DeltaBadge cur={perf?.taken ?? 0} prev={prevPerf?.taken ?? 0} />} />
            <Metric label="Tepat SLA" value={perf?.onTime ?? 0} color="text-success" spark={spark.onTime} sparkColor="success" extra={<DeltaBadge cur={perf?.onTime ?? 0} prev={prevPerf?.onTime ?? 0} />} />
            <Metric label="Inspeksi" value={perf?.inspections ?? 0} color="text-accent2" spark={spark.inspections} sparkColor="accent2" extra={<DeltaBadge cur={perf?.inspections ?? 0} prev={prevPerf?.inspections ?? 0} />} />
            <Metric label="Langgar SLA" value={perf?.breaches ?? 0} color={(perf?.breaches ?? 0) > 0 ? 'text-danger' : 'text-text2'} spark={spark.breaches} sparkColor="danger" extra={<DeltaBadge cur={perf?.breaches ?? 0} prev={prevPerf?.breaches ?? 0} lowerBetter />} />
            <Metric label="Avg Respons" value={`${perf?.avgResp ?? 0}m`} color="text-warn" spark={spark.avgResp} sparkColor="warn" extra={<DeltaBadge cur={perf?.avgResp ?? 0} prev={prevPerf?.avgResp ?? 0} lowerBetter />} />
            <Metric label="Avg Durasi" value={fmtDur(perf?.avgDur ?? 0)} color="text-accent2" spark={spark.avgDur} sparkColor="purple" extra={<DeltaBadge cur={perf?.avgDur ?? 0} prev={prevPerf?.avgDur ?? 0} lowerBetter />} />
          </div>
        </div>
        <div className="text-[10px] text-text2 mt-3">
          💡 Skor mulai 30 · +2 selesai, +4 tepat SLA, +6 kritis, +3 PM, +5 dokumentasi · −10 pelanggaran SLA (insiden on-duty tak diambil dalam {slaMin} menit), −5 eskalasi, −15 absen (hanya alpa yang dikonfirmasi koordinator) · lokasi/VPN palsu −50%. Dibatasi 0–100.
        </div>
      </div>

      {/* ===== Monitoring infrastruktur — di bawah performa ===== */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Panel title="STATUS PERANGKAT">
          <div className="flex items-center gap-6">
            <div className="relative w-[130px] h-[130px] flex-shrink-0">
              <div className="w-full h-full rounded-full" style={{ background: `conic-gradient(var(--color-success) 0deg ${donutDeg}deg, var(--color-danger) ${donutDeg}deg 360deg)` }} />
              <div className="absolute inset-[18px] rounded-full bg-surface flex flex-col items-center justify-center">
                <div className="text-2xl font-extrabold">{devices.length}</div>
                <div className="text-[9px] text-text2 uppercase">Perangkat</div>
              </div>
            </div>
            <div className="flex-1 text-[11px]">
              <div className="flex justify-between text-text2 text-[10px] uppercase border-b border-border pb-1 mb-1"><span>Jenis</span><span>Online / Offline</span></div>
              {types.map((t) => {
                const on = devices.filter((d) => d.type === t && d.status !== 'offline').length;
                const off = devices.filter((d) => d.type === t && d.status === 'offline').length;
                return (
                  <div key={t} className="flex justify-between py-0.5">
                    <span>{typeEmoji[t] || '🔌'} {t}</span>
                    <span><span className="text-success">{on}</span> / <span className={off ? 'text-danger' : 'text-text2'}>{off}</span></span>
                  </div>
                );
              })}
              <div className="flex justify-between py-1 mt-1 border-t border-border font-semibold">
                <span>Total</span><span><span className="text-success">{onlineCount}</span> / <span className="text-danger">{offlineCount}</span></span>
              </div>
            </div>
          </div>

          {/* Monitoring layanan kritis (digabung) */}
          <div className="mt-4 pt-3 border-t border-border">
            <div className="flex items-center justify-between mb-2">
              <span className="text-[11px] font-bold tracking-wide text-text2">🛰️ MONITORING LAYANAN KRITIS</span>
              <span className="text-[10px] text-text2">{services.length} layanan</span>
            </div>
            {services.length === 0 ? (
              <div className="text-[11px] text-text2 py-2 text-center">Belum ada layanan.</div>
            ) : (
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2.5">
                {services.map((s) => (
                  <div key={s.id} className={`rounded-lg border p-2.5 text-center ${s.is_ok ? 'border-success/25 bg-success/5' : 'border-danger/30 bg-danger/10'}`}>
                    <div className="text-lg mb-0.5">{s.icon}</div>
                    <div className="text-[10px] font-semibold truncate">{s.name}</div>
                    <div className={`text-[10px] font-bold ${s.is_ok ? 'text-success' : 'text-danger'}`}>{s.status}</div>
                    <div className="text-[9px] text-text2 truncate">{s.detail}</div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </Panel>

        <Panel title="PETA LOKASI GANGGUAN" right={<Link to="/master" className="text-[11px] text-text2 hover:text-text">Kelola →</Link>}>
          {locations.length === 0 ? (
            <div className="text-[11px] text-text2 py-4 text-center">Belum ada lokasi. Tambahkan di Master Data (admin).</div>
          ) : (
            <LocationMap locations={locations} />
          )}
        </Panel>
      </div>

      {/* ===== Kartu statistik atas ===== */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3.5">
        <StatCard label="AKTIF" value={mineActive.length} sub="Tiket sedang dikerjakan" color="text-danger" accent="border-danger/30" icon="🎫" />
        <StatCard label="SELESAI HARI INI" value={doneToday} sub="Tiket terselesaikan" color="text-success" accent="border-success/30" icon="✅" />
        <StatCard label="MENUNGGU SPAREPART" value={waitingSparepart} sub="Tiket pending" color="text-warn" accent="border-warn/30" icon="📦" />
        <StatCard label="SLA TERCAPAI" value={`${slaPct}%`} sub="SLA bulan ini" color="text-accent2" accent="border-accent2/30" icon="📈" />
        <StatCard label="RATA-RATA MTTR" value={fmtDur(perf?.avgDur ?? 0)} sub="Mean Time To Repair" color="" accent="border-border" icon="⏱️" purple />
      </div>

      {/* ===== Pool insiden (belum diambil) ===== */}
      <Panel title={`POOL INSIDEN (BELUM DIAMBIL) · ${pool.length}`} right={<Link to="/my-incidents" className="text-[11px] text-accent hover:underline">Lihat Semua →</Link>}>
        {pool.length === 0 ? (
          <div className="text-center py-4 text-success text-xs">✅ Tidak ada insiden menunggu di pool.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead><tr className="text-text2 uppercase text-[10px] border-b border-border">
                {['ID', 'Perangkat', 'Masalah', 'Prioritas', 'Terputus', 'Masuk', 'Aksi'].map((h) => <th key={h} className="px-2 py-2 text-left">{h}</th>)}
              </tr></thead>
              <tbody>
                {pool.map((i) => {
                  const age = Math.floor((now.getTime() - new Date(i.created_at.replace(' ', 'T')).getTime()) / 60000);
                  return (
                    <tr key={i.id} className="border-b border-border/40">
                      <td className="px-2 py-2 font-mono text-accent2 text-[10px]">{i.id}</td>
                      <td className="px-2 py-2 font-semibold">{i.device_name}</td>
                      <td className="px-2 py-2 text-text2 max-w-[200px] truncate">{i.issue}</td>
                      <td className="px-2 py-2"><span className={`text-[9px] px-1.5 py-0.5 rounded font-bold uppercase ${i.priority === 'kritis' ? 'bg-danger/15 text-danger' : i.priority === 'tinggi' ? 'bg-warn/15 text-warn' : 'bg-success/15 text-success'}`}>{i.priority}</span></td>
                      <td className="px-2 py-2 font-mono text-warn">⏱️ {fmtDur(age)}</td>
                      <td className="px-2 py-2 text-text2 font-mono text-[10px]">{i.created_at}</td>
                      <td className="px-2 py-2">
                        <button
                          disabled={!duty?.onDuty || busy === i.id + 'take'}
                          title={duty?.onDuty ? '' : 'Hanya bisa saat on-duty'}
                          className="bg-success text-bg rounded px-2.5 py-1 text-[11px] font-semibold disabled:opacity-40 disabled:cursor-not-allowed"
                          onClick={() => action(i.id, 'take')}
                        >
                          {busy === i.id + 'take' ? '…' : '✋ Ambil'}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      {/* ===== Baris tengah: prioritas | insiden aktif | sidebar ===== */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Prioritas hari ini */}
        <Panel title="PRIORITAS HARI INI" right={<Link to="/my-incidents" className="text-[11px] text-accent hover:underline">Lihat Semua →</Link>}>
          {(['kritis', 'tinggi', 'sedang'] as const).map((p) => {
            const list = byPrio(p);
            const meta = p === 'kritis' ? { c: 'text-danger', d: 'bg-danger', t: 'CRITICAL' } : p === 'tinggi' ? { c: 'text-warn', d: 'bg-warn', t: 'HIGH' } : { c: 'text-success', d: 'bg-success', t: 'MEDIUM' };
            return (
              <div key={p} className="mb-3 last:mb-0">
                <div className="flex items-center gap-1.5 mb-1.5">
                  <span className={`w-2 h-2 rounded-full ${meta.d}`} />
                  <span className={`text-[11px] font-bold ${meta.c}`}>{meta.t} ({list.length})</span>
                </div>
                {list.length === 0 ? (
                  <div className="text-[11px] text-text2 pl-3.5">—</div>
                ) : (
                  list.slice(0, 4).map((i) => (
                    <div key={i.id} className="flex items-center justify-between gap-2 pl-3.5 py-1">
                      <span className="text-[11px] truncate">{i.device_name}</span>
                      <span className={`text-[9px] px-1.5 py-0.5 rounded font-semibold ${i.tech_id ? 'bg-warn/15 text-warn' : 'bg-accent2/15 text-accent2'}`}>{i.tech_id ? 'Proses' : 'Baru'}</span>
                    </div>
                  ))
                )}
              </div>
            );
          })}
        </Panel>

        {/* Insiden aktif */}
        <Panel title="INSIDEN AKTIF" right={<Link to="/my-incidents" className="text-[11px] text-accent hover:underline">Lihat Semua →</Link>}>
          {activeAll.length === 0 ? (
            <div className="text-center py-8 text-success text-xs">✅ Tidak ada insiden aktif!</div>
          ) : (
            activeAll.slice(0, 3).map((i) => {
              const remaining = slaDeadline(i) - now.getTime();
              const pct = progressPct(i);
              const nextLabel = nextStepLabel(i);
              const dev = devices.find((d) => d.id === i.device_id);
              const remotable = !!dev?.ssh_username;
              return (
                <div key={i.id} className="border border-border rounded-lg p-3 mb-2.5 last:mb-0">
                  <div className="flex items-center justify-between gap-2 mb-2">
                    <span className="text-[12px] font-semibold flex items-center gap-1.5">🔴 {i.device_name}</span>
                    <span className="text-[9px] px-1.5 py-0.5 rounded font-bold uppercase bg-danger/15 text-danger">{i.priority}</span>
                  </div>
                  <div className="grid grid-cols-[64px_1fr] gap-y-1 text-[11px] mb-2">
                    <span className="text-text2">Masalah</span><span className="truncate">{i.issue}</span>
                    <span className="text-text2">SLA</span><span className={`font-mono font-bold ${remaining < 900000 ? 'text-danger' : 'text-warn'}`}>{fmtCountdown(remaining)}</span>
                    <span className="text-text2">Tahap</span><span className="truncate">{stepLabel(i, i.step)}</span>
                    <span className="text-text2">Progress</span>
                    <div className="flex items-center gap-2">
                      <div className="flex-1 h-1.5 bg-border rounded-full overflow-hidden"><div className="h-full bg-accent" style={{ width: `${pct}%` }} /></div>
                      <span className="text-text2">{pct}%</span>
                    </div>
                    <span className="text-text2">Dibuat</span><span className="font-mono text-text2">{i.created_at}</span>
                  </div>
                  <div className="flex gap-2">
                    {remotable && (
                      <Link to={`/ssh?device=${i.device_id}&incident=${i.id}`} title="Remote SSH Virtual" className="text-center border border-accent2/40 text-accent2 rounded px-2 py-1 text-[11px] font-semibold hover:bg-accent2/10">🖥️ SSH</Link>
                    )}
                    <Link to="/my-incidents" className="flex-1 text-center border border-border rounded px-2 py-1 text-[11px] text-text2 hover:text-text">Detail</Link>
                    {i.tech_id === user?.id && i.status !== 'selesai' && (
                      <button title="Ajak teknisi lain (kerjakan bersama)" className="border border-accent2/40 text-accent2 rounded px-2 py-1 text-[11px] font-semibold hover:bg-accent2/10" onClick={() => setInviteFor(i)}>👥</button>
                    )}
                    {i.tech_id ? (
                      <button title={`Lanjut ke: ${nextLabel}`} className="flex-1 bg-accent text-bg rounded px-2 py-1 text-[11px] font-semibold disabled:opacity-50" onClick={() => setProgressFor(i)}>
                        {`▶ ${nextLabel}`}
                      </button>
                    ) : (
                      <button disabled={!duty?.onDuty || busy === i.id + 'take'} title={duty?.onDuty ? '' : 'Hanya saat on-duty'} className="flex-1 bg-success text-bg rounded px-2 py-1 text-[11px] font-semibold disabled:opacity-40" onClick={() => action(i.id, 'take')}>
                        {busy === i.id + 'take' ? '…' : '✋ Ambil'}
                      </button>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </Panel>

        {/* Sidebar kanan */}
        <div className="space-y-4">
          <Panel title="AI ASSISTANT" badge="BETA">
            <p className="text-[11px] text-text2 leading-relaxed">
              {byPrio('kritis').length > 0
                ? `${byPrio('kritis').length} insiden kritis aktif. Fokuskan penanganan pada perangkat berprioritas tertinggi lebih dulu.`
                : 'Tidak ada insiden kritis saat ini. Pantau pool untuk insiden masuk.'}
            </p>
            <div className="text-[11px] text-accent2 font-semibold mt-2 mb-1">Rekomendasi:</div>
            <ol className="text-[11px] text-text2 list-decimal pl-4 space-y-0.5">
              <li>Ambil insiden prioritas tertinggi di pool.</li>
              <li>Perbarui progres tiap langkah penanganan.</li>
              <li>Isi laporan kerusakan & perbaikan saat selesai.</li>
            </ol>
            <div className="text-[9px] text-text2 mt-2 italic">* Analisis contoh — modul AI belum aktif</div>
          </Panel>

          <Panel title="TUGAS SAYA" right={<Link to="/my-incidents" className="text-[11px] text-accent hover:underline">Lihat Semua →</Link>}>
            {mineActive.length === 0 ? (
              <div className="text-[11px] text-text2">Tidak ada tugas aktif.</div>
            ) : (
              mineActive.slice(0, 4).map((i) => (
                <div key={i.id} className="flex items-center gap-2 py-1.5 border-b border-border/40 last:border-0">
                  <span className="w-3.5 h-3.5 rounded border border-border flex-shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="text-[11px] truncate">{i.device_name}</div>
                    <div className="text-[9px] text-text2">Prioritas: <span className={i.priority === 'kritis' ? 'text-danger' : i.priority === 'tinggi' ? 'text-warn' : 'text-accent2'}>{i.priority}</span></div>
                  </div>
                  <span className="text-[9px] text-text2 font-mono">{i.step}/{maxStep(i)} · {stepLabel(i, i.step)}</span>
                </div>
              ))
            )}

            {/* Kegiatan lain (rapat/lembur/dll) — perlu persetujuan koordinator */}
            <div className="mt-3 pt-3 border-t border-border/60">
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-[11px] font-semibold text-text2">📋 KEGIATAN LAIN</span>
                <button onClick={() => setShowActivity(true)} className="text-[10px] border border-accent/40 text-accent rounded px-2 py-0.5 hover:bg-accent/10">+ Ajukan</button>
              </div>
              {activities.length === 0 ? (
                <div className="text-[10px] text-text2">Belum ada pengajuan kegiatan.</div>
              ) : (
                activities.slice(0, 4).map((a) => {
                  const b = activityStatusBadge(a.status);
                  return (
                    <div key={a.id} className="flex items-center gap-2 py-1 border-b border-border/30 last:border-0">
                      <div className="flex-1 min-w-0">
                        <div className="text-[11px] truncate">{a.title}{a.bukti_url && <a href={a.bukti_url} target="_blank" rel="noreferrer" title="Bukti dukung" className="ml-1 text-accent2">📎</a>}</div>
                        <div className="text-[9px] text-text2 capitalize">{a.type} · {a.activity_date}{a.start_time ? ` ${a.start_time}` : ''}</div>
                      </div>
                      <span className={`text-[9px] px-1.5 py-0.5 rounded font-semibold ${b.bg} ${b.c}`}>{b.t}</span>
                    </div>
                  );
                })
              )}
            </div>
          </Panel>

          <Panel title="INVENTARIS SAYA" right={<span className="text-[11px] text-text2">{assets.length} item</span>}>
            {assets.length === 0 ? (
              <div className="text-[11px] text-text2">Belum ada aset terdaftar atas nama Anda.</div>
            ) : (
              assets.map((it) => (
                <div key={it.id} className="flex items-center justify-between gap-2 py-1.5 border-b border-border/40 last:border-0">
                  <span className="text-[11px] flex items-center gap-2 truncate">{it.icon} {it.name}</span>
                  <span className="text-[10px] text-text2 whitespace-nowrap">{it.qty} {it.unit}</span>
                </div>
              ))
            )}
          </Panel>
        </div>
      </div>

      {/* ===== Statistik bulan ini (data nyata) ===== */}
      <Panel title="STATISTIK BULAN INI" right={<span className="text-[11px] text-text2">{stats ? new Date(stats.month + '-01').toLocaleDateString('id-ID', { month: 'long', year: 'numeric' }) : '—'}</span>}>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <MiniStat label="TIKET MASUK" value={String(stats?.totals.totalIn ?? 0)} delta="bulan ini"><Bars data={stats?.ticketsIn || []} color="var(--color-accent2)" /></MiniStat>
          <MiniStat label="TIKET SELESAI" value={String(stats?.totals.totalDone ?? 0)} delta="bulan ini"><Bars data={stats?.ticketsDone || []} color="var(--color-success)" /></MiniStat>
          <MiniStat label="SLA (%)" value={`${stats?.totals.avgSla ?? 100}%`} delta="rata-rata"><Line data={stats?.slaTrend || []} color="var(--color-accent2)" /></MiniStat>
          <MiniStat label="MTTR" value={fmtDur(stats?.totals.avgMttr ?? 0)} delta="rata-rata"><Line data={stats?.mttrTrend || []} color={PURPLE} /></MiniStat>
        </div>
      </Panel>

      {/* ===== Analitik tambahan ===== */}
      {(() => {
        const total = (perf?.onTime ?? 0) + (perf?.breaches ?? 0);
        const tepat = total ? Math.round(((perf?.onTime ?? 0) / total) * 100) : 100;
        const labels = stats ? ['1', `${Math.ceil(stats.daysInMonth / 3)}`, `${Math.ceil((stats.daysInMonth * 2) / 3)}`, `${stats.daysInMonth}`] : [];
        const insights: { tone: 'ok' | 'warn' | 'danger' | 'info'; text: string }[] = [
          byPrio('kritis').length > 0 ? { tone: 'danger', text: `${byPrio('kritis').length} insiden kritis aktif — tangani lebih dulu.` } : { tone: 'ok', text: 'Tidak ada insiden kritis aktif.' },
          pool.length > 0 ? { tone: 'warn', text: `${pool.length} insiden di pool menunggu diambil.` } : { tone: 'ok', text: 'Pool insiden kosong.' },
          (perf?.breaches ?? 0) > 0 ? { tone: 'warn', text: `${perf?.breaches} pelanggaran SLA bulan ini — percepat respon.` } : { tone: 'ok', text: 'Belum ada pelanggaran SLA bulan ini.' },
          { tone: 'info', text: 'Perbarui progres tiap tindakan & lengkapi foto dokumentasi.' },
        ];
        return (
          <>
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
              <SlaBreakdown pct={slaPct} bars={[{ label: 'Tepat SLA', value: tepat, color: 'success' }, { label: 'Langgar SLA', value: 100 - tepat, color: 'danger' }]} />
              <div className="lg:col-span-2"><TrendChart title="TREND BULAN INI" xLabels={labels} series={[{ label: 'Tiket Masuk', data: stats?.ticketsIn || [], color: 'accent2' }, { label: 'Tiket Selesai', data: stats?.ticketsDone || [], color: 'success' }]} /></div>
            </div>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <AIInsight items={insights} />
              <RecentIncidents incidents={activeAll} now={now.getTime()} right={<Link to="/my-incidents" className="text-[11px] text-accent hover:underline">Lihat Semua →</Link>} />
            </div>
          </>
        );
      })()}

      {/* Status bar bawah */}
      <div className="bg-surface border border-border rounded-xl px-5 py-3 flex items-center gap-6 flex-wrap text-[11px]">
        <span className="flex items-center gap-1.5 font-semibold"><span className="relative flex h-2 w-2"><span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-success opacity-75" /><span className="relative inline-flex rounded-full h-2 w-2 bg-success" /></span>Sistem Online</span>
        <span className="text-text2">🎫 Aktif: <b className="text-danger">{mineActive.length}</b></span>
        <span className="text-text2">✅ Selesai Hari Ini: <b className="text-success">{doneToday}</b></span>
        <span className="text-text2">📈 SLA Tercapai: <b className="text-accent2">{slaPct}%</b></span>
        <span className="text-text2">⏱️ MTTR: <b className="text-accent2">{fmtDur(perf?.avgDur ?? 0)}</b></span>
        <span className="ml-auto text-text2">Skor: <b style={{ color: scoreRing }}>{score}</b> · {scoreMeta(score).label}</span>
      </div>

      {progressFor && <ProgressUpdateModal incident={progressFor} onClose={() => setProgressFor(null)} onDone={load} />}
      {inviteFor && <InviteCollabModal incident={inviteFor} onClose={() => setInviteFor(null)} onDone={load} />}
      {showDetail && user && <PerformaDetailModal techId={user.id} month={month} onClose={() => setShowDetail(false)} />}
      {showActivity && <ActivityModal onClose={() => setShowActivity(false)} onDone={load} />}
    </div>
  );
}

// ===================== sub-komponen =====================
function StatCard({ label, value, sub, color, accent, icon, purple }: { label: string; value: number | string; sub: string; color: string; accent: string; icon: string; purple?: boolean }) {
  return (
    <div className={`nw-card bg-surface border ${accent} rounded-xl p-4`}>
      <div className="flex items-center justify-between mb-2">
        <span className="text-[10px] text-text2 uppercase font-semibold">{label}</span>
        <span className="text-base">{icon}</span>
      </div>
      <div className={`text-2xl font-extrabold ${color}`} style={purple ? { color: PURPLE } : undefined}>{value}</div>
      <div className="text-[10px] text-text2 mt-0.5">{sub}</div>
    </div>
  );
}

function Metric({ label, value, color, spark, sparkColor, extra }: { label: string; value: number | string; color: string; spark?: number[]; sparkColor?: string; extra?: ReactNode }) {
  return (
    <div className="nw-card bg-surface/60 border border-border rounded-lg px-3 py-2">
      <div className={`text-lg font-extrabold ${color}`}>{value}</div>
      <div className="text-[10px] text-text2 uppercase mt-0.5">{label}</div>
      {spark && <div className="mt-1 -mb-0.5"><Spark data={spark} color={sparkColor} /></div>}
      {extra && <div className="mt-0.5">{extra}</div>}
    </div>
  );
}

function Panel({ title, right, badge, children }: { title: string; right?: ReactNode; badge?: string; children: ReactNode }) {
  return (
    <div className="nw-card bg-surface border border-border rounded-xl p-4">
      <div className="flex items-center justify-between mb-3">
        <span className="font-head text-[12px] font-bold tracking-wide flex items-center gap-2">
          {title}
          {badge && <span className="text-[8px] px-1.5 py-0.5 rounded-full bg-accent2/20 text-accent2 font-bold">{badge}</span>}
        </span>
        {right}
      </div>
      {children}
    </div>
  );
}

function MiniStat({ label, value, delta, children }: { label: string; value: string; delta: string; children: ReactNode }) {
  return (
    <div>
      <div className="text-[10px] text-text2 uppercase mb-0.5">{label}</div>
      <div className="text-xl font-extrabold mb-0.5">{value} <span className="text-[10px] text-success font-normal">{delta}</span></div>
      {children}
    </div>
  );
}

function Bars({ data, color }: { data: number[]; color: string }) {
  const max = Math.max(...data, 1);
  return (
    <div className="flex items-end gap-[2px] h-14 mt-1">
      {data.map((v, i) => <div key={i} className="flex-1 rounded-sm" style={{ height: `${(v / max) * 100}%`, background: color, opacity: 0.85 }} />)}
    </div>
  );
}

function Line({ data, color }: { data: number[]; color: string }) {
  const max = Math.max(...data), min = Math.min(...data);
  const range = max - min || 1;
  const pts = data.map((v, i) => `${(i / (data.length - 1)) * 100},${30 - ((v - min) / range) * 28}`).join(' ');
  return (
    <svg viewBox="0 0 100 30" preserveAspectRatio="none" className="w-full h-14 mt-1">
      <polyline points={pts} fill="none" stroke={color} strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}
