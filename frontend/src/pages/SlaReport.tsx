import { useEffect, useMemo, useState } from 'react';
import { api } from '../api/client';
import type { SlaDevice } from '../types';

function isoDate(d: Date) { return d.toISOString().slice(0, 10); }
function fmtDur(sec: number | null) {
  if (sec == null) return '–';
  if (sec < 60) return `${sec} dtk`;
  if (sec < 3600) return `${Math.round(sec / 60)} mnt`;
  if (sec < 86400) return `${(sec / 3600).toFixed(1)} jam`;
  return `${(sec / 86400).toFixed(1)} hari`;
}
function uptimeColor(v: number | null) {
  if (v == null) return 'text-text2';
  if (v >= 99.5) return 'text-success';
  if (v >= 95) return 'text-warn';
  return 'text-danger';
}

interface Summary { devices: number; avg_uptime_pct: number | null; total_incidents: number; avg_mttr_sec: number | null }

export default function SlaReport() {
  const [to, setTo] = useState(isoDate(new Date()));
  const [from, setFrom] = useState(isoDate(new Date(Date.now() - 29 * 86400000)));
  const [loc, setLoc] = useState('');
  const [locs, setLocs] = useState<string[]>([]);
  const [devices, setDevices] = useState<SlaDevice[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [loading, setLoading] = useState(false);
  const [sortKey, setSortKey] = useState<'uptime' | 'incidents' | 'mttr' | 'name'>('uptime');

  function load() {
    setLoading(true);
    api.get('/sla', { params: { from, to, loc: loc || undefined } })
      .then((r) => { setDevices(r.data.devices || []); setSummary(r.data.summary || null); })
      .catch(() => { setDevices([]); setSummary(null); })
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    api.get('/locations').then((r) => setLocs((r.data.locations || []).map((l: { name: string }) => l.name))).catch(() => {});
  }, []);
  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [from, to, loc]);

  const sorted = useMemo(() => {
    const arr = [...devices];
    arr.sort((a, b) => {
      if (sortKey === 'name') return a.name.localeCompare(b.name);
      if (sortKey === 'incidents') return b.incidents - a.incidents;
      if (sortKey === 'mttr') return (b.mttr_sec ?? -1) - (a.mttr_sec ?? -1);
      // uptime: terendah dulu (paling bermasalah di atas)
      return (a.uptime_pct ?? 101) - (b.uptime_pct ?? 101);
    });
    return arr;
  }, [devices, sortKey]);

  function exportCsv() {
    const head = ['Perangkat', 'IP', 'Lokasi', 'Tipe', 'Uptime %', 'Avg Ping (ms)', 'Max Ping (ms)', 'Total Down', 'Insiden', 'MTTR'];
    const rows = sorted.map((d) => [
      d.name, d.ip, d.loc || '', d.type,
      d.uptime_pct ?? '', d.avg_ping ?? '', d.max_ping ?? '',
      fmtDur(d.down_seconds), d.incidents, fmtDur(d.mttr_sec),
    ]);
    const csv = [head, ...rows].map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `SLA_${from}_${to}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  return (
    <div>
      <div className="flex items-start justify-between mb-4 gap-3 flex-wrap">
        <div>
          <div className="text-[17px] font-bold">📊 Laporan SLA & Uptime</div>
          <div className="text-[11px] text-text2 mt-0.5">Ketersediaan perangkat, MTTR & insiden per periode</div>
        </div>
        <button onClick={exportCsv} disabled={!devices.length} className="bg-surface2 border border-border rounded-md px-3 py-2 text-xs disabled:opacity-50">
          ⬇️ Export CSV
        </button>
      </div>

      {/* Filter */}
      <div className="bg-surface border border-border rounded-[10px] p-3 mb-4 flex flex-wrap items-end gap-3">
        <label className="block">
          <span className="block text-[11px] text-text2 mb-1">Dari</span>
          <input type="date" className="dev-inp" value={from} max={to} onChange={(e) => setFrom(e.target.value)} />
        </label>
        <label className="block">
          <span className="block text-[11px] text-text2 mb-1">Sampai</span>
          <input type="date" className="dev-inp" value={to} min={from} max={isoDate(new Date())} onChange={(e) => setTo(e.target.value)} />
        </label>
        <label className="block">
          <span className="block text-[11px] text-text2 mb-1">Lokasi</span>
          <select className="dev-inp" value={loc} onChange={(e) => setLoc(e.target.value)}>
            <option value="">Semua lokasi</option>
            {locs.map((l) => <option key={l} value={l}>{l}</option>)}
          </select>
        </label>
        <label className="block">
          <span className="block text-[11px] text-text2 mb-1">Urut</span>
          <select className="dev-inp" value={sortKey} onChange={(e) => setSortKey(e.target.value as typeof sortKey)}>
            <option value="uptime">Uptime terendah</option>
            <option value="incidents">Insiden terbanyak</option>
            <option value="mttr">MTTR terlama</option>
            <option value="name">Nama</option>
          </select>
        </label>
      </div>

      {/* Ringkasan */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
        <SummaryCard label="Perangkat" value={summary ? String(summary.devices) : '–'} />
        <SummaryCard label="Rata-rata Uptime" value={summary?.avg_uptime_pct == null ? '–' : `${summary.avg_uptime_pct}%`} className={uptimeColor(summary?.avg_uptime_pct ?? null)} />
        <SummaryCard label="Total Insiden" value={summary ? String(summary.total_incidents) : '–'} />
        <SummaryCard label="Rata-rata MTTR" value={fmtDur(summary?.avg_mttr_sec ?? null)} />
      </div>

      {/* Tabel */}
      <div className="bg-surface border border-border rounded-[10px] overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-text2 text-[10px] uppercase border-b border-border">
                <th className="text-left font-medium px-3 py-2">Perangkat</th>
                <th className="text-left font-medium px-3 py-2">Lokasi</th>
                <th className="text-right font-medium px-3 py-2">Uptime</th>
                <th className="text-right font-medium px-3 py-2">Avg/Max Ping</th>
                <th className="text-right font-medium px-3 py-2">Total Down</th>
                <th className="text-right font-medium px-3 py-2">Insiden</th>
                <th className="text-right font-medium px-3 py-2">MTTR</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={7} className="text-center text-text2 py-10">Memuat…</td></tr>
              ) : sorted.length === 0 ? (
                <tr><td colSpan={7} className="text-center text-text2 py-10">Belum ada data pada periode ini.</td></tr>
              ) : sorted.map((d) => (
                <tr key={d.id} className="border-b border-border/40 hover:bg-surface2/40">
                  <td className="px-3 py-2">
                    <div className="font-semibold">{d.name}</div>
                    <div className="text-[10px] text-text2 font-mono">{d.ip}</div>
                  </td>
                  <td className="px-3 py-2 text-text2">{d.loc || '–'}</td>
                  <td className={`px-3 py-2 text-right font-bold ${uptimeColor(d.uptime_pct)}`}>{d.uptime_pct == null ? '–' : `${d.uptime_pct}%`}</td>
                  <td className="px-3 py-2 text-right font-mono text-text2">{d.avg_ping ?? '–'}/{d.max_ping ?? '–'}</td>
                  <td className="px-3 py-2 text-right text-text2">{fmtDur(d.down_seconds)}</td>
                  <td className="px-3 py-2 text-right">{d.incidents || '–'}</td>
                  <td className="px-3 py-2 text-right text-text2">{fmtDur(d.mttr_sec)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <div className="text-[10px] text-text2 mt-2">Uptime = (online+warning) ÷ sampel non-maintenance. Waktu maintenance terjadwal tidak menurunkan SLA.</div>
    </div>
  );
}

function SummaryCard({ label, value, className }: { label: string; value: string; className?: string }) {
  return (
    <div className="bg-surface border border-border rounded-[10px] px-4 py-3">
      <div className="text-[11px] text-text2">{label}</div>
      <div className={`text-xl font-bold mt-1 ${className || ''}`}>{value}</div>
    </div>
  );
}
