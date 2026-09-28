// かわいいどうぶつライダー＋自転車の 3D モデルとアニメーション
import * as THREE from 'three';
import { ANIMALS } from './config.js';
import { PartList, mat, toonGradient, glowTexture } from './geom.js';
import { TAU, clamp, lerp, damp } from './util.js';

// 自転車の寸法（ローカル座標: +z 前, +y 上, +x 左）
const WHEEL_R = 0.3;
const REAR_Z = -0.38, FRONT_Z = 0.52;
const BB = new THREE.Vector3(0, 0.24, 0);
const CRANK = 0.14;
const HOOD_L = new THREE.Vector3(0.17, 0.77, 0.585);
const HOOD_R = new THREE.Vector3(-0.17, 0.77, 0.585);
const THIGH = 0.345, SHIN = 0.345;
const UPPER = 0.29, FORE = 0.28;
const HEAD_R = 0.25;
const HEAD_C = new THREE.Vector3(0, 0.2, 0.02); // 頭の中心（頭グループ座標）

// ポーズ（骨盤位置・上体の前傾）
const POSE_SEAT = { px: 0, py: 0.835, pz: -0.155, pitch: 0.95, head: -0.04 };
const POSE_STAND = { px: 0, py: 0.865, pz: 0.0, pitch: 0.82, head: 0.06 };
const POSE_TUCK = { px: 0, py: 0.815, pz: -0.19, pitch: 1.2, head: 0.02 };

let _toon = null;
function toonMat() {
  if (!_toon) _toon = new THREE.MeshToonMaterial({ vertexColors: true, gradientMap: toonGradient() });
  return _toon;
}

const _q = new THREE.Quaternion();
const _v1 = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _v3 = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);
const _fwd = new THREE.Vector3(0, 0, 1);
const LEG_BEND = new THREE.Vector3(0, 0.35, 1).normalize();
const ARM_BEND_L = new THREE.Vector3(0.7, -0.55, -0.45).normalize();
const ARM_BEND_R = new THREE.Vector3(-0.7, -0.55, -0.45).normalize();

// 2 ボーン IK（膝・肘の位置を求める）
function ik2(root, target, a, b, bendDir, outMid) {
  const d = _v1.subVectors(target, root);
  const dist = d.length();
  const dd = clamp(dist, Math.abs(a - b) + 1e-4, a + b - 1e-4);
  d.divideScalar(dist || 1);
  const cosA = clamp((a * a + dd * dd - b * b) / (2 * a * dd), -1, 1);
  const sinA = Math.sqrt(1 - cosA * cosA);
  const n = _v2.copy(bendDir).addScaledVector(d, -bendDir.dot(d));
  if (n.lengthSq() < 1e-8) n.set(0, 1, 0);
  n.normalize();
  outMid.copy(root).addScaledVector(d, a * cosA).addScaledVector(n, a * sinA);
  return outMid;
}

// Y 軸向きの部品を from→to に向ける
function orientY(obj, from, to) {
  obj.position.copy(from);
  _v3.subVectors(to, from).normalize();
  obj.quaternion.setFromUnitVectors(_up, _v3);
}

// 面の法線に沿って置く行列
function surfaceMat(pos, normal, scale, spin = 0) {
  const q = new THREE.Quaternion().setFromUnitVectors(_fwd, normal.clone().normalize());
  if (spin) q.multiply(new THREE.Quaternion().setFromAxisAngle(_fwd, spin));
  return new THREE.Matrix4().compose(pos.clone(), q, new THREE.Vector3(...scale));
}

function headPoint(dx, dy, dz, extra = 0) {
  const n = new THREE.Vector3(dx, dy, dz).normalize();
  return { p: HEAD_C.clone().addScaledVector(n, HEAD_R + extra), n };
}

function darker(hex, f = 0.75) {
  return new THREE.Color(hex).multiplyScalar(f);
}

