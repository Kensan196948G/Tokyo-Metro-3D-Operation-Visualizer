export const CENTER_LAT = 35.6762;
export const CENTER_LON = 139.6503;
// Scale factor: approximate meters per degree, divided by 100 for scene units
const SCALE_LAT = 111320 / 100;
const SCALE_LON = 111320 * Math.cos((CENTER_LAT * Math.PI) / 180) / 100;

export function latLonToXZ(lat: number, lon: number): { x: number; z: number } {
  const x = (lon - CENTER_LON) * SCALE_LON;
  const z = -(lat - CENTER_LAT) * SCALE_LAT;
  return { x, z };
}

export function isValidLatLon(lat: number, lon: number): boolean {
  // Tokyo metro area roughly: lat 35.5-35.9, lon 139.4-139.9
  return lat >= 35.4 && lat <= 36.0 && lon >= 139.3 && lon <= 140.1;
}

export function interpolatePosition(
  fromLat: number,
  fromLon: number,
  toLat: number,
  toLon: number,
  fraction: number
): { lat: number; lon: number } {
  return {
    lat: fromLat + (toLat - fromLat) * fraction,
    lon: fromLon + (toLon - fromLon) * fraction,
  };
}
