import type { FastifyInstance } from 'fastify';
import { generateMockTrains, generateMockAlerts } from '../services/normalizer.js';
import { cacheStore } from '../services/cacheStore.js';
import type { MetroTrain, MetroAlert } from '../domain/trainModel.js';

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
    // Phase 2: load real GTFS shapes. For now return empty array.
    return reply.send({
      ok: true,
      data: [],
      meta: {
        generatedAt: new Date().toISOString(),
        stale: false,
      },
    });
  });

  app.get('/api/status', async (_req, reply) => {
    return reply.send({
      ok: true,
      data: {
        gtfsStaticFetchedAt: null,
        gtfsRtFetchedAt: null,
        gtfsRtFetchSuccess: false,
        consecutiveFailures: 0,
        stale: true,
        dataSource: 'mock',
      },
      meta: {
        generatedAt: new Date().toISOString(),
        stale: false,
      },
    });
  });
}
