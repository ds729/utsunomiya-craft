// 実データ（public/world）で歩行シミュレーション: 壁抜け・床抜けが起きないこと
import test from 'node:test';
import assert from 'node:assert/strict';
import { createPlayer, stepPlayer, collides } from '../public/src/physics.js';
import { isSolidAt, isWaterAt } from '../public/src/world-data.js';
import { findSpawn } from '../public/src/spawn.js';
import { loadRealWorld } from './helpers/world.mjs';

const w = loadRealWorld();
const solid = (x, y, z) => isSolidAt(w, x, y, z);
const water = (x, y, z) => isWaterAt(w, x, y, z);
const DT = 1 / 60;

// 1 フレーム進めて不変条件を検査。詰まったら自動でジャンプ
function walker(p) {
  let hist = [];
  let frames = 0, maxClimb = p.y;
  return (input) => {
    hist.push([p.x, p.z]);
    if (hist.length > 30) hist.shift();
    const stuck = hist.length === 30 && Math.hypot(p.x - hist[0][0], p.z - hist[0][1]) < 0.5;
    stepPlayer(p, { ...input, jump: stuck || input.jump }, DT, solid, water);
    frames++;
    assert.ok(!collides(p.x, p.y, p.z, solid), `壁抜け: (${p.x.toFixed(2)}, ${p.y.toFixed(2)}, ${p.z.toFixed(2)}) frame ${frames}`);
    // 床抜け: 体が掛かる列がすべて水なら底(y=0)、それ以外は地表の上面(y=1)より下に行かない
    const cols = [];
    for (const dx of [-0.3, 0.3]) for (const dz of [-0.3, 0.3]) cols.push(water(Math.floor(p.x + dx), 0, Math.floor(p.z + dz)));
    const floor = cols.every(Boolean) ? 0 : 1;
    assert.ok(p.y >= floor - 1e-3, `床抜け: y=${p.y} (床 ${floor}) at (${p.x.toFixed(2)}, ${p.z.toFixed(2)})`);
    assert.ok(Math.abs(p.x) <= 1000 && Math.abs(p.z) <= 1000, 'ワールド外に出た');
    maxClimb = Math.max(maxClimb, p.y);
    return { maxClimb };
  };
}

test('スポーン地点から16方向に60秒ずつ歩いても壁抜け・床抜けしない', () => {
  const s = findSpawn(w, w.meta.spawnTarget.x, w.meta.spawnTarget.z);
  const dist = [];
  for (let d = 0; d < 16; d++) {
    const yaw = (d / 16) * Math.PI * 2;
    const p = createPlayer(s.x, s.y, s.z);
    const step = walker(p);
    let info;
    for (let f = 0; f < 60 * 60; f++) info = step({ forward: 1, yaw, sprint: true });
    dist.push(Math.round(Math.hypot(p.x - s.x, p.z - s.z)));
    // 床板より上には乗らない（ジャンプでは1ブロックまで）: 歩行中の最高点は建物の屋根程度に限られる
    assert.ok(info.maxClimb < 1 + 1.3 + 2, `高く登りすぎ ${info.maxClimb}`);
  }
  console.log('16方向の到達距離[m]', dist.join(','));
  // スポーンで閉じ込められていない（自動ジャンプで誤魔化していない）
  assert.ok(dist.filter((d) => d > 20).length >= 12, `20m 以上進めた方向が少ない: ${dist}`);
});

// ラスタ上の BFS（8近傍、周囲1セルも建物・水・ホームでないセルだけ通る）
function bfsPath(from, to) {
  const { W, H, west, north } = w;
  const ok = new Uint8Array(W * H);
  for (let j = 1; j < H - 1; j++) for (let i = 1; i < W - 1; i++) {
    let good = 1;
    for (let dj = -1; dj <= 1 && good; dj++) for (let di = -1; di <= 1; di++) {
      const k = (j + dj) * W + i + di;
      if (w.bld[k] || w.ground[k] === 5 || w.ground[k] === 9) { good = 0; break; }
    }
    ok[j * W + i] = good;
  }
  const s = (Math.floor(from.z) + north) * W + Math.floor(from.x) + west;
  const g = (Math.floor(to.z) + north) * W + Math.floor(to.x) + west;
  const prev = new Int32Array(W * H).fill(-1);
  prev[s] = s;
  const q = new Int32Array(W * H);
  let qh = 0, qt = 0;
  q[qt++] = s;
  while (qh < qt) {
    const k = q[qh++];
    if (k === g) break;
    const i = k % W, j = (k - i) / W;
    for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
      const n = (j + dj) * W + i + di;
      if ((di || dj) && ok[n] && prev[n] < 0) { prev[n] = k; q[qt++] = n; }
    }
  }
  if (prev[g] < 0) return null;
  const path = [];
  for (let k = g; k !== s; k = prev[k]) path.push({ x: (k % W) - west + 0.5, z: Math.floor(k / W) - north + 0.5 });
  return path.reverse();
}

