import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import type { MetroTrain, MetroRoute } from '../types/metro.js';
import { STATUS_COLORS, ROUTE_COLORS, UPDATE_INTERVAL_MS } from '../config/appConfig.js';

type TrainEntry = {
  group: THREE.Group;
  // Per-train material: line color on the waist stripe, status as emissive.
  stripeMat: THREE.MeshPhongMaterial;
  train: MetroTrain;
  // Interpolation state: glide from -> to over TRANSITION_MS after each update
  fromPos: THREE.Vector3;
  toPos: THREE.Vector3;
  startedAt: number;
};

// Glide duration matches the polling cadence so a train arrives at its
// reported position right as the next report lands — continuous motion.
const TRANSITION_MS = UPDATE_INTERVAL_MS;

// ---------------------------------------------------------------------------
// Shared car-body parts — one geometry/material per part for the whole fleet.
// Only the line-color stripe gets a per-train material (see TrainEntry).
// Local +z is the direction of travel (tick() sets rotation.y from motion).
// ---------------------------------------------------------------------------
const BODY_GEO = new RoundedBoxGeometry(2.4, 1.6, 5.6, 3, 0.5);
const GLASS_GEO = new THREE.BoxGeometry(2.44, 0.5, 4.6); // slightly proud: no z-fight
const STRIPE_GEO = new THREE.BoxGeometry(2.46, 0.34, 5.2);
const LIGHT_GEO = new THREE.BoxGeometry(0.5, 0.22, 0.12);

const BODY_MAT = new THREE.MeshPhongMaterial({ color: 0xd8dce4, shininess: 60 });
const GLASS_MAT = new THREE.MeshPhongMaterial({ color: 0x101820, shininess: 90 });
const LIGHT_MAT = new THREE.MeshPhongMaterial({
  color: 0xfff7d6,
  emissive: 0xfff3b0,
  emissiveIntensity: 1,
});

/** Assembles one rolling-stock car; the stripe material is returned for
 * per-train color/status updates. */
function buildCar(routeColor: string): { group: THREE.Group; stripeMat: THREE.MeshPhongMaterial } {
  const group = new THREE.Group();
  const stripeMat = new THREE.MeshPhongMaterial({ color: routeColor, shininess: 40 });

  const body = new THREE.Mesh(BODY_GEO, BODY_MAT);
  const glass = new THREE.Mesh(GLASS_GEO, GLASS_MAT);
  glass.position.y = 0.38;
  const stripe = new THREE.Mesh(STRIPE_GEO, stripeMat);
  stripe.position.y = -0.42;
  const lightL = new THREE.Mesh(LIGHT_GEO, LIGHT_MAT);
  lightL.position.set(-0.62, -0.35, 2.78);
  const lightR = new THREE.Mesh(LIGHT_GEO, LIGHT_MAT);
  lightR.position.set(0.62, -0.35, 2.78);

  group.add(body, glass, stripe, lightL, lightR);
  return { group, stripeMat };
}

export class TrainLayer {
  private group = new THREE.Group();
  private entries = new Map<string, TrainEntry>();
  private pulseEnabled = true;

  getGroup(): THREE.Group {
    return this.group;
  }

  /** Toggle the pulsing scale animation on delayed trains. */
  setPulseEnabled(enabled: boolean): void {
    this.pulseEnabled = enabled;
  }

  /** Applies a new server snapshot. Cars glide to new targets via tick(). */
  update(trains: MetroTrain[], routes: MetroRoute[], depthScale = 1): void {
    const routeVisibilityMap = new Map(routes.map((r) => [r.routeId, r.visible]));
    const now = performance.now();
    const currentIds = new Set<string>();

    for (const train of trains) {
      if (train.routeId && !routeVisibilityMap.get(train.routeId)) continue;
      currentIds.add(train.trainId);

      const statusColor = STATUS_COLORS[train.status] ?? STATUS_COLORS.unknown;
      const routeColor = train.routeId ? (ROUTE_COLORS[train.routeId] ?? '#ffffff') : '#ffffff';
      // Depth exaggeration matches the route/station layers; the +1.5 lift keeps
      // the car body just above its track and is intentionally not scaled.
      const target = new THREE.Vector3(train.x, train.y * depthScale + 1.5, train.z);

      let entry = this.entries.get(train.trainId);
      if (!entry) {
        const { group, stripeMat } = buildCar(routeColor);
        group.position.copy(target); // first sighting: appear in place, no glide
        // One shared userData object: the group and every child expose the same
        // train reference, so a raycast hit on any part resolves identically.
        group.userData = { type: 'train', train };
        group.children.forEach((c) => (c.userData = group.userData));
        this.group.add(group);
        entry = { group, stripeMat, train, fromPos: target.clone(), toPos: target.clone(), startedAt: now };
        this.entries.set(train.trainId, entry);
      } else {
        // Glide from wherever the car currently is toward the new report.
        entry.fromPos.copy(entry.group.position);
        entry.toPos.copy(target);
        entry.startedAt = now;
      }

      entry.train = train;
      entry.group.userData['train'] = train;
      // Status lives on the stripe: normal = soft line-color glow, delay = hot.
      entry.stripeMat.emissive.set(statusColor);
      entry.stripeMat.emissiveIntensity = train.status === 'delay' ? 0.9 : 0.35;
    }

    // Remove trains that disappeared from the feed
    for (const [id, entry] of this.entries) {
      if (!currentIds.has(id)) {
        this.group.remove(entry.group);
        entry.stripeMat.dispose(); // shared parts stay alive for the fleet
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
      entry.group.position.lerpVectors(entry.fromPos, entry.toPos, eased);

      // Face the direction of travel (XZ plane); headlights sit at local +z.
      const dx = entry.toPos.x - entry.fromPos.x;
      const dz = entry.toPos.z - entry.fromPos.z;
      if (dx * dx + dz * dz > 0.0001) {
        entry.group.rotation.y = Math.atan2(dx, dz);
      }

      // Delay pulse
      if (this.pulseEnabled && entry.train.status === 'delay') {
        const scale = 1 + Math.sin(nowMs / 400) * 0.1;
        entry.group.scale.setScalar(scale);
      } else {
        entry.group.scale.setScalar(1);
      }
    }
  }

  /** Pickable objects for raycasting (use recursive intersect). */
  getMeshes(): THREE.Object3D[] {
    return Array.from(this.entries.values()).map((e) => e.group);
  }

  /** Live object + latest report for one train (undefined once it leaves the feed). */
  getTrain(trainId: string): { mesh: THREE.Object3D; train: MetroTrain } | undefined {
    const entry = this.entries.get(trainId);
    return entry ? { mesh: entry.group, train: entry.train } : undefined;
  }

  /** First active train on a route — entry point for per-line driver mode. */
  firstTrainOnRoute(routeId: string): string | undefined {
    for (const [id, entry] of this.entries) {
      if (entry.train.routeId === routeId) return id;
    }
    return undefined;
  }
}
