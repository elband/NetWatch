import { Navigate, Outlet } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { hasRole } from '../utils/roles';
import type { Role } from '../types';

// Penjaga rute berbasis peran (defense-in-depth — backend tetap otoritas utama).
// User tanpa peran yang diizinkan diarahkan ke beranda, bukan menampilkan halaman.
export default function ProtectedRoute({ roles }: { roles: Role[] }) {
  const { user, loading } = useAuth();
  if (loading) return <div className="min-h-screen flex items-center justify-center text-text2">Memuat...</div>;
  if (!user) return <Navigate to="/login" replace />;
  if (!hasRole(user, ...roles)) return <Navigate to="/" replace />;
  return <Outlet />;
}
