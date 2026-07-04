/**
 * Fetches the ODPT GTFS-RT protobuf feed, decodes it and refreshes the
 * trains / alerts cache. Designed to run from the systemd timer (one shot)
 * or the admin refetch endpoint. Tracks consecutive failures so /api/status
 * can expose staleness to the frontend.
 */
import { config } from '../config.js';
import { logger } from '../utils/logger.js';
import { maskApiKey } from '../utils/validation.js';
import { cacheStore } from './cacheStore.js';
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
  const prior = cacheStore.read<RtMeta>('rt-meta');
  const failures = prior?.consecutiveFailures ?? 0;

  const fail = (error: string): RtMeta => {
    const meta: RtMeta = {
      fetchedAt: prior?.fetchedAt ?? null,
      success: false,
      consecutiveFailures: failures + 1,
      trainCount: prior?.trainCount ?? 0,
      alertCount: prior?.alertCount ?? 0,
      error,
    };
    cacheStore.write('rt-meta', meta);
    logger.error({ error, consecutiveFailures: meta.consecutiveFailures }, 'GTFS-RT: fetch failed');
    return meta;
  };

  if (!url) return fail('ODPT_GTFS_RT_URL not configured');

  const requestUrl = token ? appendToken(url, token) : url;
  logger.info({ url: maskUrl(requestUrl) }, 'GTFS-RT: downloading');

  let buf: Uint8Array;
  try {
    const res = await fetch(requestUrl);
    if (!res.ok) return fail(`HTTP ${res.status}`);
    buf = new Uint8Array(await res.arrayBuffer());
  } catch (err) {
    return fail(err instanceof Error ? err.message : String(err));
  }

  try {
    const feed = decodeFeed(buf);
    const { stations } = loadStations();
    const trains = feedToTrains(feed, stations);
    const alerts = feedToAlerts(feed);

    cacheStore.write('trains', trains);
    cacheStore.write('alerts', alerts);
    const meta: RtMeta = {
      fetchedAt,
      success: true,
      consecutiveFailures: 0,
      trainCount: trains.length,
      alertCount: alerts.length,
    };
    cacheStore.write('rt-meta', meta);
    logger.info({ trains: trains.length, alerts: alerts.length }, 'GTFS-RT: decoded and cached');
    return meta;
  } catch (err) {
    return fail(`decode failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}

function appendToken(url: string, token: string): string {
  const sep = url.includes('?') ? '&' : '?';
  return `${url}${sep}acl:consumerKey=${encodeURIComponent(token)}`;
}

function maskUrl(url: string): string {
  return url.replace(/(consumerKey=)[^&]+/i, (_, p1: string) => p1 + maskApiKey(config.odptApiToken));
}
