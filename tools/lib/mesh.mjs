// 標準地域メッシュ（3次メッシュ = 約1km）の純関数
export function mesh3(lat, lon) {
  const p = Math.floor(lat * 1.5), u = Math.floor(lon - 100);
  const latR = lat - p / 1.5, lonR = lon - 100 - u;
  const q = Math.floor(latR / (5 / 60)), v = Math.floor(lonR / (7.5 / 60));
  const r = Math.floor((latR - q * (5 / 60)) / (30 / 3600)), w = Math.floor((lonR - v * (7.5 / 60)) / (45 / 3600));
  return `${p}${u}${q}${v}${r}${w}`;
}

// bbox [south, west, north, east] を覆う 3 次メッシュコードの一覧
export function meshesInBBox([s, w, n, e]) {
  const out = new Set();
  for (let lat = s; lat <= n + 30 / 3600; lat += 30 / 3600) {
    for (let lon = w; lon <= e + 45 / 3600; lon += 45 / 3600) {
      out.add(mesh3(Math.min(lat, n), Math.min(lon, e)));
    }
  }
  return [...out].sort();
}
