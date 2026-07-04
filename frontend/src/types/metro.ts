export type MetroRoute = {
  routeId: string;
  shortName: string;
  longName: string;
  color: string;
  textColor?: string;
  layerHeight: number;
  visible: boolean;
};

export type MetroStation = {
  stationId: string;
  name: string;
  lat: number;
  lon: number;
  x: number;
  y: number;
  z: number;
  routeIds: string[];
};

export type MetroRouteShape = {
  routeId: string;
  points: Array<{
    lat: number;
    lon: number;
    x: number;
    y: number;
    z: number;
    sequence: number;
  }>;
};

export type MetroTrain = {
  trainId: string;
  tripId?: string;
  routeId?: string;
  directionId?: string;
  status: 'normal' | 'delay' | 'suspended' | 'unknown';
  delaySeconds?: number;
  lat?: number;
  lon?: number;
  x: number;
  y: number;
  z: number;
  currentStationId?: string;
  nextStationId?: string;
  positionSource: 'gtfs-rt' | 'interpolated' | 'station-based' | 'mock';
  updatedAt: string;
};

export type MetroAlert = {
  alertId: string;
  routeIds: string[];
  stationIds?: string[];
  severity: 'info' | 'warning' | 'critical';
  title: string;
  description?: string;
  activePeriod?: {
    start?: string;
    end?: string;
  };
};

export type ApiResponse<T> = {
  ok: boolean;
  data?: T;
  meta: {
    generatedAt: string;
    sourceUpdatedAt?: string;
    stale: boolean;
  };
  error?: {
    code: string;
    message: string;
  };
};

export type HealthData = {
  service: string;
  status: 'healthy' | 'degraded' | 'critical';
  uptimeSeconds: number;
};

export type ApiStatus = {
  gtfsStaticFetchedAt?: string;
  gtfsRtFetchedAt?: string;
  gtfsRtFetchSuccess: boolean;
  consecutiveFailures: number;
  stale: boolean;
};
