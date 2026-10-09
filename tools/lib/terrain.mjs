// 標高 → 1m セルごとの地表高さ g（ブロック数、Uint8）。副作用なし
// 手順: 双一次補間した標高 → ぼかし（5m DEM の段差・ノイズを均す）→ 最低点を 0 に整数化
//   → 水面と岸をそろえる → 隣接セルの差を 1 以下に抑える → 建物の敷地を平らにする
import { MAT, BTYPE } from './tags.mjs';

const OVER_TRACK = new Set([MAT.DIRT, MAT.BALLAST, MAT.PLATFORM, MAT.TRAM, MAT.RAIL]);

// 分離可能な箱型ぼかし（半径 r セル）を passes 回。端は範囲内だけで平均
export function boxBlur(src, W, H, r, passes = 2) {
  let a = Float32Array.from(src);
  const b = new Float32Array(W * H);
  for (let p = 0; p < passes; p++) {
    for (let j = 0; j < H; j++) { // 横
      let s = 0, n = 0;
      for (let i = 0; i < Math.min(r, W); i++) { s += a[j * W + i]; n++; }
      for (let i = 0; i < W; i++) {
        if (i + r < W) { s += a[j * W + i + r]; n++; }
        if (i - r - 1 >= 0) { s -= a[j * W + i - r - 1]; n--; }
        b[j * W + i] = s / n;
      }
    }
    for (let i = 0; i < W; i++) { // 縦
      let s = 0, n = 0;
      for (let j = 0; j < Math.min(r, H); j++) { s += b[j * W + i]; n++; }
      for (let j = 0; j < H; j++) {
        if (j + r < H) { s += b[(j + r) * W + i]; n++; }
        if (j - r - 1 >= 0) { s -= b[(j - r - 1) * W + i]; n--; }
        a[j * W + i] = s / n;
      }
    }
  }
  return a;
}

// 隣接（4近傍）セルの高さの差を 1 以下にする（高い側を下げるだけ）。前後 2 回の走査を収束まで繰り返す
export function limitSlope(g, W, H) {
  let changed = 0;
  for (let iter = 0; iter < 50; iter++) {
    let c = 0;
    for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
      const k = j * W + i;
      let m = g[k];
      if (i > 0) m = Math.min(m, g[k - 1] + 1);
      if (j > 0) m = Math.min(m, g[k - W] + 1);
      if (m < g[k]) { g[k] = m; c++; }
    }
    for (let j = H - 1; j >= 0; j--) for (let i = W - 1; i >= 0; i--) {
      const k = j * W + i;
      let m = g[k];
      if (i < W - 1) m = Math.min(m, g[k + 1] + 1);
      if (j < H - 1) m = Math.min(m, g[k + W] + 1);
      if (m < g[k]) { g[k] = m; c++; }
    }
    changed += c;
    if (!c) break;
  }
  return changed;
}

// 水に接する陸（8近傍）は、接する水面の最低より高くしない（どの水セルからも1段で上がれる）
export function levelBanks(g, ground, W, H) {
  let n = 0;
  for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
    const k = j * W + i;
    if (ground[k] === MAT.WATER) continue;
    let wmin = 256;
    for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
      const ii = i + di, jj = j + dj;
      if (ii < 0 || jj < 0 || ii >= W || jj >= H) continue;
      const q = jj * W + ii;
      if (ground[q] === MAT.WATER && g[q] < wmin) wmin = g[q];
    }
    if (wmin < 256 && g[k] > wmin) { g[k] = wmin; n++; }
  }
  return n;
}

// 建物（高さ・種別が同じで 4近傍につながるセルの塊）の地表を、その塊の最低値にそろえる（屋根を平らに）
// skip(k) が true のセル（下を歩ける上屋・線路上の駅舎）は地形のまま（周りと段差を作らない）
export function flattenBuildings(g, bld, bldtype, W, H, skip = () => false) {
  const seen = new Uint8Array(W * H);
  const stack = [], cells = [];
  let groups = 0;
  for (let s = 0; s < W * H; s++) {
    if (!bld[s] || seen[s] || skip(s)) continue;
    stack.push(s); seen[s] = 1; cells.length = 0;
    let lo = Infinity;
    while (stack.length) {
      const k = stack.pop();
      cells.push(k);
      if (g[k] < lo) lo = g[k];
      const i = k % W;
      for (const q of [i > 0 ? k - 1 : -1, i < W - 1 ? k + 1 : -1, k - W, k + W]) {
        if (q < 0 || q >= W * H || seen[q] || bld[q] !== bld[k] || bldtype[q] !== bldtype[k] || skip(q)) continue;
        seen[q] = 1; stack.push(q);
      }
    }
    for (const k of cells) g[k] = lo;
    groups++;
  }
  return groups;
}

