// multipolygon の member way 群を閉じたリングに組み立てる
// 入力: 点列の配列（各点は [x,y] またはキー化可能な値）。向き・順序は不揃いでよい
// 出力: { rings: 閉じたリングの配列, unclosed: 閉じられなかった本数 }

const keyOf = (p) => `${p[0]},${p[1]}`;

export function assembleRings(segments) {
  const pool = segments.filter((s) => s && s.length >= 2).map((s) => s.slice());
  const rings = [];
  let unclosed = 0;
  while (pool.length) {
    let cur = pool.shift();
    let guard = 0;
    while (keyOf(cur[0]) !== keyOf(cur[cur.length - 1]) && guard++ < 100000) {
      const tail = keyOf(cur[cur.length - 1]);
      let found = -1, reverse = false;
      for (let k = 0; k < pool.length; k++) {
        if (keyOf(pool[k][0]) === tail) { found = k; break; }
        if (keyOf(pool[k][pool[k].length - 1]) === tail) { found = k; reverse = true; break; }
      }
      if (found < 0) break;
      const next = pool.splice(found, 1)[0];
      if (reverse) next.reverse();
      cur = cur.concat(next.slice(1));
    }
    if (keyOf(cur[0]) !== keyOf(cur[cur.length - 1])) {
      unclosed++;
      if (cur.length < 3) continue;
      cur.push(cur[0]); // 強制的に閉じる（範囲外で切れた relation 対策）
    }
    rings.push(cur);
  }
  return { rings, unclosed };
}
