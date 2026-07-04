import * as THREE from 'three';
import { MetroScene } from './three/scene.js';
import { StationLayer } from './three/stationLayer.js';
import { RouteLayer } from './three/routeLayer.js';
import { TrainLayer } from './three/trainLayer.js';
import {
  fetchHealth,
  fetchRoutes,
  fetchStations,
  fetchRouteShapes,
  fetchTrains,
  fetchAlerts,
} from './api/metroApi.js';
import type { MetroRoute, MetroStation, MetroRouteShape, MetroTrain, MetroAlert } from './types/metro.js';
import { UPDATE_INTERVAL_MS } from './config/appConfig.js';

// State
let routes: MetroRoute[] = [];
let stations: MetroStation[] = [];
let shapes: MetroRouteShape[] = [];
let trains: MetroTrain[] = [];
let alerts: MetroAlert[] = [];

// Scene setup
const container = document.getElementById('canvas-container')!;
const metro = new MetroScene(container);
const stationLayer = new StationLayer();
const routeLayer = new RouteLayer();
const trainLayer = new TrainLayer();

metro.scene.add(routeLayer.getGroup());
metro.scene.add(stationLayer.getGroup());
metro.scene.add(trainLayer.getGroup());

// Frame-by-frame train interpolation (smooth motion between 15s polls)
metro.onFrame((now) => trainLayer.tick(now));

// Raycaster for click/hover
const raycaster = new THREE.Raycaster();
const mouse = new THREE.Vector2();
const popup = document.getElementById('info-popup')!;

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

metro.renderer.domElement.addEventListener('mousemove', (e) => {
  const rect = metro.renderer.domElement.getBoundingClientRect();
  mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
  mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;

  raycaster.setFromCamera(mouse, metro.camera);
  const interactables = [...stationLayer.getMeshes(), ...trainLayer.getMeshes()];
  const hits = raycaster.intersectObjects(interactables);

  if (hits.length > 0) {
    const obj = hits[0].object as THREE.Mesh;
    const data = obj.userData;
    popup.style.display = 'block';
    popup.style.left = `${e.clientX + 12}px`;
    popup.style.top = `${e.clientY + 12}px`;
    if (data.type === 'station') {
      const s = data.station as MetroStation;
      popup.innerHTML = `<h3>🚉 ${esc(s.name)}</h3><p>路線: ${esc(s.routeIds.join(', '))}</p><p>座標: (${s.x.toFixed(1)}, ${s.z.toFixed(1)})</p>`;
    } else if (data.type === 'train') {
      const t = data.train as MetroTrain;
      popup.innerHTML = `<h3>🚆 ${esc(t.trainId)}</h3><p>路線: ${esc(t.routeId ?? '-')}</p><p>状態: ${esc(t.status)}</p>${t.delaySeconds ? `<p>遅延: ${Math.round(t.delaySeconds)}秒</p>` : ''}<p>出典: ${esc(t.positionSource)}</p>`;
    }
  } else {
    popup.style.display = 'none';
  }
});

// UI helpers
function updateRouteList(routes: MetroRoute[]): void {
  const el = document.getElementById('route-list')!;
  el.innerHTML = routes
    .map(
      (r) => `<div class="route-item" data-route="${esc(r.routeId)}">
        <span class="route-dot" style="background:${esc(r.color)}"></span>
        <span class="route-name">${esc(r.longName)}</span>
        <input type="checkbox" class="route-check" ${r.visible ? 'checked' : ''}>
      </div>`
    )
    .join('');
  el.querySelectorAll('.route-item').forEach((item) => {
    item.querySelector('input')?.addEventListener('change', (e) => {
      const routeId = (item as HTMLElement).dataset['route']!;
      const checked = (e.target as HTMLInputElement).checked;
      const route = routes.find((r) => r.routeId === routeId);
      if (route) {
        route.visible = checked;
        routeLayer.update(stations, routes, shapes);
        stationLayer.update(stations, routes);
        trainLayer.update(trains, routes);
      }
    });
  });
}

function updateAlertList(alerts: MetroAlert[]): void {
  const el = document.getElementById('alert-list')!;
  if (alerts.length === 0) {
    el.innerHTML = '<p style="font-size:11px;color:#8b949e;">アラートなし</p>';
    return;
  }
  el.innerHTML = alerts
    .map((a) => `<div class="alert-item alert-${esc(a.severity)}"><strong>${esc(a.title)}</strong>${a.description ? `<br>${esc(a.description)}` : ''}</div>`)
    .join('');
}

function updateTrainList(trains: MetroTrain[]): void {
  const el = document.getElementById('train-list')!;
  const limited = trains.slice(0, 10);
  el.innerHTML = limited
    .map((t) => `<div class="train-item">[${esc(t.routeId ?? '?')}] ${esc(t.trainId)} - ${esc(t.status)}${t.delaySeconds ? ` (+${Math.round(t.delaySeconds)}s)` : ''}</div>`)
    .join('');
  if (trains.length > 10) {
    el.innerHTML += `<div style="font-size:11px;color:#8b949e;">他 ${trains.length - 10} 列車</div>`;
  }
}

function setApiStatus(ok: boolean): void {
  const el = document.getElementById('api-status')!;
  const dot = el.previousElementSibling as HTMLElement;
  if (ok) {
    el.textContent = '接続中';
    dot.className = 'status-dot status-ok';
  } else {
    el.textContent = '未接続';
    dot.className = 'status-dot status-err';
  }
}

function setLastUpdate(): void {
  const el = document.getElementById('last-update')!;
  el.textContent = new Date().toLocaleTimeString('ja-JP');
}

// Initial load
async function init(): Promise<void> {
  const health = await fetchHealth();
  setApiStatus(!!health);

  [routes, stations, shapes, trains, alerts] = await Promise.all([
    fetchRoutes(),
    fetchStations(),
    fetchRouteShapes(),
    fetchTrains(),
    fetchAlerts(),
  ]);

  routeLayer.update(stations, routes, shapes);
  stationLayer.update(stations, routes);
  trainLayer.update(trains, routes);
  metro.fitToPoints(stations); // frame the whole network on first load

  updateRouteList(routes);
  updateAlertList(alerts);
  updateTrainList(trains);
  setLastUpdate();
}

// Periodic update
async function update(): Promise<void> {
  try {
    trains = await fetchTrains();
    alerts = await fetchAlerts();
    trainLayer.update(trains, routes);
    updateAlertList(alerts);
    updateTrainList(trains);
    setApiStatus(true);
    setLastUpdate();
  } catch {
    setApiStatus(false);
  }
}

init().catch(console.error);
setInterval(update, UPDATE_INTERVAL_MS);
