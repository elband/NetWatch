import { useEffect, useState } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { BOTTOM_IDS, QUICK_IDS, idsForRoles, pickNav, shortLabel, type NavEntry, type NavLeaf } from './NavConfig';
import PowerIcon from './PowerIcon';
import type { Role, User } from '../types';

// Menu insiden per peran. Keduanya dikeluarkan dari bar bawah dan diwakili satu
// tombol mengambang.
const INCIDENT_IDS = ['incidents', 'my-incidents'];

const ROLE_COLOR: Record<string, string> = {
  admin: '#ef4444',
  koordinator: '#00d4aa',
  teknisi: '#0ea5e9',
  viewer: '#a78bfa',
};

/**
 * Navigasi bawah khusus layar kecil (< lg) — pola aplikasi, bukan versi kecil
 * dari sidebar. Empat tab tercepat sesuai peran + tab "Menu" yang membuka sheet
 * berisi seluruh menu. Di lg ke atas komponen ini hilang total dan tombol profil
 * mengambang (FloatingMenu) yang mengambil alih.
 *
 * Isi tab diambil dari menu efektif yang SUDAH disaring per unit (lihat
 * useNavItems), jadi unit yang tak punya menu tertentu otomatis dapat tab lain.
 */
export default function MobileNav({ navItems, user, allRoles, notif, notifKind, onEditProfile, onLogout }: {
  navItems: NavEntry[];
  user: User;
  allRoles: Role[];
  notif: number;
  /** Arti angka `notif` — menentukan tombol mana yang berhak memakainya. */
  notifKind: 'insiden' | 'kegiatan';
  onEditProfile: () => void;
  onLogout: () => void;
}) {
  const location = useLocation();
  // Simpan halaman saat sheet dibuka, bukan boolean: begitu pathname berubah
  // (klik menu ATAU tombol back), sheet tertutup sendiri tanpa efek tambahan.
  const [openedAt, setOpenedAt] = useState<string | null>(null);
  const open = openedAt === location.pathname;
  const close = () => setOpenedAt(null);

  // Kunci scroll latar selama sheet terbuka agar tidak "bocor" saat digeser.
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, [open]);

  // Insiden keluar dari bar bawah — ia jadi tombol mengambang tersendiri (lihat
  // IncidentFab). KEDUA id insiden dibuang dari kandidat tab, bukan hanya yang
  // terpilih: user multi-peran (admin+koordinator+teknisi) punya dua-duanya di
  // menu, dan menyaring satu saja menyisakan yang lain sebagai tab — dua pintu
  // ke hal yang sama. Targetnya sendiri ikut prioritas peran dari idsForRoles,
  // jadi manajer mendarat di /incidents dan teknisi murni di /my-incidents.
  const ordered = idsForRoles(BOTTOM_IDS, allRoles);
  const incidentId = ordered.find((id) => INCIDENT_IDS.includes(id)) ?? null;
  const incident = incidentId ? pickNav(navItems, [incidentId], 1)[0] ?? null : null;
  const tabs = pickNav(navItems, ordered.filter((id) => !INCIDENT_IDS.includes(id)), 4);
  if (!tabs.length && !incident) return null;

  const color = ROLE_COLOR[user.role] || '#00d4aa';
  // Dua di kiri, dua di kanan tombol tengah. Kalau menu unit menyisakan < 4 tab,
  // sisi kanan yang mengecil — tombol tengah tetap di kolom ke-3.
  const left = tabs.slice(0, 2);
  const right = tabs.slice(2, 4);
  // Ubin layanan di dalam sheet: pintasan tersering yang BUKAN sudah jadi tab —
  // percuma mengulang empat menu yang sudah nempel di bar bawah.
  const tabIds = new Set(tabs.map((t) => t.id));
  const layanan = pickNav(navItems, idsForRoles(QUICK_IDS, allRoles).filter((id) => !tabIds.has(id)), 8);

  return (
    <>
      {open && <MenuSheet navItems={navItems} layanan={layanan} user={user} allRoles={allRoles} color={color} onClose={close} onEditProfile={onEditProfile} onLogout={onLogout} />}

      <nav
        aria-label="Navigasi utama"
        className="lg:hidden fixed bottom-0 inset-x-0 z-40 nw-glass border-t border-border nw-safe-bottom"
      >
        {/* Dua tab · tombol Layanan menonjol di tengah · dua tab. Tombol tengah
            adalah titik terdekat dari ibu jari, jadi ia yang membuka seluruh
            layanan — tab kiri/kanan hanya pintasan ke halaman tersering. */}
        <div className="grid grid-cols-5 items-end">
          {[0, 1].map((i) => (left[i]
            ? <Tab key={left[i].id} to={`/${left[i].id}`} icon={left[i].icon} label={shortLabel(left[i])} title={left[i].label} badge={0} />
            : <span key={`l${i}`} aria-hidden />
          ))}

          <div className="flex flex-col items-center justify-end pb-1.5">
            <button
              type="button"
              onClick={() => setOpenedAt(location.pathname)}
              aria-label="Buka menu layanan"
              aria-expanded={open}
              className="relative -mt-7 w-14 h-14 rounded-full bg-gradient-to-br from-accent to-accent2 text-bg flex items-center justify-center shadow-lg shadow-accent/40 ring-4 ring-bg active:scale-95 transition-transform"
            >
              {/* Denyut cahaya sebagai lapisan terpisah, bukan animasi box-shadow
                  pada tombolnya sendiri — kalau langsung di tombol, keyframe akan
                  menimpa shadow & ring bawaannya (box-shadow satu properti). */}
              <span className="absolute inset-0 rounded-full nw-flipflop pointer-events-none" aria-hidden />
              <ServiceIcon />
              {/* Hitungan manajer = kegiatan menunggu persetujuan, bukan insiden —
                  itu tinggal di tombol Layanan. Hitungan teknisi (antrean pool)
                  pindah ke IncidentFab, supaya angkanya tak muncul di dua tempat
                  dengan arti berbeda. */}
              {notifKind === 'kegiatan' && notif > 0 && (
                <span className="absolute -top-0.5 -right-0.5 bg-danger text-white text-[9px] font-bold rounded-full min-w-[18px] h-[18px] flex items-center justify-center px-0.5 ring-2 ring-bg">
                  {notif > 9 ? '9+' : notif}
                </span>
              )}
            </button>
            <span className="text-[9px] font-semibold leading-none mt-1 text-accent">Layanan</span>
          </div>

          {[0, 1].map((i) => (right[i]
            ? <Tab key={right[i].id} to={`/${right[i].id}`} icon={right[i].icon} label={shortLabel(right[i])} title={right[i].label} badge={0} />
            : <span key={`r${i}`} aria-hidden />
          ))}
        </div>
      </nav>

      {incident && <IncidentFab item={incident} count={notifKind === 'insiden' ? notif : 0} />}
    </>
  );
}

