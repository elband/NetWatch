import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../api/client';
import { stampFiles } from '../utils/photoStamp';

const KATEGORI =['Komputer', 'Printer', 'Internet', 'WiFi', 'FIDS', 'Telepon', 'Monitor Informasi', 'Server', 'Keamanan', 'Operasional', 'Umum', 'Lainnya'];
const URG: Record<string, string> = { kritis: '🔴 Kritis', tinggi: '🟠 Tinggi', sedang: '🟡 Sedang', rendah: '🟢 Rendah' };
const MAX_MB = 10;
const SHARP_MIN = 40; // ambang ketajaman minimal — mencegah foto blur (sama seperti kamera inspeksi)

// Ukur ketajaman frame video via variansi Laplacian pada thumbnail 160px (murah, cukup akurat).
function frameSharpness(video: HTMLVideoElement, canvas: HTMLCanvasElement): number {
  const vw = video.videoWidth, vh = video.videoHeight;
  if (!vw || !vh) return 0;
  const w = 160, h = Math.max(90, Math.round((vh / vw) * 160));
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return 0;
  ctx.drawImage(video, 0, 0, w, h);
  const { data } = ctx.getImageData(0, 0, w, h);
  const gray = new Float64Array(w * h);
  for (let i = 0; i < w * h; i++) gray[i] = 0.299 * data[i * 4] + 0.587 * data[i * 4 + 1] + 0.114 * data[i * 4 + 2];
  let sum = 0, sum2 = 0, n = 0;
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const lap = 4 * gray[i] - gray[i - 1] - gray[i + 1] - gray[i - w] - gray[i + w];
      sum += lap; sum2 += lap * lap; n++;
    }
  }
  if (!n) return 0;
  const mean = sum / n;
  return sum2 / n - mean * mean;
}
const emptyForm = { nama: '', hp: '', jenis: 'Komputer', judul: '', urgensi: 'sedang', detail: '', gedung: '', ruang: '', unit_id: '', merk: '', inv: '' };

interface Room { kode: string; nama: string; gedung: string | null; lantai: string | null; area: string | null }
interface PublicUnit { id: number; code: string; name: string; icon: string | null }
interface AssetPrefill { id: number; name: string; unit_name?: string | null; op_status?: string | null; merk?: string | null; model?: string | null; loc?: string | null }

// Ikon garis (stroke) ringan — meniru gaya mockup tanpa dependensi tambahan.
function Icon({ name, className = '', size = 18 }: { name: string; className?: string; size?: number }) {
  const c = { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, className };
  switch (name) {
    case 'menu': return <svg {...c}><path d="M4 6h16M4 12h16M4 18h16" /></svg>;
    case 'clock': return <svg {...c}><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></svg>;
    case 'pin': return <svg {...c}><path d="M12 21s7-5.5 7-11a7 7 0 1 0-14 0c0 5.5 7 11 7 11Z" /><circle cx="12" cy="10" r="2.5" /></svg>;
    case 'swap': return <svg {...c}><path d="M7 7h11l-3-3M17 17H6l3 3" /></svg>;
    case 'bolt': return <svg {...c}><path d="M13 2 4 14h7l-1 8 9-12h-7l1-8Z" /></svg>;
    case 'user': return <svg {...c}><circle cx="12" cy="8" r="4" /><path d="M4 21c0-4 4-6 8-6s8 2 8 6" /></svg>;
    case 'phone': return <svg {...c}><path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2Z" /></svg>;
    case 'monitor': return <svg {...c}><rect x="3" y="4" width="18" height="12" rx="2" /><path d="M8 20h8M12 16v4" /></svg>;
    case 'flag': return <svg {...c}><path d="M5 21V4M5 4h11l-2 4 2 4H5" /></svg>;
    case 'doc': return <svg {...c}><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8l-5-5Z" /><path d="M14 3v5h5" /></svg>;
    case 'lines': return <svg {...c}><path d="M4 6h16M4 12h12M4 18h16" /></svg>;
    case 'image': return <svg {...c}><rect x="3" y="3" width="18" height="18" rx="2" /><circle cx="8.5" cy="8.5" r="1.5" /><path d="m21 15-5-5L5 21" /></svg>;
    case 'upload': return <svg {...c}><path d="M12 16V4m0 0L8 8m4-4 4 4" /><path d="M4 16v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" /></svg>;
    case 'camera': return <svg {...c}><path d="M4 7h3l2-2h6l2 2h3a1 1 0 0 1 1 1v11a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V8a1 1 0 0 1 1-1Z" /><circle cx="12" cy="13" r="3.5" /></svg>;
    case 'send': return <svg {...c}><path d="M22 2 11 13M22 2l-7 20-4-9-9-4 20-7Z" /></svg>;
    case 'search': return <svg {...c}><circle cx="11" cy="11" r="7" /><path d="m21 21-4-4" /></svg>;
    case 'chevDown': return <svg {...c}><path d="m6 9 6 6 6-6" /></svg>;
    case 'chevRight': return <svg {...c}><path d="m9 6 6 6-6 6" /></svg>;
    case 'check': return <svg {...c}><path d="M20 6 9 17l-5-5" /></svg>;
    default: return null;
  }
}

