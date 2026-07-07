import { useState } from 'react';
import { api } from '../api/client';
import { stampFiles } from '../utils/photoStamp';
import type { Activity } from '../types';

const TYPE_LABEL: Record<string, string> = { rapat: 'Rapat', 'dinas-luar': 'Dinas Luar' };

// Modal untuk MENYELESAIKAN kegiatan Rapat/Dinas Luar yang sudah disetujui:
// unggah dokumentasi kegiatan (banyak foto/PDF, wajib minimal satu) → status jadi "Selesai".
export default function ActivityDocModal({ activity, onClose, onDone }: { activity: Activity; onClose: () => void; onDone: () => void }) {
  const [files, setFiles] = useState<File[]>([]);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const existing = activity.doc_urls?.length || 0;

  async function submit() {
    if (!files.length) return setErr('Unggah minimal satu foto/PDF dokumentasi kegiatan.');
    setBusy(true); setErr('');
    try {
      const stamped = await stampFiles(files, [`Dokumentasi · ${activity.title}`]);
      const fd = new FormData();
      stamped.forEach((f) => fd.append('docs', f));
      if (note.trim()) fd.append('note', note.trim());
      await api.post(`/activities/${activity.id}/documentation`, fd, { headers: { 'Content-Type': 'multipart/form-data' } });
      onDone(); onClose();
    } catch (e: any) {
      setErr(e?.response?.data?.error || 'Gagal mengunggah dokumentasi.');
    } finally { setBusy(false); }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-surface border border-border rounded-xl w-full max-w-md p-5 max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-1">
          <h3 className="text-sm font-bold">📸 Dokumentasi Kegiatan</h3>
          <button type="button" className="text-text2 hover:text-text text-lg leading-none" onClick={onClose}>×</button>
        </div>
        <div className="text-[11px] text-text2 mb-4">{TYPE_LABEL[activity.type] || 'Kegiatan'} · <span className="text-text">{activity.title}</span></div>

        <label className="block text-[11px] text-text2 mb-1">Foto / PDF dokumentasi <span className="text-danger">*</span> <span className="text-text2/60">(bisa pilih beberapa)</span></label>
        <input
          type="file"
          accept="image/*,application/pdf"
          multiple
          onChange={(e) => setFiles(Array.from(e.target.files || []))}
          className="w-full text-[11px] text-text2 file:mr-2 file:py-1.5 file:px-3 file:rounded-md file:border-0 file:text-xs file:bg-surface2 file:text-text mb-1"
        />
        {files.length > 0 && (
          <ul className="text-[10px] text-accent2 mb-2 space-y-0.5">
            {files.map((f, i) => <li key={i}>✓ {f.name} ({Math.round(f.size / 1024)} KB)</li>)}
          </ul>
        )}
        {existing > 0 && <div className="text-[10px] text-text2 mb-2">Sudah ada {existing} dokumentasi terlampir — file baru akan ditambahkan.</div>}

        <label className="block text-[11px] text-text2 mb-1 mt-2">Catatan <span className="text-text2/60">(opsional)</span></label>
        <textarea className="w-full bg-surface2 border border-border rounded-md px-3 py-2 text-xs mb-3 min-h-[54px]" placeholder="Ringkasan hasil kegiatan…" value={note} onChange={(e) => setNote(e.target.value)} />

        {err && <div className="bg-danger/10 border border-danger/30 rounded-md px-3 py-2 text-[11px] text-danger mb-3">⚠️ {err}</div>}
        <div className="text-[10px] text-text2 mb-3">Setelah dokumentasi diunggah, kegiatan ditandai <b className="text-success">Selesai</b> dan koordinator diberi tahu.</div>
        <div className="flex gap-2 justify-end">
          <button type="button" className="border border-border text-text2 rounded-md px-3 py-1.5 text-xs hover:text-text" onClick={onClose} disabled={busy}>Batal</button>
          <button type="button" className="bg-accent text-bg rounded-md px-3 py-1.5 text-xs font-semibold disabled:opacity-50" onClick={submit} disabled={busy}>{busy ? 'Mengunggah…' : 'Selesaikan'}</button>
        </div>
      </div>
    </div>
  );
}
