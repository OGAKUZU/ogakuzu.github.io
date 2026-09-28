// ZOOMIES! メイン：レンダラー・状態遷移・ゲームループ
import * as THREE from 'three';
import { COURSES, ANIMALS } from './config.js';
import { Course } from './course.js';
import { World } from './world.js';
import { Race } from './race.js';
import { RiderModel } from './rider-model.js';
import { CameraRig, CAM_MODES } from './camera.js';
import { PlayerHUD } from './hud.js';
import { AudioEngine } from './audio.js';
import { DeviceSet } from './ble.js';
import { PlayerControl, InputManager } from './controls.js';
import { SpeedLines, WindStreaks, Confetti } from './fx.js';
import { Commentary } from './commentary.js';
import { UI } from './ui.js';
import { store } from './storage.js';
import { canvasTexture, FONT_POP } from './geom.js';
import { clamp, params, fmtTime, damp, escapeHtml, pick } from './util.js';

function detectQuality(setting) {
  const q = params.get('quality') || setting;
  const mobile = matchMedia('(pointer: coarse)').matches || Math.min(screen.width, screen.height) < 700;
  const level = q === 'auto' || !q ? (mobile ? 'low' : 'high') : q;
  const dpr = window.devicePixelRatio || 1;
  switch (level) {
    case 'low':
      return { level, shadows: false, shadowSize: 1024, density: 0.45, terrainRes: 161, particles: false, pixelRatio: Math.min(dpr, 1), antialias: false };
    case 'mid':
      return { level, shadows: true, shadowSize: 1024, density: 0.7, terrainRes: 193, particles: true, pixelRatio: Math.min(dpr, 1.25), antialias: true };
    default:
      return { level: 'high', shadows: true, shadowSize: 2048, density: 1, terrainRes: 257, particles: true, pixelRatio: Math.min(dpr, 1.75), antialias: true };
  }
}

class Game {
  constructor() {
    this.settings = store.loadSettings();
    this.profiles = [store.loadProfile(0), store.loadProfile(1)];
    this.quality = detectQuality(this.settings.quality);
    const canvas = document.getElementById('gl');
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: this.quality.antialias, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(this.quality.pixelRatio);
    this.renderer.setSize(window.innerWidth, window.innerHeight, false);
    this.renderer.shadowMap.enabled = this.quality.shadows;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.scene = new THREE.Scene();
    this.cameras = [0, 1].map((i) => {
      const c = new THREE.PerspectiveCamera(60, 1, 0.1, 9000);
      c.layers.enable(i + 1);
      return c;
    });
    this.audio = new AudioEngine(this.settings);
    this.devices = [new DeviceSet('P1'), new DeviceSet('P2')];
    this.devices.forEach((d, i) => {
      d.on('disconnect', ({ name }) => this.ui?.toast(`⚠ P${i + 1} ${name} の接続が切れました。再接続を試みます…`, true));
      d.on('reconnect', ({ name }) => this.ui?.toast(`✅ ${name} に再接続しました`));
    });
    this.input = new InputManager();
    this.speedLines = new SpeedLines(document.getElementById('fx2d'));
    this.hudLayer = document.getElementById('hud-layer');
    this.globalHud = document.getElementById('global-hud');
    this.huds = [];
    this.streaks = [];
    this.state = 'loading';
    this.timeScale = 1;
    this.debugSpeed = clamp(parseFloat(params.get('speed') || '1') || 1, 0.1, 20);
    this.last = performance.now();
    this.fps = 60;
    this.ui = new UI(this);
    this.input.on('camera', () => this.cycleCamera());
    this.input.on('pause', () => this.togglePause());
    this.input.on('mute', () => this.toggleMute());
    this.input.on('hud', () => this.hudLayer.classList.toggle('hidden'));
    window.addEventListener('resize', () => this.resize());
    document.addEventListener('visibilitychange', () => {
      if (document.hidden && (this.state === 'racing' || this.state === 'countdown')) this.pause();
      if (!document.hidden && this.race && this.race.players.length && this.state !== 'results') this.requestWakeLock();
    });
    window.addEventListener('pointerdown', () => this.audio.init(), { once: true });
    window.addEventListener('keydown', () => this.audio.init(), { once: true });
    if (params.get('mockble')) this.devices[0].startMock(this.profiles[0].ftp);
    this.resize();
  }

