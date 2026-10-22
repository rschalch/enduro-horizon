import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// Cars are lofted: a lower body swept from rounded superellipse cross-sections
// along the car (with wheel arches carved into its underside and flared
// fenders), topped by a greenhouse loft whose quads are split into painted
// roof/pillars and glass. Lights, grilles, bumpers, seams and plates are thin
// patches conformed to the body surface. Models face -Z, tires touch y = 0.
//
// Body profiles are keypoint curves over u in [0, 1] (0 = nose, 1 = tail):
// top: height of the hood/beltline/deck, bottom: sill line, plan: width factor.
// shoulder: height of the rounded upper half of the section; nt/nb: section
// roundness above/below the shoulder (2 = round, higher = boxier).

const SPECS = {
  sport: {
    z: [-2.3, 2.3], W: 1.84, wheelR: 0.33, tireW: 0.26, axles: [-1.33, 1.3],
    top: [[0, 0.55], [0.05, 0.68], [0.14, 0.79], [0.3, 0.84], [0.42, 0.86], [0.7, 0.92], [0.9, 0.94], [0.97, 0.9], [1, 0.76]],
    bottom: [[0, 0.36], [0.07, 0.27], [0.93, 0.27], [1, 0.38]],
    plan: [[0, 0.9], [0.2, 0.98], [0.5, 1], [0.8, 1], [1, 0.93]],
    shoulder: 0.13, nt: 2.4, nb: 4.5, tuck: 0.06, flare: 0.04, endF: 0.07, endR: 0.05,
    gh: { a: 0.36, b: 0.5, c: 0.7, d: 0.9, roof: 1.27, gw: 0.86, n: 3.2, bp: [] },
    seams: [0.39, 0.66],
    head: [{ x: [0.46, 0.8], y: [0.47, 0.55] }],
    tail: [{ x: [0.32, 0.8], y: [0.7, 0.79] }],
    grille: { x: 0.36, y: [0.38, 0.46] },
    lip: { front: [0.29, 0.36], rear: [0.3, 0.42] },
  },
  sedan: {
    z: [-2.38, 2.4], W: 1.8, wheelR: 0.33, tireW: 0.25, axles: [-1.4, 1.4],
    top: [[0, 0.66], [0.04, 0.78], [0.12, 0.85], [0.3, 0.88], [0.7, 0.92], [0.92, 0.93], [0.98, 0.9], [1, 0.8]],
    bottom: [[0, 0.36], [0.06, 0.28], [0.94, 0.28], [1, 0.38]],
    plan: [[0, 0.93], [0.15, 0.98], [0.5, 1], [0.85, 0.99], [1, 0.95]],
    shoulder: 0.12, nt: 2.6, nb: 5, tuck: 0.05, flare: 0.025, endF: 0.05, endR: 0.045, endP: 3.5,
    gh: { a: 0.3, b: 0.43, c: 0.68, d: 0.8, roof: 1.42, gw: 0.88, n: 3.6, bp: [0.555] },
    seams: [0.33, 0.555, 0.7],
    head: [{ x: [0.5, 0.82], y: [0.62, 0.72] }],
    tail: [{ x: [0.44, 0.84], y: [0.73, 0.85] }],
    grille: { x: 0.42, y: [0.56, 0.72], chrome: true },
    bumper: { front: [0.38, 0.5], rear: [0.4, 0.52] },
  },
  hatch: {
    z: [-2.05, 2.0], W: 1.74, wheelR: 0.31, tireW: 0.24, axles: [-1.25, 1.2],
    top: [[0, 0.64], [0.05, 0.75], [0.14, 0.84], [0.3, 0.88], [0.75, 0.93], [0.95, 0.95], [1, 0.9]],
    bottom: [[0, 0.36], [0.06, 0.27], [0.95, 0.27], [1, 0.37]],
    plan: [[0, 0.93], [0.5, 1], [1, 0.96]],
    shoulder: 0.12, nt: 2.6, nb: 5, tuck: 0.05, flare: 0.035, endF: 0.055, endR: 0.035, endP: 3.5,
    gh: { a: 0.3, b: 0.44, c: 0.86, d: 0.985, roof: 1.44, gw: 0.88, n: 3.4, bp: [0.6], cp: 0.5 },
    seams: [0.33, 0.6, 0.78],
    head: [{ x: [0.5, 0.8], y: [0.6, 0.7] }],
    tail: [{ x: [0.52, 0.82], y: [0.66, 0.85] }],
    grille: { x: 0.4, y: [0.55, 0.69] },
    bumper: { front: [0.36, 0.48], rear: [0.37, 0.5] },
  },
  van: {
    z: [-2.45, 2.45], W: 1.94, wheelR: 0.36, tireW: 0.27, axles: [-1.55, 1.6],
    top: [[0, 0.76], [0.04, 0.92], [0.12, 1.03], [0.22, 1.08], [1, 1.12]],
    bottom: [[0, 0.42], [0.06, 0.32], [0.95, 0.32], [1, 0.4]],
    plan: [[0, 0.93], [0.2, 0.99], [0.5, 1], [1, 0.98]],
    shoulder: 0.14, nt: 2.8, nb: 6, tuck: 0.03, flare: 0.03, endF: 0.05, endR: 0.03, endP: 3.5,
    gh: { a: 0.17, b: 0.36, c: 0.975, d: 1, roof: 2.02, gw: 0.94, n: 4.2, bp: [0.43, 0.62, 0.8], roofBand: 0.6, rw: [0.66, 1.32, 1.86] },
    seams: [0.2, 0.43, 0.62],
    head: [{ x: [0.56, 0.86], y: [0.74, 0.86] }],
    tail: [{ x: [0.8, 0.92], y: [0.72, 1.05] }],
    grille: { x: 0.46, y: [0.62, 0.84] },
    bumper: { front: [0.42, 0.56], rear: [0.42, 0.56] },
  },
  pickup: {
    z: [-2.5, 2.52], W: 1.92, wheelR: 0.38, tireW: 0.29, axles: [-1.6, 1.55],
    top: [[0, 0.82], [0.04, 0.95], [0.12, 1.04], [0.3, 1.1], [1, 1.13]],
    bottom: [[0, 0.44], [0.06, 0.36], [0.95, 0.36], [1, 0.44]],
    plan: [[0, 0.94], [0.2, 0.99], [0.5, 1], [1, 0.99]],
    shoulder: 0.14, nt: 3, nb: 6, tuck: 0.03, flare: 0.05, endF: 0.045, endR: 0.02, endP: 4,
    gh: { a: 0.31, b: 0.43, c: 0.555, d: 0.6, roof: 1.8, gw: 0.88, n: 3.6, bp: [], cp: 0.5 },
    seams: [0.33, 0.585],
    bed: [0.62, 0.985],
    head: [{ x: [0.58, 0.86], y: [0.8, 0.94] }],
    tail: [{ x: [0.8, 0.92], y: [0.76, 1.04] }],
    grille: { x: 0.5, y: [0.64, 0.94], chrome: true },
    bumper: { front: [0.44, 0.6], rear: [0.44, 0.58], chrome: true },
  },
  // The player's 80s wedge supercar.
  wedge: {
    z: [-2.35, 2.36], W: 1.96, wheelR: 0.34, tireW: 0.3, axles: [-1.38, 1.35],
    top: [[0, 0.5], [0.03, 0.6], [0.1, 0.7], [0.21, 0.8], [0.35, 0.86], [0.55, 0.95], [0.8, 0.99], [0.95, 0.99], [0.99, 0.94], [1, 0.86]],
    bottom: [[0, 0.33], [0.06, 0.25], [0.94, 0.25], [1, 0.33]],
    plan: [[0, 0.84], [0.15, 0.95], [0.5, 1], [0.85, 1], [1, 0.97]],
    shoulder: 0.1, nt: 2.2, nb: 4, tuck: 0.05, flare: 0.06, endF: 0.06, endR: 0.035,
    gh: { a: 0.33, b: 0.48, c: 0.64, d: 0.86, roof: 1.2, gw: 0.78, n: 3, bp: [] },
    seams: [0.36, 0.6],
  },
};

