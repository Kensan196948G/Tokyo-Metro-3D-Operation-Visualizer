import { config, validateConfig } from './config.js';
import { logger } from './utils/logger.js';
import { buildApp } from './app.js';
import { fetchAndDecodeRt } from './services/gtfsRtFetcher.js';
import { fetchAndNormalizeGtfs } from './services/gtfsFetcher.js';
import { cacheStore } from './services/cacheStore.js';

/**
 * Resident GTFS-RT polling: when the RT feed URL is configured, this process
 * refreshes train/alert caches every fetchIntervalSeconds so the frontend can
 * interpolate between updates. A separate systemd timer is NOT required in
 * single-service deployments.
 */
function startRtPolling(): void {
  if (!config.odptGtfsRtUrl) {
    logger.info('GTFS-RT polling disabled (ODPT_GTFS_RT_URL not set) — serving mock trains');
    return;
  }
  const intervalMs = Math.max(config.fetchIntervalSeconds, 5) * 1000;
  let running = false;
  const poll = async (): Promise<void> => {
    if (running) return; // never overlap slow fetches
    running = true;
    try {
      await fetchAndDecodeRt();
    } finally {
      running = false;
    }
  };
  void poll();
  setInterval(poll, intervalMs).unref();
  logger.info({ intervalMs }, 'GTFS-RT resident polling started');
}

async function bootstrapStaticData(): Promise<void> {
  if (config.odptGtfsUrl && !cacheStore.exists('stations')) {
    logger.info('GTFS static cache empty — fetching once at boot');
    await fetchAndNormalizeGtfs();
  }
}

async function start(): Promise<void> {
  validateConfig();
  const app = await buildApp();
  await app.listen({ port: config.port, host: '0.0.0.0' });
  logger.info({ port: config.port }, 'Tokyo Metro 3D API started');
  await bootstrapStaticData();
  startRtPolling();
}

start().catch((err) => {
  logger.error(err, 'Failed to start server');
  process.exit(1);
});
