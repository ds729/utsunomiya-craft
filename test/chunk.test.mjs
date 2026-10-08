import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { B, GROUND_BLOCK, TILE_NAMES } from '../public/src/blocks.js';
import { blockAt, isSolidAt, Y_MIN, CHUNK_H } from '../public/src/world-data.js';
import { generateChunk, generatePadded, meshChunk, CS } from '../public/src/chunk.js';
import { makeTestWorld } from './helpers/world.mjs';

// x,z はローカル座標（-32..31）
const world = makeTestWorld(64, (x, z) => {
  if (x >= 4 && x < 8 && z >= 4 && z < 8) return { bld: 7, bldtype: 3 };        // 高さ7の建物
  if (x >= 10 && x < 14 && z === 0) return { deck: 6, ground: 2 };              // 下面6mの床板（下はアスファルト）
  if (x === -5 && z === -5) return { ground: 5 };                                // 水
  if (x === -8 && z === -8) return { ground: 9 };                                // ホーム
  if (x === -12 && z === -12) return { bld: 4, bldtype: 9 };                     // 屋根だけ（バス乗り場の上屋）
  if (x === -15 && z === -15) return { bld: 15, bldtype: 5, ground: 14 };        // 線路の上の駅舎（橋上駅）
  if (x === -16 && z === -15) return { bld: 15, bldtype: 5, ground: 9, deck: 12 }; // ホームの上の駅舎＋高架
  if (x >= 14 && x < 18 && z >= -2 && z < 2) return { bld: 3, bldtype: 1 };      // チャンク境界(x=16)をまたぐ建物
  return {};
});

test('列の構造: 岩盤・土・地表・建物（屋根・窓の段）', () => {
  assert.equal(blockAt(world, 0, -4, 0), B.BEDROCK);
  for (let y = -3; y < 0; y++) assert.equal(blockAt(world, 0, y, 0), B.DIRT);
  assert.equal(blockAt(world, 0, 0, 0), B.GRASS);
  assert.equal(blockAt(world, 0, 1, 0), B.AIR);
  assert.equal(blockAt(world, 5, 1, 5), B.WALL);
  assert.equal(blockAt(world, 5, 2, 5), B.WALL_WIN, '3m ごとの窓の段');
  assert.equal(blockAt(world, 5, 5, 5), B.WALL_WIN);
  assert.equal(blockAt(world, 5, 7, 5), B.ROOF);
  assert.equal(blockAt(world, 5, 8, 5), B.AIR);
  assert.equal(blockAt(world, -5, 0, -5), B.WATER);
  assert.equal(blockAt(world, -8, 1, -8), B.PLATFORM, 'ホームは1段高い');
  for (let y = 1; y < 4; y++) assert.equal(blockAt(world, -12, y, -12), B.AIR, '上屋の下は通れる');
  assert.equal(blockAt(world, -12, 4, -12), B.ROOF);
  assert.equal(blockAt(world, -15, 0, -15), B.RAIL);
  for (let y = 1; y <= 6; y++) assert.equal(blockAt(world, -15, y, -15), B.AIR, `駅舎の下の線路は空いている y=${y}`);
  assert.equal(blockAt(world, -15, 7, -15), B.DECK, '駅舎の床');
  assert.equal(blockAt(world, -15, 8, -15), B.WALL_WIN);
  assert.equal(blockAt(world, -15, 9, -15), B.WALL);
  assert.equal(blockAt(world, -15, 15, -15), B.ROOF);
  assert.equal(blockAt(world, -16, 1, -15), B.PLATFORM);
  assert.equal(blockAt(world, -16, 2, -15), B.AIR);
  assert.equal(blockAt(world, -16, 13, -15), B.WALL, '駅舎の中の高架床板は省略');
});

test('床板: 下面高さ d の1ブロック厚、下は空洞', () => {
  assert.equal(blockAt(world, 11, 0, 0), B.ASPHALT);
  for (let y = 1; y <= 6; y++) assert.equal(blockAt(world, 11, y, 0), B.AIR, `y=${y}`);
  assert.equal(blockAt(world, 11, 7, 0), B.DECK);
  assert.equal(blockAt(world, 11, 8, 0), B.AIR);
});

test('衝突: 範囲外は壁、水は通り抜け', () => {
  assert.equal(isSolidAt(world, 100, 5, 0), true);
  assert.equal(isSolidAt(world, 0, Y_MIN - 1, 0), true);
  assert.equal(isSolidAt(world, -5, 0, -5), false);
  assert.equal(isSolidAt(world, 11, 7, 0), true);
});

test('generateChunk は blockAt と一致する', () => {
  const c = generateChunk(world, 0, 0);
  for (let yi = 0; yi < CHUNK_H; yi += 3) for (let z = 0; z < CS; z += 3) for (let x = 0; x < CS; x += 3) {
    assert.equal(c[(yi * CS + z) * CS + x], blockAt(world, x, yi + Y_MIN, z));
  }
});

// メッシュから「ある位置・向きの面」があるか
function hasFace(m, x0, y0, z0, x1, y1, z1) {
  const P = m.positions;
  for (let v = 0; v < P.length; v += 12) {
    const xs = [P[v], P[v + 3], P[v + 6], P[v + 9]], ys = [P[v + 1], P[v + 4], P[v + 7], P[v + 10]], zs = [P[v + 2], P[v + 5], P[v + 8], P[v + 11]];
    if (Math.min(...xs) === x0 && Math.max(...xs) === x1 && Math.min(...ys) === y0 && Math.max(...ys) === y1 && Math.min(...zs) === z0 && Math.max(...zs) === z1) return true;
  }
  return false;
}