// ---------------------------------------------------------------
function buildFrame(color, accent) {
  const pl = new PartList();
  const dark = 0x2b2b33, silver = 0xc3c7d0;
  const SC = [0, 0.66, -0.13], HTt = [0, 0.70, 0.43], HTb = [0, 0.585, 0.465];
  const RA = [0, WHEEL_R, REAR_Z], FA = [0, WHEEL_R, FRONT_Z];
  const bb = [0, BB.y, 0];
  pl.tube(bb, SC, 0.022, color);
  pl.tube(SC, HTt, 0.02, color);
  pl.tube(bb, HTb, 0.027, color);
  pl.tube(HTb, HTt, 0.028, color);
  for (const x of [0.055, -0.055]) {
    pl.tube([x * 0.5, SC[1] - 0.02, SC[2]], [x, RA[1], RA[2]], 0.012, color);
    pl.tube([x * 0.7, bb[1], bb[2]], [x, RA[1], RA[2]], 0.014, color);
    pl.tube([x * 0.6, HTb[1], HTb[2]], [x, FA[1], FA[2]], 0.015, color);
  }
  pl.tube(SC, [0, 0.77, -0.165], 0.014, silver);
  pl.sphere([0, 0.79, -0.18], 0.05, dark, [1.15, 0.38, 2.5]);
  pl.tube(HTt, [0, 0.745, 0.53], 0.015, dark);
  pl.tube([-0.17, 0.745, 0.53], [0.17, 0.745, 0.53], 0.013, dark);
  // ドロップハンドル（前方へ弧を描く）
  const X = new THREE.Vector3(1, 0, 0), Y = new THREE.Vector3(0, 1, 0), Z = new THREE.Vector3(0, 0, 1);
  for (const x of [0.17, -0.17]) {
    const m = new THREE.Matrix4().makeBasis(Y, Z, X).setPosition(x, 0.69, 0.53);
    pl.geo(new THREE.TorusGeometry(0.055, 0.012, 5, 10, Math.PI), dark, m);
    pl.sphere([x, 0.765, 0.58], 0.022, dark, [0.9, 1.4, 1.6]);
  }
  pl.torus([0.075, BB.y, 0], 0.09, 0.009, silver, [0, Math.PI / 2, 0], TAU, 4, 20);
  pl.cyl([0.072, BB.y, 0], 0.086, 0.086, 0.006, dark, [0, 0, Math.PI / 2], 18);
  pl.cyl([0.06, WHEEL_R, REAR_Z], 0.045, 0.045, 0.02, silver, [0, 0, Math.PI / 2], 10);
  pl.tube([0.0, 0.37, 0.15], [0.0, 0.5, 0.29], 0.033, accent);
  pl.sphere([0, 0.52, 0.31], 0.02, 0xffffff);
  return pl.build();
}

function buildWheel(rim) {
  const pl = new PartList();
  const silver = 0xd5d9e0;
  pl.torus([0, 0, 0], WHEEL_R - 0.02, 0.021, 0x26262c, [0, Math.PI / 2, 0], TAU, 8, 36);
  pl.torus([0, 0, 0], WHEEL_R - 0.052, 0.018, rim, [0, Math.PI / 2, 0], TAU, 6, 36);
  pl.torus([0, 0, 0], WHEEL_R - 0.078, 0.013, rim, [0, Math.PI / 2, 0], TAU, 6, 36);
  pl.cyl([0, 0, 0], 0.028, 0.028, 0.1, silver, [0, 0, Math.PI / 2], 10);
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * TAU;
    pl.box([0, Math.cos(a) * 0.125, Math.sin(a) * 0.125], [0.008, 0.2, 0.014], silver, [a, 0, 0]);
  }
  return pl.build();
}

function buildCrank() {
  const pl = new PartList();
  const dark = 0x2b2b33;
  pl.box([0.09, CRANK / 2, 0], [0.018, CRANK + 0.02, 0.03], dark);
  pl.box([-0.09, -CRANK / 2, 0], [0.018, CRANK + 0.02, 0.03], dark);
  pl.cyl([0, 0, 0], 0.018, 0.018, 0.2, 0x999999, [0, 0, Math.PI / 2], 8);
  return pl.build();
}

// ---------------------------------------------------------------
function buildTorso(jersey, accent) {
  const pl = new PartList();
  pl.capsule([0, 0.07, 0], [0, 0.3, 0.0], 0.15, jersey, 14);
  pl.torus([0, 0.19, 0], 0.152, 0.022, accent, [Math.PI / 2, 0, 0], TAU, 6, 24);
  pl.sphere([0, 0.03, -0.005], 0.14, 0x22232b, [1.08, 0.8, 1.0]);
  pl.box([0, 0.2, -0.148], [0.15, 0.1, 0.012], 0xffffff, [0.1, 0, 0]);
  pl.sphere([0, 0.33, 0.02], 0.1, jersey, [1.4, 0.6, 1.1]);
  return pl.build();
}

