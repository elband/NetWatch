import IORedis from 'ioredis';
import { env } from '../config/env.js';

export const redisConnection = new IORedis({
  host: env.redis.host,
  port: env.redis.port,
  password: env.redis.password,
  tls: env.redis.tls,
  maxRetriesPerRequest: null,
});

// Tanpa listener 'error', kehilangan koneksi Redis memunculkan unhandled error event.
redisConnection.on('error', (err) => console.error('[redis] error:', err?.message));
