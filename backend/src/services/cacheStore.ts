import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { logger } from '../utils/logger.js';
import { config } from '../config.js';

export class CacheStore {
  private readonly dir: string;

  constructor(dir: string = config.cacheDir) {
    this.dir = dir;
    fs.mkdirSync(dir, { recursive: true });
  }

  read<T>(key: string): T | null {
    const file = path.join(this.dir, `${key}.json`);
    try {
      const raw = fs.readFileSync(file, 'utf8');
      return JSON.parse(raw) as T;
    } catch {
      return null;
    }
  }

  write<T>(key: string, data: T): void {
    const file = path.join(this.dir, `${key}.json`);
    const temporary = `${file}.${randomUUID()}.tmp`;
    try {
      fs.writeFileSync(temporary, JSON.stringify(data, null, 2), { flag: 'wx', mode: 0o600 });
      fs.renameSync(temporary, file);
    } catch {
      logger.error({ key }, 'CacheStore: write failed');
      throw new Error('Cache write failed');
    } finally {
      try {
        fs.rmSync(temporary, { force: true });
      } catch {
        logger.warn({ key }, 'CacheStore: temporary file cleanup failed');
      }
    }
  }

  exists(key: string): boolean {
    return fs.existsSync(path.join(this.dir, `${key}.json`));
  }
}

export const cacheStore = new CacheStore();
