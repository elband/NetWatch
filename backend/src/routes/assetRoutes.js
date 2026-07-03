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
import {
  listTemplates, createTemplate, updateTemplate, deleteTemplate,
  assetChecklist, createRun,
  listPm, createPm, updatePm, deletePm, donePm, listDue,
  availability,
  listFacilities, createFacility, updateFacility, deleteFacility, procurement,
} from '../controllers/assetOpsController.js';

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

// ── Fase 3: checklist template, PM, availability (semua literal → sebelum '/:id') ──
router.get('/checklist-templates', listTemplates);
router.post('/checklist-templates', requireRole('admin', 'koordinator'), createTemplate);
router.put('/checklist-templates/:id', requireRole('admin', 'koordinator'), updateTemplate);
router.delete('/checklist-templates/:id', requireRole('admin', 'koordinator'), deleteTemplate);
router.get('/pm/due', listDue);
router.put('/pm/:planId', requireRole('admin', 'koordinator', 'teknisi'), updatePm);
router.delete('/pm/:planId', requireRole('admin', 'koordinator'), deletePm);
router.post('/pm/:planId/done', requireRole('admin', 'koordinator', 'teknisi'), donePm);
router.get('/availability', availability);
// Fase 5: grup fasilitas (master) & daftar kebutuhan pengadaan.
router.get('/facilities', listFacilities);
router.post('/facilities', requireRole('admin', 'koordinator'), createFacility);
router.put('/facilities/:id', requireRole('admin', 'koordinator'), updateFacility);
router.delete('/facilities/:id', requireRole('admin', 'koordinator'), deleteFacility);
router.get('/procurement', procurement);

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

// Checklist inspeksi & preventive maintenance per aset
router.get('/:id/checklist', assetChecklist);
router.post('/:id/checklist', requireRole('admin', 'koordinator', 'teknisi'), withReadingPhoto, createRun);
router.get('/:id/pm', listPm);
router.post('/:id/pm', requireRole('admin', 'koordinator', 'teknisi'), createPm);

export default router;
