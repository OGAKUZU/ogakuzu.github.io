// 実況：レースイベント → 通知・テロップ・ボイス・効果音
import { POWERUPS } from './config.js';
import { fmtTime, escapeHtml, pick } from './util.js';

export class Commentary {
  constructor({ race, huds, audio, ticker, camRigs, onFinishFx }) {
    this.race = race;
    this.huds = huds;
    this.audio = audio;
    this.ticker = ticker;
    this.camRigs = camRigs;
    this.onFinishFx = onFinishFx;
    this.lastTick = -99;
    this.offs = [];
    this.bind();
  }

  hudFor(r) {
    return r && r.isPlayer ? this.huds[r.playerIndex] : null;
  }

  all(fn) {
    this.huds.forEach(fn);
  }

  tick(text, speak = false, pri = 1) {
    const el = this.ticker;
    if (el) {
      const line = document.createElement('div');
      line.className = 'tick';
      line.innerHTML = `<span class="mic">🎙</span>${text}`;
      el.appendChild(line);
      while (el.children.length > 2) el.firstChild.remove();
      setTimeout(() => line.classList.add('out'), 5200);
      setTimeout(() => line.remove(), 5800);
    }
    if (speak) this.audio.say(text.replace(/<[^>]+>/g, ''), pri);
  }

  name(r) {
    return `<b>${r.emoji}${escapeHtml(r.name)}</b>`;
  }

  plain(r) {
    return r.name;
  }

