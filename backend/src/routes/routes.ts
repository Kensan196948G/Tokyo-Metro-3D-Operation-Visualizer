import type { FastifyInstance } from 'fastify';
import { ALL_ROUTES } from '../domain/routeModel.js';

export async function routesRoute(app: FastifyInstance): Promise<void> {
  app.get('/api/routes', async (_req, reply) => {
    return reply.send({
      ok: true,
      data: ALL_ROUTES,
      meta: {
        generatedAt: new Date().toISOString(),
        stale: false,
      },
    });
  });
}
