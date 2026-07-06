import { useEffect, useMemo, useState } from 'react';
import { api } from '../api/client';
import { confirmDialog } from '../components/dialog';
import type { UnitPlan, UnitKpi } from '../types';

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

export default function Perencanaan() {
  const [tab, setTab] = useState<'program' | 'anggaran' | 'pengadaan' | 'kpi'>('program');
  const [tahun, setTahun] = useState(thisYear);
  const [plans, setPlans] = useState<UnitPlan[]>([]);
  const [years, setYears] = useState<number[]>([]);
  const [loading, setLoading] = useState(false);

  function load() {
    setLoading(true);
    api.get(`/perencanaan?tahun=${tahun}`)
      .then((r) => { setPlans(r.data.plans); setYears(r.data.years || []); })
      .finally(() => setLoading(false));
  }
  useEffect(load, [tahun]);

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
        </div>
      </div>
      {tab === 'program' && <ProgramTab plans={plans} tahun={tahun} loading={loading} onChange={load} />}
      {tab === 'anggaran' && <AnggaranTab plans={plans} />}
      {tab === 'pengadaan' && <PengadaanTab tahun={tahun} onPlanCreated={load} />}
      {tab === 'kpi' && <KpiTab tahun={tahun} />}
    </div>
  );
}

// ===================== TAB PROGRAM KERJA =====================
function ProgramTab({ plans, tahun, loading, onChange }: { plans: UnitPlan[]; tahun: number; loading: boolean; onChange: () => void }) {
  const [q, setQ] = useState('');
  const [fKat, setFKat] = useState('');
  const [fStatus, setFStatus] = useState('');
  const [fPrio, setFPrio] = useState('');
  const [groupBy, setGroupBy] = useState<'kuartal' | 'kategori'>('kuartal');
  const [edit, setEdit] = useState<UnitPlan | 'new' | null>(null);

  const filtered = plans.filter((p) => {
    if (fKat && p.kategori !== fKat) return false;
    if (fStatus && p.status !== fStatus) return false;
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
        <select value={fPrio} onChange={(e) => setFPrio(e.target.value)} className="bg-surface2 border border-border rounded-md px-2 py-1.5 text-xs"><option value="">Semua Prioritas</option><option value="tinggi">Tinggi</option><option value="sedang">Sedang</option><option value="rendah">Rendah</option></select>
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
                {g.items.map((p) => <PlanCard key={p.id} p={p} onEdit={() => setEdit(p)} onDelete={() => del(p)} onQuick={quick} />)}
              </div>
            </div>
          ))}
        </div>
      )}

      {edit && <PlanModal plan={edit === 'new' ? null : edit} tahun={tahun} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); onChange(); }} />}
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

