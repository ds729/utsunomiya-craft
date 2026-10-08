// OSM 要素 → 1m ラスタ（ground / bld / bldtype / deck）。副作用なし
import { makeProjection } from './geo.mjs';
import { fillPolygon, strokePolyline } from './raster.mjs';
import { assembleRings } from './rings.mjs';
import { MAT, roadInfo, railInfo, areaMaterial, waterwayInfo, buildingHeight, buildingType, layerOf } from './tags.mjs';

const SIDEWALK_W = 2;
const DECK_PER_LAYER = 6; // layer 1 あたりの床板下面高さ[m]
const DECK_MAX = 30;
const RAIL_VIADUCT_H = 12; // 鉄道高架は layer 値がまちまちなので一律の高さにする
const RAIL_VIADUCT_W = 6;  // 並行する複線の高架が隙間なくつながる幅

// OSM id → 0..15 の色バリエーション（整数ハッシュ）
export function variantOf(id) {
  let h = (Number(id) >>> 0) ^ Math.floor(Number(id) / 4294967296);
  h = Math.imul(h ^ (h >>> 16), 0x45d9f3b);
  h = Math.imul(h ^ (h >>> 16), 0x45d9f3b);
  return (h ^ (h >>> 16)) & 15;
}

// 偶奇規則の点内判定
export function pointInRings([x, y], rings) {
  let inside = false;
  for (const r of rings) {
    for (let k = 0, n = r.length; k < n; k++) {
      const a = r[k], b = r[(k + 1) % n];
      if ((a[1] > y) !== (b[1] > y) && x < a[0] + ((y - a[1]) * (b[0] - a[0])) / (b[1] - a[1])) inside = !inside;
    }
  }
  return inside;
}

// 2 線分が交差するか（端点の接触は含まない）
function segCross(a, b, c, d) {
  const o = (p, q, r) => (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]);
  const d1 = o(a, b, c), d2 = o(a, b, d), d3 = o(c, d, a), d4 = o(c, d, b);
  return d1 * d2 < 0 && d3 * d4 < 0;
}

// way w の線が、ノードを共有しない他の線と交差するか（立体交差の判定）
export function crossesAny(w, others) {
  const line = w.g.line, nodes = new Set(w.el.nodes || []);
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (const [x, y] of line) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
  for (const o of others) {
    if (o === w || (o.el.nodes || []).some((n) => nodes.has(n))) continue;
    const ol = o.g.line;
    for (let k = 0; k + 1 < ol.length; k++) {
      const c = ol[k], d = ol[k + 1];
      if (Math.max(c[0], d[0]) < x0 || Math.min(c[0], d[0]) > x1 || Math.max(c[1], d[1]) < y0 || Math.min(c[1], d[1]) > y1) continue;
      for (let m = 0; m + 1 < line.length; m++) if (segCross(line[m], line[m + 1], c, d)) return true;
    }
  }
  return false;
}

