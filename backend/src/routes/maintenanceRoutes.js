import { Router } from 'express';
import {
  listMaintenanceWindows, createMaintenanceWindow, updateMaintenanceWindow, deleteMaintenanceWindow,
} from '../controllers/maintenanceController.js';
import { requireAuth, requireRole } from '../middleware/auth.js';

const router = Router();
router.use(requireAuth);
router.get('/', listMaintenanceWindows);
router.post('/', requireRole('admin', 'koordinator'), createMaintenanceWindow);
router.put('/:id', requireRole('admin', 'koordinator'), updateMaintenanceWindow);
router.delete('/:id', requireRole('admin', 'koordinator'), deleteMaintenanceWindow);

export default router;
