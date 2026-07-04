import { MetroTrain, MetroAlert } from '../domain/trainModel.js';
import { MetroStation, MOCK_STATIONS, latLonToXZ } from '../domain/stationModel.js';
import { TOKYO_METRO_ROUTES } from '../domain/routeModel.js';
import { isValidLatLon } from '../utils/geo.js';
import { logger } from '../utils/logger.js';
import { cacheStore } from './cacheStore.js';

export type NormalizedData = {
  routes: typeof TOKYO_METRO_ROUTES;
  stations: MetroStation[];
  trains: MetroTrain[];
  alerts: MetroAlert[];
  normalizedAt: string;
};

export function generateMockTrains(): MetroTrain[] {
  const trains: MetroTrain[] = [];
  const now = new Date().toISOString();

  TOKYO_METRO_ROUTES.forEach((route) => {
    // Pick two stations on this route to place a train between them
    const routeStations = MOCK_STATIONS.filter((s) => s.routeIds.includes(route.routeId));
    if (routeStations.length < 2) return;

    for (let i = 0; i < Math.min(3, routeStations.length - 1); i++) {
      const from = routeStations[i];
      const to = routeStations[i + 1];
      const fraction = 0.3 + Math.random() * 0.4;
      const lat = from.lat + (to.lat - from.lat) * fraction;
      const lon = from.lon + (to.lon - from.lon) * fraction;
      if (!isValidLatLon(lat, lon)) continue;
      const { x, z } = latLonToXZ(lat, lon);
      const statuses: MetroTrain['status'][] = ['normal', 'normal', 'normal', 'delay'];
      const status = statuses[Math.floor(Math.random() * statuses.length)];
      trains.push({
        trainId: `${route.routeId}-mock-${i}`,
        routeId: route.routeId,
        status,
        delaySeconds: status === 'delay' ? Math.floor(Math.random() * 300) + 60 : 0,
        lat,
        lon,
        x,
        y: route.layerHeight,
        z,
        currentStationId: from.stationId,
        nextStationId: to.stationId,
        positionSource: 'mock',
        updatedAt: now,
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

/** GTFS-normalized stations from cache when available, otherwise mock data. */
export function loadStations(): { stations: MetroStation[]; source: 'gtfs' | 'mock' } {
  const cached = cacheStore.read<MetroStation[]>('stations');
  if (cached && cached.length > 0) {
    return { stations: cached, source: 'gtfs' };
  }
  logger.warn('loadStations: cache empty, using mock stations');
  return { stations: MOCK_STATIONS, source: 'mock' };
}
