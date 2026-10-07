// Utsunomiya Craft — データ加工の設定値（開発時のみ使用）

// 中心駅の特定条件（座標は fetch-osm.mjs が OSM から取得して data/raw/station.json に確定する）
export const STATION = {
  name: '宇都宮',
  operatorPattern: '東日本旅客鉄道',
  // 駅ノードを探す広めの検索範囲 [south, west, north, east]
  searchBBox: [36.50, 139.80, 36.62, 139.98],
};

// 原点からの範囲[m]。東西だけ別々に拡張できるよう方向ごとに持つ
export const RADIUS_M = 1000;
export const EXTENT = {
  west: RADIUS_M,
  east: RADIUS_M,
  north: RADIUS_M,
  south: RADIUS_M,
};

// OSM 取得時に範囲の外側へ追加する余白[m]（境界付近のポリゴン欠けを防ぐ）
export const FETCH_MARGIN_M = 100;

export const MAX_H = 96;

export const OVERPASS_URL = 'https://overpass-api.de/api/interpreter';
export const USER_AGENT = 'utsunomiya-craft/0.1 (personal, non-commercial)';

export const PATHS = {
  rawDir: 'data/raw',
  station: 'data/raw/station.json',
  osm: 'data/raw/osm.json',
  worldDir: 'public/world',
  previewDir: 'data/preview',
};
