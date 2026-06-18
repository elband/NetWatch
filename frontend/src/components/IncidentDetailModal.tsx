import { Link } from 'react-router-dom';
import { IncidentStatusBadge, PriorityBadge } from './StatusBadge';
import { downtimeMs, fmtDowntime, downtimeColor } from '../utils/downtime';
import { stepLabels as getStepLabels, maxStep as getMaxStep } from '../utils/steps';
import type { Incident, Device } from '../types';

interface Props {
  incident: Incident;
  now: number;
  devices?: Device[];
  onClose: () => void;
  onProgress?: () => void;
  onReport?: () => void;
  onInvite?: () => void;
  onResolve?: () => void;
  onToggleSparepart?: () => void;
}

export default function IncidentDetailModal({
  incident: inc,
  now,
  devices,
  onClose,
  onProgress,
  onReport,
  onInvite,
  onResolve,
  onToggleSparepart,
}: Props) {
  const stepLabels = getStepLabels(inc);
  const maxStep = getMaxStep(inc);
  const device = devices?.find((d) => d.id === inc.device_id);
  const remotable = !!device?.ssh_username;

  return (
    <div
      className="fixed inset-0 bg-black/70 flex items-center justify-center z-[200]"
      onClick={onClose}
    >
      <div
        className="bg-surface border border-border rounded-xl p-6 w-[560px] max-w-[95vw] max-h-[85vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex justify-between items-center mb-4">
          <span className="text-[15px] font-bold">{inc.id} — {inc.device_name}</span>
          <button onClick={onClose} className="text-text2 hover:text-white">✕</button>
        </div>

        {/* Badges */}
        <div className="flex gap-2 items-center mb-3.5 flex-wrap">
          <PriorityBadge priority={inc.priority} />
          <IncidentStatusBadge status={inc.status} />
          <span className="text-[11px] text-text2">{inc.created_at}</span>
        </div>

        {/* Issue info */}
        <div className="bg-surface2 border border-border rounded-lg p-3 mb-3.5 text-xs">
          <strong>Masalah:</strong> {inc.issue}<br />
          <span className="text-text2">IP: {inc.ip || '-'}</span><br />
          <span className={downtimeColor(inc, downtimeMs(inc, now))}>
            ⏱️ Jam terputus: <strong>{fmtDowntime(downtimeMs(inc, now))}</strong>
            {inc.status !== 'selesai' && ' (berjalan)'}
          </span>
          {inc.resolved_at && (
            <><br /><span className="text-success">Selesai: {inc.resolved_at} · Durasi: {inc.duration_min} menit</span></>
          )}
        </div>

        {/* Step progress */}
        <div className="flex gap-1 mb-1.5">
          {stepLabels.slice(1).map((_, idx) => (
            <div
              key={idx}
              className={`flex-1 h-1.5 rounded ${
                idx + 1 < inc.step ? 'bg-success' : idx + 1 === inc.step ? 'bg-warn' : 'bg-border'
              }`}
            />
          ))}
        </div>
        <div className="text-[10px] text-text2 mb-3.5">
          Langkah {inc.step}/{maxStep} — {stepLabels[inc.step]}
        </div>

        {/* Collaborators */}
        {inc.collaborators && inc.collaborators.length > 0 && (
          <div className="bg-accent2/5 border border-accent2/20 rounded-lg p-2.5 mb-3.5 text-[11px]">
            <span className="text-text2">👥 Dikerjakan bersama: </span>
            {inc.collaborators.map((c) => `${c.emoji || ''} ${c.name}`).join(', ')}
          </div>
        )}

        {/* Kronologi */}
        <div className="text-xs font-semibold mb-2">📋 Kronologi</div>
        <div className="border-l-2 border-border pl-3.5 mb-3.5">
          {inc.notes.length === 0 ? (
            <div className="text-[11px] text-text2 italic">Belum ada catatan.</div>
          ) : (
            inc.notes.map((n) => (
              <div key={n.id} className="mb-2.5">
                <div className="text-[10px] text-accent font-mono">
                  {n.created_at} · {stepLabels[n.step] || `Step ${n.step}`}
                </div>
                <div className="text-[11px] text-text2">{n.note}</div>
                {n.doc_url && (
                  <a href={n.doc_url} target="_blank" rel="noreferrer" className="inline-block mt-1">
                    <img src={n.doc_url} alt="dokumentasi" className="max-h-24 rounded border border-border object-contain" />
                  </a>
                )}
              </div>
            ))
          )}
        </div>

        {/* Action buttons */}
        <div className="flex gap-2 flex-wrap">
          {inc.status !== 'selesai' && onProgress && (
            <button
              className="bg-accent text-bg rounded-md px-3 py-1.5 text-xs font-medium"
              onClick={onProgress}
            >
              ▶ {stepLabels[Math.min(inc.step + 1, maxStep)]}
            </button>
          )}
          {inc.status !== 'selesai' && remotable && device && (
            <Link
              to={`/ssh?device=${device.id}&incident=${inc.id}`}
              className="bg-accent/10 text-accent border border-accent/30 rounded-md px-3 py-1.5 text-xs font-medium"
            >
              🖥️ SSH
            </Link>
          )}
          {inc.status !== 'selesai' && onToggleSparepart && (
            <button
              className={`border rounded-md px-3 py-1.5 text-xs font-medium ${
                inc.awaiting_part
                  ? 'text-warn border-warn/40 bg-warn/10'
                  : 'text-text2 border-border hover:text-white'
              }`}
              onClick={onToggleSparepart}
            >
              📦 {inc.awaiting_part ? 'Sparepart ✓' : 'Tunggu Sparepart'}
            </button>
          )}
          {inc.status !== 'selesai' && onResolve && (
            <button
              className="bg-success/10 text-success border border-success/30 rounded-md px-3 py-1.5 text-xs font-medium"
              onClick={onResolve}
            >
              ✅ Tutup Insiden
            </button>
          )}
          {onReport && (
            <button
              className="bg-accent2/10 text-accent2 border border-accent2/30 rounded-md px-3 py-1.5 text-xs font-medium"
              onClick={onReport}
            >
              {inc.report ? '📝 Lihat/Edit Laporan' : '📝 Laporan Kerusakan & Perbaikan'}
            </button>
          )}
          {inc.status !== 'selesai' && onInvite && (
            <button
              className="bg-accent2/10 text-accent2 border border-accent2/30 rounded-md px-3 py-1.5 text-xs font-medium"
              onClick={onInvite}
            >
              👥 Ajak Teknisi
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