  async boot() {
    // 看板の文字にかわいいフォントを使うため少しだけ待つ
    try {
      await Promise.race([document.fonts ? document.fonts.load('64px "Mochiy Pop One"') : null, new Promise((r) => setTimeout(r, 1800))]);
    } catch (e) { /* noop */ }
    this.loadCourse(this.settings.course);
    this.startAttract();
    requestAnimationFrame((t) => this.loop(t));
    const auto = params.get('auto');
    if (auto === 'race' || auto === 'group' || auto === 'versus') {
      this.ui.mode = auto;
      if (params.get('laps')) this.settings.laps = +params.get('laps');
      if (params.get('rivals')) this.settings.rivals = +params.get('rivals');
      if (params.get('course')) { this.settings.course = params.get('course'); }
      this.startRace(auto);
    } else if (auto === 'setup') {
      this.ui.openSetup('race');
    } else {
      this.ui.show('title');
    }
    const ld = document.getElementById('loading');
    ld.classList.add('done');
    setTimeout(() => ld.classList.add('gone'), 700);
    window.__game = this;
  }

  courseLength(id) {
    this._lenCache ||= {};
    if (!this._lenCache[id]) this._lenCache[id] = (this.course && this.course.id === id) ? this.course.length : new Course(COURSES.find((c) => c.id === id)).length;
    return this._lenCache[id];
  }

  loadCourse(id) {
    if (this.course && this.course.id === id && this.world) return;
    this.disposeRace();
    if (this.world) this.world.dispose();
    const def = COURSES.find((c) => c.id === id) || COURSES[0];
    this.course = new Course(def);
    this.world = new World({ scene: this.scene, renderer: this.renderer, course: this.course, quality: this.quality });
    this.rigs = this.cameras.map((c, i) => new CameraRig(c, this.course, i));
    this.confetti?.dispose(this.scene);
    this.confetti = new Confetti(this.scene);
    for (const s of this.streaks) s.dispose(this.scene);
    this.streaks = [new WindStreaks(this.scene, 1), new WindStreaks(this.scene, 2)];
  }

  changeCourse(id) {
    const keepPreview = this.state === 'setup';
    this.loadCourse(id);
    this.startAttract(keepPreview);
    if (keepPreview) this.showPreview(this.ui.editP);
  }

  disposeRace() {
    if (this.commentary) { this.commentary.dispose(); this.commentary = null; }
    if (this.race) { this.race.dispose(); this.race = null; }
    for (const h of this.huds) h.destroy();
    this.huds = [];
    if (this.previewModel) { this.scene.remove(this.previewModel.root); this.previewModel.dispose(); this.previewModel = null; }
    if (this.podium) { this.scene.remove(this.podium); this.podium = null; }
    this.podiumCam = null;
    this.podiumRiders = [];
    this.ui.hideTouch();
    this.globalHud.classList.add('hidden');
    this.globalHud.classList.remove('split');
    document.getElementById('vs').classList.add('hidden');
    this.vsShown = false;
    this.hudLayer.classList.remove('intro-hide');
    this.timeScale = 1;
    this.releaseWakeLock();
  }

  // タイトル画面の背景レース
  startAttract(keepState = false) {
    this.disposeRace();
    this.race = new Race({ scene: this.scene, course: this.course, world: this.world, mode: 'attract', settings: { ...this.settings, laps: 1, rivals: 11, difficulty: 'normal' }, players: [], quality: this.quality, seed: Math.floor(Math.random() * 1e9) });
    this.twoP = false;
    this.rigs[0].cinematic('attract');
    if (!keepState) this.state = 'title';
    this.audio.setMusicMode('menu');
  }

  goTitle() {
    this.ui.closeModal('pause');
    this.devices.forEach((d) => d.setSimulation(0, 0.51, true));
    this.startAttract();
    this.ui.show('title');
    this.ui.updateTitleStats();
  }

  // セットアップ画面のキャラクタープレビュー
  showPreview(i) {
    this.state = 'setup';
    const p = this.profiles[i];
    if (this.previewModel) { this.scene.remove(this.previewModel.root); this.previewModel.dispose(); }
    const m = new RiderModel({ animal: p.animal, jersey: p.jersey, bike: p.bike, shadows: this.quality.shadows });
    this.previewModel = m;
    this.scene.add(m.root);
    const s = 18;
    const pos = new THREE.Vector3();
    this.course.worldPos(s, 0, pos);
    const c = this.course.sample(s, {});
    m.root.position.copy(pos);
    m.root.rotation.y = Math.atan2(c.tx, c.tz);
    this.previewS = s;
    this.previewGrade = c.grade;
    this.rigs[0].cinematic('preview');
    // 背景の集団は少し先を走らせる
    if (this.race && this.race.mode === 'attract') {
      for (const r of this.race.riders) r.model.root.visible = false;
    }
  }

