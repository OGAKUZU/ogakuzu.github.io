// コース（周回ルート）生成：極座標ループ＋勾配プロファイル
import { mod, lerp, mulberry32, Noise2D, TAU } from './util.js';

export class Course {
  constructor(def) {
    this.def = def;
    this.id = def.id;
    this.name = def.name;
    this.halfWidth = 5.2; // 道路の半幅 (m)
    this._tmp = { x: 0, y: 0, z: 0, tx: 0, tz: 1, grade: 0, curv: 0 };
    this._near = { d: 0, k: 0, s: 0, y: 0, side: 1 };
    this._build();
  }

  radiusAt(th) {
    let r = 1;
    for (const [k, a, ph] of this.def.harmonics) r += a * Math.sin(k * th + ph);
    return this.def.radius * r;
  }

  _build() {
    const def = this.def;
    const rng = mulberry32(def.seed);
    const noise = new Noise2D(rng);

    // 1) 極座標曲線を細かくサンプリングして弧長を求める
    const N = 16384;
    const px = new Float64Array(N + 1);
    const pz = new Float64Array(N + 1);
    const cum = new Float64Array(N + 1);
    for (let i = 0; i <= N; i++) {
      const th = (i / N) * TAU;
      const r = this.radiusAt(th);
      px[i] = r * Math.cos(th);
      pz[i] = r * Math.sin(th);
      if (i > 0) cum[i] = cum[i - 1] + Math.hypot(px[i] - px[i - 1], pz[i] - pz[i - 1]);
    }
    const L = cum[N];

    // 2) 約2m間隔で等間隔に再サンプリング
    const M = Math.round(L / 2);
    const ds = L / M;
    this.length = L;
    this.count = M;
    this.ds = ds;
    const X = (this.X = new Float32Array(M));
    const Z = (this.Z = new Float32Array(M));
    const TH = (this.TH = new Float32Array(M));
    let j = 0;
    for (let k = 0; k < M; k++) {
      const s = k * ds;
      while (j < N - 1 && cum[j + 1] < s) j++;
      const t = (s - cum[j]) / (cum[j + 1] - cum[j]);
      X[k] = lerp(px[j], px[j + 1], t);
      Z[k] = lerp(pz[j], pz[j + 1], t);
      TH[k] = ((j + t) / N) * TAU;
    }

    // 3) 接線・方位・曲率
    const TX = (this.TX = new Float32Array(M));
    const TZ = (this.TZ = new Float32Array(M));
    const HD = new Float32Array(M);
    const C = (this.C = new Float32Array(M));
    let maxR = 0;
    for (let k = 0; k < M; k++) {
      const p = (k - 1 + M) % M, n = (k + 1) % M;
      const tx = X[n] - X[p], tz = Z[n] - Z[p];
      const l = Math.hypot(tx, tz);
      TX[k] = tx / l;
      TZ[k] = tz / l;
      HD[k] = Math.atan2(TX[k], TZ[k]);
      maxR = Math.max(maxR, Math.hypot(X[k], Z[k]));
    }
    for (let k = 0; k < M; k++) {
      const p = (k - 1 + M) % M, n = (k + 1) % M;
      let dh = HD[n] - HD[p];
      dh = mod(dh + Math.PI, TAU) - Math.PI;
      C[k] = dh / (2 * ds);
    }
    this.maxRadius = maxR;

    // 4) 勾配プロファイル
    const G = (this.G = new Float32Array(M));
    for (let k = 0; k < M; k++) {
      const u = k / M;
      let g = 0;
      for (const [u0, u1, gr] of def.grades) {
        if (u >= u0 && u < u1) { g = gr; break; }
      }
      G[k] = g / 100;
    }
    // 上り下りの合計を釣り合わせる（下りを拡大縮小）
    let pos = 0, neg = 0;
    for (let k = 0; k < M; k++) {
      if (G[k] > 0) pos += G[k]; else neg -= G[k];
    }
    if (neg > 0) {
      const f = pos / neg;
      for (let k = 0; k < M; k++) if (G[k] < 0) G[k] *= f;
    }
    // 小さなうねり
    for (let k = 0; k < M; k++) {
      const s = k * ds;
      const flat = Math.abs(G[k]) < 0.001;
      G[k] += noise.noise(s / 160, 3.7) * (flat ? 0.006 : 0.012);
    }
    // 円環の移動平均で滑らかに（2回）
    const win = Math.max(2, Math.round(36 / ds));
    for (let pass = 0; pass < 3; pass++) {
      const src = Float32Array.from(G);
      let acc = 0;
      for (let o = -win; o <= win; o++) acc += src[(o + M) % M];
      for (let k = 0; k < M; k++) {
        G[k] = acc / (2 * win + 1);
        acc += src[(k + win + 1) % M] - src[(k - win + M) % M];
      }
    }
    // 周回で高さが閉じるよう平均を0に
    let mean = 0;
    for (let k = 0; k < M; k++) mean += G[k];
    mean /= M;
    for (let k = 0; k < M; k++) G[k] -= mean;

    // 5) 標高
    const Y = (this.Y = new Float32Array(M));
    Y[0] = 0;
    for (let k = 1; k < M; k++) Y[k] = Y[k - 1] + ((G[k - 1] + G[k]) / 2) * ds;
    let minY = Infinity, maxY = -Infinity;
    for (let k = 0; k < M; k++) { minY = Math.min(minY, Y[k]); maxY = Math.max(maxY, Y[k]); }
    const base = 9 - minY; // 最低点を海抜9mに
    for (let k = 0; k < M; k++) Y[k] += base;
    this.minY = 9;
    this.maxY = maxY + base;

    let gain = 0;
    for (let k = 1; k < M; k++) gain += Math.max(0, Y[k] - Y[k - 1]);
    this.lapGain = gain;

    // 6) 区間（KOM / スプリント）
    const mk = (seg) => {
      const s0 = seg.u0 * L, s1 = seg.u1 * L;
      const y0 = this.heightAt(s0), y1 = this.heightAt(s1);
      return { ...seg, s0, s1, length: s1 - s0, gain: y1 - y0, avgGrade: (y1 - y0) / (s1 - s0) };
    };
    this.kom = mk(def.kom);
    this.sprint = mk(def.sprint);
  }

