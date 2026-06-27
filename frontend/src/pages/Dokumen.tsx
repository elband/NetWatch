import { useEffect, useState } from 'react';
import { api } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { hasRole } from '../utils/roles';
import { confirmDialog } from '../components/dialog';
import type { Dokumen as Doc, DokumenStats, DocCategory, DocComment, DocVersion, DocStatus } from '../types';

const STATUS: Record<DocStatus, { label: string; cls: string }> = {
  draft: { label: 'Draft', cls: 'bg-slate-500/15 text-slate-300' },
  review: { label: 'Review', cls: 'bg-warn/15 text-warn' },
  disetujui: { label: 'Disetujui', cls: 'bg-accent2/15 text-accent2' },
  aktif: { label: 'Aktif', cls: 'bg-success/15 text-success' },
  kadaluarsa: { label: 'Kadaluarsa', cls: 'bg-danger/15 text-danger' },
  arsip: { label: 'Arsip', cls: 'bg-border text-text2' },
};
const CAT_ICON: Record<string, string> = { SOP: '📋', 'Work Instruction': '🧭', 'Knowledge Base': '💡', 'Materi Diklat': '🎓', 'Dokumentasi Sistem': '🖥️', 'Dokumentasi Infrastruktur': '🏗️', 'Troubleshooting Guide': '🛠️', 'Diagram Jaringan': '🌐', 'Form dan Template': '📝', 'Kebijakan dan Regulasi': '⚖️', 'Manual Vendor': '📦', 'Video Tutorial': '🎬' };
const icon = (k: string) => CAT_ICON[k] || '📄';
const empty = { nomor: '', judul: '', kategori: 'SOP', sub_kategori: '', deskripsi: '', tags: '', versi: '1.0', tanggal_berlaku: '', tanggal_review: '', pemilik: '', unit_kerja: 'Unit Elektronika Bandara', video_url: '', link_ref: '', catatan_revisi: '', status: 'draft' };

