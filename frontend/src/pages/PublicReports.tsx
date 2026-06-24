import { useEffect, useState } from 'react';
import { api } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { hasRole } from '../utils/roles';
import { confirmDialog } from '../components/dialog';
import type { PublicReport, User } from '../types';

const URGENSI_ICON: Record<string, string> = { kritis: '🔴', tinggi: '🟠', sedang: '🟡', rendah: '🟢' };
const STATUS_LABEL: Record<string, string> = { menunggu: '⏳ Menunggu', diproses: '🔧 Diproses', selesai: '✅ Selesai' };

export default function PublicReports() {
  const { user } = useAuth();
  const [reports, setReports] = useState<PublicReport[]>([]);
  const [techs, setTechs] = useState<User[]>([]);
  const [seeding, setSeeding] = useState(false);
  const [deleting, setDeleting] = useState(false);

  function load() {
    api.get('/public-reports').then((res) => setReports(res.data.reports));
  }
  useEffect(() => {
    load();
    api.get('/users').then((res) => setTechs(res.data.users.filter((u: User) => u.role === 'teknisi')));
  }, []);

  async function seedDemo() {
    setSeeding(true);
    try {
      await api.post('/public-reports/seed-demo');
      load();
    } finally {
      setSeeding(false);
    }
  }

  async function deleteAll() {
    if (!(await confirmDialog({ title: 'Hapus semua laporan publik', message: `Seluruh ${reports.length} laporan publik akan dihapus permanen. Tindakan ini tidak bisa dibatalkan.`, confirmText: '🗑️ Hapus semua', variant: 'danger' }))) return;
    setDeleting(true);
    try {
      await api.delete('/public-reports');
      load();
    } finally {
      setDeleting(false);
    }
  }

  async function updateStatus(id: string, status: string, techNote: string) {
    await api.put(`/public-reports/${id}`, { status, techNote });
    load();
  }
  async function assignIncident(id: string, techId: number) {
    await api.post(`/public-reports/${id}/assign-incident`, { techId });
    load();
  }

  return (
    <div>
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <div className="text-[17px] font-bold">📬 Laporan Publik</div>
          <div className="text-[11px] text-text2 mt-0.5">Laporan peralatan dari unit & pegawai lain</div>
        </div>
        {hasRole(user, 'admin') && (
          <div className="flex gap-2 flex-shrink-0">
            <button
              disabled={seeding}
              onClick={seedDemo}
              className="bg-accent2/10 text-accent2 border border-accent2/30 rounded-md px-3 py-1.5 text-xs font-medium hover:bg-accent2/20 disabled:opacity-60 whitespace-nowrap"
            >
              {seeding ? 'Membuat…' : '🎲 Buat Data Demo'}
            </button>
            {reports.length > 0 && (
              <button
                disabled={deleting}
                onClick={deleteAll}
                className="bg-danger/10 text-danger border border-danger/30 rounded-md px-3 py-1.5 text-xs font-medium hover:bg-danger/20 disabled:opacity-60 whitespace-nowrap"
              >
                {deleting ? 'Menghapus…' : '🗑️ Hapus Semua'}
              </button>
            )}
          </div>
        )}
      </div>
      {reports.length === 0 ? (
        <div className="bg-surface border border-border rounded-[10px] p-10 text-center text-text2">
          <div className="text-4xl mb-2">📭</div>
          <div className="text-sm font-semibold">Belum Ada Laporan</div>
        </div>
      ) : (
        reports.map((r) => (
          <div key={r.id} className="bg-surface border border-border rounded-[10px] mb-3 overflow-hidden">
            <div className="px-4 py-3 border-b border-border flex items-start gap-3">
              <div className="w-9 h-9 rounded-lg bg-surface2 flex items-center justify-center text-lg flex-shrink-0">{URGENSI_ICON[r.urgensi]}</div>
              <div className="flex-1">
                <div className="flex items-center gap-2 flex-wrap mb-0.5">
                  <span className="font-mono text-[10px] text-accent2">{r.id}</span>
                  <span className="text-[10px] px-2 py-0.5 rounded-full font-bold uppercase bg-danger/15 text-danger">{r.urgensi}</span>
                  <span className="text-[10px] px-2 py-0.5 rounded-full bg-surface2 text-text2 font-semibold">{STATUS_LABEL[r.status]}</span>
                </div>
                <div className="text-[13px] font-semibold">{r.judul}</div>
                <div className="text-[11px] text-text2">👤 {r.nama} · 🏢 {r.unit} · 📱 {r.hp}</div>
              </div>
            </div>
            <div className="p-4">
              <div className="text-xs text-text2 bg-surface2 rounded-md p-2.5 mb-3">{r.detail}</div>
              {r.status !== 'selesai' ? (
                <ReportActions report={r} techs={techs} onUpdate={updateStatus} onAssign={assignIncident} />
              ) : (
                <div className="bg-success/10 border border-success/20 rounded-md p-3 text-xs text-success">✅ Laporan Selesai Ditangani</div>
              )}
            </div>
          </div>
        ))
      )}
    </div>
  );
}

function ReportActions({
  report, techs, onUpdate, onAssign,
}: { report: PublicReport; techs: User[]; onUpdate: (id: string, status: string, note: string) => void; onAssign: (id: string, techId: number) => void }) {
  const [note, setNote] = useState(report.tech_note || '');
  const [status, setStatus] = useState(report.status);
  // 0 = Auto (pool): insiden dikirim ke semua teknisi on-duty, tanpa penugasan langsung.
  const [techId, setTechId] = useState(0);

  return (
    <div className="bg-accent/5 border border-accent/15 rounded-lg p-3.5 flex gap-2 items-end flex-wrap">
      <input className="flex-1 bg-surface2 border border-border rounded-md px-3 py-2 text-xs min-w-[160px]" placeholder="Catatan / update status" value={note} onChange={(e) => setNote(e.target.value)} />
      <select className="bg-surface2 border border-border rounded-md px-3 py-2 text-xs" value={status} onChange={(e) => setStatus(e.target.value as PublicReport['status'])}>
        <option value="menunggu">⏳ Menunggu</option><option value="diproses">🔧 Diproses</option><option value="selesai">✅ Selesai</option>
      </select>
      <button className="bg-accent text-bg rounded-md px-3 py-2 text-xs font-semibold" onClick={() => onUpdate(report.id, status, note)}>💾 Update</button>
      <select className="bg-surface2 border border-border rounded-md px-3 py-2 text-xs" value={techId} onChange={(e) => setTechId(Number(e.target.value))} title="Auto = kirim ke pool teknisi on-duty">
        <option value={0}>🎯 Auto (pool on-duty)</option>
        {techs.map((t) => <option key={t.id} value={t.id}>👤 {t.name}</option>)}
      </select>
      <button className="bg-success text-bg rounded-md px-3 py-2 text-xs font-semibold" onClick={() => onAssign(report.id, techId)}>+ Buat Insiden</button>
    </div>
  );
}
