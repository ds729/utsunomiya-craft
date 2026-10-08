import test from 'node:test';
import assert from 'node:assert/strict';
import { parseBuildings, applyPlateau, usageType } from '../tools/lib/plateau.mjs';
import { mesh3, meshesInBBox } from '../tools/lib/mesh.mjs';
import { parseCentralDirectory } from '../tools/lib/zip-range.mjs';
import { BTYPE } from '../tools/lib/tags.mjs';

const ring = (lat, lon, d) => `${lat} ${lon} 0 ${lat} ${lon + d} 0 ${lat + d} ${lon + d} 0 ${lat + d} ${lon} 0 ${lat} ${lon} 0`;
const gml = (id, h, usage, posList, lod1 = '') => `<bldg:Building gml:id="${id}">
  <bldg:usage codeSpace="x">${usage}</bldg:usage><bldg:measuredHeight uom="m">${h}</bldg:measuredHeight>
  <bldg:lod0RoofEdge><gml:MultiSurface><gml:surfaceMember><gml:Polygon><gml:exterior><gml:LinearRing><gml:posList>${posList}</gml:posList></gml:LinearRing></gml:exterior></gml:Polygon></gml:surfaceMember></gml:MultiSurface></bldg:lod0RoofEdge>
  ${lod1}</bldg:Building>`;

test('parseBuildings: 高さ・用途・外形。measuredHeight が無効なら LOD1 の z 範囲', () => {
  const lod1 = '<bldg:lod1Solid><gml:posList>1 2 100.5 1 2 112.5</gml:posList></bldg:lod1Solid>';
  const b = parseBuildings(gml('a', 21.4, 412, ring(36.5, 139.8, 0.001)) + gml('b', -9999, 401, ring(36.5, 139.8, 0.001), lod1));
  assert.equal(b.length, 2);
  assert.equal(b[0].height, 21.4);
  assert.equal(b[0].usage, 412);
  assert.equal(b[0].rings[0].length, 5);
  assert.equal(b[0].rings[0][1][0], 36.5);
  assert.ok(Math.abs(b[0].rings[0][1][1] - 139.801) < 1e-9);
  assert.equal(b[1].height, 12);
  assert.equal(usageType(412), BTYPE.APARTMENT);
});

test('applyPlateau: PLATEAU 優先、重なる OSM 建物の残りは中央値、重ならない OSM はそのまま、PLATEAU のみも追加', () => {
  const W = 20, H = 10, N = W * H;
  const w = { W, H, bld: new Uint8Array(N), bldtype: new Uint8Array(N) };
  const owner = new Int32Array(N).fill(-1);
  for (let j = 0; j < 5; j++) for (let i = 0; i < 6; i++) { w.bld[j * W + i] = 8; w.bldtype[j * W + i] = BTYPE.STATION; owner[j * W + i] = 0; } // OSM 建物 0（6×5）
  for (let j = 0; j < 3; j++) for (let i = 15; i < 18; i++) { w.bld[j * W + i] = 8; owner[j * W + i] = 1; }                                  // OSM 建物 1（PLATEAU なし）
  // grid 座標をそのまま [lat, lon] として渡す
  const blds = [
    { id: 'p1', height: 30.4, usage: 401, rings: [[[0, 0], [5, 0], [5, 5], [0, 5]]] },   // 建物0 の 5×5 を覆う
    { id: 'p2', height: 6, usage: 411, rings: [[[8, 5], [12, 5], [12, 9], [8, 9]]] },     // OSM に無い
  ];
  const st = applyPlateau(w, blds, ([a, b]) => [a, b], owner);
  assert.equal(w.bld[2 * W + 2], 30);
  assert.equal(w.bldtype[2 * W + 2] & 15, BTYPE.STATION, 'OSM の種別を保つ');
  assert.equal(w.bld[2 * W + 5], 30, '覆われないセルは中央値');
  assert.equal(w.bld[1 * W + 16], 8, '重ならない OSM はそのまま');
  assert.equal(w.bld[6 * W + 10], 6, 'PLATEAU のみの建物を追加');
  assert.equal(w.bldtype[6 * W + 10] & 15, BTYPE.HOUSE);
  assert.equal(st.osmMatched, 1);
  assert.equal(st.osmUnmatched, 1);
});

test('3次メッシュコード: JR宇都宮駅は 54396771', () => {
  assert.equal(mesh3(36.5592288, 139.8983323), '54396771');
  const m = meshesInBBox([36.5493, 139.8860, 36.5692, 139.9106]);
  assert.ok(m.includes('54396771') && m.includes('54396750') && m.includes('54396782'));
  assert.equal(m.length, 12);
});

test('zip の中央ディレクトリを読む', () => {
  const name = Buffer.from('udx/bldg/a.gml');
  const b = Buffer.alloc(46 + name.length);
  b.writeUInt32LE(0x02014b50, 0); b.writeUInt16LE(8, 10); b.writeUInt32LE(100, 20); b.writeUInt32LE(900, 24);
  b.writeUInt16LE(name.length, 28); b.writeUInt32LE(1234, 42); name.copy(b, 46);
  assert.deepEqual(parseCentralDirectory(b), [{ name: 'udx/bldg/a.gml', method: 8, csize: 100, usize: 900, offset: 1234 }]);
});

test('applyPlateau: OSM 建物と重ならず床板・道路の上にある PLATEAU の構造物（デッキ等）は積まない', () => {
  const W = 10, H = 10, N = W * H;
  const w = { W, H, bld: new Uint8Array(N), bldtype: new Uint8Array(N), ground: new Uint8Array(N), deck: new Uint8Array(N) };
  for (let i = 0; i < W; i++) { w.deck[2 * W + i] = 6; w.ground[6 * W + i] = 2; }
  const blds = [
    { id: 'deck', height: 8, usage: 461, rings: [[[0, 1.5], [10, 1.5], [10, 3.5], [0, 3.5]]] },
    { id: 'house', height: 6, usage: 411, rings: [[[0, 7.5], [3, 7.5], [3, 9.5], [0, 9.5]]] },
  ];
  const st = applyPlateau(w, blds, ([a, b]) => [a, b], new Int32Array(N).fill(-1));
  assert.equal(st.skippedInfra, 1);
  assert.equal(w.bld[2 * W + 5], 0);
  assert.equal(w.bld[8 * W + 1], 6);
});
