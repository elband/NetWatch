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
  // Gateway WhatsApp internal (dibangun sendiri). Endpoint: POST /api/v1/messages/send
  // dengan header X-API-Key. deviceId opsional — bila kosong, gateway pakai device default.
  waGateway: {
    apiKey: process.env.WAGATEWAY_API_KEY || '',
    baseUrl: process.env.WAGATEWAY_BASE_URL || 'https://wg.aptpairport.id',
    deviceId: process.env.WAGATEWAY_DEVICE_ID || '',
  },
  // Integrasi keluar ke aplikasi SiKeren (SI-Keren BLU) untuk verifikasi dokumen
  // Laporan Bulanan a.n. Kepala Seksi (Murdoko). Autentikasi: API Key di header.
  // Endpoint & nama field dibuat konfigurable agar mudah diarahkan ke API asli.
  siKeren: {
    baseUrl: (process.env.SIKEREN_BASE_URL || '').replace(/\/$/, ''),
    verifyPath: process.env.SIKEREN_VERIFY_PATH || '/api/v1/documents/verify',
    apiKey: process.env.SIKEREN_API_KEY || '',
    apiKeyHeader: process.env.SIKEREN_API_KEY_HEADER || 'X-API-Key',
    account: process.env.SIKEREN_ACCOUNT || '', // id/username akun Murdoko di SiKeren (opsional)
  },
  // FIDS (Flight Information Display System) bandara — sumber jadwal keberangkatan &
  // kedatangan untuk panel Penerbangan di Command Center/Wallboard. Base URL diisi di .env
  // (mis. http://103.210.122.2); KOSONG = fitur nonaktif (panel tak muncul di wallboard).
  // Endpoint (Laravel, paginasi terkunci 5/hal): GET {baseUrl}/api/transaksi/keberangkatan|kedatangan
  fids: {
    baseUrl: (process.env.FIDS_BASE_URL || '').replace(/\/$/, ''),
    apiKey: process.env.FIDS_API_KEY || '',            // opsional (API saat ini publik tanpa kunci)
    apiKeyHeader: process.env.FIDS_API_KEY_HEADER || 'X-API-Key',
  },
  corsOrigin: process.env.CORS_ORIGIN || 'http://localhost:5173',
  // URL publik aplikasi — dipakai untuk menyusun link di notifikasi WA (klik utk ambil/ingatkan).
  appUrl: (process.env.APP_URL || process.env.CORS_ORIGIN || 'http://localhost:5173').replace(/\/$/, ''),
  // URL yang dipakai Puppeteer untuk membuka halaman cetak /doc-print saat render PDF.
  // Production: Express menyajikan SPA di port yang sama. Dev: arahkan ke Vite (mis. http://127.0.0.1:5173).
  selfBaseUrl: (process.env.SELF_BASE_URL || `http://127.0.0.1:${Number(process.env.PORT || 4000)}`).replace(/\/$/, ''),
  pingIntervalMs: Number(process.env.PING_INTERVAL_MS || 15000),
};
