import { afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { zipSync, strToU8 } from 'fflate';
import { CacheStore, cacheStore } from './cacheStore.js';
import { fetchAndNormalizeGtfs, normalizeGtfsZip } from './gtfsFetcher.js';
import { fetchAndDecodeRt } from './gtfsRtFetcher.js';
import { requestFeed } from './feedRequest.js';
import { StorageError } from './storageError.js';

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('feed request safety', () => {
  it('aborts a stalled upstream request', async () => {
    vi.stubGlobal('fetch', vi.fn((_url: string, options: RequestInit) => new Promise((_resolve, reject) => {
      options.signal!.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
    })));
    await expect(requestFeed('https://example.test/feed', '', 10, 1024)).rejects.toThrow('timed out');
  });

  it('limits streamed data without trusting Content-Length', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('12345')));
    await expect(requestFeed('https://example.test/feed', '', 1000, 4)).rejects.toThrow('size limit');
  });

  it('propagates metadata storage failures to the API error handler', async () => {
    vi.spyOn(cacheStore, 'write').mockRejectedValue(new StorageError());
    await expect(fetchAndDecodeRt('', '')).rejects.toBeInstanceOf(StorageError);
  });
  it.each([fetchAndNormalizeGtfs, fetchAndDecodeRt])('bounds requests and hides upstream exception credentials', async (fetchFeed) => {
    vi.spyOn(cacheStore, 'write').mockResolvedValue(undefined);
    const request = vi.fn().mockRejectedValue(new Error('failed https://example.test/?acl:consumerKey=synthetic-secret'));
    vi.stubGlobal('fetch', request);
    const result = await fetchFeed('https://example.test/feed', 'synthetic-secret');
    expect(result.error).not.toContain('synthetic-secret');
    expect(request.mock.calls[0][1]?.signal).toBeInstanceOf(AbortSignal);
  });

  it.each([fetchAndNormalizeGtfs, fetchAndDecodeRt])('replaces existing URL credentials and removes fragments', async (fetchFeed) => {
    vi.spyOn(cacheStore, 'write').mockResolvedValue(undefined);
    const request = vi.fn().mockResolvedValue(new Response('', { status: 503 }));
    vi.stubGlobal('fetch', request);
    await fetchFeed('https://example.test/feed?acl:consumerKey=old-key#fragment', 'new-key');
    const url = new URL(request.mock.calls[0][0]);
    expect(url.searchParams.getAll('acl:consumerKey')).toEqual(['new-key']);
    expect(url.hash).toBe('');
    expect(request.mock.calls[0][1]?.redirect).toBe('error');
  });
});

describe('cache persistence', () => {
  it('rejects excessive archive expansion before allocating the declared size', async () => {
    const bytes = zipSync({ 'stops.txt': strToU8('stop_id\nG01') });
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    for (let offset = 0; offset + 28 <= bytes.length; offset++) {
      if (view.getUint32(offset, true) === 0x02014b50) {
        view.setUint32(offset + 24, 201 * 1024 * 1024, true);
        break;
      }
    }
    const result = await normalizeGtfsZip(bytes, new Date().toISOString());
    expect(result.ok).toBe(false);
    expect(result.error).toContain('extraction limit');
  });

  it('propagates static storage failures instead of reporting successful refreshes', async () => {
    vi.spyOn(cacheStore, 'writeBatch').mockRejectedValue(new StorageError());
    const bytes = zipSync({ 'stops.txt': strToU8('stop_id,stop_name,stop_lat,stop_lon\nginza.shibuya,Shibuya,35.6581,139.7016') });
    await expect(normalizeGtfsZip(bytes, new Date().toISOString())).rejects.toBeInstanceOf(StorageError);
  });

  it('reports write failures and preserves the last complete cache', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'metro-cache-safety-'));
    try {
      const cache = new CacheStore(dir);
      cache.write('trains', ['previous']);
      vi.spyOn(fs, 'renameSync').mockImplementation(() => { throw new Error('disk failure'); });
      expect(() => cache.write('trains', ['next'])).toThrow();
      expect(cache.read('trains')).toEqual(['previous']);
      expect(fs.readdirSync(dir)).toEqual(['trains.json']);
    } finally {
      vi.restoreAllMocks();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