// Kamera in-page untuk laporan publik — meniru "kamera inspeksi" (gerbang ketajaman + zoom)
// tetapi TIDAK fullscreen: preview live tertanam langsung di halaman form. Bisa ambil beberapa
// foto berturut-turut; kamera tetap hidup sampai ditutup manual.
function InlineCamera({ onCapture }: { onCapture: (f: File) => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const trackRef = useRef<MediaStreamTrack | null>(null);
  const sharpCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const sharpTimer = useRef<number | null>(null);
  const [active, setActive] = useState(false);
  const [err, setErr] = useState('');
  const [sharp, setSharp] = useState(0);
  const [flash, setFlash] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [nativeZoom, setNativeZoom] = useState(false);
  const [zoomRange, setZoomRange] = useState<{ min: number; max: number; step: number }>({ min: 1, max: 4, step: 0.25 });

  function stopWatchers() { if (sharpTimer.current != null) { clearInterval(sharpTimer.current); sharpTimer.current = null; } }
  function stop() {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null; trackRef.current = null;
    stopWatchers(); setSharp(0); setActive(false); setZoom(1);
  }
  function applyZoom(next: number) {
    const z = Math.min(zoomRange.max, Math.max(zoomRange.min, Math.round(next * 100) / 100));
    setZoom(z);
    if (nativeZoom && trackRef.current) {
      trackRef.current.applyConstraints({ advanced: [{ zoom: z } as unknown as MediaTrackConstraintSet] }).catch(() => {});
    }
  }
  useEffect(() => {
    if (!active) return;
    const v = videoRef.current;
    if (streamRef.current && v) { v.srcObject = streamRef.current; v.play().catch(() => {}); }
    if (!sharpCanvasRef.current) sharpCanvasRef.current = document.createElement('canvas');
    sharpTimer.current = window.setInterval(() => {
      const vid = videoRef.current, cv = sharpCanvasRef.current;
      if (vid && cv) setSharp(frameSharpness(vid, cv));
    }, 350);
    return stopWatchers;
  }, [active]);
  useEffect(() => () => stop(), []);

  async function start() {
    setErr('');
    if (!navigator.mediaDevices?.getUserMedia) {
      setErr('Kamera tidak didukung di browser/perangkat ini. Buka lewat HP dengan kamera (koneksi HTTPS).');
      return;
    }
    try {
      streamRef.current = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false });
      const track = streamRef.current.getVideoTracks()[0] || null;
      trackRef.current = track;
      let nz = false, range = { min: 1, max: 4, step: 0.25 };
      try {
        const caps = track?.getCapabilities?.() as (MediaTrackCapabilities & { zoom?: { min: number; max: number; step?: number } }) | undefined;
        if (caps?.zoom && typeof caps.zoom.max === 'number' && caps.zoom.max > (caps.zoom.min ?? 1)) {
          nz = true;
          range = { min: caps.zoom.min ?? 1, max: caps.zoom.max, step: caps.zoom.step || 0.1 };
        }
      } catch { /* getCapabilities tak didukung → digital */ }
      setNativeZoom(nz); setZoomRange(range); setZoom(nz ? range.min : 1);
      setActive(true);
    } catch {
      setErr('Tidak bisa mengakses kamera. Izinkan akses kamera di browser lalu coba lagi.');
    }
  }

  function snap() {
    const v = videoRef.current;
    if (!v || !v.videoWidth || sharp < SHARP_MIN) return; // hanya boleh saat frame tajam
    const canvas = document.createElement('canvas');
    canvas.width = v.videoWidth; canvas.height = v.videoHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    if (!nativeZoom && zoom > 1) {
      const zw = v.videoWidth / zoom, zh = v.videoHeight / zoom;
      const sx = (v.videoWidth - zw) / 2, sy = (v.videoHeight - zh) / 2;
      ctx.drawImage(v, sx, sy, zw, zh, 0, 0, canvas.width, canvas.height);
    } else {
      ctx.drawImage(v, 0, 0, canvas.width, canvas.height);
    }
    canvas.toBlob((blob) => {
      if (blob) onCapture(new File([blob], `laporan-${Date.now()}.jpg`, { type: 'image/jpeg', lastModified: Date.now() }));
      setFlash(true); window.setTimeout(() => setFlash(false), 180);
    }, 'image/jpeg', 0.92);
  }

  const isSharp = sharp >= SHARP_MIN;

  if (!active) {
    return (
      <div>
        <button type="button" onClick={start} className="w-full rounded-2xl border-2 border-dashed border-white/15 bg-white/[0.02] px-5 py-8 text-center transition-colors hover:border-violet-400/60 hover:bg-violet-500/5">
          <div className="text-violet-300 flex justify-center mb-1.5"><Icon name="camera" size={30} /></div>
          <div className="text-[14px] font-semibold text-slate-100">Buka Kamera</div>
          <div className="text-[11px] text-slate-500 mt-1">Ambil foto gangguan langsung dari kamera perangkat Anda</div>
          <div className="text-[11px] text-slate-500 mt-0.5">Unggah dari galeri dinonaktifkan</div>
        </button>
        {err && <div className="mt-2 text-[11px] text-rose-400">⚠️ {err}</div>}
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-white/10 bg-black/30 p-3">
      <div className="relative overflow-hidden rounded-xl border border-white/10 bg-black">
        <video ref={videoRef} playsInline muted className="w-full bg-black max-h-[52vh] object-contain"
          style={{ transform: !nativeZoom && zoom > 1 ? `scale(${zoom})` : undefined, transformOrigin: 'center center' }} />
        {flash && <div className="absolute inset-0 bg-white/80 pointer-events-none" />}
        <div className={`absolute left-1/2 -translate-x-1/2 bottom-3 px-3 py-1.5 rounded-full text-[11px] font-semibold flex items-center gap-1.5 ${isSharp ? 'bg-emerald-500/90 text-white' : 'bg-black/75 text-white'}`}>
          {isSharp ? '✅ Foto tajam — siap' : '🔍 Memeriksa ketajaman…'}
        </div>
        <div className="absolute top-2 left-1/2 -translate-x-1/2 flex items-center gap-2 bg-black/55 rounded-full px-3 py-1.5 max-w-[85%]">
          <span className="text-[11px] text-white leading-none">🔍</span>
          <input type="range" aria-label="Zoom kamera" min={zoomRange.min} max={zoomRange.max} step={zoomRange.step}
            value={zoom} onChange={(e) => applyZoom(Number(e.target.value))}
            className="w-28 sm:w-40 cursor-pointer" style={{ accentColor: '#a78bfa' }} />
          <span className="text-[11px] font-semibold text-white tabular-nums w-9 text-right">{zoom.toFixed(1)}×</span>
        </div>
      </div>
      <div className="mt-1.5 h-1.5 rounded bg-white/10 overflow-hidden" title="Indikator ketajaman">
        <div className={`h-full transition-all ${isSharp ? 'bg-emerald-400' : 'bg-amber-400'}`} style={{ width: `${Math.min(100, Math.round((sharp / (SHARP_MIN * 2)) * 100))}%` }} />
      </div>
      <div className="flex gap-2 mt-2">
        <button type="button" onClick={snap} disabled={!isSharp}
          className={`flex-1 rounded-xl py-2.5 text-[13px] font-semibold ${isSharp ? 'text-white' : 'bg-white/5 text-slate-500 cursor-not-allowed'}`}
          style={isSharp ? { background: 'linear-gradient(135deg,#4f46e5,#7c3aed)' } : undefined}>
          📸 {isSharp ? 'Ambil Foto' : 'Fokuskan kamera…'}
        </button>
        <button type="button" onClick={stop} className="rounded-xl border border-white/15 bg-white/5 py-2.5 px-4 text-[13px] text-slate-200 hover:bg-white/10">Tutup Kamera</button>
      </div>
      <div className="text-[10px] text-slate-500 mt-2 leading-relaxed">Arahkan kamera ke perangkat/gangguan hingga tajam, lalu tekan <b>Ambil Foto</b>. Anda bisa mengambil beberapa foto.</div>
      {err && <div className="mt-1 text-[11px] text-rose-400">⚠️ {err}</div>}
    </div>
  );
}

