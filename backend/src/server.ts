import { config, validateConfig } from './config.js';
import { logger } from './utils/logger.js';
import { buildApp } from './app.js';

async function start(): Promise<void> {
  validateConfig();
  const app = await buildApp();
  await app.listen({ port: config.port, host: '0.0.0.0' });
  logger.info({ port: config.port }, 'Tokyo Metro 3D API started');
}

start().catch((err) => {
  logger.error(err, 'Failed to start server');
  process.exit(1);
});
