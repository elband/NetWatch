import { useCallback, useEffect, useMemo, useState } from 'react';
import QRCode from 'qrcode';
import { api, getActiveUnitId } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { hasRole } from '../utils/roles';
import { confirmDialog } from '../components/dialog';
import AssetReadingModal from '../components/AssetReadingModal';
import ChecklistModal from '../components/ChecklistModal';
import PmModal from '../components/PmModal';
import type { PhysicalAsset, AssetMetricType, AssetLatestReading, OpStatus } from '../types';

const OP: Record<OpStatus, { label: string; cls: string }> = {
  operasional: { label: 'Operasional', cls: 'text-success bg-success/10 border-success/30' },
  standby: { label: 'Standby', cls: 'text-text2 bg-surface2 border-border' },
  rusak: { label: 'Rusak', cls: 'text-danger bg-danger/10 border-danger/30' },
  perbaikan: { label: 'Dalam Perbaikan', cls: 'text-warn bg-warn/10 border-warn/30' },
};
const OP_KEYS = Object.keys(OP) as OpStatus[];

interface LocationOpt { id: number; name: string }

const emptyForm = { name: '', category: '', type: '', merk: '', model: '', serial: '', tahun: '', loc: '', location_id: '', op_status: 'operasional' as OpStatus };