// ---------- Materials ----------
const envMats = [];
let currentEnv = null;
function envMat(m, intensity = 1) {
  m.envMapIntensity = intensity;
  if (currentEnv) m.envMap = currentEnv;
  envMats.push(m);
  return m;
}

export function setCarEnvMap(texture) {
  currentEnv = texture;
  for (const m of envMats) {
    m.envMap = texture;
    m.needsUpdate = true;
  }
}

const glassMat = envMat(new THREE.MeshPhysicalMaterial({ color: 0x0b1320, metalness: 0.1, roughness: 0.2, side: THREE.DoubleSide }), 1.3);
const trimMat = new THREE.MeshStandardMaterial({ color: 0x17181d, metalness: 0.3, roughness: 0.6 });
const tireMat = new THREE.MeshStandardMaterial({ color: 0x141416, roughness: 0.92, side: THREE.DoubleSide });
const chromeMat = envMat(new THREE.MeshStandardMaterial({ color: 0xe6e9ef, metalness: 1, roughness: 0.22 }), 1);
const goldMat = envMat(new THREE.MeshStandardMaterial({ color: 0xd9a63a, metalness: 1, roughness: 0.3 }), 1);

export const trafficLights = {
  tail: new THREE.MeshStandardMaterial({ color: 0x330000, emissive: 0xff1020, emissiveIntensity: 1 }),
  head: new THREE.MeshStandardMaterial({ color: 0x333333, emissive: 0xfff2c0, emissiveIntensity: 0.5 }),
};

const paintMats = new Map();
function paintMat(color) {
  if (!paintMats.has(color)) {
    paintMats.set(
      color,
      envMat(new THREE.MeshPhysicalMaterial({ color, metalness: 0.35, roughness: 0.38, clearcoat: 1, clearcoatRoughness: 0.22 }), 0.9),
    );
  }
  return paintMats.get(color);
}

// Headlight pool on the road ahead of a car; main fades it in at night.
function beamTexture() {
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 256;
  const g = c.getContext('2d');
  const img = g.createImageData(64, 256);
  for (let y = 0; y < 256; y++) {
    for (let x = 0; x < 64; x++) {
      const v = y / 255; // 0 = at the car, 1 = far end
      const u = Math.abs(x / 63 - 0.5) * 2;
      const a = Math.pow(1 - v, 1.6) * Math.min(1, v * 12) * Math.pow(1 - u * u, 1.5);
      const i = (y * 64 + x) * 4;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = 255;
      img.data[i + 3] = Math.round(a * 255);
    }
  }
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export const beamMaterial = new THREE.MeshBasicMaterial({
  map: beamTexture(),
  color: 0xfff1c8,
  transparent: true,
  opacity: 0,
  blending: THREE.AdditiveBlending,
  depthWrite: false,
  fog: false,
});

const beamGeo = (() => {
  const L = 26;
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute([-0.8, 0, 0, 0.8, 0, 0, -4.5, 0, -L, 4.5, 0, -L], 3));
  // Flip v so texture row 0 (top of canvas = v 1) lands at the far end.
  g.setAttribute('uv', new THREE.Float32BufferAttribute([0, 1, 1, 1, 0, 0, 1, 0], 2));
  g.setIndex([0, 1, 2, 1, 3, 2]);
  g.computeVertexNormals();
  return g;
})();

function addBeam(root, frontZ) {
  const beam = new THREE.Mesh(beamGeo, beamMaterial);
  beam.position.set(0, 0.06, frontZ - 0.1);
  beam.renderOrder = 2;
  beam.frustumCulled = false;
  root.add(beam);
  return beam;
}

// ---------- Geometry helpers ----------
const rbox = (w, h, d, r = 0.04, seg = 2) => new RoundedBoxGeometry(w, h, d, seg, Math.min(r, w * 0.49, h * 0.49, d * 0.49));
// Merge parts that may or may not carry uvs.
function merge(list) {
  return mergeGeometries(
    list.map((g) => {
      const n = g.index ? g.toNonIndexed() : g;
      n.deleteAttribute('uv');
      return n;
    }),
  );
}

// Monotone cubic interpolation through [u, value] keypoints.
function curve(pts) {
  const n = pts.length;
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  const d = [];
  for (let i = 0; i < n - 1; i++) d.push((ys[i + 1] - ys[i]) / (xs[i + 1] - xs[i]));
  const m = new Array(n);
  m[0] = d[0];
  m[n - 1] = d[n - 2];
  for (let i = 1; i < n - 1; i++) m[i] = d[i - 1] * d[i] <= 0 ? 0 : (d[i - 1] + d[i]) / 2;
  for (let i = 0; i < n - 1; i++) {
    if (d[i] === 0) {
      m[i] = m[i + 1] = 0;
      continue;
    }
    const a = m[i] / d[i];
    const b = m[i + 1] / d[i];
    const s = a * a + b * b;
    if (s > 9) {
      const t = 3 / Math.sqrt(s);
      m[i] = t * a * d[i];
      m[i + 1] = t * b * d[i];
    }
  }
  return (u) => {
    if (u <= xs[0]) return ys[0];
    if (u >= xs[n - 1]) return ys[n - 1];
    let i = 0;
    while (u > xs[i + 1]) i++;
    const h = xs[i + 1] - xs[i];
    const t = (u - xs[i]) / h;
    const t2 = t * t;
    const t3 = t2 * t;
    return (2 * t3 - 3 * t2 + 1) * ys[i] + (t3 - 2 * t2 + t) * h * m[i] + (-2 * t3 + 3 * t2) * ys[i + 1] + (t3 - t2) * h * m[i + 1];
  };
}

