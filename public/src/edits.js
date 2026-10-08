// ブロック編集の差分（チャンク単位）とレイキャスト。純関数・純データ（保存は storage.js）
import { CS, Y_MIN, CHUNK_H } from './world-data.js';

const key = (cx, cz) => `${cx},${cz}`;

// 差分: "cx,cz" → Map(局所 index → ブロック ID)。局所 index = (yi * CS + lz) * CS + lx
export class EditStore {
  constructor() { this.chunks = new Map(); this.version = 0; }

  get(x, by, z) {
    const yi = by - Y_MIN;
    if (yi < 0 || yi >= CHUNK_H) return undefined;
    const cx = Math.floor(x / CS), cz = Math.floor(z / CS);
    const m = this.chunks.get(key(cx, cz));
    if (!m) return undefined;
    return m.get((yi * CS + (z - cz * CS)) * CS + (x - cx * CS));
  }

  // 戻り値: 変更したチャンクの [cx, cz]
  set(x, by, z, id) {
    const yi = by - Y_MIN;
    if (yi < 0 || yi >= CHUNK_H) return null;
    const cx = Math.floor(x / CS), cz = Math.floor(z / CS);
    const k = key(cx, cz);
    if (!this.chunks.has(k)) this.chunks.set(k, new Map());
    this.chunks.get(k).set((yi * CS + (z - cz * CS)) * CS + (x - cx * CS), id);
    this.version++;
    return [cx, cz];
  }

  // 元に戻す（元の地形と同じ値になったら差分から消す）
  unset(x, by, z) {
    const cx = Math.floor(x / CS), cz = Math.floor(z / CS);
    const m = this.chunks.get(key(cx, cz));
    if (!m) return;
    m.delete(((by - Y_MIN) * CS + (z - cz * CS)) * CS + (x - cx * CS));
    if (!m.size) this.chunks.delete(key(cx, cz));
    this.version++;
  }

  chunk(cx, cz) { return this.chunks.get(key(cx, cz)); }

  // 保存用: [[index, id], ...]
  serialize(cx, cz) { return [...(this.chunk(cx, cz) || [])]; }
  load(cx, cz, entries) {
    if (entries.length) this.chunks.set(key(cx, cz), new Map(entries));
    this.version++;
  }
  clear() { this.chunks.clear(); this.version++; }
  get size() { let n = 0; for (const m of this.chunks.values()) n += m.size; return n; }
}

// (x, by, z) のブロックを変えたとき、メッシュを作り直すチャンク（境界なら隣も）
export function affectedChunks(x, z) {
  const cx = Math.floor(x / CS), cz = Math.floor(z / CS);
  const lx = x - cx * CS, lz = z - cz * CS;
  const out = [[cx, cz]];
  if (lx === 0) out.push([cx - 1, cz]);
  if (lx === CS - 1) out.push([cx + 1, cz]);
  if (lz === 0) out.push([cx, cz - 1]);
  if (lz === CS - 1) out.push([cx, cz + 1]);
  return out;
}

// ボクセルの DDA レイキャスト。origin・dir（正規化不要）から maxDist 以内で最初に当たる対象ブロック
// isTarget(x, y, z) が true のブロックで止まる。戻り値: { x, y, z, nx, ny, nz（当たった面の法線）, dist } または null
export function raycast(origin, dir, maxDist, isTarget) {
  const len = Math.hypot(dir[0], dir[1], dir[2]);
  if (!len) return null;
  const d = [dir[0] / len, dir[1] / len, dir[2] / len];
  const p = [Math.floor(origin[0]), Math.floor(origin[1]), Math.floor(origin[2])];
  const step = d.map((v) => (v > 0 ? 1 : v < 0 ? -1 : 0));
  const tDelta = d.map((v) => (v ? Math.abs(1 / v) : Infinity));
  const tMax = d.map((v, a) => (v > 0 ? (p[a] + 1 - origin[a]) / v : v < 0 ? (origin[a] - p[a]) / -v : Infinity));
  let n = [0, 0, 0], t = 0;
  for (let i = 0; i < 1000 && t <= maxDist; i++) {
    if (isTarget(p[0], p[1], p[2])) return { x: p[0], y: p[1], z: p[2], nx: n[0], ny: n[1], nz: n[2], dist: t };
    const a = tMax[0] < tMax[1] ? (tMax[0] < tMax[2] ? 0 : 2) : (tMax[1] < tMax[2] ? 1 : 2);
    t = tMax[a];
    tMax[a] += tDelta[a];
    p[a] += step[a];
    n = [0, 0, 0];
    n[a] = -step[a];
  }
  return null;
}

// --- 破壊・設置のルール（純関数）---
// w: world（edits 必須）、blockAt/cellIndex を受け取って循環 import を避ける
// 破壊: 岩盤は壊せない。戻り値: 変わった座標 [x, y, z] または null
export function breakAt(w, hit, { blockAt, baseAt, unbreakable }) {
  if (!hit) return null;
  const id = blockAt(w, hit.x, hit.y, hit.z);
  if (!id || unbreakable.has(id)) return null;
  setOrUnset(w, hit.x, hit.y, hit.z, 0, baseAt);
  return [hit.x, hit.y, hit.z];
}

// 設置: 当たった面の手前。空気か水の場所だけ、ワールド内・高さ範囲内、プレイヤーと重ならない
export function placeAt(w, hit, id, { blockAt, baseAt, cellIndex, overlapsPlayer, yMin, yMax, isReplaceable }) {
  if (!hit) return null;
  const x = hit.x + hit.nx, y = hit.y + hit.ny, z = hit.z + hit.nz;
  if (y <= yMin || y > yMax || cellIndex(w, x, z) < 0) return null;
  if (!isReplaceable(blockAt(w, x, y, z))) return null;
  if (overlapsPlayer(x, y, z)) return null;
  setOrUnset(w, x, y, z, id, baseAt);
  return [x, y, z];
}

// 元の地形と同じ値に戻るなら差分を消す（置いて壊しただけのブロックを数えない・保存しない）
function setOrUnset(w, x, y, z, id, baseAt) {
  if (baseAt && baseAt(w, x, y, z) === id) w.edits.unset(x, y, z);
  else w.edits.set(x, y, z, id);
}
