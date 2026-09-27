import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock fetch globally
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

beforeEach(() => {
  mockFetch.mockReset();
});

describe('fetchApi (smoke test)', () => {
  it.each([{}, [null], [{ trainId: 'invalid' }]])('rejects malformed train data: %j', async (data) => {
    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => ({ ok: true, data }) });
    const { fetchTrainSnapshot } = await import('./metroApi.js');
    expect(await fetchTrainSnapshot()).toBeNull();
  });
  it('returns null on fetch error', async () => {
    mockFetch.mockRejectedValueOnce(new Error('network error'));
    const { fetchRoutes } = await import('./metroApi.js');
    const result = await fetchRoutes();
    expect(result).toBeNull();
  });

  it('returns null on non-ok response', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
    });
    const { fetchStations } = await import('./metroApi.js');
    const result = await fetchStations();
    expect(result).toBeNull();
  });

  it('distinguishes a successful empty feed from a failed request', async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => ({ ok: true, data: [] }) });
    const { fetchTrains } = await import('./metroApi.js');
    expect(await fetchTrains()).toEqual([]);
  });
});
