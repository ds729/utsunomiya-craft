// スポーン地点の探索（純関数）。建物の中・水中・線路上・低い高架の下には出さない
import { MAT_WATER, MAT_PLATFORM, MAT_PLAZA, MAT_SIDEWALK } from './blocks.js';
import { PLAYER } from './physics.js';
import { isSolidAt } from './world-data.js';

const MAT_BALLAST = 4, MAT_RAIL = 14, MAT_TRAM = 10;
const PREFERRED = new Set([MAT_PLAZA, MAT_SIDEWALK]);
const PREFER_BONUS = 30; // 広場・歩道なら 30m 遠くても優先

// セル k に立てるか（地表に立つ想定。頭上の床板まで 2 ブロック以上空いている）
export function isStandable(w, k) {
  if (w.bld[k] > 0) return false;
  const m = w.ground[k];
  if (m === MAT_WATER || m === MAT_PLATFORM || m === MAT_BALLAST || m === MAT_RAIL || m === MAT_TRAM) return false;
  const d = w.deck[k];
  return d === 0 || d >= Math.ceil(PLAYER.H) + 1;
}

// 周囲 8 セルも立てる（AABB が余裕を持って収まる）か
function isOpen(w, i, j) {
  for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
    const ii = i + di, jj = j + dj;
    if (ii < 0 || jj < 0 || ii >= w.W || jj >= w.H) return false;
    const k = jj * w.W + ii;
    if (w.bld[k] > 0 || w.ground[k] === MAT_WATER) return false;
  }
  return true;
}

// 編集差分があるとき: 足元が固体で、体の高さ（by=1,2）が空いているか（置いたブロックの中や掘った穴に出さない）
function editsAllow(w, x, z) {
  if (!w.edits || !w.edits.size) return true;
  return isSolidAt(w, x, 0, z) && !isSolidAt(w, x, 1, z) && !isSolidAt(w, x, 2, z);
}

// 目標 (x, z)[m] から maxR の範囲で、距離（広場・歩道は優遇）が最小の立てるセルを返す
// 戻り値: { x, y, z }（足元。セル中心、y=1 は地表ブロックの上面）または null
export function findSpawn(w, x, z, maxR = 300) {
  const ci = Math.floor(x) + w.west, cj = Math.floor(z) + w.north;
  let best = null, bestScore = Infinity;
  for (let r = 0; r <= maxR; r++) {
    if (r - PREFER_BONUS > bestScore) break;
    for (let dj = -r; dj <= r; dj++) {
      for (let di = -r; di <= r; di++) {
        if (Math.max(Math.abs(di), Math.abs(dj)) !== r) continue; // 正方形の外周だけ
        const i = ci + di, j = cj + dj;
        if (i < 0 || j < 0 || i >= w.W || j >= w.H) continue;
        const k = j * w.W + i;
        if (!isStandable(w, k) || !isOpen(w, i, j) || !editsAllow(w, i - w.west, j - w.north)) continue;
        const score = Math.hypot(di, dj) - (PREFERRED.has(w.ground[k]) ? PREFER_BONUS : 0);
        if (score < bestScore) { bestScore = score; best = { x: i - w.west + 0.5, y: 1, z: j - w.north + 0.5 }; }
      }
    }
  }
  return best;
}
