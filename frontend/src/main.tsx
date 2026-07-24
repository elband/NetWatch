import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { registerSW } from 'virtual:pwa-register'
import './index.css'
import App from './App.tsx'
import { AuthProvider } from './context/AuthContext'
import { ThemeProvider } from './context/ThemeContext'
import { DialogHost } from './components/dialog'

// Auto-update service worker (PWA). Mode autoUpdate sudah otomatis me-reload
// halaman saat SW baru AKTIF — tapi hanya bila update-nya KETAHUAN dulu. Secara
// bawaan SW cuma dicek sekali saat registrasi awal, jadi PWA Android yang
// di-"resume" dari background bisa terus menampilkan versi lama berhari-hari.
// Karena itu kita memicu cek update: berkala, saat app kembali dibuka (fokus),
// dan saat koneksi pulih. Begitu SW baru ditemukan → install → aktif → reload.
registerSW({
  immediate: true,
  onRegisteredSW(_swUrl, r) {
    if (!r) return;
    const check = () => { if (navigator.onLine) r.update().catch(() => { /* offline / gagal jaringan */ }); };
    setInterval(check, 60_000); // tiap 1 menit selama app terbuka
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') check(); });
    window.addEventListener('online', check);
  },
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <ThemeProvider>
        <AuthProvider>
          <App />
          <DialogHost />
        </AuthProvider>
      </ThemeProvider>
    </BrowserRouter>
  </StrictMode>,
)
