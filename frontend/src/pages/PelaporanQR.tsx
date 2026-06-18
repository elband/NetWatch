import { useEffect, useRef, useState } from 'react';
import QRCode from 'qrcode';
import { api } from '../api/client';
import type { Room, QrStats } from '../types';

const publicUrl = (kode: string) => `${location.origin}/lapor?room=${encodeURIComponent(kode)}`;
const DOT: Record<string, string> = { hijau: '#22c55e', kuning: '#eab308', merah: '#ef4444' };

export default function PelaporanQR() {
  const [stats, setStats] = useState<QrStats | null>(null);
  const [rooms, setRooms] = useState<Room[]>([]);
  const [edit, setEdit] = useState<Room | null | 'new'>(null);
  const [qrRoom, setQrRoom] = useState<Room | null>(null);
  const [bulk, setBulk] = useState(false);

  function load() {
    api.get('/rooms/stats').then((r) => setStats(r.data)).catch(() => {});
    api.get('/rooms').then((r) => setRooms(r.data.rooms)).catch(() => {});
  }
  useEffect(load, []);

  function demo() {
    const r = rooms.find((x) => x.active) || rooms[0];
    if (r) window.open(publicUrl(r.kode), '_blank');
    else alert('Tambahkan ruangan dulu untuk demo.');
  }

  const Stat = ({ l, v, c }: { l: string; v: number | string; c: string }) => (
    <div className="bg-surface border border-border rounded-xl p-3.5"><div className="text-[11px] text-text2">{l}</div><div className="text-[22px] font-extrabold mt-0.5" style={{ color: c }}>{v}</div></div>
  );

  return (
    <div>
      <div className="flex items-center justify-between mb-4 gap-2 flex-wrap">
        <div className="text-[17px] font-bold">📱 Pelaporan Fasilitas QR</div>
        <div className="flex items-center gap-2">
          <button onClick={demo} className="bg-accent2 text-bg rounded-md px-3 py-1.5 text-xs font-semibold">🎬 Demo Scan QR</button>
          <button onClick={() => setBulk(true)} className="border border-border text-text2 hover:text-white rounded-md px-3 py-1.5 text-xs">⚡ Bulk Ruangan</button>
          <button onClick={() => setEdit('new')} className="bg-accent text-bg rounded-md px-3 py-1.5 text-xs font-semibold">+ Tambah Ruangan</button>
        </div>
      </div>

      {stats && (<>
        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-3 mb-3">
          <Stat l="Laporan Hari Ini" v={stats.stats.hariIni} c="#60a5fa" />
          <Stat l="Laporan Bulan Ini" v={stats.stats.bulanIni} c="#a78bfa" />
          <Stat l="Tiket Menunggu" v={stats.stats.menunggu} c="#eab308" />
          <Stat l="Tiket Diproses" v={stats.stats.diproses} c="#f97316" />
          <Stat l="Tiket Selesai" v={stats.stats.selesai} c="#22c55e" />
          <Stat l="SLA" v={`${stats.stats.sla}%`} c="#14b8a6" />
          <Stat l="MTTR" v={`${stats.stats.mttr}m`} c="#60a5fa" />
        </div>
        <div className="bg-gradient-to-br from-accent/10 to-accent2/8 border border-accent/25 rounded-xl p-3.5 mb-4 text-[12px]"><b>🤖 AI Insight:</b> <span className="text-text2">{stats.insight}</span></div>

        <div className="grid lg:grid-cols-[1fr_300px] gap-4 mb-4">
          {/* Peta indikator lokasi */}
          <div className="bg-surface border border-border rounded-xl p-4">
            <div className="text-[12px] font-semibold mb-3">🗺️ Status Lokasi <span className="text-text2 font-normal">· 🟢 Normal · 🟡 Gangguan · 🔴 Kritis</span></div>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              {stats.peta.map((p) => (
                <div key={p.id} className="border border-border rounded-lg p-2.5 flex items-center gap-2" style={{ borderColor: `${DOT[p.indikator]}55` }}>
                  <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: DOT[p.indikator], boxShadow: `0 0 6px ${DOT[p.indikator]}` }} />
                  <div className="min-w-0"><div className="text-[11px] font-semibold truncate">{p.nama}</div><div className="text-[9px] text-text2 truncate">{p.gedung} · {p.area}</div></div>
                </div>
              ))}
            </div>
          </div>
          <div className="space-y-4">
            <div className="bg-surface border border-border rounded-xl p-4"><div className="text-[11px] font-semibold mb-2">📍 Lokasi Terbanyak Melapor</div>{stats.topLokasi.map((l, i) => <div key={i} className="flex justify-between text-[11px] py-0.5"><span className="truncate">{l.lokasi}</span><span className="text-text2">{l.jumlah}</span></div>)}{!stats.topLokasi.length && <div className="text-text2 text-[11px]">-</div>}</div>
            <div className="bg-surface border border-border rounded-xl p-4"><div className="text-[11px] font-semibold mb-2">🔧 Kategori Terbanyak</div>{stats.topKategori.map((c, i) => <div key={i} className="flex justify-between text-[11px] py-0.5"><span className="truncate">{c.kategori}</span><span className="text-text2">{c.jumlah}</span></div>)}{!stats.topKategori.length && <div className="text-text2 text-[11px]">-</div>}</div>
          </div>
        </div>
      </>)}

      {/* Master Ruangan */}
      <div className="text-[13px] font-bold mb-2">🏢 Master Ruangan ({rooms.length})</div>
      <div className="bg-surface border border-border rounded-[10px] overflow-x-auto">
        <table className="w-full text-xs"><thead><tr className="text-text2 uppercase text-[10px] border-b border-border">
          {['Kode', 'Nama Ruangan', 'Gedung', 'Lantai', 'Area', 'PJ', 'Laporan', 'Status', 'Aksi'].map((h) => <th key={h} className="px-3 py-2.5 text-left">{h}</th>)}
        </tr></thead><tbody>
          {rooms.map((r) => (
            <tr key={r.id} className="border-b border-border/50">
              <td className="px-3 py-2.5 font-mono text-[10px]">{r.kode}</td>
              <td className="px-3 py-2.5 font-semibold">{r.nama}</td>
              <td className="px-3 py-2.5 text-text2">{r.gedung || '-'}</td>
              <td className="px-3 py-2.5 text-text2">{r.lantai || '-'}</td>
              <td className="px-3 py-2.5 text-text2">{r.area || '-'}</td>
              <td className="px-3 py-2.5 text-text2">{r.penanggung_jawab || '-'}</td>
              <td className="px-3 py-2.5 text-center">{r.total_laporan || 0}{(r.gangguan_aktif || 0) > 0 && <span className="text-danger"> ·{r.gangguan_aktif}⚠️</span>}</td>
              <td className="px-3 py-2.5">{r.active ? <span className="text-[10px] text-success">● Aktif</span> : <span className="text-[10px] text-text2">Nonaktif</span>}</td>
              <td className="px-3 py-2.5"><div className="flex gap-1.5 flex-wrap">
                <button onClick={() => setQrRoom(r)} className="border border-accent2/40 text-accent2 rounded px-2 py-0.5 text-[10px]">📱 QR</button>
                <button onClick={() => setEdit(r)} className="border border-border text-text2 rounded px-2 py-0.5 text-[10px]">✏️</button>
              </div></td>
            </tr>
          ))}
          {rooms.length === 0 && <tr><td colSpan={9} className="px-3 py-6 text-center text-text2">Belum ada ruangan.</td></tr>}
        </tbody></table>
      </div>

      {edit && <RoomForm room={edit === 'new' ? null : edit} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); load(); }} />}
      {qrRoom && <QrModal room={qrRoom} onClose={() => setQrRoom(null)} />}
      {bulk && <BulkModal onClose={() => setBulk(false)} onSaved={() => { setBulk(false); load(); }} rooms={rooms} />}
    </div>
  );
}

