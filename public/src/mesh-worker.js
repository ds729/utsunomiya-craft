// チャンク生成（ラスタ → ボクセル → 面カリング付きメッシュ）を行う Web Worker
// 本スレッドとは同じ純関数（chunk.js）を使い、ワールドのラスタと編集差分の写しを持つ
import { makeWorld } from './world-data.js';
import { generatePadded, meshChunk } from './chunk.js';
import { EditStore } from './edits.js';

let world = null;

self.onmessage = (e) => {
  const m = e.data;
  if (m.type === 'init') {
    world = makeWorld(m.meta, m.rasters, new EditStore());
    for (const [key, entries] of m.edits) setChunk(key, entries);
  } else if (m.type === 'edits') {
    setChunk(m.key, m.entries); // チャンク単位で丸ごと置き換える（消した差分も反映される）
  } else if (m.type === 'clearEdits') {
    world.edits.clear();
  } else if (m.type === 'build') {
    const t = performance.now();
    const mesh = meshChunk(generatePadded(world, m.cx, m.cz));
    const ms = performance.now() - t;
    self.postMessage({ type: 'mesh', id: m.id, mesh, ms },
      [mesh.positions.buffer, mesh.uvs.buffer, mesh.colors.buffer, mesh.indices.buffer]);
  }
};

function setChunk(key, entries) {
  const [cx, cz] = key.split(',').map(Number);
  world.edits.chunks.delete(key);
  world.edits.load(cx, cz, entries);
}
