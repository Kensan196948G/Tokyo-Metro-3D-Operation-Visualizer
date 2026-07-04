import type { FastifyInstance } from 'fastify';
import { normalizeStations } from '../services/normalizer.js';

export async function stationsRoute(app: FastifyInstance): Promise<void> {
  app.get('/api/stations', async (_req, reply) => {
    const stations = normalizeStations();
    return reply.send({
      ok: true,
      data: stations,
      meta: {
        generatedAt: new Date().toISOString(),
        stale: false,
      },
    });
  });
}
