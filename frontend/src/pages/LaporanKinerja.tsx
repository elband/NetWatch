import { useCallback, useEffect, useState } from 'react';
import { api, getActiveUnitId } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { hasRole } from '../utils/roles';

function thisMonth() { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; }
const num = (n: number | null | undefined, suf = '') => (n == null ? '–' : `${n}${suf}`);
function fmtMin(m: number | null | undefined) {
  if (m == null) return '–';
  if (m < 60) return `${m} mnt`;
  const h = Math.floor(m / 60), mm = m % 60;
  return `${h}j${mm ? ` ${mm}m` : ''}`;
}

interface KinerjaReport {
  monthName: string;
  kpi: {
    total: number; selesai: number; aktif: number; selesaiPct: number | null;
    mttr: number | null; avgResp: number | null; onTimePct: number | null; avgUptime: number | null;
    kritis: number; tinggi: number; sedang: number; jumlahPerangkat: number;
    maintDone: number; maintTotal: number; inspeksi: number;
  };
  worst: { id: number; name: string; ip: string; loc: string | null; uptime: number | null; down_sec: number; inc: number }[];
  topIssues: { nama: string; n: number }[];
  teknisi: { name: string; jabatan: string | null; done: number; onTime: number; taken: number; avgResp: number; avgDur: number; pm: number; dokumentasi: number; inspections: number; score: number; grade: string }[];
}

