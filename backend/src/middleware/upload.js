import multer from 'multer';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Token acak kriptografis (default 96-bit) untuk nama berkas tak-tertebak.
// Mengganti pola lama Date.now()+Math.random() yang bisa ditebak/di-brute:
// folder /uploads publik (kop, foto insiden/inspeksi, surat, dsb.) hanya
// mengandalkan URL tak-tertebak, jadi nama berkas WAJIB acak kuat.
export const randToken = (bytes = 12) => crypto.randomBytes(bytes).toString('hex');

// Nama berkas: prefix opsional (keterbacaan) + token acak + ekstensi asli.
// fallbackExt dipakai bila originalName tak berekstensi (mis. '.png' untuk kop).
export function randName(prefix, originalName, fallbackExt = '') {
  const ext = (path.extname(originalName || '').toLowerCase() || fallbackExt).replace(/[^.a-z0-9]/g, '');
  return `${prefix ? prefix + '-' : ''}${randToken()}${ext}`;
}
const UPLOAD_DIR = path.join(__dirname, '..', '..', 'uploads', 'incidents');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => {
    const safeId = String(req.params.id || 'inc').replace(/[^a-zA-Z0-9_-]/g, '');
    cb(null, randName(safeId, file.originalname, '.jpg'));
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

// Foto perangkat (thumbnail kartu di menu Peralatan): disimpan langsung ke disk.
export const DEVICE_PHOTO_DIR = path.join(__dirname, '..', '..', 'uploads', 'devices');
fs.mkdirSync(DEVICE_PHOTO_DIR, { recursive: true });

const deviceStorage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, DEVICE_PHOTO_DIR),
  filename: (req, file, cb) => {
    const safeId = String(req.params.id || 'dev').replace(/[^a-zA-Z0-9_-]/g, '');
    cb(null, randName(`D${safeId}`, file.originalname, '.jpg'));
  },
});

const uploadDevicePhoto = multer({
  storage: deviceStorage,
  fileFilter: imageFilter,
  limits: { fileSize: 8 * 1024 * 1024 },
}).single('photo');

export function withDevicePhoto(req, res, next) {
  uploadDevicePhoto(req, res, (err) => {
    if (err) return res.status(400).json({ error: err.message });
    next();
  });
}
