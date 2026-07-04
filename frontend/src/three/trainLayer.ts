import * as THREE from 'three';
import type { MetroTrain, MetroRoute } from '../types/metro.js';
import { STATUS_COLORS, ROUTE_COLORS, UPDATE_INTERVAL_MS } from '../config/appConfig.js';

type TrainEntry = {
  mesh: THREE.Mesh;
  train: MetroTrain;
  // Interpolation state: glide from -> to over TRANSITION_MS after each update
  fromPos: THREE.Vector3;
  toPos: THREE.Vector3;
  startedAt: number;
};

// Glide duration matches the polling cadence so a train arrives at its
// reported position right as the next report lands — continuous motion.
const TRANSITION_MS = UPDATE_INTERVAL_MS;

export class TrainLayer {
  private group = new THREE.Group();
  private entries = new Map<string, TrainEntry>();

  getGroup(): THREE.Group {
    return this.group;
  }

  /** Applies a new server snapshot. Meshes glide to new targets via tick(). */
  update(trains: MetroTrain[], routes: MetroRoute[]): void {
    const routeVisibilityMap = new Map(routes.map((r) => [r.routeId, r.visible]));
    const now = performance.now();
    const currentIds = new Set<string>();

    for (const train of trains) {
      if (train.routeId && !routeVisibilityMap.get(train.routeId)) continue;
      currentIds.add(train.trainId);

      const statusColor = STATUS_COLORS[train.status] ?? STATUS_COLORS.unknown;
      const routeColor = train.routeId ? (ROUTE_COLORS[train.routeId] ?? '#ffffff') : '#ffffff';
      const target = new THREE.Vector3(train.x, train.y + 1.5, train.z);

      let entry = this.entries.get(train.trainId);
      if (!entry) {
        const geo = new THREE.BoxGeometry(2.5, 1.2, 4);
        const mat = new THREE.MeshPhongMaterial({ color: routeColor });
        const mesh = new THREE.Mesh(geo, mat);
        mesh.position.copy(target); // first sighting: appear in place, no glide
        mesh.userData = { type: 'train', train };
        this.group.add(mesh);
        entry = { mesh, train, fromPos: target.clone(), toPos: target.clone(), startedAt: now };
        this.entries.set(train.trainId, entry);
      } else {
        // Glide from wherever the mesh currently is toward the new report.
        entry.fromPos.copy(entry.mesh.position);
        entry.toPos.copy(target);
        entry.startedAt = now;
      }

      entry.train = train;
      entry.mesh.userData.train = train;
      const mat = entry.mesh.material as THREE.MeshPhongMaterial;
      mat.emissive.set(statusColor);
      mat.emissiveIntensity = train.status === 'delay' ? 0.8 : 0.3;
    }

    // Remove trains that disappeared from the feed
    for (const [id, entry] of this.entries) {
      if (!currentIds.has(id)) {
        this.group.remove(entry.mesh);
        this.entries.delete(id);
      }
    }
  }

  /** Per-frame interpolation — register with MetroScene.onFrame(). */
  tick(nowMs: number): void {
    for (const entry of this.entries.values()) {
      const t = Math.min((nowMs - entry.startedAt) / TRANSITION_MS, 1);
      // Smoothstep eases departure/arrival without overshoot
      const eased = t * t * (3 - 2 * t);
      entry.mesh.position.lerpVectors(entry.fromPos, entry.toPos, eased);

      // Face the direction of travel (XZ plane)
      const dx = entry.toPos.x - entry.fromPos.x;
      const dz = entry.toPos.z - entry.fromPos.z;
      if (dx * dx + dz * dz > 0.0001) {
        entry.mesh.rotation.y = Math.atan2(dx, dz);
      }

      // Delay pulse
      if (entry.train.status === 'delay') {
        const scale = 1 + Math.sin(nowMs / 400) * 0.1;
        entry.mesh.scale.setScalar(scale);
      } else {
        entry.mesh.scale.setScalar(1);
      }
    }
  }

  getMeshes(): THREE.Mesh[] {
    return Array.from(this.entries.values()).map((e) => e.mesh);
  }
}
