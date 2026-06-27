import { Navigate, Route, Routes } from 'react-router-dom';
import { useAuth } from './context/AuthContext';
import { hasRole } from './utils/roles';
import RequireAuth from './components/RequireAuth';
import ProtectedRoute from './components/ProtectedRoute';
import AppLayout from './components/AppLayout';
import Login from './pages/Login';
import LaporPublik from './pages/LaporPublik';
import VerifyTte from './pages/VerifyTte';
import Ttd from './pages/Ttd';
import TtdPelaksana from './pages/TtdPelaksana';
import Dashboard from './pages/Dashboard';
import MyDashboard from './pages/MyDashboard';
import CoordDashboard from './pages/CoordDashboard';
import Devices from './pages/Devices';
import Monitor from './pages/Monitor';
import Incidents from './pages/Incidents';
import MyIncidents from './pages/MyIncidents';
import Reports from './pages/Reports';
import Jadwal from './pages/Jadwal';
import Performa from './pages/Performa';
import Users from './pages/Users';
import WaLog from './pages/WaLog';
import Settings from './pages/Settings';
import NotificationSettings from './pages/NotificationSettings';
import PublicReports from './pages/PublicReports';
import MasterData from './pages/MasterData';
import SshTerminal from './pages/SshTerminal';
import EquipmentPerf from './pages/EquipmentPerf';
import SuratKeluar from './pages/SuratKeluar';
import LaporanBulanan from './pages/LaporanBulanan';
import Attendance from './pages/Attendance';
import Diklat from './pages/Diklat';
import Dokumen from './pages/Dokumen';
import KegiatanNonRutin from './pages/KegiatanNonRutin';
import PelaporanQR from './pages/PelaporanQR';
import Notifikasi from './pages/Notifikasi';

function HomeRedirect() {
  const { user } = useAuth();
  if (!user) return <Navigate to="/login" replace />;
  const home = user.role === 'teknisi' ? '/my-dashboard' : '/dashboard';
  return <Navigate to={home} replace />;
}

// Dashboard gabungan: admin & koordinator melihat satu halaman lengkap
// (CoordDashboard + bagian unik dashboard admin); viewer tetap versi ringkas.
function DashboardRoute() {
  const { user } = useAuth();
  return hasRole(user, 'admin', 'koordinator') ? <CoordDashboard /> : <Dashboard />;
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/lapor" element={<LaporPublik />} />
      <Route path="/verify-tte" element={<VerifyTte />} />
      <Route path="/ttd" element={<Ttd />} />
      <Route path="/ttd-pelaksana" element={<TtdPelaksana />} />
      <Route element={<RequireAuth />}>
        <Route element={<AppLayout />}>
          {/* Terbuka untuk semua user terautentikasi */}
          <Route path="/" element={<HomeRedirect />} />
          <Route path="/dashboard" element={<DashboardRoute />} />
          <Route path="/my-dashboard" element={<MyDashboard />} />
          <Route path="/coord-dashboard" element={<Navigate to="/dashboard" replace />} />
          <Route path="/devices" element={<Devices />} />
          <Route path="/monitor" element={<Monitor />} />
          <Route path="/my-incidents" element={<MyIncidents />} />
          <Route path="/jadwal" element={<Jadwal />} />
          <Route path="/equipment" element={<EquipmentPerf />} />
          <Route path="/diklat" element={<Diklat />} />
          <Route path="/dokumen" element={<Dokumen />} />
          <Route path="/kegiatan-nr" element={<KegiatanNonRutin />} />
          <Route path="/notifikasi" element={<Notifikasi />} />

          {/* SSH: admin/koordinator/teknisi (bukan viewer) */}
          <Route element={<ProtectedRoute roles={['admin', 'koordinator', 'teknisi']} />}>
            <Route path="/ssh" element={<SshTerminal />} />
          </Route>

          {/* Manajer: admin & koordinator */}
          <Route element={<ProtectedRoute roles={['admin', 'koordinator']} />}>
            <Route path="/incidents" element={<Incidents />} />
            <Route path="/reports" element={<Reports />} />
            <Route path="/performa" element={<Performa />} />
            <Route path="/wa" element={<WaLog />} />
            <Route path="/publik-reports" element={<PublicReports />} />
            <Route path="/surat" element={<SuratKeluar />} />
            <Route path="/laporan-bulanan" element={<LaporanBulanan />} />
            <Route path="/attendance" element={<Attendance />} />
            <Route path="/pelaporan-qr" element={<PelaporanQR />} />
          </Route>

          {/* Admin saja */}
          <Route element={<ProtectedRoute roles={['admin']} />}>
            <Route path="/users" element={<Users />} />
            <Route path="/settings" element={<Settings />} />
            <Route path="/notification-settings" element={<NotificationSettings />} />
            <Route path="/master" element={<MasterData />} />
          </Route>
        </Route>
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
