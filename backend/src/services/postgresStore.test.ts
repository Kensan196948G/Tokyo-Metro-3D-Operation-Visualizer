import { describe, expect, it, vi } from 'vitest';
import type { Pool } from 'pg';
import { PostgresStore } from './postgresStore.js';
import { StorageError } from './storageError.js';

function fixture() {
  const client = { query: vi.fn().mockResolvedValue({ rows: [] }), release: vi.fn() };
  const pool = {
    query: vi.fn().mockResolvedValue({ rows: [] }),
    connect: vi.fn().mockResolvedValue(client),
    end: vi.fn().mockResolvedValue(undefined),
  };
  return { client, pool, store: new PostgresStore(pool as unknown as Pool) };
}

describe('PostgreSQL snapshots', () => {
  it('reads correlated keys in one parameterized statement', async () => {
    const { pool, store } = fixture();
    pool.query.mockResolvedValue({ rows: [{ key: 'trains', payload: [] }] });
    expect(await store.readMany(['trains', 'rt-meta'])).toEqual({ trains: [], 'rt-meta': null });
    expect(pool.query).toHaveBeenCalledExactlyOnceWith(
      'SELECT key, payload FROM metro3d.snapshots WHERE key = ANY($1::text[])', [['trains', 'rt-meta']],
    );
  });

  it('commits related payloads on the same client without interpolating data', async () => {
    const { pool, client, store } = fixture();
    const entries = { trains: [{ trainId: "quote'; SELECT 1; --" }], 'rt-meta': { success: true } };
    await store.writeBatch(entries);
    expect(pool.query).not.toHaveBeenCalled();
    expect(pool.connect).toHaveBeenCalledOnce();
    expect(client.query.mock.calls.map((call) => call[0])).toEqual([
      'BEGIN', expect.stringContaining('VALUES ($1, $2::jsonb)'),
      expect.stringContaining('VALUES ($1, $2::jsonb)'), 'COMMIT',
    ]);
    expect(client.query.mock.calls[1][1]).toEqual(['trains', JSON.stringify(entries.trains)]);
    expect(client.release).toHaveBeenCalledExactlyOnceWith(false);
  });

  it('rolls back partial writes and suppresses driver detail', async () => {
    const { client, store } = fixture();
    client.query.mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockRejectedValueOnce(new Error('credential=synthetic-private-value'));
    await expect(store.writeBatch({ trains: [], 'rt-meta': {} })).rejects.toThrow('Storage unavailable');
    expect(client.query).toHaveBeenLastCalledWith('ROLLBACK');
    expect(client.release).toHaveBeenCalledExactlyOnceWith(false);
  });

  it('discards a connection when rollback itself fails', async () => {
    const { client, store } = fixture();
    client.query.mockRejectedValue(new Error('connection failed'));
    await expect(store.write('trains', [])).rejects.toBeInstanceOf(StorageError);
    expect(client.release).toHaveBeenCalledExactlyOnceWith(true);
  });

  it('turns connection and read failures into safe typed errors', async () => {
    const { pool, store } = fixture();
    pool.connect.mockRejectedValue(new Error('synthetic-private-value'));
    pool.query.mockRejectedValue(new Error('synthetic-private-value'));
    await expect(store.write('trains', [])).rejects.toBeInstanceOf(StorageError);
    await expect(store.read('trains')).rejects.toThrow(/^Storage unavailable$/);
  });

  it('checks schema and privileges without performing a write', async () => {
    const { pool, store } = fixture();
    pool.query.mockResolvedValueOnce({ rows: [{ readable: true, writable: true }] })
      .mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({ rows: [{ version: 1 }] });
    await store.health();
    expect(pool.query).toHaveBeenCalledWith('SELECT key, payload, updated_at FROM metro3d.snapshots LIMIT 0');
    expect(pool.query).toHaveBeenLastCalledWith('SELECT version FROM metro3d.schema_migrations WHERE version = 1');
    expect(pool.connect).not.toHaveBeenCalled();
  });

  it('rejects missing application privileges or schema', async () => {
    const { pool, store } = fixture();
    pool.query.mockResolvedValueOnce({ rows: [{ readable: true, writable: false }] });
    await expect(store.health()).rejects.toBeInstanceOf(StorageError);
    pool.query.mockRejectedValueOnce(new Error('missing table'));
    await expect(store.health()).rejects.toBeInstanceOf(StorageError);
    pool.query.mockResolvedValueOnce({ rows: [{ readable: true, writable: true }] });
    await expect(store.health()).rejects.toBeInstanceOf(StorageError);
  });

  it('closes the pool', async () => {
    const { pool, store } = fixture();
    await store.close();
    expect(pool.end).toHaveBeenCalledOnce();
  });
});
