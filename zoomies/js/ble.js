// Web Bluetooth：パワーメーター / スマートトレーナー(FTMS) / 心拍計 / ケイデンスセンサー
import { Emitter } from './util.js';

export const SVC = { CPS: 0x1818, FTMS: 0x1826, HRS: 0x180d, CSC: 0x1816 };
export const CHR = {
  CPM: 0x2a63, // Cycling Power Measurement
  IBD: 0x2ad2, // Indoor Bike Data
  FMCP: 0x2ad9, // Fitness Machine Control Point
  FMF: 0x2acc, // Fitness Machine Feature
  HRM: 0x2a37, // Heart Rate Measurement
  CSCM: 0x2a5b, // CSC Measurement
};

// ---------------------------------------------------------------
// パーサ（GATT 仕様に準拠、リトルエンディアン）
export function parseCyclingPower(dv) {
  let o = 0;
  const flags = dv.getUint16(o, true);
  o += 2;
  const out = { power: dv.getInt16(o, true) };
  o += 2;
  const has = (n) => o + n <= dv.byteLength;
  if (flags & 0x0001) { if (has(1)) out.balance = dv.getUint8(o) / 2; o += 1; }
  if (flags & 0x0004) o += 2; // Accumulated Torque
  if (flags & 0x0010) {
    if (has(6)) { out.wheelRevs = dv.getUint32(o, true); out.wheelTime = dv.getUint16(o + 4, true); }
    o += 6;
  }
  if (flags & 0x0020) {
    if (has(4)) { out.crankRevs = dv.getUint16(o, true); out.crankTime = dv.getUint16(o + 2, true); }
    o += 4;
  }
  return out;
}

export function parseIndoorBikeData(dv) {
  let o = 0;
  const flags = dv.getUint16(o, true);
  o += 2;
  const out = {};
  const has = (n) => o + n <= dv.byteLength;
  // bit0 = More Data（0 のとき瞬間速度あり）
  if (!(flags & 0x0001)) { if (has(2)) out.speed = dv.getUint16(o, true) / 100; o += 2; }
  if (flags & 0x0002) o += 2; // 平均速度
  if (flags & 0x0004) { if (has(2)) out.cadence = dv.getUint16(o, true) / 2; o += 2; }
  if (flags & 0x0008) o += 2; // 平均ケイデンス
  if (flags & 0x0010) o += 3; // 総距離
  if (flags & 0x0020) o += 2; // 負荷レベル
  if (flags & 0x0040) { if (has(2)) out.power = dv.getInt16(o, true); o += 2; }
  if (flags & 0x0080) o += 2; // 平均パワー
  if (flags & 0x0100) o += 5; // 消費エネルギー
  if (flags & 0x0200) { if (has(1)) out.hr = dv.getUint8(o); o += 1; }
  return out;
}

export function parseHeartRate(dv) {
  const flags = dv.getUint8(0);
  return { hr: flags & 0x01 ? dv.getUint16(1, true) : dv.getUint8(1) };
}

export function parseCSC(dv) {
  let o = 0;
  const flags = dv.getUint8(o);
  o += 1;
  const out = {};
  if (flags & 0x01) { out.wheelRevs = dv.getUint32(o, true); out.wheelTime = dv.getUint16(o + 4, true); o += 6; }
  if (flags & 0x02) { out.crankRevs = dv.getUint16(o, true); out.crankTime = dv.getUint16(o + 2, true); o += 4; }
  return out;
}

// SIM モード（勾配）コマンド: Op 0x11
export function simCommand(gradePct, crr = 0.004, cw = 0.51, windMs = 0) {
  const buf = new ArrayBuffer(7);
  const dv = new DataView(buf);
  dv.setUint8(0, 0x11);
  dv.setInt16(1, Math.round(Math.max(-32, Math.min(32, windMs)) * 1000), true);
  dv.setInt16(3, Math.round(Math.max(-40, Math.min(40, gradePct)) * 100), true);
  dv.setUint8(5, Math.max(0, Math.min(255, Math.round(crr * 10000))));
  dv.setUint8(6, Math.max(0, Math.min(255, Math.round(cw * 100))));
  return buf;
}

