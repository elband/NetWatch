import { useEffect, useState } from 'react';
import { api } from '../api/client';

// Halaman publik (tanpa login): ditautkan dari QR yang ditempel di box/mesin AAB.
// Alur: scan → GET /aset/public/:token (info alat) → isi form → POST /aset/loan/:token.
interface AssetInfo { id: number; name: string; merk?: string | null; model?: string | null; loc?: string | null; unit_name?: string | null; op_status?: string | null }

const empty = { borrower_name: '', borrower_unit: '', borrower_phone: '', purpose: '', loan_date: '', expected_return: '' };

function Icon({ name, size = 18 }: { name: string; size?: number }) {
  const c = { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };
  switch (name) {
    case 'box': return <svg {...c}><path d="M21 8 12 3 3 8v8l9 5 9-5V8Z" /><path d="M3 8l9 5 9-5M12 13v8" /></svg>;
    case 'user': return <svg {...c}><circle cx="12" cy="8" r="4" /><path d="M4 21c0-4 4-6 8-6s8 2 8 6" /></svg>;
    case 'phone': return <svg {...c}><path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2Z" /></svg>;
    case 'flag': return <svg {...c}><path d="M5 21V4M5 4h11l-2 4 2 4H5" /></svg>;
    case 'doc': return <svg {...c}><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8l-5-5Z" /><path d="M14 3v5h5" /></svg>;
    case 'cal': return <svg {...c}><rect x="3" y="4" width="18" height="17" rx="2" /><path d="M8 2v4M16 2v4M3 10h18" /></svg>;
    case 'check': return <svg {...c}><path d="M20 6 9 17l-5-5" /></svg>;
    case 'send': return <svg {...c}><path d="M22 2 11 13M22 2l-7 20-4-9-9-4 20-7Z" /></svg>;
    default: return null;
  }
}

