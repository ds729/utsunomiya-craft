// PLATEAU CityGML zip から、ワールド範囲を覆う建物（udx/bldg/<3次メッシュ>_*.gml）だけを Range 取得する
// 使い方: node tools/fetch-plateau.mjs [--force]   出力: data/raw/plateau/*.gml（コミットしない）
import fs from 'node:fs';
import { EXTENT, FETCH_MARGIN_M, PATHS, PLATEAU } from './config.mjs';
import { bboxFromExtent } from './lib/geo.mjs';
import { meshesInBBox } from './lib/mesh.mjs';
import { listZip, extractEntry } from './lib/zip-range.mjs';

const force = process.argv.includes('--force');
const station = JSON.parse(fs.readFileSync(PATHS.station, 'utf8'));
const bbox = bboxFromExtent(station.lat, station.lon, EXTENT, FETCH_MARGIN_M);
const meshes = meshesInBBox(bbox);
console.log('範囲', bbox.map((v) => v.toFixed(5)).join(','), '3次メッシュ', meshes.join(' '));

const { size, entries } = await listZip(PLATEAU.zipUrl);
console.log(`zip ${(size / 1e6).toFixed(0)}MB、エントリ ${entries.length}`);
const targets = entries.filter((e) => /^udx\/bldg\/\d{8}[^/]*\.gml$/.test(e.name) && meshes.some((m) => e.name.startsWith(`udx/bldg/${m}`)));
console.log(`対象 ${targets.length} ファイル、圧縮 ${(targets.reduce((a, e) => a + e.csize, 0) / 1e6).toFixed(1)}MB → 展開 ${(targets.reduce((a, e) => a + e.usize, 0) / 1e6).toFixed(1)}MB`);

fs.mkdirSync(PATHS.plateauDir, { recursive: true });
for (const e of targets) {
  const out = `${PATHS.plateauDir}/${e.name.split('/').pop()}`;
  if (!force && fs.existsSync(out) && fs.statSync(out).size === e.usize) { console.log('キャッシュ', out); continue; }
  const t = Date.now();
  const data = await extractEntry(PLATEAU.zipUrl, e);
  if (data.length !== e.usize) throw new Error(`サイズ不一致 ${e.name}`);
  fs.writeFileSync(out, data);
  console.log(`取得 ${out} ${(e.csize / 1e6).toFixed(1)}MB → ${(e.usize / 1e6).toFixed(1)}MB (${Date.now() - t}ms)`);
}
fs.writeFileSync(`${PATHS.plateauDir}/source.json`, JSON.stringify({ ...PLATEAU, fetchedAt: new Date().toISOString(), meshes, files: targets.map((e) => e.name) }, null, 1));
