// 自転車の物理モデル（パワー→速度、ドラフティング、W' バランス）

export const G = 9.81;
export const RHO = 1.225;
export const CRR = 0.0041;
export const BIKE_MASS = 8.5;
export const DRIVETRAIN = 0.975;

// 走行抵抗の合計（N）
export function resistance(v, grade, mass, cda, wind = 0) {
  const th = Math.atan(grade);
  const fg = mass * G * Math.sin(th);
  const fr = mass * G * Math.cos(th) * CRR * Math.min(1, v / 0.3);
  const va = v + wind;
  const fa = 0.5 * RHO * cda * va * Math.abs(va);
  return fg + fr + fa;
}

// 1ステップ分の速度更新
export function stepSpeed(v, power, grade, mass, cda, wind, dt) {
  const fProp = (Math.max(0, power) * DRIVETRAIN) / Math.max(v, 1.4);
  const fRes = resistance(v, grade, mass, cda, wind);
  const a = (fProp - fRes) / (mass + 1.4);
  const nv = v + a * dt;
  return nv < 0 ? 0 : nv;
}

// 定常で速度 v を保つのに必要なパワー
export function powerForSpeed(v, grade, mass, cda, wind = 0) {
  return Math.max(0, (resistance(v, grade, mass, cda, wind) * v) / DRIVETRAIN);
}

// 一定パワーでの平衡速度（二分探索）
export function speedForPower(power, grade, mass, cda, wind = 0) {
  let lo = 0, hi = 35;
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    if (powerForSpeed(mid, grade, mass, cda, wind) > power) hi = mid; else lo = mid;
  }
  return (lo + hi) / 2;
}

// 前走者との位置関係によるドラフト効果（空気抵抗の削減率 0..~0.35）
export function draftSaving(gap, lateral) {
  if (gap <= 0.25 || gap > 14) return 0;
  const lat = Math.abs(lateral);
  if (lat > 1.35) return 0;
  const longF = gap < 1.3 ? 1 : Math.max(0, 1 - (gap - 1.3) / 12.7);
  const latF = lat < 0.45 ? 1 : 1 - (lat - 0.45) / 0.9;
  return 0.34 * Math.pow(longF, 1.25) * latF;
}

// W' バランス（Skiba の微分モデル）
export class WPrime {
  constructor(cp, w0) {
    this.cp = cp;
    this.w0 = w0;
    this.w = w0;
  }
  update(p, dt) {
    if (p > this.cp) this.w -= (p - this.cp) * dt;
    else this.w += (((this.cp - p) * (this.w0 - this.w)) / this.w0) * dt * 1.15;
    if (this.w > this.w0) this.w = this.w0;
    if (this.w < -this.w0 * 0.3) this.w = -this.w0 * 0.3;
  }
  get frac() {
    return Math.max(0, this.w / this.w0);
  }
  refill(fr) {
    this.w = Math.min(this.w0, this.w + this.w0 * fr);
  }
}

// 体重から前面投影面積×抗力係数を推定
export function cdaForWeight(kg) {
  return 0.3 * Math.pow(kg / 70, 0.66);
}
