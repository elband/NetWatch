import { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { unlockAudio, playAlarm, playTestBeep, audioReady } from '../utils/alarmSound';

// ===== COMMAND CENTER — Wallboard Publik NOC (tanpa login, token ?key=, per-unit ?unit=).
// Tata letak: Header · Sidebar kiri (Layer/Top Lokasi/Statistik) · Tengah (KPI/Peta/Telemetri)
// · Sidebar kanan (Gangguan aktif/Teknisi/Layanan) · Footer · Toast + pop-up gangguan 30 dtk.
// Real-time via polling 5 dtk. Dirancang untuk layar TV 16:9. =====

interface NDevice { id: number; name: string; ip: string; type: string | null; category: string | null; icon: string | null; loc: string | null; location_id: number | null; status: 'online' | 'warning' | 'offline'; cpu: number; mem: number; ping_ms: number; lat: number | null; lng: number | null; last_checked_at: string | null; offline_since: string | null }
interface NLoc { id: number; name: string; icon: string; lat: number | null; lng: number | null; sort_order: number }
interface NInc { id: string; device_id: number | null; device_name: string; ip: string | null; issue: string; priority: string; status: 'aktif' | 'proses' | 'selesai'; created_at: string; resolved_at: string | null; location_id: number | null; tech_name?: string | null; public_report_id?: string | null }
interface NInsp { id: number; status: 'baik' | 'perhatian' | 'rusak'; slot: string; note: string | null; inspector_name: string | null; verified: number; created_at: string; device_name: string; device_icon: string | null }
interface NTech { id: number; name: string; emoji: string | null; shift_type: string | null; handling: number }
interface NStat { kategori: string; total: number; online: number; warning: number; offline: number }
interface NTopLoc { id: number; name: string; icon: string; total: number; offline: number }
interface NService { id: number; name: string; icon: string; status: string; is_ok: number; detail: string | null }
interface NTrend { date: string; count: number }
interface NKpi { total: number; online: number; warning: number; offline: number; activeInc: number; teknisiOn: number; availability: number }
interface NUplink { id: number; name: string; ip: string; type: string | null; status: 'online' | 'warning' | 'offline'; ping_ms: number }
interface NInternet { ok: boolean | null; ping: number | null; rxBps?: number | null; txBps?: number | null }
interface NData { unit: { id: number; code: string; name: string; icon: string }; devices: NDevice[]; locations: NLoc[]; today: NInc[]; activeIncidents: NInc[]; technicians: NTech[]; deviceStats: NStat[]; topLocations: NTopLoc[]; services: NService[]; trend: NTrend[]; kpi: NKpi; uplink: NUplink[]; internet: NInternet; inspections: NInsp[]; ts: number }
interface Metric { status: string; ping_ms: number; cpu: number | null; mem: number | null; recorded_at: string }

const C = { online: '#22c55e', warning: '#f59e0b', offline: '#ef4444', dim: '#64748b', bg: '#070b10', panel: '#0f1620', panel2: '#0b1017', border: '#1e293b', accent: '#38bdf8', text: '#e2e8f0' };
const POLL_MS = 5000, ALERT_MS = 30000;
const CENTER: [number, number] = [-0.371, 117.257];
const worst = (ds: NDevice[]) => (ds.some((d) => d.status === 'offline') ? 'offline' : ds.some((d) => d.status === 'warning') ? 'warning' : ds.length ? 'online' : 'none');
const stColor = (s: string) => (s === 'offline' ? C.offline : s === 'warning' ? C.warning : s === 'online' ? C.online : C.dim);
const incColor = (s: string) => (s === 'aktif' ? C.offline : s === 'proses' ? C.warning : C.online);
const prioColor = (p: string) => (p === 'kritis' ? C.offline : p === 'tinggi' ? C.warning : C.dim);
// Kode shift bandara: P=Pagi, S=Siang, N=Malam(Dinas Kantor), L=Libur, DL=Dinas Luar, C=Cuti.
const shiftInfo = (s: string | null): { label: string; c: string; on: boolean } => {
  if (s === 'pagi') return { label: 'P', c: C.online, on: true };
  if (s === 'siang') return { label: 'S', c: C.online, on: true };
  if (s === 'malam') return { label: 'N', c: C.online, on: true };
  if (s === 'dinas_luar') return { label: 'DL', c: C.accent, on: false };
  if (s === 'cuti') return { label: 'C', c: C.dim, on: false };
  return { label: 'L', c: C.dim, on: false };
};
const fmtTime = (s: string | null) => (s ? new Date(s).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' }) : '—');
const fmtMbps = (bps: number) => { const m = bps / 1e6; return m >= 100 ? String(Math.round(m)) : m >= 10 ? m.toFixed(1) : m.toFixed(2); };
const ago = (s: string | null) => {
  if (!s) return '—';
  const m = Math.max(0, Math.round((Date.now() - new Date(s).getTime()) / 60000));
  return m < 60 ? `${m} mnt lalu` : `${Math.floor(m / 60)} jam lalu`;
};

// Sparkline SVG mungil.
function Spark({ vals, color, w = 150, h = 34, max }: { vals: number[]; color: string; w?: number; h?: number; max?: number }) {
  if (!vals.length) return <div style={{ fontSize: 10, color: C.dim }}>—</div>;
  const mx = max ?? Math.max(1, ...vals);
  const pts = vals.map((v, i) => `${(i / Math.max(1, vals.length - 1)) * w},${h - (Math.min(v, mx) / mx) * (h - 4) - 2}`).join(' ');
  return <svg width={w} height={h} style={{ display: 'block' }}><polyline points={pts} fill="none" stroke={color} strokeWidth={2} /></svg>;
}

// Auto-scroll loop untuk daftar panjang (Gangguan Aktif, Inspeksi) — jeda saat kursor di atasnya.
function useAutoScroll(dep: number) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let paused = false, raf = 0, last = 0, pos = el.scrollTop;
    const enter = () => { paused = true; }, leave = () => { paused = false; };
    el.addEventListener('mouseenter', enter); el.addEventListener('mouseleave', leave);
    const SPEED = 16; // px/detik — halus & berbasis waktu (bukan per-tick)
    const step = (t: number) => {
      raf = requestAnimationFrame(step);
      const dt = last ? Math.min((t - last) / 1000, 0.1) : 0; last = t;
      if (paused) return;
      const overflow = el.scrollHeight - el.clientHeight;
      if (overflow <= 4) { pos = 0; return; }
      pos += SPEED * dt;
      if (pos >= overflow + 18) pos = 0; // jeda kecil di bawah sebelum balik ke atas
      el.scrollTop = Math.min(pos, overflow);
    };
    raf = requestAnimationFrame(step);
    return () => { cancelAnimationFrame(raf); el.removeEventListener('mouseenter', enter); el.removeEventListener('mouseleave', leave); };
  }, [dep]);
  return ref;
}

