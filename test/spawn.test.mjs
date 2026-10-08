import test from 'node:test';
import assert from 'node:assert/strict';
import { findSpawn } from '../public/src/spawn.js';
import { collides } from '../public/src/physics.js';
import { isSolidAt } from '../public/src/world-data.js';
import { makeTestWorld, loadRealWorld } from './helpers/world.mjs';

test('建物の中・水の中を目標にしても外に出す', () => {
  const w = makeTestWorld(64, (x, z) => {
    if (x >= -5 && x < 5 && z >= -5 && z < 5) return { bld: 10 };
    if (x >= -10 && x < 10 && z >= 5 && z < 12) return { ground: 5 };
    return {};
  });
  for (const [x, z] of [[0, 0], [0, 8]]) {
    const s = findSpawn(w, x, z);
    assert.ok(s, '見つかる');
    assert.ok(!collides(s.x, s.y, s.z, (a, b, c) => isSolidAt(w, a, b, c)));
    const k = (Math.floor(s.z) + 32) * 64 + Math.floor(s.x) + 32;
    assert.equal(w.bld[k], 0);
    assert.notEqual(w.ground[k], 5);
  }
});

test('広場・歩道を優先する', () => {
  const w = makeTestWorld(64, (x, z) => (x === 10 && z === 0 ? { ground: 7 } : {}));
  const s = findSpawn(w, 0, 0);
  assert.deepEqual([s.x, s.z], [10.5, 0.5]);
});

test('実データ: 東口のスポーン地点は歩行可能で、駅の東側にある', () => {
  const w = loadRealWorld();
  const t = w.meta.spawnTarget;
  const s = findSpawn(w, t.x, t.z);
  assert.ok(s);
  assert.ok(s.x > 30, `駅舎より東 x=${s.x}`);
  assert.ok(Math.hypot(s.x - t.x, s.z - t.z) < 80, '目標の近く');
  assert.ok(!collides(s.x, s.y, s.z, (a, b, c) => isSolidAt(w, a, b, c)));
  console.log('spawn', s, 'target', t);
});

test('編集差分を考慮: 置いたブロックの中や掘った穴にはスポーンしない', async () => {
  const { EditStore } = await import('../public/src/edits.js');
  const { makeWorld } = await import('../public/src/world-data.js');
  const base = makeTestWorld(64);
  const w = makeWorld(base.meta, base, new EditStore());
  w.edits.set(0, 1, 0, 22); w.edits.set(0, 2, 0, 22); // 2段の柱
  w.edits.set(1, 0, 0, 0);                            // 穴
  const s = findSpawn(w, 0.5, 0.5);
  assert.ok(!(Math.floor(s.x) === 0 && Math.floor(s.z) === 0), '柱の中に出ない');
  assert.ok(!(Math.floor(s.x) === 1 && Math.floor(s.z) === 0), '穴に出ない');
  assert.ok(!collides(s.x, s.y, s.z, (a, b, c) => isSolidAt(w, a, b, c)));
});
