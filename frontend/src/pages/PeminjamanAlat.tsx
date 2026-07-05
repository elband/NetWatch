import { useCallback, useEffect, useState } from 'react';
import { api } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { hasRole } from '../utils/roles';

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
      <div className="mb-4">
        <h1 className="text-lg font-bold">📦 Peminjaman Peralatan</h1>
        <p className="text-[12px] text-text2">Permohonan peminjaman alat masuk lewat QR yang ditempel di alat. Setujui, tolak, atau tandai alat sudah dikembalikan.</p>
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
    </div>
  );
}
