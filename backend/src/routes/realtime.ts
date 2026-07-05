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
let realTrainCache: MetroTrain[] = [];
let realTrainCacheTime = 0;
const TRAIN_CACHE_TTL_MS = 10_000;

export async function realtimeRoute(app: FastifyInstance): Promise<void> {
  app.get('/api/realtime/trains', async (_req, reply) => {
    const now = Date.now();
    if (now - realTrainCacheTime > TRAIN_CACHE_TTL_MS) {
      realTrainCache = cacheStore.read<MetroTrain[]>('trains') ?? [];
      realTrainCacheTime = now;
    }
    // Metro: real feed when present, otherwise mock. JR: always mock — its
    // ODPT realtime feed is challenge-2026-licensed and not wired up.
    const metroTrains =
      realTrainCache.length > 0 ? realTrainCache : generateMockTrains(now, 'TokyoMetro');
    const jrTrains = generateMockTrains(now, 'JR-East');

    const rtMeta = cacheStore.read<RtMeta>('rt-meta');
    const rtAge = rtMeta?.fetchedAt ? now - Date.parse(rtMeta.fetchedAt) : Infinity;
    return reply.send({
      ok: true,
      data: [...metroTrains, ...jrTrains],
      meta: {
        generatedAt: new Date().toISOString(),
        sourceUpdatedAt: rtMeta?.fetchedAt ?? undefined,
        stale: !rtMeta?.success || rtAge > RT_STALE_THRESHOLD_MS,
      },
    });
  });

  app.get('/api/realtime/alerts', async (_req, reply) => {
    const cached = cacheStore.read<MetroAlert[]>('alerts');
    const alerts = cached ?? generateMockAlerts();
    return reply.send({
      ok: true,
      data: alerts,
      meta: {
        generatedAt: new Date().toISOString(),
        stale: false,
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
    const rtMeta = cacheStore.read<RtMeta>('rt-meta');
    const rtAge = rtMeta?.fetchedAt ? Date.now() - Date.parse(rtMeta.fetchedAt) : Infinity;
    const rtStale = !rtMeta?.success || rtAge > RT_STALE_THRESHOLD_MS;
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
        realtimeSource: rtMeta?.success ? 'gtfs-rt' : 'mock',
      },
      meta: {
        generatedAt: new Date().toISOString(),
        stale: false,
      },
    });
  });
}
