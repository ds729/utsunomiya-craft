// 編集差分の保存（IndexedDB、チャンク単位）。使えない環境（プライベートブラウズ等）では保存しないだけで動く
const DB_NAME = 'utsunomiya-craft';
const STORE = 'chunkEdits';

function req(r) { return new Promise((ok, ng) => { r.onsuccess = () => ok(r.result); r.onerror = () => ng(r.error); }); }

export async function openEditStorage() {
  let db = null;
  try {
    const open = indexedDB.open(DB_NAME, 1);
    open.onupgradeneeded = () => open.result.createObjectStore(STORE);
    db = await req(open);
  } catch (e) {
    console.warn('IndexedDB が使えないため、編集は保存されません', e);
  }
  const tx = (mode) => db.transaction(STORE, mode).objectStore(STORE);
  return {
    available: !!db,
    // [{ key: "cx,cz", entries: [[index, id], ...] }]
    async loadAll() {
      if (!db) return [];
      const s = tx('readonly');
      const [keys, values] = await Promise.all([req(s.getAllKeys()), req(s.getAll())]);
      return keys.map((key, i) => ({ key, entries: values[i] }));
    },
    async save(key, entries) {
      if (!db) return;
      const s = tx('readwrite');
      await req(entries.length ? s.put(entries, key) : s.delete(key));
    },
    async clear() { if (db) await req(tx('readwrite').clear()); },
  };
}
