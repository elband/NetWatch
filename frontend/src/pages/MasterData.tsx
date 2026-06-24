import { useEffect, useState } from 'react';
import { api } from '../api/client';
import LocationMap from '../components/LocationMap';
import { confirmDialog, alertDialog } from '../components/dialog';
import type { Asset, ServiceItem, LocationItem, User } from '../types';

type Tab = 'aset' | 'layanan' | 'lokasi' | 'tipe';
interface DeviceTypeItem { id: number; name: string; icon: string | null; sort_order: number }

export default function MasterData() {
  const [tab, setTab] = useState<Tab>('aset');
  return (
    <div>
      <div className="mb-4">
        <div className="text-[17px] font-bold">🗂️ Master Data</div>
        <div className="text-[11px] text-text2 mt-0.5">Kelola inventaris aset, layanan kritis, dan lokasi/area gangguan</div>
      </div>
      <div className="flex gap-2 mb-4">
        {([['aset', '📦 Aset / Inventaris'], ['layanan', '🛰️ Layanan Kritis'], ['lokasi', '📍 Lokasi'], ['tipe', '🖥️ Tipe Perangkat']] as [Tab, string][]).map(([t, label]) => (
          <button key={t} onClick={() => setTab(t)} className={`px-3.5 py-1.5 text-xs rounded-md border ${tab === t ? 'bg-accent text-bg border-accent font-semibold' : 'border-border text-text2 hover:text-white'}`}>{label}</button>
        ))}
      </div>
      {tab === 'aset' && <AssetsTab />}
      {tab === 'layanan' && <ServicesTab />}
      {tab === 'lokasi' && <LocationsTab />}
      {tab === 'tipe' && <DeviceTypesTab />}
    </div>
  );
}

const inputCls = 'bg-surface2 border border-border rounded-md px-3 py-2 text-xs outline-none focus:border-accent';
const btnPrimary = 'bg-accent text-bg rounded-md px-3 py-2 text-xs font-semibold disabled:opacity-50';
const btnGhost = 'border border-border text-text2 hover:text-text rounded px-2 py-1 text-[11px]';

