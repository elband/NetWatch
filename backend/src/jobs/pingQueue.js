import { Queue, Worker } from 'bullmq';
import { redisConnection } from './queueConnection.js';
import { checkAllDevices } from '../services/pingService.js';
import { env } from '../config/env.js';
import { logger } from '../config/logger.js';

export const pingQueue = new Queue('device-ping-sweep', { connection: redisConnection });

export async function schedulePingSweep() {
  await pingQueue.add(
    'sweep',
    {},
    {
      repeat: { every: env.pingIntervalMs },
      jobId: 'recurring-ping-sweep',
      attempts: 2,                       // coba ulang sekali bila sweep gagal
      backoff: { type: 'fixed', delay: 2000 },
      removeOnComplete: true,
      removeOnFail: { count: 50 },       // simpan 50 kegagalan terakhir untuk diagnosa
    }
  );
}

export function startPingWorker(io) {
  const worker = new Worker(
    'device-ping-sweep',
    async () => {
      await checkAllDevices(io);
    },
    { connection: redisConnection, concurrency: 1 }
  );
  // Tanpa handler ini, sweep yang melempar error hilang tanpa jejak (removeOnFail).
  worker.on('failed', (job, err) => logger.error({ err: err?.message }, '[pingSweep] gagal'));
  worker.on('error', (err) => logger.error({ err: err?.message }, '[pingWorker] error'));
  return worker;
}