// クランク回転データからケイデンスを計算
export class CadenceCalc {
  constructor() {
    this.revs = null;
    this.time = null;
    this.rpm = 0;
    this.lastEvent = 0;
  }
  update(revs, time1024, now) {
    if (this.revs !== null) {
      const dRev = (revs - this.revs + 65536) % 65536;
      const dT = ((time1024 - this.time + 65536) % 65536) / 1024;
      if (dRev > 0 && dT > 0) {
        const rpm = (dRev / dT) * 60;
        if (rpm < 230) { this.rpm = rpm; this.lastEvent = now; }
      } else if (now - this.lastEvent > 2600) {
        this.rpm = 0;
      }
    } else {
      this.lastEvent = now;
    }
    this.revs = revs;
    this.time = time1024;
    return this.rpm;
  }
}

// ---------------------------------------------------------------
export function bleSupported() {
  return typeof navigator !== 'undefined' && !!navigator.bluetooth && typeof navigator.bluetooth.requestDevice === 'function';
}

export function bleHelpText() {
  const ua = typeof navigator !== 'undefined' ? navigator.userAgent : '';
  if (/iPhone|iPad|iPod/.test(ua)) return 'iPhone / iPad の Safari は Web Bluetooth 非対応です。「Bluefy」ブラウザアプリで開くと接続できます。';
  if (typeof window !== 'undefined' && !window.isSecureContext) return 'Bluetooth 接続には HTTPS でのアクセスが必要です。';
  return 'このブラウザは Web Bluetooth に対応していません。PC / Android の Chrome または Edge をお使いください。';
}

// 1人分のデバイス群
export class DeviceSet extends Emitter {
  constructor(label) {
    super();
    this.label = label;
    this.power = { name: '', connected: false, connecting: false, source: '', watts: 0, t: 0, controllable: false, device: null };
    this.hr = { name: '', connected: false, connecting: false, bpm: 0, t: 0, device: null };
    this.cad = { name: '', connected: false, connecting: false, rpm: 0, t: 0, device: null };
    this.powerCad = new CadenceCalc();
    this.cscCad = new CadenceCalc();
    this.powerCadence = 0;
    this.powerCadT = 0;
    this.cp = null; // FTMS 制御ポイント
    this.queue = Promise.resolve();
    this.lastSim = { grade: 999, cw: 0, t: 0 };
    this.mock = null;
  }

  now() {
    return performance.now();
  }

  get powerFresh() {
    return this.power.connected && this.now() - this.power.t < 3000;
  }
  get watts() {
    return this.powerFresh ? Math.max(0, this.power.watts) : 0;
  }
  get cadence() {
    const n = this.now();
    if (this.cad.connected && n - this.cad.t < 3500) return this.cad.rpm;
    if (this.powerCadT && n - this.powerCadT < 3500) return this.powerCadence;
    return 0;
  }
  get hasCadence() {
    const n = this.now();
    return (this.cad.connected && n - this.cad.t < 3500) || (this.powerCadT && n - this.powerCadT < 3500);
  }
  get bpm() {
    return this.hr.connected && this.now() - this.hr.t < 5000 ? this.hr.bpm : 0;
  }

  changed() {
    this.emit('change', this);
  }

  // ---- 接続 ----
  async connectPower() {
    const device = await navigator.bluetooth.requestDevice({
      filters: [{ services: [SVC.FTMS] }, { services: [SVC.CPS] }],
      optionalServices: [SVC.FTMS, SVC.CPS, SVC.CSC, 'battery_service', 'device_information'],
    });
    this.power.device = device;
    this.power.name = device.name || 'パワーメーター';
    device.addEventListener('gattserverdisconnected', () => this.onDisconnect('power'));
    await this.setupPower(device);
  }

