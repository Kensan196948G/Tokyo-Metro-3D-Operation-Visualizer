import { config as loadDotenv } from 'dotenv';
loadDotenv();

export const config = {
  nodeEnv: process.env.NODE_ENV ?? 'development',
  port: parseInt(process.env.PORT ?? '3000', 10),
  odptApiToken: process.env.ODPT_API_TOKEN ?? '',
  odptGtfsUrl: process.env.ODPT_GTFS_URL ?? '',
  odptGtfsRtUrl: process.env.ODPT_GTFS_RT_URL ?? '',
  frontendOrigin: process.env.FRONTEND_ORIGIN ?? 'http://localhost:5173',
  cacheDir: process.env.CACHE_DIR ?? './data/cache',
  fetchIntervalSeconds: parseInt(process.env.FETCH_INTERVAL_SECONDS ?? '15', 10),
  logLevel: process.env.LOG_LEVEL ?? 'info',
  startTime: Date.now(),
} as const;

export function validateConfig(): void {
  // In production, require token; in dev, allow running without
  if (config.nodeEnv === 'production' && !config.odptApiToken) {
    throw new Error('ODPT_API_TOKEN is required in production');
  }
}
