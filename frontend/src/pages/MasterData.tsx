import { useEffect, useState } from 'react';
import { api, getActiveUnitId } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { hasRole } from '../utils/roles';
import LocationMap from '../components/LocationMap';
import { confirmDialog, alertDialog } from '../components/dialog';
import type { Asset, ServiceItem, LocationItem, Unit, User } from '../types';

type Tab = 'aset' | 'layanan' | 'lokasi' | 'tipe' | 'metrik' | 'checklist' | 'fasilitas' | 'surat-id' | 'unit';
interface DeviceTypeItem { id: number; name: string; icon: string | null; sort_order: number }

export default function MasterData() {
  const { user } = useAuth();
  const isAdmin = hasRole(user, 'admin'); // tab Unit hanya untuk Super Admin
  const [tab, setTab] = useState<Tab>('aset');
  const tabs: [Tab, string][] = [['aset', '📦 Aset / Inventaris'], ['layanan', '🛰️ Layanan Kritis'], ['lokasi', '📍 Lokasi'], ['tipe', '🖥️ Tipe Perangkat'], ['metrik', '📊 Metrik Aset'], ['checklist', '✅ Checklist'], ['fasilitas', '🏷️ Fasilitas Aset'], ['surat-id', '🖋️ Identitas Surat']];
  if (isAdmin) tabs.push(['unit', '🏢 Unit Kerja']);
  return (
    <div>
      <div className="mb-4">
        <div className="text-[17px] font-bold">🗂️ Master Data</div>
        <div className="text-[11px] text-text2 mt-0.5">Kelola inventaris aset, layanan kritis, dan lokasi/area gangguan</div>
      </div>
      <div className="flex gap-2 mb-4 flex-wrap">
        {tabs.map(([t, label]) => (
          <button key={t} onClick={() => setTab(t)} className={`px-3.5 py-1.5 text-xs rounded-md border ${tab === t ? 'bg-accent text-bg border-accent font-semibold' : 'border-border text-text2 hover:text-white'}`}>{label}</button>
        ))}
      </div>
      {tab === 'aset' && <AssetsTab />}
      {tab === 'layanan' && <ServicesTab />}
      {tab === 'lokasi' && <LocationsTab />}
      {tab === 'tipe' && <DeviceTypesTab />}
      {tab === 'metrik' && <MetricTypesTab />}
      {tab === 'checklist' && <ChecklistTemplatesTab />}
      {tab === 'fasilitas' && <FacilitiesTab />}
      {tab === 'surat-id' && <SuratIdentityTab />}
      {tab === 'unit' && isAdmin && <UnitsTab />}
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
  async function placeMarker(id: number, lat: number, lng: number) {
    await api.put(`/locations/${id}/marker`, { lat, lng });
    setItems((prev) => prev.map((l) => (l.id === id ? { ...l, lat, lng } : l)));
  }
  async function clearMarker(id: number) {
    await api.put(`/locations/${id}/marker`, { lat: null, lng: null });
    setItems((prev) => prev.map((l) => (l.id === id ? { ...l, lat: null, lng: null } : l)));
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
                  {l.icon} {l.name} {l.lat != null ? '📌' : ''}
                </button>
              ))}
            </div>
            <LocationMap mapUrl={mapUrl} locations={items} editable selectedId={placeId} onPlace={placeMarker} />
            {placeId && items.find((l) => l.id === placeId)?.lat != null && (
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

// ===================== FASILITAS ASET (Fase 5) =====================
// Grup fasilitas per unit (Kendaraan, GWT, WTP/STP, SWP, Intake) — dropdown pada
// form Aset & pengelompokan Laporan Bulanan. Ter-scope unit.
interface FacilityItem { id: number; unit_id: number | null; name: string; sort_order: number; active: number }
function FacilitiesTab() {
  const [items, setItems] = useState<FacilityItem[]>([]);
  const empty = { name: '', sort_order: 0 };
  const [form, setForm] = useState<any>(empty);
  const [editId, setEditId] = useState<number | null>(null);
  const [err, setErr] = useState('');

  function load() { api.get('/aset/facilities').then((r) => setItems(r.data.facilities || [])); }
  useEffect(load, []);

  async function save() {
    if (!form.name.trim()) { setErr('Nama fasilitas wajib diisi.'); return; }
    setErr('');
    try {
      if (editId) await api.put(`/aset/facilities/${editId}`, form);
      else await api.post('/aset/facilities', form);
      setForm(empty); setEditId(null); load();
    } catch (e: any) { setErr(e?.response?.data?.error || 'Gagal menyimpan.'); }
  }
  async function del(id: number, name: string) {
    if (!(await confirmDialog({ title: 'Hapus fasilitas', message: `Fasilitas "${name}" akan dihapus dari master.`, confirmText: '🗑️ Hapus', variant: 'danger' }))) return;
    await api.delete(`/aset/facilities/${id}`); load();
  }
  function edit(f: FacilityItem) { setEditId(f.id); setForm({ name: f.name, sort_order: f.sort_order }); }

  return (
    <div>
      <div className="bg-surface border border-border rounded-lg p-3.5 mb-3 flex gap-2 items-end flex-wrap">
        <input className={inputCls} placeholder="Nama fasilitas * (mis. GWT, Intake)" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        <input className={`${inputCls} w-24`} type="number" placeholder="Urutan" value={form.sort_order} onChange={(e) => setForm({ ...form, sort_order: Number(e.target.value) })} />
        <button className={btnPrimary} onClick={save}>{editId ? '💾 Update' : '+ Tambah'}</button>
        {editId && <button className={btnGhost} onClick={() => { setForm(empty); setEditId(null); }}>Batal</button>}
      </div>
      {err && <div className="bg-danger/10 border border-danger/30 rounded-md px-3 py-2 text-[11px] text-danger mb-3">⚠️ {err}</div>}
      <div className="text-[11px] text-text2 mb-3">Grup fasilitas untuk mengelompokkan aset di form Aset & tabel inventaris Laporan Bulanan (mis. Kendaraan & Alat Besar, GWT, WTP/STP, SWP, Intake).</div>
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2.5">
        {items.map((f) => (
          <div key={f.id} className="rounded-lg border border-border bg-surface2 p-3 flex items-center justify-between gap-2">
            <span className="text-[12px] font-semibold">{f.name}{!f.active ? ' (nonaktif)' : ''}</span>
            <div className="flex gap-1 shrink-0"><button className={btnGhost} onClick={() => edit(f)}>✏️</button><button className={`${btnGhost} text-danger`} onClick={() => del(f.id, f.name)}>🗑️</button></div>
          </div>
        ))}
        {items.length === 0 && <div className="col-span-full text-center text-text2 text-xs py-6">Belum ada fasilitas.</div>}
      </div>
    </div>
  );
}

// ===================== IDENTITAS SURAT UNIT (Fase 4) =====================
// Override per-unit untuk kop/kode surat & koordinator penandatangan. Identitas
// kantor & Kepala Seksi tetap global (di Pengaturan). Koordinator = unitnya sendiri.
const SURAT_FIELDS: [string, string, string][] = [
  ['nd_kode', 'Kode Surat', 'mis. ELBAND/APTP — dipakai pada nomor surat'],
  ['unit', 'Nama Unit (kop)', 'mis. Unit Elektronika Bandara'],
  ['koord_nama', 'Nama Koordinator', 'penandatangan surat'],
  ['koord_nip', 'NIP Koordinator', ''],
  ['koord_jabatan', 'Jabatan Koordinator', 'mis. Koordinator Unit ...'],
  ['nd_dari', 'Nota Dinas — Dari', ''],
  ['nd_yth', 'Nota Dinas — Yth', ''],
];
function SuratIdentityTab() {
  const { user } = useAuth();
  const isAdmin = hasRole(user, 'admin');
  const uid = isAdmin ? getActiveUnitId() : (user?.unit_id ?? null);
  const [cfg, setCfg] = useState<Record<string, string>>({});
  const [kopUrl, setKopUrl] = useState<string | null>(null);
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');

  useEffect(() => {
    if (!uid) return;
    api.get(`/units/${uid}/config`).then((r) => { setCfg(r.data.config || {}); setKopUrl(r.data.config?.kop_url || null); }).catch(() => {});
  }, [uid]);

  if (!uid) return <div className="text-[12px] text-text2 bg-surface2 border border-border rounded-md px-3 py-4">Pilih satu unit di switcher header untuk mengatur identitas suratnya.</div>;

  async function save() {
    setErr(''); setMsg('');
    try { await api.put(`/units/${uid}/config`, cfg); setMsg('✅ Identitas surat unit tersimpan.'); }
    catch (e: any) { setErr(e?.response?.data?.error || 'Gagal menyimpan.'); }
  }
  async function uploadKop(file: File) {
    setErr(''); setMsg('');
    const fd = new FormData(); fd.append('kop', file);
    try { const r = await api.post(`/units/${uid}/kop`, fd, { headers: { 'Content-Type': 'multipart/form-data' } }); setKopUrl(r.data.kop_url); setCfg((c) => ({ ...c, kop_url: r.data.kop_url })); setMsg('✅ Kop diunggah.'); }
    catch (e: any) { setErr(e?.response?.data?.error || 'Gagal unggah kop.'); }
  }

  return (
    <div>
      <div className="text-[11px] text-text2 mb-3">Identitas ini menimpa pengaturan global <b>hanya untuk unit ini</b> saat membuat surat/laporan (kop, kode & nomor surat, penandatangan koordinator). Identitas kantor & Kepala Seksi diatur global di menu Pengaturan.</div>
      <div className="bg-surface border border-border rounded-lg p-4 grid grid-cols-1 sm:grid-cols-2 gap-3 max-w-3xl">
        {SURAT_FIELDS.map(([key, label, hint]) => (
          <label key={key} className="block">
            <span className="text-[11px] text-text2">{label}</span>
            <input className={`${inputCls} w-full`} value={cfg[key] || ''} onChange={(e) => setCfg({ ...cfg, [key]: e.target.value })} placeholder={hint} />
          </label>
        ))}
        <div className="sm:col-span-2">
          <span className="text-[11px] text-text2">Kop / Letterhead (gambar)</span>
          <div className="flex items-center gap-3 mt-1">
            {kopUrl ? <img src={kopUrl} alt="kop" className="h-12 bg-white rounded border border-border" /> : <span className="text-[11px] text-text2">Belum ada kop unit</span>}
            <label className="cursor-pointer text-[11px] bg-surface2 border border-border rounded px-3 py-1.5 hover:text-white">
              📤 Unggah kop<input type="file" accept="image/*" className="hidden" onChange={(e) => { if (e.target.files?.[0]) uploadKop(e.target.files[0]); }} />
            </label>
          </div>
        </div>
      </div>
      {msg && <div className="text-[12px] text-success mt-2">{msg}</div>}
      {err && <div className="text-[12px] text-danger mt-2">⚠️ {err}</div>}
      <button className={`${btnPrimary} mt-3`} onClick={save}>💾 Simpan Identitas Surat</button>
    </div>
  );
}

// ===================== UNIT KERJA (Super Admin) =====================
function UnitsTab() {
  const [items, setItems] = useState<Unit[]>([]);
  const empty = { code: '', name: '', description: '', icon: '🏢' };
  const [form, setForm] = useState<any>(empty);
  const [editId, setEditId] = useState<number | null>(null);
  const [err, setErr] = useState('');

  function load() { api.get('/units').then((r) => setItems(r.data.units || [])); }
  useEffect(load, []);

  async function save() {
    if (!form.code.trim() || !form.name.trim()) return setErr('Kode dan nama unit wajib diisi.');
    setErr('');
    try {
      if (editId) await api.put(`/units/${editId}`, form);
      else await api.post('/units', form);
      setForm(empty); setEditId(null); load();
    } catch (e: any) { setErr(e?.response?.data?.error || 'Gagal menyimpan unit.'); }
  }
  async function toggleActive(u: Unit) {
    try { await api.put(`/units/${u.id}`, { active: !(u.active !== 0 && u.active !== false) }); load(); }
    catch (e: any) { alertDialog({ title: 'Gagal', message: e?.response?.data?.error || 'Gagal mengubah status unit.', variant: 'danger' }); }
  }
  async function del(u: Unit) {
    if (!(await confirmDialog({ title: `Hapus unit ${u.code}`, message: `${u.name}\n\nHanya bisa dihapus bila tidak ada user/data tertaut. Alternatif: nonaktifkan saja.`, confirmText: '🗑️ Hapus', variant: 'danger' }))) return;
    try { await api.delete(`/units/${u.id}`); load(); }
    catch (e: any) { alertDialog({ title: 'Tidak bisa dihapus', message: e?.response?.data?.error || 'Gagal menghapus unit.', variant: 'warning' }); }
  }
  function edit(u: Unit) { setEditId(u.id); setForm({ code: u.code, name: u.name, description: u.description || '', icon: u.icon || '🏢' }); }

  return (
    <div>
      <div className="text-[11px] text-text2 mb-3">Setiap unit dipimpin koordinator (admin unitnya) dengan data terisolasi: perangkat, insiden, jadwal, laporan, dan surat per unit. Super Admin melihat semuanya lewat pemilih unit di header.</div>
      <div className="bg-surface border border-border rounded-lg p-3.5 mb-4 flex gap-2 items-end flex-wrap">
        <input className={`${inputCls} w-16`} placeholder="Icon" value={form.icon} onChange={(e) => setForm({ ...form, icon: e.target.value })} />
        <input className={`${inputCls} w-24 uppercase`} placeholder="Kode *" value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })} />
        <input className={inputCls} placeholder="Nama unit *" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        <input className={`${inputCls} min-w-[220px]`} placeholder="Deskripsi" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
        <button className={btnPrimary} onClick={save}>{editId ? '💾 Update' : '+ Tambah'}</button>
        {editId && <button className={btnGhost} onClick={() => { setForm(empty); setEditId(null); }}>Batal</button>}
      </div>
      {err && <div className="bg-danger/10 border border-danger/30 rounded-md px-3 py-2 text-[11px] text-danger mb-3">⚠️ {err}</div>}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-2.5">
        {items.map((u) => {
          const aktif = u.active !== 0 && u.active !== false;
          return (
            <div key={u.id} className={`rounded-lg border p-3.5 ${aktif ? 'border-border bg-surface2' : 'border-warn/40 bg-warn/5 opacity-70'}`}>
              <div className="flex items-start justify-between">
                <div className="text-2xl">{u.icon || '🏢'}</div>
                <div className="flex gap-1">
                  <button className={btnGhost} onClick={() => edit(u)}>✏️</button>
                  <button className={btnGhost} onClick={() => toggleActive(u)}>{aktif ? '⏸️' : '▶️'}</button>
                  <button className={`${btnGhost} text-danger`} onClick={() => del(u)}>🗑️</button>
                </div>
              </div>
              <div className="text-[12px] font-bold mt-1">{u.code} — {u.name}</div>
              <div className="text-[10px] text-text2 mt-0.5">{u.description || '—'}</div>
              {!aktif && <div className="text-[10px] text-warn font-semibold mt-1">⏸️ Nonaktif</div>}
            </div>
          );
        })}
        {items.length === 0 && <div className="col-span-full text-center text-text2 text-xs py-6">Belum ada unit.</div>}
      </div>
    </div>
  );
}

