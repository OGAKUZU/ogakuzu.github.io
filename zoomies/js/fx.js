// 画面効果：集中線（スピードライン）・風のすじ・紙吹雪
import * as THREE from 'three';
import { clamp, TAU } from './util.js';

// マンガ風の集中線（2D キャンバス）
export class SpeedLines {
  constructor(canvas) {
    this.canvas = canvas;
    this.g = canvas.getContext('2d');
    this.lines = [];
    for (let i = 0; i < 130; i++) this.lines.push({ a: Math.random() * TAU, w: 2 + Math.random() * 6, l: 0.2 + Math.random() * 0.35, ph: Math.random() });
    this.resize();
  }

  resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    this.dpr = dpr;
    this.canvas.width = Math.floor(window.innerWidth * dpr);
    this.canvas.height = Math.floor(window.innerHeight * dpr);
    this.dirty = false;
  }

  clear() {
    if (!this.dirty) return;
    this.g.clearRect(0, 0, this.canvas.width, this.canvas.height);
    this.dirty = false;
  }

  // rect: ビューポート（CSS px）, intensity: 0..1
  draw(rect, intensity, t, tint = '255,255,255') {
    if (intensity <= 0.01) return;
    this.dirty = true;
    const g = this.g, d = this.dpr;
    const cx = (rect.x + rect.w / 2) * d, cy = (rect.y + rect.h * 0.45) * d;
    const R = Math.hypot(rect.w, rect.h) * 0.62 * d;
    g.save();
    g.beginPath();
    g.rect(rect.x * d, rect.y * d, rect.w * d, rect.h * d);
    g.clip();
    const n = Math.floor(this.lines.length * clamp(intensity, 0, 1));
    for (let i = 0; i < n; i++) {
      const ln = this.lines[i];
      const flick = (Math.sin(t * 23 + ln.ph * 40) + 1) / 2;
      if (flick < 0.3) continue;
      const a = ln.a + Math.sin(t * 3 + i) * 0.01;
      const inner = R * (1 - ln.l * (0.7 + intensity * 0.7));
      const ca = Math.cos(a), sa = Math.sin(a);
      const w = ln.w * d * (0.8 + intensity);
      g.beginPath();
      g.moveTo(cx + ca * R, cy + sa * R);
      g.lineTo(cx + ca * inner - sa * w * 0.1, cy + sa * inner + ca * w * 0.1);
      g.lineTo(cx + ca * R - sa * w, cy + sa * R + ca * w);
      g.closePath();
      g.fillStyle = `rgba(${tint},${0.22 + intensity * 0.5 * flick})`;
      g.fill();
    }
    g.restore();
  }
}

// 風のすじ（3D、カメラの周囲）
export class WindStreaks {
  constructor(scene, layer) {
    const n = 70;
    this.n = n;
    this.pos = new Float32Array(n * 6);
    this.seeds = [];
    for (let i = 0; i < n; i++) this.seeds.push({ x: 0, y: 0, z: 0, len: 0.4 + Math.random() * 1.2 });
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    this.mat = new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, depthWrite: false });
    this.lines = new THREE.LineSegments(g, this.mat);
    this.lines.frustumCulled = false;
    this.lines.layers.set(layer);
    scene.add(this.lines);
    this.inited = false;
    this._f = new THREE.Vector3();
    this._r = new THREE.Vector3();
    this._u = new THREE.Vector3();
  }

  respawn(s, cam, f, r, u, anywhere) {
    const dist = anywhere ? 2 + Math.random() * 40 : 30 + Math.random() * 12;
    const rx = (Math.random() - 0.5) * 16, uy = (Math.random() - 0.3) * 7;
    if (Math.abs(rx) < 1.2 && Math.abs(uy) < 1.2) return this.respawn(s, cam, f, r, u, anywhere);
    s.x = cam.position.x + f.x * dist + r.x * rx + u.x * uy;
    s.y = cam.position.y + f.y * dist + r.y * rx + u.y * uy;
    s.z = cam.position.z + f.z * dist + r.z * rx + u.z * uy;
  }

  update(dt, cam, speed, intensity) {
    const f = cam.getWorldDirection(this._f);
    const r = this._r.crossVectors(f, cam.up).normalize();
    const u = this._u.crossVectors(r, f).normalize();
    this.mat.opacity = clamp(intensity, 0, 1) * 0.3;
    this.lines.visible = this.mat.opacity > 0.02;
    if (!this.lines.visible) { this.inited = false; return; }
    for (let i = 0; i < this.n; i++) {
      const s = this.seeds[i];
      if (!this.inited) this.respawn(s, cam, f, r, u, true);
      // カメラ前方からの相対位置
      const dx = s.x - cam.position.x, dy = s.y - cam.position.y, dz = s.z - cam.position.z;
      const along = dx * f.x + dy * f.y + dz * f.z;
      if (along < -2) this.respawn(s, cam, f, r, u, false);
      s.x -= f.x * speed * dt * 1.6;
      s.y -= f.y * speed * dt * 1.6;
      s.z -= f.z * speed * dt * 1.6;
      const l = s.len * (0.4 + speed / 25);
      this.pos.set([s.x, s.y, s.z, s.x + f.x * l, s.y + f.y * l, s.z + f.z * l], i * 6);
    }
    this.inited = true;
    this.lines.geometry.attributes.position.needsUpdate = true;
  }

  dispose(scene) {
    scene.remove(this.lines);
    this.lines.geometry.dispose();
    this.mat.dispose();
  }
}

