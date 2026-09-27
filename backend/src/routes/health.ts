import type { FastifyInstance } from 'fastify';
import { config } from '../config.js';
import { cacheStore } from '../services/cacheStore.js';

export async function healthRoute(app: FastifyInstance): Promise<void> {
  app.get('/api/health', async (_req, reply) => {
    await cacheStore.health();
    const uptimeSeconds = Math.floor((Date.now() - config.startTime) / 1000);
    return reply.send({
      ok: true,
      data: {
        service: 'metro3d-api',
        status: 'healthy',
        uptimeSeconds,
        version: '1.0.0',
        storage: config.cacheBackend,
      },
      meta: {
        generatedAt: new Date().toISOString(),
        stale: false,
      },
    });
  });
}
