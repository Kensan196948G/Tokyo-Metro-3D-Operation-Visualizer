import type { Pool } from 'pg';
import { StorageError } from './storageError.js';

export class PostgresStore {
  constructor(private readonly pool: Pool) {}

  async read<T>(key: string): Promise<T | null> {
    return (await this.readMany([key]))[key] as T | null;
  }

  async readMany(keys: string[]): Promise<Record<string, unknown | null>> {
    try {
      const result = await this.pool.query<{ key: string; payload: unknown }>(
        'SELECT key, payload FROM metro3d.snapshots WHERE key = ANY($1::text[])', [keys],
      );
      return Object.fromEntries(keys.map((key) => [
        key, result.rows.find((row) => row.key === key)?.payload ?? null,
      ]));
    } catch {
      throw new StorageError();
    }
  }

  async write<T>(key: string, data: T): Promise<void> {
    await this.writeBatch({ [key]: data });
  }

  async writeBatch(entries: Record<string, unknown>): Promise<void> {
    const client = await this.pool.connect().catch(() => { throw new StorageError(); });
    let broken = false;
    try {
      await client.query('BEGIN');
      for (const [key, value] of Object.entries(entries)) {
        await client.query(
          'INSERT INTO metro3d.snapshots (key, payload) VALUES ($1, $2::jsonb) '
          + 'ON CONFLICT (key) DO UPDATE SET payload = EXCLUDED.payload, updated_at = now()',
          [key, JSON.stringify(value)],
        );
      }
      await client.query('COMMIT');
    } catch {
      try { await client.query('ROLLBACK'); } catch { broken = true; }
      throw new StorageError();
    } finally {
      client.release(broken);
    }
  }

  async exists(key: string): Promise<boolean> {
    return (await this.read(key)) !== null;
  }

  async health(): Promise<void> {
    try {
      const result = await this.pool.query<{ readable: boolean; writable: boolean }>(
        "SELECT has_table_privilege(current_user, 'metro3d.snapshots', 'SELECT') AS readable, "
        + "(has_table_privilege(current_user, 'metro3d.snapshots', 'INSERT') AND "
        + "has_table_privilege(current_user, 'metro3d.snapshots', 'UPDATE')) AS writable",
      );
      if (!result.rows[0]?.readable || !result.rows[0]?.writable) throw new StorageError();
      // Verify the actual schema contract without mutating application data.
      await this.pool.query('SELECT key, payload, updated_at FROM metro3d.snapshots LIMIT 0');
      const migration = await this.pool.query<{ version: number }>(
        'SELECT version FROM metro3d.schema_migrations WHERE version = 1',
      );
      if (migration.rows[0]?.version !== 1) throw new StorageError();
    } catch {
      throw new StorageError();
    }
  }

  async close(): Promise<void> {
    await this.pool.end().catch(() => { throw new StorageError(); });
  }
}
