// ブロック定義（純データ）。テクスチャはアトラスのタイル番号で参照する

// アトラスのタイル（atlas.js がこの順に Canvas で描く）
export const TILE_NAMES = [
  'grass', 'dirt', 'bedrock', 'asphalt', 'sidewalk', 'ballast', 'water', 'park', 'plaza', 'parking',
  'platform', 'tram', 'urban', 'farmland', 'forest', 'rail', 'deck', 'deck_side', 'roof', 'wall',
  'wall_window', 'grass_side', 'platform_side',
];
export const TILE = Object.fromEntries(TILE_NAMES.map((n, i) => [n, i]));

export const B = {
  AIR: 0, BEDROCK: 1, DIRT: 2, GRASS: 3, ASPHALT: 4, SIDEWALK: 5, BALLAST: 6, WATER: 7, PARK: 8,
  PLAZA: 9, PARKING: 10, PLATFORM: 11, TRAM: 12, URBAN: 13, FARMLAND: 14, FOREST: 15, RAIL: 16,
  DECK: 17, ROOF: 18, WALL: 19, WALL_WIN: 20,
};

const def = (top, side = top, bottom = side, extra = {}) => ({ top, side, bottom, solid: true, opaque: true, tint: false, ...extra });
// BLOCKS[id] = { top, side, bottom: タイル番号, solid: 衝突するか, opaque: 隣の面を隠すか, tint: 建物色で着色するか, topH: 上面の高さ }
export const BLOCKS = [];
BLOCKS[B.AIR] = { solid: false, opaque: false };
BLOCKS[B.BEDROCK] = def(TILE.bedrock);
BLOCKS[B.DIRT] = def(TILE.dirt);
BLOCKS[B.GRASS] = def(TILE.grass, TILE.grass_side, TILE.dirt);
BLOCKS[B.ASPHALT] = def(TILE.asphalt, TILE.dirt, TILE.dirt);
BLOCKS[B.SIDEWALK] = def(TILE.sidewalk, TILE.dirt, TILE.dirt);
BLOCKS[B.BALLAST] = def(TILE.ballast, TILE.dirt, TILE.dirt);
// 水は通り抜けられ（solid=false）、隣の面を隠さない。上面は少し低い
BLOCKS[B.WATER] = { ...def(TILE.water), solid: false, opaque: false, topH: 0.875 };
BLOCKS[B.PARK] = def(TILE.park, TILE.grass_side, TILE.dirt);
BLOCKS[B.PLAZA] = def(TILE.plaza, TILE.dirt, TILE.dirt);
BLOCKS[B.PARKING] = def(TILE.parking, TILE.dirt, TILE.dirt);
BLOCKS[B.PLATFORM] = def(TILE.platform, TILE.platform_side, TILE.platform_side);
BLOCKS[B.TRAM] = def(TILE.tram, TILE.dirt, TILE.dirt);
BLOCKS[B.URBAN] = def(TILE.urban, TILE.dirt, TILE.dirt);
BLOCKS[B.FARMLAND] = def(TILE.farmland, TILE.dirt, TILE.dirt);
BLOCKS[B.FOREST] = def(TILE.forest, TILE.grass_side, TILE.dirt);
BLOCKS[B.RAIL] = def(TILE.rail, TILE.dirt, TILE.dirt);
BLOCKS[B.DECK] = def(TILE.deck, TILE.deck_side, TILE.deck_side);
BLOCKS[B.ROOF] = def(TILE.roof, TILE.wall, TILE.wall, { tint: true });
BLOCKS[B.WALL] = def(TILE.wall, TILE.wall, TILE.wall, { tint: true });
BLOCKS[B.WALL_WIN] = def(TILE.wall, TILE.wall_window, TILE.wall, { tint: true });

export const SOLID = Uint8Array.from(BLOCKS, (b) => (b.solid ? 1 : 0));
export const OPAQUE = Uint8Array.from(BLOCKS, (b) => (b.opaque ? 1 : 0));

// world.json の materials（地表材質 ID）→ 地表ブロック。tools/lib/tags.mjs の MAT と同じ並び
export const GROUND_BLOCK = Uint8Array.from([
  B.GRASS, B.DIRT, B.ASPHALT, B.SIDEWALK, B.BALLAST, B.WATER, B.PARK,
  B.PLAZA, B.PARKING, B.PLATFORM, B.TRAM, B.URBAN, B.FARMLAND, B.FOREST, B.RAIL,
]);
export const MAT_WATER = 5, MAT_PLATFORM = 9, MAT_PLAZA = 7, MAT_SIDEWALK = 3;

// 建物種別（bldtype 下位4bit）ごとの壁の基本色 [r,g,b] 0..1
// other, house, apartment, commercial, office, station, industrial, public, small, roof, part
const WALL_BASE = [
  [0.80, 0.77, 0.72], [0.86, 0.78, 0.66], [0.82, 0.80, 0.76], [0.85, 0.72, 0.62], [0.68, 0.74, 0.82],
  [0.80, 0.82, 0.84], [0.70, 0.70, 0.68], [0.88, 0.84, 0.70], [0.72, 0.62, 0.52], [0.75, 0.75, 0.75],
  [0.78, 0.78, 0.80],
];
const ROOF_BASE = [
  [0.55, 0.55, 0.57], [0.45, 0.35, 0.32], [0.62, 0.62, 0.62], [0.58, 0.58, 0.60], [0.55, 0.58, 0.62],
  [0.60, 0.62, 0.64], [0.50, 0.55, 0.58], [0.52, 0.50, 0.46], [0.40, 0.38, 0.36], [0.62, 0.64, 0.66],
  [0.58, 0.58, 0.60],
];

// 建物の色: bldtype バイト（下位=種別, 上位=バリエーション）から壁/屋根色を決める
export function buildingColor(byte, roof) {
  const type = byte & 15, v = byte >> 4;
  const base = (roof ? ROOF_BASE : WALL_BASE)[type] || WALL_BASE[0];
  // バリエーション: 明るさ ±12%、色味を少し暖色/寒色に振る
  const k = 0.88 + (v & 3) * 0.08;
  const warm = ((v >> 2) - 1.5) * 0.03;
  return [Math.min(1, base[0] * k + warm), Math.min(1, base[1] * k), Math.min(1, base[2] * k - warm)];
}
