// ラスタ化の純関数群。座標はグリッド座標（セル (i,j) の中心は (i+0.5, j+0.5)）

// 偶奇規則のスキャンライン塗り。rings: [[ [x,y], ... ], ...]（閉じていなくてもよい）
// 複数リングをまとめて渡せば内周（穴）は自動的に抜ける
export function fillPolygon(rings, width, height, set) {
  let minY = Infinity, maxY = -Infinity;
  const edges = [];
  for (const ring of rings) {
    const n = ring.length;
    if (n < 3) continue;
    for (let k = 0; k < n; k++) {
      const a = ring[k], b = ring[(k + 1) % n];
      if (a[1] === b[1]) continue;
      edges.push(a[0], a[1], b[0], b[1]);
      if (a[1] < minY) minY = a[1];
      if (a[1] > maxY) maxY = a[1];
    }
  }
  if (!edges.length) return 0;
  const j0 = Math.max(0, Math.floor(minY - 0.5));
  const j1 = Math.min(height - 1, Math.ceil(maxY - 0.5));
  const xs = [];
  let count = 0;
  for (let j = j0; j <= j1; j++) {
    const y = j + 0.5;
    xs.length = 0;
    for (let e = 0; e < edges.length; e += 4) {
      const ax = edges[e], ay = edges[e + 1], bx = edges[e + 2], by = edges[e + 3];
      // 半開区間で頂点の二重カウントを防ぐ
      if ((ay <= y && by > y) || (by <= y && ay > y)) {
        xs.push(ax + ((y - ay) * (bx - ax)) / (by - ay));
      }
    }
    xs.sort((p, q) => p - q);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      // セル中心 i+0.5 が [xa, xb) に入るセルを塗る
      const ia = Math.max(0, Math.ceil(xs[k] - 0.5));
      const ib = Math.min(width - 1, Math.ceil(xs[k + 1] - 0.5) - 1);
      for (let i = ia; i <= ib; i++) { set(i, j); count++; }
    }
  }
  return count;
}

// 幅 w の太線（丸端）。セル中心から線分までの距離が w/2 以下のセルを塗る
export function strokePolyline(points, w, width, height, set) {
  const r = Math.max(w, 1) / 2;
  const r2 = r * r;
  let count = 0;
  const seen = points.length > 2 ? new Set() : null;
  for (let k = 0; k + 1 < points.length; k++) {
    const [ax, ay] = points[k], [bx, by] = points[k + 1];
    const i0 = Math.max(0, Math.floor(Math.min(ax, bx) - r));
    const i1 = Math.min(width - 1, Math.ceil(Math.max(ax, bx) + r));
    const j0 = Math.max(0, Math.floor(Math.min(ay, by) - r));
    const j1 = Math.min(height - 1, Math.ceil(Math.max(ay, by) + r));
    const dx = bx - ax, dy = by - ay;
    const len2 = dx * dx + dy * dy;
    for (let j = j0; j <= j1; j++) {
      const py = j + 0.5;
      for (let i = i0; i <= i1; i++) {
        const px = i + 0.5;
        let t = len2 ? ((px - ax) * dx + (py - ay) * dy) / len2 : 0;
        t = t < 0 ? 0 : t > 1 ? 1 : t;
        const ex = ax + t * dx - px, ey = ay + t * dy - py;
        if (ex * ex + ey * ey <= r2) {
          if (seen) {
            const key = j * width + i;
            if (seen.has(key)) continue;
            seen.add(key);
          }
          set(i, j);
          count++;
        }
      }
    }
  }
  return count;
}
