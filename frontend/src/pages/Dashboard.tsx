import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api/client';
import { getSocket } from '../api/socket';
import { DeviceStatusBadge, IncidentStatusBadge, PriorityBadge } from '../components/StatusBadge';
import type { Device, Incident, PerformaRow } from '../types';

const STAT_COLORS = ['text-accent2', 'text-success', 'text-warn', 'text-danger', 'text-accent'];

export default function Dashboard() {
  const [devices, setDevices] = useState<Device[]>([]);
  const [incidents, setIncidents] = useState<Incident[]>([]);
  const [performa, setPerforma] = useState<PerformaRow[]>([]);

  useEffect(() => {
    api.get('/devices').then((res) => setDevices(res.data.devices));
    api.get('/incidents').then((res) => setIncidents(res.data.incidents));
    api.get('/performa').then((res) => setPerforma(res.data.performa));
    const socket = getSocket();
    const onUpdate = (d: Device) => setDevices((prev) => prev.map((x) => (x.id === d.id ? { ...x, ...d } : x)));
    const onNewIncident = () => api.get('/incidents').then((res) => setIncidents(res.data.incidents));
    socket.on('device:update', onUpdate);
    socket.on('incident:new', onNewIncident);
    return () => {
      socket.off('device:update', onUpdate);
      socket.off('incident:new', onNewIncident);
    };
  }, []);

  const online = devices.filter((d) => d.status === 'online').length;
  const warn = devices.filter((d) => d.status === 'warning').length;
  const offline = devices.filter((d) => d.status === 'offline').length;
  const activeInc = incidents.filter((i) => i.status !== 'selesai').length;
  const selesai = incidents.filter((i) => i.status === 'selesai').length;

  const stats = [
    { label: 'Total Perangkat', value: devices.length, sub: 'Terdaftar' },
    { label: 'Online', value: online, sub: 'Normal' },
    { label: 'Warning', value: warn, sub: 'Perlu cek' },
    { label: 'Offline', value: offline, sub: 'Tidak merespons' },
    { label: 'Insiden Aktif', value: activeInc, sub: `${selesai} selesai` },
  ];

  return (
    <div>
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3.5 mb-5 nw-stagger">
        {stats.map((s, i) => (
          <div key={s.label} className="nw-card bg-surface border border-border rounded-[10px] p-4">
            <div className="text-[10px] text-text2 uppercase tracking-wider mb-1.5">{s.label}</div>
            <div className={`nw-fluid-num mb-0.5 ${STAT_COLORS[i]}`}>{s.value}</div>
            <div className="text-[10px] text-text2">{s.sub}</div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-5 nw-stagger">
        <div className="nw-card bg-surface border border-border rounded-[10px] overflow-hidden">
          <div className="px-4 py-3 border-b border-border flex justify-between items-center">
            <span className="text-[13px] font-semibold">🚨 Insiden Aktif</span>
            <Link to="/incidents" className="text-xs text-text2 hover:text-text">Semua →</Link>
          </div>
          <table className="w-full text-xs">
            <thead><tr className="text-text2 uppercase text-[10px] border-b border-border"><th className="px-3.5 py-2 text-left">Perangkat</th><th className="px-3.5 py-2 text-left">Prioritas</th><th className="px-3.5 py-2 text-left">Status</th></tr></thead>
            <tbody>
              {incidents.filter((i) => i.status !== 'selesai').slice(0, 5).map((i) => (
                <tr key={i.id} className="border-b border-border/50">
                  <td className="px-3.5 py-2"><strong>{i.device_name}</strong><br /><span className="text-[10px] text-text2 font-mono">{i.ip}</span></td>
                  <td className="px-3.5 py-2"><PriorityBadge priority={i.priority} /></td>
                  <td className="px-3.5 py-2"><IncidentStatusBadge status={i.status} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="nw-card bg-surface border border-border rounded-[10px] overflow-hidden">
          <div className="px-4 py-3 border-b border-border flex justify-between items-center">
            <span className="text-[13px] font-semibold">⚠️ Perangkat Bermasalah</span>
            <Link to="/devices" className="text-xs text-text2 hover:text-text">Semua →</Link>
          </div>
          <table className="w-full text-xs">
            <thead><tr className="text-text2 uppercase text-[10px] border-b border-border"><th className="px-3.5 py-2 text-left">Nama</th><th className="px-3.5 py-2 text-left">IP</th><th className="px-3.5 py-2 text-left">Status</th></tr></thead>
            <tbody>
              {devices.filter((d) => d.status !== 'online').map((d) => (
                <tr key={d.id} className="border-b border-border/50">
                  <td className="px-3.5 py-2"><strong>{d.name}</strong></td>
                  <td className="px-3.5 py-2 font-mono">{d.ip}</td>
                  <td className="px-3.5 py-2"><DeviceStatusBadge status={d.status} offReason={d.off_reason} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="nw-card bg-surface border border-border rounded-[10px] overflow-hidden">
        <div className="px-4 py-3 border-b border-border flex justify-between items-center">
          <span className="text-[13px] font-semibold">🏆 Performa Teknisi</span>
          <Link to="/performa" className="text-xs text-text2 hover:text-text">Detail →</Link>
        </div>
        <div className="p-3.5 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 nw-stagger">
          {performa.map((p) => (
            <div key={p.techId} className="nw-card bg-surface2 border border-border rounded-lg p-3 text-center">
              <div className="text-2xl mb-1">{p.emoji}</div>
              <div className="text-xs font-semibold">{p.name.split(' ')[0]}</div>
              <div className="text-[10px] text-text2 mb-2">{p.jabatan}</div>
              <div className={`text-xl font-bold ${p.score >= 70 ? 'text-success' : p.score >= 40 ? 'text-warn' : 'text-danger'}`}>{p.score}</div>
              <div className="text-[9px] text-text2">Skor Performa</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