export default function LaporanKinerja() {
  const { user } = useAuth();
  const needUnit = hasRole(user, 'admin') && !getActiveUnitId();
  const [month, setMonth] = useState(thisMonth());
  const [data, setData] = useState<KinerjaReport | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(() => {
    setLoading(true);
    api.get('/laporan/kinerja', { params: { month } }).then((r) => setData(r.data)).catch(() => setData(null)).finally(() => setLoading(false));
  }, [month]);
  useEffect(() => { load(); }, [load]);

  const card = 'bg-surface border border-border rounded-xl p-4';
  const upCls = (v: number | null) => v == null ? 'text-text2' : v >= 99 ? 'text-success' : v >= 95 ? 'text-warn' : 'text-danger';

  return (
    <div className="p-4 sm:p-6 max-w-5xl mx-auto">
      <div className="flex items-center justify-between gap-3 mb-4 flex-wrap print:hidden">
        <div>
          <h1 className="text-lg font-bold">📊 Laporan Bulanan Unjuk Hasil (Kinerja)</h1>
          <p className="text-[12px] text-text2">Rekap kinerja Unit Elektronika Bandara: ketersediaan perangkat, penanganan insiden & kinerja teknisi.</p>
        </div>
        <div className="flex items-center gap-2">
          <input type="month" value={month} onChange={(e) => setMonth(e.target.value)} className="bg-surface2 border border-border rounded-md px-3 py-2 text-sm" />
          <button onClick={() => window.print()} className="bg-accent text-bg font-semibold rounded-md px-4 py-2 text-sm">🖨️ Cetak</button>
        </div>
      </div>

      {needUnit && <div className="bg-warn/10 border border-warn/30 text-warn rounded-lg px-4 py-3 text-[13px] mb-4">Pilih unit Elektronika Bandara di switcher header untuk melihat laporannya.</div>}

      {loading ? <div className="text-text2 text-sm py-10 text-center">Memuat…</div> : !data ? (
        <div className={`${card} text-center text-text2`}>Data tidak tersedia.</div>
      ) : (
        <div className="space-y-4">
          <div className="text-center">
            <div className="text-base font-bold">LAPORAN BULANAN UNJUK HASIL — UNIT ELEKTRONIKA BANDARA</div>
            <div className="text-[13px] text-text2">Periode {data.monthName} · Bandara A.P.T Pranoto Samarinda</div>
          </div>

          {/* KPI ringkas */}
          <div className={card}>
            <div className="text-sm font-bold mb-3">I. Ringkasan Kinerja</div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
              <Kpi label="Uptime rata-rata" value={num(data.kpi.avgUptime, '%')} cls={upCls(data.kpi.avgUptime)} />
              <Kpi label="Perangkat dipantau" value={String(data.kpi.jumlahPerangkat)} />
              <Kpi label="Insiden (total)" value={String(data.kpi.total)} />
              <Kpi label="Insiden selesai" value={`${data.kpi.selesai}${data.kpi.selesaiPct != null ? ` · ${data.kpi.selesaiPct}%` : ''}`} cls="text-success" />
              <Kpi label="Insiden aktif" value={String(data.kpi.aktif)} cls={data.kpi.aktif ? 'text-warn' : ''} />
              <Kpi label="MTTR (rata-rata tuntas)" value={fmtMin(data.kpi.mttr)} />
              <Kpi label="Respon rata-rata" value={fmtMin(data.kpi.avgResp)} />
              <Kpi label="Diambil tepat waktu" value={num(data.kpi.onTimePct, '%')} cls={upCls(data.kpi.onTimePct)} />
            </div>
            <div className="text-[11px] text-text2 mt-3 flex gap-3 flex-wrap">
              <span>Prioritas insiden — <b className="text-danger">Kritis: {data.kpi.kritis}</b> · <b className="text-warn">Tinggi: {data.kpi.tinggi}</b> · Sedang: {data.kpi.sedang}</span>
              <span>· Maintenance selesai: {data.kpi.maintDone}/{data.kpi.maintTotal}</span>
              <span>· Inspeksi: {data.kpi.inspeksi}</span>
            </div>
          </div>

          {/* Perangkat uptime terendah */}
          <div className={card}>
            <div className="text-sm font-bold mb-2">II. Perangkat dengan Ketersediaan Terendah</div>
            {data.worst.length === 0 ? <div className="text-[12px] text-text2">Belum ada data uptime pada periode ini.</div> : (
              <div className="overflow-x-auto"><table className="w-full text-xs">
                <thead><tr className="text-left text-text2 border-b border-border"><th className="px-2 py-1.5">Perangkat</th><th className="px-2 py-1.5">IP</th><th className="px-2 py-1.5">Uptime</th><th className="px-2 py-1.5">Downtime</th><th className="px-2 py-1.5">Insiden</th></tr></thead>
                <tbody>{data.worst.map((d) => <tr key={d.id} className="border-b border-border/50"><td className="px-2 py-1.5 font-medium">{d.name}{d.loc ? <span className="text-text2"> · {d.loc}</span> : ''}</td><td className="px-2 py-1.5 font-mono text-text2">{d.ip}</td><td className={`px-2 py-1.5 font-bold ${upCls(d.uptime)}`}>{num(d.uptime, '%')}</td><td className="px-2 py-1.5">{Math.round(d.down_sec / 60)} mnt</td><td className="px-2 py-1.5">{d.inc}×</td></tr>)}</tbody>
              </table></div>
            )}
          </div>

          {/* Perangkat paling sering bermasalah */}
          <div className={card}>
            <div className="text-sm font-bold mb-2">III. Perangkat/Layanan Paling Sering Bermasalah</div>
            {data.topIssues.length === 0 ? <div className="text-[12px] text-text2">Tidak ada insiden pada periode ini. 👍</div> : (
              <div className="space-y-1">{data.topIssues.map((t, i) => <div key={i} className="flex items-center justify-between text-[12px] border-b border-border/40 pb-1"><span>{i + 1}. {t.nama}</span><span className="font-semibold">{t.n}× insiden</span></div>)}</div>
            )}
          </div>

          <div className="text-[10px] text-text2">
            Uptime & downtime dari rollup pemantauan harian. MTTR = rata-rata durasi insiden hingga tuntas · Respon = rata-rata dari terbit hingga diambil teknisi.
          </div>
        </div>
      )}
    </div>
  );
}

function Kpi({ label, value, cls }: { label: string; value: string; cls?: string }) {
  return (
    <div className="bg-surface2 border border-border rounded-md px-3 py-2">
      <div className="text-[10px] text-text2">{label}</div>
      <div className={`text-sm font-bold mt-0.5 ${cls || ''}`}>{value}</div>
    </div>
  );
}
