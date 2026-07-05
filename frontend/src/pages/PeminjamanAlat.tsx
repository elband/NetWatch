import { useCallback, useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { api } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { hasRole } from '../utils/roles';

interface AssetLite { id: number; name: string; merk: string | null; model: string | null; serial: string | null; loc: string | null; qr_token: string | null }

// Kelola peminjaman peralatan AAB: setujui / tolak permohonan, dan tandai kembali.
interface Loan {
  id: number; device_id: number; device_name: string; merk: string | null; serial: string | null;
  borrower_name: string; borrower_unit: string | null; borrower_phone: string | null; purpose: string | null;
  loan_date: string; expected_return: string | null;
  status: 'menunggu' | 'dipinjam' | 'dikembalikan' | 'ditolak';
  approver_name: string | null; approved_at: string | null; returned_at: string | null; note: string | null;
  created_at: string;
}

const STATUS_META: Record<Loan['status'], { label: string; cls: string }> = {
  menunggu: { label: '⏳ Menunggu', cls: 'text-warn bg-warn/10' },
  dipinjam: { label: '📤 Dipinjam', cls: 'text-accent bg-accent/10' },
  dikembalikan: { label: '✅ Dikembalikan', cls: 'text-success bg-success/10' },
  ditolak: { label: '⛔ Ditolak', cls: 'text-danger bg-danger/10' },
};
const FILTERS: { key: string; label: string }[] = [
  { key: 'menunggu', label: 'Menunggu' }, { key: 'dipinjam', label: 'Dipinjam' },
  { key: 'dikembalikan', label: 'Dikembalikan' }, { key: 'ditolak', label: 'Ditolak' }, { key: '', label: 'Semua' },
];
const fmtDate = (d: string | null) => d ? new Date(d).toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' }) : '–';

export default function PeminjamanAlat() {
  const { user } = useAuth();
  const canManage = hasRole(user, 'admin') || hasRole(user, 'koordinator');
  const [filter, setFilter] = useState('menunggu');
  const [loans, setLoans] = useState<Loan[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [showQr, setShowQr] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    api.get('/aset/loans', { params: filter ? { status: filter } : {} })
      .then((r) => setLoans(r.data.loans || []))
      .catch(() => setLoans([]))
      .finally(() => setLoading(false));
  }, [filter]);
  useEffect(() => { load(); }, [load]);

  async function act(id: number, action: 'approve' | 'reject' | 'return') {
    if (action === 'reject' && !confirm('Tolak permohonan peminjaman ini?')) return;
    setBusyId(id);
    try { await api.patch(`/aset/loans/${id}`, { action }); load(); }
    catch (e: any) { alert(e?.response?.data?.error || 'Gagal memproses.'); }
    finally { setBusyId(null); }
  }

  return (
    <div className="p-4 sm:p-6 max-w-5xl mx-auto">
      <div className="mb-4 flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-lg font-bold">📦 Peminjaman Peralatan</h1>
          <p className="text-[12px] text-text2">Permohonan peminjaman alat masuk lewat QR yang ditempel di alat. Setujui, tolak, atau tandai alat sudah dikembalikan.</p>
        </div>
        {canManage && (
          <button onClick={() => setShowQr(true)} className="shrink-0 bg-accent text-bg font-semibold rounded-md px-4 py-2 text-sm">🔳 QR Peminjaman</button>
        )}
      </div>

      <div className="flex flex-wrap gap-2 mb-4">
        {FILTERS.map((f) => (
          <button key={f.key} onClick={() => setFilter(f.key)}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold border ${filter === f.key ? 'bg-accent text-bg border-accent' : 'border-border text-text2 hover:text-text'}`}>
            {f.label}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="text-text2 text-sm py-10 text-center">Memuat…</div>
      ) : loans.length === 0 ? (
        <div className="text-text2 text-sm py-10 text-center border border-border rounded-xl">Tidak ada data peminjaman.</div>
      ) : (
        <div className="space-y-3">
          {loans.map((l) => {
            const sm = STATUS_META[l.status];
            return (
              <div key={l.id} className="border border-border rounded-xl bg-surface p-4">
                <div className="flex items-start justify-between gap-3 flex-wrap">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-bold text-[15px]">{l.device_name}</span>
                      <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${sm.cls}`}>{sm.label}</span>
                    </div>
                    <div className="text-[12px] text-text2 mt-0.5">{[l.merk, l.serial && `SN ${l.serial}`].filter(Boolean).join(' · ') || '—'}</div>
                  </div>
                  <div className="text-right text-[11px] text-text2">
                    <div>Pinjam: <b className="text-text">{fmtDate(l.loan_date)}</b></div>
                    {l.expected_return && <div>Rencana kembali: {fmtDate(l.expected_return)}</div>}
                  </div>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-1 mt-3 text-[12px]">
                  <div><span className="text-text2">Peminjam:</span> <b>{l.borrower_name}</b></div>
                  {l.borrower_unit && <div><span className="text-text2">Unit:</span> {l.borrower_unit}</div>}
                  {l.borrower_phone && <div><span className="text-text2">HP:</span> {l.borrower_phone}</div>}
                  {l.purpose && <div className="col-span-2 sm:col-span-3"><span className="text-text2">Keperluan:</span> {l.purpose}</div>}
                  {l.approver_name && <div className="col-span-2 sm:col-span-3 text-text2">Diproses oleh {l.approver_name}{l.approved_at ? ` · ${fmtDate(l.approved_at)}` : ''}</div>}
                  {l.returned_at && <div className="col-span-2 sm:col-span-3 text-success">Dikembalikan {fmtDate(l.returned_at)}</div>}
                </div>

                {canManage && (l.status === 'menunggu' || l.status === 'dipinjam') && (
                  <div className="flex gap-2 mt-3 pt-3 border-t border-border">
                    {l.status === 'menunggu' && (
                      <>
                        <button disabled={busyId === l.id} onClick={() => act(l.id, 'approve')} className="text-xs font-semibold bg-success/15 text-success border border-success/30 rounded-lg px-3 py-1.5 disabled:opacity-50">✅ Setujui</button>
                        <button disabled={busyId === l.id} onClick={() => act(l.id, 'reject')} className="text-xs font-semibold bg-danger/15 text-danger border border-danger/30 rounded-lg px-3 py-1.5 disabled:opacity-50">⛔ Tolak</button>
                      </>
                    )}
                    {l.status === 'dipinjam' && (
                      <button disabled={busyId === l.id} onClick={() => act(l.id, 'return')} className="text-xs font-semibold bg-accent/15 text-accent border border-accent/30 rounded-lg px-3 py-1.5 disabled:opacity-50">📥 Tandai Dikembalikan</button>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {showQr && <QrPinjamModal onClose={() => setShowQr(false)} />}
    </div>
  );
}

// Pilih alat → tampilkan & cetak QR peminjaman (URL publik /pinjam?alat=<token>).
function QrPinjamModal({ onClose }: { onClose: () => void }) {
  const [assets, setAssets] = useState<AssetLite[]>([]);
  const [sel, setSel] = useState<AssetLite | null>(null);
  const [dataUrl, setDataUrl] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get('/aset').then((r) => {
      const list: AssetLite[] = (r.data.assets || []).filter((a: AssetLite) => a.qr_token);
      setAssets(list);
      if (list.length) setSel(list[0]);
    }).catch(() => setAssets([])).finally(() => setLoading(false));
  }, []);

  const url = sel ? `${location.origin}/pinjam?alat=${sel.qr_token}` : '';
  useEffect(() => { if (url) QRCode.toDataURL(url, { width: 320, margin: 2 }).then(setDataUrl).catch(() => setDataUrl('')); }, [url]);

  function print() {
    if (!sel || !dataUrl) return;
    const w = window.open('', '_blank');
    if (!w) return;
    w.document.write(`<html><head><title>QR Peminjaman ${sel.name}</title><style>body{font-family:sans-serif;text-align:center;padding:24px}img{width:320px}h2{margin:8px 0 2px}p{color:#555;margin:2px 0;font-size:13px}</style></head><body><h2>${sel.name}</h2><p>${[sel.merk, sel.model].filter(Boolean).join(' ')}${sel.serial ? ` · SN ${sel.serial}` : ''}</p><img src="${dataUrl}"/><p>Scan untuk pinjam alat</p></body></html>`);
    w.document.close(); w.focus(); setTimeout(() => w.print(), 300);
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-surface border border-border rounded-xl w-full max-w-sm p-5 text-center" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-bold">🔳 QR Peminjaman Alat</h3>
          <button className="text-text2 hover:text-text text-lg" onClick={onClose}>×</button>
        </div>
        {loading ? <div className="text-text2 text-sm py-10">Memuat aset…</div> : assets.length === 0 ? (
          <div className="text-text2 text-sm py-8">Belum ada aset ber-QR. Tambahkan aset & buat QR-nya di halaman <b>Peralatan</b> dulu.</div>
        ) : (
          <>
            <select className="w-full bg-bg border border-border rounded-md px-3 py-2 text-sm mb-3"
              value={sel?.id ?? ''} onChange={(e) => setSel(assets.find((a) => a.id === Number(e.target.value)) || null)}>
              {assets.map((a) => <option key={a.id} value={a.id}>{a.name}{a.serial ? ` · SN ${a.serial}` : ''}</option>)}
            </select>
            {dataUrl ? <img src={dataUrl} alt="QR" className="w-56 h-56 mx-auto bg-white rounded-lg p-2" /> : <div className="text-text2 text-sm py-10">Membuat QR…</div>}
            <div className="text-[11px] text-text2 mt-1">Scan untuk mengisi form peminjaman</div>
            <div className="text-[10px] text-text2 mt-1 break-all">{url}</div>
            <button onClick={print} className="mt-3 w-full bg-accent text-bg font-semibold rounded-md px-4 py-2 text-sm">🖨️ Cetak Stiker</button>
          </>
        )}
      </div>
    </div>
  );
}
