import type { DeviceStatus, IncidentStatus } from '../types';

const COLORS: Record<string, string> = {
  online: 'text-success bg-success/10',
  offline: 'text-danger bg-danger/10',
  warning: 'text-warn bg-warn/10',
};

export function DeviceStatusBadge({ status, offReason, monitorEnabled, underMaintenance }: { status: DeviceStatus; offReason?: string | null; monitorEnabled?: number; underMaintenance?: number | boolean }) {
  // Jendela maintenance terjadwal: tampil khas (oranye), bukan alarm.
  if (underMaintenance) {
    return (
      <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[10px] font-semibold text-amber-400 bg-amber-500/15" title="Dalam jendela maintenance terjadwal — tidak memicu insiden/alarm">
        🔧 MAINTENANCE
      </span>
    );
  }
  // Perangkat dimatikan (via tombol Matikan / padam jam malam): monitoring dijeda, tidak dialarmkan.
  if (offReason === 'dimatikan') {
    return (
      <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[10px] font-semibold text-slate-300 bg-slate-500/15"
        title={monitorEnabled === 0 ? 'Peralatan dimatikan — monitoring dijeda, tidak dialarmkan' : 'Padam pada jam malam — tidak dialarmkan'}>
        🌙 DIMATIKAN
      </span>
    );
  }
  // Mode standby (monitoring dijeda manual): tampil netral, bukan status ping lama.
  if (monitorEnabled === 0) {
    return (
      <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[10px] font-semibold text-slate-300 bg-slate-500/15" title="Mode standby — tidak dimonitor otomatis">
        ⏸️ STANDBY
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
