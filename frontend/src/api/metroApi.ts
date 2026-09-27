import { API_BASE_URL } from '../config/appConfig.js';
import type { MetroRoute, MetroStation, MetroRouteShape, MetroTrain, MetroAlert, ApiResponse, HealthData, ApiStatus } from '../types/metro.js';

async function fetchResponse<T>(path: string): Promise<ApiResponse<T> | null> {
  try {
    const res = await fetch(`${API_BASE_URL}${path}`, { signal: AbortSignal.timeout(10_000) });
    if (!res.ok) {
      console.error(`API error: ${res.status} ${path}`);
      return null;
    }
    const json = (await res.json()) as ApiResponse<T>;
    if (!json.ok || json.data === undefined || json.data === null) {
      console.error(`API not ok: ${path}`);
      return null;
    }
    return json;
  } catch {
    console.error(`Fetch error: ${path}`);
    return null;
  }
}

async function fetchApi<T>(path: string): Promise<T | null> {
  return (await fetchResponse<T>(path))?.data ?? null;
}

async function fetchArrayResponse<T>(path: string): Promise<ApiResponse<T[]> | null> {
  const response = await fetchResponse<T[]>(path);
  if (!Array.isArray(response?.data) || response.data.some(item => !item || typeof item !== 'object')) {
    return null;
  }
  return response;
}

export async function fetchHealth(): Promise<HealthData | null> {
  return fetchApi<HealthData>('/api/health');
}

export async function fetchRoutes(): Promise<MetroRoute[] | null> {
  return (await fetchArrayResponse<MetroRoute>('/api/routes'))?.data ?? null;
}

export async function fetchStations(): Promise<MetroStation[] | null> {
  return (await fetchArrayResponse<MetroStation>('/api/stations'))?.data ?? null;
}

export async function fetchRouteShapes(): Promise<MetroRouteShape[] | null> {
  return (await fetchArrayResponse<MetroRouteShape>('/api/route-shapes'))?.data ?? null;
}

export async function fetchTrains(): Promise<MetroTrain[] | null> {
  return (await fetchTrainSnapshot())?.data ?? null;
}

export async function fetchTrainSnapshot(): Promise<ApiResponse<MetroTrain[]> | null> {
  const response = await fetchArrayResponse<MetroTrain>('/api/realtime/trains');
  if (response?.data?.some(train => typeof train.trainId !== 'string' ||
    ![train.x, train.y, train.z].every(Number.isFinite))) return null;
  return response;
}

export async function fetchAlerts(): Promise<MetroAlert[] | null> {
  return (await fetchArrayResponse<MetroAlert>('/api/realtime/alerts'))?.data ?? null;
}

export async function fetchApiStatus(): Promise<ApiStatus | null> {
  return fetchApi<ApiStatus>('/api/status');
}
