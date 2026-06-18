import { useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { api } from '../api/client';
import { hasRole, userRoles } from '../utils/roles';
import { NAV_ITEMS, PAGE_TITLES, type NavEntry } from './NavConfig';
import type { Role } from '../types';

const ROLE_COLOR: Record<string, string> = {
  admin: '#ef4444',
  koordinator: '#00d4aa',
  teknisi: '#0ea5e9',
  viewer: '#a78bfa',
};
const SHIFT_LABEL: Record<string, string> = { pagi: 'Pagi · 05.00–13.00', siang: 'Siang · 12.00–20.00', malam: 'Malam · 20.00–05.00' };
const ROLE_ORDER: Role[] = ['admin', 'koordinator', 'teknisi', 'viewer'];

// Gabungkan menu dari semua peran user: item unik per id, dikelompokkan per
// section (kemunculan pertama), section kosong dibuang.
function mergedNav(roles: Role[]): NavEntry[] {
  const seen = new Set<string>();
  const groups = new Map<string, Extract<NavEntry, { id: string }>[]>();
  const order: string[] = [];
  let cur = 'Menu';
  for (const role of ROLE_ORDER) {
    if (!roles.includes(role)) continue;
    for (const e of NAV_ITEMS[role] || []) {
      if ('section' in e && e.section) {
        cur = e.section;
        if (!groups.has(cur)) { groups.set(cur, []); order.push(cur); }
      } else if ('id' in e && !seen.has(e.id)) {
        seen.add(e.id);
        if (!groups.has(cur)) { groups.set(cur, []); order.push(cur); }
        groups.get(cur)!.push(e);
      }
    }
  }
  const out: NavEntry[] = [];
  for (const title of order) {
    const its = groups.get(title)!;
    if (its.length) { out.push({ section: title }); out.push(...its); }
  }
  return out;
}

export default function AppLayout() {
  const { user, logout, updateSession } = useAuth();
  const [showProfile, setShowProfile] = useState(false);
  const location = useLocation();
  const [duty, setDuty] = useState<{ onDuty: boolean; shift: string | null } | null>(null);

  const isTech = hasRole(user, 'teknisi');
  const isManager = hasRole(user, 'koordinator', 'admin');
  const [notif, setNotif] = useState(0);
  useEffect(() => {
    if (isTech) {
      api.get('/incidents/duty-status').then((res) => setDuty(res.data)).catch(() => {});
    }
  }, [isTech]);
  useEffect(() => {
    function loadNotif() {
      if (isManager) api.get('/activities?status=menunggu').then((r) => setNotif(r.data.activities.length)).catch(() => {});
      else if (isTech) api.get('/incidents/queue').then((r) => setNotif((r.data.pool || []).length)).catch(() => {});
    }
    loadNotif();
    const t = setInterval(loadNotif, 30000);
    return () => clearInterval(t);
  }, [isManager, isTech]);

  if (!user) return null;
  const allRoles = userRoles(user);
  const navItems = mergedNav(allRoles).length ? mergedNav(allRoles) : NAV_ITEMS.viewer;
  const currentId = location.pathname.replace('/', '') || navItems.find((n): n is Extract<NavEntry, { id: string }> => 'id' in n)?.id;
  const title = PAGE_TITLES[currentId || ''] || 'Dashboard';
  const color = ROLE_COLOR[user.role];
  const firstName = (user.name || '').split(' ')[0];

  return (
    <div className="flex min-h-screen">
      <aside className="w-[220px] min-h-screen bg-surface border-r border-border flex flex-col fixed top-0 left-0 z-50">
        <div className="px-4 py-[18px] border-b border-border flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-[7px] flex items-center justify-center text-[15px] bg-gradient-to-br from-accent to-accent2">📡</div>
          <div>
            <div className="text-sm font-bold">NetWatch</div>
            <div className="text-[10px] text-text2 uppercase tracking-wider">ERP v2.0</div>
          </div>
        </div>
        <nav className="flex-1 py-2.5 overflow-y-auto">
          {navItems.map((n, idx) =>
            'section' in n ? (
              <div key={idx} className="px-4 pt-2 pb-0.5 text-[10px] text-text2 uppercase tracking-[1.5px]">{n.section}</div>
            ) : (
              <NavLink
                key={n.id}
                to={`/${n.id}`}
                className={({ isActive }) =>
                  `flex items-center gap-2.5 px-4 py-2 text-[13px] border-l-[3px] transition-colors ${
                    isActive ? 'bg-accent/10 border-accent text-accent' : 'border-transparent text-text2 hover:bg-white/5 hover:text-white'
                  }`
                }
              >
                {n.icon} {n.label}
              </NavLink>
            )
          )}
        </nav>
        <button onClick={() => setShowProfile(true)} title="Klik untuk edit profil & ubah PIN"
          className="group w-full px-4 py-3 border-t border-border flex items-center gap-2.5 text-left hover:bg-surface2 transition relative">
          <div
            className="w-8 h-8 rounded-full flex items-center justify-center text-sm flex-shrink-0"
            style={{ background: `${color}22`, border: `2px solid ${color}` }}
          >
            {user.emoji}
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-xs font-semibold truncate flex items-center gap-1">{user.name} <span className="opacity-0 group-hover:opacity-100 text-text2 text-[10px] transition">✏️</span></div>
            <div className="flex flex-wrap gap-1 mt-0.5">
              {allRoles.map((r) => (
                <span key={r} className="text-[9px] px-1.5 py-0.5 rounded-full" style={{ background: `${ROLE_COLOR[r]}22`, color: ROLE_COLOR[r] }}>{r}</span>
              ))}
            </div>
          </div>
          <span className="absolute -top-7 left-4 hidden group-hover:block bg-bg border border-border text-text2 text-[10px] px-2 py-1 rounded whitespace-nowrap">Edit profil & PIN</span>
        </button>
      </aside>

      <main className="ml-[220px] flex-1 flex flex-col min-h-screen">
        <header className="bg-surface border-b border-border min-h-[58px] px-6 py-2 flex items-center gap-4 sticky top-0 z-40">
          <div className="flex-1 min-w-0">
            <div className="text-sm font-bold truncate"><HeaderGreeting firstName={firstName} /></div>
            <div className="text-[10px] text-text2 truncate">{user.jabatan || title}</div>
          </div>
          <div className="text-center hidden sm:block">
            <div className="text-text2 text-[9px] uppercase">📅 Tanggal</div>
            <div className="text-[11px] font-semibold"><HeaderDate /></div>
          </div>
          {isTech && (
            <>
              <div className="text-center hidden md:block">
                <div className="text-text2 text-[9px] uppercase">{duty?.onDuty ? '☀️' : '🌙'} Shift</div>
                <div className="text-[11px] font-semibold">{duty?.shift ? SHIFT_LABEL[duty.shift] : 'Di luar jadwal'}</div>
              </div>
              <span className="flex items-center gap-1.5">
                <span className="relative flex h-2.5 w-2.5">
                  {duty?.onDuty && <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-success opacity-75" />}
                  <span className={`relative inline-flex rounded-full h-2.5 w-2.5 ${duty?.onDuty ? 'bg-success' : 'bg-warn'}`} />
                </span>
                <span className={`text-[11px] font-semibold ${duty?.onDuty ? 'text-success' : 'text-warn'}`}>{duty?.onDuty ? 'On-Duty' : 'Off-Duty'}</span>
              </span>
            </>
          )}
          <NavLink to={hasRole(user, 'teknisi') ? '/my-incidents' : hasRole(user, 'koordinator') ? '/coord-dashboard' : '/dashboard'} className="relative text-base hover:opacity-80" title={notif > 0 ? `${notif} perlu perhatian` : 'Tidak ada notifikasi'}>
            🔔
            {notif > 0 && <span className="absolute -top-1.5 -right-1.5 bg-danger text-white text-[8px] font-bold rounded-full min-w-[14px] h-[14px] flex items-center justify-center px-0.5">{notif > 9 ? '9+' : notif}</span>}
          </NavLink>
          <span className="text-[11px] text-text2 font-mono"><HeaderClock /></span>
          <button className="border border-border text-text2 rounded-md px-3 py-1.5 text-xs hover:text-white" onClick={logout}>
            ⏻ Keluar
          </button>
        </header>
        <div className="p-5 flex-1">
          <Outlet />
        </div>
      </main>
      {showProfile && <ProfileModal onClose={() => setShowProfile(false)} onSaved={updateSession} />}
    </div>
  );
}

// Komponen waktu diisolasi: timer hanya me-render teks kecilnya sendiri, BUKAN
// seluruh AppLayout/halaman. Ini mencegah form yang sedang diketik ke-render
// ulang tiap detik (yang sebelumnya bikin input "hilang" saat mengetik pelan).
function HeaderGreeting({ firstName }: { firstName: string }) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => { const t = setInterval(() => setNow(new Date()), 60000); return () => clearInterval(t); }, []);
  const h = now.getHours();
  const greeting = h < 11 ? 'Selamat Pagi' : h < 15 ? 'Selamat Siang' : h < 18 ? 'Selamat Sore' : 'Selamat Malam';
  return <>{greeting}, {firstName} 👋</>;
}
function HeaderDate() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => { const t = setInterval(() => setNow(new Date()), 60000); return () => clearInterval(t); }, []);
  return <>{now.toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' })}</>;
}
function HeaderClock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => { const t = setInterval(() => setNow(new Date()), 1000); return () => clearInterval(t); }, []);
  return <>{now.toLocaleTimeString('id', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</>;
}

function ProfileModal({ onClose, onSaved }: { onClose: () => void; onSaved: (token: string, user: import('../types').User) => void }) {
  const { user } = useAuth();
  const [f, setF] = useState({ name: user?.name || '', email: user?.email || '', phone: user?.phone || '', jabatan: user?.jabatan || '' });
  const [pin, setPin] = useState('');
  const [pin2, setPin2] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');
  const set = (k: string, v: string) => setF((p) => ({ ...p, [k]: v }));

  async function save() {
    if (!f.name.trim()) return setErr('Nama wajib diisi.');
    if (pin && pin !== pin2) return setErr('Konfirmasi PIN tidak cocok.');
    if (pin && !/^\d{4,6}$/.test(pin)) return setErr('PIN harus 4–6 digit angka.');
    setBusy(true); setErr(''); setMsg('');
    try {
      const body: any = { ...f }; if (pin) body.pin = pin;
      const r = await api.put('/auth/profile', body);
      onSaved(r.data.token, r.data.user);
      setMsg('Profil berhasil diperbarui.'); setPin(''); setPin2('');
      setTimeout(onClose, 900);
    } catch (e: any) { setErr(e?.response?.data?.error || 'Gagal menyimpan.'); }
    finally { setBusy(false); }
  }

  const inp = 'w-full bg-surface2 border border-border rounded-md px-3 py-2 text-xs';
  return (
    <div className="fixed inset-0 z-[60] bg-black/60 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-surface border border-border rounded-xl w-full max-w-sm p-5" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4"><h3 className="text-sm font-bold">👤 Edit Profil</h3><button onClick={onClose} className="text-text2 hover:text-white text-lg leading-none">×</button></div>
        <label className="block text-[11px] text-text2 mb-1">Nama</label>
        <input className={`${inp} mb-3`} value={f.name} onChange={(e) => set('name', e.target.value)} />
        <label className="block text-[11px] text-text2 mb-1">Email</label>
        <input className={`${inp} mb-3`} value={f.email} onChange={(e) => set('email', e.target.value)} />
        <label className="block text-[11px] text-text2 mb-1">No. HP / WhatsApp</label>
        <input className={`${inp} mb-3`} value={f.phone} onChange={(e) => set('phone', e.target.value)} placeholder="08…" />
        <label className="block text-[11px] text-text2 mb-1">Jabatan</label>
        <input className={`${inp} mb-3`} value={f.jabatan} onChange={(e) => set('jabatan', e.target.value)} />
        <div className="border-t border-border pt-3 mt-1">
          <div className="text-[11px] text-text2 mb-2">🔐 Ubah PIN (kosongkan bila tidak diubah)</div>
          <input type="password" inputMode="numeric" maxLength={6} className={`${inp} mb-2`} value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))} placeholder="PIN baru (4–6 digit)" />
          <input type="password" inputMode="numeric" maxLength={6} className={inp} value={pin2} onChange={(e) => setPin2(e.target.value.replace(/\D/g, ''))} placeholder="Konfirmasi PIN baru" />
        </div>
        {err && <div className="bg-danger/10 border border-danger/30 rounded-md px-3 py-2 text-[11px] text-danger mt-3">⚠️ {err}</div>}
        {msg && <div className="bg-success/10 border border-success/30 rounded-md px-3 py-2 text-[11px] text-success mt-3">✓ {msg}</div>}
        <div className="flex gap-2 justify-end mt-4">
          <button className="border border-border text-text2 rounded-md px-3 py-1.5 text-xs" onClick={onClose} disabled={busy}>Batal</button>
          <button className="bg-accent text-bg rounded-md px-3 py-1.5 text-xs font-semibold disabled:opacity-50" onClick={save} disabled={busy}>{busy ? 'Menyimpan…' : 'Simpan'}</button>
        </div>
      </div>
    </div>
  );
}
