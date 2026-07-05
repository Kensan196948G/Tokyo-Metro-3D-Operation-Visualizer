export const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? '';

export const ROUTE_COLORS: Record<string, string> = {
  G: '#FF9500',
  M: '#F62E36',
  H: '#9C9CB0',
  T: '#009BBF',
  C: '#00BB85',
  Y: '#C1A046',
  Z: '#8F76D6',
  N: '#00ACA9',
  F: '#9C5E31',
  // JR East surface lines
  JY: '#80C241',
  JK: '#00B2E5',
  JC: '#F15A22',
  JB: '#FFD400',
  JA: '#00AC9A',
};

export const STATUS_COLORS = {
  normal: '#3fb950',
  delay: '#d29922',
  suspended: '#f85149',
  unknown: '#8b949e',
} as const;

export const UPDATE_INTERVAL_MS = 15_000;

export const CAMERA_DEFAULT = {
  x: 0,
  y: 150,
  z: 200,
  targetX: 0,
  targetY: 0,
  targetZ: 0,
} as const;