export default function Aset() {
  const { user } = useAuth();
  const canManage = hasRole(user, 'admin', 'koordinator', 'teknisi');
  const canDelete = hasRole(user, 'admin', 'koordinator');
  const isAdmin = hasRole(user, 'admin');
  const activeUnit = getActiveUnitId();
  const needUnit = isAdmin && !activeUnit; // super admin mode "Semua Unit"

  const [assets, setAssets] = useState<PhysicalAsset[]>([]);
  const [metricTypes, setMetricTypes] = useState<AssetMetricType[]>([]);
  const [locations, setLocations] = useState<LocationOpt[]>([]);
  const [latest, setLatest] = useState<Record<number, AssetLatestReading[]>>({});
  const [loading, setLoading] = useState(true);

  const [form, setForm] = useState(emptyForm);
  const [editId, setEditId] = useState<number | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const [readingAsset, setReadingAsset] = useState<PhysicalAsset | null>(null);
  const [qrAsset, setQrAsset] = useState<PhysicalAsset | null>(null);
  const [checklistAsset, setChecklistAsset] = useState<PhysicalAsset | null>(null);
  const [pmAsset, setPmAsset] = useState<PhysicalAsset | null>(null);
  const [pmDueIds, setPmDueIds] = useState<Set<number>>(new Set());

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [a, m, l, due] = await Promise.all([
        api.get('/aset'),
        api.get('/aset/metric-types'),
        api.get('/locations').catch(() => ({ data: { locations: [] } })),
        api.get('/aset/pm/due').catch(() => ({ data: { due: [] } })),
      ]);
      const list: PhysicalAsset[] = a.data.assets || [];
      setAssets(list);
      setMetricTypes(m.data.metricTypes || []);
      setLocations((l.data.locations || []).map((x: any) => ({ id: x.id, name: x.name })));
      setPmDueIds(new Set((due.data.due || []).map((d: any) => d.device_id)));
      // Muat pembacaan terakhir per aset (paralel) untuk ringkasan kartu.
      const entries = await Promise.all(list.map(async (as) => {
        try { const r = await api.get(`/aset/${as.id}/readings/latest`); return [as.id, r.data.latest || []] as const; }
        catch { return [as.id, []] as const; }
      }));
      setLatest(Object.fromEntries(entries));
    } finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  // Dari landing scan QR ("Input Meter"): /aset?focus=<id> → buka modal pembacaan.
  useEffect(() => {
    const focus = Number(new URLSearchParams(window.location.search).get('focus'));
    if (focus && assets.length) {
      const a = assets.find((x) => x.id === focus);
      if (a) setReadingAsset(a);
    }
  }, [assets]);

  const metricLabel = useMemo(() => {
    const map: Record<string, AssetMetricType> = {};
    metricTypes.forEach((m) => { map[m.metric_key] = m; });
    return map;
  }, [metricTypes]);

  function openCreate() { setForm(emptyForm); setEditId(null); setError(''); setShowForm(true); }
  function openEdit(a: PhysicalAsset) {
    setForm({
      name: a.name, category: a.category || '', type: a.type || '', merk: a.merk || '', model: a.model || '',
      serial: a.serial || '', tahun: a.tahun || '', loc: a.loc || '', location_id: a.location_id ? String(a.location_id) : '',
      op_status: a.op_status || 'operasional',
    });
    setEditId(a.id); setError(''); setShowForm(true);
  }

  async function save() {
    if (!form.name.trim()) { setError('Nama aset wajib diisi.'); return; }
    setSaving(true); setError('');
    try {
      if (editId) await api.put(`/aset/${editId}`, form);
      else await api.post('/aset', form);
      setShowForm(false); setForm(emptyForm); setEditId(null);
      load();
    } catch (e: any) { setError(e?.response?.data?.error || 'Gagal menyimpan aset.'); }
    finally { setSaving(false); }
  }

  async function changeStatus(a: PhysicalAsset, op: OpStatus) {
    setAssets((prev) => prev.map((x) => (x.id === a.id ? { ...x, op_status: op } : x)));
    try { await api.post(`/aset/${a.id}/status`, { op_status: op }); }
    catch { load(); }
  }

  async function remove(a: PhysicalAsset) {
    if (!await confirmDialog(`Hapus aset "${a.name}"? Semua pembacaan meter ikut terhapus.`)) return;
    await api.delete(`/aset/${a.id}`);
    load();
  }

  const card = 'bg-surface border border-border rounded-xl';
  const inp = 'w-full bg-surface2 border border-border rounded-md px-3 py-2 text-sm outline-none focus:border-accent';
  const btnGhost = 'px-2 py-1 rounded-md border border-border text-text2 hover:text-white text-xs';

  return (
    <div className="p-4 sm:p-6 max-w-6xl mx-auto">
      <div className="flex items-center justify-between gap-3 mb-4 flex-wrap">
        <div>
          <h1 className="text-lg font-bold">🔧 Aset & Peralatan</h1>
          <p className="text-[12px] text-text2">Peralatan fisik non-jaringan — pencatatan meter manual, status & QR per alat.</p>
        </div>
        {canManage && !needUnit && (
          <button onClick={openCreate} className="bg-accent text-bg font-semibold rounded-md px-4 py-2 text-sm">+ Tambah Aset</button>
        )}
      </div>

      {needUnit && (
        <div className="bg-warn/10 border border-warn/30 text-warn rounded-lg px-4 py-3 text-[13px] mb-4">
          Anda dalam mode <b>Semua Unit</b>. Pilih satu unit di switcher header untuk menambah / mengelola aset.
        </div>
      )}

      {loading ? (
        <div className="text-text2 text-sm py-10 text-center">Memuat…</div>
      ) : assets.length === 0 ? (
        <div className={`${card} p-10 text-center text-text2 text-sm`}>Belum ada aset. {canManage && !needUnit && 'Klik “Tambah Aset” untuk mendaftarkan peralatan.'}</div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {assets.map((a) => {
            const op = a.op_status && OP[a.op_status] ? OP[a.op_status] : OP.operasional;
            const rd = latest[a.id] || [];
            return (
              <div key={a.id} className={`${card} p-4 flex flex-col`}>
                <div className="flex items-start gap-3">
                  <div className="text-2xl shrink-0">{a.icon || '🔧'}</div>
                  <div className="min-w-0 flex-1">
                    <div className="font-semibold text-sm truncate">{a.name}</div>
                    <div className="text-[11px] text-text2 truncate">{[a.merk, a.model].filter(Boolean).join(' ') || a.type || '—'}</div>
                    {a.serial && <div className="text-[10px] text-text2 font-mono truncate">SN: {a.serial}</div>}
                  </div>
                  <div className="shrink-0 flex flex-col items-end gap-1">
                    <span className={`text-[10px] px-2 py-0.5 rounded-full border ${op.cls}`}>{op.label}</span>
                    {pmDueIds.has(a.id) && <span className="text-[9px] px-1.5 py-0.5 rounded-full border border-danger/40 text-danger bg-danger/10 font-semibold">🔧 PM due</span>}
                  </div>
                </div>

                <div className="text-[11px] text-text2 mt-2 flex items-center gap-2 flex-wrap">
                  {a.loc && <span>📍 {a.location_name || a.loc}</span>}
                  {a.tahun && <span>· {a.tahun}</span>}
                  {isAdmin && a.unit_code && <span className="px-1.5 py-0.5 rounded bg-surface2 border border-border">{a.unit_code}</span>}
                </div>

                {rd.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {rd.map((r) => (
                      <span key={r.metric} className="text-[10px] bg-surface2 border border-border rounded px-1.5 py-0.5">
                        {metricLabel[r.metric]?.label || r.metric}: <b>{Number(r.value)}</b>{metricLabel[r.metric]?.satuan ? ` ${metricLabel[r.metric]?.satuan}` : ''}
                      </span>
                    ))}
                  </div>
                )}

                <div className="mt-3 pt-3 border-t border-border flex items-center gap-1.5 flex-wrap">
                  <button className="px-2 py-1 rounded-md bg-accent/15 text-accent border border-accent/30 text-xs font-medium" onClick={() => setReadingAsset(a)}>📊 Meter</button>
                  <button className={btnGhost} onClick={() => setChecklistAsset(a)}>✅ Checklist</button>
                  <button className={`${btnGhost} ${pmDueIds.has(a.id) ? 'text-danger border-danger/40' : ''}`} onClick={() => setPmAsset(a)}>🔧 PM</button>
                  {canManage && (
                    <select value={a.op_status || 'operasional'} onChange={(e) => changeStatus(a, e.target.value as OpStatus)}
                      className="text-[11px] bg-surface2 border border-border rounded-md px-1.5 py-1 outline-none focus:border-accent">
                      {OP_KEYS.map((k) => <option key={k} value={k}>{OP[k].label}</option>)}
                    </select>
                  )}
                  <button className={btnGhost} onClick={() => setQrAsset(a)}>🔳 QR</button>
                  {canManage && <button className={btnGhost} onClick={() => openEdit(a)}>✏️</button>}
                  {canDelete && <button className={`${btnGhost} text-danger`} onClick={() => remove(a)}>🗑️</button>}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Modal form tambah/edit */}
      {showForm && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4" onClick={() => setShowForm(false)}>
          <div className={`${card} w-full max-w-lg max-h-[90vh] overflow-y-auto p-5`} onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-bold">{editId ? 'Edit Aset' : 'Tambah Aset'}</h3>
              <button className="text-text2 hover:text-text text-lg" onClick={() => setShowForm(false)}>×</button>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              <label className="block sm:col-span-2"><span className="text-[10px] text-text2">Nama aset *</span>
                <input className={inp} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="mis. Excavator Komatsu PC200" /></label>
              <label className="block"><span className="text-[10px] text-text2">Jenis / Kategori</span>
                <input className={inp} value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })} placeholder="mis. Excavator, Pompa" /></label>
              <label className="block"><span className="text-[10px] text-text2">Ikon (emoji)</span>
                <input className={inp} value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} placeholder="Sub-kategori (opsional)" /></label>
              <label className="block"><span className="text-[10px] text-text2">Merk</span>
                <input className={inp} value={form.merk} onChange={(e) => setForm({ ...form, merk: e.target.value })} placeholder="mis. Komatsu" /></label>
              <label className="block"><span className="text-[10px] text-text2">Model / Tipe</span>
                <input className={inp} value={form.model} onChange={(e) => setForm({ ...form, model: e.target.value })} placeholder="mis. PC200-8" /></label>
              <label className="block"><span className="text-[10px] text-text2">Nomor Seri</span>
                <input className={inp} value={form.serial} onChange={(e) => setForm({ ...form, serial: e.target.value })} /></label>
              <label className="block"><span className="text-[10px] text-text2">Tahun</span>
                <input className={inp} value={form.tahun} onChange={(e) => setForm({ ...form, tahun: e.target.value })} placeholder="mis. 2020" /></label>
              <label className="block sm:col-span-2"><span className="text-[10px] text-text2">Lokasi</span>
                {locations.length > 0 ? (
                  <select className={inp} value={form.location_id} onChange={(e) => {
                    const id = e.target.value; const nm = locations.find((x) => String(x.id) === id)?.name || '';
                    setForm({ ...form, location_id: id, loc: nm });
                  }}>
                    <option value="">— pilih lokasi —</option>
                    {locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
                  </select>
                ) : (
                  <input className={inp} value={form.loc} onChange={(e) => setForm({ ...form, loc: e.target.value })} placeholder="mis. Apron Barat" />
                )}
              </label>
              <label className="block sm:col-span-2"><span className="text-[10px] text-text2">Status operasional</span>
                <select className={inp} value={form.op_status} onChange={(e) => setForm({ ...form, op_status: e.target.value as OpStatus })}>
                  {OP_KEYS.map((k) => <option key={k} value={k}>{OP[k].label}</option>)}
                </select></label>
            </div>
            {error && <div className="mt-2 text-[12px] text-danger">⚠️ {error}</div>}
            <div className="mt-4 flex gap-2">
              <button onClick={save} disabled={saving} className="bg-accent text-bg font-semibold rounded-md px-4 py-2 text-sm disabled:opacity-50">{saving ? 'Menyimpan…' : (editId ? '💾 Simpan' : '+ Tambah')}</button>
              <button onClick={() => setShowForm(false)} className="border border-border text-text2 rounded-md px-4 py-2 text-sm">Batal</button>
            </div>
          </div>
        </div>
      )}

      {readingAsset && <AssetReadingModal asset={readingAsset} metricTypes={metricTypes} onClose={() => setReadingAsset(null)} onSaved={load} />}
      {checklistAsset && <ChecklistModal asset={checklistAsset} onClose={() => setChecklistAsset(null)} onSaved={load} />}
      {pmAsset && <PmModal asset={pmAsset} metricTypes={metricTypes} onClose={() => setPmAsset(null)} onSaved={load} />}
      {qrAsset && <QrModal asset={qrAsset} onClose={() => setQrAsset(null)} />}
    </div>
  );
}

