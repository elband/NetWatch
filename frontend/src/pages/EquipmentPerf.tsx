import { useEffect, useRef, useState } from 'react';
import { api } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { hasRole } from '../utils/roles';
import type { EquipmentRow, Inspection, InspectStatus, MaintenanceRow, Device } from '../types';

const SLOTS: Array<'09' | '12' | '15'> = ['09', '12', '15'];
const SLOT_LABEL: Record<string, string> = { '09': '09:00', '12': '12:00', '15': '15:00' };
const ST_META: Record<InspectStatus, { c: string; bg: string; t: string }> = {
  baik: { c: 'text-success', bg: 'bg-success/15 border-success/40', t: 'Baik' },
  perhatian: { c: 'text-warn', bg: 'bg-warn/15 border-warn/40', t: 'Perhatian' },
  rusak: { c: 'text-danger', bg: 'bg-danger/15 border-danger/40', t: 'Rusak' },
};
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
          <button className={`px-3 py-1.5 text-xs rounded-md ${tab === 'maintenance' ? 'bg-accent text-bg font-semibold' : 'text-text2'}`} onClick={() => setTab('maintenance')}>Maintenance Bulanan</button>
        </div>
      </div>
      {tab === 'inspeksi' ? <InspeksiTab /> : <MaintenanceTab isManager={isManager} />}
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
  const [edit, setEdit] = useState<{ dev: EquipmentRow; slot: '09' | '12' | '15' } | null>(null);

  function load() {
    api.get(`/equipment/inspections?date=${date}`).then((res) => {
      setRows(res.data.devices);
      setSlots(res.data.slots);
      setCurrentSlot(res.data.currentSlot);
      setOpenSlots(res.data.openSlots || []);
      setIsToday(res.data.isToday);
      setCanInput(res.data.canInput);
    });
  }
  useEffect(load, [date]);
  const slotEditable = (s: string) => canInput && isToday && openSlots.includes(s);

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

      <div className="bg-surface border border-border rounded-[10px] overflow-x-auto">
        <table className="w-full text-xs">
          <thead><tr className="text-text2 uppercase text-[10px] border-b border-border">
            <th className="px-3.5 py-2.5 text-left">Perangkat</th>
            <th className="px-3.5 py-2.5 text-left">Lokasi</th>
            {slots.map((s) => <th key={s} className="px-3.5 py-2.5 text-center">{SLOT_LABEL[s]}</th>)}
          </tr></thead>
          <tbody>
            {rows.map((d) => (
              <tr key={d.id} className="border-b border-border/50">
                <td className="px-3.5 py-2.5"><div className="font-semibold">{d.name}</div><div className="text-text2 text-[10px]">{d.type} · {d.ip}</div></td>
                <td className="px-3.5 py-2.5 text-text2 text-[11px]">{d.loc || '-'}</td>
                {(slots as Array<'09' | '12' | '15'>).map((s) => {
                  const insp = d.inspections[s];
                  const editable = slotEditable(s);
                  return (
                    <td key={s} className="px-2 py-2 text-center">
                      <div className="flex items-center justify-center gap-1">
                        <button
                          disabled={!editable}
                          onClick={() => editable && setEdit({ dev: d, slot: s })}
                          title={insp ? `${insp.status} — ${insp.inspector_name || ''}${insp.note ? ' · ' + insp.note : ''}` : editable ? 'Klik untuk isi inspeksi' : 'Terkunci (di luar jam slot / bukan hari ini)'}
                          className={`min-w-[70px] border rounded px-2 py-1 text-[10px] font-semibold ${insp ? ST_META[insp.status].bg + ' ' + ST_META[insp.status].c : 'border-border text-text2'} ${editable ? 'hover:opacity-80' : 'opacity-60 cursor-not-allowed'}`}
                        >
                          {insp ? ST_META[insp.status].t : editable ? '+ isi' : '🔒'}
                        </button>
                        {insp?.photo_url && (
                          <a href={insp.photo_url} target="_blank" rel="noreferrer" title={insp.verified ? `Terverifikasi${insp.distance_m != null ? ' · ' + insp.distance_m + ' m' : ''}` : 'Belum terverifikasi (EXIF/GPS)'} onClick={(e) => e.stopPropagation()} className="text-[12px]">📷{insp.verified ? '✅' : '⚠️'}</a>
                        )}
                      </div>
                    </td>
                  );
                })}
              </tr>
            ))}
            {rows.length === 0 && <tr><td colSpan={5} className="text-center py-6 text-text2">Tidak ada perangkat.</td></tr>}
          </tbody>
        </table>
      </div>

      {edit && (
        <InspeksiModal
          date={date}
          dev={edit.dev}
          slot={edit.slot}
          existing={edit.dev.inspections[edit.slot]}
          onClose={() => setEdit(null)}
          onSaved={() => { setEdit(null); load(); }}
        />
      )}
    </div>
  );
}

