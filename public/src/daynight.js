// 昼夜サイクル（純関数）。hours: 0〜24 の時刻 → 明るさ・空・フォグの色
export const DAY_LENGTH_SEC = 20 * 60; // ゲーム内 24 時間 = 実時間 20 分

const KEYS = [
  // [時刻, 明るさ, 天頂色, 地平線色]
  [0, 0.22, [0.02, 0.03, 0.09], [0.07, 0.09, 0.17]],
  [4.5, 0.24, [0.04, 0.05, 0.13], [0.12, 0.12, 0.22]],
  [6, 0.62, [0.30, 0.42, 0.70], [0.95, 0.66, 0.46]],  // 朝焼け
  [8, 1.0, [0.36, 0.58, 0.88], [0.74, 0.85, 0.95]],
  [16, 1.0, [0.36, 0.58, 0.88], [0.74, 0.85, 0.95]],
  [18, 0.62, [0.28, 0.34, 0.62], [0.96, 0.58, 0.38]], // 夕焼け
  [19.5, 0.26, [0.05, 0.06, 0.16], [0.16, 0.13, 0.26]],
  [24, 0.22, [0.02, 0.03, 0.09], [0.07, 0.09, 0.17]],
];

const lerp = (a, b, t) => a + (b - a) * t;
const smooth = (t) => t * t * (3 - 2 * t);

export function skyAt(hours) {
  const h = ((hours % 24) + 24) % 24;
  let i = 0;
  while (i < KEYS.length - 2 && KEYS[i + 1][0] <= h) i++;
  const [h0, l0, t0, z0] = KEYS[i], [h1, l1, t1, z1] = KEYS[i + 1];
  const t = smooth((h - h0) / (h1 - h0));
  return {
    light: lerp(l0, l1, t),
    top: t0.map((v, k) => lerp(v, t1[k], t)),
    horizon: z0.map((v, k) => lerp(v, z1[k], t)),
    night: h < 5.5 || h > 19,
  };
}

// 経過秒 → 時刻（startHours から始まる）
export const hoursAt = (sec, startHours = 10) => (startHours + (sec / DAY_LENGTH_SEC) * 24) % 24;

export const formatTime = (hours) => {
  const m = Math.floor((((hours % 24) + 24) % 24) * 60);
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
};