// 紙吹雪
export class Confetti {
  constructor(scene) {
    this.n = 380;
    const g = new THREE.PlaneGeometry(0.14, 0.09);
    this.mat = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide });
    this.mesh = new THREE.InstancedMesh(g, this.mat, this.n);
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;
    this.parts = [];
    const cols = [0xff4f8b, 0xffd23f, 0x3ec6ff, 0x7dff9a, 0xc38bff, 0xffffff, 0xff9f1c];
    const c = new THREE.Color();
    for (let i = 0; i < this.n; i++) {
      this.mesh.setColorAt(i, c.set(cols[i % cols.length]));
      this.parts.push({ p: new THREE.Vector3(), v: new THREE.Vector3(), r: new THREE.Euler(), w: new THREE.Vector3(), life: 0 });
    }
    this.mesh.instanceColor.needsUpdate = true;
    scene.add(this.mesh);
    this._m = new THREE.Matrix4();
    this._q = new THREE.Quaternion();
    this._s = new THREE.Vector3(1, 1, 1);
    this.active = false;
  }

  burst(center, up = 6) {
    for (const p of this.parts) {
      p.p.set(center.x + (Math.random() - 0.5) * 8, center.y + up + Math.random() * 5, center.z + (Math.random() - 0.5) * 8);
      p.v.set((Math.random() - 0.5) * 3, Math.random() * 2, (Math.random() - 0.5) * 3);
      p.r.set(Math.random() * 6, Math.random() * 6, Math.random() * 6);
      p.w.set((Math.random() - 0.5) * 10, (Math.random() - 0.5) * 10, (Math.random() - 0.5) * 10);
      p.life = 5 + Math.random() * 3;
    }
    this.mesh.count = this.n;
    this.active = true;
  }

  update(dt) {
    if (!this.active) return;
    let alive = 0;
    this.parts.forEach((p, i) => {
      if (p.life <= 0) { this._s.setScalar(0); }
      else {
        alive++;
        p.life -= dt;
        p.v.y -= 2.2 * dt;
        p.v.multiplyScalar(Math.exp(-1.2 * dt));
        p.p.addScaledVector(p.v, dt);
        p.p.x += Math.sin(p.life * 3 + i) * dt * 0.6;
        p.r.x += p.w.x * dt; p.r.y += p.w.y * dt; p.r.z += p.w.z * dt;
        this._s.setScalar(1);
      }
      this._q.setFromEuler(p.r);
      this._m.compose(p.p, this._q, this._s);
      this.mesh.setMatrixAt(i, this._m);
    });
    this.mesh.instanceMatrix.needsUpdate = true;
    if (!alive) { this.active = false; this.mesh.count = 0; }
  }

  dispose(scene) {
    scene.remove(this.mesh);
    this.mesh.geometry.dispose();
    this.mat.dispose();
  }
}
