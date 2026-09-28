// HUD（パワー・速度・順位・標高プロファイル・名札・吹き出し・通知）
import * as THREE from 'three';
import { POWERUPS } from './config.js';
import { clamp, fmtTime, fmtGap, escapeHtml, hexToCss, mod } from './util.js';

const TEMPLATE = `
  <div class="hud-tl panel">
    <div class="pw"><span class="pw-val">0</span><span class="unit">W</span></div>
    <div class="pw-sub"><b class="wkg">0.0</b> W/kg <span class="pw-src"></span></div>
    <div class="metrics">
      <div class="m hr"><span class="ic">❤</span><b class="hr-val">--</b><small>bpm</small></div>
      <div class="m cad"><span class="ic">⟳</span><b class="cad-val">--</b><small>rpm</small></div>
    </div>
    <div class="stamina"><div class="stamina-bar"><i></i></div><span class="stamina-label">スタミナ</span></div>
    <div class="draft"><span class="ic">🌬</span> ドラフト <b>0%</b></div>
  </div>
  <div class="hud-tc">
    <div class="speed"><span class="spd-val">0.0</span><span class="unit">km/h</span></div>
    <div class="grade"><span class="grade-arrow">▲</span><b class="grade-val">0.0%</b></div>
    <div class="dist"><b class="dist-val">0.0</b><span class="dist-total"></span> km · <b class="time-val">0:00</b></div>
  </div>
  <div class="hud-tr">
    <div class="pos"><b class="pos-val">-</b><span class="pos-of">/-</span></div>
    <div class="riders"></div>
    <div class="gapinfo"></div>
  </div>
  <div class="hud-bottom">
    <div class="togo"></div>
    <canvas class="profile"></canvas>
  </div>
  <div class="hud-bl">
    <div class="item-slot empty"><span class="item-icon"></span><span class="item-name"></span><span class="item-key"></span><svg class="item-timer" viewBox="0 0 36 36"><circle cx="18" cy="18" r="16"></circle></svg></div>
    <div class="kb-hint"></div>
  </div>
  <div class="segment-banner"></div>
  <div class="notify-area"></div>
  <div class="tags"></div>
  <div class="vignette"></div>
`;

export class PlayerHUD {
  constructor(root, playerIndex, twoPlayer, settings) {
    this.el = document.createElement('div');
    this.el.className = 'hud' + (twoPlayer ? ` split p${playerIndex}` : '');
    this.el.innerHTML = TEMPLATE;
    root.appendChild(this.el);
    this.pi = playerIndex;
    this.twoP = twoPlayer;
    this.settings = settings;
    const q = (s) => this.el.querySelector(s);
    this.$ = {
      pw: q('.pw-val'), wkg: q('.wkg'), src: q('.pw-src'), hr: q('.hr-val'), cad: q('.cad-val'),
      stam: q('.stamina-bar i'), stamWrap: q('.stamina'), stamLabel: q('.stamina-label'), draft: q('.draft'), draftVal: q('.draft b'),
      spd: q('.spd-val'), grade: q('.grade'), gradeVal: q('.grade-val'), gradeArrow: q('.grade-arrow'),
      dist: q('.dist-val'), distTotal: q('.dist-total'), time: q('.time-val'),
      pos: q('.pos-val'), posOf: q('.pos-of'), riders: q('.riders'), gapinfo: q('.gapinfo'),
      togo: q('.togo'), profile: q('.profile'), item: q('.item-slot'), itemIcon: q('.item-icon'), itemName: q('.item-name'), itemKey: q('.item-key'), itemTimer: q('.item-timer circle'),
      kb: q('.kb-hint'), seg: q('.segment-banner'), notify: q('.notify-area'), tags: q('.tags'), vig: q('.vignette'),
    };
    this.cache = new Map();
    this.tagEls = new Map();
    this.bubbles = new Map();
    this.listT = 0;
    this.profT = 0;
    this.profileData = null;
    this._v = new THREE.Vector3();
    this.hintT = 25;
  }

  set(key, val) {
    if (this.cache.get(key) === val) return;
    this.cache.set(key, val);
    this.$[key].textContent = val;
  }

