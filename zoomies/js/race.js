// レースのシミュレーション（ライダー・順位・区間・アイテム・ゴール）
import * as THREE from 'three';
import { AI_ROSTER, AI_TYPES, ANIMALS, DIFFICULTIES, POWERUPS, POWERUP_IDS } from './config.js';
import { stepSpeed, draftSaving, WPrime, BIKE_MASS, cdaForWeight } from './physics.js';
import { AIBrain, Director, followPower, lineFor } from './ai.js';
import { RiderModel } from './rider-model.js';
import { Emitter, clamp, mod, mulberry32, shuffle, lerp } from './util.js';

const GROUP_GAP = 22; // m：これ以上離れたら別集団
const PTS = [10, 6, 4, 2, 1];

export class Rider {
  constructor(o) {
    const a = ANIMALS[o.animal] || ANIMALS.cat;
    this.id = o.id;
    this.name = o.name;
    this.animal = a.id;
    this.emoji = a.emoji;
    this.cry = a.cry;
    this.jersey = o.jersey;
    this.bikeColor = o.bike;
    this.isPlayer = !!o.isPlayer;
    this.playerIndex = o.playerIndex ?? -1;
    this.rival = !!o.rival;
    this.shades = !!o.shades;
    this.type = o.type || 'rouleur';
    this.weight = o.weight;
    this.cp = o.cp;
    this.sprintPower = o.sprintPower;
    this.mass = this.weight + BIKE_MASS;
    this.cda = cdaForWeight(this.weight);
    this.wbal = new WPrime(this.cp, o.wprime);
    this.dist = 0;
    this.prevDist = 0;
    this.lat = 0;
    this.latV = 0;
    this.targetLat = 0;
    this.v = 0;
    this.power = 0;
    this.cadence = 0;
    this.hr = 72;
    this.draft = 0;
    this.brake = 0;
    this.massEff = this.mass;
    this.cdaBase = this.cda;
    this.cdaEff = this.cda;
    this.draftMul = 1;
    this.wind = 0;
    this.exhausted = false;
    this.finished = false;
    this.finishTime = 0;
    this.place = 0;
    this.item = null;
    this.active = null;
    this.komPts = 0;
    this.sprintPts = 0;
    this.lap = 0;
    this.standing = false;
    this.tuck = false;
    this.celebrate = false;
    this.happyT = 0;
    this.attackT = 0;
    this.lastAttack = -99;
    this.lastSay = -99;
    this.oi = 0; // 物理順のインデックス
    this.gi = 0; // 集団インデックス
    this.rank = 0; // 集団内の順番
    this.brain = null;
    this.model = null;
    this.control = null;
    this.stats = { time: 0, energy: 0, maxP: 0, hrSum: 0, hrT: 0, secAcc: 0, secE: 0, ring: [], np4: 0, npN: 0, elev: 0, maxV: 0 };
  }

  get wkg() {
    return this.power / this.weight;
  }
}

export class Race extends Emitter {
  constructor({ scene, course, world, mode = 'race', settings, players = [], quality, seed = 1 }) {
    super();
    this.scene = scene;
    this.course = course;
    this.world = world;
    this.mode = mode;
    this.settings = settings;
    this.quality = quality;
    this.isRace = mode === 'race';
    this.laps = settings.laps || 1;
    this.raceDist = this.isRace ? this.laps * course.length : Infinity;
    this.rng = mulberry32(seed);
    this.riders = [];
    this.players = [];
    this.t = 0;
    this.state = 'grid';
    this.countdown = 0;
    this.order = [];
    this.standings = [];
    this.groups = [];
    this.mainGroup = 0;
    this.director = new Director(this, this.rng);
    const diff = DIFFICULTIES.find((d) => d.id === settings.difficulty) || DIFFICULTIES[1];
    this.diff = diff;
    this.groupTempo = mode === 'group' ? { easy: 0.58, normal: 0.68, hard: 0.78, oni: 0.88 }[diff.id] : 0.7;
    this.finishers = [];
    this.segLogs = {};
    this.thinkT = 0;
    this.standT = 0;
    this.W = course.halfWidth;
    this._smp = { x: 0, y: 0, z: 0, tx: 0, tz: 1, grade: 0, curv: 0 };
    this._pos = new THREE.Vector3();
    this._ctx = {};
    this.createRiders(players);
    this.placeOnGrid();
  }

