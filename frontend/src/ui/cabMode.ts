import * as THREE from 'three';
import type { MetroScene } from '../three/scene.js';
import type { MetroStation, MetroRoute, MetroTrain } from '../types/metro.js';
import { ROUTE_COLORS } from '../config/appConfig.js';

export type CabModeName = 'none' | 'chase' | 'cab';

type Lookups = {
  getTrain: (id: string) => { mesh: THREE.Object3D; train: MetroTrain } | undefined;
  getStation: (id: string) => MetroStation | undefined;
  getRoute: (id: string) => MetroRoute | undefined;
  /** Terminal station names of a line: direction '0' heads to `forward`. */
  getTerminals: (routeId: string) => { forward: string; back: string } | undefined;
  /** Scene-unit → km conversion (derived from real station coordinates). */
  kmPerUnit: () => number;
  clockText: () => string;
};

/**
 * Chase + driver's-cab camera controller (reference v2 追尾モード / driver ページ
 * の運転席ビューを同一ページに統合したもの)。
 *
 * Both modes follow a live TrainLayer mesh, so motion inherits the layer's
 * smoothstep interpolation — no separate physics. The cab speedometer shows
 * the train's actual scene velocity converted to km/h (概算), never a fake
 * schedule value.
 */
export class CabModeController {
  private mode: CabModeName = 'none';
  private trainId: string | null = null;

  private lastPos = new THREE.Vector3();
  private hasLast = false;
  private dir = new THREE.Vector3(0, 0, -1);
  private lastTickMs = 0;
  private speedKmh = 0;
  private lastHudMs = 0;

  // Scratch vectors (avoid per-frame allocation)
  private tmpA = new THREE.Vector3();
  private tmpB = new THREE.Vector3();

  constructor(
    private metro: MetroScene,
    private lookups: Lookups,
    private els: {
      chip: HTMLElement;
      chipBadge: HTMLElement;
      chipLabel: HTMLElement;
      cab: HTMLElement;
      cabBadge: HTMLElement;
      cabLine: HTMLElement;
      cabDest: HTMLElement;
      cabNow: HTMLElement;
      cabNext: HTMLElement;
      cabDist: HTMLElement;
      cabPfill: HTMLElement;
      cabKmh: HTMLElement;
      cabClock: HTMLElement;
      cabNotch: HTMLElement;
    },
    /** Notified on every mode change (e.g. hide 3D labels while in the cab). */
    private onModeChange?: (mode: CabModeName) => void
  ) {}

  private applyMode(mode: CabModeName): void {
    this.mode = mode;
    // Fade the model-view chrome away while driving — the cab is immersive.
    document.body.classList.toggle('cab-on', mode === 'cab');
    this.onModeChange?.(mode);
  }

  get current(): CabModeName {
    return this.mode;
  }

  enterChase(trainId: string): void {
    const entry = this.lookups.getTrain(trainId);
    if (!entry) return;
    this.restoreMesh();
    this.trainId = trainId;
    this.applyMode('chase');
    this.hasLast = false;
    this.metro.cancelFlight();
    this.metro.setControlsEnabled(false);

    const route = entry.train.routeId ? this.lookups.getRoute(entry.train.routeId) : undefined;
    const color = entry.train.routeId ? (ROUTE_COLORS[entry.train.routeId] ?? '#8a94ab') : '#8a94ab';
    this.els.chipBadge.style.color = color;
    this.els.chipBadge.textContent = route?.shortName ?? entry.train.routeId ?? '?';
    this.els.chipLabel.textContent = `${route?.longName ?? '—'} ${entry.train.trainId}`;
    this.els.chip.classList.add('on');
    this.els.cab.classList.remove('on');
  }

  enterCab(trainId?: string): void {
    const id = trainId ?? this.trainId;
    if (!id) return;
    const entry = this.lookups.getTrain(id);
    if (!entry) return;
    this.restoreMesh();
    this.trainId = id;
    this.applyMode('cab');
    this.hasLast = false;
    this.metro.cancelFlight();
    this.metro.setControlsEnabled(false);
    // The camera sits inside the car — hide the box so we see the tunnel view.
    entry.mesh.visible = false;

    const route = entry.train.routeId ? this.lookups.getRoute(entry.train.routeId) : undefined;
    const color = entry.train.routeId ? (ROUTE_COLORS[entry.train.routeId] ?? '#8a94ab') : '#8a94ab';
    this.els.cabBadge.style.color = color;
    this.els.cabBadge.textContent = route?.shortName ?? entry.train.routeId ?? '?';
    this.els.cabLine.textContent = route?.longName ?? '—';
    const terminals = entry.train.routeId
      ? this.lookups.getTerminals(entry.train.routeId)
      : undefined;
    const dest =
      terminals === undefined
        ? '—'
        : entry.train.directionId === '1'
          ? terminals.back
          : terminals.forward;
    this.els.cabDest.textContent = `${dest} 方面`;

    this.els.chip.classList.remove('on');
    this.els.cab.classList.add('on');
  }