  setRect(r) {
    Object.assign(this.el.style, { left: r.x + 'px', top: r.y + 'px', width: r.w + 'px', height: r.h + 'px' });
    this.rect = r;
    const c = this.$.profile;
    const w = Math.max(200, Math.min(r.w * (this.twoP ? 0.9 : 0.62), 820));
    const h = this.twoP ? 56 : 66;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    c.style.width = w + 'px';
    c.style.height = h + 'px';
    c.width = Math.floor(w * dpr);
    c.height = Math.floor(h * dpr);
    this.profileDpr = dpr;
    this.profileData = null;
  }

  setupRace(race, player) {
    this.race = race;
    this.player = player;
    this.$.distTotal.textContent = race.isRace ? ` / ${(race.raceDist / 1000).toFixed(1)}` : '';
    const ctl = player.control;
    const keysSolo = this.settings.keyboardMode === 'manual'
      ? '<b>↑↓</b> 目標ワット ±10W　<b>Space</b> もがく　<b>E</b> アイテム　<b>←→</b> 移動　<b>C</b> カメラ'
      : '<b>↑</b> アタック　<b>↓</b> 休む　<b>Space</b> もがく(連打でUP)　<b>E</b> アイテム　<b>←→</b> 移動　<b>C</b> カメラ';
    const keysP = this.pi === 0 ? '<b>W</b> アタック <b>S</b> 休む <b>D</b> もがく <b>A</b> アイテム' : '<b>↑</b> アタック <b>↓</b> 休む <b>→</b> もがく <b>←</b> アイテム';
    this.$.kb.innerHTML = this.twoP ? keysP : keysSolo;
    this.$.itemKey.textContent = this.twoP ? (this.pi === 0 ? 'A' : '←') : 'E';
    this.$.tags.innerHTML = '';
    this.tagEls.clear();
    this.bubbles.clear();
    this.cache.clear();
    this.$.notify.innerHTML = '';
    this.profileData = null;
    this.el.classList.toggle('device', !!ctl?.usingDevice);
  }

  // 大きな通知
  notify(html, cls = '', dur = 2.2) {
    const n = document.createElement('div');
    n.className = 'notify ' + cls;
    n.innerHTML = html;
    this.$.notify.appendChild(n);
    while (this.$.notify.children.length > 3) this.$.notify.firstChild.remove();
    setTimeout(() => n.classList.add('out'), dur * 1000);
    setTimeout(() => n.remove(), dur * 1000 + 500);
  }

  bubble(rider, text) {
    this.bubbles.set(rider.id, { text, t: 2.8 });
  }

