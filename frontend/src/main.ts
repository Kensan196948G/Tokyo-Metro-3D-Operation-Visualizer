import * as THREE from 'three';
import { MetroScene } from './three/scene.js';
import { StationLayer } from './three/stationLayer.js';
import { RouteLayer } from './three/routeLayer.js';
import { TrainLayer } from './three/trainLayer.js';
import { StationLabelLayer, type LabelMode } from './three/stationLabelLayer.js';
import { PillarLayer } from './three/pillarLayer.js';
import { CabModeController } from './ui/cabMode.js';
import { TourController } from './ui/tour.js';
import { FactsRotator } from './ui/facts.js';
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
let kmPerUnit = 1; // scene-unit → km, derived from real coordinates at init

const stationById = new Map<string, MetroStation>();
const routeById = new Map<string, MetroRoute>();

// ---------------------------------------------------------------------------
// Scene
// ---------------------------------------------------------------------------
const container = document.getElementById('canvas-container')!;
const metro = new MetroScene(container);
const stationLayer = new StationLayer();
const routeLayer = new RouteLayer();
const trainLayer = new TrainLayer();
const labelLayer = new StationLabelLayer();
const pillarLayer = new PillarLayer();

metro.scene.add(routeLayer.getGroup());
metro.scene.add(pillarLayer.getGroup());
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

function routeHeightOf(station: MetroStation): number {
  const primary = station.routeIds[0];
  return (primary ? (routeById.get(primary)?.layerHeight ?? 0) : 0) * depthScale;
}