export function buildWorld(osm, extent) {
  const W = extent.west + extent.east, H = extent.north + extent.south;
  const proj = makeProjection(osm.origin.lat, osm.origin.lon);
  const toGrid = (p) => { const { x, z } = proj.toLocal(p.lat, p.lon); return [x + extent.west, z + extent.north]; };

  const ground = new Uint8Array(W * H).fill(MAT.GRASS);
  const bld = new Uint8Array(W * H);
  const bldtype = new Uint8Array(W * H);
  const deck = new Uint8Array(W * H);
  const stats = { unclosedRings: 0, relations: 0, skippedNoGeom: 0 };

  const paint = (arr, v) => (i, j) => { arr[j * W + i] = v; };
  const paintMax = (arr, v) => (i, j) => { const k = j * W + i; if (arr[k] === 0 || arr[k] > v) arr[k] = v; };

  // 要素ごとの幾何: { lines: [[x,y]...][], rings: [[x,y]...][] (閉じた面) }
  function geomOf(el) {
    if (el.type === 'way') {
      if (!el.geometry) { stats.skippedNoGeom++; return null; }
      const pts = el.geometry.map(toGrid);
      const closed = el.nodes && el.nodes.length > 3 && el.nodes[0] === el.nodes[el.nodes.length - 1];
      return { line: pts, rings: closed ? [pts] : null };
    }
    if (el.type === 'relation') {
      stats.relations++;
      // 偶奇規則で塗るので outer/inner を区別せずリング化すればよい（内周は自動で穴になる）
      const segs = (el.members || []).filter((m) => m.type === 'way' && m.geometry && (m.role === 'outer' || m.role === 'inner' || m.role === ''))
        .map((m) => m.geometry.map((g) => [g.lon, g.lat]));
      const { rings, unclosed } = assembleRings(segs);
      stats.unclosedRings += unclosed;
      return { line: null, rings: rings.map((r) => r.map(([lon, lat]) => toGrid({ lat, lon }))) };
    }
    return null;
  }

  const ways = [];
  for (const el of osm.elements) {
    if (el.type === 'node') continue;
    const g = geomOf(el);
    if (g) ways.push({ el, t: el.tags || {}, g });
  }

  // 1. 地表の面（優先度順）
  const areas = ways.map((w) => ({ w, a: w.g.rings ? areaMaterial(w.t) : null })).filter((x) => x.a);
  areas.sort((p, q) => p.a.pri - q.a.pri);
  const deckAreas = [];
  for (const { w, a } of areas) {
    // layer>=1 の面（ペデストリアンデッキ等）は地表ではなく高架床板として扱う
    if (layerOf(w.t) >= 1 && (a.mat === MAT.PLAZA || a.mat === MAT.ASPHALT || a.mat === MAT.PLATFORM)) { deckAreas.push(w); continue; }
    fillPolygon(w.g.rings, W, H, paint(ground, a.mat));
  }

  // 2. 水路（線）
  for (const w of ways) {
    const wi = w.g.line && waterwayInfo(w.t);
    if (wi) strokePolyline(w.g.line, wi.width, W, H, paint(ground, MAT.WATER));
  }

  // 3. 道路: 歩道 → 細い道 → 太い道 の順。高架は deck へ
  const roads = ways.filter((w) => w.g.line && !(w.t.area === 'yes')).map((w) => ({ w, r: roadInfo(w.t) })).filter((x) => x.r);
  // 道路の橋のうち、他の車道・線路の上を越えないもの（川を渡る橋など）は地表の道路として塗る
  // （layer=1 の橋をすべて 6m の床板にすると、前後に坂がないため道が途切れて歩けない）
  // 越える対象は車道と線路だけ（橋の下をくぐる河川敷の歩道・自転車道は数えない）
  const atGradeLines = [
    ...roads.filter((x) => !x.r.elevated && x.r.material === MAT.ASPHALT).map((x) => x.w),
    ...ways.filter((w) => w.g.line && railInfo(w.t)),
  ];
  stats.bridgesAtGrade = 0;
  for (const x of roads) {
    if (x.r.elevated && !crossesAny(x.w, atGradeLines)) { x.r = { ...x.r, elevated: false }; stats.bridgesAtGrade++; }
  }
  roads.sort((p, q) => p.r.width - q.r.width);
  for (const { w, r } of roads) {
    if (!r.elevated && r.sidewalk) strokePolyline(w.g.line, r.width + SIDEWALK_W * 2, W, H, paint(ground, MAT.SIDEWALK));
  }
  for (const { w, r } of roads) {
    if (r.elevated) continue;
    // 歩道材の細道が車道を上書きしないよう、車道セルは保持
    const set = r.material === MAT.SIDEWALK
      ? (i, j) => { const k = j * W + i; if (ground[k] !== MAT.ASPHALT) ground[k] = MAT.SIDEWALK; }
      : paint(ground, r.material);
    strokePolyline(w.g.line, r.width, W, H, set);
  }

  // 4. 線路（地上）
  const rails = ways.filter((w) => w.g.line).map((w) => ({ w, r: railInfo(w.t) })).filter((x) => x.r);
  for (const { w, r } of rails) {
    if (r.elevated) continue;
    strokePolyline(w.g.line, r.width, W, H, paint(ground, r.material));
    if (r.material === MAT.BALLAST) strokePolyline(w.g.line, 1.5, W, H, paint(ground, MAT.RAIL));
  }

  // 5. 高架（橋・デッキ）: 下面高さ = layer × 6m。複数重なる場合は低い方を採用（歩ける方を優先）
  for (const { w, r } of roads) {
    if (r.elevated) strokePolyline(w.g.line, r.width, W, H, paintMax(deck, Math.min(DECK_MAX, layerOf(w.t) * DECK_PER_LAYER)));
  }
  // 鉄道高架は道路デッキより後に上書き（同じ列なら鉄道の高さで揃える）
  for (const { w, r } of rails) {
    if (r.elevated) strokePolyline(w.g.line, Math.max(r.width, RAIL_VIADUCT_W), W, H, paint(deck, RAIL_VIADUCT_H));
  }
  for (const w of deckAreas) {
    // 高架ホームは鉄道高架と同じ高さに揃える
    const isPlatform = w.t.railway === 'platform' || w.t.public_transport === 'platform';
    fillPolygon(w.g.rings, W, H, isPlatform ? paint(deck, RAIL_VIADUCT_H) : paintMax(deck, Math.min(DECK_MAX, layerOf(w.t) * DECK_PER_LAYER)));
  }
  stats.deckAreas = deckAreas.length;
  // 橋の外形（man_made=bridge）は、中を高架のまま残った道路・線路が通るときだけ床板にする
  const elevatedLines = [...roads.filter((x) => x.r.elevated).map((x) => x.w.g.line), ...rails.filter((x) => x.r.elevated).map((x) => x.w.g.line)];
  for (const w of ways) {
    if (w.t.man_made !== 'bridge' || !w.g.rings) continue;
    if (!elevatedLines.some((line) => line.some((pt) => pointInRings(pt, w.g.rings)))) { stats.bridgeAreasAtGrade = (stats.bridgeAreasAtGrade || 0) + 1; continue; }
    if (w.t.man_made === 'bridge' && w.g.rings) fillPolygon(w.g.rings, W, H, paintMax(deck, Math.min(DECK_MAX, Math.max(1, layerOf(w.t)) * DECK_PER_LAYER)));
  }

  // 6. 建物: 外形 → building:part（高さ違いで上書き）
  const blds = ways.filter((w) => w.g.rings && w.t.building && w.t.building !== 'no' && !w.t['building:part']);
  const parts = ways.filter((w) => w.g.rings && w.t['building:part'] && w.t['building:part'] !== 'no');
  // owner: セルを塗った OSM 建物の番号（PLATEAU との対応付け用。building:part は外形の番号を保つ）
  const owner = new Int32Array(W * H).fill(-1);
  let nextOwner = 0;
  for (const w of [...blds, ...parts]) {
    const isPart = !!w.t['building:part'];
    const id = nextOwner++;
    // 下位4bit=種別、上位4bit=色バリエーション（OSM id 由来。建物単位で一貫）
    const h = buildingHeight(w.t), bt = buildingType(w.t) | (variantOf(w.el.id) << 4);
    fillPolygon(w.g.rings, W, H, (i, j) => { const k = j * W + i; bld[k] = h; bldtype[k] = bt; if (!isPart || owner[k] < 0) owner[k] = id; });
  }
  stats.buildings = blds.length;
  stats.buildingParts = parts.length;
  stats.roads = roads.length;
  stats.rails = rails.length;
  stats.areas = areas.length;

  // POI（名前付きノード＋名前付き面の重心）
  const pois = [];
  const poiKind = (t) => t.railway || t.public_transport || t.amenity || t.shop || t.tourism || t.leisure || null;
  for (const el of osm.elements) {
    const t = el.tags || {};
    if (!t.name) continue;
    let p = null;
    if (el.type === 'node') p = proj.toLocal(el.lat, el.lon);
    else if (el.bounds && (t.railway === 'station' || t.leisure === 'park' || t.place === 'square' || t.building === 'train_station')) {
      p = proj.toLocal((el.bounds.minlat + el.bounds.maxlat) / 2, (el.bounds.minlon + el.bounds.maxlon) / 2);
    }
    if (!p || p.x < -extent.west || p.x >= extent.east || p.z < -extent.north || p.z >= extent.south) continue;
    const kind = poiKind(t) || t.building || t.place;
    if (!kind) continue;
    pois.push({ name: t.name, kind, x: Math.round(p.x * 10) / 10, z: Math.round(p.z * 10) / 10 });
  }

  return { W, H, ground, bld, bldtype, deck, owner, pois, stats, toGrid };
}
