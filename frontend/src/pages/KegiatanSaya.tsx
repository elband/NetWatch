import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api/client';
import { useAuth } from '../context/AuthContext';
import ActivityModal, { activityStateBadge, needsDoc } from '../components/ActivityModal';
import ActivityDocModal from '../components/ActivityDocModal';
import { openImage } from '../components/ImageLightbox';
import { stepLabel, maxStep } from '../utils/steps';
import type { Activity, Incident, IncidentQueue, KegiatanNr } from '../types';

// Halaman "Kegiatan Saya": rekap SEMUA kegiatan yang dilakukan teknisi dalam satu
// linimasa — insiden yang ditangani, pengajuan kegiatan lain (rapat/lembur/izin/
// dinas-luar), dan laporan kegiatan non-rutin. Dibuka dari panah "Lihat Semua"
// pada card TUGAS SAYA di Dashboard Saya.

type Kind = 'insiden' | 'kegiatan' | 'non-rutin';
interface Item {
  key: string;
  kind: Kind;
  date: string;          // YYYY-MM-DD (untuk urut & filter bulan)
  time: string;          // jam tampil (opsional)
  title: string;
  sub: string;
  badge: { t: string; c: string; bg: string };
  done: boolean;
  needAction: boolean;
  link?: string;
  activity?: Activity;   // untuk tombol dokumentasi
  docs?: string[];
  bukti?: string | null;
}

const KIND_META: Record<Kind, { icon: string; label: string }> = {
  insiden: { icon: '🚨', label: 'Insiden' },
  kegiatan: { icon: '📋', label: 'Kegiatan Lain' },
  'non-rutin': { icon: '📝', label: 'Non-Rutin' },
};
const TYPE_LABEL: Record<string, string> = { rapat: 'Rapat', lembur: 'Lembur', izin: 'Izin', 'dinas-luar': 'Dinas Luar', lainnya: 'Kegiatan Lain' };
const KNR_BADGE: Record<string, { t: string; c: string; bg: string }> = {
  draft: { t: 'Draft', c: 'text-text2', bg: 'bg-surface2' },
  diajukan: { t: '⏳ Diajukan', c: 'text-warn', bg: 'bg-warn/15' },
  diverifikasi: { t: '👁 Diverifikasi', c: 'text-accent2', bg: 'bg-accent2/15' },
  disetujui: { t: '✓ Disetujui', c: 'text-success', bg: 'bg-success/15' },
  ditolak: { t: '✕ Ditolak', c: 'text-danger', bg: 'bg-danger/15' },
  selesai: { t: '✅ Selesai', c: 'text-success', bg: 'bg-success/15' },
};

