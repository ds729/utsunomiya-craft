// ライトラインの車両（three.js）。運行は tram.js の純関数で求め、毎フレーム車両を置き直す
// 車両は箱の組み合わせ（ボクセル風）。走行中の車両とは衝突しない（見た目だけ）
import * as THREE from 'three';
import { TRAM, makePlan, tramAt, carPoses, heightProfile, heightAt } from './tram.js';
import { cellIndex } from './world-data.js';

const YELLOW = [0.95, 0.76, 0.05], DARK = [0.13, 0.15, 0.18], GLASS = [0.20, 0.28, 0.36], ROOF = [0.72, 0.73, 0.74];
const SKIRT = [0.20, 0.20, 0.22], DOOR = [0.86, 0.66, 0.04], LAMP = [1, 0.97, 0.85], TAIL = [0.9, 0.12, 0.1];
const W = 2.65; // 車体幅[m]

// 面の向き別の陰影（チャンクと同じ）を付けた箱を配列に追加する
function box(out, x0, y0, z0, x1, y1, z1, rgb) {
  const F = [
    [[x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1], 0.6],
    [[x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0], 0.6],
    [[x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0], 1.0],
    [[x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1], 0.5],
    [[x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], 0.8],
    [[x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0], 0.8],
  ];
  for (const [a, b, c, d, sh] of F) {
    const base = out.pos.length / 3;
    for (const v of [a, b, c, d]) { out.pos.push(...v); out.col.push(rgb[0] * sh, rgb[1] * sh, rgb[2] * sh); }
    out.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
}

function geometry(out) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(out.pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(out.col, 3));
  g.setIndex(out.idx);
  g.computeBoundingSphere();
  return g;
}

// 1 両。局所座標: +z が進行方向（前）、y=0 がレール面。cab: 'front' | 'rear' | null（運転台のある側）
// 戻り値 { body: 車体（昼夜で明るさが変わる）, lamps: 前照灯・尾灯（常に明るい） }
function carGeometry(len, cab, pantograph) {
  const b = { pos: [], col: [], idx: [] }, l = { pos: [], col: [], idx: [] };
  const h = W / 2, z0 = -len / 2, z1 = len / 2;
  box(b, -h + 0.25, 0.15, z0 + 1.0, h - 0.25, 0.55, z0 + 3.2, DARK); // 台車
  box(b, -h + 0.25, 0.15, z1 - 3.2, h - 0.25, 0.55, z1 - 1.0, DARK);
  box(b, -h + 0.05, 0.4, z0, h - 0.05, 0.7, z1, SKIRT);              // すそ
  box(b, -h, 0.7, z0, h, 1.3, z1, YELLOW);                           // 腰板
  box(b, -h + 0.02, 1.3, z0 + 0.02, h - 0.02, 2.4, z1 - 0.02, GLASS); // 窓の帯
  // 窓の柱とドア（両側）
  for (let z = z0 + 1.2; z < z1 - 0.8; z += 1.7) box(b, -h, 1.3, z, h, 2.4, z + 0.25, YELLOW);
  for (const zc of [z0 + len * 0.3, z0 + len * 0.7]) box(b, -h - 0.01, 0.7, zc - 0.65, h + 0.01, 2.6, zc + 0.65, DOOR);
  box(b, -h, 2.4, z0, h, 3.0, z1, YELLOW);                           // 幕板
  box(b, -h + 0.15, 3.0, z0 + 0.3, h - 0.15, 3.25, z1 - 0.3, ROOF);  // 屋根
  box(b, -0.6, 3.25, -1.5, 0.6, 3.55, 1.5, ROOF);                    // 屋根上の機器
  if (pantograph) {
    box(b, -0.5, 3.55, -0.4, 0.5, 3.65, 0.4, DARK);
    box(b, -0.05, 3.65, -0.05, 0.05, 4.3, 0.05, DARK);
    box(b, -0.7, 4.3, -0.1, 0.7, 4.38, 0.1, DARK);
  }
  // 運転台: 前面の大きな窓、黒い顔、前照灯（前）・尾灯（後ろ）。編成は両運転台
  for (const [end, s] of [['front', 1], ['rear', -1]]) {
    if (cab !== end && cab !== 'both') continue;
    const ze = s > 0 ? z1 : z0;
    const zz = (a, c) => (s > 0 ? [ze - c, ze + a] : [ze - a, ze + c]);
    const [fa, fb] = zz(0.02, 0.6);
    box(b, -h + 0.1, 1.2, fa, h - 0.1, 2.75, fb, DARK);
    for (const x of [-h + 0.35, h - 0.75]) {
      const [la, lb] = zz(0.04, 0.05);
      box(l, x, 0.95, la, x + 0.4, 1.15, lb, s > 0 ? LAMP : TAIL);
    }
  }
  return { body: geometry(b), lamps: geometry(l) };
}

export class TramView {
  // world: makeWorld の結果（meta.trams.legs を使う）。count 編成を周期の等間隔で走らせる
  constructor(world, scene, bodyMaterial, count = 2) {
    const legs = world.meta.trams?.legs || [];
    this.legs = legs;
    this.world = world;
    this.enabled = legs.length > 0;
    if (!this.enabled) return;
    this.plan = makePlan(legs);
    // 足元の高さ = 地表ブロックの上面（g + 1）を線路沿いに滑らかに
    const groundTop = (x, z) => { const k = cellIndex(world, Math.floor(x), Math.floor(z)); return k >= 0 ? world.elev[k] + 1 : 1; };
    this.profiles = legs.map((r) => heightProfile(r, groundTop));
    this.lampMaterial = new THREE.MeshBasicMaterial({ vertexColors: true });
    const n = TRAM.CARS.length;
    const geos = TRAM.CARS.map((len, i) => carGeometry(len, n === 1 ? 'both' : i === 0 ? 'front' : i === n - 1 ? 'rear' : null, i === 1));
    this.trains = [];
    for (let t = 0; t < count; t++) {
      const cars = geos.map((g) => {
        const grp = new THREE.Group();
        grp.add(new THREE.Mesh(g.body, bodyMaterial), new THREE.Mesh(g.lamps, this.lampMaterial));
        grp.visible = false;
        scene.add(grp);
        return grp;
      });
      this.trains.push({ cars, offset: (t * this.plan.period) / count });
    }
    this.positions = [];
  }

  // time: 秒。lampBoost: 夜に前照灯を目立たせる（0..1）
  update(time) {
    if (!this.enabled) return;
    const { west, north, W: WW, H: HH } = this.world;
    this.positions.length = 0;
    for (const tr of this.trains) {
      const p = tramAt(this.plan, time + tr.offset);
      const route = this.legs[p.route], prof = this.profiles[p.route];
      const poses = carPoses(route, p.s);
      poses.forEach((c, i) => {
        const car = tr.cars[i];
        const inside = c.x > -west + 1 && c.x < WW - west - 1 && c.z > -north + 1 && c.z < HH - north - 1;
        car.visible = inside;
        if (!inside) return;
        car.position.set(c.x, heightAt(prof, Math.max(0, Math.min(route.length, c.s))), c.z);
        car.rotation.y = Math.atan2(c.dirX, c.dirZ); // 局所 +z を進行方向へ
      });
      this.positions.push({ route: p.route, s: Math.round(p.s * 10) / 10, moving: p.moving, x: Math.round(poses[0].x), z: Math.round(poses[0].z), visible: tr.cars.some((c) => c.visible) });
    }
  }
}
