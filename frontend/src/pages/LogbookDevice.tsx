import { useEffect, useState } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '../api/client';
import { openImage } from '../components/ImageLightbox';
import { kindBadge, fmtDate, monthLabel, buildPrintHtml, type LogEvent, type LogRecap } from './Logbook';

// Detail satu peralatan: identitas + info teknis + rekap bulan + kronologi aktivitas.
interface DeviceDetail {
  id: number; name: string; ip: string; type: string; category: string | null; icon: string | null;
  loc: string | null; status: string;
  cpu: number | null; mem: number | null; ping_ms: number | null;
  monitor_enabled: number; off_reason: string | null; always_on: number; inspect_required: number;
  last_checked_at: string | null; offline_since: string | null; lat: number | null; lng: number | null;
  recap: LogRecap; events: LogEvent[];
  daily: { date: string; up_pct: number; avg_ping: number; samples: number }[];
}

const thisMonth = () => new Date().toISOString().slice(0, 7);
const stMeta = (s: string) =>
  s === 'offline' ? { t: '● Offline', c: 'text-danger bg-danger/10 border-danger/30' }
  : s === 'warning' ? { t: '● Warning', c: 'text-warn bg-warn/10 border-warn/30' }
  : s === 'online' ? { t: '● Online', c: 'text-success bg-success/10 border-success/30' }
  : { t: '— N/A', c: 'text-text2 border-border' };
