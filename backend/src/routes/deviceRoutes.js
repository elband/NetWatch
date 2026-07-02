import { Router } from 'express';
import { listDevices, createDevice, updateDevice, deleteDevice, requestAlarm, toggleMonitor, toggleAlwaysOn, getDeviceMetrics } from '../controllers/deviceController.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { unitScope } from '../middleware/unitScope.js';
import { validateBody } from '../middleware/validate.js';
import { createDeviceSchema } from '../schemas/index.js';

const router = Router();
router.use(requireAuth, unitScope);
router.get('/', listDevices);
router.get('/:id/metrics', getDeviceMetrics); // riwayat metrik (grafik tren)
router.post('/', requireRole('admin', 'koordinator', 'teknisi'), validateBody(createDeviceSchema), createDevice); // teknisi boleh tambah perangkat
router.put('/:id', requireRole('admin', 'koordinator', 'teknisi'), updateDevice); // teknisi boleh edit perangkat
router.delete('/:id', requireRole('admin', 'koordinator'), deleteDevice);
router.post('/:id/request-alarm', requireRole('admin', 'koordinator', 'teknisi'), requestAlarm);
router.post('/:id/toggle-monitor', requireRole('admin', 'koordinator', 'teknisi'), toggleMonitor);
router.post('/:id/toggle-always-on', requireRole('admin', 'koordinator', 'teknisi'), toggleAlwaysOn);

export default router;
