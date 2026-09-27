import { afterEach, describe, expect, it, vi } from 'vitest';
import { Client } from 'pg';
import { libpqEnvironment } from './libpq.js';

afterEach(() => { vi.unstubAllEnvs(); });

describe('libpq connection environment', () => {
  it('separates URL components instead of passing a URI as a literal database name', () => {
    const env = libpqEnvironment('postgresql://runtime:encoded%40value@127.0.0.1:5433/metro3d?sslmode=require');
    expect(env.PGDATABASE).toBe('metro3d');
    expect(env.PGUSER).toBe('runtime');
    expect(env.PGPASSWORD).toBe('encoded@value');
    expect(env.PGHOST).toBe('127.0.0.1');
    expect(env.PGPORT).toBe('5433');
    expect(env.PGSSLMODE).toBe('require');
  });
  it('supports the local administration socket without credentials on argv', () => {
    const env = libpqEnvironment('postgresql:///metro3d?host=/var/run/postgresql&user=local');
    expect(env.PGHOST).toBe('/var/run/postgresql');
    expect(env.PGUSER).toBe('local');
    expect(env.PGPASSWORD).toBe('');
    expect(() => libpqEnvironment('https://example.invalid')).toThrow();
    expect(() => libpqEnvironment('postgresql:///metro3d?dbname=other')).toThrow();
    expect(() => libpqEnvironment('postgresql://local@127.0.0.1/metro3d?host=127.0.0.2&host=127.0.0.1')).toThrow();
    expect(() => libpqEnvironment('postgresql://local@127.0.0.1/metro3d?user=')).toThrow();
    expect(() => libpqEnvironment('postgresql:///metro3d')).toThrow();
  });
  it.each(['PGPORT', 'PGHOSTADDR', 'PGSERVICE', 'PGOPTIONS', 'PGPASSWORD', 'PGSSLMODE'])
    ('refuses inherited %s rather than connecting backup and guard to different servers', (key) => {
      vi.stubEnv(key, 'synthetic-setting');
      expect(() => libpqEnvironment('postgresql://runtime@127.0.0.1/metro3d')).toThrow('ambient');
    });
  it('allows a backup binary directory without treating it as a connection default', () => {
    vi.stubEnv('PG_BIN_DIR', '/usr/lib/postgresql/16/bin');
    expect(libpqEnvironment('postgresql://runtime@127.0.0.1/metro3d').PGDATABASE).toBe('metro3d');
  });
  it('uses the same database decoding as the pg guard', () => {
    const connection = 'postgresql://runtime@127.0.0.1/metro3d_verify_%40';
    const client = new Client({ connectionString: connection });
    expect(libpqEnvironment(connection).PGDATABASE).toBe(client.database);
  });
  it('rejects database names that pg_restore would expand as a connection string', () => {
    expect(() => libpqEnvironment('postgresql://runtime@127.0.0.1/host=other')).toThrow('connection string');
    expect(() => libpqEnvironment('postgresql://runtime@127.0.0.1/postgresql://other/db')).toThrow('connection string');
  });
});