  // ---------------------------------------------------------------
  startRace(mode) {
    this.audio.init();
    this.ui.closeModal('pause');
    this.loadCourse(this.settings.course);
    this.disposeRace();
    const twoP = mode === 'versus';
    this.twoP = twoP;
    const nP = twoP ? 2 : 1;
    const controls = [];
    for (let i = 0; i < nP; i++) {
      const ctl = new PlayerControl(i, this.devices[i], this.settings);
      ctl.manualTarget = Math.round(this.profiles[i].ftp * 0.7 / 10) * 10;
      controls.push(ctl);
    }
    this.controls = controls;
    const raceMode = mode === 'group' ? 'group' : 'race';
    const settings = { ...this.settings, rivals: this.settings.rivals };
    this.race = new Race({
      scene: this.scene, course: this.course, world: this.world, mode: raceMode, settings,
      players: controls.map((c, i) => ({ profile: this.profiles[i], control: c })), quality: this.quality, seed: Math.floor(Math.random() * 1e9),
    });
    this.input.bind(controls, twoP);
    // HUD
    this.huds = this.race.players.map((p, i) => {
      const h = new PlayerHUD(this.hudLayer, i, twoP, this.settings);
      h.setupRace(this.race, p);
      return h;
    });
    this.resize();
    this.globalHud.classList.remove('hidden');
    this.globalHud.classList.toggle('split', twoP);
    this.hudLayer.classList.remove('hidden');
    this.hudLayer.classList.add('intro-hide');
    if (matchMedia('(pointer: coarse)').matches || params.get('touch')) this.ui.buildTouch(controls, twoP);
    this.commentary = new Commentary({
      race: this.race, huds: this.huds, audio: this.audio, ticker: document.getElementById('ticker'), camRigs: this.rigs,
      onFinishFx: (r, place) => this.finishFx(r, place),
    });
    this.race.on('finish', ({ rider }) => {
      if (rider.isPlayer) this.onPlayerFinish(rider);
    });
    this.race.on('allPlayersFinished', () => this.onAllFinished());
    this.ui.show(null);
    this.rigs.forEach((rig, i) => {
      rig.mode = 'chase';
      const p = this.race.players[i] || this.race.players[0];
      rig.cinematic('intro', { center: p.dist });
    });
    this.state = 'intro';
    this.introT = mode === 'group' ? 1.2 : 3.2;
    this.audio.setMusicMode('race');
    this.audio.setLevel(1);
    this.finishTimer = 0;
    this.requestWakeLock();
    this.showVS(raceMode);
    const courseName = this.course.name;
    if (raceMode === 'race') {
      this.commentary.tick(`${courseName}、${this.race.laps < 1 ? 'ショート' : this.race.laps + '周'} ${(this.race.raceDist / 1000).toFixed(1)}キロのレース！ まもなくスタート！`, true, 2);
    } else {
      this.commentary.tick(`${courseName}でグループライド！ みんなでゆったり走ろう`, true, 2);
    }
  }

  // スタート前の VS 演出
  showVS(raceMode) {
    const el = document.getElementById('vs');
    const race = this.race;
    const card = (r, side, label) => `<div class="vs-card ${side}" style="--c:${'#' + r.jersey.toString(16).padStart(6, '0')}"><span class="em">${r.emoji}</span><span class="nm">${escapeHtml(r.name)}</span><small>${label}</small></div>`;
    const title = `${this.course.def.emoji} ${escapeHtml(this.course.name)}${raceMode === 'race' ? ` ・ ${(race.raceDist / 1000).toFixed(1)}km` : ''}`;
    let html = '';
    if (this.twoP) {
      html = card(race.players[0], 'l', 'P1') + '<div class="vs-mid">VS</div>' + card(race.players[1], 'r', 'P2');
    } else if (raceMode === 'race') {
      const rival = race.riders.find((r) => r.rival);
      if (rival) {
        html = card(race.players[0], 'l', `FTP ${Math.round(race.players[0].cp)}W`) + '<div class="vs-mid">VS</div>' + card(rival, 'r', '🔥 ライバル');
        setTimeout(() => this.race === race && race.say(rival, pick(Math.random, ['今日こそ決着をつけようぜ！', 'オレの背中、見せてやるよ。', '全力でかかってこい！']), 1), 900);
      }
    }
    if (!html) { el.classList.add('hidden'); return; }
    el.innerHTML = `<div class="vs-title">${title}</div>` + html;
    el.classList.remove('hidden', 'out');
    this.vsShown = true;
  }

