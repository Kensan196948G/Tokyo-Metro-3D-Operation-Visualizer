/**
 * GTFS-RT (Protocol Buffers) feed decoder.
 * Converts FeedMessage entities into internal MetroTrain / MetroAlert models.
 * Position resolution order per train:
 *   1. VehiclePosition lat/lon        -> positionSource "gtfs-rt"
 *   2. TripUpdate current stop lookup -> positionSource "station-based"
 */
import GtfsRealtimeBindings from 'gtfs-realtime-bindings';
import type { MetroTrain, MetroAlert, TrainStatus } from '../domain/trainModel.js';
import type { MetroStation } from '../domain/stationModel.js';
import { latLonToXZ, isValidLatLon } from '../utils/geo.js';
import { normalizeRouteId } from './gtfsParser.js';
import { ALL_ROUTES } from '../domain/routeModel.js';

const { transit_realtime } = GtfsRealtimeBindings;

const DELAY_THRESHOLD_SECONDS = 60;
const layerHeightByRoute = new Map(ALL_ROUTES.map((r) => [r.routeId, r.layerHeight]));

export function decodeFeed(buf: Uint8Array): GtfsRealtimeBindings.transit_realtime.FeedMessage {
  return transit_realtime.FeedMessage.decode(buf);
}

/** protobufjs may deliver int64 as Long objects; normalize to number. */
function toNumber(value: number | Long | null | undefined): number | undefined {
  if (value === null || value === undefined) return undefined;
  if (typeof value === 'number') return value;
  return value.toNumber();
}

function toIso(epochSeconds: number | undefined, fallback: string): string {
  return epochSeconds ? new Date(epochSeconds * 1000).toISOString() : fallback;
}

export function feedToTrains(
  feed: GtfsRealtimeBindings.transit_realtime.IFeedMessage,
  stations: MetroStation[]
): MetroTrain[] {
  const stationById = new Map(stations.map((s) => [s.stationId, s]));
  const headerTime = toIso(toNumber(feed.header?.timestamp), new Date().toISOString());
  const trains = new Map<string, MetroTrain>();

  for (const entity of feed.entity ?? []) {
    const vp = entity.vehicle;
    const tu = entity.tripUpdate;
    const trip = vp?.trip ?? tu?.trip;
    const tripId = trip?.tripId ?? undefined;
    const trainId =
      vp?.vehicle?.id ?? tu?.vehicle?.id ?? tripId ?? entity.id ?? `entity-${trains.size}`;
    const routeId = trip?.routeId ? normalizeRouteId(trip.routeId) ?? undefined : undefined;
    const layerY = routeId ? (layerHeightByRoute.get(routeId) ?? 0) : 0;

    const existing = trains.get(trainId);
    const train: MetroTrain = existing ?? {
      trainId,
      tripId,
      routeId,
      directionId: trip?.directionId != null ? String(trip.directionId) : undefined,
      status: 'unknown',
      x: 0,
      y: layerY,
      z: 0,
      positionSource: 'station-based',
      updatedAt: headerTime,
    };

    // --- Delay / status from TripUpdate ---
    if (tu) {
      const delay = extractDelaySeconds(tu);
      if (delay !== undefined) {
        train.delaySeconds = delay;
        train.status = delay >= DELAY_THRESHOLD_SECONDS ? 'delay' : 'normal';
      } else if (train.status === 'unknown') {
        train.status = 'normal';
      }
      if (
        tu.trip?.scheduleRelationship ===
        transit_realtime.TripDescriptor.ScheduleRelationship.CANCELED
      ) {
        train.status = 'suspended';
      }
      const { currentStopId, nextStopId } = extractStops(tu);
      if (currentStopId) train.currentStationId = currentStopId;
      if (nextStopId) train.nextStationId = nextStopId;
      const tuTime = toNumber(tu.timestamp);
      if (tuTime) train.updatedAt = toIso(tuTime, headerTime);
    }

    // --- Position from VehiclePosition (authoritative when present) ---
    if (vp?.position && vp.position.latitude != null && vp.position.longitude != null) {
      const lat = vp.position.latitude;
      const lon = vp.position.longitude;
      if (isValidLatLon(lat, lon)) {
        const { x, z } = latLonToXZ(lat, lon);
        train.lat = lat;
        train.lon = lon;
        train.x = x;
        train.z = z;
        train.y = layerY;
        train.positionSource = 'gtfs-rt';
      }
      if (vp.stopId) train.currentStationId = vp.stopId;
      const vpTime = toNumber(vp.timestamp);
      if (vpTime) train.updatedAt = toIso(vpTime, train.updatedAt);
      if (train.status === 'unknown') train.status = 'normal';
    }

    trains.set(trainId, train);
  }

  // Resolve station-based positions for trains without coordinates
  const resolved: MetroTrain[] = [];
  for (const train of trains.values()) {
    if (train.positionSource !== 'gtfs-rt') {
      const anchor =
        (train.currentStationId && stationById.get(train.currentStationId)) ||
        (train.nextStationId && stationById.get(train.nextStationId));
      if (!anchor) continue; // no way to place this train in the scene
      train.lat = anchor.lat;
      train.lon = anchor.lon;
      train.x = anchor.x;
      train.z = anchor.z;
      train.y = train.routeId ? (layerHeightByRoute.get(train.routeId) ?? anchor.y) : anchor.y;
      train.positionSource = 'station-based';
    }
    resolved.push(train);
  }
  return resolved;
}

