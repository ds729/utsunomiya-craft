// OSM タグ → 幅・高さ・材質・建物種別の解釈（純関数）
import { MAX_H } from '../config.mjs';

export const MAT = {
  GRASS: 0, DIRT: 1, ASPHALT: 2, SIDEWALK: 3, BALLAST: 4, WATER: 5, PARK: 6,
  PLAZA: 7, PARKING: 8, PLATFORM: 9, TRAM: 10, URBAN: 11, FARMLAND: 12, FOREST: 13, RAIL: 14,
};
export const MAT_NAMES = Object.fromEntries(Object.entries(MAT).map(([k, v]) => [v, k.toLowerCase()]));

export const BTYPE = {
  OTHER: 0, HOUSE: 1, APARTMENT: 2, COMMERCIAL: 3, OFFICE: 4, STATION: 5, INDUSTRIAL: 6,
  PUBLIC: 7, SMALL: 8, ROOF: 9, PART: 10,
};
export const BTYPE_NAMES = Object.fromEntries(Object.entries(BTYPE).map(([k, v]) => [v, k.toLowerCase()]));

export const ROAD_WIDTH = {
  motorway: 16, trunk: 14, primary: 14, secondary: 10, tertiary: 8,
  motorway_link: 6, trunk_link: 6, primary_link: 6, secondary_link: 6, tertiary_link: 6,
  unclassified: 6, residential: 6, living_street: 5, road: 6, service: 4, track: 3,
  pedestrian: 4, footway: 2, path: 2, cycleway: 2, steps: 2, bridleway: 2, corridor: 2, platform: 2,
};
// 車道（アスファルト）として塗る種別。それ以外は歩道材
const CARRIAGEWAY = new Set([
  'motorway', 'trunk', 'primary', 'secondary', 'tertiary', 'motorway_link', 'trunk_link',
  'primary_link', 'secondary_link', 'tertiary_link', 'unclassified', 'residential',
  'living_street', 'road', 'service', 'busway',
]);
// 両側に歩道を自動付与する種別（secondary 以上）
const MAJOR = new Set(['motorway', 'trunk', 'primary', 'secondary', 'trunk_link', 'primary_link', 'secondary_link']);
const SKIP_HIGHWAY = new Set(['proposed', 'abandoned', 'razed', 'elevator', 'bus_stop', 'street_lamp', 'traffic_signals']);

export function parseNum(v) {
  if (v == null) return NaN;
  const m = String(v).replace(',', '.').match(/-?\d+(\.\d+)?/);
  return m ? parseFloat(m[0]) : NaN;
}

const isTunnel = (t) => t.tunnel && t.tunnel !== 'no';
export const layerOf = (t) => { const l = parseNum(t.layer); return Number.isFinite(l) ? l : 0; };
export const isElevated = (t) => t.bridge && t.bridge !== 'no' && layerOf(t) >= 1;

// 道路の解釈。null は描かない
export function roadInfo(t) {
  let hw = t.highway;
  if (!hw || SKIP_HIGHWAY.has(hw)) return null;
  if (hw === 'construction') hw = t.construction || 'residential';
  if (isTunnel(t) || layerOf(t) < 0) return null;
  let w = parseNum(t.width);
  if (!(w > 0 && w < 60)) {
    const lanes = parseNum(t.lanes);
    w = lanes > 0 && lanes < 12 && CARRIAGEWAY.has(hw) ? lanes * 3.25 : (ROAD_WIDTH[hw] ?? 3);
  }
  const carriage = CARRIAGEWAY.has(hw);
  const sidewalk = MAJOR.has(hw) && t.sidewalk !== 'no' && t.sidewalk !== 'none' && t.sidewalk !== 'separate';
  return { kind: hw, width: w, material: carriage ? MAT.ASPHALT : MAT.SIDEWALK, sidewalk, elevated: isElevated(t) };
}

// 線路の解釈
export function railInfo(t) {
  const r = t.railway;
  if (!r || isTunnel(t) || layerOf(t) < 0) return null;
  if (['rail', 'light_rail', 'narrow_gauge', 'subway', 'preserved', 'construction'].includes(r)) {
    return { kind: r, width: 4, material: MAT.BALLAST, elevated: isElevated(t) };
  }
  if (r === 'tram') return { kind: r, width: 3, material: MAT.TRAM, elevated: isElevated(t) };
  return null;
}

