import fs from 'node:fs';
import path from 'node:path';
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
    try {
      fs.writeFileSync(file, JSON.stringify(data, null, 2));
    } catch (err) {
      logger.error({ err, key }, 'CacheStore: write failed');
    }
  }

  exists(key: string): boolean {
    return fs.existsSync(path.join(this.dir, `${key}.json`));
  }
}

export const cacheStore = new CacheStore();
