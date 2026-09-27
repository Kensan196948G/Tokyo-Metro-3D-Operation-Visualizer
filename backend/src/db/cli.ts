import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { Pool } from 'pg';
import { migrate } from './migrations.js';
import { seed, importJson, exportJson } from './data.js';
import { libpqEnvironment } from './libpq.js';

async function main(): Promise<void> {
  const [command, destination, ...extra] = process.argv.slice(2);
  if (!process.env.DATABASE_URL || extra.length || !['migrate', 'grant', 'seed', 'import', 'export', 'backup', 'restore'].includes(command)) {
    throw new Error('Usage: DATABASE_URL configured; db CLI migrate|grant|seed|import|export|backup|restore [path]');
  }
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1,
    connectionTimeoutMillis: 5000, statement_timeout: 30000, application_name: 'metro3d-db-cli' });
  pool.on('error', () => {});
  try {
    if (command === 'migrate') console.log(JSON.stringify({ applied: await migrate(pool, process.env.DB_MIGRATION_ROLE) }));
    else if (command === 'grant') {
      const role = process.env.DB_RUNTIME_ROLE ?? '';
      if (!/^metro3d(?:_[a-z0-9_]+)?_app$/.test(role) || role.length > 63) throw new Error('Invalid runtime role');
      await pool.query(`GRANT USAGE ON SCHEMA metro3d TO "${role}"`);
      await pool.query(`GRANT SELECT, INSERT, UPDATE ON metro3d.snapshots TO "${role}"`);
      await pool.query(`GRANT SELECT ON metro3d.schema_migrations TO "${role}"`);
      console.log('Runtime grants applied; no DDL or DELETE permission granted');
    }
    else if (command === 'seed') console.log(JSON.stringify({ seeded: await seed(pool) }));
    else {
      if (!destination) throw new Error('A destination path is required');
      const file = path.resolve(destination);
      if (command === 'import') console.log(JSON.stringify({ imported: await importJson(pool, file) }));
      else if (command === 'export') console.log(JSON.stringify({ exported: await exportJson(pool, file) }));
      else {
        const env = libpqEnvironment(process.env.DATABASE_URL);
        const version = await pool.query<{ server_version_num: string }>('SHOW server_version_num');
        const major = Math.floor(Number(version.rows[0].server_version_num) / 10000);
        const binary = command === 'backup' ? 'pg_dump' : 'pg_restore';
        const directory = process.env.PG_BIN_DIR ?? `/usr/lib/postgresql/${major}/bin`;
        const executable = fs.existsSync(path.join(directory, binary)) ? path.join(directory, binary) : binary;
        const toolVersion = spawnSync(executable, ['--version'], { encoding: 'utf8', timeout: 5000 });
        if (toolVersion.status !== 0 || Number(/PostgreSQL\) (\d+)\./.exec(toolVersion.stdout)?.[1]) !== major) {
          throw new Error('PostgreSQL backup tools must match the server major version');
        }
        if (command === 'backup') {
          const fd = fs.openSync(file, 'wx', 0o600);
          try {
            const result = spawnSync(executable, ['--format=custom', '--no-owner', '--no-acl', '--schema=metro3d'],
              { env, stdio: ['ignore', fd, 'pipe'], timeout: 120000 });
            if (result.error || result.status !== 0) throw new Error('Backup failed');
          } catch (error) { fs.unlinkSync(file); throw error; }
          finally { fs.closeSync(fd); }
          console.log('Backup complete');
        } else {
          const tables = await pool.query("SELECT 1 FROM pg_namespace WHERE nspname='metro3d'");
          if (tables.rowCount) throw new Error('Restore requires a new database without the metro3d schema');
          const result = spawnSync(executable, ['--dbname', env.PGDATABASE!, '--no-owner', '--no-acl', '--single-transaction', '--exit-on-error', file],
            { env, stdio: ['ignore', 'pipe', 'pipe'], timeout: 120000 });
          if (result.error || result.status !== 0) throw new Error('Restore failed');
          console.log('Restore complete; runtime grants must be applied separately');
        }
      }
    }
  } finally { await pool.end(); }
}

main().catch(() => { console.error('Database operation failed; connection details and data are withheld'); process.exitCode = 1; });
