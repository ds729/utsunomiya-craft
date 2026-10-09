// data/raw/osm.json → public/world/{ground,bld,bldtype,deck}.bin + world.json
// 使い方: node tools/build-world.mjs
import fs from 'node:fs';
import zlib from 'node:zlib';
import { EXTENT, MAX_H, PATHS, SPAWN_POI_NAME, PLATEAU, DEM } from './config.mjs';
import { buildWorld } from './lib/world.mjs';
import { parseBuildings, applyPlateau } from './lib/plateau.mjs';
import { findTeleports } from './lib/teleports.mjs';
import { buildTramRoutes } from './lib/tram.mjs';
import { buildDecor } from './lib/decor.mjs';
import { makeWorld } from '../public/src/world-data.js';
import { makeProjection } from './lib/geo.mjs';
import { MAT_NAMES, BTYPE_NAMES } from './lib/tags.mjs';
import { parseDemText, lonLatToPixel, sampleTiles, fillGaps } from './lib/dem.mjs';
import { buildTerrain } from './lib/terrain.mjs';

const t0 = performance.now();
const osm = JSON.parse(fs.readFileSync(PATHS.osm, 'utf8'));
const w = buildWorld(osm, EXTENT);

// --plateau: PLATEAU（data/raw/plateau/*.gml）の建物高さを OSM より優先して取り込む
const usePlateau = process.argv.includes('--plateau');
let plateauStats = null;
if (usePlateau) {
  const files = fs.readdirSync(PATHS.plateauDir).filter((f) => f.endsWith('.gml'));
  if (!files.length) throw new Error(`${PATHS.plateauDir} に gml がありません。node tools/fetch-plateau.mjs を先に実行してください`);
  const blds = [];
  for (const f of files) blds.push(...parseBuildings(fs.readFileSync(`${PATHS.plateauDir}/${f}`, 'utf8')));
  plateauStats = applyPlateau(w, blds, ([lat, lon]) => w.toGrid({ lat, lon }), w.owner);
  console.log('PLATEAU', plateauStats);
}

// --dem: 国土地理院 標高タイル（data/raw/dem/）から地表の起伏を作る（無指定なら平坦 = すべて 0）
const useDem = process.argv.includes('--dem');
let terrain = { g: new Uint8Array(w.W * w.H), base: 0, max: 0, stats: null };
if (useDem) {
  const proj0 = makeProjection(osm.origin.lat, osm.origin.lon);
  const load = (id, z) => {
    const m = new Map();
    for (const f of fs.readdirSync(PATHS.demDir).filter((f) => f.startsWith(`${id}_${z}_`) && f.endsWith('.txt'))) {
      const [, , x, y] = f.slice(0, -4).split('_');
      m.set(`${x},${y}`, parseDemText(fs.readFileSync(`${PATHS.demDir}/${f}`, 'utf8')));
    }
    if (!m.size) throw new Error(`${PATHS.demDir} に ${id} のタイルがありません。node tools/fetch-dem.mjs を先に実行してください`);
    return m;
  };
  const srcs = DEM.sources.map((s) => ({ ...s, tiles: load(s.id, s.z) }));
  const elevM = new Float32Array(w.W * w.H);
  const used = srcs.map(() => 0);
  for (let j = 0; j < w.H; j++) for (let i = 0; i < w.W; i++) {
    const { lat, lon } = proj0.toLatLon(i - EXTENT.west + 0.5, j - EXTENT.north + 0.5);
    let v = NaN;
    for (let s = 0; s < srcs.length && Number.isNaN(v); s++) {
      const p = lonLatToPixel(lat, lon, srcs[s].z);
      v = sampleTiles(srcs[s].tiles, p.px, p.py);
      if (!Number.isNaN(v)) used[s]++;
    }
    elevM[j * w.W + i] = v;
  }
  const gaps = fillGaps(elevM, w.W, w.H);
  terrain = buildTerrain(elevM, w);
  terrain.stats = { ...terrain.stats, cellsBySource: Object.fromEntries(srcs.map((s, i) => [s.id, used[i]])), gaps };
  console.log('標高', terrain.stats);
}
w.elev = terrain.g;

fs.mkdirSync(PATHS.worldDir, { recursive: true });
// 配信は gzip（ブラウザの DecompressionStream で展開）。生 .bin は残さない
const FILES = ['ground', 'bld', 'bldtype', 'deck', 'elev'];
const files = {};
for (const name of FILES) {
  files[name] = `${name}.bin.gz`;
  fs.writeFileSync(`${PATHS.worldDir}/${files[name]}`, zlib.gzipSync(w[name], { level: 9 }));
  fs.rmSync(`${PATHS.worldDir}/${name}.bin`, { force: true });
}

