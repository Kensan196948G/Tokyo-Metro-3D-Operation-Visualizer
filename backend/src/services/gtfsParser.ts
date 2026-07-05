/**
 * GTFS static feed parser.
 * Converts raw GTFS text files (stops.txt / routes.txt / shapes.txt / trips.txt)
 * into internal domain models. Route IDs are normalized to single-letter
 * Tokyo Metro line codes (G, M, H, T, C, Y, Z, N, F) where possible.
 */
import { parseCsv } from '../utils/csv.js';
import { latLonToXZ, isValidLatLon } from '../utils/geo.js';
import { ALL_ROUTES } from '../domain/routeModel.js';
import type { MetroStation } from '../domain/stationModel.js';
import { logger } from '../utils/logger.js';

export type GtfsFiles = {
  stops?: string;
  routes?: string;
  shapes?: string;
  trips?: string;
};

export type RouteShapePoint = {
  lat: number;
  lon: number;
  x: number;
  y: number;
  z: number;
  sequence: number;
};

export type MetroRouteShape = {
  routeId: string;
  points: RouteShapePoint[];
};

// Maps GTFS route identifiers (various ODPT naming styles) to line codes.
// Intentionally METRO-ONLY: JR East GTFS/GTFS-RT on ODPT is challenge-2026
// licensed, so its data must never enter the static cache. Keeping JR codes
// out of this table (and out of normalizeRouteId) is that firewall.
const LINE_NAME_TO_CODE: Array<[RegExp, string]> = [
  [/ginza/i, 'G'],
  [/marunouchi/i, 'M'],
  [/hibiya/i, 'H'],
  [/tozai/i, 'T'],
  [/chiyoda/i, 'C'],
  [/yurakucho/i, 'Y'],
  [/hanzomon/i, 'Z'],
  [/namboku/i, 'N'],
  [/fukutoshin/i, 'F'],
];

export function normalizeRouteId(gtfsRouteId: string, longName = ''): string | null {
  const haystack = `${gtfsRouteId} ${longName}`;
  for (const [pattern, code] of LINE_NAME_TO_CODE) {
    if (pattern.test(haystack)) return code;
  }
  // Already a bare line code
  const bare = gtfsRouteId.trim().toUpperCase();
  if (/^[GMHTCYZNF]$/.test(bare)) return bare;
  return null;
}

const layerHeightByRoute = new Map(ALL_ROUTES.map((r) => [r.routeId, r.layerHeight]));

export function parseStops(
  stopsText: string,
  routeIdByStopId: Map<string, string[]> = new Map()
): MetroStation[] {
  const records = parseCsv(stopsText);
  const stations: MetroStation[] = [];
  let skipped = 0;

  for (const rec of records) {
    const stopId = rec['stop_id'];
    const name = rec['stop_name'];
    const lat = Number(rec['stop_lat']);
    const lon = Number(rec['stop_lon']);

    if (!stopId || !name || Number.isNaN(lat) || Number.isNaN(lon)) {
      skipped++;
      continue;
    }
    if (!isValidLatLon(lat, lon)) {
      skipped++;
      continue;
    }
    // GTFS location_type: 0/empty = stop, 1 = parent station. Keep both stop
    // granularities out — prefer parent stations when marked, otherwise stops.
    const locationType = rec['location_type'] ?? '';
    if (locationType !== '' && locationType !== '0' && locationType !== '1') {
      skipped++;
      continue;
    }

    const routeIds = routeIdByStopId.get(stopId) ?? inferRouteIdsFromStopId(stopId);
    const primaryRoute = routeIds[0];
    const y = primaryRoute ? (layerHeightByRoute.get(primaryRoute) ?? 0) : 0;
    const { x, z } = latLonToXZ(lat, lon);

    stations.push({ stationId: stopId, name, lat, lon, x, y, z, routeIds });
  }

  if (skipped > 0) {
    logger.warn({ skipped, total: records.length }, 'parseStops: skipped invalid stops');
  }
  return stations;
}

// ODPT stop IDs often embed the line code, e.g. "odpt.Station:TokyoMetro.Ginza.Shibuya".
function inferRouteIdsFromStopId(stopId: string): string[] {
  const code = normalizeRouteId(stopId);
  return code ? [code] : [];
}

