import { useEffect, useRef, useState } from 'react';
import { api } from '../api/client';

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
  const [form, setForm] = useState({ wa_provider: 'fonnte', wa_coord_phone: '', threshold_cpu: 80, threshold_mem: 85, threshold_ping_timeout_ms: 3000 });
  const [lkp, setLkp] = useState<LkpForm>(LKP_DEFAULT);
  const [saved, setSaved] = useState(false);
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
    if (apply && !window.confirm(`Geser SEMUA timestamp historis ${migShift > 0 ? '+' : ''}${migShift} jam?\n\nTindakan ini MENGUBAH data dan tidak otomatis bisa dibatalkan. Pastikan sudah BACKUP database.`)) return;
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
          <div className="px-4 py-3 border-b border-border text-[13px] font-semibold">📲 WhatsApp API (Fonnte)</div>
          <div className="p-4 space-y-3">
            <div>
              <label className="text-[11px] text-text2 block mb-1">No. Koordinator</label>
              <input className="w-full bg-surface2 border border-border rounded-md px-3 py-2 text-xs" value={form.wa_coord_phone} onChange={(e) => setForm({ ...form, wa_coord_phone: e.target.value })} />
            </div>
            <p className="text-[10px] text-text2">Token Fonnte diatur lewat env backend (.env), tidak disimpan di sini agar tidak terekspos ke browser.</p>
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

      {saved && <div className="mt-3 text-success text-xs">Tersimpan ✅</div>}
    </div>
  );
}
