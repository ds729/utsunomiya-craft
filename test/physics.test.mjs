import test from 'node:test';
import assert from 'node:assert/strict';
import { createPlayer, stepPlayer, collides, pressJump, PLAYER, PHYS } from '../public/src/physics.js';
import { isSolidAt, isWaterAt } from '../public/src/world-data.js';
import { headingToYaw } from '../public/src/geo.js';
import { makeTestWorld } from './helpers/world.mjs';

const world = makeTestWorld(64, (x, z) => {
  if (x >= 5 && x < 7 && z >= -10 && z < 10) return { bld: 10 };  // 東に壁
  if (x === -3 && z >= -10 && z < 10) return { ground: 9 };        // 西に1段（ホーム）
  if (x === -6 && z >= -10 && z < 10) return { bld: 2 };           // その先に2段
  if (x >= -2 && x < 2 && z >= -12 && z <= -10) return { ground: 5 }; // 北に水
  return {};
});
const solid = (x, y, z) => isSolidAt(world, x, y, z);
const water = (x, y, z) => isWaterAt(world, x, y, z);
const run = (p, input, sec, check) => { for (let t = 0; t < sec; t += 1 / 60) { stepPlayer(p, input, 1 / 60, solid, water); check?.(p); } return p; };
const noClip = (p) => assert.ok(!collides(p.x, p.y, p.z, solid), `めり込み (${p.x.toFixed(3)},${p.y.toFixed(3)},${p.z.toFixed(3)})`);

test('重力で地面(y=1)に立つ', () => {
  const p = run(createPlayer(0.5, 5, 0.5), {}, 2, noClip);
  assert.ok(Math.abs(p.y - 1) < 0.01, `y=${p.y}`);
  assert.equal(p.onGround, true);
});

test('壁で止まる（東へ歩き続けても x < 5-0.3）', () => {
  const p = run(createPlayer(0.5, 1, 0.5), { forward: 1, yaw: headingToYaw(90), sprint: true }, 5, noClip);
  assert.ok(p.x <= 5 - PLAYER.W / 2 && p.x > 4.5, `x=${p.x}`);
});

test('歩行速度 4.3m/s、ダッシュ 5.6m/s、向き（yaw=0 は北 = -z）', () => {
  const p = run(createPlayer(0.5, 1, 0.5), { forward: 1, yaw: 0 }, 1);
  assert.ok(Math.abs(p.z - (0.5 - PHYS.WALK)) < 0.1, `z=${p.z}`);
  const q = run(createPlayer(0.5, 1, 0.5), { forward: 1, yaw: headingToYaw(180), sprint: true }, 1);
  assert.ok(Math.abs(q.z - (0.5 + PHYS.SPRINT)) < 0.1, `z=${q.z}`);
});

test('1段はジャンプで登れ、2段は登れない', () => {
  const p = run(createPlayer(0.5, 1, 0.5), { forward: 1, yaw: headingToYaw(270), jump: true }, 3, noClip);
  assert.ok(p.x < -5 + PLAYER.W && p.x > -5, `ホームに登って2段の壁で止まる x=${p.x}`);
  const q = run(createPlayer(0.5, 1, 0.5), { forward: 1, yaw: headingToYaw(270) }, 3, noClip);
  assert.ok(q.x >= -2 + PLAYER.W / 2 - 0.01, `ジャンプしないと1段で止まる x=${q.x}`);
});

test('水に入ると沈み、ジャンプで岸に上がれる', () => {
  const p = run(createPlayer(0.5, 1, -8), { forward: 1, yaw: 0 }, 1.2, noClip);
  assert.ok(p.y < 0.5 && p.inWater, `水中 y=${p.y}`);
  run(p, { forward: 1, yaw: 0, jump: true }, 3, noClip);
  run(p, {}, 1, noClip);
  assert.ok(p.z < -13 && Math.abs(p.y - 1) < 0.01, `対岸 z=${p.z} y=${p.y}`);
});

test('Space 2連打でフライ、上昇・下降しても壁を抜けない', () => {
  const p = createPlayer(0.5, 1, 0.5);
  assert.equal(pressJump(p, 10), false);
  assert.equal(pressJump(p, 10.2), true);
  assert.equal(p.flying, true);
  run(p, { jump: true }, 1, noClip);
  assert.ok(p.y > 8, `上昇 y=${p.y}`);
  run(p, { forward: 1, yaw: headingToYaw(90) }, 3, noClip);
  assert.ok(p.x < 5, 'フライ中も壁で止まる');
  run(p, { down: true }, 3, noClip);
  assert.ok(Math.abs(p.y - 1) < 0.01, `着地 y=${p.y}`);
  assert.equal(pressJump(p, 20), false);
  assert.equal(pressJump(p, 20.5), false, '0.3秒より遅いと切り替えない');
});

test('大きな dt でもトンネリングしない', () => {
  const p = createPlayer(0.5, 6, 0.5); // 壁（高さ10）より低い位置から
  for (let i = 0; i < 20; i++) stepPlayer(p, { forward: 1, yaw: headingToYaw(90) }, 0.5, solid, water);
  noClip(p);
  assert.ok(p.x < 5 && p.y >= 1 - 1e-3);
});
