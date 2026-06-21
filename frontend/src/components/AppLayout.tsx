import { useEffect, useRef, useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { api } from '../api/client';
import { hasRole, userRoles } from '../utils/roles';
import { NAV_ITEMS, PAGE_TITLES, type NavEntry } from './NavConfig';
import NotificationCenter from './NotificationCenter';
import type { Role, User } from '../types';

const ROLE_COLOR: Record<string, string> = {
  admin: '#ef4444',
  koordinator: '#00d4aa',
  teknisi: '#0ea5e9',
  viewer: '#a78bfa',
};
const SHIFT_LABEL: Record<string, string> = { pagi: 'Pagi · 05.00–13.00', siang: 'Siang · 12.00–20.00', malam: 'Malam · 20.00–05.00' };
const ROLE_ORDER: Role[] = ['admin', 'koordinator', 'teknisi', 'viewer'];

// Gabungkan menu dari semua peran user: item unik per id (dan per label, agar
// "Dashboard" admin & koordinator tidak muncul dobel), dikelompokkan per
// section (kemunculan pertama), section kosong dibuang.
function mergedNav(roles: Role[]): NavEntry[] {
  const seen = new Set<string>();
  const seenLabels = new Set<string>();
  const groups = new Map<string, Extract<NavEntry, { id: string }>[]>();
  const order: string[] = [];
  let cur = 'Menu';
  for (const role of ROLE_ORDER) {
    if (!roles.includes(role)) continue;
    for (const e of NAV_ITEMS[role] || []) {
      if ('section' in e && e.section) {
        cur = e.section;
        if (!groups.has(cur)) { groups.set(cur, []); order.push(cur); }
      } else if ('id' in e && !seen.has(e.id) && !seenLabels.has(e.label)) {
        seen.add(e.id);
        seenLabels.add(e.label);
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
    if (isTech) api.get('/incidents/duty-status').then((res) => setDuty(res.data)).catch(() => {});
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
  const firstName = (user.name || '').split(' ')[0];

  return (
    <div className="min-h-screen flex flex-col">
      <header className="bg-surface border-b border-border min-h-[58px] px-4 sm:px-6 py-2 flex items-center gap-3 sm:gap-4 sticky top-0 z-30">
        <div className="flex items-center gap-2.5 shrink-0">
          <div className="w-8 h-8 rounded-[7px] flex items-center justify-center text-[15px] bg-gradient-to-br from-accent to-accent2">📡</div>
          <div className="hidden sm:block leading-tight">
            <div className="text-sm font-bold">NetWatch <span className="text-accent">ERP</span></div>
            <div className="text-[9px] text-text2 uppercase tracking-wider">Airport Technology Operations</div>
          </div>
        </div>
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
        <NotificationCenter />
        <span className="text-[11px] text-text2 font-mono hidden sm:inline"><HeaderClock /></span>
      </header>

      <main className="flex-1 p-5">
        <div key={location.pathname} className="nw-page-in"><Outlet /></div>
      </main>

      {/* Tombol profil mengambang: bisa digeser ke mana saja, klik = menu (gabungan ☰ + profil). */}
      <FloatingMenu navItems={navItems} user={user} allRoles={allRoles} notif={notif} onEditProfile={() => setShowProfile(true)} onLogout={logout} />

      {showProfile && <ProfileModal onClose={() => setShowProfile(false)} onSaved={updateSession} />}
    </div>
  );
}

// ===== Tombol profil mengambang (draggable) + popover menu lengkap =====
function FloatingMenu({ navItems, user, allRoles, notif, onEditProfile, onLogout }: {
  navItems: NavEntry[]; user: User; allRoles: Role[]; notif: number; onEditProfile: () => void; onLogout: () => void;
}) {
  const SIZE = 54;
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState(() => {
    try { const s = JSON.parse(localStorage.getItem('nw_fab') || 'null'); if (s && typeof s.x === 'number' && typeof s.y === 'number') return s; } catch { /* abaikan */ }
    const h = typeof window !== 'undefined' ? window.innerHeight : 800;
    return { x: 18, y: h - SIZE - 26 };
  });
  const posRef = useRef(pos);
  const drag = useRef({ active: false, moved: false, sx: 0, sy: 0, ox: 0, oy: 0 });
  const clamp = (v: number, max: number) => Math.min(Math.max(0, v), Math.max(0, max));

  // Jaga agar tetap di dalam layar saat ukuran jendela berubah.
  useEffect(() => {
    function onResize() {
      setPos((p: { x: number; y: number }) => {
        const np = { x: clamp(p.x, window.innerWidth - SIZE), y: clamp(p.y, window.innerHeight - SIZE) };
        posRef.current = np; return np;
      });
    }
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  function down(e: React.PointerEvent) {
    try { (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId); } catch { /* abaikan */ }
    drag.current = { active: true, moved: false, sx: e.clientX, sy: e.clientY, ox: e.clientX - pos.x, oy: e.clientY - pos.y };
  }
  function move(e: React.PointerEvent) {
    const d = drag.current;
    if (!d.active) return;
    if (!d.moved && Math.hypot(e.clientX - d.sx, e.clientY - d.sy) < 5) return;
    d.moved = true;
    const np = { x: clamp(e.clientX - d.ox, window.innerWidth - SIZE), y: clamp(e.clientY - d.oy, window.innerHeight - SIZE) };
    posRef.current = np; setPos(np);
  }
  function up() {
    const d = drag.current;
    if (!d.active) return;
    d.active = false;
    if (d.moved) localStorage.setItem('nw_fab', JSON.stringify(posRef.current));
    else setOpen((o) => !o);
  }

  const color = ROLE_COLOR[user.role] || '#00d4aa';
  const vw = typeof window !== 'undefined' ? window.innerWidth : 1280;
  const vh = typeof window !== 'undefined' ? window.innerHeight : 800;
  const openLeft = pos.x > vw / 2;
  const openUp = pos.y > vh / 2;
  const popStyle: React.CSSProperties = { width: 320, transformOrigin: `${openLeft ? 'right' : 'left'} ${openUp ? 'bottom' : 'top'}` };
  if (openLeft) popStyle.right = vw - pos.x - SIZE; else popStyle.left = pos.x;
  if (openUp) popStyle.bottom = vh - pos.y + 10; else popStyle.top = pos.y + SIZE + 10;

  return (
    <>
      {open && <div className="fixed inset-0 z-[39]" onClick={() => setOpen(false)} aria-hidden />}
      {open && (
        <div className="fixed z-40 rounded-2xl border border-white/10 shadow-2xl overflow-hidden nw-pop" style={{ ...popStyle, background: 'rgba(22,27,34,0.62)', backdropFilter: 'blur(16px) saturate(140%)', WebkitBackdropFilter: 'blur(16px) saturate(140%)' }}>
          <button onClick={() => { setOpen(false); onEditProfile(); }} className="w-full flex items-center gap-2.5 px-3.5 py-3 border-b border-white/10 hover:bg-white/5 text-left">
            <div className="w-9 h-9 rounded-full overflow-hidden flex items-center justify-center text-base shrink-0" style={{ background: `${color}33`, border: `2px solid ${color}` }}>{user.avatar_url ? <img src={user.avatar_url} alt="" className="w-full h-full object-cover" /> : user.emoji}</div>
            <div className="flex-1 min-w-0">
              <div className="text-xs font-semibold truncate flex items-center gap-1">{user.name}<span className="text-text2 text-[10px]">✏️</span></div>
              <div className="flex flex-wrap gap-1 mt-0.5">{allRoles.map((r) => <span key={r} className="text-[9px] px-1.5 py-0.5 rounded-full" style={{ background: `${ROLE_COLOR[r]}33`, color: ROLE_COLOR[r] }}>{r}</span>)}</div>
            </div>
          </button>
          <nav className="grid grid-cols-2 gap-x-1 gap-y-0.5 px-1.5 py-2 nav-anim">
            {navItems.map((n, idx) =>
              'section' in n ? (
                <div key={idx} style={{ animationDelay: `${idx * 0.012}s` }} className="col-span-2 px-2 pt-1.5 pb-0.5 text-[9px] text-text2 uppercase tracking-[1.5px]">{n.section}</div>
              ) : (
                <NavLink key={n.id} to={`/${n.id}`} onClick={() => setOpen(false)} style={{ animationDelay: `${idx * 0.012}s` }}
                  className={({ isActive }) => `nav-link flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[12px] ${isActive ? 'nav-link-active bg-accent/15 text-accent' : 'text-text2 hover:bg-white/10 hover:text-white'}`}>
                  <span className="shrink-0">{n.icon}</span><span className="truncate">{n.label}</span>
                </NavLink>
              )
            )}
          </nav>
          <button onClick={() => { setOpen(false); onLogout(); }} className="w-full border-t border-white/10 px-3.5 py-2.5 text-[13px] text-left text-danger hover:bg-danger/10 flex items-center gap-2">⏻ Keluar</button>
        </div>
      )}
      <button
        onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up}
        style={{ left: pos.x, top: pos.y, width: SIZE, height: SIZE, borderColor: color, boxShadow: `0 8px 24px ${color}55` }}
        title="Geser untuk pindahkan · klik untuk buka menu"
        aria-label="Menu & profil"
        className="fixed z-40 rounded-full bg-surface border-2 flex items-center justify-center text-2xl cursor-grab active:cursor-grabbing touch-none select-none transition-shadow hover:brightness-110"
      >
        {user.avatar_url ? <img src={user.avatar_url} alt="" draggable={false} className="absolute inset-0 w-full h-full rounded-full object-cover pointer-events-none" /> : user.emoji}
        {notif > 0 && <span className="absolute -top-1 -right-1 bg-danger text-white text-[9px] font-bold rounded-full min-w-[16px] h-[16px] flex items-center justify-center px-0.5">{notif > 9 ? '9+' : notif}</span>}
      </button>
    </>
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

function ProfileModal({ onClose, onSaved }: { onClose: () => void; onSaved: (token: string, user: User) => void }) {
  const { user } = useAuth();
  const [f, setF] = useState({ name: user?.name || '', email: user?.email || '', phone: user?.phone || '', jabatan: user?.jabatan || '' });
  const [pin, setPin] = useState('');
  const [pin2, setPin2] = useState('');
  const [photo, setPhoto] = useState<File | null>(null);
  const [photoPreview, setPhotoPreview] = useState<string | null>(user?.avatar_url || null);
  const [removePhoto, setRemovePhoto] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');
  const set = (k: string, v: string) => setF((p) => ({ ...p, [k]: v }));
  const color = ROLE_COLOR[user?.role || 'viewer'] || '#00d4aa';

  function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const fl = e.target.files?.[0];
    if (!fl) return;
    if (fl.size > 5 * 1024 * 1024) { setErr('Ukuran foto maksimal 5 MB.'); return; }
    setPhoto(fl); setPhotoPreview(URL.createObjectURL(fl)); setRemovePhoto(false); setErr('');
  }
  function clearPhoto() { setPhoto(null); setPhotoPreview(null); setRemovePhoto(true); if (fileRef.current) fileRef.current.value = ''; }

  async function save() {
    if (!f.name.trim()) return setErr('Nama wajib diisi.');
    if (pin && pin !== pin2) return setErr('Konfirmasi PIN tidak cocok.');
    if (pin && !/^\d{4,6}$/.test(pin)) return setErr('PIN harus 4–6 digit angka.');
    setBusy(true); setErr(''); setMsg('');
    try {
      const fd = new FormData();
      fd.append('name', f.name); fd.append('email', f.email); fd.append('phone', f.phone); fd.append('jabatan', f.jabatan);
      if (pin) fd.append('pin', pin);
      if (photo) fd.append('photo', photo);
      else if (removePhoto) fd.append('removePhoto', '1');
      const r = await api.put('/auth/profile', fd, { headers: { 'Content-Type': 'multipart/form-data' } });
      onSaved(r.data.token, r.data.user);
      setMsg('Profil berhasil diperbarui.'); setPin(''); setPin2('');
      setTimeout(onClose, 900);
    } catch (e: any) { setErr(e?.response?.data?.error || 'Gagal menyimpan.'); }
    finally { setBusy(false); }
  }

  const inp = 'w-full bg-surface2 border border-border rounded-md px-3 py-2 text-xs';
  return (
    <div className="fixed inset-0 z-[60] bg-black/60 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-surface border border-border rounded-xl w-full max-w-sm p-5 max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4"><h3 className="text-sm font-bold">👤 Edit Profil</h3><button onClick={onClose} className="text-text2 hover:text-white text-lg leading-none">×</button></div>
        <div className="flex items-center gap-3 mb-4">
          <div className="w-16 h-16 rounded-full overflow-hidden flex items-center justify-center text-3xl shrink-0 bg-surface2" style={{ border: `2px solid ${color}` }}>
            {photoPreview ? <img src={photoPreview} alt="Foto profil" className="w-full h-full object-cover" /> : (user?.emoji || '👤')}
          </div>
          <div className="flex flex-col gap-1.5">
            <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={onPick} />
            <button type="button" onClick={() => fileRef.current?.click()} className="border border-border text-text2 hover:text-white rounded-md px-3 py-1.5 text-xs">📷 {photoPreview ? 'Ganti Foto' : 'Unggah Foto'}</button>
            {photoPreview && <button type="button" onClick={clearPhoto} className="text-[11px] text-danger hover:underline text-left">Hapus foto (pakai ikon)</button>}
            <span className="text-[10px] text-text2">JPG/PNG/WebP, maks 5 MB</span>
          </div>
        </div>
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
