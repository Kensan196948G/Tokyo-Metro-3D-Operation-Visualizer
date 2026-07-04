import { describe, it, expect } from 'vitest';
import { latLonToXZ, isValidLatLon, interpolatePosition } from './geo.js';

describe('latLonToXZ', () => {
  it('converts Tokyo station coordinates', () => {
    const { x, z } = latLonToXZ(35.6812, 139.7671);
    expect(typeof x).toBe('number');
    expect(typeof z).toBe('number');
    // Tokyo station is east of center, so x should be positive
    expect(x).toBeGreaterThan(0);
  });

  it('center coordinates map to origin', () => {
    const { x, z } = latLonToXZ(35.6762, 139.6503);
    expect(x).toBeCloseTo(0, 1);
    expect(z).toBeCloseTo(0, 1);
  });
});

describe('isValidLatLon', () => {
  it('accepts Tokyo area coordinates', () => {
    expect(isValidLatLon(35.6762, 139.6503)).toBe(true);
    expect(isValidLatLon(35.6581, 139.7016)).toBe(true);
  });

  it('rejects out-of-range coordinates', () => {
    expect(isValidLatLon(0, 0)).toBe(false);
    expect(isValidLatLon(34.0, 135.0)).toBe(false);
  });
});

describe('interpolatePosition', () => {
  it('interpolates midpoint correctly', () => {
    const result = interpolatePosition(35.0, 139.0, 36.0, 140.0, 0.5);
    expect(result.lat).toBeCloseTo(35.5, 5);
    expect(result.lon).toBeCloseTo(139.5, 5);
  });
});
