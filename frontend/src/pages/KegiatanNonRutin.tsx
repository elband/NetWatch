import { useEffect, useState } from 'react';
import { api } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { hasRole } from '../utils/roles';
import type { KegiatanNr as Keg, KnrStats, KnrRecap, KnrStatus } from '../types';

const STATUS: Record<KnrStatus, { label: string; cls: string }> = {
  draft: { label: 'Draft', cls: 'bg-slate-500/15 text-slate-300' }, diajukan: { label: 'Diajukan', cls: 'bg-warn/15 text-warn' },
  diverifikasi: { label: 'Diverifikasi', cls: 'bg-accent2/15 text-accent2' }, disetujui: { label: 'Disetujui', cls: 'bg-success/15 text-success' },
  ditolak: { label: 'Ditolak', cls: 'bg-danger/15 text-danger' }, selesai: { label: 'Selesai', cls: 'bg-[#14b8a6]/15 text-[#14b8a6]' },
};
const KESULITAN: Record<string, { label: string; poin: number; cls: string }> = {
  rendah: { label: 'Rendah', poin: 1, cls: 'text-slate-300' }, sedang: { label: 'Sedang', poin: 3, cls: 'text-accent2' },
  tinggi: { label: 'Tinggi', poin: 5, cls: 'text-warn' }, kritis: { label: 'Kritis', poin: 10, cls: 'text-danger' },
};
const months = Array.from({ length: 12 }, (_, i) => { const d = new Date(new Date().getFullYear(), new Date().getMonth() - i, 1); return { value: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`, label: d.toLocaleDateString('id-ID', { month: 'long', year: 'numeric' }) }; });
const empty = { tanggal_kegiatan: new Date().toISOString().slice(0, 10), petugas_nama: '', unit_kerja: 'Unit Elektronika Bandara', kategori: '', judul: '', lokasi: '', uraian: '', hasil: '', durasi_jam: '', jumlah_personel: '1', tingkat_kesulitan: 'rendah' };

export default function KegiatanNonRutin() {
  const { user } = useAuth();
  const isManager = hasRole(user, 'admin', 'koordinator');
  const [tab, setTab] = useState<'daftar' | 'persetujuan' | 'rekap' | 'statistik'>('daftar');
  const [month, setMonth] = useState(months[0].value);
  const [stats, setStats] = useState<KnrStats | null>(null);
  const [recap, setRecap] = useState<KnrRecap | null>(null);
  const [cats, setCats] = useState<string[]>([]);
  const [rows, setRows] = useState<Keg[]>([]);
  const [status, setStatus] = useState('');
  const [kategori, setKategori] = useState('');
  const [q, setQ] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [editId, setEditId] = useState<number | null>(null);
  const [detail, setDetail] = useState<number | null>(null);

  function loadList() {
    const p = new URLSearchParams({ month }); if (status) p.set('status', status); if (kategori) p.set('kategori', kategori); if (q) p.set('q', q);
    if (tab === 'persetujuan') p.set('status', 'diajukan');
    api.get(`/kegiatan-nr?${p}`).then((r) => setRows(r.data.kegiatan)).catch(() => {});
  }
  useEffect(() => { api.get('/kegiatan-nr/categories').then((r) => setCats(r.data.categories.map((c: any) => c.name))).catch(() => {}); }, []);
  useEffect(() => { api.get(`/kegiatan-nr/stats?month=${month}`).then((r) => setStats(r.data)).catch(() => {}); }, [month]);
  useEffect(() => { if (tab === 'rekap') api.get(`/kegiatan-nr/recap?month=${month}`).then((r) => setRecap(r.data)).catch(() => {}); }, [tab, month]);
  useEffect(() => { const t = setTimeout(loadList, q ? 300 : 0); return () => clearTimeout(t); }, [tab, month, status, kategori, q]);

  const Stat = ({ l, v, c, ic }: { l: string; v: number | string; c: string; ic: string }) => (
    <div className="bg-surface border border-border rounded-xl p-3.5"><div className="flex items-center justify-between"><span className="text-[11px] text-text2">{l}</span><span>{ic}</span></div><div className="text-[22px] font-extrabold mt-0.5" style={{ color: c }}>{v}</div></div>
  );

  return (
    <div>
      <div className="flex items-center justify-between mb-4 gap-2 flex-wrap">
        <div className="text-[17px] font-bold">📝 Laporan Kegiatan Non-Rutin</div>
        <div className="flex items-center gap-2">
          <select value={month} onChange={(e) => setMonth(e.target.value)} className="bg-surface2 border border-border rounded-md px-3 py-2 text-xs">{months.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}</select>
          <button onClick={() => { setEditId(null); setShowForm(true); }} className="bg-accent text-bg rounded-md px-3 py-1.5 text-xs font-semibold">+ Tambah Kegiatan</button>
        </div>
      </div>

      {/* Dashboard */}
      {stats && (<>
        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-3 mb-3">
          <Stat l="Kegiatan Bulan Ini" v={stats.stats.total} c="#60a5fa" ic="📋" />
          <Stat l="Selesai" v={stats.stats.selesai} c="#14b8a6" ic="✅" />
          <Stat l="Menunggu Persetujuan" v={stats.stats.menunggu} c="#eab308" ic="🕓" />
          <Stat l="Jam Kontribusi" v={`${stats.stats.jam}j`} c="#a78bfa" ic="⏱️" />
          <Stat l="Poin Tambahan" v={stats.stats.poin} c="#22c55e" ic="🏆" />
          <Stat l="Kegiatan Kritis" v={stats.stats.kritis} c="#ef4444" ic="🔥" />
          <Stat l="Top Kategori" v={stats.topKategori[0]?.jumlah || 0} c="#f97316" ic="📂" />
        </div>
        <div className="bg-gradient-to-br from-accent/10 to-accent2/8 border border-accent/25 rounded-xl p-3.5 mb-4 text-[12px]"><b>🤖 AI Insight:</b> <span className="text-text2">{stats.insight}</span></div>
      </>)}

      {/* Tabs */}
      <div className="flex gap-1 mb-3 flex-wrap">
        {([['daftar', '📋 Daftar Kegiatan'], ['persetujuan', '✅ Persetujuan'], ['rekap', '📊 Rekap Bulanan'], ['statistik', '📈 Statistik']] as const).map(([k, l]) => (
          <button key={k} onClick={() => setTab(k)} className={`px-3 py-1.5 text-xs rounded-md ${tab === k ? 'bg-accent text-bg font-semibold' : 'bg-surface2 text-text2'}`}>{l}</button>
        ))}
      </div>

      {(tab === 'daftar' || tab === 'persetujuan') && (<>
        {tab === 'daftar' && (
          <div className="flex gap-2 mb-3 flex-wrap">
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="🔍 Cari judul / petugas / nomor…" className="bg-surface2 border border-border rounded-md px-3 py-2 text-xs flex-1 min-w-[180px]" />
            <select value={kategori} onChange={(e) => setKategori(e.target.value)} className="bg-surface2 border border-border rounded-md px-2 py-2 text-xs"><option value="">Semua kategori</option>{cats.map((c) => <option key={c} value={c}>{c}</option>)}</select>
            <select value={status} onChange={(e) => setStatus(e.target.value)} className="bg-surface2 border border-border rounded-md px-2 py-2 text-xs"><option value="">Semua status</option>{Object.entries(STATUS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}</select>
          </div>
        )}
        <div className="bg-surface border border-border rounded-[10px] overflow-x-auto">
          <table className="w-full text-xs"><thead><tr className="text-text2 uppercase text-[10px] border-b border-border">
            {['No', 'Tanggal', 'Nomor', 'Petugas', 'Kategori', 'Judul', 'Lokasi', 'Durasi', 'Kesulitan', 'Status', 'Poin', 'Aksi'].map((h) => <th key={h} className="px-3 py-2.5 text-left">{h}</th>)}
          </tr></thead><tbody>
            {rows.map((d, i) => (
              <tr key={d.id} className="border-b border-border/50">
                <td className="px-3 py-2.5 text-text2">{i + 1}</td>
                <td className="px-3 py-2.5 font-mono text-[10px]">{d.tanggal_kegiatan}</td>
                <td className="px-3 py-2.5 font-mono text-[10px]">{d.nomor}</td>
                <td className="px-3 py-2.5">{d.petugas_nama}</td>
                <td className="px-3 py-2.5 text-text2">{d.kategori}</td>
                <td className="px-3 py-2.5 max-w-[180px]"><div className="truncate">{d.judul}</div></td>
                <td className="px-3 py-2.5 text-text2">{d.lokasi || '-'}</td>
                <td className="px-3 py-2.5 font-mono">{d.durasi_jam}j</td>
                <td className={`px-3 py-2.5 font-semibold ${KESULITAN[d.tingkat_kesulitan]?.cls}`}>{KESULITAN[d.tingkat_kesulitan]?.label}</td>
                <td className="px-3 py-2.5"><span className={`text-[10px] px-2 py-0.5 rounded-full font-semibold ${STATUS[d.status].cls}`}>{STATUS[d.status].label}</span></td>
                <td className="px-3 py-2.5 font-bold text-success">{d.poin}</td>
                <td className="px-3 py-2.5"><button onClick={() => setDetail(d.id)} className="border border-border text-text2 hover:text-white rounded px-2 py-0.5 text-[10px]">👁️ Lihat</button></td>
              </tr>
            ))}
            {rows.length === 0 && <tr><td colSpan={12} className="px-3 py-6 text-center text-text2">{tab === 'persetujuan' ? 'Tidak ada kegiatan menunggu persetujuan.' : 'Belum ada kegiatan.'}</td></tr>}
          </tbody></table>
        </div>
      </>)}

      {tab === 'rekap' && recap && (
        <div className="grid lg:grid-cols-2 gap-4">
          <div className="bg-surface border border-border rounded-xl p-4">
            <div className="text-[12px] font-semibold mb-2">Ringkasan {recap.month}</div>
            <div className="grid grid-cols-3 gap-3 mb-3"><Stat l="Total Kegiatan" v={recap.total} c="#60a5fa" ic="" /><Stat l="Total Jam" v={`${recap.jam}j`} c="#a78bfa" ic="" /><Stat l="Total Poin" v={recap.poin} c="#22c55e" ic="" /></div>
            <div className="text-[11px] font-semibold mb-1 mt-3">Per Kategori</div>
            {recap.perKategori.map((c) => <div key={c.kategori} className="flex justify-between text-[11px] py-0.5"><span>{c.kategori}</span><span className="text-text2">{c.jumlah} keg · {c.poin} poin</span></div>)}
          </div>
          <div className="bg-surface border border-border rounded-xl p-4">
            <div className="text-[12px] font-semibold mb-2">Per Teknisi</div>
            <table className="w-full text-[11px]"><thead><tr className="text-text2 uppercase text-[9px] border-b border-border"><th className="text-left py-1">Teknisi</th><th>Keg</th><th>Jam</th><th>Poin</th></tr></thead><tbody>
              {recap.perTeknisi.map((t) => <tr key={t.nama} className="border-b border-border/40"><td className="py-1">{t.nama}</td><td className="text-center">{t.jumlah}</td><td className="text-center">{t.jam}j</td><td className="text-center font-bold text-success">{t.poin}</td></tr>)}
            </tbody></table>
            <div className="text-[11px] font-semibold mb-1 mt-3">Tren 6 Bulan (jumlah kegiatan)</div>
            <div className="flex items-end justify-between gap-1.5 h-[80px]">{recap.tren.map((t) => { const mx = Math.max(1, ...recap.tren.map((x) => x.jumlah)); return <div key={t.label} className="flex-1 flex flex-col items-center gap-1"><div className="text-[9px] text-text2">{t.jumlah}</div><div className="w-full rounded-t bg-accent2" style={{ height: `${(t.jumlah / mx) * 100}%`, minHeight: 2 }} /><div className="text-[9px] text-text2">{t.label}</div></div>; })}</div>
          </div>
        </div>
      )}

      {tab === 'statistik' && stats && (
        <div className="grid lg:grid-cols-2 gap-4">
          <div className="bg-surface border border-border rounded-xl p-4"><div className="text-[12px] font-semibold mb-2">🏅 Top Kontributor</div>{stats.topKontributor.map((c, i) => <div key={i} className="flex justify-between text-[12px] py-1"><span>{i + 1}. {c.nama}</span><span className="text-text2">{c.jumlah} keg · <b className="text-success">{c.poin} poin</b></span></div>)}{!stats.topKontributor.length && <div className="text-text2 text-[11px]">-</div>}</div>
          <div className="bg-surface border border-border rounded-xl p-4"><div className="text-[12px] font-semibold mb-2">📂 Top Kategori</div>{stats.topKategori.map((c, i) => { const mx = Math.max(1, ...stats.topKategori.map((x) => x.jumlah)); return <div key={i} className="mb-2"><div className="flex justify-between text-[11px] mb-0.5"><span>{c.kategori}</span><span className="font-bold">{c.jumlah}</span></div><div className="h-1.5 rounded-full bg-surface2"><div className="h-full rounded-full bg-accent" style={{ width: `${(c.jumlah / mx) * 100}%` }} /></div></div>; })}{!stats.topKategori.length && <div className="text-text2 text-[11px]">-</div>}</div>
        </div>
      )}

      {showForm && <KegForm cats={cats} edit={editId ? rows.find((r) => r.id === editId) || null : null} onClose={() => setShowForm(false)} onSaved={() => { setShowForm(false); loadList(); }} />}
      {detail != null && <KegDetail id={detail} isManager={isManager} userId={user?.id} onClose={() => setDetail(null)} onChanged={loadList} onEdit={(d) => { setDetail(null); setEditId(d.id); setShowForm(true); }} />}
    </div>
  );
}

const inp = 'w-full bg-surface2 border border-border rounded-md px-3 py-2 text-xs';
const F = ({ label, children, full }: { label: string; children: React.ReactNode; full?: boolean }) => (<div className={full ? 'sm:col-span-2' : ''}><label className="block text-[11px] text-text2 mb-1">{label}</label>{children}</div>);

function KegForm({ cats, edit, onClose, onSaved }: { cats: string[]; edit: Keg | null; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState<any>(edit ? { ...empty, ...edit, durasi_jam: String(edit.durasi_jam || ''), jumlah_personel: String(edit.jumlah_personel || '1') } : { ...empty, kategori: cats[0] || '' });
  const [foto, setFoto] = useState<File[]>([]);
  const [dok, setDok] = useState<File[]>([]);
  const [busy, setBusy] = useState(false); const [err, setErr] = useState('');
  const set = (k: string, v: string) => setF((p: any) => ({ ...p, [k]: v }));
  async function save() {
    if (!f.judul?.trim() || !f.kategori) return setErr('Judul & kategori wajib diisi.');
    setBusy(true); setErr('');
    try {
      const fd = new FormData();
      ['tanggal_kegiatan', 'petugas_nama', 'unit_kerja', 'kategori', 'judul', 'lokasi', 'uraian', 'hasil', 'durasi_jam', 'jumlah_personel', 'tingkat_kesulitan'].forEach((k) => f[k] && fd.append(k, f[k]));
      foto.forEach((x) => fd.append('foto', x)); dok.forEach((x) => fd.append('dokumen', x));
      if (edit) await api.put(`/kegiatan-nr/${edit.id}`, fd, { headers: { 'Content-Type': 'multipart/form-data' } });
      else await api.post('/kegiatan-nr', fd, { headers: { 'Content-Type': 'multipart/form-data' } });
      onSaved();
    } catch (e: any) { setErr(e?.response?.data?.error || 'Gagal menyimpan.'); } finally { setBusy(false); }
  }
  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-surface border border-border rounded-xl w-full max-w-2xl p-5 max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4"><h3 className="text-sm font-bold">📝 {edit ? 'Edit' : 'Tambah'} Kegiatan Non-Rutin</h3><button onClick={onClose} className="text-text2 hover:text-white text-lg">×</button></div>
        <div className="grid sm:grid-cols-2 gap-3">
          <F label="Judul Kegiatan *" full><input className={inp} value={f.judul} onChange={(e) => set('judul', e.target.value)} /></F>
          <F label="Tanggal Kegiatan"><input type="date" className={inp} value={f.tanggal_kegiatan} onChange={(e) => set('tanggal_kegiatan', e.target.value)} /></F>
          <F label="Nama Petugas"><input className={inp} value={f.petugas_nama} onChange={(e) => set('petugas_nama', e.target.value)} placeholder="(default: Anda)" /></F>
          <F label="Kategori"><select className={inp} value={f.kategori} onChange={(e) => set('kategori', e.target.value)}><option value="">Pilih…</option>{cats.map((c) => <option key={c} value={c}>{c}</option>)}</select></F>
          <F label="Unit Kerja"><input className={inp} value={f.unit_kerja} onChange={(e) => set('unit_kerja', e.target.value)} /></F>
          <F label="Lokasi Kegiatan"><input className={inp} value={f.lokasi} onChange={(e) => set('lokasi', e.target.value)} /></F>
          <F label="Tingkat Kesulitan"><select className={inp} value={f.tingkat_kesulitan} onChange={(e) => set('tingkat_kesulitan', e.target.value)}>{Object.entries(KESULITAN).map(([k, v]) => <option key={k} value={k}>{v.label} ({v.poin} poin)</option>)}</select></F>
          <F label="Durasi (Jam)"><input type="number" step="0.5" className={inp} value={f.durasi_jam} onChange={(e) => set('durasi_jam', e.target.value)} /></F>
          <F label="Jumlah Personel"><input type="number" className={inp} value={f.jumlah_personel} onChange={(e) => set('jumlah_personel', e.target.value)} /></F>
          <F label="Uraian Kegiatan" full><textarea className={`${inp} min-h-[60px]`} value={f.uraian} onChange={(e) => set('uraian', e.target.value)} /></F>
          <F label="Hasil Kegiatan" full><textarea className={`${inp} min-h-[50px]`} value={f.hasil} onChange={(e) => set('hasil', e.target.value)} /></F>
          <F label="📷 Dokumentasi Foto (bisa banyak)"><input type="file" multiple accept="image/*" capture="environment" onChange={(e) => setFoto(Array.from(e.target.files || []))} className="w-full text-[11px] text-text2 file:mr-2 file:py-1 file:px-2 file:rounded file:border-0 file:text-[11px] file:bg-surface2 file:text-white" />{foto.length > 0 && <div className="text-[10px] text-accent2 mt-1">{foto.length} foto</div>}</F>
          <F label="📎 Lampiran Dokumen (PDF, dll.)"><input type="file" multiple accept="application/pdf,image/*,.doc,.docx,.xls,.xlsx" onChange={(e) => setDok(Array.from(e.target.files || []))} className="w-full text-[11px] text-text2 file:mr-2 file:py-1 file:px-2 file:rounded file:border-0 file:text-[11px] file:bg-surface2 file:text-white" />{dok.length > 0 && <div className="text-[10px] text-accent2 mt-1">{dok.length} file</div>}</F>
        </div>
        {err && <div className="bg-danger/10 border border-danger/30 rounded-md px-3 py-2 text-[11px] text-danger mt-3">⚠️ {err}</div>}
        <div className="flex gap-2 justify-end mt-4"><button className="border border-border text-text2 rounded-md px-3 py-1.5 text-xs" onClick={onClose} disabled={busy}>Batal</button><button className="bg-accent text-bg rounded-md px-3 py-1.5 text-xs font-semibold disabled:opacity-50" onClick={save} disabled={busy}>{busy ? 'Menyimpan…' : 'Simpan (Draft)'}</button></div>
      </div>
    </div>
  );
}

function KegDetail({ id, isManager, userId, onClose, onChanged, onEdit }: { id: number; isManager: boolean; userId?: number; onClose: () => void; onChanged: () => void; onEdit: (d: Keg) => void }) {
  const [d, setD] = useState<Keg | null>(null);
  const [busy, setBusy] = useState(false); const [msg, setMsg] = useState('');
  function load() { api.get(`/kegiatan-nr/${id}`).then((r) => setD(r.data.kegiatan)).catch(() => {}); }
  useEffect(load, [id]);
  async function setStatus(next: KnrStatus, ask?: boolean, askPoin?: boolean) {
    let note = ''; let poin: string | undefined;
    if (ask) { const v = window.prompt(next === 'ditolak' ? 'Alasan penolakan:' : 'Catatan koordinator (opsional):'); if (v === null) return; note = v; }
    if (askPoin) { const p = window.prompt(`Bobot/poin penilaian (default ${d?.poin}):`, String(d?.poin || '')); if (p) poin = p; }
    setBusy(true);
    try { const r = await api.patch(`/kegiatan-nr/${id}/status`, { status: next, note, poin }); setD(r.data.kegiatan); onChanged(); }
    catch (e: any) { setMsg(e?.response?.data?.error || 'Gagal.'); setTimeout(() => setMsg(''), 4000); } finally { setBusy(false); }
  }
  async function hapus() { if (!confirm('Hapus kegiatan ini?')) return; await api.delete(`/kegiatan-nr/${id}`); onChanged(); onClose(); }
  if (!d) return null;
  const owner = d.created_by === userId || d.petugas_id === userId;
  const Row = ({ k, v }: { k: string; v: React.ReactNode }) => <div className="flex gap-2 text-[12px] py-0.5"><div className="text-text2 w-32 shrink-0">{k}</div><div className="flex-1">{v || '-'}</div></div>;
  const foto = d.files.filter((f) => f.jenis === 'foto'); const dok = d.files.filter((f) => f.jenis !== 'foto');
  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-surface border border-border rounded-xl w-full max-w-2xl p-5 max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between mb-3 gap-2"><div><h3 className="text-sm font-bold">{d.judul}</h3><div className="text-[11px] text-text2 font-mono">{d.nomor} · {d.kategori}</div></div><span className={`text-[10px] px-2 py-1 rounded-full font-semibold ${STATUS[d.status].cls}`}>{STATUS[d.status].label}</span></div>
        {msg && <div className="bg-accent2/10 border border-accent2/30 rounded-md px-3 py-2 text-[11px] text-accent2 mb-3">{msg}</div>}
        <div className="border border-border rounded-lg p-3 mb-3">
          <Row k="Tanggal" v={d.tanggal_kegiatan} /><Row k="Petugas" v={`${d.petugas_nama} · ${d.unit_kerja || '-'}`} /><Row k="Lokasi" v={d.lokasi} />
          <Row k="Durasi / Personel" v={`${d.durasi_jam} jam · ${d.jumlah_personel} orang`} />
          <Row k="Tingkat Kesulitan" v={<span className={KESULITAN[d.tingkat_kesulitan]?.cls}>{KESULITAN[d.tingkat_kesulitan]?.label} · <b className="text-success">{d.poin} poin</b></span>} />
          <Row k="Uraian" v={d.uraian} /><Row k="Hasil" v={d.hasil} />
          {d.catatan_koordinator && <Row k="Catatan Koord." v={d.catatan_koordinator} />}
          <Row k="Nota Dinas" v={d.nomor_nota_dinas ? <span className="text-success font-mono">{d.nomor_nota_dinas}</span> : <span className="text-text2">otomatis dibuat saat disetujui</span>} />
        </div>
        {(foto.length > 0 || dok.length > 0) && (
          <div className="border border-border rounded-lg p-3 mb-3">
            {foto.length > 0 && <><div className="text-[11px] text-text2 mb-1.5">📷 Dokumentasi ({foto.length})</div><div className="grid grid-cols-4 gap-2 mb-2">{foto.map((f) => <a key={f.id} href={f.file_url} target="_blank" rel="noreferrer"><img src={f.file_url} className="w-full h-16 object-cover rounded border border-border" /></a>)}</div></>}
            {dok.length > 0 && <div className="space-y-1">{dok.map((f) => <a key={f.id} href={f.file_url} target="_blank" rel="noreferrer" className="block text-[11px] text-accent2 hover:underline">📎 {f.filename}</a>)}</div>}
          </div>
        )}
        <div className="border border-border rounded-lg p-3 mb-3">
          <div className="text-[11px] text-text2 mb-1.5 font-semibold">📜 Riwayat Persetujuan</div>
          {d.approval.map((a) => <div key={a.id} className="flex items-center gap-2 text-[11px] py-0.5"><span className="font-mono text-text2 w-28 shrink-0">{new Date(a.created_at).toLocaleString('id-ID', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}</span><span className={`px-1.5 rounded ${STATUS[a.status as KnrStatus]?.cls || 'bg-surface2'}`}>{STATUS[a.status as KnrStatus]?.label || a.status}</span><span className="text-text2">{a.user_name}{a.poin != null ? ` · ${a.poin} poin` : ''}{a.note ? ` — ${a.note}` : ''}</span></div>)}
        </div>
        <div className="flex gap-2 flex-wrap">
          {d.status === 'draft' && (owner || isManager) && <button onClick={() => setStatus('diajukan', true)} disabled={busy} className="bg-warn text-bg rounded-md px-3 py-1.5 text-xs font-semibold">📤 Ajukan</button>}
          {d.status === 'diajukan' && isManager && <button onClick={() => setStatus('diverifikasi', true)} disabled={busy} className="bg-accent2 text-bg rounded-md px-3 py-1.5 text-xs font-semibold">✓ Verifikasi</button>}
          {d.status === 'diverifikasi' && isManager && <button onClick={() => setStatus('disetujui', true, true)} disabled={busy} className="bg-success text-bg rounded-md px-3 py-1.5 text-xs font-semibold">✔ Setujui & Beri Bobot</button>}
          {['diajukan', 'diverifikasi'].includes(d.status) && isManager && <button onClick={() => setStatus('ditolak', true)} disabled={busy} className="border border-danger/40 text-danger rounded-md px-3 py-1.5 text-xs">✗ Tolak</button>}
          {d.status === 'disetujui' && isManager && <button onClick={() => setStatus('selesai', true)} disabled={busy} className="bg-[#14b8a6] text-bg rounded-md px-3 py-1.5 text-xs font-semibold">🏁 Selesai</button>}
          {(owner || isManager) && ['draft', 'diajukan'].includes(d.status) && <button onClick={() => onEdit(d)} className="border border-border text-text2 rounded-md px-3 py-1.5 text-xs">✏️ Edit</button>}
          {(isManager || (owner && d.status === 'draft')) && <button onClick={hapus} className="border border-danger/40 text-danger rounded-md px-3 py-1.5 text-xs ml-auto">🗑️ Hapus</button>}
          <button onClick={onClose} className="border border-border text-text2 rounded-md px-3 py-1.5 text-xs">Tutup</button>
        </div>
      </div>
    </div>
  );
}
