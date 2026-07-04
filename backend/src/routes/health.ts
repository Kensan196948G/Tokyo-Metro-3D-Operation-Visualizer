import type { FastifyInstance } from 'fastify';
import { config } from '../config.js';

export async function healthRoute(app: FastifyInstance): Promise<void> {
  app.get('/api/health', async (_req, reply) => {
    const uptimeSeconds = Math.floor((Date.now() - config.startTime) / 1000);
    return reply.send({
      ok: true,
      data: {
        service: 'metro3d-api',
        status: 'healthy',
        uptimeSeconds,
        version: '1.0.0',
      },
      meta: {
        generatedAt: new Date().toISOString(),
        stale: false,
      },
    });
  });
}
