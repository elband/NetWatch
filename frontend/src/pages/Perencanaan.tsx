import { useEffect, useMemo, useState } from 'react';
import { api } from '../api/client';
import { confirmDialog } from '../components/dialog';
import { openImage } from '../components/ImageLightbox';
import type { UnitPlan, UnitKpi, UnitPlanDetail, UnitPlanFile } from '../types';
import { buildProgramKerjaHtml, buildLaporanProgramHtml, type PkLkp, type ProgramKerjaCfg } from '../utils/programKerjaDoc';

// ===== Konstanta tampilan =====
const KATEGORI = [
  { id: 'pemeliharaan', label: 'Pemeliharaan', icon: '🔧' },
  { id: 'pengadaan', label: 'Pengadaan', icon: '📦' },
  { id: 'sdm', label: 'Pengembangan SDM', icon: '🎓' },
  { id: 'pengembangan', label: 'Peningkatan Sistem', icon: '🚀' },
  { id: 'administrasi', label: 'Administrasi/SOP', icon: '📋' },
  { id: 'lainnya', label: 'Lainnya', icon: '🗂️' },
];
const STATUS = [
  { id: 'rencana', label: 'Rencana', cls: 'text-text2 bg-surface2 border-border' },
  { id: 'berjalan', label: 'Berjalan', cls: 'text-accent2 bg-accent2/10 border-accent2/40' },
  { id: 'selesai', label: 'Selesai', cls: 'text-success bg-success/10 border-success/40' },
  { id: 'tertunda', label: 'Tertunda', cls: 'text-warn bg-warn/10 border-warn/40' },
  { id: 'batal', label: 'Batal', cls: 'text-danger bg-danger/10 border-danger/40' },
];
// Siklus program: program dianggap DISETUJUI begitu dimasukkan, lalu berjalan melalui
// tahap-tahap berikut sampai diarsipkan.
const TAHAP = [
  { id: 'pelaksanaan', label: 'Pelaksanaan', icon: '🚀', cls: 'text-accent2 bg-accent2/10 border-accent2/40', desc: 'Program berjalan — catat aktivitas/progres & unggah dokumentasi.' },
  { id: 'monitoring', label: 'Monitoring', icon: '📈', cls: 'text-accent bg-accent/10 border-accent/40', desc: 'Pantau persentase progres, kendala yang dihadapi & tindak lanjutnya.' },
  { id: 'evaluasi', label: 'Evaluasi', icon: '🧭', cls: 'text-warn bg-warn/10 border-warn/40', desc: 'Bandingkan target dengan hasil, nilai keberhasilan & beri catatan evaluasi.' },
  { id: 'penyelesaian', label: 'Penyelesaian', icon: '✅', cls: 'text-success bg-success/10 border-success/40', desc: 'Unggah laporan akhir & bukti dokumentasi, lalu tandai program Selesai.' },
  { id: 'arsip', label: 'Arsip', icon: '📦', cls: 'text-text2 bg-surface2 border-border', desc: 'Program tersimpan sebagai arsip — tetap bisa dilihat & dicetak laporannya.' },
];
const tahapOf = (id: string) => TAHAP.find((t) => t.id === id) || TAHAP[0];
const NILAI_KEBERHASILAN = [
  { id: 'berhasil', label: 'Berhasil (target tercapai)', cls: 'text-success' },
  { id: 'sebagian', label: 'Tercapai sebagian', cls: 'text-warn' },
  { id: 'tidak_tercapai', label: 'Tidak tercapai', cls: 'text-danger' },
];

const PRIO: Record<string, { label: string; cls: string }> = {
  tinggi: { label: 'Tinggi', cls: 'text-danger bg-danger/10 border-danger/40' },
  sedang: { label: 'Sedang', cls: 'text-warn bg-warn/10 border-warn/40' },
  rendah: { label: 'Rendah', cls: 'text-text2 bg-surface2 border-border' },
};
const KUARTAL = ['Tahunan', 'Triwulan I', 'Triwulan II', 'Triwulan III', 'Triwulan IV'];
const katOf = (id: string) => KATEGORI.find((k) => k.id === id) || KATEGORI[KATEGORI.length - 1];
const stOf = (id: string) => STATUS.find((s) => s.id === id) || STATUS[0];
const rp = (n: number | null | undefined) => 'Rp ' + new Intl.NumberFormat('id-ID').format(Math.round(Number(n) || 0));
const thisYear = new Date().getFullYear();
const tabBtn = (active: boolean) => `px-3 py-1.5 text-xs rounded-md ${active ? 'bg-accent text-bg font-semibold' : 'text-text2'}`;

// Kop/identitas unit untuk dokumen cetak (fallback bila /settings.lkp belum diisi).
const PK_LKP_DEFAULT: PkLkp = {
  kantor: 'BANDAR UDARA A.P.T. PRANOTO - SAMARINDA', unit: 'UNIT ELEKTRONIKA BANDARA', kota: 'Samarinda', fasilitas: 'Elektronika Bandara',
  kepala_jabatan: 'KEPALA SEKSI TEKNIK DAN OPERASI', kepala_nama: 'MURDOKO', kepala_nip: '19780319 200012 1 001',
  koord_jabatan: 'KOORDINATOR UNIT ELEKTRONIKA BANDARA', koord_nama: 'PRAYUDA ELFANDRO', koord_nip: '19930311 202203 1 008',
  nd_kode: 'ELBAND/APTP', nd_yth: 'Kepala BLU Kantor UPBU Kelas I A.P.T. Pranoto-Samarinda', nd_dari: 'Koordinator Elektronika Bandara',
};
const SUMBER_DANA = ['BLU', 'DIPA (RM)', 'PNBP', 'Hibah', 'Lainnya'];
const METODE = ['Swakelola', 'Pengadaan Langsung', 'Tender', 'E-Katalog', 'Lainnya'];

// Kelengkapan data rencana (0–100%) untuk badge/nudge di kartu.
function completeness(p: UnitPlan): number {
  const fields: (keyof UnitPlan)[] = ['judul', 'tujuan', 'keluaran', 'indikator', 'sumber_dana', 'start_date', 'target_date', 'pic_nama'];
  let filled = fields.reduce((n, k) => n + (p[k] != null && String(p[k]).trim() !== '' ? 1 : 0), 0);
  if (Number(p.estimasi_biaya) > 0) filled++;
  return Math.round((filled / (fields.length + 1)) * 100);
}