const inp = 'w-full bg-surface2 border border-border rounded-md px-3 py-2 text-xs';
function RoomForm({ room, onClose, onSaved }: { room: Room | null; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState({ kode: room?.kode || '', nama: room?.nama || '', gedung: room?.gedung || '', lantai: room?.lantai || '', area: room?.area || '', penanggung_jawab: room?.penanggung_jawab || '', active: room ? !!room.active : true });
  const [locs, setLocs] = useState<string[]>([]);
  const [busy, setBusy] = useState(false); const [err, setErr] = useState('');
  useEffect(() => { api.get('/locations').then((r) => setLocs((r.data.locations || []).map((l: any) => l.name))).catch(() => {}); }, []);
  async function save() {
    if (!f.nama.trim()) return setErr('Nama ruangan wajib.');
    setBusy(true); setErr('');
    try { if (room) await api.put(`/rooms/${room.id}`, f); else await api.post('/rooms', f); onSaved(); }
    catch (e: any) { setErr(e?.response?.data?.error || 'Gagal.'); } finally { setBusy(false); }
  }
  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-surface border border-border rounded-xl w-full max-w-md p-5" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-sm font-bold mb-4">🏢 {room ? 'Edit' : 'Tambah'} Ruangan</h3>
        <label className="block text-[11px] text-text2 mb-1">Kode Ruangan {room ? '' : '(kosongkan = otomatis)'}</label>
        <input className={`${inp} mb-3`} value={f.kode} disabled={!!room} onChange={(e) => setF({ ...f, kode: e.target.value })} placeholder="mis. RUANG-NOC" />
        <label className="block text-[11px] text-text2 mb-1">Nama Ruangan *</label>
        <input className={`${inp} mb-3`} value={f.nama} onChange={(e) => setF({ ...f, nama: e.target.value })} />
        <label className="block text-[11px] text-text2 mb-1">Gedung / Lokasi (sesuai penanda di Peta)</label>
        <select className={`${inp} mb-2`} value={f.gedung} onChange={(e) => setF({ ...f, gedung: e.target.value })}>
          <option value="">— pilih lokasi —</option>
          {locs.map((l) => <option key={l} value={l}>{l}</option>)}
          {f.gedung && !locs.includes(f.gedung) && <option value={f.gedung}>{f.gedung} (lama)</option>}
        </select>
        <div className="grid grid-cols-2 gap-2 mb-3">
          <input className={inp} value={f.lantai} onChange={(e) => setF({ ...f, lantai: e.target.value })} placeholder="Lantai" />
          <input className={inp} value={f.area} onChange={(e) => setF({ ...f, area: e.target.value })} placeholder="Area" />
        </div>
        <input className={`${inp} mb-3`} value={f.penanggung_jawab} onChange={(e) => setF({ ...f, penanggung_jawab: e.target.value })} placeholder="Penanggung Jawab" />
        {room && <label className="flex items-center gap-2 text-[11px] mb-3"><input type="checkbox" checked={f.active} onChange={(e) => setF({ ...f, active: e.target.checked })} /> Aktif</label>}
        {err && <div className="bg-danger/10 border border-danger/30 rounded-md px-3 py-2 text-[11px] text-danger mb-3">⚠️ {err}</div>}
        <div className="flex gap-2 justify-end"><button className="border border-border text-text2 rounded-md px-3 py-1.5 text-xs" onClick={onClose}>Batal</button><button className="bg-accent text-bg rounded-md px-3 py-1.5 text-xs font-semibold disabled:opacity-50" onClick={save} disabled={busy}>{busy ? '…' : 'Simpan'}</button></div>
      </div>
    </div>
  );
}

