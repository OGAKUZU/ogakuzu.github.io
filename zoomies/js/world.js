// 3D ワールド：空・地形・道路・景観・観客・ゲート
import * as THREE from 'three';
import { THEMES } from './config.js';
import { mulberry32, Noise2D, smoothstep, lerp, clamp, TAU, mod } from './util.js';
import { PartList, mergeParts, mat, canvasTexture, glowTexture, FONT_POP, FONT_ROUND } from './geom.js';

const TERRAIN = {
  meadow: { hills: [16, 82], peak: 175, bank: 14, fall: [110, 480], snow: 128 },
  coast: { hills: [10, 55], peak: 115, bank: 8, fall: [45, 300], snow: 999 },
  night: { hills: [0.5, 4], peak: 0, bank: 2.5, fall: [80, 360], snow: 999 },
};

const SECTORS = 12;

export class World {
  constructor({ scene, renderer, course, quality }) {
    this.scene = scene;
    this.renderer = renderer;
    this.course = course;
    this.themeId = course.def.theme;
    this.theme = THEMES[this.themeId];
    this.tp = TERRAIN[this.themeId];
    this.quality = quality;
    this.rng = mulberry32(course.def.seed * 7 + 3);
    this.noise = new Noise2D(mulberry32(course.def.seed + 99));
    this.group = new THREE.Group();
    this.group.name = 'world';
    scene.add(this.group);
    this.anims = [];
    this.time = 0;
    this.maxAniso = Math.min(8, renderer.capabilities.getMaxAnisotropy());
    this.disposables = [];
    this.spectators = [];
    this.build();
  }

  // ---------------------------------------------------------------
  build() {
    this.buildSky();
    this.buildLights();
    this.buildTerrain();
    this.buildSea();
    this.buildRoad();
    this.buildRoadMarks();
    this.buildBarriers();
    this.buildPosts();
    this.buildScenery();
    this.buildArches();
    this.buildSigns();
    this.buildSpectators();
    this.buildDistant();
    if (this.theme.clouds) this.buildClouds();
    if (this.theme.stars) this.buildStars();
    if (this.theme.extras === 'windmill') this.buildMeadowExtras();
    if (this.theme.extras === 'lighthouse') this.buildCoastExtras();
    if (this.theme.extras === 'city') this.buildCityExtras();
    if (this.quality.particles) this.buildParticles();
    this.buildFireworks();
  }

  add(obj) {
    this.group.add(obj);
    return obj;
  }

  // ---------------------------------------------------------------
  // 空
  buildSky() {
    const th = this.theme;
    const sunDir = new THREE.Vector3(...th.sunDir).normalize();
    this.sunDir = sunDir;
    const mat = new THREE.ShaderMaterial({
      uniforms: {
        top: { value: new THREE.Color(th.skyTop) },
        horizon: { value: new THREE.Color(th.skyHorizon) },
        bottom: { value: new THREE.Color(th.skyBottom) },
        sunDir: { value: sunDir },
        sunColor: { value: new THREE.Color(th.sunColor) },
        night: { value: this.themeId === 'night' ? 1 : 0 },
      },
      vertexShader: /* glsl */ `
        varying vec3 vDir;
        void main() {
          vDir = normalize(position);
          vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          gl_Position = vec4(p.xy, p.w * 0.99999, p.w);
        }`,
      fragmentShader: /* glsl */ `
        uniform vec3 top; uniform vec3 horizon; uniform vec3 bottom;
        uniform vec3 sunDir; uniform vec3 sunColor; uniform float night;
        varying vec3 vDir;
        void main() {
          vec3 d = normalize(vDir);
          float h = d.y;
          vec3 col;
          if (h >= 0.0) col = mix(horizon, top, pow(smoothstep(0.0, 1.0, h), 0.55));
          else col = mix(horizon, bottom, smoothstep(0.0, -0.25, h));
          float sd = max(dot(d, normalize(sunDir)), 0.0);
          float disk = smoothstep(0.9985 - night * 0.0012, 0.9993 - night * 0.0012, sd);
          col += sunColor * (disk * 1.6 + pow(sd, 18.0) * 0.28 + pow(sd, 4.0) * 0.12 * (1.0 - night));
          gl_FragColor = vec4(col, 1.0);
          #include <colorspace_fragment>
        }`,
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
    });
    const sky = new THREE.Mesh(new THREE.SphereGeometry(5000, 32, 16), mat);
    sky.renderOrder = -10;
    sky.frustumCulled = false;
    this.sky = this.add(sky);
    this.scene.fog = new THREE.Fog(th.fog, th.fogNear, th.fogFar);
    this.scene.background = new THREE.Color(th.fog);
  }

