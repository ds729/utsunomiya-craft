// テスト用: public/world の実データ（gzip）を Node で読み込む
import fs from 'node:fs';
import zlib from 'node:zlib';
import { makeWorld } from '../../public/src/world-data.js';

const DIR = new URL('../../public/world/', import.meta.url);
let cached = null;
export function loadRealWorld() {
  if (cached) return cached;
  const meta = JSON.parse(fs.readFileSync(new URL('world.json', DIR), 'utf8'));
  const rasters = {};
  for (const n of ['ground', 'bld', 'bldtype', 'deck', 'elev'].filter((f) => meta.files[f])) rasters[n] = new Uint8Array(zlib.gunzipSync(fs.readFileSync(new URL(meta.files[n], DIR))));
  if (meta.files.decor) {
    const b = zlib.gunzipSync(fs.readFileSync(new URL(meta.files.decor, DIR)));
    rasters.decor = new Int16Array(b.buffer, b.byteOffset, b.byteLength >> 1);
  }
  return (cached = makeWorld(meta, rasters));
}

// 小さな合成ワールド。cells: (i, j, {ground, bld, bldtype, deck, elev}) を返す関数
export function makeTestWorld(size, cells = () => ({})) {
  const N = size * size;
  const r = { ground: new Uint8Array(N), bld: new Uint8Array(N), bldtype: new Uint8Array(N), deck: new Uint8Array(N), elev: new Uint8Array(N) };
  for (let j = 0; j < size; j++) for (let i = 0; i < size; i++) {
    const c = cells(i - size / 2, j - size / 2);
    for (const key of Object.keys(r)) if (c[key] != null) r[key][j * size + i] = c[key];
  }
  const half = size / 2;
  return makeWorld({ size: { x: size, z: size }, extent: { west: half, east: half, north: half, south: half } }, r);
}
