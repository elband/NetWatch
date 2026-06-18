import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import QRCode from 'qrcode';
import { api } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { hasRole } from '../utils/roles';
import type { PengajuanDiklat, DiklatStatus } from '../types';

const LKP_DEFAULT = {
  kantor: 'BANDAR UDARA A.P.T. PRANOTO - SAMARINDA', kota: 'Samarinda',
  koord_jabatan: 'KOORDINATOR UNIT ELEKTRONIKA BANDARA', koord_nama: 'PRAYUDA ELFANDRO', koord_nip: '19930311 202203 1 008',
  nd_yth: 'Kepala Seksi Teknik dan Operasi Penerbangan', nd_dari: 'Koordinator Elektronika Bandara',
};
const STATUS: Record<DiklatStatus, { label: string; cls: string }> = {
  draft: { label: 'Draft', cls: 'bg-border text-text2' },
  diajukan: { label: 'Diajukan', cls: 'bg-warn/15 text-warn' },
  diverifikasi: { label: 'Diverifikasi', cls: 'bg-accent2/15 text-accent2' },
  disetujui: { label: 'Disetujui', cls: 'bg-success/15 text-success' },
  ditolak: { label: 'Ditolak', cls: 'bg-danger/15 text-danger' },
  selesai: { label: 'Selesai', cls: 'bg-[#22c55e]/15 text-[#22c55e]' },
};
const rupiah = (n: number) => 'Rp ' + new Intl.NumberFormat('id-ID').format(n || 0);
const emptyForm = { pegawai_nama: '', nip: '', jabatan: '', unit_kerja: 'Unit Elektronika Bandara', nama_diklat: '', penyelenggara: '', lokasi: '', tanggal_mulai: '', tanggal_selesai: '', durasi: '', biaya: '', tujuan: '', keterangan: '' };

