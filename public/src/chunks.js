// チャンクのストリーミング管理。three.js には依存せず、メッシュの生成・破棄はコールバックで受け取る
import { CS, generatePadded, meshChunk } from './chunk.js';

// プレイヤーのいるチャンクから半径 r（円形）以内のチャンクを近い順に返す。bounds はチャンク座標の範囲
export function chunksInRange(pcx, pcz, r, bounds) {
  const out = [];
  for (let dz = -r; dz <= r; dz++) for (let dx = -r; dx <= r; dx++) {
    const d2 = dx * dx + dz * dz;
    if (d2 > r * r + r) continue;
    const cx = pcx + dx, cz = pcz + dz;
    if (cx < bounds.x0 || cx > bounds.x1 || cz < bounds.z0 || cz > bounds.z1) continue;
    out.push({ cx, cz, d2 });
  }
  return out.sort((a, b) => a.d2 - b.d2);
}

export class ChunkManager {
  // makeMesh(meshData) → handle、disposeMesh(handle)
  constructor(world, { viewDist = 8, makeMesh, disposeMesh, now = () => performance.now() }) {
    this.world = world;
    this.viewDist = viewDist;
    this.makeMesh = makeMesh;
    this.disposeMesh = disposeMesh;
    this.now = now;
    this.loaded = new Map(); // "cx,cz" → { handle, vertexCount }
    this.queue = [];
    this.center = null;
    this.bounds = {
      x0: Math.floor(-world.west / CS), x1: Math.floor((world.W - world.west - 1) / CS),
      z0: Math.floor(-world.north / CS), z1: Math.floor((world.H - world.north - 1) / CS),
    };
    this.stats = { chunks: 0, vertices: 0, lastChunkMs: 0, avgChunkMs: 0, built: 0, pending: 0 };
  }

  setViewDist(r) { this.viewDist = Math.max(2, Math.min(16, r)); this.center = null; }

  // 毎フレーム呼ぶ。budgetMs の範囲でチャンクを作る。戻り値: 待ちチャンク数
  update(x, z, budgetMs = 6) {
    const pcx = Math.floor(x / CS), pcz = Math.floor(z / CS);
    const key = `${pcx},${pcz},${this.viewDist}`;
    if (this.center !== key) {
      this.center = key;
      const want = chunksInRange(pcx, pcz, this.viewDist, this.bounds);
      const keep = new Set(want.map((c) => `${c.cx},${c.cz}`));
      // 描画距離 + 1 の外は破棄（境界付近での作り直しの往復を防ぐ）
      const far = (this.viewDist + 1) ** 2 + this.viewDist;
      for (const [k, c] of this.loaded) {
        if (keep.has(k)) continue;
        const [cx, cz] = k.split(',').map(Number);
        if ((cx - pcx) ** 2 + (cz - pcz) ** 2 > far) {
          this.disposeMesh(c.handle);
          this.stats.vertices -= c.vertexCount;
          this.loaded.delete(k);
        }
      }
      this.queue = want.filter((c) => !this.loaded.has(`${c.cx},${c.cz}`));
    }
    const t0 = this.now();
    while (this.queue.length && this.now() - t0 < budgetMs) {
      const { cx, cz } = this.queue.shift();
      this.build(cx, cz);
    }
    this.stats.chunks = this.loaded.size;
    this.stats.pending = this.queue.length;
    return this.queue.length;
  }

  build(cx, cz) {
    const t = this.now();
    const mesh = meshChunk(generatePadded(this.world, cx, cz));
    const handle = mesh.faces ? this.makeMesh(mesh) : null;
    this.loaded.set(`${cx},${cz}`, { handle, vertexCount: mesh.vertexCount });
    const ms = this.now() - t;
    this.stats.vertices += mesh.vertexCount;
    this.stats.lastChunkMs = ms;
    this.stats.built++;
    this.stats.avgChunkMs += (ms - this.stats.avgChunkMs) / Math.min(this.stats.built, 50);
  }
}
