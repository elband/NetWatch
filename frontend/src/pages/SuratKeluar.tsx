import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import QRCode from 'qrcode';
import { api } from '../api/client';
import type { Surat, Incident } from '../types';
import { buildReportHtml, SECTIONS, type LaporanData, type LkpHead } from '../utils/laporanReport';

const LKP_DEFAULT: LkpHead = {
  kantor: 'BANDAR UDARA A.P.T. PRANOTO - SAMARINDA', kota: 'Samarinda',
  bandara: 'Aji Pangeran Tumenggung Pranoto Samarinda',
  koord_jabatan: 'KOORDINATOR UNIT ELEKTRONIKA BANDARA', koord_nama: 'PRAYUDA ELFANDRO', koord_nip: '19930311 202203 1 008',
  kasie_jabatan: 'KEPALA SEKSI TEKNIK DAN OPERASI', kasie_nama: 'MURDOKO', kasie_nip: '19780319 200012 1 001',
  nd_yth: 'Kepala Seksi Teknik dan Operasi Penerbangan', nd_dari: 'Koordinator Elektronika Bandara',
};
const JENIS = ['Nota Dinas', 'Telaahan Staf', 'Surat Pengantar', 'Surat Pernyataan', 'Surat Lain'];

interface SplFormData {
  kasi_nama: string; kasi_nip: string; kasi_golongan: string; kasi_jabatan: string;
  tanggal_kegiatan: string; hari_kegiatan: string; kegiatan: string;
  durasi_jam: string;
  dasar: string; tujuan_kegiatan: string; hasil: string;
}
interface SplPegawaiRow { user_id?: number; nama: string; nip: string; mulai: string; selesai: string; pelaksana_token?: string; signed_at?: string; sign_token?: string; }
interface SplUser { id: number; name: string; nip: string | null; emoji: string | null; jabatan: string | null; }

function numToId(n: number): string {
  const w = ['Nol','Satu','Dua','Tiga','Empat','Lima','Enam','Tujuh','Delapan','Sembilan','Sepuluh','Sebelas','Dua Belas'];
  return w[n] ?? String(n);
}