/**
 * protobufjs materializes unset scalar fields as prototype defaults (0), so
 * `tu.delay != null` is true even when the wire had no delay. Only fields
 * present on the wire become own properties — check those explicitly.
 */
function ownField<T>(obj: object | null | undefined, key: string): T | undefined {
  if (!obj || !Object.prototype.hasOwnProperty.call(obj, key)) return undefined;
  return (obj as Record<string, T>)[key];
}

function extractDelaySeconds(
  tu: GtfsRealtimeBindings.transit_realtime.ITripUpdate
): number | undefined {
  // Prefer the first upcoming stop's arrival/departure delay
  for (const stu of tu.stopTimeUpdate ?? []) {
    const delay =
      ownField<number>(stu.arrival, 'delay') ?? ownField<number>(stu.departure, 'delay');
    if (delay != null) return delay;
  }
  return ownField<number>(tu, 'delay');
}

function extractStops(tu: GtfsRealtimeBindings.transit_realtime.ITripUpdate): {
  currentStopId?: string;
  nextStopId?: string;
} {
  const updates = tu.stopTimeUpdate ?? [];
  if (updates.length === 0) return {};
  const first = updates[0]?.stopId ?? undefined;
  const second = updates[1]?.stopId ?? undefined;
  return { currentStopId: first, nextStopId: second };
}

const SEVERITY_MAP: Record<number, MetroAlert['severity']> = {
  [transit_realtime.Alert.SeverityLevel.UNKNOWN_SEVERITY]: 'info',
  [transit_realtime.Alert.SeverityLevel.INFO]: 'info',
  [transit_realtime.Alert.SeverityLevel.WARNING]: 'warning',
  [transit_realtime.Alert.SeverityLevel.SEVERE]: 'critical',
};

export function feedToAlerts(
  feed: GtfsRealtimeBindings.transit_realtime.IFeedMessage
): MetroAlert[] {
  const alerts: MetroAlert[] = [];

  for (const entity of feed.entity ?? []) {
    const alert = entity.alert;
    if (!alert) continue;

    const routeIds = new Set<string>();
    const stationIds: string[] = [];
    for (const informed of alert.informedEntity ?? []) {
      if (informed.routeId) {
        const code = normalizeRouteId(informed.routeId);
        if (code) routeIds.add(code);
      }
      if (informed.stopId) stationIds.push(informed.stopId);
    }

    const period = (alert.activePeriod ?? [])[0];
    const start = toNumber(period?.start);
    const end = toNumber(period?.end);

    alerts.push({
      alertId: entity.id ?? `alert-${alerts.length}`,
      routeIds: Array.from(routeIds),
      stationIds: stationIds.length > 0 ? stationIds : undefined,
      severity: SEVERITY_MAP[alert.severityLevel ?? 0] ?? 'info',
      title: firstTranslation(alert.headerText) ?? '運行情報',
      description: firstTranslation(alert.descriptionText),
      activePeriod:
        start || end
          ? {
              start: start ? new Date(start * 1000).toISOString() : undefined,
              end: end ? new Date(end * 1000).toISOString() : undefined,
            }
          : undefined,
    });
  }
  return alerts;
}

function firstTranslation(
  text: GtfsRealtimeBindings.transit_realtime.ITranslatedString | null | undefined
): string | undefined {
  const translations = text?.translation ?? [];
  // Prefer Japanese, fall back to the first entry
  const ja = translations.find((t) => t.language === 'ja');
  return (ja ?? translations[0])?.text ?? undefined;
}

type Long = { toNumber(): number };
