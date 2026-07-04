import { isValidLatLon } from './geo.js';

export type ValidationResult = {
  valid: boolean;
  errors: string[];
};

export function validateStation(station: {
  stationId?: unknown;
  name?: unknown;
  lat?: unknown;
  lon?: unknown;
}): ValidationResult {
  const errors: string[] = [];

  if (!station.stationId || typeof station.stationId !== 'string') {
    errors.push('stationId missing or invalid');
  }
  if (!station.name || typeof station.name !== 'string') {
    errors.push('name missing or invalid');
  }
  if (typeof station.lat !== 'number' || typeof station.lon !== 'number') {
    errors.push('lat/lon missing or not numbers');
  } else if (!isValidLatLon(station.lat, station.lon)) {
    errors.push(`lat/lon out of Tokyo area: ${station.lat}, ${station.lon}`);
  }

  return { valid: errors.length === 0, errors };
}

export function maskApiKey(str: string): string {
  if (str.length <= 8) return '***';
  return str.substring(0, 4) + '***' + str.substring(str.length - 4);
}
