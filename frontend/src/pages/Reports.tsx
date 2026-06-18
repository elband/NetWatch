import { useEffect, useState } from 'react';
import { api } from '../api/client';
import { PriorityBadge } from '../components/StatusBadge';
import type { Incident } from '../types';

export default function Reports() {
  const [incidents, setIncidents] = useState<Incident[]>([]);
  useEffect(() => {
    api.get('/incidents?status=selesai').then((res) => setIncidents(res.data.incidents));
  }, []);

  return (
    <div>
      <div className="mb-4">
        <div className="text-[17px] font-bold">📋 Laporan Selesai</div>
        <div className="text-[11px] text-text2 mt-0.5">{incidents.length} insiden diselesaikan</div>
      </div>
      <div className="bg-surface border border-border rounded-[10px] overflow-x-auto">
        <table className="w-full text-xs">
          <thead><tr className="text-text2 uppercase text-[10px] border-b border-border">
            {['ID', 'Perangkat', 'Masalah', 'Prioritas', 'Selesai', 'Durasi'].map((h) => <th key={h} className="px-3.5 py-2.5 text-left">{h}</th>)}
          </tr></thead>
          <tbody>
            {incidents.map((i) => (
              <tr key={i.id} className="border-b border-border/50">
                <td className="px-3.5 py-2.5 font-mono text-accent2 text-[10px]">{i.id}</td>
                <td className="px-3.5 py-2.5"><strong>{i.device_name}</strong></td>
                <td className="px-3.5 py-2.5 text-text2">{i.issue}</td>
                <td className="px-3.5 py-2.5"><PriorityBadge priority={i.priority} /></td>
                <td className="px-3.5 py-2.5 text-text2 text-[11px]">{i.resolved_at || '-'}</td>
                <td className="px-3.5 py-2.5 text-success font-mono">{i.duration_min ? `${i.duration_min}m` : '-'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
