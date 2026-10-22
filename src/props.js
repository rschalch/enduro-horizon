import * as THREE from 'three';
import { mergeGeometries, mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { lerp, mulberry32 } from './math.js';

// Stylized scenery. Every prop is a list of parts [geometry, materialKey];
// the world places them as InstancedMeshes, one per part per chunk.
// Geometry carries vertex colors (soft occlusion, stripes, strata) that
// multiply with the per-instance tint.

const V = new THREE.Vector3();
const TAU = Math.PI * 2;

// Every part needs the same attribute set so parts can be merged.
function ensureAttrs(g) {
  const n = g.attributes.position.count;
  if (!g.attributes.normal) g.computeVertexNormals();
  if (!g.attributes.uv) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(n * 2), 2));
  if (!g.attributes.color) g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(n * 3).fill(1), 3));
  return g;
}
const prep = (g) => ensureAttrs(g.index ? g.toNonIndexed() : g);
function merge(list) {
  const m = mergeGeometries(list.map(prep));
  m.userData.shared = true;
  return m;
}
const shared = (g) => ((g.userData.shared = true), ensureAttrs(g));
const cyl = (rt, rb, h, seg, x = 0, y = 0, z = 0) => new THREE.CylinderGeometry(rt, rb, h, seg).translate(x, y + h / 2, z);
const cone = (r, h, seg, x = 0, y = 0, z = 0) => new THREE.ConeGeometry(r, h, seg).translate(x, y + h / 2, z);
const ico = (r, x, y, z, detail = 0) => new THREE.IcosahedronGeometry(r, detail).translate(x, y, z);
const box = (w, h, d, x = 0, y = 0, z = 0) => new THREE.BoxGeometry(w, h, d).translate(x, y + h / 2, z);

// Cheap smooth 3D noise for lumpy shapes.
const n3 = (x, y, z, s) =>
  Math.sin(x * 1.7 + s) * Math.sin(y * 2.3 + s * 1.3) * Math.sin(z * 1.9 + s * 0.7) +
  0.5 * Math.sin(x * 3.9 + y * 2.1 + s * 2.1) * Math.sin(z * 4.3 - y * 1.1 + s * 0.4);

// Noise-displaced sphere: canopy lobes, bushes, boulders.
function blob(r, x, y, z, { detail = 1, rough = 0.2, seed = 0, sx = 1, sy = 1, sz = 1, flat = false } = {}) {
  let g = new THREE.IcosahedronGeometry(1, detail);
  g.deleteAttribute('normal');
  g.deleteAttribute('uv');
  g = mergeVertices(g);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    V.fromBufferAttribute(p, i);
    const k = r * (1 + rough * n3(V.x * 2.1, V.y * 2.1, V.z * 2.1, seed));
    p.setXYZ(i, x + V.x * k * sx, y + V.y * k * sy, z + V.z * k * sz);
  }
  if (flat) g = g.toNonIndexed();
  g.computeVertexNormals();
  return g;
}

// Tapered tube along a smooth curve (trunks, branches, arms, poles).
function tube(pts, r0, r1, radial = 6, segs = 8, rf = null) {
  const curve = new THREE.CatmullRomCurve3(pts.map((p) => new THREE.Vector3(...p)));
  const g = new THREE.TubeGeometry(curve, segs, 1, radial, false);
  const p = g.attributes.position;
  const c = new THREE.Vector3();
  for (let i = 0; i <= segs; i++) {
    const t = i / segs;
    curve.getPointAt(t, c);
    const r = lerp(r0, r1, t) * (rf ? rf(t) : 1);
    for (let j = 0; j <= radial; j++) {
      const k = i * (radial + 1) + j;
      V.fromBufferAttribute(p, k).sub(c).multiplyScalar(r).add(c);
      p.setXYZ(k, V.x, V.y, V.z);
    }
  }
  g.computeVertexNormals();
  return g;
}

