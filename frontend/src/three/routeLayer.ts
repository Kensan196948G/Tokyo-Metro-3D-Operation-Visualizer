import * as THREE from 'three';
import type { MetroStation, MetroRoute } from '../types/metro.js';
import { ROUTE_COLORS } from '../config/appConfig.js';

export class RouteLayer {
  private group = new THREE.Group();

  getGroup(): THREE.Group {
    return this.group;
  }

  update(stations: MetroStation[], routes: MetroRoute[]): void {
    this.group.clear();

    routes.forEach((route) => {
      if (!route.visible) return;

      const routeStations = stations
        .filter((s) => s.routeIds.includes(route.routeId))
        .sort((a, b) => a.stationId.localeCompare(b.stationId));

      if (routeStations.length < 2) return;

      const color = new THREE.Color(ROUTE_COLORS[route.routeId] ?? '#8b949e');
      const points = routeStations.map(
        (s) => new THREE.Vector3(s.x, route.layerHeight, s.z)
      );

      const geometry = new THREE.BufferGeometry().setFromPoints(points);
      const material = new THREE.LineBasicMaterial({
        color,
        linewidth: 2,
        transparent: true,
        opacity: 0.85,
      });
      const line = new THREE.Line(geometry, material);
      this.group.add(line);

      // Also add tube for better visibility
      const curve = new THREE.CatmullRomCurve3(points);
      const tubeGeo = new THREE.TubeGeometry(curve, routeStations.length * 3, 0.4, 6, false);
      const tubeMat = new THREE.MeshPhongMaterial({ color, emissive: color, emissiveIntensity: 0.2, transparent: true, opacity: 0.7 });
      const tube = new THREE.Mesh(tubeGeo, tubeMat);
      this.group.add(tube);
    });
  }
}