function addEar(pl, a, side) {
  const s = side; // +1: 左(+x), -1: 右
  const base = (x, y, z, rz, rx = 0) => new THREE.Matrix4().compose(
    new THREE.Vector3(HEAD_C.x + x * s, HEAD_C.y + y, HEAD_C.z + z),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, 0, rz * s)),
    new THREE.Vector3(1, 1, 1));
  const at = (bm, pos, rot = [0, 0, 0], scale = [1, 1, 1]) => bm.clone().multiply(mat(pos, rot, scale));
  switch (a.ears) {
    case 'cat': {
      const bm = base(0.135, 0.19, -0.01, -0.38);
      pl.geo(new THREE.ConeGeometry(0.088, 0.17, 8), a.fur, at(bm, [0, 0.07, 0]));
      pl.geo(new THREE.ConeGeometry(0.052, 0.11, 8), a.inner, at(bm, [0, 0.06, 0.035], [0, 0, 0], [1, 1, 0.45]));
      break;
    }
    case 'shiba': {
      const bm = base(0.13, 0.19, 0.0, -0.3, 0.15);
      pl.geo(new THREE.ConeGeometry(0.09, 0.16, 8), a.fur, at(bm, [0, 0.07, 0]));
      pl.geo(new THREE.ConeGeometry(0.055, 0.1, 8), a.inner, at(bm, [0, 0.055, 0.04], [0, 0, 0], [1, 1, 0.45]));
      break;
    }
    case 'fox':
    case 'wolf': {
      const big = a.ears === 'fox' ? 1.15 : 1.0;
      const bm = base(0.14, 0.19, -0.01, -0.42);
      pl.geo(new THREE.ConeGeometry(0.1 * big, 0.23 * big, 8), a.fur, at(bm, [0, 0.1 * big, 0]));
      pl.geo(new THREE.ConeGeometry(0.058 * big, 0.14 * big, 8), a.inner, at(bm, [0, 0.08 * big, 0.045], [0, 0, 0], [1, 1, 0.4]));
      if (a.ears === 'fox') pl.geo(new THREE.ConeGeometry(0.045, 0.07, 8), 0x3a2a22, at(bm, [0, 0.22 * big - 0.02, 0]));
      break;
    }
    case 'bunny': {
      const bm = base(0.075, 0.2, -0.03, -0.18, -0.18);
      pl.geo(new THREE.CapsuleGeometry(0.058, 0.26, 4, 10), a.fur, at(bm, [0, 0.17, 0]));
      pl.geo(new THREE.CapsuleGeometry(0.032, 0.2, 4, 8), a.inner, at(bm, [0, 0.17, 0.035], [0, 0, 0], [1, 1, 0.5]));
      break;
    }
    case 'round': {
      const bm = base(0.175, 0.19, -0.03, 0);
      pl.geo(new THREE.SphereGeometry(0.078, 12, 10), a.fur, at(bm, [0, 0, 0], [0, 0, 0], [1, 1, 0.75]));
      pl.geo(new THREE.SphereGeometry(0.042, 10, 8), a.inner, at(bm, [0, -0.005, 0.045], [0, 0, 0], [1, 1, 0.4]));
      break;
    }
    case 'panda': {
      const bm = base(0.175, 0.19, -0.03, 0);
      pl.geo(new THREE.SphereGeometry(0.085, 12, 10), 0x2a2a2e, at(bm, [0, 0, 0], [0, 0, 0], [1, 1, 0.75]));
      break;
    }
    case 'hamster': {
      const bm = base(0.15, 0.2, 0.0, -0.2);
      pl.geo(new THREE.SphereGeometry(0.062, 12, 10), a.fur, at(bm, [0, 0, 0], [0, 0, 0], [1, 1, 0.6]));
      pl.geo(new THREE.SphereGeometry(0.036, 10, 8), a.inner, at(bm, [0, 0, 0.03], [0, 0, 0], [1, 1, 0.4]));
      break;
    }
    default:
      break;
  }
}

