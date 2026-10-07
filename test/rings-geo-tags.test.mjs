import test from 'node:test';
import assert from 'node:assert/strict';
import { assembleRings } from '../tools/lib/rings.mjs';
import { makeProjection, bboxFromExtent } from '../tools/lib/geo.mjs';
import { roadInfo, railInfo, buildingHeight, areaMaterial, MAT } from '../tools/lib/tags.mjs';

test('assembleRings: 順序・向きが不揃いな way を1本のリングに', () => {
  const segs = [[[0, 0], [1, 0]], [[1, 1], [0, 1], [0, 0]], [[1, 1], [1, 0]]];
  const { rings, unclosed } = assembleRings(segs);
  assert.equal(unclosed, 0);
  assert.equal(rings.length, 1);
  assert.deepEqual(rings[0][0], rings[0][rings[0].length - 1]);
  assert.equal(rings[0].length, 5);
});

test('assembleRings: 外周と内周を別リングに、開いたものは強制的に閉じる', () => {
  const { rings, unclosed } = assembleRings([
    [[0, 0], [4, 0], [4, 4], [0, 4], [0, 0]],
    [[1, 1], [2, 1]], [[2, 1], [2, 2], [1, 1]],
    [[9, 9], [10, 9], [10, 10]],
  ]);
  assert.equal(rings.length, 3);
  assert.equal(unclosed, 1);
});

test('投影: 北が -z、東が +x、往復で一致', () => {
  const p = makeProjection(36.56, 139.9);
  const n = p.toLocal(36.561, 139.9), e = p.toLocal(36.56, 139.901);
  assert.ok(n.z < -100 && Math.abs(n.x) < 1e-9);
  assert.ok(e.x > 80 && Math.abs(e.z) < 1e-9);
  const back = p.toLatLon(123, -456);
  const q = p.toLocal(back.lat, back.lon);
  assert.ok(Math.abs(q.x - 123) < 1e-6 && Math.abs(q.z + 456) < 1e-6);
});

test('bboxFromExtent: 東西非対称の範囲', () => {
  const [s, w, n, e] = bboxFromExtent(36.56, 139.9, { west: 2000, east: 1000, north: 1000, south: 1000 });
  const p = makeProjection(36.56, 139.9);
  assert.ok(Math.abs(p.toLocal(36.56, w).x + 2000) < 1e-6);
  assert.ok(Math.abs(p.toLocal(36.56, e).x - 1000) < 1e-6);
  assert.ok(s < 36.56 && n > 36.56);
});

test('道路: 既定幅・width・lanes・歩道・トンネル', () => {
  assert.equal(roadInfo({ highway: 'primary' }).width, 14);
  assert.equal(roadInfo({ highway: 'primary' }).sidewalk, true);
  assert.equal(roadInfo({ highway: 'primary', sidewalk: 'no' }).sidewalk, false);
  assert.equal(roadInfo({ highway: 'residential' }).sidewalk, false);
  assert.equal(roadInfo({ highway: 'residential', width: '7.5 m' }).width, 7.5);
  assert.equal(roadInfo({ highway: 'secondary', lanes: '4' }).width, 13);
  assert.equal(roadInfo({ highway: 'footway' }).material, MAT.SIDEWALK);
  assert.equal(roadInfo({ highway: 'primary', tunnel: 'yes' }), null);
  assert.equal(roadInfo({ highway: 'footway', bridge: 'yes', layer: '1' }).elevated, true);
  assert.equal(roadInfo({ highway: 'footway', bridge: 'yes' }).elevated, false);
});

test('線路: tram は別材質', () => {
  assert.equal(railInfo({ railway: 'tram' }).material, MAT.TRAM);
  assert.equal(railInfo({ railway: 'rail' }).material, MAT.BALLAST);
  assert.equal(railInfo({ railway: 'abandoned' }), null);
});

test('建物高さ: height → levels×3 → 既定値、MAX_H でクランプ', () => {
  assert.equal(buildingHeight({ building: 'yes', height: '21.4' }), 21);
  assert.equal(buildingHeight({ building: 'yes', 'building:levels': '5' }), 15);
  assert.equal(buildingHeight({ building: 'house' }), 6);
  assert.equal(buildingHeight({ building: 'commercial' }), 12);
  assert.equal(buildingHeight({ building: 'yes', height: '300' }), 96);
});

test('面材質: 公園・水・駐車場・広場', () => {
  assert.equal(areaMaterial({ leisure: 'park' }).mat, MAT.PARK);
  assert.equal(areaMaterial({ natural: 'water' }).mat, MAT.WATER);
  assert.equal(areaMaterial({ amenity: 'parking' }).mat, MAT.PARKING);
  assert.equal(areaMaterial({ place: 'square' }).mat, MAT.PLAZA);
  assert.equal(areaMaterial({ building: 'yes', amenity: 'parking' }), null);
});
