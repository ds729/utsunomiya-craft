import test from 'node:test';
import assert from 'node:assert/strict';
import { runTime, runDist, makePlan, tramAt, pointAt, carPoses, heightProfile, heightAt, TRAM, TRAIN_LEN } from '../public/src/tram.js';
import { buildTramRoutes, clipLine, projectOnLine } from '../tools/lib/tram.mjs';
import { cellIndex } from '../public/src/world-data.js';
import { loadRealWorld } from './helpers/world.mjs';

test('走行: 停止→停止の距離と時間が一致し、速度は最高速度を超えない', () => {
  for (const d of [5, 60, 121, 400]) {
    const T = runTime(d);
    assert.ok(Math.abs(runDist(d, T) - d) < 1e-9);
    assert.equal(runDist(d, 0), 0);
    let prev = 0;
    for (let t = 0.05; t <= T; t += 0.05) {
      const x = runDist(d, t);
      assert.ok(x >= prev - 1e-9, '戻らない');
      assert.ok((x - prev) / 0.05 <= TRAM.VMAX + 1e-6, '最高速度以下');
      prev = x;
    }
  }
});

test('折れ線: 射影・距離の点・範囲での切り取り', () => {
  const pts = [[0, 0], [10, 0], [10, 10]];
  assert.deepEqual(projectOnLine(pts, [5, 3]), { s: 5, d: 3 });
  const r = { points: pts, length: 20 };
  assert.deepEqual(pointAt(r, 15), { x: 10, z: 5, dx: 0, dz: 1 });
  const c = clipLine([[-5, 0], [5, 0], [15, 0]], (x) => x < 10);
  assert.ok(Math.abs(c[c.length - 1][0] - 10) < 1e-6 && c[0][0] === -5);
});

// 合成: 上り線（西→東、x=0..100, z=0）と下り線（東→西、z=4）、終端（西）の渡り線は下り線→上り線
const synthetic = () => {
  const node = (id, x, z) => ({ id, lat: z, lon: x });
  const way = (id, tags, ns) => ({ type: 'way', id, tags: { railway: 'tram', ...tags }, nodes: ns.map((n) => n.id), geometry: ns.map((n) => ({ lat: n.lat, lon: n.lon })) });
  const a = [node(1, 0, 0), node(2, 40, 0), node(3, 200, 0)];
  const b = [node(11, 200, 4), node(12, 50, 4), node(13, 0, 4)];
  return [
    way(100, {}, a), way(101, {}, b),
    way(102, { service: 'crossover' }, [b[1], a[1]]),
    { type: 'node', id: 50, lat: 0, lon: 20, tags: { railway: 'tram_stop', name: '終点' } },
    { type: 'node', id: 51, lat: 4, lon: 80, tags: { railway: 'tram_stop', name: '中間' } },
  ];
};

test('ルート: 端で出入り、終端は渡り線で反対の線に移って後退。停留場を割り当てる', () => {
  const { legs } = buildTramRoutes(synthetic(), (lat, lon) => ({ x: lon, z: lat }), (x) => x < 100);
  assert.equal(legs.length, 2);
  const [up, down] = legs;
  assert.deepEqual([up.enter, up.exit, down.enter, down.exit], ['terminal', 'edge', 'edge', 'terminal']);
  assert.deepEqual(down.points.at(-1), [0, 0], '下り線は渡り線で上り線に移り、上り線の始点まで後退');
  assert.ok(Math.abs(up.points.at(-1)[0] - 100) < 1e-3, '範囲の端で切る');
  assert.deepEqual(down.stops.map((s) => s.name), ['中間']);
});

test('運行: 区間の切り替えで編成がとぶのは範囲の外だけ（終端の折り返しは同じ場所）', () => {
  const { legs } = buildTramRoutes(synthetic(), (lat, lon) => ({ x: lon, z: lat }), (x) => x < 100);
  const plan = makePlan(legs);
  assert.ok(plan.period > 0);
  // 全時刻で、範囲内の車両は 1 フレーム（0.1s）で 2m 以上動かない
  let prev = null;
  for (let t = 0; t < plan.period * 2; t += 0.1) {
    const p = tramAt(plan, t);
    const cars = carPoses(legs[p.route], p.s).filter((c) => c.x < 100 && c.x > -1);
    if (prev && cars.length === prev.length) {
      // 折り返しでは車両の順番が逆になる（対称な編成）
      const same = (q) => cars.every((c, i) => Math.hypot(c.x - q[i].x, c.z - q[i].z) < 2);
      assert.ok(same(prev) || same([...prev].reverse()), `t=${t.toFixed(1)} でとんだ`);
    }
    prev = cars;
  }
});

test('高さ: 線路沿いの地表を滑らかにつなぐ', () => {
  const r = { points: [[0, 0], [40, 0]], length: 40 };
  const prof = heightProfile(r, (x) => (x < 20 ? 1 : 2), 5);
  for (let s = 1; s <= 40; s++) assert.ok(Math.abs(heightAt(prof, s) - heightAt(prof, s - 1)) <= 0.2);
  assert.equal(heightAt(prof, 0), 1);
  assert.equal(heightAt(prof, 40), 2);
});

test('実データ: ライトラインは駅東口から範囲の東端まで走り、車両は軌道の上にいる', () => {
  const w = loadRealWorld();
  const legs = w.meta.trams.legs;
  assert.equal(legs.length, 2);
  const names = legs.flatMap((l) => l.stops.map((s) => s.name));
  for (const n of ['宇都宮駅東口', '東宿郷', '駅東公園前']) assert.ok(names.includes(n), n);
  const plan = makePlan(legs);
  let checked = 0, off = 0;
  for (let t = 0; t < plan.period; t += 2) {
    const p = tramAt(plan, t);
    for (const c of carPoses(legs[p.route], p.s)) {
      if (Math.abs(c.x) > 990 || Math.abs(c.z) > 990) continue;
      checked++;
      // 車両の中心から 3m 以内に軌道（TRAM 材）がある
      let near = false;
      for (let dz = -3; dz <= 3 && !near; dz++) for (let dx = -3; dx <= 3 && !near; dx++) {
        const k = cellIndex(w, Math.floor(c.x + dx), Math.floor(c.z + dz));
        if (k >= 0 && w.ground[k] === 10) near = true;
      }
      if (!near) off++;
    }
  }
  console.log(`周期 ${plan.period.toFixed(0)}s、車両位置 ${checked} 件中 軌道から外れ ${off}`);
  assert.ok(checked > 100);
  assert.ok(off / checked < 0.02, `軌道から外れ ${off}/${checked}`);
  assert.ok(TRAIN_LEN > 29 && TRAIN_LEN < 31);
});
