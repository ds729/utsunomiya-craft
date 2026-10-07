// OSM 生データを Overpass API から取得して data/raw/ にキャッシュする
// 使い方: node tools/fetch-osm.mjs [--force]
import fs from 'node:fs';
import { STATION, EXTENT, FETCH_MARGIN_M, OVERPASS_URL, USER_AGENT, PATHS } from './config.mjs';
import { bboxFromExtent } from './lib/geo.mjs';

const force = process.argv.includes('--force');
fs.mkdirSync(PATHS.rawDir, { recursive: true });

async function overpass(query, attempt = 1) {
  const res = await fetch(OVERPASS_URL, {
    method: 'POST',
    headers: { 'User-Agent': USER_AGENT, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'data=' + encodeURIComponent(query),
  });
  if (res.ok) return res.json();
  const text = await res.text();
  if ((res.status === 429 || res.status === 504) && attempt < 4) {
    console.warn(`  Overpass ${res.status}, ${attempt * 20}s 待って再試行`);
    await new Promise((r) => setTimeout(r, attempt * 20000));
    return overpass(query, attempt + 1);
  }
  throw new Error(`Overpass ${res.status}: ${text.slice(0, 300)}`);
}

// 1. 中心駅の確定
async function resolveStation() {
  if (!force && fs.existsSync(PATHS.station)) return JSON.parse(fs.readFileSync(PATHS.station, 'utf8'));
  const [s, w, n, e] = STATION.searchBBox;
  const q = `[out:json][timeout:60];node["railway"="station"]["name"="${STATION.name}"](${s},${w},${n},${e});out;`;
  const data = await overpass(q);
  const nodes = data.elements.filter((el) => (el.tags.operator || '').includes(STATION.operatorPattern));
  if (!nodes.length) throw new Error('JR宇都宮駅のノードが見つからない');
  // 在来線・新幹線で同名ノードが複数ある場合は平均を原点とする（decisions.md 参照）
  const lat = nodes.reduce((a, n) => a + n.lat, 0) / nodes.length;
  const lon = nodes.reduce((a, n) => a + n.lon, 0) / nodes.length;
  const station = {
    lat: +lat.toFixed(7), lon: +lon.toFixed(7),
    nodes: nodes.map((n) => ({ id: n.id, lat: n.lat, lon: n.lon, train: n.tags.train, highspeed: n.tags.highspeed })),
    fetchedAt: new Date().toISOString(),
  };
  fs.writeFileSync(PATHS.station, JSON.stringify(station, null, 2));
  return station;
}

function mainQuery(bbox) {
  const b = bbox.join(',');
  return `[out:json][timeout:180][maxsize:536870912][bbox:${b}];
(
  way["building"]; relation["building"]["type"="multipolygon"];
  way["building:part"]; relation["building:part"]["type"="multipolygon"];
  way["highway"]; way["area:highway"]; relation["highway"]["type"="multipolygon"];
  way["railway"];
  way["public_transport"="platform"]; relation["public_transport"="platform"]["type"="multipolygon"];
  way["landuse"]; relation["landuse"]["type"="multipolygon"];
  way["leisure"]; relation["leisure"]["type"="multipolygon"];
  way["natural"]; relation["natural"]["type"="multipolygon"];
  way["waterway"];
  way["amenity"="parking"]; relation["amenity"="parking"]["type"="multipolygon"];
  way["place"="square"]; relation["place"="square"]["type"="multipolygon"];
  way["man_made"="bridge"];
  node["name"]["railway"]; node["name"]["public_transport"];
  node["name"]["amenity"]; node["name"]["shop"]; node["name"]["tourism"]; node["name"]["leisure"];
);
out geom;`;
}

function splitBBox([s, w, n, e]) {
  const ms = (s + n) / 2, mw = (w + e) / 2;
  return [[s, w, ms, mw], [s, mw, ms, e], [ms, w, n, mw], [ms, mw, n, e]];
}

async function fetchArea(bbox, depth = 0) {
  try {
    console.log(`  取得中 bbox=${bbox.map((v) => v.toFixed(5)).join(',')}`);
    return (await overpass(mainQuery(bbox))).elements;
  } catch (err) {
    if (depth >= 2) throw err;
    console.warn(`  失敗（${err.message.slice(0, 80)}）→ 4分割して再取得`);
    const out = [];
    for (const sub of splitBBox(bbox)) out.push(...(await fetchArea(sub, depth + 1)));
    return out;
  }
}

function report(elements) {
  const c = { building: 0, buildingRel: 0, buildingPart: 0, highway: 0, rail: 0, tram: 0, platform: 0, water: 0, landuse: 0, poi: 0 };
  for (const el of elements) {
    const t = el.tags || {};
    if (el.type === 'node') { c.poi++; continue; }
    if (t.building) el.type === 'relation' ? c.buildingRel++ : c.building++;
    if (t['building:part']) c.buildingPart++;
    if (t.highway) c.highway++;
    if (['rail', 'light_rail', 'narrow_gauge'].includes(t.railway)) c.rail++;
    if (t.railway === 'tram') c.tram++;
    if (t.railway === 'platform' || t.public_transport === 'platform') c.platform++;
    if (t.natural === 'water' || t.waterway) c.water++;
    if (t.landuse || t.leisure) c.landuse++;
  }
  return c;
}

const station = await resolveStation();
console.log(`原点（JR宇都宮駅）: lat=${station.lat} lon=${station.lon}（ノード ${station.nodes.map((n) => n.id).join(', ')}）`);
const bbox = bboxFromExtent(station.lat, station.lon, EXTENT, FETCH_MARGIN_M);

let osm;
if (!force && fs.existsSync(PATHS.osm)) {
  osm = JSON.parse(fs.readFileSync(PATHS.osm, 'utf8'));
  console.log('キャッシュを使用:', PATHS.osm, '（再取得は --force）');
} else {
  const raw = await fetchArea(bbox);
  const seen = new Set();
  const elements = raw.filter((el) => { const k = el.type + el.id; if (seen.has(k)) return false; seen.add(k); return true; });
  osm = { origin: { lat: station.lat, lon: station.lon }, bbox, extent: EXTENT, fetchedAt: new Date().toISOString(), elements };
  fs.writeFileSync(PATHS.osm, JSON.stringify(osm));
}
const size = fs.statSync(PATHS.osm).size;
console.log(`bbox [S,W,N,E] = ${osm.bbox.map((v) => v.toFixed(6)).join(', ')}`);
console.log(`要素数 合計 ${osm.elements.length}（${(size / 1e6).toFixed(1)} MB）`);
console.table(report(osm.elements));