  bind() {
    const R = this.race, A = this.audio;
    const on = (ev, fn) => this.offs.push(R.on(ev, fn));
    const multi = R.players.length > 1;

    on('countdown', (n) => {
      A.countdown(n);
      this.showCount(String(n));
    });
    on('go', () => {
      A.countdown(0);
      this.showCount('GO!', 'go');
      const n = R.riders.length;
      if (R.isRace) this.tick(`レーススタート！${n}匹のもふもふライダーが一斉に飛び出した！`, true, 2);
      else this.tick('グループライド、しゅっぱーつ！ 集団の後ろについていこう', true, 2);
      this.all((h) => h.notify('<span class="big">GO!!</span>', 'go', 1.2));
      A.setLevel(1);
    });
    on('attack', ({ rider, silent }) => {
      if (silent) return;
      A.whoosh();
      if (rider.isPlayer) {
        this.hudFor(rider)?.notify('💥 アタック！', 'attack', 1.6);
        this.tick(`${this.name(rider)}がアタック！ 集団を振り切れるか！？`, true, 2);
        this.camRigs[rider.playerIndex]?.punch(0.8);
      } else {
        const near = R.players.some((p) => Math.abs(p.dist - rider.dist) < 60);
        const lines = [
          `おおっと！${this.name(rider)}がアタックだー！`,
          `${this.name(rider)}が仕掛けた！ 集団から飛び出す！`,
          `${this.name(rider)}、ここで勝負に出た！`,
        ];
        this.tick(pick(Math.random, lines), near, 1);
        if (near) this.all((h) => h.notify(`💨 ${escapeHtml(rider.name)} がアタック！`, 'warn', 1.8));
      }
    });
    on('break', ({ riders, gap }) => {
      const names = riders.slice(0, 3).map((r) => this.name(r)).join('・');
      this.tick(`${names}の逃げが決まった！ 集団とのタイム差は${Math.round(gap)}秒！`, true, 1);
    });
    on('catch', () => {
      this.tick('集団が逃げを吸収！ レースは振り出しに戻った！', true, 1);
    });
    on('kom', ({ rider, place, pts }) => {
      const k = R.course.kom.name;
      if (rider.isPlayer) {
        const h = this.hudFor(rider);
        if (place === 1) { A.fanfare(true); h?.notify(`⛰ ${escapeHtml(k)} 1位通過！<small>山岳ポイント +${pts}pt</small>`, 'kom', 3); }
        else if (pts) { A.fanfare(false); h?.notify(`⛰ ${escapeHtml(k)} ${place}位通過 <small>+${pts}pt</small>`, 'kom', 2.4); }
      }
      if (place === 1) this.tick(`${this.name(rider)}が${escapeHtml(k)}を先頭通過！ 山岳ポイント獲得！`, rider.isPlayer, 2);
    });
    on('sprint', ({ rider, place, pts }) => {
      if (rider.isPlayer) {
        const h = this.hudFor(rider);
        if (place === 1) { A.fanfare(true); h?.notify(`⚡ 中間スプリント 1位！<small>+${pts}pt</small>`, 'spr', 3); }
        else if (pts) { A.fanfare(false); h?.notify(`⚡ 中間スプリント ${place}位 <small>+${pts}pt</small>`, 'spr', 2.4); }
      }
      if (place === 1) this.tick(`中間スプリントは${this.name(rider)}が先着！`, rider.isPlayer, 2);
    });
    on('item', ({ rider, item }) => {
      if (!rider.isPlayer) return;
      A.itemGet();
      const key = multi ? (rider.playerIndex === 0 ? 'A' : '←') : 'E';
      this.hudFor(rider)?.notify(`${item.icon} アイテムゲット！<small>${escapeHtml(item.name)}：${escapeHtml(item.desc)}　[${key}]で使う</small>`, 'item', 3);
    });
    on('useitem', ({ rider, item }) => {
      if (rider.isPlayer) {
        A.itemUse();
        this.hudFor(rider)?.notify(`${item.icon} ${escapeHtml(item.name)} 発動！`, 'item', 1.6);
        this.camRigs[rider.playerIndex]?.punch(0.6);
      }
      R.world.firework(...rider.model.root.position.toArray().map((v, i) => (i === 1 ? v + 1 : v)), item.color, 36, 5);
    });
    on('blown', ({ rider }) => {
      if (rider.isPlayer) {
        A.blown();
        this.hudFor(rider)?.notify('💫 脚が止まった…！<small>少し休んでスタミナを回復しよう</small>', 'danger', 2.6);
        this.tick(`${this.name(rider)}、脚が止まったか…！？ ここは耐えどころ！`, true, 1);
      } else if (R.players.some((p) => Math.abs(p.dist - rider.dist) < 40)) {
        this.tick(`${this.name(rider)}が遅れ始めた！`, false);
      }
    });
    on('position', ({ rider, from, to }) => {
      const h = this.hudFor(rider);
      if (to < from) {
        A.ding();
        if (to <= 3 || from - to >= 2) h?.notify(`⬆ ${to}位に浮上！`, 'up', 1.4);
        if (to === 1 && R.isRace) this.tick(`${this.name(rider)}がついに先頭に立った！`, true, 2);
      } else if (to > from && to - from >= 2) {
        A.down();
      }
    });
    on('remaining', ({ rider, mark }) => {
      const h = this.hudFor(rider);
      if (mark === 3000) { this.tick('残り3キロ！ 集団のペースが上がってきた！', true, 1); A.setLevel(2); }
      if (mark === 1000) {
        h?.notify('🚩 ラスト 1km！', 'last', 2);
        this.tick('フラムルージュ通過！ ラスト1キロだ！', true, 3);
        A.setLevel(2);
        A.cheer();
      }
      if (mark === 500) h?.notify('ラスト 500m！', 'last', 1.5);
      if (mark === 200) {
        h?.notify('🔥 ラスト 200m！ もがけー！', 'last', 1.8);
        this.tick('ラスト200メートル！ スプリント勝負だーー！！', true, 3);
        A.setLevel(3);
      }
    });
    on('sprintStart', ({ rider }) => {
      if (R.players.some((p) => Math.abs(p.dist - rider.dist) < 40) && Math.random() < 0.5) {
        this.tick(`${this.name(rider)}がスプリントを開始！`, false);
      }
    });
    on('dropped', ({ rider }) => {
      const key = multi ? (rider.playerIndex === 0 ? 'W' : '↑') : '↑';
      this.hudFor(rider)?.notify(`💨 集団から遅れてる！<small>[${key}] アタックで追いつこう（スタミナに注意）</small>`, 'warn', 3);
    });
    on('say', ({ rider, text }) => {
      this.all((h) => h.bubble(rider, text));
    });
    on('rivalSwap', ({ rider, rival, ahead }) => {
      if (ahead) this.tick(`ライバル${this.name(rival)}が${this.name(rider)}をかわしていく！`, false);
      else this.tick(`${this.name(rider)}がライバル${this.name(rival)}を抜き返した！ 熱い！`, false);
    });
    on('lap', ({ rider, lap }) => {
      if (R.isRace && R.laps > 1 && lap < R.laps) this.hudFor(rider)?.notify(`🔁 ${lap + 1}周目 / ${R.laps}`, 'info', 1.8);
      if (!R.isRace) this.hudFor(rider)?.notify(`🔁 ${lap}周 完走！`, 'info', 1.8);
    });
    on('finish', ({ rider, place, time, gap, photo }) => {
      if (rider.isPlayer) {
        const h = this.hudFor(rider);
        const total = R.riders.length;
        if (place === 1) {
          A.winJingle();
          h?.notify(`<span class="big">🏆 優勝！</span><small>${fmtTime(time)}</small>`, 'win', 5);
          this.tick(`${this.name(rider)}が優勝ーー！！ 見事なスプリント！`, true, 3);
        } else {
          if (place <= 3) A.fanfare(true); else A.fanfare(false);
          h?.notify(`<span class="big">🏁 ${place}位</span><small>/${total}　トップから +${gap.toFixed(1)}s</small>`, place <= 3 ? 'win' : 'info', 4);
          this.tick(`${this.name(rider)}、${place}位でゴール！`, true, 3);
        }
        if (photo) this.all((hh) => hh.notify('📸 写真判定！！', 'photo', 2));
        this.onFinishFx?.(rider, place);
      } else if (place === 1) {
        const pl = R.players.find((p) => !p.finished && p.dist > R.raceDist - 400);
        this.tick(`${this.name(rider)}が先頭でゴール！${pl ? ' まだ表彰台は狙える！' : ''}`, !R.players.some((p) => p.finished), 3);
        A.cheer();
      }
    });
  }

  showCount(text, cls = '') {
    const el = document.getElementById('countdown');
    if (!el) return;
    el.textContent = text;
    el.className = 'show ' + cls;
    clearTimeout(this._ct);
    this._ct = setTimeout(() => (el.className = ''), cls === 'go' ? 900 : 800);
  }

  dispose() {
    for (const off of this.offs) off();
    this.offs = [];
  }
}
