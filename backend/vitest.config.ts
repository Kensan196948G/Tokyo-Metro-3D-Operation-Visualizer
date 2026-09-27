import { defineConfig } from 'vitest/config';
import os from 'node:os';
import path from 'node:path';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    // Worker threads can hit v8 OOM on memory-constrained hosts; forked
    // child processes are slower to spawn but isolate memory reliably.
    pool: 'forks',
    maxWorkers: 1,
    env: {
      // Keep test writes (gtfsFetcher cache/raw output) out of data/cache
      CACHE_DIR: path.join(os.tmpdir(), `metro3d-test-${process.pid}`, 'cache'),
      CACHE_BACKEND: 'file',
      DATABASE_URL: '',
      // Never let tests reach the real ODPT API, even with a developer .env
      ODPT_API_TOKEN: '',
      ODPT_GTFS_URL: '',
      ODPT_GTFS_RT_URL: '',
    },
  },
});