function InspeksiModal({ date, dev, slot, existing, onClose, onSaved }: { date: string; dev: EquipmentRow; slot: '09' | '12' | '15'; existing?: Inspection; onClose: () => void; onSaved: () => void }) {
  const [status, setStatus] = useState<InspectStatus>(existing?.status || 'baik');
  const [note, setNote] = useState(existing?.note || '');
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  function pick(f: File | null) {
    setFile(f); setErr('');
    setPreview(f ? URL.createObjectURL(f) : null);
  }

  function getGeo(): Promise<{ lat: number; lng: number } | null> {
    return new Promise((resolve) => {
      if (!navigator.geolocation) return resolve(null);
      navigator.geolocation.getCurrentPosition(
        (p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude }),
        () => resolve(null),
        { enableHighAccuracy: true, timeout: 6000 }
      );
    });
  }

  async function save() {
    if (!file) return setErr('Foto dokumentasi wajib diunggah (hasil pengecekan saat ini).');
    setBusy(true); setErr('');
    try {
      const geo = await getGeo();
      const fd = new FormData();
      fd.append('deviceId', String(dev.id));
      fd.append('slot', slot);
      fd.append('status', status);
      fd.append('note', note);
      fd.append('date', date);
      fd.append('photo', file);
      if (geo) { fd.append('lat', String(geo.lat)); fd.append('lng', String(geo.lng)); }
      const res = await api.post('/equipment/inspections', fd, { headers: { 'Content-Type': 'multipart/form-data' } });
      if (res.data?.warning) alert('Tersimpan, namun: ' + res.data.warning + '\n(ditandai BELUM TERVERIFIKASI untuk koordinator)');
      onSaved();
    } catch (e: any) {
      setErr(e?.response?.data?.error || 'Gagal menyimpan.');
    } finally { setBusy(false); }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-surface border border-border rounded-xl w-full max-w-sm p-5" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-sm font-bold mb-1">Inspeksi · {SLOT_LABEL[slot]}</h3>
        <p className="text-[11px] text-text2 mb-4">{dev.name} · {date}</p>
        <div className="flex gap-2 mb-3">
          {(['baik', 'perhatian', 'rusak'] as InspectStatus[]).map((s) => (
            <button key={s} onClick={() => setStatus(s)} className={`flex-1 border rounded-md px-2 py-2 text-xs font-semibold ${status === s ? ST_META[s].bg + ' ' + ST_META[s].c : 'border-border text-text2'}`}>{ST_META[s].t}</button>
          ))}
        </div>
        <label className="block text-[11px] text-text2 mb-1">Foto dokumentasi <span className="text-danger">*</span></label>
        <input
          type="file"
          accept="image/*"
          capture="environment"
          className="block w-full text-[11px] text-text2 mb-1 file:mr-3 file:py-1.5 file:px-3 file:rounded file:border-0 file:bg-accent file:text-bg file:text-[11px] file:font-semibold"
          onChange={(e) => pick(e.target.files?.[0] || null)}
        />
        {preview && <img src={preview} alt="preview" className="mt-1 mb-2 max-h-36 rounded border border-border object-contain" />}
        <textarea className="w-full bg-surface2 border border-border rounded-md px-3 py-2 text-xs min-h-[60px] mb-2 mt-1" placeholder="Catatan kondisi (opsional)…" value={note} onChange={(e) => setNote(e.target.value)} />
        <div className="text-[10px] text-text2 mb-3">⚠️ Foto wajib hasil pengecekan saat ini (akan dicek EXIF & lokasi GPS). Izinkan akses lokasi saat diminta. Foto lama/yang sudah pernah dipakai akan ditolak/ditandai.</div>
        {err && <div className="bg-danger/10 border border-danger/30 rounded-md px-3 py-2 text-[11px] text-danger mb-3">⚠️ {err}</div>}
        <div className="flex gap-2 justify-end">
          <button className="border border-border text-text2 rounded-md px-3 py-1.5 text-xs" onClick={onClose} disabled={busy}>Batal</button>
          <button className="bg-accent text-bg rounded-md px-3 py-1.5 text-xs font-semibold disabled:opacity-50" onClick={save} disabled={busy}>{busy ? 'Menyimpan…' : 'Simpan'}</button>
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
  const [completeFor, setCompleteFor] = useState<MaintenanceRow | null>(null);
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
    if (!confirm('Hapus rencana maintenance ini?')) return;
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
            <button onClick={downloadTemplate} className="border border-border text-text2 rounded-md px-3 py-1.5 text-xs hover:text-white">⬇️ Template Excel</button>
            <button onClick={() => fileRef.current?.click()} className="border border-accent2/40 text-accent2 rounded-md px-3 py-1.5 text-xs font-semibold">⬆️ Import Excel</button>
            <input ref={fileRef} type="file" accept=".xlsx,.xls" className="hidden" onChange={(e) => e.target.files?.[0] && importFile(e.target.files[0])} />
          </div>
        )}
      </div>
      {msg && <div className="bg-accent2/10 border border-accent2/30 rounded-md px-3 py-2 text-[11px] text-accent2 mb-3">{msg}</div>}

      <div className="bg-surface border border-border rounded-[10px] overflow-x-auto">
        <table className="w-full text-xs">
          <thead><tr className="text-text2 uppercase text-[10px] border-b border-border">
            {['Tanggal', 'Perangkat', 'Tugas', 'Status', 'Pelaksana', 'Aksi'].map((h) => <th key={h} className="px-3.5 py-2.5 text-left">{h}</th>)}
          </tr></thead>
          <tbody>
            {rows.map((m) => (
              <tr key={m.id} className="border-b border-border/50">
                <td className="px-3.5 py-2.5 font-mono text-[11px]">{m.scheduled_date}</td>
                <td className="px-3.5 py-2.5"><strong>{m.device_name}</strong><div className="text-text2 text-[10px]">{m.device_type}</div></td>
                <td className="px-3.5 py-2.5">{m.task}{m.note && <div className="text-text2 text-[10px]">{m.note}</div>}{m.doc_url && <a href={m.doc_url} target="_blank" rel="noreferrer" className="text-accent2 text-[10px] hover:underline">📎 Dokumentasi</a>}</td>
                <td className="px-3.5 py-2.5"><span className={`text-[10px] px-2 py-0.5 rounded border font-semibold capitalize ${stMeta[m.status]}`}>{m.status}</span></td>
                <td className="px-3.5 py-2.5 text-text2 text-[11px]">{m.done_by_name || '-'}{m.done_at && <div className="text-[10px]">{m.done_at}</div>}</td>
                <td className="px-3.5 py-2.5">
                  <div className="flex gap-1.5 flex-wrap">
                    {m.status !== 'selesai' && <button onClick={() => setCompleteFor(m)} className="border border-success/40 text-success rounded px-2 py-0.5">✅ Selesai</button>}
                    {m.status !== 'rencana' && <button onClick={() => setStatus(m.id, 'rencana')} className="border border-border text-text2 rounded px-2 py-0.5">↺ Rencana</button>}
                    {isManager && <button onClick={() => remove(m.id)} className="border border-danger/40 text-danger rounded px-2 py-0.5">🗑️</button>}
                  </div>
                </td>
              </tr>
            ))}
            {rows.length === 0 && <tr><td colSpan={6} className="text-center py-6 text-text2">Belum ada rencana maintenance bulan ini.</td></tr>}
          </tbody>
        </table>
      </div>

      {showAdd && <AddMaintenanceModal devices={devices} onClose={() => setShowAdd(false)} onSaved={() => { setShowAdd(false); load(); }} />}
      {completeFor && <CompleteMaintenanceModal item={completeFor} onClose={() => setCompleteFor(null)} onDone={(n) => { setCompleteFor(null); setMsg(`✅ Maintenance selesai. Notifikasi terkirim ke ${n} koordinator.`); setTimeout(() => setMsg(''), 6000); load(); }} />}
    </div>
  );
}