const monthKey = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
const months = Array.from({ length: 12 }, (_, i) => {
  const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() - i);
  return { value: monthKey(d), label: d.toLocaleDateString('id-ID', { month: 'long', year: 'numeric' }) };
});
const fmtDate = (iso: string) => {
  const d = new Date(`${iso}T00:00:00`);
  return isNaN(d.getTime()) ? iso : d.toLocaleDateString('id-ID', { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' });
};

export default function KegiatanSaya() {
  const { user } = useAuth();
  const [queue, setQueue] = useState<IncidentQueue | null>(null);
  const [activities, setActivities] = useState<Activity[]>([]);
  const [knr, setKnr] = useState<KegiatanNr[]>([]);
  const [month, setMonth] = useState(months[0].value);
  const [kinds, setKinds] = useState<Kind[]>([]);
  const [q, setQ] = useState('');
  const [onlyOpen, setOnlyOpen] = useState(false);
  const [showActivity, setShowActivity] = useState(false);
  const [docActivity, setDocActivity] = useState<Activity | null>(null);

  function load() {
    api.get('/incidents/queue').then((r) => setQueue(r.data)).catch(() => {});
    api.get('/activities/mine').then((r) => setActivities(r.data.activities)).catch(() => {});
    const p = month === 'all' ? '' : `?month=${month}`;
    api.get(`/kegiatan-nr${p}`).then((r) => setKnr(r.data.kegiatan || [])).catch(() => setKnr([]));
  }
  useEffect(load, [month]);

  const items = useMemo<Item[]>(() => {
    const out: Item[] = [];

    for (const i of (queue?.mine || []) as Incident[]) {
      const done = i.status === 'selesai';
      out.push({
        key: `inc-${i.id}`, kind: 'insiden',
        date: String(i.created_at).slice(0, 10),
        time: String(i.created_at).slice(11, 16),
        title: `${i.device_name} — ${i.issue}`,
        sub: `${i.id} · prioritas ${i.priority} · langkah ${i.step}/${maxStep(i)} ${stepLabel(i, i.step)}`,
        badge: done
          ? { t: '✅ Selesai', c: 'text-success', bg: 'bg-success/15' }
          : { t: '🔧 Ditangani', c: 'text-warn', bg: 'bg-warn/15' },
        done, needAction: !done,
        link: `/my-incidents?focus=${i.id}`,
      });
    }

    for (const a of activities) {
      const b = activityStateBadge(a);
      out.push({
        key: `act-${a.id}`, kind: 'kegiatan',
        date: String(a.activity_date).slice(0, 10),
        time: a.start_time ? `${a.start_time}${a.end_time ? `–${a.end_time}` : ''}` : '',
        title: a.title,
        sub: `${TYPE_LABEL[a.type] || a.type}${a.detail ? ` · ${a.detail}` : ''}`,
        badge: b,
        done: a.status === 'disetujui' && (!needsDoc(a) || !!a.completed_at),
        needAction: needsDoc(a),
        activity: a, docs: a.doc_urls || [], bukti: a.bukti_url,
      });
    }

    for (const k of knr) {
      if (user && k.created_by && k.created_by !== user.id) continue; // hanya milik saya
      out.push({
        key: `knr-${k.id}`, kind: 'non-rutin',
        date: String(k.tanggal_kegiatan).slice(0, 10),
        time: '',
        title: k.judul,
        sub: `${k.kategori}${k.lokasi ? ` · ${k.lokasi}` : ''} · ${k.durasi_jam || 0} jam · ${k.poin || 0} poin`,
        badge: KNR_BADGE[k.status] || KNR_BADGE.draft,
        done: k.status === 'selesai' || k.status === 'disetujui',
        needAction: k.status === 'draft',
        link: `/kegiatan-nr?focus=${k.id}`,
      });
    }

    return out.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : (b.time || '').localeCompare(a.time || '')));
  }, [queue, activities, knr, user]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return items.filter((it) => {
      if (month !== 'all' && it.date.slice(0, 7) !== month) return false;
      if (kinds.length && !kinds.includes(it.kind)) return false;
      if (onlyOpen && !it.needAction) return false;
      if (needle && !(`${it.title} ${it.sub}`.toLowerCase().includes(needle))) return false;
      return true;
    });
  }, [items, month, kinds, onlyOpen, q]);

  const stat = useMemo(() => {
    const inPeriod = items.filter((it) => month === 'all' || it.date.slice(0, 7) === month);
    return {
      total: inPeriod.length,
      insiden: inPeriod.filter((i) => i.kind === 'insiden').length,
      kegiatan: inPeriod.filter((i) => i.kind !== 'insiden').length,
      selesai: inPeriod.filter((i) => i.done).length,
      perlu: inPeriod.filter((i) => i.needAction).length,
    };
  }, [items, month]);

  // Kelompokkan per tanggal → linimasa.
  const groups = useMemo(() => {
    const m = new Map<string, Item[]>();
    for (const it of filtered) { const arr = m.get(it.date); if (arr) arr.push(it); else m.set(it.date, [it]); }
    return [...m.entries()];
  }, [filtered]);

  function toggleKind(k: Kind) {
    setKinds((prev) => (prev.includes(k) ? prev.filter((x) => x !== k) : [...prev, k]));
  }

  const Stat = ({ l, v, c, ic }: { l: string; v: number; c: string; ic: string }) => (
    <div className="bg-surface border border-border rounded-xl p-3.5">
      <div className="flex items-center justify-between"><span className="text-[11px] text-text2">{l}</span><span>{ic}</span></div>
      <div className="text-[22px] font-extrabold mt-0.5" style={{ color: c }}>{v}</div>
    </div>
  );

  return (
    <div>
      <div className="flex items-center justify-between mb-4 gap-2 flex-wrap">
        <div>
          <div className="text-[17px] font-bold">🗂️ Kegiatan Saya</div>
          <div className="text-[11px] text-text2">Semua kegiatan yang Anda lakukan: insiden, pengajuan kegiatan, dan laporan non-rutin.</div>
        </div>
        <div className="flex items-center gap-2">
          <select value={month} onChange={(e) => setMonth(e.target.value)} className="bg-surface2 border border-border rounded-md px-3 py-2 text-xs">
            {months.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
            <option value="all">Semua periode</option>
          </select>
          <button onClick={() => setShowActivity(true)} className="bg-accent text-bg rounded-md px-3 py-1.5 text-xs font-semibold">+ Ajukan Kegiatan</button>
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 mb-4">
        <Stat l="Total Kegiatan" v={stat.total} c="#60a5fa" ic="🗂️" />
        <Stat l="Insiden Ditangani" v={stat.insiden} c="#f97316" ic="🚨" />
        <Stat l="Kegiatan Lain" v={stat.kegiatan} c="#a78bfa" ic="📋" />
        <Stat l="Selesai" v={stat.selesai} c="#22c55e" ic="✅" />
        <Stat l="Perlu Tindakan" v={stat.perlu} c="#eab308" ic="⏳" />
      </div>

      <div className="bg-surface border border-border rounded-xl p-3 mb-4 flex flex-wrap items-center gap-2">
        {(Object.keys(KIND_META) as Kind[]).map((k) => (
          <button key={k} onClick={() => toggleKind(k)}
            className={`px-2.5 py-1 rounded-md text-[11px] border ${kinds.includes(k) ? 'border-accent bg-accent/15 text-accent font-semibold' : 'border-border text-text2'}`}>
            {KIND_META[k].icon} {KIND_META[k].label}
          </button>
        ))}
        <label className="flex items-center gap-1.5 text-[11px] text-text2 ml-1">
          <input type="checkbox" checked={onlyOpen} onChange={(e) => setOnlyOpen(e.target.checked)} /> Hanya yang perlu tindakan
        </label>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Cari kegiatan…"
          className="ml-auto bg-surface2 border border-border rounded-md px-3 py-1.5 text-xs w-full sm:w-56" />
      </div>

      {groups.length === 0 ? (
        <div className="bg-surface border border-border rounded-xl p-8 text-center text-[12px] text-text2">
          Belum ada kegiatan pada periode ini.
        </div>
      ) : (
        <div className="space-y-4">
          {groups.map(([date, list]) => (
            <div key={date} className="bg-surface border border-border rounded-xl p-4">
              <div className="flex items-center justify-between mb-2">
                <span className="font-head text-[12px] font-bold tracking-wide">{fmtDate(date)}</span>
                <span className="text-[10px] text-text2">{list.length} kegiatan</span>
              </div>
              {list.map((it) => (
                <div key={it.key} className="py-2 border-b border-border/40 last:border-0">
                  <div className="flex items-start gap-2">
                    <span className="text-[13px] leading-5">{KIND_META[it.kind].icon}</span>
                    <div className="flex-1 min-w-0">
                      <div className="text-[12px] font-semibold truncate">
                        {it.link ? <Link to={it.link} className="hover:text-accent hover:underline">{it.title}</Link> : it.title}
                        {it.bukti && (it.bukti.toLowerCase().endsWith('.pdf')
                          ? <a href={it.bukti} target="_blank" rel="noreferrer" title="Bukti dukung (PDF)" className="ml-1 text-accent2">📎</a>
                          : <button type="button" onClick={() => openImage(it.bukti!)} title="Lihat bukti dukung" className="ml-1 text-accent2">📎</button>)}
                      </div>
                      <div className="text-[10px] text-text2 truncate">{it.time ? `${it.time} · ` : ''}{it.sub}</div>
                      {!!it.docs?.length && (
                        <div className="mt-1 flex flex-wrap gap-x-2 gap-y-0.5">
                          {it.docs.map((u, i) => (u.toLowerCase().endsWith('.pdf')
                            ? <a key={i} href={u} target="_blank" rel="noreferrer" className="text-[9px] text-accent2 hover:underline">📄 Dok {i + 1}</a>
                            : <button key={i} type="button" onClick={() => openImage(u)} className="text-[9px] text-accent2 hover:underline">📷 Dok {i + 1}</button>))}
                        </div>
                      )}
                      {it.activity && needsDoc(it.activity) && (
                        <button onClick={() => setDocActivity(it.activity!)} className="mt-1 text-[10px] border border-accent2/50 text-accent2 rounded px-2 py-0.5 hover:bg-accent2/10">📸 Selesaikan · Upload Dokumentasi</button>
                      )}
                    </div>
                    <span className={`text-[9px] px-1.5 py-0.5 rounded font-semibold whitespace-nowrap ${it.badge.bg} ${it.badge.c}`}>{it.badge.t}</span>
                  </div>
                </div>
              ))}
            </div>
          ))}
        </div>
      )}

      {showActivity && <ActivityModal onClose={() => setShowActivity(false)} onDone={load} />}
      {docActivity && <ActivityDocModal activity={docActivity} onClose={() => setDocActivity(null)} onDone={load} />}
    </div>
  );
}