  // ---------------------------------------------------------------
  createRiders(players) {
    const rng = this.rng;
    let id = 0;
    players.forEach((p, i) => {
      const pr = p.profile;
      const r = new Rider({
        id: id++, name: pr.name, animal: pr.animal, jersey: pr.jersey, bike: pr.bike, isPlayer: true, playerIndex: i,
        weight: pr.weight, cp: pr.ftp, sprintPower: pr.ftp * 3.0, wprime: 18000,
      });
      r.control = p.control;
      this.players.push(r);
      this.riders.push(r);
    });
    const refWkg = this.players.length
      ? this.players.reduce((a, r) => a + r.cp / r.weight, 0) / this.players.length
      : 3.1;
    const nAI = this.mode === 'attract' ? 11 : this.settings.rivals;
    const roster = AI_ROSTER.slice();
    const rival = roster.shift();
    shuffle(rng, roster);
    const picks = nAI > 0 ? [rival, ...roster].slice(0, nAI) : [];
    const usedNames = new Set(this.players.map((r) => r.name));
    for (const a of picks) {
      if (usedNames.has(a.name)) continue;
      const T = AI_TYPES[a.type];
      const weight = Math.round(T.weight[0] + rng() * (T.weight[1] - T.weight[0]));
      let wkg = refWkg * this.diff.factor * T.ftp * (1 + (rng() - 0.5) * 2 * this.diff.spread);
      if (a.rival) wkg *= 1.05;
      if (this.mode === 'group') wkg = refWkg * 0.98;
      const cp = wkg * weight;
      const r = new Rider({
        id: id++, name: a.name, animal: a.animal, jersey: a.jersey, bike: a.bike, rival: a.rival, shades: a.shades,
        type: a.type, weight, cp, sprintPower: cp * 2.8 * T.sprint, wprime: 15500 * T.wprime * (weight / 65),
      });
      r.brain = new AIBrain(r, mulberry32(Math.floor(rng() * 1e9)));
      this.riders.push(r);
    }
    for (const r of this.riders) {
      r.model = new RiderModel({ animal: r.animal, jersey: r.jersey, bike: r.bikeColor, shades: r.shades, shadows: !!this.quality.shadows });
      this.scene.add(r.model.root);
    }
  }

  placeOnGrid() {
    const rng = this.rng;
    const lanes = [-3.0, -1.0, 1.0, 3.0];
    if (this.mode === 'attract' || this.mode === 'group') {
      // 走行中の集団として配置
      const start = this.mode === 'attract' ? this.course.length * 0.08 : 0;
      const list = this.riders.slice();
      if (this.mode === 'attract') shuffle(rng, list);
      list.forEach((r, i) => {
        const row = Math.floor(i / 3);
        r.dist = start - row * 2.6 - (rng() * 0.6);
        r.lat = (i % 3 - 1) * 1.4 + (rng() - 0.5) * 0.4;
        r.v = this.mode === 'attract' ? 10 : 0;
        r.prevDist = r.dist;
        r.targetLat = r.lat;
      });
      if (this.mode === 'group') {
        // プレイヤーは集団の後方中央
        this.players.forEach((p, i) => { p.dist = -2.6 * 2 - i * 2.6; p.lat = i ? 1 : -0.6; });
      }
      this.state = this.mode === 'attract' ? 'racing' : 'grid';
      return;
    }
    const ai = this.riders.filter((r) => !r.isPlayer);
    shuffle(rng, ai);
    const slots = [];
    const total = this.riders.length;
    for (let i = 0; i < total; i++) slots.push({ row: Math.floor(i / 4), lane: lanes[i % 4] });
    // プレイヤーは2列目中央付近
    const playerSlots = [5, 6, 4, 7].slice(0, this.players.length).map((k) => Math.min(k, total - 1));
    const assigned = new Map();
    this.players.forEach((p, i) => assigned.set(playerSlots[i], p));
    let ai_i = 0;
    for (let k = 0; k < total; k++) {
      const r = assigned.get(k) || ai[ai_i++];
      if (!r) continue;
      const sl = slots[k];
      r.dist = -1.4 - sl.row * 2.5;
      r.lat = sl.lane;
      r.targetLat = sl.lane;
      r.prevDist = r.dist;
      r.v = 0;
    }
  }