/**
 * Pintasan Insiden yang mengambang di atas bar bawah (kanan), bukan salah satu
 * tab. Insiden adalah satu-satunya menu yang dibuka karena ADA KEJADIAN, bukan
 * karena sedang menyusuri aplikasi — memberinya tombol tersendiri dengan hitungan
 * membuat antrean yang menumpuk terlihat dari halaman mana pun.
 *
 * Duduk di kanan agar tak bertabrakan dengan tombol Layanan di tengah; pakai
 * .nw-above-nav supaya ikut naik oleh env(safe-area-inset-bottom) di ponsel
 * bertakik.
 */
function IncidentFab({ item, count }: { item: NavLeaf; count: number }) {
  return (
    <NavLink
      to={`/${item.id}`}
      title={item.label}
      aria-label={count > 0 ? `${item.label}, ${count} menunggu` : item.label}
      className={({ isActive }) =>
        `lg:hidden fixed nw-above-nav right-3 z-40 w-13 h-13 rounded-full flex flex-col items-center justify-center gap-0.5 border shadow-lg active:scale-95 transition-transform nw-glass ${
          isActive ? 'border-accent text-accent' : 'border-border text-text2'
        }`
      }
      style={{ width: 52, height: 52 }}
    >
      <span className="text-lg leading-none">{item.icon}</span>
      <span className="text-[8px] font-semibold leading-none">Insiden</span>
      {count > 0 && (
        <span className="absolute -top-1 -right-1 bg-danger text-white text-[9px] font-bold rounded-full min-w-[18px] h-[18px] flex items-center justify-center px-0.5 ring-2 ring-bg">
          {count > 9 ? '9+' : count}
        </span>
      )}
    </NavLink>
  );
}