export default function SuratKeluar() {
  const navigate = useNavigate();
  const [list, setList] = useState<Surat[]>([]);
  const [lkp, setLkp] = useState(LKP_DEFAULT);
  const [filter, setFilter] = useState<'all' | 'tte'>('all');
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ jenis: 'Nota Dinas', hal: '', tujuan: '', body: '', incident_id: '' });
  const [linkIncInput, setLinkIncInput] = useState('');
  const [linkIncBusy, setLinkIncBusy] = useState(false);
  const [linkIncMsg, setLinkIncMsg] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [detail, setDetail] = useState<Surat | null>(null);
  const [previewHtml, setPreviewHtml] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [splData, setSplData] = useState<SplFormData>({ kasi_nama:'', kasi_nip:'', kasi_golongan:'Pembina (IV/a)', kasi_jabatan:'Kepala Seksi Teknik dan Operasi', tanggal_kegiatan:'', hari_kegiatan:'Jumat', kegiatan:'', durasi_jam:'5', dasar:'', tujuan_kegiatan:'', hasil:'' });
  const [splPegawai, setSplPegawai] = useState<SplPegawaiRow[]>([{ nama:'', nip:'', mulai:'18:00', selesai:'23:00' }]);
  const [splUsers, setSplUsers] = useState<SplUser[]>([]);
  const [showKop, setShowKop] = useState(false);
  const [kopBusy, setKopBusy] = useState(false);
  const kopInputRef = useRef<HTMLInputElement>(null);
  const ZOOM_STEPS = [0.5, 0.6, 0.7, 0.75, 0.8, 0.85, 0.9, 1.0, 1.1, 1.25, 1.5, 1.75, 2.0];
  const [zoomIdx, setZoomIdx] = useState(5); // default 0.85

  // Bangun pratinjau dokumen saat modal detail dibuka / berubah.
  useEffect(() => {
    if (!detail) { setPreviewHtml(''); return; }
    let alive = true;
    setPreviewHtml('');
    buildDocHtml(detail).then((h) => { if (alive) setPreviewHtml(h); }).catch(() => {});
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detail?.id, detail?.sign_token, detail?.kasi_sign_token, detail?.lampiran?.length]);

  // Sinkronkan input tautan insiden saat modal detail dibuka.
  useEffect(() => {
    if (detail) { setLinkIncInput(detail.incident_id || ''); setLinkIncMsg(''); }
  }, [detail?.id]);

  function load() {
    api.get('/surat').then((r) => setList(r.data.surat)).catch(() => {});
  }
  useEffect(() => {
    load();
    api.get('/settings').then((r) => { if (r.data.settings?.lkp) setLkp((l) => ({ ...l, ...r.data.settings.lkp })); }).catch(() => {});
    api.get('/surat/users').then((r) => setSplUsers(r.data.users || [])).catch(() => {});
  }, []);

  const iframeRef = useRef<HTMLIFrameElement>(null);
  const autoPrintRef = useRef(false);

  function printFromIframe() {
    const win = iframeRef.current?.contentWindow;
    if (!win) return;
    win.focus();
    win.print();
  }

  function applyZoom(z: number) {
    const body = iframeRef.current?.contentDocument?.body;
    if (body) body.style.zoom = String(z);
  }

  function zoomIn() {
    const next = Math.min(zoomIdx + 1, ZOOM_STEPS.length - 1);
    setZoomIdx(next);
    applyZoom(ZOOM_STEPS[next]);
  }

  function zoomOut() {
    const prev = Math.max(zoomIdx - 1, 0);
    setZoomIdx(prev);
    applyZoom(ZOOM_STEPS[prev]);
  }

  function defaultSplData(): SplFormData {
    return { kasi_nama: lkp.kasie_nama || '', kasi_nip: lkp.kasie_nip || '', kasi_golongan: 'Pembina (IV/a)', kasi_jabatan: lkp.kasie_jabatan || 'Kepala Seksi Teknik dan Operasi', tanggal_kegiatan: '', hari_kegiatan: 'Jumat', kegiatan: '', durasi_jam: '5', dasar: 'Pengaduan Penumpang\nPerintah Lisan Kepala Seksi', tujuan_kegiatan: '', hasil: '' };
  }

  async function openInWindow(s: Surat, autoPrint = false) {
    setBusy(true);
    try {
      const html = await buildDocHtml(s);
      const win = window.open('', '_blank');
      if (!win) {
        setMsg('Pop-up diblokir browser. Izinkan pop-up untuk halaman ini lalu coba lagi.');
        return;
      }
      win.document.open();
      win.document.write(html);
      win.document.close();
      if (autoPrint) {
        setTimeout(() => { try { win.focus(); win.print(); } catch { /**/ } }, 700);
      }
    } catch {
      setMsg('Gagal memuat dokumen. Coba lagi.');
    } finally {
      setBusy(false);
    }
  }

  async function create() {
    if (!form.hal.trim()) return setMsg('Hal/perihal wajib diisi.');
    setBusy(true); setMsg('');
    try {
      const fd = new FormData();
      Object.entries(form).forEach(([k, v]) => { if (v) fd.append(k, v); });
      if (form.jenis === 'Surat Pernyataan') {
        // Buang baris pegawai yang belum dipilih (nama kosong) agar tidak jadi penanda-tangan hantu.
        const pegawaiValid = splPegawai.filter((p) => p.nama.trim());
        if (!pegawaiValid.length) { setBusy(false); return setMsg('Pilih minimal satu pegawai pelaksana lembur.'); }
        fd.set('body', JSON.stringify({ type: 'spl', ...splData, pegawai: pegawaiValid }));
      }
      files.forEach((f) => fd.append('files', f));
      await api.post('/surat', fd, { headers: { 'Content-Type': 'multipart/form-data' } });
      setShowForm(false);
      setForm({ jenis: 'Nota Dinas', hal: '', tujuan: '', body: '', incident_id: '' });
      setSplData(defaultSplData());
      setSplPegawai([{ nama: '', nip: '', mulai: '18:00', selesai: '23:00' }]);
      setFiles([]);
      load();
    } catch (e: any) { setMsg(e?.response?.data?.error || 'Gagal membuat surat.'); }
    finally { setBusy(false); }
  }

  async function saveIncidentLink(s: Surat, incId: string) {
    setLinkIncBusy(true); setLinkIncMsg('');
    try {
      const r = await api.patch(`/surat/${s.id}/incident`, { incident_id: incId.trim() || null });
      setDetail(r.data.surat);
      load();
      setLinkIncMsg(incId.trim() ? `✓ Terhubung ke ${incId.trim()} — klik Lihat/Cetak untuk dokumen lengkap.` : '✓ Tautan insiden dihapus.');
    } catch (e: any) { setLinkIncMsg('⚠️ ' + (e?.response?.data?.error || 'Gagal menyimpan.')); }
    finally { setLinkIncBusy(false); }
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
  async function notifyPelaksana(s: Surat) {
    if (!window.confirm('Kirim notifikasi tanda tangan ke semua pelaksana lembur? Link unik akan dibuat untuk setiap pegawai.')) return;
    try {
      const r = await api.post(`/surat/${s.id}/notify-pelaksana`, { baseUrl: location.origin });
      setDetail(r.data.surat); load();
      const links = (r.data.links as { nama: string; token: string; link: string }[]) || [];
      setMsg(`Notifikasi terkirim ke ${links.length} pelaksana. Link TTD dibuat.`);
    } catch (e: any) { setMsg(e?.response?.data?.error || 'Gagal mengirim notifikasi.'); }
  }

  // Unggah gambar kop/letterhead → tersimpan di settings.lkp.kop_url, dipakai saat generate dokumen.
  async function uploadKop(file: File | undefined) {
    if (!file) return;
    if (!file.type.startsWith('image/')) { setMsg('Kop harus berupa gambar (JPG/PNG/WebP/GIF).'); return; }
    setKopBusy(true);
    try {
      const fd = new FormData();
      fd.append('kop', file);
      const r = await api.post('/surat/kop', fd, { headers: { 'Content-Type': 'multipart/form-data' } });
      setLkp((l) => ({ ...l, kop_url: r.data.kop_url }));
      setMsg('Kop surat berhasil diunggah.');
    } catch (e: any) { setMsg(e?.response?.data?.error || 'Gagal mengunggah kop.'); }
    finally { setKopBusy(false); if (kopInputRef.current) kopInputRef.current.value = ''; }
  }
  async function removeKop() {
    if (!window.confirm('Hapus kop surat? Dokumen akan digenerate tanpa header sampai kop baru diunggah.')) return;
    setKopBusy(true);
    try {
      await api.delete('/surat/kop');
      setLkp((l) => { const n = { ...l }; delete n.kop_url; return n; });
      setMsg('Kop surat dihapus.');
    } catch (e: any) { setMsg(e?.response?.data?.error || 'Gagal menghapus kop.'); }
    finally { setKopBusy(false); }
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

  // Render Surat Pernyataan Lembur: 3 halaman (SPL + Dokumentasi + Laporan Hasil).
  function suratPernyataanHtml(s: Surat, kasiQr = '', pelaksanaQr: Record<string, string> = {}): string {
    const esc = (v: unknown) => String(v ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
    let d: Record<string, unknown> = {};
    try { d = JSON.parse(s.body || '{}'); } catch {}
    const kasNama = String(d.kasi_nama || s.kasi_signer_name || lkp.kasie_nama || '');
    const kasNip  = String(d.kasi_nip  || s.kasi_signer_nip  || lkp.kasie_nip  || '');
    const kasGol  = String(d.kasi_golongan || '');
    const kasJab  = String(d.kasi_jabatan  || lkp.kasie_jabatan || 'Kepala Seksi Teknik dan Operasi');
    const tglKeg  = String(d.tanggal_kegiatan || '');
    const hariKeg = String(d.hari_kegiatan   || '');
    const kegiatan= String(d.kegiatan || '');
    const durasi  = String(d.durasi_jam || '5');
    const dasarList   = String(d.dasar || '').split('\n').map(x=>x.trim()).filter(Boolean);
    const tujuanList  = String(d.tujuan_kegiatan || '').split('\n').map(x=>x.trim()).filter(Boolean);
    const hasilList   = String(d.hasil || '').split('\n').map(x=>x.trim()).filter(Boolean);
    // Hanya pegawai yang benar-benar dipilih (punya nama) yang ditampilkan/dihitung.
    const pegawai = (Array.isArray(d.pegawai) ? d.pegawai : []).filter((p: SplPegawaiRow) => (p?.nama || '').trim()) as SplPegawaiRow[];
    const dmy = (v: string) => { if (!v) return '-'; const dt = new Date(v.replace(' ','T')); return isNaN(dt.getTime()) ? v : dt.toLocaleDateString('id-ID',{day:'numeric',month:'long',year:'numeric'}); };
    const tglSurat = dmy(s.tanggal);
    const tglKegStr= dmy(tglKeg);
    const kota = lkp.kota || 'Samarinda';

    const kasiTtdBlock = kasiQr && s.kasi_status === 'disetujui'
      ? `<div style="margin:4px auto;width:110px"><img src="${kasiQr}" style="width:100px;height:100px"><div style="font-size:8px;color:#0a0">✔ Ditandatangani elektronik</div><div style="font-size:7px;color:#666">Token: ${esc(s.kasi_sign_token||'')}</div></div>`
      : '<div style="height:70px"></div>';

    // Kop/letterhead: pakai gambar yang diunggah (Pengaturan Kop di halaman Surat Keluar).
    // Bila belum ada, dokumen digenerate tanpa header (sesuai permintaan).
    const kopUrl = lkp.kop_url ? `${location.origin}${lkp.kop_url}` : '';
    const kop = kopUrl
      ? `<img src="${kopUrl}" alt="Kop Surat" style="display:block;width:100%;margin:0 auto 22px">`
      : '<div style="margin-bottom:22px"></div>';


    const page1 = `<div class="page" style="page-break-after:always;font-family:'Times New Roman',serif;color:#000;width:190mm;padding:18mm 20mm;margin:0 auto;font-size:13px;line-height:1.6">
      ${kop}
      <div style="text-align:center;margin-bottom:4px"><u><b>SURAT PERNYATAAN</b></u></div>
      <div style="text-align:center;margin-bottom:20px">Nomor : ${esc(s.nomor)}</div>
      <table style="border-collapse:collapse;margin-bottom:16px">
        <tr><td style="width:90px;padding:1px 0">Nama</td><td style="padding:1px 6px">:</td><td>${esc(kasNama)}</td></tr>
        <tr><td style="padding:1px 0">NIP</td><td style="padding:1px 6px">:</td><td>${esc(kasNip)}</td></tr>
        <tr><td style="padding:1px 0">Golongan</td><td style="padding:1px 6px">:</td><td>${esc(kasGol)}</td></tr>
        <tr><td style="padding:1px 0">Jabatan</td><td style="padding:1px 6px">:</td><td>${esc(kasJab)}</td></tr>
      </table>
      <p style="margin-bottom:8px">Dengan ini menyatakan bahwa :</p>
      <ol style="padding-left:24px">
        <li style="margin-bottom:10px;text-align:justify">Telah dilaksanakan pekerjaan lembur kegiatan ${esc(kegiatan)} setelah jam operasional bandara pada hari ${esc(hariKeg)}, tanggal ${tglKegStr} pada Unit Elektronika Bandara selama ${esc(durasi)} (${numToId(Number(durasi))}) jam sebanyak ${pegawai.length} orang.</li>
        <li style="margin-bottom:10px">Pegawai yang melaksanakan kegiatan lembur sebagai berikut :
          <table style="border-collapse:collapse;width:100%;margin-top:8px;font-size:12px">
            <tr><th style="border:1px solid #000;padding:4px 8px;text-align:center;background:#f5f5f5" rowspan="2">No.</th><th style="border:1px solid #000;padding:4px 8px;text-align:center;background:#f5f5f5" rowspan="2">Nama</th><th style="border:1px solid #000;padding:4px 8px;text-align:center;background:#f5f5f5" rowspan="2">NIP</th><th style="border:1px solid #000;padding:4px 8px;text-align:center;background:#f5f5f5" colspan="2">Jam Lembur (WITA)</th></tr>
            <tr><th style="border:1px solid #000;padding:4px 8px;text-align:center;background:#f5f5f5">Mulai</th><th style="border:1px solid #000;padding:4px 8px;text-align:center;background:#f5f5f5">Selesai</th></tr>
            ${pegawai.map((p,i)=>`<tr><td style="border:1px solid #000;padding:3px 8px;text-align:center">${i+1}.</td><td style="border:1px solid #000;padding:3px 8px">${esc(p.nama)}</td><td style="border:1px solid #000;padding:3px 8px;text-align:center">${esc(p.nip||'-')}</td><td style="border:1px solid #000;padding:3px 8px;text-align:center">${esc(p.mulai)}</td><td style="border:1px solid #000;padding:3px 8px;text-align:center">${esc(p.selesai)}</td></tr>`).join('')}
          </table>
        </li>
        <li>Dokumentasi dan data dukung terlampir.<br>
          <p style="margin:8px 0;text-align:justify">Demikian pernyataan ini dibuat dengan sesungguhnya untuk dipergunakan sebagai dasar pemberian uang lembur pegawai bersangkutan.</p>
        </li>
      </ol>
      <div style="text-align:right;margin-top:20px">
        <div>${esc(kota)}, ${tglSurat}</div>
        <div>${esc(kasJab)}</div>
        ${kasiTtdBlock}
        <div><u><b>${esc(kasNama)}</b></u></div>
        <div>NIP. ${esc(kasNip)}</div>
      </div>
    </div>`;

    const lampiranImgs = (s.lampiran||[]).filter(l=>(l.mimetype||'').startsWith('image'));
    const lampiranPdfs = (s.lampiran||[]).filter(l=>l.mimetype==='application/pdf');
    const docGrid = lampiranImgs.length
      ? `<div style="display:grid;grid-template-columns:repeat(${Math.min(lampiranImgs.length,3)},1fr);gap:10px;margin-top:24px">${lampiranImgs.slice(0,9).map(l=>`<div style="text-align:center"><img src="${location.origin}${l.file_url}" style="max-width:100%;max-height:200px;border:1px solid #ccc;object-fit:cover"></div>`).join('')}</div>`
      : '<p style="text-align:center;color:#888;margin-top:40px;font-style:italic">[Foto dokumentasi kegiatan — tambahkan via Lampiran Bukti Dukung]</p>';

    const page2 = `<div class="page" style="page-break-after:always;font-family:'Times New Roman',serif;color:#000;width:190mm;padding:18mm 20mm;margin:0 auto">
      ${kop}
      <div style="text-align:center;font-size:14px;font-weight:bold;text-decoration:underline;margin:20px 0">DOKUMENTASI KEGIATAN</div>
      ${docGrid}
      ${lampiranPdfs.map(l=>`<div style="margin-top:8px;font-size:11px">📄 <a href="${location.origin}${l.file_url}">${esc(l.filename||'Lampiran PDF')}</a></div>`).join('')}
    </div>`;

    const page3 = `<div class="page" style="font-family:'Times New Roman',serif;color:#000;width:190mm;padding:18mm 20mm;margin:0 auto">
      ${kop}
      <div style="text-align:center;font-size:14px;font-weight:bold;text-decoration:underline;margin-bottom:24px">LAPORAN HASIL KEGIATAN LEMBUR</div>
      <div style="font-size:13px;line-height:1.8">
        <p style="font-weight:bold;margin-bottom:4px">A. DASAR</p>
        <ol style="margin:0 0 14px;padding-left:28px">${dasarList.map(x=>`<li style="text-align:justify">${esc(x)}</li>`).join('')||'<li>-</li>'}</ol>
        <p style="font-weight:bold;margin-bottom:4px">B. MAKSUD DAN TUJUAN</p>
        <ol style="margin:0 0 14px;padding-left:28px">${tujuanList.map(x=>`<li style="text-align:justify">${esc(x)}</li>`).join('')||'<li>-</li>'}</ol>
        <p style="font-weight:bold;margin-bottom:4px">C. HASIL YANG DICAPAI</p>
        <p style="margin:0 0 6px">Kegiatan dengan rincian sebagai berikut :</p>
        <ol style="margin:0 0 14px;padding-left:28px">${hasilList.map(x=>`<li style="text-align:justify">${esc(x)}</li>`).join('')||'<li>-</li>'}</ol>
      </div>
      <div style="text-align:right;margin-top:16px;font-size:13px">${esc(kota)}, ${tglSurat}</div>
      <table style="width:100%;margin-top:8px;font-size:12.5px;border-collapse:collapse">
        <tr>
          <td style="width:36%;text-align:center;vertical-align:top;padding:4px 8px">
            Mengetahui,<br><b>${esc(kasJab)}</b>
            ${kasiTtdBlock}
            <u><b>${esc(kasNama)}</b></u><br>NIP. ${esc(kasNip)}
          </td>
          <td style="text-align:center;vertical-align:top;padding:4px 8px">
            Pelaksana Kegiatan
            <div style="display:flex;flex-wrap:wrap;margin-top:4px">
              ${pegawai.map(p => {
                const qr = p.sign_token ? pelaksanaQr[p.sign_token] : '';
                const mark = p.sign_token
                  ? `${qr ? `<img src="${qr}" style="width:64px;height:64px;display:block;margin:2px auto 0">` : '<div style="height:8px"></div>'}<div style="font-size:9px;color:#0a7d27;font-weight:bold">✔ Ditandatangani elektronik</div>${p.signed_at ? `<div style="font-size:8px;color:#666">${dmy(p.signed_at)}</div>` : ''}`
                  : '<div style="height:64px"></div>';
                const nama = p.sign_token ? `<u><b>${esc(p.nama)}</b></u>` : `<b>${esc(p.nama)}</b>`;
                const tok = p.sign_token ? `<div style="font-size:7px;color:#888">Token: ${esc(p.sign_token)}</div>` : '';
                return `<div style="width:50%;text-align:center;margin-top:16px">${mark}${nama}${p.nip ? `<br>NIP. ${esc(p.nip)}` : ''}${tok}</div>`;
              }).join('')}
            </div>
          </td>
        </tr>
      </table>
    </div>`;

    return `<!doctype html><html><head><meta charset="utf-8"><title>Surat Pernyataan ${esc(s.nomor)}</title>
    <style>* { box-sizing:border-box;margin:0;padding:0 } body { background:#fff } .page { background:#fff } @media print { .page { page-break-after:always } }</style>
    </head><body>${page1}${page2}${page3}</body></html>`;
  }

  // Tentukan periode laporan: dari report_month, atau parse dari teks Hal (cover lama).
  function laporanMonthOf(s: Surat): string | null {
    if (s.report_month) return s.report_month;
    const m = /laporan bulanan.*?\b(januari|februari|maret|april|mei|juni|juli|agustus|september|oktober|november|desember)\s+(\d{4})/i.exec(s.hal || '');
    if (!m) return null;
    const idx = ['januari', 'februari', 'maret', 'april', 'mei', 'juni', 'juli', 'agustus', 'september', 'oktober', 'november', 'desember'].indexOf(m[1].toLowerCase()) + 1;
    return `${m[2]}-${String(idx).padStart(2, '0')}`;
  }

  // HTML dokumen surat tunggal (dipakai untuk pratinjau iframe).
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

  // Gabungkan Nota Dinas (hal.1) + LKP form (hal.2) + Lampiran (hal.3) dalam 1 HTML.
  function buildCombinedIncidentDoc(s: Surat, notaQr: string, inc: Incident, lkpQr: string, kasiQr = ''): string {
    const report = inc.report;
    const cfg = lkp as unknown as Record<string, string>;
    const esc = (v: unknown) => String(v || '-').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, '<br>');
    const dt = (v?: string | null) => (v ? new Date(v.replace(' ', 'T')) : null);
    const dmy = (v?: string | null) => { const d = dt(v); return d ? d.toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' }) : '-'; };
    const dshort = (v?: string | null) => { const d = dt(v); return d ? `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}` : '-'; };
    const jam = (v?: string | null) => { const d = dt(v); return d ? d.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }) : '-'; };
    const tgl = inc.resolved_at || inc.created_at;
    const dur = inc.duration_min || 0;
    const durTxt = dur ? `${Math.floor(dur / 60)} Jam ${dur % 60} menit` : '-';
    const kategori = inc.priority === 'kritis' || inc.priority === 'tinggi' ? 'RB' : 'RR';
    const kodeHambatan = inc.awaiting_part ? 'SC' : 'TH';
    const signerNama = report?.signer_name || cfg.koord_nama;
    const signerNip = report?.signer_nip || cfg.koord_nip;
    const fotos = (inc.notes || []).filter((n) => n.doc_url);
    const img = (u: string, max = 300) => `<img src="${location.origin}${u}" style="max-width:100%;max-height:${max}px;object-fit:contain;border:1px solid #ddd">`;
    const awal = fotos[0];
    const sesudah = fotos.find((n) => /selesai|normal kembali|teratasi|diperbaiki/i.test(n.note)) || (fotos.length > 1 ? fotos[fotos.length - 1] : null);
    const notaTgl = new Date(s.tanggal).toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' });
    const notaIsi = s.body?.trim() || `Dengan ini disampaikan ${s.hal} dan mohon persetujuannya guna proses lebih lanjut.`;
    const notaQrBlock = notaQr ? `<div style="margin:6px auto;width:120px"><img src="${notaQr}" style="width:104px;height:104px"><div style="font-size:8px;color:#0a0">✔ TTE Koordinator</div><div style="font-size:8px;color:#444">${esc(s.sign_token || '')}</div></div>` : '<br><br><br>';
    const lkpQrBlock = lkpQr ? `<div style="margin:6px auto;width:120px"><img src="${lkpQr}" style="width:108px;height:108px"><div style="font-size:8px;color:#0a0">✔ Ditandatangani elektronik</div><div style="font-size:8px;color:#444">Token: ${esc(report?.sign_token || '')}</div><div style="font-size:7px;color:#666">Pindai untuk verifikasi</div></div>` : `<div style="margin:14px 0;font-size:10px;color:#999">(Belum disahkan TTE koordinator)</div>`;
    const kasiQrBlock = kasiQr && s.kasi_status === 'disetujui'
      ? `<div style="margin:6px auto;width:120px"><img src="${kasiQr}" style="width:108px;height:108px"><div style="font-size:8px;color:#0a0">✔ Ditandatangani elektronik</div><div style="font-size:8px;color:#444">Token: ${esc(s.kasi_sign_token || '')}</div><div style="font-size:7px;color:#666">Pindai untuk verifikasi</div></div>`
      : '<br><br><br>';
    const kasiNama = s.kasi_signer_name || cfg.kepala_nama || cfg.kasie_nama;
    const kasiNip = s.kasi_signer_nip || cfg.kepala_nip || cfg.kasie_nip;
    const sigBlock = `<table class="sig"><tr><td style="width:50%;vertical-align:top;padding:4px 8px;font-family:Arial,sans-serif;font-size:12px;text-align:center">Diperiksa Oleh :<br><b>${esc(cfg.kepala_jabatan || cfg.kasie_jabatan)}</b><br>${esc(cfg.kantor)}${kasiQrBlock}<u><b>${esc(kasiNama)}</b></u><br>NIP. ${esc(kasiNip)}</td><td style="width:50%;vertical-align:top;padding:4px 8px;font-family:Arial,sans-serif;font-size:12px;text-align:center">${esc(cfg.kota)}, ${dmy(report?.signed_at || tgl)}<br>Dibuat Oleh :<br><b>${esc(cfg.koord_jabatan)}</b><br>${esc(cfg.kantor)}${lkpQrBlock}<u><b>${esc(signerNama)}</b></u><br>NIP. ${esc(signerNip)}</td></tr></table>`;

    return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(s.jenis)} ${esc(s.nomor)}</title><style>
      *{box-sizing:border-box}
      .nd{font-family:'Times New Roman',serif;color:#000;max-width:190mm;padding:24mm 16mm;margin:0 auto;font-size:13px;line-height:1.6;page-break-after:always}
      .nd .judul{text-align:center;font-weight:bold;font-size:16px;text-decoration:underline;letter-spacing:1px;text-transform:uppercase}
      .nd .nomor{text-align:center;margin:2px 0 18px}
      .nd table.head td{padding:1px 6px;vertical-align:top} .nd table.head td.l{width:74px}
      .nd .isi{margin:16px 0;text-align:justify} .nd .ttd{margin-top:30px;width:62%;margin-left:auto;text-align:center}
      .lkp{width:210mm;min-height:297mm;padding:18mm 16mm;margin:0 auto;page-break-after:always}
      .lkp h1{font-family:Arial,sans-serif;font-size:14px;text-align:center;margin:0 0 14px;text-transform:uppercase}
      .lkp table{width:100%;border-collapse:collapse;font-family:Arial,sans-serif;font-size:12px}
      .lkp td{border:1px solid #000;padding:5px 7px;vertical-align:top}
      .lkp td.no{width:26px;text-align:center} .lkp td.ur{width:200px;font-weight:bold}
      .ket{font-size:10px;color:#333} table.sig{margin-top:18px;width:100%;border-collapse:collapse}
      @media print{.nd,.lkp{padding:14mm}}
    </style></head><body>

    <div class="nd">
      <div class="judul">${esc(s.jenis || 'NOTA DINAS')}</div>
      <div class="nomor">Nomor: ${esc(s.nomor)}</div>
      <table class="head">
        <tr><td class="l">Yth</td><td>:</td><td>${esc(s.tujuan || cfg.nd_yth)}</td></tr>
        <tr><td class="l">Dari</td><td>:</td><td>${esc(cfg.nd_dari)}</td></tr>
        <tr><td class="l">Hal</td><td>:</td><td><b>${esc(s.hal)}</b></td></tr>
        <tr><td class="l">Tanggal</td><td>:</td><td>${notaTgl}</td></tr>
      </table>
      <div class="isi">${esc(notaIsi)}</div>
      <div class="isi">Demikian disampaikan, atas perhatiannya diucapkan terima kasih.</div>
      <div class="ttd">${esc(cfg.koord_jabatan)}<br>${notaQrBlock}<u><b>${esc(s.signer_name || cfg.koord_nama)}</b></u><br>NIP. ${esc(s.signer_nip || cfg.koord_nip)}</div>
    </div>

    <div class="lkp">
      <h1>Laporan Kerusakan dan Perbaikan Peralatan Elektronika Bandara</h1>
      <table>
        <tr><td class="no"><b>NO</b></td><td class="ur">URAIAN</td><td><b>DATA</b></td></tr>
        <tr><td class="no">1</td><td class="ur">Tanggal/Bulan/Tahun</td><td>${dmy(tgl)}</td></tr>
        <tr><td class="no">2</td><td class="ur">Lokasi</td><td>${esc(inc.device_name)}</td></tr>
        <tr><td class="no">3</td><td class="ur">Fasilitas</td><td>${esc(cfg.fasilitas || 'Elektronika Bandara')}</td></tr>
        <tr><td class="no">4</td><td class="ur">Peralatan</td><td>${esc(inc.device_name)}${inc.ip && inc.ip.match(/^\d/) ? ' (' + esc(inc.ip) + ')' : ''}</td></tr>
        <tr><td class="no">5</td><td class="ur">Bagian Peralatan</td><td>${esc(report?.sparepart)}</td></tr>
        <tr><td class="no">6</td><td class="ur">Kategori Kerusakan</td><td><b>${kategori}</b> <span class="ket">Ket: RR - Rusak Ringan · RB - Rusak Berat</span></td></tr>
        <tr><td class="no">7</td><td class="ur">Uraian Kerusakan</td><td>${esc(report?.kerusakan)}</td></tr>
        <tr><td class="no">8</td><td class="ur">Tindakan Perbaikan<br><span class="ket">Oleh: ${esc(report?.reporter_name)} · Lokasi: ${esc(cfg.kota)}</span></td><td>${esc(report?.perbaikan)}</td></tr>
        <tr><td class="no">9</td><td class="ur">Penyebab Kerusakan</td><td>${esc(report?.penyebab)}</td></tr>
        <tr><td class="no">10</td><td class="ur">Tgl. Kerusakan / Jam</td><td>${dshort(inc.created_at)} / ${jam(inc.created_at)}</td></tr>
        <tr><td class="no">11</td><td class="ur">Tgl. Selesai / Jam</td><td>${dshort(inc.resolved_at)} / ${jam(inc.resolved_at)}</td></tr>
        <tr><td class="no">12</td><td class="ur">Jumlah Jam Operasi Terputus</td><td>${durTxt}</td></tr>
        <tr><td class="no">13</td><td class="ur">Kode Hambatan</td><td><b>${kodeHambatan}</b> <span class="ket">(SC - Suku Cadang · TH - Tidak Ada Hambatan)</span></td></tr>
      </table>
      ${sigBlock}
    </div>

    <div class="lkp">
      <h1>Lampiran Kerusakan</h1>
      <table><tr>
        <td style="width:50%;height:260px;text-align:center;vertical-align:middle"><b>Kondisi Awal</b><br><br>${awal?.doc_url ? img(awal.doc_url, 240) : '<span style="color:#999">- belum ada foto -</span>'}</td>
        <td style="width:50%;height:260px;text-align:center;vertical-align:middle"><b>Kondisi Sesudah</b><br><br>${sesudah?.doc_url ? img(sesudah.doc_url, 240) : '<span style="color:#999">- belum ada foto -</span>'}</td>
      </tr></table>
      ${fotos.length ? `<div style="margin-top:14px;font-family:Arial,sans-serif;font-size:12px;font-weight:bold">Dokumentasi dari Log Perbaikan (${fotos.length} foto)</div><table style="margin-top:4px;border-collapse:collapse"><tr>${fotos.map((n) => `<td style="text-align:center;width:${Math.floor(100 / Math.min(fotos.length, 3))}%;vertical-align:top;padding:4px">${img(n.doc_url || '', 160)}<div style="font-size:9px;margin-top:3px">${esc(n.note.split(':')[0])}</div><div style="font-size:8px;color:#666">${esc(n.created_at)}</div></td>`).join('')}</tr></table>` : ''}
      ${sigBlock}
    </div>

    ${lampiranHtml(s)}
    </body></html>`;
  }

  // Bangun HTML dokumen (Nota Dinas+LKP bila ada incident_id; laporan bulanan bila cover; selain itu surat tunggal).
  async function buildDocHtml(s: Surat): Promise<string> {
    if (s.jenis === 'Surat Pernyataan') {
      let kasiQr = '';
      if (s.kasi_sign_token) { try { kasiQr = await QRCode.toDataURL(`${location.origin}/verify-tte?token=${s.kasi_sign_token}`, { width: 130, margin: 1 }); } catch { kasiQr = ''; } }
      // QR per pelaksana yang sudah TTE (token PK… di body JSON) → tautan verifikasi publik.
      const pelaksanaQr: Record<string, string> = {};
      try {
        const body = JSON.parse(s.body || '{}');
        const pegawai = Array.isArray(body.pegawai) ? body.pegawai : [];
        for (const p of pegawai) {
          if (p?.sign_token) {
            try { pelaksanaQr[p.sign_token] = await QRCode.toDataURL(`${location.origin}/verify-tte?token=${p.sign_token}`, { width: 120, margin: 1 }); } catch { /* abaikan */ }
          }
        }
      } catch { /* body bukan JSON valid */ }
      return suratPernyataanHtml(s, kasiQr, pelaksanaQr);
    }
    if (s.incident_id) {
      try {
        const { data } = await api.get<{ incident: Incident }>(`/incidents/${s.incident_id}`);
        const inc = data.incident;
        let notaQr = '';
        if (s.sign_token) { try { notaQr = await QRCode.toDataURL(`${location.origin}/verify-tte?token=${s.sign_token}`, { width: 130, margin: 1 }); } catch { notaQr = ''; } }
        let lkpQr = '';
        const lkpToken = inc.report?.sign_token || '';
        if (lkpToken) { try { lkpQr = await QRCode.toDataURL(`${location.origin}/verify-tte?token=${lkpToken}`, { width: 150, margin: 1 }); } catch { lkpQr = ''; } }
        let kasiQr = '';
        if (s.kasi_sign_token) { try { kasiQr = await QRCode.toDataURL(`${location.origin}/verify-tte?token=${s.kasi_sign_token}`, { width: 150, margin: 1 }); } catch { kasiQr = ''; } }
        return buildCombinedIncidentDoc(s, notaQr, inc, lkpQr, kasiQr);
      } catch (err) {
        console.error('[SuratKeluar] Gagal fetch incident untuk preview LKP:', err);
      }
    }
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
          <button onClick={() => setShowKop(true)} className="border border-border text-text2 hover:text-white rounded-md px-3 py-1.5 text-xs font-semibold">🖼️ Kop Surat</button>
          <button onClick={() => { setShowForm(true); setSplData(defaultSplData()); setSplPegawai([{nama:'',nip:'',mulai:'18:00',selesai:'23:00'}]); }} className="bg-accent text-bg rounded-md px-3 py-1.5 text-xs font-semibold">+ Buat Surat</button>
        </div>
      </div>
      {msg && <div className="bg-accent2/10 border border-accent2/30 rounded-md px-3 py-2 text-[11px] text-accent2 mb-3">{msg}</div>}

      {showKop && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4" onClick={() => setShowKop(false)}>
          <div className="bg-surface border border-border rounded-xl w-full max-w-lg p-5 max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-bold">🖼️ Kop Surat (Header Dokumen)</h3>
              <button onClick={() => setShowKop(false)} className="text-text2 hover:text-white text-lg leading-none">×</button>
            </div>
            <p className="text-[11px] text-text2 mb-3 leading-relaxed">
              Unggah gambar kop/kepala surat resmi (JPG/PNG/WebP). Gambar akan tampil sebagai header di dokumen yang digenerate (mis. Surat Pernyataan Lembur). Disarankan gambar lebar penuh dengan rasio kop (mis. 1500×360 px).
            </p>
            <div className="border border-dashed border-border rounded-lg p-3 bg-surface2 mb-3">
              {lkp.kop_url ? (
                <div className="bg-white rounded p-2">
                  <img src={`${location.origin}${lkp.kop_url}`} alt="Kop saat ini" className="w-full block" />
                </div>
              ) : (
                <div className="text-center text-text2 text-[11px] py-6">Belum ada kop. Dokumen digenerate <b>tanpa header</b> sampai kop diunggah.</div>
              )}
            </div>
            <input ref={kopInputRef} type="file" accept="image/*" className="hidden" onChange={(e) => uploadKop(e.target.files?.[0])} />
            <div className="flex gap-2">
              <button onClick={() => kopInputRef.current?.click()} disabled={kopBusy} className="bg-accent text-bg rounded-md px-3 py-1.5 text-xs font-semibold disabled:opacity-50">
                {kopBusy ? '⏳ Memproses…' : (lkp.kop_url ? '🔄 Ganti Kop' : '⬆️ Unggah Kop')}
              </button>
              {lkp.kop_url && (
                <button onClick={removeKop} disabled={kopBusy} className="border border-danger/50 text-danger rounded-md px-3 py-1.5 text-xs font-semibold disabled:opacity-50">🗑️ Hapus Kop</button>
              )}
            </div>
          </div>
        </div>
      )}

      {rows.length === 0 ? (
        <div className="bg-surface border border-border rounded-[10px] px-3 py-10 text-center text-text2 text-sm">Belum ada surat keluar.</div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
          {rows.map((s) => (
            <div key={s.id} className="bg-surface border border-border rounded-xl p-4 flex flex-col gap-3 hover:border-accent/40 transition-colors">
              {/* Header: jenis + tanggal */}
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-center gap-1.5 flex-wrap">
                  <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-accent2/10 text-accent2">{s.jenis}</span>
                  {s.incident_id && <span className="text-[9px] text-accent2 font-mono">{s.incident_id}</span>}
                </div>
                <span className="text-[10px] text-text2 font-mono shrink-0">{s.tanggal}</span>
              </div>

              {/* Hal + nomor */}
              <div>
                <div className="text-sm font-semibold leading-snug line-clamp-2" title={s.hal}>{s.hal}{s.lampiran && s.lampiran.length > 0 && <span className="ml-1.5 text-[9px] text-accent2 align-middle" title={`${s.lampiran.length} lampiran bukti dukung`}>📎{s.lampiran.length}</span>}</div>
                <div className="text-[11px] text-text2 font-mono mt-1">{s.nomor}</div>
              </div>

              {/* Meta: pembuat + status TTE */}
              <div className="flex items-center justify-between gap-2 text-[11px] border-t border-border/60 pt-2">
                <span className="text-text2 truncate">👤 {s.creator_name || '-'}</span>
                {s.sign_token
                  ? <span className="text-success truncate shrink-0" title={`Ditandatangani ${s.signer_name}`}>🔏 {s.signer_name}</span>
                  : <span className="text-text2 shrink-0">— Belum TTE</span>}
              </div>

              {/* Aksi */}
              <div className="flex gap-1.5 flex-wrap mt-auto">
                <button onClick={() => openInWindow(s)} disabled={busy} className="border border-border text-text2 hover:text-white rounded px-2 py-1 text-[11px]" title="Buka dokumen lengkap (Nota Dinas + LKP + Lampiran)">👁️ Lihat</button>
                <button onClick={() => setDetail(s)} className="border border-border text-text2 hover:text-white rounded px-2 py-1 text-[11px]" title="Kelola TTE, lampiran, dan persetujuan Kasi">⚙️ Detail</button>
                {!s.sign_token && <button onClick={() => sign(s)} className="border border-success/40 text-success rounded px-2 py-1 text-[11px]">🔏 Sahkan</button>}
                <button onClick={() => openInWindow(s, true)} disabled={busy} className="border border-border text-text2 hover:text-white rounded px-2 py-1 text-[11px]">🖨️ Cetak</button>
                <button onClick={() => hapus(s)} className="border border-danger/40 text-danger hover:bg-danger/10 rounded px-2 py-1 text-[11px]" title="Hapus surat">🗑️ Hapus</button>
              </div>
            </div>
          ))}
        </div>
      )}

      {showForm && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center overflow-y-auto p-4" onClick={() => setShowForm(false)}>
          <div className="bg-surface border border-border rounded-xl w-full max-w-lg p-5 my-auto max-h-[92vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4"><h3 className="text-sm font-bold">📤 Buat Surat Keluar</h3><button onClick={() => setShowForm(false)} className="text-text2 hover:text-white text-lg leading-none">×</button></div>
            <label className="block text-[11px] text-text2 mb-1">Jenis Surat</label>
            <select className="w-full bg-surface2 border border-border rounded-md px-3 py-2 text-xs mb-3" value={form.jenis} onChange={(e) => setForm({ ...form, jenis: e.target.value })}>{JENIS.map((j) => <option key={j} value={j}>{j}</option>)}</select>
            <label className="block text-[11px] text-text2 mb-1">Hal / Perihal *</label>
            <input className="w-full bg-surface2 border border-border rounded-md px-3 py-2 text-xs mb-3" value={form.hal} onChange={(e) => setForm({ ...form, hal: e.target.value })} placeholder="mis. Permohonan Persetujuan…" />
            <label className="block text-[11px] text-text2 mb-1">Ditujukan (Yth)</label>
            <input className="w-full bg-surface2 border border-border rounded-md px-3 py-2 text-xs mb-3" value={form.tujuan} onChange={(e) => setForm({ ...form, tujuan: e.target.value })} placeholder={lkp.nd_yth} />
            {form.jenis !== 'Surat Pernyataan' && (<>
            <label className="block text-[11px] text-text2 mb-1">Isi Surat (opsional)</label>
            <textarea className="w-full bg-surface2 border border-border rounded-md px-3 py-2 text-xs mb-3 min-h-[80px]" value={form.body} onChange={(e) => setForm({ ...form, body: e.target.value })} placeholder="Kosongkan untuk teks standar 'Dengan ini disampaikan [hal]…'" />
            </>)}

            {form.jenis === 'Surat Pernyataan' && (
              <div className="border border-border rounded-lg p-3 bg-surface2/40 space-y-3 mb-3">
                <div className="text-[10px] font-semibold text-text2 uppercase tracking-wide">Data Surat Pernyataan Lembur (SPL)</div>

                {/* Identitas Kasi */}
                <div className="grid grid-cols-2 gap-2">
                  <div><label className="block text-[10px] text-text2 mb-1">Nama Kepala Seksi</label>
                  <input className="w-full bg-surface2 border border-border rounded px-2 py-1.5 text-xs" value={splData.kasi_nama} onChange={e=>setSplData({...splData,kasi_nama:e.target.value})} placeholder="Nama Kepala Seksi" /></div>
                  <div><label className="block text-[10px] text-text2 mb-1">NIP</label>
                  <input className="w-full bg-surface2 border border-border rounded px-2 py-1.5 text-xs font-mono" value={splData.kasi_nip} onChange={e=>setSplData({...splData,kasi_nip:e.target.value})} placeholder="NIP" /></div>
                  <div><label className="block text-[10px] text-text2 mb-1">Golongan</label>
                  <input className="w-full bg-surface2 border border-border rounded px-2 py-1.5 text-xs" value={splData.kasi_golongan} onChange={e=>setSplData({...splData,kasi_golongan:e.target.value})} /></div>
                  <div><label className="block text-[10px] text-text2 mb-1">Jabatan</label>
                  <input className="w-full bg-surface2 border border-border rounded px-2 py-1.5 text-xs" value={splData.kasi_jabatan} onChange={e=>setSplData({...splData,kasi_jabatan:e.target.value})} /></div>
                </div>

                {/* Detail kegiatan */}
                <div className="grid grid-cols-3 gap-2">
                  <div><label className="block text-[10px] text-text2 mb-1">Tanggal Kegiatan</label>
                  <input type="date" className="w-full bg-surface2 border border-border rounded px-2 py-1.5 text-xs" value={splData.tanggal_kegiatan} onChange={e=>setSplData({...splData,tanggal_kegiatan:e.target.value})} /></div>
                  <div><label className="block text-[10px] text-text2 mb-1">Hari</label>
                  <select className="w-full bg-surface2 border border-border rounded px-2 py-1.5 text-xs" value={splData.hari_kegiatan} onChange={e=>setSplData({...splData,hari_kegiatan:e.target.value})}>
                    {['Senin','Selasa','Rabu','Kamis','Jumat','Sabtu','Minggu'].map(h=><option key={h}>{h}</option>)}
                  </select></div>
                  <div><label className="block text-[10px] text-text2 mb-1">Durasi (jam)</label>
                  <input type="number" min="1" max="8" className="w-full bg-surface2 border border-border rounded px-2 py-1.5 text-xs" value={splData.durasi_jam} onChange={e=>setSplData({...splData,durasi_jam:e.target.value})} /></div>
                </div>
                <div>
                  <label className="block text-[10px] text-text2 mb-1">Deskripsi Kegiatan Lembur</label>
                  <textarea className="w-full bg-surface2 border border-border rounded px-2 py-1.5 text-xs min-h-[60px]" value={splData.kegiatan} onChange={e=>setSplData({...splData,kegiatan:e.target.value})} placeholder="Re-lokasi Speker outdor PAS (Public Address System)…" />
                </div>

                {/* Daftar pegawai */}
                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <label className="text-[10px] text-text2">Daftar Pegawai Lembur</label>
                    <button type="button" onClick={()=>setSplPegawai([...splPegawai,{nama:'',nip:'',mulai:'18:00',selesai:'23:00'}])} className="text-[10px] text-accent2 hover:underline">+ Tambah Baris</button>
                  </div>
                  <div className="text-[9px] text-text2 mb-1 grid grid-cols-[minmax(0,1fr)_58px_58px_18px] gap-1"><span>Nama Pegawai</span><span className="text-center">Mulai</span><span className="text-center">Selesai</span><span></span></div>
                  {splPegawai.map((p,i)=>(
                    <div key={i} className="mb-2">
                      <div className="grid grid-cols-[minmax(0,1fr)_58px_58px_18px] gap-1 items-center">
                        <select
                          className="min-w-0 w-full bg-surface2 border border-border rounded px-2 py-1 text-xs"
                          value={p.user_id ?? ''}
                          onChange={e=>{
                            const uid = Number(e.target.value);
                            const u = splUsers.find(x=>x.id===uid);
                            const a=[...splPegawai];
                            a[i]={...a[i], user_id: u?.id, nama: u?.name||'', nip: u?.nip||''};
                            setSplPegawai(a);
                          }}
                        >
                          <option value="">-- Pilih Pegawai --</option>
                          {splUsers.map(u=><option key={u.id} value={u.id}>{u.emoji||'👤'} {u.name}{u.jabatan?' · '+u.jabatan:''}</option>)}
                        </select>
                        <input className="w-full min-w-0 bg-surface2 border border-border rounded px-1 py-1 text-xs text-center" value={p.mulai} onChange={e=>{const a=[...splPegawai];a[i]={...a[i],mulai:e.target.value};setSplPegawai(a);}} />
                        <input className="w-full min-w-0 bg-surface2 border border-border rounded px-1 py-1 text-xs text-center" value={p.selesai} onChange={e=>{const a=[...splPegawai];a[i]={...a[i],selesai:e.target.value};setSplPegawai(a);}} />
                        <button type="button" onClick={()=>setSplPegawai(splPegawai.filter((_,j)=>j!==i))} className="text-danger text-xs leading-none">✕</button>
                      </div>
                      <div className="flex items-center gap-1.5 mt-1 ml-1">
                        <span className="text-[9px] text-text2 w-7 shrink-0">NIP</span>
                        <input
                          readOnly
                          value={p.nip || ''}
                          title="NIP diambil otomatis dari akun pegawai. Ubah di menu Pengguna bila kosong/salah."
                          placeholder={p.user_id ? '⚠ NIP belum diatur di akun pegawai' : 'otomatis terisi dari akun pegawai'}
                          className={`flex-1 bg-surface border border-border rounded px-2 py-0.5 text-[11px] cursor-not-allowed ${p.nip ? 'text-text2' : 'text-warn placeholder:text-warn/70'}`}
                        />
                      </div>
                    </div>
                  ))}
                </div>

                {/* Laporan Hasil */}
                <div><label className="block text-[10px] text-text2 mb-1">A. Dasar <span className="font-normal">(tiap baris = 1 poin)</span></label>
                <textarea className="w-full bg-surface2 border border-border rounded px-2 py-1.5 text-xs min-h-[52px]" value={splData.dasar} onChange={e=>setSplData({...splData,dasar:e.target.value})} placeholder="Pengaduan Penumpang&#10;Perintah Lisan Kepala Seksi" /></div>
                <div><label className="block text-[10px] text-text2 mb-1">B. Maksud &amp; Tujuan <span className="font-normal">(tiap baris = 1 poin)</span></label>
                <textarea className="w-full bg-surface2 border border-border rounded px-2 py-1.5 text-xs min-h-[52px]" value={splData.tujuan_kegiatan} onChange={e=>setSplData({...splData,tujuan_kegiatan:e.target.value})} placeholder="Pemindahan Speker PAS&#10;Meminimalisir area blankspot" /></div>
                <div><label className="block text-[10px] text-text2 mb-1">C. Hasil yang Dicapai <span className="font-normal">(tiap baris = 1 poin)</span></label>
                <textarea className="w-full bg-surface2 border border-border rounded px-2 py-1.5 text-xs min-h-[68px]" value={splData.hasil} onChange={e=>setSplData({...splData,hasil:e.target.value})} placeholder="Kegiatan pertama: pembongkaran speker…&#10;Kegiatan selanjutnya: penarikan kabel LAN…" /></div>
              </div>
            )}
            <label className="block text-[11px] text-text2 mb-1">🔗 ID Insiden Terkait (opsional — untuk sertakan LKP)</label>
            <input className="w-full bg-surface2 border border-border rounded-md px-3 py-2 text-xs mb-3 font-mono" value={form.incident_id} onChange={(e) => setForm({ ...form, incident_id: e.target.value.toUpperCase() })} placeholder="INC-001" />
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
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center overflow-y-auto p-4" onClick={() => setDetail(null)}>
          <div className="bg-surface border border-border rounded-xl w-full max-w-5xl xl:max-w-6xl 2xl:max-w-7xl p-4 sm:p-5 flex flex-col" style={{ height: 'calc(100vh - 2rem)' }} onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-3 shrink-0">
              <h3 className="text-sm font-bold">👁️ Detail Dokumen</h3>
              <button onClick={() => setDetail(null)} className="text-text2 hover:text-white text-lg leading-none">×</button>
            </div>

            <div className="flex flex-col lg:flex-row gap-4 flex-1 min-h-0 overflow-y-auto lg:overflow-hidden">
            {/* Pratinjau dokumen (PDF/render) */}
            <div className="flex-1 min-h-[50vh] lg:min-h-0 bg-[#525659] rounded-lg border border-border overflow-hidden flex flex-col">
              <div className="px-3 py-1.5 text-[10px] text-white/70 border-b border-black/20 flex items-center justify-between gap-2">
                <span className="shrink-0">📄 Pratinjau</span>
                <div className="flex items-center gap-1">
                  <button onClick={zoomOut} disabled={zoomIdx === 0} className="w-5 h-5 flex items-center justify-center rounded hover:bg-white/20 disabled:opacity-30 text-white font-bold text-sm leading-none" title="Perkecil">−</button>
                  <span className="w-9 text-center select-none">{Math.round(ZOOM_STEPS[zoomIdx] * 100)}%</span>
                  <button onClick={zoomIn} disabled={zoomIdx === ZOOM_STEPS.length - 1} className="w-5 h-5 flex items-center justify-center rounded hover:bg-white/20 disabled:opacity-30 text-white font-bold text-sm leading-none" title="Perbesar">+</button>
                </div>
                <div className="flex items-center gap-2 ml-auto">
                  <button onClick={() => openInWindow(detail)} disabled={busy} className="text-white/80 hover:text-white shrink-0" title="Buka dokumen lengkap di tab baru">🔗 Tab Baru</button>
                  <button onClick={() => openInWindow(detail, true)} disabled={busy} className="text-white/80 hover:text-white shrink-0">🖨️ Cetak</button>
                </div>
              </div>
              {previewHtml
                ? <iframe
                    ref={iframeRef}
                    title="preview"
                    srcDoc={previewHtml}
                    className="flex-1 min-h-0 w-full bg-white"
                    onLoad={() => {
                      applyZoom(ZOOM_STEPS[zoomIdx]);
                      iframeRef.current?.contentWindow?.scrollTo(0, 0);
                      if (autoPrintRef.current) {
                        autoPrintRef.current = false;
                        setTimeout(() => printFromIframe(), 200);
                      }
                    }}
                  />
                : <div className="flex-1 flex items-center justify-center text-white/50 text-xs">Memuat dokumen…</div>}
            </div>

            <div className="w-full lg:w-[380px] lg:shrink-0 space-y-2 text-xs lg:overflow-y-auto pr-1 min-h-0">
              <Row label="Jenis" value={detail.jenis} />
              <Row label="Nomor" value={detail.nomor} mono />
              <Row label="Hal / Perihal" value={detail.hal} />
              <Row label="Ditujukan (Yth)" value={detail.tujuan || lkp.nd_yth} />
              <Row label="Tanggal" value={new Date(detail.tanggal).toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' })} />
              <Row label="Pembuat" value={detail.creator_name || '-'} />
              {detail.body && (
                <div>
                  <div className="text-text2 mb-1">Isi Surat</div>
                  <div className="bg-surface2 border border-border rounded-md p-2.5 whitespace-pre-wrap leading-relaxed">{detail.body}</div>
                </div>
              )}

              {/* Tautan ke insiden & LKP */}
              <div className="border-t border-border pt-2 mt-2">
                <div className="text-text2 mb-1.5">🔗 Laporan Kerusakan (LKP) Terkait</div>
                {detail.incident_id ? (
                  <div className="bg-success/10 border border-success/30 rounded-md p-2.5 mb-1.5">
                    <div className="text-success font-semibold text-[11px]">✓ Terhubung ke insiden <span className="font-mono">{detail.incident_id}</span></div>
                    <div className="text-[10px] text-text2 mt-0.5">Tombol Lihat/Cetak akan menyertakan halaman LKP + foto kerusakan.</div>
                  </div>
                ) : (
                  <div className="text-text2 text-[11px] mb-1.5">Belum terhubung ke insiden — hanya Nota Dinas yang ditampilkan.</div>
                )}
                <div className="flex gap-1.5">
                  <input
                    className="flex-1 bg-surface2 border border-border rounded px-2 py-1 text-xs font-mono"
                    placeholder="INC-001"
                    value={linkIncInput}
                    onChange={(e) => setLinkIncInput(e.target.value.toUpperCase())}
                  />
                  <button
                    onClick={() => saveIncidentLink(detail, linkIncInput)}
                    disabled={linkIncBusy}
                    className="bg-accent text-bg rounded px-2.5 py-1 text-[11px] font-semibold disabled:opacity-50"
                  >
                    {linkIncBusy ? '…' : 'Simpan'}
                  </button>
                  {detail.incident_id && (
                    <button
                      onClick={() => { setLinkIncInput(''); saveIncidentLink(detail, ''); }}
                      disabled={linkIncBusy}
                      className="border border-danger/40 text-danger rounded px-2 py-1 text-[11px]"
                      title="Lepas tautan insiden"
                    >✕</button>
                  )}
                </div>
                {linkIncMsg && <div className="mt-1 text-[10px] text-text2">{linkIncMsg}</div>}
              </div>

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

              {detail.jenis === 'Surat Pernyataan' && (() => {
                let bodyParsed: Record<string, unknown> = {};
                try { bodyParsed = JSON.parse(detail.body || '{}'); } catch {}
                const pg = (Array.isArray(bodyParsed.pegawai) ? bodyParsed.pegawai : []).filter((p: SplPegawaiRow) => (p?.nama || '').trim()) as SplPegawaiRow[];
                const signedCount = pg.filter(p => p.signed_at).length;
                return (
                  <div className="border-t border-border pt-2 mt-2">
                    <div className="flex items-center justify-between mb-1">
                      <div className="text-text2">✍️ TTD Pelaksana Lembur</div>
                      <button onClick={() => notifyPelaksana(detail)} className="text-[10px] text-accent2 hover:underline">📲 Kirim Notifikasi</button>
                    </div>
                    {pg.length === 0 ? (
                      <div className="text-text2 text-[11px]">Belum ada daftar pelaksana.</div>
                    ) : (
                      <div className="space-y-1">
                        <div className="text-[10px] text-text2 mb-1">{signedCount}/{pg.length} sudah menandatangani</div>
                        {pg.map((p, i) => (
                          <div key={i} className={`flex items-center justify-between rounded-md px-2.5 py-1.5 text-[11px] ${p.signed_at ? 'bg-success/10 border border-success/30' : p.pelaksana_token ? 'bg-warn/5 border border-warn/20' : 'bg-surface2 border border-border'}`}>
                            <div>
                              <span className={p.signed_at ? 'text-success font-semibold' : 'text-white'}>{p.signed_at ? '🔏' : p.pelaksana_token ? '⏳' : '○'} {p.nama}</span>
                              {p.nip && <span className="text-text2 font-mono ml-1.5 text-[9px]">{p.nip}</span>}
                            </div>
                            <div className="text-right">
                              {p.signed_at ? (
                                <div className="text-success text-[9px]">{new Date(p.signed_at).toLocaleDateString('id-ID')}</div>
                              ) : p.pelaksana_token ? (
                                <a href={`/ttd-pelaksana?token=${p.pelaksana_token}`} target="_blank" rel="noreferrer" className="text-accent2 text-[9px] hover:underline">Link TTD</a>
                              ) : (
                                <span className="text-text2 text-[9px]">Kirim notifikasi</span>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })()}

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
              <button onClick={() => openInWindow(detail, true)} disabled={busy} className="bg-accent text-bg rounded-md px-3 py-1.5 text-xs font-semibold disabled:opacity-50">🖨️ Cetak</button>
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
