// AI ライダーの頭脳と、レース展開を演出するディレクター
import { AI_TYPES, POWERUPS } from './config.js';
import { resistance, DRIVETRAIN } from './physics.js';
import { clamp, pick } from './util.js';

const LINES = {
  attack: ['いくぞ〜！', 'ついてこれる？', 'えいっ！', 'いまだっ！', 'しかけるよ！'],
  sprint: ['うおおおお！', 'まけないぞ！', 'ここで勝負！', 'ぜんりょく〜！'],
  blown: ['もう…むり…', 'へろへろ〜', 'ぜぇぜぇ…', 'あしが…'],
  pass: ['おさきに〜！', 'ちょっと失礼♪', 'ばいばーい！'],
  item: ['やった！アイテム！', 'いいものゲット！'],
  win: ['やったー！', 'ぶいっ！', 'ありがと〜！'],
  respond: ['まてまて〜！', '逃がさない！', 'おいかけるよ！'],
};
const RIVAL = {
  attack: ['オレについてこれるか？', '本気、見せてやる！'],
  respond: ['逃がすかよ！', 'その程度か？'],
  pass: ['遅いぜ！', 'お先！'],
  passed: ['やるじゃねえか…！', 'くっ…！'],
  sprint: ['勝負だ！！', 'ここからが本番だ！'],
  win: ['当然の結果だ。', 'また挑んでこい！'],
  lose: ['次は負けねえ…！'],
};

export function lineFor(rider, kind, rng = Math.random) {
  if (rider.rival && RIVAL[kind]) return pick(rng, RIVAL[kind]);
  const arr = LINES[kind];
  if (!arr) return '';
  if (rng() < 0.25) return rider.cry;
  return pick(rng, arr);
}

export class AIBrain {
  constructor(rider, rng) {
    this.r = rider;
    this.rng = rng;
    this.p = AI_TYPES[rider.type] || AI_TYPES.rouleur;
    this.aggression = this.p.aggression * (0.7 + rng() * 0.6);
    this.mode = 'pack';
    this.modeT = 0;
    this.modeDur = 0;
    this.attackF = 1.5;
    this.target = null;
    this.holdCap = 1.0;
    this.pullT = 0;
    this.pullDur = 22 + rng() * 30;
    this.laneBias = (rng() - 0.5) * 5.2;
    this.gapPref = 0.4 + rng() * 0.8;
    this.sprintDist = rider.type === 'sprinter' ? 220 + rng() * 70 : rider.type === 'puncheur' ? 190 + rng() * 80 : 120 + rng() * 90;
    if (rider.rival) this.sprintDist = 260;
    this.sprintT = 0;
    this.itemT = 3 + rng() * 6;
    this.thinkT = rng() * 0.3;
    this.lastISprintLap = -1;
    this.lastKomLap = -1;
    this.breakT = 0;
  }

  setMode(mode, dur = 0) {
    this.mode = mode;
    this.modeT = 0;
    this.modeDur = dur;
    if (mode === 'sprint') this.sprintT = 0;
  }

  startAttack(factor, dur) {
    this.attackF = factor;
    this.setMode('attack', dur);
  }

  onModeEnd(ctx) {
    const m = this.mode;
    if (m === 'attack') {
      if (ctx.gapBehind > 18) { this.setMode('break'); this.breakT = 0; }
      else this.setMode('recover', 6 + this.rng() * 6);
    } else if (m !== 'break' && m !== 'finished' && m !== 'sprint') {
      this.setMode('pack');
    }
  }

  // 毎ステップ：目標パワーを返す
  power(ctx, dt) {
    const r = this.r, cp = r.cp, wb = r.wbal.frac;
    this.modeT += dt;
    if (this.modeDur && this.modeT > this.modeDur) this.onModeEnd(ctx);
    let P;
    switch (this.mode) {
      case 'finished':
        P = cp * 0.35;
        break;
      case 'sprint': {
        this.sprintT += dt;
        const fade = Math.max(0.68, 1 - this.sprintT / 30);
        P = r.sprintPower * fade * (0.5 + 0.5 * wb);
        break;
      }
      case 'attack':
        P = cp * this.attackF * (0.72 + 0.28 * wb);
        if (wb < 0.12) this.onModeEnd(ctx);
        break;
      case 'drift':
        P = cp * 0.55;
        break;
      case 'recover':
        P = ctx.followee ? Math.min(this.followTarget(ctx, ctx.followee, 1.1), cp * 1.1) : cp * 0.6;
        break;
      case 'respond': {
        const tgt = this.target;
        if (!tgt || tgt.finished || tgt.dist - r.dist > 60) {
          this.setMode('pack');
          P = this.follow(ctx);
        } else {
          P = this.followTarget(ctx, tgt, 1.15 + 0.95 * wb);
          if (tgt.dist - r.dist < 3.5) this.setMode('pack');
        }
        break;
      }
      case 'break':
        this.breakT += dt;
        P = this.follow(ctx);
        break;
      default:
        P = this.follow(ctx);
    }
    if (r.exhausted) P = Math.min(P, cp * 0.84);
    return Math.max(0, Math.min(P, r.sprintPower));
  }

