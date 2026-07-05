export type Operator = 'TokyoMetro' | 'JR-East';

export type MetroRoute = {
  routeId: string;
  shortName: string;
  longName: string;
  color: string;
  textColor?: string;
  layerHeight: number;
  visible: boolean;
  operator: Operator;
};

// Vertical convention: y=0 is ground level. Subway lines sit BELOW ground
// (negative layerHeight, stylised depth ordered by opening era — Ginza 1927
// shallowest, Fukutoshin 2008 deepest). Surface railways sit at/above ground.
export const TOKYO_METRO_ROUTES: MetroRoute[] = [
  { routeId: 'G', shortName: 'G', longName: '銀座線', color: '#FF9500', textColor: '#000000', layerHeight: -4, visible: true, operator: 'TokyoMetro' },
  { routeId: 'M', shortName: 'M', longName: '丸ノ内線', color: '#F62E36', textColor: '#FFFFFF', layerHeight: -8, visible: true, operator: 'TokyoMetro' },
  { routeId: 'H', shortName: 'H', longName: '日比谷線', color: '#9C9CB0', textColor: '#FFFFFF', layerHeight: -12, visible: true, operator: 'TokyoMetro' },
  { routeId: 'T', shortName: 'T', longName: '東西線', color: '#009BBF', textColor: '#FFFFFF', layerHeight: -16, visible: true, operator: 'TokyoMetro' },
  { routeId: 'C', shortName: 'C', longName: '千代田線', color: '#00BB85', textColor: '#FFFFFF', layerHeight: -20, visible: true, operator: 'TokyoMetro' },
  { routeId: 'Y', shortName: 'Y', longName: '有楽町線', color: '#C1A046', textColor: '#000000', layerHeight: -24, visible: true, operator: 'TokyoMetro' },
  { routeId: 'Z', shortName: 'Z', longName: '半蔵門線', color: '#8F76D6', textColor: '#FFFFFF', layerHeight: -28, visible: true, operator: 'TokyoMetro' },
  { routeId: 'N', shortName: 'N', longName: '南北線', color: '#00ACA9', textColor: '#FFFFFF', layerHeight: -32, visible: true, operator: 'TokyoMetro' },
  { routeId: 'F', shortName: 'F', longName: '副都心線', color: '#9C5E31', textColor: '#FFFFFF', layerHeight: -36, visible: true, operator: 'TokyoMetro' },
];

// JR East surface lines (ground/elevated band). Operation is mocked — the
// realtime GTFS-RT for JR East on ODPT is challenge-2026-licensed, so no live
// feed is wired up. Station coordinates are real.
export const JR_EAST_ROUTES: MetroRoute[] = [
  { routeId: 'JY', shortName: 'JY', longName: '山手線', color: '#80C241', textColor: '#000000', layerHeight: 2, visible: true, operator: 'JR-East' },
  { routeId: 'JK', shortName: 'JK', longName: '京浜東北線', color: '#00B2E5', textColor: '#000000', layerHeight: 5, visible: true, operator: 'JR-East' },
  { routeId: 'JC', shortName: 'JC', longName: '中央線快速', color: '#F15A22', textColor: '#FFFFFF', layerHeight: 8, visible: true, operator: 'JR-East' },
  { routeId: 'JB', shortName: 'JB', longName: '総武線各駅停車', color: '#FFD400', textColor: '#000000', layerHeight: 11, visible: true, operator: 'JR-East' },
  { routeId: 'JA', shortName: 'JA', longName: '埼京線', color: '#00AC9A', textColor: '#000000', layerHeight: 14, visible: true, operator: 'JR-East' },
];

export const ALL_ROUTES: MetroRoute[] = [...TOKYO_METRO_ROUTES, ...JR_EAST_ROUTES];
