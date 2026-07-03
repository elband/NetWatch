import { Router } from 'express';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { unitScope } from '../middleware/unitScope.js';
import {
  listChemicals, createChemical, updateChemical, deleteChemical,
  recordUsage, listUsage, report,
} from '../controllers/waterChemController.js';

const router = Router();
router.use(requireAuth, unitScope);

router.get('/report', report); // literal sebelum '/:id'
router.get('/', listChemicals);
router.post('/', requireRole('admin', 'koordinator'), createChemical);
router.put('/:id', requireRole('admin', 'koordinator'), updateChemical);
router.delete('/:id', requireRole('admin', 'koordinator'), deleteChemical);
router.get('/:id/usage', listUsage);
router.post('/:id/usage', requireRole('admin', 'koordinator', 'teknisi'), recordUsage);

export default router;
