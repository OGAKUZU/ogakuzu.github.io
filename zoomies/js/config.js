// ゲーム全体の設定データ（どうぶつ・コース・難易度・アイテム）

export const GAME_TITLE = 'ZOOMIES!';

// どうぶつ（キャラクター）定義
// fur: 体毛, fur2: 口元・お腹など, inner: 耳の内側, nose: 鼻, limb: 手足の色（未指定なら fur）
export const ANIMALS = {
  cat: {
    id: 'cat', name: 'ねこ', emoji: '🐱', fur: 0xf7b267, fur2: 0xfff3e3, inner: 0xff9db0, nose: 0xff7a9c,
    ears: 'cat', tail: 'cat', muzzle: false, extra: 'tabby', cry: 'にゃー！',
  },
  shiba: {
    id: 'shiba', name: 'しばいぬ', emoji: '🐶', fur: 0xe9a05a, fur2: 0xfff6ea, inner: 0xfff0dc, nose: 0x2b2323,
    ears: 'shiba', tail: 'curl', muzzle: true, extra: 'maro', cry: 'わんっ！',
  },
  bunny: {
    id: 'bunny', name: 'うさぎ', emoji: '🐰', fur: 0xfdfdfd, fur2: 0xffffff, inner: 0xffb3c6, nose: 0xff8fab,
    ears: 'bunny', tail: 'pompom', muzzle: false, cry: 'ぴょん！',
  },
  bear: {
    id: 'bear', name: 'くま', emoji: '🐻', fur: 0xa0703f, fur2: 0xefd0a4, inner: 0x6e4a28, nose: 0x3a2415,
    ears: 'round', tail: 'stub', muzzle: true, cry: 'がおー！',
  },
  panda: {
    id: 'panda', name: 'パンダ', emoji: '🐼', fur: 0xffffff, fur2: 0xffffff, inner: 0x2a2a2e, nose: 0x2a2a2e,
    ears: 'panda', tail: 'stub', muzzle: false, extra: 'panda', limb: 0x2a2a2e, cry: 'パンパーン！',
  },
  penguin: {
    id: 'penguin', name: 'ペンギン', emoji: '🐧', fur: 0x2e3444, fur2: 0xffffff, inner: 0x2e3444, nose: 0xffa53a,
    ears: 'none', tail: 'stub', muzzle: false, extra: 'penguin', limb: 0x2e3444, cry: 'ペンペン！',
  },
  fox: {
    id: 'fox', name: 'きつね', emoji: '🦊', fur: 0xf28a3c, fur2: 0xffffff, inner: 0xfff4ea, nose: 0x2b2323,
    ears: 'fox', tail: 'fox', muzzle: true, cry: 'コンッ！',
  },
  hamster: {
    id: 'hamster', name: 'ハムスター', emoji: '🐹', fur: 0xf6c68e, fur2: 0xffffff, inner: 0xffb3c6, nose: 0xff8fab,
    ears: 'hamster', tail: 'none', muzzle: false, extra: 'cheeks', cry: 'ハムッ！',
  },
  wolf: {
    id: 'wolf', name: 'オオカミ', emoji: '🐺', fur: 0x7e8898, fur2: 0xe8ecf2, inner: 0xd7dce4, nose: 0x22242a,
    ears: 'wolf', tail: 'wolf', muzzle: true, cry: 'ワオーン！',
  },
};
export const ANIMAL_IDS = Object.keys(ANIMALS);

export const JERSEY_COLORS = [
  0xff5c8a, 0x4fc3f7, 0xffd54f, 0x66bb6a, 0xab47bc, 0xff7043,
  0x26c6da, 0x5c6bc0, 0xf06292, 0x9ccc65, 0x212121, 0xffffff,
];
export const BIKE_COLORS = [
  0xffffff, 0x222222, 0xff4d6d, 0x3fa9f5, 0xffc93c, 0x2ecc71, 0x9b5de5, 0xff8c42,
];

