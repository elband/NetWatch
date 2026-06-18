import { Router } from 'express';
import { listDevices, createDevice, updateDevice, deleteDevice, requestAlarm } from '../controllers/deviceController.js';
import { requireAuth, requireRole } from '../middleware/auth.js';

const router = Router();
router.use(requireAuth);
router.get('/', listDevices);
router.post('/', requireRole('admin', 'koordinator'), createDevice);
router.put('/:id', requireRole('admin', 'koordinator'), updateDevice);
router.delete('/:id', requireRole('admin', 'koordinator'), deleteDevice);
router.post('/:id/request-alarm', requireRole('admin', 'koordinator', 'teknisi'), requestAlarm);

export default router;
