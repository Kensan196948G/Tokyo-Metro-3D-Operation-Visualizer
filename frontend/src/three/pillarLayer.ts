import * as THREE from 'three';
import type { MetroStation, MetroRoute } from '../types/metro.js';
import { ROUTE_COLORS } from '../config/appConfig.js';

/**
 * "Model pillars" — thin verticals connecting each station to the ground
 * plane, giving the network the look of a physical architectural model
 * (reference v2's 模型支柱). Interchange stations get brighter pillars.
 */
export class PillarLayer {
  private group = new THREE.Group();

  getGroup(): THREE.Group {
    return this.group;
  }

  setVisible(visible: boolean): void {
    this.group.visible = visible;
  }

  update(stations: MetroStation[], routes: MetroRoute[], depthScale = 1): void {
    // Dispose line geometries/materials before rebuilding.
    this.group.traverse((obj) => {
      if (obj instanceof THREE.Line) {
        obj.geometry.dispose();
        (obj.material as THREE.Material).dispose();
      }
    });
    this.group.clear();

    const routeHeight = new Map(routes.map((r) => [r.routeId, r.layerHeight]));
    const routeVisible = new Map(routes.map((r) => [r.routeId, r.visible]));

    for (const station of stations) {
      const primary = station.routeIds[0];
      if (!primary) continue;
      if (!routeVisible.get(primary)) continue;

      const y = (routeHeight.get(primary) ?? 0) * depthScale;
      // Ground-level layers need no pillar.
      if (Math.abs(y) < 0.5) continue;

      const interchange = station.routeIds.length >= 2;
      const color = interchange ? (ROUTE_COLORS[primary] ?? '#8a94ab') : '#3a4560';

      const geometry = new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(station.x, 0, station.z),
        new THREE.Vector3(station.x, y, station.z),
      ]);
      const material = new THREE.LineBasicMaterial({
        color,
        transparent: true,
        opacity: interchange ? 0.5 : 0.22,
      });
      this.group.add(new THREE.Line(geometry, material));
    }
  }
}
