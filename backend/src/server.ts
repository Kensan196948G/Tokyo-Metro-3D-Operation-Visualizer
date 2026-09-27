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
function startRtPolling(): () => void {
  if (!config.odptGtfsRtUrl) {
    logger.info('GTFS-RT polling disabled (ODPT_GTFS_RT_URL not set) — serving mock trains');
    return () => {};
  }
  const intervalMs = Math.max(config.fetchIntervalSeconds, 5) * 1000;
  let running = false;
  const poll = async (): Promise<void> => {
    if (running) return; // never overlap slow fetches
    running = true;
    try {
      await fetchAndDecodeRt();
    } catch {
      logger.error('GTFS-RT polling failed; storage may be unavailable');
    } finally {
      running = false;
    }
  };
  void poll();
  const timer = setInterval(poll, intervalMs);
  timer.unref();
  logger.info({ intervalMs }, 'GTFS-RT resident polling started');
  return () => { clearInterval(timer); };
}

async function bootstrapStaticData(): Promise<void> {
  if (!config.odptGtfsUrl) return;
  const snapshot = await cacheStore.readMany(['stations', 'gtfs-meta']);
  const meta = snapshot['gtfs-meta'] as { source?: string } | null;
  if (!Array.isArray(snapshot.stations) || snapshot.stations.length === 0 || meta?.source === 'mock') {
    logger.info('GTFS static cache empty or seeded; fetching once at boot');
    await fetchAndNormalizeGtfs();
  }
}

async function start(): Promise<void> {
  validateConfig();
  await cacheStore.health();
  const app = await buildApp();
  await app.listen({ port: config.port, host: '0.0.0.0' });
  logger.info({ port: config.port }, 'Tokyo Metro 3D API started');
  let stopPolling = (): void => {};
  let closing = false;
  const shutdown = async (): Promise<void> => {
    if (closing) return;
    closing = true;
    stopPolling();
    try { await app.close(); }
    catch { logger.error('Server shutdown failed'); process.exitCode = 1; }
  };
  process.once('SIGTERM', () => { void shutdown(); });
  process.once('SIGINT', () => { void shutdown(); });
  await bootstrapStaticData();
  if (!closing) stopPolling = startRtPolling();
}

start().catch(() => {
  logger.error('Failed to start server; check configuration and storage readiness');
  process.exit(1);
});