  follow(ctx) {
    const r = this.r;
    const f = ctx.followee;
    if (!f) return r.cp * ctx.tempo;
    const capF = this.mode === 'hold' ? this.holdCap : 1.05 + 0.95 * Math.pow(r.wbal.frac, 1.3);
    return this.followTarget(ctx, f, capF);
  }

  // 前の選手の後ろにつくための必要パワー（上限つき）
  followTarget(ctx, f, capF) {
    const P = followPower(this.r, f, ctx, this.gapPref, capF);
    if (followPower.brake > this.r.brake) this.r.brake = followPower.brake;
    return P;
  }

  // 0.25秒ごとの判断
  think(ctx, race) {
    const r = this.r;
    const wb = r.wbal.frac;
    if (r.finished) {
      if (this.mode !== 'finished') this.setMode('finished');
      return;
    }
    if (race.isRace) {
      // 最終スプリント
      const rem = ctx.remaining;
      if (this.mode !== 'sprint' && rem < this.sprintDist && wb > 0.04 && ctx.groupRank <= 1) {
        this.setMode('sprint');
        race.say(r, lineFor(r, 'sprint', this.rng));
        race.emit('sprintStart', { rider: r });
      } else if (this.mode !== 'sprint' && rem < this.sprintDist * 1.35 && ctx.frontSprinting && ctx.groupRank === 0 && wb > 0.1) {
        this.setMode('sprint');
      }
      // 中間スプリント
      if (ctx.toSprintLine > 0 && ctx.toSprintLine < 170 && this.lastISprintLap !== ctx.lap && ctx.groupRank === 0 && this.mode === 'pack') {
        this.lastISprintLap = ctx.lap;
        const want = r.type === 'sprinter' || r.rival || this.rng() < this.aggression * 0.25;
        if (want && wb > 0.45 && rem > 600) {
          this.startAttack((r.sprintPower / r.cp) * 0.75, clamp(ctx.toSprintLine / 13, 5, 14));
        }
      }
      // 山岳ポイント争い
      if (ctx.toKomLine > 0 && ctx.toKomLine < 260 && this.lastKomLap !== ctx.lap && ctx.groupRank === 0 && this.mode === 'pack') {
        this.lastKomLap = ctx.lap;
        const want = r.type === 'climber' || (r.rival && this.rng() < 0.5) || this.rng() < this.aggression * 0.15;
        if (want && wb > 0.4 && rem > 500) {
          this.startAttack(1.4 + this.rng() * 0.2, clamp(ctx.toKomLine / 5, 8, 30));
          race.onAttack(r);
        }
      }
      // 逃げのまま終盤：逃げ集団内でアタック合戦
      if (this.mode === 'break' && rem < 2200 && rem > 600 && ctx.groupSize >= 2 && this.rng() < 0.004 * this.aggression && wb > 0.5) {
        this.startAttack(1.55, 12);
        race.onAttack(r);
      }
      // 逃げは長いと少しずつたれる
    }
    // 先頭交代
    if ((this.mode === 'pack' || this.mode === 'break') && ctx.isFront && ctx.groupSize >= 3 && ctx.remaining > 2500) {
      this.pullT += 0.25;
      if (this.pullT > this.pullDur) {
        this.pullT = 0;
        this.pullDur = 20 + this.rng() * 30;
        const wasBreak = this.mode === 'break';
        this.setMode('drift', 5 + this.rng() * 3);
        this._resumeBreak = wasBreak;
      }
    } else if (!ctx.isFront) {
      this.pullT = Math.max(0, this.pullT - 0.1);
    }
    if (this.mode === 'drift' && this.modeT > this.modeDur - 0.3 && this._resumeBreak) {
      this.setMode('break');
      this._resumeBreak = false;
    }
    // 逃げていたのに集団に吸収された
    if (this.mode === 'break' && ctx.groupRole === 'main') this.setMode('pack');

    // アイテム使用
    if (r.item && !r.active) {
      this.itemT -= 0.25;
      if (this.itemT <= 0) {
        const it = r.item;
        let use = false;
        if (it === 'feather') use = ctx.grade > 0.045;
        else if (it === 'aero') use = this.mode === 'attack' || this.mode === 'sprint' || (ctx.isFront && ctx.grade < 0.01);
        else if (it === 'draft') use = !ctx.isFront && ctx.groupSize >= 3;
        else if (it === 'tailwind') use = this.mode === 'sprint' || this.mode === 'attack' || ctx.remaining < 1200;
        if (use || this.itemT < -60) {
          race.useItem(r);
          this.itemT = 3 + this.rng() * 8;
        }
      }
    }
  }

