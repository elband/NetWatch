import { useEffect, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api/client';
import { getSocket } from '../api/socket';
import { useAuth } from '../context/AuthContext';
import { hasRole } from '../utils/roles';
import { DeviceStatusBadge } from '../components/StatusBadge';
import { confirmDialog, alertDialog } from '../components/dialog';
import type { Device } from '../types';

function meterColor(v: number) {
  return v > 85 ? 'bg-danger' : v > 70 ? 'bg-warn' : 'bg-success';
}

const DEVICE_TYPES = ['Switch', 'Router', 'Firewall', 'AP', 'Server', 'NAS', 'CCTV', 'PC Client', 'Printer'];
// Pustaka ikon (emoji) untuk perangkat / kartu layanan.
const ICONS = ['🖥️', '🔀', '📶', '🧱', '🖧', '💾', '📹', '🌐', '🔗', '📺', '🚪', '📢', '✈️', '🛰️', '📡', '🛜', '📱', '💻', '🔌', '⚙️', '🟢', '🗂️'];
const emptyForm = { name: '', ip: '', hasIp: true, type: 'Switch', category: '', icon: '', loc: '', ssh_host: '', ssh_port: '22', ssh_username: '', lat: '', lng: '', inspect_required: true };
const NO_IP = 'N/A (Tanpa IP)';

export default function Devices() {
  const { user } = useAuth();
  const [devices, setDevices] = useState<Device[]>([]);
  const [serviceNames, setServiceNames] = useState<string[]>([]);
  const [locs, setLocs] = useState<string[]>([]);
  const [deviceTypes, setDeviceTypes] = useState<{ name: string; icon: string | null }[]>([]);
  const [search, setSearch] = useState('');
  const [showAdd, setShowAdd] = useState(false);
  const [editId, setEditId] = useState<number | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const [formErr, setFormErr] = useState('');
  const canEdit = hasRole(user, 'admin', 'koordinator');
  const canEditDevice = hasRole(user, 'admin', 'koordinator', 'teknisi'); // teknisi boleh edit (bukan hapus)
  const canAdd = hasRole(user, 'admin', 'koordinator', 'teknisi'); // teknisi boleh tambah perangkat
  const canAlarm = hasRole(user, 'admin', 'koordinator', 'teknisi');

  async function toggleMonitor(d: Device) {
    const turningOff = d.monitor_enabled !== 0;
    if (turningOff && !(await confirmDialog({ title: `Mode standby ${d.name}`, message: 'Perangkat ini tidak akan dimonitor/di-ping otomatis dan tidak memicu insiden otomatis selama mode standby.', confirmText: '⏸️ Standby', variant: 'warning' }))) return;
    try {
      const r = await api.post(`/devices/${d.id}/toggle-monitor`);
      setDevices((prev) => prev.map((x) => (x.id === d.id ? r.data.device : x)));
    } catch (e: any) {
      alertDialog({ title: 'Gagal', message: e?.response?.data?.error || 'Gagal mengubah mode monitor.', variant: 'danger' });
    }
  }

  async function requestAlarm(d: Device) {
    if (!(await confirmDialog({ title: `Alarmkan ${d.name}`, message: 'Perangkat ini terkategori "dimatikan" (jam malam). Tindakan ini membuat insiden alarm & memberi tahu teknisi on-duty.', confirmText: '🔔 Alarmkan', variant: 'warning' }))) return;
    try {
      const r = await api.post(`/devices/${d.id}/request-alarm`);
      setDevices((prev) => prev.map((x) => (x.id === d.id ? { ...x, off_reason: null } : x)));
      alertDialog({ title: 'Alarm dibuat', message: r.data.incidentId ? `Alarm dibuat (${r.data.incidentId}). Notifikasi ke ${r.data.notified} teknisi on-duty.` : 'Perangkat ditandai untuk dialarmkan.', variant: 'success' });
    } catch (e: any) {
      alertDialog({ title: 'Gagal', message: e?.response?.data?.error || 'Gagal mengalarmkan perangkat.', variant: 'danger' });
    }
  }

  function openAdd() {
    setEditId(null); setForm(emptyForm); setFormErr(''); setShowAdd(true);
  }
  function closeForm() {
    setShowAdd(false); setEditId(null);
  }
  function openEdit(d: Device) {
    setEditId(d.id);
    const hasIp = !d.ip.startsWith('N/A');
    setForm({
      name: d.name, ip: hasIp ? d.ip : '', hasIp, type: d.type, category: d.category || '', icon: d.icon || '', loc: d.loc || '',
      ssh_host: d.ssh_host || '', ssh_port: String(d.ssh_port ?? 22), ssh_username: d.ssh_username || '',
      lat: d.lat != null ? String(d.lat) : '', lng: d.lng != null ? String(d.lng) : '',
      inspect_required: d.inspect_required == null ? true : !!d.inspect_required,
    });
    setFormErr(''); setShowAdd(true);
  }

  async function removeDevice(d: Device) {
    if (!(await confirmDialog({ title: `Hapus perangkat ${d.name}`, message: `${d.ip}\n\nInsiden terkait akan dilepas dari perangkat ini, dan riwayat inspeksi/maintenance-nya ikut terhapus.`, confirmText: '🗑️ Hapus', variant: 'danger' }))) return;
    try {
      await api.delete(`/devices/${d.id}`);
      setDevices((prev) => prev.filter((x) => x.id !== d.id));
    } catch (e: any) {
      alertDialog({ title: 'Gagal', message: e?.response?.data?.error || 'Gagal menghapus perangkat.', variant: 'danger' });
    }
  }

  async function submitDevice() {
    if (!form.name.trim() || (form.hasIp && !form.ip.trim())) return setFormErr('Nama dan IP wajib diisi.');
    setSaving(true);
    setFormErr('');
    const payload = {
      name: form.name.trim(),
      ip: form.hasIp ? form.ip.trim() : NO_IP,
      type: form.type,
      category: form.category.trim() || null,
      icon: form.icon || null,
      loc: form.loc.trim() || null,
      ssh_host: form.ssh_host.trim() || null,
      ssh_port: Number(form.ssh_port) || 22,
      ssh_username: form.ssh_username.trim() || null,
      lat: form.lat.trim() || null,
      lng: form.lng.trim() || null,
      inspect_required: form.inspect_required,
    };
    try {
      if (editId) {
        const res = await api.put(`/devices/${editId}`, payload);
        setDevices((prev) => prev.map((x) => (x.id === editId ? res.data.device : x)));
      } else {
        const res = await api.post('/devices', payload);
        setDevices((prev) => [...prev, res.data.device]);
      }
      setShowAdd(false);
      setForm(emptyForm);
      setEditId(null);
    } catch (e: any) {
      setFormErr(e?.response?.data?.error || 'Gagal menyimpan perangkat.');
    } finally {
      setSaving(false);
    }
  }

  useEffect(() => {
    api.get('/devices').then((res) => setDevices(res.data.devices));
    api.get('/services').then((res) => setServiceNames(res.data.services.map((s: { name: string }) => s.name)));
    api.get('/locations').then((res) => setLocs((res.data.locations || []).map((l: { name: string }) => l.name))).catch(() => {});
    api.get('/device-types').then((res) => setDeviceTypes(res.data.deviceTypes || [])).catch(() => {});
    const socket = getSocket();
    const onUpdate = (d: Device) => setDevices((prev) => prev.map((x) => (x.id === d.id ? { ...x, ...d } : x)));
    socket.on('device:update', onUpdate);
    return () => {
      socket.off('device:update', onUpdate);
    };
  }, []);

  async function createIncident(deviceId: number) {
    const device = devices.find((d) => d.id === deviceId);
    if (!device) return;
    await api.post('/incidents', {
      deviceId: device.id,
      deviceName: device.name,
      ip: device.ip,
      issue: 'Perangkat bermasalah - insiden manual',
      priority: 'kritis',
      source: 'manual',
    });
    alertDialog({ title: 'Insiden dibuat', message: `Insiden manual dibuat untuk ${device.name}.`, variant: 'success' });
  }

  const filtered = devices.filter(
    (d) => d.name.toLowerCase().includes(search.toLowerCase()) || d.ip.includes(search) || d.type.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <div>
          <div className="text-[17px] font-bold">🖥️ Manajemen Perangkat</div>
          <div className="text-[11px] text-text2 mt-0.5">{devices.length} perangkat terdaftar</div>
        </div>
        <div className="flex items-center gap-2">
          <input
            className="bg-surface2 border border-border rounded-md px-3 py-2 text-xs w-[200px] outline-none focus:border-accent"
            placeholder="🔍 Cari..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          {canAdd && (
            <button onClick={openAdd} className="bg-accent text-bg rounded-md px-3 py-2 text-xs font-semibold whitespace-nowrap">
              + Tambah Perangkat
            </button>
          )}
        </div>
      </div>
      {filtered.length === 0 ? (
        <div className="bg-surface border border-border rounded-[10px] py-16 text-center text-text2 text-xs">
          {search ? `Tidak ada hasil untuk "${search}"` : 'Belum ada perangkat.'}
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
          {filtered.map((d) => (
            <div key={d.id} className="bg-surface border border-border rounded-xl p-3.5 flex flex-col gap-2.5">
              {/* Header: nama + status */}
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="font-semibold text-sm truncate" title={d.name}>{d.icon && <span className="mr-1.5">{d.icon}</span>}{d.name}</div>
                  <div className="text-[10px] text-text2 font-mono truncate mt-0.5">{d.ip}</div>
                </div>
                <div className="shrink-0"><DeviceStatusBadge status={d.status} offReason={d.off_reason} monitorEnabled={d.monitor_enabled} /></div>
              </div>

              {/* Tipe + lokasi */}
              <div className="flex items-center gap-1.5 flex-wrap text-[10px] text-text2">
                <span>{d.type}</span>
                {d.category && <span className="px-1.5 py-0.5 rounded bg-accent2/15 text-accent2">{d.category}</span>}
                {d.loc && <span>· {d.loc}</span>}
                {d.inspect_required === 0 && <span className="px-1.5 py-0.5 rounded bg-surface2 text-text2 border border-border" title="Tidak wajib diinspeksi">⊘ non-inspeksi</span>}
              </div>

              {/* Metrik */}
              <div className="pt-2 border-t border-border/50 space-y-1.5">
                <div className="flex justify-between text-[10px] text-text2"><span>Ping</span><span className={`font-mono font-semibold ${d.ping_ms === 0 ? 'text-danger' : d.ping_ms > 20 ? 'text-warn' : 'text-success'}`}>{d.ping_ms === 0 ? '–' : `${d.ping_ms}ms`}</span></div>
                <div>
                  <div className="flex justify-between text-[10px] text-text2 mb-0.5"><span>CPU</span><span>{d.cpu}%</span></div>
                  <div className="h-1 bg-border rounded-full overflow-hidden"><div className={`h-full ${meterColor(d.cpu)}`} style={{ width: `${d.cpu}%` }} /></div>
                </div>
                <div>
                  <div className="flex justify-between text-[10px] text-text2 mb-0.5"><span>RAM</span><span>{d.mem}%</span></div>
                  <div className="h-1 bg-border rounded-full overflow-hidden"><div className={`h-full ${meterColor(d.mem)}`} style={{ width: `${d.mem}%` }} /></div>
                </div>
              </div>

              {/* Aksi */}
              <div className="flex gap-1 flex-wrap pt-2 border-t border-border/50">
                {canAlarm && (
                  <button
                    onClick={() => toggleMonitor(d)}
                    title={d.monitor_enabled === 0 ? 'Aktifkan monitoring otomatis' : 'Jeda monitoring (mode standby)'}
                    className={d.monitor_enabled === 0
                      ? 'bg-success/10 text-success border border-success/40 rounded px-2 py-0.5 text-[10px]'
                      : 'bg-surface2 text-text2 border border-border rounded px-2 py-0.5 text-[10px]'}
                  >
                    {d.monitor_enabled === 0 ? '▶️ Monitor' : '⏸️ Standby'}
                  </button>
                )}
                {canAlarm && d.status === 'offline' && d.off_reason === 'dimatikan' && (
                  <button onClick={() => requestAlarm(d)} title="Minta dialarmkan (override aturan jam malam)" className="bg-amber-500/10 text-amber-400 border border-amber-500/40 rounded px-2 py-0.5 text-[10px]">
                    🔔 Alarmkan
                  </button>
                )}
                {canEdit && d.status !== 'online' && d.off_reason !== 'dimatikan' && (
                  <button onClick={() => createIncident(d.id)} className="bg-danger/10 text-danger border border-danger/30 rounded px-2 py-0.5 text-[10px]">
                    ⚠️ Insiden
                  </button>
                )}
                {d.ssh_username && d.ip && (
                  <Link
                    to={`/ssh?device=${d.id}`}
                    className="bg-emerald-500/10 text-emerald-400 border border-emerald-500/40 rounded px-2 py-0.5 text-[10px] hover:bg-emerald-500/20 transition-colors"
                    title={`Remote SSH ke ${d.ssh_host || d.ip}`}
                  >
                    🖥️ SSH
                  </Link>
                )}
                {canEditDevice && (
                  <button onClick={() => openEdit(d)} title="Edit perangkat" className="bg-accent2/10 text-accent2 border border-accent2/40 rounded px-2 py-0.5 text-[10px]">
                    ✏️ Edit
                  </button>
                )}
                {canEdit && (
                  <button onClick={() => removeDevice(d)} title="Hapus perangkat" className="bg-danger/10 text-danger border border-danger/40 rounded px-2 py-0.5 text-[10px]">
                    🗑️ Hapus
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {showAdd && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4" onClick={closeForm}>
          <div className="bg-surface border border-border rounded-xl w-full max-w-md max-h-[90vh] flex flex-col overflow-hidden" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 pt-5 pb-3 border-b border-border shrink-0">
              <h3 className="text-sm font-bold">{editId ? '✏️ Edit Perangkat' : '🖥️ Tambah Perangkat'}</h3>
              <button type="button" className="text-text2 hover:text-text text-lg leading-none" onClick={closeForm}>×</button>
            </div>
            <form onSubmit={(e) => { e.preventDefault(); submitDevice(); }} className="flex flex-col flex-1 overflow-hidden">
            <div className="flex-1 overflow-y-auto px-5 py-4">
            <div className="grid grid-cols-2 gap-3">
              <Field label="Nama *"><input className="dev-inp" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="SW-Core-03" /></Field>
              <Field label="Punya IP?">
                <select className="dev-inp" value={form.hasIp ? 'ya' : 'tidak'} onChange={(e) => setForm({ ...form, hasIp: e.target.value === 'ya' })}>
                  <option value="ya">Ada IP</option>
                  <option value="tidak">Tidak Ada IP</option>
                </select>
              </Field>
              {form.hasIp && (
                <div className="col-span-2">
                  <Field label="IP *"><input className="dev-inp" value={form.ip} onChange={(e) => setForm({ ...form, ip: e.target.value })} placeholder="192.168.1.3" /></Field>
                </div>
              )}
              <Field label="Tipe">
                <select className="dev-inp" value={form.type} onChange={(e) => {
                  const t = e.target.value;
                  const dt = deviceTypes.find((x) => x.name === t);
                  setForm((f) => ({ ...f, type: t, icon: f.icon || dt?.icon || '' }));
                }}>
                  {(deviceTypes.length ? deviceTypes.map((d) => d.name) : DEVICE_TYPES).map((t) => <option key={t} value={t}>{t}</option>)}
                  {form.type && !(deviceTypes.length ? deviceTypes.some((d) => d.name === form.type) : DEVICE_TYPES.includes(form.type)) && <option value={form.type}>{form.type} (lama)</option>}
                </select>
              </Field>
              <Field label="Lokasi (penanda di Peta)">
                <select className="dev-inp" value={form.loc} onChange={(e) => setForm({ ...form, loc: e.target.value })}>
                  <option value="">— pilih lokasi —</option>
                  {locs.map((l) => <option key={l} value={l}>{l}</option>)}
                  {form.loc && !locs.includes(form.loc) && <option value={form.loc}>{form.loc} (lama)</option>}
                </select>
              </Field>
              <div className="col-span-2">
                <Field label="Kategori (Layanan Kritis)">
                  <input className="dev-inp" list="svc-names" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} placeholder="Samakan dgn nama layanan, mis. CCTV" />
                  <datalist id="svc-names">{serviceNames.map((n) => <option key={n} value={n} />)}</datalist>
                </Field>
                <div className="text-[10px] text-text2 mt-1">Perangkat dengan kategori = nama layanan akan menentukan status kartu "Monitoring Layanan Kritis" di dashboard.</div>
              </div>
              <div className="col-span-2">
                <Field label="Ikon (untuk kartu layanan)">
                  <div className="flex flex-wrap gap-1.5">
                    {ICONS.map((ic) => (
                      <button key={ic} type="button" onClick={() => setForm({ ...form, icon: form.icon === ic ? '' : ic })}
                        className={`w-8 h-8 rounded-md border text-base flex items-center justify-center ${form.icon === ic ? 'border-accent bg-accent/15' : 'border-border bg-surface2 hover:border-accent/50'}`}>
                        {ic}
                      </button>
                    ))}
                  </div>
                </Field>
              </div>
              <Field label="SSH Host"><input className="dev-inp" value={form.ssh_host} onChange={(e) => setForm({ ...form, ssh_host: e.target.value })} placeholder="kosong = pakai IP" /></Field>
              <Field label="SSH Port"><input className="dev-inp" value={form.ssh_port} onChange={(e) => setForm({ ...form, ssh_port: e.target.value })} placeholder="22" /></Field>
              <div className="col-span-2">
                <Field label="SSH Username (untuk remote)"><input className="dev-inp" value={form.ssh_username} onChange={(e) => setForm({ ...form, ssh_username: e.target.value })} placeholder="admin" /></Field>
              </div>
              <Field label="Latitude (GPS inspeksi)"><input className="dev-inp" value={form.lat} onChange={(e) => setForm({ ...form, lat: e.target.value })} placeholder="-6.1751" /></Field>
              <Field label="Longitude (GPS inspeksi)"><input className="dev-inp" value={form.lng} onChange={(e) => setForm({ ...form, lng: e.target.value })} placeholder="106.8650" /></Field>
              <div className="col-span-2">
                <label className="flex items-start gap-2 cursor-pointer bg-surface2 border border-border rounded-md px-3 py-2.5">
                  <input type="checkbox" className="mt-0.5" checked={form.inspect_required} onChange={(e) => setForm({ ...form, inspect_required: e.target.checked })} />
                  <span>
                    <span className="block text-[12px] font-semibold">🔍 Wajib diinspeksi</span>
                    <span className="block text-[10px] text-text2">Bila aktif, perangkat muncul di daftar inspeksi rutin teknisi. Nonaktifkan untuk perangkat yang tidak perlu inspeksi (mis. PC Client).</span>
                  </span>
                </label>
              </div>
            </div>
            </div>
            <div className="px-5 py-3 border-t border-border shrink-0">
              {formErr && <div className="bg-danger/10 border border-danger/30 rounded-md px-3 py-2 text-[11px] text-danger mb-2">⚠️ {formErr}</div>}
              <div className="flex gap-2 justify-end">
                <button type="button" className="border border-border text-text2 rounded-md px-3 py-1.5 text-xs hover:text-text" onClick={closeForm} disabled={saving}>Batal</button>
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

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="block text-[11px] text-text2 mb-1">{label}</span>
      {children}
    </label>
  );
}