function buildHead(a, helmet, opts = {}) {
  const pl = new PartList();
  const fur = a.fur;
  pl.sphere(HEAD_C.toArray(), HEAD_R, fur, [1.06, 0.97, 1.0], [0, 0, 0], 24, 18);
  // ほっぺ・口元
  if (a.extra === 'penguin') {
    pl.sphere([0, HEAD_C.y - 0.025, HEAD_C.z + 0.09], 0.21, a.fur2, [1.05, 0.85, 0.75], [0, 0, 0], 18, 14);
  }
  if (a.extra === 'cheeks') {
    for (const s of [1, -1]) pl.sphere([0.14 * s, HEAD_C.y - 0.085, HEAD_C.z + 0.12], 0.105, a.fur2, [1, 0.85, 0.9], [0, 0, 0], 14, 10);
  }
  if (a.id === 'fox') {
    for (const s of [1, -1]) pl.sphere([0.13 * s, HEAD_C.y - 0.08, HEAD_C.z + 0.12], 0.1, a.fur2, [1, 0.8, 0.8], [0, 0, 0], 12, 10);
  }
  if (a.muzzle) {
    const mz = HEAD_C.clone().add(new THREE.Vector3(0, -0.075, 0.185));
    pl.sphere(mz.toArray(), 0.1, a.fur2, [1.15, 0.78, 0.9], [0, 0, 0], 16, 12);
    pl.sphere([0, mz.y + 0.035, mz.z + 0.085], 0.032, a.nose, [1.3, 0.9, 1]);
    mouth(pl, new THREE.Vector3(0, mz.y - 0.022, mz.z + 0.088), 0.014);
  } else if (a.extra === 'penguin') {
    const m = new THREE.Matrix4().compose(new THREE.Vector3(0, HEAD_C.y - 0.05, HEAD_C.z + 0.265), new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.PI / 2, 0, 0)), new THREE.Vector3(1.2, 1, 0.7));
    pl.geo(new THREE.ConeGeometry(0.045, 0.09, 10), a.nose, m);
  } else {
    const np = headPoint(0, -0.12, 1, 0.004);
    pl.sphere(np.p.toArray(), 0.024, a.nose, [1.3, 0.9, 0.8]);
    mouth(pl, HEAD_C.clone().add(new THREE.Vector3(0, -0.085, 0.24)), 0.015);
  }
  // ほっぺの赤み
  for (const s of [1, -1]) {
    const b = headPoint(0.6 * s, -0.24, 0.76, -0.004);
    pl.geo(new THREE.SphereGeometry(0.046, 12, 8), 0xff9fb5, surfaceMat(b.p, b.n, [1, 0.62, 0.28]));
  }
  // 模様
  if (a.extra === 'panda') {
    for (const s of [1, -1]) {
      const e = headPoint(0.37 * s, 0.04, 0.93, -0.012);
      pl.geo(new THREE.SphereGeometry(0.062, 12, 10), 0x2a2a2e, surfaceMat(e.p, e.n, [0.85, 1.12, 0.4], 0.45 * s));
    }
  }
  if (a.extra === 'maro') {
    for (const s of [1, -1]) {
      const e = headPoint(0.3 * s, 0.33, 0.9, -0.002);
      pl.geo(new THREE.SphereGeometry(0.024, 10, 8), 0xffffff, surfaceMat(e.p, e.n, [1.35, 0.85, 0.4]));
    }
  }
  if (a.extra === 'tabby') {
    for (const [x, y] of [[0, 0.62], [0.13, 0.57], [-0.13, 0.57]]) {
      const e = headPoint(x, y, 0.78, -0.003);
      pl.geo(new THREE.SphereGeometry(0.03, 8, 6), darker(a.fur, 0.72), surfaceMat(e.p, e.n, [0.45, 1.6, 0.35]));
    }
  }
  // 耳
  addEar(pl, a, 1);
  addEar(pl, a, -1);
  // ヘルメット
  const hm = new THREE.SphereGeometry(HEAD_R + 0.022, 20, 10, 0, TAU, 0, Math.PI * 0.43);
  pl.geo(hm, helmet, mat([HEAD_C.x, HEAD_C.y + 0.035, HEAD_C.z - 0.01], [-0.12, 0, 0], [1.05, 0.95, 1.1]));
  const X = new THREE.Vector3(1, 0, 0), Y = new THREE.Vector3(0, 1, 0), Z = new THREE.Vector3(0, 0, 1);
  for (const x of [-0.075, 0, 0.075]) {
    const m = new THREE.Matrix4().makeBasis(Z, Y, X.clone().negate());
    m.premultiply(new THREE.Matrix4().makeRotationX(-0.55));
    m.setPosition(x, HEAD_C.y + 0.03, HEAD_C.z - 0.01);
    pl.geo(new THREE.TorusGeometry(HEAD_R + 0.03 - Math.abs(x) * 0.25, 0.012, 4, 16, Math.PI * 0.62), 0x1c1c22, m);
  }
  // サングラス（ライバル）
  if (opts.shades) {
    for (const s of [1, -1]) {
      const e = headPoint(0.36 * s, 0.05, 0.93, 0.012);
      pl.geo(new THREE.SphereGeometry(0.062, 14, 10), 0x111118, surfaceMat(e.p, e.n, [1.25, 0.82, 0.35]));
    }
    const br = headPoint(0, 0.07, 1, 0.012);
    pl.box(br.p.toArray(), [0.08, 0.018, 0.02], 0x111118);
  }
  return pl.build();
}

