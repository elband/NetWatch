import { useEffect, useState } from 'react';
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

  useEffect(() => {
    api.get('/settings').then((res) => {
      setForm((f) => ({ ...f, ...res.data.settings }));
      if (res.data.settings?.lkp) setLkp((l) => ({ ...l, ...res.data.settings.lkp }));
    });
  }, []);

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
