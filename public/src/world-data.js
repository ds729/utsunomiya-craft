// ワールドのラスタ（1m セル）と、列ごとのブロック決定。fetch 以外は純関数
import { B, GROUND_BLOCK, SOLID, MAT_WATER, MAT_PLATFORM } from './blocks.js';
import { EditStore } from './edits.js';

export const Y_MIN = -4;   // 岩盤
export const MAX_G = 40;   // 地表の高さ（起伏）の上限（tools/lib/terrain.mjs の maxG）
export const Y_MAX = 140;  // ブロックの上限（地表の上限 + 建物の上限 MAX_H=96 に余裕）
export const CHUNK_H = Y_MAX - Y_MIN + 1;
export const CS = 16;     // チャンクの x,z サイズ
const BT_SMALL = 8, BT_ROOF = 9; // world.json の buildingTypes
const OVER_TRACK = new Set([1, 4, 9, 10, 14]); // 地表材質: dirt(landuse=railway), ballast, platform, tram, rail
const OVER_TRACK_H = 6; // 線路上の建物の下の空き[m]

// meta: world.json、rasters: { ground, bld, bldtype, deck, elev }（Uint8Array, size.x*size.z）
// elev はセルの地表ブロックの高さ（無ければ平坦 = 0）
// decor: 装飾ブロックの一覧 Int16Array [x, y, z, id, ...]（tools/lib/decor.mjs。元の地形の一部として扱う）
// edits: 編集差分（EditStore。なければ null）
export function makeWorld(meta, rasters, edits = null) {
  return {
    meta,
    W: meta.size.x, H: meta.size.z,
    west: meta.extent.west, north: meta.extent.north,
    ground: rasters.ground, bld: rasters.bld, bldtype: rasters.bldtype, deck: rasters.deck,
    elev: rasters.elev || new Uint8Array(meta.size.x * meta.size.z),
    decor: rasters.decor ? decorStore(rasters.decor) : null,
    decorList: rasters.decor || null,
    edits,
  };
}

// 装飾の一覧をチャンク単位の差分（EditStore と同じ形）にする
export function decorStore(list) {
  const st = new EditStore();
  for (let i = 0; i + 3 < list.length; i += 4) st.set(list[i], list[i + 1], list[i + 2], list[i + 3]);
  return st;
}

// ブロック座標 (x, z) はローカル m を floor したもの。範囲外は -1
export function cellIndex(w, x, z) {
  const i = x + w.west, j = z + w.north;
  return i < 0 || j < 0 || i >= w.W || j >= w.H ? -1 : j * w.W + i;
}

// セル k の地表ブロックの高さ（by）
export const groundY = (w, k) => w.elev[k];

// 1列分のブロックを書き出す: set(by, id)。列ごとに「地表」「建物」「床板」を独立に評価する
//  g = 地表の高さ（elev）として、by=-4 岩盤、-3..g-1 土、g 地表、g+1..g+h 建物（最上段=屋根、3m ごとの窓の段）、
//  床板は by=g+1+deck（建物内なら省略）。以下の高さはすべて g からの相対
//  ホーム面は 1 段高い（g+1 も PLATFORM）。屋根だけの建物（roof 種別・高さ3m以上）は最上段のみ
//  線路・ホームの上の建物は g+7 の床から上（下を列車・人が通れる）
export function fillColumn(w, k, set0) {
  const g = w.elev[k];
  set0(Y_MIN, B.BEDROCK);
  for (let y = Y_MIN + 1; y < g; y++) set0(y, B.DIRT);
  const set = g ? (y, id) => set0(y + g, id) : set0;
  const mat = w.ground[k];
  set(0, GROUND_BLOCK[mat] ?? B.GRASS);
  let h = w.bld[k];
  const t = w.bldtype[k] & 15;
  if (h > 0 && t === BT_ROOF && h >= 3) {
    // 屋根だけの構造（building=roof / carport: バス乗り場の上屋など）は最上段だけ。下は通れる
    set(h, B.ROOF);
    h = 0;
  }
  // 線路・ホームの上の建物（橋上駅舎など）は下を空けて 6m から上に置く（線路を埋めない）
  const base = h > OVER_TRACK_H + 1 && OVER_TRACK.has(mat) ? OVER_TRACK_H + 1 : 1;
  if (h > 0) {
    const small = t === BT_SMALL || t === BT_ROOF; // 小屋・低い屋根は窓なし
    if (base > 1) set(base, B.DECK); // 床
    for (let y = base + (base > 1 ? 1 : 0); y < h; y++) set(y, !small && (y - 1) % 3 === 1 ? B.WALL_WIN : B.WALL);
    set(h, B.ROOF);
  }
  if ((h === 0 || base > 1) && mat === MAT_PLATFORM) set(1, B.PLATFORM);
  const d = w.deck[k];
  if (d > 0) {
    const y = 1 + d;
    // 床板は建物の中なら省略（駅舎の下の空間にはそのまま置く）
    const inside = h > 0 && y >= base && y <= h;
    if (!inside && y > (mat === MAT_PLATFORM ? 1 : 0) && y + g <= Y_MAX) set(y, B.DECK);
  }
}

