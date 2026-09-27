import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { Pool } from 'pg';

test('custom backup restores into a new isolated database without overwriting existing schema', async () => {
  const connection = process.env.TEST_ADMIN_DATABASE_URL;
  assert.ok(connection, 'TEST_ADMIN_DATABASE_URL is required');
  const url = new URL(connection);
  const database = url.pathname.slice(1);
  assert.match(database, /^metro3d_(test|verify)_[a-z0-9_]+$/);
  const admin = new Pool({ connectionString: connection });
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'metro3d-backup-test-'));
  let restored: Pool | undefined;
  try {
    assert.equal((await admin.query('SELECT current_database() AS name')).rows[0].name, database);
    const target = `metro3d_test_restore_${randomBytes(6).toString('hex')}`;
    await admin.query(`CREATE DATABASE "${target}"`);
    await admin.query(`REVOKE ALL ON DATABASE "${target}" FROM PUBLIC`);
    url.pathname = `/${target}`;
    const archive = path.join(temporary, 'backup.dump');
    const command = (action: string, uri: string) => spawnSync(process.execPath,
      ['--import', 'tsx', 'src/db/cli.ts', action, archive], {
        env: { ...process.env, DATABASE_URL: uri }, encoding: 'utf8', timeout: 120000,
      });
    assert.equal(command('backup', connection).status, 0, 'Backup CLI must succeed');
    assert.equal(fs.statSync(archive).mode & 0o777, 0o600);
    assert.equal(command('restore', url.toString()).status, 0, 'Restore CLI must succeed');
    restored = new Pool({ connectionString: url.toString() });
    const select = 'SELECT key, payload FROM metro3d.snapshots ORDER BY key';
    assert.deepEqual((await restored.query(select)).rows, (await admin.query(select)).rows);
    assert.deepEqual((await restored.query('SELECT version, checksum FROM metro3d.schema_migrations ORDER BY version')).rows,
      (await admin.query('SELECT version, checksum FROM metro3d.schema_migrations ORDER BY version')).rows);
    assert.notEqual(command('restore', url.toString()).status, 0, 'Existing schema must reject restore');
    assert.notEqual(command('backup', connection).status, 0, 'Existing backup must not be overwritten');
    console.log(`Restore verified in isolated database ${target}; no database was dropped`);
  } finally {
    await restored?.end();
    await admin.end();
    fs.rmSync(temporary, { recursive: true, force: true });
  }
});
