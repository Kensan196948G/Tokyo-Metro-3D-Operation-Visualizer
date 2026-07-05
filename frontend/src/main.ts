import * as THREE from 'three';
import { MetroScene } from './three/scene.js';
import { StationLayer } from './three/stationLayer.js';
import { RouteLayer } from './three/routeLayer.js';
import { TrainLayer } from './three/trainLayer.js';
import { StationLabelLayer, type LabelMode } from './three/stationLabelLayer.js';
import {
  fetchHealth,
  fetchRoutes,
  fetchStations,
  fetchRouteShapes,
  fetchTrains,
  fetchAlerts,
} from './api/metroApi.js';
import type {
  MetroRoute,
  MetroStation,
  MetroRouteShape,
  MetroTrain,
  MetroAlert,
} from './types/metro.js';
import { ROUTE_COLORS, UPDATE_INTERVAL_MS } from './config/appConfig.js';

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------
let routes: MetroRoute[] = [];
let stations: MetroStation[] = [];
let shapes: MetroRouteShape[] = [];
let trains: MetroTrain[] = [];
let alerts: MetroAlert[] = [];

let depthScale = 1;
let labelMode: LabelMode = 'major';

// ---------------------------------------------------------------------------
// Scene
// ---------------------------------------------------------------------------
const container = document.getElementById('canvas-container')!;
const metro = new MetroScene(container);
const stationLayer = new StationLayer();
const routeLayer = new RouteLayer();
const trainLayer = new TrainLayer();
const labelLayer = new StationLabelLayer();

metro.scene.add(routeLayer.getGroup());
metro.scene.add(stationLayer.getGroup());
metro.scene.add(labelLayer.getGroup());
metro.scene.add(trainLayer.getGroup());

