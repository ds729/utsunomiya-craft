// HTTP Range でリモート zip の目次を読み、必要なエントリだけを取り出す（依存なし）
import zlib from 'node:zlib';

export async function fetchRange(url, start, end, headers = {}) {
  const res = await fetch(url, { headers: { ...headers, Range: `bytes=${start}-${end}` } });
  if (res.status !== 206) throw new Error(`Range 非対応または失敗: HTTP ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

// End of Central Directory（zip64 対応）から目次を読む
export function parseCentralDirectory(buf) {
  const entries = [];
  let p = 0;
  while (p + 46 <= buf.length && buf.readUInt32LE(p) === 0x02014b50) {
    const method = buf.readUInt16LE(p + 10);
    let csize = buf.readUInt32LE(p + 20), usize = buf.readUInt32LE(p + 24);
    const nlen = buf.readUInt16LE(p + 28), xlen = buf.readUInt16LE(p + 30), clen = buf.readUInt16LE(p + 32);
    let offset = buf.readUInt32LE(p + 42);
    const flags = buf.readUInt16LE(p + 8);
    const name = buf.subarray(p + 46, p + 46 + nlen).toString(flags & 0x800 ? 'utf8' : 'latin1');
    // zip64 拡張フィールド
    let x = p + 46 + nlen;
    const xend = x + xlen;
    while (x + 4 <= xend) {
      const id = buf.readUInt16LE(x), sz = buf.readUInt16LE(x + 2);
      if (id === 0x0001) {
        let q = x + 4;
        if (usize === 0xffffffff) { usize = Number(buf.readBigUInt64LE(q)); q += 8; }
        if (csize === 0xffffffff) { csize = Number(buf.readBigUInt64LE(q)); q += 8; }
        if (offset === 0xffffffff) { offset = Number(buf.readBigUInt64LE(q)); q += 8; }
      }
      x += 4 + sz;
    }
    entries.push({ name, method, csize, usize, offset });
    p = xend + clen;
  }
  return entries;
}

export async function listZip(url) {
  const head = await fetch(url, { method: 'HEAD' });
  const size = Number(head.headers.get('content-length'));
  const tailLen = Math.min(size, 65536 + 22);
  const tail = await fetchRange(url, size - tailLen, size - 1);
  const eocd = tail.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  if (eocd < 0) throw new Error('EOCD が見つからない');
  let cdSize = tail.readUInt32LE(eocd + 12), cdOff = tail.readUInt32LE(eocd + 16);
  if (cdOff === 0xffffffff || cdSize === 0xffffffff) {
    const loc = tail.lastIndexOf(Buffer.from([0x50, 0x4b, 0x06, 0x07]));
    const z64off = Number(tail.readBigUInt64LE(loc + 8));
    const z64 = await fetchRange(url, z64off, z64off + 55);
    cdSize = Number(z64.readBigUInt64LE(40));
    cdOff = Number(z64.readBigUInt64LE(48));
  }
  const cd = await fetchRange(url, cdOff, cdOff + cdSize - 1);
  return { size, entries: parseCentralDirectory(cd) };
}

// 1 エントリを取り出して展開する
export async function extractEntry(url, e) {
  const lh = await fetchRange(url, e.offset, e.offset + 29);
  const nlen = lh.readUInt16LE(26), xlen = lh.readUInt16LE(28);
  const start = e.offset + 30 + nlen + xlen;
  const data = await fetchRange(url, start, start + e.csize - 1);
  if (e.method === 0) return data;
  if (e.method === 8) return zlib.inflateRawSync(data);
  throw new Error(`未対応の圧縮方式 ${e.method}: ${e.name}`);
}
