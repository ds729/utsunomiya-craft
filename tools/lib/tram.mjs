// ライトライン（railway=tram）の線形 → 走行ルート（純関数）
// - service=crossover などの側線は除き、端点のノードを共有する way を進行方向（way の向き）につなぐ
// - ワールド範囲外は切り落とす（範囲の端で出入りする）
// - 停留場（railway=tram_stop）は最も近いルートに、始点からの距離 s として割り当てる

const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);

// 点 p を折れ線 pts に射影: { s: 始点からの距離, d: 線からの距離 }
export function projectOnLine(pts, p) {
  let best = { s: 0, d: Infinity }, acc = 0;
  for (let i = 0; i + 1 < pts.length; i++) {
    const a = pts[i], b = pts[i + 1];
    const dx = b[0] - a[0], dz = b[1] - a[1], L = Math.hypot(dx, dz);
    if (!L) continue;
    const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dz) / (L * L)));
    const d = Math.hypot(a[0] + dx * t - p[0], a[1] + dz * t - p[1]);
    if (d < best.d) best = { s: acc + L * t, d };
    acc += L;
  }
  return best;
}

// 折れ線を範囲内（inside(x, z)）の最長の連続部分に切る。境界との交点は二分探索で求める
export function clipLine(pts, inside) {
  const runs = [];
  let cur = null;
  const edge = (a, b) => { // a は内、b は外
    let lo = 0, hi = 1;
    for (let k = 0; k < 30; k++) { const m = (lo + hi) / 2; if (inside(a[0] + (b[0] - a[0]) * m, a[1] + (b[1] - a[1]) * m)) lo = m; else hi = m; }
    return [a[0] + (b[0] - a[0]) * lo, a[1] + (b[1] - a[1]) * lo];
  };
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i], inP = inside(p[0], p[1]);
    if (inP) {
      if (!cur) { cur = []; if (i > 0) cur.push(edge(p, pts[i - 1])); }
      cur.push(p);
    } else if (cur) { cur.push(edge(pts[i - 1], p)); runs.push(cur); cur = null; }
  }
  if (cur) runs.push(cur);
  const len = (r) => r.reduce((a, p, i) => (i ? a + dist(r[i - 1], p) : 0), 0);
  return runs.sort((a, b) => len(b) - len(a))[0] || [];
}

// elements: Overpass の out geom、toLocal(lat, lon) → {x, z}、inside(x, z)
// 戻り値 { legs: [{ points, length, stops: [{name, s}], enter, exit }] }
//  巡回する走行区間の列。enter/exit は 'edge'（範囲の端で出入り）か 'terminal'（終端で折り返し）
//  終端では、到着する線から渡り線（service=crossover）で反対の線に移り、終端まで後退して折り返す
//  （折り返しの前後で編成が同じ場所にいるので、駅で瞬間移動しない）
export function buildTramRoutes(elements, toLocal, inside) {
  const all = elements.filter((e) => e.type === 'way' && e.tags && e.tags.railway === 'tram' && e.geometry && e.nodes);
  const ways = all.filter((e) => !e.tags.service);
  const crossovers = all.filter((e) => e.tags.service === 'crossover');
  const xy = (p) => { const q = toLocal(p.lat, p.lon); return [q.x, q.z]; };
  const byStart = new Map();
  for (const w of ways) byStart.set(w.nodes[0], w);
  const ends = new Set(ways.map((w) => w.nodes[w.nodes.length - 1]));
  // 1. way を進行方向につないだ線（ノード id 付き）
  const lines = [];
  for (const w0 of ways) {
    if (ends.has(w0.nodes[0])) continue;
    const pts = [], ids = [], used = new Set();
    for (let w = w0; w && !used.has(w.id); w = byStart.get(w.nodes[w.nodes.length - 1])) {
      used.add(w.id);
      const k0 = pts.length ? 1 : 0;
      for (let k = k0; k < w.nodes.length; k++) { pts.push(xy(w.geometry[k])); ids.push(w.nodes[k]); }
    }
    lines.push({ name: w0.tags.name || 'tram', pts, ids });
  }
  // 2. 巡回の順: 線の終点の近くから始まる線を次にする
  const order = [0];
  while (lines.length && order.length < lines.length) {
    const end = lines[order[order.length - 1]].pts.at(-1);
    let next = -1, nd = Infinity;
    lines.forEach((l, i) => { if (!order.includes(i) && dist(end, l.pts[0]) < nd) { nd = dist(end, l.pts[0]); next = i; } });
    order.push(next);
  }
  const seq = order.map((i) => lines[i]);
  // 3. 各線を区間に。終端（範囲内で終わる）なら、渡り線で次の線に移って後退する部分を足す
  const legs = [];
  seq.forEach((l, i) => {
    const next = seq[(i + 1) % seq.length];
    let pts = l.pts;
    const endsInside = inside(...pts.at(-1)), nextStartsInside = inside(...next.pts[0]);
    if (endsInside && nextStartsInside && next !== l) {
      // 渡り線: 始点がこの線上、終点が次の線上。終端に最も近いもの
      let best = null;
      for (const c of crossovers) {
        const a = l.ids.indexOf(c.nodes[0]), b = next.ids.indexOf(c.nodes[c.nodes.length - 1]);
        if (a < 0 || b < 0) continue;
        if (!best || a > best.a) best = { c, a, b };
      }
      if (best) {
        const cross = best.c.geometry.map(xy);
        const back = next.pts.slice(0, best.b + 1).reverse(); // 次の線を始点まで後退
        pts = [...l.pts.slice(0, best.a + 1), ...cross.slice(1, -1), ...back];
      }
    }
    const enter = inside(...l.pts[0]) ? 'terminal' : 'edge';
    const exit = inside(...pts.at(-1)) ? 'terminal' : 'edge';
    const clipped = clipLine(pts, inside).map(([x, z]) => [Math.round(x * 10) / 10, Math.round(z * 10) / 10]);
    if (clipped.length < 2) return;
    let length = 0;
    for (let k = 1; k < clipped.length; k++) length += dist(clipped[k - 1], clipped[k]);
    legs.push({ name: l.name, points: clipped, length: Math.round(length * 10) / 10, stops: [], enter, exit });
  });
  // 4. 停留場（同名が上下線に 1 つずつある）を近い区間へ
  for (const e of elements) {
    if (e.type !== 'node' || !e.tags || e.tags.railway !== 'tram_stop') continue;
    const q = toLocal(e.lat, e.lon), p = [q.x, q.z];
    let best = null;
    for (const r of legs) { const pr = projectOnLine(r.points, p); if (pr.d < 8 && (!best || pr.d < best.pr.d)) best = { r, pr }; }
    if (best) best.r.stops.push({ name: e.tags.name, s: Math.round(best.pr.s * 10) / 10 });
  }
  for (const r of legs) r.stops.sort((a, b) => a.s - b.s);
  return { legs };
}
