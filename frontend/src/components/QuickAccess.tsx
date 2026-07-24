import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { userRoles } from '../utils/roles';
import { QUICK_IDS, idsForRoles, pickNav, useNavItems } from './NavConfig';

/**
 * Kartu "Akses Cepat" — pintasan berikon besar ke menu yang paling sering
 * dipakai, gaya home screen aplikasi. Di ponsel dua kolom (target sentuh lebar),
 * melebar sampai empat kolom di layar besar.
 *
 * Isinya diambil dari menu efektif user (sudah disaring peran & unit), jadi
 * pintasan tidak pernah menunjuk halaman yang tak boleh/tak relevan dibuka.
 */
export default function QuickAccess({ max = 8 }: { max?: number }) {
  const { user } = useAuth();
  const navItems = useNavItems(user);
  const items = pickNav(navItems, idsForRoles(QUICK_IDS, userRoles(user)), max);
  if (items.length < 2) return null;

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <h3 className="font-head text-sm font-bold">⚡ Akses Cepat</h3>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
        {items.map((n) => (
          <Link
            key={n.id}
            to={`/${n.id}`}
            className="nw-card bg-surface border border-border rounded-xl px-3 py-3.5 flex items-center gap-2.5 sm:flex-col sm:gap-1.5 sm:text-center hover:border-accent/40"
          >
            <span className="text-2xl leading-none shrink-0">{n.icon}</span>
            {/* Dua baris, bukan ellipsis: "Manajemen Suku Cadang" vs "Manajemen
                User" terpotong jadi tak terbedakan kalau dipangkas satu baris. */}
            <span className="text-[11px] font-semibold leading-tight min-w-0 line-clamp-2">{n.label}</span>
          </Link>
        ))}
      </div>
    </div>
  );
}
