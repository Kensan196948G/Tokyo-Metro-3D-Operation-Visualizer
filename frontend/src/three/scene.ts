import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { CAMERA_DEFAULT } from '../config/appConfig.js';

export class MetroScene {
  public scene: THREE.Scene;
  public camera: THREE.PerspectiveCamera;
  public renderer: THREE.WebGLRenderer;
  public controls: OrbitControls;

  constructor(container: HTMLElement) {
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x0d1117);
    this.scene.fog = new THREE.Fog(0x0d1117, 400, 800);

    // Grid
    const grid = new THREE.GridHelper(600, 60, 0x1c2128, 0x1c2128);
    this.scene.add(grid);

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
    for (const cb of this.frameCallbacks) cb(now);
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
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
