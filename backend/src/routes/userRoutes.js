import { Router } from 'express';
import { listUsers, createUser, updateUser, toggleUserActive, deleteUser } from '../controllers/userController.js';
import { requireAuth, requireRole } from '../middleware/auth.js';

const router = Router();
router.use(requireAuth);
router.get('/', requireRole('admin', 'koordinator'), listUsers);
router.post('/', requireRole('admin'), createUser);
router.put('/:id', requireRole('admin'), updateUser);
router.patch('/:id/toggle-active', requireRole('admin'), toggleUserActive);
router.delete('/:id', requireRole('admin'), deleteUser);

export default router;
