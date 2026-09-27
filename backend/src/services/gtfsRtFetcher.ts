/**
 * Fetches the ODPT GTFS-RT protobuf feed, decodes it and refreshes the
 * trains / alerts cache. Designed to run from the systemd timer (one shot)
 * or the admin refetch endpoint. Tracks consecutive failures so /api/status
 * can expose staleness to the frontend.
 */
import { config } from '../config.js';
import { logger } from '../utils/logger.js';
import { requestFeed } from './feedRequest.js';
import { cacheStore } from './cacheStore.js';
import { StorageError } from './storageError.js';
import { loadStations } from './normalizer.js';
import { decodeFeed, feedToTrains, feedToAlerts } from './gtfsRtDecoder.js';

export type RtMeta = {
  fetchedAt: string | null;
  success: boolean;
  consecutiveFailures: number;
  trainCount: number;
  alertCount: number;
  error?: string;
};

export async function fetchAndDecodeRt(
  url: string = config.odptGtfsRtUrl,
  token: string = config.odptApiToken
): Promise<RtMeta> {
  const fetchedAt = new Date().toISOString();
  const prior = await cacheStore.read<RtMeta>('rt-meta');
  const failures = prior?.consecutiveFailures ?? 0;

  const fail = async (error: string): Promise<RtMeta> => {
    const meta: RtMeta = {
      fetchedAt: prior?.fetchedAt ?? null,
      success: false,
      consecutiveFailures: failures + 1,
      trainCount: prior?.trainCount ?? 0,
      alertCount: prior?.alertCount ?? 0,
      error,
    };
    try {
      await cacheStore.write('rt-meta', meta);
    } catch (error) {
      if (error instanceof StorageError) throw error;
      meta.error = 'Cache write failed';
    }
    logger.error({ error, consecutiveFailures: meta.consecutiveFailures }, 'GTFS-RT: fetch failed');
    return meta;
  };

  if (!url) return fail('ODPT_GTFS_RT_URL not configured');

  logger.info('GTFS-RT: downloading');

  let buf: Uint8Array;
  try {
    buf = await requestFeed(url, token, 15_000, 10 * 1024 * 1024);
  } catch (err) {
    return fail(err instanceof Error ? err.message : String(err));
  }

  try {
    const feed = decodeFeed(buf);
    const { stations } = await loadStations();
    const trains = feedToTrains(feed, stations);
    const alerts = feedToAlerts(feed);

    const meta: RtMeta = {
      fetchedAt,
      success: true,
      consecutiveFailures: 0,
      trainCount: trains.length,
      alertCount: alerts.length,
    };
    await cacheStore.writeBatch({ trains, alerts, 'rt-meta': meta });
    logger.info({ trains: trains.length, alerts: alerts.length }, 'GTFS-RT: decoded and cached');
    return meta;
  } catch (error) {
    if (error instanceof StorageError) throw error;
    return fail('Feed decode or cache write failed');
  }
}