export default function Dokumen() {
  const { user } = useAuth();
  const isManager = hasRole(user, 'admin', 'koordinator');
  const isAdmin = hasRole(user, 'admin');
  const [tab, setTab] = useState<'semua' | 'favorit' | 'terbaca'>('semua');
  const [data, setData] = useState<DokumenStats | null>(null);
  const [cats, setCats] = useState<DocCategory[]>([]);
  const [docs, setDocs] = useState<Doc[]>([]);
  const [q, setQ] = useState('');
  const [kategori, setKategori] = useState('');
  const [status, setStatus] = useState('');
  const [sort, setSort] = useState('baru');
  const [showForm, setShowForm] = useState(false);
  const [editId, setEditId] = useState<number | null>(null);
  const [detailId, setDetailId] = useState<number | null>(null);
  const [ai, setAi] = useState('');
  const [aiRes, setAiRes] = useState<{ answer: string; docs: { id: number; judul: string; kategori: string }[] } | null>(null);

  function loadStats() { api.get('/dokumen/stats').then((r) => setData(r.data)).catch(() => {}); api.get('/dokumen/categories').then((r) => setCats(r.data.categories)).catch(() => {}); }
  function loadDocs() {
    if (tab === 'favorit') return api.get('/dokumen/favorites').then((r) => setDocs(r.data.documents)).catch(() => {});
    if (tab === 'terbaca') return api.get('/dokumen/recent').then((r) => setDocs(r.data.documents)).catch(() => {});
    const p = new URLSearchParams(); if (q) p.set('q', q); if (kategori) p.set('kategori', kategori); if (status) p.set('status', status); p.set('sort', sort === 'populer' ? 'populer' : sort === 'judul' ? 'judul' : 'baru');
    api.get(`/dokumen?${p}`).then((r) => setDocs(r.data.documents)).catch(() => {});
  }
  useEffect(loadStats, []);
  useEffect(() => { const t = setTimeout(loadDocs, q ? 300 : 0); return () => clearTimeout(t); }, [tab, q, kategori, status, sort]);

  async function askAi() {
    if (!ai.trim()) return;
    const r = await api.post('/dokumen/assistant', { q: ai }); setAiRes(r.data);
  }

  const Stat = ({ label, value, color, icon: ic }: { label: string; value: number; color: string; icon: string }) => (
    <div className="bg-surface border border-border rounded-xl p-3.5">
      <div className="flex items-center justify-between"><span className="text-[11px] text-text2">{label}</span><span>{ic}</span></div>
      <div className="text-[24px] font-extrabold mt-0.5" style={{ color }}>{value}</div>
    </div>
  );

  return (
    <div>
      <div className="flex items-center justify-between mb-4 gap-2 flex-wrap">
        <div className="text-[17px] font-bold">📚 Manajemen Dokumen <span className="text-text2 text-[12px] font-normal">· SOP · Knowledge Base · Materi</span></div>
        {isManager && <button onClick={() => { setEditId(null); setShowForm(true); }} className="bg-accent text-bg rounded-md px-3 py-1.5 text-xs font-semibold">+ Tambah Dokumen</button>}
      </div>

      {/* Dashboard */}
      {data && (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 mb-4">
          <Stat label="Total Dokumen" value={data.stats.total} color="#60a5fa" icon="📄" />
          <Stat label="SOP" value={data.stats.sop} color="#22c55e" icon="📋" />
          <Stat label="Knowledge Base" value={data.stats.kb} color="#eab308" icon="💡" />
          <Stat label="Materi Diklat" value={data.stats.materi} color="#14b8a6" icon="🎓" />
          <Stat label="Belum Direview" value={data.stats.belumReview} color="#f97316" icon="🕓" />
          <Stat label="Kadaluarsa" value={data.stats.kadaluarsa} color="#ef4444" icon="⚠️" />
        </div>
      )}

      {/* AI Assistant */}
      <div className="bg-gradient-to-br from-accent/10 to-accent2/8 border border-accent/25 rounded-xl p-4 mb-4">
        <div className="text-[12px] font-bold mb-2">🤖 AI Knowledge Assistant</div>
        <div className="flex gap-2">
          <input value={ai} onChange={(e) => setAi(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && askAi()} placeholder='mis. "Bagaimana prosedur restart FIDS?"' className="flex-1 bg-surface2 border border-border rounded-md px-3 py-2 text-xs" />
          <button onClick={askAi} className="bg-accent text-bg rounded-md px-4 py-2 text-xs font-semibold">Tanya</button>
        </div>
        {aiRes && (
          <div className="mt-3 text-[12px]">
            <div className="text-text2">{aiRes.answer}</div>
            <div className="flex flex-wrap gap-1.5 mt-2">{aiRes.docs.map((d) => <button key={d.id} onClick={() => setDetailId(d.id)} className="border border-accent2/40 text-accent2 rounded-full px-2.5 py-0.5 text-[11px]">{icon(d.kategori)} {d.judul}</button>)}</div>
          </div>
        )}
      </div>

      <div className="grid lg:grid-cols-[1fr_280px] gap-4">
        {/* Kiri: filter + daftar */}
        <div>
          <div className="flex gap-1 mb-3">
            {([['semua', '📚 Semua'], ['favorit', '⭐ Favorit'], ['terbaca', '🕘 Terakhir Dibaca']] as const).map(([k, l]) => (
              <button key={k} onClick={() => setTab(k)} className={`px-3 py-1.5 text-xs rounded-md ${tab === k ? 'bg-accent text-bg font-semibold' : 'bg-surface2 text-text2'}`}>{l}</button>
            ))}
          </div>
          {tab === 'semua' && (
            <div className="flex gap-2 mb-3 flex-wrap">
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="🔍 Cari judul / isi / tag / nomor…" className="bg-surface2 border border-border rounded-md px-3 py-2 text-xs flex-1 min-w-[180px]" />
              <select value={kategori} onChange={(e) => setKategori(e.target.value)} className="bg-surface2 border border-border rounded-md px-2 py-2 text-xs"><option value="">Semua kategori</option>{cats.map((c) => <option key={c.id} value={c.name}>{c.name}</option>)}</select>
              <select value={status} onChange={(e) => setStatus(e.target.value)} className="bg-surface2 border border-border rounded-md px-2 py-2 text-xs"><option value="">Semua status</option>{Object.entries(STATUS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}</select>
              <select value={sort} onChange={(e) => setSort(e.target.value)} className="bg-surface2 border border-border rounded-md px-2 py-2 text-xs"><option value="baru">Terbaru</option><option value="populer">Terpopuler</option><option value="judul">Judul</option></select>
            </div>
          )}
          <div className="grid sm:grid-cols-2 gap-3">
            {docs.map((d) => (
              <button key={d.id} onClick={() => setDetailId(d.id)} className="text-left bg-surface border border-border rounded-xl p-3.5 hover:border-accent/40 transition">
                <div className="flex items-start justify-between gap-2">
                  <div className="text-[13px] font-semibold leading-tight">{icon(d.kategori)} {d.judul}</div>
                  <span className={`text-[9px] px-1.5 py-0.5 rounded-full shrink-0 ${STATUS[d.status].cls}`}>{STATUS[d.status].label}</span>
                </div>
                <div className="text-[10px] text-text2 mt-1">{d.kategori}{d.nomor ? ` · ${d.nomor}` : ''} · v{d.versi}</div>
                {d.deskripsi && <div className="text-[11px] text-text2 mt-1.5 line-clamp-2">{d.deskripsi}</div>}
                <div className="flex items-center justify-between mt-2 text-[10px] text-text2">
                  <span>{d.pemilik || d.creator_name}</span><span>👁️ {d.views}</span>
                </div>
              </button>
            ))}
            {docs.length === 0 && <div className="col-span-2 text-center text-text2 text-xs py-10">Tidak ada dokumen.</div>}
          </div>
        </div>

        {/* Kanan: insight, populer, kontributor, aktivitas, kategori */}
        <div className="space-y-4">
          {data && (
            <>
              <Panel title="🧠 AI Insight">{data.insight.map((i, k) => <div key={k} className={`text-[11px] rounded-md px-2.5 py-1.5 mb-1 ${i.type === 'good' ? 'bg-success/10 text-success' : i.type === 'warn' ? 'bg-warn/10 text-warn' : i.type === 'bad' ? 'bg-danger/10 text-danger' : 'bg-surface2 text-text2'}`}>{i.text}</div>)}</Panel>
              <Panel title="🔥 Terpopuler">{data.terpopuler.map((d) => <Line key={d.id} onClick={() => setDetailId(d.id)} left={`${icon(d.kategori)} ${d.judul}`} right={`👁️ ${d.views}`} />)}{!data.terpopuler.length && <Empty />}</Panel>
              <Panel title="🆕 Terbaru">{data.terbaru.map((d) => <Line key={d.id} onClick={() => setDetailId(d.id)} left={`${icon(d.kategori)} ${d.judul}`} right={STATUS[d.status].label} />)}{!data.terbaru.length && <Empty />}</Panel>
              <Panel title="🏅 Top Contributor">{data.kontributor.map((c, k) => <Line key={k} left={`${k + 1}. ${c.name}`} right={`${c.jumlah} dok`} />)}{!data.kontributor.length && <Empty />}</Panel>
              <Panel title="📌 Aktivitas Terakhir">{data.aktivitas.map((a, k) => <div key={k} className="text-[10px] text-text2 py-0.5 truncate">{a.user_name} membuka <b className="text-text">{a.judul}</b></div>)}{!data.aktivitas.length && <Empty />}</Panel>
            </>
          )}
          {isAdmin && <CategoryPanel cats={cats} onChange={loadStats} />}
        </div>
      </div>

      {showForm && <DocForm cats={cats} edit={editId ? docs.find((d) => d.id === editId) || null : null} onClose={() => setShowForm(false)} onSaved={() => { setShowForm(false); loadDocs(); loadStats(); }} />}
      {detailId != null && <DocDetail id={detailId} isManager={isManager} onClose={() => setDetailId(null)} onChanged={() => { loadDocs(); loadStats(); }} onEdit={(d) => { setDetailId(null); setEditId(d.id); setShowForm(true); }} />}
    </div>
  );
}

const Panel = ({ title, children }: { title: string; children: React.ReactNode }) => (<div className="bg-surface border border-border rounded-xl p-3.5"><div className="font-head text-[11px] font-semibold mb-2">{title}</div>{children}</div>);
const Line = ({ left, right, onClick }: { left: string; right: string; onClick?: () => void }) => (<button onClick={onClick} disabled={!onClick} className="w-full flex items-center justify-between gap-2 text-[11px] py-0.5 text-left hover:text-accent disabled:hover:text-current"><span className="truncate">{left}</span><span className="text-text2 shrink-0">{right}</span></button>);
const Empty = () => <div className="text-[11px] text-text2">-</div>;
const inp = 'w-full bg-surface2 border border-border rounded-md px-3 py-2 text-xs';
const F = ({ label, children, full }: { label: string; children: React.ReactNode; full?: boolean }) => (<div className={full ? 'sm:col-span-2' : ''}><label className="block text-[11px] text-text2 mb-1">{label}</label>{children}</div>);

function CategoryPanel({ cats, onChange }: { cats: DocCategory[]; onChange: () => void }) {
  const [name, setName] = useState('');
  async function add() { if (!name.trim()) return; await api.post('/dokumen/categories', { name: name.trim() }); setName(''); onChange(); }
  async function del(id: number) { if (!(await confirmDialog({ title: 'Hapus kategori', message: 'Kategori dokumen ini akan dihapus.', confirmText: '🗑️ Hapus', variant: 'danger' }))) return; await api.delete(`/dokumen/categories/${id}`); onChange(); }
  return (
    <Panel title="🗂️ Kelola Kategori">
      <div className="space-y-1 mb-2 max-h-[160px] overflow-y-auto">{cats.map((c) => <div key={c.id} className="flex items-center justify-between text-[11px]"><span>{c.name} <span className="text-text2">({c.jumlah})</span></span><button onClick={() => del(c.id)} className="text-danger">✕</button></div>)}</div>
      <div className="flex gap-1.5"><input value={name} onChange={(e) => setName(e.target.value)} placeholder="Kategori baru" className="flex-1 bg-surface2 border border-border rounded-md px-2 py-1.5 text-[11px]" /><button onClick={add} className="bg-accent text-bg rounded-md px-2.5 text-[11px]">+</button></div>
    </Panel>
  );
}

function DocForm({ cats, edit, onClose, onSaved }: { cats: DocCategory[]; edit: Doc | null; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState<any>(edit ? { ...empty, ...edit, tanggal_berlaku: edit.tanggal_berlaku || '', tanggal_review: edit.tanggal_review || '', tags: edit.tags || '' } : empty);
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false); const [err, setErr] = useState('');
  const set = (k: string, v: string) => setF((p: any) => ({ ...p, [k]: v }));
  async function save() {
    if (!f.judul?.trim()) return setErr('Judul wajib diisi.');
    setBusy(true); setErr('');
    try {
      const fd = new FormData();
      ['nomor', 'judul', 'kategori', 'sub_kategori', 'deskripsi', 'tags', 'versi', 'tanggal_berlaku', 'tanggal_review', 'pemilik', 'unit_kerja', 'video_url', 'link_ref', 'catatan_revisi', 'status'].forEach((k) => f[k] && fd.append(k, f[k]));
      if (file) fd.append('file', file);
      if (edit) await api.put(`/dokumen/${edit.id}`, fd, { headers: { 'Content-Type': 'multipart/form-data' } });
      else await api.post('/dokumen', fd, { headers: { 'Content-Type': 'multipart/form-data' } });
      onSaved();
    } catch (e: any) { setErr(e?.response?.data?.error || 'Gagal menyimpan.'); } finally { setBusy(false); }
  }
  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-surface border border-border rounded-xl w-full max-w-2xl p-5 max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4"><h3 className="text-sm font-bold">📄 {edit ? 'Edit' : 'Tambah'} Dokumen</h3><button onClick={onClose} className="text-text2 hover:text-text text-lg">×</button></div>
        <div className="grid sm:grid-cols-2 gap-3">
          <F label="Judul Dokumen *" full><input className={inp} value={f.judul} onChange={(e) => set('judul', e.target.value)} /></F>
          <F label="Nomor Dokumen"><input className={inp} value={f.nomor} onChange={(e) => set('nomor', e.target.value)} /></F>
          <F label="Kategori"><select className={inp} value={f.kategori} onChange={(e) => set('kategori', e.target.value)}>{cats.map((c) => <option key={c.id} value={c.name}>{c.name}</option>)}</select></F>
          <F label="Sub Kategori"><input className={inp} value={f.sub_kategori} onChange={(e) => set('sub_kategori', e.target.value)} placeholder="mis. FIDS, CCTV…" /></F>
          <F label="Versi"><input className={inp} value={f.versi} onChange={(e) => set('versi', e.target.value)} /></F>
          <F label="Deskripsi" full><textarea className={`${inp} min-h-[60px]`} value={f.deskripsi} onChange={(e) => set('deskripsi', e.target.value)} /></F>
          <F label="Tags (pisah koma)" full><input className={inp} value={f.tags} onChange={(e) => set('tags', e.target.value)} placeholder="restart, fids, server" /></F>
          <F label="Tanggal Berlaku"><input type="date" className={inp} value={f.tanggal_berlaku} onChange={(e) => set('tanggal_berlaku', e.target.value)} /></F>
          <F label="Tanggal Review"><input type="date" className={inp} value={f.tanggal_review} onChange={(e) => set('tanggal_review', e.target.value)} /></F>
          <F label="Pemilik Dokumen"><input className={inp} value={f.pemilik} onChange={(e) => set('pemilik', e.target.value)} /></F>
          <F label="Unit Kerja"><input className={inp} value={f.unit_kerja} onChange={(e) => set('unit_kerja', e.target.value)} /></F>
          <F label="Link Video Tutorial"><input className={inp} value={f.video_url} onChange={(e) => set('video_url', e.target.value)} placeholder="https://…" /></F>
          <F label="Link Referensi"><input className={inp} value={f.link_ref} onChange={(e) => set('link_ref', e.target.value)} /></F>
          <F label="Catatan Revisi" full><input className={inp} value={f.catatan_revisi} onChange={(e) => set('catatan_revisi', e.target.value)} /></F>
          <F label="📎 Lampiran File (PDF/PPT/DOC/gambar)" full><input type="file" onChange={(e) => setFile(e.target.files?.[0] || null)} className="w-full text-[11px] text-text2 file:mr-2 file:py-1.5 file:px-3 file:rounded-md file:border-0 file:text-xs file:bg-surface2 file:text-text" /></F>
        </div>
        {err && <div className="bg-danger/10 border border-danger/30 rounded-md px-3 py-2 text-[11px] text-danger mt-3">⚠️ {err}</div>}
        <div className="flex gap-2 justify-end mt-4"><button className="border border-border text-text2 rounded-md px-3 py-1.5 text-xs" onClick={onClose} disabled={busy}>Batal</button><button className="bg-accent text-bg rounded-md px-3 py-1.5 text-xs font-semibold disabled:opacity-50" onClick={save} disabled={busy}>{busy ? 'Menyimpan…' : 'Simpan'}</button></div>
      </div>
    </div>
  );
}

function DocDetail({ id, isManager, onClose, onChanged, onEdit }: { id: number; isManager: boolean; onClose: () => void; onChanged: () => void; onEdit: (d: Doc) => void }) {
  const [d, setD] = useState<Doc | null>(null);
  const [versions, setVersions] = useState<DocVersion[]>([]);
  const [comments, setComments] = useState<DocComment[]>([]);
  const [fav, setFav] = useState(false);
  const [cmt, setCmt] = useState('');
  function load() { api.get(`/dokumen/${id}`).then((r) => { setD(r.data.document); setVersions(r.data.versions); setComments(r.data.comments); setFav(r.data.favorited); }).catch(() => {}); }
  useEffect(load, [id]);
  async function setStatus(s: DocStatus) { const r = await api.patch(`/dokumen/${id}/status`, { status: s }); setD(r.data.document); onChanged(); }
  async function toggleFav() { const r = await api.post(`/dokumen/${id}/favorite`); setFav(r.data.favorited); }
  async function addComment() { if (!cmt.trim()) return; const r = await api.post(`/dokumen/${id}/comment`, { body: cmt }); setComments(r.data.comments); setCmt(''); }
  async function hapus() { if (!(await confirmDialog({ title: 'Hapus dokumen', message: 'Dokumen ini akan dihapus permanen.', confirmText: '🗑️ Hapus', variant: 'danger' }))) return; await api.delete(`/dokumen/${id}`); onChanged(); onClose(); }
  if (!d) return null;
  const NEXT: Record<string, DocStatus[]> = { draft: ['review'], review: ['disetujui', 'draft'], disetujui: ['aktif'], aktif: ['kadaluarsa', 'arsip'], kadaluarsa: ['aktif', 'arsip'], arsip: ['aktif'] };
  const LBL: Record<string, string> = { review: '📤 Ajukan Review', disetujui: '✔ Setujui', aktif: '✅ Aktifkan', kadaluarsa: '⚠️ Tandai Kadaluarsa', arsip: '🗄️ Arsipkan', draft: '↩ Kembalikan Draft' };
  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-surface border border-border rounded-xl w-full max-w-2xl p-5 max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between mb-2 gap-2">
          <div><h3 className="text-sm font-bold">{icon(d.kategori)} {d.judul}</h3><div className="text-[11px] text-text2">{d.kategori}{d.nomor ? ` · ${d.nomor}` : ''} · v{d.versi} · 👁️ {d.views}</div></div>
          <div className="flex items-center gap-2">
            <button onClick={toggleFav} title="Bookmark" className={`text-lg ${fav ? '' : 'opacity-40'}`}>⭐</button>
            <span className={`text-[10px] px-2 py-1 rounded-full font-semibold ${STATUS[d.status].cls}`}>{STATUS[d.status].label}</span>
          </div>
        </div>
        {d.deskripsi && <div className="text-[12px] text-text2 mb-2">{d.deskripsi}</div>}
        {d.tags && <div className="flex flex-wrap gap-1 mb-2">{d.tags.split(',').map((t) => t.trim()).filter(Boolean).map((t) => <span key={t} className="text-[10px] bg-surface2 text-text2 rounded-full px-2 py-0.5">#{t}</span>)}</div>}
        <div className="grid grid-cols-2 gap-x-4 text-[11px] mb-3">
          <div className="text-text2">Pemilik: <span className="text-text">{d.pemilik || d.creator_name}</span></div>
          <div className="text-text2">Unit: <span className="text-text">{d.unit_kerja || '-'}</span></div>
          <div className="text-text2">Berlaku: <span className="text-text">{d.tanggal_berlaku || '-'}</span></div>
          <div className="text-text2">Review: <span className="text-text">{d.tanggal_review || '-'}</span></div>
        </div>
        <div className="flex flex-wrap gap-2 mb-3">
          {d.file_url && <a href={d.file_url} target="_blank" rel="noreferrer" className="bg-accent2/15 text-accent2 border border-accent2/30 rounded-md px-3 py-1.5 text-xs">⬇️ Download / Preview</a>}
          {d.video_url && <a href={d.video_url} target="_blank" rel="noreferrer" className="border border-border text-text2 rounded-md px-3 py-1.5 text-xs">🎬 Video</a>}
          {d.link_ref && <a href={d.link_ref} target="_blank" rel="noreferrer" className="border border-border text-text2 rounded-md px-3 py-1.5 text-xs">🔗 Referensi</a>}
        </div>

        {/* Riwayat versi */}
        {versions.length > 0 && <div className="border border-border rounded-lg p-3 mb-3"><div className="text-[11px] font-semibold mb-1.5">🕜 Riwayat Versi</div>{versions.map((v) => <div key={v.id} className="flex items-center justify-between text-[11px] py-0.5"><span>v{v.versi} · {v.catatan}</span><span className="text-text2">{v.file_url && <a href={v.file_url} target="_blank" rel="noreferrer" className="text-accent2">file</a>} · {new Date(v.created_at).toLocaleDateString('id-ID')}</span></div>)}</div>}

        {/* Komentar */}
        <div className="border border-border rounded-lg p-3 mb-3">
          <div className="text-[11px] font-semibold mb-1.5">💬 Diskusi & Feedback ({comments.length})</div>
          <div className="space-y-1.5 max-h-[140px] overflow-y-auto mb-2">{comments.map((c) => <div key={c.id} className="text-[11px]"><b>{c.user_name}</b> <span className="text-text2">{new Date(c.created_at).toLocaleString('id-ID', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}</span><div className="text-text2">{c.body}</div></div>)}{!comments.length && <div className="text-[11px] text-text2">Belum ada komentar.</div>}</div>
          <div className="flex gap-1.5"><input value={cmt} onChange={(e) => setCmt(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && addComment()} placeholder="Tulis komentar / saran perbaikan…" className="flex-1 bg-surface2 border border-border rounded-md px-2 py-1.5 text-[11px]" /><button onClick={addComment} className="bg-accent text-bg rounded-md px-2.5 text-[11px]">Kirim</button></div>
        </div>

        {/* Aksi */}
        <div className="flex gap-2 flex-wrap">
          {isManager && NEXT[d.status]?.map((s) => <button key={s} onClick={() => setStatus(s)} className="border border-accent/40 text-accent rounded-md px-3 py-1.5 text-xs">{LBL[s]}</button>)}
          {isManager && <button onClick={() => onEdit(d)} className="border border-border text-text2 rounded-md px-3 py-1.5 text-xs">✏️ Edit</button>}
          {isManager && <button onClick={hapus} className="border border-danger/40 text-danger rounded-md px-3 py-1.5 text-xs ml-auto">🗑️ Hapus</button>}
          <button onClick={onClose} className="border border-border text-text2 rounded-md px-3 py-1.5 text-xs">Tutup</button>
        </div>
      </div>
    </div>
  );
}
