// ヘッドレス Chromium（SwiftShader）でページを開き、指定地点のスクリーンショットを撮る
// 使い方: node tools/e2e/shot.mjs <name> [--x=0 --z=0 --yaw=0 --y=高さ(空中) --pitch=0 --view=8 --w=1280 --h=720 --base=/sub/path/]
//   yaw は方位[度]（北=0、東=90）。x,z 省略時はスポーン地点
//   --url=http://localhost:8000/ を付けると内蔵サーバではなく既存のサーバ（python3 -m http.server 等）を開く
//   --base を付けると public の親ディレクトリを配信し、サブパス（GitHub Pages 相当）で開く
//   Phase 2 の確認用: --time=20（時刻）--map（全体地図）--pause（一時停止メニュー）--touch（スマホ相当の画面・タッチ）
//   Phase 3: --tram=秒（ライトラインの運行時刻。同じ時刻なら同じ位置）--worker=0（チャンク生成を本スレッドで。性能比較用）
//   --act=break,place:6,...（狙っているブロックを壊す/ホットバー番号のブロックを置く）--reload（撮影前に再読み込みして保存を確認）
// 出力: tools/e2e/shots/<name>.png と、標準出力に window.__stats の JSON
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../..');
const [name = 'shot', ...rest] = process.argv.slice(2);
const args = Object.fromEntries(rest.map((a) => { const [k, ...v] = a.replace(/^--/, '').split('='); return [k, v.length ? v.join('=') : true]; }));

// --- 静的サーバ（public/ もしくはサブパス確認用にリポジトリ直下を配信）---
const sub = args.base ? `/${args.base.replace(/^\/|\/$/g, '')}/` : '/';
const serveDir = args.base ? root : path.join(root, 'public');
const urlPrefix = args.base ? `${sub}` : '/';
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.gz': 'application/gzip', '.png': 'image/png' };
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (args.base) {
    // /<base>/... → public/...
    if (!p.startsWith(sub)) { res.writeHead(404); return res.end(); }
    p = '/public/' + p.slice(sub.length);
  }
  if (p.endsWith('/')) p += 'index.html';
  const file = path.join(serveDir, p);
  if (!file.startsWith(serveDir) || !fs.existsSync(file)) { res.writeHead(404); return res.end('not found'); }
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const port = server.address().port;

const W = +(args.w || 1280), H = +(args.h || 720);
const browser = await chromium.launch({
  headless: true,
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
const page = await browser.newPage(args.touch
  ? { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 }
  : { viewport: { width: W, height: H } });
const logs = [];
page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`));
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
const requested = [];
page.on('request', (r) => requested.push(new URL(r.url()).pathname));

const query = `?debug=1${args.view ? `&view=${args.view}` : ''}${args.worker != null ? `&worker=${args.worker}` : ''}`;
const url = args.url ? `${args.url}${query}` : `http://127.0.0.1:${port}${urlPrefix}${query}`;
const tLoad = Date.now();
let out = {};
try {
  await page.goto(url);
  await page.waitForFunction(() => window.__ready === true || window.__error, null, { timeout: 180000 });
  const err = await page.evaluate(() => window.__error);
  if (err) throw new Error(err);
  const readyWallMs = Date.now() - tLoad;
  if (args.x != null || args.z != null || args.y != null) {
    const pos = await page.evaluate(([x, z, yaw, y, pitch]) => window.__teleport(x, z, yaw, { y, pitch }),
      [+(args.x ?? 0), +(args.z ?? 0), +(args.yaw ?? 0), args.y != null ? +args.y : null, +(args.pitch ?? 0)]);
    out.teleport = pos;
  } else if (args.yaw != null || args.pitch != null) {
    await page.evaluate(([yaw, pitch]) => { const p = window.__player; window.__teleport(p.x, p.z, yaw, { y: p.y, pitch }); window.__player.flying = false; }, [+(args.yaw ?? 270), +(args.pitch ?? 0)]);
  }
  // 移動先のチャンクが揃うまで待つ
  await page.waitForFunction(() => window.__stats.pending === 0, null, { timeout: 180000 });
  if (args.act) {
    out.acts = [];
    for (const a of args.act.split(',')) {
      const [kind, s] = a.split(':');
      out.acts.push(await page.evaluate(([k, sl]) => window.__act(k, sl), [kind, s != null ? +s - 1 : null]));
    }
    await page.evaluate(() => window.__flushSaves());
  }
  if (args.reload) {
    const pos = await page.evaluate(() => ({ x: window.__player.x, y: window.__player.y, z: window.__player.z }));
    await page.reload();
    await page.waitForFunction(() => window.__ready === true || window.__error, null, { timeout: 180000 });
    // 方位の既定: x,z 指定なし（スポーン）なら再読み込み前と同じ 270（駅の方）
    const yaw0 = args.yaw ?? (args.x == null && args.z == null ? 270 : 0);
    await page.evaluate(([p, yaw, pitch]) => window.__teleport(p.x, p.z, yaw, { y: p.y, pitch }), [pos, +yaw0, +(args.pitch ?? 0)]);
    await page.evaluate(() => { window.__player.flying = false; });
    await page.waitForFunction(() => window.__stats.pending === 0, null, { timeout: 180000 });
    out.reloaded = true;
  }
  if (args.time != null) await page.evaluate((h) => window.__setTime(h), +args.time);
  if (args.tram != null) await page.evaluate((t) => window.__tramTime(t), +args.tram);
  if (args.map) await page.evaluate(() => window.__toggleMap());
  if (args.pause) await page.evaluate(() => window.__pause());
  await page.waitForTimeout(500);
  fs.mkdirSync(path.join(here, 'shots'), { recursive: true });
  const file = path.join(here, 'shots', `${name}.png`);
  await page.screenshot({ path: file });
  const stats = await page.evaluate(() => ({ ...window.__stats,
    resources: performance.getEntriesByType('resource').map((r) => `${r.name.split('/').pop()} ${Math.round(r.startTime)}→${Math.round(r.responseEnd)}ms ${r.encodedBodySize}B`), player: { x: window.__player.x, y: window.__player.y, z: window.__player.z } }));
  out = { file: path.relative(root, file), url, readyWallMs, ...out, stats };
} catch (e) {
  out.error = String(e.message || e);
}
out.absolutePaths = requested.filter((p) => args.base && !p.startsWith(sub));
out.logs = logs.filter((l) => !/GPU stall|Automatic fallback to software WebGL/.test(l)).slice(0, 20);
console.log(JSON.stringify(out, null, 1));
await browser.close();
server.close();
if (out.error) process.exit(1);