  onPlayerFinish(r) {
    const rig = this.rigs[r.playerIndex];
    setTimeout(() => {
      if (this.race && rig && r.finished) rig.cinematic('finish');
    }, 1400);
  }

  onAllFinished() {
    this.state = 'finished';
    this.finishTimer = 5.5;
    this.devices.forEach((d) => d.setSimulation(0, 0.51, true));
  }

  finishFx(r, place) {
    const p = r.model.root.position;
    if (place <= 3) {
      this.confetti.burst(p, 5);
      for (let i = 0; i < 4; i++) {
        setTimeout(() => this.world && this.world.firework(p.x + (Math.random() - 0.5) * 60, p.y + 45 + Math.random() * 25, p.z + (Math.random() - 0.5) * 60, null, 120, 22), i * 450);
      }
    }
  }

  quitRace() {
    if (!this.race || this.race.mode === 'attract') return this.goTitle();
    this.ui.closeModal('pause');
    this.state = 'racing';
    if (this.race.isRace) {
      this.showResults(true);
    } else {
      this.showResults(false);
    }
  }

  showResults(retired = false) {
    const race = this.race;
    this.devices.forEach((d) => d.setSimulation(0, 0.51, true));
    const players = race.players;
    const rows = race.isRace ? race.results() : [];
    // 統計
    for (const p of players) {
      const s = p.stats;
      s.distance = Math.max(0, Math.min(p.dist, race.finishDist) - race.startDist);
      s.avgP = s.time > 0 ? s.energy / s.time : 0;
      s.np = s.npN ? Math.pow(s.np4 / s.npN, 0.25) : s.avgP;
      s.avgV = s.time > 0 ? (s.distance / s.time) * 3.6 : 0;
      s.avgHr = s.hrT > 0 ? s.hrSum / s.hrT : 0;
      s.kj = s.energy / 1000;
      s.maxV *= 3.6;
      if (!p.place && race.isRace) p.place = rows.findIndex((x) => x.r === p) + 1;
    }
    const p0 = players[0];
    const awards = [];
    let record = '';
    if (race.isRace) {
      const komLeader = [...race.riders].sort((a, b) => b.komPts - a.komPts)[0];
      const sprLeader = [...race.riders].sort((a, b) => b.sprintPts - a.sprintPts)[0];
      for (const p of players) {
        const tag = this.twoP ? `P${p.playerIndex + 1} ` : '';
        if (retired && !p.finished) awards.push({ text: `${tag}🏳 リタイア` });
        if (p.place === 1 && p.finished) awards.push({ text: `${tag}🏆 優勝` });
        else if (p.place <= 3 && p.finished) awards.push({ text: `${tag}🏅 表彰台` });
        if (komLeader === p && p.komPts > 0) awards.push({ text: `${tag}⛰ 山岳賞`, cls: 'kom' });
        if (sprLeader === p && p.sprintPts > 0) awards.push({ text: `${tag}⚡ スプリント賞`, cls: 'spr' });
        const rival = race.riders.find((r) => r.rival);
        if (rival && p.finished && (!rival.finished || rival.finishTime > p.finishTime)) awards.push({ text: `${tag}🔥 ライバル${rival.name}に勝利！` });
      }
      if (!this.twoP && p0.finished) {
        const key = `${this.course.id}-${race.laps}`;
        const best = store.record(key);
        if (!best || p0.finishTime < best.time) {
          store.saveRecord(key, { time: p0.finishTime, date: Date.now() });
          record = best ? `自己ベスト更新！（${fmtTime(best.time)} → ${fmtTime(p0.finishTime)}）` : `自己ベスト記録 ${fmtTime(p0.finishTime)}`;
        } else {
          record = `自己ベスト ${fmtTime(best.time)}`;
        }
        store.addStats({ races: 1, wins: p0.place === 1 ? 1 : 0, podiums: p0.place <= 3 ? 1 : 0, km: p0.stats.distance / 1000 });
      }
    } else if (!this.twoP) {
      store.addStats({ km: p0.stats.distance / 1000 });
    }
    // 表彰台（グループライドはライダーのまわりを回るカメラ）
    if (race.isRace) this.buildPodium(rows.slice(0, 3).map((x) => x.r));
    else this.rigs[0].cinematic('finish');
    this.state = 'results';
    this.globalHud.classList.add('hidden');
    this.hudLayer.classList.add('hidden');
    this.ui.hideTouch();
    this.audio.setMusicMode('menu');
    this.releaseWakeLock();
    this.ui.showResults({ race, players, rows, courseName: this.course.name, isRace: race.isRace, twoP: this.twoP, awards, record, retired: retired && !p0.finished });
  }