// Grid of rows x cols vertices → indexed geometry; flipped if its normals
// disagree with the outward hint at vertex `probe`.
function gridGeometry(pos, rows, cols, { uv = null, probe = 0, hint = null } = {}) {
  const idx = [];
  for (let i = 0; i < rows - 1; i++) {
    for (let j = 0; j < cols - 1; j++) {
      const a = i * cols + j;
      idx.push(a, a + 1, a + cols, a + 1, a + cols + 1, a + cols);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  if (uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  if (hint) orient(g, probe, hint);
  return g;
}

function orient(g, probe, hint) {
  const n = g.attributes.normal;
  if (n.getX(probe) * hint[0] + n.getY(probe) * hint[1] + n.getZ(probe) * hint[2] >= 0) return;
  const idx = g.index.array;
  for (let i = 0; i < idx.length; i += 3) {
    const t = idx[i + 1];
    idx[i + 1] = idx[i + 2];
    idx[i + 2] = t;
  }
  g.index.needsUpdate = true;
  g.computeVertexNormals();
}

// ---------- Lofted body ----------
function makeBody(spec) {
  const [z0, z1] = spec.z;
  const top = curve(spec.top);
  const bot = curve(spec.bottom);
  const plan = curve(spec.plan);
  const R = spec.wheelR || 0;
  const Ra = R + 0.065;
  const archTop = R + Ra;
  const axles = spec.axles || [];
  const p = spec.endP || 3;
  const { nt, nb } = spec;
  const tuck = spec.tuck || 0;
  const rnd = (t) => Math.pow(Math.max(0, 1 - Math.pow(1 - Math.min(1, Math.max(0, t)), p)), 1 / p);
  const zOf = (u) => z0 + u * (z1 - z0);
  const uOf = (z) => (z - z0) / (z1 - z0);
  const b = { spec, z0, z1, zOf, uOf, R, Ra };

  b.w = (u) => {
    const f = plan(u) * rnd(u / (spec.endF || 0.06)) * rnd((1 - u) / (spec.endR || 0.05));
    let fl = 0;
    for (const ax of axles) {
      const dz = (zOf(u) - ax) / Ra;
      fl += (spec.flare || 0) * Math.exp(-dz * dz * 1.1);
    }
    return f * (spec.W / 2 + fl);
  };
  b.yt = top;
  b.ym = (u) => {
    const t = top(u);
    return Math.min(t - 0.035, Math.max(t - spec.shoulder, archTop + 0.03));
  };
  b.yb = (u) => {
    let y = bot(u);
    const z = zOf(u);
    for (const ax of axles) {
      const dz = z - ax;
      if (Math.abs(dz) < Ra) y = Math.max(y, R + Math.sqrt(Ra * Ra - dz * dz));
    }
    return Math.min(y, b.ym(u) - 0.03);
  };
  // Point on the section at station u, angle th (0 = right side, PI/2 = top).
  b.point = (u, th, out) => {
    const w = b.w(u);
    const yt = b.yt(u);
    const ym = b.ym(u);
    const c = Math.cos(th);
    const s = Math.sin(th);
    const up = s >= 0;
    const n = up ? nt : nb;
    let x = w * Math.sign(c) * Math.pow(Math.abs(c), 2 / n);
    if (up) x *= 1 - tuck * s * s;
    out[0] = x;
    out[1] = up ? ym + (yt - ym) * Math.pow(s, 2 / n) : ym - (ym - b.yb(u)) * Math.pow(-s, 2 / n);
    out[2] = zOf(u);
    return out;
  };
  // Half width of the body at station u and height y (0 outside).
  b.sx = (u, y) => {
    const yt = b.yt(u);
    const ym = b.ym(u);
    const yb = b.yb(u);
    if (y >= yt || y <= yb) return 0;
    const up = y >= ym;
    const n = up ? nt : nb;
    const s = Math.pow(up ? (y - ym) / (yt - ym) : (ym - y) / (ym - yb), n / 2);
    const c = Math.sqrt(Math.max(0, 1 - s * s));
    let x = b.w(u) * Math.pow(c, 2 / n);
    if (up) x *= 1 - tuck * s * s;
    return x;
  };
  // Surface height above lateral offset x at station u.
  b.sy = (u, x) => {
    const w = b.w(u);
    const yt = b.yt(u);
    const ym = b.ym(u);
    const ax = Math.abs(x);
    let lo = 0;
    let hi = Math.PI / 2;
    for (let i = 0; i < 24; i++) {
      const mid = (lo + hi) / 2;
      const s = Math.sin(mid);
      const xm = w * Math.pow(Math.cos(mid), 2 / nt) * (1 - tuck * s * s);
      if (xm > ax) lo = mid;
      else hi = mid;
    }
    return ym + (yt - ym) * Math.pow(Math.sin(lo), 2 / nt);
  };
  // Station of the nose ('front') or tail ('rear') surface at (x, y).
  b.su = (x, y, end) => {
    const dir = end === 'front' ? 1 : -1;
    const ax = Math.abs(x);
    let u = end === 'front' ? 0 : 1;
    let prev = u;
    for (let i = 0; i < 400 && b.sx(u, y) <= ax; i++) {
      prev = u;
      u += dir * 0.0025;
    }
    let lo = prev;
    let hi = u;
    for (let i = 0; i < 20; i++) {
      const mid = (lo + hi) / 2;
      if (b.sx(mid, y) > ax) hi = mid;
      else lo = mid;
    }
    return hi;
  };

  // Mesh: cosine-spaced stations, packed tightly across each wheel arch.
  const us = [];
  const N = spec.stations || 36;
  for (let i = 0; i <= N; i++) us.push(0.5 - 0.5 * Math.cos((Math.PI * i) / N));
  for (const ax of axles) {
    const uc = uOf(ax);
    const du = Ra / (z1 - z0);
    for (let k = -7; k <= 7; k++) us.push(uc + (du * k * 0.999) / 7);
    us.push(uc - du * 1.012, uc + du * 1.012);
  }
  us.sort((a, c) => a - c);
  const st = us.filter((u, i) => u >= 0 && u <= 1 && (i === 0 || u - us[i - 1] > 1e-4));
  const M = spec.sides || 32;
  const pos = [];
  const pt = [0, 0, 0];
  for (const u of st) {
    for (let j = 0; j <= M; j++) {
      b.point(u, -Math.PI / 2 + (2 * Math.PI * j) / M, pt);
      pos.push(pt[0], pt[1], pt[2]);
    }
  }
  const mid = st.findIndex((u) => u >= 0.5);
  b.geometry = gridGeometry(pos, st.length, M + 1, { probe: mid * (M + 1) + M / 4, hint: [1, 0, 0] });
  return b;
}

// Greenhouse: windshield, roof, pillars and rear glass in one loft with two
// material groups (0 = paint, 1 = glass).
function makeGreenhouse(b, gh) {
  const { a, b: ub, c, d } = gh;
  const sink = 0.06;
  const n = gh.n || 3.4;
  const pillar = gh.ap ?? 0.33;
  const cpillar = gh.cp ?? 0.33;
  const roofBand = gh.roofBand ?? 0.62;
  const ease = (t) => Math.sin((Math.min(1, Math.max(0, t)) * Math.PI) / 2);
  const rise = (u) => Math.min(ease((u - a) / (ub - a)), d > c ? ease((d - u) / (d - c)) : 1);
  const us = [];
  const add = (u0, u1, k) => {
    for (let i = 0; i <= k; i++) us.push(u0 + ((u1 - u0) * i) / k);
  };
  add(a, ub, 10);
  add(ub, c, 14);
  add(c, d, 10);
  us.sort((x, y) => x - y);
  const st = us.filter((u, i) => i === 0 || u - us[i - 1] > 1e-4);
  const M = 24;
  const pos = [];
  for (const u of st) {
    const e = rise(u);
    const yt = b.yt(u);
    const y0 = yt - sink;
    const crown = 0.018 * Math.sin(((u - a) / (d - a)) * Math.PI);
    const H = sink + Math.max(0, gh.roof + crown - yt) * e;
    const half = b.sx(u, y0) * gh.gw * (0.9 + 0.1 * e);
    for (let j = 0; j <= M; j++) {
      const th = (Math.PI * j) / M;
      const cs = Math.cos(th);
      pos.push(half * Math.sign(cs) * Math.pow(Math.abs(cs), 2 / n), y0 + H * Math.pow(Math.sin(th), 2 / n), b.zOf(u));
    }
  }
  const rows = st.length;
  const cols = M + 1;
  const paint = [];
  const glass = [];
  for (let i = 0; i < rows - 1; i++) {
    const uc = (st[i] + st[i + 1]) / 2;
    for (let j = 0; j < cols - 1; j++) {
      const th = (Math.PI * (j + 0.5)) / M;
      const band = Math.min(th, Math.PI - th);
      let isGlass;
      if (uc < ub) isGlass = band > pillar;
      else if (uc > c) {
        isGlass = band > cpillar;
        if (gh.rw) isGlass = false; // flat tailgate: the window is a separate panel
      }
      else isGlass = band < roofBand && band > 0.08 && !(gh.bp || []).some((bp) => Math.abs(uc - bp) < 0.016);
      const q = i * cols + j;
      (isGlass ? glass : paint).push(q, q + 1, q + cols, q + 1, q + cols + 1, q + cols);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex([...paint, ...glass]);
  g.computeVertexNormals();
  const midRow = st.findIndex((u) => u >= (ub + c) / 2);
  orient(g, midRow * cols + M / 2, [0, 1, 0]);
  g.addGroup(0, paint.length, 0);
  g.addGroup(paint.length, glass.length, 1);
  return g;
}

// Patches conformed to the body, lifted `off` meters off the surface.
// Nose/tail: (x, y) rectangle; the offset follows the curve of the plan.
function endPatch(b, end, x0, x1, y0, y1, off = 0.008, nx = 10, ny = 3, withUv = false) {
  const pos = [];
  const uv = [];
  const sgn = end === 'front' ? -1 : 1;
  for (let i = 0; i <= ny; i++) {
    const y = y0 + ((y1 - y0) * i) / ny;
    // Keep the patch inside the widest point of the body at this height.
    let xmax = 0;
    for (let k = 0; k <= 40; k++) xmax = Math.max(xmax, b.sx(end === 'front' ? k / 80 : 1 - k / 80, y));
    xmax -= 0.012;
    for (let j = 0; j <= nx; j++) {
      const xr = x0 + ((x1 - x0) * j) / nx;
      const x = Math.sign(xr) * Math.min(Math.abs(xr), xmax);
      const z = b.zOf(b.su(x, y, end));
      const e = 0.01;
      const dz = (b.zOf(b.su(x + e, y, end)) - b.zOf(b.su(x - e, y, end))) / (2 * e);
      // Outward normal of the curve z(x) in the xz plane.
      let nxv = sgn < 0 ? dz : -dz;
      let nzv = sgn;
      const l = Math.hypot(nxv, nzv);
      nxv /= l;
      nzv /= l;
      pos.push(x + nxv * off, y, z + nzv * off);
      uv.push(end === 'front' ? 1 - j / nx : j / nx, i / ny);
    }
  }
  return gridGeometry(pos, ny + 1, nx + 1, { uv: withUv ? uv : null, probe: Math.floor(nx / 2), hint: [0, 0, sgn] });
}

// Side: (u, y) rectangle on the right (side 1) or left (-1) flank.
function sidePatch(b, side, u0, u1, y0, y1, off = 0.006, nu = 8, ny = 2) {
  const pos = [];
  for (let i = 0; i <= ny; i++) {
    for (let j = 0; j <= nu; j++) {
      const u = u0 + ((u1 - u0) * j) / nu;
      const y = y0 + ((y1 - y0) * i) / ny;
      pos.push(side * (b.sx(u, y) + off), y, b.zOf(u));
    }
  }
  return gridGeometry(pos, ny + 1, nu + 1, { probe: Math.floor(nu / 2), hint: [side, 0, 0] });
}

// Top: (x, u) rectangle on the hood, deck or bed.
function topPatch(b, x0, x1, u0, u1, off = 0.006, nx = 6, nu = 6) {
  const pos = [];
  for (let i = 0; i <= nu; i++) {
    for (let j = 0; j <= nx; j++) {
      const x = x0 + ((x1 - x0) * j) / nx;
      const u = u0 + ((u1 - u0) * i) / nu;
      pos.push(x, b.sy(u, x) + off, b.zOf(u));
    }
  }
  return gridGeometry(pos, nu + 1, nx + 1, { probe: Math.floor(nx / 2), hint: [0, 1, 0] });
}

const mirrorX = (fn, x0, x1) => [fn(x0, x1), fn(-x1, -x0)];

// Tire with rounded sidewalls and a recessed dark face; axis along X, outer face +X.
const wheelCache = new Map();
function wheelGeos(R, w) {
  const key = `${R}|${w}`;
  if (wheelCache.has(key)) return wheelCache.get(key);
  const hw = w / 2;
  const rc = Math.min(0.07, hw * 0.5);
  const pts = [new THREE.Vector2(0, -hw * 0.55), new THREE.Vector2(R * 0.6, -hw * 0.55), new THREE.Vector2(R * 0.66, -hw)];
  for (let i = 0; i <= 4; i++) {
    const a = -Math.PI / 2 + (i / 4) * (Math.PI / 2);
    pts.push(new THREE.Vector2(R - rc + Math.cos(a) * rc, -hw + rc + Math.sin(a) * rc));
  }
  for (let i = 0; i <= 4; i++) {
    const a = (i / 4) * (Math.PI / 2);
    pts.push(new THREE.Vector2(R - rc + Math.cos(a) * rc, hw - rc + Math.sin(a) * rc));
  }
  pts.push(new THREE.Vector2(R * 0.66, hw), new THREE.Vector2(R * 0.62, hw * 0.55), new THREE.Vector2(0, hw * 0.55));
  const tire = new THREE.LatheGeometry(pts, 24).rotateZ(-Math.PI / 2);

  // Dished rim: lip ring, tapered spokes and a center cap.
  const rimY = hw * 0.58;
  const parts = [
    new THREE.TorusGeometry(R * 0.6, R * 0.05, 6, 24).rotateX(Math.PI / 2).translate(0, rimY, 0),
    new THREE.CylinderGeometry(R * 0.15, R * 0.19, 0.09, 12).translate(0, rimY - 0.01, 0),
    new THREE.CylinderGeometry(R * 0.56, R * 0.56, 0.02, 24, 1, true).translate(0, rimY - 0.03, 0),
  ];
  for (let i = 0; i < 10; i++) {
    const spoke = new THREE.CylinderGeometry(R * 0.035, R * 0.06, R * 0.44, 5).rotateX(Math.PI / 2).translate(0, rimY - 0.025, R * 0.36);
    parts.push(spoke.rotateY((i / 10) * Math.PI * 2 + (i % 2) * 0.12));
  }
  const rim = merge(parts).rotateZ(-Math.PI / 2);
  const out = { tire, rim };
  wheelCache.set(key, out);
  return out;
}

// Wheels: pivot (steers on Y) → tire mesh (spins on X) → rim.
function addWheels(root, spots, R, w, rimMaterial = chromeMat) {
  const g = wheelGeos(R, w);
  const wheels = [];
  const frontWheels = [];
  for (const { x, z, front } of spots) {
    const pivot = new THREE.Group();
    pivot.position.set(x, R, z);
    const tire = new THREE.Mesh(g.tire, tireMat);
    tire.castShadow = true;
    if (x < 0) tire.scale.x = -1;
    tire.add(new THREE.Mesh(g.rim, rimMaterial));
    pivot.add(tire);
    root.add(pivot);
    wheels.push(tire);
    if (front) frontWheels.push(pivot);
  }
  return { wheels, frontWheels };
}

// ---------- Per-type shared geometry ----------
const typeCache = new Map();
function profileCar(type) {
  if (typeCache.has(type)) return typeCache.get(type);
  const spec = SPECS[type];
  const b = makeBody(spec);
  const gh = spec.gh;
  const L = spec.z[1] - spec.z[0];
  const paint = [b.geometry];
  const trim = [];
  const chrome = [];

  // Wheel wells: dark liners between the tires under each arch.
  const wx = b.w(b.uOf(spec.axles[0])) - 0.035 - spec.tireW / 2;
  for (const ax of spec.axles) trim.push(rbox(2 * (wx - spec.tireW / 2) - 0.02, b.R + b.Ra - 0.12, b.Ra * 1.9, 0.05).translate(0, (b.R + b.Ra) / 2 + 0.08, ax));

  // Mirrors on the A-pillar base.
  const um = gh.a + (gh.b - gh.a) * 0.3;
  const ytm = b.yt(um);
  for (const sx of [-1, 1]) {
    const xm = b.sx(um, ytm - 0.06) * gh.gw;
    paint.push(new THREE.SphereGeometry(1, 10, 6).scale(0.12, 0.07, 0.085).translate(sx * (xm + 0.13), ytm + 0.1, b.zOf(um) + 0.02));
    trim.push(rbox(0.12, 0.03, 0.05, 0.012).translate(sx * (xm + 0.04), ytm + 0.06, b.zOf(um) + 0.04));
  }

  // Arch range in u, used to keep flank patches clear of the wheels.
  const archU = spec.axles.map((ax) => [b.uOf(ax - b.Ra) - 0.012, b.uOf(ax + b.Ra) + 0.012]);
  const uF = archU[0][1];
  const uR = archU[1][0];
  for (const side of [-1, 1]) {
    // Side skirt and a slim character line between the arches.
    const yb = Math.max(b.yb(0.5), b.yb(uF), b.yb(uR));
    trim.push(sidePatch(b, side, uF, uR, yb + 0.005, yb + 0.085, 0.006, 16, 1));
    const yl = b.ym(0.5) - 0.07;
    trim.push(sidePatch(b, side, uF + 0.01, uR - 0.01, yl, yl + 0.018, 0.005, 16, 1));
    // Door seams and handles.
    for (const us of spec.seams || []) trim.push(sidePatch(b, side, us - 0.0016, us + 0.0016, yb + 0.1, b.yt(us) - 0.03, 0.004, 1, 6));
    for (let k = 0; k < (spec.seams || []).length - 1; k++) {
      const uh = spec.seams[k + 1] - 0.035;
      const yh = b.ym(uh) - 0.01;
      trim.push(sidePatch(b, side, uh - 0.028, uh, yh - 0.022, yh, 0.009, 2, 1));
    }
  }

  // Bumpers, grille, lip.
  const bm = spec.bumper;
  const bumperList = bm?.chrome ? chrome : trim;
  const xw = spec.W / 2 - 0.08;
  if (bm) {
    bumperList.push(endPatch(b, 'front', -xw, xw, bm.front[0], bm.front[1], 0.012, 16, 2));
    bumperList.push(endPatch(b, 'rear', -xw, xw, bm.rear[0], bm.rear[1], 0.012, 16, 2));
  }
  if (spec.lip) {
    trim.push(endPatch(b, 'front', -xw, xw, spec.lip.front[0], spec.lip.front[1], 0.01, 16, 1));
    trim.push(endPatch(b, 'rear', -xw * 0.92, xw * 0.92, spec.lip.rear[0], spec.lip.rear[1], 0.01, 14, 1));
  }
  const gr = spec.grille;
  if (gr) {
    if (gr.chrome) chrome.push(endPatch(b, 'front', -gr.x - 0.03, gr.x + 0.03, gr.y[0] - 0.025, gr.y[1] + 0.025, 0.014, 8, 2));
    trim.push(endPatch(b, 'front', -gr.x, gr.x, gr.y[0], gr.y[1], 0.02, 8, 2));
    const nSlat = Math.max(2, Math.round((gr.y[1] - gr.y[0]) / 0.05));
    for (let k = 1; k < nSlat; k++) {
      const y = gr.y[0] + ((gr.y[1] - gr.y[0]) * k) / nSlat;
      (gr.chrome ? chrome : trim).push(endPatch(b, 'front', -gr.x + 0.02, gr.x - 0.02, y - 0.006, y + 0.006, 0.026, 8, 1));
    }
  }
  // Pickup bed: a dark liner inside the rails.
  if (spec.bed) {
    const xb = b.w(0.8) - 0.14;
    trim.push(topPatch(b, -xb, xb, spec.bed[0], spec.bed[1], 0.02, 12, 16));
  }
  // License plate recess on the tail.
  trim.push(endPatch(b, 'rear', -0.27, 0.27, (bm ? bm.rear[1] : 0.42) + 0.03, (bm ? bm.rear[1] : 0.42) + 0.17, 0.006, 6, 1));

  const tail = [];
  const head = [];
  for (const t of spec.tail || []) {
    // Smoked lens housing slightly bigger than the lit part.
    trim.push(...mirrorX((a, c) => endPatch(b, 'rear', a - 0.02, c + 0.02, t.y[0] - 0.02, t.y[1] + 0.02, 0.009, 8, 2), t.x[0], t.x[1]));
    tail.push(...mirrorX((a, c) => endPatch(b, 'rear', a, c, t.y[0], t.y[1], 0.015, 8, 2), t.x[0], t.x[1]));
  }
  for (const h of spec.head || []) {
    chrome.push(...mirrorX((a, c) => endPatch(b, 'front', a - 0.015, c + 0.015, h.y[0] - 0.015, h.y[1] + 0.015, 0.009, 8, 2), h.x[0], h.x[1]));
    head.push(...mirrorX((a, c) => endPatch(b, 'front', a, c, h.y[0], h.y[1], 0.015, 8, 2), h.x[0], h.x[1]));
  }

  // Tailgate window on the flat rear of the greenhouse (vans).
  let rearGlass = null;
  if (gh.rw) {
    const [hw, y0, y1] = gh.rw;
    const ytd = b.yt(gh.d);
    const base = ytd - 0.06;
    const Hf = 0.06 + gh.roof - ytd;
    const pos = [];
    for (let i = 0; i <= 4; i++) {
      const y = y0 + ((y1 - y0) * i) / 4;
      const t = (Math.asin(Math.min(1, (y - base) / Hf)) * 2) / Math.PI;
      const z = b.zOf(gh.d - t * (gh.d - gh.c)) + 0.012;
      for (let j = 0; j <= 4; j++) pos.push(-hw + (2 * hw * j) / 4, y, z);
    }
    rearGlass = gridGeometry(pos, 5, 5, { probe: 2, hint: [0, 0, 1] });
  }

  const geos = {
    spec,
    body: b,
    rearGlass,
    frontZ: spec.z[0],
    rearZ: spec.z[1],
    wheelX: wx,
    paint: merge(paint),
    green: makeGreenhouse(b, gh),
    trim: merge(trim),
    chrome: chrome.length ? merge(chrome) : null,
    tail: tail.length ? merge(tail) : null,
    head: head.length ? merge(head) : null,
    plateY: (bm ? bm.rear[1] : 0.42) + 0.1,
    L,
  };
  typeCache.set(type, geos);
  return geos;
}

function buildProfileCar(type, color, lights) {
  const g = profileCar(type);
  const { spec } = g;
  const root = new THREE.Group();
  const paint = paintMat(color);
  const body = new THREE.Mesh(g.paint, paint);
  const green = new THREE.Mesh(g.green, [paint, glassMat]);
  body.castShadow = green.castShadow = true;
  root.add(body, green, new THREE.Mesh(g.trim, trimMat));
  if (g.chrome) root.add(new THREE.Mesh(g.chrome, chromeMat));
  if (g.rearGlass) root.add(new THREE.Mesh(g.rearGlass, glassMat));
  if (g.tail) root.add(new THREE.Mesh(g.tail, lights.tail));
  if (g.head) root.add(new THREE.Mesh(g.head, lights.head));
  const spots = [];
  for (const ax of spec.axles) for (const sx of [-1, 1]) spots.push({ x: sx * g.wheelX, z: ax, front: ax < 0 });
  const { wheels, frontWheels } = addWheels(root, spots, spec.wheelR, spec.tireW, type === 'wedge' ? goldMat : chromeMat);
  const beam = addBeam(root, g.frontZ);
  root.userData = { wheels, frontWheels, beam, halfLen: g.L / 2, halfW: spec.W / 2 };
  return root;
}

// ---------- Semi truck ----------
const TRUCK = {
  cab: {
    z: [-5.62, -3.3], W: 2.42, wheelR: 0.5, axles: [-4.5],
    top: [[0, 2.95], [0.06, 3.22], [0.2, 3.36], [1, 3.4]],
    bottom: [[0, 0.82], [0.08, 0.74], [1, 0.74]],
    plan: [[0, 0.96], [1, 1]],
    shoulder: 0.45, nt: 2.4, nb: 7, tuck: 0.03, flare: 0.06, endF: 0.13, endR: 0.03, endP: 3, stations: 30,
  },
  fairing: {
    z: [-4.75, -3.28], W: 2.36,
    top: [[0, 3.33], [0.45, 3.9], [1, 4.13]],
    bottom: [[0, 3.3], [1, 3.3]],
    plan: [[0, 0.86], [1, 1]],
    shoulder: 0.35, nt: 2.2, nb: 8, endF: 0.3, endR: 0.02, endP: 2.5, stations: 22, sides: 28,
  },
};

let truckGeos = null;
function truckParts() {
  if (truckGeos) return truckGeos;
  const cab = makeBody(TRUCK.cab);
  const fair = makeBody(TRUCK.fairing);
  const paint = [cab.geometry, fair.geometry];
  const glass = [];
  const trim = [];
  const chrome = [];
  const tail = [];
  const head = [];
  // Wraparound windshield, side windows, visor.
  glass.push(endPatch(cab, 'front', -1.02, 1.02, 2.28, 3.02, 0.012, 16, 3));
  trim.push(endPatch(cab, 'front', -1.08, 1.08, 2.22, 3.08, 0.007, 16, 3));
  trim.push(endPatch(cab, 'front', -1.0, 1.0, 3.06, 3.16, 0.03, 12, 1));
  for (const side of [-1, 1]) {
    glass.push(sidePatch(cab, side, 0.17, 0.5, 2.3, 2.98, 0.01, 6, 2));
    trim.push(sidePatch(cab, side, 0.15, 0.52, 2.25, 3.03, 0.006, 6, 2));
    // Door seam and step.
    trim.push(sidePatch(cab, side, 0.6, 0.605, 1.15, 3.1, 0.006, 1, 4));
    trim.push(sidePatch(cab, side, 0.62, 0.95, 0.76, 0.9, 0.008, 4, 1));
  }
  // Grille with chrome slats, headlights and a chrome bumper.
  chrome.push(endPatch(cab, 'front', -0.66, 0.66, 1.02, 2.04, 0.012, 10, 3));
  trim.push(endPatch(cab, 'front', -0.6, 0.6, 1.08, 1.98, 0.02, 10, 3));
  for (let k = 1; k < 9; k++) chrome.push(endPatch(cab, 'front', -0.58, 0.58, 1.08 + k * 0.1 - 0.012, 1.08 + k * 0.1 + 0.012, 0.026, 8, 1));
  head.push(...mirrorX((a, c) => endPatch(cab, 'front', a, c, 1.1, 1.3, 0.016, 6, 1), 0.76, 1.06));
  chrome.push(...mirrorX((a, c) => endPatch(cab, 'front', a, c, 1.07, 1.33, 0.01, 6, 1), 0.73, 1.09));
  chrome.push(rbox(2.5, 0.3, 0.34, 0.12, 3).translate(0, 0.72, -5.68));
  for (const sx of [-1, 1]) {
    // Mirrors on arms, fuel tanks, exhaust stacks, mud flaps.
    trim.push(rbox(0.12, 0.42, 0.16, 0.05).translate(sx * 1.4, 2.75, -5.2), rbox(0.24, 0.04, 0.04, 0.02).translate(sx * 1.27, 2.9, -5.2));
    chrome.push(new THREE.CylinderGeometry(0.3, 0.3, 1.15, 16).rotateX(Math.PI / 2).translate(sx * 1.0, 0.82, -2.95));
    chrome.push(new THREE.CylinderGeometry(0.085, 0.085, 2.7, 10).translate(sx * 1.08, 2.75, -3.2));
    trim.push(new THREE.CylinderGeometry(0.1, 0.085, 0.25, 10).translate(sx * 1.08, 4.2, -3.2));
    trim.push(rbox(0.36, 0.5, 0.03, 0.01).translate(sx * 1.08, 0.45, -0.25), rbox(0.36, 0.5, 0.03, 0.01).translate(sx * 1.08, 0.45, 5.0));
  }
  // Trailer: box with rounded edges, side ribs, skirts, rear door frame.
  const trailerBody = [rbox(2.5, 3.0, 8.0, 0.14, 3).translate(0, 2.7, 1.0)];
  for (let i = 0; i <= 12; i++) for (const sx of [-1, 1]) trailerBody.push(rbox(0.04, 2.75, 0.07, 0.015).translate(sx * 1.255, 2.7, -2.75 + i * 0.625));
  const stripe = [rbox(2.54, 0.3, 7.9, 0.04).translate(0, 1.75, 1.0), rbox(2.38, 0.1, 1.2, 0.04).translate(0, 3.32, -3.9)];
  trim.push(new THREE.BoxGeometry(1.9, 0.4, 9.6).translate(0, 0.8, -0.4));
  for (const sx of [-1, 1]) trim.push(rbox(0.05, 0.55, 4.2, 0.02).translate(sx * 1.2, 1.0, 0.6));
  trim.push(rbox(2.3, 0.16, 0.12, 0.04).translate(0, 0.95, 5.02), rbox(0.05, 2.7, 0.04, 0.02).translate(0, 2.75, 5.01), rbox(2.3, 0.08, 0.04, 0.02).translate(0, 4.05, 5.01));
  chrome.push(rbox(0.05, 2.2, 0.06, 0.02).translate(-0.45, 2.6, 5.02), rbox(0.05, 2.2, 0.06, 0.02).translate(0.45, 2.6, 5.02));
  for (const sx of [-1, 1]) {
    tail.push(rbox(0.32, 0.18, 0.1, 0.05).translate(sx * 0.95, 1.05, 5.04));
    tail.push(rbox(0.08, 0.08, 0.06, 0.03).translate(sx * 1.15, 4.1, 5.02));
  }
  truckGeos = {
    paint: merge(paint),
    trailer: merge(trailerBody),
    stripe: merge(stripe),
    trim: merge(trim),
    chrome: merge(chrome),
    glass: merge(glass),
    tail: merge(tail),
    head: merge(head),
  };
  return truckGeos;
}

function buildTruck(color, lights) {
  const g = truckParts();
  const root = new THREE.Group();
  const cab = new THREE.Mesh(g.paint, paintMat(color));
  const trailer = new THREE.Mesh(g.trailer, paintMat(0xeef0f5));
  cab.castShadow = trailer.castShadow = true;
  root.add(cab, trailer, new THREE.Mesh(g.stripe, paintMat(color)), new THREE.Mesh(g.trim, trimMat), new THREE.Mesh(g.chrome, chromeMat));
  root.add(new THREE.Mesh(g.glass, glassMat), new THREE.Mesh(g.tail, lights.tail), new THREE.Mesh(g.head, lights.head));
  const spots = [];
  for (const [z, front] of [[-4.5, true], [-2.1, false], [-0.9, false], [3.4, false], [4.5, false]]) {
    for (const sx of [-1, 1]) spots.push({ x: sx * 1.06, z, front });
  }
  const { wheels, frontWheels } = addWheels(root, spots, 0.5, 0.36);
  const beam = addBeam(root, -5.7);
  beam.scale.set(1.3, 1, 1.2);
  root.userData = { wheels, frontWheels, beam, halfLen: 5.5, halfW: 1.25 };
  return root;
}

export const CAR_TYPES = ['sport', 'sedan', 'hatch', 'van', 'pickup', 'truck'];

export function buildCar(type, color, lights = trafficLights) {
  if (type === 'truck') return buildTruck(color, lights);
  return buildProfileCar(SPECS[type] ? type : 'sport', color, lights);
}

// ---------- Player ----------
function plateTexture() {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 64;
  const g = c.getContext('2d');
  g.fillStyle = '#f4f1e6';
  g.fillRect(0, 0, 256, 64);
  g.strokeStyle = '#1b2a6a';
  g.lineWidth = 6;
  g.strokeRect(4, 4, 248, 56);
  g.fillStyle = '#1b2a6a';
  g.font = '900 40px Orbitron, "Arial Black", sans-serif';
  g.textAlign = 'center';
  g.fillText('ENDURO', 128, 47);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// Rear wing: an airfoil extruded across the car, on two swan-neck struts.
function wingGeometry(W, y, z) {
  const s = new THREE.Shape();
  // Shape x = -car z (front of the wing first), y up.
  s.moveTo(0.24, 0);
  s.bezierCurveTo(0.2, 0.05, 0.02, 0.07, -0.22, 0.03);
  s.lineTo(-0.24, 0.0);
  s.bezierCurveTo(-0.05, -0.01, 0.15, -0.025, 0.24, 0);
  const g = new THREE.ExtrudeGeometry(s, { depth: W, bevelEnabled: false, curveSegments: 10 });
  g.translate(0, 0, -W / 2).rotateY(Math.PI / 2).translate(0, y, z);
  return g;
}

export function buildPlayerCar() {
  const lights = {
    tail: new THREE.MeshStandardMaterial({ color: 0x330000, emissive: 0xff1030, emissiveIntensity: 1 }),
    head: new THREE.MeshStandardMaterial({ color: 0x333333, emissive: 0xf4fbff, emissiveIntensity: 2 }),
  };
  const car = buildCar('wedge', 0xff2a6d, lights);
  const b = profileCar('wedge').body;
  const W = SPECS.wedge.W;
  const xw = W / 2 - 0.1;

  const trim = [];
  const paint = [];
  const chrome = [];
  const tail = [];
  const head = [];
  // Rear: black panel, wraparound light bar crossed by louvers, diffuser with fins.
  trim.push(endPatch(b, 'rear', -xw, xw, 0.58, 0.9, 0.008, 20, 3));
  tail.push(endPatch(b, 'rear', -xw + 0.04, xw - 0.04, 0.66, 0.82, 0.014, 20, 2));
  for (const y of [0.713, 0.767]) trim.push(endPatch(b, 'rear', -xw + 0.03, xw - 0.03, y - 0.004, y + 0.004, 0.02, 20, 1));
  trim.push(endPatch(b, 'rear', -xw, xw, 0.26, 0.4, 0.01, 16, 1));
  for (let i = -3; i <= 3; i++) trim.push(rbox(0.025, 0.08, 0.3, 0.01).translate(i * 0.2, 0.32, b.zOf(b.su(i * 0.2, 0.3, 'rear')) - 0.1));
  // Twin exhausts poking out of the diffuser.
  for (const sx of [-0.42, 0.42]) {
    const z = b.zOf(b.su(sx, 0.34, 'rear'));
    chrome.push(new THREE.CylinderGeometry(0.07, 0.07, 0.2, 14, 1, true).rotateX(Math.PI / 2).translate(sx, 0.33, z));
    trim.push(new THREE.CircleGeometry(0.06, 14).translate(sx, 0.33, z + 0.07));
  }
  // Side strakes ahead of the rear wheels (Testarossa style).
  const us0 = b.uOf(SPECS.wedge.axles[1] - b.Ra) - 0.14;
  for (const side of [-1, 1]) for (let i = 0; i < 5; i++) trim.push(sidePatch(b, side, us0, us0 + 0.125, 0.47 + i * 0.07, 0.5 + i * 0.07, 0.012, 6, 1));
  // Front: LED strip, intake, closed pop-up headlight lids with seams.
  head.push(endPatch(b, 'front', -0.78, -0.36, 0.42, 0.46, 0.012, 8, 1), endPatch(b, 'front', 0.36, 0.78, 0.42, 0.46, 0.012, 8, 1));
  trim.push(endPatch(b, 'front', -0.62, 0.62, 0.3, 0.38, 0.01, 12, 1));
  for (const sx of [-1, 1]) {
    trim.push(topPatch(b, sx > 0 ? 0.3 : -0.76, sx > 0 ? 0.76 : -0.3, 0.12, 0.215, 0.006, 6, 4));
    paint.push(topPatch(b, sx > 0 ? 0.32 : -0.74, sx > 0 ? 0.74 : -0.32, 0.125, 0.21, 0.012, 6, 4));
  }
  // Engine cover louvers behind the glass.
  for (let i = 0; i < 5; i++) trim.push(topPatch(b, -0.5, 0.5, 0.875 + i * 0.019, 0.884 + i * 0.019, 0.008, 6, 1));
  // Wing with endplates and struts.
  const zw = b.zOf(0.93);
  trim.push(wingGeometry(W - 0.04, 1.24, zw));
  for (const sx of [-1, 1]) {
    trim.push(rbox(0.03, 0.2, 0.52, 0.012).translate(sx * (W / 2 - 0.03), 1.22, zw));
    trim.push(rbox(0.05, 0.26, 0.12, 0.02).translate(sx * 0.6, 1.1, zw + 0.02));
  }
  const trimMesh = new THREE.Mesh(merge(trim), trimMat);
  trimMesh.castShadow = true;
  car.add(trimMesh, new THREE.Mesh(merge(paint), paintMat(0xff2a6d)), new THREE.Mesh(merge(chrome), chromeMat));
  car.add(new THREE.Mesh(merge(tail), lights.tail), new THREE.Mesh(merge(head), lights.head));
  const plate = new THREE.Mesh(endPatch(b, 'rear', -0.26, 0.26, 0.43, 0.56, 0.016, 6, 1, true), new THREE.MeshStandardMaterial({ map: plateTexture(), roughness: 0.5 }));
  car.add(plate);

  // Neon underglow, brighter at night.
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(64, 64, 4, 64, 64, 64);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  const glowMat = new THREE.MeshBasicMaterial({
    map: new THREE.CanvasTexture(c),
    color: new THREE.Color(0.1, 0.9, 1.6),
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  const glow = new THREE.Mesh(new THREE.PlaneGeometry(3.4, 6.2).rotateX(-Math.PI / 2), glowMat);
  glow.position.y = 0.06;
  car.add(glow);

  // Headlight beam.
  const spot = new THREE.SpotLight(0xfff4e0, 0, 150, 0.42, 0.6, 1.2);
  spot.position.set(0, 0.95, -2.0);
  spot.target.position.set(0, 0, -30);
  car.add(spot, spot.target);

  car.userData.lights = lights;
  car.userData.glow = glowMat;
  car.userData.spot = spot;
  return car;
}
