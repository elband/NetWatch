import { useEffect, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api/client';
import { getSocket } from '../api/socket';
import { useAuth } from '../context/AuthContext';
import { hasRole } from '../utils/roles';
import { DeviceStatusBadge } from '../components/StatusBadge';
import type { Device } from '../types';

function meterColor(v: number) {
  return v > 85 ? 'bg-danger' : v > 70 ? 'bg-warn' : 'bg-success';
}

const DEVICE_TYPES = ['Switch', 'Router', 'Firewall', 'AP', 'Server', 'NAS', 'CCTV', 'PC Client', 'Printer'];
// Pustaka ikon (emoji) untuk perangkat / kartu layanan.
const ICONS = ['🖥️', '🔀', '📶', '🧱', '🖧', '💾', '📹', '🌐', '🔗', '📺', '🚪', '📢', '✈️', '🛰️', '📡', '🛜', '📱', '💻', '🔌', '⚙️', '🟢', '🗂️'];
const emptyForm = { name: '', ip: '', type: 'Switch', category: '', icon: '', loc: '', ssh_host: '', ssh_port: '22', ssh_username: '', lat: '', lng: '', inspect_required: true };

export default function Devices() {
  const { user } = useAuth();
  const [devices, setDevices] = useState<Device[]>([]);
  const [serviceNames, setServiceNames] = useState<string[]>([]);
  const [locs, setLocs] = useState<string[]>([]);
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

  async function requestAlarm(d: Device) {
    if (!confirm(`Alarmkan "${d.name}" sekarang?\nPerangkat ini terkategori "dimatikan" (jam malam). Tindakan ini membuat insiden alarm & memberi tahu teknisi on-duty.`)) return;
    try {
      const r = await api.post(`/devices/${d.id}/request-alarm`);
      setDevices((prev) => prev.map((x) => (x.id === d.id ? { ...x, off_reason: null } : x)));
      alert(r.data.incidentId ? `Alarm dibuat (${r.data.incidentId}). Notifikasi ke ${r.data.notified} teknisi on-duty.` : 'Perangkat ditandai untuk dialarmkan.');
    } catch (e: any) {
      alert(e?.response?.data?.error || 'Gagal mengalarmkan perangkat.');
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
    setForm({
      name: d.name, ip: d.ip, type: d.type, category: d.category || '', icon: d.icon || '', loc: d.loc || '',
      ssh_host: d.ssh_host || '', ssh_port: String(d.ssh_port ?? 22), ssh_username: d.ssh_username || '',
      lat: d.lat != null ? String(d.lat) : '', lng: d.lng != null ? String(d.lng) : '',
      inspect_required: d.inspect_required == null ? true : !!d.inspect_required,
    });
    setFormErr(''); setShowAdd(true);
  }

  async function removeDevice(d: Device) {
    if (!confirm(`Hapus perangkat "${d.name}" (${d.ip})?\nInsiden terkait akan dilepas dari perangkat ini, dan riwayat inspeksi/maintenance-nya ikut terhapus.`)) return;
    try {
      await api.delete(`/devices/${d.id}`);
      setDevices((prev) => prev.filter((x) => x.id !== d.id));
    } catch (e: any) {
      alert(e?.response?.data?.error || 'Gagal menghapus perangkat.');
    }
  }

  async function submitDevice() {
    if (!form.name.trim() || !form.ip.trim()) return setFormErr('Nama dan IP wajib diisi.');
    setSaving(true);
    setFormErr('');
    const payload = {
      name: form.name.trim(),
      ip: form.ip.trim(),
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
    alert(`Insiden dibuat untuk ${device.name}`);
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
      <div className="bg-surface border border-border rounded-[10px] overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="text-text2 uppercase text-[10px] tracking-wider border-b border-border">
              {['Nama', 'IP', 'Tipe', 'Lokasi', 'Status', 'Ping', 'CPU', 'RAM', 'Aksi'].map((h) => (
                <th key={h} className="px-3.5 py-2.5 text-left font-medium">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtered.map((d) => (
              <tr key={d.id} className="border-b border-border/50 hover:bg-white/[0.02]">
                <td className="px-3.5 py-2.5 font-semibold">{d.icon && <span className="mr-1.5">{d.icon}</span>}{d.name}</td>
                <td className="px-3.5 py-2.5 font-mono">{d.ip}</td>
                <td className="px-3.5 py-2.5 text-text2">{d.type}{d.category && <span className="ml-1.5 text-[9px] px-1.5 py-0.5 rounded bg-accent2/15 text-accent2">{d.category}</span>}</td>
                <td className="px-3.5 py-2.5 text-text2 text-[11px]">{d.loc}{d.inspect_required === 0 && <span className="ml-1.5 text-[9px] px-1.5 py-0.5 rounded bg-surface2 text-text2 border border-border" title="Tidak wajib diinspeksi">⊘ non-inspeksi</span>}</td>
                <td className="px-3.5 py-2.5"><DeviceStatusBadge status={d.status} offReason={d.off_reason} /></td>
                <td className={`px-3.5 py-2.5 font-mono ${d.ping_ms === 0 ? 'text-danger' : d.ping_ms > 20 ? 'text-warn' : 'text-success'}`}>
                  {d.ping_ms === 0 ? '–' : `${d.ping_ms}ms`}
                </td>
                <td className="px-3.5 py-2.5">
                  <div className="flex items-center gap-1.5">
                    <div className="w-[60px] h-1 bg-border rounded-full overflow-hidden"><div className={`h-full ${meterColor(d.cpu)}`} style={{ width: `${d.cpu}%` }} /></div>
                    <span className="text-[10px]">{d.cpu}%</span>
                  </div>
                </td>
                <td className="px-3.5 py-2.5">
                  <div className="flex items-center gap-1.5">
                    <div className="w-[60px] h-1 bg-border rounded-full overflow-hidden"><div className={`h-full ${meterColor(d.mem)}`} style={{ width: `${d.mem}%` }} /></div>
                    <span className="text-[10px]">{d.mem}%</span>
                  </div>
                </td>
                <td className="px-3.5 py-2.5">
                  <div className="flex gap-1 flex-wrap">
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
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {showAdd && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4" onClick={closeForm}>
          <div className="bg-surface border border-border rounded-xl w-full max-w-md max-h-[90vh] flex flex-col overflow-hidden" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 pt-5 pb-3 border-b border-border shrink-0">
              <h3 className="text-sm font-bold">{editId ? '✏️ Edit Perangkat' : '🖥️ Tambah Perangkat'}</h3>
              <button type="button" className="text-text2 hover:text-white text-lg leading-none" onClick={closeForm}>×</button>
            </div>
            <form onSubmit={(e) => { e.preventDefault(); submitDevice(); }} className="flex flex-col flex-1 overflow-hidden">
            <div className="flex-1 overflow-y-auto px-5 py-4">
            <div className="grid grid-cols-2 gap-3">
              <Field label="Nama *"><input className="dev-inp" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="SW-Core-03" /></Field>
              <Field label="IP *"><input className="dev-inp" value={form.ip} onChange={(e) => setForm({ ...form, ip: e.target.value })} placeholder="192.168.1.3" /></Field>
              <Field label="Tipe">
                <select className="dev-inp" value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>
                  {DEVICE_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
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
                <button type="button" className="border border-border text-text2 rounded-md px-3 py-1.5 text-xs hover:text-white" onClick={closeForm} disabled={saving}>Batal</button>
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
