// 保存（プロフィール・設定・自己ベスト）— localStorage は使えない環境もあるので安全に
import { DEFAULT_PROFILE, DEFAULT_PROFILE_P2, DEFAULT_SETTINGS } from './config.js';

const KEY = 'zoomies.v1';

function read() {
  try {
    return JSON.parse(localStorage.getItem(KEY) || '{}') || {};
  } catch (e) {
    return {};
  }
}

function write(data) {
  try {
    localStorage.setItem(KEY, JSON.stringify(data));
  } catch (e) { /* 保存できなくても遊べる */ }
}

export const store = {
  loadProfile(i) {
    const d = read();
    const base = i === 0 ? DEFAULT_PROFILE : DEFAULT_PROFILE_P2;
    return { ...base, ...((d.profiles || [])[i] || {}) };
  },
  saveProfile(i, p) {
    const d = read();
    d.profiles = d.profiles || [];
    d.profiles[i] = p;
    write(d);
  },
  loadSettings() {
    const d = read();
    return { ...DEFAULT_SETTINGS, ...(d.settings || {}) };
  },
  saveSettings(s) {
    const d = read();
    d.settings = s;
    write(d);
  },
  record(key) {
    const d = read();
    return (d.records || {})[key] || null;
  },
  saveRecord(key, rec) {
    const d = read();
    d.records = d.records || {};
    d.records[key] = rec;
    write(d);
  },
  stats() {
    const d = read();
    return d.stats || { races: 0, wins: 0, podiums: 0, km: 0 };
  },
  addStats(delta) {
    const d = read();
    const s = d.stats || { races: 0, wins: 0, podiums: 0, km: 0 };
    for (const [k, v] of Object.entries(delta)) s[k] = (s[k] || 0) + v;
    d.stats = s;
    write(d);
    return s;
  },
};
