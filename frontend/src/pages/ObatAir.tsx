import { useCallback, useEffect, useState } from 'react';
import { api, getActiveUnitId } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { hasRole } from '../utils/roles';
import { confirmDialog } from '../components/dialog';
import type { WaterChemical, WaterChemReportRow, WaterChemUsage } from '../types';

const rupiah = (n: number | string) => 'Rp ' + Number(n || 0).toLocaleString('id-ID');
function thisMonth() { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; }

export default function ObatAir() {
  const { user } = useAuth();
  const canManage = hasRole(user, 'admin', 'koordinator');
  const isAdmin = hasRole(user, 'admin');
  const needUnit = isAdmin && !getActiveUnitId();
  const [month, setMonth] = useState(thisMonth());
  const [chemicals, setChemicals] = useState<WaterChemical[]>([]);
  const [report, setReport] = useState<{ rows: WaterChemReportRow[]; grand_total: number }>({ rows: [], grand_total: 0 });
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState({ name: '', satuan: 'kg', harga_satuan: '' });
  const [showForm, setShowForm] = useState(false);
  const [error, setError] = useState('');
  const [usageOf, setUsageOf] = useState<WaterChemical | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    const from = `${month}-01`;
    const to = `${month}-${new Date(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0).getDate()}`;
    Promise.all([api.get('/obat-air'), api.get('/obat-air/report', { params: { from, to } })])
      .then(([c, r]) => { setChemicals(c.data.chemicals || []); setReport({ rows: r.data.rows || [], grand_total: r.data.grand_total || 0 }); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [month]);
  useEffect(() => { load(); }, [load]);

  async function saveChem() {
    if (!form.name.trim()) { setError('Nama bahan wajib diisi.'); return; }
    try { await api.post('/obat-air', form); setForm({ name: '', satuan: 'kg', harga_satuan: '' }); setShowForm(false); load(); }
    catch (e: any) { setError(e?.response?.data?.error || 'Gagal menyimpan.'); }
  }
  async function delChem(c: WaterChemical) {
    if (!await confirmDialog(`Hapus bahan "${c.name}"? Riwayat pemakaian ikut terhapus.`)) return;
    await api.delete(`/obat-air/${c.id}`); load();
  }

  const card = 'bg-surface border border-border rounded-xl';
  const inp = 'bg-surface2 border border-border rounded-md px-3 py-2 text-sm outline-none focus:border-accent';

  return (
    <div className="p-4 sm:p-6 max-w-5xl mx-auto">
      <div className="flex items-center justify-between gap-3 mb-4 flex-wrap">
        <div>
          <h1 className="text-lg font-bold">💧 Obat Air / Bahan Kimia</h1>
          <p className="text-[12px] text-text2">Pemakaian bahan kimia pengolahan air & rekap biaya per periode.</p>
        </div>
        <div className="flex items-center gap-2">
          <input type="month" value={month} onChange={(e) => setMonth(e.target.value)} className={inp} />
          {canManage && !needUnit && <button onClick={() => { setShowForm(true); setError(''); }} className="bg-accent text-bg font-semibold rounded-md px-4 py-2 text-sm">+ Bahan</button>}
        </div>
      </div>

      {needUnit && <div className="bg-warn/10 border border-warn/30 text-warn rounded-lg px-4 py-3 text-[13px] mb-4">Pilih satu unit di switcher header untuk mengelola obat air.</div>}

      {loading ? <div className="text-text2 text-sm py-10 text-center">Memuat…</div> : (
        <>
          <div className={`${card} overflow-x-auto mb-4`}>
            <table className="w-full text-xs">
              <thead><tr className="text-left text-text2 border-b border-border">
                <th className="px-3 py-2.5">Bahan</th><th className="px-3 py-2.5">Harga Satuan</th><th className="px-3 py-2.5">Volume (bln ini)</th><th className="px-3 py-2.5">Biaya</th><th className="px-3 py-2.5"></th>
              </tr></thead>
              <tbody>
                {chemicals.map((c) => {
                  const row = report.rows.find((r) => r.id === c.id);
                  return (
                    <tr key={c.id} className="border-b border-border/60">
                      <td className="px-3 py-2.5 font-semibold">{c.name}</td>
                      <td className="px-3 py-2.5 text-text2">{rupiah(c.harga_satuan)} / {c.satuan}</td>
                      <td className="px-3 py-2.5">{Number(row?.total_volume || 0)} {c.satuan}</td>
                      <td className="px-3 py-2.5 font-semibold">{rupiah(row?.biaya || 0)}</td>
                      <td className="px-3 py-2.5"><div className="flex gap-1.5 justify-end">
                        <button className="px-2 py-1 rounded-md bg-accent/15 text-accent border border-accent/30 text-xs font-medium" onClick={() => setUsageOf(c)}>+ Pakai</button>
                        {canManage && <button className="px-2 py-1 rounded-md border border-border text-danger text-xs" onClick={() => delChem(c)}>🗑️</button>}
                      </div></td>
                    </tr>
                  );
                })}
                {chemicals.length === 0 && <tr><td colSpan={5} className="text-center text-text2 py-8">Belum ada bahan. Tambahkan mis. Soda Ash, Kapur, Chlorine, PAC.</td></tr>}
              </tbody>
              {chemicals.length > 0 && <tfoot><tr className="border-t border-border font-bold"><td className="px-3 py-2.5" colSpan={3}>Total Biaya {month}</td><td className="px-3 py-2.5 text-accent">{rupiah(report.grand_total)}</td><td /></tr></tfoot>}
            </table>
          </div>
        </>
      )}

      {showForm && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4" onClick={() => setShowForm(false)}>
          <div className={`${card} w-full max-w-sm p-5`} onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-3"><h3 className="text-sm font-bold">Tambah Bahan</h3><button className="text-text2 text-lg" onClick={() => setShowForm(false)}>×</button></div>
            <div className="space-y-2">
              <input className={`${inp} w-full`} placeholder="Nama bahan (mis. Soda Ash)" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
              <div className="grid grid-cols-2 gap-2">
                <input className={`${inp} w-full`} placeholder="Satuan (zak/pail/kg)" value={form.satuan} onChange={(e) => setForm({ ...form, satuan: e.target.value })} />
                <input className={`${inp} w-full`} inputMode="decimal" placeholder="Harga satuan" value={form.harga_satuan} onChange={(e) => setForm({ ...form, harga_satuan: e.target.value })} />
              </div>
            </div>
            {error && <div className="mt-2 text-[12px] text-danger">⚠️ {error}</div>}
            <button onClick={saveChem} className="mt-3 bg-accent text-bg font-semibold rounded-md px-4 py-2 text-sm">+ Simpan</button>
          </div>
        </div>
      )}

      {usageOf && <UsageModal chem={usageOf} onClose={() => setUsageOf(null)} onSaved={load} />}
    </div>
  );
}

