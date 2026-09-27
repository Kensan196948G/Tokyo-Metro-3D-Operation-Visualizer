import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildApp } from './app.js';
import { cacheStore } from './services/cacheStore.js';
import { StorageError } from './services/storageError.js';
import { MOCK_STATIONS } from './domain/stationModel.js';

afterEach(() => { vi.restoreAllMocks(); });

describe('storage readiness and API failures', () => {
  it.each(['/api/stations', '/api/realtime/trains', '/api/realtime/alerts', '/api/status'])
    ('returns safe 503 instead of mock success when %s cannot read storage', async (url) => {
      vi.spyOn(cacheStore, 'readMany').mockRejectedValue(new StorageError());
      const app = await buildApp({ logger: false });
      try {
        const response = await app.inject(url);
        expect(response.statusCode).toBe(503);
        expect(response.json()).toMatchObject({
          ok: false, error: { code: 'STORAGE_UNAVAILABLE', message: 'Storage temporarily unavailable' },
          meta: { stale: true },
        });
        expect(response.json()).not.toHaveProperty('data');
      } finally { await app.close(); }
    });

  it('reports unhealthy storage and recovers readiness without restarting', async () => {
    const health = vi.spyOn(cacheStore, 'health').mockRejectedValueOnce(new StorageError())
      .mockResolvedValueOnce(undefined);
    const app = await buildApp({ logger: false });
    try {
      expect((await app.inject('/api/health')).statusCode).toBe(503);
      expect((await app.inject('/api/health')).statusCode).toBe(200);
      expect(health).toHaveBeenCalledTimes(2);
    } finally { await app.close(); }
  });

  it('returns storage failures from shape reads and admin writes as 503', async () => {
    vi.spyOn(cacheStore, 'read').mockRejectedValue(new StorageError());
    const app = await buildApp({ logger: false });
    try {
      expect((await app.inject('/api/route-shapes')).statusCode).toBe(503);
      expect((await app.inject({ method: 'POST', url: '/api/admin/refetch' })).statusCode).toBe(503);
    } finally { await app.close(); }
  });

  it('does not hide a database outage behind a prior healthy train response', async () => {
    const read = vi.spyOn(cacheStore, 'readMany')
      .mockResolvedValueOnce({ trains: [], 'rt-meta': { success: true, fetchedAt: new Date().toISOString() } })
      .mockRejectedValueOnce(new StorageError())
      .mockResolvedValueOnce({ trains: [], 'rt-meta': { success: true, fetchedAt: new Date().toISOString() } });
    const app = await buildApp({ logger: false });
    try {
      expect((await app.inject('/api/realtime/trains')).statusCode).toBe(200);
      expect((await app.inject('/api/realtime/trains')).statusCode).toBe(503);
      expect((await app.inject('/api/realtime/trains')).statusCode).toBe(200);
      expect(read).toHaveBeenCalledTimes(3);
    } finally { await app.close(); }
  });

  it('labels seeded stations and status as mock rather than real GTFS', async () => {
    vi.spyOn(cacheStore, 'readMany').mockResolvedValue({
      stations: MOCK_STATIONS.filter((station) => !station.routeIds[0].startsWith('J')),
      'gtfs-meta': { source: 'mock', fetchedAt: null, stationCount: 180, shapeCount: 0 },
      trains: null, 'rt-meta': null,
    });
    const app = await buildApp({ logger: false });
    try {
      const stations = (await app.inject('/api/stations')).json();
      expect(stations.meta.dataSource).toBe('mock');
      expect(stations.meta.stale).toBe(true);
      expect(new Set(stations.data.map((station: { stationId: string }) => station.stationId)).size)
        .toBe(stations.data.length);
      const status = (await app.inject('/api/status')).json();
      expect(status.data.dataSource).toBe('mock');
      expect(status.data.gtfsStaticFetchedAt).toBeNull();
    } finally { await app.close(); }
  });
});
