import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Pool } from 'pg';
import { migrate } from './migrations.js';
import { seed, importJson, exportJson } from './data.js';
import { PostgresStore } from '../services/postgresStore.js';

const connectionString = process.env.TEST_DATABASE_URL;
if (!connectionString) throw new Error('TEST_DATABASE_URL must point to a dedicated integration database');
const db = new URL(connectionString).pathname.slice(1);
if (!/^metro3d_(test|verify)_/.test(db)) throw new Error('Integration tests require a dedicated metro3d_test_ or metro3d_verify_ database');

test('real PostgreSQL migration, seed, atomic snapshots, permissions and JSON rollback', async () => {
  const admin = new Pool({ connectionString: process.env.TEST_ADMIN_DATABASE_URL ?? connectionString, max: 2 });
  const pool = new Pool({ connectionString, max: 3 });
  const store = new PostgresStore(pool);
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'metro3d-pg-test-'));
  try {
    const identities = await Promise.all([admin.query('SELECT current_database() AS name'), pool.query('SELECT current_database() AS name')]);
    assert.equal(identities[0].rows[0].name, db);
    assert.equal(identities[1].rows[0].name, db);
    await migrate(admin, process.env.DB_MIGRATION_ROLE);
    assert.equal(await migrate(admin, process.env.DB_MIGRATION_ROLE), 0);
    await seed(pool);
    assert.equal(await seed(pool), false);
    const stations = await store.read<unknown[]>('stations');
    assert.ok(stations && stations.length >= 150);
    const meta = await store.read<{ source: string }>('gtfs-meta');
    assert.equal(meta?.source, 'mock');
    await store.health();
    await store.writeBatch({ trains: [{ generation: 1 }], alerts: [], 'rt-meta': { generation: 1 } });
    const before = await store.readMany(['trains', 'rt-meta']);
    await assert.rejects(store.writeBatch({ trains: [{ generation: 2 }], 'rt-meta': [] }));
    assert.deepEqual(await store.readMany(['trains', 'rt-meta']), before);
    await assert.rejects(store.write('not-a-key', []));
    await assert.rejects(pool.query('CREATE TABLE metro3d.forbidden_test (id integer)'));
    await assert.rejects(pool.query('DELETE FROM metro3d.snapshots WHERE false'));
    await assert.rejects(pool.query('UPDATE metro3d.schema_migrations SET checksum=checksum WHERE false'));
    for (let generation = 2; generation <= 8; generation++) {
      await store.writeBatch({ trains: [{ generation }], 'rt-meta': { generation } });
      const values = await store.readMany(['trains', 'rt-meta']);
      assert.equal((values.trains as Array<{ generation: number }>)[0].generation,
        (values['rt-meta'] as { generation: number }).generation);
    }
    assert.equal(await store.exists('stations'), true);
    const target = path.join(directory, 'export');
    assert.ok(await exportJson(pool, target) >= 2);
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(target, 'stations.json'), 'utf8')), stations);
    assert.equal(fs.statSync(path.join(target, 'stations.json')).mode & 0o777, 0o600);
    await assert.rejects(exportJson(pool, target));
    await assert.rejects(importJson(pool, target));
    const index = await admin.query("SELECT indexdef FROM pg_indexes WHERE schemaname='metro3d' AND tablename='snapshots'");
    assert.ok(index.rows.some(row => /UNIQUE INDEX.*\(key\)/.test(row.indexdef)));
    const checksum = await admin.query('SELECT checksum FROM metro3d.schema_migrations WHERE version=1');
    await admin.query("UPDATE metro3d.schema_migrations SET checksum='corrupt-test' WHERE version=1");
    try { await assert.rejects(migrate(admin, process.env.DB_MIGRATION_ROLE), /checksum mismatch/); }
    finally { await admin.query('UPDATE metro3d.schema_migrations SET checksum=$1 WHERE version=1', [checksum.rows[0].checksum]); }
  } finally {
    await pool.end();
    await admin.end();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