// Frame-by-frame train interpolation (smooth motion between 15s polls)
metro.onFrame((now) => trainLayer.tick(now));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// Alert/station text originates from external GTFS feeds — always escape
// before inserting into innerHTML.
function esc(value: unknown): string {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function byId<T extends HTMLElement = HTMLElement>(id: string): T {
  return document.getElementById(id) as T;
}

/** Rebuilds every depth-dependent layer from current state + depthScale. */
function rebuildLayers(): void {
  routeLayer.update(stations, routes, shapes, depthScale);
  stationLayer.update(stations, routes, depthScale);
  labelLayer.update(stations, routes, depthScale);
  trainLayer.update(trains, routes, depthScale);
}

// ---------------------------------------------------------------------------
// Hover popup (raycast against station + train meshes)
// ---------------------------------------------------------------------------
const raycaster = new THREE.Raycaster();
const mouse = new THREE.Vector2();
const popup = byId('info-popup');

metro.renderer.domElement.addEventListener('mousemove', (e) => {
  const rect = metro.renderer.domElement.getBoundingClientRect();
  mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
  mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;

  raycaster.setFromCamera(mouse, metro.camera);
  const interactables = [...stationLayer.getMeshes(), ...trainLayer.getMeshes()];
  const hits = raycaster.intersectObjects(interactables);

  if (hits.length > 0) {
    const data = (hits[0].object as THREE.Mesh).userData;
    popup.style.display = 'block';
    popup.style.left = `${e.clientX + 14}px`;
    popup.style.top = `${e.clientY + 14}px`;
    if (data['type'] === 'station') {
      const s = data['station'] as MetroStation;
      popup.innerHTML =
        `<h3>${esc(s.name)}</h3>` +
        `<p class="en">STATION</p>` +
        `<p>路線: ${esc(s.routeIds.join(' · '))}</p>`;
    } else if (data['type'] === 'train') {
      const t = data['train'] as MetroTrain;
      popup.innerHTML =
        `<h3>${esc(t.routeId ?? '—')} ${esc(t.trainId)}</h3>` +
        `<p class="en">TRAIN · ${esc(t.positionSource)}</p>` +
        `<p>状態: ${esc(t.status)}</p>` +
        (t.delaySeconds ? `<p>遅延: ${Math.round(t.delaySeconds)}秒</p>` : '');
    }
  } else {
    popup.style.display = 'none';
  }
});

// ---------------------------------------------------------------------------
// Line list (left panel) — row click toggles visibility
// ---------------------------------------------------------------------------
function stationCount(routeId: string): number {
  return stations.filter((s) => s.routeIds.includes(routeId)).length;
}

function updateLineList(): void {
  const el = byId('line-list');
  el.innerHTML = routes
    .map((r) => {
      const color = ROUTE_COLORS[r.routeId] ?? r.color ?? '#8a94ab';
      const letter = esc(r.shortName || r.routeId);
      return `<div class="line-row${r.visible ? '' : ' off'}" data-route="${esc(r.routeId)}">
        <span class="line-badge" style="color:${esc(color)}">${letter}</span>
        <span class="line-name">${esc(r.longName)}</span>
        <span class="line-count">${stationCount(r.routeId)}駅</span>
      </div>`;
    })
    .join('');

  el.querySelectorAll<HTMLElement>('.line-row').forEach((row) => {
    row.addEventListener('click', () => {
      const routeId = row.dataset['route']!;
      const route = routes.find((r) => r.routeId === routeId);
      if (!route) return;
      route.visible = !route.visible;
      row.classList.toggle('off', !route.visible);
      rebuildLayers();
    });
  });
}

// ---------------------------------------------------------------------------
// Alerts
// ---------------------------------------------------------------------------
function updateAlertList(): void {
  const el = byId('alert-list');
  el.innerHTML = alerts
    .map(
      (a) =>
        `<div class="alert-item alert-${esc(a.severity)}"><strong>${esc(a.title)}</strong>${
          a.description ? `<br>${esc(a.description)}` : ''
        }</div>`
    )
    .join('');
}

// ---------------------------------------------------------------------------
// Header HUD + live clock + data source
// ---------------------------------------------------------------------------
function setApiStatus(ok: boolean): void {
  const dot = byId('api-dot');
  const text = byId('api-status');
  dot.className = `status-dot ${ok ? 'status-ok' : 'status-err'}`;
  text.textContent = ok ? '接続中' : '未接続';
}

/** Current time in Asia/Tokyo regardless of the viewer's timezone — this is a
 * Tokyo transit visualiser, so the clock and rush-hour phases follow Tokyo. */
function tokyoParts(): { h: number; m: number; s: number } {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Tokyo',
    hourCycle: 'h23',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(new Date());
  const get = (t: string): number => Number(parts.find((p) => p.type === t)?.value ?? '0');
  return { h: get('hour'), m: get('minute'), s: get('second') };
}

function setLastUpdate(): void {
  const { h, m, s } = tokyoParts();
  byId('last-update').textContent =
    `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function updateStats(): void {
  byId('stat-lines').textContent = String(routes.length);
  byId('stat-stations').textContent = String(stations.length);
}

function updateTrainCount(): void {
  byId('train-count').textContent = String(trains.length);
}

/** LIVE when any train comes from the realtime feed; DEMO for mock-only data. */
function updateDataSource(): void {
  const el = byId('data-src');
  const hasReal = trains.some(
    (t) => t.positionSource === 'gtfs-rt' || t.positionSource === 'interpolated'
  );
  if (trains.length === 0) {
    el.className = 'datasrc';
    el.textContent = 'SOURCE –';
  } else if (hasReal) {
    el.className = 'datasrc live';
    el.textContent = 'LIVE 実データ';
  } else {
    el.className = 'datasrc mock';
    el.textContent = 'DEMO モック';
  }
}

const PHASES: Array<{ until: number; label: string }> = [
  { until: 5, label: '深夜' },
  { until: 7, label: '早朝' },
  { until: 9, label: '朝ラッシュ' },
  { until: 11, label: '午前' },
  { until: 14, label: '日中' },
  { until: 17, label: '午後' },
  { until: 19, label: '夕ラッシュ' },
  { until: 23, label: '夜' },
  { until: 24, label: '深夜' },
];

function phaseLabel(hour: number): string {
  return PHASES.find((p) => hour < p.until)?.label ?? 'LIVE';
}

/** Ticks the Tokyo wall clock + day-progress indicator once per second. */
function tickClock(): void {
  const { h, m, s } = tokyoParts();
  byId('sim-clock').textContent = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  byId('sim-phase').textContent = phaseLabel(h);

  const dayFrac = (h * 3600 + m * 60 + s) / 86400;
  const pct = `${(dayFrac * 100).toFixed(2)}%`;
  byId('day-fill').style.width = pct;
  byId('day-knob').style.left = pct;
}

// ---------------------------------------------------------------------------
// Control wiring
// ---------------------------------------------------------------------------
function bindToggle(id: string, onChange: (on: boolean) => void): void {
  const el = byId(id);
  el.addEventListener('click', () => {
    const on = !el.classList.contains('on');
    el.classList.toggle('on', on);
    onChange(on);
  });
}

let depthRebuildQueued = false;
function wireControls(): void {
  // Panel collapse
  const panel = byId('panel');
  const tab = byId('panel-tab');
  tab.addEventListener('click', () => {
    const hidden = panel.classList.toggle('hidden');
    tab.textContent = hidden ? '▸ PANEL' : '◂ PANEL';
  });

  // Depth exaggeration — rebuild at most once per frame while dragging.
  const depthRange = byId<HTMLInputElement>('depth-range');
  const depthVal = byId('depth-val');
  depthRange.addEventListener('input', () => {
    depthScale = parseFloat(depthRange.value);
    depthVal.textContent = `×${depthScale.toFixed(1)}`;
    if (!depthRebuildQueued) {
      depthRebuildQueued = true;
      requestAnimationFrame(() => {
        depthRebuildQueued = false;
        rebuildLayers();
      });
    }
  });

  // Label density segmented control
  const seg = byId('label-seg');
  seg.querySelectorAll<HTMLButtonElement>('button').forEach((btn) => {
    btn.addEventListener('click', () => {
      seg.querySelectorAll('button').forEach((b) => b.classList.remove('on'));
      btn.classList.add('on');
      labelMode = (btn.dataset['labels'] as LabelMode) ?? 'major';
      labelLayer.setMode(labelMode);
    });
  });

  // Display toggles
  bindToggle('toggle-grid', (on) => metro.setGridVisible(on));
  bindToggle('toggle-trains', (on) => {
    trainLayer.getGroup().visible = on;
  });
  bindToggle('toggle-pulse', (on) => trainLayer.setPulseEnabled(on));

  // Play / pause (freezes train motion)
  const playbtn = byId('playbtn');
  playbtn.addEventListener('click', () => {
    const paused = !metro.isPaused();
    metro.setPaused(paused);
    playbtn.textContent = paused ? '▶' : '❚❚';
    playbtn.title = paused ? '再開' : '一時停止';
  });

  // View buttons
  byId('view-fit').addEventListener('click', () => metro.fitToPoints(stations));
  byId('view-reset').addEventListener('click', () => metro.resetCamera());
}

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------
function dismissLoader(): void {
  byId('loader').classList.add('done');
  byId('header').classList.add('rise');
  byId('panel').classList.add('rise');
  byId('timebar').classList.add('rise');
}

async function init(): Promise<void> {
  wireControls();
  tickClock();
  setInterval(tickClock, 1000);

  const health = await fetchHealth();
  setApiStatus(!!health);

  [routes, stations, shapes, trains, alerts] = await Promise.all([
    fetchRoutes(),
    fetchStations(),
    fetchRouteShapes(),
    fetchTrains(),
    fetchAlerts(),
  ]);

  rebuildLayers();
  labelLayer.setMode(labelMode);
  metro.fitToPoints(stations); // frame the whole network on first load

  updateLineList();
  updateAlertList();
  updateStats();
  updateTrainCount();
  updateDataSource();
  setLastUpdate();
  dismissLoader();
}

// Periodic refresh of live data
async function update(): Promise<void> {
  try {
    trains = await fetchTrains();
    alerts = await fetchAlerts();
    trainLayer.update(trains, routes, depthScale);
    updateAlertList();
    updateTrainCount();
    updateDataSource();
    setApiStatus(true);
    setLastUpdate();
  } catch {
    setApiStatus(false);
  }
}

init().catch((err) => {
  console.error(err);
  dismissLoader();
});
setInterval(update, UPDATE_INTERVAL_MS);
