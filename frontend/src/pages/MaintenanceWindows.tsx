import { useEffect, useState } from 'react';
import { api } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { hasRole } from '../utils/roles';
import { confirmDialog, alertDialog } from '../components/dialog';
import type { MaintenanceWindow, Device } from '../types';

function toLocalInput(d: Date) {
  const off = d.getTimezoneOffset();
  return new Date(d.getTime() - off * 60000).toISOString().slice(0, 16);
}
function fmt(dt: string) {
  return new Date(dt).toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: 'short' });
}

const emptyForm = { scope: 'device' as 'device' | 'location' | 'site', device_id: '', location_id: '', title: '', reason: '', starts_at: '', ends_at: '' };

export default function MaintenanceWindows() {
  const { user } = useAuth();
  const canEdit = hasRole(user, 'admin', 'koordinator');
  const [windows, setWindows] = useState<MaintenanceWindow[]>([]);
  const [devices, setDevices] = useState<Device[]>([]);
  const [locs, setLocs] = useState<{ id: number; name: string }[]>([]);
  const [scope, setScope] = useState<'all' | 'active' | 'upcoming'>('upcoming');
  const [show, setShow] = useState(false);
  const [editId, setEditId] = useState<number | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');

  function load() {
    api.get('/maintenance-windows', { params: { scope } }).then((r) => setWindows(r.data.windows || [])).catch(() => setWindows([]));
  }
  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [scope]);
  useEffect(() => {
    api.get('/devices').then((r) => setDevices(r.data.devices || [])).catch(() => {});
    api.get('/locations').then((r) => setLocs((r.data.locations || []).map((l: { id: number; name: string }) => ({ id: l.id, name: l.name })))).catch(() => {});
  }, []);

  function openAdd() {
    const now = new Date();
    setEditId(null);
    setForm({ ...emptyForm, starts_at: toLocalInput(now), ends_at: toLocalInput(new Date(now.getTime() + 2 * 3600000)) });
    setErr(''); setShow(true);
  }
  function openEdit(w: MaintenanceWindow) {
    setEditId(w.id);
    setForm({
      scope: w.device_id ? 'device' : w.location_id ? 'location' : 'site',
      device_id: w.device_id ? String(w.device_id) : '',
      location_id: w.location_id ? String(w.location_id) : '',
      title: w.title, reason: w.reason || '',
      starts_at: toLocalInput(new Date(w.starts_at)), ends_at: toLocalInput(new Date(w.ends_at)),
    });
    setErr(''); setShow(true);
  }

  async function submit() {
    if (!form.title.trim()) return setErr('Judul wajib diisi.');
    if (form.scope === 'device' && !form.device_id) return setErr('Pilih perangkat.');
    if (form.scope === 'location' && !form.location_id) return setErr('Pilih lokasi.');
    if (new Date(form.ends_at) <= new Date(form.starts_at)) return setErr('Waktu selesai harus setelah waktu mulai.');
    setSaving(true); setErr('');
    const payload = {
      device_id: form.scope === 'device' ? Number(form.device_id) : null,
      location_id: form.scope === 'location' ? Number(form.location_id) : null,
      title: form.title.trim(), reason: form.reason.trim() || null,
      starts_at: form.starts_at.replace('T', ' ') + ':00',
      ends_at: form.ends_at.replace('T', ' ') + ':00',
    };
    try {
      if (editId) await api.put(`/maintenance-windows/${editId}`, payload);
      else await api.post('/maintenance-windows', payload);
      setShow(false); load();
    } catch (e: any) {
      setErr(e?.response?.data?.error || 'Gagal menyimpan jendela maintenance.');
    } finally { setSaving(false); }
  }

  async function remove(w: MaintenanceWindow) {
    if (!(await confirmDialog({ title: `Hapus jadwal "${w.title}"`, message: 'Jendela maintenance ini akan dihapus.', confirmText: '🗑️ Hapus', variant: 'danger' }))) return;
    try { await api.delete(`/maintenance-windows/${w.id}`); load(); }
    catch (e: any) { alertDialog({ title: 'Gagal', message: e?.response?.data?.error || 'Gagal menghapus.', variant: 'danger' }); }
  }

  function targetLabel(w: MaintenanceWindow) {
    if (w.device_name) return `🖥️ ${w.device_name}`;
    if (w.location_name) return `📍 ${w.location_name}`;
    return '🌐 Seluruh site';
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-4 gap-3 flex-wrap">
        <div>
          <div className="text-[17px] font-bold">🔧 Jendela Maintenance</div>
          <div className="text-[11px] text-text2 mt-0.5">Downtime terencana — tidak memicu insiden/alarm & tidak menurunkan SLA</div>
        </div>
        <div className="flex items-center gap-2">
          <select className="dev-inp" value={scope} onChange={(e) => setScope(e.target.value as typeof scope)}>
            <option value="upcoming">Aktif & mendatang</option>
            <option value="active">Sedang aktif</option>
            <option value="all">Semua</option>
          </select>
          {canEdit && <button onClick={openAdd} className="bg-accent text-bg rounded-md px-3 py-2 text-xs font-semibold whitespace-nowrap">+ Jadwalkan</button>}
        </div>
      </div>

      {windows.length === 0 ? (
        <div className="bg-surface border border-border rounded-[10px] py-16 text-center text-text2 text-xs">Belum ada jendela maintenance.</div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
          {windows.map((w) => (
            <div key={w.id} className="bg-surface border border-border rounded-xl p-3.5 flex flex-col gap-2">
              <div className="flex items-start justify-between gap-2">
                <div className="font-semibold text-sm">{w.title}</div>
                {w.is_active ? <span className="shrink-0 px-2 py-0.5 rounded-full bg-warn/15 text-warn text-[10px] font-semibold">● Aktif</span>
                  : <span className="shrink-0 px-2 py-0.5 rounded-full bg-surface2 text-text2 text-[10px]">Terjadwal</span>}
              </div>
              <div className="text-[11px] text-text2">{targetLabel(w)}</div>
              <div className="text-[11px]"><span className="text-text2">Mulai:</span> {fmt(w.starts_at)}</div>
              <div className="text-[11px]"><span className="text-text2">Selesai:</span> {fmt(w.ends_at)}</div>
              {w.reason && <div className="text-[11px] text-text2 italic">"{w.reason}"</div>}
              {canEdit && (
                <div className="flex gap-1 pt-2 border-t border-border/50">
                  <button onClick={() => openEdit(w)} className="bg-accent2/10 text-accent2 border border-accent2/40 rounded px-2 py-0.5 text-[10px]">✏️ Edit</button>
                  <button onClick={() => remove(w)} className="bg-danger/10 text-danger border border-danger/40 rounded px-2 py-0.5 text-[10px]">🗑️ Hapus</button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {show && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4" onClick={() => setShow(false)}>
          <div className="bg-surface border border-border rounded-xl w-full max-w-md max-h-[90vh] flex flex-col overflow-hidden" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 pt-5 pb-3 border-b border-border shrink-0">
              <h3 className="text-sm font-bold">{editId ? '✏️ Edit Jadwal' : '🔧 Jadwalkan Maintenance'}</h3>
              <button type="button" className="text-text2 hover:text-text text-lg leading-none" onClick={() => setShow(false)}>×</button>
            </div>
            <form onSubmit={(e) => { e.preventDefault(); submit(); }} className="flex flex-col flex-1 overflow-hidden">
              <div className="flex-1 overflow-y-auto px-5 py-4 space-y-3">
                <label className="block">
                  <span className="block text-[11px] text-text2 mb-1">Judul *</span>
                  <input className="dev-inp" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="Penggantian switch core" />
                </label>
                <label className="block">
                  <span className="block text-[11px] text-text2 mb-1">Cakupan</span>
                  <select className="dev-inp" value={form.scope} onChange={(e) => setForm({ ...form, scope: e.target.value as typeof form.scope })}>
                    <option value="device">Satu perangkat</option>
                    <option value="location">Satu lokasi</option>
                    <option value="site">Seluruh site</option>
                  </select>
                </label>
                {form.scope === 'device' && (
                  <label className="block">
                    <span className="block text-[11px] text-text2 mb-1">Perangkat *</span>
                    <select className="dev-inp" value={form.device_id} onChange={(e) => setForm({ ...form, device_id: e.target.value })}>
                      <option value="">— pilih —</option>
                      {devices.map((d) => <option key={d.id} value={d.id}>{d.name} ({d.ip})</option>)}
                    </select>
                  </label>
                )}
                {form.scope === 'location' && (
                  <label className="block">
                    <span className="block text-[11px] text-text2 mb-1">Lokasi *</span>
                    <select className="dev-inp" value={form.location_id} onChange={(e) => setForm({ ...form, location_id: e.target.value })}>
                      <option value="">— pilih —</option>
                      {locs.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
                    </select>
                  </label>
                )}
                <div className="grid grid-cols-2 gap-3">
                  <label className="block">
                    <span className="block text-[11px] text-text2 mb-1">Mulai *</span>
                    <input type="datetime-local" className="dev-inp" value={form.starts_at} onChange={(e) => setForm({ ...form, starts_at: e.target.value })} />
                  </label>
                  <label className="block">
                    <span className="block text-[11px] text-text2 mb-1">Selesai *</span>
                    <input type="datetime-local" className="dev-inp" value={form.ends_at} onChange={(e) => setForm({ ...form, ends_at: e.target.value })} />
                  </label>
                </div>
                <label className="block">
                  <span className="block text-[11px] text-text2 mb-1">Keterangan</span>
                  <textarea className="dev-inp" rows={2} value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} placeholder="Detail pekerjaan / PIC" />
                </label>
              </div>
              <div className="px-5 py-3 border-t border-border shrink-0">
                {err && <div className="bg-danger/10 border border-danger/30 rounded-md px-3 py-2 text-[11px] text-danger mb-2">⚠️ {err}</div>}
                <div className="flex gap-2 justify-end">
                  <button type="button" className="border border-border text-text2 rounded-md px-3 py-1.5 text-xs" onClick={() => setShow(false)} disabled={saving}>Batal</button>
                  <button type="submit" className="bg-accent text-bg rounded-md px-3 py-1.5 text-xs font-semibold disabled:opacity-50" disabled={saving}>{saving ? 'Menyimpan…' : 'Simpan'}</button>
                </div>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
