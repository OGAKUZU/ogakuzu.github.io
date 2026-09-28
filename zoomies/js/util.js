// 汎用ユーティリティ（数学・乱数・ノイズ・フォーマット）

export const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
export const lerp = (a, b, t) => a + (b - a) * t;
export const invLerp = (a, b, x) => (x - a) / (b - a);
export const mod = (a, n) => ((a % n) + n) % n;
export const TAU = Math.PI * 2;

export function smoothstep(a, b, x) {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
}

// フレームレート非依存の指数スムージング
export function damp(current, target, lambda, dt) {
  return lerp(current, target, 1 - Math.exp(-lambda * dt));
}

// 角度の差（-PI..PI）
export function angleDiff(a, b) {
  return mod(b - a + Math.PI, TAU) - Math.PI;
}

// シード付き乱数
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const randRange = (rng, a, b) => a + (b - a) * rng();
export const pick = (rng, arr) => arr[Math.floor(rng() * arr.length) % arr.length];

export function shuffle(rng, arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// 2D グラディエントノイズ（Perlin 系）
export class Noise2D {
  constructor(rng) {
    const p = new Uint8Array(256);
    for (let i = 0; i < 256; i++) p[i] = i;
    for (let i = 255; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      const t = p[i]; p[i] = p[j]; p[j] = t;
    }
    this.perm = new Uint8Array(512);
    for (let i = 0; i < 512; i++) this.perm[i] = p[i & 255];
  }

  noise(x, y) {
    const X = Math.floor(x), Y = Math.floor(y);
    const xf = x - X, yf = y - Y;
    const xi = X & 255, yi = Y & 255;
    const p = this.perm;
    const u = xf * xf * xf * (xf * (xf * 6 - 15) + 10);
    const v = yf * yf * yf * (yf * (yf * 6 - 15) + 10);
    const aa = p[p[xi] + yi], ab = p[p[xi] + yi + 1];
    const ba = p[p[xi + 1] + yi], bb = p[p[xi + 1] + yi + 1];
    const x1 = lerp(grad(aa, xf, yf), grad(ba, xf - 1, yf), u);
    const x2 = lerp(grad(ab, xf, yf - 1), grad(bb, xf - 1, yf - 1), u);
    return lerp(x1, x2, v) * 0.7071; // おおよそ -1..1
  }

  fbm(x, y, oct = 4, lac = 2.0, gain = 0.5) {
    let amp = 1, f = 1, sum = 0, norm = 0;
    for (let i = 0; i < oct; i++) {
      sum += amp * this.noise(x * f, y * f);
      norm += amp;
      amp *= gain;
      f *= lac;
    }
    return sum / norm;
  }
}

function grad(h, x, y) {
  switch (h & 7) {
    case 0: return x + y;
    case 1: return -x + y;
    case 2: return x - y;
    case 3: return -x - y;
    case 4: return x;
    case 5: return -x;
    case 6: return y;
    default: return -y;
  }
}

// 1D の滑らかなノイズ（カメラ揺れなど）
export function smoothNoise1(t, seed = 0) {
  return (
    Math.sin(t * 1.31 + seed) * 0.5 +
    Math.sin(t * 2.17 + seed * 1.7) * 0.3 +
    Math.sin(t * 5.03 + seed * 2.3) * 0.2
  );
}

export function fmtTime(sec) {
  if (!isFinite(sec)) return '--:--';
  sec = Math.max(0, sec);
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  const ss = String(s).padStart(2, '0');
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${ss}`;
  return `${m}:${ss}`;
}

export function fmtTimeMs(sec) {
  if (!isFinite(sec)) return '--:--.-';
  const t = fmtTime(sec);
  const tenth = Math.floor((Math.max(0, sec) % 1) * 10);
  return `${t}.${tenth}`;
}

export function fmtGap(sec) {
  const a = Math.abs(sec);
  const sign = sec >= 0 ? '+' : '-';
  if (a < 60) return `${sign}${a.toFixed(1)}s`;
  return `${sign}${fmtTime(a)}`;
}

export function fmtKm(m, digits = 1) {
  return (m / 1000).toFixed(digits);
}

export function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export function hexToCss(hex) {
  return '#' + hex.toString(16).padStart(6, '0');
}

// 簡易イベントエミッタ
export class Emitter {
  constructor() { this._h = new Map(); }
  on(type, fn) {
    if (!this._h.has(type)) this._h.set(type, new Set());
    this._h.get(type).add(fn);
    return () => this._h.get(type)?.delete(fn);
  }
  emit(type, data) {
    const set = this._h.get(type);
    if (set) for (const fn of [...set]) fn(data);
  }
}

// URL パラメータ
export const params = new URLSearchParams(typeof location !== 'undefined' ? location.search : '');
