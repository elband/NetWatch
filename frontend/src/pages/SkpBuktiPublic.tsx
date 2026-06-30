import { useEffect, useState } from 'react';
import { api } from '../api/client';

interface Snapshot { source: string; sourceLabel: string; title: string; period: string | null; summary: { label: string; value: string | number }[]; columns: string[]; rows: (string | number)[][]; generatedAt: string }
interface Bukti { id: number; deskripsi: string; kind: string; url: string | null; file_url: string | null; snapshot?: Snapshot | null; created_at?: string }
interface Ind { aspek: string; indikator: string }
interface SkpInfo { periode: string; tahun: number; pegawai_nama: string | null; pegawai_nip: string | null; pegawai_jabatan: string | null }
interface LaporanBulanan { nomor: string; hal: string; pdf_url: string; verify_url: string; koordinator: { nama: string | null; signed_at: string | null }; kasi: { nama: string | null; signed_at: string | null } }

const fmtGen = (s?: string) => { if (!s) return ''; const d = new Date(s); return isNaN(d.getTime()) ? '' : d.toLocaleString('id-ID', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }); };

export default function SkpBuktiPublic() {
  const token = new URLSearchParams(window.location.search).get('token') || '';
  const [data, setData] = useState<{ bukti: Bukti; indikator: Ind | null; skp: SkpInfo | null; laporanBulanan?: LaporanBulanan | null } | null>(null);
  const [loading, setLoading] = useState(true);
  const [valid, setValid] = useState(false);

  useEffect(() => {
    if (!token) { setLoading(false); return; }
    api.get(`/skp/bukti/public/${encodeURIComponent(token)}`)
      .then((r) => { setData(r.data); setValid(!!r.data.valid); })
      .catch(() => setValid(false))
      .finally(() => setLoading(false));
  }, [token]);

  const b = data?.bukti;
  const fileAbs = b?.file_url ? `${window.location.origin}${b.file_url}` : '';
  const snap = b?.kind === 'data' ? b.snapshot : null;

  return (
    <div className="min-h-screen flex items-center justify-center p-4"
      style={{ background: 'radial-gradient(1200px 600px at 50% -10%, #16243f 0%, #0b1220 45%, #070b14 100%)' }}>
      <div className={`w-full ${snap ? 'max-w-3xl' : 'max-w-md'}`}>
        <div className="rounded-[22px] p-[1.5px]" style={{ background: 'linear-gradient(160deg, rgba(96,165,250,.7), rgba(34,197,94,.35), rgba(255,255,255,.05))' }}>
          <div className="rounded-[21px] bg-[#0d1526]/95 backdrop-blur-xl overflow-hidden">
            <div className="flex items-center gap-3 px-6 py-4 border-b border-white/10">
              <div className="w-10 h-10 rounded-xl flex items-center justify-center text-xl shadow-lg" style={{ background: 'linear-gradient(135deg,#3b82f6,#22d3ee)' }}>{snap ? '📊' : '📎'}</div>
              <div>
                <div className="text-[15px] font-bold text-white tracking-tight">NetWatch ERP · Bukti Dukung SKP</div>
                <div className="text-[10px] text-slate-400">{snap ? 'Data resmi terverifikasi dari sistem NetWatch' : 'Verifikasi bukti data dukung kinerja'}</div>
              </div>
            </div>

            <div className="px-6 py-6">
              {loading ? (
                <div className="flex flex-col items-center gap-3 py-10 text-slate-400">
                  <div className="w-9 h-9 border-2 border-slate-600 border-t-sky-400 rounded-full animate-spin" />
                  <div className="text-sm">Memuat bukti dukung…</div>
                </div>
              ) : !valid || !b ? (
                <div className="text-center py-8">
                  <div className="text-5xl mb-2">🔍</div>
                  <div className="text-rose-400 font-extrabold text-xl">Tidak Ditemukan</div>
                  <div className="text-[12px] text-slate-400 mt-1">Tautan bukti dukung tidak dikenali atau telah dihapus.</div>
                </div>
              ) : snap ? (
                /* ===== Bukti tipe DATA: snapshot beku ===== */
                <>
                  <div className="text-center mb-4">
                    <div className="text-lg font-extrabold text-white">{snap.title}</div>
                    {data?.indikator && <div className="text-[11px] text-slate-400 mt-1">{data.indikator.aspek} · {data.indikator.indikator}</div>}
                    {data?.skp && <div className="text-[11px] text-slate-400">{data.skp.pegawai_nama || '-'}{data.skp.pegawai_nip ? ` · NIP ${data.skp.pegawai_nip}` : ''} · SKP {data.skp.periode} {data.skp.tahun}</div>}
                  </div>

                  {snap.summary.length > 0 && (
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-4">
                      {snap.summary.map((s, i) => (
                        <div key={i} className="rounded-lg border border-white/10 bg-white/[.03] px-3 py-2 text-center">
                          <div className="text-[15px] font-bold text-sky-300">{s.value}</div>
                          <div className="text-[10px] text-slate-400 mt-0.5">{s.label}</div>
                        </div>
                      ))}
                    </div>
                  )}

                  {snap.columns.length > 0 && (
                    <div className="rounded-xl border border-white/10 overflow-hidden overflow-x-auto">
                      <table className="w-full text-[11px] border-collapse">
                        <thead>
                          <tr className="bg-white/[.05] text-slate-300">
                            {snap.columns.map((c, i) => <th key={i} className="text-left px-3 py-2 font-semibold whitespace-nowrap">{c}</th>)}
                          </tr>
                        </thead>
                        <tbody>
                          {snap.rows.length === 0 ? (
                            <tr><td colSpan={snap.columns.length} className="px-3 py-4 text-center text-slate-500">Tidak ada data pada periode ini.</td></tr>
                          ) : snap.rows.map((row, ri) => (
                            <tr key={ri} className="border-t border-white/[.06] text-slate-200">
                              {row.map((cell, ci) => <td key={ci} className="px-3 py-1.5 align-top">{cell}</td>)}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                  <div className="mt-3 text-center text-[10px] text-slate-500">📸 Snapshot data dibekukan pada {fmtGen(snap.generatedAt)} · sumber: {snap.sourceLabel}</div>
                </>
              ) : (
                /* ===== Bukti tautan / berkas ===== */
                <>
                  <div className="flex flex-col items-center text-center mb-5">
                    <div className="relative mb-3">
                      <div className="absolute inset-0 rounded-full bg-emerald-500/30 blur-xl" />
                      <div className="relative w-16 h-16 rounded-full flex items-center justify-center text-3xl" style={{ background: 'linear-gradient(135deg,#22c55e,#16a34a)' }}>📄</div>
                    </div>
                    <div className="text-lg font-extrabold text-white">{b.deskripsi}</div>
                    {data?.indikator && <div className="text-[11px] text-slate-400 mt-1">{data.indikator.aspek} · {data.indikator.indikator}</div>}
                  </div>

                  <div className="rounded-xl border border-white/10 bg-white/[.02] overflow-hidden text-[12px]">
                    {data?.skp && (
                      <>
                        <Row k="Pegawai" v={data.skp.pegawai_nama || '-'} />
                        <Row k="NIP" v={data.skp.pegawai_nip || '-'} />
                        <Row k="Jabatan" v={data.skp.pegawai_jabatan || '-'} />
                        <Row k="Periode SKP" v={`${data.skp.periode} · ${data.skp.tahun}`} />
                      </>
                    )}
                  </div>

                  {b.url && (
                    <a href={b.url} target="_blank" rel="noreferrer" className="mt-3 w-full flex items-center justify-center gap-2 rounded-xl bg-sky-500/15 border border-sky-500/40 px-4 py-3 text-sky-200 text-[13px] font-semibold hover:bg-sky-500/25 transition">
                      🔗 Buka Tautan Bukti
                    </a>
                  )}
                  {fileAbs && (
                    <a href={fileAbs} target="_blank" rel="noreferrer" className="mt-2.5 w-full flex items-center justify-center gap-2 rounded-xl bg-emerald-500/15 border border-emerald-500/40 px-4 py-3 text-emerald-200 text-[13px] font-semibold hover:bg-emerald-500/25 transition">
                      📄 Buka / Unduh Berkas
                    </a>
                  )}
                  {!b.url && !fileAbs && <div className="text-center text-[11px] text-slate-500 mt-3">Bukti ini berupa keterangan tanpa lampiran berkas/tautan.</div>}
                </>
              )}

              {/* Dokumen resmi Laporan Bulanan ber-TTE (Koordinator + Kepala Seksi) bulan ini */}
              {!loading && valid && b && data?.laporanBulanan && (
                <div className="mt-4 rounded-xl border border-emerald-500/30 bg-emerald-500/[.06] p-3">
                  <div className="text-[11px] text-emerald-300 font-semibold mb-0.5">📄 Dokumen Resmi Laporan Bulanan (TTE)</div>
                  <div className="text-[10px] text-slate-400 mb-2">No. {data.laporanBulanan.nomor} · ditandatangani elektronik oleh Koordinator ({data.laporanBulanan.koordinator.nama || '-'}) &amp; Kepala Seksi ({data.laporanBulanan.kasi.nama || '-'}).</div>
                  <a href={`${window.location.origin}${data.laporanBulanan.pdf_url}`} target="_blank" rel="noreferrer" className="w-full flex items-center justify-center gap-2 rounded-xl bg-emerald-500/15 border border-emerald-500/40 px-4 py-3 text-emerald-200 text-[13px] font-semibold hover:bg-emerald-500/25 transition">
                    ⬇️ Unduh Dokumen PDF (TTE Kasi &amp; Koordinator)
                  </a>
                </div>
              )}
            </div>

            <div className="px-6 py-3 border-t border-white/10 flex items-center justify-between text-[10px] text-slate-500">
              <span>🔒 NetWatch ERP</span>
              <span>netwatch.elektronika-bandara</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex gap-3 px-4 py-2.5 border-b border-white/[.06] last:border-0">
      <span className="text-slate-400 w-[110px] shrink-0">{k}</span>
      <span className="text-slate-100 font-medium break-words flex-1">{v}</span>
    </div>
  );
}
