// チャンク生成（ラスタ → ボクセル配列）と面カリング付きメッシュ化。three.js・DOM に依存しない純関数
import { BLOCKS, OPAQUE, B, TILE_NAMES, buildingColor } from './blocks.js';
import { Y_MIN, CHUNK_H, CS, cellIndex, fillColumn } from './world-data.js';

export { CS };
export const P = CS + 2;       // 隣接 1 列ぶんの余白を含めたサイズ

// チャンク (cx, cz) と周囲 1 列を含む 18×18×CHUNK_H のブロック配列を作る。
// 隣接チャンクの列も同じ純関数で求めるので、境界の面カリングで隣を空気扱いしない。
// ワールド範囲外の列は空気。index = (yi * P + pz) * P + px、yi = by - Y_MIN
export function generatePadded(w, cx, cz) {
  const blocks = new Uint8Array(P * P * CHUNK_H);
  const tints = new Uint8Array(P * P); // 列の bldtype バイト（壁色用）
  const x0 = cx * CS - 1, z0 = cz * CS - 1;
  let top = 0; // 空気でないブロックの最大 yi（メッシュ化はここまで走査する）
  let col = 0;
  const set = (by, id) => { const yi = by - Y_MIN; blocks[yi * P * P + col] = id; if (yi > top) top = yi; };
  for (let pz = 0; pz < P; pz++) {
    for (let px = 0; px < P; px++) {
      const k = cellIndex(w, x0 + px, z0 + pz);
      if (k < 0) continue;
      col = pz * P + px;
      tints[col] = w.bldtype[k];
      fillColumn(w, k, set);
    }
  }
  // 装飾、編集差分の順に重ねる（自チャンクと、余白にかかる周囲8チャンク）
  for (const store of [w.decor, w.edits]) {
    if (!store) continue;
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
      const m = store.chunk(cx + dx, cz + dz);
      if (!m) continue;
      for (const [idx, id] of m) {
        const lx = idx % CS, lz = Math.floor(idx / CS) % CS, yi = Math.floor(idx / (CS * CS));
        const px = (cx + dx) * CS + lx - x0, pz = (cz + dz) * CS + lz - z0;
        if (px < 0 || pz < 0 || px >= P || pz >= P || cellIndex(w, x0 + px, z0 + pz) < 0) continue;
        blocks[yi * P * P + pz * P + px] = id;
        if (id && yi > top) top = yi;
      }
    }
  }
  return { cx, cz, blocks, tints, top };
}

// 16×16×CHUNK_H（余白なし）。テストや編集用
export function generateChunk(w, cx, cz) {
  const { blocks } = generatePadded(w, cx, cz);
  const out = new Uint8Array(CS * CS * CHUNK_H);
  for (let yi = 0; yi < CHUNK_H; yi++) for (let z = 0; z < CS; z++) for (let x = 0; x < CS; x++) {
    out[(yi * CS + z) * CS + x] = blocks[(yi * P + z + 1) * P + x + 1];
  }
  return out;
}

// 面の定義: 法線方向、4 頂点（外から見て反時計回り、c0,c1 が下辺）、陰影
const FACES = [
  { d: [1, 0, 0], c: [[1, 0, 1], [1, 0, 0], [1, 1, 0], [1, 1, 1]], shade: 0.6, kind: 'side' },
  { d: [-1, 0, 0], c: [[0, 0, 0], [0, 0, 1], [0, 1, 1], [0, 1, 0]], shade: 0.6, kind: 'side' },
  { d: [0, 1, 0], c: [[0, 1, 1], [1, 1, 1], [1, 1, 0], [0, 1, 0]], shade: 1.0, kind: 'top' },
  { d: [0, -1, 0], c: [[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1]], shade: 0.5, kind: 'bottom' },
  { d: [0, 0, 1], c: [[0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]], shade: 0.8, kind: 'side' },
  { d: [0, 0, -1], c: [[1, 0, 0], [0, 0, 0], [0, 1, 0], [1, 1, 0]], shade: 0.8, kind: 'side' },
];

// アトラスの配置（atlas.js と共有）
export const ATLAS_COLS = 8;
export const ATLAS_ROWS = Math.ceil(TILE_NAMES.length / ATLAS_COLS);
const EPS_UV = 0.02 / 16; // テクセル境界のにじみ防止

