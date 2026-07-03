import { useCallback, useEffect, useState } from 'react';
import { api, getActiveUnitId } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { hasRole } from '../utils/roles';
import type { AvailabilityRow } from '../types';

function fmtDur(sec: number | null | undefined) {
  if (sec == null) return '–';
  const d = Math.floor(sec / 86400), h = Math.floor((sec % 86400) / 3600), m = Math.floor((sec % 3600) / 60);
  if (d > 0) return `${d}h ${h}j`;
  if (h > 0) return `${h}j ${m}m`;
  return `${m}m`;
}
function iso(d: Date) { return d.toISOString().slice(0, 10); }

export default function AsetAvailability() {
  const { user } = useAuth();
  const isAdmin = hasRole(user, 'admin');
  const needUnit = isAdmin && !getActiveUnitId();
  const [from, setFrom] = useState(iso(new Date(Date.now() - 30 * 86400000)));
  const [to, setTo] = useState(iso(new Date()));
  const [rows, setRows] = useState<AvailabilityRow[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(() => {
    setLoading(true);
    api.get('/aset/availability', { params: { from, to } })
      .then((r) => setRows(r.data.rows || []))
      .catch(() => setRows([]))
      .finally(() => setLoading(false));
  }, [from, to]);
  useEffect(() => { load(); }, [load]);

  const availCls = (v: number | null) => v == null ? 'text-text2' : v >= 95 ? 'text-success' : v >= 85 ? 'text-warn' : 'text-danger';

  return (
    <div className="p-4 sm:p-6 max-w-6xl mx-auto">
      <div className="mb-4">
        <h1 className="text-lg font-bold">📈 Availability Aset</h1>
        <p className="text-[12px] text-text2">Ketersediaan operasional, MTBF & MTTR aset fisik. Status <b>standby</b> dihitung netral (tidak menurunkan availability).</p>
      </div>

      <div className="flex items-end gap-2 mb-4 flex-wrap">
        <label className="block"><span className="text-[10px] text-text2">Dari</span>
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="block bg-surface2 border border-border rounded-md px-2 py-1.5 text-xs outline-none focus:border-accent" /></label>
        <label className="block"><span className="text-[10px] text-text2">Sampai</span>
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="block bg-surface2 border border-border rounded-md px-2 py-1.5 text-xs outline-none focus:border-accent" /></label>
        <button onClick={load} className="bg-accent text-bg font-semibold rounded-md px-4 py-1.5 text-sm">Terapkan</button>
      </div>

      {needUnit && <div className="bg-warn/10 border border-warn/30 text-warn rounded-lg px-4 py-3 text-[13px] mb-4">Pilih satu unit di switcher header untuk melihat availability.</div>}

      {loading ? (
        <div className="text-text2 text-sm py-10 text-center">Memuat…</div>
      ) : rows.length === 0 ? (
        <div className="bg-surface border border-border rounded-xl p-10 text-center text-text2 text-sm">Tidak ada aset fisik pada unit/periode ini.</div>
      ) : (
        <div className="bg-surface border border-border rounded-xl overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left text-text2 border-b border-border">
                <th className="px-3 py-2.5">Aset</th>
                <th className="px-3 py-2.5">Availability</th>
                <th className="px-3 py-2.5">Operasional</th>
                <th className="px-3 py-2.5">Downtime</th>
                <th className="px-3 py-2.5">Gangguan</th>
                <th className="px-3 py-2.5">MTBF</th>
                <th className="px-3 py-2.5">MTTR</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-b border-border/60">
                  <td className="px-3 py-2.5"><div className="font-semibold">{r.name}</div>{r.loc && <div className="text-[10px] text-text2">{r.loc}</div>}</td>
                  <td className={`px-3 py-2.5 font-bold ${availCls(r.availability_pct)}`}>{r.availability_pct == null ? '–' : `${r.availability_pct}%`}</td>
                  <td className="px-3 py-2.5">{fmtDur(r.operasional_sec)}</td>
                  <td className="px-3 py-2.5">{fmtDur(r.down_sec)}</td>
                  <td className="px-3 py-2.5">{r.failures}×</td>
                  <td className="px-3 py-2.5">{fmtDur(r.mtbf_sec)}</td>
                  <td className="px-3 py-2.5">{fmtDur(r.mttr_sec)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="text-[10px] text-text2 mt-3">
        <b>MTBF</b> = rata-rata waktu operasional antar gangguan · <b>MTTR</b> = rata-rata durasi perbaikan per kejadian. Sumber: riwayat perubahan status aset.
      </div>
    </div>
  );
}
