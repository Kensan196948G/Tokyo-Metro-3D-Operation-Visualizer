/**
 * Downloads the ODPT GTFS static zip, extracts it in-memory, normalizes
 * stops/shapes into domain models and persists them to the cache store.
 * The ODPT token is sent only from this backend process and never logged.
 */
import fs from 'node:fs';
import path from 'node:path';
import { unzipSync, strFromU8 } from 'fflate';
import { config } from '../config.js';
import { logger } from '../utils/logger.js';
import { maskApiKey } from '../utils/validation.js';
import { cacheStore } from './cacheStore.js';
import {
  parseStops,
  parseShapes,
  buildShapeRouteMap,
  buildStopRouteMap,
} from './gtfsParser.js';

export type GtfsFetchResult = {
  ok: boolean;
  stationCount: number;
  shapeCount: number;
  fetchedAt: string;
  error?: string;
};

const RAW_DIR = path.resolve(config.cacheDir, '../raw');

export async function fetchAndNormalizeGtfs(
  url: string = config.odptGtfsUrl,
  token: string = config.odptApiToken
): Promise<GtfsFetchResult> {
  const fetchedAt = new Date().toISOString();

  if (!url) {
    return { ok: false, stationCount: 0, shapeCount: 0, fetchedAt, error: 'ODPT_GTFS_URL not configured' };
  }

  const requestUrl = token ? appendToken(url, token) : url;
  logger.info({ url: maskUrl(requestUrl) }, 'GTFS static: downloading');

  let zipBuf: Uint8Array;
  try {
    const res = await fetch(requestUrl);
    if (!res.ok) {
      return { ok: false, stationCount: 0, shapeCount: 0, fetchedAt, error: `HTTP ${res.status}` };
    }
    zipBuf = new Uint8Array(await res.arrayBuffer());
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, stationCount: 0, shapeCount: 0, fetchedAt, error: message };
  }

  return normalizeGtfsZip(zipBuf, fetchedAt);
}

/** Pure normalization step, unit-testable with a fixture zip. */
export function normalizeGtfsZip(zipBuf: Uint8Array, fetchedAt: string): GtfsFetchResult {
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(zipBuf);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, stationCount: 0, shapeCount: 0, fetchedAt, error: `unzip failed: ${message}` };
  }

  const text = (name: string): string | undefined => {
    const entry = Object.keys(files).find((k) => k === name || k.endsWith(`/${name}`));
    return entry ? strFromU8(files[entry]) : undefined;
  };

  const stopsText = text('stops.txt');
  if (!stopsText) {
    return { ok: false, stationCount: 0, shapeCount: 0, fetchedAt, error: 'stops.txt not found in zip' };
  }

  const routesText = text('routes.txt');
  const tripsText = text('trips.txt');
  const shapesText = text('shapes.txt');
  const stopTimesText = text('stop_times.txt');

  // Persist raw files for debugging / reprocessing
  try {
    fs.mkdirSync(RAW_DIR, { recursive: true });
    for (const [name, content] of Object.entries(files)) {
      const base = path.basename(name);
      if (base.endsWith('.txt')) {
        fs.writeFileSync(path.join(RAW_DIR, base), content);
      }
    }
  } catch (err) {
    logger.warn({ err }, 'GTFS static: failed to persist raw files (continuing)');
  }

  const stopRouteMap =
    tripsText && stopTimesText
      ? buildStopRouteMap(tripsText, stopTimesText, routesText)
      : new Map<string, string[]>();
  const stations = parseStops(stopsText, stopRouteMap);

  const shapeRouteMap = tripsText ? buildShapeRouteMap(tripsText, routesText) : new Map<string, string>();
  const shapes = shapesText ? parseShapes(shapesText, shapeRouteMap) : [];

  cacheStore.write('stations', stations);
  cacheStore.write('route-shapes', shapes);
  cacheStore.write('gtfs-meta', { fetchedAt, stationCount: stations.length, shapeCount: shapes.length });

  logger.info(
    { stations: stations.length, shapes: shapes.length },
    'GTFS static: normalized and cached'
  );
  return { ok: true, stationCount: stations.length, shapeCount: shapes.length, fetchedAt };
}

function appendToken(url: string, token: string): string {
  const sep = url.includes('?') ? '&' : '?';
  return `${url}${sep}acl:consumerKey=${encodeURIComponent(token)}`;
}

function maskUrl(url: string): string {
  return url.replace(/(consumerKey=)[^&]+/i, (_, p1: string) => p1 + maskApiKey(config.odptApiToken));
}
