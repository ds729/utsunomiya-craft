import test from 'node:test';
import assert from 'node:assert/strict';
import { buildWorld } from '../tools/lib/world.mjs';
import { makeProjection } from '../tools/lib/geo.mjs';
import { MAT } from '../tools/lib/tags.mjs';

// ローカル座標で書いた小さな OSM を合成して buildWorld を検証
const origin = { lat: 36.56, lon: 139.9 };
const p = makeProjection(origin.lat, origin.lon);
const geom = (pts) => pts.map(([x, z]) => p.toLatLon(x, z));
const ext = { west: 50, east: 50, north: 50, south: 50 };
const cell = (w, x, z) => Math.floor(z + ext.north) * w.W + Math.floor(x + ext.west);

test('buildWorld: 建物・道路・高架・multipolygon の穴', () => {
  const osm = {
    origin,
    elements: [
      { type: 'way', id: 1, nodes: [1, 2, 3, 4, 1], tags: { building: 'yes', 'building:levels': '4' }, geometry: geom([[-40, -40], [-20, -40], [-20, -20], [-40, -20], [-40, -40]]) },
      { type: 'way', id: 2, nodes: [5, 6], tags: { highway: 'primary' }, geometry: geom([[-50, 10], [50, 10]]) },
      { type: 'way', id: 3, nodes: [7, 8], tags: { highway: 'footway', bridge: 'yes', layer: '1' }, geometry: geom([[30, -50], [30, 50]]) },
      { type: 'way', id: 4, nodes: [9, 10], tags: { highway: 'service', tunnel: 'yes' }, geometry: geom([[-50, 40], [50, 40]]) },
      { type: 'relation', id: 5, tags: { type: 'multipolygon', building: 'yes', height: '30' }, members: [
        { type: 'way', role: 'outer', geometry: geom([[0, -40], [20, -40], [20, -20]]) },
        { type: 'way', role: 'outer', geometry: geom([[0, -40], [0, -20], [20, -20]]) },
        { type: 'way', role: 'inner', geometry: geom([[5, -35], [15, -35], [15, -25], [5, -25], [5, -35]]) },
      ] },
    ],
  };
  const w = buildWorld(osm, ext);
  assert.equal(w.W, 100);
  assert.equal(w.bld[cell(w, -30, -30)], 12);
  assert.equal(w.bld[cell(w, -10, -30)], 0);
  assert.equal(w.ground[cell(w, 0, 10)], MAT.ASPHALT);
  assert.equal(w.ground[cell(w, 0, 10 + 8)], MAT.SIDEWALK, '主要道路の両側に歩道');
  assert.equal(w.deck[cell(w, 30, -45)], 6);
  assert.equal(w.ground[cell(w, 30, -45)], MAT.GRASS, '高架の下の地表は塗らない');
  assert.equal(w.ground[cell(w, 0, 40)], MAT.GRASS, 'トンネルは描かない');
  assert.equal(w.bld[cell(w, 2, -38)], 30);
  assert.equal(w.bld[cell(w, 10, -30)], 0, '内周は穴');
  assert.equal(w.stats.unclosedRings, 0);
});

test('buildWorld: 鉄道高架は layer に関係なく12m、並行する way の間に隙間を作らない', () => {
  const osm = {
    origin,
    elements: [
      { type: 'way', id: 1, nodes: [1, 2], tags: { railway: 'rail', bridge: 'viaduct', layer: '1' }, geometry: geom([[-2.5, -50], [-2.5, 50]]) },
      { type: 'way', id: 2, nodes: [3, 4], tags: { railway: 'rail', bridge: 'viaduct', layer: '2' }, geometry: geom([[2.5, -50], [2.5, 50]]) },
    ],
  };
  const w = buildWorld(osm, ext);
  for (let x = -5; x <= 4; x++) assert.equal(w.deck[cell(w, x + 0.5, 0)], 12, `x=${x}`);
});

test('buildWorld: 車道・線路を越えない道路の橋（川の橋）は地表の道路、越える橋と高架の外形は床板', () => {
  const osm = {
    origin,
    elements: [
      { type: 'way', id: 1, nodes: [1, 2], tags: { waterway: 'river', width: '10' }, geometry: geom([[-50, 0], [50, 0]]) },
      { type: 'way', id: 2, nodes: [3, 4], tags: { highway: 'primary', bridge: 'yes', layer: '1' }, geometry: geom([[-20, -15], [-20, 15]]) },
      { type: 'way', id: 3, nodes: [5, 6], tags: { highway: 'cycleway' }, geometry: geom([[-50, 6], [50, 6]]) },
      { type: 'way', id: 7, nodes: [11, 12, 13, 14, 11], tags: { man_made: 'bridge', layer: '1' }, geometry: geom([[-26, -8], [-14, -8], [-14, 8], [-26, 8], [-26, -8]]) },
      { type: 'way', id: 4, nodes: [7, 8], tags: { highway: 'footway', bridge: 'yes', layer: '1' }, geometry: geom([[20, -15], [20, 15]]) },
      { type: 'way', id: 5, nodes: [9, 10], tags: { highway: 'residential' }, geometry: geom([[0, -10], [50, -10]]) },
    ],
  };
  const w = buildWorld(osm, ext);
  assert.equal(w.ground[cell(w, -20, 0)], MAT.ASPHALT, '川の上も道路として歩ける');
  assert.equal(w.deck[cell(w, -20, 0)], 0, '床板にしない（自転車道の上は越えても数えない）');
  assert.equal(w.deck[cell(w, -24, 0)], 0, '橋の外形も床板にしない');
  assert.equal(w.deck[cell(w, 20, -10)], 6, '車道を越える歩道橋は床板');
  assert.equal(w.stats.bridgesAtGrade, 1);
});

test('findTeleports: 名称・タグ条件で探し、way は頂点の平均、範囲外は除く', async () => {
  const { findTeleports } = await import('../tools/lib/teleports.mjs');
  const els = [
    { type: 'node', lat: 0, lon: 0, tags: { name: 'A駅', railway: 'tram_stop' } },
    { type: 'node', lat: 0, lon: 0, tags: { name: 'A駅', highway: 'bus_stop' } },
    { type: 'way', geometry: [{ lat: 10, lon: 0 }, { lat: 20, lon: 0 }], tags: { name: 'B通り', highway: 'primary' } },
    { type: 'node', lat: 500, lon: 0, tags: { name: 'C' } },
  ];
  const defs = [
    { label: 'A', name: 'A駅', filter: (t) => t.railway === 'tram_stop' },
    { label: 'B', name: 'B通り', filter: (t) => t.highway },
    { label: 'C', name: 'C' },
  ];
  const r = findTeleports(els, (lat, lon) => ({ x: lon, z: lat }), (x, z) => Math.abs(z) < 100, defs);
  assert.deepEqual(r, [{ label: 'A', x: 0, z: 0 }, { label: 'B', x: 0, z: 15 }]);
});
