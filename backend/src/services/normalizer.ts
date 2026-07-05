import { MetroTrain, MetroAlert } from '../domain/trainModel.js';
import { MetroStation, MOCK_STATIONS, JR_MOCK_STATIONS, latLonToXZ } from '../domain/stationModel.js';
import { ALL_ROUTES, MetroRoute, Operator } from '../domain/routeModel.js';
import { isValidLatLon } from '../utils/geo.js';
import { logger } from '../utils/logger.js';
import { cacheStore } from './cacheStore.js';

export type NormalizedData = {
  routes: MetroRoute[];
  stations: MetroStation[];
  trains: MetroTrain[];
  alerts: MetroAlert[];
  normalizedAt: string;
};

const TRAINS_PER_ROUTE = 3;
// Wall-clock seconds for a mock train to traverse its whole line one way.
const MOCK_TRAVERSE_SECONDS = 240;

/**
 * Time-parameterized mock trains: each train progresses along its line's
 * station polyline as a deterministic function of wall-clock time, so
 * consecutive API polls see continuous forward motion (the frontend
 * interpolates between polls for frame-smooth movement). Ping-pong at the
 * ends simulates the return trip.
 */
export function generateMockTrains(nowMs: number = Date.now(), operator?: Operator): MetroTrain[] {
  const trains: MetroTrain[] = [];
  const nowIso = new Date(nowMs).toISOString();

  const routes = operator ? ALL_ROUTES.filter((r) => r.operator === operator) : ALL_ROUTES;
  routes.forEach((route, routeIndex) => {
    // Primary-line stations only, in station-number order = the line path.
    const routeStations = MOCK_STATIONS.filter((s) => s.routeIds[0] === route.routeId).sort(
      (a, b) => a.stationId.localeCompare(b.stationId)
    );
    if (routeStations.length < 2) return;
    const segments = routeStations.length - 1;

    for (let i = 0; i < TRAINS_PER_ROUTE; i++) {
      // Phase-offset trains along the line; ping-pong for direction.
      const phase =
        (nowMs / 1000 / MOCK_TRAVERSE_SECONDS + i / TRAINS_PER_ROUTE + routeIndex * 0.11) % 2;
      const progress = phase <= 1 ? phase : 2 - phase; // 0..1..0
      const scaled = progress * segments;
      const seg = Math.min(Math.floor(scaled), segments - 1);
      const fraction = scaled - seg;

      const from = routeStations[seg];
      const to = routeStations[seg + 1];
      const lat = from.lat + (to.lat - from.lat) * fraction;
      const lon = from.lon + (to.lon - from.lon) * fraction;
      if (!isValidLatLon(lat, lon)) continue;
      const { x, z } = latLonToXZ(lat, lon);

      // Deterministic status: one delayed train per three, stable across polls.
      const delayed = i === 1;
      trains.push({
        trainId: `${route.routeId}-mock-${i}`,
        routeId: route.routeId,
        directionId: phase <= 1 ? '0' : '1',
        status: delayed ? 'delay' : 'normal',
        delaySeconds: delayed ? 180 : 0,
        lat,
        lon,
        x,
        y: route.layerHeight,
        z,
        currentStationId: from.stationId,
        nextStationId: to.stationId,
        positionSource: 'mock',
        updatedAt: nowIso,
      });
    }
  });

  return trains;
}

export function generateMockAlerts(): MetroAlert[] {
  return [
    {
      alertId: 'alert-001',
      routeIds: ['G'],
      severity: 'info',
      title: '銀座線：運行情報',
      description: '現在、通常通り運行しています。（デモ表示）',
    },
  ];
}

/**
 * Stations for the API: metro comes from the GTFS cache when available
 * (normalizeRouteId guarantees the cache is metro-only), JR is always the
 * mock set — its realtime feed is challenge-licensed and not wired up.
 * `source` describes the METRO portion.
 */
export function loadStations(): { stations: MetroStation[]; source: 'gtfs' | 'mock' } {
  const cached = cacheStore.read<MetroStation[]>('stations');
  if (cached && cached.length > 0) {
    return { stations: [...cached, ...JR_MOCK_STATIONS], source: 'gtfs' };
  }
  logger.warn('loadStations: cache empty, using mock stations');
  return { stations: MOCK_STATIONS, source: 'mock' };
}
