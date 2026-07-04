import { describe, it, expect } from 'vitest';
import { zipSync, strToU8 } from 'fflate';
import { parseCsv, parseCsvRows } from '../utils/csv.js';
import {
  normalizeRouteId,
  parseStops,
  parseShapes,
  buildShapeRouteMap,
  buildStopRouteMap,
} from './gtfsParser.js';
import { normalizeGtfsZip } from './gtfsFetcher.js';

describe('parseCsv', () => {
  it('parses simple rows', () => {
    const rows = parseCsv('a,b,c\n1,2,3\n4,5,6');
    expect(rows).toEqual([
      { a: '1', b: '2', c: '3' },
      { a: '4', b: '5', c: '6' },
    ]);
  });

  it('handles quoted fields with commas and escaped quotes', () => {
    const rows = parseCsv('name,desc\n"Ginza, Line","He said ""hi"""');
    expect(rows[0]['name']).toBe('Ginza, Line');
    expect(rows[0]['desc']).toBe('He said "hi"');
  });

  it('handles quoted newlines', () => {
    const rows = parseCsvRows('a,b\n"line1\nline2",x');
    expect(rows[1][0]).toBe('line1\nline2');
    expect(rows[1][1]).toBe('x');
  });

  it('strips UTF-8 BOM and handles CRLF', () => {
    const rows = parseCsv('﻿stop_id,stop_name\r\nS1,Tokyo\r\n');
    expect(rows).toEqual([{ stop_id: 'S1', stop_name: 'Tokyo' }]);
  });
});

describe('normalizeRouteId', () => {
  it('maps ODPT-style identifiers to line codes', () => {
    expect(normalizeRouteId('odpt.Railway:TokyoMetro.Ginza')).toBe('G');
    expect(normalizeRouteId('TokyoMetro.Marunouchi')).toBe('M');
    expect(normalizeRouteId('unknown', 'Hanzomon Line')).toBe('Z');
  });

  it('accepts bare line codes and rejects unknown', () => {
    expect(normalizeRouteId('C')).toBe('C');
    expect(normalizeRouteId('odpt.Railway:Toei.Asakusa')).toBeNull();
  });
});

const STOPS_FIXTURE = [
  'stop_id,stop_name,stop_lat,stop_lon,location_type',
  'ginza.shibuya,渋谷,35.6581,139.7016,0',
  'ginza.omotesando,"表参道 (Omote-sando)",35.6654,139.7121,0',
  'bad.station,壊れた駅,99.9,199.9,0',
  'no-coords,座標なし,,,0',
].join('\n');

describe('parseStops', () => {
  it('parses valid stops and skips invalid coordinates', () => {
    const stations = parseStops(STOPS_FIXTURE);
    expect(stations).toHaveLength(2);
    expect(stations[0].name).toBe('渋谷');
    expect(stations[1].name).toBe('表参道 (Omote-sando)');
    // ginza.* stop IDs infer the G route
    expect(stations[0].routeIds).toEqual(['G']);
  });

  it('uses the provided stop->route map and layer height', () => {
    const map = new Map([['ginza.shibuya', ['G']]]);
    const stations = parseStops(STOPS_FIXTURE, map);
    const shibuya = stations.find((s) => s.stationId === 'ginza.shibuya')!;
    expect(shibuya.routeIds).toEqual(['G']);
    expect(shibuya.y).toBe(0); // Ginza layer height
  });
});

const SHAPES_FIXTURE = [
  'shape_id,shape_pt_lat,shape_pt_lon,shape_pt_sequence',
  'shape_ginza_1,35.6581,139.7016,1',
  'shape_ginza_1,35.6654,139.7121,2',
  'shape_ginza_1,35.6713,139.7645,3',
  'shape_ginza_2,35.6581,139.7016,1',
].join('\n');

const TRIPS_FIXTURE = [
  'route_id,service_id,trip_id,shape_id',
  'odpt.Railway:TokyoMetro.Ginza,weekday,trip1,shape_ginza_1',
  'odpt.Railway:TokyoMetro.Ginza,weekday,trip2,shape_ginza_2',
].join('\n');

const STOP_TIMES_FIXTURE = [
  'trip_id,arrival_time,departure_time,stop_id,stop_sequence',
  'trip1,05:00:00,05:00:30,ginza.shibuya,1',
  'trip1,05:02:00,05:02:30,ginza.omotesando,2',
].join('\n');

describe('parseShapes', () => {
  it('keeps the longest shape per route, sorted by sequence', () => {
    const routeMap = buildShapeRouteMap(TRIPS_FIXTURE);
    const shapes = parseShapes(SHAPES_FIXTURE, routeMap);
    expect(shapes).toHaveLength(1);
    expect(shapes[0].routeId).toBe('G');
    expect(shapes[0].points).toHaveLength(3);
    expect(shapes[0].points.map((p) => p.sequence)).toEqual([1, 2, 3]);
    expect(shapes[0].points[0].y).toBe(0); // Ginza layer
  });
});

describe('buildStopRouteMap', () => {
  it('links stops to line codes via trips', () => {
    const map = buildStopRouteMap(TRIPS_FIXTURE, STOP_TIMES_FIXTURE);
    expect(map.get('ginza.shibuya')).toEqual(['G']);
    expect(map.get('ginza.omotesando')).toEqual(['G']);
  });
});

describe('normalizeGtfsZip', () => {
  it('extracts and normalizes a full fixture zip', () => {
    const zip = zipSync({
      'stops.txt': strToU8(STOPS_FIXTURE),
      'shapes.txt': strToU8(SHAPES_FIXTURE),
      'trips.txt': strToU8(TRIPS_FIXTURE),
      'stop_times.txt': strToU8(STOP_TIMES_FIXTURE),
    });
    const result = normalizeGtfsZip(zip, '2026-07-04T00:00:00Z');
    expect(result.ok).toBe(true);
    expect(result.stationCount).toBe(2);
    expect(result.shapeCount).toBe(1);
  });

  it('fails cleanly when stops.txt is missing', () => {
    const zip = zipSync({ 'agency.txt': strToU8('agency_id\nx') });
    const result = normalizeGtfsZip(zip, '2026-07-04T00:00:00Z');
    expect(result.ok).toBe(false);
    expect(result.error).toContain('stops.txt');
  });

  it('fails cleanly on corrupt zip data', () => {
    const result = normalizeGtfsZip(new Uint8Array([1, 2, 3]), '2026-07-04T00:00:00Z');
    expect(result.ok).toBe(false);
    expect(result.error).toContain('unzip');
  });
});
