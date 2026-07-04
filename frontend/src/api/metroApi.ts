import { API_BASE_URL } from '../config/appConfig.js';
import type { MetroRoute, MetroStation, MetroTrain, MetroAlert, ApiResponse, HealthData, ApiStatus } from '../types/metro.js';

async function fetchApi<T>(path: string): Promise<T | null> {
  try {
    const res = await fetch(`${API_BASE_URL}${path}`);
    if (!res.ok) {
      console.error(`API error: ${res.status} ${path}`);
      return null;
    }
    const json = (await res.json()) as ApiResponse<T>;
    if (!json.ok) {
      console.error(`API not ok: ${path}`, json.error);
      return null;
    }
    return json.data ?? null;
  } catch (err) {
    console.error(`Fetch error: ${path}`, err);
    return null;
  }
}

export async function fetchHealth(): Promise<HealthData | null> {
  return fetchApi<HealthData>('/api/health');
}

export async function fetchRoutes(): Promise<MetroRoute[]> {
  return (await fetchApi<MetroRoute[]>('/api/routes')) ?? [];
}

export async function fetchStations(): Promise<MetroStation[]> {
  return (await fetchApi<MetroStation[]>('/api/stations')) ?? [];
}

export async function fetchTrains(): Promise<MetroTrain[]> {
  return (await fetchApi<MetroTrain[]>('/api/realtime/trains')) ?? [];
}

export async function fetchAlerts(): Promise<MetroAlert[]> {
  return (await fetchApi<MetroAlert[]>('/api/realtime/alerts')) ?? [];
}

export async function fetchApiStatus(): Promise<ApiStatus | null> {
  return fetchApi<ApiStatus>('/api/status');
}