function paint(g, fn) {
  ensureAttrs(g);
  const p = g.attributes.position;
  const c = g.attributes.color;
  const o = new THREE.Color();
  for (let i = 0; i < p.count; i++) {
    o.setRGB(1, 1, 1);
    fn(p.getX(i), p.getY(i), p.getZ(i), o, i);
    c.setXYZ(i, o.r, o.g, o.b);
  }
  return g;
}
// Darker at the bottom, lighter (and a touch warmer) on top.
function shadeY(g, lo, hi, warm = 0) {
  g.computeBoundingBox();
  const b = g.boundingBox;
  return paint(g, (x, y, z, o) => {
    const t = (y - b.min.y) / (b.max.y - b.min.y || 1);
    const v = lo + (hi - lo) * t;
    o.setRGB(v * (1 + warm * t), v * (1 + warm * t * 0.6), v * (1 - warm * t));
  });
}
// Per-triangle brightness variation (non-indexed geometry).
function faceJitter(g, amt, seed) {
  const c = g.attributes.color;
  const r = mulberry32(seed);
  for (let i = 0; i < c.count; i += 3) {
    const k = 1 + (r() - 0.5) * amt;
    for (let j = i; j < i + 3; j++) c.setXYZ(j, c.getX(j) * k, c.getY(j) * k, c.getZ(j) * k);
  }
  return g;
}
// Split a geometry's triangles in two by a predicate on their centroid.
function splitTris(g, pred) {
  g = prep(g);
  const names = Object.keys(g.attributes);
  const out = [{}, {}];
  for (const o of out) for (const n of names) o[n] = [];
  const pos = g.attributes.position;
  for (let i = 0; i < pos.count; i += 3) {
    const cx = (pos.getX(i) + pos.getX(i + 1) + pos.getX(i + 2)) / 3;
    const cy = (pos.getY(i) + pos.getY(i + 1) + pos.getY(i + 2)) / 3;
    const cz = (pos.getZ(i) + pos.getZ(i + 1) + pos.getZ(i + 2)) / 3;
    const o = out[pred(cx, cy, cz) ? 0 : 1];
    for (const n of names) {
      const a = g.attributes[n];
      for (let j = i; j < i + 3; j++) for (let k = 0; k < a.itemSize; k++) o[n].push(a.array[j * a.itemSize + k]);
    }
  }
  return out.map((o) => {
    const ng = new THREE.BufferGeometry();
    for (const n of names) ng.setAttribute(n, new THREE.Float32BufferAttribute(o[n], g.attributes[n].itemSize));
    return ng;
  });
}
// The same surface facing both ways (thin leaves, canopies seen from below).
function twoSided(g) {
  g = prep(g.clone());
  const back = g.clone();
  for (const n of Object.keys(back.attributes)) {
    const a = back.attributes[n];
    const s = a.itemSize;
    for (let i = 0; i < a.count; i += 3) {
      for (let k = 0; k < s; k++) {
        const t = a.array[(i + 1) * s + k];
        a.array[(i + 1) * s + k] = a.array[(i + 2) * s + k];
        a.array[(i + 2) * s + k] = t;
      }
    }
  }
  const nr = back.attributes.normal.array;
  for (let i = 0; i < nr.length; i++) nr[i] = -nr[i];
  return mergeGeometries([g, back]);
}
// Triangle soup from a flat list of [x,y,z] triangles; flips each to face `up` (if given).
function tris(list, up = null) {
  const pos = [];
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  for (const [p0, p1, p2] of list) {
    a.set(...p0);
    b.set(...p1).sub(a);
    c.set(...p2).sub(a);
    const flip = up && b.clone().cross(c).dot(up) < 0;
    pos.push(...p0, ...(flip ? p2 : p1), ...(flip ? p1 : p2));
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  return g;
}
const UP = new THREE.Vector3(0, 1, 0);

// Gable roof slab pair over a w (x) by d (z) footprint, eaves at height y.
function gableRoof(w, d, y, rise, over = 0.5, thick = 0.22) {
  const a = Math.atan2(rise, d / 2);
  const L = Math.hypot(rise, d / 2) + over;
  const ridge = new THREE.Vector3(0, y + rise + thick / 2, 0);
  const slabs = [];
  for (const s of [1, -1]) {
    const g = new THREE.BoxGeometry(w + over * 2, thick, L).rotateX(s * a);
    const dir = new THREE.Vector3(0, -Math.sin(a), s * Math.cos(a));
    g.translate(ridge.x + dir.x * (L / 2 - 0.08), ridge.y + dir.y * (L / 2 - 0.08), ridge.z + dir.z * (L / 2 - 0.08));
    slabs.push(g);
  }
  return slabs;
}
// Triangular attic block that fills the gable ends.
function gableFill(w, d, y, rise) {
  const sh = new THREE.Shape([new THREE.Vector2(-d / 2, 0), new THREE.Vector2(d / 2, 0), new THREE.Vector2(0, rise)]);
  return new THREE.ExtrudeGeometry(sh, { depth: w, bevelEnabled: false }).rotateY(Math.PI / 2).translate(-w / 2, y, 0);
}

function windowTextures() {
  const size = 256;
  const map = document.createElement('canvas');
  const emi = document.createElement('canvas');
  map.width = map.height = emi.width = emi.height = size;
  const m = map.getContext('2d');
  const e = emi.getContext('2d');
  const rng = mulberry32(7);
  m.fillStyle = '#d8dce6';
  m.fillRect(0, 0, size, size);
  e.fillStyle = '#000';
  e.fillRect(0, 0, size, size);
  const cols = 5;
  const rows = 4;
  const cw = size / cols;
  const rh = size / rows;
  // Floor slabs and mullions for a bit of facade structure.
  m.fillStyle = '#c2c8d6';
  for (let r = 0; r < rows; r++) m.fillRect(0, r * rh, size, rh * 0.12);
  const warm = ['#ffd27a', '#ffb347', '#fff2c4', '#7af3ff', '#ff8ad8'];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const x = c * cw + cw * 0.16;
      const y = r * rh + rh * 0.22;
      const w = cw * 0.68;
      const h = rh * 0.58;
      const lit = rng() < 0.45;
      const grad = m.createLinearGradient(x, y, x + w, y + h);
      grad.addColorStop(0, lit ? '#9a9478' : '#4a5a7a');
      grad.addColorStop(1, lit ? '#7a7660' : '#2c3650');
      m.fillStyle = grad;
      m.fillRect(x, y, w, h);
      m.fillStyle = 'rgba(255,255,255,0.18)';
      m.fillRect(x, y, w * 0.35, h);
      m.fillStyle = '#aab2c2';
      m.fillRect(x + w / 2 - 1, y, 2, h);
      if (lit) {
        e.fillStyle = warm[Math.floor(rng() * warm.length)];
        e.fillRect(x, y, w, h);
      }
    }
  }
  const t1 = new THREE.CanvasTexture(map);
  const t2 = new THREE.CanvasTexture(emi);
  for (const t of [t1, t2]) {
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 4;
  }
  return [t1, t2];
}

// Box with UVs in world units (one texture tile = 16 m) and blank roof.
function building(w, h, d) {
  const g = new THREE.BoxGeometry(w, h, d);
  const uv = g.attributes.uv;
  const dims = [[d, h], [d, h], [0, 0], [0, 0], [w, h], [w, h]];
  for (let f = 0; f < 6; f++) {
    for (let k = 0; k < 4; k++) {
      const i = f * 4 + k;
      if (f === 2 || f === 3) uv.setXY(i, 0.01, 0.01);
      else uv.setXY(i, (uv.getX(i) * dims[f][0]) / 16, (uv.getY(i) * dims[f][1]) / 16);
    }
  }
  return shared(g.translate(0, h / 2, 0));
}

// Rooftop clutter and corner fins for a w x d tower whose roof is at height h.
function roofKit(w, d, h, rng, { tank = false, mast = false } = {}) {
  const t = 0.5;
  const list = [
    box(w + 0.3, 1.1, t, 0, h, d / 2),
    box(w + 0.3, 1.1, t, 0, h, -d / 2),
    box(t, 1.1, d, w / 2, h, 0),
    box(t, 1.1, d, -w / 2, h, 0),
    box(w + 0.4, 0.35, d + 0.4, 0, h - 0.35, 0),
  ];
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) list.push(box(0.55, h, 0.55, sx * (w / 2 + 0.05), 0, sz * (d / 2 + 0.05)));
  const n = 2 + Math.floor(rng() * 3);
  for (let i = 0; i < n; i++) list.push(box(1.4 + rng() * 1.4, 0.9 + rng() * 0.8, 1.2 + rng() * 1.2, (rng() - 0.5) * (w - 3), h, (rng() - 0.5) * (d - 3)));
  list.push(box(Math.min(4, w * 0.35), 2.4, Math.min(3.5, d * 0.3), w * 0.18, h, -d * 0.2));
  if (tank) {
    list.push(cyl(1.3, 1.3, 2.4, 10, -w * 0.22, h + 2.2, d * 0.2), cone(1.45, 0.9, 10, -w * 0.22, h + 4.6, d * 0.2));
    for (const [ox, oz] of [[-0.9, -0.9], [0.9, -0.9], [-0.9, 0.9], [0.9, 0.9]]) list.push(cyl(0.08, 0.08, 2.2, 4, -w * 0.22 + ox, h, d * 0.2 + oz));
  }
  if (mast) list.push(cyl(0.12, 0.2, 9, 5, -w * 0.25, h, d * 0.25));
  return merge(list);
}

export const MATS = {};
export const PROPS = {};
// Biomes list 'billboard'; each placement picks one of the ad variants.
export const BILLBOARD = { variants: [], minD: 16, maxD: 60, scale: [0.9, 1.2], faceTraffic: true, tint: [0xffffff] };

