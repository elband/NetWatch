import { useEffect, useState } from 'react';
import { api } from '../api/client';

interface Result {
  valid: boolean;
  jenis?: string;
  token?: string;
  // LKP
  incident_id?: string;
  device_name?: string;
  ip?: string;
  issue?: string;
  priority?: string;
  resolved_at?: string;
  hasil?: string;
  reporter_name?: string;
  // Surat / Nota Dinas
  nomor?: string;
  hal?: string;
  tanggal?: string;
  creator_name?: string;
  // Umum
  signer_name?: string;
  signer_nip?: string;
  signed_at?: string;
}

const fmtDate = (s?: string) => {
  if (!s) return '-';
  const d = new Date(s.replace(' ', 'T'));
  if (isNaN(d.getTime())) return s;
  return d.toLocaleString('id-ID', { day: '2-digit', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' });
};

export default function VerifyTte() {
  const token = new URLSearchParams(window.location.search).get('token') || '';
  const [res, setRes] = useState<Result | null>(null);
  const [loading, setLoading] = useState(true);
  const [mounted, setMounted] = useState(false);
  const [copied, setCopied] = useState(false);
  const [autoDone, setAutoDone] = useState(false);

  useEffect(() => {
    if (!token) { setLoading(false); return; }
    api.get(`/verify-tte/${encodeURIComponent(token)}`)
      .then((r) => setRes(r.data))
      .catch(() => setRes({ valid: false }))
      .finally(() => { setLoading(false); setTimeout(() => setMounted(true), 30); });
  }, [token]);

  const ok = res?.valid;
  const pdfUrl = token ? `/api/verify-tte/${encodeURIComponent(token)}/document.pdf` : '';

  // Unduh PDF dokumen. Nama file diambil dari header Content-Disposition server.
  function downloadPdf() {
    if (!pdfUrl) return;
    const a = document.createElement('a');
    a.href = pdfUrl;
    a.rel = 'noopener';
    a.setAttribute('download', '');
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  // Saat dokumen valid → langsung unduh otomatis sekali (fallback: tombol di bawah).
  useEffect(() => {
    if (ok && !autoDone) { setAutoDone(true); downloadPdf(); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ok]);
  const isLkp = res?.jenis === 'LKP';
  const signer = `${res?.signer_name || '-'}${res?.signer_nip ? ` · NIP ${res.signer_nip}` : ''}`;

  const rows: [string, string, string][] = ok
    ? isLkp
      ? [
          ['🔖', 'No. LKP / Insiden', res?.incident_id || '-'],
          ['🖥️', 'Peralatan', res?.device_name || '-'],
          ['⚠️', 'Masalah', res?.issue || '-'],
          ['✅', 'Hasil', res?.hasil || '-'],
          ['🧰', 'Dibuat oleh (Teknisi)', res?.reporter_name || '-'],
          ['🖊️', 'Disahkan oleh (Koordinator)', signer],
          ['🕒', 'Tanggal Pengesahan', fmtDate(res?.signed_at)],
        ]
      : [
          ['📑', 'Jenis Dokumen', res?.jenis || 'Surat'],
          ['🔢', 'Nomor', res?.nomor || '-'],
          ['📌', 'Hal / Perihal', res?.hal || '-'],
          ['✍️', 'Dibuat oleh', res?.creator_name || '-'],
          ['🖊️', 'Disahkan oleh', signer],
          ['🕒', 'Tanggal Pengesahan', fmtDate(res?.signed_at || res?.tanggal)],
        ]
    : [];

  function copyToken() {
    navigator.clipboard?.writeText(token).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); }).catch(() => {});
  }

  return (
    <div className="min-h-screen relative flex items-center justify-center p-4 overflow-hidden"
      style={{ background: 'radial-gradient(1200px 600px at 50% -10%, #16243f 0%, #0b1220 45%, #070b14 100%)' }}>
      {/* Glow dekoratif */}
      <div className="pointer-events-none absolute -top-32 left-1/2 -translate-x-1/2 w-[560px] h-[560px] rounded-full blur-[120px] opacity-30"
        style={{ background: ok ? 'radial-gradient(circle,#22c55e,transparent 70%)' : '#334155' }} />

      <div className={`relative w-full max-w-md transition-all duration-500 ${mounted ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-3'}`}>
        {/* Cincin gradien */}
        <div className="rounded-[22px] p-[1.5px]" style={{ background: 'linear-gradient(160deg, rgba(96,165,250,.7), rgba(34,197,94,.35), rgba(255,255,255,.05))' }}>
          <div className="rounded-[21px] bg-[#0d1526]/95 backdrop-blur-xl overflow-hidden">
            {/* Header */}
            <div className="flex items-center gap-3 px-6 py-4 border-b border-white/10">
              <div className="w-10 h-10 rounded-xl flex items-center justify-center text-xl shadow-lg" style={{ background: 'linear-gradient(135deg,#3b82f6,#22d3ee)' }}>📡</div>
              <div>
                <div className="text-[15px] font-bold text-white tracking-tight">NetWatch ERP · Verifikasi TTE</div>
                <div className="text-[10px] text-slate-400">Enterprise Resource Planning for Airport Technology Operations</div>
              </div>
            </div>

            <div className="px-6 py-6">
              {loading ? (
                <div className="flex flex-col items-center gap-3 py-10 text-slate-400">
                  <div className="w-9 h-9 border-2 border-slate-600 border-t-sky-400 rounded-full animate-spin" />
                  <div className="text-sm">Memverifikasi keaslian dokumen…</div>
                </div>
              ) : !token ? (
                <div className="text-center py-10">
                  <div className="text-5xl mb-2">🔍</div>
                  <div className="text-amber-400 font-bold text-lg">Token Tidak Ditemukan</div>
                  <div className="text-[12px] text-slate-400 mt-1">URL tidak memuat token verifikasi. Pindai ulang QR pada dokumen.</div>
                </div>
              ) : ok ? (
                <>
                  {/* Hero status */}
                  <div className="flex flex-col items-center text-center mb-5">
                    <div className="relative mb-3">
                      <div className="absolute inset-0 rounded-full bg-emerald-500/30 blur-xl animate-pulse" />
                      <div className="relative w-20 h-20 rounded-full flex items-center justify-center" style={{ background: 'linear-gradient(135deg,#22c55e,#16a34a)' }}>
                        <svg viewBox="0 0 24 24" className="w-11 h-11" fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M20 6L9 17l-5-5" />
                        </svg>
                      </div>
                    </div>
                    <div className="text-2xl font-extrabold tracking-tight bg-clip-text text-transparent" style={{ backgroundImage: 'linear-gradient(90deg,#34d399,#22d3ee)' }}>Dokumen Sah</div>
                    <div className="text-[12px] text-slate-400 mt-1 max-w-[300px]">Dokumen ini terverifikasi ditandatangani secara elektronik & terdaftar resmi di sistem NetWatch.</div>
                    <span className="mt-3 inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[11px] font-semibold text-sky-300 bg-sky-500/10 border border-sky-500/30">
                      🛡️ {isLkp ? 'Laporan Kerusakan & Perbaikan (LKP)' : (res?.jenis || 'Surat Keluar')}
                    </span>
                  </div>

                  {/* Rincian */}
                  <div className="rounded-xl border border-white/10 bg-white/[.02] overflow-hidden">
                    {rows.map(([icon, k, v], i) => (
                      <div key={k} className={`flex gap-3 px-4 py-2.5 ${i ? 'border-t border-white/[.06]' : ''}`}>
                        <span className="text-base leading-5 w-5 shrink-0 text-center">{icon}</span>
                        <span className="text-slate-400 text-[12px] w-[150px] shrink-0">{k}</span>
                        <span className="text-slate-100 text-[12px] font-medium break-words flex-1">{v}</span>
                      </div>
                    ))}
                  </div>

                  {/* Token */}
                  <button onClick={copyToken} className="mt-4 w-full group flex items-center justify-between gap-2 rounded-xl border border-white/10 bg-black/20 px-4 py-2.5 hover:border-sky-500/40 transition">
                    <span className="text-[10px] uppercase tracking-wide text-slate-500 shrink-0">Token TTE</span>
                    <span className="font-mono text-[11px] text-emerald-300 break-all text-right flex-1">{token}</span>
                    <span className="text-[11px] text-slate-400 group-hover:text-sky-300 shrink-0">{copied ? '✓ disalin' : '📋'}</span>
                  </button>

                  {/* Unduh dokumen — otomatis saat halaman dibuka, tombol ini sebagai cadangan. */}
                  <button onClick={downloadPdf} className="mt-3 w-full flex items-center justify-center gap-2 rounded-xl bg-sky-500/15 border border-sky-500/40 px-4 py-3 text-sky-200 text-[13px] font-semibold hover:bg-sky-500/25 transition">
                    ⬇️ Unduh Dokumen (PDF)
                  </button>
                  <div className="mt-1.5 text-center text-[10px] text-slate-500">Dokumen otomatis terunduh. Jika tidak, tekan tombol di atas.</div>
                </>
              ) : (
                <div className="text-center py-8">
                  <div className="relative inline-block mb-3">
                    <div className="absolute inset-0 rounded-full bg-rose-500/25 blur-xl" />
                    <div className="relative w-20 h-20 rounded-full flex items-center justify-center" style={{ background: 'linear-gradient(135deg,#ef4444,#b91c1c)' }}>
                      <svg viewBox="0 0 24 24" className="w-10 h-10" fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round"><path d="M18 6L6 18M6 6l12 12" /></svg>
                    </div>
                  </div>
                  <div className="text-rose-400 font-extrabold text-xl">Tidak Valid</div>
                  <div className="text-[12px] text-slate-400 mt-1 max-w-[300px] mx-auto">Token TTE tidak dikenali atau dokumen tidak terdaftar di sistem NetWatch. Pastikan QR dipindai dari dokumen asli.</div>
                  <div className="text-[10px] text-slate-500 font-mono mt-4 break-all bg-black/20 rounded-lg px-3 py-2">{token}</div>
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="px-6 py-3 border-t border-white/10 flex items-center justify-between text-[10px] text-slate-500">
              <span>🔒 Diamankan HMAC-SHA256</span>
              <span>netwatch.elektronika-bandara</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