  startCountdown(sec = 3) {
    this.state = 'countdown';
    this.countdown = sec + 0.999;
    this._lastCount = null;
  }

  // ---------------------------------------------------------------
  lapPos(d) {
    return mod(d, this.course.length);
  }
  lapOf(d) {
    return Math.floor(d / this.course.length);
  }
  onKom(d) {
    const p = this.lapPos(d), k = this.course.kom;
    return p > k.s0 && p < k.s1;
  }
  remainingFor(r) {
    return this.raceDist - r.dist;
  }
  groupOf(r) {
    return r.gi;
  }

  say(r, text, prob = 1) {
    if (!text || this.rng() > prob) return;
    if (this.t - r.lastSay < 5) return;
    r.lastSay = this.t;
    this.emit('say', { rider: r, text });
  }

  onAttack(r, silent = false) {
    r.lastAttack = this.t;
    this.emit('attack', { rider: r, silent });
    if (!r.isPlayer && !silent) this.say(r, lineFor(r, 'attack', this.rng), 0.8);
    this.director.respond(r);
  }

  useItem(r) {
    if (!r.item) return false;
    const def = POWERUPS[r.item];
    r.active = { id: r.item, until: this.t + def.duration, dur: def.duration };
    r.item = null;
    this.emit('useitem', { rider: r, item: def });
    return true;
  }

  giveItem(r) {
    if (r.item || this.mode === 'attract') return;
    const id = POWERUP_IDS[Math.floor(this.rng() * POWERUP_IDS.length)];
    r.item = id;
    this.emit('item', { rider: r, item: POWERUPS[id] });
  }

  // ---------------------------------------------------------------
  sortAndGroup() {
    const active = this.riders.filter((r) => !r.finished);
    active.sort((a, b) => b.dist - a.dist);
    this.order = active;
    active.forEach((r, i) => (r.oi = i));
    const groups = [];
    let g = null;
    for (let i = 0; i < active.length; i++) {
      const r = active[i];
      if (!g || active[i - 1].dist - r.dist > GROUP_GAP) {
        g = { riders: [], index: groups.length };
        groups.push(g);
      }
      r.gi = g.index;
      r.rank = g.riders.length;
      g.riders.push(r);
    }
    this.groups = groups;
    let main = 0, best = -1;
    groups.forEach((gg, i) => {
      if (gg.riders.length > best) { best = gg.riders.length; main = i; }
    });
    this.mainGroup = main;
    for (const r of this.riders) if (r.finished) { r.gi = -1; r.rank = 0; }
  }

  updateStandings() {
    const fin = this.finishers.slice();
    const rest = this.riders.filter((r) => !r.finished).sort((a, b) => b.dist - a.dist);
    this.standings = fin.concat(rest);
    this.standings.forEach((r, i) => (r.pos = i + 1));
  }

