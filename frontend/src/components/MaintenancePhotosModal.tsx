import { useEffect, useRef, useState } from 'react';
import { api } from '../api/client';
import type { MaintenanceRow } from '../types';

interface MPhoto {
  id: number;
  url: string;
  caption: string | null;
  created_at: string;
  uploaded_by_name: string | null;
}

/**
 * Modal dokumentasi maintenance dengan upload BANYAK foto.
 * - Pilih banyak file sekaligus atau jepret dari kamera (auto-unggah).
 * - Galeri thumbnail + hapus per foto + lightbox.
 * - Tombol "Selesai" aktif hanya bila ada minimal 1 foto (bebas jumlah).
 */
export default function MaintenancePhotosModal({ item, onClose, onCompleted }: {
  item: MaintenanceRow;
  onClose: () => void;
  onCompleted: (notified: number) => void;
}) {
  const [photos, setPhotos] = useState<MPhoto[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [note, setNote] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [lightbox, setLightbox] = useState<string | null>(null);
  const pickRef = useRef<HTMLInputElement>(null);
  const camRef = useRef<HTMLInputElement>(null);
  const done = item.status === 'selesai';

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function load() {
    setLoading(true);
    try { const r = await api.get(`/equipment/maintenance/${item.id}/photos`); setPhotos(r.data.photos); }
    catch { /* abaikan */ } finally { setLoading(false); }
  }

  async function addFiles(files: FileList | null) {
    if (!files || !files.length) return;
    setErr(''); setUploading(true);
    try {
      const fd = new FormData();
      Array.from(files).forEach((f) => fd.append('photos', f));
      const r = await api.post(`/equipment/maintenance/${item.id}/photos`, fd, { headers: { 'Content-Type': 'multipart/form-data' } });
      setPhotos(r.data.photos);
    } catch (e: any) {
      setErr(e?.response?.data?.error || 'Gagal mengunggah foto. Pastikan format gambar/PDF & maksimal 10 MB.');
    } finally {
      setUploading(false);
      if (pickRef.current) pickRef.current.value = '';
      if (camRef.current) camRef.current.value = '';
    }
  }

  async function removePhoto(id: number) {
    setPhotos((p) => p.filter((x) => x.id !== id));
    try { await api.delete(`/equipment/maintenance/photos/${id}`); } catch { load(); }
  }

  async function complete() {
    if (!photos.length) { setErr('Unggah minimal 1 foto dokumentasi sebelum menyelesaikan.'); return; }
    setBusy(true); setErr('');
    try {
      const fd = new FormData();
      fd.append('status', 'selesai');
      if (note.trim()) fd.append('note', note.trim());
      const r = await api.put(`/equipment/maintenance/${item.id}`, fd, { headers: { 'Content-Type': 'multipart/form-data' } });
      onCompleted(r.data.notified ?? 0);
    } catch (e: any) {
      setErr(e?.response?.data?.error || 'Gagal menyelesaikan maintenance.');
      setBusy(false);
    }
  }

  const isPdf = (u: string) => /\.pdf$/i.test(u);

  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-surface border border-border rounded-xl w-full max-w-lg p-5 max-h-[92vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between mb-1">
          <h3 className="text-sm font-bold">{done ? '📸 Dokumentasi Maintenance' : '✅ Selesaikan Maintenance'}</h3>
          <button onClick={onClose} className="text-text2 hover:text-text text-lg leading-none">×</button>
        </div>
        <div className="text-[11px] text-text2 mb-3">{item.device_name} · {item.task}
          {done && <span className="ml-2 text-success font-semibold">· sudah selesai</span>}
        </div>

        {/* Zona unggah */}
        <div className="border border-dashed border-border rounded-lg p-3 mb-3 bg-surface2/40">
          <div className="text-[11px] text-text2 mb-2">📷 Unggah dokumentasi kegiatan — bisa pilih <b>banyak foto sekaligus</b> atau jepret langsung dari kamera.</div>
          <div className="flex gap-2 flex-wrap">
            <button type="button" onClick={() => pickRef.current?.click()} disabled={uploading}
              className="border border-accent2/40 text-accent2 rounded-md px-3 py-1.5 text-xs font-semibold hover:bg-accent2/10 disabled:opacity-50">
              🖼️ Pilih Foto (banyak)
            </button>
            <button type="button" onClick={() => camRef.current?.click()} disabled={uploading}
              className="border border-accent/40 text-accent rounded-md px-3 py-1.5 text-xs font-semibold hover:bg-accent/10 disabled:opacity-50">
              📸 Kamera
            </button>
            {uploading && <span className="text-[11px] text-text2 self-center flex items-center gap-1.5"><span className="inline-block w-3.5 h-3.5 border-2 border-text2/40 border-t-accent rounded-full animate-spin" /> Mengunggah…</span>}
          </div>
          <input ref={pickRef} type="file" accept="image/*,application/pdf" multiple className="hidden" onChange={(e) => addFiles(e.target.files)} />
          <input ref={camRef} type="file" accept="image/*" capture="environment" multiple className="hidden" onChange={(e) => addFiles(e.target.files)} />
        </div>

        {/* Galeri */}
        <div className="flex items-center justify-between mb-2">
          <div className="text-[11px] font-semibold">Foto terunggah <span className="text-text2">({photos.length})</span></div>
        </div>
        {loading ? (
          <div className="text-center text-text2 text-[11px] py-6">Memuat foto…</div>
        ) : photos.length === 0 ? (
          <div className="text-center text-text2 text-[11px] py-6 border border-dashed border-border rounded-lg mb-3">Belum ada foto. Unggah dokumentasi di atas.</div>
        ) : (
          <div className="grid grid-cols-3 sm:grid-cols-4 gap-2 mb-3">
            {photos.map((p) => (
              <div key={p.id} className="group relative aspect-square rounded-lg overflow-hidden border border-border bg-surface2">
                {isPdf(p.url) ? (
                  <a href={p.url} target="_blank" rel="noreferrer" className="w-full h-full flex flex-col items-center justify-center text-text2 text-[10px] gap-1"><span className="text-2xl">📄</span>PDF</a>
                ) : (
                  <img src={p.url} alt={p.caption || 'Dokumentasi'} loading="lazy" onClick={() => setLightbox(p.url)}
                    className="w-full h-full object-cover cursor-zoom-in transition group-hover:brightness-75" />
                )}
                <button title="Hapus foto" onClick={() => removePhoto(p.id)}
                  className="absolute top-1 right-1 w-5 h-5 rounded-full bg-black/60 text-white text-xs flex items-center justify-center opacity-0 group-hover:opacity-100 transition hover:bg-danger">×</button>
              </div>
            ))}
          </div>
        )}

        {!done && (
          <>
            <label className="block text-[11px] text-text2 mb-1">Catatan Hasil (opsional)</label>
            <input className="w-full bg-surface2 border border-border rounded-md px-3 py-2 text-xs mb-3" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Kondisi setelah maintenance…" />
            <div className="text-[10px] text-text2 mb-3">ℹ️ Setelah selesai, notifikasi WhatsApp otomatis dikirim ke koordinator.</div>
          </>
        )}

        {err && <div className="bg-danger/10 border border-danger/30 rounded-md px-3 py-2 text-[11px] text-danger mb-3">⚠️ {err}</div>}

        <div className="flex gap-2 justify-end">
          <button className="border border-border text-text2 rounded-md px-3 py-1.5 text-xs" onClick={onClose} disabled={busy}>{done ? 'Tutup' : 'Batal'}</button>
          {!done && (
            <button className="bg-success text-bg rounded-md px-3 py-1.5 text-xs font-semibold disabled:opacity-50"
              onClick={complete} disabled={busy || uploading || photos.length === 0}
              title={photos.length === 0 ? 'Unggah minimal 1 foto dulu' : undefined}>
              {busy ? 'Menyimpan…' : '✅ Selesai & Kirim Notifikasi'}
            </button>
          )}
        </div>
      </div>

      {/* Lightbox */}
      {lightbox && (
        <div className="fixed inset-0 z-[60] bg-black/85 flex items-center justify-center p-6" onClick={(e) => { e.stopPropagation(); setLightbox(null); }}>
          <img src={lightbox} alt="Dokumentasi" className="max-w-full max-h-full rounded-lg object-contain" />
          <button onClick={(e) => { e.stopPropagation(); setLightbox(null); }} className="absolute top-4 right-5 text-white text-3xl leading-none">×</button>
        </div>
      )}
    </div>
  );
}
