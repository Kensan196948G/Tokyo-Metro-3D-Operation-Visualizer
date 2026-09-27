import { afterEach, describe, expect, it, vi } from 'vitest';
import Fastify from 'fastify';
import { realtimeRoute } from './realtime.js';
import { cacheStore } from '../services/cacheStore.js';

afterEach(() => { vi.restoreAllMocks(); });

describe('realtime cache semantics', () => {
  it('preserves a successful empty Metro feed without inventing trains', async () => {
    vi.spyOn(cacheStore, 'readMany').mockResolvedValue({
      trains: [], 'rt-meta': { success: true, fetchedAt: new Date().toISOString() },
    });
    const app = Fastify();
    await app.register(realtimeRoute);
    try {
      const res = await app.inject('/api/realtime/trains');
      expect(res.json().data.every((t: { routeId: string }) => t.routeId.startsWith('J'))).toBe(true);
      expect(res.json().meta.stale).toBe(false);
    } finally { await app.close(); }
  });

  it('marks cached alerts stale after upstream updates stop', async () => {
    vi.spyOn(cacheStore, 'readMany').mockResolvedValue({
      alerts: [], 'rt-meta': { success: true, fetchedAt: '2000-01-01T00:00:00.000Z' },
    });
    const app = Fastify();
    await app.register(realtimeRoute);
    try {
      const res = await app.inject('/api/realtime/alerts');
      expect(res.json().meta.stale).toBe(true);
    } finally { await app.close(); }
  });

  it('reports the retained real feed as stale when a refresh fails', async () => {
    vi.spyOn(cacheStore, 'readMany').mockResolvedValue({
      trains: [], 'rt-meta': { success: false, fetchedAt: 'invalid' },
    });
    const app = Fastify();
    await app.register(realtimeRoute);
    try {
      const res = await app.inject('/api/status');
      expect(res.json().data.realtimeSource).toBe('gtfs-rt');
      expect(res.json().data.stale).toBe(true);
    } finally { await app.close(); }
  });
});
