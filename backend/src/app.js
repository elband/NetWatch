import express from 'express';
import jwt from 'jsonwebtoken';
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
import { verifyTte, verifyTteDocData, verifyTteDocPdf } from './controllers/incidentController.js';
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
import logbookRoutes from './routes/logbookRoutes.js';
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
import skpRoutes from './routes/skpRoutes.js';
import unitRoutes from './routes/unitRoutes.js';
import assetRoutes from './routes/assetRoutes.js';
import sparepartRoutes from './routes/sparepartRoutes.js';
import waterChemRoutes from './routes/waterChemRoutes.js';
import perencanaanRoutes from './routes/perencanaanRoutes.js';
import auditRoutes from './routes/auditRoutes.js';
import nocRoutes from './routes/nocRoutes.js';

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
  // Berkas pribadi (cuti/sakit, sertifikat diklat, bukti kegiatan) TIDAK boleh
  // diakses anonim walau URL-nya bocor. Folder ini tak pernah tampil di halaman
  // publik, jadi aman digate. Folder lain (kop, foto insiden, bukti SKP publik,
  // lampiran surat) tetap terbuka karena dipakai Puppeteer & halaman verifikasi publik.
  const PROTECTED_UPLOADS = ['/leave/', '/diklat/', '/activities/', '/kegiatan/'];
  app.use('/uploads', (req, res, next) => {
    if (!PROTECTED_UPLOADS.some((p) => req.path.startsWith(p))) return next();
    // Izinkan render server (Puppeteer membuka /doc-print dari localhost).
    const ip = req.ip || '';
    if (ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1') return next();
    // Selain itu wajib sesi valid (cookie HttpOnly / Bearer).
    const auth = req.headers.authorization || '';
    const token = req.cookies?.netwatch_token || (auth.startsWith('Bearer ') ? auth.slice(7) : null);
    try { jwt.verify(token, env.jwtSecret, { algorithms: ['HS256'] }); return next(); }
    catch { return res.status(401).json({ error: 'Perlu login untuk mengakses berkas ini.' }); }
  }, express.static(path.join(__dirname, '..', 'uploads')));

  app.get('/health', (req, res) => res.json({ ok: true }));
  app.use('/api', apiLimiter);
  // Endpoint publik (tanpa auth) — dipindai dari QR / tautan WA.
  app.get('/api/verify-tte/:token', verifyTte);
  app.get('/api/verify-tte/:token/doc-data', verifyTteDocData);
  app.get('/api/verify-tte/:token/document.pdf', verifyTteDocPdf);
  app.get('/api/ttd/:token', getTtdDoc);
  app.post('/api/ttd/:token', submitTtd);
  app.get('/api/surat/pelaksana-sign/:token', getPelaksanaSignDoc);
  app.post('/api/surat/pelaksana-sign/:token', submitPelaksanaSign);
  app.use('/api/auth', authRoutes);
  app.use('/api/units', unitRoutes);
  app.use('/api/noc', nocRoutes); // wallboard publik NOC — punya route publik /public (token)
  app.use('/api/aset', assetRoutes); // aset non-IP (Fase 2) — punya route publik /public/:token
  app.use('/api/spareparts', sparepartRoutes); // sparepart & stok (Fase 4)
  app.use('/api/obat-air', waterChemRoutes); // obat air / bahan kimia (Fase 5c, AAB)
  app.use('/api/users', userRoutes);
  app.use('/api/devices', deviceRoutes);
  app.use('/api/incidents', incidentRoutes);
  app.use('/api/wa', waRoutes);
  app.use('/api/jadwal', jadwalRoutes);
  app.use('/api/performa', performaRoutes);
  app.use('/api/public-reports', publicReportRoutes);
  app.use('/api/rooms', roomRoutes); // sebelum masterRoutes — punya route publik /public/:kode
  app.use('/api/skp', skpRoutes); // sebelum masterRoutes — punya route publik /public/:token & /bukti/public/:token
  app.use('/api/settings', settingsRoutes);
  app.use('/api', masterRoutes);
  app.use('/api/dashboard', dashboardRoutes);
  app.use('/api/equipment', equipmentRoutes);
  app.use('/api/logbook', logbookRoutes);
  app.use('/api/activities', activityRoutes);
  app.use('/api/surat', suratRoutes);
  app.use('/api/laporan', laporanRoutes);
  app.use('/api/attendance', attendanceRoutes);
  app.use('/api/leave', leaveRoutes);
  app.use('/api/diklat', diklatRoutes);
  app.use('/api/dokumen', dokumenRoutes);
  app.use('/api/kegiatan-nr', kegiatanNrRoutes);
  app.use('/api/perencanaan', perencanaanRoutes);
  app.use('/api/audit', auditRoutes);
  app.use('/api/notifications', notificationRoutes);
  app.use('/api/notification-prefs', notificationPrefsRoutes);
  app.use('/api/sla', slaRoutes);
  app.use('/api/maintenance-windows', maintenanceRoutes);

  // Production: serve built frontend & SPA routing.
  if (env.isProd) {
    const distPath = path.join(__dirname, '..', '..', 'frontend', 'dist');
    app.use(express.static(distPath, {
      setHeaders(res, filePath) {
        // Aset ber-hash (nama memuat sidik jari konten) tak pernah berubah isinya
        // → boleh di-cache selamanya. Shell PWA (service worker, index.html,
        // manifest) HARUS selalu direvalidasi, kalau tidak versi baru tak pernah
        // ketahuan & PWA terpasang menampilkan build lama terus.
        const base = path.basename(filePath);
        if (/(^sw\.js$|^workbox-.*\.js$|^registerSW\.js$|^manifest\.webmanifest$|^index\.html$)/.test(base)) {
          res.setHeader('Cache-Control', 'no-cache');
        } else if (filePath.includes(`${path.sep}assets${path.sep}`)) {
          res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
        }
      },
    }));
    // Fallback SPA: index.html juga no-cache (revalidasi tiap muat) agar tautan
    // aset terbaru selalu ikut terkirim setelah deploy.
    app.get('*', (_req, res) => {
      res.setHeader('Cache-Control', 'no-cache');
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.use((err, req, res, next) => {
    if (res.headersSent) return next(err);
    (req.log || logger).error({ err, method: req.method, url: req.originalUrl }, 'unhandled error');
    res.status(500).json({ error: 'Terjadi kesalahan server' });
  });

  return app;
}