function PlanCard({ p, onEdit, onDelete, onQuick }: { p: UnitPlan; onEdit: () => void; onDelete: () => void; onQuick: (p: UnitPlan, s: string) => void }) {
  const kat = katOf(p.kategori);
  const st = stOf(p.status);
  const prio = PRIO[p.prioritas] || PRIO.sedang;
  return (
    <div className="bg-surface border border-border rounded-xl p-3.5 flex flex-col gap-2 hover:border-accent/40 transition-colors">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="font-semibold text-sm leading-snug">{p.judul}</div>
          <div className="text-[10px] text-text2 mt-0.5">{kat.icon} {kat.label}{p.target_date ? ` · 📅 ${p.target_date}` : ''}</div>
        </div>
        <span className={`shrink-0 text-[9px] font-semibold px-1.5 py-0.5 rounded-full border ${prio.cls}`}>{prio.label}</span>
      </div>
      {p.deskripsi && <div className="text-[11px] text-text2 line-clamp-2">{p.deskripsi}</div>}

      <div>
        <div className="flex items-center justify-between text-[10px] text-text2 mb-1"><span>Progres</span><span className="font-semibold text-text">{p.progres}%</span></div>
        <div className="h-1.5 bg-surface2 rounded-full overflow-hidden"><div className="h-full bg-accent rounded-full" style={{ width: `${Math.min(100, Math.max(0, p.progres))}%` }} /></div>
      </div>

      <div className="flex items-center justify-between text-[10px] text-text2 gap-2">
        <span className="truncate">💰 {rp(p.estimasi_biaya)}{p.realisasi_biaya != null ? ` · real ${rp(p.realisasi_biaya)}` : ''}</span>
        {p.pic_nama && <span className="truncate max-w-[110px] shrink-0" title={p.pic_nama}>👤 {p.pic_nama}</span>}
      </div>

      <div className="flex items-center gap-1.5 mt-1 pt-2 border-t border-border/50">
        <select value={p.status} onChange={(e) => onQuick(p, e.target.value)} title="Ubah status" className={`text-[10px] font-semibold border rounded px-1.5 py-1 ${st.cls}`}>
          {STATUS.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
        </select>
        <div className="ml-auto flex gap-1.5">
          <button onClick={onEdit} className="border border-border text-text2 rounded px-2 py-1 text-[11px] hover:text-text">✏️ Edit</button>
          <button onClick={onDelete} className="border border-danger/40 text-danger rounded px-2 py-1 text-[11px]">🗑️</button>
        </div>
      </div>
    </div>
  );
}

interface Form {
  tahun: number; kuartal: number; kategori: string; judul: string; deskripsi: string;
  prioritas: string; status: string; progres: number; estimasi_biaya: number;
  realisasi_biaya: number | ''; target_date: string; pic_nama: string; catatan: string;
}

function PlanModal({ plan, tahun, seed, onClose, onSaved }: { plan: UnitPlan | null; tahun: number; seed?: Partial<Form>; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState<Form>({
    tahun: plan?.tahun ?? tahun,
    kuartal: plan?.kuartal ?? 0,
    kategori: plan?.kategori ?? seed?.kategori ?? 'pemeliharaan',
    judul: plan?.judul ?? seed?.judul ?? '',
    deskripsi: plan?.deskripsi ?? seed?.deskripsi ?? '',
    prioritas: plan?.prioritas ?? 'sedang',
    status: plan?.status ?? 'rencana',
    progres: plan?.progres ?? 0,
    estimasi_biaya: plan?.estimasi_biaya ?? 0,
    realisasi_biaya: plan?.realisasi_biaya ?? '',
    target_date: plan?.target_date ?? '',
    pic_nama: plan?.pic_nama ?? '',
    catatan: plan?.catatan ?? '',
  });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setF((p) => ({ ...p, [k]: v }));

  async function save() {
    if (!f.judul.trim()) return setErr('Judul rencana wajib diisi.');
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

        <div className="grid grid-cols-2 gap-3 mb-3">
          <div><label className={lbl}>Prioritas</label>
            <select className={inp} value={f.prioritas} onChange={(e) => set('prioritas', e.target.value)}><option value="tinggi">Tinggi</option><option value="sedang">Sedang</option><option value="rendah">Rendah</option></select></div>
          <div><label className={lbl}>Status</label>
            <select className={inp} value={f.status} onChange={(e) => set('status', e.target.value)}>{STATUS.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}</select></div>
        </div>

        <div className="grid grid-cols-2 gap-3 mb-3">
          <div><label className={lbl}>Target selesai</label>
            <input type="date" className={inp} value={f.target_date || ''} onChange={(e) => set('target_date', e.target.value)} /></div>
          <div><label className={lbl}>Progres (%)</label>
            <input type="number" min={0} max={100} className={inp} value={f.progres} onChange={(e) => set('progres', Math.min(100, Math.max(0, Number(e.target.value) || 0)))} /></div>
        </div>

        <div className="grid grid-cols-2 gap-3 mb-3">
          <div><label className={lbl}>Estimasi biaya (Rp)</label>
            <input type="number" min={0} className={inp} value={f.estimasi_biaya} onChange={(e) => set('estimasi_biaya', Math.max(0, Number(e.target.value) || 0))} /></div>
          <div><label className={lbl}>Realisasi biaya (Rp)</label>
            <input type="number" min={0} className={inp} value={f.realisasi_biaya} onChange={(e) => set('realisasi_biaya', e.target.value === '' ? '' : Math.max(0, Number(e.target.value) || 0))} placeholder="kosong = belum" /></div>
        </div>

        <label className={lbl}>PIC / Penanggung jawab</label>
        <input className={`${inp} mb-3`} value={f.pic_nama} onChange={(e) => set('pic_nama', e.target.value)} placeholder="Nama penanggung jawab" />

        <label className={lbl}>Deskripsi / sasaran</label>
        <textarea className={`${inp} min-h-[60px] mb-3`} value={f.deskripsi} onChange={(e) => set('deskripsi', e.target.value)} placeholder="Rincian rencana, sasaran, keterangan…" />

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
