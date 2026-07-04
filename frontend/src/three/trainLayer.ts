import * as THREE from 'three';
import type { MetroTrain, MetroRoute } from '../types/metro.js';
import { STATUS_COLORS, ROUTE_COLORS } from '../config/appConfig.js';

export class TrainLayer {
  private group = new THREE.Group();
  private meshMap = new Map<string, THREE.Mesh>();

  getGroup(): THREE.Group {
    return this.group;
  }

  update(trains: MetroTrain[], routes: MetroRoute[]): void {
    const routeVisibilityMap = new Map(routes.map((r) => [r.routeId, r.visible]));

    const currentIds = new Set(trains.map((t) => t.trainId));

    // Remove stale
    for (const [id, mesh] of this.meshMap) {
      if (!currentIds.has(id)) {
        this.group.remove(mesh);
        this.meshMap.delete(id);
      }
    }

    trains.forEach((train) => {
      if (train.routeId && !routeVisibilityMap.get(train.routeId)) return;

      const statusColor = STATUS_COLORS[train.status] ?? STATUS_COLORS.unknown;
      const routeColor = train.routeId ? (ROUTE_COLORS[train.routeId] ?? '#ffffff') : '#ffffff';

      let mesh = this.meshMap.get(train.trainId);
      if (!mesh) {
        const geo = new THREE.BoxGeometry(2.5, 1.2, 4);
        const mat = new THREE.MeshPhongMaterial({
          color: routeColor,
          emissive: statusColor,
          emissiveIntensity: train.status === 'delay' ? 0.8 : 0.3,
        });
        mesh = new THREE.Mesh(geo, mat);
        mesh.userData = { type: 'train', train };
        this.group.add(mesh);
        this.meshMap.set(train.trainId, mesh);
      }

      mesh.position.set(train.x, train.y + 1.5, train.z);

      // Pulse for delays
      if (train.status === 'delay') {
        const scale = 1 + Math.sin(Date.now() / 400) * 0.1;
        mesh.scale.set(scale, scale, scale);
      } else {
        mesh.scale.set(1, 1, 1);
      }

      mesh.userData.train = train;
    });
  }

  getMeshes(): THREE.Mesh[] {
    return Array.from(this.meshMap.values());
  }
}
