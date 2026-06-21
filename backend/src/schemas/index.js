import { z } from 'zod';

// Helper: string kosong/null → undefined (agar field opsional benar-benar opsional).
const emptyToUndef = (v) => (v === '' || v === null ? undefined : v);
const optNum = (schema) => z.preprocess(emptyToUndef, schema.optional());
const optStr = (max) => z.preprocess(emptyToUndef, z.string().trim().max(max).optional());

// IP: wajib non-kosong; bila tampak numerik-IP harus IPv4 valid (oktet 0–255).
// Hostname (mengandung huruf) diizinkan.
const ipField = z.string().trim().min(1, 'wajib diisi').refine((v) => {
  if (!/^[\d.]+$/.test(v)) return true; // hostname
  const p = v.split('.');
  return p.length === 4 && p.every((o) => /^\d{1,3}$/.test(o) && Number(o) <= 255);
}, 'format IP tidak valid');

// POST /api/incidents
export const createIncidentSchema = z.object({
  deviceId: optNum(z.coerce.number().int().positive()),
  deviceName: optStr(150),
  ip: z.preprocess(emptyToUndef, z.string().trim().max(64).optional()),
  issue: z.string().trim().min(1, 'wajib diisi').max(1000),
  priority: z.preprocess(emptyToUndef, z.enum(['kritis', 'tinggi', 'sedang', 'rendah']).optional()),
  techId: optNum(z.coerce.number().int().positive()),
  coordId: optNum(z.coerce.number().int().positive()),
  source: optStr(40),
  locationId: optNum(z.coerce.number().int().positive()),
}).passthrough();

// POST /api/devices  (+ PUT pakai skema sama, semua opsional kecuali saat create)
export const createDeviceSchema = z.object({
  name: z.string().trim().min(1, 'wajib diisi').max(120),
  ip: ipField,
  type: z.string().trim().min(1, 'wajib diisi').max(40),
  category: optStr(80),
  icon: optStr(10),
  loc: optStr(120),
  ssh_host: optStr(120),
  ssh_port: optNum(z.coerce.number().int().min(1, 'port 1–65535').max(65535, 'port 1–65535')),
  ssh_username: optStr(80),
  lat: optNum(z.coerce.number().min(-90).max(90)),
  lng: optNum(z.coerce.number().min(-180).max(180)),
  inspect_required: z.preprocess(emptyToUndef, z.coerce.boolean().optional()),
}).passthrough();

// POST /api/users
export const createUserSchema = z.object({
  name: z.string().trim().min(1, 'wajib diisi').max(120),
  username: z.string().trim().min(3, 'min 3 karakter').max(60),
  email: z.string().trim().email('email tidak valid'),
  password: z.preprocess(emptyToUndef, z.string().min(6, 'min 6 karakter').max(100).optional()),
  pin: z.string().regex(/^\d{4,6}$/, 'PIN harus 4–6 digit angka'),
  phone: optStr(30),
  nip: optStr(40),
  jabatan: optStr(120),
  role: z.preprocess(emptyToUndef, z.enum(['admin', 'koordinator', 'teknisi', 'viewer']).optional()),
  roles: z.array(z.enum(['admin', 'koordinator', 'teknisi', 'viewer'])).optional(),
  perms: z.array(z.string()).optional(),
}).passthrough();
