import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { logger } from '../utils/logger.js';
import { config } from '../config.js';
import pg from 'pg';
import { PostgresStore } from './postgresStore.js';
import { StorageError } from './storageError.js';

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

export interface AsyncCacheStore {
  read<T>(key: string): Promise<T | null>;
  readMany(keys: string[]): Promise<Record<string, unknown | null>>;
  write<T>(key: string, data: T): Promise<void>;
  writeBatch(entries: Record<string, unknown>): Promise<void>;
  exists(key: string): Promise<boolean>;
  health(): Promise<void>;
  close(): Promise<void>;
}

class AsyncFileStore implements AsyncCacheStore {
  constructor(private readonly store = new CacheStore()) {}
  async read<T>(key: string): Promise<T | null> { return this.store.read<T>(key); }
  async readMany(keys: string[]): Promise<Record<string, unknown | null>> {
    return Object.fromEntries(keys.map((key) => [key, this.store.read(key)]));
  }
  async write<T>(key: string, data: T): Promise<void> {
    try { this.store.write(key, data); } catch { throw new StorageError(); }
  }
  async writeBatch(entries: Record<string, unknown>): Promise<void> {
    for (const [key, value] of Object.entries(entries)) await this.write(key, value);
  }
  async exists(key: string): Promise<boolean> { return this.store.exists(key); }
  async health(): Promise<void> {
    try { fs.accessSync(config.cacheDir, fs.constants.R_OK | fs.constants.W_OK); }
    catch { throw new StorageError(); }
  }
  async close(): Promise<void> {}
}

function createStore(): AsyncCacheStore {
  if (config.cacheBackend === 'file') return new AsyncFileStore();
  if (config.cacheBackend !== 'postgres' || !config.databaseUrl) {
    throw new Error('Invalid storage configuration');
  }
  const pool = new pg.Pool({
    connectionString: config.databaseUrl,
    max: 5,
    connectionTimeoutMillis: 5_000,
    idleTimeoutMillis: 30_000,
    statement_timeout: 5_000,
    query_timeout: 6_000,
    application_name: 'metro3d-api',
  });
  pool.on('error', () => logger.error('PostgreSQL connection unavailable'));
  return new PostgresStore(pool);
}

export const cacheStore: AsyncCacheStore = createStore();
