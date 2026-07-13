import { useCallback, useEffect, useRef, useState } from 'react';
import type { BrowserMultiFormatReader } from '@zxing/library'; // tipe saja; runtime di-lazy-load (bundle lebih kecil)
import QRCode from 'qrcode';
import JsBarcode from 'jsbarcode';
import { api, getActiveUnitId } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { hasRole } from '../utils/roles';
import { confirmDialog } from '../components/dialog';
import type { Sparepart, SparepartMove, SparepartCategory, SparepartStats, Incident } from '../types';

const MOVE: Record<string, { label: string; cls: string }> = {
  masuk: { label: 'Masuk', cls: 'text-success' },
  keluar: { label: 'Keluar', cls: 'text-danger' },
  adjust: { label: 'Penyesuaian', cls: 'text-warn' },
};

const PURPOSE: Record<string, string> = { maintenance: '🔧 Maintenance', perbaikan: '🛠️ Perbaikan' };
type Purpose = '' | 'maintenance' | 'perbaikan';

// Selector tujuan pengeluaran barang (hanya untuk mutasi "keluar"):
// Maintenance (perangkat opsional) atau Perbaikan Peralatan (wajib pilih tiket insiden).
function KeluarTujuan({ purpose, setPurpose, incidentId, setIncidentId, deviceId, setDeviceId }: {
  purpose: Purpose; setPurpose: (p: Purpose) => void;
  incidentId: string; setIncidentId: (v: string) => void;
  deviceId: string; setDeviceId: (v: string) => void;
}) {
  const [incidents, setIncidents] = useState<Incident[]>([]);
  const [devices, setDevices] = useState<{ id: number; name: string }[]>([]);
  useEffect(() => {
    api.get('/incidents').then((r) => setIncidents((r.data.incidents || []).filter((i: Incident) => i.status !== 'selesai'))).catch(() => setIncidents([]));
    api.get('/devices').then((r) => setDevices((r.data.devices || []).map((d: any) => ({ id: d.id, name: d.name })))).catch(() => setDevices([]));
  }, []);
  const sel = 'w-full bg-surface2 border border-border rounded-md px-2 py-1.5 text-xs outline-none focus:border-accent';
  return (
    <div className="bg-surface2/50 border border-border rounded-lg p-2.5 space-y-2">
      <div>
        <div className="text-[10px] text-text2 mb-1">Tujuan pengeluaran *</div>
        <div className="flex gap-1">
          {(['maintenance', 'perbaikan'] as const).map((p) => (
            <button key={p} type="button" onClick={() => setPurpose(p)}
              className={`flex-1 px-2 py-1.5 rounded-md text-[11px] border ${purpose === p ? 'bg-danger/15 text-danger border-danger/40 font-semibold' : 'bg-surface2 text-text2 border-border'}`}>{PURPOSE[p]}</button>
          ))}
        </div>
      </div>
      {purpose === 'perbaikan' && (
        <label className="block"><span className="text-[10px] text-text2">Tiket insiden * <span className="text-text2/60">(perangkat ikut dari tiket)</span></span>
          <select className={sel} value={incidentId} onChange={(e) => setIncidentId(e.target.value)}>
            <option value="">— Pilih tiket —</option>
            {incidents.map((i) => <option key={i.id} value={i.id}>{i.id} · {i.device_name} — {i.issue}</option>)}
          </select>
          {incidents.length === 0 && <span className="text-[10px] text-warn">Tidak ada tiket aktif di unit ini.</span>}
        </label>
      )}
      {purpose === 'maintenance' && (
        <label className="block"><span className="text-[10px] text-text2">Perangkat <span className="text-text2/60">(opsional)</span></span>
          <select className={sel} value={deviceId} onChange={(e) => setDeviceId(e.target.value)}>
            <option value="">— Tanpa perangkat —</option>
            {devices.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
        </label>
      )}
    </div>
  );
}

type Tab = 'dashboard' | 'master' | 'kategori' | 'mutasi' | 'laporan';

const card = 'bg-surface border border-border rounded-xl';
const inp = 'w-full bg-surface2 border border-border rounded-md px-3 py-2 text-sm outline-none focus:border-accent';

// Cetak lewat iframe tersembunyi (andal & tanpa pop-up blocker). Konten = HTML lengkap <body>.
function printHtml(bodyHtml: string, title = 'Cetak') {
  const iframe = document.createElement('iframe');
  iframe.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;';
  document.body.appendChild(iframe);
  const doc = iframe.contentWindow!.document;
  doc.open();
  doc.write(`<html><head><title>${title}</title></head><body>${bodyHtml}</body></html>`);
  doc.close();
  const w = iframe.contentWindow!;
  w.focus();
  setTimeout(() => { w.print(); setTimeout(() => iframe.remove(), 1500); }, 350);
}

// SKU → data URL barcode 1D (Code128) & QR (2D). Dipakai untuk label & preview.
function barcodeDataUrl(text: string): string {
  const c = document.createElement('canvas');
  try { JsBarcode(c, text, { format: 'CODE128', width: 2, height: 60, fontSize: 14, margin: 6 }); }
  catch { return ''; }
  return c.toDataURL('image/png');
}

export default function Spareparts() {
  const { user } = useAuth();
  const canManage = hasRole(user, 'admin', 'koordinator');
  const isAdmin = hasRole(user, 'admin');
  const needUnit = isAdmin && !getActiveUnitId();

  const [tab, setTab] = useState<Tab>('dashboard');
  const [items, setItems] = useState<Sparepart[]>([]);
  const [cats, setCats] = useState<SparepartCategory[]>([]);
  const [stats, setStats] = useState<SparepartStats | null>(null);
  const [loading, setLoading] = useState(true);

  const [form, setForm] = useState<any>(empty());
  const [editId, setEditId] = useState<number | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [formErr, setFormErr] = useState('');
  const [moveItem, setMoveItem] = useState<Sparepart | null>(null);
  const [labelItem, setLabelItem] = useState<Sparepart | null>(null);
  const [scanOpen, setScanOpen] = useState(false);

  function empty() { return { name: '', part_no: '', sku: '', category_id: '', satuan: 'pcs', stock_qty: '', min_qty: '', location: '', notes: '' }; }

  const load = useCallback(() => {
    if (needUnit) { setLoading(false); return; }
    setLoading(true);
    Promise.all([
      api.get('/spareparts').then((r) => setItems(r.data.spareparts || [])).catch(() => setItems([])),
      api.get('/spareparts/categories').then((r) => setCats(r.data.categories || [])).catch(() => setCats([])),
      api.get('/spareparts/stats').then((r) => setStats(r.data)).catch(() => setStats(null)),
    ]).finally(() => setLoading(false));
  }, [needUnit]);
  useEffect(() => { load(); }, [load]);

  function openCreate() { setForm(empty()); setEditId(null); setFormErr(''); setShowForm(true); }
  function openEdit(s: Sparepart) {
    setForm({ name: s.name, part_no: s.part_no || '', sku: s.sku || '', category_id: s.category_id ? String(s.category_id) : '', satuan: s.satuan, stock_qty: s.stock_qty, min_qty: s.min_qty, location: s.location || '', notes: s.notes || '' });
    setEditId(s.id); setFormErr(''); setShowForm(true);
  }
  async function saveForm() {
    if (!form.name.trim()) { setFormErr('Nama wajib diisi.'); return; }
    try {
      if (editId) await api.put(`/spareparts/${editId}`, form);
      else await api.post('/spareparts', form);
      setShowForm(false); load();
    } catch (e: any) { setFormErr(e?.response?.data?.error || 'Gagal menyimpan.'); }
  }
  async function del(s: Sparepart) {
    if (!await confirmDialog(`Hapus sparepart "${s.name}"? Riwayat stok ikut terhapus.`)) return;
    await api.delete(`/spareparts/${s.id}`); load();
  }

  const tabs: [Tab, string][] = [['dashboard', '📊 Dashboard'], ['master', '📦 Master Barang'], ['kategori', '🏷️ Kategori'], ['mutasi', '↕ Mutasi'], ['laporan', '📄 Laporan']];

  return (
    <div className="p-4 sm:p-6 max-w-6xl mx-auto">
      <div className="flex items-center justify-between gap-3 mb-3 flex-wrap">
        <div>
          <h1 className="text-lg font-bold">🧰 Manajemen Suku Cadang</h1>
          <p className="text-[12px] text-text2">Inventaris suku cadang per unit — stok, kategori, scan QR/barcode & laporan.</p>
        </div>
        <div className="flex gap-2">
          {!needUnit && <button onClick={() => setScanOpen(true)} className="bg-accent2 text-bg font-semibold rounded-md px-3 py-2 text-sm">📷 Scan Masuk/Keluar</button>}
          {canManage && !needUnit && <button onClick={openCreate} className="bg-accent text-bg font-semibold rounded-md px-3 py-2 text-sm">+ Barang</button>}
        </div>
      </div>

      {needUnit ? (
        <div className="bg-warn/10 border border-warn/30 text-warn rounded-lg px-4 py-3 text-[13px]">Pilih satu unit di switcher header untuk mengelola suku cadang.</div>
      ) : (
        <>
          <div className="flex gap-1 mb-4 flex-wrap">
            {tabs.map(([id, label]) => (
              <button key={id} onClick={() => setTab(id)} className={`px-3 py-1.5 rounded-md text-xs font-medium border ${tab === id ? 'bg-accent text-bg border-accent' : 'bg-surface2 text-text2 border-border hover:text-white'}`}>{label}</button>
            ))}
          </div>

          {loading ? (
            <div className="text-text2 text-sm py-10 text-center">Memuat…</div>
          ) : tab === 'dashboard' ? (
            <DashboardTab stats={stats} onGoto={() => setTab('master')} />
          ) : tab === 'master' ? (
            <MasterTab items={items} canManage={canManage} onMove={setMoveItem} onEdit={openEdit} onDel={del} onLabel={setLabelItem} />
          ) : tab === 'kategori' ? (
            <KategoriTab cats={cats} canManage={canManage} onChanged={load} />
          ) : tab === 'mutasi' ? (
            <MutasiTab />
          ) : (
            <LaporanTab />
          )}
        </>
      )}

      {showForm && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4" onClick={() => setShowForm(false)}>
          <div className={`${card} w-full max-w-lg max-h-[90vh] overflow-y-auto p-5`} onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-3"><h3 className="text-sm font-bold">{editId ? 'Edit Barang' : 'Tambah Barang'}</h3><button className="text-text2 hover:text-text text-lg" onClick={() => setShowForm(false)}>×</button></div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              <label className="block sm:col-span-2"><span className="text-[10px] text-text2">Nama *</span><input className={inp} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="mis. Konektor RJ45" /></label>
              <label className="block"><span className="text-[10px] text-text2">Part No</span><input className={inp} value={form.part_no} onChange={(e) => setForm({ ...form, part_no: e.target.value })} /></label>
              <label className="block"><span className="text-[10px] text-text2">SKU / Barcode <span className="text-text2">(auto bila kosong)</span></span><input className={inp} value={form.sku} onChange={(e) => setForm({ ...form, sku: e.target.value })} placeholder="SP000123" /></label>
              <label className="block"><span className="text-[10px] text-text2">Kategori</span>
                <select className={inp} value={form.category_id} onChange={(e) => setForm({ ...form, category_id: e.target.value })}>
                  <option value="">— Tanpa kategori —</option>
                  {cats.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </label>
              <label className="block"><span className="text-[10px] text-text2">Satuan</span><input className={inp} value={form.satuan} onChange={(e) => setForm({ ...form, satuan: e.target.value })} placeholder="pcs / meter / set" /></label>
              {!editId && <label className="block"><span className="text-[10px] text-text2">Stok awal</span><input className={inp} inputMode="decimal" value={form.stock_qty} onChange={(e) => setForm({ ...form, stock_qty: e.target.value })} /></label>}
              <label className="block"><span className="text-[10px] text-text2">Stok minimum (alert)</span><input className={inp} inputMode="decimal" value={form.min_qty} onChange={(e) => setForm({ ...form, min_qty: e.target.value })} /></label>
              <label className="block"><span className="text-[10px] text-text2">Lokasi simpan</span><input className={inp} value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} /></label>
              <label className="block sm:col-span-2"><span className="text-[10px] text-text2">Catatan</span><input className={inp} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></label>
            </div>
            {formErr && <div className="mt-2 text-[12px] text-danger">⚠️ {formErr}</div>}
            <div className="mt-4 flex gap-2"><button onClick={saveForm} className="bg-accent text-bg font-semibold rounded-md px-4 py-2 text-sm">{editId ? '💾 Simpan' : '+ Tambah'}</button><button onClick={() => setShowForm(false)} className="border border-border text-text2 rounded-md px-4 py-2 text-sm">Batal</button></div>
          </div>
        </div>
      )}

      {moveItem && <MoveModal sp={moveItem} onClose={() => setMoveItem(null)} onSaved={load} />}
      {labelItem && <LabelModal sp={labelItem} onClose={() => setLabelItem(null)} />}
      {scanOpen && <ScanModal onClose={() => { setScanOpen(false); load(); }} />}
    </div>
  );
}