export default function Perencanaan() {
  const [tab, setTab] = useState<'program' | 'anggaran' | 'pengadaan' | 'kpi'>('program');
  const [tahun, setTahun] = useState(thisYear);
  const [plans, setPlans] = useState<UnitPlan[]>([]);
  const [years, setYears] = useState<number[]>([]);
  const [loading, setLoading] = useState(false);
  const [lkp, setLkp] = useState<PkLkp>(PK_LKP_DEFAULT);
  const [pk, setPk] = useState<ProgramKerjaCfg>({});
  const [printing, setPrinting] = useState(false);
  const [arsip, setArsip] = useState(false);

  // arsip=1 → tampilkan program yang sudah diarsipkan (default: disembunyikan).
  function load() {
    setLoading(true);
    api.get(`/perencanaan?tahun=${tahun}${arsip ? '&arsip=1' : ''}`)
      .then((r) => { setPlans(r.data.plans); setYears(r.data.years || []); })
      .finally(() => setLoading(false));
  }
  useEffect(load, [tahun, arsip]);
  useEffect(() => { api.get('/settings').then((r) => {
    if (r.data.settings?.lkp) setLkp((l) => ({ ...l, ...r.data.settings.lkp }));
    if (r.data.settings?.program_kerja) setPk(r.data.settings.program_kerja);
  }).catch(() => {}); }, []);

  // Cetak dokumen resmi "Program Kerja Unit" (Nota Dinas + naratif I–V + matriks jadwal + TTD) ke PDF.
  async function generatePdf() {
    setPrinting(true);
    try {
      const [pkRes, kpiRes] = await Promise.all([
        api.get(`/perencanaan/program-kerja-data?tahun=${tahun}`),
        api.get(`/perencanaan/kpi?tahun=${tahun}`).catch(() => ({ data: { kpi: [] } })),
      ]);
      const html = buildProgramKerjaHtml({
        tahun, cfg: pk, lkp,
        personil: pkRes.data.personil || [],
        equipment: pkRes.data.equipment || [],
        maintenance: pkRes.data.maintenance || [],
        plans, kpi: kpiRes.data.kpi || [],
      }, window.location.origin);
      const w = window.open('', '_blank');
      if (!w) { setPrinting(false); return; }
      w.document.write(html); w.document.close();
      // Beri jeda agar gambar kop (bila ada) termuat sebelum dialog cetak muncul.
      setTimeout(() => { try { w.focus(); w.print(); } catch { /* diabaikan */ } }, 500);
    } finally { setPrinting(false); }
  }

  const yearOptions = useMemo(() => {
    const s = new Set<number>([thisYear, thisYear + 1, tahun, ...years]);
    return [...s].sort((a, b) => b - a);
  }, [years, tahun]);

  return (
    <div>
      <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
        <div>
          <div className="text-[17px] font-bold">🎯 Perencanaan Unit</div>
          <div className="text-[11px] text-text2">Program &amp; rencana kerja unit — pemeliharaan, pengadaan, pengembangan.</div>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <label className="text-xs text-text2">Tahun
            <select value={tahun} onChange={(e) => setTahun(Number(e.target.value))} className="ml-2 bg-surface2 border border-border rounded-md px-2 py-1.5 text-xs">
              {yearOptions.map((y) => <option key={y} value={y}>{y}</option>)}
            </select>
          </label>
          <div className="flex gap-1 bg-surface2 border border-border rounded-lg p-1 flex-wrap">
            <button className={tabBtn(tab === 'program')} onClick={() => setTab('program')}>Program Kerja</button>
            <button className={tabBtn(tab === 'anggaran')} onClick={() => setTab('anggaran')}>Anggaran</button>
            <button className={tabBtn(tab === 'pengadaan')} onClick={() => setTab('pengadaan')}>Pengadaan</button>
            <button className={tabBtn(tab === 'kpi')} onClick={() => setTab('kpi')}>Target/KPI</button>
          </div>
          <button onClick={generatePdf} disabled={printing || loading} title="Cetak seluruh rencana kerja tahun ini ke PDF" className="border border-accent2/40 text-accent2 hover:bg-accent2/10 rounded-md px-3 py-1.5 text-xs font-semibold disabled:opacity-50 whitespace-nowrap">🖨️ {printing ? 'Menyiapkan…' : 'Generate PDF'}</button>
        </div>
      </div>
      {tab === 'program' && <ProgramTab plans={plans} tahun={tahun} loading={loading} onChange={load} arsip={arsip} onToggleArsip={() => setArsip((v) => !v)} lkp={lkp} />}
      {tab === 'anggaran' && <AnggaranTab plans={plans} />}
      {tab === 'pengadaan' && <PengadaanTab tahun={tahun} onPlanCreated={load} />}
      {tab === 'kpi' && <KpiTab tahun={tahun} />}
    </div>
  );
}

// ===================== TAB PROGRAM KERJA =====================
function ProgramTab({ plans, tahun, loading, onChange, arsip, onToggleArsip, lkp }: { plans: UnitPlan[]; tahun: number; loading: boolean; onChange: () => void; arsip: boolean; onToggleArsip: () => void; lkp: PkLkp }) {
  const [q, setQ] = useState('');
  const [fKat, setFKat] = useState('');
  const [fStatus, setFStatus] = useState('');
  const [fPrio, setFPrio] = useState('');
  const [fTahap, setFTahap] = useState('');
  const [groupBy, setGroupBy] = useState<'kuartal' | 'kategori'>('kuartal');
  const [edit, setEdit] = useState<UnitPlan | 'new' | null>(null);
  const [kelola, setKelola] = useState<UnitPlan | null>(null);

  const filtered = plans.filter((p) => {
    if (fKat && p.kategori !== fKat) return false;
    if (fStatus && p.status !== fStatus) return false;
    if (fTahap && p.tahap !== fTahap) return false;
    if (fPrio && p.prioritas !== fPrio) return false;
    if (q.trim()) { const h = `${p.judul} ${p.deskripsi || ''} ${p.pic_nama || ''}`.toLowerCase(); if (!h.includes(q.trim().toLowerCase())) return false; }
    return true;
  });

  // Ringkasan dihitung dari seluruh rencana tahun ini (bukan yang terfilter).
  const sum = useMemo(() => {
    const byStatus: Record<string, number> = {};
    let estimasi = 0, prog = 0;
    for (const p of plans) { byStatus[p.status] = (byStatus[p.status] || 0) + 1; estimasi += Number(p.estimasi_biaya) || 0; prog += Number(p.progres) || 0; }
    return { total: plans.length, byStatus, estimasi, progAvg: plans.length ? Math.round(prog / plans.length) : 0 };
  }, [plans]);

  const groups = useMemo(() => {
    const m = new Map<string, UnitPlan[]>();
    for (const p of filtered) {
      const key = groupBy === 'kuartal' ? String(p.kuartal) : p.kategori;
      if (!m.has(key)) m.set(key, []);
      m.get(key)!.push(p);
    }
    const keys = groupBy === 'kuartal' ? ['1', '2', '3', '4', '0'] : KATEGORI.map((k) => k.id);
    return keys.filter((k) => m.has(k)).map((k) => ({
      key: k,
      label: groupBy === 'kuartal' ? KUARTAL[Number(k)] : `${katOf(k).icon} ${katOf(k).label}`,
      items: m.get(k)!,
    }));
  }, [filtered, groupBy]);

  async function del(p: UnitPlan) {
    if (!(await confirmDialog({ title: 'Hapus rencana', message: `Rencana "${p.judul}" akan dihapus permanen.`, confirmText: '🗑️ Hapus', variant: 'danger' }))) return;
    await api.delete(`/perencanaan/${p.id}`); onChange();
  }
  async function quick(p: UnitPlan, status: string) {
    await api.patch(`/perencanaan/${p.id}`, { status }); onChange();
  }

  return (
    <div>
      {/* Ringkasan */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2 mb-4">
        <Stat label="Total Rencana" value={String(sum.total)} />
        <Stat label="Berjalan" value={String(sum.byStatus.berjalan || 0)} cls="text-accent2" />
        <Stat label="Selesai" value={String(sum.byStatus.selesai || 0)} cls="text-success" />
        <Stat label="Tertunda" value={String(sum.byStatus.tertunda || 0)} cls="text-warn" />
        <Stat label="Progres Rata²" value={`${sum.progAvg}%`} />
        <Stat label="Total Anggaran" value={rp(sum.estimasi)} small />
      </div>

      {/* Toolbar */}
      <div className="flex items-center gap-2 mb-3 flex-wrap">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="🔍 Cari rencana / PIC…" className="flex-1 min-w-[180px] bg-surface2 border border-border rounded-md px-3 py-1.5 text-xs" />
        <select value={fKat} onChange={(e) => setFKat(e.target.value)} className="bg-surface2 border border-border rounded-md px-2 py-1.5 text-xs"><option value="">Semua Kategori</option>{KATEGORI.map((k) => <option key={k.id} value={k.id}>{k.icon} {k.label}</option>)}</select>
        <select value={fStatus} onChange={(e) => setFStatus(e.target.value)} className="bg-surface2 border border-border rounded-md px-2 py-1.5 text-xs"><option value="">Semua Status</option>{STATUS.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}</select>
        <select value={fTahap} onChange={(e) => setFTahap(e.target.value)} className="bg-surface2 border border-border rounded-md px-2 py-1.5 text-xs"><option value="">Semua Tahap</option>{TAHAP.map((t) => <option key={t.id} value={t.id}>{t.icon} {t.label}</option>)}</select>
        <select value={fPrio} onChange={(e) => setFPrio(e.target.value)} className="bg-surface2 border border-border rounded-md px-2 py-1.5 text-xs"><option value="">Semua Prioritas</option><option value="tinggi">Tinggi</option><option value="sedang">Sedang</option><option value="rendah">Rendah</option></select>
        <button onClick={onToggleArsip} title="Tampilkan/sembunyikan program yang sudah diarsipkan" className={`rounded-md px-2.5 py-1.5 text-[11px] border ${arsip ? 'border-accent2/50 text-accent2 bg-accent2/10 font-semibold' : 'border-border text-text2 hover:text-text'}`}>📦 {arsip ? 'Arsip tampil' : 'Lihat arsip'}</button>
        <div className="flex bg-surface2 border border-border rounded-lg p-0.5">
          {(['kuartal', 'kategori'] as const).map((g) => <button key={g} onClick={() => setGroupBy(g)} className={`px-2.5 py-1 text-[11px] rounded capitalize ${groupBy === g ? 'bg-accent text-bg font-semibold' : 'text-text2'}`}>{g}</button>)}
        </div>
        <button onClick={() => setEdit('new')} className="bg-accent text-bg rounded-md px-3 py-1.5 text-xs font-semibold">+ Tambah Rencana</button>
      </div>

      {/* Daftar */}
      {loading ? (
        <div className="text-center py-10 text-text2 text-sm">Memuat…</div>
      ) : plans.length === 0 ? (
        <Empty tahun={tahun} onAdd={() => setEdit('new')} />
      ) : filtered.length === 0 ? (
        <div className="text-center py-10 text-text2 text-sm bg-surface border border-border rounded-xl">Tidak ada rencana yang cocok dengan filter.</div>
      ) : (
        <div className="space-y-5">
          {groups.map((g) => (
            <div key={g.key}>
              <div className="text-xs font-semibold text-text2 mb-2 flex items-center gap-2"><span>{g.label}</span><span className="text-[10px] font-normal">· {g.items.length} rencana</span></div>
              <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
                {g.items.map((p) => <PlanCard key={p.id} p={p} onEdit={() => setEdit(p)} onDelete={() => del(p)} onQuick={quick} onKelola={() => setKelola(p)} />)}
              </div>
            </div>
          ))}
        </div>
      )}

      {edit && <PlanModal plan={edit === 'new' ? null : edit} tahun={tahun} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); onChange(); }} />}
      {kelola && <SiklusModal planId={kelola.id} lkp={lkp} onClose={() => setKelola(null)} onChanged={onChange} />}
    </div>
  );
}

