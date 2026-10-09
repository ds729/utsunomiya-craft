// エントリポイント: three.js の描画・ループ・UI・デバッグAPI
import * as THREE from 'three';
import { loadWorld, isSolidAt, isWaterAt, blockAt, originalBlockAt, cellIndex, Y_MIN, Y_MAX } from './world-data.js';
import { ChunkManager } from './chunks.js';
import { createAtlasCanvas } from './atlas.js';
import { createPlayer, stepPlayer, collides, PLAYER } from './physics.js';
import { findSpawn } from './spawn.js';
import { headingToYaw, yawToHeading } from './geo.js';
import { Controls } from './player.js';
import { Hud } from './hud.js';
import { EditStore, raycast, affectedChunks, breakAt, placeAt } from './edits.js';
import { openEditStorage } from './storage.js';
import { B, BLOCKS, HOTBAR, UNBREAKABLE } from './blocks.js';
import { Minimap } from './minimap.js';
import { skyAt, hoursAt, formatTime } from './daynight.js';
import { TouchControls, isTouchDevice } from './touch.js';
import { ATLAS_COLS } from './chunk.js';
import { createWorkerMesher } from './mesher.js';
import { TramView } from './tram-view.js';
import { addSigns } from './signs.js';

const params = new URLSearchParams(location.search);
const DEBUG = params.get('debug') === '1';
const VIEW_DIST = Math.max(2, Math.min(16, Number(params.get('view')) || 8));
const START_HOURS = params.has('time') ? Number(params.get('time')) : 10;
const INITIAL_BUDGET_MS = 40; // 初回ロード中は 1 フレームあたり多めに作る
const FRAME_BUDGET_MS = 6;
const REACH = 6; // 壊す・置くの届く距離[m]
const USE_WORKER = params.get('worker') !== '0'; // ?worker=0 で本スレッド生成（比較・不具合切り分け用）
const STEP_SMOOTH = 6; // 段差を自動で上がったときのカメラの追従速度[m/s]

const $ = (id) => document.getElementById(id);
const statusEl = $('status'), progressEl = document.querySelector('#progress div'), overlay = $('overlay'), startBtn = $('start');

