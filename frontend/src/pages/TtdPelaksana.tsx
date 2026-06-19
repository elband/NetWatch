import { useEffect, useState } from 'react';
import { api } from '../api/client';

interface PelaksanaResp {
  valid: boolean;
  doc?: { nomor: string; hal: string; jenis: string; tanggal: string };
  pelaksana?: { nama: string; nip: string | null; mulai: string; selesai: string; signed_at: string | null; sign_token: string | null };
}

export default function TtdPelaksana() {
  const token = new URLSearchParams(window.location.search).get('token') || '';
  const [r, setR] = useState<PelaksanaResp | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    if (!token) { setLoading(false); return; }
    api.get(`/surat/pelaksana-sign/${encodeURIComponent(token)}`)
      .then((res) => setR(res.data))
      .catch(() => setR({ valid: false }))
      .finally(() => { setLoading(false); setTimeout(() => setMounted(true), 30); });
  }, [token]);

  async function sign() {
    if (!window.confirm('Konfirmasi: Anda akan menandatangani dokumen ini secara elektronik atas nama Anda sendiri. Lanjutkan?')) return;
    setBusy(true);
    try {
      await api.post(`/surat/pelaksana-sign/${encodeURIComponent(token)}`, {});
      setDone(true);
    } catch (e: any) {
      alert(e?.response?.data?.error || 'Gagal menandatangani. Coba lagi.');
    } finally {
      setBusy(false);
    }
  }

  const fmtTgl = (s?: string | null) => {
    if (!s) return '-';
    const d = new Date(s.replace(' ', 'T'));
    return isNaN(d.getTime()) ? s : d.toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' });
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center">
        <div className="text-slate-400 text-sm animate-pulse">Memuat dokumen…</div>
      </div>
    );
  }

  if (!r?.valid || !r.doc || !r.pelaksana) {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center p-6">
        <div className="bg-slate-900 border border-slate-700 rounded-2xl p-8 max-w-sm w-full text-center">
          <div className="text-4xl mb-4">❌</div>
          <div className="text-white font-semibold text-lg mb-2">Tautan Tidak Valid</div>
          <div className="text-slate-400 text-sm">Token tidak ditemukan atau sudah kadaluarsa.</div>
        </div>
      </div>
    );
  }

  const { doc, pelaksana } = r;
  const alreadySigned = !!pelaksana.signed_at || done;

  return (
    <div className="min-h-screen bg-slate-950 flex items-center justify-center p-4">
      <div
        className="bg-slate-900 border border-slate-700 rounded-2xl w-full max-w-md shadow-2xl overflow-hidden"
        style={{ opacity: mounted ? 1 : 0, transform: mounted ? 'translateY(0)' : 'translateY(12px)', transition: 'opacity .35s ease, transform .35s ease' }}
      >
        {/* Header */}
        <div className="bg-gradient-to-r from-blue-900/60 to-slate-800/60 px-6 py-5 border-b border-slate-700">
          <div className="text-[10px] uppercase tracking-widest text-blue-400 font-semibold mb-1">Tanda Tangan Elektronik</div>
          <div className="text-white font-bold text-lg leading-tight">{doc.jenis}</div>
          <div className="text-slate-300 text-sm font-mono mt-0.5">{doc.nomor}</div>
        </div>

        <div className="px-6 py-5 space-y-4">
          {/* Dokumen info */}
          <div className="bg-slate-800/60 rounded-xl p-4 space-y-2 text-sm">
            <div className="flex gap-2"><span className="text-slate-400 w-20 shrink-0">Hal</span><span className="text-white font-medium">{doc.hal}</span></div>
            <div className="flex gap-2"><span className="text-slate-400 w-20 shrink-0">Tanggal</span><span className="text-slate-200">{fmtTgl(doc.tanggal)}</span></div>
          </div>

          {/* Identitas pelaksana */}
          <div className="bg-blue-900/20 border border-blue-700/30 rounded-xl p-4 space-y-2 text-sm">
            <div className="text-blue-300 text-[11px] font-semibold uppercase tracking-wide mb-2">Identitas Penandatangan</div>
            <div className="flex gap-2"><span className="text-slate-400 w-20 shrink-0">Nama</span><span className="text-white font-semibold">{pelaksana.nama}</span></div>
            {pelaksana.nip && <div className="flex gap-2"><span className="text-slate-400 w-20 shrink-0">NIP</span><span className="text-slate-200 font-mono text-xs">{pelaksana.nip}</span></div>}
            <div className="flex gap-2"><span className="text-slate-400 w-20 shrink-0">Jam</span><span className="text-slate-200">{pelaksana.mulai} – {pelaksana.selesai} WITA</span></div>
          </div>

          {/* Status */}
          {alreadySigned ? (
            <div className="bg-emerald-900/30 border border-emerald-600/40 rounded-xl p-5 text-center">
              <div className="text-4xl mb-2">✅</div>
              <div className="text-emerald-400 font-bold text-base">Sudah Ditandatangani</div>
              {pelaksana.signed_at && (
                <div className="text-slate-400 text-xs mt-1">
                  {new Date(pelaksana.signed_at).toLocaleString('id-ID', { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
                </div>
              )}
              {(pelaksana.sign_token) && (
                <div className="mt-2 text-[10px] text-slate-500 font-mono break-all">Token: {pelaksana.sign_token}</div>
              )}
            </div>
          ) : (
            <div className="space-y-3">
              <p className="text-slate-400 text-xs leading-relaxed">
                Dengan menekan tombol di bawah, Anda menyatakan bahwa informasi di atas adalah benar dan Anda menyetujui penandatanganan dokumen ini secara elektronik.
              </p>
              <button
                onClick={sign}
                disabled={busy}
                className="w-full bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white font-bold py-3 rounded-xl text-sm transition-colors"
              >
                {busy ? '⏳ Memproses…' : '✍️ Tanda Tangani Sekarang'}
              </button>
            </div>
          )}
        </div>

        <div className="px-6 pb-5 text-center text-[10px] text-slate-600">
          NetWatch · Sistem Manajemen Infrastruktur Bandara
        </div>
      </div>
    </div>
  );
}
