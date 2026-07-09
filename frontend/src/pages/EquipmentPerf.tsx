import { useEffect, useRef, useState } from 'react';
import { api } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { hasRole } from '../utils/roles';
import MaintenancePhotosModal from '../components/MaintenancePhotosModal';
import MaintenanceWindows from './MaintenanceWindows';
import { confirmDialog, alertDialog } from '../components/dialog';
import { getGeo, stampPhoto, stampFiles, type GeoPoint } from '../utils/photoStamp';
import { openImage } from '../components/ImageLightbox';
import type { EquipmentRow, Inspection, InspectStatus, MaintenanceRow, Device, PowerOn } from '../types';

const SLOTS: Array<'09' | '12' | '15'> = ['09', '12', '15'];
const SLOT_LABEL: Record<string, string> = { '09': '09:00', '12': '12:00', '15': '15:00' };
const ST_META: Record<InspectStatus, { c: string; bg: string; t: string }> = {
  baik: { c: 'text-success', bg: 'bg-success/15 border-success/40', t: 'Baik' },
  perhatian: { c: 'text-warn', bg: 'bg-warn/15 border-warn/40', t: 'Perhatian' },
  rusak: { c: 'text-danger', bg: 'bg-danger/15 border-danger/40', t: 'Rusak' },
};
// Koordinat perangkat + radius kerja untuk panel jarak & keterangan geotag.
type DeviceGeo = { name: string; lat?: number | null; lng?: number | null };
const DEFAULT_RADIUS_M = 200;

