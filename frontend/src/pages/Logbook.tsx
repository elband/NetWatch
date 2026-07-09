import { useEffect, useState } from 'react';
import { api } from '../api/client';
import { openImage } from '../components/ImageLightbox';

interface LogEvent { date: string; time: string; kind: 'inspeksi' | 'power' | 'maintenance' | 'insiden'; label: string; status: string; detail: string; by: string; photo_url: string; verified: boolean }
interface LogMetrik { up_pct: number; avg_ping: number; max_ping: number; samples: number }
interface LogRecap { inspeksi: { total: number; baik: number; perhatian: number; rusak: number }; power: { on: number; off: number }; maintenance: { total: number; selesai: number }; insiden: { total: number; downtime_min: number }; metrik: LogMetrik | null }
interface LogDevice { id: number; name: string; ip: string; type: string; loc: string | null; recap: LogRecap; events: LogEvent[] }

const thisMonth = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; };
const KIND_META: Record<LogEvent['kind'], { icon: string; label: string; cls: string }> = {
  inspeksi: { icon: '🔍', label: 'Inspeksi', cls: 'text-accent2 bg-accent2/10 border-accent2/30' },
  power: { icon: '⚡', label: 'Hidup/Mati', cls: 'text-indigo-400 bg-indigo-500/10 border-indigo-500/30' },
  maintenance: { icon: '🛠️', label: 'Maintenance', cls: 'text-amber-400 bg-amber-500/10 border-amber-500/30' },
  insiden: { icon: '🚨', label: 'Insiden', cls: 'text-danger bg-danger/10 border-danger/30' },
};
// Badge Jenis per-event. Aksi power dipisah jadi Hidupkan/Matikan (bukan satu kategori
// gabungan "Hidup/Mati") agar tiap kegiatan tampil sebagai jenis tersendiri.
function kindBadge(e: LogEvent): { icon: string; label: string; cls: string } {
  if (e.kind === 'power') {
    return e.status === 'mati'
      ? { icon: '⏻', label: 'Matikan', cls: 'text-slate-300 bg-slate-500/15 border-slate-500/30' }
      : { icon: '⚡', label: 'Hidupkan', cls: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/30' };
  }
  return KIND_META[e.kind];
}
const powerJenis = (e: LogEvent) => (e.status === 'mati' ? 'Matikan' : 'Hidupkan');
const fmtDate = (s: string) => (s ? new Date(s + 'T00:00:00').toLocaleDateString('id-ID', { day: '2-digit', month: 'short' }) : '-');
const monthLabel = (m: string) => { const [y, mo] = m.split('-').map(Number); return new Date(y, mo - 1, 1).toLocaleDateString('id-ID', { month: 'long', year: 'numeric' }); };

export default function Logbook() {
  const [month, setMonth] = useState(thisMonth());
  const [q, setQ] = useState('');
  const [devices, setDevices] = useState<LogDevice[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState<Record<number, boolean>>({});

  function load() {
    setLoading(true);
    api.get('/logbook', { params: { month, q: q.trim() || undefined } })
      .then((r) => setDevices(r.data.devices || []))
      .catch(() => setDevices([]))
      .finally(() => setLoading(false));
  }
  useEffect(load, [month]); // eslint-disable-line react-hooks/exhaustive-deps

  async function exportExcel() {
    const res = await api.get('/logbook/export', { params: { month, q: q.trim() || undefined }, responseType: 'blob' });
    const url = URL.createObjectURL(res.data);
    const a = document.createElement('a');
    a.href = url; a.download = `logbook-peralatan-${month}.xlsx`; a.click();
    URL.revokeObjectURL(url);
  }

  function cetak() {
    const w = window.open('', '_blank');
    if (!w) return;
    w.document.write(buildPrintHtml(devices, month));
    w.document.close();
    // Beri waktu thumbnail dokumentasi termuat sebelum dialog cetak.
    setTimeout(() => { try { w.focus(); w.print(); } catch { /**/ } }, 900);
  }

  const totalEvents = devices.reduce((a, d) => a + d.events.length, 0);

  return (
    <div>
      <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
        <div className="text-[17px] font-bold">📒 Logbook Peralatan</div>
        <div className="flex items-center gap-2 flex-wrap">
          <input type="month" className="bg-surface2 border border-border rounded-md px-2 py-1.5 text-xs" value={month} onChange={(e) => setMonth(e.target.value)} />
          <button onClick={cetak} disabled={!devices.length} className="border border-border text-text2 hover:text-text rounded-md px-3 py-1.5 text-xs font-semibold disabled:opacity-50">🖨️ Cetak</button>
          <button onClick={exportExcel} disabled={!devices.length} className="border border-accent2/40 text-accent2 rounded-md px-3 py-1.5 text-xs font-semibold disabled:opacity-50">⬇️ Excel</button>
        </div>
      </div>

      <div className="flex items-center gap-2 mb-3 flex-wrap">
        <input value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && load()} placeholder="🔍 Cari perangkat, IP, lokasi… (Enter)" className="flex-1 min-w-[200px] bg-surface2 border border-border rounded-md px-3 py-1.5 text-xs" />
        <button onClick={load} className="bg-accent text-bg rounded-md px-3 py-1.5 text-xs font-semibold">Cari</button>
        <span className="text-[10px] text-text2 w-full sm:w-auto">Rekap {monthLabel(month)} · {devices.length} perangkat · {totalEvents} aktivitas</span>
      </div>

      {loading ? (
        <div className="text-center text-text2 text-sm py-10">Memuat…</div>
      ) : devices.length === 0 ? (
        <div className="bg-surface border border-border rounded-xl text-center py-12 text-text2 text-sm">Tidak ada aktivitas peralatan pada {monthLabel(month)}.</div>
      ) : (
        <div className="space-y-3">
          {devices.map((d) => {
            const isOpen = open[d.id] ?? false;
            return (
              <div key={d.id} className="bg-surface border border-border rounded-xl overflow-hidden">
                <button onClick={() => setOpen((o) => ({ ...o, [d.id]: !isOpen }))} className="w-full flex items-start justify-between gap-3 p-3.5 text-left hover:bg-text/5">
                  <div className="min-w-0">
                    <div className="font-semibold text-sm truncate">{d.name}</div>
                    <div className="text-text2 text-[10px] truncate">{d.type} · {d.ip}{d.loc ? ` · 📍 ${d.loc}` : ''}</div>
                    <div className="flex flex-wrap gap-1.5 mt-2">
                      {d.recap.metrik && <Chip label={`🟢 Uptime ${d.recap.metrik.up_pct}%`} sub={`lat ${d.recap.metrik.avg_ping}/${d.recap.metrik.max_ping} ms`} />}
                      <Chip label={`🔍 ${d.recap.inspeksi.total} inspeksi`} sub={`${d.recap.inspeksi.baik}B/${d.recap.inspeksi.perhatian}P/${d.recap.inspeksi.rusak}R`} />
                      <Chip label={`⚡ ${d.recap.power.on}× hidup · ${d.recap.power.off}× mati`} />
                      <Chip label={`🛠️ ${d.recap.maintenance.total} maint.`} sub={`${d.recap.maintenance.selesai} selesai`} />
                      <Chip label={`🚨 ${d.recap.insiden.total} insiden`} sub={d.recap.insiden.downtime_min ? `${d.recap.insiden.downtime_min} mnt down` : undefined} />
                    </div>
                  </div>
                  <span className="text-text2 text-xs shrink-0 mt-1">{isOpen ? '▲' : '▼'} {d.events.length}</span>
                </button>
                {isOpen && (
                  <div className="border-t border-border/60 overflow-x-auto">
                    <table className="w-full text-[11px]">
                      <thead>
                        <tr className="text-text2 text-left border-b border-border/60">
                          <th className="px-3 py-2 font-medium">Tanggal</th><th className="px-3 py-2 font-medium">Jenis</th><th className="px-3 py-2 font-medium">Uraian</th><th className="px-3 py-2 font-medium">Status</th><th className="px-3 py-2 font-medium">Oleh</th><th className="px-3 py-2 font-medium">Foto</th>
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
            );
          })}
        </div>
      )}
    </div>
  );
}

function Chip({ label, sub }: { label: string; sub?: string }) {
  return <span className="inline-flex items-center gap-1 text-[10px] bg-surface2 border border-border rounded-full px-2 py-0.5">{label}{sub && <span className="text-text2">· {sub}</span>}</span>;
}

// HTML untuk cetak/PDF (dibuka di jendela baru).
function buildPrintHtml(devices: LogDevice[], month: string): string {
  const origin = window.location.origin;
  const esc = (t: string) => String(t ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const KIND: Record<string, string> = { inspeksi: 'Inspeksi', power: 'Hidup/Mati', maintenance: 'Maintenance', insiden: 'Insiden' };
  const ml = monthLabel(month);
  const sections = devices.map((d) => `
    <div style="page-break-inside:avoid;margin-bottom:16px">
      <div style="font-weight:bold;font-size:13px">${esc(d.name)} <span style="font-weight:normal;color:#555">· ${esc(d.type)} · ${esc(d.ip)}${d.loc ? ' · ' + esc(d.loc) : ''}</span></div>
      ${d.recap.metrik ? `<div style="font-size:11px;margin:2px 0 2px"><b>Uptime ${d.recap.metrik.up_pct}%</b> · Latensi rata-rata ${d.recap.metrik.avg_ping} ms · maks ${d.recap.metrik.max_ping} ms</div>` : ''}
      <div style="font-size:11px;color:#555;margin:2px 0 6px">Inspeksi ${d.recap.inspeksi.total} (${d.recap.inspeksi.baik} baik / ${d.recap.inspeksi.perhatian} perhatian / ${d.recap.inspeksi.rusak} rusak) · Hidup ${d.recap.power.on}× · Mati ${d.recap.power.off}× · Maintenance ${d.recap.maintenance.total} (${d.recap.maintenance.selesai} selesai) · Insiden ${d.recap.insiden.total}${d.recap.insiden.downtime_min ? ' (' + d.recap.insiden.downtime_min + ' mnt down)' : ''}</div>
      <table style="width:100%;border-collapse:collapse;font-size:10.5px">
        <thead><tr style="background:#f0f0f0">
          <th style="border:1px solid #999;padding:3px 6px;text-align:left">Tanggal</th><th style="border:1px solid #999;padding:3px 6px;text-align:left">Jenis</th><th style="border:1px solid #999;padding:3px 6px;text-align:left">Uraian</th><th style="border:1px solid #999;padding:3px 6px;text-align:left">Status</th><th style="border:1px solid #999;padding:3px 6px;text-align:left">Oleh</th><th style="border:1px solid #999;padding:3px 6px;text-align:center;width:90px">Dokumentasi</th>
        </tr></thead>
        <tbody>${d.events.map((e) => `<tr>
          <td style="border:1px solid #999;padding:3px 6px;white-space:nowrap">${esc(e.date)}${e.time ? ' ' + esc(e.time) : ''}</td>
          <td style="border:1px solid #999;padding:3px 6px">${esc(e.kind === 'power' ? powerJenis(e) : (KIND[e.kind] || e.kind))}</td>
          <td style="border:1px solid #999;padding:3px 6px">${esc(e.label)}${e.detail ? `<br><span style="color:#666">${esc(e.detail)}</span>` : ''}</td>
          <td style="border:1px solid #999;padding:3px 6px">${esc(e.status || '-')}</td>
          <td style="border:1px solid #999;padding:3px 6px">${esc(e.by || '-')}</td>
          <td style="border:1px solid #999;padding:3px 6px;text-align:center">${e.photo_url ? `<img src="${origin}${esc(e.photo_url)}" style="max-width:82px;max-height:64px;object-fit:cover;border:1px solid #ccc">` : '-'}</td>
        </tr>`).join('') || '<tr><td colspan="6" style="border:1px solid #999;padding:6px;text-align:center;color:#888">Tidak ada aktivitas</td></tr>'}</tbody>
      </table>
    </div>`).join('');
  return `<!doctype html><html><head><meta charset="utf-8"><title>Logbook Peralatan ${esc(ml)}</title>
    <style>body{font-family:'Segoe UI',Arial,sans-serif;color:#000;margin:18mm 14mm}h1{font-size:16px;text-align:center;margin:0 0 2px}.sub{text-align:center;font-size:12px;color:#555;margin-bottom:16px}@media print{@page{size:A4}}</style>
    </head><body>
      <h1>LOGBOOK PERALATAN</h1>
      <div class="sub">Rekap Bulan ${esc(ml)}</div>
      ${sections || '<div style="text-align:center;color:#888">Tidak ada aktivitas.</div>'}
    </body></html>`;
}