  // 横位置の目標
  laneTarget(ctx, W) {
    const r = this.r;
    const lim = W - 0.9;
    let lane = r.lat;
    const f = ctx.followee;
    switch (this.mode) {
      case 'finished':
        lane = -lim;
        break;
      case 'drift':
        lane = this.laneBias >= 0 ? lim * 0.85 : -lim * 0.85;
        break;
      default:
        if (f) lane = f.lat + clamp(this.laneBias * 0.3, -0.75, 0.75);
        else lane = clamp(this.laneBias * 0.35, -1.8, 1.8);
    }
    const aggressive = this.mode === 'attack' || this.mode === 'sprint' || this.mode === 'respond';
    const blk = ctx.blocker;
    if (blk && (aggressive || r.v > blk.v + 0.4 || blk.exhausted || blk.brain?.mode === 'drift')) {
      const left = blk.lat + 1.35, right = blk.lat - 1.35;
      lane = Math.abs(left - r.lat) < Math.abs(right - r.lat) && left < lim ? left : right > -lim ? right : left;
    }
    return clamp(lane, -lim, lim);
  }
}

// 前走者 f の後ろにつくのに必要なパワー（上限 capF×CP）
// 減速が必要な場合は followPower.brake にブレーキ量が入る
export function followPower(r, f, ctx, gapPref, capF) {
  followPower.brake = 0;
  const dd = f.dist - r.dist;
  const side = Math.abs(f.lat - r.lat) > 0.95;
  const desired = side ? 0.6 + gapPref * 0.5 : 1.75 + gapPref;
  const vDes = f.v + clamp((dd - desired) * 0.4, -2, 3);
  const aDes = clamp((vDes - r.v) * 1.2, -3, 2);
  const v = Math.max(r.v, 2);
  let P = ((resistance(v, ctx.grade, r.massEff, r.cdaEff, ctx.wind) + r.massEff * aDes) * v) / DRIVETRAIN;
  if (P < 0) {
    followPower.brake = Math.min(3.5, (-P * DRIVETRAIN) / (r.massEff * v));
    P = 0;
  }
  return Math.min(P, r.cp * capF);
}
followPower.brake = 0;

// レース展開をつくるディレクター
export class Director {
  constructor(race, rng) {
    this.race = race;
    this.rng = rng;
    this.packTempo = 0.72;
    this.earlyBreakAt = 0.05 + rng() * 0.1;
    this.earlyBreakDone = false;
    this.komAttackDone = new Set();
    this.lateAttacks = 0;
    this.nextRandomAttack = 50 + rng() * 40;
    this.finalAttackAt = 1500 + rng() * 1200;
    this.finalAttackDone = false;
    this.breakAnnounced = false;
    this.hadBreak = false;
  }

