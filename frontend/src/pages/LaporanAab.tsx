import { useCallback, useEffect, useState } from 'react';
import { api, getActiveUnitId } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { hasRole } from '../utils/roles';

const rupiah = (n: number | string) => 'Rp ' + Number(n || 0).toLocaleString('id-ID');
const KOND: Record<string, string> = { B: 'Baik', RR: 'Rusak Ringan', RB: 'Rusak Berat' };
function thisMonth() { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; }

interface AabReport {
  monthName: string; daysInMonth: number;
  personil: { no: number; name: string; nip: string | null; jabatan: string | null }[];
  inventaris: { fasilitas: string; items: any[] }[];
  kondisiRekap: Record<string, number>;
  checklist: { total: number; aset: number; byOverall: { overall: string; n: number }[] };
  obatAir: { name: string; satuan: string; total_volume: string | number; biaya: string | number }[];
  obatTotal: number;
  procurement: any[];
  kegiatan: { tanggal_kegiatan: string; judul: string; lokasi: string | null; petugas_nama: string | null }[];
  jadwal: { days: number; rows: { nama: string; cells: string[] }[] };
}

export default function LaporanAab() {
  const { user } = useAuth();
  const needUnit = hasRole(user, 'admin') && !getActiveUnitId();
  const [month, setMonth] = useState(thisMonth());
  const [data, setData] = useState<AabReport | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(() => {
    setLoading(true);
    api.get('/laporan/aab', { params: { month } }).then((r) => setData(r.data)).catch(() => setData(null)).finally(() => setLoading(false));
  }, [month]);
  useEffect(() => { load(); }, [load]);

  const card = 'bg-surface border border-border rounded-xl p-4';
  const h2 = 'text-sm font-bold mb-2';

  return (
    <div className="p-4 sm:p-6 max-w-5xl mx-auto">
      <div className="flex items-center justify-between gap-3 mb-4 flex-wrap print:hidden">
        <div>
          <h1 className="text-lg font-bold">🗓️ Laporan Bulanan AAB</h1>
          <p className="text-[12px] text-text2">Rekap otomatis dari data unit: inventaris per fasilitas, checklist, obat air, pengadaan & jadwal.</p>
        </div>
        <div className="flex items-center gap-2">
          <input type="month" value={month} onChange={(e) => setMonth(e.target.value)} className="bg-surface2 border border-border rounded-md px-3 py-2 text-sm" />
          <button onClick={() => window.print()} className="bg-accent text-bg font-semibold rounded-md px-4 py-2 text-sm">🖨️ Cetak</button>
        </div>
      </div>

      {needUnit && <div className="bg-warn/10 border border-warn/30 text-warn rounded-lg px-4 py-3 text-[13px] mb-4">Pilih unit AAB di switcher header untuk melihat laporannya.</div>}

      {loading ? <div className="text-text2 text-sm py-10 text-center">Memuat…</div> : !data ? (
        <div className={`${card} text-center text-text2`}>Data tidak tersedia.</div>
      ) : (
        <div className="space-y-4" id="aab-report">
          <div className="text-center">
            <div className="text-base font-bold">LAPORAN BULANAN UNIT ALAT-ALAT BESAR</div>
            <div className="text-[13px] text-text2">Periode {data.monthName} · Bandara A.P.T Pranoto Samarinda</div>
          </div>

          {/* Personil */}
          <div className={card}>
            <div className={h2}>I. Personil</div>
            {data.personil.length === 0 ? <div className="text-[12px] text-text2">Belum ada personil pada unit ini.</div> : (
              <table className="w-full text-xs"><thead><tr className="text-left text-text2 border-b border-border"><th className="px-2 py-1.5">No</th><th className="px-2 py-1.5">Nama</th><th className="px-2 py-1.5">NIP</th><th className="px-2 py-1.5">Jabatan</th></tr></thead>
                <tbody>{data.personil.map((p) => <tr key={p.no} className="border-b border-border/50"><td className="px-2 py-1.5">{p.no}</td><td className="px-2 py-1.5 font-medium">{p.name}</td><td className="px-2 py-1.5 font-mono text-text2">{p.nip || '-'}</td><td className="px-2 py-1.5">{p.jabatan || '-'}</td></tr>)}</tbody>
              </table>
            )}
          </div>

          {/* Inventaris per fasilitas */}
          <div className={card}>
            <div className="flex items-center justify-between mb-2">
              <div className="text-sm font-bold">II. Inventaris per Fasilitas</div>
              <div className="text-[11px] text-text2">Kondisi — B: {data.kondisiRekap.B || 0} · RR: {data.kondisiRekap.RR || 0} · RB: {data.kondisiRekap.RB || 0}</div>
            </div>
            {data.inventaris.length === 0 ? <div className="text-[12px] text-text2">Belum ada aset fisik.</div> : data.inventaris.map((g) => (
              <div key={g.fasilitas} className="mb-3">
                <div className="text-[12px] font-semibold text-accent mb-1">{g.fasilitas} <span className="text-text2 font-normal">({g.items.length})</span></div>
                <div className="overflow-x-auto"><table className="w-full text-[11px]">
                  <thead><tr className="text-left text-text2 border-b border-border"><th className="px-2 py-1">Nama</th><th className="px-2 py-1">Merk/Type</th><th className="px-2 py-1">Tahun</th><th className="px-2 py-1">Kondisi</th><th className="px-2 py-1">Kebutuhan</th></tr></thead>
                  <tbody>{g.items.map((it, i) => <tr key={i} className="border-b border-border/40"><td className="px-2 py-1">{it.name}</td><td className="px-2 py-1 text-text2">{[it.merk, it.model].filter(Boolean).join(' ') || '-'}</td><td className="px-2 py-1">{it.tahun || '-'}</td><td className="px-2 py-1">{it.kondisi ? `${it.kondisi} (${KOND[it.kondisi]})` : '-'}</td><td className="px-2 py-1 text-warn">{it.kebutuhan || '-'}</td></tr>)}</tbody>
                </table></div>
              </div>
            ))}
          </div>

          {/* Rekap checklist */}
          <div className={card}>
            <div className={h2}>III. Rekap Checklist Inspeksi</div>
            <div className="text-[12px] text-text2">{data.checklist.total} pelaksanaan pada {data.checklist.aset} aset.
              {data.checklist.byOverall.length > 0 && ' — ' + data.checklist.byOverall.map((o) => `${o.overall}: ${o.n}`).join(', ')}</div>
          </div>

          {/* Obat air */}
          <div className={card}>
            <div className={h2}>IV. Penggunaan Obat Air</div>
            {data.obatAir.length === 0 ? <div className="text-[12px] text-text2">Belum ada data obat air.</div> : (
              <table className="w-full text-xs"><thead><tr className="text-left text-text2 border-b border-border"><th className="px-2 py-1.5">Bahan</th><th className="px-2 py-1.5">Volume</th><th className="px-2 py-1.5">Biaya</th></tr></thead>
                <tbody>{data.obatAir.map((o, i) => <tr key={i} className="border-b border-border/50"><td className="px-2 py-1.5">{o.name}</td><td className="px-2 py-1.5">{Number(o.total_volume)} {o.satuan}</td><td className="px-2 py-1.5">{rupiah(o.biaya)}</td></tr>)}</tbody>
                <tfoot><tr className="border-t border-border font-bold"><td className="px-2 py-1.5" colSpan={2}>Total</td><td className="px-2 py-1.5 text-accent">{rupiah(data.obatTotal)}</td></tr></tfoot>
              </table>
            )}
          </div>

          {/* Pengadaan */}
          <div className={card}>
            <div className={h2}>V. Daftar Kebutuhan Pengadaan</div>
            {data.procurement.length === 0 ? <div className="text-[12px] text-text2">Tidak ada aset RR/RB atau kebutuhan tercatat. 👍</div> : (
              <table className="w-full text-[11px]"><thead><tr className="text-left text-text2 border-b border-border"><th className="px-2 py-1">Nama</th><th className="px-2 py-1">Fasilitas</th><th className="px-2 py-1">Kondisi</th><th className="px-2 py-1">Kebutuhan</th></tr></thead>
                <tbody>{data.procurement.map((p, i) => <tr key={i} className="border-b border-border/40"><td className="px-2 py-1">{p.name}</td><td className="px-2 py-1 text-text2">{p.fasilitas || '-'}</td><td className="px-2 py-1 font-semibold">{p.kondisi || '-'}</td><td className="px-2 py-1 text-warn">{p.kebutuhan || '-'}</td></tr>)}</tbody>
              </table>
            )}
          </div>

          {/* Kegiatan */}
          <div className={card}>
            <div className={h2}>VI. Kegiatan Pemeliharaan</div>
            {data.kegiatan.length === 0 ? <div className="text-[12px] text-text2">Belum ada kegiatan tercatat bulan ini.</div> : (
              <div className="space-y-1">{data.kegiatan.map((k, i) => <div key={i} className="text-[12px] border-b border-border/40 pb-1"><b>{new Date(k.tanggal_kegiatan).toLocaleDateString('id-ID')}</b> — {k.judul}{k.lokasi ? ` · ${k.lokasi}` : ''}</div>)}</div>
            )}
          </div>

          {/* Jadwal */}
          <div className={card}>
            <div className={h2}>VII. Jadwal Dinas — {data.monthName}</div>
            {data.jadwal.rows.length === 0 ? <div className="text-[12px] text-text2">Belum ada jadwal.</div> : (
              <div className="overflow-x-auto"><table className="text-[9px] border-collapse">
                <thead><tr><th className="border border-border px-1 py-0.5 sticky left-0 bg-surface">Nama</th>{Array.from({ length: data.jadwal.days }, (_, i) => <th key={i} className="border border-border px-1 py-0.5">{i + 1}</th>)}</tr></thead>
                <tbody>{data.jadwal.rows.map((r, i) => <tr key={i}><td className="border border-border px-1 py-0.5 whitespace-nowrap sticky left-0 bg-surface">{r.nama}</td>{r.cells.map((c, j) => <td key={j} className="border border-border px-1 py-0.5 text-center">{c}</td>)}</tr>)}</tbody>
              </table><div className="text-[9px] text-text2 mt-1">P=Pagi · S=Siang · N=Normal · L=Libur · DL=Dinas Luar · C=Cuti</div></div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