  async setupPower(device) {
    this.power.connecting = true;
    this.changed();
    try {
      const server = await device.gatt.connect();
      let gotPower = false;
      this.cp = null;
      this.power.controllable = false;
      // FTMS（スマートトレーナー）
      try {
        const ftms = await server.getPrimaryService(SVC.FTMS);
        try {
          const ibd = await ftms.getCharacteristic(CHR.IBD);
          await ibd.startNotifications();
          ibd.addEventListener('characteristicvaluechanged', (e) => this.onIndoorBike(e.target.value));
          gotPower = true;
          this.power.source = 'FTMS';
        } catch (e) { console.warn('IBD', e); }
        try {
          const cp = await ftms.getCharacteristic(CHR.FMCP);
          await cp.startNotifications();
          cp.addEventListener('characteristicvaluechanged', (e) => this.onControlResponse(e.target.value));
          this.cp = cp;
          await this.cpWrite(new Uint8Array([0x00]).buffer); // 制御権リクエスト
          await this.cpWrite(new Uint8Array([0x07]).buffer).catch(() => {}); // 開始
          this.power.controllable = true;
          this.lastSim = { grade: 999, cw: 0, t: 0 };
        } catch (e) { console.warn('FTMS control', e); }
      } catch (e) { /* FTMS なし */ }
      // Cycling Power Service（パワーメーター / トレーナー）
      try {
        const cps = await server.getPrimaryService(SVC.CPS);
        const m = await cps.getCharacteristic(CHR.CPM);
        await m.startNotifications();
        m.addEventListener('characteristicvaluechanged', (e) => this.onCyclingPower(e.target.value));
        gotPower = true;
        this.power.source = this.power.source ? 'FTMS+CPS' : 'CPS';
      } catch (e) { /* CPS なし */ }
      if (!gotPower) throw new Error('パワーを取得できるサービスが見つかりませんでした');
      this.power.connected = true;
      this.power.retries = 0;
    } finally {
      this.power.connecting = false;
      this.changed();
    }
  }

  async connectHR() {
    const device = await navigator.bluetooth.requestDevice({ filters: [{ services: [SVC.HRS] }], optionalServices: ['battery_service'] });
    this.hr.device = device;
    this.hr.name = device.name || '心拍計';
    device.addEventListener('gattserverdisconnected', () => this.onDisconnect('hr'));
    await this.setupHR(device);
  }

  async setupHR(device) {
    this.hr.connecting = true;
    this.changed();
    try {
      const server = await device.gatt.connect();
      const s = await server.getPrimaryService(SVC.HRS);
      const c = await s.getCharacteristic(CHR.HRM);
      await c.startNotifications();
      c.addEventListener('characteristicvaluechanged', (e) => {
        this.hr.bpm = parseHeartRate(e.target.value).hr;
        this.hr.t = this.now();
      });
      this.hr.connected = true;
      this.hr.retries = 0;
    } finally {
      this.hr.connecting = false;
      this.changed();
    }
  }

  async connectCadence() {
    const device = await navigator.bluetooth.requestDevice({ filters: [{ services: [SVC.CSC] }], optionalServices: ['battery_service'] });
    this.cad.device = device;
    this.cad.name = device.name || 'ケイデンス';
    device.addEventListener('gattserverdisconnected', () => this.onDisconnect('cad'));
    await this.setupCadence(device);
  }

  async setupCadence(device) {
    this.cad.connecting = true;
    this.changed();
    try {
      const server = await device.gatt.connect();
      const s = await server.getPrimaryService(SVC.CSC);
      const c = await s.getCharacteristic(CHR.CSCM);
      await c.startNotifications();
      c.addEventListener('characteristicvaluechanged', (e) => {
        const d = parseCSC(e.target.value);
        if (d.crankRevs !== undefined) {
          this.cad.rpm = this.cscCad.update(d.crankRevs, d.crankTime, this.now());
          this.cad.t = this.now();
        }
      });
      this.cad.connected = true;
      this.cad.retries = 0;
    } finally {
      this.cad.connecting = false;
      this.changed();
    }
  }

  // ---- 受信 ----
  onCyclingPower(dv) {
    const d = parseCyclingPower(dv);
    const n = this.now();
    // FTMS からもパワーが来る場合は CPS を優先
    this.power.watts = d.power;
    this.power.t = n;
    this._cpsT = n;
    if (d.crankRevs !== undefined) {
      this.powerCadence = this.powerCad.update(d.crankRevs, d.crankTime, n);
      this.powerCadT = n;
    }
  }