function mouth(pl, center, r) {
  for (const s of [1, -1]) {
    const m = new THREE.Matrix4().compose(
      new THREE.Vector3(center.x + s * r, center.y, center.z),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, Math.PI)),
      new THREE.Vector3(1, 1, 1));
    pl.geo(new THREE.TorusGeometry(r, r * 0.3, 4, 10, Math.PI), 0x3a2a2a, m);
  }
}

// 目の表情バリエーション（目の中心の高さを原点に）
function buildEyes(kind) {
  const pl = new PartList();
  const black = 0x1b1b22;
  for (const s of [1, -1]) {
    const e = headPoint(0.36 * s, 0.05, 0.93, 0.0);
    const p = e.p.clone();
    const off = new THREE.Vector3(0, -p.y, 0);
    if (kind === 'normal') {
      pl.geo(new THREE.SphereGeometry(0.043, 14, 12), black, surfaceMat(p.clone().add(off), e.n, [1, 1.28, 0.5]));
      const hl = p.clone().add(off).add(new THREE.Vector3(0.013, 0.02, 0.022));
      pl.sphere(hl.toArray(), 0.014, 0xffffff);
      const hl2 = p.clone().add(off).add(new THREE.Vector3(-0.012, -0.018, 0.02));
      pl.sphere(hl2.toArray(), 0.007, 0xffffff);
    } else {
      const segs = [];
      const q = p.clone().add(off).addScaledVector(e.n, 0.011);
      if (kind === 'effort') {
        // > < （中心側に尖る）
        const ax = -s * 0.018;
        segs.push([[ax, 0], [s * 0.022, 0.022]], [[ax, 0], [s * 0.022, -0.022]]);
      } else if (kind === 'happy') {
        segs.push([[-0.028, -0.012], [0, 0.016]], [[0, 0.016], [0.028, -0.012]]);
      } else if (kind === 'dizzy') {
        segs.push([[-0.022, -0.022], [0.022, 0.022]], [[-0.022, 0.022], [0.022, -0.022]]);
      }
      for (const [a, b] of segs) {
        const A = q.clone().add(new THREE.Vector3(a[0], a[1], 0));
        const B = q.clone().add(new THREE.Vector3(b[0], b[1], 0));
        pl.capsule(A, B, 0.009, black, 6);
      }
    }
  }
  return pl.build();
}

function buildTail(a) {
  const pl = new PartList();
  switch (a.tail) {
    case 'cat': {
      const curve = new THREE.CatmullRomCurve3([
        new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0.04, -0.12), new THREE.Vector3(0, 0.17, -0.2),
        new THREE.Vector3(0, 0.3, -0.17), new THREE.Vector3(0, 0.34, -0.08),
      ]);
      pl.geo(new THREE.TubeGeometry(curve, 16, 0.032, 8, false), a.fur);
      pl.sphere([0, 0.34, -0.08], 0.032, a.fur);
      break;
    }
    case 'curl':
      pl.geo(new THREE.TorusGeometry(0.075, 0.038, 8, 16, Math.PI * 1.7), a.fur, mat([0, 0.1, -0.07], [0, Math.PI / 2, 0.3]));
      break;
    case 'fox':
      pl.sphere([0, 0.1, -0.2], 0.095, a.fur, [0.9, 0.9, 2.5], [-0.65, 0, 0]);
      pl.sphere([0, 0.23, -0.36], 0.07, 0xffffff, [0.9, 0.9, 1.2], [-0.65, 0, 0]);
      break;
    case 'wolf':
      pl.sphere([0, -0.02, -0.21], 0.075, a.fur, [0.9, 0.9, 2.7], [0.3, 0, 0]);
      pl.sphere([0, -0.08, -0.36], 0.055, a.fur2, [0.9, 0.9, 1.2], [0.3, 0, 0]);
      break;
    case 'pompom':
      pl.sphere([0, 0.02, -0.04], 0.068, 0xffffff);
      break;
    case 'stub':
      pl.sphere([0, 0.02, -0.03], 0.042, a.extra === 'panda' ? 0x2a2a2e : a.fur);
      break;
    default:
      pl.sphere([0, 0, 0], 0.01, a.fur);
  }
  return pl.build();
}

function limbGeo(len, r, color, sock = null, sockColor = 0xffffff) {
  const pl = new PartList();
  pl.capsule([0, 0, 0], [0, len, 0], r, color, 10);
  if (sock) pl.cyl([0, len - sock, 0], r * 1.08, r * 1.08, 0.05, sockColor, [0, 0, 0], 10);
  return pl.build();
}