// 高架の床板（deck = 地表からの下面高さ）を、地形の段差に沿って波打たないよう水平にそろえる。
// 同じ下面高さで 4近傍につながる塊ごとに、基準の地表高さ gref を決めて deck を gref + d - g に置き換える
//  - 塊の差し渡しが maxSpan 以下（ペデストリアンデッキ・歩道橋）: 塊の平均で完全に水平
//  - それより長い（鉄道高架）: 半径 blurR でぼかした地表高さに沿って緩やかに
// 下は minClear 以上空ける。deck はその場で書き換える
export function levelDecks(g, deck, W, H, { maxSpan = 250, blurR = 30, minClear = 3 } = {}) {
  const seen = new Uint8Array(W * H);
  let smooth = null;
  const stack = [], cells = [];
  let groups = 0, changed = 0;
  for (let s = 0; s < W * H; s++) {
    if (!deck[s] || seen[s]) continue;
    const d = deck[s];
    stack.push(s); seen[s] = 1; cells.length = 0;
    let sum = 0, i0 = W, i1 = 0, j0 = H, j1 = 0;
    while (stack.length) {
      const k = stack.pop();
      cells.push(k); sum += g[k];
      const i = k % W, j = (k - i) / W;
      i0 = Math.min(i0, i); i1 = Math.max(i1, i); j0 = Math.min(j0, j); j1 = Math.max(j1, j);
      for (const q of [i > 0 ? k - 1 : -1, i < W - 1 ? k + 1 : -1, k - W, k + W]) {
        if (q < 0 || q >= W * H || seen[q] || deck[q] !== d) continue;
        seen[q] = 1; stack.push(q);
      }
    }
    groups++;
    const long = Math.max(i1 - i0, j1 - j0) > maxSpan;
    if (long && !smooth) smooth = boxBlur(g, W, H, blurR);
    const mean = Math.round(sum / cells.length);
    for (const k of cells) {
      const gref = long ? Math.round(smooth[k]) : mean;
      const v = Math.max(minClear, Math.min(250, d + gref - g[k]));
      if (v !== deck[k]) { deck[k] = v; changed++; }
    }
  }
  return { groups, changed };
}

// elevM: Float32Array(W*H) 標高[m]（欠測なし）。戻り値 { g: Uint8Array, base: g=0 の標高[m], max, stats }
export function buildTerrain(elevM, w, { blurR = 6, maxG = 40 } = {}) {
  const { W, H } = w;
  const sm = boxBlur(elevM, W, H, blurR);
  let lo = Infinity;
  for (const v of sm) if (v < lo) lo = v;
  const base = Math.floor(lo);
  const g = new Uint8Array(W * H);
  let clamped = 0;
  for (let k = 0; k < W * H; k++) {
    const v = Math.round(sm[k] - base);
    if (v > maxG) clamped++;
    g[k] = Math.max(0, Math.min(maxG, v));
  }
  const stats = { base, clamped };
  // 岸をそろえる・傾きを抑えるはどちらも下げるだけなので、交互に繰り返せば両方を満たして止まる
  stats.banks = 0; stats.slopeLowered = 0;
  for (let i = 0; i < 20; i++) {
    const a = levelBanks(g, w.ground, W, H), b = limitSlope(g, W, H);
    stats.banks += a; stats.slopeLowered += b;
    if (!a && !b) break;
  }
  // 実行時の fillColumn と同じ条件: 屋根だけの建物（種別 roof・3m 以上）と、線路・ホームの上の 8m 以上の建物
  const walkUnder = (k) => ((w.bldtype[k] & 15) === BTYPE.ROOF && w.bld[k] >= 3) || (OVER_TRACK.has(w.ground[k]) && w.bld[k] > 7);
  stats.buildingGroups = flattenBuildings(g, w.bld, w.bldtype, W, H, walkUnder);
  if (w.deck) stats.decks = levelDecks(g, w.deck, W, H);
  let max = 0;
  for (const v of g) if (v > max) max = v;
  stats.max = max;
  return { g, base, max, stats };
}
