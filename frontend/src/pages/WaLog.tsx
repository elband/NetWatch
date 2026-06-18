import { useEffect, useState } from 'react';
import { api } from '../api/client';
import { getSocket } from '../api/socket';
import type { WaLogEntry } from '../types';

const STATUS_COLOR: Record<string, string> = { sent: 'text-success', failed: 'text-danger', pending: 'text-warn' };

export default function WaLog() {
  const [log, setLog] = useState<WaLogEntry[]>([]);

  useEffect(() => {
    api.get('/wa').then((res) => setLog(res.data.waLog));
    const socket = getSocket();
    const refresh = () => api.get('/wa').then((res) => setLog(res.data.waLog));
    socket.on('wa:sent', refresh);
    socket.on('wa:failed', refresh);
    return () => {
      socket.off('wa:sent', refresh);
      socket.off('wa:failed', refresh);
    };
  }, []);

  return (
    <div>
      <div className="mb-4"><div className="text-[17px] font-bold">📲 Log WhatsApp</div></div>
      <div className="bg-surface border border-border rounded-[10px] p-4">
        {log.map((w) => (
          <div key={w.id} className="flex gap-3 py-3 border-b border-border/40 last:border-0">
            <div className="w-8 h-8 rounded-full flex items-center justify-center text-sm flex-shrink-0 bg-accent2/15">
              {w.type === 'alert' ? '🚨' : w.type === 'done' ? '✅' : '📨'}
            </div>
            <div className="flex-1">
              <div className="text-[11px] font-semibold">→ {w.to_label} <span className={`ml-2 text-[10px] ${STATUS_COLOR[w.status]}`}>{w.status}</span></div>
              <div className="text-[11px] text-text2 bg-surface2 rounded-md p-2 mt-1 whitespace-pre-line">{w.message}</div>
              {w.error && <div className="text-[10px] text-danger mt-1">Error: {w.error}</div>}
            </div>
            <div className="text-[10px] text-text2">{new Date(w.created_at).toLocaleTimeString('id')}</div>
          </div>
        ))}
        {log.length === 0 && <div className="text-center py-8 text-text2 text-xs">Belum ada log WhatsApp.</div>}
      </div>
    </div>
  );
}