  update(dt, camera, viewRect) {
    const r = this.player, race = this.race;
    if (!r || !race) return;
    const ctl = r.control;
    const dev = ctl?.usingDevice;
    this.el.classList.toggle('device', !!dev);
    this.set('pw', String(Math.round(r.power)));
    this.set('wkg', (r.power / r.weight).toFixed(1));
    this.set('src', dev ? '⚡ BLE' : ctl?.mode === 'manual' ? `⌨ 目標 ${Math.round(ctl.manualTarget)}W` : ctl?.sprinting ? '🔥 もがき中' : ctl?.keys.attack ? '💥 アタック' : ctl?.keys.rest ? '💤 休む' : '⌨ オート追走');
    this.set('hr', r.hr > 30 ? String(Math.round(r.hr)) : '--');
    this.set('cad', r.cadence > 1 ? String(Math.round(r.cadence)) : '--');
    const wb = r.wbal.frac;
    this.$.stam.style.transform = `scaleX(${wb.toFixed(3)})`;
    this.$.stamWrap.classList.toggle('low', wb < 0.25);
    this.$.stamWrap.classList.toggle('empty', r.exhausted);
    this.set('stamLabel', r.exhausted ? 'ヘロヘロ…！' : dev ? `W′ ${Math.round(wb * 100)}%` : `スタミナ ${Math.round(wb * 100)}%`);
    const dp = Math.round(r.draft * 100);
    this.set('draftVal', dp + '%');
    this.$.draft.classList.toggle('on', dp >= 8);
    this.set('spd', (r.v * 3.6).toFixed(1));
    const g = (r._grade || 0) * 100;
    this.set('gradeVal', `${Math.abs(g).toFixed(1)}%`);
    this.set('gradeArrow', g >= 0.3 ? '▲' : g <= -0.3 ? '▼' : '▶');
    const gcls = g > 7 ? 'g4' : g > 4 ? 'g3' : g > 1.5 ? 'g2' : g < -1.5 ? 'gd' : 'g1';
    if (this.cache.get('gcls') !== gcls) { this.$.grade.className = 'grade ' + gcls; this.cache.set('gcls', gcls); }
    this.set('dist', (Math.max(0, r.dist - race.startDist) / 1000).toFixed(2));
    this.set('time', fmtTime(race.t));

    // 残り距離
    if (race.isRace) {
      const rem = Math.max(0, race.finishDist - r.dist);
      this.set('togo', r.finished ? '🏁 ゴール！' : rem < 1000 ? `ゴールまで ${Math.round(rem)} m` : `ゴールまで ${(rem / 1000).toFixed(1)} km`);
    } else {
      this.set('togo', `周回 ${r.lap + 1} ・ ${(r.dist / 1000).toFixed(1)} km 走行`);
    }

    // アイテム
    const it = r.item ? POWERUPS[r.item] : null;
    const act = r.active ? POWERUPS[r.active.id] : null;
    this.$.item.classList.toggle('empty', !it && !act);
    this.$.item.classList.toggle('active', !!act);
    this.set('itemIcon', act ? act.icon : it ? it.icon : '');
    this.set('itemName', act ? `${act.name} 発動中` : it ? it.name : '');
    if (act) {
      const f = clamp((r.active.until - race.t) / r.active.dur, 0, 1);
      this.$.itemTimer.style.strokeDashoffset = String(100.5 * (1 - f));
    }

    // キーヒントは一定時間で薄く
    this.hintT -= dt;
    this.$.kb.classList.toggle('dim', this.hintT < 0 || !!dev);

    // 区間バナー
    this.updateSegment(r, race);

    // ビネット
    let vig = '';
    if (r.exhausted || wb < 0.15) vig = 'danger';
    else if (ctl?.sprinting || r.standing) vig = 'sprint';
    else if (act) vig = 'item';
    if (this.cache.get('vig') !== vig) { this.$.vig.className = 'vignette ' + vig; this.cache.set('vig', vig); }

    this.listT -= dt;
    if (this.listT <= 0) {
      this.listT = 0.25;
      this.updateList(r, race);
    }
    this.profT -= dt;
    if (this.profT <= 0) {
      this.profT = 0.1;
      this.drawProfile(r, race);
    }
    this.updateTags(dt, camera, viewRect);
  }

  updateSegment(r, race) {
    const c = race.course;
    const L = c.length;
    const lp = mod(r.dist, L);
    let html = '';
    if (race.mode !== 'attract' && r.dist > 0) {
      const inKom = lp > c.kom.s0 && lp < c.kom.s1;
      const inSpr = lp > c.sprint.s0 && lp < c.sprint.s1;
      const toKom = c.kom.s0 - lp;
      if (inKom) {
        html = `<span class="seg kom">⛰ ${c.kom.name}</span> 頂上まで <b>${Math.round(c.kom.s1 - lp)}m</b> <small>平均${(c.kom.avgGrade * 100).toFixed(1)}%</small>`;
      } else if (inSpr) {
        html = `<span class="seg spr">⚡ ${c.sprint.name}</span> ラインまで <b>${Math.round(c.sprint.s1 - lp)}m</b>`;
      } else if (toKom > 0 && toKom < 400) {
        html = `<span class="seg kom">⛰ まもなく ${c.kom.name}</span> <b>${Math.round(toKom)}m</b>`;
      }
      if (race.isRace && !r.finished) {
        const rem = race.finishDist - r.dist;
        if (rem < 1000) html = `<span class="seg fin">🏁 ラスト ${rem < 200 ? 'スプリント！' : Math.round(rem) + 'm'}</span>`;
      }
    }
    if (this.cache.get('seg') !== html) {
      this.cache.set('seg', html);
      this.$.seg.innerHTML = html;
      this.$.seg.classList.toggle('show', !!html);
    }
  }