// 面として塗る地表材質（建物・道路以外）。優先度が高いほど後で塗る
export function areaMaterial(t) {
  if (t.building || t['building:part']) return null;
  if (t.railway === 'platform' || t.public_transport === 'platform') return { mat: MAT.PLATFORM, pri: 6 };
  if (t['area:highway'] || (t.highway === 'pedestrian' && t.area === 'yes') || t.place === 'square' || (t.highway && t.area === 'yes')) {
    return { mat: t['area:highway'] && !['footway', 'pedestrian', 'platform'].includes(t['area:highway']) ? MAT.ASPHALT : MAT.PLAZA, pri: 5 };
  }
  if (t.amenity === 'parking' && t.parking !== 'underground' && t.parking !== 'multi-storey') return { mat: MAT.PARKING, pri: 4 };
  if (t.natural === 'water' || t.waterway === 'riverbank' || t.landuse === 'reservoir' || t.landuse === 'basin') return { mat: MAT.WATER, pri: 3 };
  if (t.leisure === 'park' || t.leisure === 'garden' || t.leisure === 'playground' || t.leisure === 'pitch' || t.landuse === 'grass' || t.landuse === 'recreation_ground' || t.landuse === 'cemetery') return { mat: MAT.PARK, pri: 2 };
  if (t.landuse === 'forest' || t.natural === 'wood' || t.natural === 'scrub') return { mat: MAT.FOREST, pri: 2 };
  if (t.landuse === 'farmland' || t.landuse === 'meadow' || t.landuse === 'orchard') return { mat: MAT.FARMLAND, pri: 1 };
  if (t.landuse === 'railway') return { mat: MAT.DIRT, pri: 1 };
  if (['residential', 'commercial', 'retail', 'industrial'].includes(t.landuse)) return { mat: MAT.URBAN, pri: 0 };
  return null;
}

export const WATERWAY_WIDTH = { river: 12, canal: 6, stream: 3, drain: 2, ditch: 1.5 };
export function waterwayInfo(t) {
  if (!WATERWAY_WIDTH[t.waterway] || isTunnel(t)) return null;
  const w = parseNum(t.width);
  return { width: w > 0 && w < 100 ? w : WATERWAY_WIDTH[t.waterway] };
}

const TYPE_MAP = {
  house: BTYPE.HOUSE, detached: BTYPE.HOUSE, residential: BTYPE.HOUSE, terrace: BTYPE.HOUSE, semidetached_house: BTYPE.HOUSE,
  apartments: BTYPE.APARTMENT, dormitory: BTYPE.APARTMENT, hotel: BTYPE.APARTMENT,
  commercial: BTYPE.COMMERCIAL, retail: BTYPE.COMMERCIAL, supermarket: BTYPE.COMMERCIAL, kiosk: BTYPE.SMALL,
  office: BTYPE.OFFICE, train_station: BTYPE.STATION, transportation: BTYPE.STATION,
  industrial: BTYPE.INDUSTRIAL, warehouse: BTYPE.INDUSTRIAL, parking: BTYPE.INDUSTRIAL,
  school: BTYPE.PUBLIC, university: BTYPE.PUBLIC, hospital: BTYPE.PUBLIC, public: BTYPE.PUBLIC, civic: BTYPE.PUBLIC,
  government: BTYPE.PUBLIC, temple: BTYPE.PUBLIC, shrine: BTYPE.PUBLIC, church: BTYPE.PUBLIC,
  garage: BTYPE.SMALL, garages: BTYPE.SMALL, shed: BTYPE.SMALL, hut: BTYPE.SMALL, toilets: BTYPE.SMALL,
  roof: BTYPE.ROOF, carport: BTYPE.ROOF,
};
const DEFAULT_H = {
  [BTYPE.OTHER]: 8, [BTYPE.HOUSE]: 6, [BTYPE.APARTMENT]: 15, [BTYPE.COMMERCIAL]: 12, [BTYPE.OFFICE]: 15,
  [BTYPE.STATION]: 15, [BTYPE.INDUSTRIAL]: 8, [BTYPE.PUBLIC]: 12, [BTYPE.SMALL]: 3, [BTYPE.ROOF]: 4, [BTYPE.PART]: 8,
};

export function buildingType(t) {
  const v = t.building && t.building !== 'yes' ? t.building : t['building:part'] && t['building:part'] !== 'yes' ? t['building:part'] : null;
  if (v && TYPE_MAP[v] != null) return TYPE_MAP[v];
  if (t.amenity === 'parking') return BTYPE.INDUSTRIAL;
  if (t.shop) return BTYPE.COMMERCIAL;
  return t['building:part'] && !t.building ? BTYPE.PART : BTYPE.OTHER;
}

// 高さ: height → building:levels×3m → 種別既定値。1..MAX_H にクランプ
export function buildingHeight(t) {
  let h = parseNum(t.height);
  if (!(h > 0)) {
    const lv = parseNum(t['building:levels']);
    if (lv > 0) h = lv * 3 + (parseNum(t['roof:levels']) > 0 ? parseNum(t['roof:levels']) * 3 : 0);
  }
  if (!(h > 0)) h = DEFAULT_H[buildingType(t)];
  return Math.max(1, Math.min(MAX_H, Math.round(h)));
}
