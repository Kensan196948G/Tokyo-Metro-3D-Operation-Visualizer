import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { CAMERA_DEFAULT } from '../config/appConfig.js';

export class MetroScene {
  public scene: THREE.Scene;
  public camera: THREE.PerspectiveCamera;
  public renderer: THREE.WebGLRenderer;
  public controls: OrbitControls;

  private grid: THREE.GridHelper;
  private paused = false;

  constructor(container: HTMLElement) {
    this.scene = new THREE.Scene();
    // Near-black navy to match the reference "underground void" backdrop.
    this.scene.background = new THREE.Color(0x05070d);
    this.scene.fog = new THREE.Fog(0x05070d, 420, 900);

    // Terrain grid — dim so the glowing lines read as the focal layer.
    this.grid = new THREE.GridHelper(600, 60, 0x16213b, 0x0f1626);
    (this.grid.material as THREE.Material).transparent = true;
    (this.grid.material as THREE.Material).opacity = 0.6;
    this.scene.add(this.grid);

    // Camera
    const aspect = container.clientWidth / container.clientHeight;
    this.camera = new THREE.PerspectiveCamera(45, aspect, 0.1, 2000);
    this.camera.position.set(CAMERA_DEFAULT.x, CAMERA_DEFAULT.y, CAMERA_DEFAULT.z);
    this.camera.lookAt(CAMERA_DEFAULT.targetX, CAMERA_DEFAULT.targetY, CAMERA_DEFAULT.targetZ);

    // Renderer
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(container.clientWidth, container.clientHeight);
    container.appendChild(this.renderer.domElement);

    // Lights
    const ambient = new THREE.AmbientLight(0xffffff, 0.6);
    this.scene.add(ambient);
    const dirLight = new THREE.DirectionalLight(0xffffff, 0.8);
    dirLight.position.set(100, 200, 100);
    this.scene.add(dirLight);

    // Controls
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.05;
    this.controls.maxPolarAngle = Math.PI * 0.85;

    // Grabbing the scene cancels any in-flight camera tween — the user wins.
    this.renderer.domElement.addEventListener('pointerdown', () => this.cancelFlight());

    // Resize
    window.addEventListener('resize', () => this.onResize(container));

    // Animate
    this.animate();
  }

  private onResize(container: HTMLElement): void {
    const w = container.clientWidth;
    const h = container.clientHeight;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
  }

  private frameCallbacks: Array<(nowMs: number) => void> = [];

  /** Registers a callback invoked every animation frame (for interpolation). */
  onFrame(cb: (nowMs: number) => void): void {
    this.frameCallbacks.push(cb);
  }

  // ---- camera flight (tween) ----
  private flight: {
    fromPos: THREE.Vector3;
    toPos: THREE.Vector3;
    fromTarget: THREE.Vector3;
    toTarget: THREE.Vector3;
    start: number;
    duration: number;
    resumeControls: boolean;
    onDone?: () => void;
  } | null = null;

  /** Smoothly flies the camera to a new position/look-target. */
  flyTo(
    pos: { x: number; y: number; z: number },
    target: { x: number; y: number; z: number },
    durationMs = 1400,
    onDone?: () => void
  ): void {
    // Chained flights (tours) must restore the ORIGINAL pre-flight state, not
    // the mid-flight disabled state a naive read would capture.
    const resumeControls = this.flight ? this.flight.resumeControls : this.controls.enabled;
    this.flight = {
      fromPos: this.camera.position.clone(),
      toPos: new THREE.Vector3(pos.x, pos.y, pos.z),
      fromTarget: this.controls.target.clone(),
      toTarget: new THREE.Vector3(target.x, target.y, target.z),
      start: performance.now(),
      duration: Math.max(durationMs, 1),
      resumeControls,
      onDone,
    };
    // Damping would fight the tween — hand control back when it lands.
    this.controls.enabled = false;
  }

  cancelFlight(): void {
    if (!this.flight) return;
    this.controls.enabled = this.flight.resumeControls;
    this.flight = null;
  }

  isFlying(): boolean {
    return this.flight !== null;
  }

  private stepFlight(now: number): void {
    if (!this.flight) return;
    const f = this.flight;
    const t = Math.min((now - f.start) / f.duration, 1);
    const e = t * t * (3 - 2 * t); // smoothstep ease in-out
    this.camera.position.lerpVectors(f.fromPos, f.toPos, e);
    this.controls.target.lerpVectors(f.fromTarget, f.toTarget, e);
    this.camera.lookAt(this.controls.target);
    if (t >= 1) {
      this.controls.enabled = f.resumeControls;
      this.flight = null;
      f.onDone?.();
    }
  }

