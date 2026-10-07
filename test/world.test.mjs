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
