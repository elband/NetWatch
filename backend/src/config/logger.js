import pino from 'pino';
import { env } from './env.js';

// Logger terstruktur (JSON) — siap diagregasi (Loki/ELK) & dikirim ke Sentry.
// Level via LOG_LEVEL; default info di prod, debug di dev.
export const logger = pino({
  level: process.env.LOG_LEVEL || (env.isProd ? 'info' : 'debug'),
  timestamp: pino.stdTimeFunctions.isoTime,
});
