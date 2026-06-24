import { useEffect, useState } from 'react';
import { api } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { confirmDialog, alertDialog } from '../components/dialog';
import type { Role, User } from '../types';

const ROLE_COLOR: Record<Role, string> = { admin: '#ef4444', koordinator: '#00d4aa', teknisi: '#0ea5e9', viewer: '#a78bfa' };
const ALL_PERMS = [
  'dashboard', 'devices', 'monitor', 'incidents', 'jadwal', 'reports', 'users', 'wa', 'settings', 'ssh',
  'my-dashboard', 'my-incidents', 'performa', 'publik-reports',
];

const ALL_ROLES: Role[] = ['admin', 'koordinator', 'teknisi', 'viewer'];
const emptyForm = { name: '', username: '', email: '', pin: '', phone: '', nip: '', roles: ['teknisi'] as Role[], jabatan: '', perms: [] as string[] };

export default function Users() {
  const { user: me } = useAuth();
  const [users, setUsers] = useState<User[]>([]);
  const [open, setOpen] = useState(false);
  const [editId, setEditId] = useState<number | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [err, setErr] = useState('');

  function load() {
    api.get('/users').then((res) => setUsers(res.data.users));
  }
  useEffect(load, []);

  function openCreate() {
    setEditId(null);
    setForm(emptyForm);
    setErr('');
    setOpen(true);
  }
  function openEdit(u: User) {
    setEditId(u.id);
    setErr('');
    setForm({ name: u.name, username: u.username, email: u.email, pin: '', phone: u.phone || '', nip: u.nip || '', roles: u.roles?.length ? u.roles : [u.role], jabatan: u.jabatan || '', perms: Array.isArray(u.perms) ? u.perms : [] });
    setOpen(true);
  }

  async function save() {
    if (form.pin && !/^\d{4,6}$/.test(form.pin)) return setErr('PIN harus 4–6 digit angka.');
    if (form.roles.length === 0) return setErr('Pilih minimal 1 peran.');
    setErr('');
    try {
      if (editId) {
        await api.put(`/users/${editId}`, form);
      } else {
        await api.post('/users', form);
      }
      setOpen(false);
      load();
    } catch (e: any) {
      setErr(e?.response?.data?.error || 'Gagal menyimpan user.');
    }
  }

  async function toggleActive(id: number) {
    await api.patch(`/users/${id}/toggle-active`);
    load();
  }
  async function hapusUser(u: User) {
    if (!(await confirmDialog({ title: `Hapus akun ${u.name}`, message: `@${u.username}\n\nData yang tertaut (insiden, jadwal, dll.) tidak ikut terhapus. Tindakan ini tidak bisa dibatalkan.`, confirmText: '🗑️ Hapus permanen', variant: 'danger' }))) return;
    try {
      await api.delete(`/users/${u.id}`);
      load();
    } catch (e: any) {
      alertDialog({ title: 'Gagal', message: e?.response?.data?.error || 'Gagal menghapus akun.', variant: 'danger' });
    }
  }

  function togglePerm(p: string) {
    setForm((f) => ({ ...f, perms: f.perms.includes(p) ? f.perms.filter((x) => x !== p) : [...f.perms, p] }));
  }
  function toggleRole(r: Role) {
    setForm((f) => ({ ...f, roles: f.roles.includes(r) ? f.roles.filter((x) => x !== r) : [...f.roles, r] }));
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <div>
          <div className="text-[17px] font-bold">👥 Manajemen User</div>
          <div className="text-[11px] text-text2 mt-0.5">{users.length} user terdaftar</div>
        </div>
        <button className="bg-accent text-bg rounded-md px-3 py-1.5 text-xs font-semibold" onClick={openCreate}>+ Tambah User</button>
      </div>

      <div className="flex flex-col gap-2.5">
        {users.map((u) => (
          <div key={u.id} className="bg-surface2 border border-border rounded-[10px] p-4 flex items-center gap-3.5">
            <div className="w-11 h-11 rounded-full flex items-center justify-center text-lg flex-shrink-0" style={{ background: `${ROLE_COLOR[u.role]}22`, border: `2px solid ${ROLE_COLOR[u.role]}` }}>
              {u.emoji}
            </div>
            <div className="flex-1">
              <div className="text-[13px] font-semibold flex items-center flex-wrap gap-1">
                {u.name}
                {(u.roles?.length ? u.roles : [u.role]).map((r) => (
                  <span key={r} className="text-[10px] px-2 py-0.5 rounded-full" style={{ background: `${ROLE_COLOR[r]}22`, color: ROLE_COLOR[r] }}>{r}</span>
                ))}
                {!u.active && <span className="text-[10px] text-danger ml-1">● Nonaktif</span>}
              </div>
              <div className="text-[11px] text-text2">
                @{u.username} · {u.email} · {u.jabatan}
                {u.nip ? <span className="ml-2 text-[10px] text-text2">🆔 NIP {u.nip}</span> : <span className="ml-2 text-[10px] text-warn">🆔 NIP belum diset</span>}
                {u.has_pin ? <span className="ml-2 text-[10px] text-success">🔐 PIN aktif</span> : <span className="ml-2 text-[10px] text-warn">🔓 PIN belum diset</span>}
              </div>
            </div>
            <div className="flex gap-1.5">
              <button className="border border-border text-text2 rounded px-2.5 py-1 text-xs hover:text-text" onClick={() => openEdit(u)}>✎ Edit</button>
              <button className={`rounded px-2.5 py-1 text-xs border ${u.active ? 'border-warn/30 text-warn bg-warn/10' : 'border-success/30 text-success bg-success/10'}`} onClick={() => toggleActive(u.id)}>
                {u.active ? 'Nonaktifkan' : 'Aktifkan'}
              </button>
              {me?.id !== u.id && (
                <button className="rounded px-2.5 py-1 text-xs border border-danger/30 text-danger bg-danger/10 hover:bg-danger/20" onClick={() => hapusUser(u)}>🗑️ Hapus</button>
              )}
            </div>
          </div>
        ))}
      </div>

      {open && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-[200]" onClick={() => setOpen(false)}>
          <div className="bg-surface border border-border rounded-xl p-6 w-[520px] max-w-[95vw] max-h-[85vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="flex justify-between items-center mb-4">
              <span className="text-[15px] font-bold">{editId ? 'Edit User' : 'Tambah User'}</span>
              <button onClick={() => setOpen(false)} className="text-text2 hover:text-text">✕</button>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <input className="col-span-2 bg-surface2 border border-border rounded-md px-3 py-2 text-xs" placeholder="Nama Lengkap" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
              <input className="bg-surface2 border border-border rounded-md px-3 py-2 text-xs" placeholder="Username" value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} />
              <input className="bg-surface2 border border-border rounded-md px-3 py-2 text-xs" placeholder="Email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
              <input inputMode="numeric" maxLength={6} className="bg-surface2 border border-border rounded-md px-3 py-2 text-xs" placeholder={editId ? 'PIN baru (kosongkan = tetap)' : 'PIN login (4–6 digit) *'} value={form.pin} onChange={(e) => setForm({ ...form, pin: e.target.value.replace(/\D/g, '') })} />
              <input className="bg-surface2 border border-border rounded-md px-3 py-2 text-xs" placeholder="No. WhatsApp" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
              <input className="col-span-2 bg-surface2 border border-border rounded-md px-3 py-2 text-xs" placeholder="NIP (dipakai untuk tanda tangan surat)" value={form.nip} onChange={(e) => setForm({ ...form, nip: e.target.value })} />
              <input className="col-span-2 bg-surface2 border border-border rounded-md px-3 py-2 text-xs" placeholder="Jabatan" value={form.jabatan} onChange={(e) => setForm({ ...form, jabatan: e.target.value })} />
            </div>
            <div className="text-[11px] font-semibold text-text2 mt-3.5 mb-2">PERAN <span className="font-normal">(bisa lebih dari satu · peran pertama = utama)</span></div>
            <div className="grid grid-cols-2 gap-2">
              {ALL_ROLES.map((r) => (
                <label key={r} className={`flex items-center gap-2 rounded-md p-2 text-[11px] cursor-pointer border ${form.roles.includes(r) ? 'border-accent/50 bg-accent/10' : 'border-border bg-surface2'}`}>
                  <input type="checkbox" checked={form.roles.includes(r)} onChange={() => toggleRole(r)} />
                  <span className="capitalize">{r}</span>
                  {form.roles[0] === r && <span className="text-[9px] text-accent ml-auto">utama</span>}
                </label>
              ))}
            </div>
            <div className="text-[11px] font-semibold text-text2 mt-3.5 mb-2">AKSES & IZIN</div>
            <div className="grid grid-cols-2 gap-2">
              {ALL_PERMS.map((p) => (
                <label key={p} className="flex items-center gap-2 bg-surface2 rounded-md p-2 text-[11px] cursor-pointer">
                  <input type="checkbox" checked={form.perms.includes(p)} onChange={() => togglePerm(p)} />
                  {p}
                </label>
              ))}
            </div>
            {err && <div className="bg-danger/10 border border-danger/30 rounded-md px-3 py-2 text-[11px] text-danger mt-3">⚠️ {err}</div>}
            <div className="flex gap-2 mt-4">
              <button className="bg-accent text-bg rounded-md px-3 py-1.5 text-xs font-semibold" onClick={save}>💾 Simpan</button>
              <button className="border border-border text-text2 rounded-md px-3 py-1.5 text-xs" onClick={() => setOpen(false)}>Batal</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