function tileUV(tile) {
  const col = tile % ATLAS_COLS, row = Math.floor(tile / ATLAS_COLS);
  const u0 = col / ATLAS_COLS + EPS_UV, u1 = (col + 1) / ATLAS_COLS - EPS_UV;
  // CanvasTexture は flipY=true なので、Canvas 上の行 0 が v=1 側
  const v1 = 1 - row / ATLAS_ROWS - EPS_UV, v0 = 1 - (row + 1) / ATLAS_ROWS + EPS_UV;
  return [u0, v0, u1, v1];
}
const TILE_UV = TILE_NAMES.map((_, t) => tileUV(t));

// 向きのある模様（レール・枕木、ホームの黄線、駐車枠）
const ORIENTED = new Set([B.RAIL, B.TRAM, B.PLATFORM, B.PARKING]);

// (px,pz) から ±(dx,dz) 方向に同じブロックが続く数（padded 配列の範囲内、最大 4 ずつ）
function runLength(blocks, base, px, pz, dx, dz, id) {
  let n = 0;
  for (const sgn of [1, -1]) {
    for (let k = 1; k <= 4; k++) {
      const x = px + dx * k * sgn, z = pz + dz * k * sgn;
      if (x < 0 || z < 0 || x >= P || z >= P || blocks[base + z * P + x] !== id) break;
      n++;
    }
  }
  return n;
}

// padded 配列から面カリング付きメッシュを作る。
// 戻り値: positions(Float32, ワールド座標), uvs, colors(Float32, 陰影×建物色), indices(Uint16|Uint32), faces
export function meshChunk(pad) {
  const { blocks, tints, cx, cz } = pad;
  const yEnd = Math.min(CHUNK_H, (pad.top ?? CHUNK_H - 1) + 1);
  const pos = [], uv = [], col = [], idx = [];
  const PP = P * P;
  const ox = cx * CS - 1, oz = cz * CS - 1;
  let faces = 0;
  for (let yi = 0; yi < yEnd; yi++) {
    const by = yi + Y_MIN;
    for (let pz = 1; pz <= CS; pz++) {
      for (let px = 1; px <= CS; px++) {
        const id = blocks[yi * PP + pz * P + px];
        if (id === B.AIR) continue;
        const blk = BLOCKS[id];
        // 水の上面は少し下げる（真上が同じ水でないとき）
        const topH = blk.topH && (yi + 1 >= CHUNK_H || blocks[(yi + 1) * PP + pz * P + px] !== id) ? blk.topH : 1;
        for (let f = 0; f < 6; f++) {
          const F = FACES[f];
          const ny = yi + F.d[1];
          let nb;
          if (ny >= CHUNK_H) nb = B.AIR;
          else if (ny < 0) continue; // 岩盤の下面は見えない
          else nb = blocks[ny * PP + (pz + F.d[2]) * P + px + F.d[0]];
          if (OPAQUE[nb]) continue;
          if (nb === id && !blk.opaque) continue; // 水どうしの境界
          const tile = F.kind === 'top' ? blk.top : F.kind === 'bottom' ? blk.bottom : blk.side;
          const [u0, v0, u1, v1] = TILE_UV[tile];
          let r = F.shade, g = F.shade, b = F.shade;
          if (blk.tint) {
            const c = buildingColor(tints[pz * P + px], id === B.ROOF && F.kind === 'top');
            r *= c[0]; g *= c[1]; b *= c[2];
          }
          const base = pos.length / 3;
          for (let v = 0; v < 4; v++) {
            const c = F.c[v];
            pos.push(ox + px + c[0], by + (c[1] ? topH : 0), oz + pz + c[2]);
            col.push(r, g, b);
          }
          // 線路・軌道などの上面は、同じ材質が東西に長く続くなら模様を 90° 回す
          if (F.kind === 'top' && ORIENTED.has(id) && runLength(blocks, yi * PP, px, pz, 1, 0, id) > runLength(blocks, yi * PP, px, pz, 0, 1, id)) {
            uv.push(u1, v0, u1, v1, u0, v1, u0, v0);
          } else {
            uv.push(u0, v0, u1, v0, u1, v1, u0, v1);
          }
          idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
          faces++;
        }
      }
    }
  }
  const vertexCount = pos.length / 3;
  return {
    positions: new Float32Array(pos),
    uvs: new Float32Array(uv),
    colors: new Float32Array(col),
    indices: vertexCount > 65535 ? new Uint32Array(idx) : new Uint16Array(idx),
    faces, vertexCount,
  };
}
