import { Router } from 'express';
import { login, loginPin, me, loginAs, updateProfile } from '../controllers/authController.js';
import { requireAuth } from '../middleware/auth.js';

const router = Router();
router.post('/login', login);
router.post('/login-pin', loginPin);
router.get('/me', requireAuth, me);
router.put('/profile', requireAuth, updateProfile);
router.post('/login-as/:id', requireAuth, loginAs);

export default router;
