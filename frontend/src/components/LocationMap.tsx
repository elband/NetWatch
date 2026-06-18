import type { LocationItem } from '../types';

export default function LocationMap({
  mapUrl,
  locations,
  editable = false,
  selectedId = null,
  onPlace,
}: {
  mapUrl: string;
  locations: LocationItem[];
  editable?: boolean;
  selectedId?: number | null;
  onPlace?: (id: number, x: number, y: number) => void;
}) {
  function handleClick(e: React.MouseEvent<HTMLDivElement>) {
    if (!editable || !onPlace || !selectedId) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const x = Math.round(((e.clientX - rect.left) / rect.width) * 1000) / 10;
    const y = Math.round(((e.clientY - rect.top) / rect.height) * 1000) / 10;
    onPlace(selectedId, Math.max(0, Math.min(100, x)), Math.max(0, Math.min(100, y)));
  }

  return (
    <div
      className="relative w-full rounded-lg overflow-hidden border border-border bg-surface2"
      style={{ cursor: editable ? 'crosshair' : 'default' }}
      onClick={handleClick}
    >
      <img src={mapUrl} alt="Peta lokasi" className="w-full block select-none" draggable={false} />
      {locations
        .filter((l) => l.map_x != null && l.map_y != null)
        .map((l) => {
          const active = l.active_count > 0;
          return (
            <div
              key={l.id}
              style={{ left: `${l.map_x}%`, top: `${l.map_y}%` }}
              className={`absolute -translate-x-1/2 -translate-y-1/2 flex flex-col items-center ${editable && selectedId === l.id ? 'z-20' : 'z-10'}`}
              title={`${l.name} · ${l.active_count} insiden aktif`}
            >
              <div className={`relative flex items-center justify-center rounded-full border-2 text-[11px] font-bold shadow ${active ? 'bg-danger/90 border-white text-white' : 'bg-surface border-accent2 text-accent2'} ${editable && selectedId === l.id ? 'ring-2 ring-accent' : ''}`} style={{ width: 28, height: 28 }}>
                {active && <span className="absolute inline-flex h-full w-full rounded-full bg-danger opacity-60 animate-ping" />}
                <span className="relative">{active ? l.active_count : l.icon}</span>
              </div>
              <span className="mt-0.5 text-[9px] font-semibold px-1 rounded bg-black/60 text-white whitespace-nowrap">{l.name}</span>
            </div>
          );
        })}
    </div>
  );
}
