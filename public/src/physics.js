// プレイヤーの移動と AABB 衝突（純関数）。座標は足元中心、+x=東、-z=北、y=上
// isSolid(bx, by, bz) / isWater(bx, by, bz) はブロック整数座標で問い合わせる

export const PLAYER = { W: 0.6, H: 1.8, EYE: 1.62 };
export const PHYS = {
  WALK: 4.3, SPRINT: 8.0, FLY: 10.8, SWIM: 2.2,
  GRAVITY: 32, JUMP_V: 9, TERMINAL: 40,
  WATER_GRAVITY: 8, SWIM_UP: 3,
  FLY_V: 8,
  SUBSTEP: 1 / 120,      // 1 サブステップの最大移動量 = 40/120 ≈ 0.33m < 1 ブロック
  DOUBLE_TAP: 0.3,       // Space 2 連打の判定[s]
};
const HW = PLAYER.W / 2;
const EPS = 1e-4;

export function createPlayer(x, y, z) {
  return { x, y, z, vx: 0, vy: 0, vz: 0, onGround: false, flying: false, inWater: false, lastJumpPress: -Infinity, stepped: 0 };
}

// AABB が固体ブロックと重なるか
export function collides(x, y, z, isSolid) {
  const x0 = Math.floor(x - HW), x1 = Math.floor(x + HW - EPS * 0.5);
  const y0 = Math.floor(y), y1 = Math.floor(y + PLAYER.H - EPS * 0.5);
  const z0 = Math.floor(z - HW), z1 = Math.floor(z + HW - EPS * 0.5);
  for (let by = y0; by <= y1; by++) for (let bz = z0; bz <= z1; bz++) for (let bx = x0; bx <= x1; bx++) {
    if (isSolid(bx, by, bz)) return true;
  }
  return false;
}

// 1 軸ぶん移動し、ぶつかったらブロック境界に止める。止まったら true
// step: 地面に立っているとき、1 ブロックの段差なら自動で上がる（地形の起伏をジャンプなしで歩けるように）
function moveAxis(p, axis, d, isSolid, step = false) {
  if (d === 0) return false;
  p[axis] += d;
  if (!collides(p.x, p.y, p.z, isSolid)) return false;
  if (step) {
    // 足元を次のブロック境界の 1 つ上に置いて重ならなければ上がる（上がれるのは 1 ブロックまで）
    const up = Math.floor(p.y + EPS) + 1 + EPS - p.y;
    if (up > 0 && up <= 1 + 2 * EPS && !collides(p.x, p.y + up, p.z, isSolid)) {
      p.y += up;
      p.stepped += up;
      return false;
    }
  }
  if (axis === 'y') {
    p.y = d < 0 ? Math.floor(p.y) + 1 + EPS : Math.floor(p.y + PLAYER.H) - PLAYER.H - EPS;
  } else {
    const v = p[axis];
    p[axis] = d > 0 ? Math.floor(v + HW) - HW - EPS : Math.floor(v - HW) + 1 + HW + EPS;
  }
  // 境界に戻しても重なる（想定外）なら移動自体を取り消す
  if (collides(p.x, p.y, p.z, isSolid)) p[axis] -= d;
  return true;
}

// Space が押された瞬間に呼ぶ。素早い 2 連打でフライ切替（t: 秒）
export function pressJump(p, t) {
  if (t - p.lastJumpPress < PHYS.DOUBLE_TAP) {
    p.flying = !p.flying;
    p.vy = 0;
    p.lastJumpPress = -Infinity;
    return true;
  }
  p.lastJumpPress = t;
  return false;
}

// input: { forward: -1..1, strafe: -1..1, jump: bool, down: bool, sprint: bool, yaw: rad（0=北、正で左回り） }
export function stepPlayer(p, input, dt, isSolid, isWater = () => false) {
  dt = Math.min(dt, 0.1);
  const n = Math.max(1, Math.ceil(dt / PHYS.SUBSTEP));
  const h = dt / n;
  for (let s = 0; s < n; s++) substep(p, input, h, isSolid, isWater);
  return p;
}

function substep(p, input, dt, isSolid, isWater) {
  p.inWater = isWater(Math.floor(p.x), Math.floor(p.y + 0.4), Math.floor(p.z));
  const speed = p.flying ? PHYS.FLY : p.inWater ? PHYS.SWIM : input.sprint ? PHYS.SPRINT : PHYS.WALK;
  let f = input.forward || 0, r = input.strafe || 0;
  const len = Math.hypot(f, r);
  if (len > 1) { f /= len; r /= len; }
  const sy = Math.sin(input.yaw || 0), cy = Math.cos(input.yaw || 0);
  // 前方 = (-sin yaw, -cos yaw)、右 = (cos yaw, -sin yaw)
  p.vx = (-sy * f + cy * r) * speed;
  p.vz = (-cy * f - sy * r) * speed;

  if (p.flying) {
    p.vy = ((input.jump ? 1 : 0) - (input.down ? 1 : 0)) * PHYS.FLY_V;
  } else if (p.inWater) {
    p.vy -= PHYS.WATER_GRAVITY * dt;
    if (input.jump) p.vy = p.onGround ? PHYS.JUMP_V : Math.max(p.vy, PHYS.SWIM_UP);
    p.vy = Math.max(p.vy, -PHYS.SWIM_UP);
  } else {
    if (input.jump && p.onGround) p.vy = PHYS.JUMP_V;
    p.vy = Math.max(p.vy - PHYS.GRAVITY * dt, -PHYS.TERMINAL);
  }

  const step = p.onGround && !p.flying;
  moveAxis(p, 'x', p.vx * dt, isSolid, step);
  moveAxis(p, 'z', p.vz * dt, isSolid, step);
  const dy = p.vy * dt;
  p.onGround = false;
  if (moveAxis(p, 'y', dy, isSolid)) {
    if (dy < 0) p.onGround = true;
    p.vy = 0;
  } else if (dy === 0 && collides(p.x, p.y - 0.01, p.z, isSolid)) {
    p.onGround = true;
  }
}
