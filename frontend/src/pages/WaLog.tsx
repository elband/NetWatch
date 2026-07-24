import { useEffect, useState } from 'react';
import { api } from '../api/client';
import { getSocket } from '../api/socket';
import type { WaLogEntry } from '../types';

const STATUS_COLOR: Record<string, string> = { sent: 'text-success', failed: 'text-danger', pending: 'text-warn' };

export default function WaLog() {
  const [log, setLog] = useState<WaLogEntry[]>([]);
  const [phone, setPhone] = useState('');
  const [testBusy, setTestBusy] = useState(false);
  const [testMsg, setTestMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const refresh = () => api.get('/wa').then((res) => setLog(res.data.waLog));

  useEffect(() => {
    refresh();
    const socket = getSocket();
    socket.on('wa:sent', refresh);
    socket.on('wa:failed', refresh);
    return () => {
      socket.off('wa:sent', refresh);
      socket.off('wa:failed', refresh);
    };
  }, []);

  async function sendTest() {
    setTestBusy(true); setTestMsg(null);
    try {
      await api.post('/wa/test', { phone: phone.trim() || undefined });
      setTestMsg({ ok: true, text: 'Pesan test diantrikan. Lihat statusnya di log di bawah.' });
      setPhone('');
      refresh();
    } catch (e: any) {
      setTestMsg({ ok: false, text: e?.response?.data?.error || 'Gagal mengirim pesan test.' });
    } finally {
      setTestBusy(false);
      setTimeout(() => setTestMsg(null), 6000);
    }
  }

  return (
    <div>
      <div className="mb-4 flex items-center justify-between flex-wrap gap-2">
        <div className="text-[17px] font-bold">📲 Log WhatsApp</div>
        <div className="flex items-center gap-2">
          <input
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !testBusy) sendTest(); }}
            placeholder="08xx (kosong = nomor Anda)"
            className="bg-surface2 border border-border rounded-md px-3 py-1.5 text-xs w-52 focus:outline-none focus:border-accent"
          />
          <button onClick={sendTest} disabled={testBusy} className="bg-accent text-bg rounded-md px-3 py-1.5 text-xs font-semibold disabled:opacity-50">
            {testBusy ? 'Mengirim…' : '🧪 Kirim Test'}
          </button>
        </div>
      </div>
      {testMsg && (
        <div className={`mb-3 text-xs rounded-md px-3 py-2 border ${testMsg.ok ? 'text-success border-success/40 bg-success/10' : 'text-danger border-danger/40 bg-danger/10'}`}>
          {testMsg.text}
        </div>
      )}
      <div className="bg-surface border border-border rounded-[10px] p-4">
        {log.map((w) => (
          <div key={w.id} className="flex gap-3 py-3 border-b border-border/40 last:border-0">
            <div className="w-8 h-8 rounded-full flex items-center justify-center text-sm flex-shrink-0 bg-accent2/15">
              {w.type === 'alert' ? '⚠️' : w.type === 'done' ? '✅' : '📨'}
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
