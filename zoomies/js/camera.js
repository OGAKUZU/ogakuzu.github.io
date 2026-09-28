// カメラ：追従・サイド・正面・ヘリ・一人称 と演出（イントロ・ゴール・タイトル）
import * as THREE from 'three';
import { clamp, damp, lerp, smoothNoise1, TAU } from './util.js';

export const CAM_MODES = [
  { id: 'chase', label: '追走カメラ' },
  { id: 'close', label: 'ローアングル' },
  { id: 'side', label: 'サイドカメラ' },
  { id: 'front', label: 'フロントカメラ' },
  { id: 'heli', label: 'ヘリカメラ' },
  { id: 'fpv', label: '一人称' },
];

export class CameraRig {
  constructor(camera, course, seed = 0) {
    this.cam = camera;
    this.course = course;
    this.mode = 'chase';
    this.pos = new THREE.Vector3();
    this.look = new THREE.Vector3();
    this.dPos = new THREE.Vector3();
    this.dLook = new THREE.Vector3();
    this.init = false;
    this.sprintB = 0;
    this.fov = 62;
    this.seed = seed * 17.3;
    this.time = 0;
    this.shake = 0;
    this.kick = 0;
    this.cine = null; // { type, t, ... }
    this._p = new THREE.Vector3();
    this._q = new THREE.Vector3();
    this._smp = { x: 0, y: 0, z: 0, tx: 0, tz: 1, grade: 0, curv: 0 };
  }

  setCourse(course) {
    this.course = course;
    this.init = false;
  }

  cycle() {
    const i = CAM_MODES.findIndex((m) => m.id === this.mode);
    const next = CAM_MODES[(i + 1) % CAM_MODES.length];
    this.mode = next.id;
    this.init = false;
    return next.label;
  }

  cinematic(type, opts = {}) {
    this.cine = { type, t: 0, ...opts };
    if (type !== 'intro') this.init = false;
  }

  clearCinematic() {
    this.cine = null;
  }

  punch(amount = 1) {
    this.kick = Math.max(this.kick, amount);
  }

  // コース上の点（横オフセット・高さ込み）
  at(s, lat, up, out) {
    this.course.worldPos(s, lat, out);
    out.y += up;
    return out;
  }

