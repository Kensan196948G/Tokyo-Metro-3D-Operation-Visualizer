import type { FastifyInstance } from 'fastify';
import { TOKYO_METRO_ROUTES } from '../domain/routeModel.js';

export async function routesRoute(app: FastifyInstance): Promise<void> {
  app.get('/api/routes', async (_req, reply) => {
    return reply.send({
      ok: true,
      data: TOKYO_METRO_ROUTES,
      meta: {
        generatedAt: new Date().toISOString(),
        stale: false,
      },
    });
  });
}
