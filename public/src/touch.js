// タッチ操作: 左=仮想ジョイスティック、右=視点ドラッグ、ボタン（ジャンプ・壊す・置く）
import { pressJump } from './physics.js';

// 主な入力がタッチの端末だけ（タッチ画面つきノートPC ではマウス操作のまま）
export const isTouchDevice = () => matchMedia('(pointer: coarse)').matches;

export class TouchControls {
  constructor(root, controls, { onBreak, onPlace }) {
    this.controls = controls;
    this.move = { x: 0, y: 0 };
    this.jump = false;
    this.down = false;
    root.classList.add('touch');
    const stick = root.querySelector('#stick'), knob = stick.querySelector('div');
    let stickId = null, lookId = null, cx = 0, cy = 0, lx = 0, ly = 0;
    const R = 50;

    stick.addEventListener('pointerdown', (e) => {
      stickId = e.pointerId; stick.setPointerCapture(e.pointerId);
      const r = stick.getBoundingClientRect(); cx = r.left + r.width / 2; cy = r.top + r.height / 2;
      this.onStick(e.clientX - cx, e.clientY - cy, knob, R);
    });
    stick.addEventListener('pointermove', (e) => { if (e.pointerId === stickId) this.onStick(e.clientX - cx, e.clientY - cy, knob, R); });
    const endStick = (e) => { if (e.pointerId === stickId) { stickId = null; this.onStick(0, 0, knob, R); } };
    stick.addEventListener('pointerup', endStick);
    stick.addEventListener('pointercancel', endStick);

    // 右半分のドラッグで視点
    const look = root.querySelector('#look');
    look.addEventListener('pointerdown', (e) => { lookId = e.pointerId; lx = e.clientX; ly = e.clientY; look.setPointerCapture(e.pointerId); });
    look.addEventListener('pointermove', (e) => {
      if (e.pointerId !== lookId) return;
      controls.yaw -= (e.clientX - lx) * 0.005;
      controls.pitch = Math.max(-1.55, Math.min(1.55, controls.pitch - (e.clientY - ly) * 0.005));
      lx = e.clientX; ly = e.clientY;
    });
    const endLook = (e) => { if (e.pointerId === lookId) lookId = null; };
    look.addEventListener('pointerup', endLook);
    look.addEventListener('pointercancel', endLook);

    const btn = (id, down, up) => {
      const b = root.querySelector(id);
      b.addEventListener('pointerdown', (e) => { e.preventDefault(); b.classList.add('on'); down(); });
      const off = () => { b.classList.remove('on'); up?.(); };
      b.addEventListener('pointerup', off);
      b.addEventListener('pointercancel', off);
      b.addEventListener('pointerleave', off);
    };
    // ジャンプボタンの 2 連打でフライ（キーボードの Space と同じ）
    btn('#btn-jump', () => { this.jump = true; pressJump(controls.player, performance.now() / 1000); }, () => { this.jump = false; });
    btn('#btn-down', () => { this.down = true; }, () => { this.down = false; });
    btn('#btn-break', onBreak);
    btn('#btn-place', onPlace);
  }

  onStick(dx, dy, knob, R) {
    const len = Math.hypot(dx, dy);
    if (len > R) { dx *= R / len; dy *= R / len; }
    knob.style.transform = `translate(${dx}px, ${dy}px)`;
    this.move = { x: dx / R, y: dy / R };
  }

  // キーボード入力に重ねる
  apply(input) {
    const m = this.move;
    if (Math.hypot(m.x, m.y) > 0.15) {
      input.forward = -m.y;
      input.strafe = m.x;
      input.sprint = !this.controls.player.flying && Math.hypot(m.x, m.y) > 0.95; // 端まで倒すとダッシュ
    }
    if (this.jump) input.jump = true;
    if (this.down) input.down = true;
    return input;
  }
}
