// ライトラインの運行（純関数）。world.json の trams.legs（走行区間）を巡回し、停留場で停車する
// 区間（route）: { points: [[x, z], ...], length, stops: [{ name, s }], enter, exit: 'edge'|'terminal' }

export const TRAM = {
  VMAX: 11,      // 最高速度[m/s]（約 40km/h。路線の maxspeed=40）
  ACCEL: 1.0,    // 加減速[m/s²]
  DWELL: 20,     // 停留場での停車[s]
  TERMINAL: 40,  // ルートの始点（始発・範囲の端）での待ち[s]
  CARS: [10.2, 9.0, 10.2], // 3 両の長さ[m]（HU300 形 全長約 29.5m）
  GAP: 0.3,      // 連結部
};

// 距離 d を停止→停止で走る時間（台形 or 三角形の速度）
export function runTime(d, v = TRAM.VMAX, a = TRAM.ACCEL) {
  return d >= (v * v) / a ? d / v + v / a : 2 * Math.sqrt(d / a);
}
// 走り始めてから t 秒後の進んだ距離
export function runDist(d, t, v = TRAM.VMAX, a = TRAM.ACCEL) {
  const T = runTime(d, v, a);
  if (t <= 0) return 0;
  if (t >= T) return d;
  const vp = Math.min(v, Math.sqrt(a * d)); // 最高到達速度
  const ta = vp / a, da = (a * ta * ta) / 2;
  if (t < ta) return (a * t * t) / 2;
  if (t < T - ta) return da + vp * (t - ta);
  const r = T - t;
  return d - (a * r * r) / 2;
}

export const TRAIN_LEN = TRAM.CARS.reduce((a, b) => a + b, 0) + TRAM.GAP * (TRAM.CARS.length - 1);

// 運行計画: 区間（world.json の trams.legs）を順に巡回する
//  - 区間の始めで待つ。範囲の端から入る区間は、編成が完全に範囲の外にいる位置で待つ（見えない）
//  - 終端（折り返し）から出る区間は、編成全体が線路に乗る位置（先頭 = 編成長）から出発
//  - 範囲の端で出る区間は、編成が完全に外へ出るまで走る。終端に着く区間は終点（車止め）まで
//  - 停留場では先頭が少し過ぎた位置（編成の中ほどが停留場）で停まる。始点・終点の近くの停留場は始発・終着で兼ねる
// 戻り値 { legs: [{ route, t0, t1, s0, s1, kind: 'dwell'|'run' }], period }
export function makePlan(routes) {
  const legs = [];
  let t = 0;
  routes.forEach((r, ri) => {
    const start = r.enter === 'edge' ? -(TRAIN_LEN + 2) : Math.min(TRAIN_LEN, r.length);
    const end = r.exit === 'edge' ? r.length + TRAIN_LEN + 2 : r.length;
    legs.push({ route: ri, kind: 'dwell', t0: t, t1: (t += TRAM.TERMINAL), s0: start, s1: start });
    let s = start;
    const marks = r.stops.map((p) => p.s + 12).filter((v) => v > start + 5 && v < Math.min(end, r.length) - 20);
    for (const m of [...marks, end]) {
      legs.push({ route: ri, kind: 'run', t0: t, t1: (t += runTime(m - s)), s0: s, s1: m });
      s = m;
      if (m < end) legs.push({ route: ri, kind: 'dwell', t0: t, t1: (t += TRAM.DWELL), s0: s, s1: s });
    }
  });
  return { legs, period: t };
}

// 時刻 t[s] の位置: { route, s（先頭の位置）, moving }
export function tramAt(plan, t) {
  const tt = ((t % plan.period) + plan.period) % plan.period;
  let lo = 0, hi = plan.legs.length - 1;
  while (lo < hi) { const m = (lo + hi + 1) >> 1; if (plan.legs[m].t0 <= tt) lo = m; else hi = m - 1; }
  const L = plan.legs[lo];
  if (L.kind === 'dwell') return { route: L.route, s: L.s0, moving: false };
  return { route: L.route, s: L.s0 + runDist(L.s1 - L.s0, tt - L.t0), moving: true };
}

// 折れ線上の距離 s の点と進行方向: { x, z, dx, dz }（s は 0..length にクランプ）
export function pointAt(route, s) {
  const p = route.points;
  if (!route._cum) { // 累積距離（初回だけ計算。JSON に書き出さないよう列挙しない）
    const cum = [0];
    for (let i = 1; i < p.length; i++) cum.push(cum[i - 1] + Math.hypot(p[i][0] - p[i - 1][0], p[i][1] - p[i - 1][1]));
    Object.defineProperty(route, '_cum', { value: cum, enumerable: false });
  }
  const c = route._cum, total = c[c.length - 1];
  s = Math.max(0, Math.min(total, s));
  let lo = 0, hi = c.length - 2;
  while (lo < hi) { const m = (lo + hi + 1) >> 1; if (c[m] <= s) lo = m; else hi = m - 1; }
  const a = p[lo], b = p[lo + 1], L = c[lo + 1] - c[lo] || 1, u = (s - c[lo]) / L;
  return { x: a[0] + (b[0] - a[0]) * u, z: a[1] + (b[1] - a[1]) * u, dx: (b[0] - a[0]) / L, dz: (b[1] - a[1]) / L };
}

// 各車両の中心・向き。先頭位置 s から後ろへ並べ、車両の前後の台車位置を結ぶ向きにする（曲線で折れて見える）
// ルートの始点より手前・終点より先は、端の延長線上に置く（範囲の外へ出入りする部分）
export function carPoses(route, s) {
  const out = [];
  let front = s;
  for (const len of TRAM.CARS) {
    const f = extended(route, front - 1.5), r = extended(route, front - len + 1.5);
    const dx = f.x - r.x, dz = f.z - r.z, L = Math.hypot(dx, dz) || 1;
    const m = extended(route, front - len / 2);
    out.push({ x: m.x, z: m.z, s: front - len / 2, len, dirX: dx / L, dirZ: dz / L });
    front -= len + TRAM.GAP;
  }
  return out;
}
function extended(route, s) {
  if (s >= 0 && s <= route.length) return pointAt(route, s);
  const e = s < 0 ? 0 : route.length, p = pointAt(route, e);
  return { ...p, x: p.x + p.dx * (s - e), z: p.z + p.dz * (s - e) };
}

// 線路沿いの高さ（足元 = 地表ブロックの上面）を 1m ごとに求めて移動平均で滑らかに。groundTop(x, z) → 高さ
export function heightProfile(route, groundTop, window = 12) {
  const n = Math.ceil(route.length) + 1;
  const raw = new Float32Array(n);
  for (let i = 0; i < n; i++) { const p = pointAt(route, i); raw[i] = groundTop(p.x, p.z); }
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let s = 0, c = 0;
    for (let k = Math.max(0, i - window); k <= Math.min(n - 1, i + window); k++) { s += raw[k]; c++; }
    out[i] = s / c;
  }
  return out;
}
export function heightAt(profile, s) {
  const i = Math.max(0, Math.min(profile.length - 1, s));
  const a = Math.floor(i), b = Math.min(profile.length - 1, a + 1);
  return profile[a] + (profile[b] - profile[a]) * (i - a);
}