// ===================== ASET =====================
function AssetsTab() {
  const [assets, setAssets] = useState<Asset[]>([]);
  const [techs, setTechs] = useState<User[]>([]);
  const empty = { name: '', code: '', category: '', qty: 1, unit: 'Unit', icon: '📦', holderUserId: 0, status: 'baik', notes: '' };
  const [form, setForm] = useState<any>(empty);
  const [editId, setEditId] = useState<number | null>(null);

  function load() { api.get('/assets').then((r) => setAssets(r.data.assets)); }
  useEffect(() => {
    load();
    api.get('/users').then((r) => setTechs(r.data.users.filter((u: User) => u.role === 'teknisi')));
  }, []);

  async function save() {
    if (!form.name.trim()) return;
    const body = { ...form, holderUserId: form.holderUserId || null };
    if (editId) await api.put(`/assets/${editId}`, body);
    else await api.post('/assets', body);
    setForm(empty); setEditId(null); load();
  }
  async function del(id: number) {
    if (!(await confirmDialog({ title: 'Hapus aset', message: 'Aset ini akan dihapus dari master data.', confirmText: '🗑️ Hapus', variant: 'danger' }))) return;
    await api.delete(`/assets/${id}`); load();
  }
  function edit(a: Asset) {
    setEditId(a.id);
    setForm({ name: a.name, code: a.code || '', category: a.category || '', qty: a.qty, unit: a.unit, icon: a.icon, holderUserId: a.holder_user_id || 0, status: a.status, notes: a.notes || '' });
  }

  return (
    <div>
      <div className="bg-surface border border-border rounded-lg p-3.5 mb-4 grid grid-cols-2 md:grid-cols-4 gap-2 items-end">
        <input className={inputCls} placeholder="Nama aset *" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        <input className={inputCls} placeholder="Kode" value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} />
        <input className={inputCls} placeholder="Kategori" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} />
        <input className={`${inputCls} w-16`} placeholder="Icon" value={form.icon} onChange={(e) => setForm({ ...form, icon: e.target.value })} />
        <input className={inputCls} type="number" placeholder="Qty" value={form.qty} onChange={(e) => setForm({ ...form, qty: Number(e.target.value) })} />
        <input className={inputCls} placeholder="Satuan" value={form.unit} onChange={(e) => setForm({ ...form, unit: e.target.value })} />
        <select className={inputCls} value={form.holderUserId} onChange={(e) => setForm({ ...form, holderUserId: Number(e.target.value) })}>
          <option value={0}>— Pemegang —</option>
          {techs.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select>
        <select className={inputCls} value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}>
          <option value="baik">Baik</option><option value="rusak">Rusak</option><option value="perbaikan">Perbaikan</option><option value="hilang">Hilang</option>
        </select>
        <input className={`${inputCls} col-span-2 md:col-span-3`} placeholder="Catatan" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
        <div className="flex gap-2">
          <button className={btnPrimary} onClick={save}>{editId ? '💾 Update' : '+ Tambah'}</button>
          {editId && <button className={btnGhost} onClick={() => { setForm(empty); setEditId(null); }}>Batal</button>}
        </div>
      </div>
      <div className="bg-surface border border-border rounded-[10px] overflow-x-auto">
        <table className="w-full text-xs">
          <thead><tr className="text-text2 uppercase text-[10px] border-b border-border">
            {['Aset', 'Kode', 'Kategori', 'Qty', 'Pemegang', 'Status', 'Aksi'].map((h) => <th key={h} className="px-3 py-2.5 text-left">{h}</th>)}
          </tr></thead>
          <tbody>
            {assets.map((a) => (
              <tr key={a.id} className="border-b border-border/50">
                <td className="px-3 py-2.5">{a.icon} <strong>{a.name}</strong></td>
                <td className="px-3 py-2.5 font-mono text-[10px] text-text2">{a.code || '-'}</td>
                <td className="px-3 py-2.5 text-text2">{a.category || '-'}</td>
                <td className="px-3 py-2.5">{a.qty} {a.unit}</td>
                <td className="px-3 py-2.5">{a.holder_name || <span className="text-text2">—</span>}</td>
                <td className="px-3 py-2.5"><StatusChip status={a.status} /></td>
                <td className="px-3 py-2.5"><div className="flex gap-1.5"><button className={btnGhost} onClick={() => edit(a)}>✏️</button><button className={`${btnGhost} text-danger`} onClick={() => del(a.id)}>🗑️</button></div></td>
              </tr>
            ))}
            {assets.length === 0 && <tr><td colSpan={7} className="px-3 py-6 text-center text-text2">Belum ada aset.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function StatusChip({ status }: { status: string }) {
  const map: Record<string, string> = { baik: 'text-success bg-success/10', rusak: 'text-danger bg-danger/10', perbaikan: 'text-warn bg-warn/10', hilang: 'text-text2 bg-border/40' };
  return <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase ${map[status] || ''}`}>{status}</span>;
}

// ===================== LAYANAN =====================
function ServicesTab() {
  const [items, setItems] = useState<ServiceItem[]>([]);
  const empty = { name: '', icon: '🟢', status: 'Online', isOk: true, detail: '', sortOrder: 0 };
  const [form, setForm] = useState<any>(empty);
  const [editId, setEditId] = useState<number | null>(null);

  function load() { api.get('/services').then((r) => setItems(r.data.services)); }
  useEffect(load, []);

  async function save() {
    if (!form.name.trim()) return;
    if (editId) await api.put(`/services/${editId}`, form);
    else await api.post('/services', form);
    setForm(empty); setEditId(null); load();
  }
  async function del(id: number) { if (await confirmDialog({ title: 'Hapus layanan', message: 'Layanan ini akan dihapus dari master data.', confirmText: '🗑️ Hapus', variant: 'danger' })) { await api.delete(`/services/${id}`); load(); } }
  function edit(s: ServiceItem) { setEditId(s.id); setForm({ name: s.name, icon: s.icon, status: s.status, isOk: !!s.is_ok, detail: s.detail || '', sortOrder: s.sort_order }); }

  return (
    <div>
      <div className="bg-surface border border-border rounded-lg p-3.5 mb-4 grid grid-cols-2 md:grid-cols-6 gap-2 items-end">
        <input className={`${inputCls} w-16`} placeholder="Icon" value={form.icon} onChange={(e) => setForm({ ...form, icon: e.target.value })} />
        <input className={inputCls} placeholder="Nama layanan *" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        <input className={inputCls} placeholder="Status (Online/Up/..)" value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })} />
        <input className={inputCls} placeholder="Detail" value={form.detail} onChange={(e) => setForm({ ...form, detail: e.target.value })} />
        <label className="flex items-center gap-1.5 text-xs text-text2"><input type="checkbox" checked={form.isOk} onChange={(e) => setForm({ ...form, isOk: e.target.checked })} /> Sehat (hijau)</label>
        <div className="flex gap-2">
          <button className={btnPrimary} onClick={save}>{editId ? '💾' : '+'}</button>
          {editId && <button className={btnGhost} onClick={() => { setForm(empty); setEditId(null); }}>Batal</button>}
        </div>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2.5">
        {items.map((s) => (
          <div key={s.id} className={`rounded-lg border p-3 ${s.is_ok ? 'border-success/25 bg-success/5' : 'border-danger/30 bg-danger/10'}`}>
            <div className="flex justify-between items-start">
              <div className="text-xl mb-1">{s.icon}</div>
              <div className="flex gap-1"><button className={btnGhost} onClick={() => edit(s)}>✏️</button><button className={`${btnGhost} text-danger`} onClick={() => del(s.id)}>🗑️</button></div>
            </div>
            <div className="text-[11px] font-semibold">{s.name}</div>
            <div className={`text-[10px] font-bold ${s.is_ok ? 'text-success' : 'text-danger'}`}>{s.status}</div>
            <div className="text-[9px] text-text2">{s.detail}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ===================== LOKASI =====================
function LocationsTab() {
  const [items, setItems] = useState<LocationItem[]>([]);
  const [mapUrl, setMapUrl] = useState<string | null>(null);
  const [placeId, setPlaceId] = useState<number | null>(null);
  const empty = { name: '', icon: '📍', sortOrder: 0 };
  const [form, setForm] = useState<any>(empty);
  const [editId, setEditId] = useState<number | null>(null);

  function load() { api.get('/locations').then((r) => { setItems(r.data.locations); setMapUrl(r.data.mapUrl || null); }); }
  useEffect(load, []);

  async function uploadMap(file: File) {
    const fd = new FormData(); fd.append('map', file);
    const r = await api.post('/locations/map', fd, { headers: { 'Content-Type': 'multipart/form-data' } });
    setMapUrl(r.data.mapUrl);
  }
  async function placeMarker(id: number, x: number, y: number) {
    await api.put(`/locations/${id}/marker`, { mapX: x, mapY: y });
    setItems((prev) => prev.map((l) => (l.id === id ? { ...l, map_x: x, map_y: y } : l)));
  }
  async function clearMarker(id: number) {
    await api.put(`/locations/${id}/marker`, { mapX: null, mapY: null });
    setItems((prev) => prev.map((l) => (l.id === id ? { ...l, map_x: null, map_y: null } : l)));
  }

  async function save() {
    if (!form.name.trim()) return;
    if (editId) await api.put(`/locations/${editId}`, form);
    else await api.post('/locations', form);
    setForm(empty); setEditId(null); load();
  }
  async function del(id: number) { if (await confirmDialog({ title: 'Hapus lokasi', message: 'Lokasi ini akan dihapus dari master data.', confirmText: '🗑️ Hapus', variant: 'danger' })) { await api.delete(`/locations/${id}`); load(); } }
  function edit(l: LocationItem) { setEditId(l.id); setForm({ name: l.name, icon: l.icon, sortOrder: l.sort_order }); }

  return (
    <div>
      <div className="bg-surface border border-border rounded-lg p-3.5 mb-4 flex gap-2 items-end flex-wrap">
        <input className={`${inputCls} w-16`} placeholder="Icon" value={form.icon} onChange={(e) => setForm({ ...form, icon: e.target.value })} />
        <input className={inputCls} placeholder="Nama lokasi *" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        <input className={`${inputCls} w-24`} type="number" placeholder="Urutan" value={form.sortOrder} onChange={(e) => setForm({ ...form, sortOrder: Number(e.target.value) })} />
        <button className={btnPrimary} onClick={save}>{editId ? '💾 Update' : '+ Tambah'}</button>
        {editId && <button className={btnGhost} onClick={() => { setForm(empty); setEditId(null); }}>Batal</button>}
      </div>
      {/* Peta gambar + penempatan titik */}
      <div className="bg-surface border border-border rounded-lg p-3.5 mb-4">
        <div className="flex items-center justify-between mb-2 flex-wrap gap-2">
          <span className="text-[12px] font-bold">🗺️ Peta Lokasi</span>
          <label className="text-[11px] border border-accent2/40 text-accent2 rounded px-2.5 py-1 cursor-pointer hover:bg-accent2/10">
            {mapUrl ? '⬆️ Ganti Gambar Peta' : '⬆️ Unggah Gambar Peta'}
            <input type="file" accept="image/*" className="hidden" onChange={(e) => e.target.files?.[0] && uploadMap(e.target.files[0])} />
          </label>
        </div>
        {mapUrl ? (
          <>
            <div className="text-[10px] text-text2 mb-2">
              {placeId ? <>Klik di peta untuk menaruh titik <span className="text-accent font-semibold">{items.find((l) => l.id === placeId)?.name}</span>.</> : 'Pilih lokasi di bawah, lalu klik di peta untuk menaruh titiknya.'}
            </div>
            <div className="flex flex-wrap gap-1.5 mb-2">
              {items.map((l) => (
                <button key={l.id} onClick={() => setPlaceId(placeId === l.id ? null : l.id)} className={`text-[11px] px-2 py-0.5 rounded border ${placeId === l.id ? 'border-accent bg-accent/15 text-accent font-semibold' : 'border-border text-text2'}`}>
                  {l.icon} {l.name} {l.map_x != null ? '📌' : ''}
                </button>
              ))}
            </div>
            <LocationMap mapUrl={mapUrl} locations={items} editable selectedId={placeId} onPlace={placeMarker} />
            {placeId && items.find((l) => l.id === placeId)?.map_x != null && (
              <button className={`${btnGhost} text-danger mt-2`} onClick={() => clearMarker(placeId)}>🗑️ Hapus titik {items.find((l) => l.id === placeId)?.name}</button>
            )}
          </>
        ) : (
          <div className="text-[11px] text-text2 py-4 text-center">Belum ada gambar peta. Unggah denah/peta lokasi, lalu taruh titik tiap lokasi di atasnya.</div>
        )}
      </div>

      <div className="grid grid-cols-2 md:grid-cols-5 gap-2.5">
        {items.map((l) => (
          <div key={l.id} className={`rounded-lg border p-3 text-center ${l.active_count > 0 ? 'border-danger/40 bg-danger/10' : 'border-border bg-surface2'}`}>
            <div className="flex justify-end gap-1"><button className={btnGhost} onClick={() => edit(l)}>✏️</button><button className={`${btnGhost} text-danger`} onClick={() => del(l.id)}>🗑️</button></div>
            <div className="text-2xl">{l.icon}</div>
            <div className="text-[11px] font-semibold">{l.name}</div>
            <div className={`text-lg font-extrabold ${l.active_count > 0 ? 'text-danger' : 'text-text2'}`}>{l.active_count}</div>
            <div className="text-[9px] text-text2">insiden aktif</div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ===================== TIPE PERANGKAT =====================
function DeviceTypesTab() {
  const [items, setItems] = useState<DeviceTypeItem[]>([]);
  const empty = { name: '', icon: '🖥️', sortOrder: 0 };
  const [form, setForm] = useState<any>(empty);
  const [editId, setEditId] = useState<number | null>(null);
  const [err, setErr] = useState('');

  function load() { api.get('/device-types').then((r) => setItems(r.data.deviceTypes)); }
  useEffect(load, []);

  async function save() {
    if (!form.name.trim()) return;
    setErr('');
    try {
      if (editId) await api.put(`/device-types/${editId}`, form);
      else await api.post('/device-types', form);
      setForm(empty); setEditId(null); load();
    } catch (e: any) { setErr(e?.response?.data?.error || 'Gagal menyimpan.'); }
  }
  async function del(id: number, name: string) {
    if (!(await confirmDialog({ title: 'Hapus tipe perangkat', message: `Tipe "${name}" akan dihapus dari master data.`, confirmText: '🗑️ Hapus', variant: 'danger' }))) return;
    try { await api.delete(`/device-types/${id}`); load(); }
    catch (e: any) { alertDialog({ title: 'Tidak bisa dihapus', message: e?.response?.data?.error || 'Gagal menghapus.', variant: 'warning' }); }
  }
  function edit(t: DeviceTypeItem) { setEditId(t.id); setForm({ name: t.name, icon: t.icon || '🖥️', sortOrder: t.sort_order }); }

  return (
    <div>
      <div className="bg-surface border border-border rounded-lg p-3.5 mb-3 flex gap-2 items-end flex-wrap">
        <input className={`${inputCls} w-16`} placeholder="Icon" value={form.icon} onChange={(e) => setForm({ ...form, icon: e.target.value })} />
        <input className={inputCls} placeholder="Nama tipe * (mis. Switch)" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        <input className={`${inputCls} w-24`} type="number" placeholder="Urutan" value={form.sortOrder} onChange={(e) => setForm({ ...form, sortOrder: Number(e.target.value) })} />
        <button className={btnPrimary} onClick={save}>{editId ? '💾 Update' : '+ Tambah'}</button>
        {editId && <button className={btnGhost} onClick={() => { setForm(empty); setEditId(null); }}>Batal</button>}
      </div>
      {err && <div className="bg-danger/10 border border-danger/30 rounded-md px-3 py-2 text-[11px] text-danger mb-3">⚠️ {err}</div>}
      <div className="text-[11px] text-text2 mb-3">Daftar ini menjadi sumber dropdown <b>Tipe</b> pada form Tambah/Edit Perangkat. Mengubah nama tipe otomatis memperbarui perangkat yang memakainya. Tipe yang masih dipakai tidak bisa dihapus.</div>
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-2.5">
        {items.map((t) => (
          <div key={t.id} className="rounded-lg border border-border bg-surface2 p-3 text-center">
            <div className="flex justify-end gap-1"><button className={btnGhost} onClick={() => edit(t)}>✏️</button><button className={`${btnGhost} text-danger`} onClick={() => del(t.id, t.name)}>🗑️</button></div>
            <div className="text-2xl">{t.icon || '🖥️'}</div>
            <div className="text-[11px] font-semibold break-words">{t.name}</div>
          </div>
        ))}
        {items.length === 0 && <div className="col-span-full text-center text-text2 text-xs py-6">Belum ada tipe perangkat.</div>}
      </div>
    </div>
  );
}