  ctxFor(r) {
    const c = this._ctx;
    const smp = this.course.sample(r.dist, this._smp);
    c.grade = smp.grade;
    c.wind = r.wind;
    c.remaining = this.raceDist - r.dist;
    c.lap = this.lapOf(r.dist);
    const L = this.course.length;
    const lp = this.lapPos(r.dist);
    c.toKomLine = mod(this.course.kom.s1 - lp, L);
    c.toSprintLine = mod(this.course.sprint.s1 - lp, L);
    if (c.toKomLine > L - 5) c.toKomLine = 0;
    if (c.toSprintLine > L - 5) c.toSprintLine = 0;
    c.followee = null;
    c.blocker = null;
    if (!r.finished) {
      for (let k = r.oi - 1; k >= 0; k--) {
        const f = this.order[k];
        const dd = f.dist - r.dist;
        if (dd > 30) break;
        if (!c.blocker && dd < 3.3 && Math.abs(f.lat - r.lat) < 0.8) c.blocker = f;
        if (!c.followee) {
          const bm = f.brain?.mode;
          if (bm !== 'drift' && !(f.exhausted && !r.exhausted)) c.followee = f;
        }
        if (c.followee && (c.blocker || dd > 3.3)) break;
      }
    }
    const grp = this.groups[r.gi];
    c.groupSize = grp ? grp.riders.length : 1;
    c.groupRank = r.gi;
    c.isFront = r.rank === 0;
    const behind = r.oi + 1 < this.order.length ? this.order[r.oi + 1] : null;
    c.gapBehind = behind ? r.dist - behind.dist : 999;
    c.groupRole = r.gi < this.mainGroup ? 'break' : r.gi === this.mainGroup ? 'main' : 'behind';
    c.frontSprinting = !!grp && grp.riders.slice(0, 4).some((x) => (x.brain && x.brain.mode === 'sprint') || (x.isPlayer && x.standing && x.power > x.cp * 1.8));
    // 先頭を引く時のテンポ
    let tempo;
    if (this.mode === 'group' || this.mode === 'attract') {
      tempo = this.groupTempo;
      if (this.mode === 'group' && c.groupRole === 'main') {
        // 遅れたプレイヤーを待つ
        const lastMain = grp.riders[grp.riders.length - 1];
        for (const p of this.players) {
          if (p.gi !== r.gi && p.dist < lastMain.dist) tempo = 0.4;
        }
      }
      if (c.groupRole === 'behind') tempo = this.groupTempo + 0.12;
      if (c.groupRole === 'break' && this.mode === 'attract') tempo = 0.88;
    } else if (c.groupRole === 'main') tempo = this.director.packTempo;
    else if (c.groupRole === 'break') {
      const bt = r.brain ? r.brain.breakT : 0;
      tempo = c.remaining < 2000 ? 0.98 : 0.94 - Math.min(0.07, bt / 900);
      if (c.groupSize === 1) tempo += 0.02;
    } else {
      const ahead = r.gi > 0 ? this.groups[r.gi - 1] : null;
      const gapS = ahead ? (ahead.riders[ahead.riders.length - 1].dist - r.dist) / Math.max(4, r.v) : 99;
      tempo = gapS < 10 ? 0.98 : 0.86;
    }
    if (r.type === 'climber' && c.grade > 0.03) tempo += 0.04;
    c.tempo = tempo;
    return c;
  }

  // ---------------------------------------------------------------
  applyEffects(r) {
    r.massEff = r.mass;
    r.cdaBase = r.cda * (r.standing ? 1.08 : 1) * (r.tuck ? 0.86 : 1);
    r.wind = 0;
    r.draftMul = 1;
    if (r.active) {
      if (this.t > r.active.until) r.active = null;
      else {
        switch (r.active.id) {
          case 'feather': r.massEff = r.mass * 0.88; break;
          case 'aero': r.cdaBase *= 0.75; break;
          case 'draft': r.draftMul = 1.6; break;
          case 'tailwind': r.wind = -4.5; break;
        }
      }
    }
  }

  computeDrafts() {
    const ord = this.order;
    for (let i = 0; i < ord.length; i++) {
      const r = ord[i];
      let s1 = 0, s2 = 0, s3 = 0;
      for (let k = i - 1; k >= 0; k--) {
        const f = ord[k];
        const dd = f.dist - r.dist;
        if (dd > 16) break;
        const s = draftSaving(dd - 1.7, f.lat - r.lat);
        if (s > s1) { s3 = s2; s2 = s1; s1 = s; } else if (s > s2) { s3 = s2; s2 = s; } else if (s > s3) s3 = s;
      }
      const tot = Math.min(0.5, s1 + 0.3 * s2 + 0.15 * s3) * r.draftMul;
      r.draft = Math.min(0.62, tot);
    }
    for (const r of this.riders) if (r.finished) r.draft = 0;
  }