  updateList(r, race) {
    const st = race.standings;
    if (!st.length) return;
    const n = st.length;
    this.set('pos', String(r.pos || '-'));
    this.set('posOf', `/${n}位`);
    const idx = st.indexOf(r);
    const rows = this.twoP ? 5 : 8;
    let start = clamp(idx - Math.floor(rows / 2), 0, Math.max(0, n - rows));
    const list = st.slice(start, start + rows);
    if (start > 0 && !list.includes(st[0])) list[0] = st[0];
    const komLeader = race.isRace ? st.reduce((a, b) => (b.komPts > (a?.komPts || 0) ? b : a), null) : null;
    const sprLeader = race.isRace ? st.reduce((a, b) => (b.sprintPts > (a?.sprintPts || 0) ? b : a), null) : null;
    let html = '';
    for (const o of list) {
      let gap;
      if (o === r) gap = '';
      else if (o.finished && r.finished) gap = fmtGap(o.finishTime - r.finishTime);
      else if (o.finished) gap = '🏁';
      else if (r.finished) gap = '';
      else gap = fmtGap(-race.gapSec(o, r));
      const badges = (o === komLeader && o.komPts > 0 ? '<i class="bdg kom" title="山岳賞">山</i>' : '') + (o === sprLeader && o.sprintPts > 0 ? '<i class="bdg spr" title="スプリント賞">速</i>' : '') + (o.rival ? '<i class="bdg rv">🔥</i>' : '') + (o.exhausted ? '<i class="bdg ex">💫</i>' : '') + (o.active ? `<i class="bdg it">${POWERUPS[o.active.id].icon}</i>` : '');
      html += `<div class="row${o === r ? ' me' : ''}${o.isPlayer && o !== r ? ' pl' : ''}"><span class="p">${o.pos}</span><span class="chip" style="background:${hexToCss(o.jersey)}"></span><span class="nm">${o.emoji} ${escapeHtml(o.name)}</span>${badges}<span class="g">${gap}</span></div>`;
    }
    if (this.cache.get('list') !== html) {
      this.cache.set('list', html);
      this.$.riders.innerHTML = html;
    }
    // 先頭・逃げとの差
    let info = '';
    if (race.isRace && !r.finished && race.state === 'racing') {
      const lead = race.order[0];
      if (lead && lead !== r) {
        const gs = race.gapSec(lead, r);
        if (race.mainGroup > 0 && r.gi === race.mainGroup) info = `逃げ集団まで <b>${gs < 60 ? gs.toFixed(0) + '秒' : fmtTime(gs)}</b>`;
        else if (gs > 1.5) info = `先頭まで <b>${gs.toFixed(1)}s</b>`;
      } else if (lead === r && race.order[1]) {
        const gs = race.gapSec(r, race.order[1]);
        if (gs > 1) info = `後続に <b>${gs.toFixed(1)}s</b> 差！`;
      }
    }
    this.set('gapinfo', '');
    if (this.cache.get('gapinfoH') !== info) { this.cache.set('gapinfoH', info); this.$.gapinfo.innerHTML = info; }
  }