function Stat({ label, value, cls, small }: { label: string; value: string; cls?: string; small?: boolean }) {
  return (
    <div className="bg-surface border border-border rounded-xl px-3 py-2.5">
      <div className="text-[10px] text-text2 uppercase tracking-wide truncate">{label}</div>
      <div className={`${small ? 'text-sm' : 'text-lg'} font-bold ${cls || ''}`}>{value}</div>
    </div>
  );
}

function Empty({ tahun, onAdd }: { tahun: number; onAdd: () => void }) {
  return (
    <div className="text-center py-12 bg-surface border border-border rounded-xl">
      <div className="text-3xl mb-2">🎯</div>
      <div className="text-sm font-semibold mb-1">Belum ada rencana kerja untuk {tahun}</div>
      <div className="text-xs text-text2 mb-4">Susun program kerja unit: pemeliharaan, pengadaan, pengembangan SDM, dan lainnya.</div>
      <button onClick={onAdd} className="bg-accent text-bg rounded-md px-4 py-2 text-xs font-semibold">+ Tambah Rencana Pertama</button>
    </div>
  );
}

function PlanCard({ p, onEdit, onDelete, onQuick, onKelola }: { p: UnitPlan; onEdit: () => void; onDelete: () => void; onQuick: (p: UnitPlan, s: string) => void; onKelola: () => void }) {
  const kat = katOf(p.kategori);
  const st = stOf(p.status);
  const th = tahapOf(p.tahap);
  const prio = PRIO[p.prioritas] || PRIO.sedang;
  const comp = completeness(p);
  const jadwal = p.start_date || p.target_date ? `📅 ${p.start_date ? p.start_date + '→' : ''}${p.target_date || ''}` : '';
  return (
    <div className="bg-surface border border-border rounded-xl p-3.5 flex flex-col gap-2 hover:border-accent/40 transition-colors">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="font-semibold text-sm leading-snug">{p.judul}</div>
          <div className="text-[10px] text-text2 mt-0.5">{kat.icon} {kat.label}{jadwal ? ` · ${jadwal}` : ''}</div>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <span className={`text-[9px] font-semibold px-1.5 py-0.5 rounded-full border ${th.cls}`} title={th.desc}>{th.icon} {th.label}</span>
          {comp === 100
            ? <span className="text-[9px] font-semibold px-1.5 py-0.5 rounded-full border text-success bg-success/10 border-success/40" title="Data lengkap">✓ Lengkap</span>
            : <span className="text-[9px] font-semibold px-1.5 py-0.5 rounded-full border text-warn bg-warn/10 border-warn/40" title="Kelengkapan data rencana">{comp}%</span>}
          <span className={`text-[9px] font-semibold px-1.5 py-0.5 rounded-full border ${prio.cls}`}>{prio.label}</span>
        </div>
      </div>
      {(p.tujuan || p.deskripsi) && <div className="text-[11px] text-text2 line-clamp-2">{p.tujuan || p.deskripsi}</div>}
      {p.keluaran && <div className="text-[10px] text-text2 truncate">📦 {p.keluaran}{p.volume ? ` (${p.volume})` : ''}</div>}

      <div>
        <div className="flex items-center justify-between text-[10px] text-text2 mb-1"><span>Progres</span><span className="font-semibold text-text">{p.progres}%</span></div>
        <div className="h-1.5 bg-surface2 rounded-full overflow-hidden"><div className="h-full bg-accent rounded-full" style={{ width: `${Math.min(100, Math.max(0, p.progres))}%` }} /></div>
      </div>

      <div className="flex items-center justify-between text-[10px] text-text2 gap-2">
        <span className="truncate">💰 {rp(p.estimasi_biaya)}{p.sumber_dana ? ` · ${p.sumber_dana}` : ''}{p.realisasi_biaya != null ? ` · real ${rp(p.realisasi_biaya)}` : ''}</span>
        {p.pic_nama && <span className="truncate max-w-[110px] shrink-0" title={p.pic_nama}>👤 {p.pic_nama}</span>}
      </div>

      <div className="flex items-center gap-1.5 mt-1 pt-2 border-t border-border/50">
        {/* 'Rencana' hanya tersisa untuk data lama — program baru langsung berjalan. */}
        <select value={p.status} onChange={(e) => onQuick(p, e.target.value)} title="Ubah status" className={`text-[10px] font-semibold border rounded px-1.5 py-1 ${st.cls}`}>
          {STATUS.filter((s) => s.id !== 'rencana' || p.status === 'rencana').map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
        </select>
        <div className="ml-auto flex gap-1.5">
          <button onClick={onKelola} title="Kelola siklus: pelaksanaan → monitoring → evaluasi → penyelesaian → arsip" className="border border-accent/40 text-accent rounded px-2 py-1 text-[11px] hover:bg-accent/10 font-semibold">📋 Kelola</button>
          <button onClick={onEdit} className="border border-border text-text2 rounded px-2 py-1 text-[11px] hover:text-text">✏️</button>
          <button onClick={onDelete} className="border border-danger/40 text-danger rounded px-2 py-1 text-[11px]">🗑️</button>
        </div>
      </div>
    </div>
  );
}

interface Form {
  tahun: number; kuartal: number; kategori: string; judul: string; deskripsi: string;
  tujuan: string; keluaran: string; volume: string; indikator: string;
  prioritas: string; status: string; progres: number; estimasi_biaya: number;
  realisasi_biaya: number | ''; sumber_dana: string; start_date: string; target_date: string; metode: string;
  pic_nama: string; catatan: string;
}

function PlanModal({ plan, tahun, seed, onClose, onSaved }: { plan: UnitPlan | null; tahun: number; seed?: Partial<Form>; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState<Form>({
    tahun: plan?.tahun ?? tahun,
    kuartal: plan?.kuartal ?? 0,
    kategori: plan?.kategori ?? seed?.kategori ?? 'pemeliharaan',
    judul: plan?.judul ?? seed?.judul ?? '',
    deskripsi: plan?.deskripsi ?? seed?.deskripsi ?? '',
    tujuan: plan?.tujuan ?? seed?.tujuan ?? '',
    keluaran: plan?.keluaran ?? seed?.keluaran ?? '',
    volume: plan?.volume ?? '',
    indikator: plan?.indikator ?? '',
    prioritas: plan?.prioritas ?? 'sedang',
    // Program baru langsung dianggap disetujui → berstatus berjalan (tahap Pelaksanaan).
    status: plan?.status ?? 'berjalan',
    progres: plan?.progres ?? 0,
    estimasi_biaya: plan?.estimasi_biaya ?? 0,
    realisasi_biaya: plan?.realisasi_biaya ?? '',
    sumber_dana: plan?.sumber_dana ?? '',
    start_date: plan?.start_date ?? '',
    target_date: plan?.target_date ?? '',
    metode: plan?.metode ?? '',
    pic_nama: plan?.pic_nama ?? '',
    catatan: plan?.catatan ?? '',
  });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setF((p) => ({ ...p, [k]: v }));

  async function save() {
    const miss: string[] = [];
    if (!f.judul.trim()) miss.push('Judul');
    if (!f.tujuan.trim()) miss.push('Tujuan');
    if (!f.keluaran.trim()) miss.push('Output/Keluaran');
    if (!f.target_date) miss.push('Target selesai');
    if (!f.pic_nama.trim()) miss.push('PIC');
    if (miss.length) return setErr('Wajib diisi: ' + miss.join(', ') + '.');
    setBusy(true); setErr('');
    try {
      if (plan) await api.put(`/perencanaan/${plan.id}`, f);
      else await api.post('/perencanaan', f);
      onSaved();
    } catch (e: any) { setErr(e?.response?.data?.error || 'Gagal menyimpan.'); }
    finally { setBusy(false); }
  }

  const inp = 'w-full bg-surface2 border border-border rounded-md px-3 py-2 text-xs';
  const lbl = 'block text-[11px] text-text2 mb-1';
  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-surface border border-border rounded-xl w-full max-w-lg p-5 max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-sm font-bold mb-4">{plan ? '✏️ Edit Rencana' : '+ Rencana Baru'}</h3>

        <label className={lbl}>Judul rencana <span className="text-danger">*</span></label>
        <input className={`${inp} mb-3`} value={f.judul} onChange={(e) => set('judul', e.target.value)} placeholder="mis. Peremajaan switch core Terminal A" />

        <div className="grid grid-cols-2 gap-3 mb-3">
          <div><label className={lbl}>Kategori</label>
            <select className={inp} value={f.kategori} onChange={(e) => set('kategori', e.target.value)}>{KATEGORI.map((k) => <option key={k.id} value={k.id}>{k.icon} {k.label}</option>)}</select></div>
          <div><label className={lbl}>Periode</label>
            <select className={inp} value={f.kuartal} onChange={(e) => set('kuartal', Number(e.target.value))}>{KUARTAL.map((k, i) => <option key={i} value={i}>{k}</option>)}</select></div>
        </div>

        {/* Substansi — inti yang mengisi narasi Korektif di dokumen PDF */}
        <div className="text-[11px] font-semibold text-accent2 mb-2 mt-1">📌 Substansi</div>
        <label className={lbl}>Tujuan / sasaran <span className="text-danger">*</span></label>
        <textarea className={`${inp} min-h-[46px] mb-3`} value={f.tujuan} onChange={(e) => set('tujuan', e.target.value)} placeholder="Apa yang ingin dicapai rencana ini…" />
        <div className="grid grid-cols-3 gap-3 mb-3">
          <div className="col-span-2"><label className={lbl}>Output / Keluaran <span className="text-danger">*</span></label>
            <input className={inp} value={f.keluaran} onChange={(e) => set('keluaran', e.target.value)} placeholder="mis. APD lengkap teknisi" /></div>
          <div><label className={lbl}>Volume</label>
            <input className={inp} value={f.volume} onChange={(e) => set('volume', e.target.value)} placeholder="mis. 10 set" /></div>
        </div>
        <label className={lbl}>Indikator keberhasilan</label>
        <input className={`${inp} mb-3`} value={f.indikator} onChange={(e) => set('indikator', e.target.value)} placeholder="mis. 0 kecelakaan kerja / 100% teknisi ber-APD" />

        <div className="grid grid-cols-2 gap-3 mb-3">
          <div><label className={lbl}>Prioritas</label>
            <select className={inp} value={f.prioritas} onChange={(e) => set('prioritas', e.target.value)}><option value="tinggi">Tinggi</option><option value="sedang">Sedang</option><option value="rendah">Rendah</option></select></div>
          <div><label className={lbl}>Status</label>
            <select className={inp} value={f.status} onChange={(e) => set('status', e.target.value)}>{STATUS.filter((s) => s.id !== 'rencana' || f.status === 'rencana').map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}</select></div>
        </div>
        {!plan && (
          <div className="mb-3 text-[10.5px] text-text2 bg-surface2/50 border border-border rounded-md px-3 py-2">
            ℹ️ Program yang dimasukkan <b>langsung dianggap disetujui</b> dan berjalan di tahap <b>Pelaksanaan</b>. Lanjutan siklusnya (monitoring → evaluasi → penyelesaian → arsip) dikelola lewat tombol <b>📋 Kelola</b> pada kartu program.
          </div>
        )}

        {/* Jadwal — rentang mulai→selesai mengisi matriks jadwal tahunan di PDF */}
        <div className="grid grid-cols-3 gap-3 mb-3">
          <div><label className={lbl}>Tanggal mulai</label>
            <input type="date" className={inp} value={f.start_date || ''} onChange={(e) => set('start_date', e.target.value)} /></div>
          <div><label className={lbl}>Target selesai <span className="text-danger">*</span></label>
            <input type="date" className={inp} value={f.target_date || ''} onChange={(e) => set('target_date', e.target.value)} /></div>
          <div><label className={lbl}>Progres (%)</label>
            <input type="number" min={0} max={100} className={inp} value={f.progres} onChange={(e) => set('progres', Math.min(100, Math.max(0, Number(e.target.value) || 0)))} /></div>
        </div>

        {/* Anggaran */}
        <div className="grid grid-cols-2 gap-3 mb-3">
          <div><label className={lbl}>Estimasi biaya (Rp)</label>
            <input type="number" min={0} className={inp} value={f.estimasi_biaya} onChange={(e) => set('estimasi_biaya', Math.max(0, Number(e.target.value) || 0))} /></div>
          <div><label className={lbl}>Realisasi biaya (Rp)</label>
            <input type="number" min={0} className={inp} value={f.realisasi_biaya} onChange={(e) => set('realisasi_biaya', e.target.value === '' ? '' : Math.max(0, Number(e.target.value) || 0))} placeholder="kosong = belum" /></div>
        </div>
        <div className="grid grid-cols-2 gap-3 mb-3">
          <div><label className={lbl}>Sumber dana</label>
            <select className={inp} value={f.sumber_dana} onChange={(e) => set('sumber_dana', e.target.value)}><option value="">—</option>{SUMBER_DANA.map((s) => <option key={s} value={s}>{s}</option>)}</select></div>
          <div><label className={lbl}>Metode <span className="text-text2/60">(opsional)</span></label>
            <select className={inp} value={f.metode} onChange={(e) => set('metode', e.target.value)}><option value="">—</option>{METODE.map((m) => <option key={m} value={m}>{m}</option>)}</select></div>
        </div>

        <label className={lbl}>PIC / Penanggung jawab <span className="text-danger">*</span></label>
        <input className={`${inp} mb-3`} value={f.pic_nama} onChange={(e) => set('pic_nama', e.target.value)} placeholder="Nama penanggung jawab" />

        <label className={lbl}>Latar belakang / deskripsi</label>
        <textarea className={`${inp} min-h-[54px] mb-3`} value={f.deskripsi} onChange={(e) => set('deskripsi', e.target.value)} placeholder="Rincian rencana, latar belakang, keterangan…" />

        <label className={lbl}>Catatan</label>
        <input className={`${inp} mb-3`} value={f.catatan} onChange={(e) => set('catatan', e.target.value)} />

        {err && <div className="bg-danger/10 border border-danger/30 rounded-md px-3 py-2 text-[11px] text-danger mb-3">⚠️ {err}</div>}
        <div className="flex gap-2 justify-end">
          <button className="border border-border text-text2 rounded-md px-3 py-1.5 text-xs" onClick={onClose} disabled={busy}>Batal</button>
          <button className="bg-accent text-bg rounded-md px-3 py-1.5 text-xs font-semibold disabled:opacity-50" onClick={save} disabled={busy}>{busy ? 'Menyimpan…' : 'Simpan'}</button>
        </div>
      </div>
    </div>
  );
}

// ===================== SIKLUS PROGRAM =====================
// Pelaksanaan → Monitoring → Evaluasi → Penyelesaian → Arsip.
// Program dianggap disetujui sejak dimasukkan, jadi modal ini langsung membuka tahap kerja.
function SiklusModal({ planId, lkp, onClose, onChanged }: { planId: number; lkp: PkLkp; onClose: () => void; onChanged: () => void }) {
  const [d, setD] = useState<UnitPlanDetail | null>(null);
  const [step, setStep] = useState<string>('pelaksanaan');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  // Form tahap Pelaksanaan
  const [logTgl, setLogTgl] = useState(new Date().toISOString().slice(0, 10));
  const [logCatatan, setLogCatatan] = useState('');
  const [logProgres, setLogProgres] = useState<string>('');
  const [logFiles, setLogFiles] = useState<File[]>([]);
  // Form tahap Monitoring & Evaluasi
  const [mon, setMon] = useState({ progres: 0, kendala: '', tindak_lanjut: '' });
  const [evl, setEvl] = useState({ hasil: '', nilai_keberhasilan: '', evaluasi_catatan: '' });
  const [realisasi, setRealisasi] = useState<string>('');

  function apply(data: UnitPlanDetail) {
    setD(data);
    const p = data.plan;
    setStep(p.tahap);
    setMon({ progres: p.progres, kendala: p.kendala || '', tindak_lanjut: p.tindak_lanjut || '' });
    setEvl({ hasil: p.hasil || '', nilai_keberhasilan: p.nilai_keberhasilan || '', evaluasi_catatan: p.evaluasi_catatan || '' });
    setRealisasi(p.realisasi_biaya != null ? String(p.realisasi_biaya) : '');
  }
  useEffect(() => { api.get(`/perencanaan/${planId}`).then((r) => apply(r.data)).catch(() => setErr('Gagal memuat program.')); }, [planId]);

  async function call(fn: () => Promise<{ data: UnitPlanDetail }>) {
    setBusy(true); setErr('');
    try { const r = await fn(); apply(r.data); onChanged(); }
    catch (e: any) { setErr(e?.response?.data?.error || 'Gagal menyimpan.'); }
    finally { setBusy(false); }
  }

  async function simpanLog() {
    if (!logCatatan.trim()) { setErr('Catatan aktivitas wajib diisi.'); return; }
    const fd = new FormData();
    fd.append('tanggal', logTgl); fd.append('catatan', logCatatan);
    if (logProgres !== '') fd.append('progres', logProgres);
    logFiles.forEach((f) => fd.append('files', f));
    await call(() => api.post(`/perencanaan/${planId}/log`, fd, { headers: { 'Content-Type': 'multipart/form-data' } }));
    setLogCatatan(''); setLogProgres(''); setLogFiles([]);
  }
  async function unggah(jenis: 'laporan' | 'bukti' | 'dokumentasi', files: File[], keterangan = '') {
    if (!files.length) return;
    const fd = new FormData();
    fd.append('jenis', jenis);
    if (keterangan) fd.append('keterangan', keterangan);
    files.forEach((f) => fd.append('files', f));
    await call(() => api.post(`/perencanaan/${planId}/files`, fd, { headers: { 'Content-Type': 'multipart/form-data' } }));
  }
  async function hapusFile(id: number) {
    if (!(await confirmDialog({ title: 'Hapus berkas', message: 'Berkas akan dihapus permanen.', confirmText: '🗑️ Hapus', variant: 'danger' }))) return;
    await call(() => api.delete(`/perencanaan/files/${id}`));
  }
  async function hapusLog(id: number) {
    if (!(await confirmDialog({ title: 'Hapus catatan', message: 'Catatan aktivitas beserta dokumentasinya akan dihapus.', confirmText: '🗑️ Hapus', variant: 'danger' }))) return;
    await call(() => api.delete(`/perencanaan/log/${id}`));
  }

  function cetak() {
    if (!d) return;
    const html = buildLaporanProgramHtml({ plan: d.plan, logs: d.logs, files: d.files, lkp }, window.location.origin);
    const w = window.open('', '_blank');
    if (!w) return;
    w.document.write(html); w.document.close();
    setTimeout(() => { try { w.focus(); w.print(); } catch { /* diabaikan */ } }, 500);
  }

  const p = d?.plan;
  const laporanFiles = (d?.files || []).filter((f) => f.jenis === 'laporan');
  const buktiFiles = (d?.files || []).filter((f) => f.jenis === 'bukti');
  const stepIdx = TAHAP.findIndex((t) => t.id === step);
  const curIdx = p ? TAHAP.findIndex((t) => t.id === p.tahap) : 0;
  const inp = 'w-full bg-surface2 border border-border rounded-md px-3 py-2 text-xs';

  return (
    <div className="fixed inset-0 z-[300] bg-black/60 flex items-start justify-center p-4 overflow-y-auto" onClick={onClose}>
      <div className="bg-surface border border-border rounded-xl w-full max-w-3xl my-6" onClick={(e) => e.stopPropagation()}>
        {/* Header + stepper */}
        <div className="p-4 border-b border-border">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="text-sm font-bold truncate">{p?.judul || 'Memuat…'}</div>
              <div className="text-[11px] text-text2">{p ? `${katOf(p.kategori).icon} ${katOf(p.kategori).label} · ${KUARTAL[Number(p.kuartal) || 0]} ${p.tahun} · progres ${p.progres}%` : ''}</div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <button onClick={cetak} disabled={!d} className="border border-accent2/40 text-accent2 rounded-md px-2.5 py-1 text-[11px] hover:bg-accent2/10 disabled:opacity-50">🖨️ Cetak Laporan</button>
              <button onClick={onClose} className="text-text2 hover:text-text text-lg leading-none">×</button>
            </div>
          </div>
          <div className="flex items-center gap-1 mt-3 flex-wrap">
            {TAHAP.map((t, i) => (
              <button key={t.id} onClick={() => setStep(t.id)}
                className={`flex items-center gap-1 rounded-md px-2 py-1 text-[10.5px] border ${step === t.id ? t.cls + ' font-semibold' : i <= curIdx ? 'border-border text-text' : 'border-border/60 text-text2'}`}>
                <span>{i < curIdx ? '✓' : t.icon}</span>{t.label}
              </button>
            ))}
          </div>
          <div className="text-[10.5px] text-text2 mt-2">{TAHAP[Math.max(0, stepIdx)].desc}</div>
        </div>

        <div className="p-4 space-y-3">
          {err && <div className="bg-danger/10 border border-danger/30 rounded-md px-3 py-2 text-[11px] text-danger">⚠️ {err}</div>}
          {!p ? <div className="text-center text-text2 text-sm py-8">Memuat…</div> : (<>

            {/* ---------- PELAKSANAAN ---------- */}
            {step === 'pelaksanaan' && (
              <>
                <div className="border border-border rounded-lg p-3 bg-surface2/40">
                  <div className="text-[11px] font-semibold mb-2">➕ Catat Aktivitas / Progres</div>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 mb-2">
                    <div><label className="text-[10px] text-text2">Tanggal</label><input type="date" className={inp} value={logTgl} onChange={(e) => setLogTgl(e.target.value)} /></div>
                    <div><label className="text-[10px] text-text2">Progres (%) — opsional</label><input type="number" min={0} max={100} className={inp} value={logProgres} onChange={(e) => setLogProgres(e.target.value)} placeholder={String(p.progres)} /></div>
                    <div><label className="text-[10px] text-text2">📷 Dokumentasi (foto/PDF)</label>
                      <input type="file" multiple accept="image/*,application/pdf" onChange={(e) => setLogFiles([...(e.target.files || [])])}
                        className="w-full text-[10px] text-text2 file:mr-2 file:py-1.5 file:px-2 file:rounded file:border-0 file:bg-surface2 file:text-text" />
                    </div>
                  </div>
                  <textarea className={inp} rows={2} placeholder="Aktivitas yang dikerjakan / capaian hari ini…" value={logCatatan} onChange={(e) => setLogCatatan(e.target.value)} />
                  <div className="flex justify-end mt-2">
                    <button onClick={simpanLog} disabled={busy} className="bg-accent text-bg rounded-md px-3 py-1.5 text-xs font-semibold disabled:opacity-50">{busy ? 'Menyimpan…' : 'Simpan Catatan'}</button>
                  </div>
                </div>

                <div className="text-[11px] font-semibold">🗓️ Kronologi Pelaksanaan ({d!.logs.length})</div>
                {d!.logs.length === 0 ? (
                  <div className="text-[11px] text-text2 border border-dashed border-border rounded-lg p-4 text-center">Belum ada catatan aktivitas.</div>
                ) : d!.logs.map((l) => {
                  const foto = d!.files.filter((f) => f.log_id === l.id);
                  return (
                    <div key={l.id} className="border border-border rounded-lg p-3">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <div className="text-[11px] font-semibold">{l.tanggal}{l.progres != null ? ` · progres ${l.progres}%` : ''}</div>
                          <div className="text-[11px] whitespace-pre-wrap mt-0.5">{l.catatan}</div>
                          <div className="text-[9.5px] text-text2 mt-1">✍️ {l.creator_name || '-'}</div>
                        </div>
                        <button onClick={() => hapusLog(l.id)} className="text-danger text-[11px] shrink-0">🗑️</button>
                      </div>
                      {foto.length > 0 && <FileStrip files={foto} onDelete={hapusFile} />}
                    </div>
                  );
                })}
              </>
            )}

            {/* ---------- MONITORING ---------- */}
            {step === 'monitoring' && (
              <div className="space-y-3">
                <div>
                  <label className="text-[11px] text-text2">Persentase Progres: <b className="text-text">{mon.progres}%</b></label>
                  <input type="range" min={0} max={100} value={mon.progres} onChange={(e) => setMon({ ...mon, progres: Number(e.target.value) })} className="w-full accent-accent" />
                </div>
                <div><label className="text-[11px] text-text2">Kendala yang dihadapi</label>
                  <textarea className={inp} rows={3} value={mon.kendala} onChange={(e) => setMon({ ...mon, kendala: e.target.value })} placeholder="mis. keterlambatan pengiriman suku cadang…" /></div>
                <div><label className="text-[11px] text-text2">Solusi / tindak lanjut</label>
                  <textarea className={inp} rows={3} value={mon.tindak_lanjut} onChange={(e) => setMon({ ...mon, tindak_lanjut: e.target.value })} placeholder="mis. mengajukan vendor alternatif…" /></div>
                <div className="flex justify-end">
                  <button onClick={() => call(() => api.put(`/perencanaan/${planId}/monitoring`, mon))} disabled={busy} className="bg-accent text-bg rounded-md px-3 py-1.5 text-xs font-semibold disabled:opacity-50">💾 Simpan Monitoring</button>
                </div>
              </div>
            )}

            {/* ---------- EVALUASI ---------- */}
            {step === 'evaluasi' && (
              <div className="space-y-3">
                <div className="border border-border rounded-lg p-3 bg-surface2/40">
                  <div className="text-[10px] text-text2 uppercase tracking-wide">Target / Indikator (dari rencana)</div>
                  <div className="text-[11.5px] whitespace-pre-wrap">{p.indikator || p.keluaran || <span className="text-text2 italic">belum diisi di rencana</span>}</div>
                </div>
                <div><label className="text-[11px] text-text2">Hasil yang dicapai</label>
                  <textarea className={inp} rows={3} value={evl.hasil} onChange={(e) => setEvl({ ...evl, hasil: e.target.value })} placeholder="Realisasi nyata dibanding target…" /></div>
                <div><label className="text-[11px] text-text2">Penilaian keberhasilan</label>
                  <select className={inp} value={evl.nilai_keberhasilan} onChange={(e) => setEvl({ ...evl, nilai_keberhasilan: e.target.value })}>
                    <option value="">— pilih —</option>
                    {NILAI_KEBERHASILAN.map((n) => <option key={n.id} value={n.id}>{n.label}</option>)}
                  </select></div>
                <div><label className="text-[11px] text-text2">Catatan evaluasi</label>
                  <textarea className={inp} rows={3} value={evl.evaluasi_catatan} onChange={(e) => setEvl({ ...evl, evaluasi_catatan: e.target.value })} placeholder="Pembelajaran, rekomendasi untuk program berikutnya…" /></div>
                <div className="flex justify-end">
                  <button onClick={() => call(() => api.put(`/perencanaan/${planId}/evaluasi`, evl))} disabled={busy} className="bg-accent text-bg rounded-md px-3 py-1.5 text-xs font-semibold disabled:opacity-50">💾 Simpan Evaluasi</button>
                </div>
              </div>
            )}

            {/* ---------- PENYELESAIAN ---------- */}
            {step === 'penyelesaian' && (
              <div className="space-y-3">
                <UploadBox label="📄 Laporan Akhir (wajib)" hint="PDF/DOC hasil akhir program." busy={busy} onPick={(fs) => unggah('laporan', fs)} />
                <FileList title={`Laporan akhir (${laporanFiles.length})`} files={laporanFiles} onDelete={hapusFile} />
                <UploadBox label="📎 Bukti / Dokumentasi Pendukung" hint="Foto, berita acara, kuitansi, dsb." busy={busy} onPick={(fs) => unggah('bukti', fs)} />
                <FileList title={`Bukti pendukung (${buktiFiles.length})`} files={buktiFiles} onDelete={hapusFile} />
                <div><label className="text-[11px] text-text2">Realisasi anggaran (Rp) — opsional</label>
                  <input type="number" className={inp} value={realisasi} onChange={(e) => setRealisasi(e.target.value)} placeholder={String(p.estimasi_biaya || 0)} /></div>
                {p.status === 'selesai' ? (
                  <div className="bg-success/10 border border-success/30 rounded-md px-3 py-2 text-[11px] text-success">✅ Program sudah ditandai <b>Selesai</b>{p.selesai_at ? ` pada ${String(p.selesai_at).slice(0, 10)}` : ''}. Lanjutkan ke tahap Arsip.</div>
                ) : (
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <span className="text-[10.5px] text-text2">{laporanFiles.length ? 'Laporan akhir sudah diunggah.' : '⚠️ Unggah laporan akhir dulu untuk bisa menandai selesai.'}</span>
                    <button onClick={() => call(() => api.post(`/perencanaan/${planId}/selesai`, { realisasi_biaya: realisasi }))} disabled={busy || !laporanFiles.length}
                      className="bg-success text-bg rounded-md px-3 py-1.5 text-xs font-semibold disabled:opacity-40">✅ Tandai Selesai</button>
                  </div>
                )}
              </div>
            )}

            {/* ---------- ARSIP ---------- */}
            {step === 'arsip' && (
              <div className="space-y-3">
                <div className="text-[11.5px] text-text2">Program yang diarsipkan disembunyikan dari daftar aktif, namun tetap dapat dibuka dan dicetak laporannya kapan saja (tombol <b>Lihat arsip</b> pada toolbar).</div>
                {p.tahap === 'arsip' ? (
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <span className="bg-surface2 border border-border rounded-md px-3 py-2 text-[11px]">📦 Diarsipkan{p.arsip_at ? ` pada ${String(p.arsip_at).slice(0, 10)}` : ''}.</span>
                    <button onClick={() => call(() => api.post(`/perencanaan/${planId}/buka-arsip`))} disabled={busy} className="border border-border text-text2 hover:text-text rounded-md px-3 py-1.5 text-xs">↩️ Keluarkan dari Arsip</button>
                  </div>
                ) : (
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <span className="text-[10.5px] text-text2">{p.status === 'selesai' ? 'Program siap diarsipkan.' : '⚠️ Program harus berstatus Selesai dulu (tahap Penyelesaian).'}</span>
                    <button onClick={() => call(() => api.post(`/perencanaan/${planId}/arsip`))} disabled={busy || p.status !== 'selesai'} className="bg-accent2 text-bg rounded-md px-3 py-1.5 text-xs font-semibold disabled:opacity-40">📦 Arsipkan Program</button>
                  </div>
                )}
              </div>
            )}
          </>)}
        </div>
      </div>
    </div>
  );
}

function UploadBox({ label, hint, busy, onPick }: { label: string; hint: string; busy: boolean; onPick: (files: File[]) => void }) {
  return (
    <div className="border border-dashed border-border rounded-lg p-3">
      <div className="text-[11px] font-semibold">{label}</div>
      <div className="text-[10px] text-text2 mb-1.5">{hint}</div>
      <input type="file" multiple disabled={busy} onChange={(e) => { const fs = [...(e.target.files || [])]; e.target.value = ''; onPick(fs); }}
        className="w-full text-[10px] text-text2 file:mr-2 file:py-1.5 file:px-2 file:rounded file:border-0 file:bg-surface2 file:text-text" />
    </div>
  );
}
function FileList({ title, files, onDelete }: { title: string; files: UnitPlanFile[]; onDelete: (id: number) => void }) {
  if (!files.length) return <div className="text-[10.5px] text-text2">{title} — belum ada berkas.</div>;
  return (
    <div>
      <div className="text-[10.5px] text-text2 mb-1">{title}</div>
      <FileStrip files={files} onDelete={onDelete} />
    </div>
  );
}
function FileStrip({ files, onDelete }: { files: UnitPlanFile[]; onDelete: (id: number) => void }) {
  const isImg = (u: string) => /\.(jpe?g|png|webp|gif)$/i.test(u);
  return (
    <div className="flex flex-wrap gap-2 mt-1.5">
      {files.map((f) => (
        <div key={f.id} className="relative group">
          {isImg(f.url)
            ? <button type="button" onClick={() => openImage(f.url)} title={f.filename || ''}><img src={f.url} alt={f.filename || 'dokumentasi'} className="w-14 h-14 object-cover rounded border border-border" /></button>
            : <a href={f.url} target="_blank" rel="noreferrer" title={f.filename || ''} className="w-14 h-14 rounded border border-border flex items-center justify-center text-[10px] text-accent2 bg-surface2 text-center px-1">📄 {(f.filename || 'berkas').slice(0, 12)}</a>}
          <button onClick={() => onDelete(f.id)} title="Hapus berkas"
            className="absolute -top-1.5 -right-1.5 w-4 h-4 rounded-full bg-danger text-bg text-[9px] leading-none opacity-0 group-hover:opacity-100 transition">×</button>
        </div>
      ))}
    </div>
  );
}

// ===================== TAB ANGGARAN =====================
function AnggaranTab({ plans }: { plans: UnitPlan[] }) {
  const agg = useMemo(() => {
    const byKat = new Map<string, { est: number; real: number; n: number }>();
    const byKuartal = new Map<number, { est: number; real: number; n: number }>();
    let totEst = 0, totReal = 0;
    for (const p of plans) {
      const est = Number(p.estimasi_biaya) || 0;
      const real = Number(p.realisasi_biaya) || 0;
      totEst += est; totReal += real;
      const k = byKat.get(p.kategori) || { est: 0, real: 0, n: 0 }; k.est += est; k.real += real; k.n++; byKat.set(p.kategori, k);
      const q = byKuartal.get(p.kuartal) || { est: 0, real: 0, n: 0 }; q.est += est; q.real += real; q.n++; byKuartal.set(p.kuartal, q);
    }
    return { byKat, byKuartal, totEst, totReal };
  }, [plans]);

  if (plans.length === 0) return <div className="text-center py-12 text-text2 text-sm bg-surface border border-border rounded-xl">Belum ada data anggaran — tambahkan rencana di tab Program Kerja.</div>;

  const sisa = agg.totEst - agg.totReal;
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <Stat label="Total Estimasi" value={rp(agg.totEst)} small />
        <Stat label="Total Realisasi" value={rp(agg.totReal)} small cls="text-success" />
        <Stat label="Sisa (Estimasi − Realisasi)" value={rp(sisa)} small cls={sisa < 0 ? 'text-danger' : ''} />
      </div>
      <BudgetTable title="Anggaran per Kategori" totEst={agg.totEst}
        rows={KATEGORI.filter((k) => agg.byKat.has(k.id)).map((k) => ({ label: `${k.icon} ${k.label}`, ...agg.byKat.get(k.id)! }))} />
      <BudgetTable title="Anggaran per Triwulan" totEst={agg.totEst}
        rows={[1, 2, 3, 4, 0].filter((q) => agg.byKuartal.has(q)).map((q) => ({ label: KUARTAL[q], ...agg.byKuartal.get(q)! }))} />
    </div>
  );
}

