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
  serviceability: { name: string; serviceable: number; note: string | null }[];
  svcRekap: { serviceable: number; unserviceable: number };
  checklistGrid: { days: number; rows: { nama: string; cells: string[] }[] };
  obatAir: { name: string; satuan: string; total_volume: string | number; biaya: string | number }[];
  obatTotal: number;
  procurement: any[];
  kegiatan: { tanggal_kegiatan: string; judul: string; lokasi: string | null; hasil?: string | null; petugas_nama: string | null }[];
  jadwal: { days: number; rows: { nama: string; cells: string[] }[] };
  lkp: { kop_url: string | null; kantor: string; kota: string; koord_nama: string; koord_nip: string; koord_jabatan: string };
  tglCetak: string;
}

// Dokumen dicetak sebagai "kertas" putih (WYSIWYG) — warna eksplisit, bukan token tema,
// agar tampilan layar == hasil cetak baik di mode terang maupun gelap.
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

  return (
    <div className="p-4 sm:p-6">
      {/* Hanya cetak #aab-report — sisanya disembunyikan saat print. */}
      <style>{`
        @media print {
          body * { visibility: hidden !important; }
          #aab-report, #aab-report * { visibility: visible !important; }
          #aab-report { position: absolute; left: 0; top: 0; width: 100%; box-shadow: none !important; margin: 0 !important; }
          @page { size: A4 portrait; margin: 14mm 12mm; }
        }
      `}</style>

      <div className="max-w-4xl mx-auto flex items-center justify-between gap-3 mb-4 flex-wrap print:hidden">
        <div>
          <h1 className="text-lg font-bold">🗓️ Laporan Bulanan AAB</h1>
          <p className="text-[12px] text-text2">Dokumen resmi siap cetak — rekap otomatis dari data unit + blok tanda tangan Koordinator.</p>
        </div>
        <div className="flex items-center gap-2">
          <input type="month" value={month} onChange={(e) => setMonth(e.target.value)} className="bg-surface2 border border-border rounded-md px-3 py-2 text-sm" />
          <button onClick={() => window.print()} className="bg-accent text-bg font-semibold rounded-md px-4 py-2 text-sm">🖨️ Cetak / PDF</button>
        </div>
      </div>

      {needUnit && <div className="max-w-4xl mx-auto bg-warn/10 border border-warn/30 text-warn rounded-lg px-4 py-3 text-[13px] mb-4 print:hidden">Pilih unit AAB di switcher header untuk melihat laporannya.</div>}

      {loading ? <div className="text-text2 text-sm py-10 text-center">Memuat…</div> : !data ? (
        <div className="max-w-4xl mx-auto bg-surface border border-border rounded-xl p-4 text-center text-text2">Data tidak tersedia.</div>
      ) : (
        <div id="aab-report" className="mx-auto bg-white text-black shadow-lg rounded-sm"
          style={{ maxWidth: 820, padding: '32px 40px', fontFamily: "'Times New Roman', Georgia, serif" }}>
          <ReportBody data={data} />
        </div>
      )}
    </div>
  );
}

