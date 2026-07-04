import Fastify from 'fastify';
import cors from '@fastify/cors';
import { config, validateConfig } from './config.js';
import { logger } from './utils/logger.js';
import { healthRoute } from './routes/health.js';
import { routesRoute } from './routes/routes.js';
import { stationsRoute } from './routes/stations.js';
import { realtimeRoute } from './routes/realtime.js';
import { fetchAndNormalizeGtfs } from './services/gtfsFetcher.js';

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

  // Admin: manual refetch. Guarded by the TCP peer address (not the Host
  // header, which clients can spoof) so only local processes may trigger it.
  app.post('/api/admin/refetch', async (req, reply) => {
    const remote = req.socket.remoteAddress ?? '';
    const isLocal = remote === '127.0.0.1' || remote === '::1' || remote === '::ffff:127.0.0.1';
    if (!isLocal) {
      return reply.status(403).send({
        ok: false,
        error: { code: 'FORBIDDEN', message: 'Admin API is local only' },
        meta: { generatedAt: new Date().toISOString(), stale: false },
      });
    }
    const result = await fetchAndNormalizeGtfs();
    return reply.status(result.ok ? 200 : 502).send({
      ok: result.ok,
      data: result,
      meta: { generatedAt: new Date().toISOString(), stale: false },
    });
  });

  await app.listen({ port: config.port, host: '0.0.0.0' });
  logger.info({ port: config.port }, 'Tokyo Metro 3D API started');
}

start().catch((err) => {
  logger.error(err, 'Failed to start server');
  process.exit(1);
});
