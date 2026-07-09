import { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { api } from '../api/client';
import { alertDialog } from '../components/dialog';
import { buildReportHtml, SECTIONS, type LaporanData, type LkpHead } from '../utils/laporanReport';
import { buildAabReportHtml, type AabReportData } from '../utils/aabReport';

const LKP_DEFAULT: LkpHead = {
  kantor: 'BANDAR UDARA A.P.T. PRANOTO - SAMARINDA', kota: 'Samarinda', bandara: 'Aji Pangeran Tumenggung Pranoto Samarinda',
  koord_jabatan: 'KOORDINATOR UNIT ELEKTRONIKA BANDARA', koord_nama: 'PRAYUDA ELFANDRO', koord_nip: '19930311 202203 1 008',
  kasie_jabatan: 'KEPALA SEKSI TEKNIK DAN OPERASI', kasie_nama: 'MURDOKO', kasie_nip: '19780319 200012 1 001',
  nd_yth: 'Kepala Seksi Teknik dan Operasi Penerbangan', nd_dari: 'Koordinator Elektronika Bandara',
};

interface Lampiran { id: number; file_url: string; filename: string | null; mimetype: string | null }
interface Doc {
  jenis: string; nomor: string; hal: string; tujuan: string | null; body: string | null; tanggal: string;
  creator_name: string | null; signer_name: string | null; signer_nip: string | null; sign_token: string | null; signed_at: string | null;
  kasi_status: string | null; kasi_signer_name: string | null; kasi_signer_nip: string | null; kasi_signed_at: string | null; kasi_sign_token: string | null; kasi_note: string | null;
  lampiran: Lampiran[];
}
interface Resp { valid: boolean; doc?: Doc; laporan?: LaporanData | AabReportData | null; report_kind?: string; lkp?: Partial<LkpHead>; kasi?: { nama: string; nip: string; jabatan: string }; header?: { kantor: string; koord_jabatan: string; nd_dari: string } }

const fmt = (s?: string | null) => {
  if (!s) return '-';
  const d = new Date(s.replace(' ', 'T'));
  return isNaN(d.getTime()) ? s : d.toLocaleString('id-ID', { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' });
};
const fmtTgl = (s?: string | null) => {
  if (!s) return '-';
  const d = new Date(s.replace(' ', 'T'));
  return isNaN(d.getTime()) ? s : d.toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' });
};

export default function Ttd() {
  const token = new URLSearchParams(window.location.search).get('token') || '';
  const [r, setR] = useState<Resp | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [name, setName] = useState('');
  const [nip, setNip] = useState('');
  const [note, setNote] = useState('');
  const [rejecting, setRejecting] = useState(false);
  const [done, setDone] = useState<'disetujui' | 'ditolak' | null>(null);
  const [mounted, setMounted] = useState(false);
  const [slide, setSlide] = useState(0);
  const [reportHtml, setReportHtml] = useState('');

  function load() {
    if (!token) { setLoading(false); return; }
    api.get(`/ttd/${encodeURIComponent(token)}`).then((res) => {
      setR(res.data);
      if (res.data?.kasi) { setName(res.data.kasi.nama || ''); setNip(res.data.kasi.nip || ''); }
    }).catch(() => setR({ valid: false })).finally(() => { setLoading(false); setTimeout(() => setMounted(true), 30); });
  }
  useEffect(load, [token]);

  // Bila surat adalah Laporan Bulanan → susun seluruh halaman laporan untuk ditinjau.
  useEffect(() => {
    const d = r?.doc;
    if (!r?.laporan || !d) { setReportHtml(''); return; }
    const lkp: LkpHead = { ...LKP_DEFAULT, ...(r.lkp || {}) };
    const cover = { nomor: d.nomor, tanggal: d.tanggal, tujuan: d.tujuan, signer_name: d.signer_name, signer_nip: d.signer_nip, sign_token: d.sign_token, kasi_signer_name: d.kasi_signer_name, kasi_signer_nip: d.kasi_signer_nip, kasi_sign_token: d.kasi_sign_token };
    const qrOf = (tok?: string | null) => tok ? QRCode.toDataURL(`${location.origin}/verify-tte?token=${tok}`, { width: 130, margin: 1 }).catch(() => '') : Promise.resolve('');
    Promise.all([qrOf(d.sign_token), d.kasi_status === 'disetujui' ? qrOf(d.kasi_sign_token) : Promise.resolve('')]).then(([qr, kasiQr]) =>
      setReportHtml(r.report_kind === 'aab'
        ? buildAabReportHtml(r.laporan as AabReportData, cover, qr, lkp, kasiQr)
        : buildReportHtml(r.laporan as LaporanData, cover, qr, lkp, new Set(SECTIONS.map((x) => x.key)), kasiQr)));
  }, [r]);

  const doc = r?.doc;
  const status = done || doc?.kasi_status || 'menunggu';
  const lamp = doc?.lampiran || [];
  const totalSlides = 1 + lamp.length;
  const go = (d: number) => setSlide((s) => (s + d + totalSlides) % totalSlides);

  async function submit(action: 'approve' | 'reject') {
    if (action === 'approve' && !name.trim()) { alertDialog({ title: 'Nama wajib diisi', message: 'Masukkan nama penandatangan terlebih dahulu.', variant: 'warning' }); return; }
    setBusy(true);
    try {
      const res = await api.post(`/ttd/${encodeURIComponent(token)}`, action === 'approve' ? { action, name, nip } : { action, note });
      setDone(res.data.status);
      if (res.data.kasi_sign_token && doc) doc.kasi_sign_token = res.data.kasi_sign_token;
    } catch (e: any) { alertDialog({ title: 'Gagal', message: e?.response?.data?.error || 'Gagal memproses.', variant: 'danger' }); }
    finally { setBusy(false); }
  }

  const Stepper = () => {
    const steps = [
      { t: 'Dibuat', d: 'Koordinator', ok: true },
      { t: 'Ditinjau', d: 'Kepala Seksi', ok: status !== 'menunggu' },
      { t: status === 'ditolak' ? 'Ditolak' : 'Disahkan', d: 'TTE', ok: status === 'disetujui' },
    ];
    return (
      <div className="flex items-center gap-1.5">
        {steps.map((s, i) => (
          <div key={i} className="flex items-center gap-1.5 flex-1">
            <div className="flex flex-col items-center text-center flex-1">
              <div className={`w-7 h-7 rounded-full flex items-center justify-center text-[11px] font-bold border ${s.ok ? (status === 'ditolak' && i === 2 ? 'bg-rose-500 border-rose-400 text-white' : 'bg-emerald-500 border-emerald-400 text-white') : 'bg-white/5 border-white/15 text-slate-500'}`}>
                {s.ok ? (status === 'ditolak' && i === 2 ? '✕' : '✓') : i + 1}
              </div>
              <div className={`text-[10px] mt-1 font-semibold ${s.ok ? 'text-slate-200' : 'text-slate-500'}`}>{s.t}</div>
              <div className="text-[9px] text-slate-500 leading-tight">{s.d}</div>
            </div>
            {i < steps.length - 1 && <div className={`h-[2px] flex-1 -mt-5 ${steps[i + 1].ok ? 'bg-emerald-500/60' : 'bg-white/10'}`} />}
          </div>
        ))}
      </div>
    );
  };

  // Konten viewer per slide: 0 = surat, selebihnya = lampiran.
  function renderLetter() {
    if (!doc) return null;
    return (
      <div className="p-7 sm:p-9 text-black relative" style={{ fontFamily: "'Times New Roman',serif" }}>
        {status === 'disetujui' && <div className="absolute top-8 right-8 border-[3px] border-emerald-600 text-emerald-600 rounded-lg px-3 py-1 text-sm font-bold rotate-[8deg] opacity-80">✓ DISETUJUI</div>}
        {status === 'ditolak' && <div className="absolute top-8 right-8 border-[3px] border-rose-600 text-rose-600 rounded-lg px-3 py-1 text-sm font-bold rotate-[8deg] opacity-80">DITOLAK</div>}
        <div className="text-center font-bold text-[17px] underline tracking-wide uppercase" style={{ color: '#0f3d91' }}>{doc.jenis}</div>
        <div className="text-center text-[13px] mb-5">Nomor: {doc.nomor}</div>
        <table className="text-[13px] leading-6 mb-3"><tbody>
          <tr><td className="align-top w-20">Yth</td><td className="align-top w-3">:</td><td>{doc.tujuan || r?.kasi?.jabatan}</td></tr>
          <tr><td className="align-top">Dari</td><td>:</td><td>{r?.header?.nd_dari || 'Koordinator Elektronika Bandara'}</td></tr>
          <tr><td className="align-top">Hal</td><td>:</td><td className="font-bold">{doc.hal}</td></tr>
          <tr><td className="align-top">Tanggal</td><td>:</td><td>{fmtTgl(doc.tanggal)}</td></tr>
        </tbody></table>
        <div className="text-[13px] text-justify leading-7 whitespace-pre-wrap">{doc.body || `Dengan ini disampaikan ${doc.hal} dan mohon persetujuannya guna proses lebih lanjut.`}</div>
        <div className="text-[13px] mt-3">Demikian disampaikan, atas perhatiannya diucapkan terima kasih.</div>
        <div className="text-[12px] mt-8 text-right">
          <div>Dibuat Oleh: {r?.header?.koord_jabatan}</div>
          <div className="font-bold underline mt-7">{doc.signer_name || doc.creator_name}</div>
          {doc.signer_nip && <div>NIP. {doc.signer_nip}</div>}
        </div>
      </div>
    );
  }
  function renderLampiran(l: Lampiran) {
    const img = (l.mimetype || '').startsWith('image');
    return (
      <div className="bg-slate-50 p-4 flex items-center justify-center min-h-[420px]">
        {img
          ? <img src={l.file_url} alt={l.filename || ''} className="max-w-full max-h-[70vh] object-contain rounded shadow" />
          : <iframe title={l.filename || 'lampiran'} src={l.file_url} className="w-full h-[70vh] bg-white rounded border" />}
      </div>
    );
  }
  const isLetter = slide === 0;
  const curLamp = !isLetter ? lamp[slide - 1] : null;

  return (
    <div className="min-h-screen relative p-4 sm:p-6" style={{ background: 'radial-gradient(1100px 560px at 50% -8%, #16243f 0%, #0b1220 45%, #070b14 100%)' }}>
      <div className="pointer-events-none absolute -top-28 left-1/2 -translate-x-1/2 w-[620px] h-[620px] rounded-full blur-[130px] opacity-25"
        style={{ background: status === 'disetujui' ? 'radial-gradient(circle,#22c55e,transparent 70%)' : status === 'ditolak' ? 'radial-gradient(circle,#ef4444,transparent 70%)' : 'radial-gradient(circle,#3b82f6,transparent 70%)' }} />

      <div className={`relative max-w-5xl mx-auto transition-all duration-500 ${mounted ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-3'}`}>
        <div className="flex items-center gap-3 mb-5 text-white">
          <div className="w-11 h-11 rounded-xl flex items-center justify-center text-2xl shadow-lg" style={{ background: 'linear-gradient(135deg,#3b82f6,#22d3ee)' }}>🖊️</div>
          <div>
            <div className="text-base font-bold tracking-tight">NetWatch ERP · Tanda Tangan Elektronik</div>
            <div className="text-[11px] text-slate-400">Enterprise Resource Planning for Airport Technology Operations</div>
          </div>
        </div>

        {loading ? (
          <div className="flex flex-col items-center gap-3 py-24 text-slate-400">
            <div className="w-9 h-9 border-2 border-slate-600 border-t-sky-400 rounded-full animate-spin" />
            <div className="text-sm">Memuat dokumen…</div>
          </div>
        ) : !token || !r?.valid || !doc ? (
          <div className="max-w-md mx-auto bg-[#0d1526] border border-white/10 rounded-2xl p-10 text-center">
            <div className="text-5xl mb-2">🔍</div>
            <div className="text-amber-400 font-bold text-lg">Tautan Tidak Valid</div>
            <div className="text-[12px] text-slate-400 mt-1">Dokumen tidak ditemukan. Mohon minta tautan baru kepada koordinator.</div>
          </div>
        ) : (
          <div className="grid lg:grid-cols-[1fr_360px] gap-5 items-start">
            {/* Kolom kiri: viewer dokumen (slider) */}
            <div className="rounded-2xl p-[1.5px]" style={{ background: 'linear-gradient(160deg, rgba(96,165,250,.5), rgba(255,255,255,.06))' }}>
              <div className="bg-white rounded-[15px] overflow-hidden shadow-2xl">
                <div className="px-4 sm:px-6 py-2.5 bg-slate-100 text-slate-500 text-[11px] border-b flex items-center justify-between gap-2">
                  <span className="truncate">{isLetter ? (reportHtml ? '📘 Laporan Bulanan (lengkap)' : '📄 Dokumen Utama') : `📎 Lampiran: ${curLamp?.filename || 'Bukti Dukung'}`}</span>
                  {totalSlides > 1 ? (
                    <div className="flex items-center gap-1.5 shrink-0">
                      <button onClick={() => go(-1)} className="w-7 h-7 rounded-md bg-white border border-slate-300 text-slate-600 hover:bg-slate-200 flex items-center justify-center" title="Sebelumnya">‹</button>
                      <span className="font-mono text-slate-600 tabular-nums">{slide + 1} / {totalSlides}</span>
                      <button onClick={() => go(1)} className="w-7 h-7 rounded-md bg-white border border-slate-300 text-slate-600 hover:bg-slate-200 flex items-center justify-center" title="Berikutnya">›</button>
                    </div>
                  ) : <span className="font-mono shrink-0">{doc.nomor}</span>}
                </div>
                {isLetter
                  ? (reportHtml
                      ? <iframe title="laporan" srcDoc={reportHtml} className="w-full bg-white" style={{ height: '78vh' }} />
                      : renderLetter())
                  : curLamp && renderLampiran(curLamp)}
                {totalSlides > 1 && (
                  <div className="flex items-center justify-center gap-1.5 py-2.5 bg-slate-50 border-t">
                    {Array.from({ length: totalSlides }).map((_, i) => (
                      <button key={i} onClick={() => setSlide(i)} className={`h-2 rounded-full transition-all ${i === slide ? 'w-5 bg-sky-500' : 'w-2 bg-slate-300 hover:bg-slate-400'}`} title={i === 0 ? 'Dokumen' : `Lampiran ${i}`} />
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* Kolom kanan: alur + aksi + lampiran kecil */}
            <div className="lg:sticky lg:top-6 space-y-4">
              <div className="bg-[#0d1526] border border-white/10 rounded-2xl p-5">
                <div className="text-slate-400 text-[10px] uppercase tracking-wide mb-3">Alur Pengesahan</div>
                <Stepper />
              </div>

              <div className="rounded-2xl p-[1.5px]" style={{ background: status === 'disetujui' ? 'linear-gradient(160deg,#34d399,#0d1526)' : status === 'ditolak' ? 'linear-gradient(160deg,#fb7185,#0d1526)' : 'linear-gradient(160deg,#60a5fa,#0d1526)' }}>
                <div className="bg-[#0d1526] rounded-[15px] p-5">
                  {status === 'disetujui' ? (
                    <div className="text-center">
                      <div className="relative inline-block mb-2">
                        <div className="absolute inset-0 rounded-full bg-emerald-500/30 blur-lg" />
                        <div className="relative w-16 h-16 rounded-full flex items-center justify-center" style={{ background: 'linear-gradient(135deg,#22c55e,#16a34a)' }}>
                          <svg viewBox="0 0 24 24" className="w-9 h-9" fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6L9 17l-5-5" /></svg>
                        </div>
                      </div>
                      <div className="text-emerald-400 font-extrabold text-lg">Sudah Ditandatangani</div>
                      <div className="text-[11px] text-slate-400 mt-1">Disahkan secara elektronik (TTE) oleh Kepala Seksi.</div>
                      <div className="mt-3 rounded-xl border border-white/10 bg-black/20 p-3 text-left">
                        <div className="text-slate-100 text-[13px] font-bold">{doc.kasi_signer_name || name}</div>
                        {(doc.kasi_signer_nip || nip) && <div className="text-slate-400 text-[11px]">NIP. {doc.kasi_signer_nip || nip}</div>}
                        <div className="text-slate-500 text-[11px] mt-1">🕒 {fmt(doc.kasi_signed_at) !== '-' ? fmt(doc.kasi_signed_at) : 'Baru saja'}</div>
                      </div>
                      {doc.kasi_sign_token && <a href={`/verify-tte?token=${doc.kasi_sign_token}`} className="inline-flex items-center gap-1 mt-3 text-sky-300 text-[11px] hover:underline">🔗 Verifikasi keaslian TTE</a>}
                    </div>
                  ) : status === 'ditolak' ? (
                    <div className="text-center">
                      <div className="w-16 h-16 rounded-full mx-auto mb-2 flex items-center justify-center" style={{ background: 'linear-gradient(135deg,#ef4444,#b91c1c)' }}>
                        <svg viewBox="0 0 24 24" className="w-8 h-8" fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round"><path d="M18 6L6 18M6 6l12 12" /></svg>
                      </div>
                      <div className="text-rose-400 font-extrabold text-lg">Ditolak</div>
                      {(doc.kasi_note || note) && <div className="text-[12px] text-slate-400 mt-1.5 rounded-lg bg-black/20 border border-white/10 p-2.5">"{doc.kasi_note || note}"</div>}
                    </div>
                  ) : (
                    <>
                      <div className="text-white font-bold text-sm mb-1">Persetujuan Kepala Seksi</div>
                      <div className="text-[11px] text-slate-400 mb-4">Tinjau dokumen{lamp.length ? ' & lampiran' : ''} di samping, lalu tandatangani.</div>
                      {!rejecting ? (
                        <>
                          <label className="block text-[11px] text-slate-400 mb-1">Nama Penandatangan</label>
                          <input value={name} onChange={(e) => setName(e.target.value)} className="w-full bg-black/30 border border-white/10 rounded-lg px-3 py-2.5 text-sm text-white mb-3 focus:border-sky-500/50 outline-none" placeholder="Nama Kepala Seksi" />
                          <label className="block text-[11px] text-slate-400 mb-1">NIP</label>
                          <input value={nip} onChange={(e) => setNip(e.target.value)} className="w-full bg-black/30 border border-white/10 rounded-lg px-3 py-2.5 text-sm text-white mb-4 focus:border-sky-500/50 outline-none" placeholder="NIP" />
                          <button onClick={() => submit('approve')} disabled={busy} className="w-full text-white rounded-xl px-4 py-3 text-sm font-bold disabled:opacity-50 shadow-lg shadow-emerald-900/40" style={{ background: 'linear-gradient(135deg,#22c55e,#16a34a)' }}>{busy ? 'Memproses…' : '🔏 Setujui & Tandatangani'}</button>
                          <button onClick={() => setRejecting(true)} disabled={busy} className="w-full mt-2 border border-rose-500/30 text-rose-400 rounded-xl px-4 py-2.5 text-sm hover:bg-rose-500/10 transition">Tolak Dokumen</button>
                          <div className="text-[10px] text-slate-500 mt-3 text-center leading-relaxed">Dengan menandatangani, Anda menyetujui dokumen ini secara elektronik (TTE) yang sah di sistem NetWatch.</div>
                        </>
                      ) : (
                        <>
                          <label className="block text-[11px] text-slate-400 mb-1">Alasan Penolakan (opsional)</label>
                          <textarea value={note} onChange={(e) => setNote(e.target.value)} className="w-full bg-black/30 border border-white/10 rounded-lg px-3 py-2.5 text-sm text-white mb-3 min-h-[80px] focus:border-rose-500/50 outline-none" placeholder="Tuliskan alasan / koreksi…" />
                          <button onClick={() => submit('reject')} disabled={busy} className="w-full bg-rose-500 hover:bg-rose-400 text-white rounded-xl px-4 py-3 text-sm font-bold disabled:opacity-50">{busy ? 'Memproses…' : 'Kirim Penolakan'}</button>
                          <button onClick={() => setRejecting(false)} disabled={busy} className="w-full mt-2 border border-white/15 text-slate-300 rounded-xl px-4 py-2.5 text-sm">Batal</button>
                        </>
                      )}
                    </>
                  )}
                </div>
              </div>

              {/* Lampiran kecil di bawah card pengesahan */}
              {lamp.length > 0 && (
                <div className="bg-[#0d1526] border border-white/10 rounded-2xl p-3.5">
                  <div className="text-slate-400 text-[10px] uppercase tracking-wide mb-2">📎 Lampiran Bukti Dukung ({lamp.length})</div>
                  <div className="grid grid-cols-4 gap-2">
                    {lamp.map((l, i) => {
                      const img = (l.mimetype || '').startsWith('image');
                      const active = slide === i + 1;
                      return (
                        <button key={l.id} onClick={() => setSlide(i + 1)} title={l.filename || ''}
                          className={`block rounded-lg overflow-hidden border bg-black/20 ${active ? 'border-sky-400 ring-1 ring-sky-400' : 'border-white/10 hover:border-white/30'}`}>
                          {img ? <img src={l.file_url} className="w-full h-12 object-cover" alt="" /> : <div className="h-12 flex items-center justify-center text-lg">📄</div>}
                        </button>
                      );
                    })}
                  </div>
                  <div className="text-[9px] text-slate-500 mt-2">Klik untuk menampilkan di pratinjau.</div>
                </div>
              )}

              <div className="text-center text-[10px] text-slate-600">🔒 Diamankan HMAC-SHA256 · NetWatch</div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