// Modal QR: encode URL /lapor?aset=<token> (publik bisa lapor kerusakan; teknisi login → tombol Input Meter).
function QrModal({ asset, onClose }: { asset: PhysicalAsset; onClose: () => void }) {
  const [dataUrl, setDataUrl] = useState('');
  const url = `${location.origin}/lapor?aset=${asset.qr_token}`;
  useEffect(() => { QRCode.toDataURL(url, { width: 320, margin: 2 }).then(setDataUrl).catch(() => {}); }, [url]);
  function print() {
    const w = window.open('', '_blank');
    if (!w) return;
    w.document.write(`<html><head><title>QR ${asset.name}</title><style>body{font-family:sans-serif;text-align:center;padding:24px}img{width:320px}h2{margin:8px 0 2px}p{color:#555;margin:2px 0;font-size:13px}</style></head><body><h2>${asset.name}</h2><p>${[asset.merk, asset.model].filter(Boolean).join(' ')}${asset.serial ? ` · SN ${asset.serial}` : ''}</p><img src="${dataUrl}"/><p>Scan untuk lapor kerusakan</p></body></html>`);
    w.document.close(); w.focus(); setTimeout(() => w.print(), 300);
  }
  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-surface border border-border rounded-xl w-full max-w-xs p-5 text-center" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-bold truncate">🔳 QR — {asset.name}</h3>
          <button className="text-text2 hover:text-text text-lg" onClick={onClose}>×</button>
        </div>
        {dataUrl ? <img src={dataUrl} alt="QR" className="w-56 h-56 mx-auto bg-white rounded-lg p-2" /> : <div className="text-text2 text-sm py-10">Membuat QR…</div>}
        <div className="text-[10px] text-text2 mt-2 break-all">{url}</div>
        <button onClick={print} className="mt-3 w-full bg-accent text-bg font-semibold rounded-md px-4 py-2 text-sm">🖨️ Cetak Stiker</button>
      </div>
    </div>
  );
}