  // ---------------------------------------------------------------
  buildLights() {
    const th = this.theme;
    this.hemi = this.add(new THREE.HemisphereLight(th.hemiSky, th.hemiGround, th.hemiIntensity));
    const sun = new THREE.DirectionalLight(th.sunColor, th.sunIntensity);
    sun.castShadow = !!this.quality.shadows;
    if (sun.castShadow) {
      const sz = this.quality.shadowSize || 2048;
      sun.shadow.mapSize.set(sz, sz);
      const cam = sun.shadow.camera;
      const r = 34;
      cam.left = -r; cam.right = r; cam.top = r; cam.bottom = -r;
      cam.near = 10; cam.far = 400;
      sun.shadow.bias = -0.0006;
      sun.shadow.normalBias = 0.04;
      this.shadowTexel = (2 * r) / sz;
    }
    this.sun = this.add(sun);
    this.add(sun.target);
    // ライト空間の基底（シャドウのちらつき防止スナップ用）
    const f = this.sunDir.clone().negate();
    const up = Math.abs(f.y) > 0.99 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0);
    this._lr = new THREE.Vector3().crossVectors(up, f).normalize();
    this._lu = new THREE.Vector3().crossVectors(f, this._lr).normalize();
  }

  // ---------------------------------------------------------------
  terrainFn(x, z, near) {
    const T = this.tp;
    const W = this.course.halfWidth;
    const d = near.d, yr = near.y;
    const flat = W + 3.6;
    const n1 = this.noise.fbm(x * 0.0026, z * 0.0026, 4) * 0.5 + 0.5;
    const n2 = this.noise.fbm(x * 0.011 + 31.7, z * 0.011 - 12.3, 3);
    let natural;
    if (near.side < 0) {
      const rise = smoothstep(flat, 300, d);
      const hills = lerp(T.hills[0], T.hills[1], n1) + n2 * T.hills[1] * 0.12;
      let pk = 0;
      if (T.peak > 0) {
        const rho = Math.hypot(x, z);
        pk = T.peak * Math.pow(1 - smoothstep(0, this.course.def.radius * 0.8, rho), 1.6) * (0.75 + 0.5 * n1);
      }
      natural = yr + rise * hills + pk + smoothstep(flat, 50, d) * n2 * 1.5;
    } else {
      const bank = smoothstep(flat, 70, d) * (T.bank * (0.4 + 0.6 * n1) + n2 * 2);
      const fall = smoothstep(T.fall[0], T.fall[1], d) * (yr + 26);
      natural = yr + bank - fall;
    }
    const w = smoothstep(flat, W + 38, d);
    return lerp(yr - 0.32, natural, w);
  }

  buildTerrain() {
    const c = this.course, th = this.theme;
    const ext = Math.ceil(c.maxRadius + 850);
    const n = this.quality.terrainRes;
    const step = (ext * 2) / (n - 1);
    const H = new Float32Array(n * n);
    const Dd = new Float32Array(n * n);
    const near = { d: 0, k: 0, s: 0, y: 0, side: 1 };
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        const x = -ext + i * step, z = -ext + j * step;
        c.nearest(x, z, near);
        H[j * n + i] = this.terrainFn(x, z, near);
        Dd[j * n + i] = near.d;
      }
    }
    this.hm = { H, n, ext, step };

    const pos = new Float32Array(n * n * 3);
    const col = new Float32Array(n * n * 3);
    const grassA = new THREE.Color(th.grass[0]), grassB = new THREE.Color(th.grass[1]), grassC = new THREE.Color(th.grass[2]);
    const forest = new THREE.Color(th.forest), rock = new THREE.Color(th.rock), sand = new THREE.Color(th.sand), snow = new THREE.Color(th.snow);
    const tmp = new THREE.Color();
    const shoulderCol = new THREE.Color(th.shoulder);
    const W = c.halfWidth;
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        const k = j * n + i;
        const x = -ext + i * step, z = -ext + j * step, h = H[k];
        pos[k * 3] = x; pos[k * 3 + 1] = h; pos[k * 3 + 2] = z;
        const hx = (H[j * n + Math.min(n - 1, i + 1)] - H[j * n + Math.max(0, i - 1)]) / (2 * step);
        const hz = (H[Math.min(n - 1, j + 1) * n + i] - H[Math.max(0, j - 1) * n + i]) / (2 * step);
        const slope = Math.hypot(hx, hz);
        const n2 = this.noise.fbm(x * 0.013 + 5.1, z * 0.013 + 9.3, 2) * 0.5 + 0.5;
        const n3 = this.noise.fbm(x * 0.005 + 77, z * 0.005 - 41, 2);
        tmp.copy(grassA).lerp(grassB, n2);
        if (n3 > 0.2) tmp.lerp(forest, smoothstep(0.2, 0.45, n3) * 0.8);
        if (n2 > 0.75) tmp.lerp(grassC, (n2 - 0.75) * 2);
        tmp.lerp(rock, smoothstep(0.55, 1.05, slope));
        if (h > this.tp.snow) tmp.lerp(snow, smoothstep(this.tp.snow, this.tp.snow + 25, h) * (slope < 1.5 ? 1 : 0.5));
        tmp.lerp(sand, smoothstep(2.6, 0.9, h));
        if (Dd[k] < W + 2.2) tmp.lerp(shoulderCol, 0.35);
        col[k * 3] = tmp.r; col[k * 3 + 1] = tmp.g; col[k * 3 + 2] = tmp.b;
      }
    }
    const idx = new Uint32Array((n - 1) * (n - 1) * 6);
    let o = 0;
    for (let j = 0; j < n - 1; j++) {
      for (let i = 0; i < n - 1; i++) {
        const a = j * n + i, b = a + 1, cc = a + n, d = cc + 1;
        if ((i + j) & 1) {
          idx[o++] = a; idx[o++] = cc; idx[o++] = b;
          idx[o++] = b; idx[o++] = cc; idx[o++] = d;
        } else {
          idx[o++] = a; idx[o++] = cc; idx[o++] = d;
          idx[o++] = a; idx[o++] = d; idx[o++] = b;
        }
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    geo.setIndex(new THREE.BufferAttribute(idx, 1));
    geo.computeVertexNormals();
    geo.computeBoundingSphere();
    const mesh = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true }));
    mesh.receiveShadow = true;
    mesh.name = 'terrain';
    this.terrain = this.add(mesh);
  }

  // 地形の高さ（双線形補間）
  heightAt(x, z) {
    const { H, n, ext, step } = this.hm;
    const fx = clamp((x + ext) / step, 0, n - 1.001);
    const fz = clamp((z + ext) / step, 0, n - 1.001);
    const i = Math.floor(fx), j = Math.floor(fz);
    const tx = fx - i, tz = fz - j;
    const a = H[j * n + i], b = H[j * n + i + 1], c = H[(j + 1) * n + i], d = H[(j + 1) * n + i + 1];
    return lerp(lerp(a, b, tx), lerp(c, d, tx), tz);
  }

  slopeAt(x, z) {
    const e = 4;
    const hx = (this.heightAt(x + e, z) - this.heightAt(x - e, z)) / (2 * e);
    const hz = (this.heightAt(x, z + e) - this.heightAt(x, z - e)) / (2 * e);
    return Math.hypot(hx, hz);
  }

  // ---------------------------------------------------------------
  buildSea() {
    const th = this.theme;
    const mat = new THREE.MeshPhongMaterial({
      color: th.sea,
      shininess: 90,
      specular: this.themeId === 'night' ? 0x333366 : 0x9ab8d8,
      emissive: this.themeId === 'night' ? 0x050a22 : 0x000000,
    });
    const sea = new THREE.Mesh(new THREE.PlaneGeometry(40000, 40000, 1, 1), mat);
    sea.rotation.x = -Math.PI / 2;
    sea.position.y = 0;
    sea.name = 'sea';
    this.sea = this.add(sea);
  }

  // ---------------------------------------------------------------
  roadTexture() {
    const th = this.theme;
    const rng = mulberry32(5);
    const tex = canvasTexture(256, 512, (g, w, h) => {
      g.fillStyle = th.road;
      g.fillRect(0, 0, w, h);
      for (let i = 0; i < 7000; i++) {
        const v = Math.floor(rng() * 60) - 30;
        g.fillStyle = `rgba(${128 + v},${128 + v},${135 + v},${0.08 + rng() * 0.12})`;
        g.fillRect(rng() * w, rng() * h, 1 + rng() * 2, 1 + rng() * 2);
      }
      g.fillStyle = 'rgba(0,0,0,0.07)';
      g.fillRect(44, 0, 34, h);
      g.fillRect(178, 0, 34, h);
      g.fillStyle = th.roadLine;
      g.fillRect(9, 0, 7, h);
      g.fillRect(240, 0, 7, h);
      g.fillRect(125, 0, 6, 150);
      g.fillRect(125, 256, 6, 150);
    });
    tex.wrapS = THREE.ClampToEdgeWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.anisotropy = this.maxAniso;
    if (th.neon) {
      this.roadEmissive = canvasTexture(256, 512, (g, w, h) => {
        g.fillStyle = '#000';
        g.fillRect(0, 0, w, h);
        g.fillStyle = '#fff';
        g.fillRect(9, 0, 7, h);
        g.fillRect(240, 0, 7, h);
        g.fillRect(125, 0, 6, 150);
        g.fillRect(125, 256, 6, 150);
      });
      this.roadEmissive.wrapT = THREE.RepeatWrapping;
      this.roadEmissive.anisotropy = this.maxAniso;
    }
    return tex;
  }

  buildRoad() {
    const c = this.course, M = c.count, W = c.halfWidth;
    const tileLen = c.length / Math.round(c.length / 20);
    const rp = new Float32Array((M + 1) * 2 * 3);
    const ruv = new Float32Array((M + 1) * 2 * 2);
    const sp = new Float32Array((M + 1) * 4 * 3);
    const scol = new Float32Array((M + 1) * 4 * 3);
    const shoulder = new THREE.Color(this.theme.shoulder);
    const dark = shoulder.clone().multiplyScalar(0.8);
    const SW = 1.5;
    for (let k = 0; k <= M; k++) {
      const kk = k % M;
      const x = c.X[kk], z = c.Z[kk], y = c.Y[kk];
      const lx = c.TZ[kk], lz = -c.TX[kk];
      const v = (k * c.ds) / tileLen;
      let o = k * 6;
      rp[o] = x + lx * W; rp[o + 1] = y + 0.02; rp[o + 2] = z + lz * W;
      rp[o + 3] = x - lx * W; rp[o + 4] = y + 0.02; rp[o + 5] = z - lz * W;
      ruv[k * 4] = 0; ruv[k * 4 + 1] = v; ruv[k * 4 + 2] = 1; ruv[k * 4 + 3] = v;
      o = k * 12;
      const pts = [[W + SW, -0.55], [W, 0.02], [-W, 0.02], [-W - SW, -0.55]];
      for (let q = 0; q < 4; q++) {
        const [lat, dy] = pts[q];
        sp[o + q * 3] = x + lx * lat;
        sp[o + q * 3 + 1] = y + dy;
        sp[o + q * 3 + 2] = z + lz * lat;
        const cc = (q === 0 || q === 3) ? dark : shoulder;
        scol[o + q * 3] = cc.r; scol[o + q * 3 + 1] = cc.g; scol[o + q * 3 + 2] = cc.b;
      }
    }
    const ri = new Uint32Array(M * 6);
    const si = new Uint32Array(M * 12);
    for (let k = 0; k < M; k++) {
      const a = k * 2, b = a + 1, cc = a + 2, d = a + 3;
      ri.set([a, b, cc, b, d, cc], k * 6);
      const p0 = k * 4, n0 = (k + 1) * 4;
      si.set([p0, p0 + 1, n0, p0 + 1, n0 + 1, n0, p0 + 2, p0 + 3, n0 + 2, p0 + 3, n0 + 3, n0 + 2], k * 12);
    }
    const rg = new THREE.BufferGeometry();
    rg.setAttribute('position', new THREE.BufferAttribute(rp, 3));
    rg.setAttribute('uv', new THREE.BufferAttribute(ruv, 2));
    rg.setIndex(new THREE.BufferAttribute(ri, 1));
    rg.computeVertexNormals();
    const tex = this.roadTexture();
    const rmat = new THREE.MeshLambertMaterial({ map: tex });
    if (this.roadEmissive) {
      rmat.emissiveMap = this.roadEmissive;
      rmat.emissive = new THREE.Color(0x66f6ff);
      rmat.emissiveIntensity = 1.0;
    }
    const road = new THREE.Mesh(rg, rmat);
    road.receiveShadow = true;
    road.name = 'road';
    this.road = this.add(road);

    const sg = new THREE.BufferGeometry();
    sg.setAttribute('position', new THREE.BufferAttribute(sp, 3));
    sg.setAttribute('color', new THREE.BufferAttribute(scol, 3));
    sg.setIndex(new THREE.BufferAttribute(si, 1));
    sg.computeVertexNormals();
    const sh = new THREE.Mesh(sg, new THREE.MeshLambertMaterial({ vertexColors: true }));
    sh.receiveShadow = true;
    this.add(sh);
  }

  // 道路に沿ったリボン（路面ペイント等）
  ribbon(s0, s1, latL, latR, yOff, step = 1) {
    const c = this.course;
    const n = Math.max(2, Math.ceil((s1 - s0) / step) + 1);
    const pos = new Float32Array(n * 2 * 3), uv = new Float32Array(n * 2 * 2);
    const smp = { x: 0, y: 0, z: 0, tx: 0, tz: 1, grade: 0, curv: 0 };
    for (let i = 0; i < n; i++) {
      const t = i / (n - 1);
      const s = lerp(s0, s1, t);
      c.sample(s, smp);
      const lx = smp.tz, lz = -smp.tx;
      pos.set([smp.x + lx * latL, smp.y + yOff, smp.z + lz * latL, smp.x + lx * latR, smp.y + yOff, smp.z + lz * latR], i * 6);
      uv.set([0, t, 1, t], i * 4);
    }
    const idx = [];
    for (let i = 0; i < n - 1; i++) {
      const a = i * 2, b = a + 1, cc = a + 2, d = a + 3;
      idx.push(a, b, cc, b, d, cc);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    g.setIndex(idx);
    g.computeVertexNormals();
    return g;
  }

  // 道路脇の縦の帯（フェンス・看板）
  wall(s0, s1, lat, y0, y1, uLen, flipU, step = 2) {
    const c = this.course;
    const n = Math.max(2, Math.ceil((s1 - s0) / step) + 1);
    const pos = new Float32Array(n * 2 * 3), uv = new Float32Array(n * 2 * 2);
    const smp = { x: 0, y: 0, z: 0, tx: 0, tz: 1, grade: 0, curv: 0 };
    for (let i = 0; i < n; i++) {
      const s = lerp(s0, s1, i / (n - 1));
      c.sample(s, smp);
      const x = smp.x + smp.tz * lat, z = smp.z - smp.tx * lat;
      pos.set([x, smp.y + y0, z, x, smp.y + y1, z], i * 6);
      const u = ((s - s0) / uLen) * (flipU ? -1 : 1);
      uv.set([u, 0, u, 1], i * 4);
    }
    const idx = [];
    for (let i = 0; i < n - 1; i++) {
      const a = i * 2, b = a + 1, cc = a + 2, d = a + 3;
      idx.push(a, cc, b, b, cc, d);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    g.setIndex(idx);
    g.computeVertexNormals();
    return g;
  }

  buildRoadMarks() {
    const c = this.course, W = c.halfWidth;
    const checker = canvasTexture(256, 64, (g, w, h) => {
      const n = 16, m = 4;
      for (let i = 0; i < n; i++) for (let j = 0; j < m; j++) {
        g.fillStyle = (i + j) % 2 ? '#111' : '#fff';
        g.fillRect((i * w) / n, (j * h) / m, w / n + 1, h / m + 1);
      }
    });
    const dots = canvasTexture(256, 64, (g, w, h) => {
      g.fillStyle = '#fff';
      g.fillRect(0, 0, w, h);
      g.fillStyle = '#e8283c';
      for (let i = 0; i < 16; i++) for (let j = 0; j < 4; j++) {
        g.beginPath();
        g.arc((i + 0.5 + (j % 2) * 0.5) * (w / 16), (j + 0.5) * (h / 4), 5.5, 0, TAU);
        g.fill();
      }
    });
    const green = canvasTexture(256, 64, (g, w, h) => {
      g.fillStyle = '#18b35a';
      g.fillRect(0, 0, w, h);
      g.fillStyle = '#fff';
      for (let i = 0; i < 16; i += 2) g.fillRect((i * w) / 16, 0, w / 16, h);
    });
    const mk = (s, len, tex) => {
      const m = new THREE.Mesh(this.ribbon(s - len / 2, s + len / 2, W, -W, 0.045, 0.5), new THREE.MeshLambertMaterial({ map: tex, polygonOffset: true, polygonOffsetFactor: -2 }));
      m.receiveShadow = true;
      this.add(m);
    };
    mk(0, 2.4, checker);
    mk(c.kom.s0, 1.2, dots);
    mk(c.kom.s1, 1.6, dots);
    mk(c.sprint.s0, 1.2, green);
    mk(c.sprint.s1, 1.6, green);

    // ゴール前の路面ペイント文字
    const words = canvasTexture(512, 256, (g, w, h) => {
      g.clearRect(0, 0, w, h);
      g.fillStyle = 'rgba(255,255,255,0.85)';
      g.font = `bold 170px ${FONT_POP}`;
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText('GO!!', w / 2, h / 2 + 10);
    });
    const paint = new THREE.MeshLambertMaterial({ map: words, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3 });
    for (const s of [c.length - 60, c.kom.s1 - 40]) {
      // 手前から奥へ読める向き（u: 左→右, v: 手前→奥）
      const g = this.ribbon(s - 5, s + 5, W * 0.7, -W * 0.7, 0.05, 1);
      const m = new THREE.Mesh(g, paint);
      m.renderOrder = 1;
      this.add(m);
    }
  }

  // ---------------------------------------------------------------
  bannerTexture(texts, bg, fg) {
    return canvasTexture(1024, 128, (g, w, h) => {
      g.fillStyle = bg;
      g.fillRect(0, 0, w, h);
      g.font = `64px ${FONT_POP}`;
      g.textBaseline = 'middle';
      g.textAlign = 'center';
      const seg = w / texts.length;
      texts.forEach((t, i) => {
        g.fillStyle = fg[i % fg.length];
        g.fillText(t, seg * (i + 0.5), h / 2 + 4);
      });
    }, { repeat: true });
  }

  buildBarriers() {
    const c = this.course, W = c.halfWidth, L = c.length;
    const tex = this.bannerTexture(['ZOOMIES!', 'がんばれ〜!', '🐾 にくきゅう', 'もふもふ'], '#ffffff', ['#ff4f8b', '#2a9df4', '#ff9f1c', '#8e5cf7']);
    tex.anisotropy = this.maxAniso;
    const mat = new THREE.MeshLambertMaterial({ map: tex, side: THREE.DoubleSide });
    const zones = [[L - 300, L + 50], [c.sprint.s1 - 160, c.sprint.s1 + 25], [c.kom.s1 - 110, c.kom.s1 + 25]];
    this.barrierZones = zones;
    const legMat = new THREE.MeshLambertMaterial({ color: 0x888888 });
    for (const [s0, s1] of zones) {
      for (const side of [1, -1]) {
        const lat = side * (W + 0.55);
        const m = new THREE.Mesh(this.wall(s0, s1, lat, 0.2, 1.15, 8, side < 0), mat);
        m.receiveShadow = true;
        this.add(m);
        const leg = new THREE.Mesh(this.wall(s0, s1, lat, -0.3, 0.2, 8, false), legMat);
        this.add(leg);
      }
    }
  }

  inBarrierZone(s) {
    const L = this.course.length;
    for (const [s0, s1] of this.barrierZones) {
      const d = mod(s - s0, L);
      if (d < s1 - s0) return true;
    }
    return false;
  }

  buildPosts() {
    const c = this.course, W = c.halfWidth;
    const pl = new PartList();
    pl.cyl([0, 0.5, 0], 0.06, 0.07, 1.0, 0xffffff, [0, 0, 0], 6);
    pl.box([0, 0.85, 0.07], [0.1, 0.16, 0.02], 0xff5a3c);
    const geo = pl.build();
    const items = [];
    const smp = {};
    for (let s = 0; s < c.length; s += 24) {
      if (this.inBarrierZone(s)) continue;
      c.sample(s, smp);
      for (const side of [1, -1]) {
        const lat = side * (W + 1.9);
        const x = smp.x + smp.tz * lat, z = smp.z - smp.tx * lat;
        items.push({ x, y: this.heightAt(x, z) - 0.1, z, ry: Math.atan2(smp.tx, smp.tz) + Math.PI, s: 1 });
      }
    }
    this.instanced(geo, new THREE.MeshLambertMaterial({ vertexColors: true }), items, false);
  }

  // インスタンス化（扇形セクターに分けてカリングを効かせる）
  instanced(geo, material, items, shadows = false, sectorize = true) {
    const groups = new Map();
    for (const it of items) {
      let key = 0;
      if (sectorize) {
        const rho = Math.hypot(it.x, it.z);
        key = rho < this.course.def.radius * 0.45 ? SECTORS : Math.floor((mod(Math.atan2(it.z, it.x), TAU) / TAU) * SECTORS);
      }
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(it);
    }
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), p = new THREE.Vector3(), sc = new THREE.Vector3();
    const col = new THREE.Color();
    const meshes = [];
    for (const list of groups.values()) {
      const im = new THREE.InstancedMesh(geo, material, list.length);
      list.forEach((it, i) => {
        e.set(it.rx || 0, it.ry || 0, it.rz || 0);
        q.setFromEuler(e);
        const s = it.s ?? 1;
        sc.set(it.sx ?? s, it.sy ?? s, it.sz ?? s);
        m4.compose(p.set(it.x, it.y, it.z), q, sc);
        im.setMatrixAt(i, m4);
        if (it.color !== undefined) im.setColorAt(i, col.set(it.color));
        else if (it.tint !== undefined) im.setColorAt(i, col.setRGB(it.tint, it.tint, it.tint));
      });
      im.instanceMatrix.needsUpdate = true;
      if (im.instanceColor) im.instanceColor.needsUpdate = true;
      im.computeBoundingSphere();
      im.castShadow = shadows;
      im.receiveShadow = false;
      this.add(im);
      meshes.push(im);
    }
    return meshes;
  }

  // ---------------------------------------------------------------
  treeGeometry(type) {
    const pl = new PartList();
    const trunk = 0x8a5a3b;
    switch (type) {
      case 'round':
        pl.cyl([0, 1.2, 0], 0.22, 0.34, 2.4, trunk, [0, 0, 0], 6);
        pl.ico([0, 3.6, 0], 2.1, 0x5cbf4f, 1);
        pl.ico([0.9, 3.0, 0.4], 1.3, 0x6fcd5a, 0);
        pl.ico([-0.7, 4.3, -0.3], 1.2, 0x4fae45, 0);
        break;
      case 'pine':
        pl.cyl([0, 1.0, 0], 0.2, 0.3, 2.0, trunk, [0, 0, 0], 6);
        pl.cone([0, 2.8, 0], 2.0, 2.8, 0x2f8f4e, [0, 0, 0], 7);
        pl.cone([0, 4.2, 0], 1.55, 2.4, 0x37a058, [0, 0, 0], 7);
        pl.cone([0, 5.4, 0], 1.0, 2.0, 0x42b064, [0, 0, 0], 7);
        break;
      case 'bush':
        pl.ico([0, 0.6, 0], 1.0, 0x5fb94c, 1, [1.3, 0.8, 1.1]);
        pl.ico([0.6, 0.9, 0.2], 0.6, 0xff8fb6, 0);
        break;
      case 'sakura':
        pl.cyl([0, 1.3, 0], 0.22, 0.34, 2.6, 0x6e4a3a, [0, 0, 0], 6);
        pl.cyl([0.5, 2.6, 0], 0.1, 0.14, 1.3, 0x6e4a3a, [0, 0, -0.6], 5);
        pl.ico([0, 3.8, 0], 2.0, 0xffb7d2, 1);
        pl.ico([1.2, 3.3, 0.5], 1.3, 0xffc9dc, 0);
        pl.ico([-0.9, 4.2, -0.4], 1.3, 0xffa6c6, 0);
        break;
      case 'palm': {
        let px = 0, py = 0;
        for (let i = 0; i < 6; i++) {
          const nx = px + 0.18, ny = py + 1.05;
          pl.tube([px, py, 0], [nx, ny, 0], 0.2 - i * 0.015, 0x9a7a52, 6);
          px = nx; py = ny;
        }
        for (let i = 0; i < 7; i++) {
          const a = (i / 7) * TAU;
          pl.cone([px + Math.cos(a) * 1.3, py - 0.3, Math.sin(a) * 1.3], 0.45, 2.8, 0x3fae5a, [Math.sin(a) * 1.25, 0, -Math.cos(a) * 1.25], 4, [1, 1, 0.3]);
        }
        pl.sphere([px, py - 0.15, 0], 0.3, 0x7a5a2c, [1, 1, 1], [0, 0, 0], 6, 4);
        break;
      }
      default:
        pl.ico([0, 1, 0], 1, 0x5cbf4f, 0);
    }
    return pl.build();
  }

  buildScenery() {
    const c = this.course, W = c.halfWidth, th = this.theme, rng = this.rng;
    const ext = this.hm.ext * 0.97;
    const near = { d: 0, k: 0, s: 0, y: 0, side: 1 };
    const count = Math.round((this.themeId === 'night' ? 900 : 2600) * this.quality.density);
    const lists = {};
    for (const t of th.trees) lists[t] = [];
    let placed = 0;
    for (let tries = 0; tries < count * 6 && placed < count; tries++) {
      const x = (rng() * 2 - 1) * ext, z = (rng() * 2 - 1) * ext;
      c.nearest(x, z, near);
      if (near.d < W + 9) continue;
      if (near.d > 320 && rng() < 0.55) continue;
      if (this.themeId === 'night' && near.side < 0 && near.d > 45) continue; // 街の中は建物
      const h = this.heightAt(x, z);
      if (h < 2.2 || h > this.tp.snow - 12) continue;
      if (this.slopeAt(x, z) > 1.0) continue;
      const pn = this.noise.fbm(x * 0.004, z * 0.004, 2);
      if (pn < -0.12 && rng() < 0.75) continue;
      let type = th.trees[Math.floor(rng() * th.trees.length)];
      if (type === 'palm' && h > 12) type = th.trees[0];
      const sc = 0.75 + rng() * 0.75;
      lists[type].push({ x, y: h - 0.25, z, ry: rng() * TAU, s: sc, tint: 0.85 + rng() * 0.3 });
      placed++;
    }
    const tmat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
    for (const [type, items] of Object.entries(lists)) {
      if (!items.length) continue;
      this.instanced(this.treeGeometry(type), tmat, items, false);
    }

    // 岩
    const rocks = [];
    for (let i = 0; i < 260 * this.quality.density; i++) {
      const x = (rng() * 2 - 1) * ext, z = (rng() * 2 - 1) * ext;
      c.nearest(x, z, near);
      if (near.d < W + 7) continue;
      const h = this.heightAt(x, z);
      if (h < 0.5) continue;
      rocks.push({ x, y: h - 0.3, z, ry: rng() * TAU, rx: rng(), s: 0.6 + rng() * 2.2, tint: 0.8 + rng() * 0.3 });
    }
    const rg = new PartList().ico([0, 0, 0], 1, th.rock, 0, [1.2, 0.7, 1]).build();
    this.instanced(rg, tmat, rocks, false);

    // 花（道路沿い）
    if (th.flowers && this.themeId !== 'night') {
      const flowers = [];
      const smp = {};
      const n = Math.round(2600 * this.quality.density);
      for (let i = 0; i < n; i++) {
        const s = rng() * c.length;
        c.sample(s, smp);
        const side = rng() < 0.5 ? 1 : -1;
        const lat = side * (W + 2.6 + Math.pow(rng(), 1.6) * 30);
        const x = smp.x + smp.tz * lat, z = smp.z - smp.tx * lat;
        const h = this.heightAt(x, z);
        if (h < 1.5) continue;
        flowers.push({ x, y: h - 0.05, z, ry: rng() * TAU, s: 0.7 + rng() * 0.8, color: th.flowers[Math.floor(rng() * th.flowers.length)] });
      }
      const fl = new PartList();
      fl.cyl([0, 0.2, 0], 0.02, 0.02, 0.4, 0x4e9a3a, [0, 0, 0], 3);
      fl.ico([0, 0.45, 0], 0.14, 0xffffff, 0, [1, 0.6, 1]);
      const fgeo = fl.build();
      // 花芯以外を白にしてインスタンス色で着色（花芯も少し色づく）
      this.instanced(fgeo, new THREE.MeshLambertMaterial({ vertexColors: true }), flowers, false);
    }
  }

  // ---------------------------------------------------------------
  // ふくらむアーチ（インフレータブルゲート）
  arch(s, colors, texts, bannerBg, bannerFg, scale = 1) {
    const c = this.course, W = c.halfWidth;
    const smp = c.sample(s, {});
    const span = (W + 1.3) * scale;
    const hgt = 6.6 * scale;
    const pts = [];
    for (let i = 0; i <= 24; i++) {
      const a = (Math.PI * i) / 24;
      pts.push(new THREE.Vector3(Math.cos(a) * span, Math.sin(a) * hgt - 0.4, 0));
    }
    const curve = new THREE.CatmullRomCurve3(pts);
    const TS = 64, RS = 12;
    const geo = new THREE.TubeGeometry(curve, TS, 0.65 * scale, RS, false);
    const cols = new Float32Array(geo.attributes.position.count * 3);
    const tmp = new THREE.Color();
    for (let i = 0; i < geo.attributes.position.count; i++) {
      const ring = Math.floor(i / (RS + 1));
      tmp.set(colors[Math.floor(ring / 5) % colors.length]);
      cols.set([tmp.r, tmp.g, tmp.b], i * 3);
    }
    geo.setAttribute('color', new THREE.BufferAttribute(cols, 3));
    const g = new THREE.Group();
    const tube = new THREE.Mesh(geo, new THREE.MeshToonMaterial({ vertexColors: true }));
    tube.castShadow = true;
    g.add(tube);
    // バナー
    const tex = canvasTexture(1024, 192, (cx, w, h) => {
      cx.fillStyle = bannerBg;
      cx.fillRect(0, 0, w, h);
      cx.strokeStyle = 'rgba(255,255,255,0.9)';
      cx.lineWidth = 10;
      cx.strokeRect(8, 8, w - 16, h - 16);
      cx.fillStyle = bannerFg;
      cx.textAlign = 'center';
      cx.textBaseline = 'middle';
      if (texts.length === 1) {
        cx.font = `104px ${FONT_POP}`;
        cx.fillText(texts[0], w / 2, h / 2 + 6);
      } else {
        cx.font = `92px ${FONT_POP}`;
        cx.fillText(texts[0], w * 0.32, h / 2 + 6);
        cx.font = `64px ${FONT_POP}`;
        cx.fillText(texts[1], w * 0.74, h / 2 + 6);
      }
    });
    tex.anisotropy = this.maxAniso;
    const bw = span * 1.05, bh = bw * (192 / 1024) * 1.25;
    const bmat = new THREE.MeshBasicMaterial({ map: tex, side: THREE.FrontSide, fog: true });
    const front = new THREE.Mesh(new THREE.PlaneGeometry(bw, bh), bmat);
    front.position.set(0, hgt * 0.72, 0.05);
    front.rotation.y = Math.PI;
    const back = new THREE.Mesh(new THREE.PlaneGeometry(bw, bh), bmat);
    back.position.set(0, hgt * 0.72, -0.05);
    g.add(front, back);

    const left = new THREE.Vector3(smp.tz, 0, -smp.tx);
    const fwd = new THREE.Vector3(smp.tx, 0, smp.tz);
    const m = new THREE.Matrix4().makeBasis(left, new THREE.Vector3(0, 1, 0), fwd);
    m.setPosition(smp.x, smp.y, smp.z);
    g.matrixAutoUpdate = false;
    g.matrix.copy(m);
    this.add(g);
    return g;
  }

  buildArches() {
    const c = this.course, L = c.length;
    this.arch(0, [0xff4f8b, 0xffd23f, 0x3ec6ff, 0xffffff], ['FINISH', 'ゴール'], '#1b1b2f', '#ffffff');
    this.arch(L - 1000, [0xff3b3b, 0xffffff], ['ラスト 1km'], '#e8283c', '#ffffff', 0.92);
    this.arch(c.kom.s1, [0xe8283c, 0xffffff], ['KOM', '山岳ポイント'], '#ffffff', '#e8283c');
    this.arch(c.sprint.s1, [0x18b35a, 0xffffff], ['SPRINT', 'スプリント'], '#18b35a', '#ffffff');
  }

  // 看板（区間の予告など）
  sign(s, lines, bg, fg, side = 1) {
    const c = this.course, W = c.halfWidth;
    const smp = c.sample(s, {});
    const lat = side * (W + 2.6);
    const x = smp.x + smp.tz * lat, z = smp.z - smp.tx * lat;
    const y = this.heightAt(x, z);
    const tex = canvasTexture(512, 256, (g, w, h) => {
      g.fillStyle = bg;
      g.fillRect(0, 0, w, h);
      g.strokeStyle = '#fff';
      g.lineWidth = 12;
      g.strokeRect(6, 6, w - 12, h - 12);
      g.fillStyle = fg;
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.font = `64px ${FONT_POP}`;
      g.fillText(lines[0], w / 2, lines.length > 1 ? h * 0.34 : h / 2);
      if (lines[1]) {
        g.font = `44px ${FONT_ROUND}`;
        g.fillText(lines[1], w / 2, h * 0.7);
      }
    });
    const grp = new THREE.Group();
    const board = new THREE.Mesh(new THREE.PlaneGeometry(3.2, 1.6), new THREE.MeshBasicMaterial({ map: tex }));
    board.position.y = 2.6;
    board.rotation.y = Math.PI;
    const back = new THREE.Mesh(new THREE.PlaneGeometry(3.2, 1.6), new THREE.MeshLambertMaterial({ color: 0x777777 }));
    back.position.set(0, 2.6, 0.02);
    const post = new PartList();
    post.cyl([-1.2, 1.2, 0.05], 0.07, 0.07, 2.4, 0x999999, [0, 0, 0], 6);
    post.cyl([1.2, 1.2, 0.05], 0.07, 0.07, 2.4, 0x999999, [0, 0, 0], 6);
    grp.add(board, back, new THREE.Mesh(post.build(), new THREE.MeshLambertMaterial({ vertexColors: true })));
    grp.position.set(x, y - 0.1, z);
    grp.rotation.y = Math.atan2(smp.tx, smp.tz) - side * 0.35;
    this.add(grp);
  }

  buildSigns() {
    const c = this.course, L = c.length;
    const k = c.kom;
    this.sign(k.s0 - 30, [`⛰ ${k.name}`, `${(k.length / 1000).toFixed(1)}km 平均${(k.avgGrade * 100).toFixed(1)}%`], '#e8283c', '#ffffff');
    this.sign(k.s1 - 500, ['頂上まで', '500m'], '#ffffff', '#e8283c');
    this.sign(c.sprint.s0 - 20, [`⚡ ${c.sprint.name}`, 'スプリント区間'], '#18b35a', '#ffffff');
    this.sign(L - 500, ['ゴールまで', '500m'], '#1b1b2f', '#ffd23f', -1);
    this.sign(L - 200, ['ゴールまで', '200m'], '#1b1b2f', '#ffd23f');
  }

  // ---------------------------------------------------------------
  // 観客（ぴょんぴょん跳ねて応援するどうぶつたち）
  spectatorGeometry(kind) {
    const pl = new PartList();
    const white = 0xffffff;
    pl.sphere([0, 0.42, 0], 0.3, white, [1, 1.15, 0.9], [0, 0, 0], 8, 6);
    pl.sphere([0, 0.98, 0], 0.27, white, [1, 0.95, 1], [0, 0, 0], 10, 8);
    if (kind === 0) {
      pl.cone([0.14, 1.2, 0], 0.08, 0.16, white, [0, 0, -0.35], 5);
      pl.cone([-0.14, 1.2, 0], 0.08, 0.16, white, [0, 0, 0.35], 5);
    } else if (kind === 1) {
      pl.sphere([0.17, 1.19, -0.02], 0.08, white, [1, 1, 0.7], [0, 0, 0], 6, 4);
      pl.sphere([-0.17, 1.19, -0.02], 0.08, white, [1, 1, 0.7], [0, 0, 0], 6, 4);
    } else {
      pl.cyl([0.1, 1.3, -0.015], 0.04, 0.045, 0.32, white, [0, 0, -0.13], 5);
      pl.cyl([-0.1, 1.3, -0.015], 0.04, 0.045, 0.32, white, [0, 0, 0.13], 5);
    }
    // 目・鼻
    pl.sphere([0.09, 1.0, 0.24], 0.035, 0x151515, [1, 1.2, 0.6], [0, 0, 0], 6, 4);
    pl.sphere([-0.09, 1.0, 0.24], 0.035, 0x151515, [1, 1.2, 0.6], [0, 0, 0], 6, 4);
    // ばんざいの腕
    pl.cyl([0.29, 0.84, 0.025], 0.055, 0.06, 0.48, white, [0, 0, 0.32], 5);
    pl.cyl([-0.29, 0.84, 0.025], 0.055, 0.06, 0.48, white, [0, 0, -0.32], 5);
    return pl.build();
  }

  buildSpectators() {
    const c = this.course, W = c.halfWidth, L = c.length, rng = this.rng;
    const zones = [
      { s0: c.kom.s0 + c.kom.length * 0.35, s1: c.kom.s1 + 30, density: 1.25 },
      { s0: L - 280, s1: L + 40, density: 1.0 },
      { s0: c.sprint.s1 - 170, s1: c.sprint.s1 + 30, density: 0.8 },
    ];
    const pastel = [0xffb3c6, 0xffe08a, 0xa8e6ff, 0xc3f0a0, 0xd9c2ff, 0xffc89a, 0xffffff, 0xf7a8d8, 0x9fe3d0, 0xe9d7b5];
    const variants = [[], [], []];
    const flags = [];
    const smp = {};
    const dens = this.quality.density;
    for (const z of zones) {
      for (let s = z.s0; s < z.s1; s += 1.5 / (z.density * dens)) {
        for (const side of [1, -1]) {
          if (rng() > 0.82) continue;
          c.sample(s, smp);
          const inBar = this.inBarrierZone(s);
          const lat = side * (W + (inBar ? 1.3 : 0.9) + rng() * 3.4);
          const x = smp.x + smp.tz * lat, zz = smp.z - smp.tx * lat;
          const y = this.heightAt(x, zz);
          const face = Math.atan2(-smp.tz * side, smp.tx * side) + (rng() - 0.5) * 0.7 - side * 0.3;
          const kind = Math.floor(rng() * 3);
          const sp = {
            s, x, y, z: zz, ry: face, base: y, phase: rng() * TAU, speed: 7 + rng() * 5,
            color: pastel[Math.floor(rng() * pastel.length)], scale: 0.85 + rng() * 0.35, kind, idx: variants[kind].length, active: false,
          };
          variants[kind].push(sp);
          this.spectators.push(sp);
          if (rng() < 0.22) {
            sp.flag = flags.length;
            flags.push(sp);
          }
        }
      }
    }
    const mat = new THREE.MeshLambertMaterial({ vertexColors: true });
    this.specMeshes = variants.map((list, kind) => {
      const im = new THREE.InstancedMesh(this.spectatorGeometry(kind), mat, Math.max(1, list.length));
      im.count = list.length;
      const col = new THREE.Color();
      list.forEach((sp, i) => im.setColorAt(i, col.set(sp.color)));
      if (im.instanceColor) im.instanceColor.needsUpdate = true;
      im.castShadow = false;
      this.add(im);
      return im;
    });
    // 旗
    const fl = new PartList();
    fl.cyl([0, 0.9, 0], 0.02, 0.02, 1.8, 0x999999, [0, 0, 0], 4);
    const flagShape = new THREE.BufferGeometry();
    flagShape.setAttribute('position', new THREE.BufferAttribute(new Float32Array([0, 1.8, 0, 0, 1.3, 0, 0.7, 1.55, 0]), 3));
    flagShape.setIndex([0, 1, 2]);
    flagShape.computeVertexNormals();
    fl.geo(flagShape, 0xffffff);
    const flagMat = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide });
    this.flagMesh = new THREE.InstancedMesh(fl.build(), flagMat, Math.max(1, flags.length));
    this.flagMesh.count = flags.length;
    const flagColors = [0xff4f8b, 0xffd23f, 0x3ec6ff, 0x18b35a, 0xe8283c, 0x8e5cf7];
    const col = new THREE.Color();
    flags.forEach((sp, i) => this.flagMesh.setColorAt(i, col.set(flagColors[i % flagColors.length])));
    if (this.flagMesh.instanceColor) this.flagMesh.instanceColor.needsUpdate = true;
    this.add(this.flagMesh);
    this.flagList = flags;
    // 初期配置
    this._specM = new THREE.Matrix4();
    this._specQ = new THREE.Quaternion();
    this._specE = new THREE.Euler();
    this._specP = new THREE.Vector3();
    this._specS = new THREE.Vector3();
    for (const sp of this.spectators) this.placeSpectator(sp, 0, 0);
    for (const im of this.specMeshes) { im.instanceMatrix.needsUpdate = true; im.computeBoundingSphere(); }
    this.flagMesh.instanceMatrix.needsUpdate = true;
    this.flagMesh.computeBoundingSphere();
    // 観客のいる区間（音響用）
    this.crowdZones = zones;
  }

  placeSpectator(sp, jump, wave) {
    const e = this._specE.set(0, sp.ry + wave * 0.3, wave * 0.12);
    this._specQ.setFromEuler(e);
    this._specP.set(sp.x, sp.base + jump - 0.05, sp.z);
    const s = sp.scale;
    this._specS.set(s, s * (1 - jump * 0.25), s);
    this._specM.compose(this._specP, this._specQ, this._specS);
    this.specMeshes[sp.kind].setMatrixAt(sp.idx, this._specM);
    if (sp.flag !== undefined) {
      this._specE.set(0, sp.ry + 0.8 + Math.sin(wave * 3) * 0.3, 0);
      this._specQ.setFromEuler(this._specE);
      const lat = 0.38;
      this._specP.set(sp.x + Math.cos(sp.ry) * lat, sp.base + jump + 0.2, sp.z - Math.sin(sp.ry) * lat);
      this._specS.set(s, s, s);
      this._specM.compose(this._specP, this._specQ, this._specS);
      this.flagMesh.setMatrixAt(sp.flag, this._specM);
    }
  }

  crowdLevel(s) {
    const L = this.course.length;
    let lv = 0;
    for (const z of this.crowdZones) {
      const d0 = mod(s - z.s0, L), len = z.s1 - z.s0;
      if (d0 < len) lv = Math.max(lv, z.density);
      else {
        const before = mod(z.s0 - s, L);
        if (before < 80) lv = Math.max(lv, z.density * (1 - before / 80));
        const after = mod(s - z.s1, L);
        if (after < 60) lv = Math.max(lv, z.density * (1 - after / 60));
      }
    }
    return lv;
  }

  // ---------------------------------------------------------------
  buildDistant() {
    const rng = mulberry32(this.course.def.seed + 5);
    const pl = new PartList();
    const fogC = new THREE.Color(this.theme.fog);
    const base = this.themeId === 'night' ? [0x0e1030, 0x151238] : this.themeId === 'coast' ? [0x6a78a8, 0x7c6f98] : [0x5d9a6c, 0x6fa27c];
    const cols = base.map((c0) => new THREE.Color(c0).lerp(fogC, 0.45));
    for (let i = 0; i < 11; i++) {
      const a = (i / 11) * TAU + rng() * 0.3;
      const r = 3200 + rng() * 2200;
      const h = 120 + rng() * 280;
      const rad = 350 + rng() * 600;
      pl.cone([Math.cos(a) * r, h / 2 - 20, Math.sin(a) * r], rad, h, cols[i % 2], [0, rng() * 3, 0], 7);
    }
    const m = new THREE.Mesh(pl.build(), new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true, fog: false }));
    this.add(m);
  }

  buildClouds() {
    const rng = mulberry32(this.course.def.seed + 11);
    const pl = new PartList();
    pl.ico([0, 0, 0], 16, 0xffffff, 1);
    pl.ico([18, -4, 3], 12, 0xffffff, 1);
    pl.ico([-17, -5, -2], 11, 0xffffff, 1);
    pl.ico([6, 6, -6], 11, 0xffffff, 1);
    pl.ico([-6, -2, 10], 10, 0xffffff, 1);
    const geo = pl.build();
    const emissive = this.themeId === 'coast' ? 0x8a5a66 : 0x6f7f8f;
    const mat = new THREE.MeshLambertMaterial({ vertexColors: true, emissive, flatShading: true });
    const n = 28;
    const im = new THREE.InstancedMesh(geo, mat, n);
    this.clouds = [];
    const m4 = new THREE.Matrix4();
    for (let i = 0; i < n; i++) {
      const cl = { x: (rng() * 2 - 1) * 3600, y: 190 + rng() * 170, z: (rng() * 2 - 1) * 3600, s: 1 + rng() * 1.8, r: rng() * TAU };
      this.clouds.push(cl);
      m4.makeRotationY(cl.r).scale(new THREE.Vector3(cl.s, cl.s * 0.6, cl.s)).setPosition(cl.x, cl.y, cl.z);
      im.setMatrixAt(i, m4);
    }
    im.frustumCulled = false;
    this.cloudMesh = this.add(im);
  }

  buildStars() {
    const rng = mulberry32(3);
    const n = 1600;
    const pos = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const u = rng() * TAU, v = 0.04 + rng() * 0.96;
      const r = 4200;
      const y = Math.pow(v, 0.8);
      const rr = Math.sqrt(1 - y * y);
      pos.set([Math.cos(u) * rr * r, y * r, Math.sin(u) * rr * r], i * 3);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const m = new THREE.PointsMaterial({ color: 0xffffff, size: 2.2, sizeAttenuation: false, fog: false, transparent: true, opacity: 0.9, depthWrite: false });
    this.stars = this.add(new THREE.Points(g, m));
    this.stars.frustumCulled = false;
    this.stars.renderOrder = -9;
  }

  // ---------------------------------------------------------------
  pickSpot(minD, maxD, side, tries = 200, minH = 3) {
    const c = this.course, rng = this.rng;
    const smp = {};
    for (let i = 0; i < tries; i++) {
      const s = rng() * c.length;
      c.sample(s, smp);
      const lat = side * (c.halfWidth + minD + rng() * (maxD - minD));
      const x = smp.x + smp.tz * lat, z = smp.z - smp.tx * lat;
      const h = this.heightAt(x, z);
      if (h < minH) continue;
      return { x, y: h, z, s };
    }
    return null;
  }

  buildMeadowExtras() {
    // 風車
    const towerMat = new THREE.MeshToonMaterial({ vertexColors: true });
    for (let i = 0; i < 6; i++) {
      const sp = this.pickSpot(70, 380, -1);
      if (!sp) continue;
      const pl = new PartList();
      pl.cyl([0, 8, 0], 1.0, 1.8, 16, 0xfdfbf5, [0, 0, 0], 10);
      pl.cone([0, 17.2, 0], 1.6, 2.6, 0xff6f91, [0, 0, 0], 10);
      pl.box([0, 15.2, 1.2], [0.6, 0.6, 1.2], 0xeeeeee);
      const tower = new THREE.Mesh(pl.build(), towerMat);
      tower.castShadow = false;
      const g = new THREE.Group();
      g.add(tower);
      const bp = new PartList();
      for (let b = 0; b < 4; b++) {
        const a = (b / 4) * TAU;
        bp.box([Math.cos(a) * 4.5, Math.sin(a) * 4.5, 0], [7.6, 1.1, 0.12], b % 2 ? 0xffffff : 0xffe4ec, [0, 0, a]);
      }
      bp.sphere([0, 0, 0.1], 0.5, 0xff6f91);
      const blades = new THREE.Mesh(bp.build(), towerMat);
      blades.position.set(0, 15.2, 1.9);
      g.add(blades);
      g.position.set(sp.x, sp.y - 0.5, sp.z);
      g.rotation.y = Math.atan2(-sp.x, -sp.z) + 0.6;
      g.scale.setScalar(1.3);
      this.add(g);
      const speed = 0.6 + this.rng() * 0.5;
      this.anims.push((dt) => { blades.rotation.z += dt * speed; });
    }
    // 気球
    const cols = [[0xff6f91, 0xffe066], [0x6fd3ff, 0xffffff], [0xb28dff, 0xffb3c6]];
    for (let i = 0; i < 3; i++) {
      const [a, b] = cols[i];
      const bal = new PartList();
      bal.sphere([0, 0, 0], 9, a, [1, 1.18, 1], [0, 0, 0], 16, 12);
      bal.torus([0, 0, 0], 8.9, 0.8, b, [Math.PI / 2, 0, 0], TAU, 6, 24);
      bal.torus([0, 4, 0], 8.1, 0.8, b, [Math.PI / 2, 0, 0], TAU, 6, 24);
      bal.cone([0, -10.5, 0], 3.5, 5, a, [Math.PI, 0, 0], 12);
      bal.box([0, -15, 0], [2.4, 1.8, 2.4], 0x9a6a3a);
      const m = new THREE.Mesh(bal.build(), towerMat);
      const ang = this.rng() * TAU;
      const r = 400 + this.rng() * 700;
      m.position.set(Math.cos(ang) * r, 110 + i * 35, Math.sin(ang) * r);
      this.add(m);
      const ph = this.rng() * 10;
      const y0 = m.position.y;
      this.anims.push((dt, t) => { m.position.y = y0 + Math.sin(t * 0.3 + ph) * 4; m.rotation.y += dt * 0.05; });
    }
  }

  buildCoastExtras() {
    const c = this.course, W = c.halfWidth;
    const toon = new THREE.MeshToonMaterial({ vertexColors: true });
    // 灯台（KOM 頂上の外側）
    const smp = c.sample(c.kom.s1 + 40, {});
    const lat = W + 20; // 左側 = ループの外側（海側）
    const x = smp.x + smp.tz * lat, z = smp.z - smp.tx * lat;
    const y = this.heightAt(x, z);
    const pl = new PartList();
    for (let i = 0; i < 6; i++) {
      pl.cyl([0, 2 + i * 3.6, 0], 2.2 - i * 0.16 - 0.16, 2.2 - i * 0.16, 3.6, i % 2 ? 0xffffff : 0xe8283c, [0, 0, 0], 14);
    }
    pl.cyl([0, 23.6, 0], 1.8, 1.8, 0.4, 0x333333, [0, 0, 0], 14);
    pl.cyl([0, 25.2, 0], 1.1, 1.1, 2.8, 0xfff2a8, [0, 0, 0], 12);
    pl.cone([0, 27.6, 0], 1.6, 2.0, 0xe8283c, [0, 0, 0], 12);
    const lh = new THREE.Mesh(pl.build(), toon);
    lh.position.set(x, y - 0.5, z);
    this.add(lh);
    const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color: 0xfff0a0, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
    glow.scale.set(16, 16, 1);
    glow.position.set(x, y + 25, z);
    this.add(glow);
    // 光のビーム
    const beamMat = new THREE.MeshBasicMaterial({ color: 0xfff3b0, transparent: true, opacity: 0.18, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
    const beam = new THREE.Mesh(new THREE.ConeGeometry(9, 120, 16, 1, true), beamMat);
    beam.geometry.translate(0, -60, 0);
    beam.rotation.z = Math.PI / 2;
    const beamPivot = new THREE.Group();
    beamPivot.position.set(x, y + 25, z);
    beamPivot.add(beam);
    this.add(beamPivot);
    this.anims.push((dt) => { beamPivot.rotation.y += dt * 0.5; });

    // 鳥居（KOM 手前）
    {
      const s2 = c.sample(c.kom.s0 + 60, {});
      const lat2 = -(W + 7);
      const tx = s2.x + s2.tz * lat2, tz = s2.z - s2.tx * lat2;
      const ty = this.heightAt(tx, tz);
      const tp = new PartList();
      const red = 0xe8403a;
      tp.cyl([-2.4, 3, 0], 0.32, 0.36, 6, red, [0, 0, 0], 10);
      tp.cyl([2.4, 3, 0], 0.32, 0.36, 6, red, [0, 0, 0], 10);
      tp.box([0, 6.3, 0], [7.6, 0.55, 0.7], 0x2a2a2a);
      tp.box([0, 5.9, 0], [7.0, 0.45, 0.6], red);
      tp.box([0, 4.9, 0], [6.0, 0.35, 0.4], red);
      const torii = new THREE.Mesh(tp.build(), toon);
      torii.position.set(tx, ty - 0.2, tz);
      torii.rotation.y = Math.atan2(s2.tx, s2.tz) + Math.PI / 2;
      torii.castShadow = true;
      this.add(torii);
    }

    // ヨット
    const rng = this.rng;
    for (let i = 0; i < 7; i++) {
      let px = 0, pz = 0, ok = false;
      for (let t = 0; t < 40 && !ok; t++) {
        const a = rng() * TAU;
        const r = c.radiusAt(a) + 380 + rng() * 700;
        px = Math.cos(a) * r; pz = Math.sin(a) * r;
        ok = this.heightAt(px, pz) < -3;
      }
      if (!ok) continue;
      const bp = new PartList();
      bp.box([0, 0.4, 0], [1.6, 0.8, 5.5], 0xffffff);
      bp.cyl([0, 4.2, 0.2], 0.08, 0.08, 7, 0xcccccc, [0, 0, 0], 5);
      const sail = new THREE.BufferGeometry();
      sail.setAttribute('position', new THREE.BufferAttribute(new Float32Array([0, 1.2, 0.4, 0, 7.4, 0.4, 0, 1.2, 3.0]), 3));
      sail.setIndex([0, 1, 2, 0, 2, 1]);
      sail.computeVertexNormals();
      bp.geo(sail, i % 2 ? 0xff9fb8 : 0xfff6e0);
      const boat = new THREE.Mesh(bp.build(), new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide }));
      boat.position.set(px, 0, pz);
      boat.rotation.y = rng() * TAU;
      boat.scale.setScalar(2.2);
      this.add(boat);
      const ph = rng() * 10;
      this.anims.push((dt, t) => { boat.rotation.z = Math.sin(t * 0.8 + ph) * 0.06; boat.position.y = Math.sin(t * 1.1 + ph) * 0.3 - 0.2; });
    }
  }

  buildCityExtras() {
    const c = this.course, W = c.halfWidth, rng = this.rng;
    // 窓テクスチャ
    const winTex = canvasTexture(128, 256, (g, w, h) => {
      g.fillStyle = '#000';
      g.fillRect(0, 0, w, h);
      const cols = ['#ffe9a8', '#9ff7ff', '#ffb3e6', '#fff'];
      for (let y = 6; y < h; y += 16) {
        for (let x = 6; x < w; x += 16) {
          if (rng() < 0.55) {
            g.fillStyle = cols[Math.floor(rng() * cols.length)];
            g.globalAlpha = 0.5 + rng() * 0.5;
            g.fillRect(x, y, 9, 10);
          }
        }
      }
      g.globalAlpha = 1;
    }, { repeat: true });
    const bmat = new THREE.MeshLambertMaterial({ vertexColors: true, emissiveMap: winTex, emissive: new THREE.Color(0xffffff), emissiveIntensity: 1.1 });
    const near = { d: 0, k: 0, s: 0, y: 0, side: 1 };
    const ext = this.hm.ext * 0.9;
    const sectors = new Map();
    const facade = [0x2a2e4a, 0x33294a, 0x243a4a, 0x3a2f45];
    let count = 0;
    for (let i = 0; i < 4000 && count < 420 * this.quality.density; i++) {
      const x = (rng() * 2 - 1) * ext, z = (rng() * 2 - 1) * ext;
      c.nearest(x, z, near);
      if (near.d < W + 24) continue;
      const h0 = this.heightAt(x, z);
      if (h0 < 1.5) continue;
      if (near.side > 0 && near.d > 140) continue;
      const bw = 12 + rng() * 18, bd = 12 + rng() * 18;
      const rho = Math.hypot(x, z);
      const tall = near.side < 0 ? 1 - smoothstep(0, c.def.radius * 0.9, rho) : 0.2;
      const bh = 12 + rng() * 25 + tall * (60 + rng() * 80);
      const key = Math.floor((mod(Math.atan2(z, x), TAU) / TAU) * SECTORS);
      if (!sectors.has(key)) sectors.set(key, []);
      const g = new THREE.BoxGeometry(bw, bh, bd);
      const part = { geo: g, color: new THREE.Color(facade[count % facade.length]), matrix: mat([x, h0 + bh / 2 - 0.5, z], [0, rng() * TAU, 0]), uvScale: [bw / 10, bh / 20] };
      sectors.get(key).push(part);
      count++;
    }
    for (const parts of sectors.values()) {
      const m = new THREE.Mesh(mergeParts(parts), bmat);
      this.add(m);
    }
    // 道路脇のネオンライン
    const neonL = new THREE.MeshBasicMaterial({ color: 0x3ff6ff });
    const neonR = new THREE.MeshBasicMaterial({ color: 0xff4fd8 });
    this.add(new THREE.Mesh(this.ribbon(0, c.length, W + 0.35, W + 0.1, 0.12, 4), neonL));
    this.add(new THREE.Mesh(this.ribbon(0, c.length, -W - 0.1, -W - 0.35, 0.12, 4), neonR));
    // 街灯（光の点）
    const lamps = [];
    const smp = {};
    for (let s = 0; s < c.length; s += 36) {
      c.sample(s, smp);
      const side = (Math.floor(s / 36) % 2) ? 1 : -1;
      const lat = side * (W + 1.4);
      lamps.push(smp.x + smp.tz * lat, smp.y + 5.6, smp.z - smp.tx * lat);
    }
    const lg = new THREE.BufferGeometry();
    lg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(lamps), 3));
    const lm = new THREE.PointsMaterial({ map: glowTexture(), size: 7, color: 0xffd9a0, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false });
    this.add(new THREE.Points(lg, lm));
    const poles = [];
    for (let i = 0; i < lamps.length; i += 3) poles.push({ x: lamps[i], y: lamps[i + 1] - 5.6, z: lamps[i + 2], s: 1 });
    const pp = new PartList();
    pp.cyl([0, 2.8, 0], 0.08, 0.1, 5.6, 0x555a70, [0, 0, 0], 6);
    pp.sphere([0, 5.6, 0], 0.25, 0xffe2b0, [1, 0.6, 1], [0, 0, 0], 8, 6);
    this.instanced(pp.build(), new THREE.MeshBasicMaterial({ vertexColors: true }), poles, false);
    // ネオンアーチ
    for (let s = 150; s < c.length - 100; s += 420) {
      const sm = c.sample(s, {});
      const col = [0x3ff6ff, 0xff4fd8, 0xfff36b][Math.floor(s / 420) % 3];
      const ring = new THREE.Mesh(new THREE.TorusGeometry(W + 1.6, 0.16, 6, 40, Math.PI), new THREE.MeshBasicMaterial({ color: col }));
      const left = new THREE.Vector3(sm.tz, 0, -sm.tx), fwd = new THREE.Vector3(sm.tx, 0, sm.tz);
      const m = new THREE.Matrix4().makeBasis(left, new THREE.Vector3(0, 1, 0), fwd).setPosition(sm.x, sm.y, sm.z);
      ring.matrixAutoUpdate = false;
      ring.matrix.copy(m);
      this.add(ring);
    }
    // 月
    const moon = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color: 0xc8d8ff, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
    moon.scale.set(520, 520, 1);
    this.moon = this.add(moon);
    this.fireworkTimer = 2;
  }

  // ---------------------------------------------------------------
  // 環境パーティクル（花びら・桜・ホタル）
  buildParticles() {
    const kind = this.theme.particles;
    const n = kind === 'firefly' ? 260 : 420;
    const pos = new Float32Array(n * 3);
    const vel = new Float32Array(n * 3);
    const cols = new Float32Array(n * 3);
    const rng = mulberry32(9);
    const palette = kind === 'sakura' ? [0xffc1d9, 0xffa6c9, 0xffffff] : kind === 'petal' ? [0xffe066, 0xff9ec4, 0xffffff, 0xb5f28b] : [0xd8ff6b, 0x9ff7ff, 0xfff36b];
    const tc = new THREE.Color();
    for (let i = 0; i < n; i++) {
      pos.set([(rng() - 0.5) * 160, rng() * 40, (rng() - 0.5) * 160], i * 3);
      if (kind === 'firefly') vel.set([(rng() - 0.5) * 0.6, (rng() - 0.5) * 0.4, (rng() - 0.5) * 0.6], i * 3);
      else vel.set([0.6 + rng() * 0.8, -(0.4 + rng() * 0.6), 0.3 + rng() * 0.5], i * 3);
      tc.set(palette[Math.floor(rng() * palette.length)]);
      cols.set([tc.r, tc.g, tc.b], i * 3);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.BufferAttribute(cols, 3));
    const m = new THREE.PointsMaterial({
      size: kind === 'firefly' ? 0.9 : 0.35, map: glowTexture(), vertexColors: true, transparent: true, depthWrite: false,
      blending: kind === 'firefly' ? THREE.AdditiveBlending : THREE.NormalBlending, opacity: kind === 'firefly' ? 1 : 0.95,
    });
    const pts = new THREE.Points(g, m);
    pts.frustumCulled = false;
    this.particles = { pts, pos, vel, n, kind };
    this.add(pts);
  }

  // ---------------------------------------------------------------
  // 花火
  buildFireworks() {
    const n = 1200;
    const g = new THREE.BufferGeometry();
    this.fw = {
      n,
      pos: new Float32Array(n * 3),
      vel: new Float32Array(n * 3),
      col: new Float32Array(n * 3),
      base: new Float32Array(n * 3),
      life: new Float32Array(n),
      max: new Float32Array(n),
      next: 0,
    };
    g.setAttribute('position', new THREE.BufferAttribute(this.fw.pos, 3));
    g.setAttribute('color', new THREE.BufferAttribute(this.fw.col, 3));
    const m = new THREE.PointsMaterial({ size: 3.2, map: glowTexture(), vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false });
    this.fwPoints = new THREE.Points(g, m);
    this.fwPoints.frustumCulled = false;
    this.add(this.fwPoints);
    for (let i = 0; i < n; i++) this.fw.pos[i * 3 + 1] = -9999;
  }

  firework(x, y, z, color = null, count = 140, speed = 26) {
    const fw = this.fw, rng = Math.random;
    const palette = [0xff4f8b, 0xffd23f, 0x3ec6ff, 0x7dff9a, 0xc38bff, 0xffffff];
    const c = new THREE.Color(color ?? palette[Math.floor(rng() * palette.length)]);
    for (let k = 0; k < count; k++) {
      const i = fw.next;
      fw.next = (fw.next + 1) % fw.n;
      const u = rng() * 2 - 1, a = rng() * TAU, r = Math.sqrt(1 - u * u);
      const sp = speed * (0.75 + rng() * 0.35);
      fw.pos.set([x, y, z], i * 3);
      fw.vel.set([Math.cos(a) * r * sp, u * sp, Math.sin(a) * r * sp], i * 3);
      fw.base.set([c.r, c.g, c.b], i * 3);
      fw.life[i] = fw.max[i] = 1.6 + rng() * 0.8;
    }
  }

  updateFireworks(dt) {
    const fw = this.fw;
    let any = false;
    for (let i = 0; i < fw.n; i++) {
      if (fw.life[i] <= 0) continue;
      any = true;
      fw.life[i] -= dt;
      const o = i * 3;
      if (fw.life[i] <= 0) { fw.pos[o + 1] = -9999; fw.col[o] = fw.col[o + 1] = fw.col[o + 2] = 0; continue; }
      fw.vel[o + 1] -= 9 * dt;
      const drag = Math.exp(-1.6 * dt);
      fw.vel[o] *= drag; fw.vel[o + 1] *= drag; fw.vel[o + 2] *= drag;
      fw.pos[o] += fw.vel[o] * dt; fw.pos[o + 1] += fw.vel[o + 1] * dt; fw.pos[o + 2] += fw.vel[o + 2] * dt;
      const t = fw.life[i] / fw.max[i];
      const tw = t < 0.3 ? (Math.random() < 0.5 ? 1 : 0.3) : 1;
      fw.col[o] = fw.base[o] * t * tw; fw.col[o + 1] = fw.base[o + 1] * t * tw; fw.col[o + 2] = fw.base[o + 2] * t * tw;
    }
    if (any || this._fwWasActive) {
      this.fwPoints.geometry.attributes.position.needsUpdate = true;
      this.fwPoints.geometry.attributes.color.needsUpdate = true;
    }
    this._fwWasActive = any;
  }

  // ---------------------------------------------------------------
  // 毎フレーム更新
  update(dt, camera, focus, focusS, excitement = 1) {
    this.time += dt;
    const t = this.time;
    this.sky.position.copy(camera.position);
    if (this.stars) this.stars.position.copy(camera.position);
    if (this.moon) this.moon.position.copy(camera.position).addScaledVector(this.sunDir, 4000);

    // 太陽とシャドウカメラ（テクセルにスナップ）
    if (focus) {
      const sun = this.sun;
      if (sun.castShadow && this.shadowTexel) {
        const ts = this.shadowTexel;
        const r = this._lr, u = this._lu;
        const a = Math.round(focus.dot(r) / ts) * ts;
        const b = Math.round(focus.dot(u) / ts) * ts;
        const f = this._lf || (this._lf = this.sunDir.clone().negate());
        const along = focus.dot(f);
        const p = (this._lp || (this._lp = new THREE.Vector3())).copy(r).multiplyScalar(a).addScaledVector(u, b).addScaledVector(f, along);
        sun.target.position.copy(p);
        sun.position.copy(p).addScaledVector(this.sunDir, 200);
      } else {
        sun.target.position.copy(focus);
        sun.position.copy(focus).addScaledVector(this.sunDir, 200);
      }
      sun.target.updateMatrixWorld();
    }

    for (const fn of this.anims) fn(dt, t);

    // 雲
    if (this.cloudMesh) {
      const m4 = this._cm4 || (this._cm4 = new THREE.Matrix4());
      const sc = this._csc || (this._csc = new THREE.Vector3());
      this.clouds.forEach((cl, i) => {
        cl.x += dt * 3;
        if (cl.x > 3600) cl.x -= 7200;
        m4.makeRotationY(cl.r).scale(sc.set(cl.s, cl.s * 0.6, cl.s)).setPosition(cl.x, cl.y, cl.z);
        this.cloudMesh.setMatrixAt(i, m4);
      });
      this.cloudMesh.instanceMatrix.needsUpdate = true;
    }

    // 観客アニメーション（近くのみ）
    if (focusS !== undefined && this.spectators.length) {
      const L = this.course.length;
      let dirty = false;
      for (const sp of this.spectators) {
        const d = mod(sp.s - focusS + L / 2, L) - L / 2;
        const near = d > -90 && d < 140;
        if (near) {
          const ex = excitement * (d < 45 && d > -25 ? 1 : 0.45);
          const jump = Math.max(0, Math.sin(t * sp.speed + sp.phase)) * 0.32 * ex;
          const wave = Math.sin(t * sp.speed * 0.5 + sp.phase) * ex;
          this.placeSpectator(sp, jump, wave);
          sp.active = true;
          dirty = true;
        } else if (sp.active) {
          this.placeSpectator(sp, 0, 0);
          sp.active = false;
          dirty = true;
        }
      }
      if (dirty) {
        for (const im of this.specMeshes) im.instanceMatrix.needsUpdate = true;
        this.flagMesh.instanceMatrix.needsUpdate = true;
      }
    }

    // パーティクル
    if (this.particles) {
      const P = this.particles;
      const cp = camera.position;
      for (let i = 0; i < P.n; i++) {
        const o = i * 3;
        if (P.kind === 'firefly') {
          P.vel[o] += (Math.random() - 0.5) * dt * 0.8;
          P.vel[o + 1] += (Math.random() - 0.5) * dt * 0.5;
          P.vel[o + 2] += (Math.random() - 0.5) * dt * 0.8;
        }
        P.pos[o] += P.vel[o] * dt + Math.sin(t * 1.3 + i) * dt * 0.3;
        P.pos[o + 1] += P.vel[o + 1] * dt;
        P.pos[o + 2] += P.vel[o + 2] * dt;
        const dx = P.pos[o] - cp.x, dz = P.pos[o + 2] - cp.z, dy = P.pos[o + 1] - cp.y;
        if (dx > 80) P.pos[o] -= 160; else if (dx < -80) P.pos[o] += 160;
        if (dz > 80) P.pos[o + 2] -= 160; else if (dz < -80) P.pos[o + 2] += 160;
        if (dy < -6) P.pos[o + 1] += 36; else if (dy > 30) P.pos[o + 1] -= 36;
      }
      P.pts.geometry.attributes.position.needsUpdate = true;
    }

    // 夜は時々花火
    if (this.themeId === 'night') {
      this.fireworkTimer -= dt;
      if (this.fireworkTimer <= 0) {
        this.fireworkTimer = 2.5 + Math.random() * 4;
        const a = Math.random() * TAU;
        const r = 300 + Math.random() * 500;
        this.firework(Math.cos(a) * r, 160 + Math.random() * 90, Math.sin(a) * r, null, 150, 34);
      }
    }
    this.updateFireworks(dt);
  }

  dispose() {
    this.scene.remove(this.group);
    this.group.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) {
        const ms = Array.isArray(o.material) ? o.material : [o.material];
        for (const m of ms) {
          for (const k of ['map', 'emissiveMap']) if (m[k]) m[k].dispose();
          m.dispose();
        }
      }
    });
    this.scene.fog = null;
  }
}