function buildShoe(color) {
  const pl = new PartList();
  pl.sphere([0, 0, 0.02], 0.05, color, [1, 0.8, 2.1]);
  pl.box([0, -0.03, 0.02], [0.07, 0.015, 0.2], 0x222222);
  return pl.build();
}

function buildPaw(color) {
  const pl = new PartList();
  pl.sphere([0, 0, 0], 0.052, color, [1, 0.9, 1.1]);
  return pl.build();
}

function starGeo() {
  const pl = new PartList();
  pl.geo(new THREE.OctahedronGeometry(0.045, 0), 0xffe14d, mat([0, 0, 0], [0, 0, 0], [1, 1, 0.35]));
  return pl.build();
}

// ---------------------------------------------------------------
export class RiderModel {
  constructor({ animal = 'cat', jersey = 0xff5c8a, bike = 0xffffff, accent = 0xffffff, shades = false, shadows = true }) {
    const a = ANIMALS[animal] || ANIMALS.cat;
    this.animal = a;
    const toon = toonMat();
    const limb = a.limb ?? a.fur;
    const mk = (geo) => {
      const m = new THREE.Mesh(geo, toon);
      m.castShadow = shadows;
      return m;
    };

    this.root = new THREE.Group();
    this.lean = new THREE.Group();
    this.lean.rotation.order = 'YXZ';
    this.root.add(this.lean);

    // 自転車
    this.frame = mk(buildFrame(bike, jersey));
    this.lean.add(this.frame);
    this.wheelF = mk(buildWheel(bike === 0xffffff ? 0x333333 : 0x222222));
    this.wheelF.position.set(0, WHEEL_R, FRONT_Z);
    this.wheelR = mk(this.wheelF.geometry);
    this.wheelR.position.set(0, WHEEL_R, REAR_Z);
    this.lean.add(this.wheelF, this.wheelR);
    this.crank = mk(buildCrank());
    this.crank.position.copy(BB);
    this.lean.add(this.crank);

    // からだ
    this.body = new THREE.Group();
    this.lean.add(this.body);
    this.torso = mk(buildTorso(jersey, accent));
    this.body.add(this.torso);
    this.head = new THREE.Group();
    this.head.position.set(0, 0.4, 0.04);
    this.body.add(this.head);
    this.headMesh = mk(buildHead(a, jersey, { shades }));
    this.head.add(this.headMesh);
    const eyeY = headPoint(0.36, 0.05, 0.93).p.y;
    this.eyes = {};
    for (const kind of ['normal', 'effort', 'happy', 'dizzy']) {
      const m = new THREE.Mesh(buildEyes(kind), toon);
      m.position.y = eyeY;
      m.visible = kind === 'normal';
      this.head.add(m);
      this.eyes[kind] = m;
    }
    this.face = 'normal';
    this.shades = shades;
    // ぐるぐる星
    this.stars = new THREE.Group();
    this.stars.position.set(0, HEAD_C.y + 0.33, HEAD_C.z);
    const sg = starGeo();
    for (let i = 0; i < 3; i++) {
      const s = new THREE.Mesh(sg, toon);
      const ang = (i / 3) * TAU;
      s.position.set(Math.cos(ang) * 0.2, 0, Math.sin(ang) * 0.2);
      this.stars.add(s);
    }
    this.stars.visible = false;
    this.head.add(this.stars);
    // 汗
    const sweatGeo = new PartList().sphere([0, 0, 0], 0.028, 0x8fdcff, [0.8, 1.1, 0.8]).cone([0, 0.035, 0], 0.022, 0.04, 0x8fdcff, [0, 0, 0], 6).build();
    this.sweat = [0, 1].map((i) => {
      const m = new THREE.Mesh(sweatGeo, toon);
      m.visible = false;
      this.head.add(m);
      return m;
    });

    this.tail = mk(buildTail(a));
    this.tail.position.set(0, 0.04, -0.16);
    this.body.add(this.tail);

    // 手足
    const shorts = 0x22232b;
    this.thighL = mk(limbGeo(THIGH, 0.066, shorts));
    this.thighR = mk(this.thighL.geometry);
    this.shinL = mk(limbGeo(SHIN, 0.05, limb, 0.07, 0xffffff));
    this.shinR = mk(this.shinL.geometry);
    const shoeCol = jersey === 0xffffff ? 0x333333 : 0xffffff;
    this.shoeL = mk(buildShoe(shoeCol));
    this.shoeR = mk(this.shoeL.geometry);
    this.upperL = mk(limbGeo(UPPER, 0.052, jersey));
    this.upperR = mk(this.upperL.geometry);
    this.foreL = mk(limbGeo(FORE, 0.043, limb));
    this.foreR = mk(this.foreL.geometry);
    this.pawL = mk(buildPaw(limb));
    this.pawR = mk(this.pawL.geometry);
    this.lean.add(this.thighL, this.thighR, this.shinL, this.shinR, this.shoeL, this.shoeR, this.upperL, this.upperR, this.foreL, this.foreR, this.pawL, this.pawR);

    // パワーアップのオーラ
    this.aura = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color: 0xffffff, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0 }));
    this.aura.scale.set(2.6, 2.6, 1);
    this.aura.position.set(0, 0.8, 0);
    this.root.add(this.aura);

    // 影（シャドウマップなし用）
    if (!shadows) {
      const blob = new THREE.Mesh(new THREE.CircleGeometry(0.55, 16), new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.25, depthWrite: false }));
      blob.rotation.x = -Math.PI / 2;
      blob.position.y = 0.03;
      blob.scale.set(0.7, 1.4, 1);
      this.root.add(blob);
    }

    // 状態
    this.crankAngle = Math.random() * TAU;
    this.wheelAngle = 0;
    this.standB = 0;
    this.tuckB = 0;
    this.roll = 0;
    this.blinkT = 1 + Math.random() * 3;
    this.time = Math.random() * 10;
    this.celebrateB = 0;

    this._hip = new THREE.Vector3();
    this._knee = new THREE.Vector3();
    this._ankle = new THREE.Vector3();
    this._pedal = new THREE.Vector3();
    this._sh = new THREE.Vector3();
    this._elbow = new THREE.Vector3();
    this._hand = new THREE.Vector3();
    this.update(0, { speed: 0, cadence: 0 });
  }

  setFace(kind) {
    if (this.face === kind) return;
    this.face = kind;
    for (const [k, m] of Object.entries(this.eyes)) m.visible = k === kind;
  }

  // 頭上のワールド座標（名札用）
  headWorld(out) {
    return this.head.localToWorld(out.set(0, HEAD_C.y + HEAD_R + 0.28, 0));
  }

  update(dt, st) {
    this.time += dt;
    const t = this.time;
    const speed = st.speed || 0;
    const cadence = st.cadence || 0;

    // ホイール
    this.wheelAngle += (speed / WHEEL_R) * dt;
    this.wheelF.rotation.x = this.wheelAngle;
    this.wheelR.rotation.x = this.wheelAngle;

    // クランク
    if (cadence > 1) {
      this.crankAngle += (cadence / 60) * TAU * dt;
    } else {
      // 惰性走行：クランクを水平に
      const target = Math.round((this.crankAngle - Math.PI / 2) / Math.PI) * Math.PI + Math.PI / 2;
      this.crankAngle = damp(this.crankAngle, target, 4, dt);
    }
    this.crankAngle %= TAU * 1000;
    const ca = this.crankAngle;
    this.crank.rotation.x = ca;

    // ポーズのブレンド
    const standing = !!st.standing, tuck = !!st.tuck && !standing;
    this.standB = damp(this.standB, standing ? 1 : 0, 6, dt);
    this.tuckB = damp(this.tuckB, tuck ? 1 : 0, 3, dt);
    this.celebrateB = damp(this.celebrateB, st.celebrate ? 1 : 0, 5, dt);
    const sb = this.standB, tb = this.tuckB;
    const P = (k) => lerp(lerp(POSE_SEAT[k], POSE_STAND[k], sb), POSE_TUCK[k], tb);
    const stroke = Math.sin(ca);
    const px = P('px') + sb * stroke * 0.035;
    const py = P('py') - sb * Math.abs(Math.cos(ca)) * 0.02 + (1 - sb) * Math.sin(ca * 2) * 0.004;
    const pz = P('pz');
    let pitch = P('pitch');
    // ばんざい（ゴール時）
    pitch = lerp(pitch, 0.35, this.celebrateB);

    // 車体：傾き（コーナー＋ダンシング）とピッチ（勾配）
    const rock = sb * 0.13 * stroke * clamp(cadence / 80, 0, 1.2);
    this.roll = damp(this.roll, (st.lean || 0) + rock, 10, dt);
    this.lean.rotation.z = this.roll;
    this.lean.rotation.x = -Math.atan(st.grade || 0);

    this.body.position.set(px, py, pz);
    this.body.rotation.set(pitch, 0, -rock * 0.7);
    const effort = st.effort || 0;
    const headTilt = P('head') + clamp(effort - 0.8, 0, 0.6) * 0.1 + Math.sin(ca * 2) * 0.012 * (0.5 + sb);
    this.head.rotation.set(-pitch + headTilt, Math.sin(t * 0.7) * 0.05 * (1 - sb), 0);
    this.body.updateMatrix();

    // しっぽ
    this.tail.rotation.set(Math.sin(t * 2.3) * 0.12, Math.sin(t * 3.1 + 1) * 0.35 * (st.happy ? 1.8 : 1), 0);

    // 脚（2ボーンIK）
    const lod = st.lod ?? 0;
    if (lod < 2) {
      for (const side of [1, -1]) {
        const ang = side > 0 ? ca : ca + Math.PI;
        this._pedal.set(side * 0.105, BB.y + CRANK * Math.cos(ang), CRANK * Math.sin(ang));
        this._hip.set(px + side * 0.075, py, pz);
        this._ankle.set(this._pedal.x, this._pedal.y + 0.06, this._pedal.z - 0.025);
        ik2(this._hip, this._ankle, THIGH, SHIN, LEG_BEND, this._knee);
        const thigh = side > 0 ? this.thighL : this.thighR;
        const shin = side > 0 ? this.shinL : this.shinR;
        const shoe = side > 0 ? this.shoeL : this.shoeR;
        orientY(thigh, this._hip, this._knee);
        // 膝から足首（届かない場合は伸び切った位置）
        _v1.subVectors(this._ankle, this._knee);
        if (_v1.length() > SHIN) this._ankle.copy(this._knee).addScaledVector(_v1.normalize(), SHIN);
        orientY(shin, this._knee, this._ankle);
        shoe.position.set(this._pedal.x, this._pedal.y + 0.035, this._pedal.z);
        shoe.rotation.set(-0.15 + 0.25 * Math.sin(ang - 0.6), 0, 0);
      }
      // 腕
      for (const side of [1, -1]) {
        this._sh.set(side * 0.14, 0.32, 0.02).applyMatrix4(this.body.matrix);
        const hood = side > 0 ? HOOD_L : HOOD_R;
        this._hand.copy(hood);
        if (this.celebrateB > 0.01) {
          // ばんざい
          _v1.set(side * 0.3, 0.55, 0.05).applyMatrix4(this.body.matrix);
          this._hand.lerp(_v1, this.celebrateB);
        }
        ik2(this._sh, this._hand, UPPER, FORE, side > 0 ? ARM_BEND_L : ARM_BEND_R, this._elbow);
        const up = side > 0 ? this.upperL : this.upperR;
        const fo = side > 0 ? this.foreL : this.foreR;
        const paw = side > 0 ? this.pawL : this.pawR;
        orientY(up, this._sh, this._elbow);
        _v1.subVectors(this._hand, this._elbow);
        if (_v1.length() > FORE) this._hand.copy(this._elbow).addScaledVector(_v1.normalize(), FORE);
        orientY(fo, this._elbow, this._hand);
        paw.position.copy(this._hand);
      }
    }

    // 表情
    let face = 'normal';
    if (st.exhausted) face = 'dizzy';
    else if (st.happy || this.celebrateB > 0.5) face = 'happy';
    else if (effort > 1.12 || standing) face = 'effort';
    if (face === 'normal') {
      this.blinkT -= dt;
      const eyes = this.eyes.normal;
      if (this.blinkT < 0) {
        eyes.scale.y = 0.12;
        if (this.blinkT < -0.11) {
          this.blinkT = 2 + Math.random() * 3.5;
          eyes.scale.y = 1;
        }
      }
    } else {
      this.eyes.normal.scale.y = 1;
    }
    this.setFace(face);
    this.stars.visible = !!st.exhausted;
    if (this.stars.visible) this.stars.rotation.y += dt * 4;
    const sweaty = effort > 1.0 || st.exhausted;
    this.sweat.forEach((m, i) => {
      m.visible = sweaty;
      if (!sweaty) return;
      const ph = ((t * 1.6 + i * 0.5) % 1);
      const s = i ? -1 : 1;
      m.position.set(s * (0.24 + ph * 0.12), HEAD_C.y + 0.14 - ph * 0.15, HEAD_C.z - ph * 0.2);
      m.scale.setScalar(1 - ph * 0.6);
    });

    // オーラ
    const auraOn = st.powerupColor != null;
    const mat = this.aura.material;
    mat.opacity = damp(mat.opacity, auraOn ? 0.55 + Math.sin(t * 8) * 0.2 : 0, 6, dt);
    if (auraOn) mat.color.set(st.powerupColor);
    this.aura.visible = mat.opacity > 0.01;
  }

  dispose() {
    this.root.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
    });
  }
}