async function main() {
  const world = await loadWorld(new URL('./world/', document.baseURI), (f) => { progressEl.style.width = `${f * 30}%`; });
  // 地形が変わると過去の編集の座標が合わなくなるので、world.json の editsVersion が上がったら保存済みの編集を捨てる
  const storage = await openEditStorage(world.meta.editsVersion || 1);
  // 保存済みの編集差分を読む
  world.edits = new EditStore();
  for (const { key, entries } of await storage.loadAll()) {
    const [cx, cz] = key.split(',').map(Number);
    world.edits.load(cx, cz, entries);
  }
  $('license').textContent = world.meta.attribution.map((a) => a.replace(' (ODbL)', '')).join(' ／ ');

  // --- 描画の準備 ---
  const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.outputColorSpace = THREE.LinearSRGBColorSpace; // 頂点カラーの陰影をそのまま出す
  document.body.prepend(renderer.domElement);

  const scene = new THREE.Scene();
  const horizon = new THREE.Color(), zenith = new THREE.Color();
  scene.background = horizon;
  const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
  camera.rotation.order = 'YXZ';

  const atlasCanvas = createAtlasCanvas();
  const atlas = new THREE.CanvasTexture(atlasCanvas);
  atlas.magFilter = THREE.NearestFilter;
  atlas.minFilter = THREE.NearestFilter;
  atlas.generateMipmaps = false;
  atlas.colorSpace = THREE.NoColorSpace;
  // alphaTest: ガラスの透明部分を抜く
  const material = new THREE.MeshBasicMaterial({ map: atlas, vertexColors: true, alphaTest: 0.5 });

  const sky = makeSky();
  scene.add(sky);

  // ライトライン（車体は頂点カラーのみ。昼夜の明るさは地形と同じく色の乗算）
  const tramMaterial = new THREE.MeshBasicMaterial({ vertexColors: true });
  const trams = new TramView(world, scene, tramMaterial);
  let tramClock = 0; // デバッグ用: 運行時刻のずらし[s]
  addSigns(scene, world.meta.signs);

  // チャンク生成は Web Worker で（使えない環境では本スレッドで予算制）
  let mesher = null;
  if (USE_WORKER && typeof Worker !== 'undefined') {
    try { mesher = await createWorkerMesher(world); } catch (e) { console.warn('Web Worker が使えないため本スレッドでチャンクを生成します', e); }
  }
  const chunks = new ChunkManager(world, {
    viewDist: VIEW_DIST,
    mesher,
    makeMesh(m) {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(m.positions, 3));
      g.setAttribute('uv', new THREE.BufferAttribute(m.uvs, 2));
      g.setAttribute('color', new THREE.BufferAttribute(m.colors, 3));
      g.setIndex(new THREE.BufferAttribute(m.indices, 1));
      g.computeBoundingSphere();
      const mesh = new THREE.Mesh(g, material);
      mesh.matrixAutoUpdate = false;
      scene.add(mesh);
      return mesh;
    },
    disposeMesh(mesh) {
      if (!mesh) return;
      scene.remove(mesh);
      mesh.geometry.dispose();
    },
  });

  function applyViewDist() {
    const far = chunks.viewDist * 16;
    scene.fog = new THREE.Fog(horizon, far * 0.45, far * 0.95);
    camera.far = far * 1.2;
    camera.updateProjectionMatrix();
    sky.scale.setScalar(far * 1.1);
  }
  applyViewDist();

  // --- プレイヤー ---
  const solid = (x, y, z) => isSolidAt(world, x, y, z);
  const water = (x, y, z) => isWaterAt(world, x, y, z);
  const target = world.meta.spawnTarget || { x: 0, z: 0 };
  const spawn = findSpawn(world, target.x, target.z) || { x: target.x, y: 1, z: target.z };
  const player = createPlayer(spawn.x, spawn.y, spawn.z);
  const controls = new Controls(renderer.domElement, player);
  controls.yaw = headingToYaw(270); // 東口から駅（西）を向く
  const hud = new Hud(world.meta);
  const minimap = new Minimap(world, $('minimap'));
  let ready = false;
  const stats = { ...chunks.stats, frameMs: 0, fps: 0, loadMs: 0, viewDist: chunks.viewDist, edits: world.edits.size, workers: mesher ? mesher.count : 0 };
  let stepLag = 0; // 段差を上がった直後、カメラを少し遅らせて滑らかに見せる量[m]
  // 性能評価用: 初回ロード後、チャンクを読み込み中のフレームの本スレッド処理時間（テレポートでリセット）
  const stream = { frames: 0, maxMs: 0, sumMs: 0 };

  function teleport(x, z, heading = null, opts = {}) {
    if (opts.y != null) {
      Object.assign(player, { x, z, y: opts.y, vx: 0, vy: 0, vz: 0, flying: true });
    } else {
      const k = cellIndex(world, Math.floor(x), Math.floor(z));
      const s = findSpawn(world, x, z, 100) || { x, y: (k >= 0 ? world.elev[k] : 0) + 1, z };
      Object.assign(player, { x: s.x, y: s.y, z: s.z, vx: 0, vy: 0, vz: 0, flying: false });
    }
    stepLag = 0; player.stepped = 0;
    Object.assign(stream, { frames: 0, maxMs: 0, sumMs: 0 });
    if (heading != null) controls.yaw = headingToYaw(heading);
    if (opts.pitch != null) controls.pitch = (opts.pitch * Math.PI) / 180;
    stats.pending = chunks.update(player.x, player.z, 0); // 待ちチャンク数をすぐ更新
    return { x: player.x, y: player.y, z: player.z };
  }

  // --- ブロック編集 ---
  let slot = 0;
  const hotbarEl = $('hotbar');
  HOTBAR.forEach((h, i) => {
    const d = document.createElement('div');
    d.innerHTML = `<span>${i + 1}</span>`;
    d.style.backgroundImage = `url(${tileDataURL(atlasCanvas, h.id === B.GRASS ? BLOCKS[h.id].side : BLOCKS[h.id].top)})`;
    d.title = h.name;
    d.addEventListener('click', () => selectSlot(i));
    hotbarEl.appendChild(d);
  });
  function selectSlot(i) {
    slot = (i + HOTBAR.length) % HOTBAR.length;
    [...hotbarEl.children].forEach((c, k) => c.classList.toggle('sel', k === slot));
    $('blockname').textContent = HOTBAR[slot].name;
  }
  selectSlot(0);

  const highlight = new THREE.LineSegments(
    new THREE.EdgesGeometry(new THREE.BoxGeometry(1.004, 1.004, 1.004)),
    new THREE.LineBasicMaterial({ color: 0x111111, fog: false }),
  );
  highlight.visible = false;
  scene.add(highlight);

  const isTarget = (x, y, z) => { const id = blockAt(world, x, y, z); return id !== B.AIR && id !== B.WATER; };
  function currentHit() {
    const eye = [player.x, player.y + PLAYER.EYE, player.z];
    const cp = Math.cos(controls.pitch);
    const dir = [-Math.sin(controls.yaw) * cp, Math.sin(controls.pitch), -Math.cos(controls.yaw) * cp];
    return raycast(eye, dir, REACH, isTarget);
  }
  const saveTimers = new Map();
  // まとめ書き待ちの保存を今すぐ書く（ページを離れるとき・隠れるとき）
  const flushSaves = () => {
    for (const [key, t] of saveTimers) {
      clearTimeout(t);
      const [cx, cz] = key.split(',').map(Number);
      storage.save(key, world.edits.serialize(cx, cz));
    }
    saveTimers.clear();
  };
  addEventListener('pagehide', flushSaves);
  document.addEventListener('visibilitychange', () => { if (document.hidden) flushSaves(); });
  function afterEdit(pos) {
    if (!pos) return false;
    const cx = Math.floor(pos[0] / 16), cz = Math.floor(pos[2] / 16), key = `${cx},${cz}`;
    mesher?.setEdits(key, world.edits.serialize(cx, cz)); // 作り直しの依頼より先に Worker の差分を更新
    for (const [ax, az] of affectedChunks(pos[0], pos[2])) chunks.rebuild(ax, az);
    // チャンク単位で少し待ってまとめて保存
    clearTimeout(saveTimers.get(key));
    saveTimers.set(key, setTimeout(() => { saveTimers.delete(key); storage.save(key, world.edits.serialize(cx, cz)); }, 300));
    return true;
  }
  const editDeps = {
    blockAt, baseAt: originalBlockAt, cellIndex, yMin: Y_MIN, yMax: Y_MAX, unbreakable: UNBREAKABLE,
    isReplaceable: (id) => id === B.AIR || id === B.WATER,
    overlapsPlayer: (x, y, z) => collides(player.x, player.y, player.z, (a, b, c) => a === x && b === y && c === z),
  };
  function act(kind) {
    const hit = currentHit();
    return afterEdit(kind === 'break' ? breakAt(world, hit, editDeps) : placeAt(world, hit, HOTBAR[slot].id, editDeps));
  }
  controls.onAction = (kind) => kind && act(kind);
  controls.onWheel = (d) => selectSlot(slot + d);

  controls.onKey = (code) => {
    if (code === 'BracketLeft' || code === 'BracketRight') {
      chunks.setViewDist(chunks.viewDist + (code === 'BracketRight' ? 1 : -1));
      applyViewDist();
    } else if (code.startsWith('Digit') && code !== 'Digit0') selectSlot(Number(code.slice(5)) - 1);
    else if (code === 'KeyM') minimap.toggle();
    else if (code === 'KeyT') controls.setActive(false); // 一時停止メニュー（テレポート一覧）
  };

  // --- 一時停止メニュー（開始・テレポート・編集リセット）---
  const touch = isTouchDevice() ? new TouchControls(document.body, controls, { onBreak: () => act('break'), onPlace: () => act('place') }) : null;
  const resume = () => controls.start({ lock: !touch });
  for (const t of world.meta.teleports || []) {
    const b = document.createElement('button');
    b.textContent = t.label;
    b.addEventListener('click', () => { teleport(t.x, t.z); resume(); });
    $('tp-list').appendChild(b);
  }
  startBtn.addEventListener('click', () => { if (ready) resume(); });
  $('btn-menu').addEventListener('click', () => controls.setActive(false));
  $('minimap').addEventListener('click', () => minimap.toggle()); // タッチではミニマップのタップで全体地図
  const updateEditCount = () => { $('edit-count').textContent = `編集 ${world.edits.size} ブロック${storage.available ? '' : '（この環境では保存されません）'}`; };
  $('reset-edits').addEventListener('click', async () => {
    if (!confirm('ブロックの編集をすべて元に戻します。よろしいですか？')) return;
    const keys = [...world.edits.chunks.keys()];
    world.edits.clear();
    mesher?.clearEdits();
    await storage.clear();
    for (const k of keys) {
      const [cx, cz] = k.split(',').map(Number);
      for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) chunks.rebuild(cx + dx, cz + dz);
    }
    updateEditCount();
  });
  controls.onActiveChange = (active) => {
    overlay.classList.toggle('hidden', active);
    if (!active) updateEditCount();
  };

  // --- デバッグ API ---
  let timeOffset = 0;
  if (DEBUG) {
    window.__ready = false;
    window.__stats = stats;
    // yaw は方位[度]（北=0、東=90）。opts: { y: 足元の高さ（指定するとフライで空中に置く）, pitch: 度 }
    window.__teleport = (x, z, yaw = 0, opts = {}) => teleport(x, z, yaw, { pitch: opts.pitch || 0, y: opts.y ?? undefined });
    window.__player = player;
    window.__act = (kind, s) => { if (s != null) selectSlot(s); return act(kind); };
    window.__setTime = (h) => { timeOffset = h - hoursAt(performance.now() / 1000, START_HOURS); };
    window.__toggleMap = () => minimap.toggle();
    window.__pause = () => { controls.setActive(false); overlay.classList.remove('hidden'); updateEditCount(); };
    window.__tramTime = (t) => { tramClock = t - performance.now() / 1000; }; // 運行時刻を t 秒にする
    window.__flushSaves = () => Promise.all([...world.edits.chunks.keys()].map((k) => {
      const [cx, cz] = k.split(',').map(Number);
      return storage.save(k, world.edits.serialize(cx, cz));
    }));
  }

  // --- ループ ---
  let last = performance.now(), fpsFrames = 0, fpsTime = last, fps = 0, skyTime = -1;
  function frame(now) {
    requestAnimationFrame(frame);
    const dt = Math.min((now - last) / 1000, 0.1);
    last = now;
    const cpu0 = performance.now();

    const pending = chunks.update(player.x, player.z, ready ? FRAME_BUDGET_MS : INITIAL_BUDGET_MS);
    if (!ready) {
      const total = chunks.stats.chunks + pending;
      progressEl.style.width = `${30 + (70 * chunks.stats.chunks) / Math.max(1, total)}%`;
      statusEl.textContent = `ワールド生成中… ${chunks.stats.chunks}/${total}`;
      if (pending === 0) {
        ready = true;
        stats.loadMs = Math.round(performance.now()); // ナビゲーション開始からの時間
        statusEl.textContent = '';
        progressEl.parentElement.style.display = 'none';
        startBtn.disabled = false;
        startBtn.textContent = 'クリックで開始';
        overlay.classList.add('ready');
        updateEditCount();
        if (DEBUG) { window.__ready = true; overlay.classList.add('hidden'); }
      }
    }

    let input = controls.active ? controls.input() : { yaw: controls.yaw };
    if (touch && controls.active) input = touch.apply(input);
    // 初回生成が終わるまでは物理を止める（足場ができる前に落ちない）
    if (ready) stepPlayer(player, input, dt, solid, water);
    stepLag = Math.max(0, Math.min(1.5, stepLag + player.stepped) - STEP_SMOOTH * dt);
    player.stepped = 0;
    // ダッシュ中は視野角を少し広げて速さを感じやすくする
    const fov = input.sprint && input.forward > 0 && !player.inWater ? 84 : 75;
    if (Math.abs(camera.fov - fov) > 0.05) { camera.fov += (fov - camera.fov) * Math.min(1, dt * 10); camera.updateProjectionMatrix(); }

    camera.position.set(player.x, player.y + PLAYER.EYE - stepLag, player.z);
    camera.rotation.set(controls.pitch, controls.yaw, 0);
    sky.position.copy(camera.position);

    // 昼夜（空・フォグ・明るさ）。0.25 秒ごとに更新
    const hours = (hoursAt(now / 1000, START_HOURS) + timeOffset + 48) % 24;
    if (now - skyTime > 250) {
      skyTime = now;
      const s = skyAt(hours);
      horizon.setRGB(...s.horizon);
      scene.fog.color.copy(horizon); // Fog は色をコピーして持つので毎回反映する
      zenith.setRGB(...s.top);
      paintSky(sky, zenith, horizon);
      material.color.setScalar(s.light);
      tramMaterial.color.setScalar(s.light);
      stats.hours = hours;
    }

    trams.update(now / 1000 + tramClock);
    stats.trams = trams.positions;

    // 狙っているブロックの枠
    const hit = ready && (controls.active || DEBUG) ? currentHit() : null;
    highlight.visible = !!hit;
    if (hit) highlight.position.set(hit.x + 0.5, hit.y + 0.5, hit.z + 0.5);

    renderer.render(scene, camera);

    fpsFrames++;
    if (now - fpsTime > 500) { fps = Math.round((fpsFrames * 1000) / (now - fpsTime)); fpsFrames = 0; fpsTime = now; }
    const cpuMs = performance.now() - cpu0;
    if (ready && pending > 0) { stream.frames++; stream.sumMs += cpuMs; stream.maxMs = Math.max(stream.maxMs, cpuMs); }
    stats.stream = { frames: stream.frames, maxMs: +stream.maxMs.toFixed(2), avgMs: +(stream.sumMs / Math.max(1, stream.frames)).toFixed(2) };
    stats.frameMs = stats.frameMs ? stats.frameMs * 0.9 + cpuMs * 0.1 : cpuMs;
    Object.assign(stats, chunks.stats, { fps, playerY: player.y, viewDist: chunks.viewDist, drawCalls: renderer.info.render.calls, edits: world.edits.size, slot });
    hud.update(player, controls.yaw, fps, DEBUG ? `chunks ${stats.chunks} (待ち ${stats.pending}) 頂点 ${stats.vertices} 生成 ${stats.avgChunkMs.toFixed(1)}ms/chunk 転送 ${stats.uploadMs.toFixed(1)}ms ${mesher ? `Worker×${mesher.count}` : '本スレッド'}` : '', now);
    $('clock').textContent = formatTime(hours);
    minimap.draw(player, yawToHeading(controls.yaw), world.meta.teleports);
  }
  requestAnimationFrame(frame);

  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
    minimap.layout();
  });
}

