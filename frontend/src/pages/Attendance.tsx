import { useEffect, useState } from 'react';
import { api } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { hasRole } from '../utils/roles';
import type { Attendance as Att } from '../types';

function recentMonths(n = 12) {
  const now = new Date();
  return Array.from({ length: n }, (_, i) => {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    return { value: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`, label: d.toLocaleDateString('id-ID', { month: 'long', year: 'numeric' }) };
  });
}
const fmt = (s: string | null) => (s ? new Date(s.replace(' ', 'T')).toLocaleString('id-ID', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—');
const LEAVE_LABEL: Record<string, string> = { izin: 'Izin', sakit: 'Sakit', cuti: 'Cuti', dinas_luar: 'Dinas Luar' };

interface Leave { id: number; user_id: number; name: string; jabatan: string | null; type: string; start_date: string; end_date: string; reason: string | null; doc_url: string | null; status: string; approver_name: string | null; coord_note: string | null }
interface Recap { techId: number; name: string; jabatan: string | null; active: boolean; hadir: number; flagged: number; alpa: number; izin: number; sakit: number; cuti: number; dinas_luar: number }
interface Audit { id: number; actor_name: string | null; action: string; detail: string | null; created_at: string }
interface Absence { user_id: number; name: string; jabatan: string | null; work_date: string; shift_type: string; status: string | null; note: string | null; decided_at: string | null; decided_by_name: string | null }

export default function Attendance() {
  const { user } = useAuth();
  const isAdmin = hasRole(user, 'admin');
  const months = recentMonths();
  const [tab, setTab] = useState<'absensi' | 'izin' | 'rekap' | 'absen' | 'audit'>('absensi');
  const [month, setMonth] = useState(months[0].value);
  const [onlyFlagged, setOnlyFlagged] = useState(false);
  const [rows, setRows] = useState<Att[]>([]);
  const [office, setOffice] = useState<{ lat: number; lng: number; radius_m: number; acc_m?: number; enabled: boolean } | null>(null);
  const [leaves, setLeaves] = useState<Leave[]>([]);
  const [recap, setRecap] = useState<Recap[]>([]);
  const [absences, setAbsences] = useState<Absence[]>([]);
  const [audit, setAudit] = useState<Audit[]>([]);
  const [msg, setMsg] = useState('');

  function loadAbsen() { api.get(`/attendance/absences?month=${month}`).then((r) => setAbsences(r.data.absences)).catch(() => {}); }

  function loadAbsensi() {
    const q = new URLSearchParams({ month }); if (onlyFlagged) q.set('flagged', '1');
    api.get(`/attendance?${q.toString()}`).then((r) => { setRows(r.data.attendance); setOffice(r.data.office); }).catch(() => {});
  }
  useEffect(() => {
    if (tab === 'absensi') loadAbsensi();
    if (tab === 'izin') api.get(`/leave?month=${month}`).then((r) => setLeaves(r.data.leave)).catch(() => {});
    if (tab === 'rekap') api.get(`/attendance/recap?month=${month}`).then((r) => setRecap(r.data.recap)).catch(() => {});
    if (tab === 'absen') loadAbsen();
    if (tab === 'audit') api.get('/attendance/audit').then((r) => setAudit(r.data.audit)).catch(() => {});
  }, [tab, month, onlyFlagged]);

  async function decideAbsen(a: Absence, status: 'penalti' | 'dimaafkan' | 'reset') {
    let note: string | null = null;
    if (status !== 'reset') {
      const r = window.prompt(status === 'penalti'
        ? `Konfirmasi ALPA (−15 skor) — ${a.name}, ${a.work_date}. Catatan (opsional):`
        : `Maafkan absen (tanpa penalti) — ${a.name}, ${a.work_date}. Catatan (opsional):`);
      if (r === null) return; // dibatalkan
      note = r;
    }
    try { await api.post('/attendance/absences/decide', { userId: a.user_id, workDate: a.work_date, status, note }); loadAbsen(); }
    catch (e: any) { setMsg(e?.response?.data?.error || 'Gagal menyimpan keputusan.'); }
  }

  async function toggleFlag(a: Att) { await api.patch(`/attendance/${a.id}`, { flagged: a.flagged ? 0 : 1 }); loadAbsensi(); }
  async function saveOffice() { if (!office) return; await api.put('/settings', { office }); setMsg('Lokasi kantor disimpan.'); setTimeout(() => setMsg(''), 3000); }
  async function decide(l: Leave, status: 'disetujui' | 'ditolak') {
    const note = status === 'ditolak' ? (window.prompt('Alasan penolakan (opsional):') ?? '') : '';
    await api.patch(`/leave/${l.id}`, { status, note });
    api.get(`/leave?month=${month}`).then((r) => setLeaves(r.data.leave));
  }
  async function resetDevice(techId: number, name: string) {
    if (!window.confirm(`Reset perangkat absensi ${name}? Perangkat berikutnya yang dipakai absen akan diikat ulang.`)) return;
    await api.post(`/attendance/reset-device/${techId}`); setMsg(`Perangkat ${name} direset.`); setTimeout(() => setMsg(''), 3000);
  }
  function reloadRecap() { api.get(`/attendance/recap?month=${month}`).then((r) => setRecap(r.data.recap)).catch(() => {}); }
  async function toggleUser(r: Recap) {
    if (!window.confirm(`${r.active ? 'Nonaktifkan' : 'Aktifkan'} akun ${r.name}?${r.active ? ' Akses dashboard-nya akan langsung hilang.' : ''}`)) return;
    await api.patch(`/users/${r.techId}/toggle-active`); setMsg(`${r.name} ${r.active ? 'dinonaktifkan' : 'diaktifkan'}.`); setTimeout(() => setMsg(''), 3000); reloadRecap();
  }
  async function hapusUser(r: Recap) {
    if (!window.confirm(`HAPUS akun ${r.name} secara permanen? Akses dashboard hilang & data jadwal/absensi miliknya ikut terhapus. Tindakan ini tidak bisa dibatalkan.`)) return;
    try { await api.delete(`/users/${r.techId}`); setMsg(`Akun ${r.name} dihapus.`); setTimeout(() => setMsg(''), 3000); reloadRecap(); }
    catch (e: any) { setMsg(e?.response?.data?.error || 'Gagal menghapus.'); }
  }

  const TABS = [['absensi', '🕒 Absensi'], ['izin', '📝 Pengajuan Izin'], ['rekap', '📊 Rekap Bulanan'], ['absen', '🚫 Tinjauan Absen'], ...(isAdmin ? [['audit', '🛡️ Audit Log']] : [])] as const;
  const absenPending = absences.filter((a) => !a.status).length;

  return (
    <div>
      <div className="flex items-center justify-between mb-4 gap-2 flex-wrap">
        <div className="text-[17px] font-bold">🕒 Manajemen Absensi</div>
        <select className="bg-surface2 border border-border rounded-md px-3 py-2 text-xs" value={month} onChange={(e) => setMonth(e.target.value)}>
          {months.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
        </select>
      </div>

      <div className="flex gap-1 mb-4 flex-wrap">
        {TABS.map(([k, lbl]) => <button key={k} onClick={() => setTab(k as any)} className={`px-3 py-1.5 text-xs rounded-md ${tab === k ? 'bg-accent text-bg font-semibold' : 'bg-surface2 text-text2'}`}>{lbl}</button>)}
      </div>
      {msg && <div className="bg-success/10 border border-success/30 rounded-md px-3 py-2 text-[11px] text-success mb-3">{msg}</div>}

      {/* ===== ABSENSI ===== */}
      {tab === 'absensi' && (<>
        {isAdmin && office && (
          <div className="bg-surface border border-border rounded-[10px] p-3.5 mb-4">
            <div className="text-[12px] font-semibold mb-2">📍 Lokasi Kantor (acuan verifikasi)</div>
            <div className="flex items-end gap-3 flex-wrap">
              <label className="text-[11px] text-text2">Latitude<input type="number" step="any" className="block w-32 bg-surface2 border border-border rounded-md px-2 py-1.5 text-xs mt-1" value={office.lat} onChange={(e) => setOffice({ ...office, lat: Number(e.target.value) })} /></label>
              <label className="text-[11px] text-text2">Longitude<input type="number" step="any" className="block w-32 bg-surface2 border border-border rounded-md px-2 py-1.5 text-xs mt-1" value={office.lng} onChange={(e) => setOffice({ ...office, lng: Number(e.target.value) })} /></label>
              <label className="text-[11px] text-text2">Radius (m)<input type="number" className="block w-24 bg-surface2 border border-border rounded-md px-2 py-1.5 text-xs mt-1" value={office.radius_m} onChange={(e) => setOffice({ ...office, radius_m: Number(e.target.value) })} /></label>
              <label className="text-[11px] text-text2">Akurasi maks (m)<input type="number" className="block w-24 bg-surface2 border border-border rounded-md px-2 py-1.5 text-xs mt-1" value={office.acc_m ?? 150} onChange={(e) => setOffice({ ...office, acc_m: Number(e.target.value) })} /></label>
              <label className="text-[11px] text-text2 flex items-center gap-1.5 pb-2"><input type="checkbox" checked={office.enabled} onChange={(e) => setOffice({ ...office, enabled: e.target.checked })} /> Aktif</label>
              <button onClick={saveOffice} className="bg-accent text-bg rounded-md px-3 py-1.5 text-xs font-semibold">Simpan</button>
            </div>
          </div>
        )}
        <div className="flex justify-end mb-2">
          <button onClick={() => setOnlyFlagged((v) => !v)} className={`px-2.5 py-1.5 text-[11px] rounded-md border ${onlyFlagged ? 'bg-danger/15 text-danger border-danger/40' : 'border-border text-text2'}`}>⚠️ Hanya VPN/Mencurigakan</button>
        </div>
        <div className="bg-surface border border-border rounded-[10px] overflow-x-auto">
          <table className="w-full text-xs"><thead><tr className="text-text2 uppercase text-[10px] border-b border-border">
            {['Tanggal', 'Teknisi', 'Masuk', 'Pulang', 'Jarak', 'Lokasi', 'Status', 'Keterangan', 'Aksi'].map((h) => <th key={h} className="px-3 py-2.5 text-left">{h}</th>)}
          </tr></thead><tbody>
            {rows.map((a) => (
              <tr key={a.id} className={`border-b border-border/50 ${a.flagged ? 'bg-danger/5' : ''}`}>
                <td className="px-3 py-2.5 font-mono text-[11px]">{a.work_date}</td>
                <td className="px-3 py-2.5"><strong>{a.name}</strong><div className="text-text2 text-[10px]">{a.jabatan}</div></td>
                <td className="px-3 py-2.5 text-success">{fmt(a.check_in_at)}</td>
                <td className="px-3 py-2.5 text-accent2">{fmt(a.check_out_at)}</td>
                <td className={`px-3 py-2.5 font-mono text-[11px] ${a.check_in_dist_m != null && office && a.check_in_dist_m > office.radius_m ? 'text-danger' : ''}`}>{a.check_in_dist_m != null ? `${a.check_in_dist_m} m` : '—'}</td>
                <td className="px-3 py-2.5">{a.check_in_lat != null && a.check_in_lng != null ? <a href={`https://www.google.com/maps?q=${a.check_in_lat},${a.check_in_lng}`} target="_blank" rel="noreferrer" className="text-accent2 hover:underline text-[11px]">📍 Peta</a> : <span className="text-text2 text-[10px]">GPS mati</span>}</td>
                <td className="px-3 py-2.5">{a.flagged ? <span className="text-[10px] px-2 py-0.5 rounded-full bg-danger/15 text-danger font-semibold">⚠️ Ditandai</span> : <span className="text-[10px] px-2 py-0.5 rounded-full bg-success/15 text-success">✓ Wajar</span>}</td>
                <td className="px-3 py-2.5 text-text2 text-[11px] max-w-[220px]"><div className="truncate" title={a.reason || ''}>{a.reason || '-'}</div></td>
                <td className="px-3 py-2.5">{isAdmin && <button onClick={() => toggleFlag(a)} className="border border-border text-text2 hover:text-white rounded px-2 py-0.5 text-[10px]">{a.flagged ? '✓ Wajar' : '⚠️ Tandai'}</button>}</td>
              </tr>
            ))}
            {rows.length === 0 && <tr><td colSpan={9} className="px-3 py-6 text-center text-text2">Belum ada data absensi.</td></tr>}
          </tbody></table>
        </div>
      </>)}

      {/* ===== PENGAJUAN IZIN ===== */}
      {tab === 'izin' && (
        <div className="bg-surface border border-border rounded-[10px] overflow-x-auto">
          <table className="w-full text-xs"><thead><tr className="text-text2 uppercase text-[10px] border-b border-border">
            {['Teknisi', 'Jenis', 'Periode', 'Alasan', 'Bukti', 'Status', 'Aksi'].map((h) => <th key={h} className="px-3 py-2.5 text-left">{h}</th>)}
          </tr></thead><tbody>
            {leaves.map((l) => (
              <tr key={l.id} className="border-b border-border/50">
                <td className="px-3 py-2.5"><strong>{l.name}</strong><div className="text-text2 text-[10px]">{l.jabatan}</div></td>
                <td className="px-3 py-2.5">{LEAVE_LABEL[l.type]}</td>
                <td className="px-3 py-2.5 font-mono text-[11px]">{l.start_date}{l.end_date !== l.start_date ? ` – ${l.end_date}` : ''}</td>
                <td className="px-3 py-2.5 text-text2 max-w-[200px]"><div className="truncate" title={l.reason || ''}>{l.reason || '-'}</div></td>
                <td className="px-3 py-2.5">{l.doc_url ? <a href={l.doc_url} target="_blank" rel="noreferrer" className="text-accent2 hover:underline text-[11px]">📎 Lihat</a> : '-'}</td>
                <td className="px-3 py-2.5"><span className={`text-[10px] px-2 py-0.5 rounded-full font-semibold ${l.status === 'disetujui' ? 'bg-success/15 text-success' : l.status === 'ditolak' ? 'bg-danger/15 text-danger' : 'bg-warn/15 text-warn'}`}>{l.status}</span>{l.coord_note && <div className="text-[9px] text-text2 mt-0.5">{l.coord_note}</div>}</td>
                <td className="px-3 py-2.5">{l.status === 'menunggu' && <div className="flex gap-1.5"><button onClick={() => decide(l, 'disetujui')} className="border border-success/40 text-success rounded px-2 py-0.5 text-[10px]">✓ Setujui</button><button onClick={() => decide(l, 'ditolak')} className="border border-danger/40 text-danger rounded px-2 py-0.5 text-[10px]">✗ Tolak</button></div>}</td>
              </tr>
            ))}
            {leaves.length === 0 && <tr><td colSpan={7} className="px-3 py-6 text-center text-text2">Tidak ada pengajuan pada periode ini.</td></tr>}
          </tbody></table>
        </div>
      )}

      {/* ===== REKAP ===== */}
      {tab === 'rekap' && (
        <div className="bg-surface border border-border rounded-[10px] overflow-x-auto">
          <table className="w-full text-xs"><thead><tr className="text-text2 uppercase text-[10px] border-b border-border">
            {['Teknisi', 'Status', 'Hadir', 'Alpa', 'Izin', 'Sakit', 'Cuti', 'Dinas Luar', 'Ditandai', ...(isAdmin ? ['Aksi'] : [])].map((h) => <th key={h} className="px-3 py-2.5 text-left">{h}</th>)}
          </tr></thead><tbody>
            {recap.map((r) => (
              <tr key={r.techId} className={`border-b border-border/50 ${!r.active ? 'opacity-50' : ''}`}>
                <td className="px-3 py-2.5"><strong>{r.name}</strong><div className="text-text2 text-[10px]">{r.jabatan}</div></td>
                <td className="px-3 py-2.5">{r.active ? <span className="text-[10px] px-2 py-0.5 rounded-full bg-success/15 text-success">● Aktif</span> : <span className="text-[10px] px-2 py-0.5 rounded-full bg-danger/15 text-danger">● Nonaktif</span>}</td>
                <td className="px-3 py-2.5 text-center text-success font-semibold">{r.hadir}</td>
                <td className={`px-3 py-2.5 text-center font-semibold ${r.alpa > 0 ? 'text-danger' : 'text-text2'}`}>{r.alpa}</td>
                <td className="px-3 py-2.5 text-center">{r.izin}</td>
                <td className="px-3 py-2.5 text-center">{r.sakit}</td>
                <td className="px-3 py-2.5 text-center">{r.cuti}</td>
                <td className="px-3 py-2.5 text-center">{r.dinas_luar}</td>
                <td className={`px-3 py-2.5 text-center ${r.flagged > 0 ? 'text-danger font-semibold' : 'text-text2'}`}>{r.flagged}</td>
                {isAdmin && <td className="px-3 py-2.5"><div className="flex gap-1.5 flex-wrap">
                  <button onClick={() => toggleUser(r)} className={`rounded px-2 py-0.5 text-[10px] border ${r.active ? 'border-warn/40 text-warn' : 'border-success/40 text-success'}`}>{r.active ? '🚫 Nonaktifkan' : '✓ Aktifkan'}</button>
                  <button onClick={() => resetDevice(r.techId, r.name)} className="border border-border text-text2 hover:text-white rounded px-2 py-0.5 text-[10px]">📱 Reset HP</button>
                  <button onClick={() => hapusUser(r)} className="border border-danger/40 text-danger rounded px-2 py-0.5 text-[10px]">🗑️ Hapus</button>
                </div></td>}
              </tr>
            ))}
            {recap.length === 0 && <tr><td colSpan={10} className="px-3 py-6 text-center text-text2">Belum ada data.</td></tr>}
          </tbody></table>
        </div>
      )}

      {/* ===== TINJAUAN ABSEN ===== */}
      {tab === 'absen' && (<>
        <div className="bg-accent/8 border border-accent/25 rounded-[10px] p-3 mb-3 text-[11px] text-text2 flex flex-wrap items-center gap-x-4 gap-y-1">
          <span>📌 Penalti absen <b className="text-danger">−15 skor</b> hanya berlaku setelah koordinator menandai <b>Alpa</b>. Hari yang belum ditinjau / dimaafkan <b>tidak</b> memotong skor.</span>
          <span className="text-warn">⏳ {absenPending} belum ditinjau</span>
          <span className="text-danger">⚠️ {absences.filter((a) => a.status === 'penalti').length} alpa</span>
          <span className="text-success">✓ {absences.filter((a) => a.status === 'dimaafkan').length} dimaafkan</span>
        </div>
        <div className="bg-surface border border-border rounded-[10px] overflow-x-auto">
          <table className="w-full text-xs"><thead><tr className="text-text2 uppercase text-[10px] border-b border-border">
            {['Teknisi', 'Tanggal', 'Shift', 'Status Tinjauan', 'Diputuskan', 'Aksi'].map((h) => <th key={h} className="px-3 py-2.5 text-left">{h}</th>)}
          </tr></thead><tbody>
            {absences.map((a) => (
              <tr key={`${a.user_id}-${a.work_date}`} className={`border-b border-border/50 ${!a.status ? 'bg-warn/5' : a.status === 'penalti' ? 'bg-danger/5' : ''}`}>
                <td className="px-3 py-2.5"><strong>{a.name}</strong><div className="text-text2 text-[10px]">{a.jabatan}</div></td>
                <td className="px-3 py-2.5 font-mono text-[11px]">{a.work_date}</td>
                <td className="px-3 py-2.5 capitalize text-text2">{a.shift_type}</td>
                <td className="px-3 py-2.5">
                  {a.status === 'penalti' ? <span className="text-[10px] px-2 py-0.5 rounded-full bg-danger/15 text-danger font-semibold">⚠️ Alpa −15</span>
                    : a.status === 'dimaafkan' ? <span className="text-[10px] px-2 py-0.5 rounded-full bg-success/15 text-success font-semibold">✓ Dimaafkan</span>
                    : <span className="text-[10px] px-2 py-0.5 rounded-full bg-warn/15 text-warn font-semibold">⏳ Belum ditinjau</span>}
                  {a.note && <div className="text-[9px] text-text2 mt-0.5">{a.note}</div>}
                </td>
                <td className="px-3 py-2.5 text-text2 text-[10px]">{a.decided_by_name ? <>{a.decided_by_name}<div>{fmt(a.decided_at)}</div></> : '—'}</td>
                <td className="px-3 py-2.5"><div className="flex gap-1.5 flex-wrap">
                  {a.status !== 'penalti' && <button onClick={() => decideAbsen(a, 'penalti')} className="border border-danger/40 text-danger rounded px-2 py-0.5 text-[10px]">⚠️ Alpa −15</button>}
                  {a.status !== 'dimaafkan' && <button onClick={() => decideAbsen(a, 'dimaafkan')} className="border border-success/40 text-success rounded px-2 py-0.5 text-[10px]">✓ Maafkan</button>}
                  {a.status && <button onClick={() => decideAbsen(a, 'reset')} className="border border-border text-text2 hover:text-white rounded px-2 py-0.5 text-[10px]">↺ Reset</button>}
                </div></td>
              </tr>
            ))}
            {absences.length === 0 && <tr><td colSpan={6} className="px-3 py-6 text-center text-text2">Tidak ada kandidat absen pada periode ini. 🎉</td></tr>}
          </tbody></table>
        </div>
      </>)}

      {/* ===== AUDIT ===== */}
      {tab === 'audit' && isAdmin && (
        <div className="bg-surface border border-border rounded-[10px] overflow-x-auto">
          <table className="w-full text-xs"><thead><tr className="text-text2 uppercase text-[10px] border-b border-border">
            {['Waktu', 'Pelaku', 'Aksi', 'Detail'].map((h) => <th key={h} className="px-3 py-2.5 text-left">{h}</th>)}
          </tr></thead><tbody>
            {audit.map((a) => (
              <tr key={a.id} className="border-b border-border/50">
                <td className="px-3 py-2.5 font-mono text-[10px] text-text2">{fmt(a.created_at)}</td>
                <td className="px-3 py-2.5">{a.actor_name || '—'}</td>
                <td className="px-3 py-2.5"><span className="text-[10px] px-1.5 py-0.5 rounded bg-surface2 text-accent2 font-mono">{a.action}</span></td>
                <td className="px-3 py-2.5 text-text2">{a.detail || '-'}</td>
              </tr>
            ))}
            {audit.length === 0 && <tr><td colSpan={4} className="px-3 py-6 text-center text-text2">Belum ada catatan audit.</td></tr>}
          </tbody></table>
        </div>
      )}

      <div className="text-[10px] text-text2 mt-2">Absensi ditandai ⚠️ (luar radius / akurasi rendah / zona waktu tak wajar / GPS mati / perangkat asing) menurunkan skor 50%. Hari ber-izin/cuti disetujui tidak dihitung Alpa.</div>
    </div>
  );
}
