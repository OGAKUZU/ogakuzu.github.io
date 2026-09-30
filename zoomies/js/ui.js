// メニュー画面（タイトル・セットアップ・デバイス・設定・リザルト）とタッチ操作
import { ANIMALS, ANIMAL_IDS, JERSEY_COLORS, BIKE_COLORS, COURSES, LAP_OPTIONS, DIFFICULTIES, POWERUPS } from './config.js';
import { store } from './storage.js';
import { bleSupported, bleHelpText } from './ble.js';
import { escapeHtml, hexToCss, fmtTime, fmtTimeMs, clamp } from './util.js';

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];

const RIVALS_BY_MODE = {
  race: [[1, 'ライバル対決'], [7, '7匹'], [11, '11匹'], [15, '15匹']],
  versus: [[0, 'なし'], [3, '3匹'], [7, '7匹'], [11, '11匹']],
  group: [[5, '5匹'], [9, '9匹'], [13, '13匹']],
};
const GROUP_PACE = { easy: 'ゆったり', normal: 'ふつう', hard: 'はやい', oni: 'ガチ' };

export class UI {
  constructor(game) {
    this.g = game;
    this.editP = 0;
    this.devP = 0;
    this.mode = 'race';
    this.modals = [];
    this.bind();
    this.buildStatic();
  }

  // ---------------------------------------------------------------
  show(name) {
    for (const s of $$('.screen:not(.modal)')) s.classList.add('hidden');
    if (name) $(`#screen-${name}`).classList.remove('hidden');
    this.current = name;
  }

  openModal(name) {
    $(`#screen-${name}`).classList.remove('hidden');
    if (!this.modals.includes(name)) this.modals.push(name);
    if (name === 'devices') this.startDevicePoll();
  }

  closeModal(name) {
    const n = name || this.modals[this.modals.length - 1];
    if (!n) return;
    $(`#screen-${n}`).classList.add('hidden');
    this.modals = this.modals.filter((m) => m !== n);
    if (n === 'devices') this.stopDevicePoll();
  }

  toast(msg, err = false, dur = 3200) {
    const el = document.createElement('div');
    el.className = 'toast' + (err ? ' err' : '');
    el.textContent = msg;
    $('#toast').appendChild(el);
    setTimeout(() => el.classList.add('out'), dur);
    setTimeout(() => el.remove(), dur + 500);
  }

  // ---------------------------------------------------------------
  bind() {
    const g = this.g;
    const act = (screen, fn) => {
      $(`#screen-${screen}`).addEventListener('click', (e) => {
        const b = e.target.closest('[data-act]');
        if (!b) return;
        g.audio.init();
        fn(b.dataset.act, b);
      });
    };
    act('title', (a) => {
      if (a === 'race' || a === 'group' || a === 'versus') this.openSetup(a);
      else if (a === 'devices') this.openModal('devices');
      else if (a === 'settings') this.openSettings();
      else if (a === 'howto') this.openModal('howto');
    });
    act('setup', (a) => {
      if (a === 'back') g.goTitle();
      else if (a === 'start') g.startRace(this.mode);
    });
    act('devices', (a) => { if (a === 'close') { this.closeModal('devices'); this.refreshSetupDevice(); } });
    act('settings', (a) => {
      if (a === 'close') this.closeModal('settings');
      if (a === 'reset') {
        if (confirm('記録（自己ベスト・戦績）をリセットしますか？')) {
          try { localStorage.removeItem('zoomies.v1'); } catch (e) { /* noop */ }
          this.toast('記録をリセットしました');
          this.updateTitleStats();
        }
      }
    });
    act('howto', (a) => { if (a === 'close') this.closeModal('howto'); });
    act('pause', (a) => {
      if (a === 'resume') g.resume();
      else if (a === 'camera') g.cycleCamera();
      else if (a === 'devices') this.openModal('devices');
      else if (a === 'quit') g.quitRace();
    });
    act('results', (a) => {
      if (a === 'again') g.startRace(this.mode);
      else if (a === 'title') g.goTitle();
    });
    $('#setup-dev').addEventListener('click', () => this.openModal('devices'));
    $('#btn-cam').addEventListener('click', () => g.cycleCamera());
    $('#btn-pause').addEventListener('click', () => g.togglePause());
    $('#btn-mute').addEventListener('click', () => g.toggleMute());

    // デバイス
    $$('#screen-devices .dev').forEach((el) => {
      $('.dev-btn', el).addEventListener('click', () => this.deviceAction(el.dataset.kind));
    });
    $$('#dev-tabs button').forEach((b) => b.addEventListener('click', () => {
      this.devP = +b.dataset.p;
      $$('#dev-tabs button').forEach((x) => x.classList.toggle('on', x === b));
      this.refreshDevices();
    }));
    const st = g.settings;
    const sim = $('#in-sim');
    sim.checked = st.simMode;
    sim.addEventListener('change', () => { st.simMode = sim.checked; store.saveSettings(st); });
    const td = $('#in-tdiff');
    td.value = st.trainerDifficulty;
    $('#tdiff-val').textContent = st.trainerDifficulty + '%';
    td.addEventListener('input', () => { st.trainerDifficulty = +td.value; $('#tdiff-val').textContent = td.value + '%'; store.saveSettings(st); });
    this.segment('#seg-kbmode', [['auto', 'オート追走'], ['manual', '手動ワット']], () => st.keyboardMode, (v) => { st.keyboardMode = v; store.saveSettings(st); });

    // 設定
    const vol = $('#in-vol');
    vol.value = st.volume;
    vol.addEventListener('input', () => { g.audio.setVolume(+vol.value); store.saveSettings(st); });
    const mus = $('#in-music');
    mus.checked = st.music;
    mus.addEventListener('change', () => { g.audio.setMusic(mus.checked); store.saveSettings(st); });
    const voi = $('#in-voice');
    voi.checked = st.voice;
    voi.addEventListener('change', () => { st.voice = voi.checked; store.saveSettings(st); if (voi.checked) g.audio.say('実況ボイス、オン！', 3); });
    this.segment('#seg-quality', [['auto', 'おまかせ'], ['high', '高'], ['mid', '中'], ['low', '低']], () => st.quality, (v) => {
      st.quality = v;
      store.saveSettings(st);
      $('#quality-note').innerHTML = '画質の変更は <b>再読み込み後</b> に反映されます。<a href="javascript:location.reload()">いま再読み込み</a>';
    });
  }