// Modal penyelesaian maintenance: wajib unggah dokumentasi (foto/PDF, bisa dari kamera).
function CompleteMaintenanceModal({ item, onClose, onDone }: { item: MaintenanceRow; onClose: () => void; onDone: (notified: number) => void }) {
  const [doc, setDoc] = useState<File | null>(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const hasExisting = !!item.doc_url;

  async function submit() {
    if (!doc && !hasExisting) return setErr('Dokumentasi (foto/PDF) wajib diunggah untuk menyelesaikan maintenance.');
    setBusy(true); setErr('');
    try {
      const fd = new FormData();
      fd.append('status', 'selesai');
      if (note.trim()) fd.append('note', note.trim());
      if (doc) fd.append('doc', doc);
      const r = await api.put(`/equipment/maintenance/${item.id}`, fd, { headers: { 'Content-Type': 'multipart/form-data' } });
      onDone(r.data.notified ?? 0);
    } catch (e: any) { setErr(e?.response?.data?.error || 'Gagal menyimpan.'); }
    finally { setBusy(false); }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-surface border border-border rounded-xl w-full max-w-md p-5" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-sm font-bold mb-1">✅ Selesaikan Maintenance</h3>
        <div className="text-[11px] text-text2 mb-4">{item.device_name} · {item.task}</div>

        <label className="block text-[11px] text-text2 mb-1">📷 Dokumentasi * (foto/PDF — bisa langsung dari kamera)</label>
        <input type="file" accept="image/*,application/pdf" capture="environment" onChange={(e) => setDoc(e.target.files?.[0] || null)}
          className="w-full text-[11px] text-text2 mb-2 file:mr-2 file:py-1.5 file:px-3 file:rounded-md file:border-0 file:text-xs file:bg-surface2 file:text-white file:cursor-pointer" />
        {doc && <div className="text-[10px] text-accent2 mb-2 flex items-center gap-1.5">{doc.type.startsWith('image') ? '🖼️' : '📄'} {doc.name}<button type="button" onClick={() => setDoc(null)} className="text-danger">✕</button></div>}
        {!doc && hasExisting && <div className="text-[10px] text-text2 mb-2">Sudah ada dokumentasi terlampir; unggah baru untuk menggantinya (opsional).</div>}

        <label className="block text-[11px] text-text2 mb-1">Catatan Hasil (opsional)</label>
        <input className="w-full bg-surface2 border border-border rounded-md px-3 py-2 text-xs mb-3" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Kondisi setelah maintenance…" />

        <div className="text-[10px] text-text2 mb-3">ℹ️ Setelah selesai, notifikasi WhatsApp otomatis dikirim ke koordinator.</div>
        {err && <div className="bg-danger/10 border border-danger/30 rounded-md px-3 py-2 text-[11px] text-danger mb-3">⚠️ {err}</div>}
        <div className="flex gap-2 justify-end">
          <button className="border border-border text-text2 rounded-md px-3 py-1.5 text-xs" onClick={onClose} disabled={busy}>Batal</button>
          <button className="bg-success text-bg rounded-md px-3 py-1.5 text-xs font-semibold disabled:opacity-50" onClick={submit} disabled={busy}>{busy ? 'Menyimpan…' : '✅ Selesai & Kirim Notifikasi'}</button>
        </div>
      </div>
    </div>
  );
}

function AddMaintenanceModal({ devices, onClose, onSaved }: { devices: Device[]; onClose: () => void; onSaved: () => void }) {
  const [deviceId, setDeviceId] = useState<number | ''>('');
  const [scheduledDate, setScheduledDate] = useState(todayKey());
  const [task, setTask] = useState('');
  const [note, setNote] = useState('');
  const [doc, setDoc] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  async function save() {
    if (!deviceId || !task.trim()) return setErr('Perangkat dan tugas wajib diisi.');
    setBusy(true); setErr('');
    try {
      const fd = new FormData();
      fd.append('deviceId', String(deviceId));
      fd.append('scheduledDate', scheduledDate);
      fd.append('task', task.trim());
      if (note.trim()) fd.append('note', note.trim());
      if (doc) fd.append('doc', doc);
      await api.post('/equipment/maintenance', fd, { headers: { 'Content-Type': 'multipart/form-data' } });
      onSaved();
    } catch (e: any) {
      setErr(e?.response?.data?.error || 'Gagal menyimpan.');
    } finally { setBusy(false); }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-surface border border-border rounded-xl w-full max-w-md p-5" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-sm font-bold mb-4">+ Rencana Maintenance</h3>
        <label className="block text-[11px] text-text2 mb-1">Perangkat *</label>
        <select className="w-full bg-surface2 border border-border rounded-md px-3 py-2 text-xs mb-3" value={deviceId} onChange={(e) => setDeviceId(Number(e.target.value))}>
          <option value="">Pilih perangkat…</option>
          {devices.map((d) => <option key={d.id} value={d.id}>{d.name} ({d.ip})</option>)}
        </select>
        <label className="block text-[11px] text-text2 mb-1">Tanggal *</label>
        <input type="date" className="w-full bg-surface2 border border-border rounded-md px-3 py-2 text-xs mb-3" value={scheduledDate} onChange={(e) => setScheduledDate(e.target.value)} />
        <label className="block text-[11px] text-text2 mb-1">Tugas *</label>
        <input className="w-full bg-surface2 border border-border rounded-md px-3 py-2 text-xs mb-3" placeholder="Pembersihan, cek kondisi…" value={task} onChange={(e) => setTask(e.target.value)} />
        <label className="block text-[11px] text-text2 mb-1">Catatan</label>
        <input className="w-full bg-surface2 border border-border rounded-md px-3 py-2 text-xs mb-3" value={note} onChange={(e) => setNote(e.target.value)} />
        <label className="block text-[11px] text-text2 mb-1">📎 Dokumentasi (foto/PDF — bisa langsung dari kamera)</label>
        <input type="file" accept="image/*,application/pdf" capture="environment" onChange={(e) => setDoc(e.target.files?.[0] || null)}
          className="w-full text-[11px] text-text2 mb-2 file:mr-2 file:py-1.5 file:px-3 file:rounded-md file:border-0 file:text-xs file:bg-surface2 file:text-white file:cursor-pointer" />
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
