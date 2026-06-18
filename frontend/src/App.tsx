import { Navigate, Route, Routes } from 'react-router-dom';
import { useAuth } from './context/AuthContext';
import RequireAuth from './components/RequireAuth';
import AppLayout from './components/AppLayout';
import Login from './pages/Login';
import LaporPublik from './pages/LaporPublik';
import VerifyTte from './pages/VerifyTte';
import Ttd from './pages/Ttd';
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

function HomeRedirect() {
  const { user } = useAuth();
  if (!user) return <Navigate to="/login" replace />;
  const home = user.role === 'teknisi' ? '/my-dashboard' : user.role === 'koordinator' ? '/coord-dashboard' : '/dashboard';
  return <Navigate to={home} replace />;
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/lapor" element={<LaporPublik />} />
      <Route path="/verify-tte" element={<VerifyTte />} />
      <Route path="/ttd" element={<Ttd />} />
      <Route element={<RequireAuth />}>
        <Route element={<AppLayout />}>
          <Route path="/" element={<HomeRedirect />} />
          <Route path="/dashboard" element={<Dashboard />} />
          <Route path="/my-dashboard" element={<MyDashboard />} />
          <Route path="/coord-dashboard" element={<CoordDashboard />} />
          <Route path="/devices" element={<Devices />} />
          <Route path="/monitor" element={<Monitor />} />
          <Route path="/incidents" element={<Incidents />} />
          <Route path="/my-incidents" element={<MyIncidents />} />
          <Route path="/reports" element={<Reports />} />
          <Route path="/jadwal" element={<Jadwal />} />
          <Route path="/performa" element={<Performa />} />
          <Route path="/users" element={<Users />} />
          <Route path="/wa" element={<WaLog />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="/publik-reports" element={<PublicReports />} />
          <Route path="/master" element={<MasterData />} />
          <Route path="/ssh" element={<SshTerminal />} />
          <Route path="/equipment" element={<EquipmentPerf />} />
          <Route path="/surat" element={<SuratKeluar />} />
          <Route path="/laporan-bulanan" element={<LaporanBulanan />} />
          <Route path="/attendance" element={<Attendance />} />
          <Route path="/diklat" element={<Diklat />} />
          <Route path="/dokumen" element={<Dokumen />} />
          <Route path="/kegiatan-nr" element={<KegiatanNonRutin />} />
          <Route path="/pelaporan-qr" element={<PelaporanQR />} />
        </Route>
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
