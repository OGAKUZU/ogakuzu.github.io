// サウンド：風切り音・歓声・フリーホイール・効果音・チップチューンBGM・実況ボイス
import { clamp } from './util.js';

const midi = (m) => 440 * Math.pow(2, (m - 69) / 12);

// C - G - Am - F
const CHORDS = [[60, 64, 67], [55, 59, 62], [57, 60, 64], [53, 57, 60]];
const BASS = [1, 0, 0, 1, 0, 0, 1, 0, 1, 0, 0, 1, 0, 0, 1, 0];
// 64 ステップのメロディ（null は休符）
const MEL = [
  76, null, 79, null, 84, null, 79, null, 81, null, 79, null, 76, null, null, null,
  74, null, 79, null, 83, null, 79, null, 81, null, 79, null, 74, null, null, null,
  72, null, 76, null, 81, null, 76, null, 79, null, 76, null, 72, null, 74, null,
  77, null, 81, null, 84, null, 81, null, 79, null, null, null, 83, null, 86, null,
];
const MENU_MEL = [
  72, null, null, 76, null, null, 79, null, 77, null, 76, null, 74, null, null, null,
  71, null, null, 74, null, null, 79, null, 77, null, 74, null, 71, null, null, null,
  69, null, null, 72, null, null, 76, null, 74, null, 72, null, 69, null, 72, null,
  65, null, null, 69, null, null, 72, null, 74, null, 76, null, 79, null, null, null,
];

export class AudioEngine {
  constructor(settings) {
    this.settings = settings;
    this.ctx = null;
    this.level = 1;
    this.musicMode = 'off';
    this.muted = false;
    this.voicePri = 0;
    this.nextBeat = 0;
    this._jaVoice = undefined;
  }

