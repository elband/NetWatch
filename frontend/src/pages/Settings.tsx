import { useEffect, useRef, useState } from 'react';
import { api } from '../api/client';
import { confirmDialog } from '../components/dialog';

const LKP_FIELDS: [keyof LkpForm, string][] = [
  ['kantor', 'Nama Kantor / Bandara'], ['unit', 'Unit'], ['kota', 'Kota'], ['fasilitas', 'Fasilitas'],
  ['kepala_jabatan', 'Jabatan Pemeriksa (Kepala Seksi)'], ['kepala_nama', 'Nama Pemeriksa'], ['kepala_nip', 'NIP Pemeriksa'], ['kepala_phone', 'No. WA Kepala Seksi (permohonan TTD)'],
  ['koord_jabatan', 'Jabatan Koordinator (TTE)'], ['koord_nama', 'Nama Koordinator (TTE)'], ['koord_nip', 'NIP Koordinator'],
  ['nd_kode', 'Kode Unit Nota Dinas (mis. ELBAND/APTP)'], ['nd_yth', 'Nota Dinas — Ditujukan (Yth)'], ['nd_dari', 'Nota Dinas — Dari'],
];
interface LkpForm { kantor: string; unit: string; kota: string; fasilitas: string; kepala_jabatan: string; kepala_nama: string; kepala_nip: string; kepala_phone: string; koord_jabatan: string; koord_nama: string; koord_nip: string; nd_kode: string; nd_yth: string; nd_dari: string }
const LKP_DEFAULT: LkpForm = {
  kantor: 'BANDAR UDARA A.P.T. PRANOTO - SAMARINDA', unit: 'UNIT ELEKTRONIKA BANDARA', kota: 'Samarinda', fasilitas: 'Elektronika Bandara',
  kepala_jabatan: 'KEPALA SEKSI TEKNIK DAN OPERASI', kepala_nama: 'MURDOKO', kepala_nip: '19780319 200012 1 001', kepala_phone: '',
  koord_jabatan: 'KOORDINATOR UNIT ELEKTRONIKA BANDARA', koord_nama: 'PRAYUDA ELFANDRO', koord_nip: '19930311 202203 1 008',
  nd_kode: 'ELBAND/APTP', nd_yth: 'Kepala Seksi Teknik dan Operasi Penerbangan', nd_dari: 'Koordinator Elektronika Bandara',
};