function StatCard({ label, value, sub, tone }: { label: string; value: string | number; sub?: string; tone?: 'danger' | 'warn' | 'success' }) {
  const c = tone === 'danger' ? 'text-danger' : tone === 'warn' ? 'text-warn' : tone === 'success' ? 'text-success' : '';
  return (
    <div className={`${card} p-4`}>
      <div className="text-[11px] text-text2">{label}</div>
      <div className={`text-2xl font-bold mt-1 ${c}`}>{value}</div>
      {sub && <div className="text-[10px] text-text2 mt-0.5">{sub}</div>}
    </div>
  );
}

function DashboardTab({ stats, onGoto }: { stats: SparepartStats | null; onGoto: () => void }) {
  if (!stats) return <div className={`${card} p-10 text-center text-text2 text-sm`}>Statistik belum tersedia.</div>;
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <StatCard label="Jenis Barang" value={stats.total_items} sub="item aktif" />
        <StatCard label="Total Stok" value={stats.total_stock} sub="seluruh satuan" />
        <StatCard label="Stok Menipis" value={stats.low_count} tone={stats.low_count > 0 ? 'warn' : undefined} sub="≤ minimum" />
        <StatCard label="Stok Habis" value={stats.out_count} tone={stats.out_count > 0 ? 'danger' : undefined} sub="= 0" />
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <StatCard label="Barang Masuk (bln ini)" value={stats.moves_month.masuk} tone="success" />
        <StatCard label="Barang Keluar (bln ini)" value={stats.moves_month.keluar} tone="danger" />
        <StatCard label="Kategori" value={stats.by_category.length} sub="kelompok" />
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        <div className={`${card} p-4`}>
          <div className="text-sm font-semibold mb-2">Stok per Kategori</div>
          {stats.by_category.length === 0 ? <div className="text-text2 text-xs">Belum ada data.</div> : (
            <div className="space-y-1.5">
              {stats.by_category.map((c) => (
                <div key={c.category} className="flex items-center justify-between text-xs">
                  <span className="truncate">{c.category}</span>
                  <span className="text-text2">{c.items} jenis · {Number(c.stock)} stok</span>
                </div>
              ))}
            </div>
          )}
        </div>
        <div className={`${card} p-4`}>
          <div className="flex items-center justify-between mb-2"><div className="text-sm font-semibold">⚠️ Stok Menipis</div>{stats.low_items.length > 0 && <button onClick={onGoto} className="text-[11px] text-accent">Kelola →</button>}</div>
          {stats.low_items.length === 0 ? <div className="text-text2 text-xs">Semua stok aman. 👍</div> : (
            <div className="space-y-1.5">
              {stats.low_items.map((s) => (
                <div key={s.id} className="flex items-center justify-between text-xs">
                  <span className="truncate">{s.name}{s.part_no ? ` · ${s.part_no}` : ''}</span>
                  <span className="text-danger font-semibold">{Number(s.stock_qty)}/{Number(s.min_qty)} {s.satuan}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function MasterTab({ items, canManage, onMove, onEdit, onDel, onLabel }: {
  items: Sparepart[]; canManage: boolean;
  onMove: (s: Sparepart) => void; onEdit: (s: Sparepart) => void; onDel: (s: Sparepart) => void; onLabel: (s: Sparepart) => void;
}) {
  const [q, setQ] = useState('');
  const btnGhost = 'px-2 py-1 rounded-md border border-border text-text2 hover:text-white text-xs';
  const filtered = items.filter((s) => {
    if (!q.trim()) return true;
    const h = `${s.name} ${s.part_no || ''} ${s.sku || ''} ${s.category_name || s.category || ''} ${s.location || ''}`.toLowerCase();
    return h.includes(q.trim().toLowerCase());
  });
  return (
    <div>
      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="🔍 Cari nama, SKU, part no, kategori, lokasi…" className={`${inp} mb-3`} />
      {filtered.length === 0 ? (
        <div className={`${card} p-10 text-center text-text2 text-sm`}>{items.length === 0 ? 'Belum ada barang.' : 'Tidak ada yang cocok.'}</div>
      ) : (
        <div className={`${card} overflow-x-auto`}>
          <table className="w-full text-xs">
            <thead><tr className="text-left text-text2 border-b border-border">
              <th className="px-3 py-2.5">Nama</th><th className="px-3 py-2.5">SKU</th><th className="px-3 py-2.5">Kategori</th><th className="px-3 py-2.5">Stok</th><th className="px-3 py-2.5">Min</th><th className="px-3 py-2.5">Lokasi</th><th className="px-3 py-2.5"></th>
            </tr></thead>
            <tbody>
              {filtered.map((s) => {
                const low = Number(s.stock_qty) <= Number(s.min_qty) && Number(s.min_qty) > 0;
                return (
                  <tr key={s.id} className="border-b border-border/60">
                    <td className="px-3 py-2.5"><div className="font-semibold">{s.name}</div>{s.part_no && <div className="text-[10px] text-text2 font-mono">{s.part_no}</div>}</td>
                    <td className="px-3 py-2.5 font-mono text-text2">{s.sku || '—'}</td>
                    <td className="px-3 py-2.5 text-text2">{s.category_name || s.category || '—'}</td>
                    <td className={`px-3 py-2.5 font-bold ${low ? 'text-danger' : ''}`}>{Number(s.stock_qty)} {s.satuan}{low && ' ⚠'}</td>
                    <td className="px-3 py-2.5 text-text2">{Number(s.min_qty)}</td>
                    <td className="px-3 py-2.5 text-text2">{s.location || '—'}</td>
                    <td className="px-3 py-2.5"><div className="flex gap-1.5 justify-end">
                      <button className="px-2 py-1 rounded-md bg-accent/15 text-accent border border-accent/30 text-xs font-medium" onClick={() => onMove(s)}>↕ Stok</button>
                      <button className={btnGhost} title="Cetak label QR/Barcode" onClick={() => onLabel(s)}>🏷️</button>
                      {canManage && <button className={btnGhost} onClick={() => onEdit(s)}>✏️</button>}
                      {canManage && <button className={`${btnGhost} text-danger`} onClick={() => onDel(s)}>🗑️</button>}
                    </div></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function KategoriTab({ cats, canManage, onChanged }: { cats: SparepartCategory[]; canManage: boolean; onChanged: () => void }) {
  const [name, setName] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  async function add() {
    if (!name.trim()) return;
    setBusy(true); setErr('');
    try { await api.post('/spareparts/categories', { name: name.trim() }); setName(''); onChanged(); }
    catch (e: any) { setErr(e?.response?.data?.error || 'Gagal menambah.'); }
    finally { setBusy(false); }
  }
  async function del(c: SparepartCategory) {
    if (!await confirmDialog(`Hapus kategori "${c.name}"? Barang terkait jadi tanpa kategori.`)) return;
    await api.delete(`/spareparts/categories/${c.id}`); onChanged();
  }
  return (
    <div className="max-w-lg">
      {canManage && (
        <div className="flex gap-2 mb-3">
          <input className={inp} value={name} onChange={(e) => setName(e.target.value)} placeholder="Nama kategori baru…" onKeyDown={(e) => e.key === 'Enter' && add()} />
          <button onClick={add} disabled={busy} className="bg-accent text-bg font-semibold rounded-md px-4 py-2 text-sm disabled:opacity-50 whitespace-nowrap">+ Tambah</button>
        </div>
      )}
      {err && <div className="text-[12px] text-danger mb-2">⚠️ {err}</div>}
      {cats.length === 0 ? (
        <div className={`${card} p-8 text-center text-text2 text-sm`}>Belum ada kategori.</div>
      ) : (
        <div className={`${card} divide-y divide-border`}>
          {cats.map((c) => (
            <div key={c.id} className="flex items-center justify-between px-4 py-2.5 text-sm">
              <span>{c.name} <span className="text-[11px] text-text2">· {c.items || 0} barang</span></span>
              {canManage && <button className="text-danger text-xs hover:underline" onClick={() => del(c)}>Hapus</button>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function MutasiTab() {
  const [moves, setMoves] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    api.get('/spareparts/report').then((r) => setMoves(r.data.moves || [])).catch(() => setMoves([])).finally(() => setLoading(false));
  }, []);
  if (loading) return <div className="text-text2 text-sm py-10 text-center">Memuat…</div>;
  if (moves.length === 0) return <div className={`${card} p-10 text-center text-text2 text-sm`}>Belum ada mutasi stok.</div>;
  return (
    <div className={`${card} overflow-x-auto`}>
      <table className="w-full text-xs">
        <thead><tr className="text-left text-text2 border-b border-border">
          <th className="px-3 py-2.5">Waktu</th><th className="px-3 py-2.5">Jenis</th><th className="px-3 py-2.5">Tujuan</th><th className="px-3 py-2.5">Barang</th><th className="px-3 py-2.5">Jumlah</th><th className="px-3 py-2.5">Perangkat / Tiket</th><th className="px-3 py-2.5">Oleh</th><th className="px-3 py-2.5">Catatan</th>
        </tr></thead>
        <tbody>
          {moves.map((m, i) => (
            <tr key={i} className="border-b border-border/60">
              <td className="px-3 py-2.5 text-text2 whitespace-nowrap">{new Date(m.moved_at).toLocaleString('id-ID', { dateStyle: 'short', timeStyle: 'short' })}</td>
              <td className={`px-3 py-2.5 font-medium ${MOVE[m.type]?.cls || ''}`}>{MOVE[m.type]?.label || m.type}</td>
              <td className="px-3 py-2.5 text-text2">{m.purpose ? PURPOSE[m.purpose] : '—'}</td>
              <td className="px-3 py-2.5"><div className="font-medium">{m.sparepart_name}</div>{m.sku && <div className="text-[10px] text-text2 font-mono">{m.sku}</div>}</td>
              <td className="px-3 py-2.5 font-semibold">{Number(m.qty)} {m.satuan}</td>
              <td className="px-3 py-2.5 text-text2">{m.incident_id ? <span className="font-mono">{m.incident_id}</span> : (m.device_name || '—')}{m.incident_issue ? <div className="text-[10px] text-text2/70 truncate max-w-[160px]">{m.incident_issue}</div> : null}</td>
              <td className="px-3 py-2.5 text-text2">{m.moved_by_name || '—'}</td>
              <td className="px-3 py-2.5 text-text2">{m.note || '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function LaporanTab() {
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [busy, setBusy] = useState('');

  async function exportExcel() {
    setBusy('excel');
    try {
      const r = await api.get('/spareparts/report.xlsx', { params: { from, to }, responseType: 'blob' });
      const url = URL.createObjectURL(r.data);
      const a = document.createElement('a');
      a.href = url; a.download = `suku-cadang${from || to ? `-${from || '...'}_${to || '...'}` : ''}.xlsx`;
      a.click(); URL.revokeObjectURL(url);
    } finally { setBusy(''); }
  }

  async function exportPdf() {
    setBusy('pdf');
    try {
      const r = await api.get('/spareparts/report', { params: { from, to } });
      const { items, moves } = r.data;
      const esc = (v: any) => String(v ?? '').replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c] as string));
      const period = from || to ? `Periode: ${from || '...'} s/d ${to || '...'}` : 'Semua periode';
      const stokRows = items.map((s: any) => `<tr><td>${esc(s.name)}</td><td>${esc(s.sku)}</td><td>${esc(s.category)}</td><td style="text-align:right">${Number(s.stock_qty)}</td><td style="text-align:right">${Number(s.min_qty)}</td><td>${esc(s.satuan)}</td><td>${esc(s.location)}</td><td>${Number(s.low) ? 'MENIPIS' : 'Aman'}</td></tr>`).join('');
      const purposeTxt = (p: string) => (p === 'maintenance' ? 'Maintenance' : p === 'perbaikan' ? 'Perbaikan' : '');
      const mvRows = moves.map((m: any) => `<tr><td>${new Date(m.moved_at).toLocaleString('id-ID')}</td><td>${esc(m.type)}</td><td>${esc(purposeTxt(m.purpose))}</td><td>${esc(m.sparepart_name)}</td><td style="text-align:right">${Number(m.qty)} ${esc(m.satuan)}</td><td>${esc(m.device_name)}</td><td>${esc(m.incident_id ? `${m.incident_id}${m.incident_issue ? ` — ${m.incident_issue}` : ''}` : '')}</td><td>${esc(m.moved_by_name)}</td><td>${esc(m.note)}</td></tr>`).join('');
      const html = `
        <style>*{font-family:Arial,sans-serif}h2{margin:0 0 2px}small{color:#555}table{width:100%;border-collapse:collapse;margin:8px 0 18px;font-size:11px}th,td{border:1px solid #999;padding:4px 6px;text-align:left}th{background:#eee}h3{margin:14px 0 4px;font-size:13px}@media print{@page{size:A4 landscape;margin:12mm}}</style>
        <h2>Laporan Manajemen Suku Cadang</h2><small>${period} · Dicetak ${new Date().toLocaleString('id-ID')}</small>
        <h3>Daftar Stok (${items.length})</h3>
        <table><thead><tr><th>Nama</th><th>SKU</th><th>Kategori</th><th>Stok</th><th>Min</th><th>Satuan</th><th>Lokasi</th><th>Status</th></tr></thead><tbody>${stokRows || '<tr><td colspan="8">Tidak ada data</td></tr>'}</tbody></table>
        <h3>Mutasi Stok (${moves.length})</h3>
        <table><thead><tr><th>Waktu</th><th>Jenis</th><th>Tujuan</th><th>Barang</th><th>Jumlah</th><th>Perangkat</th><th>Tiket</th><th>Oleh</th><th>Catatan</th></tr></thead><tbody>${mvRows || '<tr><td colspan="9">Tidak ada data</td></tr>'}</tbody></table>`;
      printHtml(html, 'Laporan Suku Cadang');
    } finally { setBusy(''); }
  }

  return (
    <div className={`${card} p-5 max-w-lg`}>
      <div className="text-sm font-semibold mb-3">Ekspor Laporan</div>
      <div className="grid grid-cols-2 gap-3 mb-4">
        <label className="block"><span className="text-[10px] text-text2">Dari tanggal (opsional)</span><input type="date" className={inp} value={from} onChange={(e) => setFrom(e.target.value)} /></label>
        <label className="block"><span className="text-[10px] text-text2">Sampai tanggal (opsional)</span><input type="date" className={inp} value={to} onChange={(e) => setTo(e.target.value)} /></label>
      </div>
      <p className="text-[11px] text-text2 mb-3">Kosongkan tanggal untuk seluruh periode. Filter tanggal berlaku untuk data mutasi; daftar stok selalu kondisi terkini.</p>
      <div className="flex gap-2">
        <button onClick={exportExcel} disabled={!!busy} className="bg-success text-bg font-semibold rounded-md px-4 py-2 text-sm disabled:opacity-50">{busy === 'excel' ? 'Menyiapkan…' : '📊 Export Excel'}</button>
        <button onClick={exportPdf} disabled={!!busy} className="bg-danger text-bg font-semibold rounded-md px-4 py-2 text-sm disabled:opacity-50">{busy === 'pdf' ? 'Menyiapkan…' : '📄 Cetak / PDF'}</button>
      </div>
    </div>
  );
}

function MoveModal({ sp, onClose, onSaved }: { sp: Sparepart; onClose: () => void; onSaved: () => void }) {
  const [type, setType] = useState<'masuk' | 'keluar' | 'adjust'>('masuk');
  const [qty, setQty] = useState('');
  const [note, setNote] = useState('');
  const [purpose, setPurpose] = useState<Purpose>('');
  const [incidentId, setIncidentId] = useState('');
  const [deviceId, setDeviceId] = useState('');
  const [moves, setMoves] = useState<SparepartMove[]>([]);
  const [stock, setStock] = useState(Number(sp.stock_qty));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(() => { api.get(`/spareparts/${sp.id}/moves`).then((r) => setMoves(r.data.moves || [])).catch(() => {}); }, [sp.id]);
  useEffect(() => { load(); }, [load]);

  async function submit() {
    if (qty.trim() === '' || !Number.isFinite(Number(qty)) || Number(qty) < 0) { setError('Jumlah harus angka ≥ 0.'); return; }
    if (type === 'keluar') {
      if (!purpose) { setError('Pilih tujuan pengeluaran: Maintenance atau Perbaikan.'); return; }
      if (purpose === 'perbaikan' && !incidentId) { setError('Pilih tiket insiden untuk pengeluaran perbaikan.'); return; }
    }
    setBusy(true); setError('');
    try {
      const body: any = { type, qty: Number(qty), note };
      if (type === 'keluar') {
        body.purpose = purpose;
        if (purpose === 'perbaikan') body.incident_id = incidentId;
        if (purpose === 'maintenance' && deviceId) body.device_id = Number(deviceId);
      }
      const r = await api.post(`/spareparts/${sp.id}/move`, body);
      setStock(r.data.stock_qty); setQty(''); setNote(''); setPurpose(''); setIncidentId(''); setDeviceId(''); load(); onSaved();
    } catch (e: any) { setError(e?.response?.data?.error || 'Gagal mencatat.'); }
    finally { setBusy(false); }
  }
  const inp2 = 'w-full bg-surface2 border border-border rounded-md px-2 py-1.5 text-xs outline-none focus:border-accent';

  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-surface border border-border rounded-xl w-full max-w-md max-h-[90vh] flex flex-col overflow-hidden" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 pt-5 pb-3 border-b border-border shrink-0">
          <div><h3 className="text-sm font-bold truncate">↕ Kartu Stok — {sp.name}</h3><div className="text-[11px] text-text2">{sp.sku ? `${sp.sku} · ` : ''}Stok saat ini: <b>{stock} {sp.satuan}</b></div></div>
          <button className="text-text2 hover:text-text text-lg" onClick={onClose}>×</button>
        </div>
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-3">
          <div className="flex gap-1">
            {(['masuk', 'keluar', 'adjust'] as const).map((t) => (
              <button key={t} onClick={() => setType(t)} className={`px-3 py-1 rounded-md text-[11px] border ${type === t ? 'bg-accent text-bg border-accent font-semibold' : 'bg-surface2 text-text2 border-border'}`}>{MOVE[t].label}</button>
            ))}
          </div>
          {type === 'keluar' && <KeluarTujuan purpose={purpose} setPurpose={setPurpose} incidentId={incidentId} setIncidentId={setIncidentId} deviceId={deviceId} setDeviceId={setDeviceId} />}
          <div className="grid grid-cols-2 gap-2">
            <label className="block"><span className="text-[10px] text-text2">{type === 'adjust' ? 'Stok jadi' : 'Jumlah'} ({sp.satuan})</span><input className={inp2} inputMode="decimal" value={qty} onChange={(e) => setQty(e.target.value)} /></label>
            <label className="block"><span className="text-[10px] text-text2">Catatan</span><input className={inp2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="mis. pengadaan / servis" /></label>
          </div>
          {error && <div className="text-[12px] text-danger">⚠️ {error}</div>}
          <button onClick={submit} disabled={busy} className="bg-accent text-bg font-semibold rounded-md px-4 py-2 text-sm disabled:opacity-50">{busy ? 'Menyimpan…' : 'Catat Pergerakan'}</button>

          {moves.length > 0 && (
            <div className="border-t border-border pt-3">
              <div className="text-[11px] font-semibold text-text2 mb-2">Riwayat</div>
              <div className="space-y-1">
                {moves.map((m) => (
                  <div key={m.id} className="flex items-center justify-between text-[11px] bg-surface2 border border-border rounded-md px-2.5 py-1.5">
                    <span className={MOVE[m.type].cls}>{MOVE[m.type].label} {Number(m.qty)} {sp.satuan}{m.purpose ? ` · ${PURPOSE[m.purpose]}` : ''}{m.incident_id ? ` · ${m.incident_id}` : ''}</span>
                    <span className="text-text2">{m.device_name ? `${m.device_name} · ` : ''}{new Date(m.moved_at).toLocaleDateString('id-ID')}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function LabelModal({ sp, onClose }: { sp: Sparepart; onClose: () => void }) {
  const [qr, setQr] = useState('');
  const code = sp.sku || sp.part_no || String(sp.id);
  const bc = barcodeDataUrl(code);
  useEffect(() => { QRCode.toDataURL(code, { margin: 1, width: 220 }).then(setQr).catch(() => setQr('')); }, [code]);

  const labelHtml = `
    <style>body{font-family:Arial,sans-serif;text-align:center;margin:0;padding:10px}.lbl{display:inline-block;border:1px solid #000;border-radius:6px;padding:10px 14px}.nm{font-weight:bold;font-size:13px;margin-bottom:4px}.cd{font-family:monospace;font-size:12px;margin-top:2px}@media print{@page{margin:6mm}}</style>
    <div class="lbl"><div class="nm">${String(sp.name).replace(/[<>&]/g, '')}</div>
    ${qr ? `<img src="${qr}" width="120" height="120"/>` : ''}
    ${bc ? `<div><img src="${bc}" style="max-width:200px"/></div>` : ''}
    <div class="cd">${code}</div></div>`;

  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4" onClick={onClose}>
      <div className={`${card} w-full max-w-xs p-5 text-center`} onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-3"><h3 className="text-sm font-bold">🏷️ Label — {sp.name}</h3><button className="text-text2 hover:text-text text-lg" onClick={onClose}>×</button></div>
        <div className="bg-white rounded-lg p-3 inline-block">
          {qr ? <img src={qr} alt="QR" width={140} height={140} className="mx-auto" /> : <div className="text-black text-xs py-10">Membuat QR…</div>}
          {bc && <img src={bc} alt="barcode" className="mx-auto mt-1 max-w-full" />}
          <div className="text-black font-mono text-xs mt-1">{code}</div>
        </div>
        <button onClick={() => printHtml(labelHtml, 'Label')} className="mt-4 w-full bg-accent text-bg font-semibold rounded-md px-4 py-2 text-sm">🖨️ Cetak Label</button>
        <p className="text-[10px] text-text2 mt-2">QR (2D) & barcode Code128 (1D) berisi kode <b>{code}</b> — dipakai saat scan masuk/keluar.</p>
      </div>
    </div>
  );
}

// Scan kamera (QR 2D & barcode 1D) → resolve barang → catat masuk/keluar/penyesuaian.
function ScanModal({ onClose }: { onClose: () => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const readerRef = useRef<BrowserMultiFormatReader | null>(null);
  const [phase, setPhase] = useState<'scan' | 'found'>('scan');
  const [err, setErr] = useState('');
  const [manual, setManual] = useState('');
  const [found, setFound] = useState<Sparepart | null>(null);
  const [type, setType] = useState<'masuk' | 'keluar' | 'adjust'>('masuk');
  const [qty, setQty] = useState('1');
  const [note, setNote] = useState('');
  const [purpose, setPurpose] = useState<Purpose>('');
  const [incidentId, setIncidentId] = useState('');
  const [deviceId, setDeviceId] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');

  const resetKeluar = () => { setPurpose(''); setIncidentId(''); setDeviceId(''); };

  const stopCam = useCallback(() => { try { readerRef.current?.reset(); } catch { /* noop */ } }, []);

  const resolve = useCallback(async (code: string) => {
    const c = code.trim();
    if (!c) return;
    stopCam();
    setErr(''); setMsg('');
    try {
      const r = await api.get('/spareparts/lookup', { params: { code: c } });
      setFound(r.data.sparepart); setType('masuk'); setQty('1'); setNote(''); resetKeluar(); setPhase('found');
    } catch (e: any) {
      setErr(e?.response?.data?.error || `Kode "${c}" tidak ditemukan.`);
      startCam();
    }
  }, [stopCam]);

  const startCam = useCallback(async () => {
    setPhase('scan'); setFound(null);
    try {
      const { BrowserMultiFormatReader } = await import('@zxing/library'); // lazy: hanya dimuat saat scan dibuka
      const reader = new BrowserMultiFormatReader();
      readerRef.current = reader;
      if (!videoRef.current) return; // modal keburu ditutup
      await reader.decodeFromVideoDevice(null, videoRef.current, (result) => {
        if (result) resolve(result.getText());
      });
    } catch {
      setErr('Tidak bisa mengakses kamera. Izinkan kamera & gunakan HTTPS/localhost. Anda tetap bisa ketik kode manual di bawah.');
    }
  }, [resolve]);

  useEffect(() => { startCam(); return () => stopCam(); }, [startCam, stopCam]);

  async function submit() {
    if (!found) return;
    if (qty.trim() === '' || !Number.isFinite(Number(qty)) || Number(qty) < 0) { setErr('Jumlah harus angka ≥ 0.'); return; }
    if (type === 'keluar') {
      if (!purpose) { setErr('Pilih tujuan pengeluaran: Maintenance atau Perbaikan.'); return; }
      if (purpose === 'perbaikan' && !incidentId) { setErr('Pilih tiket insiden untuk pengeluaran perbaikan.'); return; }
    }
    setBusy(true); setErr('');
    try {
      const body: any = { type, qty: Number(qty), note };
      if (type === 'keluar') {
        body.purpose = purpose;
        if (purpose === 'perbaikan') body.incident_id = incidentId;
        if (purpose === 'maintenance' && deviceId) body.device_id = Number(deviceId);
      }
      const r = await api.post(`/spareparts/${found.id}/move`, body);
      setMsg(`✅ ${MOVE[type].label} ${qty} ${found.satuan} — ${found.name}. Stok kini ${r.data.stock_qty}.`);
      setFound(null); resetKeluar(); startCam();
    } catch (e: any) { setErr(e?.response?.data?.error || 'Gagal mencatat.'); }
    finally { setBusy(false); }
  }

  const inp2 = 'w-full bg-surface2 border border-border rounded-md px-2 py-1.5 text-xs outline-none focus:border-accent';

  return (
    <div className="fixed inset-0 z-[60] bg-black/80 flex items-center justify-center p-4" onClick={() => { stopCam(); onClose(); }}>
      <div className="bg-surface border border-border rounded-xl w-full max-w-md max-h-[94vh] overflow-y-auto p-5" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-3"><h3 className="text-sm font-bold">📷 Scan Masuk / Keluar</h3><button className="text-text2 hover:text-text text-lg" onClick={() => { stopCam(); onClose(); }}>×</button></div>

        {msg && <div className="bg-success/10 border border-success/30 text-success rounded-md px-3 py-2 text-[12px] mb-3">{msg}</div>}

        {phase === 'scan' && (
          <>
            <div className="relative rounded-lg overflow-hidden border border-border bg-black">
              <video ref={videoRef} className="w-full max-h-[45vh] object-contain" muted playsInline />
              <div className="absolute inset-0 pointer-events-none border-2 border-accent/60 m-8 rounded-lg" />
            </div>
            <p className="text-[11px] text-text2 mt-2">Arahkan kamera ke QR/barcode pada label barang.</p>
            <div className="flex gap-2 mt-2">
              <input className={inp2} value={manual} onChange={(e) => setManual(e.target.value)} placeholder="…atau ketik/scan kode manual (SKU)" onKeyDown={(e) => e.key === 'Enter' && resolve(manual)} />
              <button onClick={() => resolve(manual)} className="bg-accent text-bg font-semibold rounded-md px-3 py-1.5 text-xs whitespace-nowrap">Cari</button>
            </div>
          </>
        )}

        {phase === 'found' && found && (
          <div>
            <div className="bg-surface2 border border-border rounded-lg px-3 py-2.5 mb-3">
              <div className="font-semibold text-sm">{found.name}</div>
              <div className="text-[11px] text-text2">{found.sku ? `${found.sku} · ` : ''}{found.category_name || found.category || 'Tanpa kategori'} · Stok: <b>{Number(found.stock_qty)} {found.satuan}</b></div>
            </div>
            <div className="flex gap-1 mb-2">
              {(['masuk', 'keluar', 'adjust'] as const).map((t) => (
                <button key={t} onClick={() => setType(t)} className={`px-3 py-1 rounded-md text-[11px] border ${type === t ? 'bg-accent text-bg border-accent font-semibold' : 'bg-surface2 text-text2 border-border'}`}>{MOVE[t].label}</button>
              ))}
            </div>
            {type === 'keluar' && <div className="mb-2"><KeluarTujuan purpose={purpose} setPurpose={setPurpose} incidentId={incidentId} setIncidentId={setIncidentId} deviceId={deviceId} setDeviceId={setDeviceId} /></div>}
            <div className="grid grid-cols-2 gap-2 mb-2">
              <label className="block"><span className="text-[10px] text-text2">{type === 'adjust' ? 'Stok jadi' : 'Jumlah'} ({found.satuan})</span><input className={inp2} inputMode="decimal" value={qty} onChange={(e) => setQty(e.target.value)} /></label>
              <label className="block"><span className="text-[10px] text-text2">Catatan</span><input className={inp2} value={note} onChange={(e) => setNote(e.target.value)} /></label>
            </div>
            <div className="flex gap-2">
              <button onClick={submit} disabled={busy} className="flex-1 bg-accent text-bg font-semibold rounded-md px-4 py-2 text-sm disabled:opacity-50">{busy ? 'Menyimpan…' : `Catat ${MOVE[type].label}`}</button>
              <button onClick={() => { setFound(null); startCam(); }} className="border border-border text-text2 rounded-md px-4 py-2 text-sm">Scan lagi</button>
            </div>
          </div>
        )}

        {err && <div className="text-[12px] text-danger mt-3">⚠️ {err}</div>}
      </div>
    </div>
  );
}