export default function LaporPublik() {
  const params = new URLSearchParams(window.location.search);
  const roomCode = params.get('room') || '';
  const trackParam = params.get('track') || '';
  const asetToken = params.get('aset') || '';
  const [asset, setAsset] = useState<AssetPrefill | null>(null);
  const [isTech, setIsTech] = useState(false);
  const [room, setRoom] = useState<Room | null>(null);
  const [roomErr, setRoomErr] = useState('');
  const [editLoc, setEditLoc] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [files, setFiles] = useState<File[]>([]);
  const [submitted, setSubmitted] = useState<{ id: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [trackId, setTrackId] = useState(trackParam);
  const [track, setTrack] = useState<any>(null);
  const [showTrack, setShowTrack] = useState(!!trackParam);
  const trackRef = useRef<HTMLDivElement>(null);
  const [units, setUnits] = useState<PublicUnit[]>([]);

  useEffect(() => {
    if (!roomCode) return;
    api.get(`/rooms/public/${encodeURIComponent(roomCode)}`).then((r) => setRoom(r.data.room)).catch(() => setRoomErr('Kode ruangan tidak dikenali. Anda tetap dapat mengisi lokasi manual.'));
  }, [roomCode]);
  // Multi-unit: pelapor memilih unit tujuan (default unit pertama = ELB).
  useEffect(() => {
    api.get('/units/public').then((r) => {
      const list: PublicUnit[] = r.data.units || [];
      setUnits(list);
      if (list.length) setForm((f) => (f.unit_id ? f : { ...f, unit_id: String(list[0].id) }));
    }).catch(() => {});
  }, []);
  // Dari tautan WA: ?track=ID → langsung lacak.
  useEffect(() => { if (trackParam) doTrack(); /* eslint-disable-next-line */ }, []);
  // Dari QR aset: ?aset=<token> → prefill form kerusakan + banner aset.
  useEffect(() => {
    if (!asetToken) return;
    api.get(`/aset/public/${encodeURIComponent(asetToken)}`).then((r) => {
      setAsset(r.data.asset);
      const p = r.data.prefill || {};
      setForm((f) => ({
        ...f,
        jenis: p.jenis || f.jenis,
        judul: p.judul || f.judul,
        merk: p.merk || f.merk,
        inv: p.inv || f.inv,
        ruang: p.ruang || f.ruang,
        unit_id: p.unit_id ? String(p.unit_id) : f.unit_id,
      }));
    }).catch(() => {});
    // Bila teknisi sedang login, tawarkan pintasan input meter.
    api.get('/auth/me').then((r) => {
      const roles: string[] = r.data?.user?.roles || (r.data?.user?.role ? [r.data.user.role] : []);
      setIsTech(roles.some((x) => ['admin', 'koordinator', 'teknisi'].includes(x)));
    }).catch(() => setIsTech(false));
  }, [asetToken]);

  function addFiles(list: FileList | File[]) {
    const arr = Array.from(list);
    const tooBig = arr.filter((f) => f.size > MAX_MB * 1024 * 1024);
    const ok = arr.filter((f) => f.size <= MAX_MB * 1024 * 1024);
    setError(tooBig.length ? `${tooBig.length} foto dilewati (maks ${MAX_MB} MB per foto).` : '');
    if (ok.length) setFiles((prev) => [...prev, ...ok]);
  }
  // Object URL untuk pratinjau foto; direvoke saat daftar berubah / unmount (hindari bocor memori).
  const photoUrls = useMemo(() => files.map((f) => URL.createObjectURL(f)), [files]);
  useEffect(() => () => photoUrls.forEach((u) => URL.revokeObjectURL(u)), [photoUrls]);

  async function submit() {
    if (!form.nama.trim() || !form.hp.trim()) { setError('Nama & No. HP/WA wajib diisi.'); return; }
    if (!form.judul.trim() || !form.detail.trim()) { setError('Perangkat/judul & deskripsi gangguan wajib diisi.'); return; }
    if (!files.length) { setError('Foto gangguan wajib dilampirkan — buka kamera lalu ambil foto.'); return; }
    setBusy(true); setError('');
    try {
      const fd = new FormData();
      Object.entries(form).forEach(([k, v]) => v && fd.append(k, v));
      if (roomCode) fd.append('room_code', roomCode);
      if (asetToken) fd.append('aset_token', asetToken); // deteksi otomatis perangkat dari QR aset
      fd.append('baseUrl', location.origin);
      const stampedFiles = await stampFiles(files, [`Laporan · ${form.judul.trim()}`]);
      stampedFiles.forEach((f) => fd.append('foto', f));
      const res = await api.post('/public-reports', fd, { headers: { 'Content-Type': 'multipart/form-data' } });
      setSubmitted({ id: res.data.id }); setForm(emptyForm); setFiles([]);
    } catch (e: any) { setError(e?.response?.data?.error || 'Gagal mengirim laporan.'); }
    finally { setBusy(false); }
  }
  async function doTrack(idArg?: string) {
    const tid = (idArg ?? trackId).trim();
    if (!tid) return;
    setTrack(null);
    try { const r = await api.get(`/public-reports/track/${encodeURIComponent(tid)}`); setTrack(r.data.ticket); }
    catch (e: any) { setTrack({ error: e?.response?.data?.error || 'Tiket tidak ditemukan.' }); }
  }
  function openTrack() {
    setShowTrack(true);
    setTimeout(() => trackRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 60);
  }

  const STAGE: Record<string, string> = { Menunggu: 'text-amber-300 bg-amber-400/10', Diproses: 'text-violet-300 bg-violet-400/10', 'Dalam Penanganan': 'text-orange-300 bg-orange-400/10', Selesai: 'text-emerald-300 bg-emerald-400/10' };
  const showManual = editLoc || !room;
  const locName = room ? room.nama : (form.ruang || form.gedung || 'Lokasi belum dipilih');
  const locCrumb = room ? [room.gedung, room.lantai, room.area].filter(Boolean).join(' • ') : [form.gedung, form.ruang].filter(Boolean).join(' • ');

  const card = 'rounded-3xl border border-white/10 bg-[#0f0d20]/70 backdrop-blur-sm shadow-[0_8px_40px_-12px_rgba(99,102,241,0.35)]';
  const fieldBox = 'flex items-center gap-3 rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3 focus-within:border-violet-400/50 transition-colors';
  const iconBox = 'shrink-0 w-9 h-9 rounded-xl bg-white/5 text-violet-300 flex items-center justify-center';
  const label = 'text-[11px] text-slate-400';
  const inp = 'w-full bg-transparent text-[14px] font-medium text-white placeholder-slate-600 outline-none';

  return (
    <div className="min-h-screen p-4 sm:p-6 text-white" style={{ background: 'radial-gradient(1100px 650px at 50% -12%, #1c1346 0%, #0c0a20 46%, #06060f 100%)' }}>
      <div className="max-w-2xl mx-auto">
        {/* Header */}
        <div className="flex items-center gap-4 mb-5">
          <span className="text-slate-300/80" aria-hidden><Icon name="menu" size={24} /></span>
          <div className="w-12 h-12 rounded-2xl flex items-center justify-center shadow-lg shrink-0" style={{ background: 'linear-gradient(135deg,#6366f1,#22d3ee)' }}>
            <Icon name="monitor" size={22} className="text-white" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-[22px] leading-tight font-extrabold tracking-tight">Pelaporan Fasilitas</div>
            <div className="text-[12px] text-slate-400">Seksi Teknik dan Operasi • Bandara A.P.T Pranoto</div>
          </div>
          <button onClick={openTrack} className="hidden sm:flex items-center gap-2 rounded-xl border border-violet-400/40 bg-violet-500/10 px-3.5 py-2 text-[12px] font-semibold text-violet-200 hover:bg-violet-500/20 transition-colors whitespace-nowrap">
            <Icon name="clock" size={15} /> Riwayat Laporan
          </button>
        </div>

        {/* Banner aset (dari scan QR) */}
        {asset && (
          <div className="rounded-3xl border border-cyan-400/25 bg-gradient-to-br from-cyan-500/10 to-violet-500/5 p-5 mb-4">
            <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-cyan-300"><Icon name="monitor" size={14} /> Aset (dari QR)</div>
            <div className="text-[22px] font-bold mt-1 leading-tight">{asset.name}</div>
            <div className="text-[12px] text-slate-400 mt-0.5">{[asset.merk, asset.model].filter(Boolean).join(' ')}{asset.unit_name ? ` • ${asset.unit_name}` : ''}{asset.loc ? ` • ${asset.loc}` : ''}</div>
            {isTech && (
              <a href={`/aset?focus=${asset.id}`} className="inline-flex items-center gap-2 mt-3 rounded-xl border border-cyan-400/40 bg-cyan-500/10 px-3.5 py-2 text-[12px] font-semibold text-cyan-200 hover:bg-cyan-500/20 transition-colors">
                <Icon name="doc" size={15} /> Saya teknisi — Input Meter / Detail Aset
              </a>
            )}
          </div>
        )}

        {/* Lokasi */}
        <div className="rounded-3xl border border-violet-400/25 bg-gradient-to-br from-violet-500/10 to-blue-500/5 p-5 mb-4 relative overflow-hidden">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-violet-300"><Icon name="pin" size={14} /> Lokasi (dari QR)</div>
              <div className="text-[24px] font-bold mt-1 leading-tight truncate">{locName}</div>
              {locCrumb && <div className="text-[12px] text-slate-400 mt-0.5">{locCrumb}</div>}
            </div>
            <button onClick={() => setEditLoc((v) => !v)} className="shrink-0 flex items-center gap-2 rounded-xl border border-white/15 bg-white/5 px-3.5 py-2 text-[12px] font-semibold text-slate-200 hover:bg-white/10 transition-colors">
              <Icon name="swap" size={15} /> Ganti Lokasi
            </button>
          </div>
          {showManual && (
            <div className="grid grid-cols-2 gap-2.5 mt-4">
              <input className="bg-black/30 border border-white/10 rounded-xl px-3 py-2.5 text-[13px] text-white placeholder-slate-500 outline-none focus:border-violet-400/50" placeholder="Gedung" value={form.gedung} onChange={(e) => setForm({ ...form, gedung: e.target.value })} />
              <input className="bg-black/30 border border-white/10 rounded-xl px-3 py-2.5 text-[13px] text-white placeholder-slate-500 outline-none focus:border-violet-400/50" placeholder="Ruang / Area" value={form.ruang} onChange={(e) => setForm({ ...form, ruang: e.target.value })} />
            </div>
          )}
        </div>
        {roomErr && <div className="rounded-2xl border border-amber-500/30 bg-amber-500/5 text-amber-300 p-3.5 mb-4 text-[12px]">{roomErr}</div>}

        {/* Form / Sukses */}
        <div className={`${card} p-5 sm:p-6`}>
          {submitted ? (
            <div className="text-center py-6">
              <div className="w-16 h-16 mx-auto rounded-full flex items-center justify-center bg-emerald-500/15 text-emerald-300 mb-3"><Icon name="check" size={34} /></div>
              <div className="text-emerald-300 font-bold text-xl">Laporan Terkirim!</div>
              <div className="text-[13px] text-slate-400 mt-1">Tiket Anda telah dibuat & diteruskan ke teknisi on-duty.</div>
              <div className="mt-4 bg-black/30 rounded-2xl p-4 inline-block"><div className="text-[10px] text-slate-500 uppercase tracking-wide">Nomor Tiket</div><div className="font-mono text-violet-300 text-2xl font-bold">{submitted.id}</div></div>
              <div className="text-[12px] text-emerald-300/80 mt-3">📲 Notifikasi & tautan pemantauan dikirim ke WhatsApp Anda (bila nomor diisi).</div>
              <div className="flex gap-2 justify-center mt-4">
                <button onClick={() => { setTrackId(submitted.id); openTrack(); doTrack(submitted.id); }} className="text-[12px] bg-violet-500/15 text-violet-200 border border-violet-400/30 rounded-xl px-4 py-2 font-semibold">Tinjau Status</button>
                <button onClick={() => setSubmitted(null)} className="text-[12px] border border-white/15 rounded-xl px-4 py-2 text-slate-300">Kirim laporan lain</button>
              </div>
            </div>
          ) : (
            <>
              <div className="flex items-center gap-3 mb-5">
                <div className="w-11 h-11 rounded-2xl flex items-center justify-center text-white shadow-lg" style={{ background: 'linear-gradient(135deg,#7c3aed,#4f46e5)' }}><Icon name="bolt" size={22} /></div>
                <div>
                  <div className="text-[17px] font-bold leading-tight">Laporkan Gangguan</div>
                  <div className="text-[12px] text-slate-400">Bantu kami menjaga fasilitas tetap optimal ✨</div>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {/* Unit tujuan (multi-unit) */}
                {units.length > 1 && (
                  <div className={`${fieldBox} sm:col-span-2`}>
                    <div className={iconBox}><Icon name="flag" /></div>
                    <div className="min-w-0 flex-1"><div className={label}>Unit Tujuan Laporan</div>
                      <select className={`${inp} appearance-none cursor-pointer`} value={form.unit_id} onChange={(e) => setForm({ ...form, unit_id: e.target.value })}>
                        {units.map((u) => <option key={u.id} value={u.id} className="bg-[#15122b]">{u.icon || '🏢'} {u.name}</option>)}
                      </select></div>
                    <span className="text-slate-500"><Icon name="chevDown" size={16} /></span>
                  </div>
                )}
                {/* Nama */}
                <div className={fieldBox}>
                  <div className={iconBox}><Icon name="user" /></div>
                  <div className="min-w-0 flex-1"><div className={label}>Nama <span className="text-rose-400">*</span></div>
                    <input className={inp} placeholder="Masukkan nama Anda" value={form.nama} onChange={(e) => setForm({ ...form, nama: e.target.value })} /></div>
                </div>
                {/* HP */}
                <div className={fieldBox}>
                  <div className={iconBox}><Icon name="phone" /></div>
                  <div className="min-w-0 flex-1"><div className={label}>No. HP/WA <span className="text-rose-400">*</span></div>
                    <input className={inp} inputMode="tel" placeholder="08xxxxxxxxxxx" value={form.hp} onChange={(e) => setForm({ ...form, hp: e.target.value })} /></div>
                </div>
                {/* Kategori */}
                <div className={fieldBox}>
                  <div className={iconBox}><Icon name="monitor" /></div>
                  <div className="min-w-0 flex-1"><div className={label}>Kategori Perangkat</div>
                    <select className={`${inp} appearance-none cursor-pointer`} value={form.jenis} onChange={(e) => setForm({ ...form, jenis: e.target.value })}>
                      {KATEGORI.map((k) => <option key={k} value={k} className="bg-[#15122b]">{k}</option>)}
                    </select></div>
                  <span className="text-slate-500"><Icon name="chevDown" size={16} /></span>
                </div>
                {/* Prioritas */}
                <div className={fieldBox}>
                  <div className={iconBox}><Icon name="flag" /></div>
                  <div className="min-w-0 flex-1"><div className={label}>Tingkat Prioritas</div>
                    <select className={`${inp} appearance-none cursor-pointer`} value={form.urgensi} onChange={(e) => setForm({ ...form, urgensi: e.target.value })}>
                      {Object.entries(URG).map(([k, v]) => <option key={k} value={k} className="bg-[#15122b]">{v}</option>)}
                    </select></div>
                  <span className="text-slate-500"><Icon name="chevDown" size={16} /></span>
                </div>
                {/* Judul */}
                <div className={`${fieldBox} sm:col-span-2`}>
                  <div className={iconBox}><Icon name="doc" /></div>
                  <div className="min-w-0 flex-1"><div className={label}>Perangkat/Judul gangguan <span className="text-rose-400">*</span></div>
                    <input className={inp} placeholder="Contoh: Komputer tidak menyala" value={form.judul} onChange={(e) => setForm({ ...form, judul: e.target.value })} /></div>
                </div>
                {/* Deskripsi */}
                <div className={`${fieldBox} sm:col-span-2 items-start`}>
                  <div className={`${iconBox} mt-0.5`}><Icon name="lines" /></div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between"><div className={label}>Deskripsi gangguan <span className="text-rose-400">*</span></div>
                      <span className="text-[10px] text-slate-500">{form.detail.length}/500</span></div>
                    <textarea maxLength={500} className={`${inp} resize-none min-h-[84px] mt-0.5`} placeholder="Jelaskan detail gangguan yang terjadi…" value={form.detail} onChange={(e) => setForm({ ...form, detail: e.target.value })} />
                  </div>
                </div>
              </div>

              {/* Foto bukti — WAJIB, langsung dari kamera (bukan unggah galeri) */}
              <div className="mt-4">
                <div className="flex items-center gap-2 text-[13px] font-semibold text-violet-300 mb-2"><Icon name="camera" size={16} /> Foto Gangguan <span className="text-rose-400 font-normal">* wajib</span></div>
                <InlineCamera onCapture={(f) => addFiles([f])} />
                {files.length > 0 && (
                  <div className="grid grid-cols-3 sm:grid-cols-4 gap-2 mt-3">
                    {photoUrls.map((url, i) => (
                      <div key={i} className="relative aspect-square rounded-xl overflow-hidden border border-white/10 bg-black/30">
                        <img src={url} alt={`Foto ${i + 1}`} className="w-full h-full object-cover" />
                        <button type="button" onClick={() => setFiles((prev) => prev.filter((_, j) => j !== i))} className="absolute top-1 right-1 w-6 h-6 rounded-full bg-black/70 text-rose-300 hover:text-rose-200 text-sm flex items-center justify-center">✕</button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {error && <div className="mt-3 text-[12px] text-rose-400">⚠️ {error}</div>}

              {/* Kirim */}
              <button onClick={submit} disabled={busy} className="w-full mt-4 rounded-2xl px-5 py-4 flex items-center gap-4 text-left text-white font-bold shadow-lg disabled:opacity-50 transition-opacity" style={{ background: 'linear-gradient(135deg,#4f46e5,#7c3aed)' }}>
                <Icon name="send" size={22} />
                <span className="flex-1">
                  <span className="block text-[15px]">{busy ? 'Mengirim…' : 'Kirim Laporan'}</span>
                  <span className="block text-[11px] font-normal opacity-80">Laporan akan langsung diteruskan ke teknisi <i>on-duty</i></span>
                </span>
                <Icon name="chevRight" size={20} />
              </button>
            </>
          )}
        </div>

        {/* Lacak Status Tiket */}
        <div ref={trackRef} className={`${card} p-5 mt-4`}>
          <button onClick={() => setShowTrack((v) => !v)} className="w-full flex items-center gap-4 text-left">
            <div className="w-11 h-11 rounded-2xl flex items-center justify-center text-white shadow-lg" style={{ background: 'linear-gradient(135deg,#7c3aed,#4f46e5)' }}><Icon name="search" size={20} /></div>
            <div className="flex-1">
              <div className="text-[15px] font-bold">Lacak Status Tiket</div>
              <div className="text-[12px] text-slate-400">Cek perkembangan laporan yang telah Anda kirim</div>
            </div>
            <span className="text-slate-500">{showTrack ? <Icon name="chevDown" /> : <Icon name="chevRight" />}</span>
          </button>
          {showTrack && (
            <div className="mt-4">
              <div className="flex gap-2">
                <input value={trackId} onChange={(e) => setTrackId(e.target.value)} placeholder="No. Tiket (mis. LAP-0001)" className="flex-1 bg-black/30 border border-white/10 rounded-xl px-3.5 py-2.5 text-[13px] text-white placeholder-slate-500 outline-none focus:border-violet-400/50" />
                <button onClick={() => doTrack()} className="rounded-xl px-4 text-[13px] font-semibold text-white" style={{ background: 'linear-gradient(135deg,#4f46e5,#7c3aed)' }}>Lacak</button>
              </div>
              {track && (track.error ? <div className="text-rose-400 text-[12px] mt-3">{track.error}</div> : (
                <div className="mt-4 text-[13px] text-slate-300 space-y-1.5">
                  <div className="flex justify-between items-center"><span className="text-slate-500">Status</span><span className={`px-2.5 py-0.5 rounded-full text-[10px] font-semibold ${STAGE[track.stage] || 'bg-slate-500/10'}`}>{track.stage}</span></div>
                  <div className="flex justify-between gap-3"><span className="text-slate-500">Gangguan</span><span className="text-right">{track.judul}</span></div>
                  <div className="flex justify-between gap-3"><span className="text-slate-500">Lokasi</span><span className="text-right">{track.ruang || track.gedung || '-'}</span></div>
                  <div className="flex justify-between gap-3"><span className="text-slate-500">Teknisi</span><span className="text-right">{track.tech_name || '— (menunggu diambil)'}</span></div>
                  {track.resolved_at && <div className="flex justify-between gap-3"><span className="text-slate-500">Selesai</span><span className="text-right">{new Date(track.resolved_at).toLocaleString('id-ID')}</span></div>}
                  {track.perbaikan && <div className="bg-black/20 rounded-xl p-3 text-[12px]"><span className="text-slate-500">Catatan: </span>{track.perbaikan}</div>}
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="flex items-center justify-center gap-1.5 text-[11px] text-slate-600 mt-5">
          <span aria-hidden>🔒</span> Tanpa login • Laporan langsung diteruskan ke teknisi <i>on-duty</i>
        </div>
      </div>
    </div>
  );
}
