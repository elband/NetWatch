import { useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import type { LocationItem } from '../types';

// Pusat default (area bandara) saat belum ada lokasi ber-koordinat.
const DEFAULT_CENTER: [number, number] = [-0.371, 117.257];

/**
 * Peta lokasi gangguan — peta LIVE interaktif (citra satelit Esri, zoom/geser/klik).
 * Marker ditaruh memakai koordinat GPS asli (lat/lng) tiap lokasi. Mode editable:
 * klik peta → kirim lat/lng lokasi terpilih lewat onPlace.
 */
export default function LocationMap({
  locations,
  editable = false,
  selectedId = null,
  onPlace,
}: {
  mapUrl?: string | null; // tidak dipakai lagi (peta live), dipertahankan utk kompatibilitas pemanggil
  locations: LocationItem[];
  editable?: boolean;
  selectedId?: number | null;
  onPlace?: (id: number, lat: number, lng: number) => void;
}) {
  const elRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const layerRef = useRef<L.LayerGroup | null>(null);
  const fittedRef = useRef(false);

  const onPlaceRef = useRef(onPlace);
  const editRef = useRef(editable);
  const selRef = useRef(selectedId);
  onPlaceRef.current = onPlace;
  editRef.current = editable;
  selRef.current = selectedId;

  // Init peta sekali.
  useEffect(() => {
    if (!elRef.current || mapRef.current) return;
    const map = L.map(elRef.current, { center: DEFAULT_CENTER, zoom: 15, zoomControl: false, scrollWheelZoom: true });
    L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
      maxZoom: 19, attribution: 'Tiles © Esri',
    }).addTo(map);
    L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}', {
      maxZoom: 19, opacity: 0.9,
    }).addTo(map);
    L.control.zoom({ position: 'bottomright' }).addTo(map);
    layerRef.current = L.layerGroup().addTo(map);
    mapRef.current = map;

    // Mode penempatan: klik peta → kirim GPS lokasi terpilih.
    map.on('click', (e: L.LeafletMouseEvent) => {
      if (!editRef.current || !onPlaceRef.current || !selRef.current) return;
      onPlaceRef.current(selRef.current, Number(e.latlng.lat.toFixed(7)), Number(e.latlng.lng.toFixed(7)));
    });

    const ro = new ResizeObserver(() => map.invalidateSize());
    ro.observe(elRef.current);
    setTimeout(() => map.invalidateSize(), 0);
    return () => { ro.disconnect(); map.remove(); mapRef.current = null; };
  }, []);

  // Gambar ulang marker saat data / mode berubah.
  useEffect(() => {
    const map = mapRef.current, layer = layerRef.current;
    if (!map || !layer) return;
    layer.clearLayers();
    const pts: [number, number][] = [];
    for (const l of locations) {
      if (l.lat == null || l.lng == null) continue;
      const lat = Number(l.lat), lng = Number(l.lng);
      pts.push([lat, lng]);
      const active = Number(l.active_count) > 0;
      const sel = editable && selectedId === l.id;
      const name = l.name.replace(/</g, '&lt;');
      const circle = active
        ? 'background:var(--color-danger);border-color:#fff;color:#fff;'
        : 'background:var(--color-surface);border-color:var(--color-accent2);color:var(--color-accent2);';
      const icon = L.divIcon({
        className: 'loc-pin',
        html: `<div class="loc-pin-wrap">
            <div class="loc-pin-dot${sel ? ' loc-pin-sel' : ''}" style="${circle}">
              ${active ? '<span class="loc-pin-ping"></span>' : ''}
              <span style="position:relative">${active ? l.active_count : (l.icon || '📍')}</span>
            </div>
            <span class="loc-pin-label">${name}</span>
          </div>`,
        iconSize: [0, 0],
        iconAnchor: [0, 0],
      });
      // Saat editable, marker non-interaktif agar klik penempatan tak terhalang.
      const m = L.marker([lat, lng], { icon, interactive: !editable });
      if (!editable) {
        m.bindPopup(
          `<div style="font-family:system-ui;font-size:12px;line-height:1.5">
            <b>${name}</b><br>${active ? `<b style="color:var(--color-danger)">${l.active_count} insiden aktif</b>` : 'Tidak ada insiden aktif'}
          </div>`
        );
      }
      m.addTo(layer);
    }
    // Fit ke semua titik sekali saat pertama tersedia.
    if (!fittedRef.current && pts.length) {
      if (pts.length === 1) map.setView(pts[0], 16);
      else map.fitBounds(L.latLngBounds(pts).pad(0.25));
      fittedRef.current = true;
    }
  }, [locations, editable, selectedId]);

  return (
    <>
      <style>{`
        .loc-pin .loc-pin-wrap { position: relative; transform: translate(-50%, -50%); }
        .loc-pin .loc-pin-dot { position: relative; width: 28px; height: 28px; border-radius: 9999px; border: 2px solid; display: flex; align-items: center; justify-content: center; font: 700 11px/1 system-ui, sans-serif; box-shadow: 0 1px 4px rgba(0,0,0,.5); }
        .loc-pin .loc-pin-sel { outline: 2px solid var(--color-accent); outline-offset: 1px; }
        .loc-pin .loc-pin-ping { position: absolute; inset: -2px; border-radius: 9999px; background: var(--color-danger); opacity: .55; animation: loc-ping 1.4s cubic-bezier(0,0,.2,1) infinite; }
        .loc-pin .loc-pin-label { position: absolute; top: 30px; left: 50%; transform: translateX(-50%); padding: 1px 5px; border-radius: 4px; font: 600 9px/1.4 system-ui, sans-serif; background: rgba(0,0,0,.6); color: #fff; white-space: nowrap; }
        @keyframes loc-ping { 75%, 100% { transform: scale(2.1); opacity: 0; } }
        .loc-edit .leaflet-container { cursor: crosshair; }
      `}</style>
      <div
        ref={elRef}
        className={`w-full rounded-lg overflow-hidden border border-border bg-surface2 relative z-0 isolate ${editable ? 'loc-edit' : ''}`}
        style={{ height: '60vh', minHeight: 320 }}
      />
    </>
  );
}