// AI ライダー（名前・どうぶつ・タイプ）
// type: sprinter / climber / breakaway / rouleur / puncheur
export const AI_ROSTER = [
  { name: 'ガロウ', animal: 'wolf', type: 'puncheur', rival: true, shades: true, jersey: 0x212121, bike: 0xff4d6d },
  { name: 'ペン太', animal: 'penguin', type: 'breakaway', jersey: 0x4fc3f7, bike: 0xffffff },
  { name: 'ミミ', animal: 'bunny', type: 'climber', jersey: 0xf06292, bike: 0xffffff },
  { name: 'クマ吉', animal: 'bear', type: 'sprinter', jersey: 0x66bb6a, bike: 0x222222 },
  { name: 'コン', animal: 'fox', type: 'puncheur', jersey: 0xffd54f, bike: 0x222222 },
  { name: 'ハチ', animal: 'shiba', type: 'rouleur', jersey: 0xff7043, bike: 0xffffff },
  { name: 'タマ', animal: 'cat', type: 'sprinter', jersey: 0xab47bc, bike: 0xffc93c },
  { name: 'モチ', animal: 'hamster', type: 'climber', jersey: 0x26c6da, bike: 0xff4d6d },
  { name: 'ササ', animal: 'panda', type: 'rouleur', jersey: 0x9ccc65, bike: 0x222222 },
  { name: 'ミケ', animal: 'cat', type: 'breakaway', jersey: 0xffffff, bike: 0x3fa9f5 },
  { name: 'ポチ', animal: 'shiba', type: 'sprinter', jersey: 0x5c6bc0, bike: 0xffffff },
  { name: 'ユキ', animal: 'bunny', type: 'puncheur', jersey: 0x4fc3f7, bike: 0x9b5de5 },
  { name: 'ゴロー', animal: 'bear', type: 'rouleur', jersey: 0xff5c8a, bike: 0x2ecc71 },
  { name: 'ギン', animal: 'penguin', type: 'climber', jersey: 0xffd54f, bike: 0x3fa9f5 },
  { name: 'ユズ', animal: 'fox', type: 'breakaway', jersey: 0x66bb6a, bike: 0xffc93c },
  { name: 'クルミ', animal: 'hamster', type: 'sprinter', jersey: 0xff7043, bike: 0x222222 },
  { name: 'リンリン', animal: 'panda', type: 'climber', jersey: 0xab47bc, bike: 0xffffff },
  { name: 'ギンジ', animal: 'wolf', type: 'rouleur', jersey: 0x26c6da, bike: 0x222222 },
];

// タイプ別の能力補正
export const AI_TYPES = {
  sprinter:  { label: 'スプリンター', ftp: 0.96, sprint: 1.35, wprime: 1.15, weight: [70, 80], aggression: 0.35 },
  climber:   { label: 'クライマー',   ftp: 1.05, sprint: 0.85, wprime: 0.95, weight: [52, 60], aggression: 0.55 },
  breakaway: { label: '逃げ屋',       ftp: 1.02, sprint: 0.9,  wprime: 1.0,  weight: [62, 70], aggression: 0.9 },
  rouleur:   { label: 'ルーラー',     ftp: 1.03, sprint: 1.0,  wprime: 0.95, weight: [68, 76], aggression: 0.45 },
  puncheur:  { label: 'パンチャー',   ftp: 1.0,  sprint: 1.15, wprime: 1.25, weight: [60, 68], aggression: 0.75 },
};

export const DIFFICULTIES = [
  { id: 'easy', label: 'やさしい', factor: 0.78, spread: 0.08 },
  { id: 'normal', label: 'ふつう', factor: 0.92, spread: 0.08 },
  { id: 'hard', label: 'つよい', factor: 1.03, spread: 0.07 },
  { id: 'oni', label: 'おに', factor: 1.13, spread: 0.05 },
];

