import { createHash } from 'node:crypto';
import type { Pool } from 'pg';

export const SNAPSHOT_KEYS = ['stations', 'route-shapes', 'gtfs-meta', 'trains', 'alerts', 'rt-meta'] as const;

const migrations = [{ version: 1, sql: `
CREATE TABLE metro3d.snapshots (
  key text PRIMARY KEY CHECK (key IN ('stations', 'route-shapes', 'gtfs-meta', 'trains', 'alerts', 'rt-meta')),
  payload jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT snapshot_payload_type CHECK (
    (key IN ('stations', 'route-shapes', 'trains', 'alerts') AND jsonb_typeof(payload) = 'array') OR
    (key IN ('gtfs-meta', 'rt-meta') AND jsonb_typeof(payload) = 'object')
  )
);
REVOKE ALL ON metro3d.snapshots FROM PUBLIC;
` }];

export async function migrate(pool: Pool, ownerRole?: string): Promise<number> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    if (ownerRole) {
      if (!/^[a-z][a-z0-9_]{0,62}$/.test(ownerRole)) throw new Error('Invalid migration owner role');
      await client.query(`SET LOCAL ROLE "${ownerRole}"`);
    }
    await client.query('SELECT pg_advisory_xact_lock(674, 1)');
    await client.query('CREATE SCHEMA IF NOT EXISTS metro3d');
    await client.query('REVOKE ALL ON SCHEMA metro3d FROM PUBLIC');
    await client.query(`CREATE TABLE IF NOT EXISTS metro3d.schema_migrations (
      version integer PRIMARY KEY, checksum text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now()
    )`);
    let applied = 0;
    for (const migration of migrations) {
      const checksum = createHash('sha256').update(migration.sql).digest('hex');
      const existing = await client.query<{ checksum: string }>(
        'SELECT checksum FROM metro3d.schema_migrations WHERE version = $1', [migration.version]);
      if (existing.rowCount) {
        if (existing.rows[0].checksum !== checksum) throw new Error('Migration checksum mismatch');
        continue;
      }
      await client.query(migration.sql);
      await client.query('INSERT INTO metro3d.schema_migrations(version, checksum) VALUES ($1, $2)',
        [migration.version, checksum]);
      applied++;
    }
    await client.query('COMMIT');
    return applied;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally { client.release(); }
}
