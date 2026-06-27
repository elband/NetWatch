import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import compression from 'compression';
import path from 'path';
import { fileURLToPath } from 'url';
import pinoHttp from 'pino-http';
import { env } from './config/env.js';
import { logger } from './config/logger.js';
import { apiLimiter } from './middleware/rateLimit.js';
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
import suratRoutes, { getTtdDoc, submitTtd, getPelaksanaSignDoc, submitPelaksanaSign } from './routes/suratRoutes.js';
import laporanRoutes from './routes/laporanRoutes.js';
import attendanceRoutes from './routes/attendanceRoutes.js';
import leaveRoutes from './routes/leaveRoutes.js';
import diklatRoutes from './routes/diklatRoutes.js';
import dokumenRoutes from './routes/dokumenRoutes.js';
import kegiatanNrRoutes from './routes/kegiatanNrRoutes.js';
import roomRoutes from './routes/roomRoutes.js';
import notificationRoutes from './routes/notificationRoutes.js';
import notificationPrefsRoutes from './routes/notificationPrefsRoutes.js';
import slaRoutes from './routes/slaRoutes.js';
import maintenanceRoutes from './routes/maintenanceRoutes.js';

// Membangun & mengembalikan instance Express (tanpa listen/socket/worker) agar
// bisa dipakai ulang oleh server.js (produksi) maupun test (supertest).
export function createApp() {
  const app = express();
  // Di belakang reverse proxy (Nginx): percayai X-Forwarded-* agar IP klien & rate-limit benar.
  app.set('trust proxy', 1);
  // Security headers. CSP hanya diaktifkan di production (saat Express melayani SPA);
  // di dev frontend dilayani Vite. HSTS hanya efektif via HTTPS.
  app.use(helmet({
    crossOriginEmbedderPolicy: false,
    contentSecurityPolicy: env.isProd
      ? {
          useDefaults: true,
          directives: {
            defaultSrc: ["'self'"],
            scriptSrc: ["'self'"],
            // Google Fonts stylesheet + Inter/Poppins font files.
            styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
            // Tile peta live (Esri World Imagery) dimuat sebagai <img>.
            imgSrc: ["'self'", 'data:', 'blob:', 'https://server.arcgisonline.com'],
            connectSrc: ["'self'", 'ws:', 'wss:'],
            fontSrc: ["'self'", 'data:', 'https://fonts.gstatic.com'],
            frameSrc: ["'self'"],
            objectSrc: ["'none'"],
            baseUri: ["'self'"],
            upgradeInsecureRequests: [],
          },
        }
      : false,
  }));
  app.use(compression());
  app.use(cors({ origin: env.corsOrigin, credentials: true }));
  app.use(express.json({ limit: '2mb' }));
  app.use(cookieParser());

  // Request logging terstruktur (req.id otomatis). Serializer dibatasi agar tidak
  // membocorkan header/cookie sensitif; /health di-skip agar tidak bising.
  app.use(pinoHttp({
    logger,
    autoLogging: { ignore: (req) => req.url === '/health' },
    customLogLevel: (req, res, err) => (res.statusCode >= 500 || err ? 'error' : res.statusCode >= 400 ? 'warn' : 'info'),
    serializers: {
      req: (req) => ({ method: req.method, url: req.url }),
      res: (res) => ({ statusCode: res.statusCode }),
    },
  }));

  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  app.use('/uploads', express.static(path.join(__dirname, '..', 'uploads')));

  app.get('/health', (req, res) => res.json({ ok: true }));
  app.use('/api', apiLimiter);
  // Endpoint publik (tanpa auth) — dipindai dari QR / tautan WA.
  app.get('/api/verify-tte/:token', verifyTte);
  app.get('/api/ttd/:token', getTtdDoc);
  app.post('/api/ttd/:token', submitTtd);
  app.get('/api/surat/pelaksana-sign/:token', getPelaksanaSignDoc);
  app.post('/api/surat/pelaksana-sign/:token', submitPelaksanaSign);
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
  app.use('/api/notification-prefs', notificationPrefsRoutes);
  app.use('/api/sla', slaRoutes);
  app.use('/api/maintenance-windows', maintenanceRoutes);

  // Production: serve built frontend & SPA routing.
  if (env.isProd) {
    const distPath = path.join(__dirname, '..', '..', 'frontend', 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => res.sendFile(path.join(distPath, 'index.html')));
  }

  app.use((err, req, res, next) => {
    if (res.headersSent) return next(err);
    (req.log || logger).error({ err, method: req.method, url: req.originalUrl }, 'unhandled error');
    res.status(500).json({ error: 'Terjadi kesalahan server' });
  });

  return app;
}