// パワーアップ（アイテム）
export const POWERUPS = {
  feather: { id: 'feather', icon: '🪶', name: 'ハネ', desc: '15秒間 体重-12%（登りで最強）', duration: 15, color: 0xfff4a8 },
  aero: { id: 'aero', icon: '🚀', name: 'エアロ', desc: '15秒間 空気抵抗-25%', duration: 15, color: 0x7ad7ff },
  draft: { id: 'draft', icon: '🐟', name: 'コバンザメ', desc: '30秒間 ドラフト効果+60%', duration: 30, color: 0xb3ffb8 },
  tailwind: { id: 'tailwind', icon: '🌪️', name: 'おいかぜ', desc: '12秒間 追い風ブースト', duration: 12, color: 0xffc2e8 },
};
export const POWERUP_IDS = Object.keys(POWERUPS);

// コース定義
// grades: [開始u, 終了u, 勾配%]（u = 周回内の割合）。上りと下りの合計は自動で釣り合わせる。
export const COURSES = [
  {
    id: 'meadow',
    name: 'ひだまり高原',
    emoji: '🌻',
    desc: '風車と花畑の島。名物「もふもふ峠」と高速ダウンヒル！',
    seed: 1207,
    radius: 1150,
    harmonics: [[2, 0.12, 0.4], [3, 0.06, 2.1], [5, 0.02, 0.9]],
    grades: [
      [0.00, 0.06, 0.0], [0.06, 0.14, 2.5], [0.14, 0.20, -2.0], [0.20, 0.24, 1.5],
      [0.24, 0.29, 5.0], [0.29, 0.35, 7.5], [0.35, 0.40, 5.5],
      [0.40, 0.52, -5.5], [0.52, 0.58, -1.0], [0.58, 0.66, 0.0],
      [0.66, 0.74, 3.0], [0.74, 0.82, -3.0], [0.82, 0.90, 1.0], [0.90, 1.00, 0.4],
    ],
    kom: { name: 'もふもふ峠', u0: 0.24, u1: 0.40 },
    shortStart: 0.53,
    sprint: { name: 'ひまわりスプリント', u0: 0.59, u1: 0.66 },
    theme: 'meadow',
  },
  {
    id: 'coast',
    name: 'さくら海岸',
    emoji: '🌸',
    desc: '夕焼けの海辺を駆け抜ける。灯台坂は勾配8%の激坂！',
    seed: 4242,
    radius: 1250,
    harmonics: [[2, 0.1, 1.2], [3, 0.08, 0.3], [4, 0.03, 2.5]],
    grades: [
      [0.00, 0.10, 0.0], [0.10, 0.18, 1.5], [0.18, 0.26, -1.5], [0.26, 0.30, 3.0],
      [0.30, 0.38, 8.0], [0.38, 0.40, 4.0], [0.40, 0.50, -6.0], [0.50, 0.62, 0.0],
      [0.62, 0.72, 2.0], [0.72, 0.80, -2.0], [0.80, 0.88, 1.0], [0.88, 1.00, 0.0],
    ],
    kom: { name: '灯台坂', u0: 0.26, u1: 0.40 },
    shortStart: 0.5,
    sprint: { name: 'なぎさスプリント', u0: 0.55, u1: 0.62 },
    theme: 'coast',
  },
  {
    id: 'night',
    name: 'ネオンナイト',
    emoji: '🌃',
    desc: '光る夜の街を高速周回。スプリンター向けのハイスピードコース！',
    seed: 777,
    radius: 860,
    harmonics: [[3, 0.1, 0.5], [2, 0.06, 1.0], [6, 0.015, 0.2]],
    grades: [
      [0.00, 0.12, 0.0], [0.12, 0.20, 2.0], [0.20, 0.30, 5.0], [0.30, 0.38, -5.0],
      [0.38, 0.55, 0.0], [0.55, 0.62, 1.5], [0.62, 0.70, -1.5], [0.70, 0.80, 0.0],
      [0.80, 0.88, 2.0], [0.88, 1.00, -0.5],
    ],
    kom: { name: 'ネオン大橋', u0: 0.12, u1: 0.30 },
    shortStart: 0.38,
    sprint: { name: 'シティスプリント', u0: 0.73, u1: 0.80 },
    theme: 'night',
  },
];