export default function Settings() {
  const [form, setForm] = useState({ wa_provider: 'gateway', wa_coord_phone: '', threshold_cpu: 80, threshold_mem: 85, threshold_ping_timeout_ms: 3000, auto_resolve_stable_sec: 300, auto_detect_offline_sec: 120, inspect_radius_m: 200 });
  const [lkp, setLkp] = useState<LkpForm>(LKP_DEFAULT);
  const [saved, setSaved] = useState(false);
  const [nocToken, setNocToken] = useState('');
  const [nocUnits, setNocUnits] = useState<{ id: number; code: string; name: string; active: number }[]>([]);
  const [nocCopied, setNocCopied] = useState('');
  const [tz, setTz] = useState('Asia/Makassar');
  const [srv, setSrv] = useState<{ tz: string; offset: string } | null>(null);
  const [clock, setClock] = useState('—');
  const baseRef = useRef<{ epoch: number; at: number } | null>(null);

  // Migrasi data historis (zona waktu)
  const [migStatus, setMigStatus] = useState<{ globalTz: string; systemTz: string; sessionOffsetHours: number; alreadyDone: unknown } | null>(null);
  const [migShift, setMigShift] = useState(8);
  const [migForce, setMigForce] = useState(false);
  const [migBusy, setMigBusy] = useState(false);
  const [migMsg, setMigMsg] = useState('');
  const [migResult, setMigResult] = useState<{ mode: string; shift: number; totalColumns: number; totalRows: number; columns: { key: string; n: number; min: string | null; max: string | null }[] } | null>(null);

  async function loadMigStatus() {
    try { const r = await api.get('/settings/tz-migration/status'); setMigStatus(r.data); } catch { /* abaikan */ }
  }
  async function runMig(apply: boolean) {
    if (apply && !(await confirmDialog({ title: `Geser semua timestamp ${migShift > 0 ? '+' : ''}${migShift} jam`, message: 'Tindakan ini MENGUBAH data historis dan tidak otomatis bisa dibatalkan. Pastikan sudah BACKUP database.', confirmText: 'Geser data', variant: 'danger' }))) return;
    setMigBusy(true); setMigMsg('');
    try {
      const r = await api.post('/settings/tz-migration', { shift: migShift, apply, force: migForce });
      setMigResult(r.data);
      setMigMsg(apply ? `✅ Migrasi diterapkan: ${r.data.totalRows} nilai pada ${r.data.totalColumns} kolom digeser ${r.data.shift > 0 ? '+' : ''}${r.data.shift} jam.` : `🟢 Pratinjau: ${r.data.totalRows} nilai pada ${r.data.totalColumns} kolom akan digeser. Tinjau lalu klik Jalankan.`);
      if (apply) loadMigStatus();
    } catch (e: any) { setMigMsg('⚠️ ' + (e?.response?.data?.error || 'Gagal.')); }
    finally { setMigBusy(false); }
  }

  async function loadServerTime() {
    try {
      const r = await api.get('/settings/server-time');
      setSrv({ tz: r.data.tz, offset: r.data.offset });
      baseRef.current = { epoch: r.data.epoch, at: Date.now() };
    } catch { /* abaikan */ }
  }

  useEffect(() => {
    api.get('/settings').then((res) => {
      setForm((f) => ({ ...f, ...res.data.settings }));
      if (res.data.settings?.lkp) setLkp((l) => ({ ...l, ...res.data.settings.lkp }));
      if (res.data.settings?.app_timezone) setTz(res.data.settings.app_timezone);
    });
    loadServerTime();
    loadMigStatus();
    api.get('/noc/token').then((r) => setNocToken(r.data.token)).catch(() => {});
    api.get('/units').then((r) => setNocUnits((r.data.units || []).filter((u: { active: number }) => u.active !== 0))).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const nocLink = (code: string) => `${location.origin}/noc?unit=${encodeURIComponent(code)}&key=${nocToken}`;
  async function regenNoc() {
    if (!(await confirmDialog({ title: 'Ganti token wallboard?', message: 'Semua tautan lama langsung tidak berlaku; layar NOC yang terbuka perlu tautan baru.', confirmText: '🔁 Ganti token', variant: 'danger' }))) return;
    const r = await api.post('/noc/token/regenerate'); setNocToken(r.data.token);
  }
  async function copyNoc(code: string) {
    try { await navigator.clipboard.writeText(nocLink(code)); setNocCopied(code); setTimeout(() => setNocCopied(''), 1500); } catch { /* abaikan */ }
  }

  // Jam server berdetak: hitung dari epoch server + selisih lokal, format di zona server.
  useEffect(() => {
    const id = setInterval(() => {
      const base = baseRef.current;
      if (!base || !srv) return;
      const now = new Date(base.epoch + (Date.now() - base.at));
      setClock(now.toLocaleString('id-ID', { timeZone: srv.tz, dateStyle: 'full', timeStyle: 'medium' }));
    }, 1000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [srv]);

  async function saveLkp() {
    await api.put('/settings', { lkp });
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  async function save() {
    await api.put('/settings', form);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  async function saveTz() {
    await api.put('/settings', { app_timezone: tz });
    await loadServerTime();
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  return (
    <div>
      <div className="mb-4"><div className="text-[17px] font-bold">⚙️ Pengaturan Sistem</div></div>
      <div className="grid grid-cols-2 gap-4">
        <div className="bg-surface border border-border rounded-[10px] overflow-hidden">
          <div className="px-4 py-3 border-b border-border text-[13px] font-semibold">📲 WhatsApp Gateway</div>
          <div className="p-4 space-y-3">
            <div>
              <label className="text-[11px] text-text2 block mb-1">No. Koordinator</label>
              <input className="w-full bg-surface2 border border-border rounded-md px-3 py-2 text-xs" value={form.wa_coord_phone} onChange={(e) => setForm({ ...form, wa_coord_phone: e.target.value })} />
            </div>
            <p className="text-[10px] text-text2">API key WhatsApp Gateway diatur lewat env backend (.env: WAGATEWAY_API_KEY), tidak disimpan di sini agar tidak terekspos ke browser.</p>
            <button className="bg-accent text-bg rounded-md px-3 py-1.5 text-xs font-semibold" onClick={save}>💾 Simpan</button>
          </div>
        </div>
        <div className="bg-surface border border-border rounded-[10px] overflow-hidden">
          <div className="px-4 py-3 border-b border-border text-[13px] font-semibold">⚡ Threshold Alert</div>
          <div className="p-4 space-y-3">
            <div>
              <label className="text-[11px] text-text2 block mb-1">CPU Warning (%)</label>
              <input type="number" className="w-full bg-surface2 border border-border rounded-md px-3 py-2 text-xs" value={form.threshold_cpu} onChange={(e) => setForm({ ...form, threshold_cpu: Number(e.target.value) })} />
            </div>
            <div>
              <label className="text-[11px] text-text2 block mb-1">Memory Warning (%)</label>
              <input type="number" className="w-full bg-surface2 border border-border rounded-md px-3 py-2 text-xs" value={form.threshold_mem} onChange={(e) => setForm({ ...form, threshold_mem: Number(e.target.value) })} />
            </div>
            <div>
              <label className="text-[11px] text-text2 block mb-1">Ping Timeout (ms)</label>
              <input type="number" className="w-full bg-surface2 border border-border rounded-md px-3 py-2 text-xs" value={form.threshold_ping_timeout_ms} onChange={(e) => setForm({ ...form, threshold_ping_timeout_ms: Number(e.target.value) })} />
            </div>
            <div>
              <label className="text-[11px] text-text2 block mb-1">Auto-Resolve Insiden — stabil ONLINE (detik)</label>
              <input type="number" min={0} className="w-full bg-surface2 border border-border rounded-md px-3 py-2 text-xs" value={form.auto_resolve_stable_sec} onChange={(e) => setForm({ ...form, auto_resolve_stable_sec: Number(e.target.value) })} />
              <div className="text-[10px] text-text2 mt-1">Lama perangkat harus stabil ONLINE (tanpa flapping) sebelum insiden otomatis ditutup. Mis. 300 = 5 menit. 0 = tutup begitu online.</div>
            </div>
            <div>
              <label className="text-[11px] text-text2 block mb-1">Auto-Deteksi Offline — stabil OFFLINE (detik)</label>
              <input type="number" min={0} className="w-full bg-surface2 border border-border rounded-md px-3 py-2 text-xs" value={form.auto_detect_offline_sec} onChange={(e) => setForm({ ...form, auto_detect_offline_sec: Number(e.target.value) })} />
              <div className="text-[10px] text-text2 mt-1">Lama perangkat harus terus OFFLINE sebelum tiket otomatis dibuat (debounce anti naik-turun). Mis. 120 = 2 menit. 0 = buat tiket seketika.</div>
            </div>
            <div>
              <label className="text-[11px] text-text2 block mb-1">Radius Kerja Inspeksi (meter)</label>
              <input type="number" min={10} className="w-full bg-surface2 border border-border rounded-md px-3 py-2 text-xs" value={form.inspect_radius_m} onChange={(e) => setForm({ ...form, inspect_radius_m: Number(e.target.value) })} />
              <div className="text-[10px] text-text2 mt-1">Jarak maksimal foto (inspeksi / hidupkan / matikan) ke koordinat perangkat. Foto di luar radius ini ditandai mencurigakan (performa −20%). Tampil sebagai "Radius Kerja" di halaman kamera. Mis. 200 = 200 meter.</div>
            </div>
            <button className="bg-accent text-bg rounded-md px-3 py-1.5 text-xs font-semibold" onClick={save}>💾 Simpan</button>
          </div>
        </div>
      </div>

      {/* Zona waktu server — semua waktu (NOW, tampilan, laporan) memakai zona ini, bukan UTC */}
      <div className="bg-surface border border-border rounded-[10px] overflow-hidden mt-4">
        <div className="px-4 py-3 border-b border-border text-[13px] font-semibold">🕒 Waktu Server</div>
        <div className="p-4 grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <div className="text-[11px] text-text2 mb-1">Waktu server saat ini</div>
            <div className="bg-surface2 border border-border rounded-md px-3 py-2.5">
              <div className="text-sm font-semibold font-mono">{clock}</div>
              <div className="text-[10px] text-text2 mt-0.5">Zona aktif: <b>{srv?.tz || '—'}</b> (UTC{srv?.offset || ''})</div>
            </div>
            <p className="text-[10px] text-text2 mt-2 leading-relaxed">Semua pencatatan waktu (insiden, absensi, surat, laporan) dan <code>NOW()</code> database mengikuti zona ini — bukan UTC.</p>
          </div>
          <div>
            <label className="text-[11px] text-text2 block mb-1">Zona Waktu</label>
            <select className="w-full bg-surface2 border border-border rounded-md px-3 py-2 text-xs" value={tz} onChange={(e) => setTz(e.target.value)}>
              <option value="Asia/Jakarta">WIB — Asia/Jakarta (UTC+7)</option>
              <option value="Asia/Makassar">WITA — Asia/Makassar (UTC+8)</option>
              <option value="Asia/Jayapura">WIT — Asia/Jayapura (UTC+9)</option>
              <option value="UTC">UTC (UTC+0)</option>
            </select>
            <button className="bg-accent text-bg rounded-md px-3 py-1.5 text-xs font-semibold mt-3" onClick={saveTz}>💾 Simpan Zona Waktu</button>
            <p className="text-[10px] text-text2 mt-2 leading-relaxed">Berlaku langsung untuk waktu baru. Untuk konsistensi penuh pada koneksi DB lama, restart server (PM2) setelah mengubah.</p>
          </div>
        </div>
      </div>

      {/* Migrasi data historis zona waktu (one-off, untuk data yang terlanjur tersimpan UTC) */}
      <div className="bg-surface border border-border rounded-[10px] overflow-hidden mt-4">
        <div className="px-4 py-3 border-b border-border text-[13px] font-semibold">🧭 Migrasi Data Historis (Zona Waktu)</div>
        <div className="p-4 space-y-3">
          <div className="bg-warn/10 border border-warn/30 rounded-md px-3 py-2 text-[11px] text-warn leading-relaxed">
            ⚠️ Geser <b>semua timestamp lama</b> (created_at, dll) sebesar N jam. Pakai <b>hanya</b> bila data historis terlanjur tersimpan UTC. <b>Backup database dulu</b> — perubahan mengubah data.
          </div>
          {migStatus && (
            <div className="bg-surface2 border border-border rounded-md px-3 py-2 text-[11px] text-text2">
              <div>Diagnosa DB: <b>system_time_zone</b> = {migStatus.systemTz} · <b>global.time_zone</b> = {migStatus.globalTz} · offset sesi = +{migStatus.sessionOffsetHours}j</div>
              <div className="mt-0.5">
                {/^(utc|\+00:00|00:00)$/i.test(String(migStatus.systemTz)) || migStatus.sessionOffsetHours === 0
                  ? <span className="text-warn">→ Data lama kemungkinan <b>UTC</b> — migrasi mungkin diperlukan.</span>
                  : <span className="text-success">→ Server menyimpan waktu lokal (offset +{migStatus.sessionOffsetHours}j) — biasanya <b>TIDAK perlu</b> migrasi.</span>}
              </div>
              {migStatus.alreadyDone ? <div className="text-danger mt-0.5">⚑ Migrasi sudah pernah dijalankan. Centang "Paksa" untuk menjalankan lagi.</div> : null}
            </div>
          )}
          <div className="flex items-end gap-3 flex-wrap">
            <div>
              <label className="text-[11px] text-text2 block mb-1">Geser (jam)</label>
              <input type="number" className="w-24 bg-surface2 border border-border rounded-md px-3 py-2 text-xs" value={migShift} onChange={(e) => setMigShift(Number(e.target.value))} />
            </div>
            {migStatus?.alreadyDone ? (
              <label className="flex items-center gap-1.5 text-[11px] text-text2 pb-2"><input type="checkbox" checked={migForce} onChange={(e) => setMigForce(e.target.checked)} /> Paksa</label>
            ) : null}
            <button disabled={migBusy} className="border border-accent2/50 text-accent2 rounded-md px-3 py-2 text-xs font-semibold disabled:opacity-50" onClick={() => runMig(false)}>🔍 Pratinjau (Dry-run)</button>
            <button disabled={migBusy || migResult?.mode !== 'dry-run'} title={migResult?.mode === 'dry-run' ? '' : 'Lakukan pratinjau dulu'} className="bg-danger text-white rounded-md px-3 py-2 text-xs font-semibold disabled:opacity-40" onClick={() => runMig(true)}>▶️ Jalankan Migrasi</button>
          </div>
          {migMsg && <div className="text-[11px]">{migMsg}</div>}
          {migResult && (
            <div className="border border-border rounded-md max-h-52 overflow-y-auto">
              <table className="w-full text-[11px]">
                <thead><tr className="text-text2 border-b border-border sticky top-0 bg-surface"><th className="text-left px-3 py-1.5">Kolom</th><th className="text-right px-3 py-1.5">Baris</th><th className="text-left px-3 py-1.5">Rentang</th></tr></thead>
                <tbody>
                  {migResult.columns.filter((c) => c.n > 0).map((c) => (
                    <tr key={c.key} className="border-b border-border/40"><td className="px-3 py-1 font-mono">{c.key}</td><td className="px-3 py-1 text-right">{c.n}</td><td className="px-3 py-1 text-text2">{c.min} … {c.max}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {/* Kop & penanda tangan LKP (untuk cetak Laporan Kerusakan & Perbaikan) */}
      <div className="bg-surface border border-border rounded-[10px] overflow-hidden mt-4">
        <div className="px-4 py-3 border-b border-border text-[13px] font-semibold">🧾 Kop & Penanda Tangan LKP (Cetak Laporan + TTE QR Koordinator)</div>
        <div className="p-4 grid grid-cols-2 gap-3">
          {LKP_FIELDS.map(([k, label]) => (
            <div key={k} className={k === 'kantor' ? 'col-span-2' : ''}>
              <label className="text-[11px] text-text2 block mb-1">{label}</label>
              <input className="w-full bg-surface2 border border-border rounded-md px-3 py-2 text-xs" value={lkp[k]} onChange={(e) => setLkp({ ...lkp, [k]: e.target.value })} />
            </div>
          ))}
          <div className="col-span-2 flex items-center gap-3">
            <button className="bg-accent text-bg rounded-md px-3 py-1.5 text-xs font-semibold" onClick={saveLkp}>💾 Simpan Kop LKP</button>
            <span className="text-[10px] text-text2">Nama Koordinator dipakai sebagai penanda tangan elektronik (TTE QR) pada cetakan laporan.</span>
          </div>
        </div>
      </div>

      {/* Wallboard Publik (NOC) — tautan rahasia untuk layar TV tanpa login */}
      <div className="bg-surface border border-border rounded-[10px] overflow-hidden mt-4">
        <div className="px-4 py-3 border-b border-border text-[13px] font-semibold">📺 Wallboard Publik (NOC) — Tautan Layar TV</div>
        <div className="p-4 space-y-3">
          <p className="text-[10px] text-text2">Tautan rahasia untuk memajang wallboard di layar TV <b>tanpa login</b> (peta lokasi, gangguan real-time, daftar gangguan hari ini). Bagikan hanya ke layar NOC. Ganti token bila tautan bocor — semua tautan lama langsung mati.</p>
          <div className="flex items-center gap-2">
            <label className="text-[11px] text-text2 w-16">Token</label>
            <input readOnly className="flex-1 bg-surface2 border border-border rounded-md px-3 py-2 text-xs font-mono" value={nocToken} onFocus={(e) => e.target.select()} />
            <button onClick={regenNoc} className="border border-danger/50 text-danger rounded-md px-3 py-2 text-xs font-semibold whitespace-nowrap">🔁 Ganti</button>
          </div>
          <div className="space-y-1.5">
            {nocUnits.length === 0 ? <div className="text-[11px] text-text2">Belum ada unit aktif.</div> : nocUnits.map((u) => (
              <div key={u.id} className="flex items-center gap-2">
                <span className="text-[11px] text-text2 w-16 truncate" title={u.name}>{u.code}</span>
                <input readOnly className="flex-1 bg-surface2 border border-border rounded-md px-3 py-1.5 text-[11px] font-mono" value={nocLink(u.code)} onFocus={(e) => e.target.select()} />
                <button onClick={() => copyNoc(u.code)} className="border border-accent/40 text-accent rounded-md px-3 py-1.5 text-[11px] font-semibold whitespace-nowrap">{nocCopied === u.code ? '✓ Disalin' : '📋 Salin'}</button>
                <a href={nocLink(u.code)} target="_blank" rel="noreferrer" className="border border-border text-text2 rounded-md px-3 py-1.5 text-[11px] whitespace-nowrap hover:text-text">↗ Buka</a>
              </div>
            ))}
          </div>
        </div>
      </div>

      {saved && <div className="mt-3 text-success text-xs">Tersimpan ✅</div>}
    </div>
  );
}
