import type { MetroScene } from '../three/scene.js';
import type { MetroStation } from '../types/metro.js';

type Waypoint = {
  station: MetroStation;
  y: number;
};

/**
 * Cinematic tour (reference v2's ▶ シネマティックツアー): the camera glides
 * between major interchange stations while a caption introduces each stop.
 * Pure camera choreography — no data is simulated.
 */
export class TourController {
  private token = 0;
  private running = false;

  constructor(
    private metro: MetroScene,
    private els: {
      cap: HTMLElement;
      capMain: HTMLElement;
      capSub: HTMLElement;
      exitBtn: HTMLElement;
    },
    private onExit: () => void
  ) {}

  get active(): boolean {
    return this.running;
  }

  /** Picks well-spread interchange stations as tour stops. */
  private pickWaypoints(stations: MetroStation[], getY: (s: MetroStation) => number): Waypoint[] {
    const majors = stations
      .filter((s) => s.routeIds.length >= 3)
      .sort((a, b) => b.routeIds.length - a.routeIds.length);
    const picked: MetroStation[] = [];
    for (const s of majors) {
      // Keep stops spatially apart so the camera actually travels.
      if (picked.every((p) => (p.x - s.x) ** 2 + (p.z - s.z) ** 2 > 30 ** 2)) {
        picked.push(s);
      }
      if (picked.length >= 7) break;
    }
    // Fallback for sparse data: any interchange.
    if (picked.length < 3) {
      picked.push(...stations.filter((s) => s.routeIds.length >= 2).slice(0, 5));
    }
    return picked.map((station) => ({ station, y: getY(station) }));
  }

  start(stations: MetroStation[], getY: (s: MetroStation) => number): void {
    const waypoints = this.pickWaypoints(stations, getY);
    if (waypoints.length === 0) return;

    this.running = true;
    const myToken = ++this.token;
    this.els.cap.classList.add('on');
    this.els.exitBtn.classList.add('on');

    const visit = (i: number): void => {
      if (this.token !== myToken) return;
      const wp = waypoints[i % waypoints.length];
      const s = wp.station;

      // Vary approach angle per stop so consecutive shots feel composed.
      const angle = (i * 2.4) % (Math.PI * 2);
      const dist = 55;
      this.metro.flyTo(
        {
          x: s.x + Math.sin(angle) * dist,
          y: Math.max(wp.y, 0) + 30,
          z: s.z + Math.cos(angle) * dist,
        },
        { x: s.x, y: wp.y, z: s.z },
        3000,
        () => {
          if (this.token !== myToken) return;
          setTimeout(() => visit(i + 1), 2600);
        }
      );

      this.els.capMain.textContent = s.name;
      this.els.capSub.textContent = `${s.routeIds.join(' · ')} — ${s.routeIds.length}路線 乗換`;
    };
    visit(0);
  }

  stop(): void {
    if (!this.running) return;
    this.token++;
    this.running = false;
    this.metro.cancelFlight();
    this.els.cap.classList.remove('on');
    this.els.exitBtn.classList.remove('on');
    this.onExit();
  }
}
