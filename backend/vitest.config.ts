import { defineConfig } from 'vitest/config';
import os from 'node:os';
import path from 'node:path';

export default defineConfig({
  test: {
    // Worker threads can hit v8 OOM on memory-constrained hosts; forked
    // child processes are slower to spawn but isolate memory reliably.
    pool: 'forks',
    poolOptions: {
      forks: { singleFork: true },
    },
    env: {
      // Keep test writes (gtfsFetcher cache/raw output) out of data/cache
      CACHE_DIR: path.join(os.tmpdir(), 'metro3d-test-cache'),
      // Never let tests reach the real ODPT API, even with a developer .env
      ODPT_API_TOKEN: '',
      ODPT_GTFS_URL: '',
      ODPT_GTFS_RT_URL: '',
    },
  },
});
