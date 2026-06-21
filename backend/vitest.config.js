import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    env: { LOG_LEVEL: 'silent' }, // bungkam pino saat test
    hookTimeout: 20000,           // beri waktu setup/teardown DB
    pool: 'forks',
  },
});
