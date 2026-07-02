import { Router } from 'express';
import { getSlaReport } from '../controllers/slaController.js';
import { requireAuth } from '../middleware/auth.js';
import { unitScope } from '../middleware/unitScope.js';

const router = Router();
router.use(requireAuth, unitScope);
router.get('/', getSlaReport);

export default router;