  exit(): void {
    this.restoreMesh();
    const entry = this.trainId ? this.lookups.getTrain(this.trainId) : undefined;
    if (entry) {
      // Leave the orbit pivot at the train so the hand-back feels continuous.
      this.metro.controls.target.copy(entry.mesh.position);
    }
    this.applyMode('none');
    this.trainId = null;
    this.els.chip.classList.remove('on');
    this.els.cab.classList.remove('on');
    this.metro.setControlsEnabled(true);
  }

  private restoreMesh(): void {
    if (!this.trainId) return;
    const entry = this.lookups.getTrain(this.trainId);
    if (entry) entry.mesh.visible = true;
  }

  /** Per-frame follow + HUD. Register with MetroScene.onFrame(). */
  tick(nowMs: number): void {
    if (this.mode === 'none' || !this.trainId) return;
    const entry = this.lookups.getTrain(this.trainId);
    if (!entry) {
      // Train left the feed (or its line was hidden) — hand control back.
      this.exit();
      return;
    }

    const pos = entry.mesh.position;
    const dtMs = this.lastTickMs ? nowMs - this.lastTickMs : 16;
    this.lastTickMs = nowMs;

    if (this.hasLast) {
      this.tmpA.subVectors(pos, this.lastPos);
      const dist = this.tmpA.length();
      if (dist > 1e-4) {
        this.tmpA.normalize();
        // Smooth heading so cab view doesn't jitter at interpolation seams.
        this.dir.lerp(this.tmpA, 0.12).normalize();
      }
      // Actual scene velocity → km/h (概算), exponentially smoothed.
      const kmh = ((dist * this.lookups.kmPerUnit()) / (dtMs / 3_600_000));
      this.speedKmh += (kmh - this.speedKmh) * 0.08;
    }
    this.lastPos.copy(pos);
    this.hasLast = true;

    const cam = this.metro.camera;
    if (this.mode === 'chase') {
      // Third person: behind and above, looking at the car.
      this.tmpB.copy(pos).addScaledVector(this.dir, -20);
      this.tmpB.y += 11;
      cam.position.lerp(this.tmpB, 0.08);
      this.metro.controls.target.lerp(pos, 0.2);
      cam.lookAt(this.metro.controls.target);
    } else {
      // First person: at the windshield, looking down the line.
      this.tmpB.copy(pos).addScaledVector(this.dir, 2.4);
      this.tmpB.y += 1.4;
      cam.position.lerp(this.tmpB, 0.25);
      this.tmpA.copy(pos).addScaledVector(this.dir, 60);
      this.tmpA.y = this.tmpB.y - 0.4;
      cam.lookAt(this.tmpA);
      // HUD text ~5×/s is plenty and keeps the frame loop cheap.
      if (nowMs - this.lastHudMs > 200) {
        this.lastHudMs = nowMs;
        this.updateCabHud(entry.train, pos);
      }
    }
  }

  private updateCabHud(train: MetroTrain, pos: THREE.Vector3): void {
    this.els.cabKmh.textContent = String(Math.round(this.speedKmh));
    this.els.cabClock.textContent = this.lookups.clockText();

    const now = train.currentStationId ? this.lookups.getStation(train.currentStationId) : undefined;
    const next = train.nextStationId ? this.lookups.getStation(train.nextStationId) : undefined;
    this.els.cabNow.textContent = now?.name ?? '—';
    this.els.cabNext.textContent = next?.name ?? '—';

    if (now && next) {
      const seg = Math.hypot(next.x - now.x, next.z - now.z);
      const rest = Math.hypot(next.x - pos.x, next.z - pos.z);
      const meters = rest * this.lookups.kmPerUnit() * 1000;
      this.els.cabDist.textContent = `あと ${Math.max(Math.round(meters / 10) * 10, 0)} m`;
      const frac = seg > 1e-3 ? Math.min(Math.max(1 - rest / seg, 0), 1) : 0;
      this.els.cabPfill.style.width = `${(frac * 100).toFixed(1)}%`;
    } else {
      this.els.cabDist.textContent = '';
      this.els.cabPfill.style.width = '0%';
    }

    // Notch: first 2 bars = brake, rest = power (lit with speed).
    const bars = Array.from(this.els.cabNotch.children);
    const power = Math.round(Math.min(this.speedKmh / 160, 1) * (bars.length - 2));
    bars.forEach((bar, i) => {
      if (i < 2) bar.classList.toggle('lit', train.status === 'delay');
      else bar.classList.toggle('lit', i - 2 < power);
    });
  }
}
