import Fastify from 'fastify';
import cors from '@fastify/cors';
import { config, validateConfig } from './config.js';
import { logger } from './utils/logger.js';
import { healthRoute } from './routes/health.js';
import { routesRoute } from './routes/routes.js';
import { stationsRoute } from './routes/stations.js';
import { realtimeRoute } from './routes/realtime.js';

async function start(): Promise<void> {
  validateConfig();

  const app = Fastify({
    logger: {
      level: config.logLevel,
    },
  });

  await app.register(cors, {
    origin: config.frontendOrigin,
    methods: ['GET', 'POST'],
  });

  await app.register(healthRoute);
  await app.register(routesRoute);
  await app.register(stationsRoute);
  await app.register(realtimeRoute);

  // Admin: manual refetch (local only)
  app.post('/api/admin/refetch', async (req, reply) => {
    const host = req.headers.host ?? '';
    if (!host.startsWith('localhost') && !host.startsWith('127.0.0.1')) {
      return reply.status(403).send({ ok: false, error: { code: 'FORBIDDEN', message: 'Admin API is local only' } });
    }
    return reply.send({ ok: true, data: { message: 'Refetch triggered (mock)' }, meta: { generatedAt: new Date().toISOString(), stale: false } });
  });

  await app.listen({ port: config.port, host: '0.0.0.0' });
  logger.info({ port: config.port }, 'Tokyo Metro 3D API started');
}

start().catch((err) => {
  logger.error(err, 'Failed to start server');
  process.exit(1);
});
