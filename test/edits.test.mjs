import test from 'node:test';
import assert from 'node:assert/strict';
import { EditStore, raycast, affectedChunks } from '../public/src/edits.js';
import { B } from '../public/src/blocks.js';
import { blockAt, isSolidAt } from '../public/src/world-data.js';
import { generatePadded, meshChunk } from '../public/src/chunk.js';
import { makeTestWorld } from './helpers/world.mjs';
import { makeWorld } from '../public/src/world-data.js';

const withEdits = () => { const base = makeTestWorld(64); return makeWorld(base.meta, base, new EditStore()); };

test('EditStore: 設定・取得・負の座標・解除・保存形式', () => {
  const e = new EditStore();
  assert.deepEqual(e.set(-1, 5, -17, B.BRICK), [-1, -2]);
  assert.equal(e.get(-1, 5, -17), B.BRICK);
  assert.equal(e.get(-1, 6, -17), undefined);
  const s = e.serialize(-1, -2);
  const f = new EditStore();
  f.load(-1, -2, s);
  assert.equal(f.get(-1, 5, -17), B.BRICK);
  e.unset(-1, 5, -17);
  assert.equal(e.get(-1, 5, -17), undefined);
  assert.equal(e.size, 0);
});

test('編集は blockAt・衝突・チャンク生成（隣チャンクの余白も）に反映される', () => {
  const w = withEdits();
  w.edits.set(15, 1, 3, B.STONE);  // チャンク0の東端
  w.edits.set(5, 0, 5, B.AIR);     // 地面に穴
  assert.equal(blockAt(w, 15, 1, 3), B.STONE);
  assert.equal(isSolidAt(w, 15, 1, 3), true);
  assert.equal(isSolidAt(w, 5, 0, 5), false);
  const pad0 = generatePadded(w, 0, 0), pad1 = generatePadded(w, 1, 0);
  const at = (pad, px, by, pz) => pad.blocks[(by + 4) * 18 * 18 + pz * 18 + px];
  assert.equal(at(pad0, 16, 1, 4), B.STONE);
  assert.equal(at(pad1, 0, 1, 4), B.STONE, '隣チャンクの余白にも反映');
  // 穴の側面が見える（穴の中の土の面が出る）
  const flat = meshChunk(generatePadded(makeTestWorld(64), 0, 0)).faces;
  assert.ok(meshChunk(pad0).faces > flat);
});

test('affectedChunks: 境界のブロックは隣チャンクも作り直す', () => {
  assert.deepEqual(affectedChunks(5, 5), [[0, 0]]);
  assert.deepEqual(affectedChunks(15, 0), [[0, 0], [1, 0], [0, -1]]);
  assert.deepEqual(affectedChunks(-16, 3), [[-1, 0], [-2, 0]]);
});

test('raycast: 最初に当たるブロックと面の法線', () => {
  const solid = (x, y, z) => y <= 0 || (x === 3 && y === 1);
  const down = raycast([0.5, 2.62, 0.5], [0, -1, 0], 6, solid);
  assert.deepEqual([down.x, down.y, down.z, down.ny], [0, 0, 0, 1]);
  const east = raycast([0.5, 1.5, 0.5], [1, 0, 0], 6, solid);
  assert.deepEqual([east.x, east.y, east.z, east.nx], [3, 1, 0, -1]);
  assert.ok(Math.abs(east.dist - 2.5) < 1e-9);
  assert.equal(raycast([0.5, 1.5, 0.5], [0, 1, 0], 6, solid), null, '空は当たらない');
  assert.equal(raycast([0.5, 1.5, 0.5], [-1, 0, 0], 2, solid), null, '届かない');
  const diag = raycast([0.5, 1.5, 0.5], [1, -0.2, 0.05], 6, solid);
  assert.ok(diag && (diag.y === 0 || (diag.x === 3 && diag.y === 1)));
});

test('破壊・設置のルール: 岩盤は壊せない、自分の位置には置けない、空気と水にだけ置ける', async () => {
  const { breakAt, placeAt } = await import('../public/src/edits.js');
  const { cellIndex, Y_MIN, Y_MAX } = await import('../public/src/world-data.js');
  const { UNBREAKABLE } = await import('../public/src/blocks.js');
  const { collides } = await import('../public/src/physics.js');
  const w = withEdits();
  const player = { x: 0.5, y: 1, z: 0.5 };
  const deps = {
    blockAt, cellIndex, yMin: Y_MIN, yMax: Y_MAX, unbreakable: UNBREAKABLE,
    isReplaceable: (id) => id === B.AIR || id === B.WATER,
    overlapsPlayer: (x, y, z) => collides(player.x, player.y, player.z, (a, b, c) => a === x && b === y && c === z),
  };
  assert.equal(breakAt(w, { x: 3, y: -4, z: 3 }, deps), null, '岩盤');
  assert.deepEqual(breakAt(w, { x: 3, y: 0, z: 3 }, deps), [3, 0, 3]);
  assert.equal(blockAt(w, 3, 0, 3), B.AIR);
  assert.deepEqual(placeAt(w, { x: 2, y: 0, z: 2, nx: 0, ny: 1, nz: 0 }, B.BRICK, deps), [2, 1, 2]);
  assert.equal(blockAt(w, 2, 1, 2), B.BRICK);
  assert.equal(placeAt(w, { x: 0, y: 0, z: 0, nx: 0, ny: 1, nz: 0 }, B.BRICK, deps), null, 'プレイヤーの足元');
  assert.equal(placeAt(w, { x: 1, y: 0, z: 1, nx: 0, ny: 0, nz: 0 }, B.BRICK, deps), null, '固体の場所');
  assert.equal(placeAt(w, { x: 40, y: 0, z: 1, nx: 0, ny: 1, nz: 0 }, B.BRICK, deps), null, 'ワールド外');
});
