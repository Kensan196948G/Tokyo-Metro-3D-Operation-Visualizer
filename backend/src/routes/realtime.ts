import type { FastifyInstance } from 'fastify';
import { generateMockTrains, generateMockAlerts } from '../services/normalizer.js';
import { cacheStore } from '../services/cacheStore.js';
import type { MetroTrain, MetroAlert } from '../domain/trainModel.js';
import type { MetroRouteShape } from '../services/gtfsParser.js';

type GtfsMeta = { fetchedAt: string; stationCount: number; shapeCount: number };

let trainCache: MetroTrain[] = [];
let trainCacheTime = 0;
const TRAIN_CACHE_TTL_MS = 10_000;

export async function realtimeRoute(app: FastifyInstance): Promise<void> {
  app.get('/api/realtime/trains', async (_req, reply) => {
    const now = Date.now();
    if (now - trainCacheTime > TRAIN_CACHE_TTL_MS) {
      // Try real cache, fallback to mock
      const cached = cacheStore.read<MetroTrain[]>('trains');
      trainCache = cached ?? generateMockTrains();
      trainCacheTime = now;
    }
    return reply.send({
      ok: true,
      data: trainCache,
      meta: {
        generatedAt: new Date().toISOString(),
        stale: false,
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
    return reply.send({
      ok: true,
      data: {
        gtfsStaticFetchedAt: gtfsMeta?.fetchedAt ?? null,
        gtfsStationCount: gtfsMeta?.stationCount ?? 0,
        gtfsShapeCount: gtfsMeta?.shapeCount ?? 0,
        gtfsRtFetchedAt: null,
        gtfsRtFetchSuccess: false,
        consecutiveFailures: 0,
        stale: !gtfsMeta,
        dataSource: gtfsMeta ? 'gtfs' : 'mock',
      },
      meta: {
        generatedAt: new Date().toISOString(),
        stale: false,
      },
    });
  });
}
