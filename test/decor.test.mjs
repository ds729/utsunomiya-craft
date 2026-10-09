import test from 'node:test';
import assert from 'node:assert/strict';
import { B } from '../public/src/blocks.js';
import { blockAt, isSolidAt, isWaterAt, cellIndex } from '../public/src/world-data.js';
import { createPlayer, stepPlayer, collides } from '../public/src/physics.js';
import { loadRealWorld } from './helpers/world.mjs';

const w = loadRealWorld();
const solid = (x, y, z) => isSolidAt(w, x, y, z);
const water = (x, y, z) => isWaterAt(w, x, y, z);
const st = w.meta.decorStats;

test('装飾: 手すり・階段・駅名板（東西）・餃子像・停留場が置かれている', () => {
  assert.ok(w.decor, 'decor.bin.gz を読み込む');
  assert.ok(st.railings > 1000, `手すり ${st.railings}`);
  assert.ok(st.stairs >= 8, `階段 ${st.stairs}`);
  assert.equal(st.signs, 2);
  assert.deepEqual(w.meta.signs.map((s) => s.facing).sort(), ['east', 'west']);
  assert.equal(st.statue, 1);
  assert.ok(st.tramStops >= 4, `停留場 ${st.tramStops}`);
  // 東口（駅の東側、x>0）のデッキにも階段がある
  assert.ok(st.stairsAt.some((s) => s.top[0] > 50), '東口デッキの階段');
  // 餃子像は OSM の「餃子像」から 8m 以内
  const [sx, sz] = st.statueAt;
  assert.ok(Math.hypot(sx + 64, sz - 4) <= 9, `餃子像の位置 ${st.statueAt}`);
  let gy = 0;
  for (let y = 0; y < 40; y++) if (blockAt(w, sx, y, sz) === B.GYOZA) gy++;
  assert.ok(gy >= 2, '餃子のブロック');
});

test('装飾: どの階段も地上から歩いて（自動で1段ずつ上がって）デッキの上に出られ、下りても戻れる', () => {
  for (const s of st.stairsAt) {
    const [tx, tz] = s.top, [ux, uz] = s.dir;
    const bottom = { x: tx + ux * (s.steps + 2), z: tz + uz * (s.steps + 2) };
    const deckTarget = { x: tx - ux * 2, z: tz - uz * 2 };
    const k = cellIndex(w, Math.floor(bottom.x), Math.floor(bottom.z));
    const p = createPlayer(bottom.x, w.elev[k] + 1, bottom.z);
    const goto = (t, sec) => {
      for (let f = 0; f < sec * 60; f++) {
        const dx = t.x - p.x, dz = t.z - p.z;
        if (Math.hypot(dx, dz) < 0.3) break;
        stepPlayer(p, { forward: 1, yaw: Math.atan2(-dx, -dz) }, 1 / 60, solid, water);
        assert.ok(!collides(p.x, p.y, p.z, solid), `めり込み ${JSON.stringify(s)}`);
      }
    };
    const y0 = p.y;
    goto(deckTarget, 12);
    const deckSurface = s.steps + y0; // デッキの上面 = 地上の足元 + 段数（付け根の地表を基準）
    assert.ok(p.y >= deckSurface - 1.01, `デッキに上がれない ${JSON.stringify(s)} y=${p.y.toFixed(2)} 地上=${y0} 目標≈${deckSurface}`);
    goto(bottom, 12);
    assert.ok(Math.abs(p.y - y0) < 1.01, `下りられない ${JSON.stringify(s)} y=${p.y}`);
  }
});

test('装飾: デッキの縁は手すりで、歩いて落ちない（東口デッキの上を16方向に歩く）', () => {
  // 東口デッキの上: 階段の上り口から少しデッキ側に入り、周囲 2 マスがすべて同じ高さの床板（手すりなし）の点から歩く
  const start = st.stairsAt.find((s) => s.top[0] > 50);
  let sx = null, sz = null, deckTop = 0;
  const flat = (x, z) => {
    const k = cellIndex(w, x, z);
    if (!w.deck[k]) return -1;
    const y = w.elev[k] + 1 + w.deck[k];
    return blockAt(w, x, y, z) === B.DECK && blockAt(w, x, y + 1, z) === B.AIR ? y : -1;
  };
  for (let r = 2; r < 20 && sx === null; r++) {
    const cx = Math.round(start.top[0] - start.dir[0] * r), cz = Math.round(start.top[1] - start.dir[1] * r);
    const y = flat(cx, cz);
    let ok = y >= 0;
    for (let dz = -2; dz <= 2 && ok; dz++) for (let dx = -2; dx <= 2 && ok; dx++) if (flat(cx + dx, cz + dz) !== y) ok = false;
    if (ok) { sx = cx + 0.5; sz = cz + 0.5; deckTop = y + 1; }
  }
  assert.ok(sx !== null, 'デッキの上の出発点');
  // 床板より 1.5m 以上下がった最初の位置が、階段の範囲（上り口から段数ぶん、幅 3）でなければ「落ちた」
  const onStairs = (x, z) => st.stairsAt.some((s) => {
    const rx = x - s.top[0], rz = z - s.top[1];
    const t = rx * s.dir[0] + rz * s.dir[1], l = Math.abs(-rx * s.dir[1] + rz * s.dir[0]);
    return t > -1.5 && t < s.steps + 1.5 && l < 2.5;
  });
  let fell = 0, down = 0;
  for (let d = 0; d < 16; d++) {
    const yaw = (d / 16) * Math.PI * 2;
    const p = createPlayer(sx, deckTop, sz);
    for (let f = 0; f < 60 * 15; f++) {
      stepPlayer(p, { forward: 1, yaw }, 1 / 60, solid, water);
      assert.ok(!collides(p.x, p.y, p.z, solid));
      if (p.y < deckTop - 1.5) {
        if (onStairs(p.x, p.z)) down++; else { fell++; console.log('落下', d, p.x.toFixed(1), p.z.toFixed(1)); }
        break;
      }
    }
  }
  console.log(`デッキから16方向: 階段で下りた ${down}、落ちた ${fell}`);
  assert.equal(fell, 0, 'デッキの縁から落ちた方向がある');
});