  // ---------------------------------------------------------------
  step(dt) {
    if (this.state === 'countdown') {
      this.countdown -= dt;
      const n = Math.ceil(this.countdown - 1);
      if (n !== this._lastCount && n >= 1) { this._lastCount = n; this.emit('countdown', n); }
      if (this.countdown <= 1) {
        this.state = 'racing';
        this.emit('go', {});
      }
    }
    const racing = this.state === 'racing' || this.state === 'done';
    if (racing) this.t += dt;

    this.sortAndGroup();
    this.thinkT -= dt;
    const doThink = racing && this.thinkT <= 0;
    if (doThink) {
      this.thinkT = 0.25;
      this.director.update(0.25);
    }

    // パワー決定
    for (const r of this.riders) {
      const ctx = this.ctxFor(r);
      r.brake = 0;
      this.applyEffects(r);
      let P = 0;
      if (racing) {
        if (r.isPlayer) P = this.playerPower(r, ctx, dt);
        else {
          if (doThink) r.brain.think(ctx, this);
          P = r.brain.power(ctx, dt);
        }
      } else if (r.isPlayer && r.control) {
        // スタート前もパワー表示は動かす
        r.control.computePower(dt, { ftp: r.cp, wbal: 1, exhausted: false, auto: 0, idle: true });
        r.cadence = r.control.cadence;
        r.hr = r.control.hr || r.hr;
      }
      if (!r.isPlayer) {
        const up = r.brain.mode === 'sprint' || r.brain.mode === 'attack' ? 1200 : 450, down = 900;
        r.power += clamp(P - r.power, -down * dt, up * dt);
      } else {
        r.power = P;
      }
      r.targetLat = r.isPlayer ? this.playerLane(r, ctx, dt) : r.brain.laneTarget(ctx, this.W);
      // 姿勢
      const bm = r.brain?.mode;
      if (r.isPlayer) r.standing = racing && (r.control?.sprinting || r.power > r.cp * 1.6);
      else r.standing = bm === 'sprint' || (bm === 'attack' && this.rng() < 0.9) || (ctx.grade > 0.07 && r.power > r.cp * 1.05);
      r.tuck = ctx.grade < -0.025 && r.power < r.cp * 0.35 && r.v > 11;
      r._grade = ctx.grade;
      r._blocker = ctx.blocker;
      r._ctxGroupSize = ctx.groupSize;
      r._remaining = ctx.remaining;
    }

    this.computeDrafts();

    // 物理
    for (const r of this.riders) {
      if (!racing) { r.v = 0; r.cadence = r.isPlayer ? r.cadence : 0; continue; }
      r.cdaEff = r.cdaBase * (1 - r.draft);
      r.v = stepSpeed(r.v, r.power, r._grade, r.massEff, r.cdaEff, r.wind, dt);
      if (r.brake > 0) r.v = Math.max(0, r.v - r.brake * dt);
      const blk = r._blocker;
      if (blk && !r.finished) {
        const dd = blk.dist - r.dist;
        // 本当に重なりそうな時だけ速度を抑える（横にずれて抜く）
        if (dd < 1.8 && Math.abs(blk.lat - r.lat) < 0.6 && r.v > blk.v) r.v = Math.max(0, Math.min(r.v, blk.v + (dd - 1.55) * 3));
      }
      r.prevDist = r.dist;
      r.dist += r.v * dt;
      // 横移動
      const err = r.targetLat - r.lat;
      const dv = clamp(err * 1.6, -1.3, 1.3);
      r.latV += (dv - r.latV) * Math.min(1, 6 * dt);
      r.lat += r.latV * dt;
      // W'
      r.wbal.update(r.power, dt);
      const was = r.exhausted;
      if (r.wbal.w <= 0) r.exhausted = true;
      else if (r.exhausted && r.wbal.frac > 0.28) r.exhausted = false;
      if (!was && r.exhausted) {
        this.emit('blown', { rider: r });
        if (!r.isPlayer) this.say(r, lineFor(r, 'blown', this.rng), 0.6);
      }
      // AI のケイデンス・心拍
      if (!r.isPlayer) {
        const rel = r.power / r.cp;
        const cad = r.power < 15 ? 0 : clamp(82 + 22 * clamp(rel - 0.6, 0, 1.2) - r._grade * 160 + (r.standing ? 6 : 0), 55, 125);
        r.cadence += (cad - r.cadence) * Math.min(1, 3 * dt);
        const hrT = 70 + 110 * Math.pow(clamp(rel, 0, 1.4) / 1.4, 0.7) + (1 - r.wbal.frac) * 15;
        r.hr += (hrT - r.hr) * Math.min(1, dt / 12);
      }
      this.updateStats(r, dt);
      this.checkLines(r);
      if (this.isRace) this.checkFinish(r);
      if (r.happyT > 0) r.happyT -= dt;
    }
    this.separate(dt);

    this.standT -= dt;
    if (this.standT <= 0) {
      this.standT = 0.25;
      this.updateStandings();
      this.playerEvents();
    }
    if (this.isRace && this.state === 'racing' && this.players.length && this.players.every((p) => p.finished)) {
      this.state = 'done';
      this.emit('allPlayersFinished', {});
    }
  }

