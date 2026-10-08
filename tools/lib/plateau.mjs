// PLATEAU CityGML（bldg）の読み取りと、OSM ラスタへの高さの取り込み（純関数）
import { fillPolygon } from './raster.mjs';
import { BTYPE } from './tags.mjs';
import { MAX_H } from '../config.mjs';

// 建物用途コード（Building_usage.xml）→ 建物種別
const USAGE_TYPE = {
  401: BTYPE.OFFICE, 402: BTYPE.COMMERCIAL, 403: BTYPE.APARTMENT, 404: BTYPE.COMMERCIAL,
  411: BTYPE.HOUSE, 412: BTYPE.APARTMENT, 413: BTYPE.HOUSE, 414: BTYPE.APARTMENT, 415: BTYPE.HOUSE,
  421: BTYPE.PUBLIC, 422: BTYPE.PUBLIC, 431: BTYPE.INDUSTRIAL, 441: BTYPE.INDUSTRIAL,
};
// 地表材質（tags.mjs の MAT）: asphalt, sidewalk, ballast, water, plaza, platform, tram, rail
const INFRA = new Set([2, 3, 4, 5, 7, 9, 10, 14]);
export const usageType = (code) => USAGE_TYPE[code] ?? BTYPE.OTHER;

// CityGML テキスト → [{ id, height, usage, rings: [[[lat, lon], ...], ...] }]
// 高さは measuredHeight、無効（-9999 等）なら LOD1 立体の z の範囲
export function parseBuildings(text) {
  const out = [];
  const re = /<bldg:Building gml:id="([^"]+)">([\s\S]*?)<\/bldg:Building>/g;
  let m;
  while ((m = re.exec(text))) {
    const body = m[2];
    const num = (tag) => { const r = new RegExp(`<${tag}[^>]*>([^<]+)<`).exec(body); return r ? parseFloat(r[1]) : NaN; };
    let height = num('bldg:measuredHeight');
    const usage = num('bldg:usage');
    const edge = /<bldg:lod0RoofEdge>([\s\S]*?)<\/bldg:lod0RoofEdge>/.exec(body);
    if (!edge) continue;
    const rings = [...edge[1].matchAll(/<gml:posList>([^<]+)<\/gml:posList>/g)].map(([, s]) => {
      const v = s.trim().split(/\s+/).map(Number);
      const ring = [];
      for (let k = 0; k + 2 < v.length; k += 3) ring.push([v[k], v[k + 1]]);
      return ring;
    });
    if (!(height > 0)) {
      const solid = /<bldg:lod1Solid>([\s\S]*?)<\/bldg:lod1Solid>/.exec(body);
      if (solid) {
        let lo = Infinity, hi = -Infinity;
        for (const [, s] of solid[1].matchAll(/<gml:posList>([^<]+)<\/gml:posList>/g)) {
          const v = s.trim().split(/\s+/).map(Number);
          for (let k = 2; k < v.length; k += 3) { lo = Math.min(lo, v[k]); hi = Math.max(hi, v[k]); }
        }
        height = hi - lo;
      }
    }
    if (!(height > 0)) continue;
    out.push({ id: m[1], height, usage, rings });
  }
  return out;
}

// 文字列 id → 0..15
export function variantOfString(id) {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 16777619);
  h ^= h >>> 15;
  return (h >>> 0) & 15;
}

// PLATEAU の高さを OSM ラスタに取り込む（w の bld / bldtype を上書き）。
// - PLATEAU の建物セル: PLATEAU の高さ。種別は OSM 建物があればそれ（駅舎などを保つ）、なければ用途コード
// - PLATEAU と 30% 以上重なる OSM 建物の、PLATEAU に覆われないセル: 覆われたセルの高さの中央値（外形のずれで旧高さが残らないように）
// - PLATEAU と重ならない OSM 建物: そのまま（新しい建物など）
// toGrid([lat, lon]) → [gx, gy]、owner: OSM 建物の番号（-1 = なし）
export function applyPlateau(w, buildings, toGrid, owner) {
  const N = w.W * w.H;
  const ph = new Uint8Array(N), pt = new Uint8Array(N);
  let skippedInfra = 0;
  const cells = [];
  for (const b of buildings) {
    const h = Math.max(1, Math.min(MAX_H, Math.round(b.height)));
    const t = usageType(b.usage) | (variantOfString(b.id) << 4);
    cells.length = 0;
    fillPolygon(b.rings.map((r) => r.map(toGrid)), w.W, w.H, (i, j) => cells.push(j * w.W + i));
    // OSM 建物と重ならず、大半が床板・道路・線路・広場・水の上にあるもの（ペデストリアンデッキ・上屋など）は
    // 建物として積まない（床板や上屋として別に表現済みで、積むと通路をふさぐ）
    if (w.ground && cells.length) {
      let osm = 0, infra = 0;
      for (const k of cells) { if (w.bld[k]) osm++; if (w.deck[k] || INFRA.has(w.ground[k])) infra++; }
      if (osm < cells.length * 0.3 && infra >= cells.length * 0.5) { skippedInfra++; continue; }
    }
    for (const k of cells) if (h >= ph[k]) { ph[k] = h; pt[k] = t; } // 重なりは高い方
  }
  // OSM 建物ごとの被覆
  const total = new Map(), covered = new Map();
  for (let k = 0; k < N; k++) {
    const o = owner[k];
    if (o < 0 || !w.bld[k]) continue;
    total.set(o, (total.get(o) || 0) + 1);
    if (ph[k]) { if (!covered.has(o)) covered.set(o, []); covered.get(o).push(ph[k]); }
  }
  const matchedH = new Map();
  for (const [o, hs] of covered) {
    if (hs.length / total.get(o) < 0.3) continue;
    hs.sort((a, b) => a - b);
    matchedH.set(o, hs[hs.length >> 1]);
  }
  const stats = { plateauBuildings: buildings.length, skippedInfra, plateauCells: 0, plateauOnlyCells: 0, osmMatched: matchedH.size, osmUnmatched: total.size - matchedH.size, filledFromMatch: 0 };
  for (let k = 0; k < N; k++) {
    if (ph[k]) {
      stats.plateauCells++;
      if (!w.bld[k]) { stats.plateauOnlyCells++; w.bldtype[k] = pt[k]; }
      else if ((w.bldtype[k] & 15) === BTYPE.OTHER) w.bldtype[k] = (pt[k] & 15) | (w.bldtype[k] & 0xf0);
      w.bld[k] = ph[k];
    } else if (w.bld[k] && matchedH.has(owner[k])) {
      w.bld[k] = matchedH.get(owner[k]);
      stats.filledFromMatch++;
    }
  }
  return stats;
}
