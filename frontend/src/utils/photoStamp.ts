// Utilitas geotag foto dokumentasi: ambil lokasi GPS aktif lalu "bakar" waktu tangkap
// + koordinat (+ konteks) ke foto lewat kanvas. Dipakai di SEMUA titik dokumentasi kamera
// (insiden, inspeksi, hidupkan/matikan peralatan, maintenance, kegiatan, absensi, dll)
// agar bukti tetap membawa lokasi & jam walau browser membuang metadata EXIF.

export interface GeoPoint { lat: number; lng: number; acc: number }

// Geolokasi browser (aktif, high-accuracy). null bila tidak tersedia / ditolak.
export function getGeo(): Promise<GeoPoint | null> {
  return new Promise((resolve) => {
    if (!navigator.geolocation) return resolve(null);
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude, acc: p.coords.accuracy }),
      () => resolve(null),
      { enableHighAccuracy: true, timeout: 8000 }
    );
  });
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

// Bakar geotag (waktu tangkap + koordinat + konteks) ke satu foto. Waktu diambil dari
// file.lastModified (waktu tangkap kamera) sehingga jujur untuk foto lama. Non-gambar
// dikembalikan apa adanya. Bila proses gagal, file asli dikembalikan.
export async function stampPhoto(file: File, geo: GeoPoint | null, extraLines: string[] = []): Promise<File> {
  if (!file.type.startsWith('image/')) return file;
  try {
    const url = URL.createObjectURL(file);
    const img = await loadImage(url);
    URL.revokeObjectURL(url);
    const maxW = 1280;
    const scale = img.width > maxW ? maxW / img.width : 1;
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(img.width * scale);
    canvas.height = Math.round(img.height * scale);
    const ctx = canvas.getContext('2d');
    if (!ctx) return file;
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

    const when = new Date(file.lastModified || Date.now());
    const lines = [
      `🕒 ${when.toLocaleString('id-ID')}`,
      geo ? `📍 ${geo.lat.toFixed(6)}, ${geo.lng.toFixed(6)} (±${Math.round(geo.acc)}m)` : '📍 Lokasi tidak terdeteksi',
      ...extraLines,
    ].filter(Boolean);
    const fs = Math.max(13, Math.round(canvas.width * 0.030));
    const pad = Math.round(fs * 0.7);
    const lineH = Math.round(fs * 1.35);
    const boxH = lineH * lines.length + pad * 2;
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.fillRect(0, canvas.height - boxH, canvas.width, boxH);
    ctx.fillStyle = '#fff';
    ctx.textBaseline = 'top';
    ctx.font = `${fs}px system-ui, sans-serif`;
    lines.forEach((l, i) => ctx.fillText(l, pad, canvas.height - boxH + pad + i * lineH));

    const blob: Blob | null = await new Promise((r) => canvas.toBlob((b) => r(b), 'image/jpeg', 0.9));
    if (!blob) return file;
    return new File([blob], (file.name.replace(/\.[^.]+$/, '') || 'foto') + '-geo.jpg', { type: 'image/jpeg', lastModified: file.lastModified || Date.now() });
  } catch {
    return file; // bila stamping gagal, unggah file asli
  }
}

// Ambil lokasi sekali lalu bakar geotag ke banyak file (gambar saja; lainnya dilewati).
// Cocok untuk input multi-file kamera. Mengembalikan array File terurut.
export async function stampFiles(files: File[] | FileList, extraLines: string[] = []): Promise<File[]> {
  const arr = Array.from(files);
  if (!arr.length) return arr;
  const geo = await getGeo();
  return Promise.all(arr.map((f) => stampPhoto(f, geo, extraLines)));
}
