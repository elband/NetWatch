import { Navigate, Outlet } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

export default function RequireAuth() {
  const { user, loading } = useAuth();
  if (loading) return <div className="min-h-screen flex items-center justify-center text-text2">Memuat...</div>;
  if (!user) return <Navigate to="/login" replace />;
  return <Outlet />;
}