function UsageModal({ chem, onClose, onSaved }: { chem: WaterChemical; onClose: () => void; onSaved: () => void }) {
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [volume, setVolume] = useState('');
  const [note, setNote] = useState('');
  const [usage, setUsage] = useState<WaterChemUsage[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const load = useCallback(() => { api.get(`/obat-air/${chem.id}/usage`).then((r) => setUsage(r.data.usage || [])).catch(() => {}); }, [chem.id]);
  useEffect(() => { load(); }, [load]);

  async function save() {
    if (volume.trim() === '' || !Number.isFinite(Number(volume))) { setError('Volume harus angka.'); return; }
    setBusy(true); setError('');
    try { await api.post(`/obat-air/${chem.id}/usage`, { usage_date: date, volume: Number(volume), note }); setVolume(''); setNote(''); load(); onSaved(); }
    catch (e: any) { setError(e?.response?.data?.error || 'Gagal.'); }
    finally { setBusy(false); }
  }
  const inp = 'w-full bg-surface2 border border-border rounded-md px-2 py-1.5 text-xs outline-none focus:border-accent';
  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-surface border border-border rounded-xl w-full max-w-md max-h-[90vh] flex flex-col overflow-hidden" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 pt-5 pb-3 border-b border-border shrink-0">
          <h3 className="text-sm font-bold">💧 Pemakaian — {chem.name}</h3><button className="text-text2 text-lg" onClick={onClose}>×</button>
        </div>
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-3">
          <div className="grid grid-cols-2 gap-2">
            <label className="block"><span className="text-[10px] text-text2">Tanggal</span><input type="date" className={inp} value={date} onChange={(e) => setDate(e.target.value)} /></label>
            <label className="block"><span className="text-[10px] text-text2">Volume ({chem.satuan})</span><input className={inp} inputMode="decimal" value={volume} onChange={(e) => setVolume(e.target.value)} /></label>
            <label className="block col-span-2"><span className="text-[10px] text-text2">Catatan</span><input className={inp} value={note} onChange={(e) => setNote(e.target.value)} /></label>
          </div>
          {error && <div className="text-[12px] text-danger">⚠️ {error}</div>}
          <button onClick={save} disabled={busy} className="bg-accent text-bg font-semibold rounded-md px-4 py-2 text-sm disabled:opacity-50">{busy ? 'Menyimpan…' : 'Catat Pemakaian'}</button>
          {usage.length > 0 && (
            <div className="border-t border-border pt-3">
              <div className="text-[11px] font-semibold text-text2 mb-2">Riwayat</div>
              <div className="space-y-1">
                {usage.map((u) => (
                  <div key={u.id} className="flex items-center justify-between text-[11px] bg-surface2 border border-border rounded-md px-2.5 py-1.5">
                    <span>{new Date(u.usage_date).toLocaleDateString('id-ID')}</span>
                    <span className="font-semibold">{Number(u.volume)} {chem.satuan}</span>
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