  update(dt) {
    const race = this.race;
    if (!race.isRace) {
      this.packTempo = race.groupTempo;
      return;
    }
    const lead = race.order[0];
    if (!lead) return;
    const D = race.raceDist;
    const prog = clamp(lead.dist / D, 0, 1);
    const main = race.groups[race.mainGroup];
    const mainFront = main ? main.riders[0] : lead;
    const remainingMain = D - mainFront.dist;

    // 逃げ集団とのタイム差
    let breakGapSec = 0;
    if (race.mainGroup > 0) {
      const front = race.groups[0].riders[0];
      breakGapSec = race.gapSec(front, mainFront);
    }
    const hasBreak = race.mainGroup > 0;
    let chase = 0;
    if (hasBreak) {
      // プレイヤーが逃げていると集団は本気で追う
      const playerAhead = race.players.some((p) => !p.finished && p.gi >= 0 && p.gi < race.mainGroup);
      let allowed = (remainingMain / 1000) * (prog < 0.4 ? 10 : 5);
      if (playerAhead) allowed *= 0.4;
      chase = clamp((breakGapSec - allowed) / 12, 0, 1);
      if (!this.breakAnnounced && breakGapSec > 8) {
        this.breakAnnounced = true;
        race.emit('break', { riders: race.groups.slice(0, race.mainGroup).flatMap((g) => g.riders), gap: breakGapSec });
      }
    } else if (this.hadBreak) {
      race.emit('catch', {});
      this.breakAnnounced = false;
    }
    this.hadBreak = hasBreak;
    this.breakGapSec = breakGapSec;

    let base = 0.85 + 0.07 * prog;
    if (remainingMain < 3000) base += 0.05;
    if (remainingMain < 1500) base += 0.08;
    if (race.onKom(mainFront.dist)) base += 0.04;
    this.packTempo = clamp(base + chase * 0.24, 0.6, 1.08);

    const ais = race.riders.filter((r) => r.brain && !r.finished);
    const inMain = (r) => race.groupOf(r) === race.mainGroup;

    // 序盤の逃げ
    if (!this.earlyBreakDone && prog > this.earlyBreakAt && D > 3500) {
      this.earlyBreakDone = true;
      const cands = ais.filter((r) => inMain(r) && r.brain.mode === 'pack' && !r.rival)
        .sort((a, b) => (b.type === 'breakaway') - (a.type === 'breakaway') || b.brain.aggression - a.brain.aggression);
      const n = Math.min(cands.length, 1 + Math.floor(this.rng() * 2.5));
      for (let i = 0; i < n; i++) {
        const r = cands[i];
        r.brain.startAttack(1.5 + this.rng() * 0.2, 16 + this.rng() * 8);
        race.onAttack(r, i > 0);
      }
    }

    // 山岳：クライマーのアタック
    const kom = race.course.kom;
    const lapPos = race.lapPos(mainFront.dist);
    const lap = race.lapOf(mainFront.dist);
    if (lapPos > kom.s0 + kom.length * 0.45 && lapPos < kom.s0 + kom.length * 0.75 && !this.komAttackDone.has(lap)) {
      this.komAttackDone.add(lap);
      const climbers = ais.filter((r) => inMain(r) && r.brain.mode === 'pack' && (r.type === 'climber' || r.rival) && r.wbal.frac > 0.5);
      if (climbers.length) {
        const r = climbers[Math.floor(this.rng() * climbers.length)];
        r.brain.startAttack(1.38 + this.rng() * 0.2, 25 + this.rng() * 15);
        race.onAttack(r);
      }
    }

    // 中盤以降のランダムアタック
    this.nextRandomAttack -= dt;
    if (this.nextRandomAttack <= 0 && prog > 0.3 && remainingMain > 2000) {
      this.nextRandomAttack = 45 + this.rng() * 60;
      const cands = ais.filter((r) => inMain(r) && r.brain.mode === 'pack' && r.wbal.frac > 0.7);
      if (cands.length && this.rng() < 0.7) {
        cands.sort((a, b) => b.brain.aggression * this.rng() - a.brain.aggression * this.rng());
        const r = cands[0];
        r.brain.startAttack(1.45 + this.rng() * 0.25, 12 + this.rng() * 10);
        race.onAttack(r);
      }
    }

    // 終盤のアタック
    if (!this.finalAttackDone && remainingMain < this.finalAttackAt && remainingMain > 700) {
      this.finalAttackDone = true;
      const cands = ais.filter((r) => inMain(r) && r.brain.mode === 'pack' && (r.type === 'puncheur' || r.rival) && r.wbal.frac > 0.5);
      if (cands.length) {
        const r = cands[Math.floor(this.rng() * cands.length)];
        r.brain.startAttack(1.6 + this.rng() * 0.2, 12 + this.rng() * 6);
        race.onAttack(r);
      }
    }
  }

  // アタックへの反応：追う者と見送る者
  respond(attacker) {
    const race = this.race;
    const gi = race.groupOf(attacker);
    for (const r of race.riders) {
      if (!r.brain || r === attacker || r.finished) continue;
      if (race.groupOf(r) !== gi) continue;
      if (r.brain.mode === 'attack' || r.brain.mode === 'sprint') continue;
      const b = r.brain;
      let p = 0.12 + b.aggression * 0.3;
      if (r.rival) p = attacker.isPlayer ? 0.92 : 0.45;
      if (attacker.isPlayer && race.isRace && race.remainingFor(attacker) < 2500) p += 0.25;
      p *= clamp(r.wbal.frac * 1.3, 0, 1);
      if (this.rng() < p) {
        b.target = attacker;
        b.setMode('respond', attacker.isPlayer ? 40 : 25);
        if (this.rng() < 0.35 || r.rival) race.say(r, lineFor(r, 'respond', this.rng), 0.6);
      } else {
        b.holdCap = 0.92 + this.rng() * 0.12;
        b.setMode('hold', 14 + this.rng() * 20);
      }
    }
  }
}

export { LINES };
