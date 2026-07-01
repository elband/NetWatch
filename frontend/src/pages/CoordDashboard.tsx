import { useEffect, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api/client';
import { getSocket } from '../api/socket';
import { activityStatusBadge } from '../components/ActivityModal';
import LocationMap from '../components/LocationMap';
import { DeviceStatusBadge } from '../components/StatusBadge';
import { promptDialog } from '../components/dialog';
import { TrendChart, SlaBreakdown, AIInsight, RecentIncidents, scoreMeta, DeltaBadge, Spark } from '../components/DashboardExtras';
import type { Incident, Device, LocationItem, ServiceItem, MonthlyStats, Activity, PerformaRow } from '../types';

const PURPLE = '#a78bfa';
const fmtDur = (min: number) => (min >= 60 ? `${Math.floor(min / 60)}j ${min % 60}m` : `${min}m`);
const typeEmoji: Record<string, string> = { Switch: '🔀', Router: '📶', AP: '📡', 'Access Point': '📡', Server: '🖧', Firewall: '🧱', NAS: '💾', CCTV: '📹' };

interface CoordData {
  month: string;
  coordSlaMinutes: number;
  coordBreachMinutes: number;
  slaMinutes: number;
  active: Incident[];
  stats: { totalActive: number; unclaimed: number; breaching: number; inProgress: number; doneToday: number };
  performa: { totalIn: number; taken: number; takenOnTime: number; reminders: number; breaches: number; avgClaim: number; score: number };
}

const PRIO = ['kritis', 'tinggi', 'sedang'] as const;
const fmtAge = (min: number) => (min >= 60 ? `${Math.floor(min / 60)}j ${min % 60}m` : `${min}m`);

export default function CoordDashboard() {
  const [data, setData] = useState<CoordData | null>(null);
  const [devices, setDevices] = useState<Device[]>([]);
  const [performa, setPerforma] = useState<PerformaRow[]>([]);
  const [locations, setLocations] = useState<LocationItem[]>([]);
  const [services, setServices] = useState<ServiceItem[]>([]);
  const [stats, setStats] = useState<MonthlyStats | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [reminding, setReminding] = useState<string | null>(null);
  const [teknisiList, setTeknisiList] = useState<{ id: number; name: string; emoji?: string | null }[]>([]);
  const [showRincian, setShowRincian] = useState(false);
  const [activities, setActivities] = useState<Activity[]>([]);
  const [acting, setActing] = useState<number | null>(null);
  const [toast, setToast] = useState('');
  const [prev, setPrev] = useState<CoordData['performa'] | null>(null);
  const [spark, setSpark] = useState<Record<string, number[]>>({});
  const month = (() => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; })();
  const prevMonth = (() => { const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() - 1); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; })();

  function load() {
    api.get('/dashboard/coordinator').then((res) => setData(res.data)).catch(() => {});
    api.get(`/dashboard/coordinator?month=${prevMonth}`).then((res) => setPrev(res.data.performa)).catch(() => {});
    api.get('/dashboard/coordinator-sparkline').then((res) => setSpark(res.data.spark)).catch(() => {});
    api.get('/devices').then((res) => setDevices(res.data.devices)).catch(() => {});
    api.get('/performa').then((res) => setPerforma(res.data.performa)).catch(() => {});
    api.get('/locations').then((res) => { setLocations(res.data.locations); }).catch(() => {});
    api.get('/services').then((res) => setServices(res.data.services)).catch(() => {});
    api.get(`/dashboard/monthly?month=${month}`).then((res) => setStats(res.data)).catch(() => {});
    api.get('/activities').then((res) => setActivities(res.data.activities)).catch(() => {});
    api.get('/incidents/teknisi-list').then((res) => setTeknisiList(res.data.teknisi || [])).catch(() => {});
  }

  async function decideActivity(id: number, action: 'approve' | 'reject') {
    let note: string | undefined;
    if (action === 'reject') { note = (await promptDialog({ title: 'Tolak aktivitas', inputLabel: 'Alasan penolakan (opsional)', confirmText: 'Tolak', variant: 'danger' })) || undefined; }
    setActing(id);
    try {
      await api.patch(`/activities/${id}/${action}`, { note });
      setToast(action === 'approve' ? 'Kegiatan disetujui — notifikasi WA terkirim ke teknisi.' : 'Kegiatan ditolak — notifikasi WA terkirim.');
      load();
    } catch (e: any) {
      setToast(e?.response?.data?.error || 'Gagal memproses.');
    } finally {
      setActing(null);
      setTimeout(() => setToast(''), 4000);
    }
  }
  useEffect(() => {
    load();
    const socket = getSocket();
    const refresh = () => load();
    const onServices = (list: ServiceItem[]) => setServices(list);
    socket.on('incident:new', refresh);
    socket.on('incident:escalated', refresh);
    socket.on('incident:reminded', refresh);
    socket.on('services:update', onServices);
    const poll = setInterval(load, 30000);
    return () => {
      socket.off('incident:new', refresh);
      socket.off('incident:escalated', refresh);
      socket.off('incident:reminded', refresh);
      socket.off('services:update', onServices);
      clearInterval(poll);
    };
  }, []);
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  function exportCsv() {
    const pp = data?.performa;
    const ss = data?.stats;
    const rows: [string, string | number][] = [
      ['Periode', month], ['Skor', pp?.score ?? 0], ['Tiket Masuk', pp?.totalIn ?? 0],
      ['Mengingatkan', pp?.reminders ?? 0], ['Diambil', pp?.taken ?? 0], ['Tepat Waktu', pp?.takenOnTime ?? 0],
      ['Telat', pp?.breaches ?? 0], ['Avg Waktu Ambil (menit)', pp?.avgClaim ?? 0],
      ['Total Aktif', ss?.totalActive ?? 0], ['Belum Diambil', ss?.unclaimed ?? 0], ['Selesai Hari Ini', ss?.doneToday ?? 0],
    ];
    const csv = 'Metrik,Nilai\n' + rows.map(([k, v]) => `"${k}",${v}`).join('\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8;' }));
    const a = document.createElement('a'); a.href = url; a.download = `performa-koordinator-${month}.csv`; a.click();
    URL.revokeObjectURL(url);
  }

  async function remind(id: string, techId?: number) {
    setReminding(id);
    setToast('');
    try {
      const res = await api.post(`/incidents/${id}/remind`, techId ? { techId } : {});
      setToast(res.data?.message || 'Pengingat dikirim.');
      load();
    } catch (e: any) {
      setToast(e?.response?.data?.error || 'Gagal mengirim pengingat.');
    } finally {
      setReminding(null);
      setTimeout(() => setToast(''), 4000);
    }
  }

  const p = data?.performa;
  const s = data?.stats;
  const coordSla = data?.coordSlaMinutes ?? 10;
  const coordBreach = data?.coordBreachMinutes ?? 30;
  const score = p?.score ?? 100;
  const scoreColor = score >= 70 ? 'text-success' : score >= 40 ? 'text-warn' : 'text-danger';
  const scoreRing = score >= 70 ? 'var(--color-success)' : score >= 40 ? 'var(--color-warn)' : 'var(--color-danger)';
  const monthLabel = data ? new Date(data.month + '-01').toLocaleDateString('id-ID', { month: 'long', year: 'numeric' }) : '—';

  const ageMin = (inc: Incident) => Math.floor((now - new Date(inc.created_at.replace(' ', 'T')).getTime()) / 60000);
  const active = data?.active || [];
  const byPrio = (pr: string) => active.filter((i) => i.priority === pr);

  const onlineCount = devices.filter((d) => d.status !== 'offline').length;
  const offlineCount = devices.filter((d) => d.status === 'offline').length;
  const types = [...new Set(devices.map((d) => d.type))];
  const donutDeg = devices.length ? Math.round((onlineCount / devices.length) * 360) : 0;

  return (
    <div className="space-y-4 nw-stagger">
      {toast && <div className="bg-accent2/10 border border-accent2/30 rounded-md px-3 py-2 text-[11px] text-accent2">🔔 {toast}</div>}

      {/* Persetujuan kegiatan teknisi — di atas */}
      <Panel title={`PERSETUJUAN KEGIATAN${activities.filter((a) => a.status === 'menunggu').length ? ` · ${activities.filter((a) => a.status === 'menunggu').length} menunggu` : ''}`}>
        {activities.length === 0 ? (
          <div className="text-center py-4 text-text2 text-xs">Belum ada pengajuan kegiatan.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead><tr className="text-text2 uppercase text-[10px] border-b border-border">
                {['Teknisi', 'Kegiatan', 'Waktu', 'Status', 'Aksi'].map((h) => <th key={h} className="px-2 py-2 text-left">{h}</th>)}
              </tr></thead>
              <tbody>
                {activities.slice(0, 8).map((a) => {
                  const b = activityStatusBadge(a.status);
                  return (
                    <tr key={a.id} className="border-b border-border/40">
                      <td className="px-2 py-2 whitespace-nowrap">{a.user_emoji} {a.user_name}</td>
                      <td className="px-2 py-2"><div className="font-semibold capitalize">{a.type} · {a.title}</div>{a.detail && <div className="text-text2 text-[10px] truncate max-w-[220px]">{a.detail}</div>}{a.bukti_url && <a href={a.bukti_url} target="_blank" rel="noreferrer" className="text-accent2 text-[10px] hover:underline">📎 Lihat bukti dukung</a>}</td>
                      <td className="px-2 py-2 font-mono text-[10px] whitespace-nowrap">{a.activity_date}{a.start_time ? ` ${a.start_time}${a.end_time ? `–${a.end_time}` : ''}` : ''}</td>
                      <td className="px-2 py-2"><span className={`text-[10px] px-1.5 py-0.5 rounded font-semibold ${b.bg} ${b.c}`}>{b.t}</span></td>
                      <td className="px-2 py-2">
                        {a.status === 'menunggu' ? (
                          <div className="flex gap-1.5">
                            <button disabled={acting === a.id} onClick={() => decideActivity(a.id, 'approve')} className="border border-success/40 text-success rounded px-2 py-0.5 disabled:opacity-50">✓ Setujui</button>
                            <button disabled={acting === a.id} onClick={() => decideActivity(a.id, 'reject')} className="border border-danger/40 text-danger rounded px-2 py-0.5 disabled:opacity-50">✕ Tolak</button>
                          </div>
                        ) : (
                          <span className="text-[10px] text-text2">{a.approver_name || '-'}</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      {/* Performa koordinator */}
      <div className="nw-card bg-gradient-to-br from-accent/10 to-accent2/8 border border-accent/25 rounded-xl p-5">
        <div className="flex items-center justify-between mb-4 gap-2 flex-wrap">
          <span className="text-[13px] font-bold">🎯 Performa Koordinator · {monthLabel}</span>
          <div className="flex items-center gap-3">
            <button onClick={() => setShowRincian(true)} className="border border-accent2/40 text-accent2 rounded-md px-2.5 py-1 text-[11px] font-semibold hover:bg-accent2/10">📊 Rincian</button>
            <button onClick={exportCsv} className="border border-accent/40 text-accent rounded-md px-2.5 py-1 text-[11px] font-semibold hover:bg-accent/10">⬇️ Ekspor</button>
            <span className="text-[10px] text-text2">Ingatkan di {coordSla} mnt · telat bila &gt; {coordBreach} mnt</span>
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
          <div className="flex-1 grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 min-w-[260px]">
            <Metric label="Tiket Masuk" value={p?.totalIn ?? 0} color="text-accent2" spark={spark.totalIn} sparkColor="accent2" extra={<DeltaBadge cur={p?.totalIn ?? 0} prev={prev?.totalIn ?? 0} />} />
            <Metric label="Mengingatkan" value={p?.reminders ?? 0} color="text-warn" spark={spark.reminders} sparkColor="warn" extra={<DeltaBadge cur={p?.reminders ?? 0} prev={prev?.reminders ?? 0} />} />
            <Metric label="Diambil" value={p?.taken ?? 0} color="text-accent2" spark={spark.taken} sparkColor="accent2" extra={<DeltaBadge cur={p?.taken ?? 0} prev={prev?.taken ?? 0} />} />
            <Metric label={`Tepat ≤${coordBreach}m`} value={p?.takenOnTime ?? 0} color="text-success" spark={spark.takenOnTime} sparkColor="success" extra={<DeltaBadge cur={p?.takenOnTime ?? 0} prev={prev?.takenOnTime ?? 0} />} />
            <Metric label={`Telat >${coordBreach}m`} value={p?.breaches ?? 0} color={(p?.breaches ?? 0) > 0 ? 'text-danger' : 'text-text2'} spark={spark.breaches} sparkColor="danger" extra={<DeltaBadge cur={p?.breaches ?? 0} prev={prev?.breaches ?? 0} lowerBetter />} />
            <Metric label="Avg Waktu Ambil" value={`${p?.avgClaim ?? 0}m`} color="text-warn" spark={spark.avgClaim} sparkColor="warn" extra={<DeltaBadge cur={p?.avgClaim ?? 0} prev={prev?.avgClaim ?? 0} lowerBetter />} />
          </div>
        </div>
        <div className="text-[10px] text-text2 mt-3">
          💡 Saat insiden lewat <b>{coordSla} menit</b> belum diambil → pencet <span className="text-warn">🔔 Ingatkan</span>. Insiden dihitung <span className="text-danger">telat</span> bila belum diambil teknisi dalam <b>{coordBreach} menit</b>. Skor mulai 100, −10 tiap telat, +2 tiap diambil tepat waktu, +2 tiap pengingat manual.
        </div>
      </div>

      {/* Rincian performa koordinator */}
      {showRincian && (() => {
        const pf = p || { totalIn: 0, taken: 0, takenOnTime: 0, reminders: 0, breaches: 0, avgClaim: 0, score: 100 };
        const remCounted = Math.min(pf.reminders, 10);
        const penaltyTelat = pf.breaches * 10;
        const bonusTepat = pf.takenOnTime * 2;
        const bonusIngatkan = remCounted * 2;
        const raw = 100 - penaltyTelat + bonusTepat + bonusIngatkan;
        const belumDiambil = Math.max(0, pf.totalIn - pf.taken);
        const claimRate = pf.totalIn ? Math.round((pf.taken / pf.totalIn) * 100) : 0;
        const onTimeRate = pf.taken ? Math.round((pf.takenOnTime / pf.taken) * 100) : 0;
        const breachRate = pf.taken ? Math.round((pf.breaches / pf.taken) * 100) : 0;
        const tiers = [
          { min: 85, label: 'EXCELLENT', desc: '85–100', color: 'text-success' },
          { min: 70, label: 'BAIK', desc: '70–84', color: 'text-success' },
          { min: 40, label: 'CUKUP', desc: '40–69', color: 'text-warn' },
          { min: 0, label: 'KURANG', desc: '0–39', color: 'text-danger' },
        ];
        const Row = ({ label, val, hint, color = '' }: { label: string; val: string; hint?: string; color?: string }) => (
          <div className="flex items-center justify-between py-1.5 border-b border-border/40 last:border-0">
            <div><div className="text-[12px]">{label}</div>{hint && <div className="text-[10px] text-text2">{hint}</div>}</div>
            <div className={`text-[13px] font-bold font-mono ${color}`}>{val}</div>
          </div>
        );
        return (
          <div className="fixed inset-0 z-[200] bg-black/70 flex items-center justify-center p-4" onClick={() => setShowRincian(false)}>
            <div className="bg-surface border border-border rounded-xl w-full max-w-lg max-h-[90vh] flex flex-col overflow-hidden" onClick={(e) => e.stopPropagation()}>
              {/* Header */}
              <div className="flex items-center justify-between gap-3 px-5 pt-5 pb-3 border-b border-border shrink-0">
                <span className="text-sm font-bold">📊 Rincian Performa Koordinator · {monthLabel}</span>
                <button onClick={() => setShowRincian(false)} className="text-text2 hover:text-text text-lg leading-none shrink-0">×</button>
              </div>
              {/* Body */}
              <div className="px-5 py-4 overflow-y-auto flex-1 space-y-4">
                {/* Skor hero */}
                <div className="flex items-center gap-4 bg-surface2/60 border border-border rounded-lg p-3">
                  <div className="relative w-[84px] h-[84px] flex-shrink-0">
                    <div className="w-full h-full rounded-full" style={{ background: `conic-gradient(${scoreRing} ${score * 3.6}deg, var(--color-border) 0deg)` }} />
                    <div className="absolute inset-[9px] rounded-full bg-surface flex flex-col items-center justify-center">
                      <div className={`text-2xl font-extrabold ${scoreColor}`}>{score}</div>
                      <div className="text-[8px] font-bold" style={{ color: scoreRing }}>{scoreMeta(score).label}</div>
                    </div>
                  </div>
                  <div className="text-[11px] text-text2 leading-relaxed">
                    Skor dihitung dari ketepatan tim mengambil insiden dalam <b>{coordBreach} menit</b> dan pengingat yang Anda kirim. Skor akhir dibatasi pada rentang <b>0–100</b>.
                  </div>
                </div>

                {/* Perhitungan skor */}
                <div>
                  <div className="text-[11px] font-bold text-text2 uppercase tracking-wide mb-1">🧮 Perhitungan Skor</div>
                  <div className="bg-surface2/40 border border-border rounded-lg px-3 py-1">
                    <Row label="Skor dasar" val="100" />
                    <Row label={`Telat ambil (>${coordBreach}m)`} hint={`${pf.breaches} insiden × −10`} val={`−${penaltyTelat}`} color="text-danger" />
                    <Row label={`Diambil tepat (≤${coordBreach}m)`} hint={`${pf.takenOnTime} insiden × +2`} val={`+${bonusTepat}`} color="text-success" />
                    <Row label="Pengingat manual" hint={`${remCounted} dihitung${pf.reminders > 10 ? ` (dari ${pf.reminders}, maks 10)` : ''} × +2`} val={`+${bonusIngatkan}`} color="text-warn" />
                    <Row label="Subtotal" val={`${raw}`} color="text-text" />
                    <Row label="Skor akhir (dibatasi 0–100)" val={`${score}`} color={scoreColor} />
                  </div>
                  {pf.reminders > 10 && <div className="text-[10px] text-text2 mt-1">ℹ️ Bonus pengingat dibatasi maksimal 10 pengingat (+20). Sisanya tidak menambah skor.</div>}
                </div>

                {/* Tingkat efisiensi */}
                <div>
                  <div className="text-[11px] font-bold text-text2 uppercase tracking-wide mb-1">📈 Tingkat Efisiensi</div>
                  <div className="bg-surface2/40 border border-border rounded-lg px-3 py-1">
                    <Row label="Total tiket masuk" val={`${pf.totalIn}`} />
                    <Row label="Tingkat pengambilan" hint={`${pf.taken} dari ${pf.totalIn} tiket diambil`} val={`${claimRate}%`} color={claimRate >= 80 ? 'text-success' : claimRate >= 50 ? 'text-warn' : 'text-danger'} />
                    <Row label="Ketepatan waktu" hint={`${pf.takenOnTime} dari ${pf.taken} diambil tepat waktu`} val={`${onTimeRate}%`} color={onTimeRate >= 80 ? 'text-success' : onTimeRate >= 50 ? 'text-warn' : 'text-danger'} />
                    <Row label="Tingkat keterlambatan" hint={`${pf.breaches} dari ${pf.taken} diambil telat`} val={`${breachRate}%`} color={breachRate <= 20 ? 'text-success' : breachRate <= 50 ? 'text-warn' : 'text-danger'} />
                    <Row label="Belum diambil" hint="tiket tanpa teknisi" val={`${belumDiambil}`} color={belumDiambil > 0 ? 'text-accent2' : 'text-text2'} />
                    <Row label="Rata-rata waktu ambil" hint="sejak insiden dibuat" val={`${pf.avgClaim}m`} color="text-warn" />
                  </div>
                </div>

                {/* Skala penilaian */}
                <div>
                  <div className="text-[11px] font-bold text-text2 uppercase tracking-wide mb-1">🏅 Skala Penilaian</div>
                  <div className="grid grid-cols-2 gap-2">
                    {tiers.map((t) => {
                      const active = scoreMeta(score).label === t.label;
                      return (
                        <div key={t.label} className={`rounded-lg border px-3 py-2 ${active ? 'border-accent bg-accent/10' : 'border-border bg-surface2/40'}`}>
                          <div className={`text-[12px] font-bold ${t.color}`}>{t.label} {active && '← Anda'}</div>
                          <div className="text-[10px] text-text2">Skor {t.desc}</div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
              {/* Footer */}
              <div className="px-5 py-3 border-t border-border shrink-0 flex justify-end gap-2">
                <button onClick={exportCsv} className="border border-accent/40 text-accent rounded-md px-3 py-1.5 text-xs font-semibold hover:bg-accent/10">⬇️ Ekspor CSV</button>
                <button onClick={() => setShowRincian(false)} className="bg-accent text-bg rounded-md px-3 py-1.5 text-xs font-semibold">Tutup</button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* Monitoring infrastruktur — di bawah performa */}
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
                {services.map((sv) => (
                  <div key={sv.id} className={`rounded-lg border p-2.5 text-center ${sv.is_ok ? 'border-success/25 bg-success/5' : 'border-danger/30 bg-danger/10'}`}>
                    <div className="text-lg mb-0.5">{sv.icon}</div>
                    <div className="text-[10px] font-semibold truncate">{sv.name}</div>
                    <div className={`text-[10px] font-bold ${sv.is_ok ? 'text-success' : 'text-danger'}`}>{sv.status}</div>
                    <div className="text-[9px] text-text2 truncate">{sv.detail}</div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </Panel>

        <Panel title="PETA LOKASI GANGGUAN" right={<Link to="/master" className="text-[11px] text-text2 hover:text-text">Kelola →</Link>}>
          {locations.length === 0 ? (
            <div className="text-[11px] text-text2 py-4 text-center">Belum ada lokasi.</div>
          ) : (
            <LocationMap locations={locations} />
          )}
        </Panel>
      </div>

      {/* Perangkat bermasalah (dari dashboard admin) */}
      <Panel title="⚠️ PERANGKAT BERMASALAH" right={<Link to="/devices" className="text-[11px] text-text2 hover:text-text">Semua →</Link>}>
        {devices.filter((d) => d.status !== 'online').length === 0 ? (
          <div className="text-center py-4 text-success text-xs">✅ Semua perangkat online.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead><tr className="text-text2 uppercase text-[10px] border-b border-border"><th className="px-3.5 py-2 text-left">Nama</th><th className="px-3.5 py-2 text-left">IP</th><th className="px-3.5 py-2 text-left">Status</th></tr></thead>
              <tbody>
                {devices.filter((d) => d.status !== 'online').map((d) => (
                  <tr key={d.id} className="border-b border-border/50">
                    <td className="px-3.5 py-2"><strong>{d.name}</strong></td>
                    <td className="px-3.5 py-2 font-mono">{d.ip}</td>
                    <td className="px-3.5 py-2"><DeviceStatusBadge status={d.status} offReason={d.off_reason} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      {/* Statistik — satu kartu */}
      <div className="bg-surface border border-border rounded-xl grid grid-cols-2 md:grid-cols-5 divide-x divide-border/60">
        {[
          { label: 'TOTAL AKTIF', value: s?.totalActive ?? 0, sub: 'Insiden belum selesai', color: '', icon: '🎫' },
          { label: 'BELUM DIAMBIL', value: s?.unclaimed ?? 0, sub: 'Menunggu teknisi', color: 'text-accent2', icon: '📥' },
          { label: `LEWAT ${coordSla} MENIT`, value: s?.breaching ?? 0, sub: 'Pencet 🔔 Ingatkan', color: 'text-danger', icon: '⏰' },
          { label: 'SEDANG PROSES', value: s?.inProgress ?? 0, sub: 'Ditangani teknisi', color: 'text-warn', icon: '🔧' },
          { label: 'SELESAI HARI INI', value: s?.doneToday ?? 0, sub: 'Tiket terselesaikan', color: 'text-success', icon: '✅' },
        ].map((m) => (
          <div key={m.label} className="p-4">
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-[10px] text-text2 uppercase font-semibold">{m.label}</span>
              <span className="text-base">{m.icon}</span>
            </div>
            <div className={`text-2xl font-extrabold ${m.color}`}>{m.value}</div>
            <div className="text-[10px] text-text2 mt-0.5">{m.sub}</div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Ringkasan prioritas */}
        <Panel title="RINGKASAN PRIORITAS">
          {PRIO.map((pr) => {
            const list = byPrio(pr);
            const meta = pr === 'kritis' ? { c: 'text-danger', d: 'bg-danger', t: 'KRITIS' } : pr === 'tinggi' ? { c: 'text-warn', d: 'bg-warn', t: 'TINGGI' } : { c: 'text-success', d: 'bg-success', t: 'SEDANG' };
            return (
              <div key={pr} className="mb-3 last:mb-0">
                <div className="flex items-center gap-1.5 mb-1.5">
                  <span className={`w-2 h-2 rounded-full ${meta.d}`} />
                  <span className={`text-[11px] font-bold ${meta.c}`}>{meta.t} ({list.length})</span>
                </div>
                {list.length === 0 ? <div className="text-[11px] text-text2 pl-3.5">—</div> : list.slice(0, 5).map((i) => (
                  <div key={i.id} className="flex items-center justify-between gap-2 pl-3.5 py-1">
                    <span className="text-[11px] truncate">{i.device_name}</span>
                    <span className={`text-[9px] px-1.5 py-0.5 rounded font-semibold ${i.tech_id ? 'bg-warn/15 text-warn' : 'bg-accent2/15 text-accent2'}`}>{i.tech_id ? 'Proses' : 'Baru'}</span>
                  </div>
                ))}
              </div>
            );
          })}
        </Panel>

        {/* Semua insiden aktif */}
        <div className="lg:col-span-2">
          <Panel title="SEMUA INSIDEN AKTIF" right={<Link to="/incidents" className="text-[11px] text-accent hover:underline">Kelola →</Link>}>
            {active.length === 0 ? (
              <div className="text-center py-8 text-success text-xs">✅ Tidak ada insiden aktif!</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead><tr className="text-text2 uppercase text-[10px] border-b border-border">
                    {['Perangkat', 'Prioritas', 'Status', 'Usia', 'Penanganan'].map((h) => <th key={h} className="px-2 py-2 text-left">{h}</th>)}
                  </tr></thead>
                  <tbody>
                    {active.map((i) => {
                      const age = ageMin(i);
                      const breach = !i.tech_id && age >= coordSla;
                      return (
                        <tr key={i.id} className={`border-b border-border/40 ${breach ? 'bg-danger/10' : ''}`}>
                          <td className="px-2 py-2"><div className="font-semibold truncate max-w-[140px]">{i.device_name}</div><div className="text-text2 text-[10px] truncate max-w-[140px]">{i.issue}</div></td>
                          <td className="px-2 py-2"><span className={`text-[9px] px-1.5 py-0.5 rounded font-bold uppercase ${i.priority === 'kritis' ? 'bg-danger/15 text-danger' : i.priority === 'tinggi' ? 'bg-warn/15 text-warn' : 'bg-success/15 text-success'}`}>{i.priority}</span></td>
                          <td className="px-2 py-2"><span className={`text-[10px] font-semibold ${i.tech_id ? 'text-warn' : 'text-accent2'}`}>{i.tech_id ? 'Proses' : 'Belum diambil'}</span></td>
                          <td className={`px-2 py-2 font-mono font-semibold ${breach ? 'text-danger' : 'text-text2'}`}>{breach && '⏰ '}{fmtAge(age)}</td>
                          <td className="px-2 py-2 text-[10px]">
                            {i.tech_id ? (
                              <span className="text-text2">{i.tech_name || `Teknisi #${i.tech_id}`}</span>
                            ) : reminding === i.id ? (
                              <span className="text-warn">…</span>
                            ) : (
                              <select
                                value=""
                                onChange={(e) => { const v = e.target.value; if (v === 'all') remind(i.id); else if (v) remind(i.id, Number(v)); }}
                                title="Pilih: ingatkan semua teknisi on-duty, atau kirim perintah penanganan ke teknisi tertentu"
                                className="border border-warn/40 text-warn bg-surface rounded px-2 py-0.5 font-semibold hover:bg-warn/10 cursor-pointer text-[10px] focus:outline-none"
                              >
                                <option value="">🔔 Ingatkan…</option>
                                <option value="all">📢 Semua teknisi on-duty</option>
                                {teknisiList.map((t) => <option key={t.id} value={t.id}>➡️ Perintah: {t.name}</option>)}
                              </select>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </Panel>
        </div>
      </div>

      {/* Statistik bulan ini */}
      <Panel title="STATISTIK BULAN INI" right={<span className="text-[11px] text-text2">{stats ? new Date(stats.month + '-01').toLocaleDateString('id-ID', { month: 'long', year: 'numeric' }) : '—'}</span>}>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <MiniStat label="TIKET MASUK" value={String(stats?.totals.totalIn ?? 0)} delta="bulan ini"><Bars data={stats?.ticketsIn || []} color="var(--color-accent2)" /></MiniStat>
          <MiniStat label="TIKET SELESAI" value={String(stats?.totals.totalDone ?? 0)} delta="bulan ini"><Bars data={stats?.ticketsDone || []} color="var(--color-success)" /></MiniStat>
          <MiniStat label="SLA (%)" value={`${stats?.totals.avgSla ?? 100}%`} delta="rata-rata"><Line data={stats?.slaTrend || []} color="var(--color-accent2)" /></MiniStat>
          <MiniStat label="MTTR" value={fmtDur(stats?.totals.avgMttr ?? 0)} delta="rata-rata"><Line data={stats?.mttrTrend || []} color={PURPLE} /></MiniStat>
        </div>
      </Panel>

      {/* Performa teknisi (dari dashboard admin) */}
      <Panel title="🏆 PERFORMA TEKNISI" right={<Link to="/performa" className="text-[11px] text-text2 hover:text-text">Detail →</Link>}>
        {performa.length === 0 ? (
          <div className="text-center py-4 text-text2 text-xs">Belum ada data performa.</div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 nw-stagger">
            {performa.map((p) => (
              <div key={p.techId} className="nw-card bg-surface2 border border-border rounded-lg p-3 text-center">
                <div className="text-2xl mb-1">{p.emoji}</div>
                <div className="text-xs font-semibold">{p.name.split(' ')[0]}</div>
                <div className="text-[10px] text-text2 mb-2">{p.jabatan}</div>
                <div className={`text-xl font-bold ${p.score >= 70 ? 'text-success' : p.score >= 40 ? 'text-warn' : 'text-danger'}`}>{p.score}</div>
                <div className="text-[9px] text-text2">Skor Performa</div>
              </div>
            ))}
          </div>
        )}
      </Panel>

      {/* Analitik tambahan */}
      {(() => {
        const tot = (p?.takenOnTime ?? 0) + (p?.breaches ?? 0);
        const tepat = tot ? Math.round(((p?.takenOnTime ?? 0) / tot) * 100) : 100;
        const labels = stats ? ['1', `${Math.ceil(stats.daysInMonth / 3)}`, `${Math.ceil((stats.daysInMonth * 2) / 3)}`, `${stats.daysInMonth}`] : [];
        const insights: { tone: 'ok' | 'warn' | 'danger' | 'info'; text: string }[] = [
          (s?.breaching ?? 0) > 0 ? { tone: 'danger', text: `${s?.breaching} insiden lewat ${coordSla} menit belum diambil — pencet Ingatkan.` } : { tone: 'ok', text: `Semua insiden tertangani dalam ${coordSla} menit.` },
          (p?.breaches ?? 0) > 0 ? { tone: 'warn', text: `${p?.breaches} tiket telat diambil (> ${coordBreach} menit) bulan ini.` } : { tone: 'ok', text: 'Tidak ada tiket telat diambil bulan ini.' },
          { tone: 'info', text: `${p?.reminders ?? 0} pengingat manual dikirim — ${tepat}% tiket diambil tepat waktu.` },
          (s?.unclaimed ?? 0) > 0 ? { tone: 'warn', text: `${s?.unclaimed} insiden masih menunggu teknisi di pool.` } : { tone: 'ok', text: 'Pool insiden kosong.' },
        ];
        return (
          <>
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
              <SlaBreakdown pct={stats?.totals.avgSla ?? 100} bars={[{ label: `Tepat ≤${coordBreach}m`, value: tepat, color: 'success' }, { label: `Telat >${coordBreach}m`, value: 100 - tepat, color: 'danger' }]} />
              <div className="lg:col-span-2"><TrendChart title="TREND BULAN INI" xLabels={labels} series={[{ label: 'Tiket Masuk', data: stats?.ticketsIn || [], color: 'accent2' }, { label: 'Tiket Selesai', data: stats?.ticketsDone || [], color: 'success' }]} /></div>
            </div>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <AIInsight items={insights} />
              <RecentIncidents incidents={active} now={now} right={<Link to="/incidents" className="text-[11px] text-accent hover:underline">Lihat Semua →</Link>} />
            </div>
          </>
        );
      })()}

      {/* Status bar bawah */}
      <div className="bg-surface border border-border rounded-xl px-5 py-3 flex items-center gap-6 flex-wrap text-[11px]">
        <span className="flex items-center gap-1.5 font-semibold"><span className="relative flex h-2 w-2"><span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-success opacity-75" /><span className="relative inline-flex rounded-full h-2 w-2 bg-success" /></span>Sistem Online</span>
        <span className="text-text2">🎫 Total Tiket Masuk: <b className="text-accent2">{p?.totalIn ?? 0}</b></span>
        <span className="text-text2">✅ Selesai Hari Ini: <b className="text-success">{s?.doneToday ?? 0}</b></span>
        <span className="text-text2">📈 SLA Tercapai: <b className="text-accent2">{stats?.totals.avgSla ?? 100}%</b></span>
        <span className="text-text2">⏱️ Avg Ambil: <b className="text-warn">{p?.avgClaim ?? 0}m</b></span>
        <span className="ml-auto text-text2">Skor performa: <b style={{ color: scoreRing }}>{score}</b> · {scoreMeta(score).label}</span>
      </div>
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
  if (!data?.length) return null;
  const max = Math.max(...data), min = Math.min(...data);
  const range = max - min || 1;
  const denom = data.length > 1 ? data.length - 1 : 1; // hindari pembagian 0 (NaN) untuk 1 titik
  const pts = data.map((v, i) => `${(i / denom) * 100},${30 - ((v - min) / range) * 28}`).join(' ');
  return (
    <svg viewBox="0 0 100 30" preserveAspectRatio="none" className="w-full h-14 mt-1">
      <polyline points={pts} fill="none" stroke={color} strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
    </svg>
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

function Panel({ title, right, children }: { title: string; right?: ReactNode; children: ReactNode }) {
  return (
    <div className="nw-card bg-surface border border-border rounded-xl p-4">
      <div className="flex items-center justify-between mb-3">
        <span className="font-head text-[12px] font-bold tracking-wide">{title}</span>
        {right}
      </div>
      {children}
    </div>
  );
}
