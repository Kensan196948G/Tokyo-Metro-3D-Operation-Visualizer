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
import { requestFeed } from './feedRequest.js';
import { cacheStore } from './cacheStore.js';
import { StorageError } from './storageError.js';
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

  logger.info('GTFS static: downloading');

  let zipBuf: Uint8Array;
  try {
    zipBuf = await requestFeed(url, token, 60_000, 50 * 1024 * 1024);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, stationCount: 0, shapeCount: 0, fetchedAt, error: message };
  }

  return normalizeGtfsZip(zipBuf, fetchedAt);
}

/** Pure normalization step, unit-testable with a fixture zip. */
export async function normalizeGtfsZip(zipBuf: Uint8Array, fetchedAt: string): Promise<GtfsFetchResult> {
  let files: Record<string, Uint8Array>;
  try {
    let totalSize = 0;
    let entries = 0;
    files = unzipSync(zipBuf, {
      filter: (entry) => {
        totalSize += entry.originalSize;
        entries += 1;
        if (totalSize > 200 * 1024 * 1024 || entries > 1000) {
          throw new Error('GTFS archive exceeds extraction limit');
        }
        return true;
      },
    });
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

  try {
    await cacheStore.writeBatch({
      stations,
      'route-shapes': shapes,
      'gtfs-meta': { source: 'gtfs', fetchedAt, stationCount: stations.length, shapeCount: shapes.length },
    });
  } catch (error) {
    if (error instanceof StorageError) throw error;
    return { ok: false, stationCount: 0, shapeCount: 0, fetchedAt, error: 'Cache write failed' };
  }

  logger.info(
    { stations: stations.length, shapes: shapes.length },
    'GTFS static: normalized and cached'
  );
  return { ok: true, stationCount: stations.length, shapeCount: shapes.length, fetchedAt };
}
