import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import type { FastifyInstance } from 'fastify';
import { buildApp } from './app.js';
import { cacheStore } from './services/cacheStore.js';

let app: FastifyInstance;

beforeAll(async () => {
  // Other test files (gtfsParser) write fixture data into the shared test
  // CACHE_DIR; wipe it so these tests exercise the mock fallback path.
  const cacheDir = process.env.CACHE_DIR;
  if (cacheDir && fs.existsSync(cacheDir)) {
    fs.rmSync(cacheDir, { recursive: true, force: true });
    fs.mkdirSync(cacheDir, { recursive: true });
  }
  app = await buildApp({ logger: false });
});

afterAll(async () => {
  await app.close();
});

describe('GET /api/health', () => {
  it('reports healthy with the ApiResponse envelope', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/health' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.ok).toBe(true);
    expect(body.data.status).toBe('healthy');
    expect(body.meta.generatedAt).toBeTruthy();
  });
});

describe('GET /api/routes', () => {
  it('returns 9 metro + 5 JR lines with distinct layer heights', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/routes' });
    const body = res.json();
    expect(body.ok).toBe(true);
    expect(body.data).toHaveLength(14);
    const codes = body.data.map((r: { routeId: string }) => r.routeId).sort();
    expect(codes).toEqual([
      'C', 'F', 'G', 'H', 'JA', 'JB', 'JC', 'JK', 'JY', 'M', 'N', 'T', 'Y', 'Z',
    ]);
    const heights = new Set(body.data.map((r: { layerHeight: number }) => r.layerHeight));
    expect(heights.size).toBe(14); // all distinct layers

    // Vertical convention: subway below ground, JR surface at/above ground.
    for (const r of body.data) {
      expect(['TokyoMetro', 'JR-East']).toContain(r.operator);
      if (r.operator === 'TokyoMetro') expect(r.layerHeight).toBeLessThan(0);
      else expect(r.layerHeight).toBeGreaterThan(0);
    }
  });
});

describe('GET /api/stations', () => {
  it('serves stations for every line (mock fallback)', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/stations' });
    const body = res.json();
    expect(body.ok).toBe(true);
    expect(body.data.length).toBeGreaterThanOrEqual(250);
    const linesWithStations = new Set(
      body.data.map((s: { routeIds: string[] }) => s.routeIds[0])
    );
    for (const code of ['G', 'M', 'H', 'T', 'C', 'Y', 'Z', 'N', 'F', 'JY', 'JC', 'JK', 'JB', 'JA']) {
      expect(linesWithStations.has(code)).toBe(true);
    }
  });

  it('every station carries scene coordinates', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/stations' });
    const body = res.json();
    for (const s of body.data) {
      expect(typeof s.x).toBe('number');
      expect(typeof s.y).toBe('number');
      expect(typeof s.z).toBe('number');
      expect(Number.isFinite(s.x)).toBe(true);
      expect(Number.isFinite(s.z)).toBe(true);
    }
  });
});

describe('GET /api/realtime/trains', () => {
  // Runs FIRST in this block: the route module reads the disk cache once per
  // TTL, so the fixture must be on disk before the first request lands.
  it('merges real metro trains with JR mocks (cache present)', async () => {
    const fakeReal = [
      {
        trainId: 'real-G-1',
        routeId: 'G',
        status: 'normal',
        x: 10,
        y: -4,
        z: 5,
        positionSource: 'gtfs-rt',
        updatedAt: new Date().toISOString(),
      },
    ];
    cacheStore.write('trains', fakeReal);
    const res = await app.inject({ method: 'GET', url: '/api/realtime/trains' });
    const body = res.json();
    expect(body.ok).toBe(true);
    const ids = body.data.map((t: { trainId: string }) => t.trainId);
    // Real metro feed is passed through untouched...
    expect(ids).toContain('real-G-1');
    // ...and metro mocks are NOT generated alongside it...
    expect(ids.some((id: string) => id.startsWith('G-mock'))).toBe(false);
    // ...while JR (challenge-licensed feed, never wired) stays mocked.
    expect(body.data.some((t: { routeId?: string }) => t.routeId === 'JY')).toBe(true);
    cacheStore.write('trains', []); // cleanup for the mock-path test below
  });

  it('returns positioned trains', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/realtime/trains' });
    const body = res.json();
    expect(body.ok).toBe(true);
    expect(body.data.length).toBeGreaterThan(0);
    for (const t of body.data) {
      expect(t.trainId).toBeTruthy();
      expect(['normal', 'delay', 'suspended', 'unknown']).toContain(t.status);
      expect(['gtfs-rt', 'interpolated', 'station-based', 'mock']).toContain(t.positionSource);
    }
  });
});

describe('GET /api/realtime/alerts', () => {
  it('returns the alert envelope', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/realtime/alerts' });
    const body = res.json();
    expect(body.ok).toBe(true);
    expect(Array.isArray(body.data)).toBe(true);
  });
});

describe('GET /api/status', () => {
  it('exposes static and realtime freshness', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/status' });
    const body = res.json();
    expect(body.ok).toBe(true);
    expect(body.data).toHaveProperty('gtfsStaticFetchedAt');
    expect(body.data).toHaveProperty('gtfsRtFetchSuccess');
    expect(body.data).toHaveProperty('consecutiveFailures');
    expect(['gtfs', 'mock']).toContain(body.data.dataSource);
  });
});

describe('POST /api/admin/refetch', () => {
  it('is reachable from localhost injection and reports fetch failure without token', async () => {
    // inject() sets remoteAddress to 127.0.0.1, passing the local-only gate;
    // with no ODPT URLs configured both fetches fail -> 502 envelope.
    const res = await app.inject({ method: 'POST', url: '/api/admin/refetch' });
    expect([200, 502]).toContain(res.statusCode);
    const body = res.json();
    expect(body).toHaveProperty('ok');
    expect(body.data).toHaveProperty('static');
    expect(body.data).toHaveProperty('realtime');
  });
});
