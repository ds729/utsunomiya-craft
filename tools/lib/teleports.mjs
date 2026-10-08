// テレポート先（POIメニュー）を OSM の名称検索で求める（純関数）
// 各定義: label（表示名）、name（完全一致）か pattern（正規表現）、filter（タグ条件）。
// 一致した要素の代表点（ノード=座標、way=頂点の平均）の平均を取る。見つからなければ省く
export const TELEPORT_DEFS = [
  { label: '宇都宮駅 東口', name: '宇都宮駅東口', filter: (t) => t.public_transport || t.highway === 'bus_stop' },
  { label: '宇都宮駅 西口', name: 'JR宇都宮駅西口' },
  { label: '餃子像（西口）', name: '餃子像' },
  { label: 'ライトライン 宇都宮駅東口停留場', name: '宇都宮駅東口', filter: (t) => t.railway === 'tram_stop' },
  { label: 'ライトライン 東宿郷停留場', name: '東宿郷', filter: (t) => t.railway === 'tram_stop' },
  { label: 'ライトライン 駅東公園前停留場', name: '駅東公園前', filter: (t) => t.railway === 'tram_stop' },
  { label: 'ライトキューブ宇都宮', name: 'ライトキューブ宇都宮' },
  { label: '宇都宮みんみん（駅前）', pattern: /^宇都宮みんみん$/, near: [0, -150] },
  { label: '大通り', name: '大通り', filter: (t) => t.highway },
  { label: '宮の橋（田川）', name: '宮の橋', filter: (t) => t.man_made === 'bridge' || t.bridge },
  { label: '鬼怒通り', name: '鬼怒通り', filter: (t) => t.highway },
];

// elements: Overpass の out geom、toLocal(lat, lon) → {x, z}、inExtent(x, z)
export function findTeleports(elements, toLocal, inExtent, defs = TELEPORT_DEFS) {
  const out = [];
  for (const d of defs) {
    let pts = [];
    for (const e of elements) {
      const t = e.tags || {};
      if (!t.name || (d.name ? t.name !== d.name : !d.pattern.test(t.name)) || (d.filter && !d.filter(t))) continue;
      let p = null;
      if (e.type === 'node') p = toLocal(e.lat, e.lon);
      else if (e.geometry) {
        const ps = e.geometry.map((g) => toLocal(g.lat, g.lon)).filter((q) => inExtent(q.x, q.z));
        if (ps.length) p = { x: ps.reduce((a, q) => a + q.x, 0) / ps.length, z: ps.reduce((a, q) => a + q.z, 0) / ps.length };
      }
      if (p && inExtent(p.x, p.z)) pts.push(p);
    }
    // near: 同名が複数あるときは指定点に最も近いものだけ
    if (d.near && pts.length > 1) {
      pts.sort((a, b) => Math.hypot(a.x - d.near[0], a.z - d.near[1]) - Math.hypot(b.x - d.near[0], b.z - d.near[1]));
      pts = pts.slice(0, 1);
    }
    if (!pts.length) continue;
    out.push({ label: d.label, x: Math.round(pts.reduce((a, q) => a + q.x, 0) / pts.length), z: Math.round(pts.reduce((a, q) => a + q.z, 0) / pts.length) });
  }
  return out;
}
