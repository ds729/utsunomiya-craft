// 座標・方位・POI の純関数（tools/lib/geo.mjs と同じ投影式）
const M_PER_DEG_LON = 111320;
const M_PER_DEG_LAT = 110540;

export function toLatLon(origin, x, z) {
  const cosLat = Math.cos((origin.lat * Math.PI) / 180);
  return { lat: origin.lat - z / M_PER_DEG_LAT, lon: origin.lon + x / (cosLat * M_PER_DEG_LON) };
}

// 方位[度]（北=0、東=90、時計回り） ⇔ カメラ yaw[rad]（0=北向き、正で左回り）
export const headingToYaw = (deg) => (-deg * Math.PI) / 180;
export function yawToHeading(yaw) {
  const d = (-yaw * 180) / Math.PI;
  return ((d % 360) + 360) % 360;
}

const DIRS = ['北', '北東', '東', '南東', '南', '南西', '西', '北西'];
export const headingLabel = (deg) => DIRS[Math.round(deg / 45) % 8];

// 最寄り POI（maxDist[m] 以内）。なければ null
export function nearestPoi(pois, x, z, maxDist = 30) {
  let best = null, bd = maxDist * maxDist;
  for (const p of pois) {
    const d = (p.x - x) ** 2 + (p.z - z) ** 2;
    if (d <= bd) { bd = d; best = p; }
  }
  return best && { ...best, dist: Math.sqrt(bd) };
}