export default function Diklat() {
  const { user } = useAuth();
  const isManager = hasRole(user, 'admin', 'koordinator');
  const [stats, setStats] = useState({ total: 0, menunggu: 0, disetujui: 0, ditolak: 0, selesai: 0, draft: 0 });
  const [rows, setRows] = useState<PengajuanDiklat[]>([]);
  const [lkp, setLkp] = useState(LKP_DEFAULT);
  const [year, setYear] = useState(String(new Date().getFullYear()));
  const [status, setStatus] = useState('');
  const [q, setQ] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [editId, setEditId] = useState<number | null>(null);
  const [detail, setDetail] = useState<PengajuanDiklat | null>(null);
  const years = Array.from({ length: 5 }, (_, i) => String(new Date().getFullYear() - i));
  const [searchParams] = useSearchParams();
  const lastFocus = useRef<string | null>(null);
  // Buka detail otomatis bila diarahkan dari notifikasi (?focus=<id>).
  useEffect(() => {
    const f = searchParams.get('focus');
    if (!f || !rows.length || lastFocus.current === f) return;
    const d = rows.find((x) => String(x.id) === f);
    if (d) { setDetail(d); lastFocus.current = f; }
  }, [rows, searchParams]);

  function load() {
    const p = new URLSearchParams(); if (year) p.set('year', year); if (status) p.set('status', status); if (q) p.set('q', q);
    api.get(`/diklat?${p}`).then((r) => setRows(r.data.diklat)).catch(() => {});
    api.get('/diklat/stats').then((r) => setStats(r.data.stats)).catch(() => {});
  }
  useEffect(() => { const t = setTimeout(load, q ? 300 : 0); return () => clearTimeout(t); }, [year, status, q]);
  useEffect(() => { api.get('/settings').then((r) => { if (r.data.settings?.lkp) setLkp((l) => ({ ...l, ...r.data.settings.lkp })); }).catch(() => {}); }, []);

  async function exportExcel() {
    const p = new URLSearchParams(); if (year) p.set('year', year); if (status) p.set('status', status); if (q) p.set('q', q);
    const res = await api.get(`/diklat/export?${p}`, { responseType: 'blob' });
    const url = URL.createObjectURL(res.data); const a = document.createElement('a'); a.href = url; a.download = `pengajuan-diklat-${year || 'semua'}.xlsx`; a.click(); URL.revokeObjectURL(url);
  }

  const StatCard = ({ label, value, color }: { label: string; value: number; color: string }) => (
    <div className="bg-surface border border-border rounded-xl p-3.5">
      <div className="text-[11px] text-text2">{label}</div>
      <div className="text-[26px] font-extrabold mt-0.5" style={{ color }}>{value}</div>
    </div>
  );

  return (
    <div>
      <div className="flex items-center justify-between mb-4 gap-2 flex-wrap">
        <div className="text-[17px] font-bold">🎓 Pengajuan Diklat</div>
        <div className="flex items-center gap-2">
          {isManager && <button onClick={exportExcel} className="border border-border text-text2 hover:text-white rounded-md px-3 py-1.5 text-xs">⬇️ Export Excel</button>}
          <button onClick={() => { setEditId(null); setShowForm(true); }} className="bg-accent text-bg rounded-md px-3 py-1.5 text-xs font-semibold">+ Ajukan Diklat</button>
        </div>
      </div>

      {/* Dashboard */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 mb-4">
        <StatCard label="Total Pengajuan" value={stats.total} color="#60a5fa" />
        <StatCard label="Menunggu Persetujuan" value={stats.menunggu} color="#eab308" />
        <StatCard label="Disetujui" value={stats.disetujui} color="#22c55e" />
        <StatCard label="Ditolak" value={stats.ditolak} color="#ef4444" />
        <StatCard label="Selesai" value={stats.selesai} color="#14b8a6" />
      </div>

      {/* Filter */}
      <div className="flex items-center gap-2 mb-3 flex-wrap">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="🔍 Cari diklat / pegawai / nomor…" className="bg-surface2 border border-border rounded-md px-3 py-2 text-xs flex-1 min-w-[200px]" />
        <select value={year} onChange={(e) => setYear(e.target.value)} className="bg-surface2 border border-border rounded-md px-3 py-2 text-xs"><option value="">Semua tahun</option>{years.map((y) => <option key={y} value={y}>{y}</option>)}</select>
        <select value={status} onChange={(e) => setStatus(e.target.value)} className="bg-surface2 border border-border rounded-md px-3 py-2 text-xs"><option value="">Semua status</option>{Object.entries(STATUS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}</select>
      </div>

      {/* Tabel */}
      <div className="bg-surface border border-border rounded-[10px] overflow-x-auto">
        <table className="w-full text-xs">
          <thead><tr className="text-text2 uppercase text-[10px] border-b border-border">
            {['No. Pengajuan', 'Tanggal', 'Pegawai', 'Nama Diklat', 'Penyelenggara', 'Periode', 'Biaya', 'Status', 'Aksi'].map((h) => <th key={h} className="px-3 py-2.5 text-left">{h}</th>)}
          </tr></thead>
          <tbody>
            {rows.map((d) => (
              <tr key={d.id} className="border-b border-border/50">
                <td className="px-3 py-2.5 font-mono text-[10px]">{d.nomor_pengajuan}</td>
                <td className="px-3 py-2.5 font-mono text-[10px]">{d.tanggal_pengajuan}</td>
                <td className="px-3 py-2.5">{d.pegawai_nama}</td>
                <td className="px-3 py-2.5 max-w-[220px]"><div className="truncate">{d.nama_diklat}</div></td>
                <td className="px-3 py-2.5 text-text2">{d.penyelenggara || '-'}</td>
                <td className="px-3 py-2.5 font-mono text-[10px]">{d.tanggal_mulai || '-'}{d.tanggal_selesai ? ` → ${d.tanggal_selesai}` : ''}</td>
                <td className="px-3 py-2.5 font-mono text-[11px]">{rupiah(d.biaya)}</td>
                <td className="px-3 py-2.5"><span className={`text-[10px] px-2 py-0.5 rounded-full font-semibold ${STATUS[d.status].cls}`}>{STATUS[d.status].label}</span></td>
                <td className="px-3 py-2.5"><button onClick={() => setDetail(d)} className="border border-border text-text2 hover:text-white rounded px-2 py-0.5 text-[10px]">👁️ Lihat</button></td>
              </tr>
            ))}
            {rows.length === 0 && <tr><td colSpan={9} className="px-3 py-6 text-center text-text2">Belum ada pengajuan diklat.</td></tr>}
          </tbody>
        </table>
      </div>

      {showForm && <DiklatForm lkp={lkp} edit={editId ? rows.find((r) => r.id === editId) || null : null} onClose={() => setShowForm(false)} onSaved={() => { setShowForm(false); load(); }} />}
      {detail && <DiklatDetail id={detail.id} isManager={isManager} userId={user?.id} lkp={lkp} onClose={() => setDetail(null)} onChanged={load} onEdit={(d) => { setDetail(null); setEditId(d.id); setShowForm(true); }} />}
    </div>
  );
}

function Field({ label, children, full }: { label: string; children: React.ReactNode; full?: boolean }) {
  return <div className={full ? 'sm:col-span-2' : ''}><label className="block text-[11px] text-text2 mb-1">{label}</label>{children}</div>;
}
const inp = 'w-full bg-surface2 border border-border rounded-md px-3 py-2 text-xs';

function DiklatForm({ lkp: _lkp, edit, onClose, onSaved }: { lkp: any; edit: PengajuanDiklat | null; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState(edit ? {
    pegawai_nama: edit.pegawai_nama || '', nip: edit.nip || '', jabatan: edit.jabatan || '', unit_kerja: edit.unit_kerja || '', nama_diklat: edit.nama_diklat,
    penyelenggara: edit.penyelenggara || '', lokasi: edit.lokasi || '', tanggal_mulai: edit.tanggal_mulai || '', tanggal_selesai: edit.tanggal_selesai || '', durasi: edit.durasi || '', biaya: String(edit.biaya || ''), tujuan: edit.tujuan || '', keterangan: edit.keterangan || '',
  } : emptyForm);
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const set = (k: string, v: string) => setF((p) => ({ ...p, [k]: v }));

  async function save() {
    if (!f.nama_diklat.trim() || !f.pegawai_nama.trim()) return setErr('Nama pegawai & nama diklat wajib diisi.');
    setBusy(true); setErr('');
    try {
      const fd = new FormData();
      Object.entries(f).forEach(([k, v]) => v && fd.append(k, v));
      if (file) fd.append('file', file);
      if (edit) await api.put(`/diklat/${edit.id}`, fd, { headers: { 'Content-Type': 'multipart/form-data' } });
      else await api.post('/diklat', fd, { headers: { 'Content-Type': 'multipart/form-data' } });
      onSaved();
    } catch (e: any) { setErr(e?.response?.data?.error || 'Gagal menyimpan.'); }
    finally { setBusy(false); }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-surface border border-border rounded-xl w-full max-w-2xl p-5 max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4"><h3 className="text-sm font-bold">🎓 {edit ? 'Edit' : 'Form'} Pengajuan Diklat</h3><button onClick={onClose} className="text-text2 hover:text-white text-lg leading-none">×</button></div>
        <div className="grid sm:grid-cols-2 gap-3">
          <Field label="Nama Pegawai *"><input className={inp} value={f.pegawai_nama} onChange={(e) => set('pegawai_nama', e.target.value)} /></Field>
          <Field label="NIP / NIK"><input className={inp} value={f.nip} onChange={(e) => set('nip', e.target.value)} /></Field>
          <Field label="Jabatan"><input className={inp} value={f.jabatan} onChange={(e) => set('jabatan', e.target.value)} /></Field>
          <Field label="Unit Kerja"><input className={inp} value={f.unit_kerja} onChange={(e) => set('unit_kerja', e.target.value)} /></Field>
          <Field label="Nama Diklat *" full><input className={inp} value={f.nama_diklat} onChange={(e) => set('nama_diklat', e.target.value)} placeholder="mis. Diklat Mikrotik (MTCNA)" /></Field>
          <Field label="Penyelenggara"><input className={inp} value={f.penyelenggara} onChange={(e) => set('penyelenggara', e.target.value)} /></Field>
          <Field label="Lokasi Diklat"><input className={inp} value={f.lokasi} onChange={(e) => set('lokasi', e.target.value)} /></Field>
          <Field label="Tanggal Mulai"><input type="date" className={inp} value={f.tanggal_mulai} onChange={(e) => set('tanggal_mulai', e.target.value)} /></Field>
          <Field label="Tanggal Selesai"><input type="date" className={inp} value={f.tanggal_selesai} onChange={(e) => set('tanggal_selesai', e.target.value)} /></Field>
          <Field label="Durasi"><input className={inp} value={f.durasi} onChange={(e) => set('durasi', e.target.value)} placeholder="mis. 5 hari / 40 JP" /></Field>
          <Field label="Estimasi Biaya (Rp)"><input type="number" className={inp} value={f.biaya} onChange={(e) => set('biaya', e.target.value)} /></Field>
          <Field label="Tujuan & Manfaat Diklat" full><textarea className={`${inp} min-h-[60px]`} value={f.tujuan} onChange={(e) => set('tujuan', e.target.value)} /></Field>
          <Field label="Keterangan Tambahan" full><textarea className={`${inp} min-h-[50px]`} value={f.keterangan} onChange={(e) => set('keterangan', e.target.value)} /></Field>
          <Field label="📎 Dokumen Pendukung (foto/PDF)" full><input type="file" accept="image/*,application/pdf" onChange={(e) => setFile(e.target.files?.[0] || null)} className="w-full text-[11px] text-text2 file:mr-2 file:py-1.5 file:px-3 file:rounded-md file:border-0 file:text-xs file:bg-surface2 file:text-white" /></Field>
        </div>
        {err && <div className="bg-danger/10 border border-danger/30 rounded-md px-3 py-2 text-[11px] text-danger mt-3">⚠️ {err}</div>}
        <div className="flex gap-2 justify-end mt-4">
          <button className="border border-border text-text2 rounded-md px-3 py-1.5 text-xs" onClick={onClose} disabled={busy}>Batal</button>
          <button className="bg-accent text-bg rounded-md px-3 py-1.5 text-xs font-semibold disabled:opacity-50" onClick={save} disabled={busy}>{busy ? 'Menyimpan…' : 'Simpan (Draft)'}</button>
        </div>
      </div>
    </div>
  );
}

function DiklatDetail({ id, isManager, userId, lkp, onClose, onChanged, onEdit }: { id: number; isManager: boolean; userId?: number; lkp: any; onClose: () => void; onChanged: () => void; onEdit: (d: PengajuanDiklat) => void }) {
  const [d, setD] = useState<PengajuanDiklat | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  function load() { api.get(`/diklat/${id}`).then((r) => setD(r.data.diklat)).catch(() => {}); }
  useEffect(load, [id]);

  async function setStatus(next: DiklatStatus, ask?: boolean) {
    let note = '';
    if (ask) { const v = window.prompt(next === 'ditolak' ? 'Alasan penolakan:' : 'Catatan (opsional):'); if (v === null) return; note = v; }
    setBusy(true);
    try { const r = await api.patch(`/diklat/${id}/status`, { status: next, note }); setD(r.data.diklat); onChanged(); }
    catch (e: any) { setMsg(e?.response?.data?.error || 'Gagal.'); setTimeout(() => setMsg(''), 4000); }
    finally { setBusy(false); }
  }
  async function genNota() {
    setBusy(true);
    try { await api.post(`/diklat/${id}/nota-dinas`); load(); onChanged(); setMsg('Nota Dinas dibuat.'); setTimeout(() => setMsg(''), 3000); }
    catch (e: any) { setMsg(e?.response?.data?.error || 'Gagal.'); }
    finally { setBusy(false); }
  }
  async function uploadLaporan(file: File) {
    setBusy(true);
    try {
      const fd = new FormData(); fd.append('laporan', file);
      const r = await api.post(`/diklat/${id}/laporan`, fd, { headers: { 'Content-Type': 'multipart/form-data' } });
      setD(r.data.diklat); onChanged(); setMsg('Laporan diklat berhasil diunggah.'); setTimeout(() => setMsg(''), 3000);
    } catch (e: any) { setMsg(e?.response?.data?.error || 'Gagal mengunggah laporan.'); }
    finally { setBusy(false); }
  }
  async function signNota() {
    if (!d?.nota_dinas_id) return;
    if (!window.confirm('Sahkan Nota Dinas dengan TTE? Tidak bisa dibatalkan.')) return;
    try { await api.post(`/surat/${d.nota_dinas_id}/sign`, { signerName: lkp.koord_nama, signerNip: lkp.koord_nip }); load(); onChanged(); }
    catch (e: any) { setMsg(e?.response?.data?.error || 'Gagal TTE.'); }
  }
  async function hapus() {
    if (!window.confirm('Hapus pengajuan ini?')) return;
    try { await api.delete(`/diklat/${id}`); onChanged(); onClose(); } catch (e: any) { setMsg(e?.response?.data?.error || 'Gagal hapus.'); }
  }

  async function cetakNota() {
    if (!d) return;
    const esc = (t: any) => String(t ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, '<br>');
    const tok = d.nota?.sign_token;
    let qr = ''; if (tok) { try { qr = await QRCode.toDataURL(`${location.origin}/verify-tte?token=${tok}`, { width: 130, margin: 1 }); } catch { qr = ''; } }
    const tgl = new Date(d.tanggal_pengajuan).toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' });
    const w = window.open('', '_blank', 'width=820,height=1040'); if (!w) return;
    w.document.write(`<!doctype html><html><head><title>Nota Dinas ${esc(d.nomor_nota_dinas || '')}</title>
      <style>body{font-family:'Times New Roman',serif;color:#000;max-width:190mm;margin:22mm auto;font-size:13px;line-height:1.6}
      .judul{text-align:center;font-weight:bold;font-size:16px;text-decoration:underline;text-transform:uppercase}.nomor{text-align:center;margin:2px 0 16px}
      table.h td{padding:1px 6px;vertical-align:top}table.h td.l{width:74px}.isi{margin:14px 0;text-align:justify}.ttd{margin-top:28px;width:62%;margin-left:auto;text-align:center}
      table.d{width:100%;border-collapse:collapse;font-size:11px;margin:8px 0}table.d td{border:1px solid #555;padding:3px 6px}</style></head><body>
      <div class="judul">Nota Dinas</div><div class="nomor">Nomor: ${esc(d.nomor_nota_dinas || '(belum dibuat)')}</div>
      <table class="h"><tr><td class="l">Yth</td><td>:</td><td>${esc(lkp.nd_yth)}</td></tr><tr><td class="l">Dari</td><td>:</td><td>${esc(lkp.nd_dari)}</td></tr>
        <tr><td class="l">Hal</td><td>:</td><td><b>Permohonan Pelaksanaan Diklat a.n. ${esc(d.pegawai_nama)}</b></td></tr><tr><td class="l">Tanggal</td><td>:</td><td>${tgl}</td></tr></table>
      <div class="isi">Dengan ini diajukan permohonan pelaksanaan diklat berikut, dan mohon persetujuannya guna proses lebih lanjut:</div>
      <table class="d">
        <tr><td style="width:38%">Nama Pegawai / NIP</td><td>${esc(d.pegawai_nama)} / ${esc(d.nip || '-')}</td></tr>
        <tr><td>Jabatan / Unit</td><td>${esc(d.jabatan || '-')} · ${esc(d.unit_kerja || '-')}</td></tr>
        <tr><td>Nama Diklat</td><td>${esc(d.nama_diklat)}</td></tr>
        <tr><td>Penyelenggara</td><td>${esc(d.penyelenggara || '-')}</td></tr>
        <tr><td>Lokasi</td><td>${esc(d.lokasi || '-')}</td></tr>
        <tr><td>Waktu</td><td>${esc(d.tanggal_mulai || '-')} s/d ${esc(d.tanggal_selesai || '-')} (${esc(d.durasi || '-')})</td></tr>
        <tr><td>Estimasi Biaya</td><td>${rupiah(d.biaya)}</td></tr>
        <tr><td>Tujuan & Manfaat</td><td>${esc(d.tujuan || '-')}</td></tr>
      </table>
      <div class="isi">Demikian disampaikan, atas perhatian dan persetujuannya diucapkan terima kasih.</div>
      <div class="ttd">${esc(lkp.koord_jabatan)}<br>
        ${qr ? `<div style="margin:6px auto;width:120px"><img src="${qr}" style="width:104px;height:104px"><div style="font-size:8px;color:#0a0">✔ Ditandatangani Elektronik (TTE)</div><div style="font-size:8px;color:#444">${esc(tok)}</div></div>` : '<br><br><br>'}
        <u><b>${esc(d.nota?.signer_name || lkp.koord_nama)}</b></u><br>NIP. ${esc(d.nota?.signer_nip || lkp.koord_nip)}</div>
      </body></html>`);
    w.document.close(); w.focus(); setTimeout(() => w.print(), 350);
  }

  if (!d) return null;
  const owner = d.created_by === userId || d.pegawai_id === userId;
  const canEditOwn = (owner || isManager) && ['draft', 'diajukan'].includes(d.status);
  const Row = ({ k, v }: { k: string; v: React.ReactNode }) => <div className="flex gap-2 text-[12px] py-0.5"><div className="text-text2 w-36 shrink-0">{k}</div><div className="flex-1">{v || '-'}</div></div>;

  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-surface border border-border rounded-xl w-full max-w-2xl p-5 max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-3">
          <div><h3 className="text-sm font-bold">🎓 {d.nama_diklat}</h3><div className="text-[11px] text-text2 font-mono">{d.nomor_pengajuan}</div></div>
          <span className={`text-[10px] px-2 py-1 rounded-full font-semibold ${STATUS[d.status].cls}`}>{STATUS[d.status].label}</span>
        </div>
        {msg && <div className="bg-accent2/10 border border-accent2/30 rounded-md px-3 py-2 text-[11px] text-accent2 mb-3">{msg}</div>}

        <div className="border border-border rounded-lg p-3 mb-3">
          <Row k="Pegawai" v={`${d.pegawai_nama} (NIP ${d.nip || '-'})`} />
          <Row k="Jabatan / Unit" v={`${d.jabatan || '-'} · ${d.unit_kerja || '-'}`} />
          <Row k="Penyelenggara" v={d.penyelenggara} />
          <Row k="Lokasi" v={d.lokasi} />
          <Row k="Waktu" v={`${d.tanggal_mulai || '-'} → ${d.tanggal_selesai || '-'} (${d.durasi || '-'})`} />
          <Row k="Estimasi Biaya" v={rupiah(d.biaya)} />
          <Row k="Tujuan & Manfaat" v={d.tujuan} />
          <Row k="Keterangan" v={d.keterangan} />
          <Row k="Dokumen" v={d.file_pendukung ? <a href={d.file_pendukung} target="_blank" rel="noreferrer" className="text-accent2 hover:underline">📎 Lihat dokumen</a> : '-'} />
          <Row k="Nota Dinas" v={d.nomor_nota_dinas ? <>{d.nomor_nota_dinas} {d.nota?.sign_token ? <span className="text-success">🔏 {d.nota.signer_name}</span> : <span className="text-text2">(belum TTE)</span>}</> : <span className="text-text2">belum dibuat</span>} />
          <Row k="Laporan Diklat" v={d.laporan_url ? <a href={d.laporan_url} target="_blank" rel="noreferrer" className="text-accent2 hover:underline">📄 Lihat laporan{d.laporan_at ? ` · ${new Date(d.laporan_at).toLocaleDateString('id-ID')}` : ''}</a> : <span className="text-text2">belum diunggah</span>} />
        </div>

        {/* Upload laporan hasil diklat (setelah disetujui) */}
        {(owner || isManager) && ['disetujui', 'selesai'].includes(d.status) && (
          <div className="border border-accent2/30 bg-accent2/5 rounded-lg p-3 mb-3">
            <div className="text-[11px] text-text2 mb-1.5">📤 {d.laporan_url ? 'Ganti' : 'Upload'} Laporan Hasil Diklat (foto/PDF){d.status === 'disetujui' ? ' — wajib sebelum menandai Selesai' : ''}</div>
            <input type="file" accept="image/*,application/pdf" disabled={busy} onChange={(e) => e.target.files?.[0] && uploadLaporan(e.target.files[0])}
              className="w-full text-[11px] text-text2 file:mr-2 file:py-1.5 file:px-3 file:rounded-md file:border-0 file:text-xs file:bg-surface2 file:text-white file:cursor-pointer" />
          </div>
        )}

        {/* Riwayat persetujuan */}
        <div className="border border-border rounded-lg p-3 mb-3">
          <div className="text-[11px] text-text2 mb-1.5 font-semibold">📜 Riwayat Persetujuan</div>
          {d.history.length === 0 ? <div className="text-[11px] text-text2">-</div> : d.history.map((h) => (
            <div key={h.id} className="flex items-center gap-2 text-[11px] py-0.5">
              <span className="font-mono text-text2 w-32 shrink-0">{new Date(h.created_at).toLocaleString('id-ID', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}</span>
              <span className={`px-1.5 py-0.5 rounded ${STATUS[h.status as DiklatStatus]?.cls || 'bg-surface2'}`}>{STATUS[h.status as DiklatStatus]?.label || h.status}</span>
              <span className="text-text2">{h.user_name}{h.note ? ` — ${h.note}` : ''}</span>
            </div>
          ))}
        </div>

        {/* Aksi workflow */}
        <div className="flex gap-2 flex-wrap">
          {d.status === 'draft' && (owner || isManager) && <button onClick={() => setStatus('diajukan', true)} disabled={busy} className="bg-warn text-bg rounded-md px-3 py-1.5 text-xs font-semibold">📤 Ajukan</button>}
          {d.status === 'diajukan' && isManager && <button onClick={() => setStatus('diverifikasi', true)} disabled={busy} className="bg-accent2 text-bg rounded-md px-3 py-1.5 text-xs font-semibold">✓ Verifikasi</button>}
          {d.status === 'diverifikasi' && isManager && <button onClick={() => setStatus('disetujui', true)} disabled={busy} className="bg-success text-bg rounded-md px-3 py-1.5 text-xs font-semibold">✔ Setujui</button>}
          {['diajukan', 'diverifikasi'].includes(d.status) && isManager && <button onClick={() => setStatus('ditolak', true)} disabled={busy} className="border border-danger/40 text-danger rounded-md px-3 py-1.5 text-xs">✗ Tolak</button>}
          {d.status === 'disetujui' && isManager && <button onClick={() => setStatus('selesai', true)} disabled={busy} className="bg-[#14b8a6] text-bg rounded-md px-3 py-1.5 text-xs font-semibold">🏁 Selesai</button>}
          {isManager && ['diverifikasi', 'disetujui', 'selesai'].includes(d.status) && !d.nomor_nota_dinas && <button onClick={genNota} disabled={busy} className="border border-accent2/50 text-accent2 rounded-md px-3 py-1.5 text-xs">📋 Buat Nota Dinas</button>}
          {isManager && d.nota_dinas_id && !d.nota?.sign_token && <button onClick={signNota} disabled={busy} className="border border-success/40 text-success rounded-md px-3 py-1.5 text-xs">🔏 Sahkan TTE</button>}
          {d.nomor_nota_dinas && <button onClick={cetakNota} className="border border-border text-text2 hover:text-white rounded-md px-3 py-1.5 text-xs">🖨️ Cetak Nota Dinas</button>}
          {canEditOwn && <button onClick={() => onEdit(d)} className="border border-border text-text2 rounded-md px-3 py-1.5 text-xs">✏️ Edit</button>}
          {(isManager || (owner && d.status === 'draft')) && <button onClick={hapus} className="border border-danger/40 text-danger rounded-md px-3 py-1.5 text-xs ml-auto">🗑️ Hapus</button>}
          <button onClick={onClose} className="border border-border text-text2 rounded-md px-3 py-1.5 text-xs">Tutup</button>
        </div>
      </div>
    </div>
  );
}
