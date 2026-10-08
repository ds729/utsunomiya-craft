// エントリポイント: three.js の描画・ループ・デバッグAPI
import * as THREE from 'three';
import { loadWorld, isSolidAt, isWaterAt } from './world-data.js';
import { ChunkManager } from './chunks.js';
import { createAtlasCanvas } from './atlas.js';
import { createPlayer, stepPlayer, PLAYER } from './physics.js';
import { findSpawn } from './spawn.js';
import { headingToYaw } from './geo.js';
import { Controls } from './player.js';
import { Hud } from './hud.js';

const params = new URLSearchParams(location.search);
const DEBUG = params.get('debug') === '1';
const VIEW_DIST = Math.max(2, Math.min(16, Number(params.get('view')) || 8));
const INITIAL_BUDGET_MS = 40; // 初回ロード中は 1 フレームあたり多めに作る
const FRAME_BUDGET_MS = 6;

const statusEl = document.getElementById('status');
const progressEl = document.querySelector('#progress div');
const overlay = document.getElementById('overlay');

async function main() {
  const world = await loadWorld(new URL('./world/', document.baseURI), (f) => { progressEl.style.width = `${f * 30}%`; });

  // --- 描画の準備 ---
  const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.outputColorSpace = THREE.LinearSRGBColorSpace; // 頂点カラーの陰影をそのまま出す
  document.body.prepend(renderer.domElement);

  const SKY_TOP = new THREE.Color(0.36, 0.58, 0.88), SKY_HORIZON = new THREE.Color(0.74, 0.85, 0.95);
  const scene = new THREE.Scene();
  scene.background = SKY_HORIZON;
  const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
  camera.rotation.order = 'YXZ';

  const atlas = new THREE.CanvasTexture(createAtlasCanvas());
  atlas.magFilter = THREE.NearestFilter;
  atlas.minFilter = THREE.NearestFilter;
  atlas.generateMipmaps = false;
  atlas.colorSpace = THREE.NoColorSpace;
  const material = new THREE.MeshBasicMaterial({ map: atlas, vertexColors: true });

  // グラデーションの空（カメラに追従する球）
  const sky = makeSky(SKY_TOP, SKY_HORIZON);
  scene.add(sky);

  const chunks = new ChunkManager(world, {
    viewDist: VIEW_DIST,
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
    scene.fog = new THREE.Fog(SKY_HORIZON, far * 0.45, far * 0.95);
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
  controls.onKey = (code) => {
    if (code === 'BracketLeft' || code === 'BracketRight') {
      chunks.setViewDist(chunks.viewDist + (code === 'BracketRight' ? 1 : -1));
      applyViewDist();
    }
  };
  const hud = new Hud(world.meta);

  // --- 初回チャンク生成（進捗表示）---
  let ready = false;
  const stats = { ...chunks.stats, frameMs: 0, fps: 0, loadMs: 0, viewDist: chunks.viewDist };
  overlay.addEventListener('click', () => { if (ready) controls.start(); });
  controls.onActiveChange = (active) => overlay.classList.toggle('hidden', active || DEBUG);

  // --- デバッグ API ---
  if (DEBUG) {
    window.__ready = false;
    window.__stats = stats;
    // yaw は方位[度]（北=0、東=90）。opts: { y: 足元の高さ（指定するとフライで空中に置く）, pitch: 度 }
    window.__teleport = (x, z, yaw = 0, opts = {}) => {
      if (opts.y != null) {
        Object.assign(player, { x, z, y: opts.y, vx: 0, vy: 0, vz: 0, flying: true });
      } else {
        const s = findSpawn(world, x, z, 100) || { x, y: 1, z };
        Object.assign(player, { x: s.x, y: s.y, z: s.z, vx: 0, vy: 0, vz: 0, flying: false });
      }
      controls.yaw = headingToYaw(yaw);
      controls.pitch = ((opts.pitch || 0) * Math.PI) / 180;
      // 待ちチャンク数をすぐ更新する（撮影側が古い pending=0 を見て先に進まないように）
      stats.pending = chunks.update(player.x, player.z, 0);
      return { x: player.x, y: player.y, z: player.z };
    };
    window.__player = player;
  }

  // --- ループ ---
  let last = performance.now(), fpsFrames = 0, fpsTime = last, fps = 0;
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
        statusEl.textContent = 'クリックで開始';
        progressEl.parentElement.style.display = 'none';
        if (DEBUG) { window.__ready = true; overlay.classList.add('hidden'); }
      }
    }

    // 初回生成が終わるまでは物理を止める（足場ができる前に落ちない）
    const input = controls.active ? controls.input() : { yaw: controls.yaw };
    if (ready) stepPlayer(player, input, dt, solid, water);
    // ダッシュ中は視野角を少し広げて速さを感じやすくする
    const fov = input.sprint && input.forward > 0 && !player.inWater ? 84 : 75;
    if (Math.abs(camera.fov - fov) > 0.05) { camera.fov += (fov - camera.fov) * Math.min(1, dt * 10); camera.updateProjectionMatrix(); }

    camera.position.set(player.x, player.y + PLAYER.EYE, player.z);
    camera.rotation.set(controls.pitch, controls.yaw, 0);
    sky.position.copy(camera.position);
    renderer.render(scene, camera);

    fpsFrames++;
    if (now - fpsTime > 500) { fps = Math.round((fpsFrames * 1000) / (now - fpsTime)); fpsFrames = 0; fpsTime = now; }
    const cpuMs = performance.now() - cpu0;
    stats.frameMs = stats.frameMs ? stats.frameMs * 0.9 + cpuMs * 0.1 : cpuMs;
    Object.assign(stats, chunks.stats, { fps, viewDist: chunks.viewDist, drawCalls: renderer.info.render.calls });
    hud.update(player, controls.yaw, fps, DEBUG ? `chunks ${stats.chunks} (待ち ${stats.pending}) 頂点 ${stats.vertices} 生成 ${stats.avgChunkMs.toFixed(1)}ms/chunk` : '', now);
  }
  requestAnimationFrame(frame);

  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });
}

function makeSky(top, horizon) {
  const g = new THREE.SphereGeometry(1, 24, 12);
  const pos = g.attributes.position;
  const colors = new Float32Array(pos.count * 3);
  const c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const t = Math.max(0, pos.getY(i)); // 地平線(0)→天頂(1)
    c.copy(horizon).lerp(top, Math.pow(t, 0.6));
    c.toArray(colors, i * 3);
  }
  g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  const m = new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, fog: false, depthWrite: false });
  const sky = new THREE.Mesh(g, m);
  sky.renderOrder = -1;
  sky.frustumCulled = false;
  return sky;
}

main().catch((e) => {
  console.error(e);
  statusEl.innerHTML = `<span id="error">読み込みに失敗しました: ${e.message}</span>`;
  if (DEBUG) window.__error = String(e && e.stack || e);
});