// スポーン探索の目標点: 「宇都宮駅東口」の名を持つ POI の平均（実際の位置は実行時に歩行可能セルを探索）
const east = w.pois.filter((p) => p.name === SPAWN_POI_NAME);
const spawnTarget = east.length
  ? { x: Math.round(east.reduce((a, p) => a + p.x, 0) / east.length), z: Math.round(east.reduce((a, p) => a + p.z, 0) / east.length), from: SPAWN_POI_NAME }
  : { x: 0, z: 0, from: 'origin' };

// テレポート先（OSM の名称検索）
const proj = makeProjection(osm.origin.lat, osm.origin.lon);
const teleports = findTeleports(osm.elements, (lat, lon) => proj.toLocal(lat, lon),
  (x, z) => x >= -EXTENT.west && x < EXTENT.east && z >= -EXTENT.north && z < EXTENT.south);
console.log('テレポート先', teleports.map((t) => `${t.label}(${t.x},${t.z})`).join(' '));

// ライトラインの走行ルート（範囲の端から 2m 内側で切る）
const trams = buildTramRoutes(osm.elements, (lat, lon) => proj.toLocal(lat, lon),
  (x, z) => x >= -EXTENT.west + 2 && x < EXTENT.east - 2 && z >= -EXTENT.north + 2 && z < EXTENT.south - 2);
console.log('ライトライン', trams.legs.map((r) => `${r.enter}→${r.exit} ${r.length}m 停留場 ${r.stops.map((s) => `${s.name}@${s.s}`).join(',')}`).join(' / '));

// 手作りの装飾（手すり・階段・駅名板・餃子像・停留場）。--no-decor で省く
let decor = null;
if (!process.argv.includes('--no-decor')) {
  const pw = makeWorld({ size: { x: w.W, z: w.H }, extent: EXTENT }, w);
  decor = buildDecor(pw, osm.elements, (lat, lon) => proj.toLocal(lat, lon), trams);
  files.decor = 'decor.bin.gz';
  fs.writeFileSync(`${PATHS.worldDir}/${files.decor}`, zlib.gzipSync(Buffer.from(decor.list.buffer), { level: 9 }));
  console.log('装飾', decor.stats);
} else fs.rmSync(`${PATHS.worldDir}/decor.bin.gz`, { force: true });

const world = {
  version: 1,
  origin: osm.origin,
  extent: EXTENT,
  size: { x: w.W, z: w.H },
  resolution: 1,
  axes: '+x=east, -z=north; cell (i,j) covers x∈[i-west, i-west+1), z∈[j-north, j-north+1); index = j*size.x + i',
  maxHeight: MAX_H,
  files,
  encoding: 'gzip, Uint8 per cell',
  bldtypeFormat: 'low 4 bits = buildingTypes id, high 4 bits = color variant (hash of OSM id)',
  spawnTarget,
  teleports,
  trams,
  signs: decor ? decor.signs : [],
  decorFormat: 'Int16 [x, y, z, blockId] per block, local block coords (overrides the raster columns; edits override decor)',
  decorStats: decor ? decor.stats : null,
  materials: MAT_NAMES,
  buildingTypes: BTYPE_NAMES,
  pois: w.pois,
  osmFetchedAt: osm.fetchedAt,
  heightSource: usePlateau ? 'PLATEAU 2023 (measuredHeight) > OSM' : 'OSM',
  plateau: plateauStats,
  // elev: セルの地表ブロックの高さ（by）。標高[m] ≈ terrain.base + elev
  terrain: useDem ? { source: 'GSI DEM5A (z15) > DEM10B (z14)', base: terrain.base, max: terrain.max, stats: terrain.stats } : { source: 'flat', base: 0, max: 0 },
  // 編集差分の保存形式の版。地形が変わると過去の編集の座標が合わなくなるので上げる（IndexedDB の版）
  editsVersion: useDem ? 2 : 1,
  attribution: ['© OpenStreetMap contributors (ODbL)', ...(usePlateau ? [PLATEAU.attribution] : []), ...(useDem ? [DEM.attribution] : [])],
};
fs.writeFileSync(`${PATHS.worldDir}/world.json`, JSON.stringify(world));

const hist = {};
for (const v of w.ground) hist[MAT_NAMES[v]] = (hist[MAT_NAMES[v]] || 0) + 1;
let bldCells = 0, deckCells = 0, maxH = 0;
for (let k = 0; k < w.bld.length; k++) { if (w.bld[k]) { bldCells++; if (w.bld[k] > maxH) maxH = w.bld[k]; } if (w.deck[k]) deckCells++; }
console.log(`ワールド ${w.W}×${w.H} m、生成 ${(performance.now() - t0).toFixed(0)} ms`);
console.log('統計', w.stats);
console.log(`建物セル ${bldCells}（${(100 * bldCells / w.bld.length).toFixed(1)}%）最大高さ ${maxH}m、デッキセル ${deckCells}、POI ${w.pois.length}`);
console.log('スポーン目標', spawnTarget);
console.log('gzip サイズ', Object.fromEntries(FILES.map((n) => [n, fs.statSync(`${PATHS.worldDir}/${files[n]}`).size])));
console.log('地表材質の面積[m²]', hist);