export default function Noc() {
  const [sp] = useSearchParams();
  const unit = sp.get('unit') || '';
  const key = sp.get('key') || '';
  const [data, setData] = useState<NData | null>(null);
  const [err, setErr] = useState('');
  const [now, setNow] = useState(() => new Date());
  const [latency, setLatency] = useState(0);
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [sel, setSel] = useState<NDevice | null>(null);
  const [metrics, setMetrics] = useState<Metric[]>([]);
  const [alert, setAlert] = useState<NDevice | null>(null);
  const [toast, setToast] = useState<NDevice | null>(null);
  const [focusIdx, setFocusIdx] = useState(0);
  const [hoverMap, setHoverMap] = useState(false);
  // Alarm suara: aktif/mati (disimpan per-browser) + status audio sudah ter-unlock browser.
  const [soundOn, setSoundOn] = useState<boolean>(() => { try { return localStorage.getItem('noc_alarm_sound') !== '0'; } catch { return true; } });
  const [audioOk, setAudioOk] = useState(false);
  const soundOnRef = useRef(soundOn); soundOnRef.current = soundOn;

  // Kebijakan autoplay: unlock audio pada interaksi user pertama (sekali) agar alarm bisa berbunyi.
  useEffect(() => {
    const unlock = () => { unlockAudio(); window.setTimeout(() => setAudioOk(audioReady()), 60); };
    window.addEventListener('pointerdown', unlock, { once: true });
    window.addEventListener('keydown', unlock, { once: true });
    return () => { window.removeEventListener('pointerdown', unlock); window.removeEventListener('keydown', unlock); };
  }, []);

  // Toggle alarm suara (juga meng-unlock audio + beep konfirmasi saat dinyalakan).
  // Efek samping di luar updater agar tetap murni (StrictMode aman, tak dobel-beep).
  const toggleSound = () => {
    unlockAudio();
    const nv = !soundOnRef.current;
    soundOnRef.current = nv;
    setSoundOn(nv);
    try { localStorage.setItem('noc_alarm_sound', nv ? '1' : '0'); } catch { /* */ }
    if (nv) window.setTimeout(() => { setAudioOk(audioReady()); playTestBeep(); }, 80);
  };

  const q = `unit=${encodeURIComponent(unit)}&key=${encodeURIComponent(key)}`;

  // Polling data.
  useEffect(() => {
    let alive = true;
    const load = async () => {
      const t0 = performance.now();
      try {
        const r = await fetch(`/api/noc/public?${q}`);
        setLatency(Math.round(performance.now() - t0));
        if (!r.ok) { const j = await r.json().catch(() => ({})); if (alive) setErr(j.error || `Gagal memuat (${r.status})`); return; }
        const j = await r.json();
        if (alive) { setData(j); setErr(''); }
      } catch { if (alive) setErr('Tidak bisa terhubung ke server.'); }
    };
    load();
    const t = setInterval(load, POLL_MS);
    return () => { alive = false; clearInterval(t); };
  }, [q]);
  useEffect(() => { const t = setInterval(() => setNow(new Date()), 1000); return () => clearInterval(t); }, []);

  const devices = useMemo(() => data?.devices || [], [data]);
  const locations = useMemo(() => data?.locations || [], [data]);
  const kpi = data?.kpi || { total: 0, online: 0, warning: 0, offline: 0, activeInc: 0, teknisiOn: 0, availability: 100 };
  const internet: NInternet = data?.internet || { ok: null, ping: null };
  const cats = useMemo(() => Array.from(new Set(devices.map((d) => d.category || d.type || 'Lainnya'))).sort(), [devices]);
  const visible = useMemo(() => devices.filter((d) => !hidden.has(d.category || d.type || 'Lainnya')), [devices, hidden]);
  const byLoc = useMemo(() => { const m = new Map<number, NDevice[]>(); for (const d of visible) { const k = d.location_id ?? -1; if (!m.has(k)) m.set(k, []); m.get(k)!.push(d); } return m; }, [visible]);
  const locWithCoord = useMemo(() => locations.filter((l) => l.lat != null && l.lng != null), [locations]);
  const locWithDevices = useMemo(() => locWithCoord.filter((l) => (byLoc.get(l.id) || []).length > 0), [locWithCoord, byLoc]);
  const focusLoc = locWithDevices.length ? locWithDevices[focusIdx % locWithDevices.length] : null;
  // Tanda-tangan marker (nilai biasa, bukan hook): hanya berubah saat isi peta benar-benar
  // berubah (jumlah/status/fokus), bukan tiap polling — marker tak digambar ulang & berkedip.
  const markerSig = locWithCoord.map((l) => {
    const ds = byLoc.get(l.id) || [];
    return `${l.id}.${ds.length}.${worst(ds)}.${ds.filter((d) => d.status === 'offline').length}`;
  }).join('|') + '#' + (focusLoc?.id ?? '');

  // Deteksi gangguan baru → toast + popup 30 dtk.
  const prev = useRef<Record<number, string>>({});
  const alertTimer = useRef<number | undefined>(undefined);
  useEffect(() => {
    if (!data) return;
    const p = prev.current; const first = Object.keys(p).length === 0;
    const down = devices.find((d) => d.status === 'offline' && p[d.id] && p[d.id] !== 'offline');
    const snap: Record<number, string> = {}; for (const d of devices) snap[d.id] = d.status; prev.current = snap;
    if (!first && down) {
      setAlert(down); setToast(down);
      if (soundOnRef.current) playAlarm('critical'); // bunyikan alarm sesuai nada gangguan
      window.clearTimeout(alertTimer.current);
      alertTimer.current = window.setTimeout(() => { setAlert(null); setToast(null); }, ALERT_MS);
    }
  }, [data]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => window.clearTimeout(alertTimer.current), []);

  // Telemetri perangkat terpilih.
  useEffect(() => {
    if (!sel) { setMetrics([]); return; }
    let alive = true;
    const load = () => fetch(`/api/noc/public/device-metrics?${q}&id=${sel.id}`).then((r) => r.json()).then((j) => { if (alive) setMetrics(j.metrics || []); }).catch(() => {});
    load(); const t = setInterval(load, POLL_MS);
    return () => { alive = false; clearInterval(t); };
  }, [sel?.id, q]); // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-scroll daftar Gangguan Aktif & Inspeksi (loop pelan; jeda saat kursor di atasnya).
  const incScrollRef = useAutoScroll(data?.activeIncidents.length ?? 0);
  const inspScrollRef = useAutoScroll(data?.inspections?.length ?? 0);

  // ===== Peta Leaflet =====
  const elRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const layerRef = useRef<L.LayerGroup | null>(null);
  const fitted = useRef(false);
  const selectRef = useRef<(id: number) => void>(() => {});
  selectRef.current = (locId: number) => {
    const idx = locWithDevices.findIndex((x) => x.id === locId);
    if (idx >= 0) setFocusIdx(idx);
    const ds = byLoc.get(locId) || [];
    if (ds.length) setSel(ds[0]);
  };
  useEffect(() => {
    if (!elRef.current || mapRef.current) return;
    const map = L.map(elRef.current, { center: CENTER, zoom: 15, zoomControl: false, attributionControl: false });
    L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', { maxZoom: 19 }).addTo(map);
    L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}', { maxZoom: 19, opacity: 0.85 }).addTo(map);
    layerRef.current = L.layerGroup().addTo(map);
    mapRef.current = map;
    const ro = new ResizeObserver(() => map.invalidateSize()); ro.observe(elRef.current);
    setTimeout(() => map.invalidateSize(), 0);
    return () => { ro.disconnect(); map.remove(); mapRef.current = null; };
  }, []);
  useEffect(() => {
    const map = mapRef.current, layer = layerRef.current;
    if (!map || !layer) return;
    layer.clearLayers();
    const pts: [number, number][] = [];
    for (const l of locWithCoord) {
      const ds = byLoc.get(l.id) || [];
      if (!ds.length) continue;
      const col = stColor(worst(ds));
      const down = ds.filter((d) => d.status === 'offline').length;
      const lat = Number(l.lat), lng = Number(l.lng); pts.push([lat, lng]);
      const focus = focusLoc?.id === l.id;
      const html = `<div class="noc-pin${focus ? ' noc-focus' : ''}"><div class="noc-dot" style="background:${col}">${down > 0 ? '<span class="noc-ping"></span>' : ''}<span style="position:relative">${down > 0 ? down : ds.length}</span></div><span class="noc-label">${l.name.replace(/</g, '&lt;')}</span></div>`;
      const mk = L.marker([lat, lng], { icon: L.divIcon({ className: '', html, iconSize: [0, 0], iconAnchor: [0, 0] }), zIndexOffset: focus ? 1000 : 0 });
      mk.on('click', () => selectRef.current(l.id));
      mk.addTo(layer);
    }
    if (!fitted.current && pts.length) { if (pts.length === 1) map.setView(pts[0], 16); else map.fitBounds(L.latLngBounds(pts).pad(0.3)); fitted.current = true; }
  }, [markerSig]); // eslint-disable-line react-hooks/exhaustive-deps

  // Rotasi otomatis fokus lokasi (bergiliran) — jeda saat pilih perangkat / hover peta / popup gangguan.
  useEffect(() => {
    if (sel || hoverMap || alert || locWithDevices.length <= 1) return;
    const t = setInterval(() => setFocusIdx((i) => (i + 1) % locWithDevices.length), 9000);
    return () => clearInterval(t);
  }, [sel, hoverMap, alert, locWithDevices.length]);
  // Terbangkan peta ke lokasi fokus saat id-nya berganti.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !focusLoc || focusLoc.lat == null) return;
    map.flyTo([Number(focusLoc.lat), Number(focusLoc.lng)], 17, { duration: 1.3 });
  }, [focusLoc?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (err && !data) {
    return (
      <div style={{ minHeight: '100vh', background: C.bg, color: C.text, display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'Inter, system-ui, "Noto Color Emoji", "Segoe UI Emoji", "Apple Color Emoji", sans-serif', textAlign: 'center', padding: 24 }}>
        <div><div style={{ fontSize: 48 }}>🔒</div><div style={{ fontSize: 22, fontWeight: 800, marginTop: 8 }}>{err}</div><div style={{ fontSize: 13, color: C.dim, marginTop: 8 }}>Tautan harus lengkap: <code>/noc?unit=KODE&amp;key=…</code></div></div>
      </div>
    );
  }

  const sys = kpi.offline > 0 ? { t: `${kpi.offline} PERANGKAT GANGGUAN`, c: C.offline } : kpi.warning > 0 ? { t: `${kpi.warning} WARNING`, c: C.warning } : { t: 'ALL SYSTEMS OPERATIONAL', c: C.online };
  const onDuty = (data?.technicians || []).filter((t) => ['pagi', 'siang', 'malam'].includes(t.shift_type || ''));
  const trendMax = Math.max(1, ...(data?.trend || []).map((t) => t.count));
  const card: React.CSSProperties = { background: C.panel, border: `1px solid ${C.border}`, borderRadius: 10 };
  const cardTitle: React.CSSProperties = { fontSize: 10.5, fontWeight: 800, letterSpacing: 0.5, color: '#94a3b8', padding: '5px 10px', borderBottom: `1px solid ${C.border}` };

  return (
    <div style={{ height: '100vh', display: 'flex', flexDirection: 'column', background: C.bg, color: C.text, fontFamily: 'Inter, system-ui, "Noto Color Emoji", "Segoe UI Emoji", "Apple Color Emoji", sans-serif', overflow: 'hidden' }}>
      <style>{`
        .noc-pin{position:relative;transform:translate(-50%,-50%);cursor:pointer}
        .noc-dot{position:relative;width:30px;height:30px;border-radius:9999px;border:2px solid #fff;display:flex;align-items:center;justify-content:center;font:800 12px/1 'Roboto Mono',monospace;color:#fff;box-shadow:0 1px 5px rgba(0,0,0,.6)}
        .noc-ping{position:absolute;inset:-3px;border-radius:9999px;background:${C.offline};opacity:.55;animation:nocping 1.4s cubic-bezier(0,0,.2,1) infinite}
        .noc-focus .noc-dot{transform:scale(1.25);outline:3px solid ${C.accent};outline-offset:3px;transition:transform .3s}
        .noc-focus .noc-label{background:${C.accent};color:#00131f;font-weight:800}
        .noc-label{position:absolute;top:32px;left:50%;transform:translateX(-50%);padding:1px 6px;border-radius:4px;font:700 10px/1.4 'Inter',system-ui;background:rgba(0,0,0,.7);color:#fff;white-space:nowrap}
        @keyframes nocping{75%,100%{transform:scale(2.2);opacity:0}}
        @keyframes nocpop{from{transform:scale(.9);opacity:0}to{transform:scale(1);opacity:1}}
        @keyframes nocblink{50%{opacity:.35}}
        @keyframes nocslide{from{transform:translateX(30px);opacity:0}to{transform:translateX(0);opacity:1}}
        .noc-scroll::-webkit-scrollbar{width:6px}.noc-scroll::-webkit-scrollbar-thumb{background:#22303f;border-radius:3px}
        .mono{font-family:'Roboto Mono','JetBrains Mono',monospace}
      `}</style>

      {/* 1. HEADER */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, padding: '8px 16px', background: C.panel2, borderBottom: `1px solid ${C.border}` }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 24 }}>📡</span>
          <div>
            <div style={{ fontSize: 16, fontWeight: 900, letterSpacing: 0.5 }}>COMMAND CENTER <span style={{ color: C.accent }}>· {data?.unit.name || unit}</span></div>
            <div style={{ fontSize: 10, color: C.dim }}>Unit Elektronika Bandara · {data?.unit.code || unit}</div>
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 18 }}>
          <div style={{ textAlign: 'center' }}>
            <div className="mono" style={{ fontSize: 24, fontWeight: 800, lineHeight: 1 }}>{now.toLocaleTimeString('id-ID')}</div>
            <div style={{ fontSize: 10, color: '#94a3b8' }}>{now.toLocaleDateString('id-ID', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}</div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 7, background: `${sys.c}18`, border: `1px solid ${sys.c}55`, color: sys.c, borderRadius: 8, padding: '6px 12px', fontSize: 12, fontWeight: 800 }}>
            <span style={{ width: 9, height: 9, borderRadius: 999, background: sys.c, boxShadow: `0 0 8px ${sys.c}` }} />{sys.t}
          </div>
          <div style={{ fontSize: 11, color: '#94a3b8', textAlign: 'right' }}>Shift aktif<br /><b style={{ color: C.text }}>{onDuty.length ? onDuty.map((t) => t.name.split(' ')[0]).join(', ') : '—'}</b></div>
          <button
            onClick={toggleSound}
            title={!soundOn ? 'Alarm suara MATI — klik untuk hidupkan' : audioOk ? 'Alarm suara AKTIF — klik untuk matikan' : 'Alarm aktif — klik sekali untuk mengizinkan suara di browser'}
            style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'transparent', border: `1px solid ${soundOn ? C.online + '66' : C.border}`, color: soundOn ? C.online : C.dim, borderRadius: 8, padding: '5px 10px', cursor: 'pointer', lineHeight: 1, animation: soundOn && !audioOk ? 'nocblink 1.2s infinite' : 'none' }}
          >
            <span style={{ fontSize: 16 }}>{soundOn ? '🔊' : '🔇'}</span>
            <span style={{ fontSize: 10, fontWeight: 800, letterSpacing: 0.3 }}>ALARM</span>
          </button>
          <div style={{ position: 'relative' }}>
            <span style={{ fontSize: 20 }}>🔔</span>
            {kpi.activeInc > 0 && <span style={{ position: 'absolute', top: -4, right: -6, background: C.offline, color: '#fff', fontSize: 10, fontWeight: 800, borderRadius: 999, padding: '0 5px' }}>{kpi.activeInc}</span>}
          </div>
          <div title="Status insiden kritis" style={{ display: 'flex', alignItems: 'center', gap: 6, background: kpi.offline > 0 ? C.offline : '#1e293b', color: '#fff', borderRadius: 8, padding: '6px 12px', fontSize: 12, fontWeight: 800, animation: kpi.offline > 0 ? 'nocblink 1s infinite' : 'none' }}>🚨 {kpi.offline > 0 ? 'GANGGUAN' : 'AMAN'}</div>
        </div>
      </div>

      {/* BODY */}
      <div style={{ flex: 1, display: 'grid', gridTemplateColumns: '260px 1fr 320px', gap: 10, padding: 10, minHeight: 0 }}>

        {/* SIDEBAR KIRI */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, minHeight: 0, overflow: 'hidden' }}>
          <div style={card}>
            <div style={cardTitle}>🧩 LAYER PERANGKAT</div>
            <div style={{ padding: '6px 10px', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '3px 12px' }}>
              {cats.length === 0 ? <span style={{ fontSize: 11, color: C.dim }}>—</span> : cats.map((c) => {
                const on = !hidden.has(c);
                return (
                  <label key={c} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, cursor: 'pointer', opacity: on ? 1 : 0.45, minWidth: 0 }}>
                    <input type="checkbox" checked={on} style={{ width: 12, height: 12 }} onChange={() => setHidden((h) => { const n = new Set(h); if (n.has(c)) n.delete(c); else n.add(c); return n; })} />
                    <span style={{ textTransform: 'capitalize', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{c}</span>
                    <span className="mono" style={{ marginLeft: 'auto', color: C.dim }}>{devices.filter((d) => (d.category || d.type || 'Lainnya') === c).length}</span>
                  </label>
                );
              })}
            </div>
          </div>
          <div style={card}>
            <div style={cardTitle}>📍 TOP LOKASI GANGGUAN</div>
            <div style={{ padding: '6px 10px', display: 'flex', flexDirection: 'column', gap: 5 }}>
              {(data?.topLocations || []).length === 0 ? <span style={{ fontSize: 11, color: C.dim }}>Tidak ada gangguan per lokasi.</span> : data!.topLocations.slice(0, 5).map((l) => (
                <div key={l.id}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10.5, marginBottom: 2 }}><span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{l.icon} {l.name}</span><b className="mono" style={{ color: C.offline, marginLeft: 6 }}>{l.offline}</b></div>
                  <div style={{ height: 4, background: '#0b1220', borderRadius: 999, overflow: 'hidden' }}><div style={{ height: '100%', width: `${(l.offline / Math.max(...data!.topLocations.map((x) => x.offline))) * 100}%`, background: C.offline, borderRadius: 999 }} /></div>
                </div>
              ))}
            </div>
          </div>
          <div style={{ ...card, display: 'flex', flexDirection: 'column' }}>
            <div style={cardTitle}>📊 STATISTIK PERANGKAT</div>
            <div className="noc-scroll" style={{ padding: '2px 8px 5px', overflow: 'auto', maxHeight: 146 }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 10.5 }}>
                <thead><tr style={{ color: C.dim }}><th style={{ textAlign: 'left', padding: '2px 4px' }}>Jenis</th><th style={{ padding: '2px 4px' }}>Σ</th><th style={{ color: C.online, padding: '2px 4px' }}>●</th><th style={{ color: C.offline, padding: '2px 4px' }}>●</th></tr></thead>
                <tbody>
                  {(data?.deviceStats || []).map((s) => (
                    <tr key={s.kategori} style={{ borderTop: `1px solid ${C.border}` }}>
                      <td style={{ padding: '2px 4px', textTransform: 'capitalize', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 110 }}>{s.kategori}</td>
                      <td className="mono" style={{ textAlign: 'center', padding: '2px 4px' }}>{s.total}</td>
                      <td className="mono" style={{ textAlign: 'center', padding: '2px 4px', color: C.online }}>{s.online}</td>
                      <td className="mono" style={{ textAlign: 'center', padding: '2px 4px', color: s.offline ? C.offline : C.dim }}>{s.offline}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          <div style={card}>
            <div style={cardTitle}>🌐 INTERNET / UPLINK (MIKROTIK)</div>
            <div style={{ padding: 10 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: (data?.uplink?.length || 0) ? 8 : 0 }}>
                <span style={{ fontSize: 17, fontWeight: 900, color: internet.ok == null ? C.dim : internet.ok ? C.online : C.offline }}>{internet.ok == null ? '— N/A' : internet.ok ? '● INTERNET UP' : '○ INTERNET DOWN'}</span>
                {internet.rxBps != null
                  ? <span className="mono" style={{ fontSize: 11, color: C.online, whiteSpace: 'nowrap', textAlign: 'right' }}>↓ {fmtMbps(internet.rxBps)} · ↑ {fmtMbps(internet.txBps || 0)}<br /><span style={{ color: C.dim, fontSize: 9 }}>Mbps{internet.ping != null ? ` · ${internet.ping}ms` : ''}</span></span>
                  : (internet.ping != null && <span className="mono" style={{ fontSize: 12, color: internet.ping < 60 ? C.online : C.warning }}>{internet.ping} ms</span>)}
              </div>
              {(data?.uplink || []).length === 0
                ? <div style={{ fontSize: 10, color: C.dim, lineHeight: 1.4 }}>Tandai perangkat sumbernya: menu <b style={{ color: C.text }}>Perangkat → centang "Sumber Internet/Uplink"</b>.</div>
                : data!.uplink.map((u) => (
                  <div key={u.id} onClick={() => { const d = devices.find((x) => x.id === u.id); if (d) setSel(d); }} style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 11, padding: '3px 0', cursor: 'pointer' }}>
                    <span style={{ width: 8, height: 8, borderRadius: 999, background: stColor(u.status), boxShadow: `0 0 6px ${stColor(u.status)}` }} />
                    <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{u.name}</span>
                    <span className="mono" style={{ marginLeft: 'auto', color: u.status === 'offline' ? C.offline : C.dim }}>{u.status === 'offline' ? 'DOWN' : u.ping_ms + 'ms'}</span>
                  </div>
                ))}
            </div>
          </div>
          <div style={{ ...card, flex: 1, minHeight: 84, display: 'flex', flexDirection: 'column' }}>
            <div style={cardTitle}>🔍 INSPEKSI TEKNISI HARI INI · {data?.inspections?.length || 0} <span style={{ fontWeight: 500, color: C.dim }}>· auto-scroll</span></div>
            <div ref={inspScrollRef} className="noc-scroll" style={{ overflow: 'auto', flex: 1, padding: 8, display: 'flex', flexDirection: 'column', gap: 6 }}>
              {(data?.inspections || []).length === 0
                ? <div style={{ fontSize: 11, color: C.dim }}>Belum ada inspeksi hari ini.</div>
                : data!.inspections.map((ins) => {
                  const col = ins.status === 'rusak' ? C.offline : ins.status === 'perhatian' ? C.warning : C.online;
                  return (
                    <div key={ins.id} style={{ background: C.panel2, border: `1px solid ${C.border}`, borderLeft: `3px solid ${col}`, borderRadius: 7, padding: '6px 9px' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 6 }}>
                        <span style={{ fontSize: 12, fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{ins.device_icon || '🔧'} {ins.device_name}</span>
                        <span style={{ fontSize: 9, fontWeight: 800, color: col, whiteSpace: 'nowrap' }}>{ins.status.toUpperCase()}{ins.verified ? ' ✓' : ''}</span>
                      </div>
                      <div style={{ fontSize: 10, color: '#94a3b8', marginTop: 2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>👷 {ins.inspector_name || '—'} · slot {ins.slot} · 🕒 {fmtTime(ins.created_at)}</div>
                      {ins.note && <div style={{ fontSize: 10, color: C.dim, marginTop: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{ins.note}</div>}
                    </div>
                  );
                })}
            </div>
          </div>
        </div>

        {/* TENGAH */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, minHeight: 0 }}>
          {/* KPI */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6,1fr)', gap: 8 }}>
            {[{ l: 'ONLINE', v: kpi.online, c: C.online }, { l: 'GANGGUAN', v: kpi.offline, c: C.offline }, { l: 'WARNING', v: kpi.warning, c: C.warning }, { l: 'INSIDEN AKTIF', v: kpi.activeInc, c: C.accent }, { l: 'TEKNISI', v: kpi.teknisiOn, c: C.text }, { l: 'KETERSEDIAAN', v: `${kpi.availability}%`, c: kpi.availability >= 98 ? C.online : C.warning }].map((k) => (
              <div key={k.l} style={{ ...card, padding: '8px 10px' }}>
                <div style={{ fontSize: 9, color: C.dim, letterSpacing: 0.6, fontWeight: 800 }}>{k.l}</div>
                <div className="mono" style={{ fontSize: 28, fontWeight: 900, color: k.c, lineHeight: 1.15 }}>{k.v}</div>
              </div>
            ))}
          </div>
          {/* PETA */}
          <div style={{ ...card, flex: 1, minHeight: 0, position: 'relative', overflow: 'hidden' }} onMouseEnter={() => setHoverMap(true)} onMouseLeave={() => setHoverMap(false)}>
            <div ref={elRef} style={{ position: 'absolute', inset: 0 }} />
            {focusLoc && (
              <div key={focusLoc.id} className="noc-scroll" style={{ position: 'absolute', top: 12, right: 12, width: 236, maxHeight: 'calc(100% - 24px)', overflow: 'auto', background: 'rgba(9,13,19,.92)', border: `1px solid ${C.accent}55`, borderRadius: 10, padding: 10, zIndex: 500, animation: 'nocslide .45s ease', boxShadow: '0 8px 30px rgba(0,0,0,.5)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                  <div style={{ fontSize: 13, fontWeight: 800 }}>{focusLoc.icon || '📍'} {focusLoc.name}</div>
                  <span className="mono" style={{ fontSize: 10, color: C.accent }}>{(focusIdx % locWithDevices.length) + 1}/{locWithDevices.length}</span>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                  {(byLoc.get(focusLoc.id) || []).map((d) => (
                    <div key={d.id} onClick={() => setSel(d)} style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 11, cursor: 'pointer', background: C.panel2, border: `1px solid ${C.border}`, borderLeft: `3px solid ${stColor(d.status)}`, borderRadius: 6, padding: '5px 8px' }}>
                      <span style={{ width: 8, height: 8, borderRadius: 999, background: stColor(d.status), boxShadow: `0 0 6px ${stColor(d.status)}` }} />
                      <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{d.icon || ''} {d.name}</span>
                      <span className="mono" style={{ marginLeft: 'auto', color: d.status === 'offline' ? C.offline : C.dim, fontSize: 10 }}>{d.status === 'offline' ? 'DOWN' : d.ping_ms + 'ms'}</span>
                    </div>
                  ))}
                </div>
                <div style={{ fontSize: 9, color: C.dim, marginTop: 6, textAlign: 'center' }}>▶ rotasi otomatis · hover untuk jeda</div>
              </div>
            )}
          </div>
          {/* TELEMETRI / TREN */}
          <div style={{ ...card, height: 168, display: 'flex', flexDirection: 'column' }}>
            {sel ? (
              <>
                <div style={{ ...cardTitle, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span>🖧 TELEMETRI · {sel.name}</span>
                  <button onClick={() => setSel(null)} style={{ background: 'transparent', border: 'none', color: C.dim, cursor: 'pointer', fontSize: 14 }}>✕</button>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 12, padding: 12, flex: 1 }}>
                  {[{ l: 'PING (ms)', vals: metrics.map((m) => m.ping_ms), c: C.accent, cur: sel.ping_ms }, { l: 'CPU (%)', vals: metrics.map((m) => m.cpu || 0), c: C.warning, cur: sel.cpu, max: 100 }, { l: 'RAM (%)', vals: metrics.map((m) => m.mem || 0), c: '#a78bfa', cur: sel.mem, max: 100 }].map((g) => (
                    <div key={g.l}>
                      <div style={{ fontSize: 10, color: C.dim }}>{g.l}</div>
                      <div className="mono" style={{ fontSize: 22, fontWeight: 800, color: g.c }}>{g.cur}</div>
                      <Spark vals={g.vals} color={g.c} max={g.max} w={190} />
                    </div>
                  ))}
                </div>
                <div style={{ fontSize: 10, color: C.dim, padding: '0 12px 8px' }}>IP {sel.ip} · {sel.type || '—'} · status <b style={{ color: stColor(sel.status) }}>{sel.status.toUpperCase()}</b> · {metrics.length} sampel terakhir</div>
              </>
            ) : (
              <>
                <div style={cardTitle}>📈 TREN INSIDEN 7 HARI</div>
                <div style={{ display: 'flex', alignItems: 'flex-end', gap: 8, padding: 12, flex: 1 }}>
                  {(data?.trend || []).map((t) => (
                    <div key={t.date} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, height: '100%', justifyContent: 'flex-end' }}>
                      <div className="mono" style={{ fontSize: 11, color: t.count ? C.text : C.dim }}>{t.count}</div>
                      <div style={{ width: '70%', height: `${(t.count / trendMax) * 100}%`, minHeight: 2, background: t.count ? C.accent : '#1e293b', borderRadius: 3 }} />
                      <div style={{ fontSize: 9, color: C.dim }}>{new Date(t.date + 'T00:00:00').toLocaleDateString('id-ID', { weekday: 'short' })}</div>
                    </div>
                  ))}
                </div>
                <div style={{ fontSize: 10, color: C.dim, padding: '0 12px 8px' }}>Klik marker/perangkat untuk telemetri detail.</div>
              </>
            )}
          </div>
        </div>

        {/* SIDEBAR KANAN */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, minHeight: 0 }}>
          <div style={{ ...card, flex: 1.4, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
            <div style={cardTitle}>🚨 GANGGUAN AKTIF · {data?.activeIncidents.length || 0} <span style={{ fontWeight: 500, color: C.dim }}>· auto-scroll</span></div>
            <div ref={incScrollRef} className="noc-scroll" style={{ overflow: 'auto', flex: 1, padding: 8, display: 'flex', flexDirection: 'column', gap: 7 }}>
              {(data?.activeIncidents || []).length === 0 ? <div style={{ fontSize: 11, color: C.dim }}>Tidak ada insiden aktif. 🎉</div> : data!.activeIncidents.map((i) => {
                const col = incColor(i.status);
                return (
                  <div key={i.id} onClick={() => { const d = devices.find((x) => x.id === i.device_id); if (d) { setSel(d); setAlert(d); } }} style={{ background: C.panel2, border: `1px solid ${C.border}`, borderLeft: `4px solid ${prioColor(i.priority)}`, borderRadius: 8, padding: '7px 10px', cursor: 'pointer' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 6, alignItems: 'center' }}>
                      <span style={{ display: 'flex', alignItems: 'center', gap: 5, minWidth: 0 }}>
                        <span className="mono" style={{ fontSize: 11, color: C.dim }}>{i.id}</span>
                        <span title={i.public_report_id ? 'Dari laporan publik' : 'Auto-deteksi sistem'} style={{ fontSize: 8, fontWeight: 800, color: i.public_report_id ? C.accent : C.dim, border: `1px solid ${(i.public_report_id ? C.accent : C.dim)}66`, borderRadius: 4, padding: '0 4px', whiteSpace: 'nowrap' }}>{i.public_report_id ? '📣 LAPOR' : '🤖 AUTO'}</span>
                      </span>
                      <span style={{ fontSize: 9, fontWeight: 800, color: col, border: `1px solid ${col}66`, borderRadius: 5, padding: '0 5px', whiteSpace: 'nowrap' }}>{i.status.toUpperCase()}</span>
                    </div>
                    <div style={{ fontSize: 13, fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{i.device_name}</div>
                    <div style={{ fontSize: 10, color: '#94a3b8', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{i.issue}</div>
                    <div style={{ fontSize: 10, color: C.dim, marginTop: 2 }}>🕒 {fmtTime(i.created_at)}{i.tech_name ? ` · 👷 ${i.tech_name}` : ' · pool'}</div>
                  </div>
                );
              })}
            </div>
          </div>
          <div style={{ ...card, flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
            <div style={cardTitle}>👷 STATUS TEKNISI</div>
            <div className="noc-scroll" style={{ overflow: 'auto', flex: 1, padding: 8, display: 'flex', flexDirection: 'column', gap: 6 }}>
              {(data?.technicians || []).length === 0 ? <div style={{ fontSize: 11, color: C.dim }}>—</div> : data!.technicians.map((t) => {
                const si = shiftInfo(t.shift_type);
                const busy = t.handling > 0;
                return (
                  <div key={t.id} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12 }}>
                    <span style={{ width: 9, height: 9, borderRadius: 999, background: busy ? C.warning : si.c, boxShadow: `0 0 6px ${busy ? C.warning : si.c}` }} />
                    <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{t.emoji || '👤'} {t.name}</span>
                    <span style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 5, whiteSpace: 'nowrap' }}>
                      {busy && <span style={{ fontSize: 10, color: C.warning }}>🛠 {t.handling}</span>}
                      <span className="mono" title="Kode shift hari ini" style={{ fontSize: 10, fontWeight: 800, color: si.c, border: `1px solid ${si.c}66`, borderRadius: 4, padding: '0 5px', minWidth: 16, textAlign: 'center' }}>{si.label}</span>
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
          <div style={{ ...card, display: 'flex', flexDirection: 'column' }}>
            <div style={cardTitle}>🟢 MONITORING LAYANAN</div>
            <div style={{ padding: 10, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
              {(data?.services || []).length === 0 ? <span style={{ fontSize: 11, color: C.dim }}>—</span> : data!.services.map((s) => (
                <div key={s.id} style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 11 }}>
                  <span style={{ width: 8, height: 8, borderRadius: 999, background: s.is_ok ? C.online : C.offline, boxShadow: `0 0 6px ${s.is_ok ? C.online : C.offline}` }} />
                  <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{s.name}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* 14. FOOTER */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 20, padding: '6px 16px', background: C.panel2, borderTop: `1px solid ${C.border}`, fontSize: 11, color: C.dim }}>
        <span className="mono">🕒 {now.toLocaleTimeString('id-ID')}</span>
        <span>DB: <b style={{ color: C.online }}>OK</b></span>
        <span>API Latency: <b className="mono" style={{ color: latency < 300 ? C.online : C.warning }}>{latency}ms</b></span>
        <span>Data: <b className="mono" style={{ color: C.text }}>{data ? ago(new Date(data.ts).toISOString()) : '—'}</b></span>
        <span style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ position: 'relative', display: 'inline-flex', width: 8, height: 8 }}><span style={{ position: 'absolute', inset: 0, borderRadius: 999, background: C.online, opacity: 0.6 }} className="animate-ping" /><span style={{ position: 'relative', width: 8, height: 8, borderRadius: 999, background: C.online }} /></span>
          Live · {POLL_MS / 1000}s{err ? ` · ⚠ ${err}` : ''}
        </span>
      </div>

      {/* 13. TOAST */}
      {toast && (
        <div style={{ position: 'fixed', right: 16, bottom: 46, zIndex: 900, background: C.panel, border: `1px solid ${C.offline}`, borderLeft: `5px solid ${C.offline}`, borderRadius: 10, padding: '12px 16px', maxWidth: 340, boxShadow: `0 8px 30px rgba(0,0,0,.6)`, animation: 'nocslide .3s ease' }}>
          <div style={{ fontSize: 13, fontWeight: 900, color: C.offline }}>🚨 CRITICAL ALERT</div>
          <div style={{ fontSize: 13, fontWeight: 700, marginTop: 2 }}>{toast.name} OFFLINE</div>
          <div style={{ fontSize: 11, color: C.dim, marginTop: 2 }}>{toast.loc || '—'} · {toast.ip}</div>
        </div>
      )}

      {/* Pop-up rincian gangguan (auto-close 30 dtk) */}
      {alert && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.72)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 24 }} onClick={() => setAlert(null)}>
          <div onClick={(e) => e.stopPropagation()} style={{ width: '100%', maxWidth: 470, background: C.panel, border: `2px solid ${stColor(alert.status)}`, borderRadius: 16, padding: 22, boxShadow: `0 0 40px ${stColor(alert.status)}55`, animation: 'nocpop .25s ease' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
              <span style={{ fontSize: 28 }}>{alert.status === 'offline' ? '🚨' : 'ℹ️'}</span>
              <div><div style={{ fontSize: 17, fontWeight: 900, color: stColor(alert.status) }}>{alert.status === 'offline' ? 'GANGGUAN TERDETEKSI' : 'RINCIAN PERANGKAT'}</div>
                <div style={{ fontSize: 11, color: C.dim }}>Lokasi: <b style={{ color: C.text }}>{locations.find((l) => l.id === alert.location_id)?.name || alert.loc || '—'}</b></div></div>
            </div>
            <div style={{ background: C.panel2, border: `1px solid ${C.border}`, borderRadius: 10, padding: 14 }}>
              <div style={{ fontSize: 19, fontWeight: 800 }}>{alert.icon || '🖥️'} {alert.name}</div>
              <div className="mono" style={{ fontSize: 12, color: C.dim, marginTop: 2 }}>{alert.ip}{alert.type ? ` · ${alert.type}` : ''}</div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginTop: 12, fontSize: 13 }}>
                <div><span style={{ color: C.dim }}>Status</span><div style={{ fontWeight: 800, color: stColor(alert.status) }}>{alert.status === 'offline' ? 'TIDAK MERESPONS' : alert.status.toUpperCase()}</div></div>
                <div><span style={{ color: C.dim }}>{alert.status === 'offline' ? 'Sejak' : 'Cek terakhir'}</span><div style={{ fontWeight: 700 }}>{ago(alert.status === 'offline' ? alert.offline_since : alert.last_checked_at)}</div></div>
              </div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 14 }}>
              <span style={{ fontSize: 11, color: C.dim }}>{alert.status === 'offline' ? 'Tutup otomatis dalam 30 detik…' : ''}</span>
              <button onClick={() => setAlert(null)} style={{ background: 'transparent', border: `1px solid ${C.border}`, color: '#94a3b8', borderRadius: 8, padding: '6px 14px', fontSize: 12, cursor: 'pointer' }}>Tutup</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
