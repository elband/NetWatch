import type { DeviceStatus, IncidentStatus } from '../types';

const COLORS: Record<string, string> = {
  online: 'text-success bg-success/10',
  offline: 'text-danger bg-danger/10',
  warning: 'text-warn bg-warn/10',
};

export function DeviceStatusBadge({ status, offReason }: { status: DeviceStatus; offReason?: string | null }) {
  // Perangkat dimatikan (bukan gangguan): tampil netral, bukan alarm merah.
  if (status === 'offline' && offReason === 'dimatikan') {
    return (
      <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[10px] font-semibold text-slate-300 bg-slate-500/15" title="Padam terjadwal (jam malam) — tidak dialarmkan">
        🌙 DIMATIKAN
      </span>
    );
  }
  return (
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[10px] font-semibold uppercase ${COLORS[status]}`}>
      <span className="w-1.5 h-1.5 rounded-full bg-current" />
      {status}
    </span>
  );
}

const INC_MAP: Record<IncidentStatus, DeviceStatus> = { aktif: 'offline', proses: 'warning', selesai: 'online' };
export function IncidentStatusBadge({ status }: { status: IncidentStatus }) {
  return <DeviceStatusBadge status={INC_MAP[status]} />;
}

const PRIORITY_COLORS: Record<string, string> = {
  kritis: 'text-danger bg-danger/15',
  tinggi: 'text-warn bg-warn/15',
  sedang: 'text-accent2 bg-accent2/15',
};
export function PriorityBadge({ priority }: { priority: string }) {
  return (
    <span className={`inline-block px-2 py-0.5 rounded text-[10px] font-bold uppercase ${PRIORITY_COLORS[priority] || ''}`}>
      {priority}
    </span>
  );
}
