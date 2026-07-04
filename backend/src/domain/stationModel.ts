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

// Tokyo center reference
export const CENTER_LAT = 35.6762;
export const CENTER_LON = 139.6503;
export const SCALE = 111320; // meters per degree

export function latLonToXZ(lat: number, lon: number): { x: number; z: number } {
  const x = (lon - CENTER_LON) * SCALE * Math.cos((CENTER_LAT * Math.PI) / 180) / 100;
  const z = -(lat - CENTER_LAT) * SCALE / 100;
  return { x, z };
}

// Mock stations for key Tokyo Metro stops
export const MOCK_STATIONS: MetroStation[] = [
  // 銀座線 (G)
  { stationId: 'G01', name: '渋谷', lat: 35.6581, lon: 139.7016, ...latLonToXZ(35.6581, 139.7016), y: 0, routeIds: ['G'] },
  { stationId: 'G02', name: '表参道', lat: 35.6654, lon: 139.7121, ...latLonToXZ(35.6654, 139.7121), y: 0, routeIds: ['G', 'C', 'H'] },
  { stationId: 'G03', name: '青山一丁目', lat: 35.6725, lon: 139.7178, ...latLonToXZ(35.6725, 139.7178), y: 0, routeIds: ['G'] },
  { stationId: 'G04', name: '外苑前', lat: 35.6727, lon: 139.7124, ...latLonToXZ(35.6727, 139.7124), y: 0, routeIds: ['G'] },
  { stationId: 'G05', name: '溜池山王', lat: 35.6741, lon: 139.7426, ...latLonToXZ(35.6741, 139.7426), y: 0, routeIds: ['G', 'N'] },
  { stationId: 'G06', name: '赤坂見附', lat: 35.6778, lon: 139.7362, ...latLonToXZ(35.6778, 139.7362), y: 0, routeIds: ['G', 'M'] },
  { stationId: 'G07', name: '新橋', lat: 35.6666, lon: 139.7584, ...latLonToXZ(35.6666, 139.7584), y: 0, routeIds: ['G'] },
  { stationId: 'G08', name: '銀座', lat: 35.6713, lon: 139.7645, ...latLonToXZ(35.6713, 139.7645), y: 0, routeIds: ['G', 'H', 'M'] },
  { stationId: 'G09', name: '京橋', lat: 35.6756, lon: 139.7705, ...latLonToXZ(35.6756, 139.7705), y: 0, routeIds: ['G'] },
  { stationId: 'G10', name: '日本橋', lat: 35.6826, lon: 139.7742, ...latLonToXZ(35.6826, 139.7742), y: 0, routeIds: ['G', 'T', 'A'] },
  { stationId: 'G11', name: '三越前', lat: 35.6840, lon: 139.7747, ...latLonToXZ(35.6840, 139.7747), y: 0, routeIds: ['G', 'H', 'Z'] },
  { stationId: 'G12', name: '神田', lat: 35.6916, lon: 139.7706, ...latLonToXZ(35.6916, 139.7706), y: 0, routeIds: ['G'] },
  { stationId: 'G13', name: '末広町', lat: 35.7070, lon: 139.7754, ...latLonToXZ(35.7070, 139.7754), y: 0, routeIds: ['G'] },
  { stationId: 'G14', name: '上野広小路', lat: 35.7088, lon: 139.7735, ...latLonToXZ(35.7088, 139.7735), y: 0, routeIds: ['G'] },
  { stationId: 'G15', name: '稲荷町', lat: 35.7133, lon: 139.7800, ...latLonToXZ(35.7133, 139.7800), y: 0, routeIds: ['G'] },
  { stationId: 'G16', name: '田原町', lat: 35.7117, lon: 139.7891, ...latLonToXZ(35.7117, 139.7891), y: 0, routeIds: ['G'] },
  { stationId: 'G17', name: '浅草', lat: 35.7117, lon: 139.7967, ...latLonToXZ(35.7117, 139.7967), y: 0, routeIds: ['G'] },
  // 丸ノ内線 (M)
  { stationId: 'M01', name: '荻窪', lat: 35.7033, lon: 139.6243, ...latLonToXZ(35.7033, 139.6243), y: 10, routeIds: ['M'] },
  { stationId: 'M02', name: '南阿佐ケ谷', lat: 35.7023, lon: 139.6420, ...latLonToXZ(35.7023, 139.6420), y: 10, routeIds: ['M'] },
  { stationId: 'M03', name: '新高円寺', lat: 35.7003, lon: 139.6548, ...latLonToXZ(35.7003, 139.6548), y: 10, routeIds: ['M'] },
  { stationId: 'M04', name: '東高円寺', lat: 35.6982, lon: 139.6627, ...latLonToXZ(35.6982, 139.6627), y: 10, routeIds: ['M'] },
  { stationId: 'M05', name: '新中野', lat: 35.6945, lon: 139.6679, ...latLonToXZ(35.6945, 139.6679), y: 10, routeIds: ['M'] },
  { stationId: 'M06', name: '中野坂上', lat: 35.6925, lon: 139.6773, ...latLonToXZ(35.6925, 139.6773), y: 10, routeIds: ['M'] },
  { stationId: 'M07', name: '西新宿', lat: 35.6913, lon: 139.6945, ...latLonToXZ(35.6913, 139.6945), y: 10, routeIds: ['M'] },
  { stationId: 'M08', name: '新宿', lat: 35.6896, lon: 139.7006, ...latLonToXZ(35.6896, 139.7006), y: 10, routeIds: ['M'] },
  { stationId: 'M09', name: '新宿三丁目', lat: 35.6892, lon: 139.7083, ...latLonToXZ(35.6892, 139.7083), y: 10, routeIds: ['M', 'F'] },
  { stationId: 'M10', name: '新宿御苑前', lat: 35.6852, lon: 139.7137, ...latLonToXZ(35.6852, 139.7137), y: 10, routeIds: ['M'] },
  { stationId: 'M11', name: '四谷三丁目', lat: 35.6850, lon: 139.7222, ...latLonToXZ(35.6850, 139.7222), y: 10, routeIds: ['M'] },
  { stationId: 'M12', name: '四ツ谷', lat: 35.6862, lon: 139.7310, ...latLonToXZ(35.6862, 139.7310), y: 10, routeIds: ['M', 'N'] },
  { stationId: 'M13', name: '赤坂見附', lat: 35.6778, lon: 139.7362, ...latLonToXZ(35.6778, 139.7362), y: 10, routeIds: ['M', 'G'] },
  { stationId: 'M14', name: '国会議事堂前', lat: 35.6737, lon: 139.7424, ...latLonToXZ(35.6737, 139.7424), y: 10, routeIds: ['M', 'C'] },
  { stationId: 'M15', name: '霞ケ関', lat: 35.6754, lon: 139.7492, ...latLonToXZ(35.6754, 139.7492), y: 10, routeIds: ['M', 'H', 'C'] },
  { stationId: 'M16', name: '銀座', lat: 35.6713, lon: 139.7645, ...latLonToXZ(35.6713, 139.7645), y: 10, routeIds: ['M', 'G', 'H'] },
  { stationId: 'M17', name: '東京', lat: 35.6812, lon: 139.7671, ...latLonToXZ(35.6812, 139.7671), y: 10, routeIds: ['M'] },
  { stationId: 'M18', name: '大手町', lat: 35.6841, lon: 139.7632, ...latLonToXZ(35.6841, 139.7632), y: 10, routeIds: ['M', 'T', 'C', 'Z', 'N'] },
  { stationId: 'M19', name: '淡路町', lat: 35.6937, lon: 139.7665, ...latLonToXZ(35.6937, 139.7665), y: 10, routeIds: ['M'] },
  { stationId: 'M20', name: '御茶ノ水', lat: 35.6978, lon: 139.7655, ...latLonToXZ(35.6978, 139.7655), y: 10, routeIds: ['M'] },
  { stationId: 'M21', name: '後楽園', lat: 35.7070, lon: 139.7522, ...latLonToXZ(35.7070, 139.7522), y: 10, routeIds: ['M', 'N'] },
  { stationId: 'M22', name: '本郷三丁目', lat: 35.7079, lon: 139.7618, ...latLonToXZ(35.7079, 139.7618), y: 10, routeIds: ['M'] },
  { stationId: 'M23', name: '春日', lat: 35.7076, lon: 139.7523, ...latLonToXZ(35.7076, 139.7523), y: 10, routeIds: ['M'] },
  { stationId: 'M24', name: '池袋', lat: 35.7298, lon: 139.7110, ...latLonToXZ(35.7298, 139.7110), y: 10, routeIds: ['M', 'Y', 'F'] },
  // 千代田線 (C)
  { stationId: 'C01', name: '代々木上原', lat: 35.6652, lon: 139.6842, ...latLonToXZ(35.6652, 139.6842), y: 40, routeIds: ['C'] },
  { stationId: 'C02', name: '代々木公園', lat: 35.6677, lon: 139.6927, ...latLonToXZ(35.6677, 139.6927), y: 40, routeIds: ['C'] },
  { stationId: 'C03', name: '明治神宮前', lat: 35.6693, lon: 139.7029, ...latLonToXZ(35.6693, 139.7029), y: 40, routeIds: ['C', 'F'] },
  { stationId: 'C04', name: '表参道', lat: 35.6654, lon: 139.7121, ...latLonToXZ(35.6654, 139.7121), y: 40, routeIds: ['C', 'G', 'H'] },
  { stationId: 'C05', name: '乃木坂', lat: 35.6645, lon: 139.7268, ...latLonToXZ(35.6645, 139.7268), y: 40, routeIds: ['C'] },
  { stationId: 'C06', name: '赤坂', lat: 35.6756, lon: 139.7376, ...latLonToXZ(35.6756, 139.7376), y: 40, routeIds: ['C'] },
  { stationId: 'C07', name: '国会議事堂前', lat: 35.6737, lon: 139.7424, ...latLonToXZ(35.6737, 139.7424), y: 40, routeIds: ['C', 'M'] },
  { stationId: 'C08', name: '霞ケ関', lat: 35.6754, lon: 139.7492, ...latLonToXZ(35.6754, 139.7492), y: 40, routeIds: ['C', 'M', 'H'] },
  { stationId: 'C09', name: '日比谷', lat: 35.6737, lon: 139.7581, ...latLonToXZ(35.6737, 139.7581), y: 40, routeIds: ['C', 'H'] },
  { stationId: 'C10', name: '二重橋前', lat: 35.6799, lon: 139.7605, ...latLonToXZ(35.6799, 139.7605), y: 40, routeIds: ['C'] },
  { stationId: 'C11', name: '大手町', lat: 35.6841, lon: 139.7632, ...latLonToXZ(35.6841, 139.7632), y: 40, routeIds: ['C', 'M', 'T', 'Z', 'N'] },
  { stationId: 'C12', name: '新御茶ノ水', lat: 35.6958, lon: 139.7644, ...latLonToXZ(35.6958, 139.7644), y: 40, routeIds: ['C'] },
  { stationId: 'C13', name: '湯島', lat: 35.7067, lon: 139.7699, ...latLonToXZ(35.7067, 139.7699), y: 40, routeIds: ['C'] },
  { stationId: 'C14', name: '根津', lat: 35.7208, lon: 139.7620, ...latLonToXZ(35.7208, 139.7620), y: 40, routeIds: ['C'] },
  { stationId: 'C15', name: '千駄木', lat: 35.7273, lon: 139.7621, ...latLonToXZ(35.7273, 139.7621), y: 40, routeIds: ['C'] },
  { stationId: 'C16', name: '西日暮里', lat: 35.7323, lon: 139.7664, ...latLonToXZ(35.7323, 139.7664), y: 40, routeIds: ['C'] },
];
