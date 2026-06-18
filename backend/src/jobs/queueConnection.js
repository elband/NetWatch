import IORedis from 'ioredis';
import { env } from '../config/env.js';

export const redisConnection = new IORedis({
  host: env.redis.host,
  port: env.redis.port,
  maxRetriesPerRequest: null,
});
