import { useEffect, useState } from 'react';

// Lightbox gambar global (satu instance di AppLayout). Panggil openImage(url) dari mana saja
// untuk menampilkan gambar penuh layar dengan tombol "← Kembali" di dalam gambar.
let opener: ((src: string) => void) | null = null;

/** Buka gambar penuh layar. Pakai di onClick foto mana pun. */
export function openImage(src: string) {
  if (src) opener?.(src);
}

export default function ImageLightbox() {
  const [src, setSrc] = useState<string | null>(null);

  useEffect(() => { opener = setSrc; return () => { opener = null; }; }, []);

  useEffect(() => {
    if (!src) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setSrc(null); };
    window.addEventListener('keydown', onKey);
    // Cegah scroll latar saat lightbox terbuka.
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { window.removeEventListener('keydown', onKey); document.body.style.overflow = prev; };
  }, [src]);

  if (!src) return null;
  const close = () => setSrc(null);
  return (
    <div className="fixed inset-0 z-[100] bg-black/90 flex items-center justify-center p-4" onClick={close}>
      {/* Tombol Kembali — di dalam tampilan gambar (pojok kiri atas) */}
      <button
        onClick={(e) => { e.stopPropagation(); close(); }}
        className="fixed top-4 left-4 z-[101] flex items-center gap-1.5 bg-white/15 hover:bg-white/25 text-white rounded-lg px-3 py-2 text-sm font-semibold backdrop-blur"
      >← Kembali</button>
      {/* Tutup (×) di pojok kanan atas */}
      <button
        onClick={(e) => { e.stopPropagation(); close(); }}
        aria-label="Tutup"
        className="fixed top-4 right-4 z-[101] w-9 h-9 flex items-center justify-center bg-white/15 hover:bg-white/25 text-white rounded-full text-xl leading-none backdrop-blur"
      >×</button>
      <img src={src} alt="Pratinjau" className="max-w-full max-h-full object-contain rounded-lg" onClick={(e) => e.stopPropagation()} />
    </div>
  );
}