  // 重なり防止（横方向に押し合う）
  separate(dt) {
    const ord = this.order;
    const lim = this.W - 0.7;
    for (let i = 0; i < ord.length; i++) {
      const a = ord[i];
      for (let k = i + 1; k < ord.length; k++) {
        const b = ord[k];
        const dd = a.dist - b.dist;
        if (dd > 1.9) break;
        const dl = a.lat - b.lat;
        if (Math.abs(dl) < 0.64) {
          const push = (0.64 - Math.abs(dl)) * Math.min(1, 8 * dt) * 0.5;
          const s = dl >= 0 ? 1 : -1;
          a.lat += s * push;
          b.lat -= s * push;
        }
      }
    }
    for (const r of this.riders) r.lat = clamp(r.lat, -lim, lim);
  }

  playerPower(r, ctx, dt) {
    const ctl = r.control;
    if (!ctl) return 0;
    let auto, autoBrake = 0;
    if (ctx.followee) { auto = followPower(r, ctx.followee, ctx, 0.45, 1.12); autoBrake = followPower.brake; }
    else auto = r.cp * (ctx.grade < -0.035 ? 0.3 : this.isRace ? 0.86 : Math.max(0.55, this.groupTempo));
    // 集団から遅れはじめたらヒント
    if (!ctx.followee && !r.finished && this.state === 'racing' && !ctl.usingDevice) {
      const ahead = r.oi > 0 ? this.order[r.oi - 1] : null;
      const gap = ahead ? ahead.dist - r.dist : 999;
      if (gap > 25 && gap < 90 && this.t - (r._dropHint || -99) > 35) {
        r._dropHint = this.t;
        this.emit('dropped', { rider: r, gap });
      }
    }
    const P = ctl.computePower(dt, { ftp: r.cp, wbal: r.wbal.frac, exhausted: r.exhausted, auto, grade: ctx.grade, remaining: ctx.remaining, t: this.t });
    // オート追走中だけ自動でブレーキ（手動操作・パワーメーター時はかけない）
    const k = ctl.keys;
    if (!ctl.usingDevice && ctl.mode === 'auto' && !k.attack && !k.sprint && !k.rest) r.brake = autoBrake;
    r.cadence = ctl.cadence;
    r.hr = ctl.hr || r.hr;
    if (ctl.consumeItem && ctl.consumeItem()) this.useItem(r);
    // プレイヤーのアタック検出
    if (!r.finished && P > r.cp * 1.3 && r.v > 5) r.attackT += dt; else r.attackT = 0;
    if (r.attackT > 1.4 && this.t - r.lastAttack > 25 && ctx.groupSize >= 2 && ctx.remaining > 450 && (this.isRace || this.mode === 'group')) {
      this.onAttack(r);
    }
    return P;
  }

  // 空いているレーン（前方の見通し）を評価
  laneClearance(r, cand) {
    for (let k = r.oi - 1; k >= 0; k--) {
      const f = this.order[k];
      const dd = f.dist - r.dist;
      if (dd > 25) break;
      if (Math.abs(f.lat - cand) < 0.75 && dd > -0.5) return dd;
    }
    return 25;
  }

