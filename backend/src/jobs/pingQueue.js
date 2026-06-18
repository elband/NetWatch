import { Queue, Worker } from 'bullmq';
import { redisConnection } from './queueConnection.js';
import { checkAllDevices } from '../services/pingService.js';
import { env } from '../config/env.js';

export const pingQueue = new Queue('device-ping-sweep', { connection: redisConnection });

export async function schedulePingSweep() {
  await pingQueue.add(
    'sweep',
    {},
    {
      repeat: { every: env.pingIntervalMs },
      jobId: 'recurring-ping-sweep',
      removeOnComplete: true,
      removeOnFail: true,
    }
  );
}

export function startPingWorker(io) {
  return new Worker(
    'device-ping-sweep',
    async () => {
      await checkAllDevices(io);
    },
    { connection: redisConnection }
  );
}