function QrModal({ room, onClose }: { room: Room; onClose: () => void }) {
  const [url, setUrl] = useState('');
  const ref = useRef<HTMLImageElement>(null);
  useEffect(() => { QRCode.toDataURL(publicUrl(room.kode), { width: 320, margin: 2 }).then(setUrl).catch(() => {}); }, [room]);
  function download() { const a = document.createElement('a'); a.href = url; a.download = `QR-${room.kode}.png`; a.click(); }
  function print() {
    const w = window.open('', '_blank', 'width=820,height=1100'); if (!w) return;
    const lokasi = [room.gedung, room.lantai, room.area].filter(Boolean).join(' · ');
    // Ilustrasi flat: teknisi IT sedang bekerja di samping server rack.
    const teknisiSvg = `<svg viewBox="0 0 420 230" width="100%" style="max-width:420px">
      <ellipse cx="210" cy="206" rx="190" ry="20" fill="#e0f2fe"/>
      <!-- server rack -->
      <rect x="280" y="56" width="92" height="150" rx="9" fill="#1e293b"/>
      <rect x="289" y="66" width="74" height="20" rx="3" fill="#334155"/><circle cx="353" cy="76" r="3.2" fill="#22c55e"/><circle cx="343" cy="76" r="3.2" fill="#38bdf8"/>
      <rect x="289" y="92" width="74" height="20" rx="3" fill="#334155"/><circle cx="353" cy="102" r="3.2" fill="#22c55e"/><circle cx="343" cy="102" r="3.2" fill="#f59e0b"/>
      <rect x="289" y="118" width="74" height="20" rx="3" fill="#334155"/><circle cx="353" cy="128" r="3.2" fill="#22c55e"/><circle cx="343" cy="128" r="3.2" fill="#38bdf8"/>
      <rect x="289" y="144" width="74" height="20" rx="3" fill="#334155"/><circle cx="353" cy="154" r="3.2" fill="#22c55e"/>
      <!-- wifi/sinyal -->
      <g stroke="#22d3ee" stroke-width="3.5" fill="none" stroke-linecap="round"><path d="M300 44 q12 -12 24 0"/><path d="M294 38 q18 -18 36 0"/></g><circle cx="312" cy="50" r="3" fill="#22d3ee"/>
      <!-- meja + laptop -->
      <rect x="44" y="172" width="150" height="9" rx="3" fill="#94a3b8"/>
      <rect x="78" y="146" width="74" height="46" rx="4" fill="#0ea5e9"/><rect x="84" y="151" width="62" height="33" rx="2" fill="#e0f7ff"/>
      <rect x="70" y="190" width="90" height="6" rx="3" fill="#64748b"/>
      <!-- teknisi -->
      <g>
        <rect x="150" y="120" width="58" height="64" rx="20" fill="#2563eb"/>            <!-- badan/seragam -->
        <rect x="166" y="128" width="10" height="22" rx="2" fill="#fff" opacity=".85"/>   <!-- id card -->
        <circle cx="179" cy="100" r="20" fill="#f5c9a6"/>                                  <!-- kepala -->
        <path d="M159 96 q20 -26 40 0 q-8 -8 -20 -8 q-12 0 -20 8" fill="#3f3a36"/>          <!-- rambut -->
        <rect x="116" y="150" width="46" height="13" rx="6" fill="#2563eb" transform="rotate(-14 139 156)"/> <!-- lengan ke laptop -->
        <circle cx="120" cy="158" r="7" fill="#f5c9a6"/>
        <rect x="158" y="184" width="44" height="34" rx="6" fill="#1e3a8a"/>               <!-- kaki -->
      </g>
      <!-- gear -->
      <g transform="translate(232,40)" fill="#38bdf8"><circle r="9"/><circle r="4" fill="#fff"/></g>
    </svg>`;
    w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>Pamflet QR ${room.kode}</title>
      <style>*{-webkit-print-color-adjust:exact;print-color-adjust:exact;box-sizing:border-box}
      @page{size:A4 portrait;margin:0}
      body{font-family:'Segoe UI',Arial,sans-serif;margin:0;color:#0f172a}
      .page{width:210mm;min-height:297mm;margin:0 auto;padding:16mm 14mm;display:flex;flex-direction:column;align-items:center;text-align:center;background:#fff}
      .band{width:100%;background:linear-gradient(135deg,#2563eb,#06b6d4);color:#fff;border-radius:18px;padding:18px;display:flex;align-items:center;gap:14px;justify-content:center}
      .band .logo{width:54px;height:54px;border-radius:14px;background:rgba(255,255,255,.18);display:flex;align-items:center;justify-content:center;font-size:30px}
      .band h1{margin:0;font-size:22px;letter-spacing:.5px}.band p{margin:2px 0 0;font-size:12px;opacity:.9}
      .judul{font-size:40px;font-weight:900;color:#1e3a8a;margin:22px 0 4px;line-height:1.05}
      .sub{font-size:16px;color:#475569;margin:0 0 6px}
      .qrcard{background:#fff;border:3px solid #1e3a8a;border-radius:24px;padding:20px;margin:14px 0;box-shadow:0 8px 24px rgba(0,0,0,.08)}
      .qrcard img{width:300px;height:300px;display:block}
      .scan{display:inline-block;background:#22c55e;color:#fff;font-weight:800;font-size:17px;padding:8px 22px;border-radius:30px;margin-bottom:6px}
      .room{font-size:26px;font-weight:800;margin:4px 0 0}.loc{font-size:14px;color:#475569}.kode{font-family:monospace;font-size:13px;color:#64748b;margin-top:4px}
      .steps{display:flex;gap:10px;width:100%;margin:22px 0 0}
      .step{flex:1;background:#f1f5f9;border-radius:14px;padding:12px 8px}
      .step .n{width:26px;height:26px;border-radius:50%;background:#2563eb;color:#fff;font-weight:800;display:flex;align-items:center;justify-content:center;margin:0 auto 6px;font-size:13px}
      .step .t{font-size:12px;color:#334155;line-height:1.3}
      .foot{margin-top:auto;padding-top:18px;color:#94a3b8;font-size:11px}</style></head><body>
      <div class="page">
        <div class="band"><div class="logo">📡</div><div><h1>UNIT ELEKTRONIKA BANDARA</h1><p>A.P.T. PRANOTO · SAMARINDA · Helpdesk IT</p></div></div>
        <div class="judul">ADA GANGGUAN?<br>LAPOR DI SINI 📲</div>
        <div class="sub">Pindai QR di bawah dengan kamera HP Anda — tanpa aplikasi, tanpa login.</div>
        ${teknisiSvg}
        <div class="scan">📱 SCAN QR INI</div>
        <div class="qrcard"><img src="${url}"></div>
        <div class="room">${room.nama}</div>
        <div class="loc">${lokasi}</div>
        <div class="kode">Kode: ${room.kode}</div>
        <div class="steps">
          <div class="step"><div class="n">1</div><div class="t">Pindai QR Code</div></div>
          <div class="step"><div class="n">2</div><div class="t">Isi form gangguan + foto</div></div>
          <div class="step"><div class="n">3</div><div class="t">Tiket otomatis ke teknisi</div></div>
          <div class="step"><div class="n">4</div><div class="t">Pantau status via WhatsApp</div></div>
        </div>
        <div class="foot">Laporan Anda langsung diteruskan ke tim teknisi on-duty Unit Elektronika Bandara · A.P.T. Pranoto Samarinda</div>
      </div></body></html>`);
    w.document.close(); w.focus(); setTimeout(() => w.print(), 400);
  }
  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-surface border border-border rounded-xl w-full max-w-xs p-5 text-center" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-sm font-bold mb-1">{room.nama}</h3>
        <div className="text-[11px] text-text2 mb-3">{room.gedung} · {room.lantai} · {room.area}</div>
        {url ? <img ref={ref} src={url} className="w-48 h-48 mx-auto bg-white rounded-lg p-2" /> : <div className="text-text2 text-xs py-10">Membuat QR…</div>}
        <div className="font-mono text-[10px] text-text2 mt-2">{room.kode}</div>
        <div className="flex gap-2 justify-center mt-4">
          <button onClick={download} className="border border-border text-text2 rounded-md px-3 py-1.5 text-xs">⬇️ Download</button>
          <button onClick={print} className="bg-accent text-bg rounded-md px-3 py-1.5 text-xs font-semibold">🖨️ Cetak</button>
          <button onClick={() => window.open(publicUrl(room.kode), '_blank')} className="border border-accent2/40 text-accent2 rounded-md px-3 py-1.5 text-xs">👁️ Tes</button>
        </div>
      </div>
    </div>
  );
}

function BulkModal({ onClose, onSaved, rooms }: { onClose: () => void; onSaved: () => void; rooms: Room[] }) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false); const [msg, setMsg] = useState('');
  async function save() {
    const list = text.split('\n').map((l) => l.split(',').map((x) => x.trim())).filter((p) => p[0]).map((p) => ({ nama: p[0], gedung: p[1] || '', lantai: p[2] || '', area: p[3] || '' }));
    if (!list.length) return setMsg('Masukkan minimal satu baris.');
    setBusy(true);
    try { const r = await api.post('/rooms/bulk', { rooms: list }); setMsg(`${r.data.created} ruangan dibuat.`); setTimeout(onSaved, 800); }
    catch (e: any) { setMsg(e?.response?.data?.error || 'Gagal.'); } finally { setBusy(false); }
  }
  async function printAll() {
    const items = await Promise.all(rooms.filter((r) => r.active).map(async (r) => ({ r, url: await QRCode.toDataURL(publicUrl(r.kode), { width: 200, margin: 1 }) })));
    const w = window.open('', '_blank'); if (!w) return;
    const cells = items.map(({ r, url }) => `<div style="border:1px solid #333;border-radius:8px;padding:10px;text-align:center;break-inside:avoid"><div style="font-size:10px;color:#0a5">SCAN LAPOR GANGGUAN</div><b style="font-size:12px">${r.nama}</b><div style="font-size:9px;color:#555">${r.gedung || ''} ${r.area || ''}</div><img src="${url}" style="width:150px;height:150px"><div style="font-family:monospace;font-size:9px;color:#555">${r.kode}</div></div>`).join('');
    w.document.write(`<!doctype html><html><head><title>QR Ruangan</title></head><body style="font-family:Arial"><div style="display:grid;grid-template-columns:repeat(3,1fr);gap:10px;padding:12px">${cells}</div></body></html>`);
    w.document.close(); w.focus(); setTimeout(() => w.print(), 500);
  }
  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-surface border border-border rounded-xl w-full max-w-md p-5" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-sm font-bold mb-2">⚡ Bulk Ruangan & QR</h3>
        <button onClick={printAll} className="w-full border border-accent2/40 text-accent2 rounded-md px-3 py-2 text-xs font-semibold mb-3">🖨️ Cetak Semua QR (1 halaman)</button>
        <div className="text-[11px] text-text2 mb-1">Tambah massal — satu ruangan per baris: <code>Nama, Gedung, Lantai, Area</code></div>
        <textarea className={`${inp} min-h-[120px] font-mono`} value={text} onChange={(e) => setText(e.target.value)} placeholder={'Ruang Genset, Terminal, Lantai 1, Utilitas\nToilet Pria, Terminal, Lantai 1, Publik'} />
        {msg && <div className="text-[11px] text-accent2 mt-2">{msg}</div>}
        <div className="flex gap-2 justify-end mt-3"><button className="border border-border text-text2 rounded-md px-3 py-1.5 text-xs" onClick={onClose}>Tutup</button><button className="bg-accent text-bg rounded-md px-3 py-1.5 text-xs font-semibold disabled:opacity-50" onClick={save} disabled={busy}>{busy ? '…' : 'Buat'}</button></div>
      </div>
    </div>
  );
}
