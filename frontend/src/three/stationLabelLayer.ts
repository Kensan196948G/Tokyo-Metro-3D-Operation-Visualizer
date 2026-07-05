import * as THREE from 'three';
import type { MetroStation, MetroRoute } from '../types/metro.js';

export type LabelMode = 'none' | 'major' | 'all';

type LabelEntry = { sprite: THREE.Sprite; major: boolean };

/**
 * Billboard station-name labels rendered as canvas-texture sprites.
 *
 * "Major" stations are interchanges (stations served by 2+ lines) — the app
 * has no curated importance flag, so shared stations are a faithful heuristic
 * for the reference design's "主要駅" tier.
 */
export class StationLabelLayer {
  private group = new THREE.Group();
  private entries: LabelEntry[] = [];
  private mode: LabelMode = 'major';

  getGroup(): THREE.Group {
    return this.group;
  }

  setMode(mode: LabelMode): void {
    this.mode = mode;
    this.applyVisibility();
  }

  private applyVisibility(): void {
    for (const e of this.entries) {
      e.sprite.visible =
        this.mode === 'all' || (this.mode === 'major' && e.major);
    }
  }

  update(stations: MetroStation[], routes: MetroRoute[], depthScale = 1): void {
    this.dispose();

    const routeHeight = new Map(routes.map((r) => [r.routeId, r.layerHeight]));
    const routeVisible = new Map(routes.map((r) => [r.routeId, r.visible]));

    for (const station of stations) {
      const primary = station.routeIds[0];
      if (!primary) continue;
      if (!routeVisible.get(primary)) continue;

      const major = station.routeIds.length >= 2;
      const sprite = this.makeLabel(station.name, major);
      const y = (routeHeight.get(primary) ?? 0) * depthScale + 3.2;
      sprite.position.set(station.x, y, station.z);
      this.group.add(sprite);
      this.entries.push({ sprite, major });
    }

    this.applyVisibility();
  }

  /** Draws the name onto a canvas and wraps it in a camera-facing sprite. */
  private makeLabel(text: string, major: boolean): THREE.Sprite {
    const dpr = 2;
    const fontPx = 30;
    const pad = 8;
    const weight = major ? 700 : 500;
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('2D canvas context unavailable');

    // Measure first, then sizing the canvas resets the context — re-apply font.
    ctx.font = `${weight} ${fontPx}px sans-serif`;
    const textW = ctx.measureText(text).width;
    canvas.width = Math.ceil((textW + pad * 2) * dpr);
    canvas.height = Math.ceil((fontPx + pad * 2) * dpr);
    ctx.scale(dpr, dpr);
    ctx.font = `${weight} ${fontPx}px sans-serif`;
    ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';
    const midY = (fontPx + pad * 2) / 2;
    // Dark halo keeps white text legible over the glowing lines.
    ctx.strokeStyle = 'rgba(2,4,10,0.92)';
    ctx.lineWidth = 5;
    ctx.strokeText(text, pad, midY);
    ctx.fillStyle = major ? '#ffffff' : 'rgba(214,222,238,0.9)';
    ctx.fillText(text, pad, midY);

    const texture = new THREE.CanvasTexture(canvas);
    texture.minFilter = THREE.LinearFilter;
    const material = new THREE.SpriteMaterial({
      map: texture,
      transparent: true,
      depthTest: false,
      depthWrite: false,
    });
    const sprite = new THREE.Sprite(material);
    const worldH = major ? 4.2 : 3.4;
    const aspect = canvas.width / canvas.height;
    sprite.scale.set(worldH * aspect, worldH, 1);
    sprite.renderOrder = 10;
    return sprite;
  }

  /** Frees GPU textures/materials before rebuilding — sprites are not GC-cheap. */
  private dispose(): void {
    for (const e of this.entries) {
      const mat = e.sprite.material as THREE.SpriteMaterial;
      mat.map?.dispose();
      mat.dispose();
      this.group.remove(e.sprite);
    }
    this.entries = [];
  }
}
