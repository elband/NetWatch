import { Navigate, Route, Routes } from 'react-router-dom';
import { useAuth } from './context/AuthContext';
import { hasRole } from './utils/roles';
import RequireAuth from './components/RequireAuth';
import ProtectedRoute from './components/ProtectedRoute';
import AppLayout from './components/AppLayout';
import Login from './pages/Login';
import LaporPublik from './pages/LaporPublik';
import VerifyTte from './pages/VerifyTte';
import DocPrint from './pages/DocPrint';
import Ttd from './pages/Ttd';
import TtdPelaksana from './pages/TtdPelaksana';
import Dashboard from './pages/Dashboard';
import MyDashboard from './pages/MyDashboard';
import CoordDashboard from './pages/CoordDashboard';
import Devices from './pages/Devices';
import Aset from './pages/Aset';
import AsetAvailability from './pages/AsetAvailability';
import Spareparts from './pages/Spareparts';
import ObatAir from './pages/ObatAir';
import LaporanAab from './pages/LaporanAab';
import LaporanKinerja from './pages/LaporanKinerja';
import Monitor from './pages/Monitor';
import DeviceMap from './pages/DeviceMap';
import SlaReport from './pages/SlaReport';
import Incidents from './pages/Incidents';
import MyIncidents from './pages/MyIncidents';
import Reports from './pages/Reports';
import Jadwal from './pages/Jadwal';
import Performa from './pages/Performa';
import Perencanaan from './pages/Perencanaan';
import Users from './pages/Users';
import WaLog from './pages/WaLog';
import Settings from './pages/Settings';
import AuditLog from './pages/AuditLog';
import Wallboard from './pages/Wallboard';
import Noc from './pages/Noc';
import NotificationSettings from './pages/NotificationSettings';
import PublicReports from './pages/PublicReports';
import MasterData from './pages/MasterData';
import SshTerminal from './pages/SshTerminal';
import EquipmentPerf from './pages/EquipmentPerf';
import Logbook from './pages/Logbook';
import LogbookDevice from './pages/LogbookDevice';
import ApiDocs from './pages/ApiDocs';
import SuratKeluar from './pages/SuratKeluar';
import LaporanBulanan from './pages/LaporanBulanan';
import Attendance from './pages/Attendance';
import Diklat from './pages/Diklat';
import Dokumen from './pages/Dokumen';
import KegiatanNonRutin from './pages/KegiatanNonRutin';
import KegiatanSaya from './pages/KegiatanSaya';
import PelaporanQR from './pages/PelaporanQR';
import Notifikasi from './pages/Notifikasi';
import Skp from './pages/Skp';
import SkpPublic from './pages/SkpPublic';
import SkpBuktiPublic from './pages/SkpBuktiPublic';
import Pinjam from './pages/Pinjam';
import PeminjamanAlat from './pages/PeminjamanAlat';

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
      <Route path="/doc-print" element={<DocPrint />} />
      <Route path="/ttd" element={<Ttd />} />
      <Route path="/ttd-pelaksana" element={<TtdPelaksana />} />
      <Route path="/skp-publik" element={<SkpPublic />} />
      <Route path="/skp-bukti" element={<SkpBuktiPublic />} />
      <Route path="/pinjam" element={<Pinjam />} />
      <Route path="/noc" element={<Noc />} />
      <Route element={<RequireAuth />}>
        {/* Wallboard NOC — butuh login tapi tampil fullscreen tanpa sidebar. */}
        <Route path="/wallboard" element={<Wallboard />} />
        <Route element={<AppLayout />}>
          {/* Terbuka untuk semua user terautentikasi */}
          <Route path="/" element={<HomeRedirect />} />
          <Route path="/dashboard" element={<DashboardRoute />} />
          <Route path="/my-dashboard" element={<MyDashboard />} />
          <Route path="/coord-dashboard" element={<Navigate to="/dashboard" replace />} />
          <Route path="/devices" element={<Devices />} />
          <Route path="/aset" element={<Aset />} />
          <Route path="/aset-availability" element={<AsetAvailability />} />
          <Route path="/peminjaman" element={<PeminjamanAlat />} />
          <Route path="/sparepart" element={<Spareparts />} />
          <Route path="/obat-air" element={<ObatAir />} />
          <Route path="/monitor" element={<Monitor />} />
          <Route path="/peta" element={<DeviceMap />} />
          <Route path="/sla" element={<SlaReport />} />
          <Route path="/my-incidents" element={<MyIncidents />} />
          <Route path="/kegiatan-saya" element={<KegiatanSaya />} />
          <Route path="/jadwal" element={<Jadwal />} />
          <Route path="/equipment" element={<EquipmentPerf />} />
          <Route path="/logbook" element={<Logbook />} />
          <Route path="/logbook/:id" element={<LogbookDevice />} />
          <Route path="/api-docs" element={<ApiDocs />} />
          <Route path="/diklat" element={<Diklat />} />
          <Route path="/dokumen" element={<Dokumen />} />
          <Route path="/kegiatan-nr" element={<KegiatanNonRutin />} />
          <Route path="/notifikasi" element={<Notifikasi />} />

          {/* SSH & SKP: admin/koordinator/teknisi (bukan viewer).
              SKP — teknisi menyusun SKP-nya sendiri; koordinator melihat SKP anggota unit
              (read-only, dijaga backend); sesama teknisi tidak saling melihat. */}
          <Route element={<ProtectedRoute roles={['admin', 'koordinator', 'teknisi']} />}>
            <Route path="/ssh" element={<SshTerminal />} />
            <Route path="/skp" element={<Skp />} />
          </Route>

          {/* Manajer: admin & koordinator */}
          <Route element={<ProtectedRoute roles={['admin', 'koordinator']} />}>
            <Route path="/incidents" element={<Incidents />} />
            {/* Jendela Maintenance kini menjadi tab di halaman Performa Peralatan. */}
            <Route path="/maintenance" element={<Navigate to="/equipment" replace />} />
            <Route path="/reports" element={<Reports />} />
            <Route path="/performa" element={<Performa />} />
            <Route path="/perencanaan" element={<Perencanaan />} />
            <Route path="/wa" element={<WaLog />} />
            <Route path="/publik-reports" element={<PublicReports />} />
            <Route path="/surat" element={<SuratKeluar />} />
            <Route path="/laporan-bulanan" element={<LaporanBulanan />} />
            <Route path="/laporan-aab" element={<LaporanAab />} />
            <Route path="/laporan-kinerja" element={<LaporanKinerja />} />
            <Route path="/attendance" element={<Attendance />} />
            <Route path="/pelaporan-qr" element={<PelaporanQR />} />
            {/* Koordinator = admin unitnya: kelola user & master data (ter-scope unit di backend). */}
            <Route path="/users" element={<Users />} />
            <Route path="/master" element={<MasterData />} />
          </Route>

          {/* Admin saja (pengaturan global sistem) */}
          <Route element={<ProtectedRoute roles={['admin']} />}>
            <Route path="/settings" element={<Settings />} />
            <Route path="/notification-settings" element={<NotificationSettings />} />
            <Route path="/audit" element={<AuditLog />} />
          </Route>
        </Route>
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
