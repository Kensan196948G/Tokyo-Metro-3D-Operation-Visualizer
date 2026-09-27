import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { Pool } from 'pg';

async function main(): Promise<void> {
  const [name, ...extra] = process.argv.slice(2);
  if (!/^metro3d(?:_[a-z0-9_]{1,32})?$/.test(name ?? '') || extra.length) throw new Error('Invalid dedicated database name');
  const owner = `${name}_owner`;
  const runtime = `${name}_app`;
  const directory = path.join(os.homedir(), '.config/metro3d');
  const file = path.join(directory, `${name}.env`);
  if (fs.existsSync(file)) throw new Error('Connection file already exists');
  const pool = new Pool({ host: '/var/run/postgresql', database: 'postgres', user: os.userInfo().username, max: 1 });
  pool.on('error', () => {});
  const client = await pool.connect();
  try {
    const found = await client.query(`SELECT 1 FROM pg_database WHERE datname=$1
      UNION ALL SELECT 1 FROM pg_roles WHERE rolname IN ($2,$3)`, [name, owner, runtime]);
    if (found.rowCount) throw new Error('Dedicated database or role already exists');
    await client.query("SET log_statement = 'none'");
    await client.query("SET log_min_error_statement = 'panic'");
    await client.query("SET log_min_duration_statement = -1");
    await client.query("SET log_min_duration_sample = -1");
    await client.query("SET log_duration = off");
    const auditing = await client.query("SELECT current_setting('shared_preload_libraries') AS extensions");
    if (auditing.rows[0].extensions) throw new Error('Review server audit extensions before credential provisioning');
    await client.query("SET password_encryption = 'scram-sha-256'");
    const password = randomBytes(36).toString('base64url');
    await client.query('BEGIN');
    await client.query(`CREATE ROLE "${owner}" NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION`);
    await client.query(`CREATE ROLE "${runtime}" LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION PASSWORD '${password}'`);
    await client.query('COMMIT');
    await client.query(`CREATE DATABASE "${name}" OWNER "${owner}"`);
    await client.query(`REVOKE ALL ON DATABASE "${name}" FROM PUBLIC`);
    await client.query(`GRANT CONNECT ON DATABASE "${name}" TO "${runtime}"`);
    fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
    const connection = `postgresql://${runtime}:${password}@127.0.0.1:5432/${name}`;
    fs.writeFileSync(file, `CACHE_BACKEND=postgres\nDATABASE_URL=${connection}\n`, { flag: 'wx', mode: 0o600 });
    console.log(JSON.stringify({ database: name, ownerRole: owner, runtimeRole: runtime,
      connectionFile: file, next: 'Run migration as owner and grant schema usage plus snapshot SELECT/INSERT/UPDATE' }));
  } catch {
    await client.query('ROLLBACK').catch(() => {});
    throw new Error('Provision failed; inspect dedicated object existence before retrying');
  } finally { client.release(); await pool.end(); }
}

main().catch(() => { console.error('Local database provisioning failed; credentials withheld'); process.exitCode = 1; });
