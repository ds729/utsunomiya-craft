// 国土地理院 標高タイル（DEM5A z15 と、欠測の補完用に DEM10B z14）を取得して data/raw/dem/ にキャッシュする
// 使い方: node tools/fetch-dem.mjs [--force]
import fs from 'node:fs';
import { EXTENT, FETCH_MARGIN_M, PATHS, DEM, USER_AGENT } from './config.mjs';
import { bboxFromExtent } from './lib/geo.mjs';
import { tilesInBBox } from './lib/dem.mjs';

const force = process.argv.includes('--force');
const station = JSON.parse(fs.readFileSync(PATHS.station, 'utf8'));
const bbox = bboxFromExtent(station.lat, station.lon, EXTENT, FETCH_MARGIN_M);
fs.mkdirSync(PATHS.demDir, { recursive: true });
const got = [];
for (const src of DEM.sources) {
  const tiles = tilesInBBox(bbox, src.z);
  console.log(`${src.id} z${src.z}: ${tiles.length} タイル`);
  for (const { x, y } of tiles) {
    const out = `${PATHS.demDir}/${src.id}_${src.z}_${x}_${y}.txt`;
    got.push(out.split('/').pop());
    if (!force && fs.existsSync(out)) { console.log('  キャッシュ', out); continue; }
    const url = DEM.url.replace('{id}', src.id).replace('{z}', src.z).replace('{x}', x).replace('{y}', y);
    const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT } });
    if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
    fs.writeFileSync(out, await res.text());
    console.log(`  取得 ${out} ${fs.statSync(out).size}B`);
    await new Promise((r) => setTimeout(r, 300)); // 配信元への負荷を抑える
  }
}
fs.writeFileSync(`${PATHS.demDir}/source.json`, JSON.stringify({ ...DEM, bbox, files: got, fetchedAt: new Date().toISOString() }, null, 1));
