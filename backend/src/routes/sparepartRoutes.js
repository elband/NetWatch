import { Router } from 'express';
import multer from 'multer';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { unitScope } from '../middleware/unitScope.js';
import {
  listSpareparts, getSparepart, createSparepart, updateSparepart, deleteSparepart,
  move, listMoves, lowStock, lookupSparepart, stats,
  listCategories, createCategory, deleteCategory, reportJson, reportXlsx,
  templateXlsx, importXlsx,
} from '../controllers/sparepartController.js';

const router = Router();
router.use(requireAuth, unitScope);

// Impor Excel di memori (tanpa simpan ke disk); batasi 5MB.
const uploadXlsx = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

// Literal sebelum '/:id'.
router.get('/low-stock', lowStock);
router.get('/stats', stats);
router.get('/lookup', lookupSparepart);
router.get('/report.xlsx', reportXlsx);
router.get('/report', reportJson);
router.get('/template.xlsx', templateXlsx);
router.post('/import', requireRole('admin', 'koordinator'), uploadXlsx.single('file'), importXlsx);
router.get('/categories', listCategories);
router.post('/categories', requireRole('admin', 'koordinator'), createCategory);
router.delete('/categories/:id', requireRole('admin', 'koordinator'), deleteCategory);

router.get('/', listSpareparts);
router.post('/', requireRole('admin', 'koordinator'), createSparepart);
router.get('/:id', getSparepart);
router.put('/:id', requireRole('admin', 'koordinator'), updateSparepart);
router.delete('/:id', requireRole('admin', 'koordinator'), deleteSparepart);
router.get('/:id/moves', listMoves);
router.post('/:id/move', requireRole('admin', 'koordinator', 'teknisi'), move);

export default router;
