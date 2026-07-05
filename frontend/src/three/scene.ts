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

  private animate(): void {
    requestAnimationFrame(() => this.animate());
    const now = performance.now();
    // When paused, freeze motion (skip interpolation callbacks) but keep
    // rendering so orbit/zoom stays responsive.
    if (!this.paused) {
      for (const cb of this.frameCallbacks) cb(now);
    }
    this.controls.update();
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

  /**
   * Frames the camera so the given XZ points fill the view. The geo center
   * (config CENTER_LON) sits west of the actual network centroid, so a fixed
   * origin-look leaves the network off-screen right — fit to data instead.
   */
  fitToPoints(points: Array<{ x: number; z: number }>): void {
    if (points.length === 0) return;
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
    const centerX = (minX + maxX) / 2;
    const centerZ = (minZ + maxZ) / 2;
    const spread = Math.max(maxX - minX, maxZ - minZ, 50);
    const fovRad = (this.camera.fov * Math.PI) / 180;
    // Distance so the spread fits vertically with ~20% margin
    const distance = (spread * 1.2) / (2 * Math.tan(fovRad / 2));

    this.controls.target.set(centerX, 0, centerZ);
    // Tilted bird's-eye: pull back along +Z and up along +Y from the target
    this.camera.position.set(centerX, distance * 0.8, centerZ + distance * 0.75);
    this.controls.update();
  }
}
