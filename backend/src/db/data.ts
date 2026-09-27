import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import { MOCK_STATIONS, JR_MOCK_STATIONS } from '../domain/stationModel.js';
import { SNAPSHOT_KEYS } from './migrations.js';

export async function seed(pool: Pool): Promise<boolean> {
  const jr = new Set(JR_MOCK_STATIONS.map(station => station.stationId));
  const stations = MOCK_STATIONS.filter(station => !jr.has(station.stationId));
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(674, 2)');
    const existing = await client.query('SELECT key FROM metro3d.snapshots LIMIT 1');
    if (existing.rowCount) { await client.query('COMMIT'); return false; }
    for (const [key, payload] of Object.entries({ stations, 'gtfs-meta': {
      source: 'mock', fetchedAt: null, stationCount: stations.length, shapeCount: 0,
    } })) {
      await client.query('INSERT INTO metro3d.snapshots(key, payload) VALUES ($1, $2::jsonb)',
        [key, JSON.stringify(payload)]);
    }
    await client.query('COMMIT');
    return true;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally { client.release(); }
}

export async function importJson(pool: Pool, directory: string): Promise<number> {
  const entries: Array<[string, unknown]> = [];
  for (const key of SNAPSHOT_KEYS) {
    const file = path.join(directory, `${key}.json`);
    if (!fs.existsSync(file)) continue;
    const stat = fs.lstatSync(file);
    if (!stat.isFile() || stat.size > 200 * 1024 * 1024) throw new Error('Invalid cache import file');
    entries.push([key, JSON.parse(fs.readFileSync(file, 'utf8'))]);
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(674, 2)');
    const existing = await client.query('SELECT key FROM metro3d.snapshots LIMIT 1');
    if (existing.rowCount) throw new Error('Import requires an empty snapshot table');
    for (const [key, payload] of entries) {
      await client.query('INSERT INTO metro3d.snapshots(key, payload) VALUES ($1, $2::jsonb)',
        [key, JSON.stringify(payload)]);
    }
    await client.query('COMMIT');
    return entries.length;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally { client.release(); }
}

export async function exportJson(pool: Pool, directory: string): Promise<number> {
  if (fs.existsSync(directory)) throw new Error('Export destination must not exist');
  const rows = await pool.query<{ key: string; payload: unknown }>(
    'SELECT key, payload FROM metro3d.snapshots ORDER BY key');
  const temporary = `${directory}.${randomUUID()}.tmp`;
  fs.mkdirSync(temporary, { recursive: true, mode: 0o700 });
  try {
    for (const row of rows.rows) {
      if (!(SNAPSHOT_KEYS as readonly string[]).includes(row.key)) throw new Error('Unexpected snapshot key');
      await fs.promises.writeFile(path.join(temporary, `${row.key}.json`), JSON.stringify(row.payload),
        { mode: 0o600, flag: 'wx' });
    }
    fs.renameSync(temporary, directory);
    return rows.rows.length;
  } catch (error) {
    fs.rmSync(temporary, { recursive: true, force: true });
    throw error;
  }
}