// ===================== TIPE PERANGKAT =====================
// ===================== METRIK ASET (Fase 2) =====================
// Definisi metrik meter per unit (jam operasi, BBM, tekanan, dst.) — sumber
// dropdown pada form pembacaan meter di halaman Aset. Ter-scope unit di backend.
interface MetricTypeItem { id: number; unit_id: number | null; metric_key: string; label: string; satuan: string | null; is_cumulative: number; sort_order: number; active: number }
function MetricTypesTab() {
  const [items, setItems] = useState<MetricTypeItem[]>([]);
  const empty = { metric_key: '', label: '', satuan: '', is_cumulative: false, sort_order: 0 };
  const [form, setForm] = useState<any>(empty);
  const [editId, setEditId] = useState<number | null>(null);
  const [err, setErr] = useState('');

  function load() { api.get('/aset/metric-types').then((r) => setItems(r.data.metricTypes || [])); }
  useEffect(load, []);

  async function save() {
    if (!form.label.trim()) { setErr('Label metrik wajib diisi.'); return; }
    if (!editId && !form.metric_key.trim()) { setErr('Kunci metrik wajib diisi.'); return; }
    setErr('');
    try {
      if (editId) await api.put(`/aset/metric-types/${editId}`, form);
      else await api.post('/aset/metric-types', form);
      setForm(empty); setEditId(null); load();
    } catch (e: any) { setErr(e?.response?.data?.error || 'Gagal menyimpan.'); }
  }
  async function del(id: number, label: string) {
    if (!(await confirmDialog({ title: 'Hapus metrik', message: `Metrik "${label}" akan dihapus. Pembacaan lama tetap tersimpan.`, confirmText: '🗑️ Hapus', variant: 'danger' }))) return;
    try { await api.delete(`/aset/metric-types/${id}`); load(); }
    catch (e: any) { alertDialog({ title: 'Tidak bisa dihapus', message: e?.response?.data?.error || 'Gagal menghapus.', variant: 'warning' }); }
  }
  function edit(m: MetricTypeItem) { setEditId(m.id); setForm({ metric_key: m.metric_key, label: m.label, satuan: m.satuan || '', is_cumulative: !!m.is_cumulative, sort_order: m.sort_order }); }

  return (
    <div>
      <div className="bg-surface border border-border rounded-lg p-3.5 mb-3 flex gap-2 items-end flex-wrap">
        <input className={`${inputCls} w-36`} placeholder="Kunci (mis. jam_operasi)" value={form.metric_key} disabled={!!editId} onChange={(e) => setForm({ ...form, metric_key: e.target.value })} />
        <input className={inputCls} placeholder="Label * (mis. Jam Operasi)" value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value })} />
        <input className={`${inputCls} w-24`} placeholder="Satuan" value={form.satuan} onChange={(e) => setForm({ ...form, satuan: e.target.value })} />
        <label className="flex items-center gap-1.5 text-[11px] text-text2"><input type="checkbox" checked={form.is_cumulative} onChange={(e) => setForm({ ...form, is_cumulative: e.target.checked })} /> Kumulatif</label>
        <input className={`${inputCls} w-20`} type="number" placeholder="Urutan" value={form.sort_order} onChange={(e) => setForm({ ...form, sort_order: Number(e.target.value) })} />
        <button className={btnPrimary} onClick={save}>{editId ? '💾 Update' : '+ Tambah'}</button>
        {editId && <button className={btnGhost} onClick={() => { setForm(empty); setEditId(null); }}>Batal</button>}
      </div>
      {err && <div className="bg-danger/10 border border-danger/30 rounded-md px-3 py-2 text-[11px] text-danger mb-3">⚠️ {err}</div>}
      <div className="text-[11px] text-text2 mb-3">Metrik meter yang dicatat pada aset unit ini (halaman <b>Aset & Peralatan</b>). <i>Kumulatif</i> = nilai selalu naik (mis. jam operasi/hour meter) — dasar preventive maintenance berbasis interval nanti.</div>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead><tr className="text-left text-text2 border-b border-border">
            <th className="px-3 py-2">Label</th><th className="px-3 py-2">Kunci</th><th className="px-3 py-2">Satuan</th><th className="px-3 py-2">Kumulatif</th><th className="px-3 py-2">Urutan</th><th className="px-3 py-2"></th>
          </tr></thead>
          <tbody>
            {items.map((m) => (
              <tr key={m.id} className="border-b border-border/60">
                <td className="px-3 py-2.5 font-semibold">{m.label}{!m.active ? ' (nonaktif)' : ''}</td>
                <td className="px-3 py-2.5 font-mono text-text2">{m.metric_key}</td>
                <td className="px-3 py-2.5">{m.satuan || '—'}</td>
                <td className="px-3 py-2.5">{m.is_cumulative ? '✅' : '—'}{m.unit_id == null ? ' · global' : ''}</td>
                <td className="px-3 py-2.5">{m.sort_order}</td>
                <td className="px-3 py-2.5"><div className="flex gap-1.5"><button className={btnGhost} onClick={() => edit(m)}>✏️</button><button className={`${btnGhost} text-danger`} onClick={() => del(m.id, m.label)}>🗑️</button></div></td>
              </tr>
            ))}
            {items.length === 0 && <tr><td colSpan={6} className="text-center text-text2 py-6">Belum ada metrik. Tambahkan mis. Jam Operasi, BBM, Tekanan.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ===================== CHECKLIST TEMPLATE (Fase 3) =====================
// Template checklist inspeksi per unit — item satu per baris. Dipakai di halaman
// Aset & Peralatan (tombol Checklist). Ter-scope unit di backend.
interface ChecklistTpl { id: number; unit_id: number | null; name: string; category: string | null; active: number; items: { id?: number; label: string }[] }
function ChecklistTemplatesTab() {
  const [items, setItems] = useState<ChecklistTpl[]>([]);
  const empty = { name: '', category: '', itemsText: '' };
  const [form, setForm] = useState<any>(empty);
  const [editId, setEditId] = useState<number | null>(null);
  const [err, setErr] = useState('');

  function load() { api.get('/aset/checklist-templates').then((r) => setItems(r.data.templates || [])); }
  useEffect(load, []);

  async function save() {
    if (!form.name.trim()) { setErr('Nama template wajib diisi.'); return; }
    setErr('');
    const itemList = String(form.itemsText).split('\n').map((s: string) => s.trim()).filter(Boolean).map((label: string) => ({ label }));
    const body = { name: form.name, category: form.category || null, items: itemList };
    try {
      if (editId) await api.put(`/aset/checklist-templates/${editId}`, body);
      else await api.post('/aset/checklist-templates', body);
      setForm(empty); setEditId(null); load();
    } catch (e: any) { setErr(e?.response?.data?.error || 'Gagal menyimpan.'); }
  }
  async function del(id: number, name: string) {
    if (!(await confirmDialog({ title: 'Hapus template', message: `Template "${name}" akan dihapus.`, confirmText: '🗑️ Hapus', variant: 'danger' }))) return;
    await api.delete(`/aset/checklist-templates/${id}`); load();
  }
  function edit(t: ChecklistTpl) { setEditId(t.id); setForm({ name: t.name, category: t.category || '', itemsText: (t.items || []).map((i) => i.label).join('\n') }); }

  return (
    <div>
      <div className="bg-surface border border-border rounded-lg p-3.5 mb-3 grid grid-cols-1 sm:grid-cols-2 gap-2">
        <input className={inputCls} placeholder="Nama template * (mis. Inspeksi Harian Excavator)" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        <input className={inputCls} placeholder="Kategori/jenis alat (opsional, cocokkan ke aset)" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} />
        <textarea className={`${inputCls} sm:col-span-2 min-h-[90px]`} placeholder={'Item checklist — satu per baris\nmis.\nLevel oli mesin\nTekanan ban\nRem'} value={form.itemsText} onChange={(e) => setForm({ ...form, itemsText: e.target.value })} />
        <div className="sm:col-span-2 flex gap-2">
          <button className={btnPrimary} onClick={save}>{editId ? '💾 Update' : '+ Tambah'}</button>
          {editId && <button className={btnGhost} onClick={() => { setForm(empty); setEditId(null); }}>Batal</button>}
        </div>
      </div>
      {err && <div className="bg-danger/10 border border-danger/30 rounded-md px-3 py-2 text-[11px] text-danger mb-3">⚠️ {err}</div>}
      <div className="text-[11px] text-text2 mb-3">Template dipakai di halaman <b>Aset & Peralatan</b> (tombol Checklist). Kategori kosong = berlaku untuk semua aset unit; diisi = hanya aset dgn jenis/kategori itu.</div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
        {items.map((t) => (
          <div key={t.id} className="rounded-lg border border-border bg-surface2 p-3">
            <div className="flex items-start justify-between gap-2">
              <div><div className="text-sm font-semibold">{t.name}</div>{t.category && <div className="text-[10px] text-text2">Jenis: {t.category}</div>}</div>
              <div className="flex gap-1"><button className={btnGhost} onClick={() => edit(t)}>✏️</button><button className={`${btnGhost} text-danger`} onClick={() => del(t.id, t.name)}>🗑️</button></div>
            </div>
            <div className="text-[11px] text-text2 mt-1.5">{(t.items || []).length} item: {(t.items || []).map((i) => i.label).join(', ') || '—'}</div>
          </div>
        ))}
        {items.length === 0 && <div className="col-span-full text-center text-text2 text-xs py-6">Belum ada template checklist.</div>}
      </div>
    </div>
  );
}

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
