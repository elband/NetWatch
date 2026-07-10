// ============================================================================
// FIDS (Flight Information Display System) — proxy jadwal penerbangan bandara.
//
// Menarik data dari API FIDS eksternal (Laravel, paginasi terkunci 5/halaman) untuk
// panel "Penerbangan" di Command Center/Wallboard. Base URL di env.fids.baseUrl (.env).
//
// Desain:
//   • stale-while-revalidate: getFids() SELALU sinkron & instan (kembalikan cache),
//     memicu refresh latar bila kadaluarsa — jadi endpoint /noc/public yang di-poll
//     tiap 5 dtk TIDAK pernah terblokir menunggu API luar.
//   • Tahan gagal: timeout per-request, tak pernah throw; saat API luar mati cache
//     lama dipertahankan (ok:false) agar wallboard tidak berkedip kosong.
//   • API luar dihit paling sering 1×/TTL (60 dtk) berapa pun jumlah pemanggil.
// ============================================================================
import { env } from '../config/env.js';

const TTL_MS = 60_000;        // segarkan cache tiap 60 dtk
const REQ_TIMEOUT_MS = 8000;  // batas waktu tiap request ke FIDS
const MAX_PAGES = 12;         // pengaman anti-loop paginasi

let cache = { departures: [], arrivals: [], updatedAt: 0, ok: false };
let refreshing = false;

function headers() {
  const h = { Accept: 'application/json' };
  if (env.fids.apiKey) h[env.fids.apiKeyHeader] = env.fids.apiKey;
  return h;
}

async function fetchJson(url) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), REQ_TIMEOUT_MS);
  try {
    const r = await fetch(url, { headers: headers(), signal: ctrl.signal });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return await r.json();
  } finally { clearTimeout(t); }
}

// Ambil SEMUA halaman satu jenis (kind='keberangkatan'|'kedatangan') → gabung result.data.
// Server mengunci per_page=5 (mengabaikan ?per_page), jadi kita telusuri page=1..last_page.
async function fetchAll(kind) {
  const base = `${env.fids.baseUrl}/api/transaksi/${kind}`;
  const out = [];
  let page = 1, last = 1;
  do {
    const j = await fetchJson(`${base}?page=${page}`);
    const result = j?.data?.result;
    if (!result || !Array.isArray(result.data)) break;
    out.push(...result.data);
    last = Number(result.last_page) || 1;
    page++;
  } while (page <= last && page <= MAX_PAGES);
  return out;
}

// Ringkas satu record penerbangan → hanya field yang dipakai panel wallboard.
function normalize(f, dir) {
  const b = (dir === 'dep' ? f.bandara_tujuan : f.bandara_asal) || {};
  const gate = f.gate?.nama && f.gate.nama !== '-' ? f.gate.nama : '';
  return {
    id: f.id,
    dir,                                            // 'dep' (berangkat) | 'arr' (datang)
    flight: f.pesawat?.kode_penerbangan || '',      // "IW-1486"
    airline: f.maskapai?.nama || '',                // "Wings Air"
    time: f.jam || '',                              // "08:47"
    date: f.tanggal || '',
    city: b.kota_provinsi || b.nama || '',          // kota tujuan/asal
    iata: b.iata || '',                             // "BEJ" / "SUB"
    airport: b.nama || '',
    status: f.remark?.status || '',                 // "Departured On-Time"
    gate: dir === 'dep' ? gate : '',
    counter: dir === 'dep' ? (Number(f.konter) || null) : null,
    conveyor: dir === 'arr' ? (Number(f.conveyor) || null) : null,
    reason: f.reason?.deskripsi && f.reason.deskripsi !== '---' ? f.reason.deskripsi : '',
  };
}

async function refresh() {
  if (refreshing || !env.fids.baseUrl) return;
  refreshing = true;
  try {
    const [dep, arr] = await Promise.all([fetchAll('keberangkatan'), fetchAll('kedatangan')]);
    const byTime = (a, b) => String(a.time).localeCompare(String(b.time));
    cache = {
      departures: dep.map((f) => normalize(f, 'dep')).sort(byTime),
      arrivals: arr.map((f) => normalize(f, 'arr')).sort(byTime),
      updatedAt: Date.now(),
      ok: true,
    };
  } catch {
    // Pertahankan data lama; hanya tandai stale supaya wallboard tak berkedip kosong.
    cache = { ...cache, ok: false };
  } finally {
    refreshing = false;
  }
}

// Dipakai route: sinkron & instan. null bila FIDS tak dikonfigurasi (panel disembunyikan).
export function getFids() {
  if (!env.fids.baseUrl) return null;
  if (Date.now() - cache.updatedAt > TTL_MS && !refreshing) refresh(); // fire-and-forget
  return { departures: cache.departures, arrivals: cache.arrivals, updatedAt: cache.updatedAt || null, ok: cache.ok };
}

// Hangatkan cache saat server start agar poll pertama sudah berisi (tanpa memblokir import).
if (env.fids.baseUrl) refresh();
