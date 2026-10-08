// ミニマップ（Canvas 2D）。ラスタから 1px=1m の地図を一度だけ作り、表示時は切り出して描く
// 通常: 右上に周囲 120m（北が上）。M キーで全体表示（テレポート先も表示）
const GROUND_RGB = [
  [150, 190, 110], [170, 140, 100], [80, 80, 86], [196, 190, 180], [130, 110, 95], [70, 130, 210], [100, 170, 85],
  [225, 205, 160], [130, 130, 146], [240, 240, 230], [255, 150, 30], [180, 180, 170], [200, 200, 120], [60, 120, 65], [70, 50, 40],
];

export function renderMapImage(w) {
  const img = new ImageData(w.W, w.H);
  const d = img.data;
  for (let k = 0; k < w.W * w.H; k++) {
    let c;
    if (w.bld[k]) {
      const f = 1 - Math.min(w.bld[k], 60) / 110; // 高い建物ほど濃く
      c = [205 * f, 175 * f, 160 * f];
    } else c = GROUND_RGB[w.ground[k]] || GROUND_RGB[0];
    if (w.deck[k] && !w.bld[k]) c = c.map((v) => v * 0.8 + 40);
    d[k * 4] = c[0]; d[k * 4 + 1] = c[1]; d[k * 4 + 2] = c[2]; d[k * 4 + 3] = 255;
  }
  const canvas = document.createElement('canvas');
  canvas.width = w.W; canvas.height = w.H;
  canvas.getContext('2d').putImageData(img, 0, 0);
  return canvas;
}

export class Minimap {
  constructor(world, el) {
    this.w = world;
    this.el = el;
    this.ctx = el.getContext('2d');
    this.src = renderMapImage(world);
    this.large = false;
    this.layout();
  }

  toggle() { this.large = !this.large; this.layout(); }

  layout() {
    const size = this.large ? Math.min(window.innerWidth, window.innerHeight) - 80 : window.innerWidth < 600 ? 120 : 170;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.el.width = Math.round(size * dpr);
    this.el.height = Math.round(size * dpr);
    this.el.style.width = this.el.style.height = `${size}px`;
    this.el.classList.toggle('large', this.large);
  }

  // 地図上の位置（ローカル m → キャンバス px）
  draw(p, heading, teleports) {
    const { ctx, el, w } = this;
    const S = el.width;
    ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = '#223';
    ctx.fillRect(0, 0, S, S);
    let x0, z0, span;
    if (this.large) { span = Math.max(w.W, w.H); x0 = -w.west; z0 = -w.north; }
    else { span = 240; x0 = p.x - span / 2; z0 = p.z - span / 2; }
    const k = S / span;
    ctx.drawImage(this.src, x0 + w.west, z0 + w.north, span, span, 0, 0, S, S);
    const toPx = (x, z) => [(x - x0) * k, (z - z0) * k];
    if (this.large && teleports) {
      ctx.font = `${Math.round(11 * S / el.clientWidth)}px system-ui, sans-serif`;
      for (const t of teleports) {
        const [px, py] = toPx(t.x, t.z);
        ctx.fillStyle = '#ffd34d';
        ctx.beginPath(); ctx.arc(px, py, 3 * S / el.clientWidth, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#fff';
        ctx.fillText(t.label, px + 5, py - 4);
      }
    }
    // プレイヤー（向きつきの三角形）
    const [px, py] = toPx(p.x, p.z);
    const r = (this.large ? 9 : 7) * S / el.clientWidth;
    const a = (heading * Math.PI) / 180;
    ctx.save();
    ctx.translate(px, py);
    ctx.rotate(a);
    ctx.fillStyle = '#e33';
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 1.5 * S / el.clientWidth;
    ctx.beginPath(); ctx.moveTo(0, -r); ctx.lineTo(r * 0.7, r * 0.8); ctx.lineTo(-r * 0.7, r * 0.8); ctx.closePath();
    ctx.fill(); ctx.stroke();
    ctx.restore();
    // 北の目印
    ctx.fillStyle = '#fff';
    ctx.font = `bold ${Math.round(12 * S / el.clientWidth)}px system-ui, sans-serif`;
    ctx.fillText('N', S / 2 - 4 * S / el.clientWidth, 14 * S / el.clientWidth);
  }
}
