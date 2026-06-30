import { useEffect, useState } from 'react';
import { api } from '../api/client';

interface PubBukti { id: number; deskripsi: string; kind?: string; url: string | null; file_url: string | null; public_token: string | null }
interface PubInd { id: number; aspek: string; indikator: string; target: string | null; renaksi: string | null; realisasi: string | null; feedback: string | null; bukti: PubBukti[] }
interface PubRhk { id: number; klasifikasi: string; rhk: string; indikator: PubInd[] }
interface PubSkp {
  periode: string; tahun: number; pendekatan: string;
  pegawai_nama: string | null; pegawai_nip: string | null; pegawai_jabatan: string | null; pegawai_unit: string | null;
  penilai_nama: string | null; penilai_nip: string | null; penilai_jabatan: string | null;
  bulan: string; months: string[]; bulanInfo: { bulan: string; status: string; tanggal_pengajuan: string | null }; rhk: PubRhk[];
}

const BULAN_ID =['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];
const monthLabel = (m?: string) => { if (!m) return '-'; const [y, mo] = m.split('-'); return `${BULAN_ID[Number(mo) - 1]} ${y}`; };
const aspekCls = (a: string) =>
  a === 'Kuantitas' ? 'text-sky-700 bg-sky-100'
  : a === 'Waktu' ? 'text-amber-700 bg-amber-100'
  : a === 'Kualitas' ? 'text-emerald-700 bg-emerald-100'
  : 'text-slate-600 bg-slate-100';

export default function SkpPublic() {
  const params = new URLSearchParams(window.location.search);
  const token = params.get('token') || '';
  const [bulan, setBulan] = useState(params.get('bulan') || '');
  const [skp, setSkp] = useState<PubSkp | null>(null);
  const [lb, setLb] = useState<{ nomor: string; pdf_url: string; koordinator: { nama: string | null }; kasi: { nama: string | null } } | null>(null);
  const [loading, setLoading] = useState(true);
  const [valid, setValid] = useState(false);

  useEffect(() => {
    if (!token) { setLoading(false); return; }
    setLoading(true);
    api.get(`/skp/public/${encodeURIComponent(token)}`, { params: bulan ? { bulan } : {} })
      .then((r) => { setSkp(r.data.skp); setLb(r.data.laporanBulanan || null); setValid(!!r.data.valid); if (!bulan && r.data.skp?.bulan) setBulan(r.data.skp.bulan); })
      .catch(() => setValid(false))
      .finally(() => setLoading(false));
  }, [token, bulan]);

  const buktiUrl = (t: string) => `${window.location.origin}/skp-bukti?token=${t}`;
  const monthsOfYear = (tahun: number) => Array.from({ length: 12 }, (_, i) => `${tahun}-${String(i + 1).padStart(2, '0')}`);

  return (
    <div className="min-h-screen bg-slate-100 text-slate-800">
      {/* Header bar */}
      <div className="bg-[#0d1526] text-white">
        <div className="max-w-4xl mx-auto px-5 py-4 flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl flex items-center justify-center text-lg shadow" style={{ background: 'linear-gradient(135deg,#3b82f6,#22d3ee)' }}>📡</div>
          <div>
            <div className="text-[14px] font-bold tracking-tight">NetWatch ERP · Sasaran Kinerja Pegawai</div>
            <div className="text-[10px] text-slate-400">Halaman publik — dapat dibagikan untuk verifikasi & penilaian</div>
          </div>
        </div>
      </div>

      <div className="max-w-4xl mx-auto px-4 py-6">
        {loading ? (
          <div className="text-center text-slate-500 py-20">Memuat SKP…</div>
        ) : !valid || !skp ? (
          <div className="bg-white rounded-xl shadow p-10 text-center">
            <div className="text-5xl mb-2">🔍</div>
            <div className="text-rose-600 font-bold text-lg">SKP Tidak Ditemukan</div>
            <div className="text-[12px] text-slate-500 mt-1">Tautan tidak valid atau SKP telah dihapus.</div>
          </div>
        ) : (
          <>
            {/* Identitas */}
            <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-5 mb-4">
              <div className="flex items-center justify-between flex-wrap gap-2">
                <h1 className="text-lg font-bold">SKP {skp.periode} · {skp.tahun}</h1>
                <select value={skp.bulan} onChange={(e) => setBulan(e.target.value)} className="bg-white border border-slate-300 rounded-md px-2 py-1 text-[12px]">
                  {monthsOfYear(skp.tahun).map((m) => <option key={m} value={m}>{BULAN_ID[Number(m.split('-')[1]) - 1]}{skp.months?.includes(m) ? ' ●' : ''}</option>)}
                </select>
              </div>
              <div className="text-[12px] text-slate-500 mt-0.5">Periode: <b>{monthLabel(skp.bulan)}</b> · Pendekatan: {skp.pendekatan}</div>
              <div className="grid sm:grid-cols-2 gap-3 mt-3">
                <div className="bg-slate-50 rounded-lg p-3 border border-slate-100">
                  <div className="text-[10px] uppercase tracking-wide text-slate-400 mb-1">Pegawai yang Dinilai</div>
                  <div className="text-[13px] font-semibold">{skp.pegawai_nama || '-'}</div>
                  <div className="text-[11px] text-slate-500">{skp.pegawai_jabatan || '-'}</div>
                  <div className="text-[11px] text-slate-500">NIP. {skp.pegawai_nip || '-'}</div>
                  <div className="text-[11px] text-slate-500">{skp.pegawai_unit || '-'}</div>
                </div>
                <div className="bg-slate-50 rounded-lg p-3 border border-slate-100">
                  <div className="text-[10px] uppercase tracking-wide text-slate-400 mb-1">Pejabat Penilai</div>
                  <div className="text-[13px] font-semibold">{skp.penilai_nama || '-'}</div>
                  <div className="text-[11px] text-slate-500">{skp.penilai_jabatan || '-'}</div>
                  <div className="text-[11px] text-slate-500">NIP. {skp.penilai_nip || '-'}</div>
                </div>
              </div>
              {lb && (
                <a href={`${window.location.origin}${lb.pdf_url}`} target="_blank" rel="noreferrer"
                  className="mt-3 flex items-center justify-center gap-2 rounded-lg bg-emerald-600 text-white px-4 py-2.5 text-[13px] font-semibold hover:bg-emerald-700 transition">
                  ⬇️ Unduh Laporan Bulanan {monthLabel(skp.bulan)} (PDF · TTE Kasi &amp; Koordinator)
                </a>
              )}
            </div>

            {/* RHK */}
            {skp.rhk.length === 0 ? (
              <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-8 text-center text-slate-400 text-sm">Belum ada RHK pada SKP ini.</div>
            ) : skp.rhk.map((r, ri) => (
              <div key={r.id} className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden mb-4">
                <div className="px-4 py-3 bg-slate-50 border-b border-slate-200">
                  <span className={`text-[9px] px-1.5 py-0.5 rounded mr-2 ${r.klasifikasi === 'utama' ? 'text-sky-700 bg-sky-100' : 'text-slate-500 bg-slate-100'}`}>{r.klasifikasi.toUpperCase()}</span>
                  <span className="text-[13px] font-semibold">RHK {ri + 1}.</span> <span className="text-[13px]">{r.rhk}</span>
                </div>
                <div className="p-4 space-y-4">
                  {r.indikator.map((ind) => (
                    <div key={ind.id} className="border border-slate-200 rounded-lg p-3">
                      <div>
                        <span className={`text-[9px] px-1.5 py-0.5 rounded mr-2 ${aspekCls(ind.aspek)}`}>{ind.aspek}</span>
                        <span className="text-[12.5px] font-medium">{ind.indikator}</span>
                        {ind.target && <div className="text-[11px] text-slate-500 mt-0.5">🎯 Target: {ind.target}</div>}
                      </div>
                      <div className="grid sm:grid-cols-2 gap-2 mt-2">
                        <PubField label="Rencana Aksi" value={ind.renaksi} />
                        <PubField label="Realisasi" value={ind.realisasi} />
                      </div>
                      {ind.bukti.length > 0 && (
                        <div className="mt-2.5 border-t border-slate-100 pt-2">
                          <div className="text-[11px] font-semibold text-slate-500 mb-1">📎 Bukti Data Dukung</div>
                          <ol className="space-y-1">
                            {ind.bukti.map((b, bi) => (
                              <li key={b.id} className="flex items-start gap-2 text-[11.5px]">
                                <span className="text-slate-400">{bi + 1}.</span>
                                <div className="flex-1 min-w-0">
                                  {b.kind === 'data' && <span className="text-[9px] px-1.5 py-0.5 rounded bg-indigo-100 text-indigo-700 mr-1.5">📊 Data Aplikasi</span>}
                                  <span>{b.deskripsi}</span>
                                  {(b.url || b.file_url) && (
                                    <span className="ml-2 inline-flex gap-2">
                                      {b.url && <a href={b.url} target="_blank" rel="noreferrer" className="text-sky-600 hover:underline">🔗 Tautan</a>}
                                      {b.file_url && <a href={b.file_url} target="_blank" rel="noreferrer" className="text-sky-600 hover:underline">📄 Berkas</a>}
                                    </span>
                                  )}
                                  {b.public_token && (
                                    <div className="mt-1 flex items-center gap-1.5 bg-slate-50 border border-slate-200 rounded px-2 py-1">
                                      <span className="text-[9px] text-slate-400 shrink-0">🌐 Link publik:</span>
                                      <a href={buktiUrl(b.public_token)} target="_blank" rel="noreferrer" className="text-indigo-600 font-mono text-[10px] break-all hover:underline">{buktiUrl(b.public_token)}</a>
                                    </div>
                                  )}
                                </div>
                              </li>
                            ))}
                          </ol>
                        </div>
                      )}
                    </div>
                  ))}
                  {r.indikator.length === 0 && <div className="text-[11px] text-slate-400 italic">Belum ada indikator.</div>}
                </div>
              </div>
            ))}
            <div className="text-center text-[10px] text-slate-400 mt-6">🔒 Dokumen ini disajikan oleh sistem NetWatch ERP · netwatch.elektronika-bandara</div>
          </>
        )}
      </div>
    </div>
  );
}

function PubField({ label, value, accent }: { label: string; value: string | null; accent?: boolean }) {
  return (
    <div className={`rounded-md border px-2.5 py-1.5 ${accent ? 'border-sky-200 bg-sky-50' : 'border-slate-200 bg-slate-50'}`}>
      <div className="text-[9px] uppercase tracking-wide text-slate-400 mb-0.5">{label}</div>
      <div className="text-[11.5px] whitespace-pre-wrap">{value || <span className="text-slate-400 italic">—</span>}</div>
    </div>
  );
}
