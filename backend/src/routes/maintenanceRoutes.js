import { Router } from 'express';
import multer from 'multer';
import path from 'path';
import {
  listMaintenanceWindows, createMaintenanceWindow, updateMaintenanceWindow, deleteMaintenanceWindow,
  listWindowPhotos, addWindowPhotos, removeWindowPhoto, completeMaintenanceWindow, MW_PHOTO_DIR,
} from '../controllers/maintenanceController.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { unitScope } from '../middleware/unitScope.js';

const upload = multer({
  storage: multer.diskStorage({
    destination: (req, f, cb) => cb(null, MW_PHOTO_DIR),
    filename: (req, f, cb) => cb(null, `MW${Date.now()}-${Math.round(Math.random() * 1e9)}${path.extname(f.originalname).toLowerCase()}`),
  }),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, f, cb) => cb(null, ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'application/pdf'].includes(f.mimetype)),
});

const router = Router();
router.use(requireAuth, unitScope);
router.get('/', listMaintenanceWindows);
router.post('/', requireRole('admin', 'koordinator'), createMaintenanceWindow);

// Dokumentasi foto & penyelesaian pekerjaan — teknisi pelaksana ke atas (bukan viewer).
router.get('/:id/photos', listWindowPhotos);
router.post('/:id/photos', requireRole('admin', 'koordinator', 'teknisi'), upload.array('photos', 20), addWindowPhotos);
router.delete('/photos/:photoId', requireRole('admin', 'koordinator', 'teknisi'), removeWindowPhoto);
router.put('/:id/complete', requireRole('admin', 'koordinator', 'teknisi'), completeMaintenanceWindow);

router.put('/:id', requireRole('admin', 'koordinator'), updateMaintenanceWindow);
router.delete('/:id', requireRole('admin', 'koordinator'), deleteMaintenanceWindow);

export default router;
