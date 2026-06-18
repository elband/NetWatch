import dotenv from 'dotenv';
dotenv.config();

export const env = {
  port: Number(process.env.PORT || 4000),
  jwtSecret: process.env.JWT_SECRET || 'change_me',
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
  },
  fonnte: {
    token: process.env.FONNTE_TOKEN || '',
    apiUrl: process.env.FONNTE_API_URL || 'https://api.fonnte.com/send',
  },
  corsOrigin: process.env.CORS_ORIGIN || 'http://localhost:5173',
  pingIntervalMs: Number(process.env.PING_INTERVAL_MS || 15000),
};
