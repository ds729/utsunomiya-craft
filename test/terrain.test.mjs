import test from 'node:test';
import assert from 'node:assert/strict';
import { lonLatToPixel, tilesInBBox, parseDemText, sampleTiles, fillGaps } from '../tools/lib/dem.mjs';
import { boxBlur, limitSlope, levelBanks, flattenBuildings } from '../tools/lib/terrain.mjs';
import { MAT } from '../tools/lib/tags.mjs';
import { bboxFromExtent } from '../tools/lib/geo.mjs';
import { loadRealWorld } from './helpers/world.mjs';

test('標高タイル: 座標→タイル、テキストの解析（欠測 e は NaN）、双一次補間', () => {
  // 経度 0・緯度 0 は z=1 で 256 px（タイル境界）
  assert.deepEqual(lonLatToPixel(0, 0, 1), { px: 256, py: 256 });
  // 宇都宮駅付近は z15 で x=29117, y=12804
  const p = lonLatToPixel(36.5592288, 139.8983323, 15);
  assert.deepEqual([Math.floor(p.px / 256), Math.floor(p.py / 256)], [29117, 12804]);
  // ワールド（2km 四方＋余白 100m）は z15 で 3×3 タイル
  const bbox = bboxFromExtent(36.5592288, 139.8983323, { west: 1000, east: 1000, north: 1000, south: 1000 }, 100);
  assert.equal(tilesInBBox(bbox, 15).length, 9);
  const rows = Array.from({ length: 256 }, (_, j) => Array.from({ length: 256 }, (_, i) => (i === 3 && j === 0 ? 'e' : String(i))).join(','));
  const t = parseDemText(rows.join('\n'));
  assert.equal(t[5], 5);
  assert.ok(Number.isNaN(t[3]));
  const tiles = new Map([['0,0', t]]);
  assert.ok(Math.abs(sampleTiles(tiles, 10.5, 5.5) - 10) < 1e-6, '画素中心はその値');
  assert.ok(Math.abs(sampleTiles(tiles, 11, 5.5) - 10.5) < 1e-6, '画素の間は補間');
  assert.equal(sampleTiles(tiles, 3, 0.5), 2, '欠測（画素 3）は重みから外し、隣の値だけで補間');
  assert.ok(Number.isNaN(sampleTiles(new Map(), 1, 1)));
  const a = Float32Array.from([1, NaN, NaN, 3]);
  assert.equal(fillGaps(a, 4, 1), 2);
  assert.ok(a.every((v) => Number.isFinite(v)));
});

test('地形: ぼかし・隣接差1以下・岸の高さ・建物の敷地を平らに', () => {
  const W = 8, H = 8;
  const flat = boxBlur(new Float32Array(W * H).fill(5), W, H, 2);
  assert.ok(flat.every((v) => Math.abs(v - 5) < 1e-6), '一定値はぼかしても同じ');
  // 崖（左 0 / 右 5）は 1 段ずつに下げられる
  const g = Uint8Array.from({ length: W * H }, (_, k) => (k % W < 4 ? 0 : 5));
  limitSlope(g, W, H);
  for (let k = 0; k < W * H; k++) if (k % W) assert.ok(Math.abs(g[k] - g[k - 1]) <= 1);
  assert.deepEqual([...g.slice(0, 8)], [0, 0, 0, 0, 1, 2, 3, 4]);
  // 岸: 水(高さ 2)に接する陸は 2 以下（接する水の最低に合わせる）
  const ground = new Uint8Array(W * H); ground[3 * W + 3] = MAT.WATER;
  const g2 = new Uint8Array(W * H).fill(4); g2[3 * W + 3] = 2;
  levelBanks(g2, ground, W, H);
  assert.equal(g2[2 * W + 2], 2);
  assert.equal(g2[0], 4);
  // 建物: 同じ高さ・種別の塊は最高値に。skip のセルはそのまま
  const bld = new Uint8Array(W * H), bt = new Uint8Array(W * H);
  const g3 = Uint8Array.from({ length: W * H }, (_, k) => k % W);
  for (const k of [9, 10, 11]) bld[k] = 10;
  bld[20] = 10; // 離れた別の建物
  flattenBuildings(g3, bld, bt, W, H, (k) => k === 20);
  assert.deepEqual([...g3.slice(9, 12)], [3, 3, 3]);
  assert.equal(g3[20], 4);
});

test('実データ: 起伏は緩やか（建物以外の隣接セルの差は1以下）、水からは1段で岸に上がれる', () => {
  const w = loadRealWorld();
  const { W, H, elev, bld, ground } = w;
  assert.ok(w.meta.terrain.max > 10, `起伏がある max=${w.meta.terrain.max}`);
  let worst = 0, banksBad = 0, waterCells = 0;
  for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
    const k = j * W + i;
    if (bld[k]) continue;
    for (const q of [i + 1 < W ? k + 1 : -1, j + 1 < H ? k + W : -1]) {
      if (q < 0 || bld[q]) continue;
      worst = Math.max(worst, Math.abs(elev[k] - elev[q]));
    }
    if (ground[k] === MAT.WATER) {
      waterCells++;
      for (const q of [i > 0 ? k - 1 : -1, i + 1 < W ? k + 1 : -1, k - W, k + W]) if (q >= 0 && q < W * H && ground[q] !== MAT.WATER && !bld[q] && elev[q] > elev[k]) banksBad++;
    }
  }
  console.log(`起伏 0..${w.meta.terrain.max}（標高 ${w.meta.terrain.base}m〜）、建物以外の隣接差の最大 ${worst}、水セル ${waterCells}`);
  assert.ok(worst <= 1, `隣接差 ${worst}`);
  assert.equal(banksBad, 0, '水より高い岸');
});

test('高架: 短い床板は塊ごとに水平、長い高架は緩やかに、下は3m以上空ける', async () => {
  const { levelDecks } = await import('../tools/lib/terrain.mjs');
  const W = 400, H = 3;
  const g = Uint8Array.from({ length: W * H }, (_, k) => Math.floor((k % W) / 50)); // 50m ごとに1段上がる坂
  const deck = new Uint8Array(W * H);
  for (let i = 10; i < 60; i++) deck[W + i] = 6;   // 短いデッキ（g=0..1 をまたぐ）
  for (let i = 0; i < W; i++) deck[2 * W + i] = 12; // 長い高架
  levelDecks(g, deck, W, H, { maxSpan: 100, blurR: 20 });
  const top = (k) => g[k] + deck[k];
  for (let i = 11; i < 60; i++) assert.equal(top(W + i), top(W + 10), `デッキは水平 i=${i}`);
  for (let i = 1; i < W; i++) assert.ok(Math.abs(top(2 * W + i) - top(2 * W + i - 1)) <= 1, '高架は緩やか');
  for (const v of deck) if (v) assert.ok(v >= 3);
});

test('実データ: 高さ2以上の建物の屋上には、周りの地表から1段で上がれない（屋上から建物の隙間に降りて閉じ込められない）', () => {
  const w = loadRealWorld();
  const { W, H, elev, bld, bldtype, deck } = w;
  let n = 0;
  for (let k = W; k < W * H - W; k++) {
    const i = k % W;
    if (bld[k] < 2 || i === 0 || i === W - 1) continue;
    if ((bldtype[k] & 15) === 9 && bld[k] >= 3) continue; // 屋根だけ（下を通る）
    for (const q of [k - 1, k + 1, k - W, k + W]) if (!bld[q] && !deck[q] && elev[k] + bld[k] <= elev[q] + 1) { n++; break; }
  }
  assert.equal(n, 0);
});