  playerLane(r, ctx, dt) {
    const ctl = r.control;
    const lim = this.W - 0.9;
    if (ctl && ctl.manualLaneT > 0) return clamp(ctl.manualLane, -lim, lim);
    r._laneHold = (r._laneHold || 0) - dt;
    const surging = r.standing || r.power > r.cp * 1.25;
    let lane;
    if (surging) {
      // アタック・スプリント中は前が空いたレーンを選んで保持
      if (r._laneHold > 0 && r._laneTgt !== undefined) lane = r._laneTgt;
      else {
        let best = r.lat, bestScore = -Infinity;
        for (const off of [0, -1.3, 1.3, -2.5, 2.5]) {
          const cand = clamp(r.lat + off, -lim, lim);
          const clear = this.laneClearance(r, cand);
          const score = Math.min(clear, 18) - Math.abs(off) * 1.2 + (clear > 3 && clear < 9 ? 2 : 0);
          if (score > bestScore) { bestScore = score; best = cand; }
        }
        lane = best;
        r._laneTgt = best;
        r._laneHold = 1.5;
      }
    } else {
      lane = r.targetLat;
      const f = ctx.followee;
      if (f && f.dist - r.dist < 18) lane = f.lat + (r.playerIndex === 1 ? 0.35 : -0.15);
      const blk = ctx.blocker;
      if (blk && (r.v > blk.v + 0.3 || r.power > blk.power * 1.2)) {
        const left = blk.lat + 1.3, right = blk.lat - 1.3;
        lane = Math.abs(left - r.lat) < Math.abs(right - r.lat) && left < lim ? left : right > -lim ? right : left;
      }
      r._laneTgt = undefined;
    }
    if (ctl) ctl.manualLane = r.lat;
    return clamp(lane, -lim, lim);
  }

  updateStats(r, dt) {
    const st = r.stats;
    if (r.finished && this.isRace) return;
    st.time += dt;
    st.energy += r.power * dt;
    st.maxP = Math.max(st.maxP, r.power);
    st.maxV = Math.max(st.maxV, r.v);
    if (r.hr > 30) { st.hrSum += r.hr * dt; st.hrT += dt; }
    st.secAcc += dt;
    st.secE += r.power * dt;
    if (st.secAcc >= 1) {
      st.ring.push(st.secE / st.secAcc);
      if (st.ring.length > 30) st.ring.shift();
      const avg = st.ring.reduce((a, b) => a + b, 0) / st.ring.length;
      st.np4 += avg ** 4;
      st.npN++;
      st.secAcc = 0;
      st.secE = 0;
    }
    const dy = this.course.heightAt(r.dist) - this.course.heightAt(r.prevDist);
    if (dy > 0 && dy < 5) st.elev += dy;
  }

  checkLines(r) {
    if (r.dist <= 0.5 || this.mode === 'attract') return;
    const L = this.course.length;
    const crossed = (s) => Math.floor((r.prevDist - s) / L) < Math.floor((r.dist - s) / L);
    if (this.isRace && !r.finished) {
      if (crossed(this.course.kom.s1)) this.segmentLine(r, 'kom', this.course.kom.s1);
      if (crossed(this.course.sprint.s1)) this.segmentLine(r, 'sprint', this.course.sprint.s1);
    } else if (!this.isRace) {
      if (crossed(this.course.kom.s1) || crossed(this.course.sprint.s1)) this.giveItem(r);
    }
    if (crossed(0) && r.prevDist > 0) {
      r.lap = this.lapOf(r.dist);
      if (r.isPlayer) this.emit('lap', { rider: r, lap: r.lap });
      if (!r.finished && r.dist < this.raceDist - 10) this.giveItem(r);
    }
  }

  segmentLine(r, type, s) {
    const lap = Math.floor((r.dist - s) / this.course.length);
    const key = `${type}${lap}`;
    const log = (this.segLogs[key] ||= []);
    log.push(r);
    const place = log.length;
    const pts = PTS[place - 1] || 0;
    if (type === 'kom') r.komPts += pts; else r.sprintPts += pts;
    if (place <= 3 || r.isPlayer) this.emit(type, { rider: r, place, pts, lap });
    this.giveItem(r);
    if (place === 1 && !r.isPlayer) this.say(r, lineFor(r, 'win', this.rng), 0.5);
    if (place === 1) r.happyT = 3;
  }