  // 表彰台（ゴール横）
  buildPodium(top3) {
    const g = new THREE.Group();
    const s = 24;
    const smp = this.course.sample(s, {});
    const lat = -(this.course.halfWidth + 9.5);
    const base = new THREE.Vector3();
    this.course.worldPos(s, lat, base);
    base.y = this.world.heightAt(base.x, base.z);
    const heights = [1.2, 0.85, 0.6];
    const offs = [0, -1, 1]; // 2位は正面から見て左、3位は右
    const cols = [0xffd23f, 0xd9dde6, 0xe8a060];
    const fwd = new THREE.Vector3(smp.tx, 0, smp.tz);
    top3.forEach((r, i) => {
      if (!r) return;
      const block = new THREE.Mesh(new THREE.BoxGeometry(1.4, heights[i], 1.6), new THREE.MeshToonMaterial({ color: cols[i] }));
      block.position.set(offs[i] * 1.5, heights[i] / 2, 0);
      block.castShadow = true;
      block.receiveShadow = true;
      g.add(block);
      const tex = canvasTexture(128, 128, (cx, w, h) => {
        cx.fillStyle = '#fff';
        cx.beginPath();
        cx.arc(w / 2, h / 2, w / 2 - 2, 0, Math.PI * 2);
        cx.fill();
        cx.fillStyle = ['#e0a100', '#8a93a6', '#b86a2c'][i];
        cx.font = `92px ${FONT_POP}`;
        cx.textAlign = 'center';
        cx.textBaseline = 'middle';
        cx.fillText(String(i + 1), w / 2, h / 2 + 6);
      });
      const num = new THREE.Mesh(new THREE.CircleGeometry(0.34, 24), new THREE.MeshBasicMaterial({ map: tex, transparent: true }));
      num.position.set(offs[i] * 1.5, heights[i] * 0.55, 0.81);
      g.add(num);
      r.podium = { x: offs[i] * 1.5, y: heights[i] };
    });
    g.position.copy(base);
    // 表彰台の正面（+z）が道路を向くように
    g.rotation.y = Math.atan2(fwd.x, fwd.z) + Math.PI / 2;
    this.scene.add(g);
    g.updateMatrixWorld(true);
    this.podium = g;
    this.podiumRiders = top3.filter(Boolean);
    this.podiumRiders.forEach((r) => {
      r.onPodium = true;
      const m = r.model;
      m.root.position.copy(g.localToWorld(new THREE.Vector3(r.podium.x, r.podium.y, 0)));
      m.root.rotation.y = g.rotation.y;
    });
    this.podiumT = 0;
    this.rigs[0].clearCinematic();
    this.podiumCam = { center: base.clone().add(new THREE.Vector3(0, 1.4, 0)), a: 0 };
    this.confetti.burst(base, 7);
  }

  // ---------------------------------------------------------------
  cycleCamera(i = 0) {
    const rig = this.rigs[i] || this.rigs[0];
    if (this.state !== 'racing' && this.state !== 'countdown' && this.state !== 'paused') return;
    const label = rig.cycle();
    const el = document.getElementById('cam-label');
    el.textContent = `🎥 ${this.twoP ? `P${i + 1} ` : ''}${label}`;
    el.classList.add('show');
    clearTimeout(this._camT);
    this._camT = setTimeout(() => el.classList.remove('show'), 1500);
  }

  toggleMute() {
    this.audio.init();
    const m = this.audio.toggleMute();
    document.getElementById('btn-mute').textContent = m ? '🔇' : '🔊';
    this.ui.toast(m ? '🔇 ミュート' : '🔊 サウンドON', false, 1200);
  }

  togglePause() {
    if (this.state === 'paused') this.resume();
    else this.pause();
  }

  pause() {
    if (!['racing', 'countdown', 'intro', 'finished'].includes(this.state)) return;
    this.prevState = this.state;
    this.state = 'paused';
    this.input.releaseAll();
    this.devices.forEach((d) => d.setSimulation(0, 0.51, true));
    document.getElementById('btn-quit').textContent = this.race?.isRace ? '🏳 リタイア' : '🏁 ライド終了';
    this.ui.openModal('pause');
  }

  resume() {
    if (this.state !== 'paused') return;
    this.ui.closeModal('pause');
    this.state = this.prevState || 'racing';
    this.last = performance.now();
  }

