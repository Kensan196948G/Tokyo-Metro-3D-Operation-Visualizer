import * as THREE from 'three';
import type { MetroStation, MetroRoute, MetroRouteShape } from '../types/metro.js';
import { ROUTE_COLORS } from '../config/appConfig.js';

const MAX_TUBE_SEGMENTS = 512;

export class RouteLayer {
  private group = new THREE.Group();

  getGroup(): THREE.Group {
    return this.group;
  }

  update(
    stations: MetroStation[],
    routes: MetroRoute[],
    shapes: MetroRouteShape[] = [],
    depthScale = 1
  ): void {
    this.group.clear();

    const shapeByRoute = new Map(shapes.map((s) => [s.routeId, s]));

    routes.forEach((route) => {
      if (!route.visible) return;

      const points = this.resolvePoints(
        route,
        stations,
        shapeByRoute.get(route.routeId),
        depthScale
      );
      if (points.length < 2) return;

      const color = new THREE.Color(ROUTE_COLORS[route.routeId] ?? '#8b949e');

      // Circular lines (Yamanote) close back on themselves — ring, not arc.
      const closed = route.loop === true;
      const linePoints = closed ? [...points, points[0].clone()] : points;
      const geometry = new THREE.BufferGeometry().setFromPoints(linePoints);
      const material = new THREE.LineBasicMaterial({
        color,
        transparent: true,
        opacity: 0.85,
      });
      this.group.add(new THREE.Line(geometry, material));

      // Tube gives the line body; segment count is capped for perf with
      // real GTFS shapes that carry hundreds of points per route.
      const curve = new THREE.CatmullRomCurve3(points, closed);
      const segments = Math.min(points.length * 3, MAX_TUBE_SEGMENTS);
      const tubeGeo = new THREE.TubeGeometry(curve, segments, 0.4, 6, closed);
      const tubeMat = new THREE.MeshPhongMaterial({
        color,
        emissive: color,
        emissiveIntensity: 0.2,
        transparent: true,
        opacity: 0.7,
      });
      this.group.add(new THREE.Mesh(tubeGeo, tubeMat));
    });
  }

  /** GTFS shape geometry when available, station-to-station fallback otherwise. */
  private resolvePoints(
    route: MetroRoute,
    stations: MetroStation[],
    shape: MetroRouteShape | undefined,
    depthScale: number
  ): THREE.Vector3[] {
    // depthScale exaggerates only the vertical (depth) axis; horizontal layout
    // and tube thickness stay fixed so shapes are not distorted.
    const y = route.layerHeight * depthScale;
    if (shape && shape.points.length >= 2) {
      return shape.points.map((p) => new THREE.Vector3(p.x, y, p.z));
    }
    // Only stations whose PRIMARY line is this route: interchange stations
    // list foreign routes in routeIds and would zigzag the path otherwise.
    return stations
      .filter((s) => s.routeIds[0] === route.routeId)
      .sort((a, b) => a.stationId.localeCompare(b.stationId))
      .map((s) => new THREE.Vector3(s.x, y, s.z));
  }
}