// アトラスの 1 タイルを data URL に（ホットバーのアイコン）
function tileDataURL(atlas, tile) {
  const c = document.createElement('canvas');
  c.width = c.height = 16;
  c.getContext('2d').drawImage(atlas, (tile % ATLAS_COLS) * 16, Math.floor(tile / ATLAS_COLS) * 16, 16, 16, 0, 0, 16, 16);
  return c.toDataURL();
}

// グラデーションの空（カメラに追従する球）。色は paintSky で更新
function makeSky() {
  const g = new THREE.SphereGeometry(1, 24, 12);
  g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 3), 3));
  const m = new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, fog: false, depthWrite: false });
  const sky = new THREE.Mesh(g, m);
  sky.renderOrder = -1;
  sky.frustumCulled = false;
  return sky;
}
const tmpColor = new THREE.Color();
function paintSky(sky, zenith, horizon) {
  const pos = sky.geometry.attributes.position, col = sky.geometry.attributes.color;
  for (let i = 0; i < pos.count; i++) {
    const t = Math.max(0, pos.getY(i)); // 地平線(0)→天頂(1)
    tmpColor.copy(horizon).lerp(zenith, Math.pow(t, 0.6));
    col.setXYZ(i, tmpColor.r, tmpColor.g, tmpColor.b);
  }
  col.needsUpdate = true;
}

main().catch((e) => {
  console.error(e);
  statusEl.innerHTML = `<span id="error">読み込みに失敗しました: ${e.message}</span>`;
  if (DEBUG) window.__error = String((e && e.stack) || e);
});
