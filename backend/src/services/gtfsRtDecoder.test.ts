import { describe, it, expect } from 'vitest';
import GtfsRealtimeBindings from 'gtfs-realtime-bindings';
import { decodeFeed, feedToTrains, feedToAlerts } from './gtfsRtDecoder.js';
import type { MetroStation } from '../domain/stationModel.js';

const { transit_realtime } = GtfsRealtimeBindings;

const STATIONS: MetroStation[] = [
  {
    stationId: 'ginza.shibuya',
    name: '渋谷',
    lat: 35.6581,
    lon: 139.7016,
    x: 46.4,
    y: 0,
    z: 20.1,
    routeIds: ['G'],
  },
  {
    stationId: 'ginza.omotesando',
    name: '表参道',
    lat: 35.6654,
    lon: 139.7121,
    x: 55.9,
    y: 0,
    z: 12.0,
    routeIds: ['G'],
  },
];

function encodeFeed(
  entities: GtfsRealtimeBindings.transit_realtime.IFeedEntity[]
): Uint8Array {
  const feed = transit_realtime.FeedMessage.create({
    header: { gtfsRealtimeVersion: '2.0', timestamp: 1780000000 },
    entity: entities,
  });
  return transit_realtime.FeedMessage.encode(feed).finish();
}

describe('decodeFeed', () => {
  it('round-trips an encoded feed', () => {
    const buf = encodeFeed([]);
    const feed = decodeFeed(buf);
    expect(feed.header.gtfsRealtimeVersion).toBe('2.0');
  });
});

describe('feedToTrains', () => {
  it('uses VehiclePosition coordinates when present', () => {
    const buf = encodeFeed([
      {
        id: 'e1',
        vehicle: {
          trip: { tripId: 'trip1', routeId: 'odpt.Railway:TokyoMetro.Ginza' },
          vehicle: { id: 'train-001' },
          position: { latitude: 35.67, longitude: 139.75 },
          timestamp: 1780000100,
        },
      },
    ]);
    const trains = feedToTrains(decodeFeed(buf), STATIONS);
    expect(trains).toHaveLength(1);
    expect(trains[0].trainId).toBe('train-001');
    expect(trains[0].routeId).toBe('G');
    expect(trains[0].positionSource).toBe('gtfs-rt');
    expect(trains[0].lat).toBeCloseTo(35.67, 4);
    expect(trains[0].y).toBe(0); // Ginza layer height
    expect(trains[0].status).toBe('normal');
  });

  it('falls back to station-based placement from TripUpdate stops', () => {
    const buf = encodeFeed([
      {
        id: 'e2',
        tripUpdate: {
          trip: { tripId: 'trip2', routeId: 'odpt.Railway:TokyoMetro.Ginza' },
          stopTimeUpdate: [
            { stopId: 'ginza.shibuya', arrival: { delay: 30 } },
            { stopId: 'ginza.omotesando' },
          ],
        },
      },
    ]);
    const trains = feedToTrains(decodeFeed(buf), STATIONS);
    expect(trains).toHaveLength(1);
    expect(trains[0].positionSource).toBe('station-based');
    expect(trains[0].currentStationId).toBe('ginza.shibuya');
    expect(trains[0].nextStationId).toBe('ginza.omotesando');
    expect(trains[0].x).toBeCloseTo(46.4, 1);
    expect(trains[0].status).toBe('normal'); // 30s < threshold
    expect(trains[0].delaySeconds).toBe(30);
  });

  it('marks trains delayed at >= 60s and suspended when canceled', () => {
    const buf = encodeFeed([
      {
        id: 'e3',
        tripUpdate: {
          trip: { tripId: 'trip3', routeId: 'TokyoMetro.Ginza' },
          stopTimeUpdate: [{ stopId: 'ginza.shibuya', arrival: { delay: 240 } }],
        },
      },
      {
        id: 'e4',
        tripUpdate: {
          trip: {
            tripId: 'trip4',
            routeId: 'TokyoMetro.Ginza',
            scheduleRelationship:
              transit_realtime.TripDescriptor.ScheduleRelationship.CANCELED,
          },
          stopTimeUpdate: [{ stopId: 'ginza.omotesando' }],
        },
      },
    ]);
    const trains = feedToTrains(decodeFeed(buf), STATIONS);
    const delayed = trains.find((t) => t.tripId === 'trip3')!;
    const canceled = trains.find((t) => t.tripId === 'trip4')!;
    expect(delayed.status).toBe('delay');
    expect(delayed.delaySeconds).toBe(240);
    expect(canceled.status).toBe('suspended');
  });

  it('drops trains that cannot be placed', () => {
    const buf = encodeFeed([
      {
        id: 'e5',
        tripUpdate: {
          trip: { tripId: 'trip5', routeId: 'TokyoMetro.Ginza' },
          stopTimeUpdate: [{ stopId: 'unknown.station' }],
        },
      },
    ]);
    const trains = feedToTrains(decodeFeed(buf), STATIONS);
    expect(trains).toHaveLength(0);
  });

  it('merges VehiclePosition and TripUpdate for the same vehicle', () => {
    const buf = encodeFeed([
      {
        id: 'e6',
        vehicle: {
          trip: { tripId: 'trip6', routeId: 'TokyoMetro.Ginza' },
          vehicle: { id: 'train-006' },
          position: { latitude: 35.67, longitude: 139.75 },
        },
      },
      {
        id: 'e7',
        tripUpdate: {
          trip: { tripId: 'trip6', routeId: 'TokyoMetro.Ginza' },
          vehicle: { id: 'train-006' },
          stopTimeUpdate: [{ stopId: 'ginza.shibuya', arrival: { delay: 120 } }],
        },
      },
    ]);
    const trains = feedToTrains(decodeFeed(buf), STATIONS);
    expect(trains).toHaveLength(1);
    expect(trains[0].positionSource).toBe('gtfs-rt');
    expect(trains[0].status).toBe('delay');
    expect(trains[0].delaySeconds).toBe(120);
  });
});

describe('feedToAlerts', () => {
  it('maps severity and prefers Japanese translations', () => {
    const buf = encodeFeed([
      {
        id: 'a1',
        alert: {
          informedEntity: [
            { routeId: 'odpt.Railway:TokyoMetro.Hanzomon' },
            { stopId: 'hanzomon.shibuya' },
          ],
          severityLevel: transit_realtime.Alert.SeverityLevel.SEVERE,
          headerText: {
            translation: [
              { language: 'en', text: 'Service suspended' },
              { language: 'ja', text: '運転見合わせ' },
            ],
          },
          activePeriod: [{ start: 1780000000, end: 1780003600 }],
        },
      },
    ]);
    const alerts = feedToAlerts(decodeFeed(buf));
    expect(alerts).toHaveLength(1);
    expect(alerts[0].severity).toBe('critical');
    expect(alerts[0].title).toBe('運転見合わせ');
    expect(alerts[0].routeIds).toEqual(['Z']);
    expect(alerts[0].stationIds).toEqual(['hanzomon.shibuya']);
    expect(alerts[0].activePeriod?.start).toBe('2026-05-28T20:26:40.000Z');
  });

  it('defaults to info severity and fallback title', () => {
    const buf = encodeFeed([{ id: 'a2', alert: { informedEntity: [] } }]);
    const alerts = feedToAlerts(decodeFeed(buf));
    expect(alerts[0].severity).toBe('info');
    expect(alerts[0].title).toBe('運行情報');
  });
});