  buildStatic() {
    const items = Object.values(POWERUPS).map((p) => `<li>${p.icon} <b>${p.name}</b>：${p.desc}</li>`).join('');
    $('#howto-items').innerHTML = items;
    if (!bleSupported()) {
      $('#ble-note').textContent = '⚠ ' + bleHelpText();
      $('#ble-note').classList.add('warn');
    } else {
      $('#ble-note').textContent = 'Bluetooth 対応のパワーメーター・スマートトレーナー・心拍計・ケイデンスセンサーをつなげます。デバイスを起こして（ペダルを回すなど）から「接続する」を押してください。';
    }
    this.updateTitleStats();
  }

  updateTitleStats() {
    const s = store.stats();
    $('#title-stats').textContent = s.races ? `🏁 ${s.races}レース　🏆 ${s.wins}勝　🥉 表彰台 ${s.podiums}回　🚴 ${s.km.toFixed(1)}km` : '';
  }

  segment(sel, options, get, set) {
    const el = $(sel);
    el.innerHTML = options.map(([v, label]) => `<button data-v="${v}">${label}</button>`).join('');
    const refresh = () => $$('button', el).forEach((b) => b.classList.toggle('on', b.dataset.v === String(get())));
    el.onclick = (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      const opt = options.find(([v]) => String(v) === b.dataset.v);
      set(opt[0]);
      refresh();
    };
    refresh();
    return refresh;
  }

