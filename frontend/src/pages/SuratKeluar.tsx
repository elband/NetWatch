import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import QRCode from 'qrcode';
import { api } from '../api/client';
import type { Surat } from '../types';
import { buildReportHtml, SECTIONS, type LaporanData, type LkpHead } from '../utils/laporanReport';

const LKP_DEFAULT: LkpHead = {
  kantor: 'BANDAR UDARA A.P.T. PRANOTO - SAMARINDA', kota: 'Samarinda',
  bandara: 'Aji Pangeran Tumenggung Pranoto Samarinda',
  koord_jabatan: 'KOORDINATOR UNIT ELEKTRONIKA BANDARA', koord_nama: 'PRAYUDA ELFANDRO', koord_nip: '19930311 202203 1 008',
  kasie_jabatan: 'KEPALA SEKSI TEKNIK DAN OPERASI', kasie_nama: 'MURDOKO', kasie_nip: '19780319 200012 1 001',
  nd_yth: 'Kepala Seksi Teknik dan Operasi Penerbangan', nd_dari: 'Koordinator Elektronika Bandara',
};
const JENIS = ['Nota Dinas', 'Telaahan Staf', 'Surat Pengantar', 'Surat Lain'];

export default function SuratKeluar() {
  const navigate = useNavigate();
  const [list, setList] = useState<Surat[]>([]);
  const [lkp, setLkp] = useState(LKP_DEFAULT);
  const [filter, setFilter] = useState<'all' | 'tte'>('all');
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ jenis: 'Nota Dinas', hal: '', tujuan: '', body: '' });
  const [files, setFiles] = useState<File[]>([]);
  const [detail, setDetail] = useState<Surat | null>(null);
  const [previewHtml, setPreviewHtml] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');

  // Bangun pratinjau dokumen saat modal detail dibuka / berubah.
  useEffect(() => {
    if (!detail) { setPreviewHtml(''); return; }
    let alive = true;
    setPreviewHtml('');
    buildDocHtml(detail).then((h) => { if (alive) setPreviewHtml(h); }).catch(() => {});
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detail?.id, detail?.sign_token, detail?.kasi_sign_token, detail?.lampiran?.length]);

  function load() {
    api.get('/surat').then((r) => setList(r.data.surat)).catch(() => {});
  }
  useEffect(() => {
    load();
    api.get('/settings').then((r) => { if (r.data.settings?.lkp) setLkp((l) => ({ ...l, ...r.data.settings.lkp })); }).catch(() => {});
  }, []);

  async function create() {
    if (!form.hal.trim()) return setMsg('Hal/perihal wajib diisi.');
    setBusy(true); setMsg('');
    try {
      const fd = new FormData();
      Object.entries(form).forEach(([k, v]) => fd.append(k, v));
      files.forEach((f) => fd.append('files', f));
      await api.post('/surat', fd, { headers: { 'Content-Type': 'multipart/form-data' } });
      setShowForm(false); setForm({ jenis: 'Nota Dinas', hal: '', tujuan: '', body: '' }); setFiles([]);
      load();
    } catch (e: any) { setMsg(e?.response?.data?.error || 'Gagal membuat surat.'); }
    finally { setBusy(false); }
  }
  async function kirimKasi(s: Surat) {
    let phone: string | undefined;
    if (!window.confirm('Kirim permohonan TTD ke Kepala Seksi via WhatsApp?\n(Nomor diambil dari Pengaturan bila sudah diatur.)')) return;
    try {
      const r = await api.post(`/surat/${s.id}/request-kasi`, { baseUrl: location.origin, phone });
      setDetail(r.data.surat); load();
      setMsg(`Permohonan TTD dikirim${r.data.waQueued ? ' via WA' : ''} ke ${r.data.phone}. Tautan: ${r.data.link}`);
    } catch (e: any) {
      const err = e?.response?.data?.error || 'Gagal mengirim.';
      if (/nomor wa/i.test(err)) {
        phone = window.prompt('Nomor WA Kepala Seksi (mis. 0812xxxx):') || undefined;
        if (!phone) return;
        try {
          const r = await api.post(`/surat/${s.id}/request-kasi`, { baseUrl: location.origin, phone });
          setDetail(r.data.surat); load();
          setMsg(`Permohonan TTD dikirim ke ${r.data.phone}. Tautan: ${r.data.link}`);
        } catch (e2: any) { setMsg(e2?.response?.data?.error || 'Gagal mengirim.'); }
      } else setMsg(err);
    }
  }
  async function addLampiran(s: Surat, fl: File[]) {
    if (!fl.length) return;
    try {
      const fd = new FormData();
      fl.forEach((f) => fd.append('files', f));
      const r = await api.post(`/surat/${s.id}/lampiran`, fd, { headers: { 'Content-Type': 'multipart/form-data' } });
      setDetail(r.data.surat); load();
    } catch (e: any) { setMsg(e?.response?.data?.error || 'Gagal menambah lampiran.'); }
  }
  async function delLampiran(s: Surat, lampId: number) {
    if (!window.confirm('Hapus lampiran ini?')) return;
    try {
      await api.delete(`/surat/${s.id}/lampiran/${lampId}`);
      const upd = { ...s, lampiran: (s.lampiran || []).filter((l) => l.id !== lampId) };
      setDetail(upd); load();
    } catch (e: any) { setMsg(e?.response?.data?.error || 'Gagal menghapus lampiran.'); }
  }
  async function hapus(s: Surat) {
    if (!window.confirm(`Hapus surat "${s.nomor}" — ${s.hal}?\nLampiran ikut terhapus. Tindakan ini tidak bisa dibatalkan.`)) return;
    try {
      await api.delete(`/surat/${s.id}`);
      setDetail(null); load();
      setMsg(`Surat ${s.nomor} dihapus.`); setTimeout(() => setMsg(''), 4000);
    } catch (e: any) { setMsg(e?.response?.data?.error || 'Gagal menghapus surat.'); }
  }
  async function sign(s: Surat) {
    if (!window.confirm(`Sahkan "${s.nomor}" dengan TTE? Tidak bisa dibatalkan.`)) return;
    try {
      await api.post(`/surat/${s.id}/sign`, { signerName: lkp.koord_nama, signerNip: lkp.koord_nip });
      setMsg('Surat disahkan (TTE).'); load();
    } catch (e: any) { setMsg(e?.response?.data?.error || 'Gagal mengesahkan.'); }
    setTimeout(() => setMsg(''), 4000);
  }

  // Halaman lampiran bukti dukung (gambar tampil, PDF sebagai tautan).
  function lampiranHtml(s: Surat) {
    const lp = s.lampiran || [];
    if (!lp.length) return '';
    const e = (t: string) => String(t || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const items = lp.map((l, i) => {
      const url = `${location.origin}${l.file_url}`;
      const isImg = (l.mimetype || '').startsWith('image');
      return `<div style="margin:8px 0;page-break-inside:avoid"><div style="font-size:11px;font-weight:bold">${i + 1}. ${e(l.filename || 'Lampiran')}</div>${isImg ? `<img src="${url}" style="max-width:100%;max-height:230px;border:1px solid #999;margin-top:3px">` : `<div style="font-size:10px">📄 Berkas PDF: <a href="${url}">${e(l.filename || url)}</a></div>`}</div>`;
    }).join('');
    return `<div style="page-break-before:always;margin-top:20px"><div style="text-align:center;font-weight:bold;font-size:14px;text-decoration:underline;text-transform:uppercase;margin-bottom:10px">Lampiran Bukti Dukung</div>${items}</div>`;
  }

  // Tentukan periode laporan: dari report_month, atau parse dari teks Hal (cover lama).
  function laporanMonthOf(s: Surat): string | null {
    if (s.report_month) return s.report_month;
    const m = /laporan bulanan.*?\b(januari|februari|maret|april|mei|juni|juli|agustus|september|oktober|november|desember)\s+(\d{4})/i.exec(s.hal || '');
    if (!m) return null;
    const idx = ['januari', 'februari', 'maret', 'april', 'mei', 'juni', 'juli', 'agustus', 'september', 'oktober', 'november', 'desember'].indexOf(m[1].toLowerCase()) + 1;
    return `${m[2]}-${String(idx).padStart(2, '0')}`;
  }

  // Cetak laporan bulanan penuh (semua halaman) bila surat adalah pengantarnya.
  async function cetakLaporanPenuh(s: Surat, month: string) {
    try {
      const { data } = await api.get<LaporanData>('/laporan/bulanan', { params: { month } });
      let qr = '';
      if (s.sign_token) { try { qr = await QRCode.toDataURL(`${location.origin}/verify-tte?token=${s.sign_token}`, { width: 130, margin: 1 }); } catch { qr = ''; } }
      let kasiQr = '';
      if (s.kasi_sign_token) { try { kasiQr = await QRCode.toDataURL(`${location.origin}/verify-tte?token=${s.kasi_sign_token}`, { width: 130, margin: 1 }); } catch { kasiQr = ''; } }
      const cover = { nomor: s.nomor, tanggal: s.tanggal, tujuan: s.tujuan, signer_name: s.signer_name, signer_nip: s.signer_nip, sign_token: s.sign_token, kasi_signer_name: s.kasi_signer_name, kasi_signer_nip: s.kasi_signer_nip, kasi_sign_token: s.kasi_sign_token };
      const html = buildReportHtml(data, cover, qr, lkp, new Set(SECTIONS.map((x) => x.key)), kasiQr);
      const w = window.open('', '_blank', 'width=900,height=1100');
      if (!w) return;
      w.document.write(html); w.document.close(); w.focus(); setTimeout(() => w.print(), 500);
    } catch (e: any) { setMsg(e?.response?.data?.error || 'Gagal menyusun laporan untuk dicetak.'); }
  }

  // HTML dokumen surat tunggal (dipakai untuk cetak & pratinjau iframe).
  function suratHtml(s: Surat, qr: string) {
    const esc = (t: string) => String(t || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, '<br>');
    const tgl = new Date(s.tanggal).toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' });
    const isi = s.body?.trim() || `Dengan ini disampaikan ${s.hal} dan mohon persetujuannya guna proses lebih lanjut.`;
    return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(s.jenis)} ${esc(s.nomor)}</title>
      <style>body{font-family:'Times New Roman',serif;color:#000;background:#fff;max-width:190mm;margin:24mm auto;font-size:13px;line-height:1.6}
      .judul{text-align:center;font-weight:bold;font-size:16px;text-decoration:underline;letter-spacing:1px;text-transform:uppercase}
      .nomor{text-align:center;margin:2px 0 18px} table.head td{padding:1px 6px;vertical-align:top} table.head td.l{width:74px}
      .isi{margin:16px 0;text-align:justify} .ttd{margin-top:30px;width:62%;margin-left:auto;text-align:center}</style></head><body>
      <div class="judul">${esc(s.jenis)}</div>
      <div class="nomor">Nomor: ${esc(s.nomor)}</div>
      <table class="head">
        <tr><td class="l">Yth</td><td>:</td><td>${esc(s.tujuan || lkp.nd_yth)}</td></tr>
        <tr><td class="l">Dari</td><td>:</td><td>${esc(lkp.nd_dari)}</td></tr>
        <tr><td class="l">Hal</td><td>:</td><td><b>${esc(s.hal)}</b></td></tr>
        <tr><td class="l">Tanggal</td><td>:</td><td>${tgl}</td></tr>
      </table>
      <div class="isi">${esc(isi)}</div>
      <div class="isi">Demikian disampaikan, atas perhatiannya diucapkan terima kasih.</div>
      <div class="ttd">${esc(lkp.koord_jabatan)}<br>
        ${qr ? `<div style="margin:6px auto;width:120px"><img src="${qr}" style="width:104px;height:104px"><div style="font-size:8px;color:#0a0">✔ Ditandatangani elektronik</div><div style="font-size:8px;color:#444">${esc(s.sign_token || '')}</div></div>` : '<br><br><br>'}
        <u><b>${esc(s.signer_name || lkp.koord_nama)}</b></u><br>NIP. ${esc(s.signer_nip || lkp.koord_nip)}</div>
      ${lampiranHtml(s)}
      </body></html>`;
  }

  // Bangun HTML dokumen (laporan penuh bila cover laporan bulanan; selain itu surat tunggal). Untuk iframe pratinjau.
  async function buildDocHtml(s: Surat): Promise<string> {
    let qr = '';
    if (s.sign_token) { try { qr = await QRCode.toDataURL(`${location.origin}/verify-tte?token=${s.sign_token}`, { width: 130, margin: 1 }); } catch { qr = ''; } }
    const lm = laporanMonthOf(s);
    if (lm) {
      try {
        const { data } = await api.get<LaporanData>('/laporan/bulanan', { params: { month: lm } });
        let kasiQr = '';
        if (s.kasi_sign_token) { try { kasiQr = await QRCode.toDataURL(`${location.origin}/verify-tte?token=${s.kasi_sign_token}`, { width: 130, margin: 1 }); } catch { kasiQr = ''; } }
        const cover = { nomor: s.nomor, tanggal: s.tanggal, tujuan: s.tujuan, signer_name: s.signer_name, signer_nip: s.signer_nip, sign_token: s.sign_token, kasi_signer_name: s.kasi_signer_name, kasi_signer_nip: s.kasi_signer_nip, kasi_sign_token: s.kasi_sign_token };
        return buildReportHtml(data, cover, qr, lkp, new Set(SECTIONS.map((x) => x.key)), kasiQr);
      } catch { return suratHtml(s, qr); }
    }
    return suratHtml(s, qr);
  }

  async function cetak(s: Surat) {
    const lm = laporanMonthOf(s);
    if (lm) return cetakLaporanPenuh(s, lm);
    let qr = '';
    if (s.sign_token) { try { qr = await QRCode.toDataURL(`${location.origin}/verify-tte?token=${s.sign_token}`, { width: 130, margin: 1 }); } catch { qr = ''; } }
    const w = window.open('', '_blank', 'width=800,height=1000');
    if (!w) return;
    w.document.write(suratHtml(s, qr)); w.document.close(); w.focus(); setTimeout(() => w.print(), 350);
  }

  const rows = filter === 'tte' ? list.filter((s) => s.sign_token) : list;

  return (
    <div>
      <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
        <div className="text-[17px] font-bold">📤 Manajemen Surat Keluar</div>
        <div className="flex items-center gap-2">
          <div className="flex bg-surface2 border border-border rounded-lg p-0.5">
            <button onClick={() => setFilter('all')} className={`px-2.5 py-1 text-[11px] rounded ${filter === 'all' ? 'bg-accent text-bg font-semibold' : 'text-text2'}`}>Semua</button>
            <button onClick={() => setFilter('tte')} className={`px-2.5 py-1 text-[11px] rounded ${filter === 'tte' ? 'bg-accent text-bg font-semibold' : 'text-text2'}`}>Ber-TTE</button>
          </div>
          <button onClick={() => navigate('/laporan-bulanan')} className="border border-accent2/50 text-accent2 rounded-md px-3 py-1.5 text-xs font-semibold">📅 Laporan Bulanan</button>
          <button onClick={() => setShowForm(true)} className="bg-accent text-bg rounded-md px-3 py-1.5 text-xs font-semibold">+ Buat Surat</button>
        </div>
      </div>
      {msg && <div className="bg-accent2/10 border border-accent2/30 rounded-md px-3 py-2 text-[11px] text-accent2 mb-3">{msg}</div>}

      <div className="bg-surface border border-border rounded-[10px] overflow-x-auto">
        <table className="w-full text-xs">
          <thead><tr className="text-text2 uppercase text-[10px] border-b border-border">
            {['Jenis', 'Nomor', 'Hal', 'Tanggal', 'Pembuat', 'TTE', 'Aksi'].map((h) => <th key={h} className="px-3 py-2.5 text-left">{h}</th>)}
          </tr></thead>
          <tbody>
            {rows.map((s) => (
              <tr key={s.id} className="border-b border-border/50">
                <td className="px-3 py-2.5">{s.jenis}{s.incident_id ? <span className="ml-1 text-[9px] text-accent2 font-mono">{s.incident_id}</span> : ''}</td>
                <td className="px-3 py-2.5 font-mono text-[11px]">{s.nomor}</td>
                <td className="px-3 py-2.5 max-w-[260px]"><div className="truncate">{s.hal}{s.lampiran && s.lampiran.length > 0 && <span className="ml-1.5 text-[9px] text-accent2" title={`${s.lampiran.length} lampiran bukti dukung`}>📎{s.lampiran.length}</span>}</div></td>
                <td className="px-3 py-2.5 font-mono text-[10px]">{s.tanggal}</td>
                <td className="px-3 py-2.5 text-text2">{s.creator_name}</td>
                <td className="px-3 py-2.5">{s.sign_token ? <span className="text-[10px] text-success">🔏 {s.signer_name}</span> : <span className="text-[10px] text-text2">—</span>}</td>
                <td className="px-3 py-2.5">
                  <div className="flex gap-1.5 flex-wrap">
                    <button onClick={() => setDetail(s)} className="border border-border text-text2 hover:text-white rounded px-2 py-0.5" title="Lihat detail dokumen">👁️ Lihat</button>
                    {!s.sign_token && <button onClick={() => sign(s)} className="border border-success/40 text-success rounded px-2 py-0.5">🔏 Sahkan</button>}
                    <button onClick={() => cetak(s)} className="border border-border text-text2 hover:text-white rounded px-2 py-0.5">🖨️ Cetak</button>
                    <button onClick={() => hapus(s)} className="border border-danger/40 text-danger hover:bg-danger/10 rounded px-2 py-0.5" title="Hapus surat">🗑️ Hapus</button>
                  </div>
                </td>
              </tr>
            ))}
            {rows.length === 0 && <tr><td colSpan={7} className="px-3 py-6 text-center text-text2">Belum ada surat keluar.</td></tr>}
          </tbody>
        </table>
      </div>

      {showForm && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4" onClick={() => setShowForm(false)}>
          <div className="bg-surface border border-border rounded-xl w-full max-w-md p-5" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4"><h3 className="text-sm font-bold">📤 Buat Surat Keluar</h3><button onClick={() => setShowForm(false)} className="text-text2 hover:text-white text-lg leading-none">×</button></div>
            <label className="block text-[11px] text-text2 mb-1">Jenis Surat</label>
            <select className="w-full bg-surface2 border border-border rounded-md px-3 py-2 text-xs mb-3" value={form.jenis} onChange={(e) => setForm({ ...form, jenis: e.target.value })}>{JENIS.map((j) => <option key={j} value={j}>{j}</option>)}</select>
            <label className="block text-[11px] text-text2 mb-1">Hal / Perihal *</label>
            <input className="w-full bg-surface2 border border-border rounded-md px-3 py-2 text-xs mb-3" value={form.hal} onChange={(e) => setForm({ ...form, hal: e.target.value })} placeholder="mis. Permohonan Persetujuan…" />
            <label className="block text-[11px] text-text2 mb-1">Ditujukan (Yth)</label>
            <input className="w-full bg-surface2 border border-border rounded-md px-3 py-2 text-xs mb-3" value={form.tujuan} onChange={(e) => setForm({ ...form, tujuan: e.target.value })} placeholder={lkp.nd_yth} />
            <label className="block text-[11px] text-text2 mb-1">Isi Surat (opsional)</label>
            <textarea className="w-full bg-surface2 border border-border rounded-md px-3 py-2 text-xs mb-3 min-h-[80px]" value={form.body} onChange={(e) => setForm({ ...form, body: e.target.value })} placeholder="Kosongkan untuk teks standar 'Dengan ini disampaikan [hal]…'" />
            <label className="block text-[11px] text-text2 mb-1">📎 Lampiran Bukti Dukung (gambar/PDF, opsional)</label>
            <input type="file" multiple accept="image/*,application/pdf" onChange={(e) => setFiles(Array.from(e.target.files || []))}
              className="w-full text-[11px] text-text2 mb-2 file:mr-2 file:py-1.5 file:px-3 file:rounded-md file:border-0 file:text-xs file:bg-surface2 file:text-white file:cursor-pointer" />
            {files.length > 0 && (
              <div className="mb-3 space-y-1">
                {files.map((f, i) => (
                  <div key={i} className="flex items-center justify-between bg-surface2 rounded px-2 py-1 text-[10px]">
                    <span className="truncate">{f.name.startsWith('image') || f.type.startsWith('image') ? '🖼️' : '📄'} {f.name}</span>
                    <button type="button" onClick={() => setFiles(files.filter((_, j) => j !== i))} className="text-danger ml-2">✕</button>
                  </div>
                ))}
              </div>
            )}
            {msg && <div className="bg-danger/10 border border-danger/30 rounded-md px-3 py-2 text-[11px] text-danger mb-3">⚠️ {msg}</div>}
            <div className="flex gap-2 justify-end">
              <button className="border border-border text-text2 rounded-md px-3 py-1.5 text-xs" onClick={() => setShowForm(false)} disabled={busy}>Batal</button>
              <button className="bg-accent text-bg rounded-md px-3 py-1.5 text-xs font-semibold disabled:opacity-50" onClick={create} disabled={busy}>{busy ? 'Menyimpan…' : 'Buat & Beri Nomor'}</button>
            </div>
          </div>
        </div>
      )}

      {detail && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4" onClick={() => setDetail(null)}>
          <div className="bg-surface border border-border rounded-xl w-full max-w-4xl p-5 max-h-[90vh] overflow-hidden flex flex-col" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-3 shrink-0">
              <h3 className="text-sm font-bold">👁️ Detail Dokumen</h3>
              <button onClick={() => setDetail(null)} className="text-text2 hover:text-white text-lg leading-none">×</button>
            </div>

            <div className="grid lg:grid-cols-[1fr_360px] gap-4 flex-1 min-h-0 overflow-hidden">
            {/* Pratinjau dokumen (PDF/render) */}
            <div className="bg-[#525659] rounded-lg border border-border overflow-hidden flex flex-col min-h-[300px]">
              <div className="px-3 py-1.5 text-[10px] text-white/70 border-b border-black/20 flex items-center justify-between">
                <span>📄 Pratinjau Dokumen</span>
                <button onClick={() => cetak(detail)} className="text-white/80 hover:text-white">🖨️ Cetak / PDF</button>
              </div>
              {previewHtml
                ? <iframe title="preview" srcDoc={previewHtml} className="flex-1 w-full bg-white" />
                : <div className="flex-1 flex items-center justify-center text-white/50 text-xs">Memuat dokumen…</div>}
            </div>

            <div className="space-y-2 text-xs overflow-y-auto pr-1">
              <Row label="Jenis" value={detail.jenis} />
              <Row label="Nomor" value={detail.nomor} mono />
              <Row label="Hal / Perihal" value={detail.hal} />
              <Row label="Ditujukan (Yth)" value={detail.tujuan || lkp.nd_yth} />
              <Row label="Tanggal" value={new Date(detail.tanggal).toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' })} />
              <Row label="Pembuat" value={detail.creator_name || '-'} />
              {detail.incident_id && <Row label="Terkait Insiden" value={detail.incident_id} mono />}
              {detail.body && (
                <div>
                  <div className="text-text2 mb-1">Isi Surat</div>
                  <div className="bg-surface2 border border-border rounded-md p-2.5 whitespace-pre-wrap leading-relaxed">{detail.body}</div>
                </div>
              )}

              <div className="border-t border-border pt-2 mt-2">
                <div className="text-text2 mb-1">Status Tanda Tangan Elektronik (TTE)</div>
                {detail.sign_token ? (
                  <div className="bg-success/10 border border-success/30 rounded-md p-2.5">
                    <div className="text-success font-semibold">🔏 Sudah disahkan</div>
                    <div className="mt-1">Penandatangan: <b>{detail.signer_name}</b>{detail.signer_nip ? ` (NIP. ${detail.signer_nip})` : ''}</div>
                    {detail.signed_at && <div>Waktu: {new Date(detail.signed_at).toLocaleString('id-ID')}</div>}
                    <div className="font-mono text-[10px] text-text2 mt-1 break-all">Token: {detail.sign_token}</div>
                    <a href={`/verify-tte?token=${detail.sign_token}`} target="_blank" rel="noreferrer" className="inline-block mt-1 text-accent2 hover:underline">🔗 Verifikasi publik</a>
                  </div>
                ) : (
                  <div className="text-text2">— Belum di-TTE</div>
                )}
              </div>

              <div className="border-t border-border pt-2 mt-2">
                <div className="flex items-center justify-between mb-1">
                  <div className="text-text2">🖊️ Persetujuan Kepala Seksi</div>
                  <button onClick={() => kirimKasi(detail)} className="text-[10px] text-accent2 hover:underline">📲 Kirim ke Kasi (WA)</button>
                </div>
                {detail.kasi_status === 'disetujui' ? (
                  <div className="bg-success/10 border border-success/30 rounded-md p-2.5 text-[11px]">
                    <div className="text-success font-semibold">🔏 Disetujui & ditandatangani</div>
                    <div className="mt-0.5">{detail.kasi_signer_name}{detail.kasi_signer_nip ? ` · NIP ${detail.kasi_signer_nip}` : ''}</div>
                    {detail.kasi_signed_at && <div className="text-text2">{new Date(detail.kasi_signed_at).toLocaleString('id-ID')}</div>}
                    {detail.kasi_sign_token && <a href={`/verify-tte?token=${detail.kasi_sign_token}`} target="_blank" rel="noreferrer" className="text-accent2 hover:underline">🔗 Verifikasi</a>}
                  </div>
                ) : detail.kasi_status === 'ditolak' ? (
                  <div className="bg-danger/10 border border-danger/30 rounded-md p-2.5 text-[11px] text-danger">🚫 Ditolak Kepala Seksi{detail.kasi_note ? ` — ${detail.kasi_note}` : ''}</div>
                ) : detail.kasi_status === 'menunggu' ? (
                  <div className="bg-warn/10 border border-warn/30 rounded-md p-2.5 text-[11px] text-warn">⏳ Menunggu tanda tangan Kepala Seksi (tautan WA terkirim).</div>
                ) : (
                  <div className="text-text2 text-[11px]">— Belum diminta. Klik "Kirim ke Kasi (WA)" untuk meminta tanda tangan.</div>
                )}
              </div>

              <div className="border-t border-border pt-2 mt-2">
                <div className="flex items-center justify-between mb-1.5">
                  <div className="text-text2">📎 Lampiran Bukti Dukung ({detail.lampiran?.length || 0})</div>
                  <label className="text-[10px] text-accent2 hover:underline cursor-pointer">
                    + Tambah
                    <input type="file" multiple accept="image/*,application/pdf" className="hidden" onChange={(e) => addLampiran(detail, Array.from(e.target.files || []))} />
                  </label>
                </div>
                {detail.lampiran && detail.lampiran.length > 0 ? (
                  <div className="grid grid-cols-2 gap-2">
                    {detail.lampiran.map((l) => {
                      const isImg = (l.mimetype || '').startsWith('image');
                      return (
                        <div key={l.id} className="border border-border rounded-md overflow-hidden bg-surface2">
                          <a href={`${l.file_url}`} target="_blank" rel="noreferrer" className="block">
                            {isImg
                              ? <img src={l.file_url} alt={l.filename || ''} className="w-full h-24 object-cover" />
                              : <div className="h-24 flex items-center justify-center text-2xl">📄</div>}
                          </a>
                          <div className="flex items-center justify-between px-2 py-1 gap-1">
                            <span className="text-[10px] truncate" title={l.filename || ''}>{l.filename || 'Lampiran'}</span>
                            <button onClick={() => delLampiran(detail, l.id)} className="text-danger text-[10px] shrink-0" title="Hapus">✕</button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ) : <div className="text-text2 text-[11px]">Belum ada lampiran.</div>}
              </div>
            </div>
            </div>

            <div className="flex gap-2 justify-end mt-3 shrink-0 flex-wrap">
              <button onClick={() => hapus(detail)} className="border border-danger/40 text-danger hover:bg-danger/10 rounded-md px-3 py-1.5 text-xs mr-auto">🗑️ Hapus</button>
              {!detail.sign_token && <button onClick={() => { sign(detail); setDetail(null); }} className="border border-success/40 text-success rounded-md px-3 py-1.5 text-xs">🔏 Sahkan</button>}
              <button onClick={() => cetak(detail)} className="bg-accent text-bg rounded-md px-3 py-1.5 text-xs font-semibold">🖨️ Cetak</button>
              <button onClick={() => setDetail(null)} className="border border-border text-text2 rounded-md px-3 py-1.5 text-xs">Tutup</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex gap-2">
      <div className="text-text2 w-32 shrink-0">{label}</div>
      <div className={`flex-1 ${mono ? 'font-mono' : ''}`}>{value}</div>
    </div>
  );
}
