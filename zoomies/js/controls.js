// プレイヤー入力：キーボード / タッチ（バーチャルパワー）と Bluetooth デバイス
import { clamp } from './util.js';

// キー割り当て（1人用 / 2人対戦）
export const KEYMAPS = {
  solo: {
    attack: ['ArrowUp', 'KeyW'],
    rest: ['ArrowDown', 'KeyS'],
    sprint: ['Space'],
    item: ['KeyE', 'Enter', 'ShiftLeft', 'ShiftRight'],
    left: ['ArrowLeft', 'KeyA'],
    right: ['ArrowRight', 'KeyD'],
  },
  p1: { attack: ['KeyW'], rest: ['KeyS'], sprint: ['KeyD'], item: ['KeyA'], left: [], right: [] },
  p2: { attack: ['ArrowUp'], rest: ['ArrowDown'], sprint: ['ArrowRight'], item: ['ArrowLeft'], left: [], right: [] },
};

export class PlayerControl {
  constructor(slot, devices, settings) {
    this.slot = slot;
    this.dev = devices;
    this.settings = settings;
    this.keys = { attack: false, rest: false, sprint: false, left: false, right: false };
    this.vPower = 0;
    this.cadence = 0;
    this.hr = 0;
    this.vHr = 72;
    this.manualTarget = 150;
    this.tapBoost = 0;
    this.itemQueued = false;
    this.manualLane = 0;
    this.manualLaneT = 0;
    this.sprinting = false;
    this.mode = 'auto';
    this.repeatT = 0;
  }

  get usingDevice() {
    return this.dev.power.connected;
  }

  press(action, repeat = false) {
    if (action === 'item') {
      if (!repeat) this.itemQueued = true;
      return;
    }
    if (action === 'sprint' && !repeat) this.tapBoost = Math.min(0.2, this.tapBoost + 0.035);
    if (this.settings.keyboardMode === 'manual' && (action === 'attack' || action === 'rest')) {
      if (!repeat) this.manualTarget += action === 'attack' ? 10 : -10;
      this.manualTarget = clamp(this.manualTarget, 0, 1500);
    }
    this.keys[action] = true;
  }

  release(action) {
    if (action in this.keys) this.keys[action] = false;
  }

  consumeItem() {
    const q = this.itemQueued;
    this.itemQueued = false;
    return q;
  }

  // 目標パワーを返す（ctx: ftp, wbal, exhausted, auto, idle）
  computePower(dt, ctx) {
    const ftp = ctx.ftp;
    // 横移動（手動）
    if (this.keys.left || this.keys.right) {
      this.manualLane += (this.keys.left ? 1 : 0) * 2.4 * dt - (this.keys.right ? 1 : 0) * 2.4 * dt;
      this.manualLaneT = 3;
    } else if (this.manualLaneT > 0) {
      this.manualLaneT -= dt;
    }
    // 手動モードは長押しで連続変更
    if (this.settings.keyboardMode === 'manual' && (this.keys.attack || this.keys.rest)) {
      this.repeatT += dt;
      if (this.repeatT > 0.35) {
        this.manualTarget = clamp(this.manualTarget + (this.keys.attack ? 1 : -1) * 120 * dt, 0, 1500);
      }
    } else this.repeatT = 0;

    let P;
    if (this.usingDevice) {
      P = this.dev.watts;
      this.sprinting = P > ftp * 1.7;
      this.cadence = this.dev.hasCadence ? this.dev.cadence : P > 20 ? 85 : 0;
      this.mode = 'device';
    } else {
      this.mode = this.settings.keyboardMode === 'manual' ? 'manual' : 'auto';
      let target;
      this.sprinting = this.keys.sprint && !ctx.idle;
      if (ctx.idle) target = 0;
      else if (this.keys.sprint) target = ftp * 2.8 * (0.5 + 0.5 * ctx.wbal) * (1 + this.tapBoost);
      else if (this.mode === 'manual') target = this.manualTarget;
      else if (this.keys.attack) target = ftp * 1.55;
      else if (this.keys.rest) target = ftp * 0.45;
      else target = Math.min(ctx.auto, ftp * 1.12);
      if (ctx.exhausted) target = Math.min(target, ftp * 0.8);
      const rate = target > this.vPower ? 4.5 : 7;
      this.vPower += (target - this.vPower) * Math.min(1, rate * dt);
      this.tapBoost = Math.max(0, this.tapBoost - dt * 0.45);
      P = this.vPower;
      const rel = P / ftp;
      const cad = P < 15 ? 0 : clamp(84 + 16 * clamp(rel - 0.6, 0, 1) + (this.sprinting ? 18 : 0) - (ctx.grade || 0) * 120, 60, 128);
      this.cadence += (cad - this.cadence) * Math.min(1, 4 * dt);
    }
    // 心拍：デバイスがあれば実測、なければ推定
    const bpm = this.dev.bpm;
    if (bpm) this.hr = bpm;
    else {
      const rel = P / ftp;
      const t = 68 + 112 * Math.pow(clamp(rel, 0, 1.4) / 1.4, 0.75) + (1 - (ctx.wbal ?? 1)) * 14;
      this.vHr += (t - this.vHr) * Math.min(1, dt / 10);
      this.hr = this.usingDevice ? 0 : this.vHr;
    }
    return P;
  }
}

// キーボード・タッチ入力をプレイヤーへ振り分け
export class InputManager {
  constructor() {
    this.controls = [];
    this.maps = [];
    this.handlers = {};
    this.enabled = true;
    window.addEventListener('keydown', (e) => this.onKey(e, true));
    window.addEventListener('keyup', (e) => this.onKey(e, false));
    window.addEventListener('blur', () => this.releaseAll());
  }

  bind(controls, twoPlayer) {
    this.controls = controls;
    this.maps = twoPlayer ? [KEYMAPS.p1, KEYMAPS.p2] : [KEYMAPS.solo];
    this.releaseAll();
  }

  on(name, fn) {
    this.handlers[name] = fn;
  }

  releaseAll() {
    for (const c of this.controls) for (const k of Object.keys(c.keys)) c.keys[k] = false;
  }

  onKey(e, down) {
    const tag = (e.target && e.target.tagName) || '';
    if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
    // 全体キー
    if (down && !e.repeat) {
      const g = { KeyC: 'camera', KeyP: 'pause', Escape: 'pause', KeyM: 'mute', KeyH: 'hud', KeyV: 'voice' }[e.code];
      if (g && this.handlers[g]) {
        this.handlers[g]();
        e.preventDefault();
        return;
      }
    }
    if (!this.enabled) return;
    let handled = false;
    this.maps.forEach((map, i) => {
      const ctl = this.controls[i];
      if (!ctl) return;
      for (const [action, codes] of Object.entries(map)) {
        if (codes.includes(e.code)) {
          if (down) ctl.press(action, e.repeat);
          else ctl.release(action);
          handled = true;
        }
      }
    });
    if (handled) e.preventDefault();
  }
}
