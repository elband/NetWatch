import { useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api } from '../api/client';
import { IncidentStatusBadge, PriorityBadge } from '../components/StatusBadge';
import IncidentReportModal from '../components/IncidentReportModal';
import ProgressUpdateModal from '../components/ProgressUpdateModal';
import InviteCollabModal from '../components/InviteCollabModal';
import IncidentDetailModal from '../components/IncidentDetailModal';
import { downtimeMs, fmtDowntime, downtimeColor } from '../utils/downtime';
import { nextStepLabel } from '../utils/steps';
import { useShiftWindows, shiftLabel } from '../utils/shifts';
import type { Incident, IncidentQueue, Device } from '../types';

export default function MyIncidents() {
  const shiftWindows = useShiftWindows(); // jam dinas dinamis per-unit
  const [queue, setQueue] = useState<IncidentQueue | null>(null);
  const [selected, setSelected] = useState<Incident | null>(null);
  const [reportFor, setReportFor] = useState<Incident | null>(null);
  const [progressFor, setProgressFor] = useState<Incident | null>(null);
  const [inviteFor, setInviteFor] = useState<Incident | null>(null);
  const [devices, setDevices] = useState<Device[]>([]);
  const [taking, setTaking] = useState<string | null>(null);
  const [err, setErr] = useState('');
  const [now, setNow] = useState(() => Date.now());
  const [searchParams, setSearchParams] = useSearchParams();
  const focusId = searchParams.get('focus');
  const focusAction = searchParams.get('action');
  const lastAutoTake = useRef<string | null>(null);

  function load() {
    api.get('/incidents/queue').then((res) => setQueue(res.data));
  }
  useEffect(load, []);

  // Klik link "AMBIL" dari notifikasi WA (?focus=INC-…&action=take) — ambil otomatis.
  useEffect(() => {
    if (!focusId || focusAction !== 'take' || !queue || lastAutoTake.current === focusId) return;
    lastAutoTake.current = focusId;
    const inPool = queue.pool.find((i) => i.id === focusId);
    if (inPool) {
      take(focusId);
    } else {
      const mineInc = queue.mine.find((i) => i.id === focusId);
      if (mineInc) setSelected(mineInc);
    }
    setSearchParams((p) => { p.delete('action'); return p; }, { replace: true });
  }, [queue, focusId, focusAction]);
  useEffect(() => {
    api.get('/devices').then((res) => setDevices(res.data.devices));
  }, []);
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30000);
    return () => clearInterval(t);
  }, []);

  async function take(id: string) {
    setTaking(id);
    setErr('');
    try {
      await api.post(`/incidents/${id}/take`);
      load();
    } catch (e: any) {
      setErr(e?.response?.data?.error || 'Gagal mengambil insiden.');
    } finally {
      setTaking(null);
    }
  }
  async function toggleSparepart(id: string, value: boolean) {
    await api.put(`/incidents/${id}/awaiting-part`, { value });
    load();
    setSelected((cur) => cur && cur.id === id ? { ...cur, awaiting_part: value ? 1 : 0 } : cur);
  }

  const duty = queue?.duty;
  const pool = queue?.pool || [];
  const mine = queue?.mine || [];
  const mineActive = mine.filter((i) => i.status !== 'selesai');

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <div className="text-[17px] font-bold">⚠️ Insiden Saya</div>
        <button onClick={load} className="text-xs text-text2 hover:text-text border border-border rounded px-2.5 py-1">⟳ Muat ulang</button>
      </div>

      {/* Banner status on-duty */}
      <div className={`rounded-[10px] border px-4 py-3 mb-4 flex items-center gap-3 ${duty?.onDuty ? 'bg-success/10 border-success/30' : 'bg-warn/10 border-warn/30'}`}>
        <span className="relative flex h-2.5 w-2.5">
          {duty?.onDuty && <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-success opacity-75" />}
          <span className={`relative inline-flex rounded-full h-2.5 w-2.5 ${duty?.onDuty ? 'bg-success' : 'bg-warn'}`} />
        </span>
        <div className="text-xs">
          {duty?.onDuty ? (
            <><span className="font-semibold text-success">Anda sedang ON-DUTY</span>{duty.shift && <span className="text-text2"> · Shift {shiftLabel(duty.shift, shiftWindows)}</span>}<span className="text-text2"> — silakan ambil insiden dari pool di bawah.</span></>
          ) : (
            <><span className="font-semibold text-warn">Anda sedang TIDAK on-duty</span><span className="text-text2"> — insiden pool hanya bisa diambil saat jadwal dinas Anda aktif.</span></>
          )}
        </div>
      </div>

      {err && <div className="bg-danger/10 border border-danger/30 rounded-md px-3 py-2 text-xs text-danger mb-3">⚠️ {err}</div>}

      {/* Pool insiden belum diambil */}
      <div className="mb-5">
        <div className="text-[13px] font-semibold mb-2">📥 Pool Insiden (belum diambil) <span className="text-text2 font-normal">· {pool.length}</span></div>
        {pool.length === 0 ? (
          <div className="bg-surface border border-border rounded-[10px] p-6 text-center text-text2 text-xs">✅ Tidak ada insiden di pool.</div>
        ) : (
          <div className="bg-surface border border-border rounded-[10px] overflow-x-auto">
            <table className="w-full text-xs">
              <thead><tr className="text-text2 uppercase text-[10px] border-b border-border">
                {['ID', 'Perangkat', 'Masalah', 'Prioritas', 'Terputus', 'Masuk', 'Aksi'].map((h) => <th key={h} className="px-3.5 py-2.5 text-left">{h}</th>)}
              </tr></thead>
              <tbody>
                {pool.map((i) => (
                  <tr key={i.id} className="border-b border-border/50">
                    <td className="px-3.5 py-2.5 font-mono text-accent2 text-[10px]">{i.id}</td>
                    <td className="px-3.5 py-2.5"><strong>{i.device_name}</strong></td>
                    <td className="px-3.5 py-2.5 text-text2 max-w-[180px]">{i.issue}</td>
                    <td className="px-3.5 py-2.5"><PriorityBadge priority={i.priority} /></td>
                    <td className={`px-3.5 py-2.5 font-mono font-semibold ${downtimeColor(i, downtimeMs(i, now))}`}>⏱️ {fmtDowntime(downtimeMs(i, now))}</td>
                    <td className="px-3.5 py-2.5 text-text2 font-mono text-[10px]">{i.created_at}</td>
                    <td className="px-3.5 py-2.5">
                      <div className="flex gap-1.5">
                        <button className="text-text2 hover:text-text border border-border rounded px-2 py-0.5 text-xs" onClick={() => setSelected(i)}>Detail →</button>
                        <button
                          disabled={!duty?.onDuty || taking === i.id}
                          title={duty?.onDuty ? '' : 'Hanya bisa saat on-duty'}
                          className="bg-accent text-bg rounded px-2.5 py-1 font-semibold disabled:opacity-40 disabled:cursor-not-allowed"
                          onClick={() => take(i.id)}
                        >
                          {taking === i.id ? '…' : '✋ Ambil'}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Insiden milik sendiri */}
      <div>
        <div className="text-[13px] font-semibold mb-2">🔧 Saya Tangani <span className="text-text2 font-normal">· {mineActive.length} aktif</span></div>
        {mine.length === 0 ? (
          <div className="bg-surface border border-border rounded-[10px] p-6 text-center text-text2 text-xs">Belum ada insiden yang Anda ambil.</div>
        ) : (
          <div className="bg-surface border border-border rounded-[10px] overflow-x-auto">
            <table className="w-full text-xs">
              <thead><tr className="text-text2 uppercase text-[10px] border-b border-border">
                {['ID', 'Perangkat', 'Masalah', 'Prioritas', 'Terputus', 'Status', 'Aksi'].map((h) => <th key={h} className="px-3.5 py-2.5 text-left">{h}</th>)}
              </tr></thead>
              <tbody>
                {mine.map((i) => (
                  <tr key={i.id} className="border-b border-border/50">
                    <td className="px-3.5 py-2.5 font-mono text-accent2 text-[10px]">{i.id}</td>
                    <td className="px-3.5 py-2.5"><strong>{i.device_name}</strong></td>
                    <td className="px-3.5 py-2.5 text-text2 max-w-[180px]">{i.issue}</td>
                    <td className="px-3.5 py-2.5"><PriorityBadge priority={i.priority} /></td>
                    <td className={`px-3.5 py-2.5 font-mono font-semibold ${downtimeColor(i, downtimeMs(i, now))}`}>⏱️ {fmtDowntime(downtimeMs(i, now))}</td>
                    <td className="px-3.5 py-2.5"><IncidentStatusBadge status={i.status} /></td>
                    <td className="px-3.5 py-2.5">
                      <div className="flex gap-1.5 flex-wrap">
                        <button className="text-text2 hover:text-text border border-border rounded px-2 py-0.5" onClick={() => setSelected(i)}>Detail →</button>
                        <button className={`border rounded px-2 py-0.5 ${i.report ? 'text-success border-success/40' : 'text-accent2 border-accent2/40'}`} onClick={() => setReportFor(i)}>
                          {i.report ? '📝 Laporan ✓' : '📝 Laporan'}
                        </button>
                        {i.status !== 'selesai' && devices.find((d) => d.id === i.device_id)?.ssh_username && (
                          <Link to={`/ssh?device=${i.device_id}&incident=${i.id}`} className="border border-accent2/40 text-accent2 rounded px-2 py-0.5" title="Remote SSH Virtual">🖥️ SSH</Link>
                        )}
                        {i.status !== 'selesai' && (
                          <button className={`border rounded px-2 py-0.5 ${i.awaiting_part ? 'text-warn border-warn/40 bg-warn/10' : 'text-text2 border-border'}`} onClick={() => toggleSparepart(i.id, !i.awaiting_part)}>
                            📦 {i.awaiting_part ? 'Sparepart ✓' : 'Tunggu Sparepart'}
                          </button>
                        )}
                        {i.status !== 'selesai' && (
                          <button className="bg-accent/10 text-accent border border-accent/30 rounded px-2 py-0.5" onClick={() => setProgressFor(i)}>
                            ▶ {nextStepLabel(i)}
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {selected && (
        <IncidentDetailModal
          incident={selected}
          now={now}
          devices={devices}
          onClose={() => setSelected(null)}
          onProgress={() => { setProgressFor(selected); setSelected(null); }}
          onReport={() => { setReportFor(selected); setSelected(null); }}
          onInvite={() => { setInviteFor(selected); setSelected(null); }}
          onToggleSparepart={() => toggleSparepart(selected.id, !selected.awaiting_part)}
        />
      )}

      {reportFor && (
        <IncidentReportModal
          incident={reportFor}
          onClose={() => setReportFor(null)}
          onSaved={() => load()}
        />
      )}

      {progressFor && (
        <ProgressUpdateModal
          incident={progressFor}
          onClose={() => setProgressFor(null)}
          onDone={load}
        />
      )}

      {inviteFor && (
        <InviteCollabModal
          incident={inviteFor}
          onClose={() => setInviteFor(null)}
          onDone={(inc) => {
            setQueue((q) => q ? {
              ...q,
              mine: q.mine.map((i) => i.id === inc.id ? { ...i, collaborators: inc.collaborators } : i),
            } : q);
          }}
        />
      )}
    </div>
  );
}