  // ---------------------------------------------------------------
  openSetup(mode) {
    this.mode = mode;
    const g = this.g, st = g.settings;
    this.show('setup');
    const two = mode === 'versus';
    $('#rider-tabs').classList.toggle('hidden', !two);
    this.editP = 0;
    $$('#rider-tabs button').forEach((b) => b.classList.toggle('on', b.dataset.p === '0'));
    $$('#rider-tabs button').forEach((b) => (b.onclick = () => {
      this.editP = +b.dataset.p;
      $$('#rider-tabs button').forEach((x) => x.classList.toggle('on', x === b));
      this.fillRider();
      g.showPreview(this.editP);
    }));
    $('#setup-title').textContent = mode === 'group' ? '🚴 グループライド設定' : mode === 'versus' ? '⚔️ 2人対戦の設定' : '🏁 レース設定';
    // コース
    $('#courses').innerHTML = COURSES.map((c) => {
      const len = g.courseLength(c.id);
      return `<button class="course" data-c="${c.id}"><span class="em">${c.emoji}</span><b>${c.name}</b><small>${(len / 1000).toFixed(1)}km</small></button>`;
    }).join('') + '<div class="course-desc" id="course-desc"></div>';
    const refreshCourse = () => {
      $$('#courses .course').forEach((b) => b.classList.toggle('on', b.dataset.c === st.course));
      const c = COURSES.find((x) => x.id === st.course) || COURSES[0];
      $('#course-desc').textContent = c.desc;
    };
    $('#courses').onclick = (e) => {
      const b = e.target.closest('.course');
      if (!b) return;
      st.course = b.dataset.c;
      store.saveSettings(st);
      refreshCourse();
      this.refreshLaps();
      g.changeCourse(st.course);
    };
    refreshCourse();
    this.refreshLaps();
    // ライバル数
    const opts = RIVALS_BY_MODE[mode];
    if (!opts.some(([v]) => v === st.rivals)) st.rivals = opts[Math.min(1, opts.length - 1)][0];
    $('#field-rivals').firstChild.textContent = mode === 'group' ? 'なかま ' : 'ライバル ';
    this.segment('#seg-rivals', opts, () => st.rivals, (v) => { st.rivals = v; store.saveSettings(st); });
    const diffOpts = DIFFICULTIES.map((d) => [d.id, mode === 'group' ? GROUP_PACE[d.id] : d.label]);
    $('#seg-diff').previousSibling.textContent = mode === 'group' ? 'ペース ' : 'つよさ ';
    this.segment('#seg-diff', diffOpts, () => st.difficulty, (v) => { st.difficulty = v; store.saveSettings(st); });

    // どうぶつ
    $('#animals').innerHTML = ANIMAL_IDS.map((id) => `<button data-a="${id}">${ANIMALS[id].emoji}<small>${ANIMALS[id].name}</small></button>`).join('');
    $('#animals').onclick = (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      this.profile().animal = b.dataset.a;
      this.saveRider();
    };
    const sw = (sel, colors, key) => {
      $(sel).innerHTML = colors.map((c) => `<button data-c="${c}" style="background:${hexToCss(c)}" aria-label="color"></button>`).join('');
      $(sel).onclick = (e) => {
        const b = e.target.closest('button');
        if (!b) return;
        this.profile()[key] = +b.dataset.c;
        this.saveRider();
      };
    };
    sw('#sw-jersey', JERSEY_COLORS, 'jersey');
    sw('#sw-bike', BIKE_COLORS, 'bike');
    $('#in-name').oninput = (e) => { this.profile().name = e.target.value.trim() || 'あなた'; this.saveRider(false); };
    $('#in-weight').onchange = (e) => { this.profile().weight = clamp(+e.target.value || 65, 30, 150); this.saveRider(false); this.fillRider(); };
    $('#in-ftp').onchange = (e) => { this.profile().ftp = clamp(+e.target.value || 200, 50, 600); this.saveRider(false); this.fillRider(); };
    this.fillRider();
    this.refreshSetupDevice();
    g.showPreview(0);
  }

  refreshLaps() {
    const g = this.g, st = g.settings;
    const len = g.courseLength(st.course);
    const def = COURSES.find((c) => c.id === st.course) || COURSES[0];
    const opts = this.mode === 'group' ? [[1, 'エンドレス']] : LAP_OPTIONS.map((n) => [n, n < 1 ? `ショート ${((1 - (def.shortStart ?? 0.5)) * len / 1000).toFixed(1)}km` : `${n}周 ${(n * len / 1000).toFixed(1)}km`]);
    if (this.mode !== 'group' && !LAP_OPTIONS.includes(st.laps)) st.laps = 1;
    this.segment('#seg-laps', opts, () => (this.mode === 'group' ? 1 : st.laps), (v) => { if (this.mode !== 'group') { st.laps = v; store.saveSettings(st); } });
  }

  profile() {
    return this.g.profiles[this.editP];
  }

  saveRider(refreshPreview = true) {
    store.saveProfile(this.editP, this.profile());
    this.fillRider();
    if (refreshPreview) this.g.showPreview(this.editP);
  }