/**
 * Ikon tombol Layanan: dua panah melingkar yang berputar pelan.
 *
 * Digambar sendiri (bukan aset pihak ketiga): dua busur 8px-radius yang saling
 * berhadapan 180°, masing-masing ditutup kepala panah segitiga pada arah
 * singgungnya. Titik-titik di luar meniru cincin putus-putus sebagai kesan
 * gerak. Putarannya diatur .nw-spin di index.css, yang mati sendiri saat
 * pengguna meminta pengurangan animasi.
 */
function ServiceIcon() {
  return (
    <svg viewBox="0 0 24 24" className="w-7 h-7 nw-spin" fill="none" stroke="currentColor" strokeWidth={1.9} strokeLinecap="round" aria-hidden focusable="false">
      {/* Busur atas (kiri → kanan lewat puncak) + kepala panah di ujung kanan */}
      <path d="M4.5 9.3 A8 8 0 0 1 19.5 9.3" />
      <path d="M20 10.7 L16.9 8.6 L21.1 7.1 Z" fill="currentColor" stroke="none" />
      {/* Busur bawah — rotasi 180° dari busur atas */}
      <path d="M19.5 14.7 A8 8 0 0 1 4.5 14.7" />
      <path d="M4 13.3 L7.1 15.4 L2.9 16.9 Z" fill="currentColor" stroke="none" />
    </svg>
  );
}

function Badge({ n }: { n: number }) {
  return (
    <span className="absolute top-1 right-[22%] bg-danger text-white text-[9px] font-bold rounded-full min-w-[16px] h-[16px] flex items-center justify-center px-0.5">
      {n > 9 ? '9+' : n}
    </span>
  );
}

function Tab({ to, icon, label, title, badge }: { to: string; icon: string; label: string; title: string; badge: number }) {
  return (
    <NavLink
      to={to}
      title={title}
      className={({ isActive }) =>
        `relative flex flex-col items-center justify-center gap-0.5 py-2 active:scale-95 transition-transform ${isActive ? 'text-accent' : 'text-text2'}`
      }
    >
      {({ isActive }) => (
        <>
          {/* Penanda tab aktif di tepi atas bar — tidak menggeser layout tab. */}
          {isActive && <span className="absolute top-0 h-[2px] w-8 rounded-full bg-accent" />}
          <span className="text-[19px] leading-none">{icon}</span>
          <span className="text-[9px] font-semibold leading-none truncate max-w-full px-1">{label}</span>
          {badge > 0 && <Badge n={badge} />}
        </>
      )}
    </NavLink>
  );
}