export function parseShapes(
  shapesText: string,
  routeIdByShapeId: Map<string, string> = new Map()
): MetroRouteShape[] {
  const records = parseCsv(shapesText);
  const byShapeId = new Map<string, RouteShapePoint[]>();
  let skipped = 0;

  for (const rec of records) {
    const shapeId = rec['shape_id'];
    const lat = Number(rec['shape_pt_lat']);
    const lon = Number(rec['shape_pt_lon']);
    const sequence = Number(rec['shape_pt_sequence']);

    if (!shapeId || Number.isNaN(lat) || Number.isNaN(lon) || Number.isNaN(sequence)) {
      skipped++;
      continue;
    }
    if (!isValidLatLon(lat, lon)) {
      skipped++;
      continue;
    }

    const routeId = routeIdByShapeId.get(shapeId) ?? normalizeRouteId(shapeId) ?? '';
    const y = routeId ? (layerHeightByRoute.get(routeId) ?? 0) : 0;
    const { x, z } = latLonToXZ(lat, lon);

    const points = byShapeId.get(shapeId) ?? [];
    points.push({ lat, lon, x, y, z, sequence });
    byShapeId.set(shapeId, points);
  }

  if (skipped > 0) {
    logger.warn({ skipped, total: records.length }, 'parseShapes: skipped invalid points');
  }

  // One representative shape per route: pick the shape with the most points
  // (GTFS ships many trip variants; the longest usually covers the full line).
  const bestByRoute = new Map<string, { shapeId: string; points: RouteShapePoint[] }>();
  for (const [shapeId, points] of byShapeId) {
    const routeId = routeIdByShapeId.get(shapeId) ?? normalizeRouteId(shapeId);
    if (!routeId) continue;
    const current = bestByRoute.get(routeId);
    if (!current || points.length > current.points.length) {
      bestByRoute.set(routeId, { shapeId, points });
    }
  }

  const shapes: MetroRouteShape[] = [];
  for (const [routeId, { points }] of bestByRoute) {
    points.sort((a, b) => a.sequence - b.sequence);
    shapes.push({ routeId, points });
  }
  return shapes;
}

/** Builds shape_id -> line code map from trips.txt (route_id + shape_id columns). */
export function buildShapeRouteMap(tripsText: string, routesText?: string): Map<string, string> {
  const longNameByRouteId = new Map<string, string>();
  if (routesText) {
    for (const rec of parseCsv(routesText)) {
      const id = rec['route_id'];
      if (id) longNameByRouteId.set(id, rec['route_long_name'] ?? '');
    }
  }

  const map = new Map<string, string>();
  for (const rec of parseCsv(tripsText)) {
    const shapeId = rec['shape_id'];
    const gtfsRouteId = rec['route_id'];
    if (!shapeId || !gtfsRouteId) continue;
    if (map.has(shapeId)) continue;
    const code = normalizeRouteId(gtfsRouteId, longNameByRouteId.get(gtfsRouteId) ?? '');
    if (code) map.set(shapeId, code);
  }
  return map;
}

/** Builds stop_id -> line codes map from routes/trips/stop_times relationships. */
export function buildStopRouteMap(
  tripsText: string,
  stopTimesText: string,
  routesText?: string
): Map<string, string[]> {
  const longNameByRouteId = new Map<string, string>();
  if (routesText) {
    for (const rec of parseCsv(routesText)) {
      const id = rec['route_id'];
      if (id) longNameByRouteId.set(id, rec['route_long_name'] ?? '');
    }
  }

  const routeByTripId = new Map<string, string>();
  for (const rec of parseCsv(tripsText)) {
    const tripId = rec['trip_id'];
    const gtfsRouteId = rec['route_id'];
    if (!tripId || !gtfsRouteId) continue;
    const code = normalizeRouteId(gtfsRouteId, longNameByRouteId.get(gtfsRouteId) ?? '');
    if (code) routeByTripId.set(tripId, code);
  }

  const codesByStopId = new Map<string, Set<string>>();
  for (const rec of parseCsv(stopTimesText)) {
    const tripId = rec['trip_id'];
    const stopId = rec['stop_id'];
    if (!tripId || !stopId) continue;
    const code = routeByTripId.get(tripId);
    if (!code) continue;
    const set = codesByStopId.get(stopId) ?? new Set<string>();
    set.add(code);
    codesByStopId.set(stopId, set);
  }

  const result = new Map<string, string[]>();
  for (const [stopId, codes] of codesByStopId) {
    result.set(stopId, Array.from(codes).sort());
  }
  return result;
}
