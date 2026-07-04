export type TrainStatus = 'normal' | 'delay' | 'suspended' | 'unknown';

export type MetroTrain = {
  trainId: string;
  tripId?: string;
  routeId?: string;
  directionId?: string;
  status: TrainStatus;
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
