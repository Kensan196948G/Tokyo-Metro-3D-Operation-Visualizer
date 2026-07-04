import { describe, it, expect } from 'vitest';
import { validateStation, maskApiKey } from './validation.js';

describe('validateStation', () => {
  it('accepts valid station', () => {
    const result = validateStation({
      stationId: 'G01',
      name: '渋谷',
      lat: 35.6581,
      lon: 139.7016,
    });
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('rejects missing stationId', () => {
    const result = validateStation({ name: '渋谷', lat: 35.6581, lon: 139.7016 });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('stationId'))).toBe(true);
  });

  it('rejects out-of-range coordinates', () => {
    const result = validateStation({ stationId: 'X01', name: 'Test', lat: 0, lon: 0 });
    expect(result.valid).toBe(false);
  });
});

describe('maskApiKey', () => {
  it('masks middle of key', () => {
    const masked = maskApiKey('abcdefghijklmnop');
    expect(masked).toContain('***');
    expect(masked.startsWith('abcd')).toBe(true);
    expect(masked.endsWith('mnop')).toBe(true);
  });

  it('handles short keys', () => {
    expect(maskApiKey('abc')).toBe('***');
  });
});
