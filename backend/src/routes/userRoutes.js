import { Router } from 'express';
import { listUsers, createUser, updateUser, toggleUserActive, deleteUser } from '../controllers/userController.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { unitScope } from '../middleware/unitScope.js';
import { validateBody } from '../middleware/validate.js';
import { createUserSchema } from '../schemas/index.js';

const router = Router();
router.use(requireAuth, unitScope);
// Koordinator = admin unitnya: boleh CRUD user, dibatasi coordGuard di controller
// (hanya unit sendiri, tak boleh sentuh/beri peran admin, tak boleh pindah unit).
router.get('/', requireRole('admin', 'koordinator'), listUsers);
router.post('/', requireRole('admin', 'koordinator'), validateBody(createUserSchema), createUser);
router.put('/:id', requireRole('admin', 'koordinator'), updateUser);
router.patch('/:id/toggle-active', requireRole('admin', 'koordinator'), toggleUserActive);
router.delete('/:id', requireRole('admin', 'koordinator'), deleteUser);

export default router;