  private animate(): void {
    requestAnimationFrame(() => this.animate());
    const now = performance.now();
    // When paused, freeze motion (skip interpolation callbacks) but keep
    // rendering so orbit/zoom stays responsive.
    if (!this.paused) {
      for (const cb of this.frameCallbacks) cb(now);
    }
    this.stepFlight(now);
    if (this.controls.enabled) this.controls.update();
    this.renderer.render(this.scene, this.camera);
  }

  /** Freeze/resume per-frame animation (train interpolation, delay pulse). */
  setPaused(paused: boolean): void {
    this.paused = paused;
  }

  isPaused(): boolean {
    return this.paused;
  }

  /** Show/hide the terrain reference grid. */
  setGridVisible(visible: boolean): void {
    this.grid.visible = visible;
  }

  resetCamera(): void {
    this.camera.position.set(CAMERA_DEFAULT.x, CAMERA_DEFAULT.y, CAMERA_DEFAULT.z);
    this.controls.target.set(CAMERA_DEFAULT.targetX, CAMERA_DEFAULT.targetY, CAMERA_DEFAULT.targetZ);
    this.controls.update();
  }

  private computeBounds(points: Array<{ x: number; z: number }>): {
    centerX: number;
    centerZ: number;
    distance: number;
  } {
    let minX = Infinity;
    let maxX = -Infinity;
    let minZ = Infinity;
    let maxZ = -Infinity;
    for (const p of points) {
      if (p.x < minX) minX = p.x;
      if (p.x > maxX) maxX = p.x;
      if (p.z < minZ) minZ = p.z;
      if (p.z > maxZ) maxZ = p.z;
    }
    const spread = Math.max(maxX - minX, maxZ - minZ, 50);
    const fovRad = (this.camera.fov * Math.PI) / 180;
    // Distance so the spread fits vertically with ~20% margin
    const distance = (spread * 1.2) / (2 * Math.tan(fovRad / 2));
    return { centerX: (minX + maxX) / 2, centerZ: (minZ + maxZ) / 2, distance };
  }

  /**
   * Frames the camera so the given XZ points fill the view. The geo center
   * (config CENTER_LON) sits west of the actual network centroid, so a fixed
   * origin-look leaves the network off-screen right — fit to data instead.
   */
  fitToPoints(points: Array<{ x: number; z: number }>): void {
    if (points.length === 0) return;
    const { centerX, centerZ, distance } = this.computeBounds(points);
    this.controls.target.set(centerX, 0, centerZ);
    // Tilted bird's-eye: pull back along +Z and up along +Y from the target
    this.camera.position.set(centerX, distance * 0.8, centerZ + distance * 0.75);
    this.controls.update();
  }

  /** Smoothly flies to one of the reference camera presets. */
  setView(preset: 'bird' | 'top' | 'side' | 'under', points: Array<{ x: number; z: number }>): void {
    if (points.length === 0) return;
    const { centerX, centerZ, distance } = this.computeBounds(points);
    const target = { x: centerX, y: 0, z: centerZ };
    let pos: { x: number; y: number; z: number };
    switch (preset) {
      case 'top':
        // Almost straight down; tiny Z offset keeps OrbitControls' up-vector stable.
        pos = { x: centerX, y: distance * 1.15, z: centerZ + distance * 0.02 };
        break;
      case 'side':
        // Low southern vantage looking north — reads as a cross-section.
        pos = { x: centerX, y: distance * 0.12, z: centerZ + distance * 1.05 };
        break;
      case 'under':
        // From below the plane looking up at the model's underside.
        pos = { x: centerX, y: -distance * 0.55, z: centerZ + distance * 0.4 };
        break;
      case 'bird':
      default:
        pos = { x: centerX, y: distance * 0.8, z: centerZ + distance * 0.75 };
        break;
    }
    this.flyTo(pos, target, 1400);
  }

  setAutoRotate(on: boolean): void {
    this.controls.autoRotate = on;
    this.controls.autoRotateSpeed = 0.6;
  }

  setControlsEnabled(on: boolean): void {
    this.controls.enabled = on;
  }

  /** Camera azimuth in degrees (0 = viewer facing north; scene north is -Z). */
  getAzimuthDeg(): number {
    const dx = this.camera.position.x - this.controls.target.x;
    const dz = this.camera.position.z - this.controls.target.z;
    return (Math.atan2(dx, dz) * 180) / Math.PI;
  }
}
