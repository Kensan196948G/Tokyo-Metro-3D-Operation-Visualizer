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
import { cacheStore } from './services/cacheStore.js';
import { StorageError } from './services/storageError.js';

export async function buildApp(options: { logger?: boolean } = {}): Promise<FastifyInstance> {
  const app = Fastify({
    logger: options.logger === false ? false : { level: config.logLevel },
  });

  app.setErrorHandler((error, _req, reply) => {
    if (error instanceof StorageError) {
      return reply.status(503).send({
        ok: false,
        error: { code: 'STORAGE_UNAVAILABLE', message: 'Storage temporarily unavailable' },
        meta: { generatedAt: new Date().toISOString(), stale: true },
      });
    }
    return reply.send(error);
  });
  app.addHook('onClose', async () => { await cacheStore.close(); });

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
      throw new Error('SERVE_STATIC_DIR has no index.html; refusing incomplete deployment');
    }
  }

  await app.register(healthRoute);
  await app.register(routesRoute);
  await app.register(stationsRoute);
  await app.register(realtimeRoute);

  // Admin: manual refetch. Guarded by the TCP peer address (not the Host
  // header, which clients can spoof) so only local processes may trigger it.
  // A Cloudflare Tunnel (cloudflared) proxies FROM localhost, so the peer
  // check alone would pass for internet traffic — any cf-* proxy header
  // therefore also rejects. (Clients can't strip headers Cloudflare adds.)
  // CLI-only: CORS does not stop browser POST side effects on localhost.
  app.post('/api/admin/refetch', async (req, reply) => {
    const remote = req.socket.remoteAddress ?? '';
    const viaCloudflare =
      req.headers['cf-connecting-ip'] !== undefined || req.headers['cf-ray'] !== undefined;
    const isLocal =
      !viaCloudflare &&
      req.headers.origin === undefined &&
      req.headers['sec-fetch-site'] === undefined &&
      (remote === '127.0.0.1' || remote === '::1' || remote === '::ffff:127.0.0.1');
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
