// Web Worker のプール。ChunkManager の mesher（request / capacity）として使う
// 編集差分はチャンク単位で全 Worker に送る（依頼より先に送るので、作り直しは必ず新しい差分で作られる）
const PER_WORKER = 2; // 1 Worker あたりの同時依頼数（受け取り・転送の間も Worker を遊ばせない）

export function workerCount() {
  const n = (typeof navigator !== 'undefined' && navigator.hardwareConcurrency) || 4;
  return Math.max(1, Math.min(4, n - 1));
}

// world: makeWorld の結果。失敗したら reject（呼び出し側で同期生成に切り替える）
export async function createWorkerMesher(world, n = workerCount()) {
  const workers = [];
  const busy = [];
  const waiting = new Map(); // id → { w, done }
  let nextId = 1;
  const rasters = { ground: world.ground, bld: world.bld, bldtype: world.bldtype, deck: world.deck, elev: world.elev, decor: world.decorList };
  const edits = [...world.edits.chunks].map(([key, m]) => [key, [...m]]);
  for (let i = 0; i < n; i++) {
    const w = new Worker(new URL('./mesh-worker.js', import.meta.url), { type: 'module' });
    w.onmessage = (e) => {
      const r = waiting.get(e.data.id);
      if (!r) return;
      waiting.delete(e.data.id);
      busy[r.w]--;
      r.done(e.data.mesh, e.data.ms);
    };
    w.postMessage({ type: 'init', meta: world.meta, rasters, edits });
    workers.push(w);
    busy.push(0);
  }
  // 起動確認: 1 チャンク作れることを確かめる（module Worker 非対応・読み込み失敗を検出）
  await new Promise((ok, ng) => {
    const timer = setTimeout(() => ng(new Error('Worker の起動がタイムアウト')), 15000);
    for (const w of workers) w.onerror = (e) => { clearTimeout(timer); ng(e.error || new Error(e.message || 'Worker error')); };
    const id = nextId++;
    waiting.set(id, { w: 0, done: () => { clearTimeout(timer); ok(); } });
    busy[0]++;
    workers[0].postMessage({ type: 'build', id, cx: 0, cz: 0 });
  });
  return {
    count: n,
    capacity() { let c = 0; for (const b of busy) c += PER_WORKER - b; return c; },
    request(cx, cz, gen, done) {
      let best = 0;
      for (let i = 1; i < n; i++) if (busy[i] < busy[best]) best = i;
      const id = nextId++;
      busy[best]++;
      waiting.set(id, { w: best, done });
      workers[best].postMessage({ type: 'build', id, cx, cz });
    },
    setEdits(key, entries) { for (const w of workers) w.postMessage({ type: 'edits', key, entries }); },
    clearEdits() { for (const w of workers) w.postMessage({ type: 'clearEdits' }); },
  };
}