function haversineKm(aLat: number, aLon: number, bLat: number, bLon: number): number {
  const R = 6371;
  const dLat = ((bLat - aLat) * Math.PI) / 180;
  const dLon = ((bLon - aLon) * Math.PI) / 180;
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((aLat * Math.PI) / 180) * Math.cos((bLat * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

/** Derives the scene-unit → km ratio from the two farthest-apart stations. */
function computeKmPerUnit(): number {
  if (stations.length < 2) return 1;
  const a = stations[0];
  let best = stations[1];
  let bestD = 0;
  for (const s of stations) {
    const d = (s.x - a.x) ** 2 + (s.z - a.z) ** 2;
    if (d > bestD) {
      bestD = d;
      best = s;
    }
  }
  const sceneDist = Math.sqrt(bestD);
  if (sceneDist < 1e-6) return 1;
  return haversineKm(a.lat, a.lon, best.lat, best.lon) / sceneDist;
}

/** Rebuilds every depth-dependent layer from current state + depthScale. */
function rebuildLayers(): void {
  routeLayer.update(stations, routes, shapes, depthScale);
  stationLayer.update(stations, routes, depthScale);
  labelLayer.update(stations, routes, depthScale);
  pillarLayer.update(stations, routes, depthScale);
  trainLayer.update(trains, routes, depthScale);
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

function tokyoClockText(): string {
  const { h, m, s } = tokyoParts();
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

// ---------------------------------------------------------------------------
// Chase / driver-cab controller + cinematic tour
// ---------------------------------------------------------------------------
const cab = new CabModeController(
  metro,
  {
    getTrain: (id) => trainLayer.getTrain(id),
    getStation: (id) => stationById.get(id),
    getRoute: (id) => routeById.get(id),
    getTerminals: (routeId) => {
      const line = stations
        .filter((s) => s.routeIds[0] === routeId)
        .sort((a, b) => a.stationId.localeCompare(b.stationId));
      if (line.length < 2) return undefined;
      // Mock direction '0' progresses from first → last sorted station.
      return { forward: line[line.length - 1].name, back: line[0].name };
    },
    kmPerUnit: () => kmPerUnit,
    clockText: tokyoClockText,
  },
  {
    chip: byId('chase'),
    chipBadge: byId('chase-badge'),
    chipLabel: byId('chase-label'),
    cab: byId('cab'),
    cabBadge: byId('cab-badge'),
    cabLine: byId('cab-line'),
    cabDest: byId('cab-dest'),
    cabNow: byId('cab-now'),
    cabNext: byId('cab-next'),
    cabDist: byId('cab-dist'),
    cabPfill: byId('cab-pfill'),
    cabKmh: byId('cab-kmh'),
    cabClock: byId('cab-clock'),
    cabNotch: byId('cab-notch'),
  },
  (mode) => {
    // Billboard labels render through geometry (depthTest:false) and turn
    // into giant white blobs at windshield distance — hide them in the cab.
    labelLayer.getGroup().visible = mode !== 'cab';
  }
);
metro.onFrame((now) => cab.tick(now));

const tour = new TourController(
  metro,
  {
    cap: byId('tourcap'),
    capMain: byId('tc-main'),
    capSub: byId('tc-sub'),
    exitBtn: byId('tour-exit'),
  },
  () => metro.setControlsEnabled(true)
);

/** Leaves any exclusive camera mode before starting another. */
function leaveModes(): void {
  if (cab.current !== 'none') cab.exit();
  if (tour.active) tour.stop();
}

// ---------------------------------------------------------------------------
// Hover popup + click-to-chase (raycast against station + train meshes)
// ---------------------------------------------------------------------------
const raycaster = new THREE.Raycaster();
const mouse = new THREE.Vector2();
const popup = byId('info-popup');

function pickAt(clientX: number, clientY: number): THREE.Mesh | null {
  const rect = metro.renderer.domElement.getBoundingClientRect();
  mouse.x = ((clientX - rect.left) / rect.width) * 2 - 1;
  mouse.y = -((clientY - rect.top) / rect.height) * 2 + 1;
  raycaster.setFromCamera(mouse, metro.camera);
  const interactables = [...stationLayer.getMeshes(), ...trainLayer.getMeshes()];
  const hits = raycaster.intersectObjects(interactables);
  return hits.length > 0 ? (hits[0].object as THREE.Mesh) : null;
}

metro.renderer.domElement.addEventListener('mousemove', (e) => {
  if (cab.current === 'cab') {
    popup.style.display = 'none';
    return;
  }
  const obj = pickAt(e.clientX, e.clientY);
  if (obj) {
    const data = obj.userData;
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
        (t.delaySeconds ? `<p>遅延: ${Math.round(t.delaySeconds)}秒</p>` : '') +
        `<p style="color:var(--gold)">クリックで追尾</p>`;
    }
  } else {
    popup.style.display = 'none';
  }
});

// Click (not drag) on a train enters chase mode — reference v2's
// 「列車をクリック → 追尾モード」.
let downX = 0;
let downY = 0;
metro.renderer.domElement.addEventListener('pointerdown', (e) => {
  downX = e.clientX;
  downY = e.clientY;
});
metro.renderer.domElement.addEventListener('pointerup', (e) => {
  if (Math.hypot(e.clientX - downX, e.clientY - downY) > 5) return; // drag, not click
  if (cab.current === 'cab') return;
  const obj = pickAt(e.clientX, e.clientY);
  if (obj?.userData['type'] === 'train') {
    const t = obj.userData['train'] as MetroTrain;
    if (tour.active) tour.stop();
    cab.enterChase(t.trainId);
    popup.style.display = 'none';
  }
});

// ---------------------------------------------------------------------------
// Line list (left panel) — row click toggles visibility, 運転 enters the cab
// ---------------------------------------------------------------------------
function stationCount(routeId: string): number {
  return stations.filter((s) => s.routeIds.includes(routeId)).length;
}

const OPERATOR_GROUPS: Array<{ op: MetroRoute['operator']; label: string; en: string }> = [
  { op: 'TokyoMetro', label: '地下鉄 · 東京メトロ', en: 'SUBWAY' },
  { op: 'JR-East', label: '地上鉄道 · JR東日本', en: 'SURFACE' },
];

function lineRowHtml(r: MetroRoute): string {
  const color = ROUTE_COLORS[r.routeId] ?? r.color ?? '#8a94ab';
  const letter = esc(r.shortName || r.routeId);
  return `<div class="line-row${r.visible ? '' : ' off'}" data-route="${esc(r.routeId)}">
    <span class="line-badge${letter.length > 1 ? ' wide' : ''}" style="color:${esc(color)}">${letter}</span>
    <span class="line-name">${esc(r.longName)}</span>
    <span class="line-count">${stationCount(r.routeId)}駅</span>
    <button class="line-drive-btn" data-drive="${esc(r.routeId)}">運転</button>
  </div>`;
}

function updateLineList(): void {
  const el = byId('line-list');
  el.innerHTML = OPERATOR_GROUPS.map(({ op, label, en }) => {
    const group = routes.filter((r) => r.operator === op);
    if (group.length === 0) return '';
    const anyOn = group.some((r) => r.visible);
    return `<div class="line-group-head" data-group="${esc(op)}">
        <span>${en}<i>${esc(label)}</i></span>
        <button class="group-toggle" data-group-toggle="${esc(op)}">${anyOn ? '一括OFF' : '一括ON'}</button>
      </div>${group.map(lineRowHtml).join('')}`;
  }).join('');

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
  el.querySelectorAll<HTMLButtonElement>('.line-drive-btn').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation(); // don't toggle the line row
      const trainId = trainLayer.firstTrainOnRoute(btn.dataset['drive']!);
      if (trainId) {
        if (tour.active) tour.stop();
        cab.enterCab(trainId);
      }
    });
  });
  // Group master toggle: turn the whole operator on/off, then re-render the
  // list (rebinds listeners and refreshes the button label consistently).
  el.querySelectorAll<HTMLButtonElement>('.group-toggle').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const op = btn.dataset['groupToggle'];
      const group = routes.filter((r) => r.operator === op);
      const anyOn = group.some((r) => r.visible);
      group.forEach((r) => (r.visible = !anyOn));
      rebuildLayers();
      updateLineList();
    });
  });
}

