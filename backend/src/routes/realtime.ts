import type { FastifyInstance } from 'fastify';
import { generateMockTrains, generateMockAlerts } from '../services/normalizer.js';
import { cacheStore } from '../services/cacheStore.js';
import type { MetroTrain, MetroAlert } from '../domain/trainModel.js';
import type { MetroRouteShape } from '../services/gtfsParser.js';
import type { RtMeta } from '../services/gtfsRtFetcher.js';

type GtfsMeta = { fetchedAt: string; stationCount: number; shapeCount: number };

const RT_STALE_THRESHOLD_MS = 90_000;

// Disk-read TTL for the REAL (GTFS-RT, metro-only) train cache. Mock trains
// are a pure function of wall-clock time and are regenerated on every poll.
const TRAIN_CACHE_TTL_MS = 10_000;

function isRtStale(meta: RtMeta | null, now: number): boolean {
  const updated = meta?.fetchedAt ? Date.parse(meta.fetchedAt) : NaN;
  return !meta?.success || !Number.isFinite(updated) || now - updated > RT_STALE_THRESHOLD_MS;
}

export async function realtimeRoute(app: FastifyInstance): Promise<void> {
  let realTrainCache: MetroTrain[] | null = null;
  let realTrainMeta: RtMeta | null = null;
  let realTrainCacheTime = 0;
  const readTrains = (now: number): void => {
    if (now - realTrainCacheTime > TRAIN_CACHE_TTL_MS || realTrainCacheTime === 0) {
      const cached = cacheStore.read<MetroTrain[]>('trains');
      realTrainCache = Array.isArray(cached) ? cached : null;
      realTrainMeta = cacheStore.read<RtMeta>('rt-meta');
      realTrainCacheTime = now;
    }
  };
  app.get('/api/realtime/trains', async (_req, reply) => {
    const now = Date.now();
    readTrains(now);
    // Metro: real feed when present, otherwise mock. JR: always mock — its
    // ODPT realtime feed is challenge-2026-licensed and not wired up.
    const metroTrains =
      realTrainCache ?? generateMockTrains(now, 'TokyoMetro');
    const jrTrains = generateMockTrains(now, 'JR-East');

    return reply.send({
      ok: true,
      data: [...metroTrains, ...jrTrains],
      meta: {
        generatedAt: new Date().toISOString(),
        sourceUpdatedAt: realTrainMeta?.fetchedAt ?? undefined,
        stale: realTrainCache === null || isRtStale(realTrainMeta, now),
      },
    });
  });

  app.get('/api/realtime/alerts', async (_req, reply) => {
    const cached = cacheStore.read<MetroAlert[]>('alerts');
    const alerts = Array.isArray(cached) ? cached : generateMockAlerts();
    const rtMeta = cacheStore.read<RtMeta>('rt-meta');
    return reply.send({
      ok: true,
      data: alerts,
      meta: {
        generatedAt: new Date().toISOString(),
        sourceUpdatedAt: rtMeta?.fetchedAt ?? undefined,
        stale: !Array.isArray(cached) || isRtStale(rtMeta, Date.now()),
      },
    });
  });

  app.get('/api/route-shapes', async (_req, reply) => {
    const shapes = cacheStore.read<MetroRouteShape[]>('route-shapes') ?? [];
    return reply.send({
      ok: true,
      data: shapes,
      meta: {
        generatedAt: new Date().toISOString(),
        stale: shapes.length === 0,
      },
    });
  });

  app.get('/api/status', async (_req, reply) => {
    const gtfsMeta = cacheStore.read<GtfsMeta>('gtfs-meta');
    const now = Date.now();
    readTrains(now);
    const rtMeta = realTrainMeta;
    const rtStale = realTrainCache === null || isRtStale(rtMeta, now);
    return reply.send({
      ok: true,
      data: {
        gtfsStaticFetchedAt: gtfsMeta?.fetchedAt ?? null,
        gtfsStationCount: gtfsMeta?.stationCount ?? 0,
        gtfsShapeCount: gtfsMeta?.shapeCount ?? 0,
        gtfsRtFetchedAt: rtMeta?.fetchedAt ?? null,
        gtfsRtFetchSuccess: rtMeta?.success ?? false,
        gtfsRtTrainCount: rtMeta?.trainCount ?? 0,
        consecutiveFailures: rtMeta?.consecutiveFailures ?? 0,
        stale: rtStale,
        dataSource: gtfsMeta ? 'gtfs' : 'mock',
        realtimeSource: realTrainCache !== null ? 'gtfs-rt' : 'mock',
      },
      meta: {
        generatedAt: new Date().toISOString(),
        stale: false,
      },
    });
  });
}