// テーマ（色・景観）
export const THEMES = {
  meadow: {
    skyTop: 0x4aa8ff, skyHorizon: 0xd4f1ff, skyBottom: 0xa6dcf7,
    sunColor: 0xfff3cf, sunDir: [0.45, 0.62, -0.64], sunIntensity: 2.6,
    hemiSky: 0xe6f6ff, hemiGround: 0x86b86a, hemiIntensity: 1.35,
    fog: 0xd4f1ff, fogNear: 280, fogFar: 2600,
    grass: [0x7fd25e, 0x62bb4b, 0x9be26d], forest: 0x3f9e48, rock: 0xa9a49a, sand: 0xf3e2a9, snow: 0xffffff,
    sea: 0x42b8ec, road: '#6c707b', roadLine: '#ffffff', shoulder: 0x8d8a80,
    trees: ['round', 'round', 'pine', 'bush'], flowers: [0xff7eb6, 0xffe066, 0xffffff, 0xb28dff, 0xff9f59],
    extras: 'windmill', clouds: true, stars: false, particles: 'petal', neon: false,
  },
  coast: {
    skyTop: 0x5a6fd8, skyHorizon: 0xffb892, skyBottom: 0xff9aa8,
    sunColor: 0xffc27a, sunDir: [-0.55, 0.16, -0.82], sunIntensity: 2.3,
    hemiSky: 0xffd9c2, hemiGround: 0x7f8f62, hemiIntensity: 1.25,
    fog: 0xffb892, fogNear: 260, fogFar: 2400,
    grass: [0x94c96a, 0x7db85c, 0xaad47a], forest: 0x5b9a52, rock: 0xb09a8e, sand: 0xf7dcb0, snow: 0xfff4f4,
    sea: 0x4a86cc, road: '#6e6a74', roadLine: '#fff6ee', shoulder: 0x9a8a80,
    trees: ['sakura', 'sakura', 'palm', 'pine'], flowers: [0xffb7d2, 0xffffff, 0xffd1dc],
    extras: 'lighthouse', clouds: true, stars: false, particles: 'sakura', neon: false,
  },
  night: {
    skyTop: 0x070a24, skyHorizon: 0x2d1b5e, skyBottom: 0x140a30,
    sunColor: 0xbfd4ff, sunDir: [0.3, 0.55, 0.78], sunIntensity: 0.9,
    hemiSky: 0x6c7cff, hemiGround: 0x1a1f33, hemiIntensity: 1.1,
    fog: 0x2d1b5e, fogNear: 180, fogFar: 1900,
    grass: [0x1f4a4a, 0x1a3f45, 0x245552], forest: 0x173a3f, rock: 0x3b3a52, sand: 0x3c3656, snow: 0x9ea8d8,
    sea: 0x101b44, road: '#2b2e3d', roadLine: '#7ff9ff', shoulder: 0x2a2840,
    trees: ['pine', 'round'], flowers: [0x7ff9ff, 0xff5ec8, 0xfff36b],
    extras: 'city', clouds: false, stars: true, particles: 'firefly', neon: true,
  },
};

export const LAP_OPTIONS = [0.5, 1, 2, 3]; // 0.5 = ショート（後半だけ）
export const RIVAL_OPTIONS = [1, 7, 11, 15];

export const DEFAULT_PROFILE = {
  name: 'あなた',
  animal: 'cat',
  jersey: 0xff5c8a,
  bike: 0xffffff,
  weight: 65,
  ftp: 200,
};

export const DEFAULT_PROFILE_P2 = {
  name: 'ともだち',
  animal: 'shiba',
  jersey: 0x4fc3f7,
  bike: 0x222222,
  weight: 65,
  ftp: 200,
};

export const DEFAULT_SETTINGS = {
  volume: 0.8,
  music: true,
  voice: true,
  quality: 'auto',
  trainerDifficulty: 50,
  simMode: true,
  keyboardMode: 'auto', // auto: オート追走 / manual: 手動ワット
  course: 'meadow',
  laps: 1,
  rivals: 11,
  difficulty: 'normal',
  mode: 'race', // race / group
};
