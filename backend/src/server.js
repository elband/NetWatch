import express from 'express';
import cors from 'cors';
import http from 'http';
import path from 'path';
import jwt from 'jsonwebtoken';
import { fileURLToPath } from 'url';
import { Server } from 'socket.io';
import { env } from './config/env.js';
import { verifyTte } from './controllers/incidentController.js';
import authRoutes from './routes/authRoutes.js';
import userRoutes from './routes/userRoutes.js';
import deviceRoutes from './routes/deviceRoutes.js';
import incidentRoutes from './routes/incidentRoutes.js';
import waRoutes from './routes/waRoutes.js';
import jadwalRoutes from './routes/jadwalRoutes.js';
import performaRoutes from './routes/performaRoutes.js';
import publicReportRoutes from './routes/publicReportRoutes.js';
import settingsRoutes from './routes/settingsRoutes.js';
import masterRoutes from './routes/masterRoutes.js';
import dashboardRoutes from './routes/dashboardRoutes.js';
import equipmentRoutes from './routes/equipmentRoutes.js';
import activityRoutes from './routes/activityRoutes.js';
import suratRoutes, { getTtdDoc, submitTtd } from './routes/suratRoutes.js';
import laporanRoutes from './routes/laporanRoutes.js';
import attendanceRoutes from './routes/attendanceRoutes.js';
import leaveRoutes from './routes/leaveRoutes.js';
import diklatRoutes from './routes/diklatRoutes.js';
import dokumenRoutes from './routes/dokumenRoutes.js';
import kegiatanNrRoutes from './routes/kegiatanNrRoutes.js';
import roomRoutes from './routes/roomRoutes.js';
import notificationRoutes from './routes/notificationRoutes.js';
import { setNotifyIo } from './services/notify.js';
import { attachSshNamespace } from './services/sshBridge.js';
import { startCoordWatcher } from './services/coordWatcher.js';
import { schedulePingSweep, startPingWorker } from './jobs/pingQueue.js';
import { startWaWorker } from './jobs/waWorker.js';

const app = express();
app.use(cors({ origin: env.corsOrigin }));
app.use(express.json());

const __dirname = path.dirname(fileURLToPath(import.meta.url));
app.use('/uploads', express.static(path.join(__dirname, '..', 'uploads')));

app.get('/health', (req, res) => res.json({ ok: true }));
// Verifikasi publik TTE (tanpa auth) — dipindai dari QR.
app.get('/api/verify-tte/:token', verifyTte);
// Halaman TTD Kepala Seksi (tanpa auth) — diakses via tautan WA.
app.get('/api/ttd/:token', getTtdDoc);
app.post('/api/ttd/:token', submitTtd);
app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/devices', deviceRoutes);
app.use('/api/incidents', incidentRoutes);
app.use('/api/wa', waRoutes);
app.use('/api/jadwal', jadwalRoutes);
app.use('/api/performa', performaRoutes);
app.use('/api/public-reports', publicReportRoutes);
app.use('/api/rooms', roomRoutes); // sebelum masterRoutes — punya route publik /public/:kode
app.use('/api/settings', settingsRoutes);
app.use('/api', masterRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/equipment', equipmentRoutes);
app.use('/api/activities', activityRoutes);
app.use('/api/surat', suratRoutes);
app.use('/api/laporan', laporanRoutes);
app.use('/api/attendance', attendanceRoutes);
app.use('/api/leave', leaveRoutes);
app.use('/api/diklat', diklatRoutes);
app.use('/api/dokumen', dokumenRoutes);
app.use('/api/kegiatan-nr', kegiatanNrRoutes);
app.use('/api/notifications', notificationRoutes);

// Production: serve built frontend and handle SPA routing.
if (process.env.NODE_ENV === 'production') {
  const distPath = path.join(__dirname, '..', '..', 'frontend', 'dist');
  app.use(express.static(distPath));
  app.get('*', (_req, res) => res.sendFile(path.join(distPath, 'index.html')));
}

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'Terjadi kesalahan server' });
});

const server = http.createServer(app);
const io = new Server(server, { cors: { origin: env.corsOrigin } });
app.set('io', io); // agar route biasa bisa emit (mis. notifikasi maintenance selesai)
setNotifyIo(io); // Notification Center: kirim notifikasi real-time per-user

io.on('connection', (socket) => {
  // Klien mengirim JWT-nya → join room user:{id} agar notifikasi tersampaikan ke user yang tepat.
  socket.on('notif:auth', (token) => {
    try {
      const u = jwt.verify(String(token || ''), env.jwtSecret);
      if (u?.id) socket.join(`user:${u.id}`);
    } catch { /* token tidak valid — abaikan */ }
  });
  socket.on('disconnect', () => {});
});

attachSshNamespace(io);
startPingWorker(io);
startWaWorker(io);
startCoordWatcher(io);
await schedulePingSweep();

server.listen(env.port, () => {
  console.log(`NetWatch backend running on http://localhost:${env.port}`);
});
