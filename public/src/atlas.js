// 16×16 タイルのテクスチャアトラスを Canvas で生成する（外部画像は使わない）
import { TILE_NAMES } from './blocks.js';
import { ATLAS_COLS, ATLAS_ROWS } from './chunk.js';

const T = 16;

function rng(seed) {
  let s = seed >>> 0;
  return () => { s = (Math.imul(s ^ (s >>> 15), 0x2c1b3c6d) + 0x9e3779b9) >>> 0; return (s >>> 8) / 16777216; };
}

// 基本色にノイズを散らす
function noise(ctx, rnd, [r, g, b], amp, x0, y0) {
  for (let y = 0; y < T; y++) for (let x = 0; x < T; x++) {
    const n = (rnd() - 0.5) * amp;
    ctx.fillStyle = `rgb(${clamp(r + n)},${clamp(g + n)},${clamp(b + n)})`;
    ctx.fillRect(x0 + x, y0 + y, 1, 1);
  }
}
const clamp = (v) => Math.max(0, Math.min(255, Math.round(v)));
const rect = (ctx, c, x, y, w, h) => { ctx.fillStyle = c; ctx.fillRect(x, y, w, h); };

const DRAW = {
  grass: (c, r, x, y) => noise(c, r, [96, 150, 70], 40, x, y),
  dirt: (c, r, x, y) => noise(c, r, [130, 96, 66], 36, x, y),
  bedrock: (c, r, x, y) => noise(c, r, [70, 70, 72], 70, x, y),
  asphalt: (c, r, x, y) => noise(c, r, [72, 72, 76], 18, x, y),
  sidewalk: (c, r, x, y) => {
    noise(c, r, [182, 176, 166], 16, x, y);
    rect(c, 'rgba(0,0,0,0.12)', x, y + 7, 16, 1); rect(c, 'rgba(0,0,0,0.12)', x + 7, y, 1, 16); // 敷石の目地
  },
  ballast: (c, r, x, y) => noise(c, r, [128, 118, 106], 60, x, y),
  water: (c, r, x, y) => {
    noise(c, r, [56, 110, 190], 18, x, y);
    for (let k = 0; k < 5; k++) rect(c, 'rgba(255,255,255,0.18)', x + Math.floor(r() * 12), y + Math.floor(r() * 16), 4, 1);
  },
  park: (c, r, x, y) => noise(c, r, [78, 160, 64], 46, x, y),
  plaza: (c, r, x, y) => {
    noise(c, r, [214, 196, 158], 14, x, y);
    for (let k = 0; k < 16; k += 4) { rect(c, 'rgba(90,70,40,0.15)', x, y + k, 16, 1); rect(c, 'rgba(90,70,40,0.15)', x + k, y, 1, 16); }
  },
  parking: (c, r, x, y) => { noise(c, r, [104, 104, 112], 16, x, y); rect(c, 'rgba(240,240,240,0.7)', x, y, 1, 16); },
  platform: (c, r, x, y) => { noise(c, r, [218, 216, 206], 10, x, y); rect(c, 'rgb(230,200,40)', x, y + 13, 16, 2); }, // 点字ブロックの黄線
  tram: (c, r, x, y) => {
    noise(c, r, [120, 150, 110], 30, x, y); // 芝生軌道
    rect(c, 'rgb(150,150,155)', x + 3, y, 2, 16); rect(c, 'rgb(150,150,155)', x + 11, y, 2, 16);
  },
  urban: (c, r, x, y) => noise(c, r, [160, 158, 150], 22, x, y),
  farmland: (c, r, x, y) => { noise(c, r, [150, 120, 70], 24, x, y); for (let k = 1; k < 16; k += 3) rect(c, 'rgba(90,140,50,0.8)', x, y + k, 16, 1); },
  forest: (c, r, x, y) => noise(c, r, [52, 108, 52], 50, x, y),
  rail: (c, r, x, y) => {
    noise(c, r, [118, 108, 96], 50, x, y);
    for (let k = 1; k < 16; k += 4) rect(c, 'rgb(96,70,50)', x, y + k, 16, 2); // 枕木
    rect(c, 'rgb(170,170,176)', x + 3, y, 2, 16); rect(c, 'rgb(170,170,176)', x + 11, y, 2, 16);
  },
  deck: (c, r, x, y) => { noise(c, r, [176, 176, 172], 14, x, y); rect(c, 'rgba(0,0,0,0.1)', x, y + 15, 16, 1); },
  deck_side: (c, r, x, y) => { noise(c, r, [150, 150, 148], 14, x, y); rect(c, 'rgba(0,0,0,0.25)', x, y + 14, 16, 2); },
  // 屋根・壁はグレースケール（頂点カラーで建物ごとに着色）
  roof: (c, r, x, y) => { noise(c, r, [210, 210, 210], 22, x, y); rect(c, 'rgba(0,0,0,0.12)', x, y, 16, 1); rect(c, 'rgba(0,0,0,0.12)', x, y, 1, 16); },
  wall: (c, r, x, y) => noise(c, r, [236, 236, 236], 14, x, y),
  wall_window: (c, r, x, y) => {
    noise(c, r, [236, 236, 236], 14, x, y);
    // 窓（2枚）: 青みのガラスと窓枠。白っぽい壁色に掛け算されても暗く見えるよう低めの値
    for (const wx of [2, 9]) {
      rect(c, 'rgb(60,72,92)', x + wx, y + 3, 5, 9);
      rect(c, 'rgb(110,130,160)', x + wx + 1, y + 4, 2, 3);
      rect(c, 'rgb(180,180,180)', x + wx, y + 12, 5, 1);
    }
  },
  grass_side: (c, r, x, y) => {
    noise(c, r, [130, 96, 66], 36, x, y);
    for (let k = 0; k < 16; k++) rect(c, 'rgb(96,150,70)', x + k, y, 1, 3 + Math.floor(r() * 2));
  },
  platform_side: (c, r, x, y) => noise(c, r, [168, 166, 158], 12, x, y),
};

export function createAtlasCanvas() {
  const canvas = document.createElement('canvas');
  canvas.width = ATLAS_COLS * T;
  canvas.height = ATLAS_ROWS * T;
  const ctx = canvas.getContext('2d');
  TILE_NAMES.forEach((name, i) => {
    const x = (i % ATLAS_COLS) * T, y = Math.floor(i / ATLAS_COLS) * T;
    DRAW[name](ctx, rng(i * 7919 + 17), x, y);
  });
  return canvas;
}
