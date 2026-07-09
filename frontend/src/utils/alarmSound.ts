// Alarm suara sintetis via Web Audio API — tanpa berkas aset (mp3/wav). Dipakai Command
// Center / Wallboard NOC untuk membunyikan alarm saat ada gangguan (perangkat down).
// Karena kebijakan autoplay browser, AudioContext harus di-"unlock" oleh interaksi user
// (klik/tekan) minimal sekali sebelum bisa berbunyi.

let ctx: AudioContext | null = null;

function getCtx(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  if (!ctx) {
    const AC = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return null;
    try { ctx = new AC(); } catch { return null; }
  }
  return ctx;
}

// Izinkan suara — panggil pada interaksi user (klik). Aman dipanggil berkali-kali.
export function unlockAudio(): void {
  const c = getCtx();
  if (c && c.state === 'suspended') c.resume().catch(() => {});
}

// Apakah audio siap berbunyi (context sudah running / ter-unlock).
export function audioReady(): boolean {
  return !!ctx && ctx.state === 'running';
}

// Satu nada (frekuensi, mulai, durasi) dengan envelope agar mulus — tanpa bunyi "klik".
function tone(c: AudioContext, freq: number, start: number, dur: number, gain: number, type: OscillatorType) {
  const osc = c.createOscillator();
  const g = c.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, start);
  g.gain.setValueAtTime(0.0001, start);
  g.gain.exponentialRampToValueAtTime(gain, start + 0.012);
  g.gain.setValueAtTime(gain, Math.max(start + 0.013, start + dur - 0.03));
  g.gain.exponentialRampToValueAtTime(0.0001, start + dur);
  osc.connect(g).connect(c.destination);
  osc.start(start);
  osc.stop(start + dur + 0.02);
}

// Bunyikan alarm sesuai tingkat: 'critical' (perangkat down) = sirene dua-nada mendesak;
// 'warning' = dua nada lembut. No-op bila audio belum ter-unlock.
export function playAlarm(severity: 'critical' | 'warning' = 'critical'): void {
  const c = getCtx();
  if (!c || c.state !== 'running') return;
  const t0 = c.currentTime + 0.03;
  if (severity === 'warning') {
    tone(c, 700, t0, 0.16, 0.14, 'sine');
    tone(c, 700, t0 + 0.24, 0.16, 0.14, 'sine');
    return;
  }
  // critical: sirene hi-lo berselang 4 siklus (~1,7 dtk) — khas peringatan.
  const HI = 988, LO = 741, seg = 0.16, gap = 0.04;
  let t = t0;
  for (let i = 0; i < 4; i++) {
    tone(c, HI, t, seg, 0.22, 'square'); t += seg + gap;
    tone(c, LO, t, seg, 0.22, 'square'); t += seg + gap;
  }
}

// Nada konfirmasi singkat & enak saat alarm diaktifkan (biar user tahu suara hidup).
export function playTestBeep(): void {
  const c = getCtx();
  if (!c || c.state !== 'running') return;
  const t0 = c.currentTime + 0.03;
  tone(c, 880, t0, 0.12, 0.16, 'sine');
  tone(c, 1175, t0 + 0.14, 0.16, 0.16, 'sine');
}