  async requestWakeLock() {
    try {
      if ('wakeLock' in navigator) this.wakeLock = await navigator.wakeLock.request('screen');
    } catch (e) { /* noop */ }
  }

  releaseWakeLock() {
    try { this.wakeLock?.release(); } catch (e) { /* noop */ }
    this.wakeLock = null;
  }

  // ---------------------------------------------------------------
  viewports() {
    const W = window.innerWidth, H = window.innerHeight;
    if (!this.twoP) return [{ x: 0, y: 0, w: W, h: H }];
    const hw = Math.floor(W / 2);
    return [{ x: 0, y: 0, w: hw - 3, h: H }, { x: hw + 3, y: 0, w: W - hw - 3, h: H }];
  }

  resize() {
    const W = window.innerWidth, H = window.innerHeight;
    this.renderer.setSize(W, H, false);
    this.speedLines.resize();
    const vps = this.viewports();
    vps.forEach((vp, i) => {
      this.cameras[i].aspect = vp.w / vp.h;
      this.cameras[i].updateProjectionMatrix();
      this.huds[i]?.setRect(vp);
    });
  }

  // ---------------------------------------------------------------
  loop(now) {
    requestAnimationFrame((t) => this.loop(t));
    let dt = (now - this.last) / 1000;
    this.last = now;
    if (!(dt > 0)) dt = 0.016;
    dt = Math.min(dt, 0.05);
    this.fps = damp(this.fps, 1 / dt, 2, dt);
    this.adaptQuality(dt);
    try {
      this.frame(dt);
    } catch (e) {
      console.error(e);
      if (!this._errShown) { this._errShown = true; this.ui.toast('エラーが発生しました: ' + e.message, true, 6000); }
    }
  }

  frame(dt) {
    this.simulate(dt);
    this.render();
  }

  // 重い端末では解像度を自動で下げる（画質「おまかせ」時）
  adaptQuality(dt) {
    if (this.settings.quality !== 'auto' || params.get('quality')) return;
    this._aq ||= { low: 0, high: 0, pr: this.quality.pixelRatio, max: this.quality.pixelRatio };
    const aq = this._aq;
    if (this.fps < 40) { aq.low += dt; aq.high = 0; }
    else if (this.fps > 57) { aq.high += dt; aq.low = 0; }
    else { aq.low = Math.max(0, aq.low - dt); aq.high = Math.max(0, aq.high - dt); }
    let pr = aq.pr;
    if (aq.low > 4 && pr > 0.75) pr = Math.max(0.75, pr - 0.25);
    else if (aq.high > 12 && pr < aq.max) pr = Math.min(aq.max, pr + 0.25);
    if (pr !== aq.pr) {
      aq.pr = pr;
      aq.low = aq.high = 0;
      this.renderer.setPixelRatio(pr);
      this.resize();
    }
  }

  // テスト・デバッグ用：描画せずに時間を進める
  fastForward(sec, step = 1 / 30) {
    const n = Math.round(sec / step);
    for (let i = 0; i < n; i++) this.simulate(step, i < n - 1);
  }