  update(dt, rider, opts = {}) {
    this.time += dt;
    const t = this.time;
    const s = rider ? rider.dist : opts.s || 0;
    const lat = rider ? rider.lat : 0;
    const v = rider ? rider.v : 0;
    const kmh = v * 3.6;
    const sprint = rider && (rider.standing || (rider.power > rider.cp * 1.6)) ? 1 : 0;
    this.sprintB = damp(this.sprintB, sprint, 3, dt);
    const sb = this.sprintB;
    const P = this.dPos, L = this.dLook;
    let lambda = 7, lookLambda = 10;
    let fov = 62;
    let shakeAmt = 0;

    const cine = this.cine;
    if (cine) cine.t += dt;

    if (cine && cine.type === 'intro') {
      // スタート前：グリッドのまわりを旋回
      const c = cine.center ?? s;
      const a = -1.2 + cine.t * 0.32;
      const r = 13 - Math.min(cine.t, 4) * 1.2;
      this.at(c - 4 + Math.cos(a) * r, Math.sin(a) * r * 0.55, 2.2 + Math.max(0, 3 - cine.t) * 1.3, P);
      this.at(c - 3, 0, 1.0, L);
      lambda = 3;
      fov = 55;
    } else if (cine && cine.type === 'finish') {
      // ゴール後：ライダーのまわりをゆっくり回る
      const a = cine.t * 0.35 + 0.6;
      this.at(s + Math.cos(a) * 4.2, lat + Math.sin(a) * 3.2, 1.35 + Math.sin(cine.t * 0.5) * 0.3, P);
      this.at(s, lat, 1.0, L);
      lambda = 4;
      fov = 50;
    } else if (cine && cine.type === 'photo') {
      // 写真判定：ゴールライン横から
      const fl = cine.line;
      this.at(fl + 0.5, -(this.course.halfWidth + 3.2), 1.0, P);
      this.at(fl, 0.5, 0.8, L);
      lambda = 20;
      lookLambda = 20;
      fov = 42;
    } else if (cine && cine.type === 'preview') {
      // キャラクター選択：その場で旋回
      const a = cine.t * 0.45;
      this.at(s + Math.cos(a) * 3.0 + 0.3, lat + Math.sin(a) * 3.0, 1.25, P);
      this.at(s + 0.1, lat, 0.95, L);
      lambda = 5;
      fov = 44;
    } else if (cine && cine.type === 'attract') {
      // タイトル画面：ショットを切り替え
      const shot = Math.floor(cine.t / 7) % 5;
      const u = (cine.t % 7) / 7;
      lambda = 4;
      if (shot !== cine.lastShot) {
        cine.lastShot = shot;
        cine.anchor = s + 30;
        this.init = false;
      }
      if (shot === 0) {
        this.at(s + 2 - u * 4, -(this.course.halfWidth + 3.5), 1.5, P);
        this.at(s - 1, lat * 0.5, 0.9, L);
        fov = 38;
      } else if (shot === 1) {
        this.at(s + 8, lat * 0.4, 1.3, P);
        this.at(s - 3, lat, 1.0, L);
        fov = 42;
      } else if (shot === 2) {
        this.at(s - 22 + u * 10, lat + 10, 12, P);
        this.at(s + 6, 0, 0, L);
        fov = 55;
      } else if (shot === 3) {
        // 路肩に固定したカメラの前を集団が駆け抜ける
        this.at(cine.anchor, this.course.halfWidth + 1.5, 0.7, P);
        this.at(s, lat, 1.0, L);
        lambda = 30;
        fov = 48;
      } else {
        this.at(s - 5, lat + 1.2, 2.3, P);
        this.at(s + 8, lat, 0.9, L);
        fov = 60;
      }
    } else {
      switch (this.mode) {
        case 'close': {
          const back = 2.7 - clamp((kmh - 30) / 40, 0, 1) * 0.35;
          this.at(s - back, lat * 0.9, 1.05 - sb * 0.15, P);
          this.at(s + 5, lat * 0.8, 0.95, L);
          fov = 66 + clamp((kmh - 25) * 0.4, 0, 22) + sb * 8;
          shakeAmt = 1.2;
          lambda = 12;
          break;
        }
        case 'side': {
          this.at(s + 0.6 + v * 0.05, lat - 3.9, 1.15, P);
          this.at(s + 0.3 + v * 0.05, lat, 0.85, L);
          fov = 48 + clamp((kmh - 30) * 0.2, 0, 10);
          lambda = 16;
          lookLambda = 20;
          break;
        }
        case 'front': {
          this.at(s + 3.6 + sb * 0.6 + v * 0.06, lat + 0.5, 1.45, P);
          this.at(s - 2.5, lat, 1.0, L);
          fov = 55 + sb * 6;
          lambda = 16;
          lookLambda = 20;
          break;
        }
        case 'heli': {
          this.at(s - 15, lat + 5, 12.5, P);
          this.at(s + 8, lat * 0.5, 0.5, L);
          fov = 55;
          lambda = 7;
          lookLambda = 12;
          break;
        }
        case 'fpv': {
          this.at(s + 0.35, lat, 1.42, P);
          this.at(s + 22, lat, 1.1, L);
          fov = 70 + clamp((kmh - 25) * 0.35, 0, 18) + sb * 6;
          shakeAmt = 0.8;
          lambda = 30;
          lookLambda = 14;
          break;
        }
        default: {
          const push = clamp((kmh - 28) / 40, 0, 1);
          const back = 5.6 - push * 0.9 - sb * 1.2;
          const up = 2.65 - push * 0.3 - sb * 0.7;
          this.at(s - back, lat * 0.75, up, P);
          this.at(s + 5.5, lat * 0.6, 0.85 - sb * 0.1, L);
          fov = 60 + clamp((kmh - 25) * 0.38, 0, 22) + sb * 7;
          shakeAmt = 1;
          lambda = 8;
        }
      }
    }

    // 路面より下に潜らない
    const ground = this.course.worldPos(s, 0, this._q).y;
    if (P.y < ground + 0.45 && !(cine && cine.type === 'attract')) P.y = Math.max(P.y, ground + 0.45);

    if (!this.init) {
      this.pos.copy(P);
      this.look.copy(L);
      this.fov = fov;
      this.init = true;
    } else {
      const k = 1 - Math.exp(-lambda * dt);
      const kl = 1 - Math.exp(-lookLambda * dt);
      this.pos.lerp(P, k);
      this.look.lerp(L, kl);
      this.fov = damp(this.fov, fov, 3, dt);
    }

    // 揺れ（速度とスプリントに応じて）
    this.kick = Math.max(0, this.kick - dt * 2.5);
    const amp = shakeAmt * (clamp((v / 13) ** 2, 0, 1.6) * 0.018 + sb * 0.03) + this.kick * 0.06;
    const cam = this.cam;
    cam.position.copy(this.pos);
    if (amp > 0) {
      cam.position.x += smoothNoise1(t * 13, this.seed) * amp;
      cam.position.y += smoothNoise1(t * 17, this.seed + 3) * amp;
      cam.position.z += smoothNoise1(t * 11, this.seed + 7) * amp;
    }
    cam.lookAt(this.look);
    if (this.mode === 'chase' || this.mode === 'close') {
      // コーナーで少しロール
      const c = this.course.sample(s, this._smp);
      cam.rotateZ(clamp(c.curv * v * v * 0.02, -0.08, 0.08) * (cine ? 0 : 1));
    }
    const f = this.fov + (opts.fovKick || 0);
    if (Math.abs(cam.fov - f) > 0.01) {
      cam.fov = f;
      cam.updateProjectionMatrix();
    }
  }
}