export function initProps() {
  const [winMap, winEmi] = windowTextures();
  Object.assign(MATS, {
    tint: new THREE.MeshStandardMaterial({ color: 0xffffff, flatShading: true, roughness: 0.9, vertexColors: true }),
    foliage: new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.85, vertexColors: true }),
    trunk: new THREE.MeshStandardMaterial({ color: 0x7a4a2a, flatShading: true, roughness: 1, vertexColors: true }),
    palmTrunk: new THREE.MeshStandardMaterial({ color: 0xb98d5a, roughness: 1, vertexColors: true }),
    white: new THREE.MeshStandardMaterial({ color: 0xf4f6fa, roughness: 0.75, vertexColors: true }),
    dark: new THREE.MeshStandardMaterial({ color: 0x2a2d36, metalness: 0.6, roughness: 0.4 }),
    glow: new THREE.MeshBasicMaterial({ color: new THREE.Color(1.5, 1.5, 1.5) }),
    bulb: new THREE.MeshBasicMaterial({ color: new THREE.Color(1, 0.85, 0.6) }),
    reflector: new THREE.MeshBasicMaterial({ color: new THREE.Color(1, 0.5, 0.1) }),
    beacon: new THREE.MeshBasicMaterial({ color: new THREE.Color(1, 0.1, 0.1) }),
    pool: new THREE.MeshBasicMaterial({ map: radialTexture(), color: 0x000000, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 }),
    fence: new THREE.MeshStandardMaterial({ color: 0x8a5a36, flatShading: true, roughness: 1, vertexColors: true }),
    metal: new THREE.MeshStandardMaterial({ color: 0xb8c0cc, metalness: 0.7, roughness: 0.35 }),
    stem: new THREE.MeshStandardMaterial({ color: 0x3f8f3a, roughness: 0.9, vertexColors: true }),
    pollen: new THREE.MeshStandardMaterial({ color: 0xffd23f, roughness: 0.7 }),
    building: new THREE.MeshStandardMaterial({
      map: winMap,
      emissiveMap: winEmi,
      emissive: 0xffffff,
      emissiveIntensity: 0.1,
      roughness: 0.6,
      metalness: 0.25,
    }),
  });

  const rng = mulberry32(42);
  const greens = [0x3fa34d, 0x5cc15a, 0x2e8b57];

  // ---------- Trees ----------
  {
    const flare = (t) => 1 + 0.6 * Math.pow(1 - t, 6);
    const trunk = [tube([[0, -0.2, 0], [0.12, 1.3, 0.05], [-0.06, 2.5, 0], [0.05, 3.6, 0]], 0.38, 0.2, 7, 6, flare)];
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * TAU + 0.4;
      trunk.push(tube([[0, 2.3, 0], [Math.cos(a) * 0.7, 3.1, Math.sin(a) * 0.7], [Math.cos(a) * 1.3, 3.8, Math.sin(a) * 1.3]], 0.13, 0.06, 5, 3));
    }
    const lobes = [blob(2.2, 0, 4.7, 0, { rough: 0.22, seed: 1, sy: 0.85 })];
    for (let i = 0; i < 7; i++) {
      const a = (i / 7) * TAU + rng() * 0.5;
      const rr = 1.55 + rng() * 0.4;
      lobes.push(blob(1.15 + rng() * 0.35, Math.cos(a) * rr, 3.8 + rng() * 1.1, Math.sin(a) * rr, { rough: 0.25, seed: 2 + i, sy: 0.85 }));
    }
    lobes.push(blob(1.4, 0.3, 6.0, -0.2, { rough: 0.2, seed: 9 }));
    const canopy = merge(lobes);
    canopy.computeBoundingBox();
    const cb = canopy.boundingBox;
    paint(canopy, (x, y, z, o) => {
      const t = (y - cb.min.y) / (cb.max.y - cb.min.y);
      const out = Math.min(1, Math.hypot(x, z) / 3);
      const v = 0.5 + 0.42 * t + 0.16 * out;
      o.setRGB(v * (1 + 0.08 * t), v * (1 + 0.05 * t), v * (1 - 0.1 * t));
    });
    PROPS.roundTree = {
      parts: [[merge(trunk), 'trunk'], [canopy, 'foliage']],
      minD: 13, maxD: 190, scale: [0.8, 1.7], tint: greens,
    };
  }
  {
    const tiers = [];
    const n = 6;
    for (let i = 0; i < n; i++) {
      const r = 2.5 * (1 - i / (n + 0.8)) + 0.25;
      const h = 2.3 - i * 0.12;
      const y0 = 1.0 + i * 0.92;
      const g = new THREE.ConeGeometry(r, h, 11, 2);
      const p = g.attributes.position;
      for (let k = 0; k < p.count; k++) {
        const x = p.getX(k);
        const z = p.getZ(k);
        const rr = Math.hypot(x, z);
        if (rr < 1e-4) continue;
        const a = Math.atan2(z, x);
        const f = 1 + 0.16 * Math.sin(a * 5 + i * 1.7) + 0.08 * Math.sin(a * 11 + i);
        const yy = p.getY(k);
        p.setXYZ(k, x * f, yy - (yy < -h / 2 + 1e-3 ? 0.35 * (rr / r) * f : 0), z * f);
      }
      g.rotateY(i * 0.7).translate(0, y0 + h / 2, 0);
      const ng = g.toNonIndexed();
      ng.computeVertexNormals();
      paint(ng, (x, y, z, o) => {
        const t = Math.min(1, Math.max(0, (y - y0 + 0.35) / (h + 0.35)));
        const v = (0.62 + 0.5 * t) * (0.85 + 0.25 * (i / n));
        o.setRGB(v, v * 1.02, v * 0.98);
      });
      tiers.push(ng);
    }
    const crown = merge(tiers);
    faceJitter(crown, 0.18, 5);
    PROPS.pine = {
      parts: [
        [merge([tube([[0, -0.2, 0], [0.04, 1.2, 0], [0, 3.0, 0]], 0.32, 0.14, 6, 3, (t) => 1 + 0.5 * Math.pow(1 - t, 5))]), 'trunk'],
        [crown, 'foliage'],
      ],
      minD: 13, maxD: 190, scale: [0.8, 1.9], tint: [0x2f6b4f, 0x3f7f5f],
    };
  }
  {
    const canopy = merge([
      blob(1.5, 0, 3.7, 0, { rough: 0.2, seed: 21, sy: 1.6 }),
      blob(1.3, 0.15, 5.7, 0.1, { rough: 0.22, seed: 22, sy: 1.5 }),
      blob(1.0, -0.1, 7.5, 0, { rough: 0.22, seed: 23, sy: 1.5 }),
      blob(0.6, 0.05, 8.9, 0, { rough: 0.2, seed: 24, sy: 1.5 }),
    ]);
    shadeY(canopy, 0.55, 1.08, 0.08);
    PROPS.poplar = {
      parts: [
        [merge([tube([[0, -0.2, 0], [0.05, 1.5, 0], [0, 3.6, 0]], 0.26, 0.14, 6, 3)]), 'trunk'],
        [canopy, 'foliage'],
      ],
      minD: 14, maxD: 160, scale: [0.9, 1.5], tint: greens,
    };
  }
  {
    const lobes = [];
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * TAU + rng();
      const rr = i ? 0.75 : 0;
      lobes.push(blob(i ? 0.75 + rng() * 0.25 : 1.05, Math.cos(a) * rr, 0.55 + rng() * 0.2, Math.sin(a) * rr, { rough: 0.25, seed: 30 + i, sy: 0.78 }));
    }
    const g = merge(lobes);
    shadeY(g, 0.5, 1.05, 0.06);
    PROPS.bush = { parts: [[g, 'foliage']], minD: 11, maxD: 120, scale: [0.6, 1.5], tint: greens };
  }
  {
    const stems = [];
    const heads = [];
    const hearts = [];
    for (let i = 0; i < 8; i++) {
      const a = rng() * TAU;
      const r = 0.15 + rng() * 0.85;
      const x = Math.cos(a) * r;
      const z = Math.sin(a) * r;
      const h = 0.3 + rng() * 0.3;
      const lean = (rng() - 0.5) * 0.6;
      stems.push(cyl(0.022, 0.03, h, 3, x, 0, z));
      const pr = 0.2 + rng() * 0.08;
      const ring = [];
      for (let k = 0; k < 10; k++) {
        const aa = (k / 10) * TAU;
        const rr = k % 2 ? pr * 0.42 : pr;
        ring.push([Math.cos(aa) * rr, k % 2 ? 0.01 : 0.045, Math.sin(aa) * rr]);
      }
      const list = [];
      for (let k = 0; k < 10; k++) list.push([[0, 0, 0], ring[k], ring[(k + 1) % 10]]);
      const head = tris(list, UP).rotateX(lean).rotateY(rng() * TAU).translate(x, h, z);
      paint(head, (px, py, pz, o) => {
        const d = Math.hypot(px - x, pz - z) / pr;
        o.setScalar(0.82 + 0.25 * d);
      });
      heads.push(head);
      hearts.push(new THREE.OctahedronGeometry(0.06).scale(1, 0.6, 1).translate(x, h + 0.03, z));
    }
    PROPS.flowers = {
      parts: [[merge(stems), 'stem'], [merge(heads), 'foliage'], [merge(hearts), 'pollen']],
      minD: 10, maxD: 80, scale: [0.8, 1.6], tint: [0xff4d6d, 0xffd23f], noShadow: true,
    };
  }
  {
    const blades = [];
    for (let i = 0; i < 7; i++) {
      const a = rng() * TAU;
      const r = 0.05 + rng() * 0.35;
      const h = 0.45 + rng() * 0.5;
      const g = new THREE.ConeGeometry(0.06, h, 3, 2, true).translate(0, h / 2, 0);
      const p = g.attributes.position;
      const dir = a + (rng() - 0.5);
      const lean = 0.15 + rng() * 0.3;
      for (let k = 0; k < p.count; k++) {
        const t = p.getY(k) / h;
        p.setX(k, p.getX(k) + Math.cos(dir) * lean * t * t);
        p.setZ(k, p.getZ(k) + Math.sin(dir) * lean * t * t);
      }
      g.rotateY(rng() * TAU).translate(Math.cos(a) * r, 0, Math.sin(a) * r);
      g.computeVertexNormals();
      blades.push(g);
    }
    const g = merge(blades);
    paint(g, (x, y, z, o) => {
      const t = Math.min(1, y / 0.9);
      o.setRGB(0.5 + 0.65 * t, 0.55 + 0.6 * t, 0.5 + 0.35 * t);
    });
    PROPS.grass = { parts: [[g, 'foliage']], minD: 9.4, maxD: 45, scale: [0.8, 1.8], tint: greens, noShadow: true };
  }
  {
    const g = merge([
      blob(1.2, 0, 0.42, 0, { rough: 0.3, seed: 41, sx: 1.3, sy: 0.72, flat: true }),
      blob(0.55, 1.35, 0.18, 0.5, { rough: 0.3, seed: 42, sy: 0.7, flat: true }),
    ]);
    shadeY(g, 0.72, 1.12);
    faceJitter(g, 0.22, 43);
    PROPS.rock = { parts: [[g, 'tint']], minD: 12, maxD: 190, scale: [0.5, 2.6], tint: [0x8a8f99, 0x9a9faa] };
  }
  {
    // Saguaro: ribbed trunk and rounded, bent arms.
    const prof = [];
    for (let i = 0; i <= 8; i++) prof.push(new THREE.Vector2(0.42 - i * 0.004, -0.1 + i * 0.42));
    for (let i = 1; i <= 4; i++) {
      const a = (i / 4) * (Math.PI / 2);
      prof.push(new THREE.Vector2(0.39 * Math.cos(a), 3.26 + 0.36 * Math.sin(a)));
    }
    const ribs = (g, n, amt) => {
      const p = g.attributes.position;
      for (let k = 0; k < p.count; k++) {
        const x = p.getX(k);
        const z = p.getZ(k);
        const f = 1 + amt * Math.cos(Math.atan2(z, x) * n);
        p.setX(k, x * f);
        p.setZ(k, z * f);
      }
      g.computeVertexNormals();
      return g;
    };
    const trunk = ribs(new THREE.LatheGeometry(prof, 16), 8, 0.08);
    const arm = (pts, r) => [tube(pts, r, r * 0.9, 8, 10), new THREE.SphereGeometry(r * 0.9, 8, 5).translate(...pts[pts.length - 1])];
    const g = merge([
      trunk,
      ...arm([[0.1, 1.45, 0], [0.75, 1.42, 0], [1.08, 1.75, 0], [1.12, 2.4, 0], [1.12, 2.95, 0]], 0.25),
      ...arm([[-0.1, 2.05, 0.05], [-0.62, 2.05, 0.1], [-0.88, 2.35, 0.12], [-0.9, 3.05, 0.12]], 0.22),
    ]);
    shadeY(g, 0.7, 1.08);
    PROPS.cactus = { parts: [[g, 'foliage']], minD: 12, maxD: 160, scale: [0.8, 1.6], tint: [0x3f9b4a, 0x5aaa48, 0x2f8a40] };
  }
  {
    // Mesa: stacked strata bands with ledges, a talus skirt and a hoodoo.
    const bands = [[1.3, 1.22, 0.24, 0.78], [1.18, 1.12, 0.26, 1.0], [1.08, 1.05, 0.3, 0.86], [1.0, 0.97, 0.26, 1.06], [0.93, 0.88, 0.2, 0.9], [0.86, 0.84, 0.08, 1.12]];
    const list = [];
    let y = -0.05;
    bands.forEach(([rb, rt, h, shade], k) => {
      const g = new THREE.CylinderGeometry(rt, rb, h, 16, 1);
      const p = g.attributes.position;
      for (let i = 0; i < p.count; i++) {
        const x = p.getX(i);
        const z = p.getZ(i);
        const a = Math.atan2(z, x);
        const f = 1 + 0.09 * Math.sin(a * 3 + 1.1) + 0.05 * Math.sin(a * 7 + k * 2.1) + 0.03 * Math.sin(a * 13 + k);
        p.setX(i, x * f);
        p.setZ(i, z * f);
      }
      g.translate(0, y + h / 2, 0);
      y += h;
      list.push(paint(g, (px, py, pz, o) => o.setScalar(shade)));
    });
    list.push(paint(new THREE.CylinderGeometry(1.3, 1.7, 0.22, 16).translate(0, 0.06, 0), (x, y, z, o) => o.setScalar(0.7)));
    list.push(paint(cyl(0.09, 0.16, 0.85, 6, 1.75, 0, 0.5), (x, y, z, o) => o.setScalar(0.95)));
    list.push(paint(cone(0.13, 0.16, 6, 1.75, 0.85, 0.5), (x, y, z, o) => o.setScalar(0.8)));
    const g = merge(list);
    faceJitter(g, 0.14, 51);
    PROPS.mesa = { parts: [[g.scale(16, 22, 16), 'tint']], minD: 75, maxD: 200, scale: [0.6, 1.8], tint: [0xd9622b, 0xc2452d] };
  }
  {
    // Palm: curved ringed trunk, coconuts and drooping two-sided fronds.
    const top = [1.62, 7.3, 0];
    const trunk = tube([[0, -0.2, 0], [0.25, 2.5, 0], [0.9, 5, 0], top], 0.36, 0.22, 8, 16, (t) => 1 + 0.08 * Math.abs(Math.sin(t * Math.PI * 11)));
    paint(trunk, (x, y, z, o) => o.setScalar(0.78 + 0.3 * Math.abs(Math.sin((y / 7.3) * Math.PI * 11))));
    const nuts = [];
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * TAU;
      nuts.push(paint(ico(0.2, top[0] + Math.cos(a) * 0.28, top[1] - 0.2, Math.sin(a) * 0.28, 1), (x, y, z, o) => o.setRGB(0.45, 0.35, 0.25)));
    }
    nuts.push(paint(blob(0.4, top[0], top[1] + 0.05, 0, { rough: 0.1, seed: 61 }), (x, y, z, o) => o.setRGB(0.55, 0.5, 0.35)));
    const fronds = [];
    const L = 3.8;
    for (let i = 0; i < 9; i++) {
      const yaw = (i / 9) * TAU + rng() * 0.3;
      const lift = 0.3 + (i % 3) * 0.12;
      const fwd = [Math.cos(yaw), 0, Math.sin(yaw)];
      const side = [-Math.sin(yaw), 0, Math.cos(yaw)];
      const N = 9;
      const spine = [];
      const edge = [[], []];
      for (let k = 0; k <= N; k++) {
        const u = k / N;
        const s = L * u;
        const sp = [top[0] + fwd[0] * s, top[1] + 0.15 + L * (lift * u - 0.8 * u * u), top[2] + fwd[2] * s];
        spine.push(sp);
        const w = 0.55 * Math.pow(Math.sin(Math.PI * Math.min(1, u * 1.08)), 0.7);
        for (const [j, sg] of [[0, -1], [1, 1]]) edge[j].push([sp[0] + side[0] * sg * w, sp[1] - w * 0.45, sp[2] + side[2] * sg * w]);
      }
      const list = [];
      for (let k = 0; k < N; k++) {
        for (const e of edge) {
          list.push([spine[k], e[k], e[k + 1]], [spine[k], e[k + 1], spine[k + 1]]);
        }
      }
      const g = tris(list, UP);
      paint(g, (x, y, z, o) => {
        const u = Math.min(1, Math.hypot(x - top[0], z - top[2]) / L);
        o.setRGB(0.75 + 0.35 * u, 0.8 + 0.2 * u, 0.7);
      });
      fronds.push(twoSided(g));
    }
    PROPS.palm = {
      parts: [[merge([trunk, ...nuts]), 'palmTrunk'], [merge(fronds), 'foliage']],
      minD: 12, maxD: 90, scale: [0.9, 1.35], tint: [0x2fa84f, 0x45c060, 0x1f8f45],
    };
  }
  {
    // Hot-air balloon: smooth envelope with two-color gores, ropes, basket and burner.
    const prof = [[0.75, 2.5], [1.5, 3.2], [2.5, 4.2], [3.4, 5.4], [3.95, 6.7], [4.05, 7.8], [3.8, 8.9], [3.1, 9.8], [2.0, 10.5], [0.9, 10.85], [0, 10.95]].map(([r, y]) => new THREE.Vector2(r, y));
    const env = new THREE.LatheGeometry(prof, 16);
    shadeY(env, 0.75, 1.05);
    const [ga, gb] = splitTris(env, (x, y, z) => Math.floor(((Math.atan2(z, x) + Math.PI) / TAU) * 16) % 2 === 0);
    const pal = [0xff3b6b, 0xffc93c, 0x3bc9ff, 0x9b5cff, 0x3ddc84];
    const pal2 = pal.map((_, i) => pal[(i + 2) % pal.length]);
    const ropes = [];
    for (const [x, z] of [[-0.5, -0.5], [0.5, -0.5], [-0.5, 0.5], [0.5, 0.5]]) ropes.push(tube([[x, 1.0, z], [x * 1.6, 2.55, z * 1.6]], 0.03, 0.03, 3, 1));
    PROPS.balloon = {
      parts: [
        [shared(ga), 'tint', pal],
        [shared(gb), 'tint', pal2],
        [merge([box(1.2, 1, 1.2), box(1.35, 0.15, 1.35, 0, 0.9)]), 'trunk'],
        [merge(ropes), 'dark'],
        [shared(cone(0.25, 0.5, 6).rotateX(Math.PI).translate(0, 1.9, 0)), 'bulb'],
      ],
      minD: 40, maxD: 190, scale: [1, 1.6], lift: [30, 90], tint: pal, noShadow: true,
    };
  }
  PROPS.snowman = {
    parts: [
      [merge([blob(1, 0, 1, 0, { detail: 2, rough: 0.04, seed: 71 }), blob(0.72, 0, 2.4, 0, { detail: 2, rough: 0.04, seed: 72 }), blob(0.48, 0, 3.35, 0, { detail: 2, rough: 0.03, seed: 73 })]), 'white'],
      [merge([
        cyl(0.42, 0.42, 0.08, 12, 0, 3.7, 0), cyl(0.3, 0.3, 0.5, 12, 0, 3.75, 0),
        ico(0.06, -0.17, 3.48, -0.42), ico(0.06, 0.17, 3.48, -0.42),
        ico(0.07, 0, 2.55, -0.7), ico(0.07, 0, 2.25, -0.71), ico(0.07, 0, 1.4, -0.98),
      ]), 'dark'],
      [shared(cone(0.09, 0.5, 6).rotateX(-Math.PI / 2).translate(0, 3.4, -0.6)), 'tint'],
      [merge([
        tube([[0.6, 2.5, 0], [1.2, 2.85, 0.1], [1.65, 3.3, 0]], 0.05, 0.03, 4, 3),
        tube([[-0.6, 2.5, 0], [-1.15, 2.7, -0.1], [-1.6, 3.1, 0]], 0.05, 0.03, 4, 3),
      ]), 'trunk'],
      [merge([new THREE.TorusGeometry(0.5, 0.11, 6, 14).rotateX(Math.PI / 2).translate(0, 2.98, 0), box(0.22, 0.7, 0.08, 0.25, 2.3, -0.5)]), 'tint', [0xe8203a, 0x2a7fff, 0x3ddc84, 0xffc93c]],
    ],
    minD: 12, maxD: 40, scale: [0.9, 1.3], tint: [0xff8c1a],
  };
  {
    // Sailboat: pointed hull, mast, mainsail and jib.
    const hs = new THREE.Shape([[-0.8, -2.5], [0.8, -2.5], [0.88, 0.4], [0.55, 1.8], [0, 2.7], [-0.55, 1.8], [-0.88, 0.4]].map(([x, y]) => new THREE.Vector2(x, y)));
    const hull = new THREE.ExtrudeGeometry(hs, { depth: 0.9, bevelEnabled: true, bevelThickness: 0.08, bevelSize: 0.08, bevelSegments: 1 }).rotateX(-Math.PI / 2).translate(0, -0.25, 0);
    paint(hull, (x, y, z, o) => o.setScalar(y < 0.25 ? 0.55 : 1));
    const sail = (pts, depth = 0.04) => new THREE.ExtrudeGeometry(new THREE.Shape(pts.map(([x, y]) => new THREE.Vector2(x, y))), { depth, bevelEnabled: false }).rotateY(-Math.PI / 2);
    PROPS.sailboat = {
      parts: [
        [merge([hull, box(0.9, 0.5, 1.4, 0, 0.7, 0.6), cyl(0.06, 0.07, 6.8, 6, 0, 0.7, 0), cyl(0.04, 0.04, 3.0, 4, 0, 0, 0).rotateX(Math.PI / 2).translate(0, 1.5, 1.5)]), 'white'],
        [merge([sail([[0.1, 0], [3.1, 0], [0.1, 5.6]]).translate(0.02, 1.55, 0), sail([[-0.15, 0], [-2.4, 0], [-0.15, 4.6]]).translate(0.02, 2.2, 0)]), 'tint'],
      ],
      onWater: true, minD: 60, maxD: 190, scale: [0.9, 1.6], tint: [0xff3b6b, 0xffd23f, 0xffffff, 0x3bc9ff], noShadow: true,
    };
  }
  const bldTint = [0x8aa0c8, 0x6c7aa8, 0xb0b8d0, 0x9b8ac8, 0x5e6f9a, 0xc8a0b8];
  PROPS.bldA = { parts: [[building(12, 32, 12), 'building'], [roofKit(12, 12, 32, rng, { tank: true }), 'dark']], minD: 24, maxD: 150, scale: [0.8, 1.5], align: true, tint: bldTint };
  PROPS.bldB = { parts: [[building(16, 60, 16), 'building'], [roofKit(16, 16, 60, rng, { mast: true }), 'dark']], minD: 35, maxD: 190, scale: [0.8, 1.4], align: true, tint: bldTint };
  PROPS.bldC = { parts: [[building(10, 18, 14), 'building'], [roofKit(10, 14, 18, rng, { tank: true }), 'dark']], minD: 22, maxD: 120, scale: [0.8, 1.4], align: true, tint: bldTint };
  PROPS.neon = {
    parts: [
      [merge([cyl(0.15, 0.18, 6, 8, -1.8), cyl(0.15, 0.18, 6, 8, 1.8), box(5.5, 2.1, 0.16, 0, 5.75, -0.2), box(5.2, 0.12, 0.6, 0, 7.75, 0.1)]), 'dark'],
      [shared(box(5, 1.6, 0.25, 0, 6)), 'glow'],
    ],
    minD: 12, maxD: 22, scale: [0.9, 1.3], align: true, tint: [0xff2bd6, 0x00f0ff, 0xffe600, 0x7cff4f, 0xff6a00, 0xb84dff], noShadow: true,
  };
  // Regularly spaced roadside props (placed by the world, not randomly).
  PROPS.lamp = {
    parts: [
      [merge([
        cyl(0.26, 0.32, 0.7, 8),
        tube([[0, 0.5, 0], [0, 7.0, 0], [-0.25, 7.75, 0], [-1.1, 7.98, 0], [-2.2, 7.92, 0]], 0.16, 0.08, 6, 12),
        box(1.25, 0.2, 0.55, -2.35, 7.78),
      ]), 'dark'],
      [shared(box(1, 0.1, 0.45, -2.35, 7.68)), 'bulb'],
    ],
  };
  PROPS.reflector = {
    parts: [
      [shared(cyl(0.08, 0.09, 1, 6)), 'white'],
      [shared(box(0.18, 0.16, 0.18, 0, 0.82)), 'reflector'],
    ],
    noShadow: true,
  };
  // Warm pool of light on the road under each lamp, visible at night.
  PROPS.lamp.parts.push([shared(new THREE.PlaneGeometry(9, 9).rotateX(-Math.PI / 2).translate(-3.4, 0.12, 0)), 'pool']);

  // ---------- Countryside ----------
  {
    const walls = [box(7, 3.6, 6), gableFill(7, 6, 3.6, 2.2)];
    const roof = [...gableRoof(7, 6, 3.6, 2.2), box(0.75, 2.2, 0.75, 1.8, 4.4, -1.1), box(0.95, 0.18, 0.95, 1.8, 6.6, -1.1)];
    const trim = [paint(box(7.25, 0.45, 6.25, 0, -0.1), (x, y, z, o) => o.setScalar(0.62))];
    const glass = [];
    const win = (x, y, z, rotY = 0) => {
      const fr = [box(1.4, 1.4, 0.08, 0, -0.7, 0), box(1.6, 0.12, 0.3, 0, -0.82, 0.1), box(0.07, 1.1, 0.05, 0, -0.55, 0.08), box(1.1, 0.07, 0.05, 0, -0.03, 0.08)];
      for (const g of fr) trim.push(g.rotateY(rotY).translate(x, y, z));
      glass.push(box(1.1, 1.1, 0.1, 0, -0.55, 0.01).rotateY(rotY).translate(x, y, z));
      for (const sx of [-1, 1]) roof.push(box(0.5, 1.25, 0.06, sx * 0.86, -0.62, 0.02).rotateY(rotY).translate(x, y, z));
    };
    win(-1.8, 1.4, 3.0);
    win(1.8, 1.4, 3.0);
    win(-1.8, 1.4, -3.0, Math.PI);
    win(1.8, 1.4, -3.0, Math.PI);
    win(-3.5, 1.4, 0, -Math.PI / 2);
    win(3.5, 1.4, 0, Math.PI / 2);
    win(-3.5, 4.0, 0, -Math.PI / 2);
    // Front door with a little porch roof on two posts and a step.
    trim.push(box(1.3, 2.15, 0.08, 0, 0, 3.0), box(1.6, 0.18, 1.0, 0, -0.05, 3.5), box(2.4, 0.14, 1.5, 0, 2.55, 3.65), cyl(0.07, 0.07, 2.55, 6, -1.05, 0, 4.25), cyl(0.07, 0.07, 2.55, 6, 1.05, 0, 4.25));
    glass.push(box(1.0, 1.9, 0.1, 0, 0, 3.02));
    PROPS.house = {
      parts: [
        [merge(walls), 'tint', [0xfff4e0, 0xf6e0c0, 0xe8f0ff, 0xffe8e8, 0xdff5e0]],
        [merge(roof), 'tint', [0xc0392b, 0x8e3b2a, 0x34495e, 0x6a4a8a, 0x2e6b4a]],
        [merge(trim), 'white'],
        [merge(glass), 'bulb'],
      ],
      minD: 30, maxD: 170, scale: [0.9, 1.3], align: true, tint: [0xffffff],
    };
  }
  {
    // Log cabin with snowy roof, stone chimney and lit windows.
    const logs = [];
    const lr = 0.2;
    for (let i = 0; i < 7; i++) {
      const y = lr + i * lr * 2;
      for (const z of [-2.25, 2.25]) logs.push(paint(new THREE.CylinderGeometry(lr, lr, 5.5, 6).rotateZ(Math.PI / 2).translate(0, y, z), (x, yy, zz, o) => o.setScalar(i % 2 ? 0.85 : 1)));
      for (const x of [-2.5, 2.5]) logs.push(paint(new THREE.CylinderGeometry(lr, lr, 5.0, 6).rotateX(Math.PI / 2).translate(x, y + lr, 0), (xx, yy, zz, o) => o.setScalar(i % 2 ? 1 : 0.85)));
    }
    logs.push(paint(gableFill(5, 4.5, 2.8, 1.6), (x, y, z, o) => o.setScalar(0.8)));
    logs.push(paint(box(1.0, 1.9, 0.12, 0.9, 0, 2.42), (x, y, z, o) => o.setScalar(0.55)));
    logs.push(paint(box(0.9, 4.6, 0.9, -1.7, 0, -1.4), (x, y, z, o) => o.setRGB(0.75, 0.75, 0.78)));
    const roof = gableRoof(5, 4.5, 2.8, 1.6, 0.55, 0.32);
    roof.push(box(1.05, 0.2, 1.05, -1.7, 4.6, -1.4));
    PROPS.cabin = {
      parts: [
        [merge(logs), 'trunk'],
        [merge(roof), 'white'],
        [merge([box(0.9, 0.9, 0.1, -0.9, 1.0, 2.45), box(0.1, 0.9, 0.9, 2.72, 1.0, 0.6), box(0.1, 0.9, 0.9, -2.72, 1.0, 0.6)]), 'bulb'],
      ],
      minD: 25, maxD: 120, scale: [0.9, 1.2], align: true, tint: [0xffffff],
    };
  }
  {
    // Wind turbine: tapered tower, rounded nacelle, airfoil blades.
    const bladeShape = new THREE.Shape([[-0.3, 0.8], [0.25, 0.8], [0.55, 3.0], [0.3, 12], [0.08, 17.6], [-0.08, 17.6], [-0.3, 3.0]].map(([x, y]) => new THREE.Vector2(x, y)));
    const rotor = [new THREE.ConeGeometry(0.75, 1.6, 12).rotateX(Math.PI / 2).translate(0, 0, 0.55), new THREE.SphereGeometry(0.78, 12, 8)];
    for (let i = 0; i < 3; i++) rotor.push(new THREE.ExtrudeGeometry(bladeShape, { depth: 0.16, bevelEnabled: false }).translate(0, 0, -0.08).rotateZ((i / 3) * TAU));
    PROPS.turbine = {
      parts: [
        [merge([cyl(0.7, 1.3, 38, 14), new THREE.CapsuleGeometry(0.85, 3.4, 4, 12).rotateX(Math.PI / 2).translate(0, 38.3, -0.4)]), 'white'],
        [shared(box(0.5, 0.5, 0.5, 0, 39.1, -1.8)), 'beacon'],
        [merge(rotor), 'white', null, { spin: { y: 38.3, z: 1.6, speed: 1.4 } }],
      ],
      minD: 90, maxD: 200, scale: [0.8, 1.1], align: true, tint: [0xffffff], noShadow: true,
    };
  }
  {
    // Dead tree: gnarly recursive branches.
    const parts = [];
    const r2 = mulberry32(81);
    const grow = (base, dir, len, r, depth) => {
      const mid = base.clone().addScaledVector(dir, len * 0.5).add(new THREE.Vector3((r2() - 0.5) * 0.3, 0, (r2() - 0.5) * 0.3));
      const end = base.clone().addScaledVector(dir, len);
      parts.push(tube([base.toArray(), mid.toArray(), end.toArray()], r, r * 0.6, depth > 1 ? 6 : 4, 3));
      if (depth === 0) return;
      const n = depth > 1 ? 3 : 2;
      for (let i = 0; i < n; i++) {
        const a = r2() * TAU;
        const nd = dir.clone().multiplyScalar(0.6).add(new THREE.Vector3(Math.cos(a), 0.35 + r2() * 0.4, Math.sin(a)).multiplyScalar(0.7)).normalize();
        grow(end, nd, len * (0.55 + r2() * 0.15), r * 0.55, depth - 1);
      }
    };
    grow(new THREE.Vector3(0, -0.2, 0), new THREE.Vector3(0.05, 1, 0).normalize(), 2.8, 0.3, 3);
    const g = merge(parts);
    shadeY(g, 0.7, 1.05);
    PROPS.deadTree = { parts: [[g, 'trunk']], minD: 14, maxD: 160, scale: [0.8, 1.6] };
  }
  {
    // Beach umbrella: domed canopy with alternating white panels.
    const prof = [[1.75, 2.3], [1.45, 2.58], [0.95, 2.82], [0.4, 2.95], [0, 2.98]].map(([r, y]) => new THREE.Vector2(r, y));
    const can = twoSided(new THREE.LatheGeometry(prof, 16));
    const [ga, gb] = splitTris(can, (x, y, z) => Math.floor(((Math.atan2(z, x) + Math.PI) / TAU) * 16) % 2 === 0);
    PROPS.umbrella = {
      parts: [
        [merge([cyl(0.045, 0.05, 3.05, 6), ico(0.08, 0, 3.05, 0, 1)]), 'white'],
        [shared(ga), 'tint'],
        [shared(gb), 'white'],
      ],
      beach: true, minD: 15, maxD: 38, scale: [0.9, 1.2], tint: [0xff3b6b, 0xffd23f, 0x3bc9ff, 0x7cff4f, 0xff8c1a, 0xffffff], noShadow: false,
    };
  }
  PROPS.bldD = {
    parts: [
      [merge([building(18, 40, 18), building(12, 30, 12).translate(0, 40, 0), building(6, 16, 6).translate(0, 70, 0)]), 'building'],
      [merge([
        roofKit(18, 18, 40, rng), roofKit(12, 12, 70, rng),
        box(6.6, 0.6, 6.6, 0, 86, 0), cyl(0.15, 0.25, 14, 5, 0, 86, 0),
      ]), 'dark'],
      [shared(box(0.7, 0.7, 0.7, 0, 99.6, 0)), 'beacon'],
    ],
    minD: 40, maxD: 190, scale: [0.8, 1.2], align: true, tint: bldTint,
  };

  // 80s billboards: one atlas, one geometry per ad.
  const atlas = billboardAtlas();
  MATS.billboard = new THREE.MeshStandardMaterial({ map: atlas, emissiveMap: atlas, emissive: 0xffffff, emissiveIntensity: 0.1, roughness: 0.7, side: THREE.DoubleSide });
  const legs = merge([
    cyl(0.18, 0.2, 6, 8, -3.8), cyl(0.18, 0.2, 6, 8, 3.8),
    box(12.4, 0.3, 0.6, 0, 5.6, 0.2), box(12.6, 0.1, 1.0, 0, 5.75, 0.6),
    box(12.6, 0.4, 0.3, 0, 9.6, -0.1),
    box(0.25, 0.25, 0.9, -3, 9.75, 0.35), box(0.25, 0.25, 0.9, 3, 9.75, 0.35),
  ]);
  for (let i = 0; i < ADS.length; i++) {
    const g = new THREE.PlaneGeometry(12, 3.6).translate(0, 7.8, 0);
    const uv = g.attributes.uv;
    for (let k = 0; k < uv.count; k++) uv.setY(k, 1 - (i + 1 - uv.getY(k)) / ADS.length);
    PROPS['billboard' + i] = {
      parts: [[legs, 'dark'], [shared(g), 'billboard']],
      minD: 16, maxD: 60, scale: [0.9, 1.2], faceTraffic: true,
    };
    BILLBOARD.variants.push('billboard' + i);
  }

  // Roadside furniture placed at regular spacing by the world.
  PROPS.fence = {
    parts: [[merge([cyl(0.09, 0.1, 1.15, 6), cone(0.1, 0.12, 6, 0, 1.15), box(0.06, 0.14, 4, 0, 0.45, -2), box(0.06, 0.14, 4, 0, 0.95, -2)]), 'fence']],
    noShadow: true,
  };
  {
    const ins = [];
    for (const x of [-1.4, -0.5, 0.5, 1.4]) ins.push(cyl(0.07, 0.09, 0.28, 6, x, 10.3, 0), cyl(0.11, 0.11, 0.05, 8, x, 10.38, 0), cyl(0.11, 0.11, 0.05, 8, x, 10.48, 0));
    PROPS.powerPole = {
      parts: [
        [merge([
          cyl(0.15, 0.22, 11, 7), box(3.2, 0.2, 0.2, 0, 10.1),
          box(0.07, 1.3, 0.07, 0, 0, 0).rotateZ(0.9).translate(-0.5, 9.4, 0.12), box(0.07, 1.3, 0.07, 0, 0, 0).rotateZ(-0.9).translate(0.5, 9.4, 0.12),
        ]), 'trunk'],
        [merge(ins), 'white'],
      ],
    };
  }
  PROPS.railPost = { parts: [[shared(box(0.14, 0.75, 0.14)), 'metal']], noShadow: true };
  const chev = chevronTexture();
  MATS.sign = new THREE.MeshStandardMaterial({ map: chev, emissiveMap: chev, emissive: 0xffffff, emissiveIntensity: 0.1, roughness: 0.5, side: THREE.DoubleSide });
  for (const dir of [1, -1]) {
    const g = new THREE.PlaneGeometry(1.3, 1.3).translate(0, 1.75, 0.08);
    if (dir < 0) {
      const uv = g.attributes.uv;
      for (let k = 0; k < uv.count; k++) uv.setX(k, 1 - uv.getX(k));
    }
    PROPS[dir > 0 ? 'chevR' : 'chevL'] = { parts: [[shared(box(0.1, 1.2, 0.1)), 'dark'], [shared(g), 'sign']], noShadow: true };
  }
}