  onIndoorBike(dv) {
    const d = parseIndoorBikeData(dv);
    const n = this.now();
    const cpsRecent = this._cpsT && n - this._cpsT < 2500;
    if (d.power !== undefined && !cpsRecent) {
      this.power.watts = d.power;
      this.power.t = n;
    }
    if (d.cadence !== undefined && !(this.powerCadT && n - this.powerCadT < 2500 && cpsRecent)) {
      this.powerCadence = d.cadence;
      this.powerCadT = n;
    }
    if (d.hr && !this.hr.connected) {
      this.hr.bpm = d.hr;
      this.hr.t = n;
    }
  }

  onControlResponse(dv) {
    if (dv.byteLength >= 3 && dv.getUint8(0) === 0x80) {
      const op = dv.getUint8(1), result = dv.getUint8(2);
      if (result !== 0x01) console.warn(`FTMS 制御ポイント op=0x${op.toString(16)} result=${result}`);
      if (op === 0x00 && result === 0x05) this.power.controllable = false; // Control Not Permitted
    }
  }

  // GATT 操作は直列化
  cpWrite(buf) {
    const cp = this.cp;
    if (!cp) return Promise.reject(new Error('no control point'));
    const run = () => (cp.writeValueWithResponse ? cp.writeValueWithResponse(buf) : cp.writeValue(buf));
    const p = this.queue.then(run, run);
    this.queue = p.catch(() => {});
    return p;
  }

  // 勾配を送る（間引き）
  setSimulation(gradePct, cw = 0.51) {
    if (!this.cp || !this.power.connected || !this.power.controllable) return;
    const n = this.now();
    const dg = Math.abs(gradePct - this.lastSim.grade);
    const dcw = Math.abs(cw - this.lastSim.cw);
    if (n - this.lastSim.t < 1000 || (dg < 0.1 && dcw < 0.03 && n - this.lastSim.t < 5000)) return;
    this.lastSim = { grade: gradePct, cw, t: n };
    this.cpWrite(simCommand(gradePct, 0.004, cw)).catch((e) => console.warn('SIM', e));
  }

  // ---- 切断・再接続 ----
  onDisconnect(kind) {
    const st = kind === 'power' ? this.power : kind === 'hr' ? this.hr : this.cad;
    if (st.manual) return;
    st.connected = false;
    if (kind === 'power') this.cp = null;
    this.changed();
    this.emit('disconnect', { kind, name: st.name });
    st.retries = (st.retries || 0) + 1;
    if (st.retries > 6 || !st.device) return;
    const delay = Math.min(16000, 1000 * 2 ** (st.retries - 1));
    setTimeout(async () => {
      if (st.connected || st.manual) return;
      try {
        if (kind === 'power') await this.setupPower(st.device);
        else if (kind === 'hr') await this.setupHR(st.device);
        else await this.setupCadence(st.device);
        this.emit('reconnect', { kind, name: st.name });
      } catch (e) {
        this.onDisconnect(kind);
      }
    }, delay);
  }

  disconnect(kind) {
    const st = kind === 'power' ? this.power : kind === 'hr' ? this.hr : this.cad;
    st.manual = true;
    try { st.device?.gatt?.disconnect(); } catch (e) { /* noop */ }
    st.connected = false;
    st.device = null;
    st.name = '';
    if (kind === 'power') this.cp = null;
    setTimeout(() => (st.manual = false), 100);
    this.changed();
  }

  // ---- 開発用の疑似デバイス（?mockble=1）----
  startMock(ftp = 200) {
    if (this.mock) return;
    this.power.connected = true;
    this.power.name = 'デモ パワーメーター';
    this.power.source = 'MOCK';
    this.hr.connected = true;
    this.hr.name = 'デモ 心拍計';
    let t = 0;
    this.mock = setInterval(() => {
      t += 0.25;
      const n = this.now();
      this.power.watts = Math.round(ftp * (0.75 + 0.25 * Math.sin(t / 7)) + (Math.random() - 0.5) * 30);
      this.power.t = n;
      this.powerCadence = 85 + Math.sin(t / 5) * 6;
      this.powerCadT = n;
      this.hr.bpm = Math.round(140 + Math.sin(t / 9) * 12);
      this.hr.t = n;
    }, 250);
    this.changed();
  }
}
