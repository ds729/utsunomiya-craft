// 国土地理院 標高タイル（テキスト形式、256×256 の CSV、欠測は "e"）の純関数
// 参照: https://maps.gsi.go.jp/development/demtile.html

// 緯度経度 → ズーム z のタイル内ピクセル座標（Web メルカトル。整数部がタイル番号×256＋画素）
export function lonLatToPixel(lat, lon, z) {
  const n = 2 ** z * 256;
  const r = (lat * Math.PI) / 180;
  return { px: ((lon + 180) / 360) * n, py: ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * n };
}

// bbox [south, west, north, east] を覆うタイル {x, y} の一覧
export function tilesInBBox([s, w, n, e], z) {
  const a = lonLatToPixel(n, w, z), b = lonLatToPixel(s, e, z);
  const out = [];
  for (let y = Math.floor(a.py / 256); y <= Math.floor(b.py / 256); y++) {
    for (let x = Math.floor(a.px / 256); x <= Math.floor(b.px / 256); x++) out.push({ x, y });
  }
  return out;
}

// テキストタイル → Float32Array(256*256)。欠測は NaN
export function parseDemText(text) {
  const out = new Float32Array(256 * 256).fill(NaN);
  const rows = text.trim().split(/\r?\n/);
  for (let j = 0; j < Math.min(256, rows.length); j++) {
    const cols = rows[j].split(',');
    for (let i = 0; i < Math.min(256, cols.length); i++) {
      const v = parseFloat(cols[i]);
      if (Number.isFinite(v)) out[j * 256 + i] = v;
    }
  }
  return out;
}

// タイル群（Map "x,y" → Float32Array）から、ピクセル座標で双一次補間した標高。周囲が欠測なら NaN
// 画素 (i, j) の値は画素中心 (i+0.5, j+0.5) の標高とみなす
export function sampleTiles(tiles, px, py) {
  const fx = px - 0.5, fy = py - 0.5;
  const x0 = Math.floor(fx), y0 = Math.floor(fy), tx = fx - x0, ty = fy - y0;
  let sum = 0, wsum = 0;
  for (const [dx, dy, wt] of [[0, 0, (1 - tx) * (1 - ty)], [1, 0, tx * (1 - ty)], [0, 1, (1 - tx) * ty], [1, 1, tx * ty]]) {
    const gx = x0 + dx, gy = y0 + dy;
    const t = tiles.get(`${Math.floor(gx / 256)},${Math.floor(gy / 256)}`);
    if (!t || wt === 0) continue;
    const v = t[(((gy % 256) + 256) % 256) * 256 + (((gx % 256) + 256) % 256)];
    if (Number.isNaN(v)) continue;
    sum += v * wt; wsum += wt;
  }
  return wsum > 0 ? sum / wsum : NaN;
}

// 欠測（NaN）を周囲の値で埋める（反復して近傍平均で拡張）。arr は W×H、その場で書き換える
export function fillGaps(arr, W, H) {
  let missing = 0;
  for (const v of arr) if (Number.isNaN(v)) missing++;
  const filled = missing;
  for (let iter = 0; missing > 0 && iter < 10000; iter++) {
    const next = arr.slice();
    for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
      const k = j * W + i;
      if (!Number.isNaN(arr[k])) continue;
      let s = 0, n = 0;
      for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const ii = i + di, jj = j + dj;
        if (ii < 0 || jj < 0 || ii >= W || jj >= H) continue;
        const v = arr[jj * W + ii];
        if (!Number.isNaN(v)) { s += v; n++; }
      }
      if (n) { next[k] = s / n; missing--; }
    }
    arr.set(next);
  }
  return filled;
}