  checkFinish(r) {
    if (r.finished || r.dist < this.raceDist) return;
    r.finished = true;
    const over = (r.dist - this.raceDist) / Math.max(r.v, 0.1);
    r.finishTime = this.t - over;
    this.finishers.push(r);
    // 同着付近は時間でソートし直す
    this.finishers.sort((a, b) => a.finishTime - b.finishTime);
    this.finishers.forEach((f, i) => (f.place = i + 1));
    if (r.brain) r.brain.setMode('finished');
    r.celebrate = r.place <= 3;
    r.happyT = r.place <= 3 ? 8 : 0;
    const winnerTime = this.finishers[0].finishTime;
    const close = this.riders.filter((o) => o !== r && Math.abs((o.finished ? o.finishTime : this.t + (this.raceDist - o.dist) / Math.max(o.v, 1)) - r.finishTime) < 0.35);
    this.emit('finish', { rider: r, place: r.place, time: r.finishTime, gap: r.finishTime - winnerTime, photo: close.length > 0 });
    if (r.place === 1 && !r.isPlayer) this.say(r, lineFor(r, 'win', this.rng), 1);
    if (r.rival && !r.isPlayer) {
      const beaten = this.players.some((p) => p.finished && p.finishTime < r.finishTime);
      this.say(r, lineFor(r, beaten ? 'lose' : 'win', this.rng), 1);
    }
  }

  // プレイヤー向けのイベント（順位変動・残り距離・ライバル）
  playerEvents() {
    for (const p of this.players) {
      if (p._lastPos && p.pos !== p._lastPos && this.state === 'racing' && !p.finished) {
        this.emit('position', { rider: p, from: p._lastPos, to: p.pos });
      }
      p._lastPos = p.pos;
      if (this.isRace && !p.finished) {
        const rem = this.raceDist - p.dist;
        for (const mark of [3000, 1000, 500, 200]) {
          p._marks ||= new Set();
          if (rem < mark && !p._marks.has(mark)) {
            p._marks.add(mark);
            this.emit('remaining', { rider: p, mark });
          }
        }
      }
      // ライバルとの抜きつ抜かれつ
      const rv = this.riders.find((r) => r.rival);
      if (rv && !rv.finished && !p.finished && this.state === 'racing') {
        const d = rv.dist - p.dist;
        const side = d > 1.5 ? 1 : d < -1.5 ? -1 : 0;
        if (side && p._rivalSide && side !== p._rivalSide && Math.abs(d) < 12) {
          if (side > 0) this.say(rv, lineFor(rv, 'pass', this.rng), 0.8);
          else this.say(rv, lineFor(rv, 'passed', this.rng), 0.8);
          this.emit('rivalSwap', { rider: p, rival: rv, ahead: side > 0 });
        }
        if (side) p._rivalSide = side;
      }
    }
  }

  // ---------------------------------------------------------------
  // 見た目の更新
  updateVisuals(dt, camPos) {
    const smp = this._smp, pos = this._pos;
    for (const r of this.riders) {
      if (r.onPodium) continue;
      const c = this.course.sample(r.dist, smp);
      this.course.worldPos(r.dist, r.lat, pos);
      const m = r.model;
      m.root.position.set(pos.x, pos.y, pos.z);
      m.root.rotation.y = Math.atan2(c.tx, c.tz) - r.latV * 0.06;
      const lean = clamp(-Math.atan((r.v * r.v * c.curv) / 9.81) + r.latV * 0.12, -0.45, 0.45);
      const dist2 = camPos ? m.root.position.distanceToSquared(camPos) : 0;
      m.update(dt, {
        speed: r.v,
        cadence: r.cadence,
        grade: c.grade,
        lean,
        standing: r.standing,
        tuck: r.tuck,
        effort: r.power / r.cp,
        exhausted: r.exhausted,
        happy: r.happyT > 0 || (r.active && !r.isPlayer),
        celebrate: r.celebrate && r.finished && this.t - r.finishTime < 6,
        powerupColor: r.active ? POWERUPS[r.active.id].color : null,
        lod: dist2 > 110 * 110 ? 2 : 0,
      });
    }
  }

  // 結果（未完走者は推定タイム）
  results() {
    const list = this.riders.map((r) => {
      let time = r.finishTime;
      let est = false;
      if (!r.finished) {
        time = this.t + (this.raceDist - r.dist) / Math.max(r.v, 5);
        est = true;
      }
      return { r, time, est };
    });
    list.sort((a, b) => a.time - b.time);
    return list;
  }

  dispose() {
    for (const r of this.riders) {
      this.scene.remove(r.model.root);
      r.model.dispose();
    }
  }
}
