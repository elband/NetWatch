import { Router } from 'express';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { unitScope } from '../middleware/unitScope.js';
import {
  listSpareparts, getSparepart, createSparepart, updateSparepart, deleteSparepart,
  move, listMoves, lowStock, lookupSparepart, stats,
  listCategories, createCategory, deleteCategory, reportJson, reportXlsx,
} from '../controllers/sparepartController.js';

const router = Router();
router.use(requireAuth, unitScope);

// Literal sebelum '/:id'.
router.get('/low-stock', lowStock);
router.get('/stats', stats);
router.get('/lookup', lookupSparepart);
router.get('/report.xlsx', reportXlsx);
router.get('/report', reportJson);
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
