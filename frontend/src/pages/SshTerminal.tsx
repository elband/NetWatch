import { useEffect, useRef, useState } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import { api } from '../api/client';
import { getSshSocket } from '../api/socket';
import type { Device } from '../types';

const params = () => new URLSearchParams(window.location.search);

export default function SshTerminal() {
  const [devices, setDevices] = useState<Device[]>([]);
  const [deviceId, setDeviceId] = useState<number | null>(null);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [connected, setConnected] = useState(false);
  const [incidentId] = useState<string | null>(() => params().get('incident'));
  const [comment, setComment] = useState('');
  const [savingNote, setSavingNote] = useState(false);
  const [noteMsg, setNoteMsg] = useState('');
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const socketRef = useRef<ReturnType<typeof getSshSocket> | null>(null);

  useEffect(() => {
    api.get('/devices').then((res) => {
      setDevices(res.data.devices);
      const wanted = Number(new URLSearchParams(window.location.search).get('device'));
      if (wanted && res.data.devices.some((d: Device) => d.id === wanted)) {
        setDeviceId(wanted);
        const dev = res.data.devices.find((d: Device) => d.id === wanted);
        if (dev?.ssh_username) setUsername(dev.ssh_username);
      }
    });
  }, []);

  function connect() {
    if (!deviceId || !containerRef.current) return;
    const term = new Terminal({ theme: { background: '#0d1117' }, fontSize: 13 });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(containerRef.current);
    fit.fit();
    termRef.current = term;

    const socket = getSshSocket();
    socketRef.current = socket;

    socket.on('connect', () => {
      socket.emit('ssh:connect', { deviceId, username, password });
    });
    socket.on('ssh:ready', () => {
      setConnected(true);
      term.writeln('\x1b[32mConnected.\x1b[0m');
    });
    socket.on('ssh:data', (data: string) => term.write(data));
    socket.on('ssh:error', (msg: string) => term.writeln(`\x1b[31mError: ${msg}\x1b[0m`));
    socket.on('ssh:closed', () => {
      setConnected(false);
      term.writeln('\x1b[33mConnection closed.\x1b[0m');
    });

    term.onData((data) => socket.emit('ssh:input', data));
  }

  function disconnect() {
    socketRef.current?.disconnect();
    termRef.current?.dispose();
    setConnected(false);
  }

  async function saveComment() {
    if (!incidentId || !comment.trim()) return;
    setSavingNote(true);
    setNoteMsg('');
    try {
      await api.post(`/incidents/${incidentId}/note`, { note: comment.trim(), source: 'ssh' });
      setComment('');
      setNoteMsg('✓ Catatan tersimpan ke insiden ' + incidentId);
    } catch (e: any) {
      setNoteMsg(e?.response?.data?.error || 'Gagal menyimpan catatan.');
    } finally {
      setSavingNote(false);
      setTimeout(() => setNoteMsg(''), 4000);
    }
  }

  useEffect(() => () => disconnect(), []);

  return (
    <div>
      <div className="mb-4"><div className="text-[17px] font-bold">💻 SSH Terminal</div></div>
      {!connected && (
        <div className="bg-surface border border-border rounded-[10px] p-4 mb-3 flex gap-2 items-end flex-wrap">
          <select className="bg-surface2 border border-border rounded-md px-3 py-2 text-xs" value={deviceId ?? ''} onChange={(e) => setDeviceId(Number(e.target.value))}>
            <option value="">Pilih perangkat...</option>
            {devices.map((d) => <option key={d.id} value={d.id}>{d.name} ({d.ip})</option>)}
          </select>
          <input className="bg-surface2 border border-border rounded-md px-3 py-2 text-xs" placeholder="Username" value={username} onChange={(e) => setUsername(e.target.value)} />
          <input type="password" className="bg-surface2 border border-border rounded-md px-3 py-2 text-xs" placeholder="Password" value={password} onChange={(e) => setPassword(e.target.value)} />
          <button className="bg-accent text-bg rounded-md px-3 py-2 text-xs font-semibold" onClick={connect} disabled={!deviceId}>Hubungkan</button>
        </div>
      )}
      {connected && (
        <button className="mb-2 border border-border text-text2 rounded-md px-3 py-1.5 text-xs" onClick={disconnect}>Putuskan Koneksi</button>
      )}
      <div ref={containerRef} className="bg-[#0d1117] border border-border rounded-[10px] p-2 h-[420px]" />

      {incidentId && (
        <div className="bg-surface border border-border rounded-[10px] p-4 mt-3">
          <div className="text-xs font-semibold mb-2">💻 Komentar Teknisi · tersimpan ke insiden <span className="font-mono text-accent2">{incidentId}</span></div>
          <textarea
            className="w-full bg-surface2 border border-border rounded-md px-3 py-2 text-xs min-h-[80px] outline-none focus:border-accent"
            placeholder="Tulis apa yang dilakukan/ditemukan saat remote SSH…"
            value={comment}
            onChange={(e) => setComment(e.target.value)}
          />
          <div className="flex items-center gap-3 mt-2">
            <button
              className="bg-accent text-bg rounded-md px-3 py-1.5 text-xs font-semibold disabled:opacity-50"
              onClick={saveComment}
              disabled={savingNote || !comment.trim()}
            >
              {savingNote ? 'Menyimpan…' : 'Simpan Catatan'}
            </button>
            {noteMsg && <span className="text-[11px] text-text2">{noteMsg}</span>}
          </div>
        </div>
      )}
    </div>
  );
}
