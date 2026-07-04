import * as THREE from 'three';
import type { MetroStation, MetroRoute } from '../types/metro.js';
import { ROUTE_COLORS } from '../config/appConfig.js';

export class StationLayer {
  private group = new THREE.Group();
  private meshMap = new Map<string, THREE.Mesh>();

  getGroup(): THREE.Group {
    return this.group;
  }

  update(stations: MetroStation[], routes: MetroRoute[]): void {
    // Remove old
    this.group.clear();
    this.meshMap.clear();

    const routeHeightMap = new Map(routes.map((r) => [r.routeId, r.layerHeight]));
    const routeVisibilityMap = new Map(routes.map((r) => [r.routeId, r.visible]));

    stations.forEach((station) => {
      const primaryRoute = station.routeIds[0];
      if (!primaryRoute) return;
      if (!routeVisibilityMap.get(primaryRoute)) return;

      const height = routeHeightMap.get(primaryRoute) ?? 0;
      const color = ROUTE_COLORS[primaryRoute] ?? '#8b949e';

      const geo = new THREE.SphereGeometry(0.8, 8, 8);
      const mat = new THREE.MeshPhongMaterial({ color, emissive: color, emissiveIntensity: 0.3 });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(station.x, height + 0.5, station.z);
      mesh.userData = { type: 'station', station };
      this.group.add(mesh);
      this.meshMap.set(station.stationId, mesh);
    });
  }

  getMeshes(): THREE.Mesh[] {
    return Array.from(this.meshMap.values());
  }
}
