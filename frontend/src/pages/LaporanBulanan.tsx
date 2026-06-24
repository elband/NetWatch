import { useEffect, useRef, useState } from 'react';
import QRCode from 'qrcode';
import { api } from '../api/client';
import type { Surat } from '../types';
import { confirmDialog } from '../components/dialog';
import { buildReportHtml, SECTIONS, type LaporanData, type SectionKey, type LkpHead, type CoverInfo } from '../utils/laporanReport';

const LKP_DEFAULT: LkpHead = {
  kantor: 'BANDAR UDARA A.P.T. PRANOTO - SAMARINDA', kota: 'Samarinda',
  bandara: 'Aji Pangeran Tumenggung Pranoto Samarinda',
  koord_jabatan: 'KOORDINATOR UNIT ELEKTRONIKA BANDARA', koord_nama: 'PRAYUDA ELFANDRO', koord_nip: '19930311 202203 1 008',
  kasie_jabatan: 'KEPALA SEKSI TEKNIK DAN OPERASI', kasie_nama: 'MURDOKO', kasie_nip: '19780319 200012 1 001',
  nd_yth: 'Kepala Seksi Teknik dan Operasi Penerbangan', nd_dari: 'Koordinator Elektronika Bandara',
};
const BULAN = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];

export default function LaporanBulanan() {
  const now = new Date();
  const [month, setMonth] = useState(`${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`);
  const [lkp, setLkp] = useState(LKP_DEFAULT);
  const [sel, setSel] = useState<Set<SectionKey>>(new Set(SECTIONS.map((s) => s.key)));
  const [data, setData] = useState<LaporanData | null>(null);
  const [cover, setCover] = useState<CoverInfo | null>(null);
  const [qr, setQr] = useState('');
  const [kasiQr, setKasiQr] = useState('');
  const [html, setHtml] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const iframeRef = useRef<HTMLIFrameElement>(null);

  useEffect(() => {
    api.get('/settings').then((r) => { if (r.data.settings?.lkp) setLkp((l) => ({ ...l, ...r.data.settings.lkp })); }).catch(() => {});
  }, []);

  // Bangun ulang preview saat pilihan seksi berubah (tanpa fetch ulang).
  useEffect(() => {
    if (data && cover) setHtml(buildReportHtml(data, cover, qr, lkp, sel, kasiQr));
  }, [sel, data, cover, qr, kasiQr, lkp]);

  function toggle(k: SectionKey) {
    setSel((prev) => { const n = new Set(prev); n.has(k) ? n.delete(k) : n.add(k); return n; });
  }

  // Susun preview. published=false → nomor sementara (tidak buat record); true → buat Nota Dinas ber-nomor.
  async function susun(published: boolean) {
    setBusy(true); setMsg('');
    try {
      const [y, m] = month.split('-').map(Number);
      const namaBulan = `${BULAN[m - 1]} ${y}`;
      const { data: d } = await api.get<LaporanData>('/laporan/bulanan', { params: { month } });
      const hal = `Laporan Bulanan Unit Elektronika Bandara ${namaBulan}`;
      let cov: CoverInfo;
      if (published) {
        const { data: ls } = await api.get<{ surat: Surat[] }>('/surat');
        const ex = ls.surat.find((s) => s.hal === hal);
        if (ex) cov = ex;
        else {
          const r = await api.post('/surat', { jenis: 'Nota Dinas', hal, report_month: month, body: `Dengan ini disampaikan Laporan Bulanan Unit Elektronika Bandara periode ${namaBulan} dan Jadwal Dinas ${d.nextMonthName} sebagaimana terlampir, dan mohon persetujuannya guna proses lebih lanjut.` });
          cov = r.data.surat;
        }
      } else {
        cov = { nomor: `…/ELBAND/APTP/…/${y} (draf)`, tanggal: now.toISOString() };
      }
      let q = '';
      if (cov.sign_token) { try { q = await QRCode.toDataURL(`${location.origin}/verify-tte?token=${cov.sign_token}`, { width: 130, margin: 1 }); } catch { q = ''; } }
      let kq = '';
      if (cov.kasi_sign_token) { try { kq = await QRCode.toDataURL(`${location.origin}/verify-tte?token=${cov.kasi_sign_token}`, { width: 130, margin: 1 }); } catch { kq = ''; } }
      setData(d); setCover(cov); setQr(q); setKasiQr(kq);
      setHtml(buildReportHtml(d, cov, q, lkp, sel, kq));
      if (published) setMsg(`Nota Dinas pengantar diterbitkan: ${cov.nomor}. Dokumen siap dicetak.`);
    } catch (e: any) { setMsg(e?.response?.data?.error || 'Gagal menyusun laporan.'); }
    finally { setBusy(false); }
  }

  // Sahkan Nota Dinas dengan TTE → QR koordinator tampil di SEMUA halaman laporan.
  async function sahkanTte() {
    if (!cover?.id) return;
    if (!(await confirmDialog({ title: 'Sahkan laporan bulanan', message: 'Laporan akan ditandatangani secara elektronik (TTE). Tidak bisa dibatalkan.', confirmText: '🔏 Sahkan', variant: 'success' }))) return;
    setBusy(true); setMsg('');
    try {
      const { data: r } = await api.post(`/surat/${cover.id}/sign`, { signerName: lkp.koord_nama, signerNip: lkp.koord_nip });
      const cov: CoverInfo = r.surat;
      let q = '';
      if (cov.sign_token) { try { q = await QRCode.toDataURL(`${location.origin}/verify-tte?token=${cov.sign_token}`, { width: 130, margin: 1 }); } catch { q = ''; } }
      setCover(cov); setQr(q);
      if (data) setHtml(buildReportHtml(data, cov, q, lkp, sel, kasiQr));
      setMsg('Laporan disahkan TTE. QR verifikasi kini tampil di semua halaman.');
    } catch (e: any) { setMsg(e?.response?.data?.error || 'Gagal mengesahkan TTE.'); }
    finally { setBusy(false); }
  }

  function cetak() {
    const w = iframeRef.current?.contentWindow;
    if (!w) return;
    w.focus(); w.print();
  }

  const allOn = sel.size === SECTIONS.length;

  return (
    <div className="flex flex-col lg:flex-row gap-4 h-[calc(100vh-130px)]">
      {/* Panel pengaturan */}
      <div className="lg:w-[320px] shrink-0 bg-surface border border-border rounded-xl p-4 overflow-y-auto">
        <div className="text-sm font-bold mb-3">🗓️ Susun Laporan Bulanan</div>

        <label className="block text-[11px] text-text2 mb-1">Periode (Bulan)</label>
        <input type="month" className="w-full bg-surface2 border border-border rounded-md px-3 py-2 text-xs mb-4" value={month} onChange={(e) => setMonth(e.target.value)} />

        <div className="flex items-center justify-between mb-1.5">
          <label className="text-[11px] text-text2 uppercase tracking-wide">Seksi Dokumen</label>
          <button onClick={() => setSel(allOn ? new Set() : new Set(SECTIONS.map((s) => s.key)))} className="text-[10px] text-accent2 hover:underline">{allOn ? 'Kosongkan' : 'Pilih Semua'}</button>
        </div>
        <div className="space-y-1 mb-4">
          <div className="flex items-center gap-2 text-[11px] text-text2 px-2 py-1.5 rounded bg-surface2/50 opacity-70">
            <input type="checkbox" checked disabled className="accent-accent" /> Nota Dinas Pengantar <span className="ml-auto text-[9px]">wajib</span>
          </div>
          {SECTIONS.map((s) => (
            <label key={s.key} className="flex items-center gap-2 text-[11px] px-2 py-1.5 rounded hover:bg-surface2 cursor-pointer">
              <input type="checkbox" checked={sel.has(s.key)} onChange={() => toggle(s.key)} className="accent-accent" />
              <span className={sel.has(s.key) ? 'text-text' : 'text-text2'}>{s.label}</span>
            </label>
          ))}
        </div>

        <div className="space-y-2">
          <button onClick={() => susun(false)} disabled={busy} className="w-full border border-border text-text rounded-md px-3 py-2 text-xs font-semibold hover:bg-surface2 disabled:opacity-50">{busy ? 'Menyusun…' : '👁️ Susun Pratinjau'}</button>
          <button onClick={() => susun(true)} disabled={busy} className="w-full bg-accent2 text-bg rounded-md px-3 py-2 text-xs font-semibold disabled:opacity-50">📋 Terbitkan Nota Dinas (beri nomor)</button>
          {cover?.id && !cover.sign_token && (
            <button onClick={sahkanTte} disabled={busy} className="w-full bg-success text-bg rounded-md px-3 py-2 text-xs font-semibold disabled:opacity-50">🔏 Sahkan TTE (semua halaman)</button>
          )}
          {cover?.sign_token && <div className="text-[10px] text-success text-center">🔏 Ber-TTE: {cover.sign_token}</div>}
          <button onClick={cetak} disabled={!html} className="w-full bg-accent text-bg rounded-md px-3 py-2 text-xs font-semibold disabled:opacity-40">🖨️ Cetak / Simpan PDF</button>
        </div>

        {msg && <div className="mt-3 bg-accent2/10 border border-accent2/30 rounded-md px-3 py-2 text-[11px] text-accent2">{msg}</div>}
        <p className="mt-3 text-[10px] text-text2 leading-relaxed">Alur: <b>Susun Pratinjau</b> (nomor draf) → <b>Terbitkan</b> (beri nomor, muncul di Surat Keluar) → <b>Sahkan TTE</b> agar QR verifikasi koordinator tampil di <b>semua halaman</b> → <b>Cetak</b>.</p>
      </div>

      {/* Pratinjau dokumen */}
      <div className="flex-1 bg-[#525659] rounded-xl border border-border overflow-hidden flex flex-col">
        <div className="px-4 py-2 text-[11px] text-white/80 border-b border-black/20 flex items-center justify-between">
          <span>📄 Pratinjau Dokumen {data ? `— ${data.monthName}` : ''}</span>
          {data && <span>{sel.size + 1} halaman seksi · A4</span>}
        </div>
        {html ? (
          <iframe ref={iframeRef} title="preview" srcDoc={html} className="flex-1 w-full bg-[#525659]" />
        ) : (
          <div className="flex-1 flex items-center justify-center text-white/50 text-sm">Pilih periode &amp; seksi, lalu klik <b className="mx-1">Susun Pratinjau</b></div>
        )}
      </div>
    </div>
  );
}