  fillRider() {
    const p = this.profile();
    $$('#animals button').forEach((b) => b.classList.toggle('on', b.dataset.a === p.animal));
    $$('#sw-jersey button').forEach((b) => b.classList.toggle('on', +b.dataset.c === p.jersey));
    $$('#sw-bike button').forEach((b) => b.classList.toggle('on', +b.dataset.c === p.bike));
    if (document.activeElement !== $('#in-name')) $('#in-name').value = p.name;
    $('#in-weight').value = p.weight;
    $('#in-ftp').value = p.ftp;
    const wkg = p.ftp / p.weight;
    const lv = wkg < 2.2 ? 'のんびり' : wkg < 3 ? 'ふつう' : wkg < 3.8 ? 'つよい' : wkg < 4.6 ? 'とてもつよい' : 'プロ級！';
    $('#wkg-hint').innerHTML = `FTP ${wkg.toFixed(2)} W/kg（${lv}）<br><small>FTP＝1時間続けられるパワーの目安。わからなければ「体重×3」くらいでOK。ライバルの強さはこれを基準に決まります。</small>`;
  }

  refreshSetupDevice() {
    const g = this.g;
    const n = this.mode === 'versus' ? 2 : 1;
    let html = '';
    for (let i = 0; i < n; i++) {
      const d = g.devices[i];
      const tag = n > 1 ? `P${i + 1}: ` : '';
      html += `<div>⚡ ${tag}${d.power.connected ? `<b>${escapeHtml(d.power.name)}</b> 接続中${d.power.controllable && g.settings.simMode ? '（勾配連動ON）' : ''}` : 'パワーメーター未接続 → キーボード／タッチで操作'}</div>`;
    }
    $('#setup-dev').innerHTML = html + '<small>タップしてデバイス接続</small>';
    const any = g.devices.some((d) => d.power.connected);
    $('#title-dev').textContent = any ? '✅' : '';
  }

  // ---------------------------------------------------------------
  async deviceAction(kind) {
    const g = this.g;
    const d = g.devices[this.devP];
    const st = kind === 'power' ? d.power : kind === 'hr' ? d.hr : d.cad;
    if (st.connecting) return;
    if (st.connected) {
      d.disconnect(kind);
      this.refreshDevices();
      return;
    }
    if (!bleSupported()) {
      this.toast(bleHelpText(), true, 5000);
      return;
    }
    try {
      if (kind === 'power') await d.connectPower();
      else if (kind === 'hr') await d.connectHR();
      else await d.connectCadence();
      this.toast(`✅ ${st.name} に接続しました`);
    } catch (e) {
      if (e && e.name === 'NotFoundError') return; // キャンセル
      console.error(e);
      this.toast(`接続できませんでした：${e.message || e}`, true, 5000);
    }
    this.refreshDevices();
    this.refreshSetupDevice();
  }

  refreshDevices() {
    const d = this.g.devices[this.devP];
    const vals = {
      power: [d.power, d.powerFresh ? `${Math.round(d.watts)} W` : '-- W', d.power.source],
      hr: [d.hr, d.bpm ? `${Math.round(d.bpm)} bpm` : '-- bpm', ''],
      cad: [d.cad, d.cad.connected && d.cadence ? `${Math.round(d.cadence)} rpm` : '-- rpm', ''],
    };
    for (const el of $$('#screen-devices .dev')) {
      const [st, val, src] = vals[el.dataset.kind];
      el.classList.toggle('on', st.connected);
      el.classList.toggle('busy', !!st.connecting);
      $('.dev-name', el).textContent = st.connecting ? '接続中…' : st.connected ? `${st.name}${src ? `（${src}${st.controllable ? '・負荷制御OK' : ''}）` : ''}` : '未接続';
      $('.dev-val', el).textContent = val;
      $('.dev-btn', el).textContent = st.connected ? '切断する' : '接続する';
    }
  }

  startDevicePoll() {
    this.refreshDevices();
    clearInterval(this._devPoll);
    this._devPoll = setInterval(() => this.refreshDevices(), 300);
  }

  stopDevicePoll() {
    clearInterval(this._devPoll);
  }

  openSettings() {
    this.openModal('settings');
  }

