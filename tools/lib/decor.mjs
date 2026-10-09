// 手作りのボクセル装飾（純関数）。地形（public/src/world-data.js の列の規則）の上に置くブロックの一覧を作る
//  1. 高架の床板（ペデストリアンデッキ・新幹線高架）の縁の手すり（落下防止。衝突する）
//  2. デッキから地上への階段（OSM の highway=steps の位置と向き。1段ずつなので歩いて上り下りできる）
//  3. 駅舎の東西の壁面の駅名板（文字は実行時に Canvas で描いた板を重ねる）
//  4. 餃子像（OSM の「餃子像」の位置。台座＋餃子の形）
//  5. ライトラインの停留場のホームと上屋
import { B } from '../../public/src/blocks.js';
import { originalBlockAt, cellIndex, Y_MAX } from '../../public/src/world-data.js';
import { MAT } from './tags.mjs';
import { projectOnLine } from './tram.mjs';
import { pointAt } from '../../public/src/tram.js';

const BT_STATION = 5, BT_ROOF = 9;
const NO_BUILD_MAT = new Set([MAT.WATER, MAT.RAIL, MAT.BALLAST, MAT.TRAM, MAT.PLATFORM]);
const NO_STAIR_MAT = new Set([MAT.WATER, MAT.RAIL, MAT.BALLAST, MAT.TRAM]); // 階段はバスのりばのホーム面（1段）には置ける