// ——— Isi dokumen (semua warna eksplisit hitam/putih) ———
function ReportBody({ data }: { data: AabReport }) {
  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  const bordered: React.CSSProperties = { borderCollapse: 'collapse', width: '100%', fontSize: 11 };
  const th: React.CSSProperties = { border: '1px solid #000', padding: '3px 6px', textAlign: 'left', background: '#eee', fontWeight: 700 };
  const td: React.CSSProperties = { border: '1px solid #000', padding: '3px 6px', verticalAlign: 'top' };
  const h2: React.CSSProperties = { fontSize: 13, fontWeight: 700, margin: '18px 0 6px' };
  const muted: React.CSSProperties = { fontSize: 11, color: '#333' };

  return (
    <>
      {/* Kop / letterhead */}
      {data.lkp.kop_url ? (
        <img src={`${origin}${data.lkp.kop_url}`} alt="Kop" style={{ width: '100%', display: 'block', marginBottom: 8 }} />
      ) : (
        <div style={{ textAlign: 'center', borderBottom: '3px double #000', paddingBottom: 8, marginBottom: 8 }}>
          <div style={{ fontSize: 14, fontWeight: 700 }}>{data.lkp.kantor}</div>
        </div>
      )}

      {/* Judul */}
      <div style={{ textAlign: 'center', margin: '10px 0 18px' }}>
        <div style={{ fontSize: 16, fontWeight: 700, textDecoration: 'underline' }}>LAPORAN BULANAN</div>
        <div style={{ fontSize: 14, fontWeight: 700 }}>UNIT ALAT-ALAT BESAR (AAB)</div>
        <div style={{ fontSize: 12 }}>Periode {data.monthName}</div>
      </div>

      {/* I. Personil */}
      <div style={h2}>I. Personil</div>
      {data.personil.length === 0 ? <div style={muted}>Belum ada personil pada unit ini.</div> : (
        <table style={bordered}>
          <thead><tr><th style={{ ...th, width: 34 }}>No</th><th style={th}>Nama</th><th style={th}>NIP</th><th style={th}>Jabatan</th></tr></thead>
          <tbody>{data.personil.map((p) => <tr key={p.no}><td style={td}>{p.no}</td><td style={{ ...td, fontWeight: 600 }}>{p.name}</td><td style={td}>{p.nip || '-'}</td><td style={td}>{p.jabatan || '-'}</td></tr>)}</tbody>
        </table>
      )}

      {/* II. Inventaris per fasilitas */}
      <div style={h2}>II. Inventaris per Fasilitas
        <span style={{ ...muted, fontWeight: 400, marginLeft: 8 }}>Kondisi — B: {data.kondisiRekap.B || 0} · RR: {data.kondisiRekap.RR || 0} · RB: {data.kondisiRekap.RB || 0}</span>
      </div>
      {data.inventaris.length === 0 ? <div style={muted}>Belum ada aset fisik.</div> : data.inventaris.map((g) => (
        <div key={g.fasilitas} style={{ marginBottom: 10 }}>
          <div style={{ fontSize: 12, fontWeight: 700, margin: '4px 0' }}>{g.fasilitas} ({g.items.length})</div>
          <table style={bordered}>
            <thead><tr><th style={th}>Nama</th><th style={th}>Merk/Type</th><th style={th}>Tahun</th><th style={th}>Kondisi</th><th style={th}>Kebutuhan</th></tr></thead>
            <tbody>{g.items.map((it: any, i: number) => <tr key={i}><td style={td}>{it.name}</td><td style={td}>{[it.merk, it.model].filter(Boolean).join(' ') || '-'}</td><td style={td}>{it.tahun || '-'}</td><td style={td}>{it.kondisi ? `${it.kondisi} (${KOND[it.kondisi]})` : '-'}</td><td style={td}>{it.kebutuhan || '-'}</td></tr>)}</tbody>
          </table>
        </div>
      ))}

      {/* III. Rekap checklist harian */}
      <div style={h2}>III. Rekap Checklist Harian</div>
      <div style={muted}>{data.checklist.total} pelaksanaan pada {data.checklist.aset} aset.
        {data.checklist.byOverall.length > 0 && ' — ' + data.checklist.byOverall.map((o) => `${o.overall}: ${o.n}`).join(', ')}</div>

      {/* III-c. Grid checklist harian per aset */}
      {data.checklistGrid.rows.length > 0 && (
        <div style={{ marginTop: 8, overflowX: 'auto' }}>
          <table style={{ borderCollapse: 'collapse', fontSize: 8 }}>
            <thead><tr><th style={{ ...th, fontSize: 8, padding: '2px 4px' }}>Aset / Kendaraan</th>{Array.from({ length: data.checklistGrid.days }, (_, i) => <th key={i} style={{ ...th, fontSize: 8, padding: '2px 3px', textAlign: 'center' }}>{i + 1}</th>)}</tr></thead>
            <tbody>{data.checklistGrid.rows.map((r, i) => <tr key={i}><td style={{ ...td, fontSize: 8, whiteSpace: 'nowrap' }}>{r.nama}</td>{r.cells.map((c, j) => <td key={j} style={{ ...td, fontSize: 8, padding: '2px 3px', textAlign: 'center' }}>{c}</td>)}</tr>)}</tbody>
          </table>
          <div style={{ fontSize: 8, color: '#333', marginTop: 2 }}>✓ Baik · △ Perhatian · ✗ Rusak</div>
        </div>
      )}

      {/* III-b. Status kelayakan (Serviceable) */}
      <div style={h2}>IV. Status Kelayakan Bulanan (Serviceable)
        <span style={{ ...muted, fontWeight: 400, marginLeft: 8 }}>Serviceable: {data.svcRekap.serviceable} · Unserviceable: {data.svcRekap.unserviceable}</span>
      </div>
      {data.serviceability.length === 0 ? <div style={muted}>Belum ada penilaian kelayakan bulanan pada periode ini.</div> : (
        <table style={bordered}>
          <thead><tr><th style={{ ...th, width: 34 }}>No</th><th style={th}>Aset</th><th style={th}>Status</th><th style={th}>Catatan</th></tr></thead>
          <tbody>{data.serviceability.map((s, i) => <tr key={i}><td style={td}>{i + 1}</td><td style={td}>{s.name}</td><td style={{ ...td, fontWeight: 700 }}>{s.serviceable ? 'Serviceable' : 'Unserviceable'}</td><td style={td}>{s.note || '-'}</td></tr>)}</tbody>
        </table>
      )}

      {/* V. Obat air */}
      <div style={h2}>V. Penggunaan Obat Air</div>
      {data.obatAir.length === 0 ? <div style={muted}>Belum ada data obat air.</div> : (
        <table style={bordered}>
          <thead><tr><th style={th}>Bahan</th><th style={th}>Volume</th><th style={th}>Biaya</th></tr></thead>
          <tbody>{data.obatAir.map((o, i) => <tr key={i}><td style={td}>{o.name}</td><td style={td}>{Number(o.total_volume)} {o.satuan}</td><td style={td}>{rupiah(o.biaya)}</td></tr>)}</tbody>
          <tfoot><tr><td style={{ ...td, fontWeight: 700 }} colSpan={2}>Total</td><td style={{ ...td, fontWeight: 700 }}>{rupiah(data.obatTotal)}</td></tr></tfoot>
        </table>
      )}

      {/* VI. Pengadaan */}
      <div style={h2}>VI. Daftar Kebutuhan Pengadaan</div>
      {data.procurement.length === 0 ? <div style={muted}>Tidak ada aset RR/RB atau kebutuhan tercatat.</div> : (
        <table style={bordered}>
          <thead><tr><th style={th}>Nama</th><th style={th}>Fasilitas</th><th style={th}>Kondisi</th><th style={th}>Kebutuhan</th></tr></thead>
          <tbody>{data.procurement.map((p: any, i: number) => <tr key={i}><td style={td}>{p.name}</td><td style={td}>{p.fasilitas || '-'}</td><td style={{ ...td, fontWeight: 600 }}>{p.kondisi || '-'}</td><td style={td}>{p.kebutuhan || '-'}</td></tr>)}</tbody>
        </table>
      )}

      {/* VII. Kegiatan */}
      <div style={h2}>VII. Kegiatan Pemeliharaan</div>
      {data.kegiatan.length === 0 ? <div style={muted}>Belum ada kegiatan tercatat bulan ini.</div> : (
        <table style={bordered}>
          <thead><tr><th style={{ ...th, width: 80 }}>Tanggal</th><th style={th}>Kegiatan</th><th style={th}>Lokasi</th><th style={th}>Hasil</th></tr></thead>
          <tbody>{data.kegiatan.map((k, i) => <tr key={i}><td style={td}>{new Date(k.tanggal_kegiatan).toLocaleDateString('id-ID')}</td><td style={td}>{k.judul}</td><td style={td}>{k.lokasi || '-'}</td><td style={td}>{k.hasil || '-'}</td></tr>)}</tbody>
        </table>
      )}

      {/* VIII. Jadwal dinas */}
      <div style={h2}>VIII. Jadwal Dinas — {data.monthName}</div>
      {data.jadwal.rows.length === 0 ? <div style={muted}>Belum ada jadwal.</div> : (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ borderCollapse: 'collapse', fontSize: 8 }}>
            <thead><tr><th style={{ ...th, fontSize: 8, padding: '2px 4px' }}>Nama</th>{Array.from({ length: data.jadwal.days }, (_, i) => <th key={i} style={{ ...th, fontSize: 8, padding: '2px 3px', textAlign: 'center' }}>{i + 1}</th>)}</tr></thead>
            <tbody>{data.jadwal.rows.map((r, i) => <tr key={i}><td style={{ ...td, fontSize: 8, whiteSpace: 'nowrap' }}>{r.nama}</td>{r.cells.map((c, j) => <td key={j} style={{ ...td, fontSize: 8, padding: '2px 3px', textAlign: 'center' }}>{c}</td>)}</tr>)}</tbody>
          </table>
          <div style={{ fontSize: 8, color: '#333', marginTop: 2 }}>P=Pagi · S=Siang · N=Normal · L=Libur · DL=Dinas Luar · C=Cuti</div>
        </div>
      )}

      {/* Blok tanda tangan Koordinator */}
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 34, breakInside: 'avoid' }}>
        <div style={{ textAlign: 'center', fontSize: 12, minWidth: 260 }}>
          <div>{data.lkp.kota}, {data.tglCetak}</div>
          <div>{data.lkp.koord_jabatan}</div>
          <div style={{ height: 64 }} />
          <div style={{ fontWeight: 700, textDecoration: 'underline' }}>{data.lkp.koord_nama || '(………………………………)'}</div>
          <div>NIP. {data.lkp.koord_nip || '………………………'}</div>
        </div>
      </div>
    </>
  );
}
