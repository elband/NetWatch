import dotenv from 'dotenv';
dotenv.config();

// Zona waktu server (default WITA/Asia/Makassar). Di-set sedini mungkin agar
// semua operasi Date, toLocale*, dan sesi MySQL memakai zona ini — bukan UTC.
// Nilai dapat ditimpa runtime dari Pengaturan (settings.app_timezone).
const appTz = process.env.TZ || process.env.APP_TZ || 'Asia/Makassar';
try { process.env.TZ = appTz; } catch { /* abaikan bila tak bisa di-set */ }

const isProd = process.env.NODE_ENV === 'production';

// Di production, secret lemah/default ditolak agar token tidak bisa dipalsukan.
const WEAK_SECRETS = new Set(['change_me', 'netwatch_dev_secret_change_me', '', 'secret', 'changeme']);
let jwtSecret = process.env.JWT_SECRET || 'change_me';
if (isProd && (WEAK_SECRETS.has(jwtSecret) || jwtSecret.length < 32)) {
  throw new Error(
    '[FATAL] JWT_SECRET tidak aman untuk production (kosong/default/<32 char). ' +
    'Set nilai acak kuat: node -e "console.log(require(\'crypto\').randomBytes(48).toString(\'hex\'))"'
  );
}
if (isProd && !process.env.DB_PASSWORD) {
  throw new Error('[FATAL] DB_PASSWORD wajib di-set di production (jangan pakai root tanpa password).');
}

export const env = {
  isProd,
  appTz,
  port: Number(process.env.PORT || 4000),
  jwtSecret,
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '8h',
  db: {
    host: process.env.DB_HOST || '127.0.0.1',
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'netwatch_erp',
  },
  redis: {
    host: process.env.REDIS_HOST || '127.0.0.1',
    port: Number(process.env.REDIS_PORT || 6379),
    password: process.env.REDIS_PASSWORD || undefined,
    // Aktifkan TLS bila REDIS_TLS=true (Redis lintas host/terkelola).
    tls: process.env.REDIS_TLS === 'true' ? {} : undefined,
  },
  waBarier: {
    apiKey: process.env.WABARIER_API_KEY || '',
    baseUrl: process.env.WABARIER_BASE_URL || 'https://wa.aptpairport.id',
    sessionId: process.env.WABARIER_SESSION_ID || '',
  },
  corsOrigin: process.env.CORS_ORIGIN || 'http://localhost:5173',
  pingIntervalMs: Number(process.env.PING_INTERVAL_MS || 15000),
};
