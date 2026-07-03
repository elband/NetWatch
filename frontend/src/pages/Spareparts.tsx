import { useCallback, useEffect, useState } from 'react';
import { api, getActiveUnitId } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { hasRole } from '../utils/roles';
import { confirmDialog } from '../components/dialog';
import type { Sparepart, SparepartMove } from '../types';

const MOVE: Record<string, { label: string; cls: string }> = {
  masuk: { label: 'Masuk', cls: 'text-success' },
  keluar: { label: 'Keluar', cls: 'text-danger' },
  adjust: { label: 'Penyesuaian', cls: 'text-warn' },
};

export default function Spareparts() {
  const { user } = useAuth();
  const canManage = hasRole(user, 'admin', 'koordinator');
  const isAdmin = hasRole(user, 'admin');
  const needUnit = isAdmin && !getActiveUnitId();
  const [items, setItems] = useState<Sparepart[]>([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState<any>(empty());
  const [editId, setEditId] = useState<number | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [error, setError] = useState('');
  const [moveItem, setMoveItem] = useState<Sparepart | null>(null);

  function empty() { return { name: '', part_no: '', category: '', satuan: 'pcs', stock_qty: '', min_qty: '', location: '', notes: '' }; }

  const load = useCallback(() => {
    setLoading(true);
    api.get('/spareparts').then((r) => setItems(r.data.spareparts || [])).catch(() => setItems([])).finally(() => setLoading(false));
  }, []);
  useEffect(() => { load(); }, [load]);

  const lowCount = items.filter((s) => Number(s.stock_qty) <= Number(s.min_qty) && Number(s.min_qty) > 0).length;

  function openCreate() { setForm(empty()); setEditId(null); setError(''); setShowForm(true); }
  function openEdit(s: Sparepart) {
    setForm({ name: s.name, part_no: s.part_no || '', category: s.category || '', satuan: s.satuan, stock_qty: s.stock_qty, min_qty: s.min_qty, location: s.location || '', notes: s.notes || '' });
    setEditId(s.id); setError(''); setShowForm(true);
  }
  async function save() {
    if (!form.name.trim()) { setError('Nama wajib diisi.'); return; }
    try {
      if (editId) await api.put(`/spareparts/${editId}`, form);
      else await api.post('/spareparts', form);
      setShowForm(false); load();
    } catch (e: any) { setError(e?.response?.data?.error || 'Gagal menyimpan.'); }
  }
  async function del(s: Sparepart) {
    if (!await confirmDialog(`Hapus sparepart "${s.name}"? Riwayat stok ikut terhapus.`)) return;
    await api.delete(`/spareparts/${s.id}`); load();
  }

  const card = 'bg-surface border border-border rounded-xl';
  const inp = 'w-full bg-surface2 border border-border rounded-md px-3 py-2 text-sm outline-none focus:border-accent';
  const btnGhost = 'px-2 py-1 rounded-md border border-border text-text2 hover:text-white text-xs';

  return (
    <div className="p-4 sm:p-6 max-w-6xl mx-auto">
      <div className="flex items-center justify-between gap-3 mb-4 flex-wrap">
        <div>
          <h1 className="text-lg font-bold">🧰 Sparepart & Stok</h1>
          <p className="text-[12px] text-text2">Inventaris suku cadang per unit dengan kartu stok masuk/keluar.
            {lowCount > 0 && <span className="text-danger font-semibold"> · {lowCount} stok menipis</span>}
          </p>
        </div>
        {canManage && !needUnit && <button onClick={openCreate} className="bg-accent text-bg font-semibold rounded-md px-4 py-2 text-sm">+ Tambah Sparepart</button>}
      </div>

      {needUnit && <div className="bg-warn/10 border border-warn/30 text-warn rounded-lg px-4 py-3 text-[13px] mb-4">Pilih satu unit di switcher header untuk mengelola sparepart.</div>}

      {loading ? (
        <div className="text-text2 text-sm py-10 text-center">Memuat…</div>
      ) : items.length === 0 ? (
        <div className={`${card} p-10 text-center text-text2 text-sm`}>Belum ada sparepart.</div>
      ) : (
        <div className={`${card} overflow-x-auto`}>
          <table className="w-full text-xs">
            <thead><tr className="text-left text-text2 border-b border-border">
              <th className="px-3 py-2.5">Nama</th><th className="px-3 py-2.5">Part No</th><th className="px-3 py-2.5">Stok</th><th className="px-3 py-2.5">Min</th><th className="px-3 py-2.5">Lokasi</th><th className="px-3 py-2.5"></th>
            </tr></thead>
            <tbody>
              {items.map((s) => {
                const low = Number(s.stock_qty) <= Number(s.min_qty) && Number(s.min_qty) > 0;
                return (
                  <tr key={s.id} className="border-b border-border/60">
                    <td className="px-3 py-2.5"><div className="font-semibold">{s.name}</div>{s.category && <div className="text-[10px] text-text2">{s.category}</div>}</td>
                    <td className="px-3 py-2.5 font-mono text-text2">{s.part_no || '—'}</td>
                    <td className={`px-3 py-2.5 font-bold ${low ? 'text-danger' : ''}`}>{Number(s.stock_qty)} {s.satuan}{low && ' ⚠'}</td>
                    <td className="px-3 py-2.5 text-text2">{Number(s.min_qty)}</td>
                    <td className="px-3 py-2.5 text-text2">{s.location || '—'}</td>
                    <td className="px-3 py-2.5"><div className="flex gap-1.5 justify-end">
                      <button className="px-2 py-1 rounded-md bg-accent/15 text-accent border border-accent/30 text-xs font-medium" onClick={() => setMoveItem(s)}>↕ Stok</button>
                      {canManage && <button className={btnGhost} onClick={() => openEdit(s)}>✏️</button>}
                      {canManage && <button className={`${btnGhost} text-danger`} onClick={() => del(s)}>🗑️</button>}
                    </div></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {showForm && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4" onClick={() => setShowForm(false)}>
          <div className={`${card} w-full max-w-lg max-h-[90vh] overflow-y-auto p-5`} onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-3"><h3 className="text-sm font-bold">{editId ? 'Edit Sparepart' : 'Tambah Sparepart'}</h3><button className="text-text2 hover:text-text text-lg" onClick={() => setShowForm(false)}>×</button></div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              <label className="block sm:col-span-2"><span className="text-[10px] text-text2">Nama *</span><input className={inp} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="mis. Filter Oli" /></label>
              <label className="block"><span className="text-[10px] text-text2">Part No</span><input className={inp} value={form.part_no} onChange={(e) => setForm({ ...form, part_no: e.target.value })} /></label>
              <label className="block"><span className="text-[10px] text-text2">Kategori</span><input className={inp} value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} /></label>
              <label className="block"><span className="text-[10px] text-text2">Satuan</span><input className={inp} value={form.satuan} onChange={(e) => setForm({ ...form, satuan: e.target.value })} placeholder="pcs / liter / set" /></label>
              {!editId && <label className="block"><span className="text-[10px] text-text2">Stok awal</span><input className={inp} inputMode="decimal" value={form.stock_qty} onChange={(e) => setForm({ ...form, stock_qty: e.target.value })} /></label>}
              <label className="block"><span className="text-[10px] text-text2">Stok minimum (alert)</span><input className={inp} inputMode="decimal" value={form.min_qty} onChange={(e) => setForm({ ...form, min_qty: e.target.value })} /></label>
              <label className="block"><span className="text-[10px] text-text2">Lokasi simpan</span><input className={inp} value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} /></label>
              <label className="block sm:col-span-2"><span className="text-[10px] text-text2">Catatan</span><input className={inp} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></label>
            </div>
            {error && <div className="mt-2 text-[12px] text-danger">⚠️ {error}</div>}
            <div className="mt-4 flex gap-2"><button onClick={save} className="bg-accent text-bg font-semibold rounded-md px-4 py-2 text-sm">{editId ? '💾 Simpan' : '+ Tambah'}</button><button onClick={() => setShowForm(false)} className="border border-border text-text2 rounded-md px-4 py-2 text-sm">Batal</button></div>
          </div>
        </div>
      )}

      {moveItem && <MoveModal sp={moveItem} onClose={() => setMoveItem(null)} onSaved={load} />}
    </div>
  );
}

function MoveModal({ sp, onClose, onSaved }: { sp: Sparepart; onClose: () => void; onSaved: () => void }) {
  const [type, setType] = useState<'masuk' | 'keluar' | 'adjust'>('masuk');
  const [qty, setQty] = useState('');
  const [note, setNote] = useState('');
  const [moves, setMoves] = useState<SparepartMove[]>([]);
  const [stock, setStock] = useState(Number(sp.stock_qty));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(() => { api.get(`/spareparts/${sp.id}/moves`).then((r) => setMoves(r.data.moves || [])).catch(() => {}); }, [sp.id]);
  useEffect(() => { load(); }, [load]);

  async function submit() {
    if (qty.trim() === '' || !Number.isFinite(Number(qty)) || Number(qty) < 0) { setError('Jumlah harus angka ≥ 0.'); return; }
    setBusy(true); setError('');
    try {
      const r = await api.post(`/spareparts/${sp.id}/move`, { type, qty: Number(qty), note });
      setStock(r.data.stock_qty); setQty(''); setNote(''); load(); onSaved();
    } catch (e: any) { setError(e?.response?.data?.error || 'Gagal mencatat.'); }
    finally { setBusy(false); }
  }
  const inp = 'w-full bg-surface2 border border-border rounded-md px-2 py-1.5 text-xs outline-none focus:border-accent';

  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-surface border border-border rounded-xl w-full max-w-md max-h-[90vh] flex flex-col overflow-hidden" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 pt-5 pb-3 border-b border-border shrink-0">
          <div><h3 className="text-sm font-bold truncate">↕ Kartu Stok — {sp.name}</h3><div className="text-[11px] text-text2">Stok saat ini: <b>{stock} {sp.satuan}</b></div></div>
          <button className="text-text2 hover:text-text text-lg" onClick={onClose}>×</button>
        </div>
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-3">
          <div className="flex gap-1">
            {(['masuk', 'keluar', 'adjust'] as const).map((t) => (
              <button key={t} onClick={() => setType(t)} className={`px-3 py-1 rounded-md text-[11px] border ${type === t ? 'bg-accent text-bg border-accent font-semibold' : 'bg-surface2 text-text2 border-border'}`}>{MOVE[t].label}</button>
            ))}
          </div>
          <div className="grid grid-cols-2 gap-2">
            <label className="block"><span className="text-[10px] text-text2">{type === 'adjust' ? 'Stok jadi' : 'Jumlah'} ({sp.satuan})</span><input className={inp} inputMode="decimal" value={qty} onChange={(e) => setQty(e.target.value)} /></label>
            <label className="block"><span className="text-[10px] text-text2">Catatan</span><input className={inp} value={note} onChange={(e) => setNote(e.target.value)} placeholder="mis. pengadaan / servis" /></label>
          </div>
          {error && <div className="text-[12px] text-danger">⚠️ {error}</div>}
          <button onClick={submit} disabled={busy} className="bg-accent text-bg font-semibold rounded-md px-4 py-2 text-sm disabled:opacity-50">{busy ? 'Menyimpan…' : 'Catat Pergerakan'}</button>

          {moves.length > 0 && (
            <div className="border-t border-border pt-3">
              <div className="text-[11px] font-semibold text-text2 mb-2">Riwayat</div>
              <div className="space-y-1">
                {moves.map((m) => (
                  <div key={m.id} className="flex items-center justify-between text-[11px] bg-surface2 border border-border rounded-md px-2.5 py-1.5">
                    <span className={MOVE[m.type].cls}>{MOVE[m.type].label} {Number(m.qty)} {sp.satuan}</span>
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