  simulate(dt, light = false) {
    const race = this.race;
    const st = this.state;
    const paused = st === 'paused';
    const vps = this.viewports();

    if (st === 'intro') {
      this.introT -= dt;
      if (this.vsShown && this.introT < 0.45) document.getElementById('vs').classList.add('out');
      if (this.introT <= 0) {
        if (this.vsShown) { document.getElementById('vs').classList.add('hidden'); this.vsShown = false; }
        this.hudLayer.classList.remove('intro-hide');
        this.state = 'countdown';
        if (race.mode === 'group') {
          race.state = 'racing';
          race.emit('go', {});
          this.state = 'racing';
        } else race.startCountdown(3);
        this.rigs.forEach((r) => r.clearCinematic());
        this.rigs.forEach((r) => (r.init = false));
      }
    }
    if (st === 'countdown' && race.state === 'racing') this.state = 'racing';

    // スローモーション（ゴール前の接戦）
    let targetScale = 1;
    if (race && race.isRace && (this.state === 'racing') && !this.twoP) {
      const p = race.players[0];
      const rem = race.finishDist - p.dist;
      if (!p.finished && rem > 0 && rem < 9) {
        const close = race.riders.some((o) => o !== p && !o.finished && Math.abs(o.dist - p.dist) < 2.5);
        if (close) targetScale = 0.35;
      }
      if (p.finished && race.t - p.finishTime < 0.8 && this.timeScale < 1) targetScale = 0.35;
    }
    this.timeScale = damp(this.timeScale, targetScale, 8, dt);

    const simDt = paused ? 0 : dt * this.timeScale * this.debugSpeed;
    if (race && simDt > 0) {
      let rem = simDt;
      while (rem > 1e-6) {
        const h = Math.min(rem, 1 / 30);
        race.step(h);
        rem -= h;
      }
    }

    // 見た目の更新
    const cam0 = this.cameras[0];
    if (race && !paused) race.updateVisuals(dt * this.timeScale, cam0.position);
    if (this.previewModel && this.state === 'setup') {
      this.previewModel.update(dt, { speed: 0, cadence: 60, grade: this.previewGrade, happy: true, effort: 0.5 });
    }
    if (this.podium && this.state === 'results') {
      for (const r of this.podiumRiders) r.model.update(dt, { speed: 0, cadence: 0, grade: 0, celebrate: true, happy: true });
    }

    // カメラ
    if (this.state === 'results' && this.podiumCam && this.podium) {
      const pc = this.podiumCam;
      pc.a += dt * 0.25;
      const c = this.cameras[0];
      const sw = Math.sin(pc.a) * 0.9;
      const off = new THREE.Vector3(Math.sin(sw) * 8.5, 2.6, Math.cos(sw) * 8.5).applyAxisAngle(new THREE.Vector3(0, 1, 0), this.podium.rotation.y);
      c.position.copy(pc.center).add(off);
      // リザルト表示（左側）と重ならないよう、表彰台を画面の右寄りに
      const fwdv = pc.center.clone().sub(c.position).normalize();
      const right = new THREE.Vector3().crossVectors(fwdv, c.up).normalize();
      const shift = window.innerWidth > 900 ? 2.6 : 0;
      c.lookAt(pc.center.x - right.x * shift, pc.center.y - 0.2, pc.center.z - right.z * shift);
      if (c.fov !== 50) { c.fov = 50; c.updateProjectionMatrix(); }
    } else if (this.state === 'setup' && this.previewModel) {
      this.rigs[0].update(dt, null, { s: this.previewS });
    } else if (race) {
      const focusList = race.players.length ? race.players : [race.order[0] || race.riders[0]];
      vps.forEach((vp, i) => {
        const r = focusList[i] || focusList[0];
        if (r) this.rigs[i].update(paused ? 0 : dt, r);
      });
    }

    // ワールド
    let focus = null, focusS = 0, excite = 1;
    if (race) {
      const fr = race.players[0] || race.order[0] || race.riders[0];
      if (fr) {
        focus = fr.model.root.position;
        focusS = fr.dist;
      }
    }
    if (this.state === 'setup' && this.previewModel) { focus = this.previewModel.root.position; focusS = this.previewS; }
    if (this.state === 'results' && this.podium) focus = this.podium.position;
    this.world.update(paused ? 0 : dt, cam0, focus, focusS, excite);
    this.confetti.update(paused ? 0 : dt);

    // 効果・HUD・サウンド
    if (!light) this.speedLines.clear();
    const inRace = race && race.players.length && ['racing', 'countdown', 'intro', 'finished', 'paused'].includes(this.state);
    this.inRace = inRace;
    if (inRace) {
      race.players.forEach((p, i) => {
        const vp = vps[i];
        const cam = this.cameras[i];
        const kmh = p.v * 3.6;
        const rig = this.rigs[i];
        const sprint = (p.control?.sprinting || p.standing) && p.v > 8 ? 1 : 0;
        const inten = rig.cine ? 0 : clamp((kmh - 42) / 30, 0, 1) * 0.8 + sprint * 0.55;
        if (!light) {
          this.speedLines.draw(vp, clamp(inten, 0, 1), performance.now() / 1000, sprint ? '255,236,170' : '255,255,255');
          this.streaks[i].update(paused ? 0 : dt, cam, p.v, rig.cine ? 0 : clamp((kmh - 25) / 25, 0, 1));
          this.huds[i]?.update(dt, cam, vp);
        }
        // スマートトレーナーの勾配
        if (this.settings.simMode && this.state === 'racing' && !p.finished) {
          const dif = this.settings.trainerDifficulty / 100;
          const gpct = (p._grade || 0) * 100;
          const g = gpct >= 0 ? gpct * dif : Math.max(-6, gpct * dif * 0.5);
          this.devices[i].setSimulation(Math.round(g * 10) / 10, 0.51 * (1 - p.draft * 0.8));
        }
      });
      // 環境音（1P を基準）
      const p = race.players[0];
      const crowd = this.world.crowdLevel(p.dist);
      const racingNow = this.state === 'racing' || this.state === 'finished';
      this.audio.updateRide({
        speed: p.v, coasting: p.cadence < 5 && p.v > 1, crowd: racingNow ? crowd : 0.2,
        danger: racingNow && !p.finished ? clamp((0.2 - p.wbal.frac) / 0.2, 0, 1) : 0, hr: p.hr || 150, active: !paused, dt,
      });
      if (racingNow && race.isRace && !p.finished) {
        const rem = race.finishDist - p.dist;
        this.audio.setLevel(rem < 250 ? 3 : rem < 3000 || race.onKom(p.dist) ? 2 : 1);
      }
    } else if (this.audio.ctx) {
      this.streaks.forEach((s) => s.update(dt, this.cameras[0], 0, 0));
      const lead = race && race.order[0];
      this.audio.updateRide({ speed: lead ? lead.v * 0.4 : 0, coasting: false, crowd: this.state === 'results' ? 0.5 : 0, danger: 0, active: true, dt });
    }

    if (this.state === 'finished') {
      this.finishTimer -= dt;
      if (this.finishTimer <= 0) this.showResults(false);
    }
  }