// w: makeWorld の結果（elev・deck は地形処理後）。osm: Overpass の要素、toLocal(lat, lon) → {x, z}、trams: { legs }
export function buildDecor(w, elements, toLocal, trams) {
  const placed = new Map(); // "x,y,z" → id
  const key = (x, y, z) => `${x},${y},${z}`;
  const get = (x, y, z) => placed.get(key(x, y, z)) ?? originalBlockAt(w, x, y, z);
  const put = (x, y, z, id) => { if (y > -4 && y <= Y_MAX && cellIndex(w, x, z) >= 0) placed.set(key(x, y, z), id); };
  const cell = (x, z) => cellIndex(w, Math.floor(x), Math.floor(z));
  const g = (x, z) => { const k = cell(x, z); return k >= 0 ? w.elev[k] : 0; };
  // 列の床板ブロックの高さ（なければ -1）: 地形の規則どおり by = g + 1 + deck
  const deckY = (x, z) => {
    const k = cell(x, z);
    if (k < 0 || !w.deck[k]) return -1;
    const y = w.elev[k] + 1 + w.deck[k];
    return originalBlockAt(w, Math.floor(x), y, Math.floor(z)) === B.DECK ? y : -1;
  };
  const stats = { railings: 0, stairs: 0, stairsSkipped: 0, stairBlocks: 0, signs: 0, statue: 0, tramStops: 0, tramStopBlocks: 0 };
  const signs = [];

  // --- 2. 階段（手すりより先に。階段の付け根には手すりを付けない）---
  const stairCells = new Set(); // "x,z"
  const steps = elements.filter((e) => e.type === 'way' && e.tags && e.tags.highway === 'steps' && e.geometry && e.geometry.length >= 2);
  for (const e of steps) {
    const pts = e.geometry.map((p) => { const q = toLocal(p.lat, p.lon); return [q.x, q.z]; });
    const ends = [pts[0], pts[pts.length - 1]];
    // デッキに近い方の端 = 上端
    const near = (p) => { for (let r = 0; r <= 4; r++) for (let dz = -r; dz <= r; dz++) for (let dx = -r; dx <= r; dx++) if (deckY(p[0] + dx, p[1] + dz) >= 0) return r; return Infinity; };
    const [ra, rb] = ends.map(near);
    if (!Number.isFinite(Math.min(ra, rb))) continue;
    const top = ra <= rb ? ends[0] : ends[1], bot = ra <= rb ? ends[1] : ends[0];
    let ux = bot[0] - top[0], uz = bot[1] - top[1];
    const L = Math.hypot(ux, uz);
    if (L < 1) continue;
    // 東西南北のいずれかにそろえる（斜めの階段はセルの段差が 2 になる所ができて上れない）
    if (Math.abs(ux) >= Math.abs(uz)) { ux = Math.sign(ux); uz = 0; } else { uz = Math.sign(uz); ux = 0; }
    // 上端の近くで、外向き（u 方向）に進んでデッキが切れる位置 = 階段の付け根
    let edge = null, y0 = -1;
    for (let t = -5; t <= 5; t += 0.25) {
      const x = top[0] + ux * t, z = top[1] + uz * t, y = deckY(x, z);
      if (y >= 0) { edge = t; y0 = y; } else if (edge !== null) break;
    }
    if (edge === null) continue;
    const ex = top[0] + ux * (edge + 0.25), ez = top[1] + uz * (edge + 0.25);
    const n = y0 - g(ex + ux, ez + uz); // 段数
    if (n < 2 || n > 20) continue;
    // 階段の範囲のセル: 付け根から u 方向に t（0 < t <= n）、横に |l| <= 1.5
    const cells = [];
    let ok = true, why = '';
    const vx = -uz, vz = ux;
    const minX = Math.floor(Math.min(ex, ex + ux * n) - 3), maxX = Math.ceil(Math.max(ex, ex + ux * n) + 3);
    const minZ = Math.floor(Math.min(ez, ez + uz * n) - 3), maxZ = Math.ceil(Math.max(ez, ez + uz * n) + 3);
    for (let z = minZ; z <= maxZ && ok; z++) for (let x = minX; x <= maxX; x++) {
      const cx = x + 0.5 - ex, cz = z + 0.5 - ez;
      const t = cx * ux + cz * uz, l = cx * vx + cz * vz;
      if (t <= 0 || t > n || Math.abs(l) > 1.5) continue;
      const k = cell(x, z);
      const y = y0 - Math.ceil(t); // この段の一番上のブロック
      // 屋根だけの建物（バスのりばの上屋）の下は、屋根まで 2 ブロック以上空けば通す
      const shelter = k >= 0 && w.bld[k] && (w.bldtype[k] & 15) === BT_ROOF && w.bld[k] >= 3 && w.elev[k] + w.bld[k] - y >= 3;
      if (k < 0 || (w.bld[k] && !shelter) || NO_STAIR_MAT.has(w.ground[k])) { ok = false; why = `cell ${x},${z} bld=${k >= 0 && w.bld[k]} mat=${k >= 0 && w.ground[k]}`; break; }
      if (y <= w.elev[k]) continue; // 地面に着いた
      for (let yy = w.elev[k] + 1; yy <= y; yy++) if (get(x, yy, z) !== B.AIR && !(yy === w.elev[k] + 1 && get(x, yy, z) === B.PLATFORM)) { ok = false; why = `block ${x},${yy},${z}=${get(x, yy, z)}`; break; }
      // 頭上の床板との間が 3 ブロック未満なら（段を上がる途中で頭が当たる）、床板に階段の口を開ける（駅前のデッキの階段は床を抜けて下りる）
      const over = deckY(x, z);
      cells.push([x, z, w.elev[k] + 1, y, over >= 0 && over - y < 4 ? over : -1]);
    }
    // 床板に開ける口は階段の上り口の 2 列ぶん（幅 3 × 2）まで。それより長く床板を削るなら置かない（並走する高架の歩道を切らない）
    if (ok && cells.filter((c) => c[4] >= 0).length > 6) { ok = false; why = 'cuts deck'; }
    if (!ok || !cells.length) { stats.stairsSkipped++; (stats.skippedWhy ||= []).push(`${e.id}: ${why || 'empty'}`); continue; }
    for (const [x, z, ya, yb, cut] of cells) {
      for (let y = ya; y <= yb; y++) put(x, y, z, B.DECK);
      if (cut >= 0) { put(x, cut, z, B.AIR); stats.deckCut = (stats.deckCut || 0) + 1; }
      stats.stairBlocks += yb - ya + 1;
      stairCells.add(`${x},${z}`);
    }
    stats.stairs++;
    (stats.stairsAt ||= []).push({ top: [Math.round(ex), Math.round(ez)], dir: [Math.round(ux * 100) / 100, Math.round(uz * 100) / 100], steps: n });
  }

  // --- 1. 高架の縁の手すり ---
  for (let k = 0; k < w.W * w.H; k++) {
    if (!w.deck[k]) continue;
    const x = (k % w.W) - w.west, z = Math.floor(k / w.W) - w.north;
    const y = deckY(x, z);
    if (y < 0 || get(x, y + 1, z) !== B.AIR) continue;
    let edge = false;
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, nz = z + dz;
      if (cell(nx, nz) < 0 || stairCells.has(`${nx},${nz}`)) continue;
      // 隣の列で、同じ高さか 1 段下に乗れる面があれば縁ではない（緩い段差・建物の床へつながる）
      const walk = [y, y - 1].some((yy) => get(nx, yy, nz) !== B.AIR && get(nx, yy + 1, nz) === B.AIR);
      const wall = get(nx, y + 1, nz) !== B.AIR; // 壁に接する
      if (!walk && !wall) { edge = true; break; }
    }
    if (edge) { put(x, y + 1, z, B.RAILING); stats.railings++; }
  }

  // --- 3. 駅名板（駅舎の東西の壁面）---
  // 駅舎セル（種別 station）のうち原点から 150m 以内
  const station = [];
  for (let k = 0; k < w.W * w.H; k++) {
    if (!w.bld[k] || (w.bldtype[k] & 15) !== BT_STATION) continue;
    const x = (k % w.W) - w.west, z = Math.floor(k / w.W) - w.north;
    if (Math.hypot(x, z) < 150) station.push([x, z, k]);
  }
  if (station.length) {
    // 行（z）ごとの東端・西端の駅舎セル。壁面は斜めなので、板は壁から一番外の列まで埋めて表面を平らにする
    const rowEdge = new Map(); // z → { e: [x, k], w: [x, k] }
    for (const [x, z, k] of station) {
      const r = rowEdge.get(z) || { e: null, w: null };
      if (!r.e || x > r.e[0]) r.e = [x, k];
      if (!r.w || x < r.w[0]) r.w = [x, k];
      rowEdge.set(z, r);
    }
    // 駅舎に接して続く建物セル（PLATEAU 由来で種別が付いていない部分など）も壁面に含める
    for (const r of rowEdge.values()) for (const [sd, e] of [[1, 'e'], [-1, 'w']]) {
      let [x, k] = r[e];
      const z = Math.floor(k / w.W) - w.north;
      for (;;) { const q = cell(x + sd, z); if (q < 0 || !w.bld[q]) break; x += sd; k = q; }
      r[e] = [x, k];
    }
    const hw = 7;
    for (const side of [1, -1]) {
      // 原点付近（|z| <= 30）で、板の範囲の全行に駅舎がある中心行のうち、壁の凹凸が最も小さいもの
      let best = null;
      for (let zc = -30; zc <= 30; zc++) {
        const xs = [];
        for (let z = zc - hw; z <= zc + hw; z++) { const r = rowEdge.get(z); if (!r) break; xs.push((side > 0 ? r.e : r.w)[0]); }
        if (xs.length !== hw * 2 + 1) continue;
        const spread = Math.max(...xs) - Math.min(...xs);
        if (!best || spread < best.spread || (spread === best.spread && Math.abs(zc) < Math.abs(best.zc))) best = { zc, spread, xs };
      }
      if (!best) continue;
      const { zc, xs } = best;
      const front = side > 0 ? Math.max(...xs) + 1 : Math.min(...xs) - 1; // 板の表面の列
      const k0 = (side > 0 ? rowEdge.get(zc).e : rowEdge.get(zc).w)[1];
      const roofY = w.elev[k0] + w.bld[k0];
      const y1 = roofY - 1, y0 = Math.max(y1 - 3, w.elev[k0] + 9);
      const cells = [];
      for (let i = 0; i < xs.length; i++) {
        const z = zc - hw + i;
        for (let x = xs[i] + side; side > 0 ? x <= front : x >= front; x += side) cells.push([x, z]);
      }
      if (!cells.every(([x, z]) => { for (let y = y0; y <= y1; y++) if (get(x, y, z) !== B.AIR) return false; return true; })) continue;
      for (const [x, z] of cells) for (let y = y0; y <= y1; y++) put(x, y, z, B.SIGN);
      // 文字の板: 面の外側（side 方向）に向ける。中心座標・幅・高さ[m]
      signs.push({ text: '宇都宮駅', sub: 'UTSUNOMIYA STATION', x: front + 0.5 + side * 0.52, y: (y0 + y1 + 1) / 2, z: zc + 0.5, w: hw * 2 + 1, h: y1 - y0 + 1, facing: side > 0 ? 'east' : 'west' });
      stats.signs++;
    }
  }

  // --- 4. 餃子像（OSM の位置から 8m 以内で、台座が平らな面に収まり、周りが空いている所）---
  const statue = [];
  for (let dz = -1; dz <= 1; dz++) for (let dx = -2; dx <= 2; dx++) statue.push([dx, 0, dz, B.STONE]); // 台座
  for (let dz = -1; dz <= 1; dz++) for (let dx = -2; dx <= 2; dx++) if (Math.abs(dx) < 2 || dz === 0) statue.push([dx, 1, dz, B.GYOZA]); // 餃子の下半分
  for (let dx = -2; dx <= 2; dx++) statue.push([dx, 2, 0, B.GYOZA]); // ひだの稜線
  for (let dx = -1; dx <= 1; dx++) statue.push([dx, 3, 0, B.GYOZA]);
  const surface = (x, z) => { const dy = deckY(x, z); return (dy >= 0 ? dy : g(x, z)) + 1; }; // 乗っている面の上のブロック
  for (const e of elements) {
    if (e.type !== 'node' || !e.tags || e.tags.name !== '餃子像') continue;
    const q = toLocal(e.lat, e.lon);
    let done = false;
    for (let r = 0; r <= 8 && !done; r++) for (let oz = -r; oz <= r && !done; oz++) for (let ox = -r; ox <= r && !done; ox++) {
      if (Math.max(Math.abs(ox), Math.abs(oz)) !== r) continue;
      const sx = Math.floor(q.x) + ox, sz = Math.floor(q.z) + oz, base = surface(sx, sz);
      // 台座の下がすべて同じ高さの面で、像と周り 1 マスが空いている
      let ok = true;
      for (let dz = -2; dz <= 2 && ok; dz++) for (let dx = -3; dx <= 3 && ok; dx++) {
        const inner = Math.abs(dx) <= 2 && Math.abs(dz) <= 1;
        if (inner && (get(sx + dx, base - 1, sz + dz) === B.AIR || surface(sx + dx, sz + dz) !== base)) ok = false;
        for (let y = base; y <= base + 4 && ok; y++) if (get(sx + dx, y, sz + dz) !== B.AIR) ok = false;
      }
      if (!ok) continue;
      for (const [dx, dy2, dz, id] of statue) put(sx + dx, base + dy2, sz + dz, id);
      stats.statue++;
      stats.statueAt = [sx, sz];
      done = true;
    }
  }

  // --- 5. ライトラインの停留場（ホームと上屋）---
  const legs = trams?.legs || [];
  for (const e of elements) {
    if (e.type !== 'node' || !e.tags || e.tags.railway !== 'tram_stop') continue;
    const q = toLocal(e.lat, e.lon), p = [q.x, q.z];
    let best = null;
    for (const r of legs) { const pr = projectOnLine(r.points, p); if (pr.d < 8 && (!best || pr.d < best.pr.d)) best = { r, pr }; }
    if (!best) continue;
    const { r, pr } = best;
    const c = pointAt(r, pr.s);
    // ホームは反対の線と逆の側（外側）。反対の線 = 他の区間で、この点から最も近い点
    let side = 1, od = Infinity;
    for (const o of legs) {
      if (o === r) continue;
      const op = projectOnLine(o.points, [c.x, c.z]);
      if (op.d < od && op.d > 1) { od = op.d; const oc = pointAt(o, op.s); side = ((oc.x - c.x) * -c.dz + (oc.z - c.z) * c.dx) > 0 ? -1 : 1; }
    }
    const gStop = g(c.x, c.z);
    let n = 0;
    const roofCells = [];
    for (let t = -14; t <= 14; t += 0.5) for (let l = 2.2; l <= 4.4; l += 0.5) {
      const a = pointAt(r, pr.s + t);
      const x = Math.floor(a.x + -a.dz * l * side), z = Math.floor(a.z + a.dx * l * side);
      const k = cell(x, z);
      if (k < 0 || w.bld[k] || NO_BUILD_MAT.has(w.ground[k]) || placed.get(key(x, w.elev[k] + 1, z)) === B.PLATFORM) continue;
      if (get(x, w.elev[k] + 1, z) !== B.AIR) continue;
      put(x, w.elev[k] + 1, z, B.PLATFORM); n++;
      if (Math.abs(t) <= 6 && l >= 2.7) roofCells.push([x, z, k, Math.abs(Math.abs(t) - 6) < 0.5 && l >= 3.7]);
    }
    const roofY = gStop + 6; // ホーム面（g+2）から 4m 上
    for (const [x, z, k, post] of roofCells) {
      if (get(x, roofY, z) === B.AIR) put(x, roofY, z, B.STEEL);
      if (post) for (let y = w.elev[k] + 2; y < roofY; y++) if (get(x, y, z) === B.AIR) put(x, y, z, B.STEEL);
    }
    if (n) { stats.tramStops++; stats.tramStopBlocks += n + roofCells.length; }
  }

  // 一覧（Int16 の x, y, z, id）。元の地形と同じ値は除く
  const out = [];
  for (const [k, id] of placed) {
    const [x, y, z] = k.split(',').map(Number);
    if (originalBlockAt(w, x, y, z) !== id) out.push(x, y, z, id);
  }
  stats.blocks = out.length / 4;
  return { list: Int16Array.from(out), signs, stats };
}
