// ジオメトリ組み立てヘルパー（頂点カラー付きでまとめて1メッシュにする）
import * as THREE from 'three';

const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);
const _d = new THREE.Vector3();
const _v = new THREE.Vector3();
const _nm = new THREE.Matrix3();

const toVec = (a) => (a instanceof THREE.Vector3 ? a : _v.set(a[0], a[1], a[2]).clone());

export function mat(pos = [0, 0, 0], rot = [0, 0, 0], scale = [1, 1, 1]) {
  _e.set(rot[0], rot[1], rot[2]);
  _q.setFromEuler(_e);
  return new THREE.Matrix4().compose(_p.set(pos[0], pos[1], pos[2]), _q, _s.set(scale[0], scale[1], scale[2]));
}

// Y 軸方向の形状を a→b に向ける行列（形状は原点中心）
export function matBetween(a, b) {
  const A = toVec(a), B = toVec(b);
  _d.subVectors(B, A);
  const len = _d.length();
  _d.normalize();
  _q.setFromUnitVectors(_up, _d);
  const mid = A.clone().add(B).multiplyScalar(0.5);
  return { m: new THREE.Matrix4().compose(mid, _q, _s.set(1, 1, 1)), len };
}

export class PartList {
  constructor() {
    this.parts = [];
  }

  geo(geometry, color, matrix = new THREE.Matrix4()) {
    this.parts.push({ geo: geometry, color: new THREE.Color(color), matrix });
    return this;
  }

  sphere(pos, r, color, scale = [1, 1, 1], rot = [0, 0, 0], ws = 16, hs = 12) {
    return this.geo(new THREE.SphereGeometry(r, ws, hs), color, mat(pos, rot, scale));
  }

  ico(pos, r, color, detail = 0, scale = [1, 1, 1], rot = [0, 0, 0]) {
    return this.geo(new THREE.IcosahedronGeometry(r, detail), color, mat(pos, rot, scale));
  }

  box(pos, size, color, rot = [0, 0, 0]) {
    return this.geo(new THREE.BoxGeometry(size[0], size[1], size[2]), color, mat(pos, rot));
  }

  cyl(pos, rTop, rBot, h, color, rot = [0, 0, 0], seg = 10, scale = [1, 1, 1]) {
    return this.geo(new THREE.CylinderGeometry(rTop, rBot, h, seg), color, mat(pos, rot, scale));
  }

  cone(pos, r, h, color, rot = [0, 0, 0], seg = 10, scale = [1, 1, 1]) {
    return this.geo(new THREE.ConeGeometry(r, h, seg), color, mat(pos, rot, scale));
  }

  torus(pos, R, r, color, rot = [0, 0, 0], arc = Math.PI * 2, rs = 8, ts = 24, scale = [1, 1, 1]) {
    return this.geo(new THREE.TorusGeometry(R, r, rs, ts, arc), color, mat(pos, rot, scale));
  }

  tube(a, b, r, color, seg = 8, r2 = r) {
    const { m, len } = matBetween(a, b);
    return this.geo(new THREE.CylinderGeometry(r2, r, len, seg, 1), color, m);
  }

  capsule(a, b, r, color, seg = 10) {
    const { m, len } = matBetween(a, b);
    return this.geo(new THREE.CapsuleGeometry(r, Math.max(0.001, len), 4, seg), color, m);
  }

  build() {
    return mergeParts(this.parts);
  }
}

// パーツ（ジオメトリ+色+行列）を1つの BufferGeometry に結合
// 全パーツが uv を持つ場合は uv も結合（part.uvScale = [su, sv] で拡大可能）
export function mergeParts(parts) {
  let vCount = 0, iCount = 0;
  let withUV = parts.length > 0;
  for (const p of parts) {
    if (!p.geo.attributes.normal) p.geo.computeVertexNormals();
    if (!p.geo.attributes.uv) withUV = false;
    vCount += p.geo.attributes.position.count;
    iCount += p.geo.index ? p.geo.index.count : p.geo.attributes.position.count;
  }
  const pos = new Float32Array(vCount * 3);
  const nor = new Float32Array(vCount * 3);
  const col = new Float32Array(vCount * 3);
  const uvs = withUV ? new Float32Array(vCount * 2) : null;
  const idx = vCount > 65535 ? new Uint32Array(iCount) : new Uint16Array(iCount);
  let vo = 0, io = 0;
  const v = new THREE.Vector3();
  for (const p of parts) {
    const g = p.geo;
    const pa = g.attributes.position, na = g.attributes.normal;
    _nm.getNormalMatrix(p.matrix);
    const { r, g: gg, b } = p.color;
    for (let i = 0; i < pa.count; i++) {
      v.fromBufferAttribute(pa, i).applyMatrix4(p.matrix);
      const o = (vo + i) * 3;
      pos[o] = v.x; pos[o + 1] = v.y; pos[o + 2] = v.z;
      v.fromBufferAttribute(na, i).applyMatrix3(_nm).normalize();
      nor[o] = v.x; nor[o + 1] = v.y; nor[o + 2] = v.z;
      col[o] = r; col[o + 1] = gg; col[o + 2] = b;
    }
    if (uvs) {
      const ua = g.attributes.uv;
      const su = p.uvScale ? p.uvScale[0] : 1, sv = p.uvScale ? p.uvScale[1] : 1;
      for (let i = 0; i < ua.count; i++) {
        uvs[(vo + i) * 2] = ua.getX(i) * su;
        uvs[(vo + i) * 2 + 1] = ua.getY(i) * sv;
      }
    }
    if (g.index) {
      const ia = g.index.array;
      for (let i = 0; i < ia.length; i++) idx[io + i] = ia[i] + vo;
      io += ia.length;
    } else {
      for (let i = 0; i < pa.count; i++) idx[io + i] = vo + i;
      io += pa.count;
    }
    vo += pa.count;
    g.dispose();
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  out.setAttribute('color', new THREE.BufferAttribute(col, 3));
  if (uvs) out.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  out.setIndex(new THREE.BufferAttribute(idx, 1));
  out.computeBoundingSphere();
  return out;
}

// トゥーン用 3段階グラデーション
let _gradient = null;
export function toonGradient() {
  if (_gradient) return _gradient;
  const data = new Uint8Array([110, 190, 255]);
  _gradient = new THREE.DataTexture(data, 3, 1, THREE.RedFormat);
  _gradient.minFilter = THREE.NearestFilter;
  _gradient.magFilter = THREE.NearestFilter;
  _gradient.generateMipmaps = false;
  _gradient.needsUpdate = true;
  return _gradient;
}

// キャンバステクスチャ生成
export function canvasTexture(w, h, draw, { repeat = false, srgb = true } = {}) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d');
  draw(g, w, h);
  const tex = new THREE.CanvasTexture(c);
  if (srgb) tex.colorSpace = THREE.SRGBColorSpace;
  if (repeat) {
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
  }
  return tex;
}

export const FONT_POP = '"Mochiy Pop One", "M PLUS Rounded 1c", "Hiragino Maru Gothic ProN", "Yu Gothic", sans-serif';
export const FONT_ROUND = '"M PLUS Rounded 1c", "Hiragino Maru Gothic ProN", "Yu Gothic", sans-serif';

let _glow = null;
export function glowTexture() {
  if (_glow) return _glow;
  _glow = canvasTexture(128, 128, (g, w, h) => {
    const gr = g.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
    gr.addColorStop(0, 'rgba(255,255,255,1)');
    gr.addColorStop(0.25, 'rgba(255,255,255,0.55)');
    gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr;
    g.fillRect(0, 0, w, h);
  });
  return _glow;
}
