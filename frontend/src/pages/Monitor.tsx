import { useEffect, useState } from 'react';
import { api } from '../api/client';
import { getSocket } from '../api/socket';
import { DeviceStatusBadge } from '../components/StatusBadge';
import type { Device } from '../types';

function meterColor(v: number) {
  return v > 85 ? 'bg-danger' : v > 70 ? 'bg-warn' : 'bg-success';
}

export default function Monitor() {
  const [devices, setDevices] = useState<Device[]>([]);

  useEffect(() => {
    api.get('/devices').then((res) => setDevices(res.data.devices));
    const socket = getSocket();
    const onUpdate = (d: Device) => setDevices((prev) => prev.map((x) => (x.id === d.id ? { ...x, ...d } : x)));
    socket.on('device:update', onUpdate);
    return () => {
      socket.off('device:update', onUpdate);
    };
  }, []);

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <div>
          <div className="text-[17px] font-bold">📡 Live Monitor</div>
          <div className="text-[11px] text-text2 mt-0.5">Update real-time via WebSocket</div>
        </div>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {devices.map((d) => {
          const crit = d.status === 'offline';
          const warn = d.status === 'warning';
          return (
            <div
              key={d.id}
              className={`bg-surface2 border rounded-lg p-3.5 transition-colors min-w-0 ${
                crit ? 'border-danger/50' : warn ? 'border-warn/40' : 'border-border'
              }`}
            >
              <div className="flex justify-between items-start gap-2 mb-2.5">
                <div className="min-w-0">
                  <div className="text-xs font-semibold truncate">{d.name}</div>
                  <div className="text-[10px] text-text2 font-mono truncate">{d.ip} · {d.type}</div>
                </div>
                <div className="flex-shrink-0"><DeviceStatusBadge status={d.status} offReason={d.off_reason} monitorEnabled={d.monitor_enabled} underMaintenance={d.under_maintenance} /></div>
              </div>
              {d.status !== 'offline' ? (
                <>
                  {[['CPU', d.cpu], ['RAM', d.mem]].map(([label, val]) => (
                    <div key={label as string} className="mb-1.5">
                      <div className="flex justify-between text-[10px] text-text2 mb-0.5"><span>{label}</span><span>{val}%</span></div>
                      <div className="h-1 bg-border rounded-full overflow-hidden"><div className={`h-full ${meterColor(val as number)}`} style={{ width: `${val}%` }} /></div>
                    </div>
                  ))}
                  <div className="mb-1.5">
                    <div className="flex justify-between text-[10px] text-text2 mb-0.5"><span>Ping</span><span>{d.ping_ms}ms</span></div>
                    <div className="h-1 bg-border rounded-full overflow-hidden">
                      <div className={`h-full ${d.ping_ms > 50 ? 'bg-danger' : d.ping_ms > 20 ? 'bg-warn' : 'bg-success'}`} style={{ width: `${Math.min(d.ping_ms * 2, 100)}%` }} />
                    </div>
                  </div>
                </>
              ) : (
                <div className="text-center py-4 text-danger text-xs">⚠️ Tidak Merespons</div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
