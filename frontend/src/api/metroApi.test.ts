import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock fetch globally
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

beforeEach(() => {
  mockFetch.mockReset();
});

describe('fetchApi (smoke test)', () => {
  it('returns null on fetch error', async () => {
    mockFetch.mockRejectedValueOnce(new Error('network error'));
    const { fetchRoutes } = await import('./metroApi.js');
    const result = await fetchRoutes();
    expect(result).toEqual([]);
  });

  it('returns null on non-ok response', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
    });
    const { fetchStations } = await import('./metroApi.js');
    const result = await fetchStations();
    expect(result).toEqual([]);
  });
});
