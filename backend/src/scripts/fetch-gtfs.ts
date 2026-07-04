/**
 * CLI entrypoint: fetch ODPT GTFS static feed and refresh the cache.
 * Run via `npm run fetch:static` (tsx) or `node dist/scripts/fetch-gtfs.js`.
 */
import { fetchAndNormalizeGtfs } from '../services/gtfsFetcher.js';
import { logger } from '../utils/logger.js';

fetchAndNormalizeGtfs()
  .then((result) => {
    if (result.ok) {
      logger.info(result, 'fetch-gtfs: success');
      process.exit(0);
    }
    logger.error(result, 'fetch-gtfs: failed');
    process.exit(1);
  })
  .catch((err) => {
    logger.error(err, 'fetch-gtfs: unexpected error');
    process.exit(1);
  });
