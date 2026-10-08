// キーボード・マウス入力（ポインターロックの FPS 視点。使えない環境ではドラッグで視点）
import { pressJump } from './physics.js';

export class Controls {
  constructor(element, player) {
    this.el = element;
    this.player = player;
    this.yaw = 0;    // 0 = 北、正で左回り
    this.pitch = 0;
    this.keys = new Set();
    this.locked = false;
    this.active = false; // 操作を受け付けるか
    this.onKey = null;   // 追加のキー処理（描画距離・地図など）
    this.onActiveChange = null;
    this.onAction = null; // 'break' | 'place'
    this.onWheel = null;
    let downAt = null;

    document.addEventListener('pointerlockchange', () => {
      const was = this.locked;
      this.locked = document.pointerLockElement === this.el;
      if (was && !this.locked) this.setActive(false); // Esc でロック解除 → 一時停止
    });
    document.addEventListener('mousemove', (e) => {
      if (!this.active || (!this.locked && !(e.buttons & 1))) return;
      this.yaw -= e.movementX * 0.0025;
      this.pitch = Math.max(-1.55, Math.min(1.55, this.pitch - e.movementY * 0.0025));
    });
    // ロック中: 左=壊す、右=置く。ロックなし: ドラッグせずに離した左クリック=壊す、右クリック=置く
    this.el.addEventListener('mousedown', (e) => {
      if (!this.active) return;
      if (this.locked) { this.onAction?.(e.button === 2 ? 'place' : e.button === 0 ? 'break' : null); return; }
      downAt = [e.clientX, e.clientY];
      if (e.button === 2) this.onAction?.('place');
    });
    this.el.addEventListener('mouseup', (e) => {
      if (!this.active || this.locked || e.button !== 0 || !downAt) return;
      if (Math.hypot(e.clientX - downAt[0], e.clientY - downAt[1]) < 5) this.onAction?.('break');
      downAt = null;
    });
    this.el.addEventListener('contextmenu', (e) => e.preventDefault());
    this.el.addEventListener('wheel', (e) => { if (this.active) { e.preventDefault(); this.onWheel?.(Math.sign(e.deltaY)); } }, { passive: false });
    window.addEventListener('keydown', (e) => {
      if (!this.active) return;
      if (e.code === 'Escape' && !this.locked) { this.setActive(false); return; }
      if (e.code === 'Space' && !e.repeat) pressJump(this.player, performance.now() / 1000);
      this.keys.add(e.code);
      this.onKey?.(e.code);
      if (e.code === 'Space' || e.code === 'Tab') e.preventDefault();
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());
  }

  setActive(v) {
    if (this.active === v) return;
    this.active = v;
    if (!v) {
      this.keys.clear();
      if (this.locked) document.exitPointerLock?.();
    }
    this.onActiveChange?.(v);
  }

  // 開始。ポインターロックを試み、失敗してもキー操作とドラッグ視点で遊べる
  start({ lock = true } = {}) {
    this.setActive(true);
    if (lock) { try { this.el.requestPointerLock?.()?.catch?.(() => {}); } catch { /* 非対応 */ } }
  }

  input() {
    const k = this.keys;
    const shift = k.has('ShiftLeft') || k.has('ShiftRight');
    return {
      forward: (k.has('KeyW') || k.has('ArrowUp') ? 1 : 0) - (k.has('KeyS') || k.has('ArrowDown') ? 1 : 0),
      strafe: (k.has('KeyD') || k.has('ArrowRight') ? 1 : 0) - (k.has('KeyA') || k.has('ArrowLeft') ? 1 : 0),
      jump: k.has('Space'),
      sprint: shift && !this.player.flying,
      down: shift && this.player.flying,
      yaw: this.yaw,
    };
  }
}