function BudgetTable({ title, rows, totEst }: { title: string; rows: { label: string; est: number; real: number; n: number }[]; totEst: number }) {
  return (
    <div className="bg-surface border border-border rounded-xl overflow-hidden">
      <div className="px-4 py-2.5 border-b border-border text-xs font-semibold">{title}</div>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead><tr className="text-text2 uppercase text-[10px] border-b border-border">
            {['Pos', 'Jml', 'Estimasi', 'Realisasi', '% Anggaran'].map((h) => <th key={h} className={`px-3 py-2 ${h === 'Pos' ? 'text-left' : 'text-right'}`}>{h}</th>)}
          </tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.label} className="border-b border-border/40 last:border-0">
                <td className="px-3 py-2">{r.label}</td>
                <td className="px-3 py-2 text-right text-text2">{r.n}</td>
                <td className="px-3 py-2 text-right font-mono">{rp(r.est)}</td>
                <td className="px-3 py-2 text-right font-mono text-success">{r.real ? rp(r.real) : '-'}</td>
                <td className="px-3 py-2 text-right text-text2">{totEst ? Math.round((r.est / totEst) * 100) : 0}%</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ===================== TAB PENGADAAN & PEREMAJAAN =====================
interface Peremajaan { sumber: string; id: number; nama: string; tipe: string; tahun: string | null; umur: number | null; kondisi: string | null; lokasi: string | null; alasan: string }

function PengadaanTab({ tahun, onPlanCreated }: { tahun: number; onPlanCreated: () => void }) {
  const [items, setItems] = useState<Peremajaan[]>([]);
  const [umurMax, setUmurMax] = useState(5);
  const [loading, setLoading] = useState(false);
  const [seed, setSeed] = useState<Partial<Form> | null>(null);

  function load() {
    setLoading(true);
    api.get(`/perencanaan/peremajaan?umurMax=${umurMax}`).then((r) => setItems(r.data.items || [])).finally(() => setLoading(false));
  }
  useEffect(load, [umurMax]);

  return (
    <div>
      <div className="flex items-center gap-3 mb-3 flex-wrap">
        <div className="text-xs text-text2">Kandidat peremajaan dari inventaris unit (perangkat &amp; aset) — berdasarkan umur atau kondisi. Ubah jadi Rencana Pengadaan sekali klik.</div>
        <label className="text-xs text-text2 ml-auto whitespace-nowrap">Umur ≥
          <input type="number" min={1} max={30} value={umurMax} onChange={(e) => setUmurMax(Math.max(1, Number(e.target.value) || 5))} className="mx-2 w-16 bg-surface2 border border-border rounded-md px-2 py-1.5 text-xs" />th
        </label>
      </div>
      {loading ? (
        <div className="text-center py-10 text-text2 text-sm">Memuat…</div>
      ) : items.length === 0 ? (
        <div className="text-center py-12 text-text2 text-sm bg-surface border border-border rounded-xl">✅ Tidak ada perangkat/aset yang perlu diremajakan (umur ≥ {umurMax} th atau kondisi rusak).</div>
      ) : (
        <div className="bg-surface border border-border rounded-xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead><tr className="text-text2 uppercase text-[10px] border-b border-border">
                {['Nama', 'Sumber', 'Tipe', 'Umur', 'Kondisi', 'Alasan', ''].map((h) => <th key={h} className="px-3 py-2 text-left">{h}</th>)}
              </tr></thead>
              <tbody>
                {items.map((it) => (
                  <tr key={`${it.sumber}-${it.id}`} className="border-b border-border/40 last:border-0">
                    <td className="px-3 py-2 font-semibold">{it.nama}</td>
                    <td className="px-3 py-2"><span className="text-[10px] px-1.5 py-0.5 rounded border border-border text-text2 whitespace-nowrap">{it.sumber === 'aset' ? '📦 Aset' : '🖥️ Perangkat'}</span></td>
                    <td className="px-3 py-2 text-text2">{it.tipe}</td>
                    <td className="px-3 py-2 text-text2 whitespace-nowrap">{it.umur != null ? `${it.umur} th` : (it.tahun || '-')}</td>
                    <td className="px-3 py-2 text-text2">{it.kondisi || '-'}</td>
                    <td className="px-3 py-2"><span className="text-warn">{it.alasan}</span></td>
                    <td className="px-3 py-2 text-right">
                      <button
                        onClick={() => setSeed({ kategori: 'pengadaan', judul: `Peremajaan ${it.nama}`, deskripsi: `${it.sumber === 'aset' ? 'Aset' : 'Perangkat'}: ${it.nama} (${it.tipe}). Alasan: ${it.alasan}.` })}
                        className="border border-accent/40 text-accent rounded px-2 py-1 text-[11px] font-semibold whitespace-nowrap">+ Jadikan Rencana</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
      {seed && <PlanModal plan={null} tahun={tahun} seed={seed} onClose={() => setSeed(null)} onSaved={() => { setSeed(null); onPlanCreated(); }} />}
    </div>
  );
}

// ===================== TAB TARGET & KPI =====================
const KPI_TEMPLATES = [
  { label: 'Uptime Jaringan', satuan: '%', arah: 'naik', target: 99 },
  { label: 'Pemenuhan SLA', satuan: '%', arah: 'naik', target: 95 },
  { label: 'Skor Performa Unit', satuan: '', arah: 'naik', target: 85 },
  { label: 'MTTR (rata² penyelesaian)', satuan: 'jam', arah: 'turun', target: 4 },
  { label: 'Ketersediaan Alat', satuan: '%', arah: 'naik', target: 95 },
];

function kpiPct(k: UnitKpi): number | null {
  if (k.target == null || k.realisasi == null) return null;
  const t = Number(k.target), r = Number(k.realisasi);
  if (!Number.isFinite(t) || !Number.isFinite(r)) return null;
  if (k.arah === 'turun') return r <= 0 ? 100 : Math.round((t / r) * 100);
  return t <= 0 ? (r > 0 ? 100 : 0) : Math.round((r / t) * 100);
}

function KpiTab({ tahun }: { tahun: number }) {
  const [rows, setRows] = useState<UnitKpi[]>([]);
  const [loading, setLoading] = useState(false);
  const [edit, setEdit] = useState<UnitKpi | 'new' | null>(null);

  function load() {
    setLoading(true);
    api.get(`/perencanaan/kpi?tahun=${tahun}`).then((r) => setRows(r.data.kpi || [])).finally(() => setLoading(false));
  }
  useEffect(load, [tahun]);

  async function del(k: UnitKpi) {
    if (!(await confirmDialog({ title: 'Hapus KPI', message: `KPI "${k.label}" akan dihapus.`, confirmText: '🗑️ Hapus', variant: 'danger' }))) return;
    await api.delete(`/perencanaan/kpi/${k.id}`); load();
  }
  async function addTemplate(t: typeof KPI_TEMPLATES[number]) {
    await api.post('/perencanaan/kpi', { tahun, label: t.label, satuan: t.satuan, target: t.target, arah: t.arah });
    load();
  }

  return (
    <div>
      <div className="flex items-center gap-2 mb-3 flex-wrap">
        <div className="text-xs text-text2">Target kinerja unit {tahun}. Realisasi diisi manual — rujuk halaman <span className="text-text">Laporan SLA</span> &amp; <span className="text-text">Performa Teknisi</span>.</div>
        <button onClick={() => setEdit('new')} className="bg-accent text-bg rounded-md px-3 py-1.5 text-xs font-semibold ml-auto">+ Tambah KPI</button>
      </div>

      {!loading && rows.length === 0 && (
        <div className="bg-surface border border-border rounded-xl p-4 mb-3">
          <div className="text-xs text-text2 mb-2">Belum ada KPI. Tambah cepat dari templat:</div>
          <div className="flex flex-wrap gap-2">
            {KPI_TEMPLATES.map((t) => <button key={t.label} onClick={() => addTemplate(t)} className="border border-accent2/40 text-accent2 rounded-md px-2.5 py-1 text-[11px]">+ {t.label}</button>)}
          </div>
        </div>
      )}

      {loading ? <div className="text-center py-10 text-text2 text-sm">Memuat…</div>
        : rows.length === 0 ? null
        : (
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
            {rows.map((k) => <KpiCard key={k.id} k={k} onEdit={() => setEdit(k)} onDelete={() => del(k)} />)}
          </div>
        )}
      {edit && <KpiModal kpi={edit === 'new' ? null : edit} tahun={tahun} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); load(); }} />}
    </div>
  );
}

function KpiCard({ k, onEdit, onDelete }: { k: UnitKpi; onEdit: () => void; onDelete: () => void }) {
  const pct = kpiPct(k);
  const tercapai = pct != null && pct >= 100;
  const barPct = pct == null ? 0 : Math.min(100, Math.max(0, pct));
  const fmt = (v: number | null) => v == null ? '-' : `${Number(v)}${k.satuan ? ' ' + k.satuan : ''}`;
  return (
    <div className="bg-surface border border-border rounded-xl p-3.5 flex flex-col gap-2">
      <div className="flex items-start justify-between gap-2">
        <div className="font-semibold text-sm leading-snug">{k.label}</div>
        <span className={`shrink-0 text-[9px] font-semibold px-1.5 py-0.5 rounded-full border ${pct == null ? 'text-text2 border-border' : tercapai ? 'text-success bg-success/10 border-success/40' : 'text-warn bg-warn/10 border-warn/40'}`}>{pct == null ? 'Belum diisi' : tercapai ? 'Tercapai' : `${pct}%`}</span>
      </div>
      <div className="flex items-end justify-between text-xs">
        <div><div className="text-[10px] text-text2">Target</div><div className="font-bold">{fmt(k.target)}</div></div>
        <div className="text-right"><div className="text-[10px] text-text2">Realisasi</div><div className="font-bold">{fmt(k.realisasi)}</div></div>
      </div>
      <div className="h-1.5 bg-surface2 rounded-full overflow-hidden"><div className={`h-full rounded-full ${tercapai ? 'bg-success' : 'bg-accent'}`} style={{ width: `${barPct}%` }} /></div>
      <div className="text-[10px] text-text2">{k.arah === 'turun' ? '⬇️ makin rendah makin baik' : '⬆️ makin tinggi makin baik'}{k.catatan ? ` · ${k.catatan}` : ''}</div>
      <div className="flex gap-1.5 justify-end mt-auto pt-1">
        <button onClick={onEdit} className="border border-border text-text2 rounded px-2 py-1 text-[11px] hover:text-text">✏️ Edit</button>
        <button onClick={onDelete} className="border border-danger/40 text-danger rounded px-2 py-1 text-[11px]">🗑️</button>
      </div>
    </div>
  );
}

interface KpiForm { label: string; satuan: string; target: number | ''; realisasi: number | ''; arah: string; catatan: string }

function KpiModal({ kpi, tahun, onClose, onSaved }: { kpi: UnitKpi | null; tahun: number; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState<KpiForm>({
    label: kpi?.label ?? '',
    satuan: kpi?.satuan ?? '',
    target: kpi?.target != null ? Number(kpi.target) : '',
    realisasi: kpi?.realisasi != null ? Number(kpi.realisasi) : '',
    arah: kpi?.arah ?? 'naik',
    catatan: kpi?.catatan ?? '',
  });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const set = <K extends keyof KpiForm>(k: K, v: KpiForm[K]) => setF((p) => ({ ...p, [k]: v }));

  async function save() {
    if (!f.label.trim()) return setErr('Label KPI wajib diisi.');
    setBusy(true); setErr('');
    try {
      if (kpi) await api.put(`/perencanaan/kpi/${kpi.id}`, f);
      else await api.post('/perencanaan/kpi', { ...f, tahun });
      onSaved();
    } catch (e: any) { setErr(e?.response?.data?.error || 'Gagal menyimpan.'); }
    finally { setBusy(false); }
  }

  const inp = 'w-full bg-surface2 border border-border rounded-md px-3 py-2 text-xs';
  const lbl = 'block text-[11px] text-text2 mb-1';
  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-surface border border-border rounded-xl w-full max-w-md p-5 max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-sm font-bold mb-4">{kpi ? '✏️ Edit KPI' : '+ KPI Baru'}</h3>
        <label className={lbl}>Label KPI <span className="text-danger">*</span></label>
        <input className={`${inp} mb-3`} value={f.label} onChange={(e) => set('label', e.target.value)} placeholder="mis. Uptime Jaringan" />
        <div className="grid grid-cols-3 gap-3 mb-3">
          <div><label className={lbl}>Target</label><input type="number" className={inp} value={f.target} onChange={(e) => set('target', e.target.value === '' ? '' : Number(e.target.value))} /></div>
          <div><label className={lbl}>Realisasi</label><input type="number" className={inp} value={f.realisasi} onChange={(e) => set('realisasi', e.target.value === '' ? '' : Number(e.target.value))} placeholder="kosong" /></div>
          <div><label className={lbl}>Satuan</label><input className={inp} value={f.satuan} onChange={(e) => set('satuan', e.target.value)} placeholder="%, jam…" /></div>
        </div>
        <label className={lbl}>Arah target</label>
        <select className={`${inp} mb-3`} value={f.arah} onChange={(e) => set('arah', e.target.value)}>
          <option value="naik">⬆️ Makin tinggi makin baik (uptime, SLA, skor)</option>
          <option value="turun">⬇️ Makin rendah makin baik (MTTR, downtime)</option>
        </select>
        <label className={lbl}>Catatan</label>
        <input className={`${inp} mb-3`} value={f.catatan} onChange={(e) => set('catatan', e.target.value)} />
        {err && <div className="bg-danger/10 border border-danger/30 rounded-md px-3 py-2 text-[11px] text-danger mb-3">⚠️ {err}</div>}
        <div className="flex gap-2 justify-end">
          <button className="border border-border text-text2 rounded-md px-3 py-1.5 text-xs" onClick={onClose} disabled={busy}>Batal</button>
          <button className="bg-accent text-bg rounded-md px-3 py-1.5 text-xs font-semibold disabled:opacity-50" onClick={save} disabled={busy}>{busy ? 'Menyimpan…' : 'Simpan'}</button>
        </div>
      </div>
    </div>
  );
}
