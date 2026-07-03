import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../api/client';
import type { PhysicalAsset, AssetReading, AssetMetricType } from '../types';

type Range = '30d' | '90d' | '1y' | 'all';
const RANGES: { key: Range; label: string }[] = [
  { key: '30d', label: '30 Hari' },
  { key: '90d', label: '90 Hari' },
  { key: '1y', label: '1 Tahun' },
  { key: 'all', label: 'Semua' },
];

// Grafik garis SVG sederhana (tanpa dependensi), titik pembacaan meter manual.
function ReadingChart({ readings, unit }: { readings: AssetReading[]; unit: string }) {
  const W = 600, H = 140, padL = 40, padB = 22, padT = 10, padR = 10;
  const pts = readings.map((r) => ({ t: new Date(r.recorded_at).getTime(), v: Number(r.value) })).filter((p) => Number.isFinite(p.v));
  if (!pts.length) return <div className="text-[11px] text-text2 py-8 text-center">Belum ada pembacaan pada rentang ini.</div>;
  const vs = pts.map((p) => p.v);
  const max = Math.max(...vs), min = Math.min(...vs, 0);
  const span = max - min || 1;
  const innerW = W - padL - padR, innerH = H - padT - padB;
  const x = (i: number) => padL + (pts.length <= 1 ? innerW / 2 : (i / (pts.length - 1)) * innerW);
  const y = (v: number) => padT + innerH - ((v - min) / span) * innerH;
  const d = pts.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)} ${y(p.v).toFixed(1)}`).join(' ');
  const ticks = [min, min + span / 2, max];
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" preserveAspectRatio="none" style={{ height: H }}>
      {ticks.map((t, i) => (
        <g key={i}>
          <line x1={padL} x2={W - padR} y1={y(t)} y2={y(t)} stroke="var(--color-border)" strokeWidth="0.5" />
          <text x={padL - 4} y={y(t) + 3} textAnchor="end" fontSize="9" fill="var(--color-text2)">{Math.round(t)}{unit}</text>
        </g>
      ))}
      <path d={d} fill="none" stroke="var(--color-accent)" strokeWidth="1.5" strokeLinejoin="round" />
      {pts.map((p, i) => <circle key={i} cx={x(i)} cy={y(p.v)} r="2" fill="var(--color-accent)" />)}
    </svg>
  );
}

export default function AssetReadingModal({ asset, metricTypes, onClose, onSaved }: {
  asset: PhysicalAsset;
  metricTypes: AssetMetricType[];
  onClose: () => void;
  onSaved?: () => void;
}) {
  const metrics = useMemo(() => metricTypes.filter((m) => m.active), [metricTypes]);
  const [metric, setMetric] = useState(metrics[0]?.metric_key || '');
  const [range, setRange] = useState<Range>('90d');
  const [readings, setReadings] = useState<AssetReading[]>([]);
  const [loading, setLoading] = useState(false);
  const [value, setValue] = useState('');
  const [note, setNote] = useState('');
  const [photo, setPhoto] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const activeMetric = metrics.find((m) => m.metric_key === metric);
  const unit = activeMetric?.satuan ? ` ${activeMetric.satuan}` : '';

  const load = useCallback(() => {
    if (!metric) return;
    setLoading(true);
    api.get(`/aset/${asset.id}/readings`, { params: { metric, range } })
      .then((r) => setReadings(r.data.readings || []))
      .catch(() => setReadings([]))
      .finally(() => setLoading(false));
  }, [asset.id, metric, range]);
  useEffect(() => { load(); }, [load]);

  async function save() {
    if (!metric) { setError('Pilih metrik.'); return; }
    if (value.trim() === '' || !Number.isFinite(Number(value))) { setError('Nilai pembacaan harus berupa angka.'); return; }
    setBusy(true); setError('');
    try {
      const fd = new FormData();
      fd.append('metric', metric);
      fd.append('value', value.trim());
      if (note.trim()) fd.append('note', note.trim());
      if (photo) fd.append('photo', photo);
      await api.post(`/aset/${asset.id}/readings`, fd, { headers: { 'Content-Type': 'multipart/form-data' } });
      setValue(''); setNote(''); setPhoto(null);
      load();
      onSaved?.();
    } catch (e: any) { setError(e?.response?.data?.error || 'Gagal menyimpan pembacaan.'); }
    finally { setBusy(false); }
  }

  const last = readings.length ? readings[readings.length - 1] : null;
  const inp = 'w-full bg-surface2 border border-border rounded-md px-3 py-2 text-sm outline-none focus:border-accent';

  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-surface border border-border rounded-xl w-full max-w-2xl max-h-[90vh] flex flex-col overflow-hidden" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 pt-5 pb-3 border-b border-border shrink-0">
          <div className="min-w-0">
            <h3 className="text-sm font-bold truncate">📊 Pembacaan Meter — {asset.name}</h3>
            <div className="text-[10px] text-text2 mt-0.5">{[asset.merk, asset.model].filter(Boolean).join(' ') || asset.type || 'Aset'}{asset.loc ? ` · ${asset.loc}` : ''}</div>
          </div>
          <button type="button" className="text-text2 hover:text-text text-lg leading-none" onClick={onClose}>×</button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
          {metrics.length === 0 ? (
            <div className="text-[12px] text-text2 bg-surface2 border border-border rounded-md px-3 py-4 text-center">
              Belum ada metrik untuk unit ini. Tambahkan di <b>Master Data → Metrik Aset</b>.
            </div>
          ) : (
            <>
              {/* Pilih metrik */}
              <div className="flex flex-wrap gap-1">
                {metrics.map((m) => (
                  <button key={m.metric_key} onClick={() => setMetric(m.metric_key)}
                    className={`px-3 py-1 rounded-md text-[11px] border ${metric === m.metric_key ? 'bg-accent text-bg border-accent font-semibold' : 'bg-surface2 text-text2 border-border'}`}>
                    {m.label}
                  </button>
                ))}
              </div>

              {/* Ringkasan + rentang */}
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <div className="bg-surface2 border border-border rounded-md px-3 py-2">
                  <div className="text-[10px] text-text2">Pembacaan terakhir</div>
                  <div className="text-sm font-bold mt-0.5">{last ? `${Number(last.value)}${unit}` : '–'}</div>
                  {last && <div className="text-[9px] text-text2">{new Date(last.recorded_at).toLocaleString('id-ID')}</div>}
                </div>
                <div className="flex gap-1">
                  {RANGES.map((r) => (
                    <button key={r.key} onClick={() => setRange(r.key)}
                      className={`px-2.5 py-1 rounded-md text-[11px] border ${range === r.key ? 'bg-accent text-bg border-accent font-semibold' : 'bg-surface2 text-text2 border-border'}`}>
                      {r.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Grafik tren */}
              <div>
                <div className="text-[11px] text-text2 mb-1">Tren {activeMetric?.label}{unit ? ` (${activeMetric?.satuan})` : ''}</div>
                <div className="bg-surface2 border border-border rounded-md p-2">
                  {loading ? <div className="text-[11px] text-text2 py-8 text-center">Memuat…</div> : <ReadingChart readings={readings} unit={unit} />}
                </div>
              </div>

              {/* Form input */}
              <div className="border-t border-border pt-3">
                <div className="text-[11px] font-semibold text-text2 mb-2">Catat pembacaan baru</div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <label className="block">
                    <span className="text-[10px] text-text2">Metrik</span>
                    <select className={inp} value={metric} onChange={(e) => setMetric(e.target.value)}>
                      {metrics.map((m) => <option key={m.metric_key} value={m.metric_key}>{m.label}{m.satuan ? ` (${m.satuan})` : ''}</option>)}
                    </select>
                  </label>
                  <label className="block">
                    <span className="text-[10px] text-text2">Nilai{unit && ` (${activeMetric?.satuan})`}</span>
                    <input className={inp} inputMode="decimal" placeholder="mis. 1234.5" value={value} onChange={(e) => setValue(e.target.value)} />
                  </label>
                  <label className="block sm:col-span-2">
                    <span className="text-[10px] text-text2">Catatan (opsional)</span>
                    <input className={inp} placeholder="mis. servis rutin, pengisian BBM" value={note} onChange={(e) => setNote(e.target.value)} />
                  </label>
                  <label className="block sm:col-span-2">
                    <span className="text-[10px] text-text2">Foto bukti (opsional)</span>
                    <input type="file" accept="image/*" capture="environment" className="block w-full text-[11px] text-text2 file:mr-2 file:rounded file:border-0 file:bg-surface2 file:px-2 file:py-1 file:text-text2"
                      onChange={(e) => setPhoto(e.target.files?.[0] || null)} />
                  </label>
                </div>
                {error && <div className="mt-2 text-[12px] text-danger">⚠️ {error}</div>}
                <button onClick={save} disabled={busy} className="mt-3 bg-accent text-bg font-semibold rounded-md px-4 py-2 text-sm disabled:opacity-50">
                  {busy ? 'Menyimpan…' : '+ Simpan Pembacaan'}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