  // ---------------------------------------------------------------
  showResults(data) {
    this.show('results');
    const { race, players, rows, courseName, isRace, twoP, awards, record, retired } = data;
    const p0 = players[0];
    let head = '';
    if (twoP) {
      const [a, b] = players;
      const win = a.place && b.place ? (a.place < b.place ? a : b) : a;
      head = `<div class="res-rank gold">${win.emoji} ${escapeHtml(win.name)} の勝ち！</div><div class="res-sub">P1 ${escapeHtml(a.name)}：${a.place}位 ／ P2 ${escapeHtml(b.name)}：${b.place}位</div>`;
    } else if (isRace && retired) {
      head = `<div class="res-rank">🏳 リタイア</div>`;
    } else if (isRace) {
      const pl = p0.place || rows.findIndex((x) => x.r === p0) + 1;
      const medal = ['🏆 優勝！', '🥈 2位！', '🥉 3位！'][pl - 1] || `🏁 ${pl}位`;
      head = `<div class="res-rank ${pl === 1 ? 'gold' : ''}">${medal}</div>`;
    } else {
      head = `<div class="res-rank">🚴 おつかれさま！</div>`;
    }
    head += `<div class="res-sub">${escapeHtml(courseName)} ・ ${(Math.max(0, p0.stats.distance) / 1000).toFixed(2)}km ・ ${fmtTime(p0.stats.time)}</div>`;
    $('#res-head').innerHTML = head;
    $('#res-awards').innerHTML = awards.map((a) => `<span class="award ${a.cls || ''}">${a.text}</span>`).join('') + (record ? `<span class="award">⭐ ${record}</span>` : '');
    const s = p0.stats;
    const stat = (v, l) => `<div class="stat"><b>${v}</b><small>${l}</small></div>`;
    $('#res-stats').innerHTML = [
      stat(`${Math.round(s.avgP)}W`, '平均パワー'),
      stat(`${Math.round(s.np)}W`, 'NP'),
      stat(`${Math.round(s.maxP)}W`, '最大パワー'),
      stat(`${s.avgV.toFixed(1)}`, '平均 km/h'),
      stat(s.avgHr ? `${Math.round(s.avgHr)}` : '--', '平均心拍'),
      stat(`${Math.round(s.kj)}`, 'kJ（≒kcal）'),
      stat(`${Math.round(s.elev)}m`, '獲得標高'),
      stat(`${s.maxV.toFixed(1)}`, '最高 km/h'),
    ].join('');
    if (isRace) {
      $('#res-table').innerHTML = rows.map((x, i) => {
        const r = x.r;
        const me = r.isPlayer ? ' class="me"' : '';
        const t = i === 0 ? fmtTimeMs(x.time) : `+${(x.time - rows[0].time).toFixed(1)}s${x.est ? '*' : ''}`;
        const pts = (r.komPts ? ` <span title="山岳ポイント">⛰${r.komPts}</span>` : '') + (r.sprintPts ? ` <span title="スプリントポイント">⚡${r.sprintPts}</span>` : '');
        return `<tr${me}><td class="p">${i + 1}</td><td><span class="chip" style="background:${hexToCss(r.jersey)}"></span>${r.emoji} ${escapeHtml(r.name)}${r.rival ? ' 🔥' : ''}${pts}</td><td class="t">${t}</td></tr>`;
      }).join('');
      $('.res-table-wrap').classList.remove('hidden');
    } else {
      $('.res-table-wrap').classList.add('hidden');
    }
  }

  // ---------------------------------------------------------------
  buildTouch(controls, twoP) {
    const root = $('#touch');
    root.innerHTML = '';
    root.classList.remove('hidden');
    $('#app').classList.add('touch-on');
    controls.forEach((ctl, i) => {
      const pad = document.createElement('div');
      pad.className = `tpad p${i}` + (twoP ? ' split' : '');
      pad.innerHTML = `
        <button class="tbtn" data-a="rest"><span>💤</span>休む</button>
        <button class="tbtn" data-a="attack"><span>💥</span>アタック</button>
        <button class="tbtn sprint" data-a="sprint"><span>🔥</span>もがく！</button>
        <button class="tbtn" data-a="item"><span>🎁</span>アイテム</button>
        <button class="tbtn" data-a="camera"><span>🎥</span>カメラ</button>`;
      root.appendChild(pad);
      for (const b of $$('.tbtn', pad)) {
        const a = b.dataset.a;
        const down = (e) => {
          e.preventDefault();
          this.g.audio.init();
          b.classList.add('down');
          if (a === 'camera') this.g.cycleCamera(i);
          else ctl.press(a, false);
        };
        const up = (e) => {
          e.preventDefault();
          b.classList.remove('down');
          if (a !== 'camera') ctl.release(a);
        };
        b.addEventListener('pointerdown', down);
        b.addEventListener('pointerup', up);
        b.addEventListener('pointercancel', up);
        b.addEventListener('pointerleave', up);
      }
    });
  }

  hideTouch() {
    $('#app').classList.remove('touch-on');
    $('#touch').classList.add('hidden');
    $('#touch').innerHTML = '';
  }
}