// Sheet menu lengkap: naik dari bawah, berisi profil, seluruh menu (per section),
// dan tombol keluar. Dua kolom agar menu panjang tetap terjangkau satu tangan.
function MenuSheet({ navItems, layanan, user, allRoles, color, onClose, onEditProfile, onLogout }: {
  navItems: NavEntry[];
  layanan: NavLeaf[];
  user: User;
  allRoles: Role[];
  color: string;
  onClose: () => void;
  onEditProfile: () => void;
  onLogout: () => void;
}) {
  return (
    <div className="lg:hidden fixed inset-0 z-[45]" role="dialog" aria-modal="true" aria-label="Menu lengkap">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} aria-hidden />
      <div className="nw-sheet absolute inset-x-0 bottom-0 max-h-[85vh] flex flex-col rounded-t-2xl border-t border-border nw-glass shadow-2xl">
        <div className="flex justify-center pt-2 pb-1 shrink-0" onClick={onClose}>
          <span className="w-10 h-1 rounded-full bg-text2/40" />
        </div>

        <button onClick={() => { onClose(); onEditProfile(); }} className="w-full flex items-center gap-2.5 px-4 py-3 border-b border-border hover:bg-text/5 text-left shrink-0">
          <div className="w-10 h-10 rounded-full overflow-hidden flex items-center justify-center text-lg shrink-0" style={{ background: `${color}33`, border: `2px solid ${color}` }}>
            {user.avatar_url ? <img src={user.avatar_url} alt="" className="w-full h-full object-cover" /> : user.emoji}
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-[13px] font-semibold truncate flex items-center gap-1">{user.name}<span className="text-text2 text-[10px]">✏️</span></div>
            <div className="flex flex-wrap gap-1 mt-0.5">
              {allRoles.map((r) => <span key={r} className="text-[9px] px-1.5 py-0.5 rounded-full" style={{ background: `${ROLE_COLOR[r]}33`, color: ROLE_COLOR[r] }}>{r}</span>)}
            </div>
          </div>
        </button>

        <nav className="flex-1 min-h-0 overflow-y-auto overscroll-contain px-2 py-2">
          {/* Layanan tersering sebagai ubin ikon besar — target sentuh lebar,
              terjangkau ibu jari, tanpa perlu menyusuri daftar panjang. */}
          {layanan.length >= 2 && (
            <>
              <div className="px-2 pt-1 pb-1.5 text-[9px] text-text2 uppercase tracking-[1.5px]">Layanan</div>
              <div className="grid grid-cols-4 gap-1.5 mb-2 pb-2 border-b border-border">
                {layanan.map((n) => (
                  <NavLink
                    key={n.id}
                    to={`/${n.id}`}
                    onClick={onClose}
                    title={n.label}
                    className={({ isActive }) => `flex flex-col items-center gap-1 rounded-xl px-1 py-2.5 ${isActive ? 'bg-accent/15 text-accent' : 'text-text2 active:bg-text/10'}`}
                  >
                    <span className="text-xl leading-none">{n.icon}</span>
                    <span className="text-[9px] font-semibold leading-tight text-center line-clamp-2">{shortLabel(n)}</span>
                  </NavLink>
                ))}
              </div>
            </>
          )}

          <div className="grid grid-cols-2 gap-x-1.5 gap-y-0.5">
          {navItems.map((n, idx) =>
            'section' in n ? (
              <div key={`s${idx}`} className="col-span-2 px-2 pt-2 pb-0.5 text-[9px] text-text2 uppercase tracking-[1.5px]">{n.section}</div>
            ) : (
              <NavLink
                key={n.id}
                to={`/${n.id}`}
                onClick={onClose}
                className={({ isActive }) => `flex items-center gap-2 px-2.5 py-2.5 rounded-lg text-[12px] ${isActive ? 'bg-accent/15 text-accent font-semibold' : 'text-text2 active:bg-text/10'}`}
              >
                <span className="shrink-0">{(n as NavLeaf).icon}</span>
                <span className="truncate">{(n as NavLeaf).label}</span>
              </NavLink>
            )
          )}
          </div>
        </nav>

        <button onClick={() => { onClose(); onLogout(); }} className="w-full border-t border-border px-4 py-3 text-[13px] text-left text-danger active:bg-danger/10 flex items-center gap-2 shrink-0 nw-safe-bottom">
          <PowerIcon /> Keluar
        </button>
      </div>
    </div>
  );
}
