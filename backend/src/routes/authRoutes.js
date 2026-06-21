import { Router } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { login, loginPin, me, loginAs, updateProfile, logout } from '../controllers/authController.js';
import { requireAuth } from '../middleware/auth.js';
import { authLimiter } from '../middleware/rateLimit.js';

const router = Router();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const AVATAR_DIR = path.join(__dirname, '..', '..', 'uploads', 'avatars');
fs.mkdirSync(AVATAR_DIR, { recursive: true });
const upload = multer({
  storage: multer.diskStorage({ destination: (q, f, cb) => cb(null, AVATAR_DIR), filename: (q, f, cb) => cb(null, `U${Date.now()}-${Math.round(Math.random() * 1e9)}${path.extname(f.originalname).toLowerCase()}`) }),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (q, f, cb) => cb(null, ['image/jpeg', 'image/png', 'image/webp'].includes(f.mimetype)),
});

router.post('/login', authLimiter, login);
router.post('/login-pin', authLimiter, loginPin);
router.get('/me', requireAuth, me);
router.put('/profile', requireAuth, upload.single('photo'), updateProfile);
router.post('/login-as/:id', requireAuth, loginAs);
router.post('/logout', logout);

export default router;