// ---------------------------------------------------------------------------
// Station search (incremental, fly-to on select)
// ---------------------------------------------------------------------------
function wireSearch(): void {
  const input = byId<HTMLInputElement>('search');
  const res = byId('search-res');

  const flyToStation = (s: MetroStation): void => {
    leaveModes();
    const y = routeHeightOf(s);
    metro.flyTo(
      { x: s.x + 26, y: Math.max(y, 0) + 22, z: s.z + 26 },
      { x: s.x, y, z: s.z },
      1600
    );
    res.classList.remove('show');
    input.blur();
  };

  const render = (): void => {
    const q = input.value.trim();
    if (!q) {
      res.classList.remove('show');
      return;
    }
    const hits = stations.filter((s) => s.name.includes(q)).slice(0, 8);
    if (hits.length === 0) {
      res.classList.remove('show');
      return;
    }
    res.innerHTML = hits
      .map(
        (s, i) => `<div class="sr-item" data-i="${i}">
          <span>${esc(s.name)}</span>
          <span class="sr-badges">${s.routeIds
            .map((r) => `<i style="color:${esc(ROUTE_COLORS[r] ?? '#8a94ab')}">${esc(r)}</i>`)
            .join('')}</span>
        </div>`
      )
      .join('');
    res.classList.add('show');
    res.querySelectorAll<HTMLElement>('.sr-item').forEach((item) => {
      // mousedown (not click) so it fires before the input's blur hides the list
      item.addEventListener('mousedown', () => flyToStation(hits[Number(item.dataset['i'])]));
    });
  };

  input.addEventListener('input', render);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      const first = stations.find((s) => s.name.includes(input.value.trim()));
      if (first) flyToStation(first);
    }
  });
  input.addEventListener('blur', () => setTimeout(() => res.classList.remove('show'), 150));
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

function setLastUpdate(): void {
  byId('last-update').textContent = tokyoClockText();
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
  bindToggle('toggle-pillars', (on) => pillarLayer.setVisible(on));
  bindToggle('toggle-rotate', (on) => metro.setAutoRotate(on));

  // Play / pause (freezes train motion)
  const playbtn = byId('playbtn');
  playbtn.addEventListener('click', () => {
    const paused = !metro.isPaused();
    metro.setPaused(paused);
    playbtn.textContent = paused ? '▶' : '❚❚';
    playbtn.title = paused ? '再開' : '一時停止';
  });

  // Camera presets
  document.querySelectorAll<HTMLButtonElement>('.viewbtns button[data-view]').forEach((btn) => {
    btn.addEventListener('click', () => {
      leaveModes();
      metro.setView(btn.dataset['view'] as 'bird' | 'top' | 'side' | 'under', stations);
    });
  });

  // Cinematic tour
  byId('tour-btn').addEventListener('click', () => {
    leaveModes();
    metro.setControlsEnabled(false);
    tour.start(stations, (s) => routeHeightOf(s));
  });
  byId('tour-exit').addEventListener('click', () => tour.stop());

  // Driver cab: whole-network button picks the first live train
  byId('drive-btn').addEventListener('click', () => {
    const first = trains[0];
    if (!first) return;
    if (tour.active) tour.stop();
    cab.enterCab(first.trainId);
  });
  byId('cab-exit').addEventListener('click', () => cab.exit());
  byId('chase-cab').addEventListener('click', () => cab.enterCab());
  byId('chase-exit').addEventListener('click', () => cab.exit());

  // ESC backs out of the current exclusive mode
  window.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (cab.current !== 'none') cab.exit();
    else if (tour.active) tour.stop();
  });

  // Screenshot — render explicitly first so the buffer is fresh when read.
  byId('shotbtn').addEventListener('click', () => {
    metro.renderer.render(metro.scene, metro.camera);
    const a = document.createElement('a');
    a.href = metro.renderer.domElement.toDataURL('image/png');
    a.download = `tokyo-metro-3d-${Date.now()}.png`;
    a.click();
  });

  wireSearch();
}

// ---------------------------------------------------------------------------
// Compass — north is -Z in scene space (z = -(lat - CENTER_LAT))
// ---------------------------------------------------------------------------
function wireCompass(): void {
  const needle = document.getElementById('compass-needle');
  if (!needle) return;
  let lastDeg = NaN;
  metro.onFrame(() => {
    const deg = Math.round(metro.getAzimuthDeg());
    if (deg !== lastDeg) {
      lastDeg = deg;
      needle.setAttribute('transform', `rotate(${deg}, 30, 30)`);
    }
  });
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
  wireCompass();
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

  stationById.clear();
  for (const s of stations) stationById.set(s.stationId, s);
  routeById.clear();
  for (const r of routes) routeById.set(r.routeId, r);
  kmPerUnit = computeKmPerUnit();

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

  new FactsRotator(byId('f-body'), byId('f-dots')).start();
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
// First refresh arrives early: the initial snapshot places trains with
// from==to (no glide), so motion only starts at the next poll — pull that
// forward so the scene (and cab speedometer) comes alive within seconds.
setTimeout(update, 3000);
setInterval(update, UPDATE_INTERVAL_MS);
