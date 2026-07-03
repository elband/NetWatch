import { Router } from 'express';
import multer from 'multer';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { unitScope } from '../middleware/unitScope.js';
import {
  listAssets, getAsset, createAsset, updateAsset, deleteAsset, setAssetStatus, regenerateQr,
  listReadings, latestReadings, addReading,
  listMetricTypes, createMetricType, updateMetricType, deleteMetricType,
  getPublicAsset,
} from '../controllers/assetController.js';

const router = Router();

// Foto bukti pembacaan meter (opsional) — disimpan di uploads/assets.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ASSET_DIR = path.join(__dirname, '..', '..', 'uploads', 'assets');
fs.mkdirSync(ASSET_DIR, { recursive: true });
const readingPhoto = multer({
  storage: multer.diskStorage({
    destination: (q, f, cb) => cb(null, ASSET_DIR),
    filename: (q, f, cb) => cb(null, `AR${Date.now()}-${Math.round(Math.random() * 1e9)}${path.extname(f.originalname).toLowerCase() || '.jpg'}`),
  }),
  fileFilter: (q, f, cb) => (/^image\/(jpe?g|png|webp|gif)$/.test(f.mimetype) ? cb(null, true) : cb(new Error('Foto harus gambar (JPG/PNG/WebP/GIF).'))),
  limits: { fileSize: 8 * 1024 * 1024 },
}).single('photo');
function withReadingPhoto(req, res, next) {
  readingPhoto(req, res, (err) => (err ? res.status(400).json({ error: err.message }) : next()));
}

// ——— Publik (tanpa auth): landing scan QR ———
router.get('/public/:token', getPublicAsset);

// ——— Terlindungi ———
router.use(requireAuth, unitScope);

// Definisi metrik (literal sebelum '/:id' agar tidak tertangkap sebagai id).
router.get('/metric-types', listMetricTypes);
router.post('/metric-types', requireRole('admin', 'koordinator'), createMetricType);
router.put('/metric-types/:id', requireRole('admin', 'koordinator'), updateMetricType);
router.delete('/metric-types/:id', requireRole('admin', 'koordinator'), deleteMetricType);

// Aset fisik
router.get('/', listAssets);
router.post('/', requireRole('admin', 'koordinator', 'teknisi'), createAsset);
router.get('/:id', getAsset);
router.put('/:id', requireRole('admin', 'koordinator', 'teknisi'), updateAsset);
router.delete('/:id', requireRole('admin', 'koordinator'), deleteAsset);
router.post('/:id/status', requireRole('admin', 'koordinator', 'teknisi'), setAssetStatus);
router.post('/:id/regenerate-qr', requireRole('admin', 'koordinator'), regenerateQr);

// Pembacaan meter
router.get('/:id/readings', listReadings);
router.get('/:id/readings/latest', latestReadings);
router.post('/:id/readings', requireRole('admin', 'koordinator', 'teknisi'), withReadingPhoto, addReading);

export default router;
