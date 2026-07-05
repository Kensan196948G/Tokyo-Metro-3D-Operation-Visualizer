import * as THREE from 'three';
import type { MetroStation } from '../types/metro.js';

/**
 * Ground basemap (reference v2's 地形マップ): CARTO dark raster tiles are
 * stitched into one canvas texture and laid under the network at y≈0.
 * Attribution (© OpenStreetMap contributors / © CARTO) is shown in the
 * panel footer. Tiles load lazily; failures leave dark gaps (no retry).
 */
const TILE = 256;
const ZOOM = 13; // ~8km tiles at Tokyo latitude — city detail without bulk
const MAX_TILES = 120; // safety cap (network bbox at z13 is ~5×5)

const tileUrl = (z: number, x: number, y: number): string =>
  `https://basemaps.cartocdn.com/dark_all/${z}/${x}/${y}.png`;

// Web-Mercator slippy-map tile math
const lon2tile = (lon: number, z: number): number => ((lon + 180) / 360) * 2 ** z;
const lat2tile = (lat: number, z: number): number => {
  const r = (lat * Math.PI) / 180;
  return ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * 2 ** z;
};
const tile2lon = (x: number, z: number): number => (x / 2 ** z) * 360 - 180;
const tile2lat = (y: number, z: number): number => {
  const n = Math.PI - (2 * Math.PI * y) / 2 ** z;
  return (180 / Math.PI) * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)));
};

export class MapLayer {
  private group = new THREE.Group();
  private material: THREE.MeshBasicMaterial | null = null;
  private built = false;

  getGroup(): THREE.Group {
    return this.group;
  }

  setVisible(visible: boolean): void {
    this.group.visible = visible;
  }

  setOpacity(opacity: number): void {
    if (this.material) this.material.opacity = opacity;
  }

  /**
   * Builds the map plane once from station data. The lon/lat→scene affine is
   * derived from two far-apart stations, so this stays correct even if the
   * backend projection constants change.
   */
  async build(stations: MetroStation[], opacity: number): Promise<void> {
    if (this.built || stations.length < 2) return;
    this.built = true;

    // Affine fit: x = ax·lon + bx, z = az·lat + bz (scene is equirectangular)
    const a = stations[0];
    let b = stations[1];
    let bestD = 0;
    for (const s of stations) {
      const d = (s.x - a.x) ** 2 + (s.z - a.z) ** 2;
      if (d > bestD) {
        bestD = d;
        b = s;
      }
    }
    if (Math.abs(b.lon - a.lon) < 1e-9 || Math.abs(b.lat - a.lat) < 1e-9) return;
    const ax = (b.x - a.x) / (b.lon - a.lon);
    const bx = a.x - ax * a.lon;
    const az = (b.z - a.z) / (b.lat - a.lat);
    const bz = a.z - az * a.lat;
    const lonToX = (lon: number): number => ax * lon + bx;
    const latToZ = (lat: number): number => az * lat + bz;

    // Station bbox + 15% margin → covering tile block
    let minLat = 90;
    let maxLat = -90;
    let minLon = 180;
    let maxLon = -180;
    for (const s of stations) {
      minLat = Math.min(minLat, s.lat);
      maxLat = Math.max(maxLat, s.lat);
      minLon = Math.min(minLon, s.lon);
      maxLon = Math.max(maxLon, s.lon);
    }
    const mLat = (maxLat - minLat) * 0.15;
    const mLon = (maxLon - minLon) * 0.15;
    const x0 = Math.floor(lon2tile(minLon - mLon, ZOOM));
    const x1 = Math.floor(lon2tile(maxLon + mLon, ZOOM));
    const y0 = Math.floor(lat2tile(maxLat + mLat, ZOOM)); // tile y grows southward
    const y1 = Math.floor(lat2tile(minLat - mLat, ZOOM));
    const cols = x1 - x0 + 1;
    const rows = y1 - y0 + 1;
    if (cols * rows > MAX_TILES) return;

    const canvas = document.createElement('canvas');
    canvas.width = cols * TILE;
    canvas.height = rows * TILE;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    await Promise.all(
      Array.from({ length: cols * rows }, (_, i) => {
        const tx = x0 + (i % cols);
        const ty = y0 + Math.floor(i / cols);
        return new Promise<void>((resolve) => {
          const img = new Image();
          img.crossOrigin = 'anonymous'; // required for WebGL texture upload
          img.onload = (): void => {
            ctx.drawImage(img, (tx - x0) * TILE, (ty - y0) * TILE);
            resolve();
          };
          img.onerror = (): void => resolve(); // gap stays dark — acceptable
          img.src = tileUrl(ZOOM, tx, ty);
        });
      })
    );

    // Map the tile block's corner lat/lons through the affine. Mercator vs
    // equirectangular mismatch across ~30km of Tokyo is <0.4% — invisible here.
    const west = lonToX(tile2lon(x0, ZOOM));
    const east = lonToX(tile2lon(x1 + 1, ZOOM));
    const north = latToZ(tile2lat(y0, ZOOM));
    const south = latToZ(tile2lat(y1 + 1, ZOOM));

    // Explicit quad (double-sided) so uv orientation is unambiguous:
    // canvas row 0 = north edge, texture flipY makes v=1 the top.
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute(
      'position',
      new THREE.BufferAttribute(
        new Float32Array([
          west, 0, north, east, 0, north, east, 0, south,
          west, 0, north, east, 0, south, west, 0, south,
        ]),
        3
      )
    );
    geometry.setAttribute(
      'uv',
      new THREE.BufferAttribute(new Float32Array([0, 1, 1, 1, 1, 0, 0, 1, 1, 0, 0, 0]), 2)
    );

    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = 4;
    this.material = new THREE.MeshBasicMaterial({
      map: texture,
      transparent: true,
      opacity,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const mesh = new THREE.Mesh(geometry, this.material);
    mesh.position.y = -0.08; // just under the grid, no z-fight (depthWrite off)
    mesh.renderOrder = -1;
    this.group.add(mesh);
  }
}
