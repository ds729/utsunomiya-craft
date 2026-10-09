// 駅名板の文字（three.js）。world.json の signs（tools/lib/decor.mjs が置いた板の位置）に、Canvas で描いた文字の面を重ねる
// 板は照明付きの想定で、昼夜の明るさを掛けない
import * as THREE from 'three';

const PX_PER_M = 64;

function signTexture(s) {
  const c = document.createElement('canvas');
  c.width = Math.round(s.w * PX_PER_M);
  c.height = Math.round(s.h * PX_PER_M);
  const g = c.getContext('2d');
  g.fillStyle = '#1c346e';
  g.fillRect(0, 0, c.width, c.height);
  g.strokeStyle = 'rgba(255,255,255,0.35)';
  g.lineWidth = 6;
  g.strokeRect(10, 10, c.width - 20, c.height - 20);
  g.fillStyle = '#fff';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  const font = '"Hiragino Sans", "Noto Sans JP", "Yu Gothic", system-ui, sans-serif';
  g.font = `700 ${Math.round(c.height * 0.5)}px ${font}`;
  g.fillText(s.text, c.width / 2, c.height * 0.42, c.width * 0.9);
  g.font = `600 ${Math.round(c.height * 0.16)}px ${font}`;
  g.fillText(s.sub || '', c.width / 2, c.height * 0.8, c.width * 0.9);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.NoColorSpace; // 地形と同じく色をそのまま出す
  t.anisotropy = 4;
  return t;
}

export function addSigns(scene, signs = []) {
  const out = [];
  for (const s of signs) {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(s.w - 0.2, s.h - 0.2), new THREE.MeshBasicMaterial({ map: signTexture(s) }));
    m.position.set(s.x, s.y, s.z);
    m.rotation.y = s.facing === 'east' ? Math.PI / 2 : s.facing === 'west' ? -Math.PI / 2 : s.facing === 'south' ? 0 : Math.PI;
    scene.add(m);
    out.push(m);
  }
  return out;
}
