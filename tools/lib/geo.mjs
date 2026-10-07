// 緯度経度 ⇔ ローカルメートル座標（原点中心、+x=東、-z=北）

const M_PER_DEG_LON = 111320;
const M_PER_DEG_LAT = 110540;

export function makeProjection(lat0, lon0) {
  const cosLat = Math.cos((lat0 * Math.PI) / 180);
  return {
    toLocal(lat, lon) {
      return { x: (lon - lon0) * cosLat * M_PER_DEG_LON, z: -(lat - lat0) * M_PER_DEG_LAT };
    },
    toLatLon(x, z) {
      return { lat: lat0 - z / M_PER_DEG_LAT, lon: lon0 + x / (cosLat * M_PER_DEG_LON) };
    },
  };
}

// 原点と各方向の範囲[m]から bbox [south, west, north, east] を求める
export function bboxFromExtent(lat0, lon0, extent, margin = 0) {
  const p = makeProjection(lat0, lon0);
  const nw = p.toLatLon(-(extent.west + margin), -(extent.north + margin));
  const se = p.toLatLon(extent.east + margin, extent.south + margin);
  return [se.lat, nw.lon, nw.lat, se.lon];
}