  // カメラとプレイヤーの間にいるライダーは視界をふさぐので隠す
  hideNearCamera(cam, keep) {
    const hidden = [];
    const race = this.race;
    if (!race) return hidden;
    const rig = keep ? this.rigs[keep.playerIndex] : null;
    const checkLine = keep && rig && !rig.cine && rig.mode !== 'heli';
    const A = cam.position;
    const B = this._hB || (this._hB = new THREE.Vector3());
    const P = this._hP || (this._hP = new THREE.Vector3());
    let ab2 = 0;
    if (checkLine) {
      B.copy(keep.model.root.position).y += 0.9;
      ab2 = B.distanceToSquared(A);
    }
    for (const r of race.riders) {
      if (r === keep || r.onPodium) continue;
      const root = r.model.root;
      if (!root.visible) continue;
      let hide = root.position.distanceToSquared(A) < 2.2 * 2.2;
      if (!hide && checkLine && ab2 > 0.01) {
        P.copy(root.position).y += 0.8;
        const t = ((P.x - A.x) * (B.x - A.x) + (P.y - A.y) * (B.y - A.y) + (P.z - A.z) * (B.z - A.z)) / ab2;
        if (t > 0 && t < 0.92) {
          const cx = A.x + (B.x - A.x) * t - P.x, cy = A.y + (B.y - A.y) * t - P.y, cz = A.z + (B.z - A.z) * t - P.z;
          hide = cx * cx + cy * cy + cz * cz < 1.15 * 1.15;
        }
      }
      if (hide) {
        root.visible = false;
        hidden.push(root);
        r._camHidden = 2;
      } else if (r._camHidden) r._camHidden--;
    }
    return hidden;
  }

  render() {
    const R = this.renderer;
    const vps = this.viewports();
    const cam0 = this.cameras[0];
    const players = this.race && this.inRace ? this.race.players : [];
    const draw = (cam, keep) => {
      const hidden = this.hideNearCamera(cam, keep);
      R.render(this.scene, cam);
      for (const o of hidden) o.visible = true;
    };
    if (this.twoP && this.inRace) {
      R.setScissorTest(true);
      vps.forEach((vp, i) => {
        const H = window.innerHeight;
        R.setViewport(vp.x, H - vp.y - vp.h, vp.w, vp.h);
        R.setScissor(vp.x, H - vp.y - vp.h, vp.w, vp.h);
        draw(this.cameras[i], players[i]);
      });
      R.setScissorTest(false);
    } else {
      R.setViewport(0, 0, window.innerWidth, window.innerHeight);
      if (Math.abs(cam0.aspect - window.innerWidth / window.innerHeight) > 0.001) {
        cam0.aspect = window.innerWidth / window.innerHeight;
        cam0.updateProjectionMatrix();
      }
      draw(cam0, players[0]);
    }
  }
}

function fatal(msg) {
  const ld = document.getElementById('loading');
  ld.classList.remove('done', 'gone');
  ld.innerHTML = `<div class="spin" style="animation:none">🙀</div><div class="fatal">${msg}</div>`;
}

try {
  const game = new Game();
  window.__booted = true;
  game.boot().catch((e) => {
    console.error(e);
    fatal('起動中にエラーが発生しました。ページを再読み込みしてください。');
  });
} catch (e) {
  console.error(e);
  fatal('このブラウザでは 3D 表示（WebGL）が使えないようです。<br>最新の Chrome / Edge / Safari でお試しください。');
}