const fmtDT = (s: string | null) => (s ? new Date(String(s).replace(' ', 'T')).toLocaleString('id-ID', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '-');

export default function LogbookDevice() {
  const { id } = useParams();
  const nav = useNavigate();
  const [sp, setSp] = useSearchParams();
  const month = sp.get('month') || thisMonth();
  const [d, setD] = useState<DeviceDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');

  useEffect(() => {
    setLoading(true); setErr('');
    api.get(`/logbook/device/${id}`, { params: { month } })
      .then((r) => setD(r.data.device))
      .catch((e) => { setD(null); setErr(e?.response?.data?.error || 'Gagal memuat data perangkat.'); })
      .finally(() => setLoading(false));
  }, [id, month]);

  const setMonth = (m: string) => { const n = new URLSearchParams(sp); n.set('month', m); setSp(n, { replace: true }); };

  async function exportExcel() {
    if (!d) return;
    const res = await api.get(`/logbook/device/${id}/export`, { params: { month }, responseType: 'blob' });
    const url = URL.createObjectURL(res.data);
    const a = document.createElement('a'); a.href = url; a.download = `logbook-${d.name}-${month}.xlsx`; a.click();
    URL.revokeObjectURL(url);
  }
  function cetak() {
    if (!d) return;
    const w = window.open('', '_blank'); if (!w) return;
    w.document.write(buildPrintHtml([d], month));
    w.document.close();
    setTimeout(() => { try { w.focus(); w.print(); } catch { /**/ } }, 900);
  }

  const monitorLabel = !d ? ''
    : d.always_on ? '🕒 Selalu aktif 24 jam'
    : d.monitor_enabled === 0 ? '⚫ Dimatikan · dijeda'
    : '🟢 Monitoring aktif';

  return (
    <div>
      <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
        <button onClick={() => nav(`/logbook?month=${month}`)} className="text-text2 hover:text-text text-xs font-semibold flex items-center gap-1">← Logbook Peralatan</button>
        <div className="flex items-center gap-2 flex-wrap">
          <input type="month" className="bg-surface2 border border-border rounded-md px-2 py-1.5 text-xs" value={month} onChange={(e) => setMonth(e.target.value)} />
          {d && <button onClick={cetak} className="border border-border text-text2 hover:text-text rounded-md px-3 py-1.5 text-xs font-semibold">🖨️ Cetak</button>}
          {d && <button onClick={exportExcel} className="border border-accent2/40 text-accent2 rounded-md px-3 py-1.5 text-xs font-semibold">⬇️ Excel</button>}
        </div>
      </div>

      {loading ? (
        <div className="text-center text-text2 text-sm py-10">Memuat…</div>
      ) : err || !d ? (
        <div className="bg-surface border border-border rounded-xl text-center py-12 text-text2 text-sm">{err || 'Perangkat tidak ditemukan.'}</div>
      ) : (
        <>
          {/* Identitas + status live */}
          <div className="bg-surface border border-border rounded-xl p-4 mb-3">
            <div className="flex items-start justify-between gap-3 flex-wrap">
              <div className="min-w-0">
                <div className="text-lg font-bold flex items-center gap-2">{d.icon || '🔧'} <span className="truncate">{d.name}</span></div>
                <div className="text-text2 text-xs mt-0.5 truncate">{d.type}{d.category ? ` · ${d.category}` : ''} · {d.ip}{d.loc ? ` · 📍 ${d.loc}` : ''}</div>
              </div>
              <span className={`shrink-0 text-[11px] font-semibold px-2 py-1 rounded-full border ${stMeta(d.status).c}`}>{stMeta(d.status).t}</span>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2 mt-3">
              <Info label="Monitoring" value={monitorLabel} />
              <Info label="Latensi kini" value={d.status === 'offline' ? 'DOWN' : d.ping_ms != null ? `${d.ping_ms} ms` : '-'} />
              <Info label="CPU / RAM" value={`${d.cpu ?? '-'}% / ${d.mem ?? '-'}%`} />
              <Info label="Terakhir dicek" value={fmtDT(d.last_checked_at)} />
              <Info label="Wajib inspeksi" value={d.inspect_required ? 'Ya' : 'Tidak'} />
              <Info label="Koordinat" value={d.lat != null && d.lng != null ? `${Number(d.lat).toFixed(5)}, ${Number(d.lng).toFixed(5)}` : '-'} />
              {d.off_reason ? <Info label="Alasan offline" value={d.off_reason} /> : null}
              {d.offline_since ? <Info label="Offline sejak" value={fmtDT(d.offline_since)} /> : null}
            </div>
          </div>

          {/* Rekap bulan */}
          <div className="text-xs text-text2 mb-2">Rekap <b className="text-text">{monthLabel(month)}</b> · {d.events.length} aktivitas</div>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2 mb-4">
            <Stat label="🟢 Uptime" value={d.recap.metrik ? `${d.recap.metrik.up_pct}%` : '—'} sub={d.recap.metrik ? `${d.recap.metrik.samples} sampel` : 'belum ada data'} />
            <Stat label="📶 Latensi" value={d.recap.metrik ? `${d.recap.metrik.avg_ping} ms` : '—'} sub={d.recap.metrik ? `maks ${d.recap.metrik.max_ping} ms` : undefined} />
            <Stat label="🔍 Inspeksi" value={String(d.recap.inspeksi.total)} sub={`${d.recap.inspeksi.baik}B / ${d.recap.inspeksi.perhatian}P / ${d.recap.inspeksi.rusak}R`} />
            <Stat label="⚡ Hidup / Mati" value={`${d.recap.power.on} / ${d.recap.power.off}`} sub="hidup / mati" />
            <Stat label="🛠️ Maintenance" value={String(d.recap.maintenance.total)} sub={`${d.recap.maintenance.selesai} selesai`} />
            <Stat label="🚨 Insiden" value={String(d.recap.insiden.total)} sub={d.recap.insiden.downtime_min ? `${d.recap.insiden.downtime_min} mnt down` : 'tanpa downtime'} />
          </div>

          {/* Tren uptime harian */}
          {d.daily.length > 0 && (
            <div className="bg-surface border border-border rounded-xl p-4 mb-3">
              <div className="text-sm font-semibold mb-3">📈 Tren Uptime Harian</div>
              <div className="flex items-end gap-1 h-28">
                {d.daily.map((day) => {
                  const col = day.up_pct >= 99 ? 'bg-success' : day.up_pct >= 95 ? 'bg-warn' : 'bg-danger';
                  return (
                    <div key={day.date} className="flex-1 flex flex-col items-center gap-1 h-full justify-end min-w-0" title={`${day.date} · ${day.up_pct}% uptime · lat ${day.avg_ping} ms · ${day.samples} sampel`}>
                      {d.daily.length <= 20 && <span className="text-[8px] text-text2">{day.up_pct}</span>}
                      <div className={`w-full rounded-t ${col}`} style={{ height: `${Math.max(2, day.up_pct)}%` }} />
                      <span className="text-[8px] text-text2">{new Date(day.date + 'T00:00:00').getDate()}</span>
                    </div>
                  );
                })}
              </div>
              <div className="text-[10px] text-text2 mt-2">Persentase waktu online per hari (di luar jendela maintenance). 🟢 ≥99% · 🟡 ≥95% · 🔴 &lt;95%.</div>
            </div>
          )}

          {/* Galeri dokumentasi (foto dari inspeksi / hidup-mati / maintenance) */}
          {(() => {
            const photos = d.events.filter((e) => e.photo_url);
            if (!photos.length) return null;
            return (
              <div className="bg-surface border border-border rounded-xl p-4 mb-3">
                <div className="text-sm font-semibold mb-3">🖼️ Galeri Dokumentasi <span className="text-text2 font-normal text-xs">· {photos.length} foto</span></div>
                <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-2">
                  {photos.map((e, i) => {
                    const km = kindBadge(e);
                    return (
                      <button key={i} onClick={() => openImage(e.photo_url)} title={`${km.label} · ${fmtDate(e.date)}${e.by ? ' · ' + e.by : ''}`} className="relative aspect-square rounded-lg overflow-hidden border border-border hover:border-accent/50">
                        <img src={e.photo_url} alt={e.label} loading="lazy" className="w-full h-full object-cover" />
                        <span className="absolute top-1 left-1 text-[10px] leading-none px-1 py-0.5 rounded bg-black/60 text-white">{km.icon}</span>
                        <span className="absolute bottom-0 inset-x-0 bg-black/55 text-white text-[8px] px-1 py-0.5 flex items-center justify-between"><span>{fmtDate(e.date)}</span><span>{e.verified ? '✅' : '⚠️'}</span></span>
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })()}

          {/* Kronologi aktivitas */}
          <div className="bg-surface border border-border rounded-xl overflow-hidden">
            <div className="px-4 py-2.5 border-b border-border text-sm font-semibold">📋 Kronologi Aktivitas</div>
            {d.events.length === 0 ? (
              <div className="text-center text-text2 text-sm py-10">Tidak ada aktivitas pada {monthLabel(month)}.</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-[11px]">
                  <thead>
                    <tr className="text-text2 text-left border-b border-border/60">
                      <th className="px-3 py-2 font-medium whitespace-nowrap">Tanggal</th><th className="px-3 py-2 font-medium">Jenis</th><th className="px-3 py-2 font-medium">Uraian</th><th className="px-3 py-2 font-medium">Status</th><th className="px-3 py-2 font-medium">Oleh</th><th className="px-3 py-2 font-medium">Foto</th>
                    </tr>
                  </thead>
                  <tbody>
                    {d.events.map((e, i) => {
                      const km = kindBadge(e);
                      return (
                        <tr key={i} className="border-b border-border/30 last:border-0">
                          <td className="px-3 py-2 whitespace-nowrap font-mono">{fmtDate(e.date)}{e.time ? ` ${e.time}` : ''}</td>
                          <td className="px-3 py-2 whitespace-nowrap"><span className={`inline-block px-1.5 py-0.5 rounded border text-[10px] ${km.cls}`}>{km.icon} {km.label}</span></td>
                          <td className="px-3 py-2"><div>{e.label}</div>{e.detail && <div className="text-text2 text-[10px]">{e.detail}</div>}</td>
                          <td className="px-3 py-2 whitespace-nowrap capitalize">{e.status || '-'}</td>
                          <td className="px-3 py-2 whitespace-nowrap text-text2">{e.by || '-'}</td>
                          <td className="px-3 py-2">{e.photo_url ? <button onClick={() => openImage(e.photo_url)} className="leading-none" title={e.verified ? 'Terverifikasi' : 'Belum terverifikasi'}>📷{e.verified ? '✅' : '⚠️'}</button> : '-'}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-surface2 border border-border rounded-lg px-2.5 py-1.5">
      <div className="text-[9px] font-semibold tracking-wide text-text2 uppercase">{label}</div>
      <div className="text-[11px] mt-0.5 truncate" title={value}>{value}</div>
    </div>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="bg-surface border border-border rounded-xl px-3 py-2.5">
      <div className="text-[10px] text-text2">{label}</div>
      <div className="text-lg font-bold mt-0.5">{value}</div>
      {sub && <div className="text-[9px] text-text2 truncate" title={sub}>{sub}</div>}
    </div>
  );
}
