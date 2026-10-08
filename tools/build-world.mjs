// data/raw/osm.json → public/world/{ground,bld,bldtype,deck}.bin + world.json
// 使い方: node tools/build-world.mjs
import fs from 'node:fs';
import zlib from 'node:zlib';
import { EXTENT, MAX_H, PATHS, SPAWN_POI_NAME, PLATEAU } from './config.mjs';
import { buildWorld } from './lib/world.mjs';
import { parseBuildings, applyPlateau } from './lib/plateau.mjs';
import { MAT_NAMES, BTYPE_NAMES } from './lib/tags.mjs';

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
fs.mkdirSync(PATHS.worldDir, { recursive: true });
// 配信は gzip（ブラウザの DecompressionStream で展開）。生 .bin は残さない
const FILES = ['ground', 'bld', 'bldtype', 'deck'];
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
  materials: MAT_NAMES,
  buildingTypes: BTYPE_NAMES,
  pois: w.pois,
  osmFetchedAt: osm.fetchedAt,
  heightSource: usePlateau ? 'PLATEAU 2023 (measuredHeight) > OSM' : 'OSM',
  plateau: plateauStats,
  attribution: ['© OpenStreetMap contributors (ODbL)', ...(usePlateau ? [PLATEAU.attribution] : [])],
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
