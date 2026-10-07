// public/world のラスタから俯瞰 PNG を出力する（data/preview/）
// 使い方: node tools/debug-preview.mjs [--x=0 --z=0 --r=1000 --scale=1 --out=name] [--highlight=名前1,名前2]
//   x,z: 中心のローカル座標[m]、r: 半径[m]、scale: 1m あたりのピクセル数
//   highlight: 指定した name を含む道路・線路の way を OSM 生データから探して色付きで重ねる
import fs from 'node:fs';
import zlib from 'node:zlib';
import { PATHS } from './config.mjs';
import { encodePNG } from './lib/png.mjs';
import { makeProjection } from './lib/geo.mjs';
import { strokePolyline } from './lib/raster.mjs';

const args = Object.fromEntries(process.argv.slice(2).map((a) => a.replace(/^--/, '').split('=')));
const world = JSON.parse(fs.readFileSync(`${PATHS.worldDir}/world.json`, 'utf8'));
const W = world.size.x, H = world.size.z, { west, north } = world.extent;
const read = (n) => new Uint8Array(zlib.gunzipSync(fs.readFileSync(`${PATHS.worldDir}/${n}.bin.gz`)));
const ground = read('ground'), bld = read('bld'), bldtype = read('bldtype'), deck = read('deck');

const GROUND_RGB = {
  grass: [150, 190, 110], dirt: [170, 140, 100], asphalt: [70, 70, 75], sidewalk: [190, 185, 175],
  ballast: [130, 110, 95], water: [70, 130, 210], park: [90, 165, 80], plaza: [225, 205, 160],
  parking: [120, 120, 140], platform: [240, 240, 230], tram: [255, 140, 0], urban: [175, 175, 165],
  farmland: [200, 200, 120], forest: [50, 115, 60], rail: [60, 40, 30],
};
const BTYPE_RGB = {
  other: [200, 160, 160], house: [215, 165, 140], apartment: [190, 150, 190], commercial: [230, 130, 120],
  office: [140, 160, 210], station: [0, 170, 170], industrial: [170, 160, 140], public: [210, 190, 110],
  small: [190, 170, 150], roof: [200, 200, 200], part: [220, 120, 200],
};
const gColor = Object.fromEntries(Object.entries(world.materials).map(([id, n]) => [id, GROUND_RGB[n] || [255, 0, 255]]));
const bColor = Object.fromEntries(Object.entries(world.buildingTypes).map(([id, n]) => [id, BTYPE_RGB[n] || [255, 0, 255]]));

const cx = +(args.x ?? 0), cz = +(args.z ?? 0), r = +(args.r ?? Math.max(W, H) / 2), scale = +(args.scale ?? 1);
const x0 = cx - r, z0 = cz - r;
const S = Math.round(2 * r * scale);
const img = new Uint8Array(S * S * 3);

for (let py = 0; py < S; py++) {
  for (let px = 0; px < S; px++) {
    const x = x0 + (px + 0.5) / scale, z = z0 + (py + 0.5) / scale;
    const i = Math.floor(x + west), j = Math.floor(z + north);
    const o = (py * S + px) * 3;
    if (i < 0 || j < 0 || i >= W || j >= H) { img[o] = img[o + 1] = img[o + 2] = 30; continue; }
    const k = j * W + i;
    let c;
    if (bld[k]) {
      // 建物: 種別色を高さで暗く（高いほど濃い）
      const f = 1 - Math.min(bld[k], 60) / 100;
      c = bColor[bldtype[k] & 15].map((v) => v * f);
    } else c = gColor[ground[k]];
    // 高架床板は斜線で重ねる（下の建物・地表が見えるように）
    if (deck[k] && (((Math.floor(x) + Math.floor(z)) % 4) + 4) % 4 < 2) c = deck[k] >= 12 ? [200, 0, 255] : [255, 60, 200];
    // 100m グリッド
    const onGrid = (Math.abs(x - Math.round(x / 100) * 100) < 0.5 / scale * 1.5) || (Math.abs(z - Math.round(z / 100) * 100) < 0.5 / scale * 1.5);
    if (onGrid) c = c.map((v) => v * 0.8);
    img[o] = c[0]; img[o + 1] = c[1]; img[o + 2] = c[2];
  }
}

const dot = (x, z, rad, rgb) => {
  const pcx = (x - x0) * scale, pcy = (z - z0) * scale, pr = rad * scale;
  for (let py = Math.floor(pcy - pr); py <= pcy + pr; py++) for (let px = Math.floor(pcx - pr); px <= pcx + pr; px++) {
    if (px < 0 || py < 0 || px >= S || py >= S || (px - pcx) ** 2 + (py - pcy) ** 2 > pr * pr) continue;
    img.set(rgb, (py * S + px) * 3);
  }
};

// 名前で way を強調表示
const PALETTE = [[255, 30, 30], [0, 220, 255], [255, 230, 0], [0, 255, 120], [255, 255, 255]];
if (args.highlight) {
  const osm = JSON.parse(fs.readFileSync(PATHS.osm, 'utf8'));
  const proj = makeProjection(osm.origin.lat, osm.origin.lon);
  args.highlight.split(',').forEach((name, n) => {
    const rgb = PALETTE[n % PALETTE.length];
    let hits = 0;
    for (const el of osm.elements) {
      if (el.type !== 'way' || !el.tags || !el.geometry || !(el.tags.highway || el.tags.railway) || !(el.tags.name || '').includes(name)) continue;
      hits++;
      const pts = el.geometry.map((g) => { const p = proj.toLocal(g.lat, g.lon); return [(p.x - x0) * scale, (p.z - z0) * scale]; });
      strokePolyline(pts, Math.max(2, 1.5 * scale), S, S, (i, j) => img.set(rgb, (j * S + i) * 3));
    }
    console.log(`highlight "${name}" → way ${hits} 本（色 ${rgb}）`);
  });
}

// 凡例: 斜線マゼンタ=高架床板（紫=12m以上 新幹線等、ピンク=それ未満 デッキ・橋）
// 原点（JR宇都宮駅ノード）に赤丸、POI（駅・停留場）に白丸
for (const p of world.pois) if (/station|tram_stop|stop_position/.test(p.kind)) dot(p.x, p.z, 3, [255, 255, 255]);
dot(0, 0, 6, [255, 0, 0]);

fs.mkdirSync(PATHS.previewDir, { recursive: true });
const out = `${PATHS.previewDir}/${args.out || 'overview'}.png`;
fs.writeFileSync(out, encodePNG(S, S, img));
console.log(`出力 ${out}（${S}×${S}px、中心 x=${cx} z=${cz}、半径 ${r}m、${scale}px/m）`);