  init() {
    if (this.ctx) { this.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = (this.ctx = new AC());
    this.master = ctx.createGain();
    this.master.gain.value = this.muted ? 0 : this.settings.volume;
    this.master.connect(ctx.destination);
    this.comp = ctx.createDynamicsCompressor();
    this.comp.threshold.value = -12;
    this.comp.ratio.value = 4;
    this.comp.connect(this.master);
    this.sfx = ctx.createGain();
    this.sfx.gain.value = 0.85;
    this.sfx.connect(this.comp);
    this.musicBus = ctx.createGain();
    this.musicBus.gain.value = this.settings.music ? 0.2 : 0;
    this.musicBus.connect(this.comp);
    this.amb = ctx.createGain();
    this.amb.gain.value = 1;
    this.amb.connect(this.comp);

    // ノイズ
    const len = ctx.sampleRate * 2;
    this.white = ctx.createBuffer(1, len, ctx.sampleRate);
    const w = this.white.getChannelData(0);
    for (let i = 0; i < len; i++) w[i] = Math.random() * 2 - 1;
    this.pink = ctx.createBuffer(1, len, ctx.sampleRate);
    const p = this.pink.getChannelData(0);
    let b0 = 0, b1 = 0, b2 = 0;
    for (let i = 0; i < len; i++) {
      const x = Math.random() * 2 - 1;
      b0 = 0.99765 * b0 + x * 0.099046;
      b1 = 0.963 * b1 + x * 0.2965164;
      b2 = 0.57 * b2 + x * 1.0526913;
      p[i] = (b0 + b1 + b2 + x * 0.1848) * 0.18;
    }

    // 風切り音
    this.windG = ctx.createGain();
    this.windG.gain.value = 0;
    this.windF = ctx.createBiquadFilter();
    this.windF.type = 'lowpass';
    this.windF.frequency.value = 500;
    this.loop(this.pink).connect(this.windF).connect(this.windG).connect(this.amb);
    // 路面の振動音
    this.rumbleG = ctx.createGain();
    this.rumbleG.gain.value = 0;
    const rf = ctx.createBiquadFilter();
    rf.type = 'lowpass';
    rf.frequency.value = 140;
    this.loop(this.white).connect(rf).connect(this.rumbleG).connect(this.amb);
    // 歓声
    this.crowdG = ctx.createGain();
    this.crowdG.gain.value = 0;
    const cf = ctx.createBiquadFilter();
    cf.type = 'bandpass';
    cf.frequency.value = 1100;
    cf.Q.value = 0.6;
    const cf2 = ctx.createBiquadFilter();
    cf2.type = 'peaking';
    cf2.frequency.value = 2600;
    cf2.gain.value = 8;
    this.loop(this.pink).connect(cf).connect(cf2).connect(this.crowdG).connect(this.amb);
    // フリーホイールのカチカチ音
    const cb = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const cd = cb.getChannelData(0);
    const clicks = 36;
    for (let k = 0; k < clicks; k++) {
      const start = Math.floor((k / clicks) * ctx.sampleRate + Math.random() * 120);
      for (let i = 0; i < 220; i++) cd[start + i] = (Math.random() * 2 - 1) * Math.exp(-i / 30) * 0.8;
    }
    this.fwSrc = ctx.createBufferSource();
    this.fwSrc.buffer = cb;
    this.fwSrc.loop = true;
    const fh = ctx.createBiquadFilter();
    fh.type = 'highpass';
    fh.frequency.value = 2500;
    this.fwG = ctx.createGain();
    this.fwG.gain.value = 0;
    this.fwSrc.connect(fh).connect(this.fwG).connect(this.amb);
    this.fwSrc.start();

    this.step = 0;
    this.nextTime = ctx.currentTime + 0.1;
    this.bpm = 140;
    this.seqTimer = setInterval(() => this.schedule(), 25);
  }

  resume() {
    if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume();
  }

  loop(buf) {
    const s = this.ctx.createBufferSource();
    s.buffer = buf;
    s.loop = true;
    s.loopStart = Math.random();
    s.start(0, Math.random() * 1.5);
    return s;
  }

  setVolume(v) {
    this.settings.volume = v;
    if (this.master) this.master.gain.setTargetAtTime(this.muted ? 0 : v, this.ctx.currentTime, 0.05);
  }

  toggleMute() {
    this.muted = !this.muted;
    this.setVolume(this.settings.volume);
    if (this.muted && 'speechSynthesis' in window) speechSynthesis.cancel();
    return this.muted;
  }

  setMusic(on) {
    this.settings.music = on;
    if (this.musicBus) this.musicBus.gain.setTargetAtTime(on ? 0.2 : 0, this.ctx.currentTime, 0.2);
  }

  setMusicMode(mode) {
    this.musicMode = mode;
  }

  setLevel(l) {
    this.level = l;
  }

  // ---------------------------------------------------------------
  schedule() {
    const ctx = this.ctx;
    if (!ctx) return;
    const spb = 60 / this.bpm / 4;
    while (this.nextTime < ctx.currentTime + 0.12) {
      if (this.musicMode !== 'off' && this.settings.music && !this.muted) this.playStep(this.step, this.nextTime);
      this.nextTime += spb;
      this.step = (this.step + 1) % 64;
    }
  }

  playStep(st, time) {
    const bar = Math.floor(st / 16), s = st % 16;
    const chord = CHORDS[bar];
    const menu = this.musicMode === 'menu';
    const lvl = menu ? 0 : this.level;
    const bus = this.musicBus;
    // ドラム
    if (lvl >= 1) {
      if (s % 4 === 0 && (lvl >= 2 || s % 8 === 0)) this.kick(time);
      if (s === 4 || s === 12) this.snare(time, 0.32);
      if (lvl >= 3 && (s === 14 || s === 15)) this.snare(time, 0.18);
      if (s % 2 === 0) this.hat(time, s % 4 === 2 ? 0.55 : 0.3);
      else if (lvl >= 2) this.hat(time, 0.18);
    } else if (s % 4 === 2) {
      this.hat(time, 0.2);
    }
    // ベース
    if (BASS[s]) {
      const n = chord[0] - 24 + (s === 14 ? 7 : 0);
      this.tone(midi(n), time, 0.2, 'triangle', 0.5, bus);
      if (lvl >= 1) this.tone(midi(n + 12), time, 0.08, 'square', 0.06, bus);
    }
    // コード
    if (s % 4 === 2 || (lvl >= 2 && s % 4 === 3 && s > 8)) {
      for (const n of chord) this.tone(midi(n), time, 0.12, 'square', 0.035, bus);
    }
    // メロディ
    const mel = menu ? MENU_MEL[st] : MEL[st];
    if (mel && (menu || lvl >= 2)) {
      const up = lvl >= 3 ? 12 : 0;
      this.tone(midi(mel + up), time, menu ? 0.32 : 0.22, 'square', menu ? 0.09 : 0.1, bus, 0.01, true);
    }
    if (lvl >= 3 || (menu && s % 2 === 1 && bar === 3)) {
      const n = chord[s % 3] + 12;
      this.tone(midi(n), time, 0.06, 'square', 0.03, bus);
    }
  }

  tone(freq, time, dur, type, gain, dest = this.sfx, attack = 0.005, vib = false) {
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, time);
    if (vib) {
      const l = ctx.createOscillator();
      const lg = ctx.createGain();
      l.frequency.value = 6;
      lg.gain.value = freq * 0.006;
      l.connect(lg).connect(o.frequency);
      l.start(time);
      l.stop(time + dur + 0.05);
    }
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, time);
    g.gain.linearRampToValueAtTime(gain, time + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, time + dur);
    o.connect(g).connect(dest);
    o.start(time);
    o.stop(time + dur + 0.05);
  }

  noise(time, dur, gain, filterType, freq, dest = this.sfx, q = 0.7, freqEnd = null) {
    const ctx = this.ctx;
    const s = ctx.createBufferSource();
    s.buffer = this.white;
    const f = ctx.createBiquadFilter();
    f.type = filterType;
    f.frequency.setValueAtTime(freq, time);
    if (freqEnd) f.frequency.exponentialRampToValueAtTime(freqEnd, time + dur);
    f.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, time);
    g.gain.exponentialRampToValueAtTime(0.0001, time + dur);
    s.connect(f).connect(g).connect(dest);
    s.start(time, Math.random() * 1.5);
    s.stop(time + dur + 0.05);
  }

  kick(time) {
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    o.frequency.setValueAtTime(150, time);
    o.frequency.exponentialRampToValueAtTime(45, time + 0.12);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.85, time);
    g.gain.exponentialRampToValueAtTime(0.0001, time + 0.26);
    o.connect(g).connect(this.musicBus);
    o.start(time);
    o.stop(time + 0.3);
  }

  snare(time, gain) {
    this.noise(time, 0.14, gain, 'highpass', 1400, this.musicBus);
    this.tone(190, time, 0.08, 'triangle', gain * 0.8, this.musicBus);
  }

  hat(time, gain) {
    this.noise(time, 0.035, gain * 0.28, 'highpass', 7500, this.musicBus);
  }

  // ---------------------------------------------------------------
  // 効果音
  now() {
    return this.ctx ? this.ctx.currentTime : 0;
  }

  countdown(n) {
    if (!this.ctx) return;
    this.tone(n > 0 ? 660 : 1320, this.now(), n > 0 ? 0.18 : 0.6, 'square', 0.25);
    if (n <= 0) {
      const t = this.now();
      [72, 76, 79, 84].forEach((m, i) => this.tone(midi(m), t + i * 0.05, 0.5, 'square', 0.08));
    }
  }

  ding() {
    if (!this.ctx) return;
    const t = this.now();
    this.tone(1047, t, 0.15, 'triangle', 0.25);
    this.tone(1568, t + 0.08, 0.25, 'triangle', 0.22);
  }

  down() {
    if (!this.ctx) return;
    const t = this.now();
    this.tone(392, t, 0.15, 'triangle', 0.2);
    this.tone(311, t + 0.1, 0.2, 'triangle', 0.18);
  }

  whoosh() {
    if (!this.ctx) return;
    this.noise(this.now(), 0.5, 0.5, 'bandpass', 350, this.sfx, 1.2, 3200);
  }

  itemGet() {
    if (!this.ctx) return;
    const t = this.now();
    [84, 88, 91, 96].forEach((m, i) => this.tone(midi(m), t + i * 0.06, 0.18, 'square', 0.12));
  }

  itemUse() {
    if (!this.ctx) return;
    const ctx = this.ctx, t = this.now();
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(400, t);
    o.frequency.exponentialRampToValueAtTime(1800, t + 0.45);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.25, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.55);
    o.connect(g).connect(this.sfx);
    o.start(t);
    o.stop(t + 0.6);
    this.noise(t, 0.6, 0.25, 'bandpass', 800, this.sfx, 1, 5000);
  }

  fanfare(big = false) {
    if (!this.ctx) return;
    const t = this.now();
    const seq = big ? [[72, 0], [76, 0.12], [79, 0.24], [84, 0.36], [79, 0.6], [84, 0.72]] : [[76, 0], [79, 0.1], [84, 0.2]];
    for (const [m, d] of seq) {
      this.tone(midi(m), t + d, 0.3, 'square', 0.12);
      this.tone(midi(m - 12), t + d, 0.3, 'triangle', 0.15);
    }
  }

  winJingle() {
    if (!this.ctx) return;
    const t = this.now();
    const seq = [[72, 0, 0.15], [72, 0.15, 0.15], [72, 0.3, 0.15], [72, 0.45, 0.45], [68, 0.95, 0.45], [70, 1.45, 0.45], [72, 1.95, 0.25], [70, 2.25, 0.15], [72, 2.45, 1.2]];
    for (const [m, d, len] of seq) {
      this.tone(midi(m + 12), t + d, len, 'square', 0.12);
      this.tone(midi(m), t + d, len, 'triangle', 0.14);
    }
  }

  blown() {
    if (!this.ctx) return;
    const ctx = this.ctx, t = this.now();
    const o = ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(330, t);
    o.frequency.exponentialRampToValueAtTime(110, t + 0.9);
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 900;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.18, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 1);
    o.connect(f).connect(g).connect(this.sfx);
    o.start(t);
    o.stop(t + 1.05);
  }

  cheer() {
    if (!this.ctx) return;
    const t = this.now();
    this.noise(t, 1.8, 0.35, 'bandpass', 1400, this.sfx, 0.5, 1800);
  }

  heartbeat(gain) {
    if (!this.ctx) return;
    const t = this.now();
    this.tone(58, t, 0.16, 'sine', gain);
    this.tone(52, t + 0.18, 0.18, 'sine', gain * 0.8);
  }

  // 走行中の環境音
  updateRide({ speed = 0, coasting = false, crowd = 0, danger = 0, hr = 120, active = true, dt = 0.016 }) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const v = active ? speed : 0;
    this.windG.gain.setTargetAtTime(clamp((v / 17) ** 2, 0, 1.6) * 0.2, t, 0.12);
    this.windF.frequency.setTargetAtTime(280 + v * 95, t, 0.12);
    this.rumbleG.gain.setTargetAtTime(clamp(v / 22, 0, 1) * 0.1, t, 0.1);
    const swell = 0.75 + 0.25 * Math.sin(t * 2.3) * Math.sin(t * 0.7);
    this.crowdG.gain.setTargetAtTime(active ? crowd * 0.32 * swell : 0, t, 0.35);
    this.fwG.gain.setTargetAtTime(active && coasting && v > 1 ? 0.14 : 0, t, 0.05);
    this.fwSrc.playbackRate.setTargetAtTime(clamp(v / 9, 0.2, 3), t, 0.1);
    if (active && danger > 0) {
      this.nextBeat -= dt;
      if (this.nextBeat <= 0) {
        this.nextBeat = 60 / clamp(hr || 150, 90, 200);
        this.heartbeat(0.35 * danger);
      }
    }
  }

  // ---------------------------------------------------------------
  // 実況ボイス（Web Speech API）
  jaVoice() {
    if (this._jaVoice !== undefined) return this._jaVoice;
    const vs = window.speechSynthesis ? speechSynthesis.getVoices() : [];
    if (!vs.length) return null;
    this._jaVoice = vs.find((v) => v.lang === 'ja-JP' && /Google/.test(v.name)) || vs.find((v) => v.lang && v.lang.startsWith('ja')) || null;
    return this._jaVoice;
  }

  say(text, priority = 1) {
    if (!this.settings.voice || this.muted || !('speechSynthesis' in window)) return;
    try {
      if (speechSynthesis.speaking || speechSynthesis.pending) {
        if (priority <= this.voicePri) return;
        speechSynthesis.cancel();
      }
      const u = new SpeechSynthesisUtterance(text);
      u.lang = 'ja-JP';
      u.rate = 1.15;
      u.pitch = 1.1;
      u.volume = clamp(this.settings.volume * 1.1, 0, 1);
      const v = this.jaVoice();
      if (v) u.voice = v;
      this.voicePri = priority;
      u.onend = () => { this.voicePri = 0; };
      u.onerror = () => { this.voicePri = 0; };
      speechSynthesis.speak(u);
    } catch (e) { /* noop */ }
  }
}