test('駅（西側）→ 西口駅前広場 → 大通り を歩いて到達できる', () => {
  const start = findSpawn(w, -40, 0, 60);
  const plaza = findSpawn(w, -110, 20, 60); // 西口のバス乗り場付近
  const odori = findSpawn(w, -528, -88, 30); // 大通り（OSM の way 上の点）
  const legs = [bfsPath(start, plaza), bfsPath(plaza, odori)];
  assert.ok(legs[0] && legs[1], 'ラスタ上で経路が見つかる');
  const path = legs.flat();
  const p = createPlayer(start.x, start.y, start.z);
  const step = walker(p);
  let idx = 0, f = 0;
  for (; f < 60 * 400 && idx < path.length - 1; f++) {
    // セル中心を順にたどる（周囲1セルの余裕があるので角を切らなければ建物に当たらない）
    while (idx < path.length - 1 && Math.hypot(path[idx].x - p.x, path[idx].z - p.z) < 0.6) idx++;
    const t = path[idx];
    step({ forward: 1, yaw: Math.atan2(-(t.x - p.x), -(t.z - p.z)) });
  }
  const end = path[path.length - 1];
  const left = Math.hypot(end.x - p.x, end.z - p.z);
  console.log(`経路 ${path.length} セル、${(f / 60).toFixed(0)} 秒、到達誤差 ${left.toFixed(1)}m`, { start, plaza, odori });
  assert.ok(left < 3, `大通りに到達できない（残り ${left}m）`);
  // 地表を歩いている（床板の上などに乗っていない）
  assert.ok(Math.abs(p.y - 1) < 0.01, `y=${p.y}`);
});

// 道路系の材質（アスファルト・歩道・広場・駐車場）だけを 4 近傍でたどる経路
const ROAD = new Set([2, 3, 7, 8]);
function roadPath(from, to) {
  const { W, H, west, north } = w;
  const ok = (k) => ROAD.has(w.ground[k]) && w.bld[k] === 0 && (w.deck[k] === 0 || w.deck[k] >= 3);
  const snap = (p) => {
    const ci = Math.floor(p.x) + west, cj = Math.floor(p.z) + north;
    for (let r = 0; r < 60; r++) for (let dj = -r; dj <= r; dj++) for (let di = -r; di <= r; di++) {
      const k = (cj + dj) * W + ci + di;
      if (Math.max(Math.abs(di), Math.abs(dj)) === r && ok(k)) return k;
    }
    return -1;
  };
  const s = snap(from), g = snap(to);
  const prev = new Int32Array(W * H).fill(-1);
  const q = new Int32Array(W * H);
  let qh = 0, qt = 0;
  prev[s] = s; q[qt++] = s;
  while (qh < qt) {
    const k = q[qh++];
    if (k === g) break;
    for (const n of [k - 1, k + 1, k - W, k + W]) if (n >= 0 && n < W * H && prev[n] < 0 && ok(n)) { prev[n] = k; q[qt++] = n; }
  }
  if (prev[g] < 0) return null;
  const path = [];
  for (let k = g; k !== s; k = prev[k]) path.push({ x: (k % W) - west + 0.5, z: Math.floor(k / W) - north + 0.5 });
  path.push({ x: (s % W) - west + 0.5, z: Math.floor(s / W) - north + 0.5 });
  return path.reverse();
}

function follow(path, maxSec) {
  const p = createPlayer(path[0].x, 1, path[0].z);
  const step = walker(p);
  let idx = 0, f = 0;
  const end = path[path.length - 1];
  for (; f < 60 * maxSec && Math.hypot(end.x - p.x, end.z - p.z) > 0.3; f++) {
    while (idx < path.length - 1 && Math.hypot(path[idx].x - p.x, path[idx].z - p.z) < 0.35) idx++;
    const t = path[idx];
    step({ forward: 1, yaw: Math.atan2(-(t.x - p.x), -(t.z - p.z)) });
  }
  return { left: Math.hypot(end.x - p.x, end.z - p.z), sec: f / 60, p };
}

for (const [label, legs] of [
  ['西口駅前広場 → 大通り', [[-110, 20], [-300, -45], [-528, -88]]],
  ['東口 → 鬼怒通り', [[w.meta.spawnTarget.x, w.meta.spawnTarget.z], [420, 92]]],
]) {
  test(`道路系の材質だけで ${label} がつながり、歩いて到達できる`, () => {
    const path = [];
    for (let i = 0; i + 1 < legs.length; i++) {
      const seg = roadPath({ x: legs[i][0], z: legs[i][1] }, { x: legs[i + 1][0], z: legs[i + 1][1] });
      assert.ok(seg, `道路がつながっていない: ${legs[i]} → ${legs[i + 1]}`);
      path.push(...(path.length ? seg.slice(1) : seg));
    }
    const r = follow(path, 900);
    console.log(`${label}: 道路 ${path.length} セル、${r.sec.toFixed(0)} 秒、到達誤差 ${r.left.toFixed(2)}m`);
    assert.ok(r.left < 1, `到達できない（残り ${r.left}m）`);
  });
}
