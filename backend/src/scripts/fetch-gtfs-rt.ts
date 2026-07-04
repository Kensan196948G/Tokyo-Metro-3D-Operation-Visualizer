/**
 * CLI entrypoint: fetch the ODPT GTFS-RT feed once and refresh the cache.
 * Run via `npm run fetch:realtime` (tsx) or the systemd timer
 * (`node dist/scripts/fetch-gtfs-rt.js`).
 */
import { fetchAndDecodeRt } from '../services/gtfsRtFetcher.js';
import { logger } from '../utils/logger.js';

fetchAndDecodeRt()
  .then((meta) => {
    if (meta.success) {
      logger.info(meta, 'fetch-gtfs-rt: success');
      process.exit(0);
    }
    logger.error(meta, 'fetch-gtfs-rt: failed');
    process.exit(1);
  })
  .catch((err) => {
    logger.error(err, 'fetch-gtfs-rt: unexpected error');
    process.exit(1);
  });