// Jarak dua titik (meter) — haversine. Dipakai untuk "Jarak Saat Ini" & keterangan foto.
function haversineM(la1: number, lo1: number, la2: number, lo2: number): number {
  const R = 6371000, toRad = (d: number) => (d * Math.PI) / 180;
  const dLa = toRad(la2 - la1), dLo = toRad(lo2 - lo1);
  const a = Math.sin(dLa / 2) ** 2 + Math.cos(toRad(la1)) * Math.cos(toRad(la2)) * Math.sin(dLo / 2) ** 2;
  return Math.round(R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
}
// Jarak titik GPS ke perangkat bila koordinat perangkat tersedia, else null.
function distToDevice(geo: GeoPoint | null, dev?: DeviceGeo | null): number | null {
  if (!geo || !dev || dev.lat == null || dev.lng == null) return null;
  return haversineM(geo.lat, geo.lng, Number(dev.lat), Number(dev.lng));
}

// Skor ketajaman satu frame video: variance of Laplacian pada citra grayscale ~160px.
// Makin tinggi makin tajam; foto buram bernilai rendah. Dipakai untuk mengunci tombol
// "Ambil Foto" sampai gambar cukup jelas (anti-foto blur).
const SHARP_MIN = 40; // ambang ketajaman minimal
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

// Hook kamera+geotag bersama untuk modal inspeksi & hidupkan/matikan peralatan: saat foto
// dipilih, ambil lokasi aktif, catat waktu tangkap (file.lastModified), lalu bakar geotag ke
// foto — termasuk keterangan JARAK ke perangkat & DALAM/LUAR RADIUS bila koordinat tersedia.
function usePhotoCapture(contextLines: string[], opts?: { device?: DeviceGeo | null; radiusM?: number }) {
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [geo, setGeo] = useState<GeoPoint | null>(null);
  const [dist, setDist] = useState<number | null>(null);
  const [capturedAt, setCapturedAt] = useState<number | null>(null);
  const [processing, setProcessing] = useState(false);
  const [geoErr, setGeoErr] = useState('');

  async function pick(f: File | null) {
    if (!f) { setFile(null); setPreview(null); setGeo(null); setDist(null); setCapturedAt(null); setGeoErr(''); return; }
    setProcessing(true); setGeoErr('');
    setCapturedAt(f.lastModified || Date.now());
    const g = await getGeo();
    setGeo(g);
    if (!g) setGeoErr('Lokasi tidak aktif — izinkan akses lokasi, lalu ambil foto ulang agar geotag tercatat.');
    // Keterangan tambahan pada geotag: jarak ke perangkat + status radius.
    const radius = opts?.radiusM ?? DEFAULT_RADIUS_M;
    const d = distToDevice(g, opts?.device);
    setDist(d);
    const extra = [...contextLines];
    if (d != null) extra.push(`📏 ${d} m ke perangkat (radius ${radius} m) — ${d <= radius ? 'DALAM RADIUS' : 'LUAR RADIUS'}`);
    const stamped = await stampPhoto(f, g, extra);
    setFile(stamped);
    setPreview(URL.createObjectURL(stamped));
    setProcessing(false);
  }
  return { file, preview, geo, dist, capturedAt, processing, geoErr, pick };
}

// Halaman kamera dokumentasi peralatan (getUserMedia) — unggah galeri dinonaktifkan.
// Saat aktif menampilkan panel gaya absensi: LOKASI ANDA, RADIUS KERJA, JARAK SAAT INI &
// STATUS (dalam/luar radius) secara live, plus GERBANG KETAJAMAN — tombol "Ambil Foto"
// terkunci sampai frame cukup tajam (anti-foto blur). Frame hasil diteruskan ke onCapture
// (yang menggeotag lewat usePhotoCapture.pick). Butuh konteks aman (HTTPS/localhost).
function CameraCapture({ onCapture, hasPhoto, device, radiusM = DEFAULT_RADIUS_M }: {
  onCapture: (f: File) => void; hasPhoto: boolean; device?: DeviceGeo | null; radiusM?: number;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const sharpCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const sharpTimer = useRef<number | null>(null);
  const watchIdRef = useRef<number | null>(null);
  const [active, setActive] = useState(false);
  const [err, setErr] = useState('');
  const [sharp, setSharp] = useState(0);
  const [pos, setPos] = useState<GeoPoint | null>(null);
  const [posErr, setPosErr] = useState('');

  function stopWatchers() {
    if (sharpTimer.current != null) { clearInterval(sharpTimer.current); sharpTimer.current = null; }
    if (watchIdRef.current != null && navigator.geolocation) { navigator.geolocation.clearWatch(watchIdRef.current); watchIdRef.current = null; }
  }
  function stop() {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    stopWatchers();
    setSharp(0); setActive(false);
  }
  // Saat kamera aktif: wiring stream → <video>, jalankan loop ketajaman & watch lokasi.
  useEffect(() => {
    if (!active) return;
    const v = videoRef.current;
    if (streamRef.current && v) { v.srcObject = streamRef.current; v.play().catch(() => {}); }
    if (!sharpCanvasRef.current) sharpCanvasRef.current = document.createElement('canvas');
    sharpTimer.current = window.setInterval(() => {
      const vid = videoRef.current, cv = sharpCanvasRef.current;
      if (vid && cv) setSharp(frameSharpness(vid, cv));
    }, 350);
    if (navigator.geolocation) {
      watchIdRef.current = navigator.geolocation.watchPosition(
        (p) => { setPos({ lat: p.coords.latitude, lng: p.coords.longitude, acc: p.coords.accuracy }); setPosErr(''); },
        () => setPosErr('Lokasi tidak aktif — izinkan akses lokasi.'),
        { enableHighAccuracy: true, maximumAge: 3000, timeout: 10000 }
      );
    }
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
      setActive(true);
    } catch {
      setErr('Tidak bisa mengakses kamera. Izinkan akses kamera di browser lalu coba lagi. (Unggah dari galeri dinonaktifkan untuk inspeksi.)');
    }
  }

  function snap() {
    const v = videoRef.current;
    if (!v || !v.videoWidth || sharp < SHARP_MIN) return; // hanya boleh saat frame tajam
    const canvas = document.createElement('canvas');
    canvas.width = v.videoWidth; canvas.height = v.videoHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.drawImage(v, 0, 0, canvas.width, canvas.height);
    canvas.toBlob((blob) => {
      if (blob) onCapture(new File([blob], `kamera-${Date.now()}.jpg`, { type: 'image/jpeg', lastModified: Date.now() }));
      stop();
    }, 'image/jpeg', 0.92);
  }

  const isSharp = sharp >= SHARP_MIN;
  const dist = distToDevice(pos, device);
  const within = dist != null ? dist <= radiusM : null;
  const hasDevCoord = !!device && device.lat != null && device.lng != null;

  if (!active) {
    return (
      <div className="mb-1">
        <button type="button" onClick={start} className="w-full border border-accent/40 text-accent rounded-md py-2.5 text-xs font-semibold hover:bg-accent/10">
          📷 {hasPhoto ? 'Ambil Ulang dari Kamera' : 'Buka Kamera & Foto Peralatan'}
        </button>
        {err && <div className="mt-1 text-[10px] text-danger">⚠️ {err}</div>}
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-[60] bg-black/90 flex items-center justify-center p-3" role="dialog" aria-modal="true">
      <div className="bg-surface border border-border rounded-xl w-full max-w-3xl max-h-[96vh] overflow-y-auto p-4" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-3">
          <div className="text-sm font-bold truncate">📷 Foto Peralatan{device?.name ? ` — ${device.name}` : ''}</div>
          <button type="button" onClick={stop} className="text-text2 hover:text-text text-xl leading-none">×</button>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-[1.5fr_1fr] gap-3">
          {/* Kamera + gerbang ketajaman */}
          <div>
            <div className="relative">
              <video ref={videoRef} playsInline muted className="w-full rounded-lg border border-border bg-black max-h-[58vh] object-contain" />
              <div className={`absolute left-1/2 -translate-x-1/2 bottom-3 px-3 py-1.5 rounded-full text-[11px] font-semibold flex items-center gap-1.5 ${isSharp ? 'bg-success/90 text-white' : 'bg-black/75 text-white'}`}>
                {isSharp ? '✅ Foto tajam — siap' : '🔍 Memeriksa ketajaman…'}
              </div>
            </div>
            <div className="mt-1.5 h-1.5 rounded bg-surface2 overflow-hidden" title="Indikator ketajaman">
              <div className={`h-full transition-all ${isSharp ? 'bg-success' : 'bg-warn'}`} style={{ width: `${Math.min(100, Math.round((sharp / (SHARP_MIN * 2)) * 100))}%` }} />
            </div>
            <div className="flex gap-2 mt-2">
              <button type="button" onClick={snap} disabled={!isSharp}
                className={`flex-1 rounded-md py-2.5 text-sm font-semibold ${isSharp ? 'bg-accent text-bg' : 'bg-surface2 text-text2 cursor-not-allowed'}`}>
                📸 {isSharp ? 'Ambil Foto' : 'Fokuskan kamera…'}
              </button>
              <button type="button" onClick={stop} className="border border-border text-text2 rounded-md py-2.5 px-4 text-sm">Batal</button>
            </div>
          </div>
          {/* Panel lokasi / radius / jarak / status */}
          <div className="space-y-2">
            <div className="border border-border rounded-lg px-3 py-2">
              <div className="text-[9px] font-semibold tracking-wide text-text2">LOKASI ANDA</div>
              {pos ? (
                <div className="mt-0.5"><div className="text-xs font-mono">{pos.lat.toFixed(6)}, {pos.lng.toFixed(6)}</div><div className="text-[10px] text-text2">akurasi ±{Math.round(pos.acc)} m</div></div>
              ) : (
                <div className="text-[11px] text-warn mt-0.5">{posErr || (typeof navigator !== 'undefined' && navigator.geolocation ? 'Mengambil lokasi…' : 'Perangkat tidak mendukung GPS.')}</div>
              )}
            </div>
            <div className="border border-border rounded-lg px-3 py-2">
              <div className="text-[9px] font-semibold tracking-wide text-text2">RADIUS KERJA</div>
              <div className="text-lg font-bold mt-0.5">{radiusM} <span className="text-xs font-normal text-text2">Meter</span></div>
            </div>
            <div className={`border rounded-lg px-3 py-2 ${within === false ? 'border-danger/40 bg-danger/10' : within ? 'border-success/40 bg-success/10' : 'border-border'}`}>
              <div className="text-[9px] font-semibold tracking-wide text-text2">JARAK SAAT INI</div>
              <div className={`text-lg font-bold mt-0.5 ${within === false ? 'text-danger' : within ? 'text-success' : ''}`}>{dist != null ? `${dist} ` : '— '}<span className="text-xs font-normal text-text2">Meter</span></div>
            </div>
            <div className="border border-border rounded-lg px-3 py-2 flex items-center justify-between">
              <div className="text-[9px] font-semibold tracking-wide text-text2">STATUS</div>
              <div className={`text-xs font-bold ${within === false ? 'text-danger' : within ? 'text-success' : 'text-text2'}`}>
                {!hasDevCoord ? 'Tanpa Koordinat' : dist == null ? 'Lokasi mati' : within ? '✅ Dalam Radius' : '⚠️ Diluar Radius'}
              </div>
            </div>
            <div className="text-[10px] text-text2 leading-relaxed">
              Arahkan kamera ke peralatan hingga tajam. Waktu, koordinat & jarak dibakar ke foto (geotag). Foto di luar radius tetap bisa disimpan tapi ditandai mencurigakan — performa bulan ini −20%.
            </div>
          </div>
        </div>
        {err && <div className="mt-2 text-[11px] text-danger">⚠️ {err}</div>}
      </div>
    </div>
  );
}
const todayKey = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const thisMonth = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; };

export default function EquipmentPerf() {
  const { user } = useAuth();
  const isManager = hasRole(user, 'admin', 'koordinator');
  const [tab, setTab] = useState<'inspeksi' | 'maintenance'>('inspeksi');

  return (
    <div>
      <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
        <div className="text-[17px] font-bold">🛠️ Performa Peralatan</div>
        <div className="flex gap-1 bg-surface2 border border-border rounded-lg p-1">
          <button className={`px-3 py-1.5 text-xs rounded-md ${tab === 'inspeksi' ? 'bg-accent text-bg font-semibold' : 'text-text2'}`} onClick={() => setTab('inspeksi')}>Inspeksi Harian</button>
          <button className={`px-3 py-1.5 text-xs rounded-md ${tab === 'maintenance' ? 'bg-accent text-bg font-semibold' : 'text-text2'}`} onClick={() => setTab('maintenance')}>Maintenance</button>
        </div>
      </div>
      {tab === 'inspeksi' && <InspeksiTab />}
      {tab === 'maintenance' && (
        <div className="space-y-6">
          {/* Maintenance Bulanan + Jendela Maintenance digabung jadi satu halaman utuh (tanpa sekat). */}
          <MaintenanceTab isManager={isManager} />
          <MaintenanceWindows embedded />
        </div>
      )}
    </div>
  );
}

// ===================== INSPEKSI HARIAN =====================
function InspeksiTab() {
  const [date, setDate] = useState(todayKey());
  const [rows, setRows] = useState<EquipmentRow[]>([]);
  const [slots, setSlots] = useState<string[]>(SLOTS);
  const [currentSlot, setCurrentSlot] = useState('09');
  const [openSlots, setOpenSlots] = useState<string[]>([]);
  const [isToday, setIsToday] = useState(true);
  const [canInput, setCanInput] = useState(false);
  const [radiusM, setRadiusM] = useState(DEFAULT_RADIUS_M); // radius kerja (Pengaturan)
  const [attended, setAttended] = useState(true); // sudah absen masuk hari ini? (default true agar tak berkedip)
  const [edit, setEdit] = useState<{ dev: EquipmentRow; slot: '09' | '12' | '15' } | null>(null);
  const [powerOn, setPowerOn] = useState<EquipmentRow | null>(null);
  const [powerOff, setPowerOff] = useState<EquipmentRow | null>(null);
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState<'semua' | 'belum' | 'sudah'>('semua');

  function load() {
    api.get(`/equipment/inspections?date=${date}`).then((res) => {
      setRows(res.data.devices);
      setSlots(res.data.slots);
      setCurrentSlot(res.data.currentSlot);
      setOpenSlots(res.data.openSlots || []);
      setIsToday(res.data.isToday);
      setCanInput(res.data.canInput);
      setRadiusM(Number(res.data.inspectRadiusM) || DEFAULT_RADIUS_M);
      setAttended(res.data.attended !== false);
    });
  }
  useEffect(load, [date]);
  const slotEditable = (s: string) => canInput && isToday && openSlots.includes(s);

  const cur = currentSlot as '09' | '12' | '15';
  const filtered = rows.filter((d) => {
    if (q.trim()) {
      const hay = `${d.name} ${d.type} ${d.ip} ${d.loc || ''}`.toLowerCase();
      if (!hay.includes(q.trim().toLowerCase())) return false;
    }
    if (filter !== 'semua') {
      const done = !!d.inspections[cur];
      if (filter === 'sudah' && !done) return false;
      if (filter === 'belum' && done) return false;
    }
    return true;
  });

  return (
    <div>
      <div className="flex items-center gap-3 mb-3 flex-wrap">
        <label className="text-xs text-text2">Tanggal
          <input type="date" className="ml-2 bg-surface2 border border-border rounded-md px-2 py-1.5 text-xs" value={date} onChange={(e) => setDate(e.target.value)} />
        </label>
        <span className="text-[11px] text-text2">Slot berjalan: <span className="text-accent font-semibold">{SLOT_LABEL[currentSlot]}</span></span>
        {canInput ? (
          <span className="text-[11px] text-success">● Anda berhak mengisi inspeksi</span>
        ) : (
          <span className="text-[11px] text-warn">● Hanya teknisi on-duty (atau koordinator/admin) yang bisa input</span>
        )}
        {!isToday && <span className="text-[11px] text-text2">🔒 Hanya hari ini yang bisa diisi (slot lampau terkunci)</span>}
      </div>
      <div className="text-[10px] text-text2 mb-3">🔒 Tiap slot hanya bisa diisi pada jamnya (09:00 → 08:30–11:00, 12:00 → 11:00–14:00, 15:00 → 14:00–17:00). Foto wajib & tidak boleh foto yang sudah pernah dipakai.</div>

      {canInput && isToday && !attended && (
        <div className="mb-3 rounded-md px-3 py-2 text-[11px] border bg-warn/10 border-warn/30 text-warn flex items-center gap-2">
          <span>⏰ Anda belum <b>absen masuk</b> hari ini. Absen masuk dulu untuk bisa <b>menghidupkan peralatan</b> — buka <b>Dashboard → Absensi</b>.</span>
        </div>
      )}

      {/* Pencarian + filter status inspeksi (mengacu slot berjalan) */}
      <div className="flex items-center gap-2 mb-3 flex-wrap">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="🔍 Cari perangkat, IP, atau lokasi…"
          className="flex-1 min-w-[200px] bg-surface2 border border-border rounded-md px-3 py-1.5 text-xs"
        />
        <div className="flex bg-surface2 border border-border rounded-lg p-0.5" title={`Status untuk slot berjalan (${SLOT_LABEL[currentSlot]})`}>
          {([['semua', 'Semua'], ['belum', 'Belum'], ['sudah', 'Sudah']] as const).map(([v, l]) => (
            <button
              key={v}
              onClick={() => setFilter(v)}
              className={`px-2.5 py-1 text-[11px] rounded ${filter === v ? 'bg-accent text-bg font-semibold' : 'text-text2'}`}
            >{l}</button>
          ))}
        </div>
        <span className="text-[10px] text-text2 w-full sm:w-auto">Menampilkan {filtered.length} dari {rows.length} perangkat · status mengacu slot {SLOT_LABEL[currentSlot]}</span>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
        {filtered.map((d) => {
          const doneCount = (slots as Array<'09' | '12' | '15'>).filter((s) => d.inspections[s]).length;
          return (
            <div key={d.id} className="bg-surface border border-border rounded-xl p-3.5 flex flex-col gap-2.5 hover:border-accent/40 transition-colors">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="font-semibold text-sm truncate" title={d.name}>{d.name}</div>
                  <div className="text-text2 text-[10px] truncate">{d.type} · {d.ip}</div>
                </div>
                <span className={`shrink-0 text-[9px] font-semibold px-1.5 py-0.5 rounded-full border ${doneCount >= slots.length ? 'text-success bg-success/10 border-success/30' : doneCount > 0 ? 'text-warn bg-warn/10 border-warn/30' : 'text-text2 border-border'}`}>{doneCount}/{slots.length}</span>
              </div>
              <div className="text-text2 text-[11px] flex items-center gap-1 truncate"><span>📍</span><span className="truncate">{d.loc || '-'}</span></div>
              <div className="grid gap-1.5 mt-auto pt-2 border-t border-border/50" style={{ gridTemplateColumns: `repeat(${slots.length}, minmax(0,1fr))` }}>
                {(slots as Array<'09' | '12' | '15'>).map((s) => {
                  const insp = d.inspections[s];
                  const editable = slotEditable(s);
                  return (
                    <div key={s} className="flex flex-col items-center gap-1">
                      <span className="text-[9px] text-text2">{SLOT_LABEL[s]}</span>
                      <button
                        disabled={!editable}
                        onClick={() => editable && setEdit({ dev: d, slot: s })}
                        title={insp ? `${insp.status} — ${insp.inspector_name || ''}${insp.note ? ' · ' + insp.note : ''}` : editable ? 'Klik untuk isi inspeksi' : 'Terkunci (di luar jam slot / bukan hari ini)'}
                        className={`w-full border rounded px-1.5 py-1 text-[10px] font-semibold ${insp ? ST_META[insp.status].bg + ' ' + ST_META[insp.status].c : 'border-border text-text2'} ${editable ? 'hover:opacity-80' : 'opacity-60 cursor-not-allowed'}`}
                      >
                        {insp ? ST_META[insp.status].t : editable ? '+ isi' : '🔒'}
                      </button>
                      {insp?.photo_url
                        ? <button type="button" title={insp.verified ? `Terverifikasi${insp.distance_m != null ? ' · ' + insp.distance_m + ' m' : ''}` : 'Belum terverifikasi (EXIF/GPS)'} onClick={(e) => { e.stopPropagation(); openImage(insp.photo_url!); }} className="text-[11px] leading-none">📷{insp.verified ? '✅' : '⚠️'}</button>
                        : <span className="h-[11px]" />}
                    </div>
                  );
                })}
              </div>

              {/* Hidupkan / Matikan peralatan — kontrol monitoring perangkat (di samping kunci slot).
                  Hidupkan (wajib foto) → monitoring mulai · Matikan → status "dimatikan" & monitoring dijeda. */}
              {d.always_on ? (
                <div className="flex items-center gap-1.5 text-[10px] text-indigo-400 border border-indigo-500/30 bg-indigo-500/10 rounded px-2 py-1.5">
                  🕒 Selalu aktif 24 jam — tidak dihidupkan/dimatikan
                </div>
              ) : (() => {
                const canPress = canInput && isToday;
                const canHidupkan = canPress && attended; // wajib sudah absen masuk dulu
                // Mematikan: cukup sudah absen masuk hari ini (boleh di luar jam dinas — alat
                // sering dimatikan di akhir hari). Koord/admin tercakup dalam `attended`.
                const canMatikan = attended && isToday;
                const isOn = d.monitor_enabled !== 0;
                const bukti = isOn ? d.poweron : d.poweroff; // bukti sesuai state terkini
                return (
                  <div className="flex flex-col gap-1.5">
                    <div className="flex items-center justify-between text-[10px]">
                      <span className={isOn ? 'text-success' : 'text-text2'}>
                        {isOn ? '🟢 Monitoring aktif' : '⚫ Dimatikan · monitoring dijeda'}
                      </span>
                      {bukti?.photo_url && (
                        <button type="button" onClick={(e) => { e.stopPropagation(); openImage(bukti.photo_url!); }}
                          title={`Bukti ${isOn ? 'dihidupkan' : 'dimatikan'} oleh ${bukti.done_by_name || '-'}${bukti.verified ? ' · terverifikasi' : ' · belum terverifikasi'}${bukti.distance_m != null ? ' · ' + bukti.distance_m + ' m' : ''}`}
                          className="leading-none">📷{bukti.verified ? '✅' : '⚠️'}</button>
                      )}
                    </div>
                    <div className="flex items-center gap-1.5">
                      <button
                        disabled={!canHidupkan || isOn}
                        onClick={() => canHidupkan && !isOn && setPowerOn(d)}
                        title={!canPress ? 'Terkunci (hanya hari ini & teknisi on-duty)' : !attended ? 'Absen masuk dulu untuk bisa menghidupkan peralatan' : isOn ? 'Peralatan sudah hidup & dimonitor' : 'Hidupkan + mulai monitoring (wajib foto dokumentasi)'}
                        className={`flex-1 border rounded px-2 py-1.5 text-[11px] font-semibold ${isOn
                          ? 'bg-success/15 border-success/40 text-success cursor-default'
                          : canHidupkan ? 'border-accent/40 text-accent hover:opacity-80' : 'border-border text-text2 opacity-60 cursor-not-allowed'}`}
                      >
                        {!canHidupkan && !isOn ? '🔒 ' : ''}⚡ {isOn ? 'Hidup' : 'Hidupkan'}
                      </button>
                      <button
                        disabled={!canMatikan || !isOn}
                        onClick={() => canMatikan && isOn && setPowerOff(d)}
                        title={!canMatikan ? 'Absen masuk dulu hari ini untuk mematikan peralatan' : !isOn ? 'Peralatan sudah dimatikan' : 'Matikan + jeda monitoring (wajib foto dokumentasi)'}
                        className={`flex-1 border rounded px-2 py-1.5 text-[11px] font-semibold ${!isOn
                          ? 'bg-surface2 border-border text-text2 cursor-default'
                          : canMatikan ? 'border-danger/40 text-danger hover:opacity-80' : 'border-border text-text2 opacity-60 cursor-not-allowed'}`}
                      >
                        ⏻ {isOn ? 'Matikan' : 'Mati'}
                      </button>
                    </div>
                  </div>
                );
              })()}
            </div>
          );
        })}
        {filtered.length === 0 && (
          <div className="col-span-full text-center py-10 text-text2 text-sm bg-surface border border-border rounded-xl">
            {rows.length === 0 ? 'Tidak ada perangkat.' : 'Tidak ada perangkat yang cocok dengan pencarian/filter.'}
          </div>
        )}
      </div>

      {edit && (
        <InspeksiModal
          date={date}
          dev={edit.dev}
          slot={edit.slot}
          radiusM={radiusM}
          existing={edit.dev.inspections[edit.slot]}
          onClose={() => setEdit(null)}
          onSaved={() => { setEdit(null); load(); }}
        />
      )}

      {powerOn && (
        <PowerOnModal
          dev={powerOn}
          radiusM={radiusM}
          existing={powerOn.poweron || undefined}
          onClose={() => setPowerOn(null)}
          onSaved={() => { setPowerOn(null); load(); }}
        />
      )}

      {powerOff && (
        <PowerOffModal
          dev={powerOff}
          radiusM={radiusM}
          existing={powerOff.poweroff || undefined}
          onClose={() => setPowerOff(null)}
          onSaved={() => { setPowerOff(null); load(); }}
        />
      )}
    </div>
  );
}

function InspeksiModal({ date, dev, slot, radiusM, existing, onClose, onSaved }: { date: string; dev: EquipmentRow; slot: '09' | '12' | '15'; radiusM: number; existing?: Inspection; onClose: () => void; onSaved: () => void }) {
  const [status, setStatus] = useState<InspectStatus>(existing?.status || 'baik');
  const [note, setNote] = useState(existing?.note || '');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const cap = usePhotoCapture([`Inspeksi ${SLOT_LABEL[slot]} · ${dev.name}`], { device: dev, radiusM });

  // Kirim ke server; `confirmSuspicious` memaksa simpan foto yang gagal verifikasi.
  function submit(confirmSuspicious: boolean) {
    const fd = new FormData();
    fd.append('deviceId', String(dev.id));
    fd.append('slot', slot);
    fd.append('status', status);
    fd.append('note', note);
    fd.append('date', date);
    fd.append('photo', cap.file as File);
    if (cap.geo) { fd.append('lat', String(cap.geo.lat)); fd.append('lng', String(cap.geo.lng)); }
    if (cap.capturedAt) fd.append('capturedAt', String(cap.capturedAt));
    if (confirmSuspicious) fd.append('confirmSuspicious', '1');
    return api.post('/equipment/inspections', fd, { headers: { 'Content-Type': 'multipart/form-data' } });
  }

  async function save() {
    if (!cap.file) return setErr('Foto wajib diambil langsung dari kamera.');
    setBusy(true); setErr('');
    try {
      let res;
      try {
        res = await submit(false);
      } catch (e: any) {
        const data = e?.response?.data;
        if (!data?.needConfirm) throw e;
        // Foto mencurigakan → konfirmasi eksplisit sebelum menyimpan (kena penalti 20%).
        const ok = await confirmDialog({
          title: 'Foto Mencurigakan',
          message: `${data.warning}\n\nApakah Anda yakin menyimpan foto ini? Foto mencurigakan yang tetap disimpan akan mengurangi skor performa Anda 20% bulan ini.`,
          confirmText: 'Ya, tetap simpan',
          cancelText: 'Batal',
          variant: 'danger',
        });
        if (!ok) return; // dibatalkan; finally mematikan status "menyimpan"
        res = await submit(true);
      }
      if (res.data?.flagged) {
        await alertDialog({ title: 'Tersimpan · Ditandai', message: `Foto disimpan namun ditandai mencurigakan:\n${res.data.warning || ''}\n\nSkor performa bulan ini dikurangi 20% & koordinator diberi tahu.`, variant: 'warning' });
      }
      onSaved();
    } catch (e: any) {
      setErr(e?.response?.data?.error || 'Gagal menyimpan.');
    } finally { setBusy(false); }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-surface border border-border rounded-xl w-full max-w-sm p-5 max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-sm font-bold mb-1">Inspeksi · {SLOT_LABEL[slot]}</h3>
        <p className="text-[11px] text-text2 mb-4">{dev.name} · {date}</p>
        <div className="flex gap-2 mb-3">
          {(['baik', 'perhatian', 'rusak'] as InspectStatus[]).map((s) => (
            <button key={s} onClick={() => setStatus(s)} className={`flex-1 border rounded-md px-2 py-2 text-xs font-semibold ${status === s ? ST_META[s].bg + ' ' + ST_META[s].c : 'border-border text-text2'}`}>{ST_META[s].t}</button>
          ))}
        </div>
        <label className="block text-[11px] text-text2 mb-1">Foto dokumentasi <span className="text-danger">*</span> <span className="text-text2">(wajib dari kamera)</span></label>
        <CameraCapture onCapture={(f) => cap.pick(f)} hasPhoto={!!cap.file} device={dev} radiusM={radiusM} />
        <GeoTagStatus cap={cap} />
        {cap.preview && <img src={cap.preview} alt="preview" className="mt-1 mb-2 max-h-40 rounded border border-border object-contain" />}
        <textarea className="w-full bg-surface2 border border-border rounded-md px-3 py-2 text-xs min-h-[60px] mb-2 mt-1" placeholder="Catatan kondisi (opsional)…" value={note} onChange={(e) => setNote(e.target.value)} />
        <div className="text-[10px] text-text2 mb-3">📷 Foto WAJIB diambil langsung dari kamera (unggah galeri dinonaktifkan). Waktu &amp; lokasi GPS dibakar ke foto. Foto yang lokasinya jauh dari perangkat / tanpa GPS dianggap <b>mencurigakan</b> — bila tetap disimpan, performa bulan ini berkurang 20%.</div>
        {err && <div className="bg-danger/10 border border-danger/30 rounded-md px-3 py-2 text-[11px] text-danger mb-3">⚠️ {err}</div>}
        <div className="flex gap-2 justify-end">
          <button className="border border-border text-text2 rounded-md px-3 py-1.5 text-xs" onClick={onClose} disabled={busy}>Batal</button>
          <button className="bg-accent text-bg rounded-md px-3 py-1.5 text-xs font-semibold disabled:opacity-50" onClick={save} disabled={busy || cap.processing}>{busy ? 'Menyimpan…' : cap.processing ? 'Memproses foto…' : 'Simpan'}</button>
        </div>
      </div>
    </div>
  );
}

// Ringkasan status geotag di modal: sedang ambil lokasi / koordinat terkunci / lokasi mati.
function GeoTagStatus({ cap }: { cap: ReturnType<typeof usePhotoCapture> }) {
  if (cap.processing) return <div className="text-[10px] text-text2 mb-1">⏳ Mengambil lokasi & membakar geotag ke foto…</div>;
  if (cap.geo) return <div className="text-[10px] text-success mb-1">📍 Geotag aktif: {cap.geo.lat.toFixed(6)}, {cap.geo.lng.toFixed(6)} (±{Math.round(cap.geo.acc)} m)</div>;
  if (cap.geoErr) return <div className="text-[10px] text-warn mb-1">⚠️ {cap.geoErr}</div>;
  return null;
}

// ===================== MENGHIDUPKAN PERALATAN =====================
// Catat "peralatan dihidupkan" untuk hari ini (1× per perangkat), wajib foto dokumentasi
// dengan verifikasi EXIF/GPS yang sama seperti inspeksi. Notifikasi otomatis ke koordinator.
function PowerOnModal({ dev, radiusM, existing, onClose, onSaved }: { dev: EquipmentRow; radiusM: number; existing?: PowerOn; onClose: () => void; onSaved: () => void }) {
  const [note, setNote] = useState(existing?.note || '');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const cap = usePhotoCapture([`Hidupkan peralatan · ${dev.name}`], { device: dev, radiusM });

  // Kirim ke server; `confirmSuspicious` memaksa simpan foto yang gagal verifikasi (penalti 20%).
  function submit(confirmSuspicious: boolean) {
    const fd = new FormData();
    fd.append('deviceId', String(dev.id));
    fd.append('note', note);
    fd.append('photo', cap.file as File);
    if (cap.geo) { fd.append('lat', String(cap.geo.lat)); fd.append('lng', String(cap.geo.lng)); }
    if (cap.capturedAt) fd.append('capturedAt', String(cap.capturedAt));
    if (confirmSuspicious) fd.append('confirmSuspicious', '1');
    return api.post('/equipment/poweron', fd, { headers: { 'Content-Type': 'multipart/form-data' } });
  }

  async function save() {
    if (!cap.file) return setErr('Foto dokumentasi wajib diambil dari kamera (bukti peralatan dihidupkan).');
    setBusy(true); setErr('');
    try {
      let res;
      try {
        res = await submit(false);
      } catch (e: any) {
        const data = e?.response?.data;
        if (!data?.needConfirm) throw e;
        const ok = await confirmDialog({
          title: 'Foto Mencurigakan',
          message: `${data.warning}\n\nApakah Anda yakin menyimpan foto ini? Foto mencurigakan (di luar radius / tanpa GPS) yang tetap disimpan akan mengurangi skor performa Anda 20% bulan ini.`,
          confirmText: 'Ya, tetap simpan', cancelText: 'Batal', variant: 'danger',
        });
        if (!ok) return;
        res = await submit(true);
      }
      if (res.data?.flagged) {
        await alertDialog({ title: 'Tersimpan · Ditandai', message: `Foto disimpan namun ditandai mencurigakan:\n${res.data.warning || ''}\n\nSkor performa bulan ini dikurangi 20% & koordinator diberi tahu.`, variant: 'warning' });
      }
      onSaved();
    } catch (e: any) {
      setErr(e?.response?.data?.error || 'Gagal menyimpan.');
    } finally { setBusy(false); }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-surface border border-border rounded-xl w-full max-w-sm p-5 max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-sm font-bold mb-1">⚡ Hidupkan Peralatan</h3>
        <p className="text-[11px] text-text2 mb-4">{dev.name} · {dev.type} · {dev.ip}</p>
        {existing && <div className="bg-success/10 border border-success/30 rounded-md px-3 py-2 text-[11px] text-success mb-3">Sudah tercatat dihidupkan hari ini oleh {existing.done_by_name || '-'}. Mengunggah foto baru akan memperbarui catatan.</div>}
        <label className="block text-[11px] text-text2 mb-1">Foto dokumentasi <span className="text-danger">*</span> <span className="text-text2">(wajib dari kamera)</span></label>
        <CameraCapture onCapture={(f) => cap.pick(f)} hasPhoto={!!cap.file} device={dev} radiusM={radiusM} />
        <GeoTagStatus cap={cap} />
        {cap.preview && <img src={cap.preview} alt="preview" className="mt-1 mb-2 max-h-40 rounded border border-border object-contain" />}
        <textarea className="w-full bg-surface2 border border-border rounded-md px-3 py-2 text-xs min-h-[60px] mb-2 mt-1" placeholder="Catatan (opsional)…" value={note} onChange={(e) => setNote(e.target.value)} />
        <div className="text-[10px] text-text2 mb-3">📷 Ambil foto langsung dari kamera hingga tajam. Waktu & lokasi GPS dibakar ke foto (geotag). Foto di luar radius / tanpa GPS dianggap <b>mencurigakan</b> — bila tetap disimpan, performa bulan ini berkurang 20%.</div>
        {err && <div className="bg-danger/10 border border-danger/30 rounded-md px-3 py-2 text-[11px] text-danger mb-3">⚠️ {err}</div>}
        <div className="flex gap-2 justify-end">
          <button className="border border-border text-text2 rounded-md px-3 py-1.5 text-xs" onClick={onClose} disabled={busy}>Batal</button>
          <button className="bg-accent text-bg rounded-md px-3 py-1.5 text-xs font-semibold disabled:opacity-50" onClick={save} disabled={busy || cap.processing}>{busy ? 'Menyimpan…' : cap.processing ? 'Memproses foto…' : 'Simpan'}</button>
        </div>
      </div>
    </div>
  );
}

// Matikan peralatan: WAJIB foto dokumentasi (geotag/verifikasi sama seperti Hidupkan).
// Menandai perangkat "dimatikan" & menjeda monitoring otomatis. Notifikasi ke koordinator.
function PowerOffModal({ dev, radiusM, existing, onClose, onSaved }: { dev: EquipmentRow; radiusM: number; existing?: PowerOn; onClose: () => void; onSaved: () => void }) {
  const [note, setNote] = useState(existing?.note || '');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const cap = usePhotoCapture([`Matikan peralatan · ${dev.name}`], { device: dev, radiusM });

  // Kirim ke server; `confirmSuspicious` memaksa simpan foto yang gagal verifikasi (penalti 20%).
  function submit(confirmSuspicious: boolean) {
    const fd = new FormData();
    fd.append('deviceId', String(dev.id));
    fd.append('note', note);
    fd.append('photo', cap.file as File);
    if (cap.geo) { fd.append('lat', String(cap.geo.lat)); fd.append('lng', String(cap.geo.lng)); }
    if (cap.capturedAt) fd.append('capturedAt', String(cap.capturedAt));
    if (confirmSuspicious) fd.append('confirmSuspicious', '1');
    return api.post('/equipment/poweroff', fd, { headers: { 'Content-Type': 'multipart/form-data' } });
  }

  async function save() {
    if (!cap.file) return setErr('Foto dokumentasi wajib diambil dari kamera (bukti peralatan dimatikan).');
    setBusy(true); setErr('');
    try {
      let res;
      try {
        res = await submit(false);
      } catch (e: any) {
        const data = e?.response?.data;
        if (!data?.needConfirm) throw e;
        const ok = await confirmDialog({
          title: 'Foto Mencurigakan',
          message: `${data.warning}\n\nApakah Anda yakin menyimpan foto ini? Foto mencurigakan (di luar radius / tanpa GPS) yang tetap disimpan akan mengurangi skor performa Anda 20% bulan ini.`,
          confirmText: 'Ya, tetap simpan', cancelText: 'Batal', variant: 'danger',
        });
        if (!ok) return;
        res = await submit(true);
      }
      if (res.data?.flagged) {
        await alertDialog({ title: 'Tersimpan · Ditandai', message: `Foto disimpan namun ditandai mencurigakan:\n${res.data.warning || ''}\n\nSkor performa bulan ini dikurangi 20% & koordinator diberi tahu.`, variant: 'warning' });
      }
      onSaved();
    } catch (e: any) {
      setErr(e?.response?.data?.error || 'Gagal menyimpan.');
    } finally { setBusy(false); }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-surface border border-border rounded-xl w-full max-w-sm p-5 max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-sm font-bold mb-1">⏻ Matikan Peralatan</h3>
        <p className="text-[11px] text-text2 mb-3">{dev.name} · {dev.type} · {dev.ip}</p>
        <div className="bg-warn/10 border border-warn/30 rounded-md px-3 py-2 text-[11px] text-warn mb-3">Perangkat ditandai "dimatikan": status offline tanpa alarm, monitoring otomatis (ping/insiden) dijeda sampai dihidupkan kembali.</div>
        {existing && <div className="bg-surface2 border border-border rounded-md px-3 py-2 text-[11px] text-text2 mb-3">Sudah tercatat dimatikan hari ini oleh {existing.done_by_name || '-'}. Mengunggah foto baru akan memperbarui catatan.</div>}
        <label className="block text-[11px] text-text2 mb-1">Foto dokumentasi <span className="text-danger">*</span> <span className="text-text2">(wajib dari kamera)</span></label>
        <CameraCapture onCapture={(f) => cap.pick(f)} hasPhoto={!!cap.file} device={dev} radiusM={radiusM} />
        <GeoTagStatus cap={cap} />
        {cap.preview && <img src={cap.preview} alt="preview" className="mt-1 mb-2 max-h-40 rounded border border-border object-contain" />}
        <textarea className="w-full bg-surface2 border border-border rounded-md px-3 py-2 text-xs min-h-[60px] mb-2 mt-1" placeholder="Catatan (opsional)…" value={note} onChange={(e) => setNote(e.target.value)} />
        <div className="text-[10px] text-text2 mb-3">📷 Ambil foto langsung dari kamera hingga tajam. Waktu & lokasi GPS dibakar ke foto (geotag). Foto di luar radius / tanpa GPS dianggap <b>mencurigakan</b> — bila tetap disimpan, performa bulan ini berkurang 20%.</div>
        {err && <div className="bg-danger/10 border border-danger/30 rounded-md px-3 py-2 text-[11px] text-danger mb-3">⚠️ {err}</div>}
        <div className="flex gap-2 justify-end">
          <button className="border border-border text-text2 rounded-md px-3 py-1.5 text-xs" onClick={onClose} disabled={busy}>Batal</button>
          <button className="bg-danger text-bg rounded-md px-3 py-1.5 text-xs font-semibold disabled:opacity-50" onClick={save} disabled={busy || cap.processing}>{busy ? 'Menyimpan…' : cap.processing ? 'Memproses foto…' : '⏻ Matikan'}</button>
        </div>
      </div>
    </div>
  );
}

// ===================== MAINTENANCE BULANAN =====================
function MaintenanceTab({ isManager }: { isManager: boolean }) {
  const [month, setMonth] = useState(thisMonth());
  const [rows, setRows] = useState<MaintenanceRow[]>([]);
  const [devices, setDevices] = useState<Device[]>([]);
  const [showAdd, setShowAdd] = useState(false);
  const [photoModalFor, setPhotoModalFor] = useState<MaintenanceRow | null>(null);
  const [msg, setMsg] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  function load() {
    api.get(`/equipment/maintenance?month=${month}`).then((res) => setRows(res.data.maintenance));
  }
  useEffect(load, [month]);
  useEffect(() => { api.get('/devices').then((res) => setDevices(res.data.devices)); }, []);

  async function setStatus(id: number, status: string) {
    await api.put(`/equipment/maintenance/${id}`, { status });
    load();
  }
  async function remove(id: number) {
    if (!(await confirmDialog({ title: 'Hapus rencana maintenance', message: 'Rencana maintenance ini akan dihapus.', confirmText: '🗑️ Hapus', variant: 'danger' }))) return;
    await api.delete(`/equipment/maintenance/${id}`);
    load();
  }
  async function downloadTemplate() {
    const res = await api.get('/equipment/maintenance/template', { responseType: 'blob' });
    const url = URL.createObjectURL(res.data);
    const a = document.createElement('a');
    a.href = url; a.download = 'template-maintenance.xlsx'; a.click();
    URL.revokeObjectURL(url);
  }
  async function importFile(file: File) {
    setMsg('Mengimpor…');
    try {
      const fd = new FormData();
      fd.append('file', file);
      const res = await api.post('/equipment/maintenance/import', fd, { headers: { 'Content-Type': 'multipart/form-data' } });
      const { inserted, errors } = res.data;
      setMsg(`✓ ${inserted} baris diimpor.${errors?.length ? ` ${errors.length} dilewati.` : ''}`);
      if (errors?.length) console.warn('Import errors:', errors);
      load();
    } catch (e: any) {
      setMsg(e?.response?.data?.error || 'Gagal mengimpor.');
    } finally {
      setTimeout(() => setMsg(''), 6000);
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  const stMeta: Record<string, string> = { rencana: 'text-accent2 border-accent2/40 bg-accent2/10', selesai: 'text-success border-success/40 bg-success/10', batal: 'text-text2 border-border' };

  return (
    <div>
      <div className="flex items-center gap-3 mb-3 flex-wrap">
        <label className="text-xs text-text2">Bulan
          <input type="month" className="ml-2 bg-surface2 border border-border rounded-md px-2 py-1.5 text-xs" value={month} onChange={(e) => setMonth(e.target.value)} />
        </label>
        {isManager && (
          <div className="flex gap-2 ml-auto flex-wrap">
            <button onClick={() => setShowAdd(true)} className="bg-accent text-bg rounded-md px-3 py-1.5 text-xs font-semibold">+ Tambah</button>
            <button onClick={downloadTemplate} className="border border-border text-text2 rounded-md px-3 py-1.5 text-xs hover:text-text">⬇️ Template Excel</button>
            <button onClick={() => fileRef.current?.click()} className="border border-accent2/40 text-accent2 rounded-md px-3 py-1.5 text-xs font-semibold">⬆️ Import Excel</button>
            <input ref={fileRef} type="file" accept=".xlsx,.xls" className="hidden" onChange={(e) => e.target.files?.[0] && importFile(e.target.files[0])} />
          </div>
        )}
      </div>
      {msg && <div className="bg-accent2/10 border border-accent2/30 rounded-md px-3 py-2 text-[11px] text-accent2 mb-3">{msg}</div>}

      {rows.length === 0 ? (
        <div className="bg-surface border border-border rounded-xl text-center py-10 text-text2 text-sm">Belum ada rencana maintenance bulan ini.</div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
          {rows.map((m) => (
            <div key={m.id} className="bg-surface border border-border rounded-xl p-3.5 flex flex-col gap-2.5 hover:border-accent/40 transition-colors">
              {/* Header: perangkat + status */}
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="font-semibold text-sm truncate" title={m.device_name}>{m.device_name}</div>
                  <div className="text-text2 text-[10px] truncate">{m.device_type}</div>
                </div>
                <span className={`shrink-0 text-[10px] px-2 py-0.5 rounded border font-semibold capitalize ${stMeta[m.status]}`}>{m.status}</span>
              </div>

              {/* Tanggal */}
              <div className="text-text2 text-[11px] flex items-center gap-1"><span>📅</span><span className="font-mono">{m.scheduled_date}</span></div>

              {/* Tugas */}
              <div className="text-[11px]">
                <div>{m.task}</div>
                {m.note && <div className="text-text2 text-[10px] mt-0.5">{m.note}</div>}
                <button onClick={() => setPhotoModalFor(m)} className="block text-accent2 text-[10px] hover:underline mt-1">📷 {m.photo_count || 0} foto dokumentasi{m.doc_url ? ' + lampiran' : ''}</button>
              </div>

              {/* Pelaksana */}
              <div className="text-text2 text-[10px] pt-2 border-t border-border/50">
                Pelaksana: <span className="text-text">{m.done_by_name || '-'}</span>
                {m.done_at && <span className="font-mono"> · {m.done_at}</span>}
              </div>

              {/* Aksi */}
              <div className="flex gap-1.5 flex-wrap text-[11px] mt-auto">
                {m.status !== 'selesai' && <button onClick={() => setPhotoModalFor(m)} className="border border-success/40 text-success rounded px-2 py-1">✅ Selesai</button>}
                {m.status !== 'rencana' && <button onClick={() => setStatus(m.id, 'rencana')} className="border border-border text-text2 rounded px-2 py-1">↺ Rencana</button>}
                {isManager && <button onClick={() => remove(m.id)} className="border border-danger/40 text-danger rounded px-2 py-1">🗑️</button>}
              </div>
            </div>
          ))}
        </div>
      )}

      {showAdd && <AddMaintenanceModal devices={devices} onClose={() => setShowAdd(false)} onSaved={() => { setShowAdd(false); load(); }} />}
      {photoModalFor && <MaintenancePhotosModal item={photoModalFor} onClose={() => { setPhotoModalFor(null); load(); }} onCompleted={(n) => { setPhotoModalFor(null); setMsg(`✅ Maintenance selesai. Notifikasi terkirim ke ${n} koordinator.`); setTimeout(() => setMsg(''), 6000); load(); }} />}
    </div>
  );
}

function AddMaintenanceModal({ devices, onClose, onSaved }: { devices: Device[]; onClose: () => void; onSaved: () => void }) {
  const [deviceIds, setDeviceIds] = useState<number[]>([]);
  const [q, setQ] = useState('');
  const [scheduledDate, setScheduledDate] = useState(todayKey());
  const [task, setTask] = useState('');
  const [note, setNote] = useState('');
  const [doc, setDoc] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  async function save() {
    if (deviceIds.length === 0 || !task.trim()) return setErr('Pilih minimal satu perangkat dan isi tugas.');
    setBusy(true); setErr('');
    try {
      // Geotag dokumentasi (bila gambar) — stamp sekali, dipakai untuk semua perangkat.
      const stampedDoc = doc ? (await stampFiles([doc], ['Rencana Maintenance']))[0] : null;
      // Satu rencana maintenance dibuat untuk tiap perangkat yang dipilih.
      for (const id of deviceIds) {
        const fd = new FormData();
        fd.append('deviceId', String(id));
        fd.append('scheduledDate', scheduledDate);
        fd.append('task', task.trim());
        if (note.trim()) fd.append('note', note.trim());
        if (stampedDoc) fd.append('doc', stampedDoc);
        await api.post('/equipment/maintenance', fd, { headers: { 'Content-Type': 'multipart/form-data' } });
      }
      onSaved();
    } catch (e: any) {
      setErr(e?.response?.data?.error || 'Gagal menyimpan.');
    } finally { setBusy(false); }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-surface border border-border rounded-xl w-full max-w-md p-5 max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-sm font-bold mb-4">+ Rencana Maintenance</h3>
        <label className="block text-[11px] text-text2 mb-1">Perangkat * <span className="text-text2">({deviceIds.length} dipilih)</span></label>
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="🔍 Cari perangkat…"
          className="w-full bg-surface2 border border-border rounded-md px-3 py-1.5 text-xs mb-1.5"
        />
        {(() => {
          const filtered = devices.filter((d) => { const t = `${d.name} ${d.ip}`.toLowerCase(); return !q.trim() || t.includes(q.trim().toLowerCase()); });
          const allSel = filtered.length > 0 && filtered.every((d) => deviceIds.includes(d.id));
          return (
            <>
              <div className="flex items-center justify-between mb-1">
                <button
                  type="button"
                  onClick={() => setDeviceIds(allSel
                    ? deviceIds.filter((id) => !filtered.some((d) => d.id === id))
                    : Array.from(new Set([...deviceIds, ...filtered.map((d) => d.id)])))}
                  className="text-[10px] text-accent2 hover:underline"
                >{allSel ? '✕ Hapus pilihan (hasil cari)' : '✓ Pilih semua (hasil cari)'}</button>
                {deviceIds.length > 0 && <button type="button" onClick={() => setDeviceIds([])} className="text-[10px] text-danger hover:underline">Kosongkan</button>}
              </div>
              <div className="max-h-40 overflow-y-auto border border-border rounded-md mb-3 divide-y divide-border/50">
                {filtered.length === 0 ? (
                  <div className="text-center text-text2 text-[11px] py-4">Tidak ada perangkat cocok.</div>
                ) : filtered.map((d) => {
                  const checked = deviceIds.includes(d.id);
                  return (
                    <label key={d.id} className="flex items-center gap-2 px-2.5 py-1.5 text-xs cursor-pointer hover:bg-surface2">
                      <input type="checkbox" checked={checked} onChange={() => setDeviceIds((ids) => checked ? ids.filter((x) => x !== d.id) : [...ids, d.id])} className="accent-[var(--color-accent)]" />
                      <span className="truncate">{d.name} <span className="text-text2 font-mono text-[10px]">{d.ip}</span></span>
                    </label>
                  );
                })}
              </div>
            </>
          );
        })()}
        <label className="block text-[11px] text-text2 mb-1">Tanggal *</label>
        <input type="date" className="w-full bg-surface2 border border-border rounded-md px-3 py-2 text-xs mb-3" value={scheduledDate} onChange={(e) => setScheduledDate(e.target.value)} />
        <label className="block text-[11px] text-text2 mb-1">Tugas *</label>
        <input className="w-full bg-surface2 border border-border rounded-md px-3 py-2 text-xs mb-3" placeholder="Pembersihan, cek kondisi…" value={task} onChange={(e) => setTask(e.target.value)} />
        <label className="block text-[11px] text-text2 mb-1">Catatan</label>
        <input className="w-full bg-surface2 border border-border rounded-md px-3 py-2 text-xs mb-3" value={note} onChange={(e) => setNote(e.target.value)} />
        <label className="block text-[11px] text-text2 mb-1">📎 Dokumentasi (foto/PDF — bisa langsung dari kamera)</label>
        <input type="file" accept="image/*,application/pdf" capture="environment" onChange={(e) => setDoc(e.target.files?.[0] || null)}
          className="w-full text-[11px] text-text2 mb-2 file:mr-2 file:py-1.5 file:px-3 file:rounded-md file:border-0 file:text-xs file:bg-surface2 file:text-text file:cursor-pointer" />
        {doc && <div className="text-[10px] text-accent2 mb-3 flex items-center gap-1.5">{doc.type.startsWith('image') ? '🖼️' : '📄'} {doc.name}<button type="button" onClick={() => setDoc(null)} className="text-danger">✕</button></div>}
        {err && <div className="bg-danger/10 border border-danger/30 rounded-md px-3 py-2 text-[11px] text-danger mb-3">⚠️ {err}</div>}
        <div className="flex gap-2 justify-end">
          <button className="border border-border text-text2 rounded-md px-3 py-1.5 text-xs" onClick={onClose} disabled={busy}>Batal</button>
          <button className="bg-accent text-bg rounded-md px-3 py-1.5 text-xs font-semibold disabled:opacity-50" onClick={save} disabled={busy}>{busy ? 'Menyimpan…' : 'Simpan'}</button>
        </div>
      </div>
    </div>
  );
}
