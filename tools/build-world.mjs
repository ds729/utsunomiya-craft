// data/raw/osm.json → public/world/{ground,bld,bldtype,deck}.bin + world.json
// 使い方: node tools/build-world.mjs
import fs from 'node:fs';
import { EXTENT, MAX_H, PATHS } from './config.mjs';
import { buildWorld } from './lib/world.mjs';
import { MAT_NAMES, BTYPE_NAMES } from './lib/tags.mjs';

const t0 = performance.now();
const osm = JSON.parse(fs.readFileSync(PATHS.osm, 'utf8'));
const w = buildWorld(osm, EXTENT);
fs.mkdirSync(PATHS.worldDir, { recursive: true });
for (const name of ['ground', 'bld', 'bldtype', 'deck']) fs.writeFileSync(`${PATHS.worldDir}/${name}.bin`, w[name]);

const world = {
  version: 1,
  origin: osm.origin,
  extent: EXTENT,
  size: { x: w.W, z: w.H },
  resolution: 1,
  axes: '+x=east, -z=north; cell (i,j) covers x∈[i-west, i-west+1), z∈[j-north, j-north+1); index = j*size.x + i',
  maxHeight: MAX_H,
  materials: MAT_NAMES,
  buildingTypes: BTYPE_NAMES,
  pois: w.pois,
  osmFetchedAt: osm.fetchedAt,
  attribution: ['© OpenStreetMap contributors (ODbL)'],
};
fs.writeFileSync(`${PATHS.worldDir}/world.json`, JSON.stringify(world));

const hist = {};
for (const v of w.ground) hist[MAT_NAMES[v]] = (hist[MAT_NAMES[v]] || 0) + 1;
let bldCells = 0, deckCells = 0, maxH = 0;
for (let k = 0; k < w.bld.length; k++) { if (w.bld[k]) { bldCells++; if (w.bld[k] > maxH) maxH = w.bld[k]; } if (w.deck[k]) deckCells++; }
console.log(`ワールド ${w.W}×${w.H} m、生成 ${(performance.now() - t0).toFixed(0)} ms`);
console.log('統計', w.stats);
console.log(`建物セル ${bldCells}（${(100 * bldCells / w.bld.length).toFixed(1)}%）最大高さ ${maxH}m、デッキセル ${deckCells}、POI ${w.pois.length}`);
console.log('地表材質の面積[m²]', hist);
