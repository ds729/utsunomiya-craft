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

// スポーン探索の目標にする POI 名（JR宇都宮駅 東口）
export const SPAWN_POI_NAME = '宇都宮駅東口';

export const OVERPASS_URL = 'https://overpass-api.de/api/interpreter';
export const USER_AGENT = 'utsunomiya-craft/0.1 (personal, non-commercial)';

// PLATEAU 3D都市モデル 宇都宮市 2023年度版 CityGML（G空間情報センター、zip 約977MB）。
// 全体は落とさず、HTTP Range で範囲内の建物ファイル（3次メッシュ単位）だけを取り出す
export const PLATEAU = {
  dataset: 'https://www.geospatial.jp/ckan/dataset/plateau-09201-utsunomiya-shi-2023',
  zipUrl: 'https://assets.cms.plateau.reearth.io/assets/f8/3a8d50-57c9-4b5b-a700-a5ca80230c8a/09201_utsunomiya-shi_city_2023_citygml_2_op.zip',
  attribution: '3D都市モデル（Project PLATEAU）国土交通省',
};

// 国土地理院 標高タイル（テキスト形式）。DEM5A（5m、z15）を主に、欠測は DEM10B（10m、z14）で補う
export const DEM = {
  url: 'https://cyberjapandata.gsi.go.jp/xyz/{id}/{z}/{x}/{y}.txt',
  sources: [{ id: 'dem5a', z: 15 }, { id: 'dem', z: 14 }],
  attribution: '国土地理院 標高タイル',
};

export const PATHS = {
  rawDir: 'data/raw',
  station: 'data/raw/station.json',
  osm: 'data/raw/osm.json',
  worldDir: 'public/world',
  previewDir: 'data/preview',
  plateauDir: 'data/raw/plateau',
  demDir: 'data/raw/dem',
};