// Brightness of emissive scenery follows the night factor.
export function updatePropLights(night, time = 0) {
  MATS.building.emissiveIntensity = 0.06 + night * 0.65;
  MATS.bulb.color.setRGB(0.6 + night * 3.0, 0.5 + night * 2.4, 0.3 + night * 1.4);
  MATS.reflector.color.setRGB(0.9 + night * 2.2, 0.4 + night * 0.9, 0.05);
  MATS.pool.color.setRGB(night * 0.55, night * 0.4, night * 0.2);
  MATS.pool.visible = night > 0.05;
  const blink = Math.sin(time * 3) > 0.6 ? 1 : 0.15;
  MATS.beacon.color.setRGB(0.5 + blink * night * 3, 0.05, 0.05);
  MATS.billboard.emissiveIntensity = 0.12 + night * 0.9;
  MATS.sign.emissiveIntensity = 0.1 + night * 0.5;
}

const ADS = [
  { title: 'SUNSET COLA', sub: 'TASTE THE HORIZON', bg: ['#ff6a00', '#ee0979'], fg: '#fff' },
  { title: 'TURBO TAPES', sub: 'C-90 CHROME · REWIND THE 80s', bg: ['#00c6ff', '#7b2bff'], fg: '#fff' },
  { title: 'NEON FM 88.5', sub: 'SYNTHWAVE ALL NIGHT LONG', bg: ['#1a0033', '#ff00cc'], fg: '#00f0ff' },
  { title: 'RAD ARCADE', sub: 'INSERT COIN · 2 PLAYERS', bg: ['#ffd23f', '#ff3b3b'], fg: '#1a1040' },
  { title: 'CHROME MOTORS', sub: 'BUILT FOR THE LONG ROAD', bg: ['#d7dde8', '#757f9a'], fg: '#b3001b' },
];

