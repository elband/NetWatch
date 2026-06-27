import { Router } from 'express';
import { getSlaReport } from '../controllers/slaController.js';
import { requireAuth } from '../middleware/auth.js';

const router = Router();
router.use(requireAuth);
router.get('/', getSlaReport);

export default router;