export default function Pinjam() {
  const token = new URLSearchParams(window.location.search).get('alat') || '';
  const [asset, setAsset] = useState<AssetInfo | null>(null);
  const [loadErr, setLoadErr] = useState('');
  const [form, setForm] = useState(empty);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (!token) { setLoadErr('Kode QR tidak ditemukan. Pindai ulang stiker di alat.'); return; }
    api.get(`/aset/public/${encodeURIComponent(token)}`)
      .then((r) => setAsset(r.data.asset))
      .catch((e) => setLoadErr(e?.response?.data?.error || 'Alat tidak ditemukan.'));
  }, [token]);

  async function submit() {
    if (!form.borrower_name.trim()) { setError('Nama peminjam wajib diisi.'); return; }
    if (!form.loan_date) { setError('Tanggal pinjam wajib diisi.'); return; }
    setBusy(true); setError('');
    try {
      await api.post(`/aset/loan/${encodeURIComponent(token)}`, form);
      setDone(true);
    } catch (e: any) { setError(e?.response?.data?.error || 'Gagal mengirim permohonan.'); }
    finally { setBusy(false); }
  }

  const card = 'rounded-3xl border border-white/10 bg-[#0f0d20]/70 backdrop-blur-sm shadow-[0_8px_40px_-12px_rgba(16,185,129,0.35)]';
  const fieldBox = 'flex items-center gap-3 rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3 focus-within:border-emerald-400/50 transition-colors';
  const iconBox = 'shrink-0 w-9 h-9 rounded-xl bg-white/5 text-emerald-300 flex items-center justify-center';
  const label = 'text-[11px] text-slate-400';
  const inp = 'w-full bg-transparent text-[14px] font-medium text-white placeholder-slate-600 outline-none';

  return (
    <div className="min-h-screen p-4 sm:p-6 text-white" style={{ background: 'radial-gradient(1100px 650px at 50% -12%, #0c3325 0%, #0a1a1a 46%, #06060f 100%)' }}>
      <div className="max-w-lg mx-auto">
        {/* Header */}
        <div className="flex items-center gap-4 mb-5">
          <div className="w-12 h-12 rounded-2xl flex items-center justify-center shadow-lg shrink-0" style={{ background: 'linear-gradient(135deg,#10b981,#22d3ee)' }}>
            <Icon name="box" size={22} />
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-[22px] leading-tight font-extrabold tracking-tight">Peminjaman Peralatan</div>
            <div className="text-[12px] text-slate-400">Alat-Alat Besar • Bandara A.P.T Pranoto</div>
          </div>
        </div>

        {loadErr && !asset && (
          <div className={`${card} p-6 text-center`}>
            <div className="text-rose-400 font-semibold">{loadErr}</div>
          </div>
        )}

        {asset && (
          <>
            {/* Banner alat */}
            <div className="rounded-3xl border border-emerald-400/25 bg-gradient-to-br from-emerald-500/10 to-cyan-500/5 p-5 mb-4">
              <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-emerald-300"><Icon name="box" size={14} /> Alat (dari QR)</div>
              <div className="text-[22px] font-bold mt-1 leading-tight">{asset.name}</div>
              <div className="text-[12px] text-slate-400 mt-0.5">{[asset.merk, asset.model].filter(Boolean).join(' ')}{asset.unit_name ? ` • ${asset.unit_name}` : ''}{asset.loc ? ` • ${asset.loc}` : ''}</div>
            </div>

            <div className={`${card} p-5 sm:p-6`}>
              {done ? (
                <div className="text-center py-6">
                  <div className="w-16 h-16 mx-auto rounded-full flex items-center justify-center bg-emerald-500/15 text-emerald-300 mb-3"><Icon name="check" size={34} /></div>
                  <div className="text-emerald-300 font-bold text-xl">Permohonan Terkirim!</div>
                  <div className="text-[13px] text-slate-400 mt-1 max-w-xs mx-auto">Menunggu persetujuan koordinator Alat-Alat Besar. Ambil alat setelah disetujui.</div>
                </div>
              ) : (
                <>
                  <div className="flex items-center gap-3 mb-5">
                    <div className="w-11 h-11 rounded-2xl flex items-center justify-center text-white shadow-lg" style={{ background: 'linear-gradient(135deg,#059669,#0891b2)' }}><Icon name="box" size={22} /></div>
                    <div>
                      <div className="text-[17px] font-bold leading-tight">Formulir Peminjaman</div>
                      <div className="text-[12px] text-slate-400">Isi data peminjam untuk mengajukan</div>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div className={`${fieldBox} sm:col-span-2`}>
                      <div className={iconBox}><Icon name="user" /></div>
                      <div className="min-w-0 flex-1"><div className={label}>Nama Peminjam <span className="text-rose-400">*</span></div>
                        <input className={inp} placeholder="Nama lengkap" value={form.borrower_name} onChange={(e) => setForm({ ...form, borrower_name: e.target.value })} /></div>
                    </div>
                    <div className={fieldBox}>
                      <div className={iconBox}><Icon name="flag" /></div>
                      <div className="min-w-0 flex-1"><div className={label}>Unit / Instansi</div>
                        <input className={inp} placeholder="mis. Bagian Umum" value={form.borrower_unit} onChange={(e) => setForm({ ...form, borrower_unit: e.target.value })} /></div>
                    </div>
                    <div className={fieldBox}>
                      <div className={iconBox}><Icon name="phone" /></div>
                      <div className="min-w-0 flex-1"><div className={label}>No. HP/WA</div>
                        <input className={inp} inputMode="tel" placeholder="08xxxxxxxxxxx" value={form.borrower_phone} onChange={(e) => setForm({ ...form, borrower_phone: e.target.value })} /></div>
                    </div>
                    <div className={`${fieldBox} sm:col-span-2 items-start`}>
                      <div className={`${iconBox} mt-0.5`}><Icon name="doc" /></div>
                      <div className="min-w-0 flex-1"><div className={label}>Keperluan</div>
                        <textarea className={`${inp} resize-none min-h-[60px] mt-0.5`} maxLength={255} placeholder="Tujuan penggunaan alat…" value={form.purpose} onChange={(e) => setForm({ ...form, purpose: e.target.value })} /></div>
                    </div>
                    <div className={fieldBox}>
                      <div className={iconBox}><Icon name="cal" /></div>
                      <div className="min-w-0 flex-1"><div className={label}>Tgl. Pinjam <span className="text-rose-400">*</span></div>
                        <input type="date" className={`${inp} [color-scheme:dark]`} value={form.loan_date} onChange={(e) => setForm({ ...form, loan_date: e.target.value })} /></div>
                    </div>
                    <div className={fieldBox}>
                      <div className={iconBox}><Icon name="cal" /></div>
                      <div className="min-w-0 flex-1"><div className={label}>Rencana Kembali</div>
                        <input type="date" className={`${inp} [color-scheme:dark]`} value={form.expected_return} onChange={(e) => setForm({ ...form, expected_return: e.target.value })} /></div>
                    </div>
                  </div>

                  {error && <div className="mt-3 text-[12px] text-rose-400">⚠️ {error}</div>}

                  <button onClick={submit} disabled={busy} className="w-full mt-4 rounded-2xl px-5 py-4 flex items-center gap-4 text-left text-white font-bold shadow-lg disabled:opacity-50 transition-opacity" style={{ background: 'linear-gradient(135deg,#059669,#0891b2)' }}>
                    <Icon name="send" size={22} />
                    <span className="flex-1">
                      <span className="block text-[15px]">{busy ? 'Mengirim…' : 'Ajukan Peminjaman'}</span>
                      <span className="block text-[11px] font-normal opacity-80">Permohonan diteruskan ke koordinator untuk disetujui</span>
                    </span>
                  </button>
                </>
              )}
            </div>
          </>
        )}

        <div className="flex items-center justify-center gap-1.5 text-[11px] text-slate-600 mt-5">
          <span aria-hidden>🔒</span> Tanpa login • Peminjaman diproses oleh koordinator Alat-Alat Besar
        </div>
      </div>
    </div>
  );
}