// 単一ブロック（テスト・衝突用）。範囲外は AIR
export function blockAt(w, x, by, z) {
  if (by < Y_MIN || by > Y_MAX) return B.AIR;
  const k = cellIndex(w, x, z);
  if (k < 0) return B.AIR;
  if (w.edits) { const e = w.edits.get(x, by, z); if (e !== undefined) return e; }
  if (w.decor) { const d = w.decor.get(x, by, z); if (d !== undefined) return d; }
  return baseBlockAt(w, k, by);
}

// 編集前の地形（ラスタ＋装飾）のブロック（ブロック座標で）
export function originalBlockAt(w, x, by, z) {
  if (by < Y_MIN || by > Y_MAX) return B.AIR;
  const k = cellIndex(w, x, z);
  if (k < 0) return B.AIR;
  if (w.decor) { const d = w.decor.get(x, by, z); if (d !== undefined) return d; }
  return baseBlockAt(w, k, by);
}

// 編集前の地形のブロック（セル index で）
export function baseBlockAt(w, k, by) {
  if (by < w.elev[k] && by > Y_MIN) return B.DIRT; // 地表より下（よく呼ばれるので近道）
  let id = B.AIR;
  fillColumn(w, k, (y, b) => { if (y === by) id = b; });
  return id;
}

// 衝突判定用。ワールド外周（水平方向の範囲外）と岩盤より下は壁として扱う。手すりの上の 1 ブロックも衝突する
export function isSolidAt(w, x, by, z) {
  if (by < Y_MIN) return true;
  if (cellIndex(w, x, z) < 0) return true;
  if (by > Y_MAX + 1) return false;
  if (SOLID[blockAt(w, x, by, z)] === 1) return true;
  // 手すりは柵のように 1 つ上のブロックまで衝突する（段差の自動上り・ジャンプで乗り越えて落ちない）
  return blockAt(w, x, by - 1, z) === B.RAILING;
}

export function isWaterAt(w, x, by, z) {
  const k = cellIndex(w, x, z);
  return k >= 0 && by === w.elev[k] && w.ground[k] === MAT_WATER;
}

// gzip の先頭バイト（1f 8b）なら展開する。サーバが Content-Encoding: gzip で送り、
// ブラウザが展開済みの場合はそのまま使う
async function gunzipIfNeeded(bytes) {
  if (bytes[0] !== 0x1f || bytes[1] !== 0x8b) return bytes;
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

// world/ 以下を読み込む（ブラウザ専用）。.bin.gz は DecompressionStream で展開
export async function loadWorld(baseUrl, onProgress = () => {}) {
  const meta = await (await fetch(new URL('world.json', baseUrl))).json();
  const names = ['ground', 'bld', 'bldtype', 'deck', 'elev', 'decor'].filter((n) => meta.files[n]);
  const rasters = {};
  let done = 0;
  await Promise.all(names.map(async (n) => {
    const res = await fetch(new URL(meta.files[n], baseUrl));
    if (!res.ok) throw new Error(`${meta.files[n]}: HTTP ${res.status}`);
    const bytes = await gunzipIfNeeded(new Uint8Array(await res.arrayBuffer()));
    if (n === 'decor') { rasters[n] = new Int16Array(bytes.buffer, bytes.byteOffset, bytes.byteLength >> 1); onProgress(++done / names.length); return; }
    rasters[n] = bytes;
    if (rasters[n].length !== meta.size.x * meta.size.z) throw new Error(`${n}: サイズ不一致 ${rasters[n].length}`);
    onProgress(++done / names.length);
  }));
  return makeWorld(meta, rasters);
}