  drawProfile(r, race) {
    const cv = this.$.profile;
    const g = cv.getContext('2d');
    const W = cv.width, H = cv.height, d = this.profileDpr;
    const c = race.course;
    const total = race.isRace ? race.raceDist : c.length;
    const offset = race.isRace ? race.startDist : Math.floor(Math.max(0, r.dist) / c.length) * c.length;
    if (!this.profileData || this.profileData.total !== total || this.profileData.offset !== offset) {
      const n = 240;
      const hs = [];
      for (let i = 0; i <= n; i++) hs.push(c.heightAt(offset + (i / n) * total));
      const mn = Math.min(...hs), mx = Math.max(...hs);
      this.profileData = { total, offset, hs, mn, mx, n };
    }
    const P = this.profileData;
    g.clearRect(0, 0, W, H);
    const pad = 4 * d;
    const x = (dist) => pad + ((dist - offset) / total) * (W - pad * 2);
    const y = (h) => H - pad - ((h - P.mn) / Math.max(20, P.mx - P.mn)) * (H - pad * 2 - 10 * d);
    // 区間の色
    const firstLap = Math.floor(offset / c.length), lastLap = Math.ceil((offset + total) / c.length);
    g.save();
    g.beginPath();
    g.rect(pad, 0, W - pad * 2, H);
    g.clip();
    for (let l = firstLap; l < lastLap; l++) {
      const base = l * c.length;
      g.fillStyle = 'rgba(232,40,60,0.28)';
      g.fillRect(x(base + c.kom.s0), 0, x(base + c.kom.s1) - x(base + c.kom.s0), H);
      g.fillStyle = 'rgba(24,179,90,0.3)';
      g.fillRect(x(base + c.sprint.s0), 0, x(base + c.sprint.s1) - x(base + c.sprint.s0), H);
    }
    g.restore();
    // 走行済み部分と未走行部分
    const grad = g.createLinearGradient(0, 0, 0, H);
    grad.addColorStop(0, 'rgba(255,255,255,0.95)');
    grad.addColorStop(1, 'rgba(255,255,255,0.35)');
    g.beginPath();
    g.moveTo(x(offset), H);
    for (let i = 0; i <= P.n; i++) g.lineTo(x(offset + (i / P.n) * total), y(P.hs[i]));
    g.lineTo(x(offset + total), H);
    g.closePath();
    g.fillStyle = grad;
    g.fill();
    const px = x(clamp(r.dist, offset, offset + total));
    g.save();
    g.beginPath();
    g.rect(0, 0, px, H);
    g.clip();
    g.fillStyle = 'rgba(255,111,165,0.85)';
    g.fill();
    g.restore();
    // 他のライダー
    for (const o of race.riders) {
      if (o === r) continue;
      const od = race.isRace ? Math.min(o.dist, race.finishDist) : o.dist;
      if (od < offset || od > offset + total) continue;
      const ox = x(od);
      const oy = y(c.heightAt(od)) - 4 * d;
      g.beginPath();
      g.arc(ox, oy, (o.isPlayer ? 4.5 : 3) * d, 0, Math.PI * 2);
      g.fillStyle = hexToCss(o.jersey);
      g.fill();
      g.lineWidth = 1 * d;
      g.strokeStyle = '#222';
      g.stroke();
    }
    // 自分
    const my = y(c.heightAt(r.dist)) - 5 * d;
    g.beginPath();
    g.arc(px, my, 6 * d, 0, Math.PI * 2);
    g.fillStyle = hexToCss(r.jersey);
    g.fill();
    g.lineWidth = 2.5 * d;
    g.strokeStyle = '#fff';
    g.stroke();
    // ゴール旗
    if (race.isRace) {
      g.font = `${14 * d}px sans-serif`;
      g.fillText('🏁', x(offset + total) - 16 * d, 16 * d);
    }
  }

  // 名札と吹き出し
  updateTags(dt, camera, rect) {
    const race = this.race, me = this.player;
    const v = this._v;
    const seen = new Set();
    for (const o of race.riders) {
      if (o === me) continue;
      const dd = o.dist - me.dist;
      const b = this.bubbles.get(o.id);
      if (b) { b.t -= dt; if (b.t <= 0) this.bubbles.delete(o.id); }
      // 名札は近くのライダー・ライバル・しゃべっているライダーだけ（ごちゃつき防止）
      const near = (dd > -12 && dd < 40) || (o.rival && dd > -30 && dd < 120) || (o.isPlayer && dd > -60 && dd < 150);
      const show = (near || !!b) && !(o._camHidden && !this.twoP);
      if (!show) continue;
      o.model.headWorld(v);
      v.project(camera);
      if (v.z > 1 || v.x < -1.1 || v.x > 1.1 || v.y < -1.2 || v.y > 1.2) continue;
      const sx = (v.x * 0.5 + 0.5) * rect.w;
      const sy = (-v.y * 0.5 + 0.5) * rect.h;
      let el = this.tagEls.get(o.id);
      if (!el) {
        el = document.createElement('div');
        el.className = 'tag' + (o.rival ? ' rival' : '') + (o.isPlayer ? ' player' : '');
        el.innerHTML = `<div class="bubble"></div><div class="nm"><i style="background:${hexToCss(o.jersey)}"></i>${escapeHtml(o.name)}</div>`;
        this.$.tags.appendChild(el);
        this.tagEls.set(o.id, el);
        el._bubble = el.querySelector('.bubble');
        el._txt = '';
      }
      seen.add(o.id);
      const distA = Math.abs(dd);
      const sc = clamp(1.25 - distA / 60, 0.55, 1.1);
      el.style.transform = `translate(${sx.toFixed(1)}px, ${sy.toFixed(1)}px) translate(-50%, -100%) scale(${sc.toFixed(2)})`;
      el.style.opacity = String(clamp(1.3 - distA / 55, 0.25, 1));
      el.style.display = '';
      const txt = b ? b.text : '';
      if (el._txt !== txt) {
        el._txt = txt;
        el._bubble.textContent = txt;
        el.classList.toggle('talk', !!txt);
      }
    }
    for (const [id, el] of this.tagEls) if (!seen.has(id)) el.style.display = 'none';
  }

  destroy() {
    this.el.remove();
  }
}
