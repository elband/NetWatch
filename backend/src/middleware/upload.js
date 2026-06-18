import multer from 'multer';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const UPLOAD_DIR = path.join(__dirname, '..', '..', 'uploads', 'incidents');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase() || '.jpg';
    const safeId = String(req.params.id || 'inc').replace(/[^a-zA-Z0-9_-]/g, '');
    cb(null, `${safeId}-${Date.now()}${ext}`);
  },
});

// Hanya menerima berkas gambar (jpg/png/webp/gif) untuk dokumentasi tindakan.
function imageFilter(req, file, cb) {
  if (/^image\/(jpe?g|png|webp|gif)$/.test(file.mimetype)) cb(null, true);
  else cb(new Error('Dokumentasi harus berupa gambar (JPG/PNG/WebP/GIF).'));
}

export const uploadIncidentDoc = multer({
  storage,
  fileFilter: imageFilter,
  limits: { fileSize: 8 * 1024 * 1024 }, // 8 MB
}).single('doc');

// Bungkus multer agar error (tipe/ukuran) menjadi respons 400 yang rapi.
export function withIncidentDoc(req, res, next) {
  uploadIncidentDoc(req, res, (err) => {
    if (err) return res.status(400).json({ error: err.message });
    next();
  });
}

// Foto inspeksi peralatan: disimpan ke memori dulu agar bisa di-hash
// (dedup anti-foto-palsu) sebelum ditulis ke disk oleh handler.
export const INSPECTION_DIR = path.join(__dirname, '..', '..', 'uploads', 'inspections');
fs.mkdirSync(INSPECTION_DIR, { recursive: true });

const uploadInspectionPhoto = multer({
  storage: multer.memoryStorage(),
  fileFilter: imageFilter,
  limits: { fileSize: 8 * 1024 * 1024 },
}).single('photo');

export function withInspectionPhoto(req, res, next) {
  uploadInspectionPhoto(req, res, (err) => {
    if (err) return res.status(400).json({ error: err.message });
    next();
  });
}
