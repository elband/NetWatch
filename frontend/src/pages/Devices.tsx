import { useEffect, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api/client';
import { getSocket } from '../api/socket';
import { useAuth } from '../context/AuthContext';
import { hasRole } from '../utils/roles';
import { DeviceStatusBadge } from '../components/StatusBadge';
import { confirmDialog, alertDialog } from '../components/dialog';
import DeviceMetricsModal from '../components/DeviceMetricsModal';
import type { Device } from '../types';

function meterColor(v: number) {
  return v > 85 ? 'bg-danger' : v > 70 ? 'bg-warn' : 'bg-success';
}

const DEVICE_TYPES = ['Switch', 'Router', 'Firewall', 'AP', 'Server', 'NAS', 'CCTV', 'PC Client', 'Printer'];
// Pustaka ikon (emoji) untuk perangkat / kartu layanan.
const ICONS = ['🖥️', '🔀', '📶', '🧱', '🖧', '💾', '📹', '🌐', '🔗', '📺', '🚪', '📢', '✈️', '🛰️', '📡', '🛜', '📱', '💻', '🔌', '⚙️', '🟢', '🗂️'];
const emptyForm = { name: '', ip: '', hasIp: true, type: 'Switch', category: '', icon: '', loc: '', location_id: null as number | null, ssh_host: '', ssh_port: '22', ssh_username: '', lat: '', lng: '', inspect_required: true, check_type: 'ping' as 'ping' | 'tcp' | 'http', check_port: '', check_url: '', snmp_enabled: false, snmp_community: 'public', snmp_port: '161' };
const NO_IP = 'N/A (Tanpa IP)';

export default function Devices() {
  const { user } = useAuth();
  const [devices, setDevices] = useState<Device[]>([]);
  const [serviceNames, setServiceNames] = useState<string[]>([]);
  const [locs, setLocs] = useState<{ id: number; name: string }[]>([]);
  const [deviceTypes, setDeviceTypes] = useState<{ name: string; icon: string | null }[]>([]);
  const [search, setSearch] = useState('');
  const [showAdd, setShowAdd] = useState(false);
  const [editId, setEditId] = useState<number | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const [formErr, setFormErr] = useState('');
  const [metricsDevice, setMetricsDevice] = useState<Device | null>(null);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
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

  async function toggleAlwaysOn(d: Device) {
    const turningOn = d.always_on !== 1;
    if (turningOn && !(await confirmDialog({ title: `Selalu Aktif 24 Jam — ${d.name}`, message: 'Perangkat ditandai selalu aktif (mis. Masterclock/server): dikecualikan dari alur Hidupkan/Matikan peralatan — tidak untuk dihidupkan maupun dimatikan manual. Monitoring tetap berjalan.', confirmText: '🕒 Tandai 24 Jam', variant: 'info' }))) return;
    try {
      const r = await api.post(`/devices/${d.id}/toggle-always-on`);
      setDevices((prev) => prev.map((x) => (x.id === d.id ? r.data.device : x)));
    } catch (e: any) {
      alertDialog({ title: 'Gagal', message: e?.response?.data?.error || 'Gagal mengubah status selalu aktif.', variant: 'danger' });
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

  async function uploadPhoto(file: File) {
    if (!editId) return;
    setUploadingPhoto(true);
    try {
      const fd = new FormData();
      fd.append('photo', file);
      const res = await api.post(`/devices/${editId}/photo`, fd);
      setDevices((prev) => prev.map((x) => (x.id === editId ? res.data.device : x)));
    } catch (e: any) {
      alertDialog({ title: 'Gagal', message: e?.response?.data?.error || 'Gagal mengunggah foto.', variant: 'danger' });
    } finally {
      setUploadingPhoto(false);
    }
  }

  async function removePhoto() {
    if (!editId) return;
    setUploadingPhoto(true);
    try {
      const res = await api.delete(`/devices/${editId}/photo`);
      setDevices((prev) => prev.map((x) => (x.id === editId ? res.data.device : x)));
    } catch (e: any) {
      alertDialog({ title: 'Gagal', message: e?.response?.data?.error || 'Gagal menghapus foto.', variant: 'danger' });
    } finally {
      setUploadingPhoto(false);
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
      name: d.name, ip: hasIp ? d.ip : '', hasIp, type: d.type, category: d.category || '', icon: d.icon || '', loc: d.loc || '', location_id: d.location_id ?? null,
      ssh_host: d.ssh_host || '', ssh_port: String(d.ssh_port ?? 22), ssh_username: d.ssh_username || '',
      lat: d.lat != null ? String(d.lat) : '', lng: d.lng != null ? String(d.lng) : '',
      inspect_required: d.inspect_required == null ? true : !!d.inspect_required,
      check_type: d.check_type || 'ping', check_port: d.check_port != null ? String(d.check_port) : '', check_url: d.check_url || '',
      snmp_enabled: !!d.snmp_enabled, snmp_community: d.snmp_community || 'public', snmp_port: String(d.snmp_port ?? 161),
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
      location_id: form.location_id,
      ssh_host: form.ssh_host.trim() || null,
      ssh_port: Number(form.ssh_port) || 22,
      ssh_username: form.ssh_username.trim() || null,
      lat: form.lat.trim() || null,
      lng: form.lng.trim() || null,
      inspect_required: form.inspect_required,
      check_type: form.check_type,
      check_port: form.check_type === 'tcp' ? (Number(form.check_port) || null) : null,
      check_url: form.check_type === 'http' ? (form.check_url.trim() || null) : null,
      snmp_enabled: form.snmp_enabled,
      snmp_community: form.snmp_community.trim() || 'public',
      snmp_port: Number(form.snmp_port) || 161,
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
    api.get('/locations').then((res) => setLocs((res.data.locations || []).map((l: { id: number; name: string }) => ({ id: l.id, name: l.name })))).catch(() => {});
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
  const editingDevice = editId ? devices.find((x) => x.id === editId) : null;

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
              {/* Header: foto/ikon + nama + status */}
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-start gap-2.5 min-w-0">
                  {(d.photo_url || d.icon) && (
                    <span className="w-10 h-10 rounded-md border border-border bg-surface2 flex items-center justify-center overflow-hidden shrink-0 text-lg">
                      {d.photo_url ? <img src={d.photo_url} alt="" className="w-full h-full object-cover" /> : d.icon}
                    </span>
                  )}
                  <div className="min-w-0">
                    <div className="font-semibold text-sm truncate" title={d.name}>{d.name}</div>
                    <div className="text-[10px] text-text2 font-mono truncate mt-0.5">{d.ip}</div>
                  </div>
                </div>
                <div className="shrink-0"><DeviceStatusBadge status={d.status} offReason={d.off_reason} monitorEnabled={d.monitor_enabled} underMaintenance={d.under_maintenance} /></div>
              </div>

              {/* Tipe + lokasi */}
              <div className="flex items-center gap-1.5 flex-wrap text-[10px] text-text2">
                <span>{d.type}</span>
                {d.category && <span className="px-1.5 py-0.5 rounded bg-accent2/15 text-accent2">{d.category}</span>}
                {d.location_name
                  ? <span className="px-1.5 py-0.5 rounded bg-accent/15 text-accent" title="Tertaut ke titik di Peta">📍 {d.location_name}</span>
                  : d.loc && <span title="Tag lokasi lama (belum tertaut ke peta)">· {d.loc}</span>}
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
                {canAlarm && (
                  <button
                    onClick={() => toggleAlwaysOn(d)}
                    title={d.always_on === 1 ? 'Batalkan status selalu aktif — perangkat kembali ikut alur Hidupkan/Matikan' : 'Tandai selalu aktif 24 jam — dikecualikan dari Hidupkan/Matikan (tidak dimatikan maupun dihidupkan)'}
                    className={d.always_on === 1
                      ? 'bg-indigo-500/15 text-indigo-400 border border-indigo-500/40 rounded px-2 py-0.5 text-[10px]'
                      : 'bg-surface2 text-text2 border border-border rounded px-2 py-0.5 text-[10px]'}
                  >
                    {d.always_on === 1 ? '🕒 24 Jam ✓' : '🕒 24 Jam'}
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
                <button onClick={() => setMetricsDevice(d)} title="Lihat tren metrik (latency, uptime, CPU/RAM)" className="bg-sky-500/10 text-sky-400 border border-sky-500/40 rounded px-2 py-0.5 text-[10px]">
                  📈 Tren
                </button>
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
              <Field label="Lokasi (tag di Peta)">
                <select className="dev-inp" value={form.location_id ?? ''} onChange={(e) => {
                  const id = e.target.value ? Number(e.target.value) : null;
                  const name = locs.find((l) => l.id === id)?.name || '';
                  setForm({ ...form, location_id: id, loc: id ? name : '' });
                }}>
                  <option value="">— pilih lokasi —</option>
                  {locs.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
                </select>
                {form.location_id == null && form.loc && (
                  <div className="text-[10px] text-text2 mt-1">Tag lama: <b>{form.loc}</b> — pilih lokasi di atas untuk menautkannya ke titik peta.</div>
                )}
              </Field>
              <div className="col-span-2">
                <Field label="Kategori (Layanan Kritis)">
                  <input className="dev-inp" list="svc-names" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} placeholder="Samakan dgn nama layanan, mis. CCTV" />
                  <datalist id="svc-names">{serviceNames.map((n) => <option key={n} value={n} />)}</datalist>
                </Field>
                <div className="text-[10px] text-text2 mt-1">Perangkat dengan kategori = nama layanan akan menentukan status kartu "Monitoring Layanan Kritis" di dashboard.</div>
              </div>
              <div className="col-span-2">
                <Field label="Foto Perangkat">
                  {editId ? (
                    <div className="flex items-center gap-3">
                      <span className="w-14 h-14 rounded-md border border-border bg-surface2 flex items-center justify-center overflow-hidden shrink-0 text-2xl">
                        {editingDevice?.photo_url ? <img src={editingDevice.photo_url} alt="" className="w-full h-full object-cover" /> : (form.icon || '📦')}
                      </span>
                      <div className="flex flex-col gap-1.5">
                        <label className={`bg-surface2 border border-border rounded-md px-2.5 py-1.5 text-[11px] w-fit hover:border-accent/50 ${uploadingPhoto ? 'opacity-60' : 'cursor-pointer'}`}>
                          {uploadingPhoto ? 'Mengunggah...' : '📷 Unggah Foto'}
                          <input type="file" accept="image/*" className="hidden" disabled={uploadingPhoto}
                            onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadPhoto(f); e.target.value = ''; }} />
                        </label>
                        {editingDevice?.photo_url && (
                          <button type="button" onClick={removePhoto} disabled={uploadingPhoto} className="text-[10px] text-danger text-left hover:underline">Hapus foto</button>
                        )}
                      </div>
                    </div>
                  ) : (
                    <div className="text-[10px] text-text2 bg-surface2 border border-border rounded-md px-3 py-2">📷 Foto bisa diunggah setelah perangkat disimpan — buka menu Edit.</div>
                  )}
                </Field>
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

              {/* Metode pemantauan */}
              <div className="col-span-2 pt-2 mt-1 border-t border-border/50">
                <div className="text-[11px] font-semibold text-text2 mb-2">📡 Metode Pemantauan</div>
              </div>
              <Field label="Cek ketersediaan via">
                <select className="dev-inp" value={form.check_type} onChange={(e) => setForm({ ...form, check_type: e.target.value as 'ping' | 'tcp' | 'http' })}>
                  <option value="ping">ICMP Ping (host hidup)</option>
                  <option value="tcp">TCP Port (service hidup)</option>
                  <option value="http">HTTP/HTTPS (web sehat)</option>
                </select>
              </Field>
              {form.check_type === 'tcp' && (
                <Field label="Port TCP"><input className="dev-inp" value={form.check_port} onChange={(e) => setForm({ ...form, check_port: e.target.value })} placeholder="443" /></Field>
              )}
              {form.check_type === 'http' && (
                <div className="col-span-2">
                  <Field label="URL HTTP(S)"><input className="dev-inp" value={form.check_url} onChange={(e) => setForm({ ...form, check_url: e.target.value })} placeholder="https://192.168.1.3/health" /></Field>
                </div>
              )}
              <div className="col-span-2">
                <label className="flex items-start gap-2 cursor-pointer bg-surface2 border border-border rounded-md px-3 py-2.5">
                  <input type="checkbox" className="mt-0.5" checked={form.snmp_enabled} onChange={(e) => setForm({ ...form, snmp_enabled: e.target.checked })} />
                  <span>
                    <span className="block text-[12px] font-semibold">📊 Aktifkan SNMP</span>
                    <span className="block text-[10px] text-text2">Rekam CPU & memori riil (SNMP v2c). Tanpa ini, CPU/RAM tidak terisi.</span>
                  </span>
                </label>
              </div>
              {form.snmp_enabled && (
                <>
                  <Field label="SNMP Community"><input className="dev-inp" value={form.snmp_community} onChange={(e) => setForm({ ...form, snmp_community: e.target.value })} placeholder="public" /></Field>
                  <Field label="SNMP Port"><input className="dev-inp" value={form.snmp_port} onChange={(e) => setForm({ ...form, snmp_port: e.target.value })} placeholder="161" /></Field>
                </>
              )}

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

      {metricsDevice && <DeviceMetricsModal device={metricsDevice} onClose={() => setMetricsDevice(null)} />}
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
