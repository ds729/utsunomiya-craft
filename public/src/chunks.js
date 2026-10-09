// チャンクのストリーミング管理。three.js には依存せず、メッシュの生成・破棄はコールバックで受け取る
// mesher を渡すと、チャンク生成（ボクセル化＋メッシュ化）を非同期（Web Worker）に任せ、
// 本スレッドは結果の受け取り（GPU への転送 = makeMesh）だけを予算内で行う。mesher なしなら同期で作る
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
  // mesher: { request(cx, cz, gen, done(mesh, ms)), capacity() → 今送れる依頼数 }（省略時は同期生成）
  constructor(world, { viewDist = 8, makeMesh, disposeMesh, mesher = null, now = () => performance.now() }) {
    this.world = world;
    this.viewDist = viewDist;
    this.makeMesh = makeMesh;
    this.disposeMesh = disposeMesh;
    this.mesher = mesher;
    this.now = now;
    this.loaded = new Map(); // "cx,cz" → { handle, vertexCount }
    this.queue = [];
    this.want = new Set();   // 現在の描画範囲のチャンク
    this.gen = new Map();    // "cx,cz" → 最新の依頼番号（古い結果を捨てる）
    this.inFlight = new Map(); // "cx,cz" → 依頼中の番号
    this.results = [];       // 届いたが未反映の結果
    this.center = null;
    this.bounds = {
      x0: Math.floor(-world.west / CS), x1: Math.floor((world.W - world.west - 1) / CS),
      z0: Math.floor(-world.north / CS), z1: Math.floor((world.H - world.north - 1) / CS),
    };
    this.stats = { chunks: 0, vertices: 0, lastChunkMs: 0, avgChunkMs: 0, uploadMs: 0, built: 0, pending: 0 };
  }

  setViewDist(r) { this.viewDist = Math.max(2, Math.min(16, r)); this.center = null; }

  get pending() { return this.queue.length + this.inFlight.size + this.results.length; }

  // 毎フレーム呼ぶ。budgetMs の範囲でチャンクを作る（mesher があれば反映する）。戻り値: 待ちチャンク数
  update(x, z, budgetMs = 6) {
    const pcx = Math.floor(x / CS), pcz = Math.floor(z / CS);
    const key = `${pcx},${pcz},${this.viewDist}`;
    if (this.center !== key) {
      this.center = key;
      const want = chunksInRange(pcx, pcz, this.viewDist, this.bounds);
      this.want = new Set(want.map((c) => `${c.cx},${c.cz}`));
      // 描画距離 + 1 の外は破棄（境界付近での作り直しの往復を防ぐ）
      const far = (this.viewDist + 1) ** 2 + this.viewDist;
      for (const [k, c] of this.loaded) {
        if (this.want.has(k)) continue;
        const [cx, cz] = k.split(',').map(Number);
        if ((cx - pcx) ** 2 + (cz - pcz) ** 2 > far) this.unload(k, c);
      }
      this.queue = want.filter((c) => { const k = `${c.cx},${c.cz}`; return !this.loaded.has(k) && !this.inFlight.has(k); });
    }
    const t0 = this.now();
    if (this.mesher) {
      this.pump();
      while (this.results.length && this.now() - t0 < budgetMs) this.apply(this.results.shift());
    } else {
      while (this.queue.length && this.now() - t0 < budgetMs) {
        const { cx, cz } = this.queue.shift();
        this.build(cx, cz);
      }
    }
    this.stats.chunks = this.loaded.size;
    this.stats.pending = this.pending;
    return this.pending;
  }

  unload(k, c) {
    this.disposeMesh(c.handle);
    this.stats.vertices -= c.vertexCount;
    this.loaded.delete(k);
  }

  // 編集後の作り直し（読み込み済みか依頼中のチャンクだけ。未読み込みなら後で差分込みで作られる）
  // 非同期のときは新しいメッシュが届くまで古いメッシュを表示したままにする（ちらつかない）
  rebuild(cx, cz) {
    const k = `${cx},${cz}`;
    if (this.mesher) {
      if (!this.loaded.has(k) && !this.inFlight.has(k)) return false;
      this.request(cx, cz);
      return true;
    }
    const c = this.loaded.get(k);
    if (!c) return false;
    this.unload(k, c);
    this.build(cx, cz);
    return true;
  }

  // 依頼は近い順に、mesher の空きぶんだけ（生成は別スレッドなので予算に数えない）。
  // 結果が届くたびにも呼び、フレームを待たずに次を依頼する
  pump() {
    while (this.queue.length && this.mesher.capacity() > 0) {
      const { cx, cz } = this.queue.shift();
      this.request(cx, cz);
    }
  }

  request(cx, cz) {
    const k = `${cx},${cz}`;
    const gen = (this.gen.get(k) || 0) + 1;
    this.gen.set(k, gen);
    this.inFlight.set(k, gen);
    this.mesher.request(cx, cz, gen, (mesh, ms) => { this.results.push({ k, cx, cz, gen, mesh, ms }); this.pump(); });
  }

  // 届いた結果を反映。古い依頼の結果・描画範囲から外れたチャンクは捨てる
  apply({ k, gen, mesh, ms }) {
    if (this.gen.get(k) !== gen) return;
    this.inFlight.delete(k);
    const old = this.loaded.get(k);
    if (!old && !this.want.has(k)) return;
    this.install(k, mesh, ms, old);
  }

  build(cx, cz) {
    const t = this.now();
    const mesh = meshChunk(generatePadded(this.world, cx, cz));
    this.install(`${cx},${cz}`, mesh, this.now() - t, null);
  }

  install(k, mesh, ms, old) {
    const t = this.now();
    const handle = mesh.faces ? this.makeMesh(mesh) : null;
    if (old) this.unload(k, old);
    this.loaded.set(k, { handle, vertexCount: mesh.vertexCount });
    this.stats.vertices += mesh.vertexCount;
    this.stats.lastChunkMs = ms;
    this.stats.built++;
    const n = Math.min(this.stats.built, 50);
    this.stats.avgChunkMs += (ms - this.stats.avgChunkMs) / n;
    this.stats.uploadMs += (this.now() - t - this.stats.uploadMs) / n;
  }
}