  // s（m）の位置のコース情報を補間して返す（out は再利用可能）
  sample(s, out = this._tmp) {
    const M = this.count;
    s = mod(s, this.length);
    const f = s / this.ds;
    let i = Math.floor(f);
    const t = f - i;
    if (i >= M) i -= M;
    const j = i + 1 >= M ? 0 : i + 1;
    const X = this.X, Z = this.Z, Y = this.Y;
    out.x = X[i] + (X[j] - X[i]) * t;
    out.z = Z[i] + (Z[j] - Z[i]) * t;
    out.y = Y[i] + (Y[j] - Y[i]) * t;
    out.grade = this.G[i] + (this.G[j] - this.G[i]) * t;
    const tx = this.TX[i] + (this.TX[j] - this.TX[i]) * t;
    const tz = this.TZ[i] + (this.TZ[j] - this.TZ[i]) * t;
    const l = Math.hypot(tx, tz) || 1;
    out.tx = tx / l;
    out.tz = tz / l;
    out.curv = this.C[i] + (this.C[j] - this.C[i]) * t;
    return out;
  }

  heightAt(s) {
    return this.sample(s, this._tmp).y;
  }

  gradeAt(s) {
    return this.sample(s, this._tmp).grade;
  }

  // 横方向オフセット（+が左）込みのワールド座標
  worldPos(s, lateral, out) {
    const c = this.sample(s, this._tmp);
    out.x = c.x + c.tz * lateral;
    out.y = c.y;
    out.z = c.z - c.tx * lateral;
    return out;
  }

  // 任意の点から最も近い道路中心点（地形生成用）
  nearest(x, z, out = this._near) {
    const M = this.count;
    const TH = this.TH, X = this.X, Z = this.Z;
    const th = mod(Math.atan2(z, x), TAU);
    let lo = 0, hi = M - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (TH[mid] < th) lo = mid + 1; else hi = mid;
    }
    let best = Infinity, bk = lo;
    for (let o = -90; o <= 90; o += 3) {
      const k = (lo + o + M) % M;
      const dx = X[k] - x, dz = Z[k] - z;
      const d2 = dx * dx + dz * dz;
      if (d2 < best) { best = d2; bk = k; }
    }
    const c0 = bk;
    for (let o = -3; o <= 3; o++) {
      const k = (c0 + o + M) % M;
      const dx = X[k] - x, dz = Z[k] - z;
      const d2 = dx * dx + dz * dz;
      if (d2 < best) { best = d2; bk = k; }
    }
    out.d = Math.sqrt(best);
    out.k = bk;
    out.s = bk * this.ds;
    out.y = this.Y[bk];
    out.side = Math.hypot(x, z) > this.radiusAt(th) ? 1 : -1;
    return out;
  }

  // 標高プロファイル（HUD 用）
  profile(n = 300) {
    const arr = new Float32Array(n);
    for (let i = 0; i < n; i++) arr[i] = this.heightAt((i / n) * this.length);
    return arr;
  }
}
