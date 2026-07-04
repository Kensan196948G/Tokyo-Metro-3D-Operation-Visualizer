export type MetroRoute = {
  routeId: string;
  shortName: string;
  longName: string;
  color: string;
  textColor?: string;
  layerHeight: number;
  visible: boolean;
};

export const TOKYO_METRO_ROUTES: MetroRoute[] = [
  { routeId: 'G', shortName: 'G', longName: '銀座線', color: '#FF9500', textColor: '#000000', layerHeight: 0, visible: true },
  { routeId: 'M', shortName: 'M', longName: '丸ノ内線', color: '#F62E36', textColor: '#FFFFFF', layerHeight: 10, visible: true },
  { routeId: 'H', shortName: 'H', longName: '日比谷線', color: '#9C9CB0', textColor: '#FFFFFF', layerHeight: 20, visible: true },
  { routeId: 'T', shortName: 'T', longName: '東西線', color: '#009BBF', textColor: '#FFFFFF', layerHeight: 30, visible: true },
  { routeId: 'C', shortName: 'C', longName: '千代田線', color: '#00BB85', textColor: '#FFFFFF', layerHeight: 40, visible: true },
  { routeId: 'Y', shortName: 'Y', longName: '有楽町線', color: '#C1A046', textColor: '#000000', layerHeight: 50, visible: true },
  { routeId: 'Z', shortName: 'Z', longName: '半蔵門線', color: '#8F76D6', textColor: '#FFFFFF', layerHeight: 60, visible: true },
  { routeId: 'N', shortName: 'N', longName: '南北線', color: '#00ACA9', textColor: '#FFFFFF', layerHeight: 70, visible: true },
  { routeId: 'F', shortName: 'F', longName: '副都心線', color: '#9C5E31', textColor: '#FFFFFF', layerHeight: 80, visible: true },
];