function billboardAtlas() {
  const W = 1024;
  const H = 308;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H * ADS.length;
  const g = c.getContext('2d');
  ADS.forEach((ad, i) => {
    const y = i * H;
    const grad = g.createLinearGradient(0, y, W, y + H);
    grad.addColorStop(0, ad.bg[0]);
    grad.addColorStop(1, ad.bg[1]);
    g.fillStyle = grad;
    g.fillRect(0, y, W, H);
    // Retro sun stripes.
    g.fillStyle = 'rgba(255,255,255,0.12)';
    for (let k = 0; k < 6; k++) g.fillRect(0, y + H - 30 - k * 22, W, 8 - k);
    g.strokeStyle = 'rgba(255,255,255,0.85)';
    g.lineWidth = 12;
    g.strokeRect(6, y + 6, W - 12, H - 12);
    g.textAlign = 'center';
    g.fillStyle = ad.fg;
    g.shadowColor = 'rgba(0,0,0,0.35)';
    g.shadowBlur = 10;
    g.font = 'italic 900 120px Orbitron, "Arial Black", sans-serif';
    g.fillText(ad.title, W / 2, y + 160, W - 60);
    g.font = '700 40px Orbitron, "Arial Black", sans-serif';
    g.fillText(ad.sub, W / 2, y + 240, W - 80);
    g.shadowBlur = 0;
  });
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

function chevronTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  g.fillStyle = '#ffd200';
  g.fillRect(0, 0, 128, 128);
  g.fillStyle = '#111';
  g.beginPath();
  g.moveTo(34, 14);
  g.lineTo(62, 14);
  g.lineTo(100, 64);
  g.lineTo(62, 114);
  g.lineTo(34, 114);
  g.lineTo(72, 64);
  g.closePath();
  g.fill();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function radialTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.5, 'rgba(255,255,255,0.45)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
