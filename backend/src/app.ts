/**
 * Fastify application factory. Building the app separately from the network
 * listener lets integration tests exercise real routes via app.inject()
 * without opening a port.
 */
import path from 'node:path';
import fs from 'node:fs';
import Fastify, { type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import fastifyStatic from '@fastify/static';
import { config } from './config.js';
import { healthRoute } from './routes/health.js';
import { routesRoute } from './routes/routes.js';
import { stationsRoute } from './routes/stations.js';
import { realtimeRoute } from './routes/realtime.js';
import { fetchAndNormalizeGtfs } from './services/gtfsFetcher.js';
import { fetchAndDecodeRt } from './services/gtfsRtFetcher.js';

export async function buildApp(options: { logger?: boolean } = {}): Promise<FastifyInstance> {
  const app = Fastify({
    logger: options.logger === false ? false : { level: config.logLevel },
  });

  await app.register(cors, {
    origin: config.frontendOrigin,
    methods: ['GET', 'POST'],
  });

  // Single-service LAN mode: serve the built frontend alongside the API.
  if (config.serveStaticDir) {
    const root = path.resolve(config.serveStaticDir);
    if (fs.existsSync(path.join(root, 'index.html'))) {
      await app.register(fastifyStatic, { root });
    } else {
      app.log.warn({ root }, 'SERVE_STATIC_DIR has no index.html; static serving skipped');
    }
  }

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
    const [staticResult, rtResult] = await Promise.all([
      fetchAndNormalizeGtfs(),
      fetchAndDecodeRt(),
    ]);
    const ok = staticResult.ok || rtResult.success;
    return reply.status(ok ? 200 : 502).send({
      ok,
      data: { static: staticResult, realtime: rtResult },
      meta: { generatedAt: new Date().toISOString(), stale: false },
    });
  });

  return app;
}