test('面カリング: 平地は上面のみ、建物は外周だけ', () => {
  const flat = makeTestWorld(64);
  const m = meshChunk(generatePadded(flat, -1, -1)); // ワールド中央に接するチャンク（周囲もワールド内）
  assert.equal(m.faces, CS * CS, '平坦な地面は上面だけ（側面・下面なし）');
  const mb = meshChunk(generatePadded(world, 0, 0));
  // 建物 4×4×7: 側面 4辺×4×7=112、屋根 16。地面の上面は建物の下が消えて 256-16
  assert.ok(hasFace(mb, 4, 1, 4, 8, 2, 4) === false, '面は1ブロック単位');
  assert.ok(hasFace(mb, 4, 1, 4, 5, 2, 4), '建物の北面');
  assert.ok(!hasFace(mb, 5, 1, 5, 6, 1, 6), '地面と建物の接する面は描かない');
});

test('チャンク境界: 隣チャンクの建物に接する面を描かない（空気扱いしない）', () => {
  // x=14..17 の建物が x=16 の境界をまたぐ。チャンク0側の x=16 面（建物内部）は出さない
  const m0 = meshChunk(generatePadded(world, 0, -1));
  const m1 = meshChunk(generatePadded(world, 0, 0));
  const m2 = meshChunk(generatePadded(world, 1, 0));
  for (const m of [m0, m1, m2]) for (let y = 1; y <= 3; y++) assert.ok(!hasFace(m, 16, y, 0, 16, y + 1, 1), `y=${y}`);
  assert.ok(hasFace(m1, 14, 1, 0, 14, 2, 1), '建物の西面は描く');
  assert.ok(hasFace(m2, 18, 1, 0, 18, 2, 1), '建物の東面は隣チャンク側で描く');
});

test('ワールド範囲外の隣は空気（外周に側面が出る）', () => {
  const m = meshChunk(generatePadded(world, -2, -2));
  assert.ok(hasFace(m, -32, 0, -32, -32, 1, -31));
});

test('メッシュの配列長と index の型', () => {
  const m = meshChunk(generatePadded(world, 0, 0));
  assert.equal(m.positions.length, m.vertexCount * 3);
  assert.equal(m.uvs.length, m.vertexCount * 2);
  assert.equal(m.colors.length, m.vertexCount * 3);
  assert.equal(m.indices.length, m.faces * 6);
  assert.ok(m.indices instanceof Uint16Array);
  for (const u of m.uvs) assert.ok(u > 0 && u < 1);
});

test('地表ブロック対応が world.json の材質と一致', () => {
  const meta = JSON.parse(fs.readFileSync(new URL('../public/world/world.json', import.meta.url)));
  const name = { GRASS: 'grass', DIRT: 'dirt', ASPHALT: 'asphalt', SIDEWALK: 'sidewalk', BALLAST: 'ballast', WATER: 'water', PARK: 'park', PLAZA: 'plaza', PARKING: 'parking', PLATFORM: 'platform', TRAM: 'tram', URBAN: 'urban', FARMLAND: 'farmland', FOREST: 'forest', RAIL: 'rail' };
  const byId = Object.fromEntries(Object.entries(B).map(([k, v]) => [v, k]));
  for (const [id, mat] of Object.entries(meta.materials)) assert.equal(name[byId[GROUND_BLOCK[id]]], mat, `材質 ${id}`);
  assert.ok(TILE_NAMES.length <= 32);
});

test('線路の模様は東西に続くとき 90° 回す', () => {
  const w = makeTestWorld(64, (x, z) => (z === 3 ? { ground: 14 } : x === 3 ? { ground: 14 } : {}));
  const m = meshChunk(generatePadded(w, 0, 0));
  // 上面の頂点0の uv を、セル (x, z) について取り出す
  const uvAt = (x, z) => {
    for (let v = 0; v < m.vertexCount; v += 4) {
      if (m.positions[v * 3] === x && m.positions[v * 3 + 1] === 1 && m.positions[v * 3 + 2] === z + 1) return [m.uvs[v * 2], m.uvs[v * 2 + 2]];
    }
  };
  const [ew0, ew1] = uvAt(8, 3), [ns0, ns1] = uvAt(3, 8);
  assert.ok(ns0 < ns1, '南北の線路は通常の向き');
  assert.equal(ew0, ew1, '東西の線路は回転（c0 と c1 の u が同じ）');
});

test('ChunkManager.rebuild: 読み込み済みのチャンクだけ作り直し、頂点数の集計を更新する', async () => {
  const { ChunkManager } = await import('../public/src/chunks.js');
  const { EditStore } = await import('../public/src/edits.js');
  const { makeWorld } = await import('../public/src/world-data.js');
  const base = makeTestWorld(64);
  const w = makeWorld(base.meta, base, new EditStore());
  const made = [], disposed = [];
  const m = new ChunkManager(w, { viewDist: 2, makeMesh: (x) => (made.push(x), x), disposeMesh: (x) => disposed.push(x) });
  while (m.update(0, 0, 1000) > 0);
  const v0 = m.stats.vertices;
  w.edits.set(3, 1, 3, B.STONE);
  assert.equal(m.rebuild(0, 0), true);
  assert.equal(disposed.length, 1);
  // 石1個: 上面と側面4つの5面が増え、下の地面の上面1つが隠れる → +4面 = +16頂点
  assert.equal(m.stats.vertices, v0 + 16);
  assert.equal(m.rebuild(50, 50), false);
});
