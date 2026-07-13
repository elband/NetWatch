import { useEffect, useMemo, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { api } from '../api/client';
import { getSocket } from '../api/socket';
import type { Device } from '../types';

// Warna marker per status (selaras token tema).
function statusColor(d: Device): string {
  if (d.monitor_enabled === 0) return '#94a3b8'; // standby
  if (d.under_maintenance) return '#f59e0b';       // maintenance
  if (d.status === 'online') return '#3fb950';
  if (d.status === 'warning') return '#d29922';
  return '#f85149';                                 // offline
}
function statusLabel(d: Device): string {
  if (d.monitor_enabled === 0) return 'Standby';
  if (d.under_maintenance) return 'Maintenance';
  if (d.status === 'offline' && d.off_reason === 'poweroff') return 'Dimatikan (peralatan)';
  if (d.status === 'offline' && d.off_reason === 'dimatikan') return 'Dimatikan (jam malam)';
  return d.status.charAt(0).toUpperCase() + d.status.slice(1);
}

// Koordinat efektif perangkat: GPS sendiri bila ada, jika tidak mewarisi titik
// lokasi yang di-tag (pin lokasi di peta gangguan jadi koordinat perangkat).
function effLatLng(d: Device): [number, number] | null {
  const lat = d.lat != null ? Number(d.lat) : (d.location_lat != null ? Number(d.location_lat) : null);
  const lng = d.lng != null ? Number(d.lng) : (d.location_lng != null ? Number(d.location_lng) : null);
  return lat != null && lng != null && !Number.isNaN(lat) && !Number.isNaN(lng) ? [lat, lng] : null;
}
// Posisi berasal dari tag lokasi (bukan GPS perangkat sendiri).
function fromLocation(d: Device): boolean {
  return (d.lat == null || d.lng == null) && d.location_lat != null && d.location_lng != null;
}

export default function DeviceMap() {
  const [devices, setDevices] = useState<Device[]>([]);
  const mapEl = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const layerRef = useRef<L.LayerGroup | null>(null);
  const fittedRef = useRef(false);

  const withGps = useMemo(() => devices.filter((d) => effLatLng(d) != null), [devices]);
  const noGps = useMemo(() => devices.filter((d) => effLatLng(d) == null), [devices]);

  // Init peta sekali — citra satelit (Esri World Imagery) agar selaras dengan
  // tampilan "Peta Lokasi Gangguan", + lapisan label nama tempat/jalan.
  useEffect(() => {
    if (!mapEl.current || mapRef.current) return;
    const map = L.map(mapEl.current, { center: [-2.5, 118], zoom: 5, scrollWheelZoom: true });
    L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
      maxZoom: 19, attribution: 'Tiles © Esri',
    }).addTo(map);
    L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}', {
      maxZoom: 19, opacity: 0.9,
    }).addTo(map);
    layerRef.current = L.layerGroup().addTo(map);
    mapRef.current = map;
    return () => { map.remove(); mapRef.current = null; };
  }, []);

  // Muat data + real-time.
  useEffect(() => {
    api.get('/devices').then((res) => setDevices(res.data.devices)).catch(() => {});
    const socket = getSocket();
    const onUpdate = (d: Device) => setDevices((prev) => prev.map((x) => (x.id === d.id ? { ...x, ...d } : x)));
    socket.on('device:update', onUpdate);
    return () => { socket.off('device:update', onUpdate); };
  }, []);

  // Gambar ulang marker saat data berubah.
  useEffect(() => {
    const map = mapRef.current, layer = layerRef.current;
    if (!map || !layer) return;
    layer.clearLayers();
    const pts: [number, number][] = [];
    // Sebar marker yang berbagi koordinat identik (mis. beberapa perangkat di
    // satu titik GPS) dalam lingkaran kecil agar semuanya tampak & bisa diklik.
    const seen = new Map<string, number>();
    for (const d of withGps) {
      const c0 = effLatLng(d)!;
      let lat = c0[0], lng = c0[1];
      const key = `${lat.toFixed(6)},${lng.toFixed(6)}`;
      const idx = seen.get(key) ?? 0;
      seen.set(key, idx + 1);
      if (idx > 0) {
        const ang = idx * 2.39996; // sudut emas → sebaran merata
        const rad = 0.00012 * Math.ceil(idx / 6); // ~13m, melebar tiap 6 marker
        lat += rad * Math.cos(ang);
        lng += rad * Math.sin(ang);
      }
      pts.push([lat, lng]);
      const color = statusColor(d);
      // Status butuh perhatian → titik berdenyut (selaras peta gangguan).
      const alert = d.monitor_enabled !== 0 && !d.under_maintenance &&
        (d.status === 'offline' || d.status === 'warning');
      const safeName = d.name.replace(/</g, '&lt;');
      const icon = L.divIcon({
        className: 'dev-pin',
        html: `<div class="dev-pin-wrap">
            <span class="dev-pin-dot" style="background:${color}">${alert ? '<span class="dev-pin-pulse" style="background:' + color + '"></span>' : ''}</span>
            <span class="dev-pin-label">${safeName}</span>
          </div>`,
        iconSize: [0, 0],
        iconAnchor: [0, 0],
      });
      L.marker([lat, lng], { icon })
        .bindPopup(
          `<div style="font-family:system-ui;font-size:12px;line-height:1.5">
            <b>${d.name}</b><br>
            <span style="font-family:monospace">${d.ip}</span> · ${d.type}<br>
            ${d.loc ? `📍 ${d.loc}${fromLocation(d) ? ' <span style="color:#8b949e">(posisi dari titik lokasi)</span>' : ''}<br>` : ''}
            Status: <b style="color:${color}">${statusLabel(d)}</b><br>
            Ping: ${d.ping_ms ? `${d.ping_ms} ms` : '–'}
          </div>`
        )
        .addTo(layer);
    }
    // Fit bounds sekali saat marker pertama tersedia.
    if (!fittedRef.current && pts.length) {
      if (pts.length === 1) map.setView(pts[0], 15);
      else map.fitBounds(L.latLngBounds(pts).pad(0.3));
      fittedRef.current = true;
    }
  }, [withGps]);

  const counts = useMemo(() => {
    const c = { online: 0, warning: 0, offline: 0, other: 0 };
    for (const d of withGps) {
      if (d.monitor_enabled === 0 || d.under_maintenance) c.other++;
      else if (d.status === 'online') c.online++;
      else if (d.status === 'warning') c.warning++;
      else c.offline++;
    }
    return c;
  }, [withGps]);

  return (
    <div>
      <style>{`
        .dev-pin .dev-pin-wrap { position: relative; display: flex; flex-direction: column; align-items: center; transform: translate(-50%, -50%); pointer-events: auto; }
        .dev-pin .dev-pin-dot { position: relative; width: 16px; height: 16px; border-radius: 9999px; border: 2px solid #fff; box-shadow: 0 1px 4px rgba(0,0,0,.6); }
        .dev-pin .dev-pin-pulse { position: absolute; inset: -2px; border-radius: 9999px; opacity: .55; animation: dev-pin-ping 1.5s cubic-bezier(0,0,.2,1) infinite; }
        .dev-pin .dev-pin-label { margin-top: 3px; padding: 1px 6px; border-radius: 4px; font: 600 10px/1.4 system-ui, sans-serif; color: #fff; background: rgba(0,0,0,.62); white-space: nowrap; }
        @keyframes dev-pin-ping { 75%, 100% { transform: scale(2.2); opacity: 0; } }
      `}</style>
      <div className="flex items-center justify-between mb-4 gap-3 flex-wrap">
        <div>
          <div className="text-[17px] font-bold">🗺️ Peta Perangkat</div>
          <div className="text-[11px] text-text2 mt-0.5">Sebaran geografis & status real-time per lokasi</div>
        </div>
        <div className="flex items-center gap-3 text-[11px] flex-wrap">
          <Legend color="#3fb950" label={`Online ${counts.online}`} />
          <Legend color="#d29922" label={`Warning ${counts.warning}`} />
          <Legend color="#f85149" label={`Offline ${counts.offline}`} />
          <Legend color="#f59e0b" label="Maintenance" />
          <Legend color="#94a3b8" label="Standby" />
        </div>
      </div>

      {/* isolate: kurung stacking context Leaflet (pane/kontrol z 400–1000) agar
          tidak menimpa header, menu profil, notifikasi & modal app (z ≤ 45). */}
      <div ref={mapEl} className="w-full rounded-[10px] border border-border overflow-hidden relative z-0 isolate" style={{ height: '62vh', background: 'var(--color-surface2)' }} />

      {withGps.length === 0 && (
        <div className="mt-3 bg-surface border border-border rounded-[10px] px-4 py-3 text-[12px] text-text2">
          Belum ada perangkat dengan koordinat. <b>Tag perangkat ke Lokasi</b> (yang sudah punya titik di peta) — atau isi <b>Latitude/Longitude</b> pada pengaturan perangkat — agar muncul di peta.
        </div>
      )}

      {noGps.length > 0 && (
        <div className="mt-3 bg-surface border border-border rounded-[10px] p-3">
          <div className="text-[11px] font-semibold text-text2 mb-2">⚠️ {noGps.length} perangkat tanpa koordinat & tanpa tag lokasi (tidak tampil di peta)</div>
          <div className="flex flex-wrap gap-1.5">
            {noGps.map((d) => (
              <span key={d.id} className="px-2 py-0.5 rounded bg-surface2 border border-border text-[10px]">
                <span className="inline-block w-1.5 h-1.5 rounded-full mr-1 align-middle" style={{ background: statusColor(d) }} />
                {d.name}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="inline-block w-2.5 h-2.5 rounded-full" style={{ background: color }} />
      <span className="text-text2">{label}</span>
    </span>
  );
}
