import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { HALF_W, LANES } from './track.js';
import { clamp, hash2, lerp, mulberry32, smoothstep } from './math.js';

// Set pieces along the road: tunnels, bridges, rock arches, torii avenues,
// overpasses, roadworks, villages and warning signs. The world calls
// buildFeatures() once per 100 m chunk; each piece is only built in the chunk
// that owns its anchor distance, so nothing is duplicated.

const TUBE_W = HALF_W + 2; // tunnel inner half width
const TUBE_SPRING = 4.8; // where the walls start to curve
const TUBE_TOP = 8.6; // inner crown height
const PORTAL_W = HALF_W + 14;
const PORTAL_H = 24;
const KERB = HALF_W + 1.3;

let M = null;
const G = {};
const signCache = new Map();
const plateCache = new Map();

const tmpF = {};
const _p = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _s = new THREE.Vector3();
const _c = new THREE.Color();

// ---------- small helpers ----------

const shared = (g) => ((g.userData.shared = true), g);

function colored(geo, hex) {
  const g = geo.index ? geo.toNonIndexed() : geo;
  _c.setHex(hex);
  const n = g.attributes.position.count;
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) arr.set([_c.r, _c.g, _c.b], i * 3);
  g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return g;
}
const mergeShared = (list) => shared(mergeGeometries(list.map((g) => (g.index ? g.toNonIndexed() : g))));
const box = (w, h, d, x = 0, y = 0, z = 0) => new THREE.BoxGeometry(w, h, d).translate(x, y + h / 2, z);
const cyl = (rt, rb, h, seg, x = 0, y = 0, z = 0) => new THREE.CylinderGeometry(rt, rb, h, seg).translate(x, y + h / 2, z);

function canvasTex(w, h, draw, repeat = false) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

function noiseFill(g, w, h, base, spread, count, size, rng) {
  g.fillStyle = base;
  g.fillRect(0, 0, w, h);
  for (let i = 0; i < count; i++) {
    const v = (rng() - 0.5) * spread;
    g.fillStyle = v > 0 ? `rgba(255,255,255,${v})` : `rgba(0,0,0,${-v})`;
    g.fillRect(rng() * w, rng() * h, size * (0.5 + rng()), size * (0.5 + rng()));
  }
}

// World matrix for an object at lateral offset d and height y above the road.
function frameMatrix(T, f, d, y, yaw = 0, sx = 1, sy = 1, sz = 1) {
  _p.set(f.x + f.cos * d, T.roadY(f, d) + y, f.z + f.sin * d);
  _q.setFromEuler(_e.set(0, -f.h + yaw, 0));
  _s.set(sx, sy, sz);
  return new THREE.Matrix4().compose(_p, _q, _s);
}

function instanced(geo, mat, matrices, colors = null, shadow = true) {
  if (!matrices.length) return null;
  const mesh = new THREE.InstancedMesh(geo, mat, matrices.length);
  matrices.forEach((m, i) => mesh.setMatrixAt(i, m));
  if (colors) colors.forEach((c, i) => mesh.setColorAt(i, _c.setHex(c)));
  mesh.castShadow = shadow;
  mesh.receiveShadow = true;
  mesh.computeBoundingSphere();
  return mesh;
}

// Group placed on the road at distance s, local +X = right, -Z = forward.
function anchorGroup(T, s, d = 0, yaw = 0, yOverride = null) {
  const f = T.frame(s, {});
  const g = new THREE.Group();
  g.position.set(f.x + f.cos * d, yOverride ?? T.roadY(f, d), f.z + f.sin * d);
  g.rotation.y = -f.h + yaw;
  return { g, f };
}

// Sweep a cross-section profile ([d, y] pairs, left to right) along the road.
function sweep(T, sA, sB, profile, { yFn = null, step = 2, closed = false, uScale = 0.25, vScale = 0.25 } = {}) {
  const n = Math.max(2, Math.ceil((sB - sA) / step) + 1);
  const pts = closed ? profile.concat([profile[0]]) : profile;
  const m = pts.length;
  const lens = [0];
  for (let j = 1; j < m; j++) lens.push(lens[j - 1] + Math.hypot(pts[j][0] - pts[j - 1][0], pts[j][1] - pts[j - 1][1]));
  const pos = new Float32Array(n * m * 3);
  const uv = new Float32Array(n * m * 2);
  for (let i = 0; i < n; i++) {
    const s = sA + ((sB - sA) * i) / (n - 1);
    const f = T.frame(s, tmpF);
    const yo = yFn ? yFn(s) : 0;
    for (let j = 0; j < m; j++) {
      const [d, y] = pts[j];
      const k = i * m + j;
      pos[k * 3] = f.x + f.cos * d;
      pos[k * 3 + 1] = T.roadY(f, d) + y + yo;
      pos[k * 3 + 2] = f.z + f.sin * d;
      uv[k * 2] = lens[j] * uScale;
      uv[k * 2 + 1] = s * vScale;
    }
  }
  const idx = [];
  for (let i = 0; i < n - 1; i++) {
    for (let j = 0; j < m - 1; j++) {
      const a = i * m + j;
      const b = a + 1;
      const c = a + m;
      const d = c + 1;
      idx.push(a, b, c, b, d, c);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  return geo;
}

// Rectangle cross-section with duplicated corners so edges stay sharp.
function rect(d0, d1, y0, y1) {
  return [[d0, y0], [d1, y0], [d1, y0], [d1, y1], [d1, y1], [d0, y1], [d0, y1], [d0, y0]];
}

function sweepMesh(group, T, sA, sB, profile, mat, opts = {}) {
  if (sB - sA < 0.05) return null;
  const mesh = new THREE.Mesh(sweep(T, sA, sB, profile, opts), mat);
  mesh.castShadow = opts.shadow !== false;
  mesh.receiveShadow = true;
  group.add(mesh);
  return mesh;
}

// Points of a tunnel-shaped arch from (-w, bottom) up, over and down to (w, bottom).
function archPoints(w, spring, top, bottom, n = 18) {
  const pts = [[-w, bottom], [-w, spring]];
  for (let i = 1; i < n; i++) {
    const a = Math.PI - (i / n) * Math.PI;
    pts.push([Math.cos(a) * w, spring + Math.sin(a) * (top - spring)]);
  }
  pts.push([w, spring], [w, bottom]);
  return pts;
}

function radialTexture() {
  return canvasTex(128, 128, (g) => {
    const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    grad.addColorStop(0, 'rgba(255,255,255,1)');
    grad.addColorStop(0.5, 'rgba(255,255,255,0.4)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, 128, 128);
  });
}

// ---------- materials ----------

function init() {
  if (M) return;
  const rng = mulberry32(1987);
  const rockTex = canvasTex(256, 256, (g, w, h) => {
    noiseFill(g, w, h, '#77706a', 0.25, 2600, 6, rng);
    g.strokeStyle = 'rgba(30,25,20,0.45)';
    g.lineWidth = 2;
    for (let i = 0; i < 14; i++) {
      g.beginPath();
      let x = rng() * w;
      let y = rng() * h;
      g.moveTo(x, y);
      for (let k = 0; k < 5; k++) g.lineTo((x += (rng() - 0.5) * 50), (y += rng() * 30));
      g.stroke();
    }
  }, true);
  const panelTex = canvasTex(256, 256, (g, w, h) => {
    noiseFill(g, w, h, '#cfd4dc', 0.12, 1500, 4, rng);
    g.fillStyle = 'rgba(40,50,70,0.35)';
    for (let k = 0; k <= 4; k++) {
      g.fillRect(0, k * 64 - 2, w, 4);
      g.fillRect(k * 64 - 2, 0, 4, h);
    }
  }, true);
  const neonTex = canvasTex(256, 256, (g, w, h) => {
    g.fillStyle = '#16142e';
    g.fillRect(0, 0, w, h);
    g.strokeStyle = '#2f2a66';
    g.lineWidth = 3;
    for (let k = 0; k <= 8; k++) {
      g.beginPath();
      g.moveTo(0, k * 32);
      g.lineTo(w, k * 32);
      g.moveTo(k * 32, 0);
      g.lineTo(k * 32, h);
      g.stroke();
    }
  }, true);
  const hazardTex = canvasTex(128, 32, (g, w, h) => {
    g.fillStyle = '#ffcc00';
    g.fillRect(0, 0, w, h);
    g.fillStyle = '#111';
    for (let x = -h; x < w + h; x += 32) {
      g.beginPath();
      g.moveTo(x, 0);
      g.lineTo(x + 16, 0);
      g.lineTo(x + 16 - h, h);
      g.lineTo(x - h, h);
      g.fill();
    }
  }, true);
  const concreteTex = canvasTex(256, 256, (g, w, h) => {
    noiseFill(g, w, h, '#bdb8ae', 0.15, 1800, 5, rng);
    g.fillStyle = 'rgba(0,0,0,0.12)';
    for (let y = 0; y < h; y += 64) g.fillRect(0, y, w, 2);
  }, true);
  const stoneTex = canvasTex(256, 256, (g, w, h) => {
    g.fillStyle = '#a88f6e';
    g.fillRect(0, 0, w, h);
    const bh = 32;
    for (let r = 0; r < h / bh; r++) {
      const off = (r % 2) * 32;
      for (let x = -off; x < w; x += 64) {
        const v = 180 + Math.floor(rng() * 50);
        g.fillStyle = `rgb(${v},${v - 22},${v - 52})`;
        g.fillRect(x + 2, r * bh + 2, 60, bh - 4);
      }
    }
  }, true);
  stoneTex.repeat.set(0.25, 0.25);
  const pool = radialTexture();

  const steel = (color) => new THREE.MeshStandardMaterial({ color, metalness: 0.35, roughness: 0.45 });
  M = {
    vc: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.7, metalness: 0.05 }),
    vcFlat: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, flatShading: true }),
    tint: new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.6 }),
    rockTint: new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, flatShading: true }),
    tunnel: {
      rock: new THREE.MeshStandardMaterial({ map: rockTex, roughness: 0.95, side: THREE.DoubleSide }),
      snow: new THREE.MeshStandardMaterial({ map: panelTex, roughness: 0.7, side: THREE.DoubleSide }),
      neon: new THREE.MeshStandardMaterial({ map: neonTex, roughness: 0.5, metalness: 0.3, side: THREE.DoubleSide }),
    },
    portal: {
      rock: new THREE.MeshStandardMaterial({ map: rockTex, color: 0xfff2e0, roughness: 1, emissive: 0x2a2420 }),
      snow: new THREE.MeshStandardMaterial({ map: concreteTex, color: 0xe8ecf2, roughness: 0.9 }),
      neon: new THREE.MeshStandardMaterial({ map: neonTex, color: 0xffffff, roughness: 0.6, metalness: 0.2 }),
    },
    frame: {
      rock: new THREE.MeshStandardMaterial({ color: 0xb8a48a, roughness: 0.9 }),
      snow: new THREE.MeshStandardMaterial({ color: 0x8a96a8, roughness: 0.7 }),
      neon: new THREE.MeshStandardMaterial({ color: 0x0c0c18, roughness: 0.4, metalness: 0.6 }),
    },
    snowCap: new THREE.MeshStandardMaterial({ color: 0xf8fbff, roughness: 0.9 }),
    walkway: new THREE.MeshStandardMaterial({ color: 0x8e8b86, roughness: 0.95 }),
    hazard: new THREE.MeshStandardMaterial({ map: hazardTex, roughness: 0.6, side: THREE.DoubleSide }),
    concrete: new THREE.MeshStandardMaterial({ map: concreteTex, roughness: 0.9 }),
    stone: new THREE.MeshStandardMaterial({ map: stoneTex, roughness: 0.95, side: THREE.DoubleSide }),
    rail: new THREE.MeshStandardMaterial({ color: 0xd4dae2, metalness: 0.75, roughness: 0.3, side: THREE.DoubleSide }),
    steel: { suspension: steel(0xc0362c), arch: steel(0x2f9bd8), girder: steel(0x3fae5a), stone: steel(0x8a8f99) },
    dark: new THREE.MeshStandardMaterial({ color: 0x24262e, metalness: 0.5, roughness: 0.5 }),
    water: new THREE.MeshStandardMaterial({ color: 0x1d8fb3, roughness: 0.06, metalness: 0.25 }),
    lamp: new THREE.MeshBasicMaterial({ color: new THREE.Color(2.6, 1.45, 0.5) }),
    neonC: new THREE.MeshBasicMaterial({ color: new THREE.Color(0.2, 1.8, 2.3), side: THREE.DoubleSide }),
    neonP: new THREE.MeshBasicMaterial({ color: new THREE.Color(2.3, 0.25, 1.8), side: THREE.DoubleSide }),
    pool: new THREE.MeshBasicMaterial({ map: pool, color: new THREE.Color(0.4, 0.26, 0.1), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3 }),
    poolC: new THREE.MeshBasicMaterial({ map: pool, color: new THREE.Color(0.05, 0.3, 0.4), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3 }),
    poolP: new THREE.MeshBasicMaterial({ map: pool, color: new THREE.Color(0.4, 0.05, 0.32), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3 }),
    lantern: new THREE.MeshBasicMaterial({ color: new THREE.Color(1, 0.75, 0.4) }),
    beacon: new THREE.MeshBasicMaterial({ color: new THREE.Color(2.5, 1.4, 0.1) }),
    aviation: new THREE.MeshBasicMaterial({ color: new THREE.Color(2.5, 0.1, 0.05) }),
    windows: new THREE.MeshBasicMaterial({ color: new THREE.Color(1, 0.8, 0.45) }),
    necklace: new THREE.MeshBasicMaterial({ color: new THREE.Color(1, 0.9, 0.7) }),
    bridgeLamp: new THREE.MeshBasicMaterial({ color: new THREE.Color(1, 0.8, 0.5) }),
    bridgePool: new THREE.MeshBasicMaterial({ map: pool, color: new THREE.Color(0, 0, 0), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3 }),
  };
  const arrow = (dir) =>
    canvasTex(256, 160, (g, w, h) => {
      g.fillStyle = '#000';
      g.fillRect(0, 0, w, h);
      g.fillStyle = '#ffb000';
      const dots = [];
      for (let x = 30; x <= 170; x += 20) dots.push([x, 80]);
      for (let k = 1; k <= 4; k++) dots.push([170 - k * 20, 80 - k * 16], [170 - k * 20, 80 + k * 16]);
      dots.push([190, 80]);
      for (const [x, y] of dots) {
        g.beginPath();
        g.arc(dir > 0 ? x + 20 : w - x - 20, y, 7, 0, Math.PI * 2);
        g.fill();
      }
    });
  M.arrowR = new THREE.MeshStandardMaterial({ color: 0x111111, emissiveMap: arrow(1), emissive: 0xffffff, emissiveIntensity: 2 });
  M.arrowL = new THREE.MeshStandardMaterial({ color: 0x111111, emissiveMap: arrow(-1), emissive: 0xffffff, emissiveIntensity: 2 });
  initGeometry();
}

// ---------- shared geometry ----------

function initGeometry() {
  // Tunnel portal: a U-shaped wall around the opening, a frame ring and a cornice.
  const wallPts = [[-PORTAL_W, -3], [-TUBE_W, -3]]
    .concat(archPoints(TUBE_W, TUBE_SPRING, TUBE_TOP, -1))
    .concat([[TUBE_W, -3], [PORTAL_W, -3], [PORTAL_W, PORTAL_H], [-PORTAL_W, PORTAL_H]]);
  G.portalWall = shared(
    new THREE.ExtrudeGeometry(new THREE.Shape(wallPts.map(([x, y]) => new THREE.Vector2(x, y))), { depth: 3, bevelEnabled: false }).translate(0, 0, -1.5),
  );
  G.portalWall.attributes.uv.array.forEach((v, i, a) => (a[i] = v * 0.12));
  const ring = (inner, width, depth) => {
    const outer = archPoints(TUBE_W + inner + width, TUBE_SPRING, TUBE_TOP + inner + width, -1);
    const innerPts = archPoints(TUBE_W + inner, TUBE_SPRING, TUBE_TOP + inner, -1).reverse();
    return shared(
      new THREE.ExtrudeGeometry(new THREE.Shape(outer.concat(innerPts).map(([x, y]) => new THREE.Vector2(x, y))), { depth, bevelEnabled: false }).translate(0, 0, -depth / 2),
    );
  };
  G.portalRing = ring(0, 1.6, 3.6);
  G.neonRing = ring(1.6, 0.35, 3.8);
  G.cornice = shared(box(PORTAL_W * 2 + 1, 1.3, 4.2, 0, PORTAL_H));
  G.snowCap = shared(box(PORTAL_W * 2 + 2, 1.5, 5, 0, PORTAL_H + 1.1));
  G.plate = shared(new THREE.PlaneGeometry(10, 2.4));

  // Tunnel lights and road pools.
  G.lampBox = shared(box(0.5, 0.18, 1.8));
  G.poolPlane = shared(new THREE.PlaneGeometry(15, 15).rotateX(-Math.PI / 2));

  // Bridge bits.
  G.unitBox = shared(new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0));
  G.post = shared(box(0.12, 1.1, 0.12));
  G.hanger = shared(new THREE.BoxGeometry(0.14, 1, 0.14).translate(0, 0.5, 0));
  G.bulb = shared(new THREE.SphereGeometry(0.32, 8, 6));
  G.lampPost = shared(mergeGeometries([cyl(0.09, 0.12, 6.5, 6), box(1.6, 0.1, 0.1, -0.75, 6.4)]));
  G.lampHead = shared(box(0.7, 0.16, 0.36, -1.45, 6.28));
  G.lampPool = shared(new THREE.PlaneGeometry(8, 8).rotateX(-Math.PI / 2).translate(-2.6, 0.12, 0));

  // Torii gate (vermilion and black) and stone lanterns.
  const R = 0xe0402a;
  const B = 0x1d1a1a;
  const px = HALF_W + 2.2;
  const toriiParts = [];
  for (const sx of [-1, 1]) {
    toriiParts.push(colored(cyl(0.5, 0.58, 10.6, 14, sx * px, 0.6), R));
    toriiParts.push(colored(cyl(0.78, 0.82, 0.9, 14, sx * px), B));
    toriiParts.push(colored(new THREE.BoxGeometry(3.4, 0.8, 1.3).rotateZ(sx * 0.22).translate(sx * 13.4, 12.0, 0), B));
  }
  toriiParts.push(colored(box(px * 2 + 3.4, 0.7, 0.55, 0, 8.3), R));
  toriiParts.push(colored(box(0.7, 1.8, 0.5, 0, 9.0), R));
  toriiParts.push(colored(box(1.6, 1.4, 0.2, 0, 9.2, 0.36), B));
  toriiParts.push(colored(box(px * 2 + 4.6, 0.6, 1.0, 0, 10.7), R));
  toriiParts.push(colored(box(px * 2 + 5.6, 0.75, 1.35, 0, 11.3), B));
  G.torii = mergeShared(toriiParts);
  const S = 0x9a968e;
  G.toro = mergeShared([
    colored(box(1.5, 0.4, 1.5), S),
    colored(cyl(0.28, 0.32, 1.6, 8, 0, 0.4), S),
    colored(box(1.15, 0.25, 1.15, 0, 2.0), S),
    colored(new THREE.ConeGeometry(1.15, 0.8, 4).rotateY(Math.PI / 4).translate(0, 3.35, 0), S),
    colored(new THREE.SphereGeometry(0.2, 8, 6).translate(0, 3.85, 0), S),
  ]);
  G.toroLight = shared(box(0.62, 0.7, 0.62, 0, 2.25));

  // Roadworks.
  G.cone = mergeShared([
    colored(box(0.52, 0.06, 0.52), 0x161616),
    colored(cyl(0.04, 0.22, 0.75, 12, 0, 0.06), 0xff5a10),
    colored(cyl(0.125, 0.16, 0.17, 12, 0, 0.26), 0xffffff),
  ]);
  G.barrier = shared(mergeGeometries([box(1.9, 0.6, 0.6), box(1.9, 0.3, 0.36, 0, 0.6)]));
  G.beacon = shared(box(0.22, 0.2, 0.22));

  // Gorge boulder.
  const rock = new THREE.DodecahedronGeometry(1, 1);
  const pr = rock.attributes.position;
  for (let i = 0; i < pr.count; i++) {
    const k = 0.75 + hash2(Math.round(pr.getX(i) * 50), Math.round(pr.getY(i) * 50 + pr.getZ(i) * 31)) * 0.45;
    pr.setXYZ(i, pr.getX(i) * k, pr.getY(i) * k * 0.8, pr.getZ(i) * k);
  }
  rock.computeVertexNormals();
  G.boulder = shared(rock);

  G.rockArch = buildRockArch();
}

// A sandstone arch: extruded outline, jittered for a weathered look, banded strata.
function buildRockArch() {
  const outer = [[-26, -12], [-24, 4], [-22.5, 14], [-19, 22], [-13, 27], [-5, 29.5], [4, 29], [12, 27.5], [18.5, 23], [22.5, 14], [24.5, 2], [26, -12]];
  const inner = [[13.5, -12], [13.5, 3], [12.6, 8], [10.5, 12.2], [7.5, 15.2], [3.8, 16.9], [0, 17.4], [-3.8, 16.9], [-7.5, 15.2], [-10.5, 12.2], [-12.6, 8], [-13.5, 3], [-13.5, -12]];
  const dense = (pts) => {
    const out = [];
    for (let i = 0; i < pts.length - 1; i++) {
      const [x0, y0] = pts[i];
      const [x1, y1] = pts[i + 1];
      const n = Math.max(1, Math.round(Math.hypot(x1 - x0, y1 - y0) / 2.2));
      for (let k = 0; k < n; k++) out.push([x0 + ((x1 - x0) * k) / n, y0 + ((y1 - y0) * k) / n]);
    }
    out.push(pts[pts.length - 1]);
    return out;
  };
  const contour = dense(outer).concat(dense(inner));
  let geo = new THREE.ExtrudeGeometry(new THREE.Shape(contour.map(([x, y]) => new THREE.Vector2(x, y))), { depth: 13, steps: 5, bevelEnabled: false });
  geo.translate(0, 0, -6.5);
  geo = geo.index ? geo.toNonIndexed() : geo;
  const p = geo.attributes.position;
  const col = new Float32Array(p.count * 3);
  const a = new THREE.Color(0xc2552d);
  const b = new THREE.Color(0xeb9a52);
  const c = new THREE.Color();
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i);
    const y = p.getY(i);
    const z = p.getZ(i);
    const n = (hash2(Math.round(x * 3), Math.round(y * 3 + z * 7)) - 0.5) * 2.2;
    const inside = Math.abs(x) < 15 && y < 18.5;
    const dx = inside && Math.abs(x) > 12 ? Math.abs(n) * Math.sign(x) : n;
    p.setXYZ(i, x + dx * 0.6, y + (inside && y > 15 ? Math.abs(n) * 0.5 : n * 0.6), z + n * 0.5);
    c.copy(a).lerp(b, 0.5 + 0.5 * Math.sin(y * 0.8 + n * 0.3));
    if (y > 24) c.lerp(new THREE.Color(0xf2c27a), 0.4);
    col.set([c.r, c.g, c.b], i * 3);
  }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geo.computeVertexNormals();
  return shared(geo);
}

// ---------- textures for signs & plates ----------

function plateMaterial(text, style) {
  const key = style + text;
  if (plateCache.has(key)) return plateCache.get(key);
  const neon = style === 'neon';
  const t = canvasTex(512, 128, (g, w, h) => {
    g.fillStyle = neon ? '#0a0614' : style === 'snow' ? '#1e4fa8' : '#f2efe6';
    g.fillRect(0, 0, w, h);
    g.strokeStyle = neon ? '#ff2bd6' : style === 'snow' ? '#ffffff' : '#222';
    g.lineWidth = 8;
    g.strokeRect(6, 6, w - 12, h - 12);
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.font = '900 60px Orbitron, "Arial Black", sans-serif';
    g.fillStyle = neon ? '#00f0ff' : style === 'snow' ? '#ffffff' : '#1a1a1a';
    if (neon) {
      g.shadowColor = '#00f0ff';
      g.shadowBlur = 18;
    }
    g.fillText(text, w / 2, h / 2 + 3, w - 40);
  });
  const mat = new THREE.MeshBasicMaterial({ map: t, color: neon ? new THREE.Color(1.6, 1.6, 1.6) : new THREE.Color(0.9, 0.9, 0.9) });
  plateCache.set(key, mat);
  return mat;
}

function drawPictogram(g, kind) {
  g.fillStyle = '#111';
  g.strokeStyle = '#111';
  g.lineWidth = 10;
  g.lineCap = 'round';
  if (kind === 'tunnel') {
    g.beginPath();
    g.moveTo(78, 168);
    g.lineTo(78, 120);
    g.arc(128, 120, 50, Math.PI, 0);
    g.lineTo(178, 168);
    g.closePath();
    g.fill();
    g.fillStyle = '#ffd200';
    g.beginPath();
    g.moveTo(104, 168);
    g.lineTo(104, 128);
    g.arc(128, 128, 24, Math.PI, 0);
    g.lineTo(152, 168);
    g.fill();
  } else if (kind === 'bridge') {
    g.fillRect(66, 132, 124, 10);
    g.beginPath();
    g.moveTo(66, 132);
    g.quadraticCurveTo(128, 62, 190, 132);
    g.stroke();
    for (const x of [90, 128, 166]) g.fillRect(x - 3, 96 + Math.abs(x - 128) * 0.6, 6, 36 - Math.abs(x - 128) * 0.6);
    g.beginPath();
    for (let x = 70; x < 190; x += 24) {
      g.moveTo(x, 166);
      g.quadraticCurveTo(x + 6, 158, x + 12, 166);
      g.quadraticCurveTo(x + 18, 174, x + 24, 166);
    }
    g.lineWidth = 5;
    g.stroke();
  } else if (kind === 'works') {
    g.beginPath();
    g.arc(118, 78, 12, 0, Math.PI * 2);
    g.fill();
    g.beginPath();
    g.moveTo(116, 94);
    g.lineTo(104, 134);
    g.lineTo(90, 168);
    g.moveTo(104, 134);
    g.lineTo(124, 168);
    g.moveTo(112, 104);
    g.lineTo(148, 124);
    g.moveTo(148, 108);
    g.lineTo(156, 160);
    g.stroke();
    g.beginPath();
    g.moveTo(140, 168);
    g.quadraticCurveTo(168, 136, 190, 168);
    g.fill();
  } else if (kind === 'gorge') {
    g.beginPath();
    g.moveTo(70, 172);
    g.lineTo(70, 70);
    g.lineTo(110, 92);
    g.lineTo(100, 172);
    g.fill();
    for (const [x, y, r] of [[136, 96, 12], [160, 128, 10], [146, 158, 14], [176, 160, 8]]) {
      g.beginPath();
      g.arc(x, y, r, 0, Math.PI * 2);
      g.fill();
    }
  } else {
    // curve: bent arrow
    g.lineWidth = 16;
    g.beginPath();
    g.moveTo(108, 172);
    g.lineTo(108, 120);
    g.quadraticCurveTo(108, 92, 140, 88);
    g.stroke();
    g.beginPath();
    g.moveTo(170, 88);
    g.lineTo(134, 62);
    g.lineTo(134, 114);
    g.closePath();
    g.fill();
  }
}

function signMaterial(kind, text) {
  const key = kind + '|' + (text || '');
  if (signCache.has(key)) return signCache.get(key);
  let t;
  if (kind === 'village') {
    t = canvasTex(512, 256, (g, w, h) => {
      g.fillStyle = '#1f5fa8';
      g.fillRect(0, 0, w, h);
      g.strokeStyle = '#fff';
      g.lineWidth = 10;
      g.strokeRect(10, 10, w - 20, h - 20);
      g.fillStyle = '#fff';
      g.textAlign = 'center';
      g.font = '700 34px Orbitron, "Arial Black", sans-serif';
      g.fillText('WELCOME TO', w / 2, 80);
      g.font = '900 58px Orbitron, "Arial Black", sans-serif';
      g.fillText((text || 'SUNNYVALE').toUpperCase(), w / 2, 150, w - 50);
      g.font = '700 26px Orbitron, "Arial Black", sans-serif';
      g.fillText('POP. 1987 · DRIVE SAFELY', w / 2, 208);
    });
  } else {
    t = canvasTex(256, 336, (g) => {
      const orange = kind === 'works';
      g.save();
      g.translate(128, 128);
      g.rotate(Math.PI / 4);
      g.fillStyle = '#111';
      g.fillRect(-88, -88, 176, 176);
      g.fillStyle = orange ? '#ff8a00' : '#ffd200';
      g.fillRect(-80, -80, 160, 160);
      g.restore();
      drawPictogram(g, kind);
      if (text) {
        g.fillStyle = '#fff';
        g.fillRect(14, 262, 228, 66);
        g.strokeStyle = '#111';
        g.lineWidth = 5;
        g.strokeRect(14, 262, 228, 66);
        g.fillStyle = '#111';
        g.textAlign = 'center';
        g.textBaseline = 'middle';
        g.font = '900 34px Orbitron, "Arial Black", sans-serif';
        g.fillText(text.toUpperCase(), 128, 296, 214);
      }
    });
  }
  const mat = new THREE.MeshStandardMaterial({ map: t, transparent: true, alphaTest: 0.5, side: THREE.DoubleSide, emissiveMap: t, emissive: 0xffffff, emissiveIntensity: 0.12, roughness: 0.5 });
  signCache.set(key, mat);
  return mat;
}

// ---------- builders ----------

const TUNNEL_NAMES = {
  rock: ['GALLERIA 1987', 'SAN BERNARDO', 'TÚNEL DEL SOL', 'GALLERIA VERDE'],
  snow: ['FROSTBITE PASS', 'GLETSCHER TUNNEL', 'ICE GATE', 'COL DU NORD'],
  neon: ['NEON TUNNEL', 'LASER TUBE 2000', 'CHROME TUNNEL', 'HYPERDRIVE'],
};

function buildTunnel(group, T, ft, c) {
  const style = TUNNEL_NAMES[ft.style] ? ft.style : 'rock';
  const a = Math.max(c.s0, ft.s0);
  const b = Math.min(c.s1, ft.s1);
  if (b - a > 0.05) {
    sweepMesh(group, T, a, b, archPoints(TUBE_W, TUBE_SPRING, TUBE_TOP, -0.3), M.tunnel[style]);
    for (const side of [-1, 1]) {
      const inner = side * KERB;
      const outer = side * (TUBE_W + 0.05);
      const prof = side < 0 ? rect(outer, inner, -0.2, 0.42) : rect(inner, outer, -0.2, 0.42);
      sweepMesh(group, T, a, b, prof, M.walkway, { shadow: false });
      const w = side * (TUBE_W - 0.02);
      sweepMesh(group, T, a, b, [[w, 0.42], [w, 1.25]], M.hazard, { shadow: false, uScale: 1, vScale: 0.5 });
      if (style === 'neon') {
        const wn = side * (TUBE_W - 0.04);
        sweepMesh(group, T, a, b, [[wn, 3.6], [wn, 3.9]], side < 0 ? M.neonC : M.neonP, { shadow: false });
      }
    }
    const lamps = [];
    const pools = [];
    const poolsAlt = [];
    for (let s = Math.ceil(a / 18) * 18; s < b; s += 18) {
      const f = T.frame(s, tmpF);
      const alt = Math.round(s / 18) % 2 === 0;
      if (style === 'neon') {
        sweepMesh(group, T, s, s + 0.7, archPoints(TUBE_W - 0.08, TUBE_SPRING, TUBE_TOP - 0.08, 1.3), alt ? M.neonC : M.neonP, { shadow: false, step: 0.7 });
        (alt ? poolsAlt : pools).push(frameMatrix(T, f, 0, 0.1));
      } else {
        for (const d of [-2.6, 2.6]) lamps.push(frameMatrix(T, f, d, TUBE_TOP - 0.55));
        pools.push(frameMatrix(T, f, 0, 0.1));
      }
    }
    const lm = instanced(G.lampBox, M.lamp, lamps, null, false);
    if (lm) group.add(lm);
    const pm = instanced(G.poolPlane, style === 'neon' ? M.poolP : M.pool, pools, null, false);
    if (pm) group.add(pm);
    const pa = instanced(G.poolPlane, M.poolC, poolsAlt, null, false);
    if (pa) group.add(pa);
  }
  const names = TUNNEL_NAMES[style];
  const name = names[Math.floor(hash2(Math.round(ft.s0), 3) * names.length) % names.length];
  for (const [sp, exit] of [[ft.s0, false], [ft.s1, true]]) {
    if (sp < c.s0 || sp >= c.s1) continue;
    const { g } = anchorGroup(T, sp, 0, exit ? Math.PI : 0);
    const wall = new THREE.Mesh(G.portalWall, M.portal[style]);
    const ring = new THREE.Mesh(G.portalRing, M.frame[style]);
    const cornice = new THREE.Mesh(G.cornice, M.frame[style]);
    for (const m of [wall, ring, cornice]) {
      m.castShadow = true;
      m.receiveShadow = true;
      g.add(m);
    }
    if (style === 'snow') g.add(new THREE.Mesh(G.snowCap, M.snowCap));
    if (style === 'neon') g.add(new THREE.Mesh(G.neonRing, M.neonP));
    const plate = new THREE.Mesh(G.plate, plateMaterial(name, style));
    plate.position.set(0, TUBE_TOP + 4.2, 1.85);
    g.add(plate);
    group.add(g);
  }
}

// Height of the ground under the bridge (never above the deck bottom).
function groundBelow(f, d, ctx, fallback) {
  const h = ctx.heightAt ? ctx.heightAt(f, d) : fallback;
  return Math.min(h, f.y - 3);
}

function buildBridge(group, T, ft, c, ctx) {
  const style = ft.style || 'girder';
  const L = ft.s1 - ft.s0;
  const depth = ft.depth ?? 30;
  const a = Math.max(c.s0, ft.s0);
  const b = Math.min(c.s1, ft.s1);
  const inChunk = (s) => s >= c.s0 && s < c.s1;
  const steel = M.steel[style] || M.steel.girder;
  const deckW = HALF_W + 2.5;

  if (b - a > 0.05) {
    // Deck slab and sidewalks.
    sweepMesh(group, T, a, b, rect(-deckW, deckW, -1.7, -0.03), M.concrete);
    for (const side of [-1, 1]) {
      const p = side < 0 ? rect(-deckW, -KERB, -0.1, 0.25) : rect(KERB, deckW, -0.1, 0.25);
      sweepMesh(group, T, a, b, p, M.walkway, { shadow: false });
    }
    // Railings.
    if (style === 'stone') {
      for (const side of [-1, 1]) {
        const d0 = side * (deckW - 0.7);
        const d1 = side * deckW;
        sweepMesh(group, T, a, b, side < 0 ? rect(d1, d0, 0.2, 1.2) : rect(d0, d1, 0.2, 1.2), M.stone);
        const c0 = side * (deckW - 0.85);
        const c1 = side * (deckW + 0.15);
        sweepMesh(group, T, a, b, side < 0 ? rect(c1, c0, 1.2, 1.45) : rect(c0, c1, 1.2, 1.45), M.stone);
      }
    } else {
      const posts = [];
      for (const side of [-1, 1]) {
        const d = side * (deckW - 0.3);
        for (const y of [0.62, 1.12]) sweepMesh(group, T, a, b, rect(d - 0.07, d + 0.07, y - 0.06, y + 0.06), M.rail, { shadow: false });
        for (let s = Math.ceil(a / 2.5) * 2.5; s < b; s += 2.5) posts.push(frameMatrix(T, T.frame(s, tmpF), d, 0.2));
      }
      const pm = instanced(G.post, M.rail, posts, null, false);
      if (pm) group.add(pm);
    }
  }

  // Street lamps along the deck, lit at night.
  if (b - a > 0.05) {
    const posts = [];
    for (let s = Math.ceil(a / 30) * 30; s < b; s += 30) {
      if (s < ft.s0 + 10 || s > ft.s1 - 10) continue;
      const f = T.frame(s, tmpF);
      const side = Math.round(s / 30) % 2 ? 1 : -1;
      posts.push(frameMatrix(T, f, side * (deckW - 0.6), 0.2, side < 0 ? Math.PI : 0));
    }
    for (const [geo, mat, sh] of [[G.lampPost, M.dark, true], [G.lampHead, M.bridgeLamp, false], [G.lampPool, M.bridgePool, false]]) {
      const lm = instanced(geo, mat, posts, null, sh);
      if (lm) group.add(lm);
    }
  }

  // Concrete pillars (not under a suspension main span or a steel arch).
  const t1 = ft.s0 + 0.25 * L;
  const t2 = ft.s0 + 0.75 * L;
  const a0 = ft.s0 + 0.12 * L;
  const a1 = ft.s1 - 0.12 * L;
  if (style !== 'stone') {
    for (let s = ft.s0 + 20; s <= ft.s1 - 20; s += 40) {
      if (!inChunk(s)) continue;
      if (style === 'suspension' && s > t1 - 8 && s < t2 + 8) continue;
      if (style === 'arch' && s > a0 - 8 && s < a1 + 8) continue;
      const f = T.frame(s, {});
      const cols = [];
      for (const d of [-4.6, 4.6]) {
        const bottom = groundBelow(f, d, ctx, f.y - depth) - 5;
        const h = T.roadY(f, d) - 1.7 - bottom;
        cols.push(frameMatrix(T, f, d, -1.7 - h, 0, 2.4, h, 2.4));
      }
      cols.push(frameMatrix(T, f, 0, -3.1, 0, deckW * 2 - 1, 1.4, 2.8));
      const pm = instanced(G.unitBox, M.concrete, cols);
      group.add(pm);
    }
  }

  if (style === 'suspension') buildSuspension(group, T, ft, c, ctx, steel, a, b, t1, t2, depth);
  else if (style === 'arch') buildSteelArch(group, T, c, steel, a, b, a0, a1);
  else if (style === 'girder') buildTruss(group, T, ft, c, steel, a, b);
  else buildViaduct(group, T, ft, c, ctx, depth);

  // River in the valley under the middle of the bridge.
  const sm = (ft.s0 + ft.s1) / 2;
  if (inChunk(sm)) {
    const f = T.frame(sm, {});
    const water = new THREE.Mesh(new THREE.PlaneGeometry(840, Math.max(60, L * 0.5)).rotateX(-Math.PI / 2), M.water);
    water.position.set(f.x, f.y - depth + 4, f.z);
    water.rotation.y = -f.h;
    water.receiveShadow = true;
    group.add(water);
  }
}

function buildSuspension(group, T, ft, c, ctx, steel, a, b, t1, t2, depth) {
  const H = 54;
  const cd = HALF_W + 3.6;
  const cableY = (s) => {
    if (s <= t1) {
      const u = (s - ft.s0) / (t1 - ft.s0);
      return 1.5 + (H - 1.5) * u * u;
    }
    if (s >= t2) {
      const u = (ft.s1 - s) / (ft.s1 - t2);
      return 1.5 + (H - 1.5) * u * u;
    }
    const u = (s - t1) / (t2 - t1);
    return 3 + (H - 3) * (2 * u - 1) * (2 * u - 1);
  };
  if (b - a > 0.05) {
    for (const side of [-1, 1]) {
      const d = side * cd;
      sweepMesh(group, T, a, b, rect(d - 0.35, d + 0.35, -0.35, 0.35), steel, { yFn: cableY, step: 2 });
    }
    const hangers = [];
    for (let s = Math.ceil(a / 6) * 6; s < b; s += 6) {
      if (s < ft.s0 + 6 || s > ft.s1 - 6 || Math.abs(s - t1) < 3 || Math.abs(s - t2) < 3) continue;
      const f = T.frame(s, tmpF);
      const h = cableY(s) - 1.2;
      if (h < 0.5) continue;
      for (const side of [-1, 1]) hangers.push(frameMatrix(T, f, side * cd, 1.2, 0, 1, h, 1));
    }
    const hm = instanced(G.hanger, steel, hangers);
    if (hm) group.add(hm);
    const beads = [];
    for (let s = Math.ceil(a / 8) * 8; s < b; s += 8) {
      const f = T.frame(s, tmpF);
      for (const side of [-1, 1]) beads.push(frameMatrix(T, f, side * cd, cableY(s) + 0.5));
    }
    const bm = instanced(G.bulb, M.necklace, beads, null, false);
    if (bm) group.add(bm);
  }
  // Towers.
  for (const st of [t1, t2]) {
    if (st < c.s0 || st >= c.s1) continue;
    const f = T.frame(st, {});
    const parts = [];
    for (const side of [-1, 1]) {
      const d = side * cd;
      const bottom = groundBelow(f, d, ctx, f.y - depth) - 5;
      const h = T.roadY(f, d) + H + 2 - bottom;
      parts.push(frameMatrix(T, f, d, bottom - T.roadY(f, d), 0, 2.6, h, 3.2));
      parts.push(frameMatrix(T, f, d, H + 2, 0, 3.2, 1.2, 3.8));
    }
    for (const y of [H, 36, 18]) parts.push(frameMatrix(T, f, 0, y, 0, cd * 2 + 2.6, 2.2, 2.6));
    parts.push(frameMatrix(T, f, 0, -4.5, 0, cd * 2 + 2.6, 2.4, 2.6));
    group.add(instanced(G.unitBox, steel, parts));
    const lights = [frameMatrix(T, f, -cd, H + 3.2, 0, 0.7, 0.7, 0.7), frameMatrix(T, f, cd, H + 3.2, 0, 0.7, 0.7, 0.7)];
    group.add(instanced(G.unitBox, M.aviation, lights, null, false));
  }
  // Anchorages at both ends.
  for (const sa of [ft.s0, ft.s1]) {
    if (sa < c.s0 || sa >= c.s1) continue;
    const f = T.frame(sa, {});
    group.add(instanced(G.unitBox, M.concrete, [-1, 1].map((side) => frameMatrix(T, f, side * cd, -2, 0, 3.4, 4.5, 6))));
  }
}

function buildSteelArch(group, T, c, steel, a, b, a0, a1) {
  const peak = clamp(0.2 * (a1 - a0), 18, 48);
  const yArch = (s) => peak * Math.sin(Math.PI * clamp((s - a0) / (a1 - a0), 0, 1));
  const ad = HALF_W + 2.9;
  const ra = Math.max(a, a0);
  const rb = Math.min(b, a1);
  if (rb - ra > 0.05) {
    for (const side of [-1, 1]) {
      const d = side * ad;
      sweepMesh(group, T, ra, rb, rect(d - 0.8, d + 0.8, 0, 1.9), steel, { yFn: yArch, step: 1.5 });
    }
    const hangers = [];
    const braces = [];
    for (let s = Math.ceil(ra / 7) * 7; s < rb; s += 7) {
      const y = yArch(s);
      if (y < 2) continue;
      const f = T.frame(s, tmpF);
      for (const side of [-1, 1]) hangers.push(frameMatrix(T, f, side * ad, 0.4, 0, 1.6, y - 0.4, 1.6));
      if (y > 9 && Math.round(s / 7) % 2 === 0) braces.push(frameMatrix(T, f, 0, y + 0.3, 0, ad * 2, 1.2, 1.2));
    }
    const hm = instanced(G.hanger, steel, hangers);
    if (hm) group.add(hm);
    const bm = instanced(G.unitBox, steel, braces);
    if (bm) group.add(bm);
  }
  for (const sp of [a0, a1]) {
    if (sp < c.s0 || sp >= c.s1) continue;
    const f = T.frame(sp, {});
    group.add(instanced(G.unitBox, M.concrete, [-1, 1].map((side) => frameMatrix(T, f, side * ad, -6, 0, 3.6, 7, 6))));
  }
}

function buildTruss(group, T, ft, c, steel, a, b) {
  const td = HALF_W + 2.9;
  const top = 5.6;
  if (b - a > 0.05) {
    for (const side of [-1, 1]) {
      const d = side * td;
      sweepMesh(group, T, a, b, rect(d - 0.35, d + 0.35, top - 0.7, top), steel);
      sweepMesh(group, T, a, b, rect(d - 0.35, d + 0.35, -0.2, 0.55), steel);
    }
  }
  const parts = [];
  const len = Math.hypot(8, top - 0.6);
  const ang = Math.atan2(8, top - 0.6);
  for (let k = 0; ft.s0 + k * 8 <= ft.s1; k++) {
    const s = ft.s0 + k * 8;
    if (s >= c.s0 && s < c.s1) {
      const f = T.frame(s, tmpF);
      for (const side of [-1, 1]) parts.push(frameMatrix(T, f, side * td, 0.3, 0, 0.45, top - 0.6, 0.45));
      parts.push(frameMatrix(T, f, 0, top - 0.6, 0, td * 2, 0.5, 0.5));
    }
    const sd = s + 4;
    if (sd < ft.s1 && sd >= c.s0 && sd < c.s1) {
      const f = T.frame(sd, tmpF);
      for (const side of [-1, 1]) {
        _p.set(f.x + f.cos * side * td, T.roadY(f, side * td) + 0.3 + (top - 0.6) / 2, f.z + f.sin * side * td);
        _q.setFromEuler(_e.set((k % 2 ? 1 : -1) * ang, -f.h, 0, 'YXZ'));
        _s.set(0.35, len, 0.35);
        parts.push(new THREE.Matrix4().compose(_p, _q, _s).multiply(new THREE.Matrix4().makeTranslation(0, -0.5, 0)));
      }
    }
  }
  const tm = instanced(G.unitBox, steel, parts);
  if (tm) group.add(tm);
}

// Stone viaduct: tall piers with arches between them, like an old aqueduct.
function buildViaduct(group, T, ft, c, ctx, depth) {
  const span = 32;
  const p = 2.2;
  const r = span / 2 - p;
  const spring = -1.7 - r - 1;
  const width = (HALF_W + 2.5) * 2;
  if (!G.viaductArch) {
    const pts = [[0, -1.7], [span, -1.7], [span, spring], [span - p, spring]];
    const shape = new THREE.Shape(pts.map(([x, y]) => new THREE.Vector2(x, y)));
    shape.absarc(span / 2, spring, r, 0, Math.PI, false);
    shape.lineTo(0, spring);
    const g = new THREE.ExtrudeGeometry(shape, { depth: width, bevelEnabled: false, curveSegments: 14 });
    g.translate(0, 0, -width / 2).rotateY(Math.PI / 2);
    G.viaductArch = shared(g);
  }
  for (let s = ft.s0 + span / 2; s <= ft.s1 - span / 2; s += span) {
    if (s < c.s0 || s >= c.s1) continue;
    const f = T.frame(s, {});
    // Pier from the springing line down into the ground.
    const bottom = Math.min(groundBelow(f, -4, ctx, f.y - depth), groundBelow(f, 4, ctx, f.y - depth)) - 5;
    const top = f.y + spring;
    if (top > bottom) group.add(instanced(G.unitBox, M.stone, [frameMatrix(T, f, 0, bottom - f.y, 0, width - 0.4, top - bottom, p * 2)]));
    if (s + span <= ft.s1 - span / 2 + 0.01) {
      const arch = new THREE.Mesh(G.viaductArch, M.stone);
      arch.position.set(f.x, f.y, f.z);
      arch.rotation.y = -f.h;
      arch.castShadow = true;
      arch.receiveShadow = true;
      group.add(arch);
    }
  }
}

function buildRockArchFeature(group, T, ft, c) {
  const sm = (ft.s0 + ft.s1) / 2;
  if (sm < c.s0 || sm >= c.s1) return;
  const { g } = anchorGroup(T, sm);
  const m = new THREE.Mesh(G.rockArch, M.vcFlat);
  m.castShadow = true;
  m.receiveShadow = true;
  g.add(m);
  group.add(g);
}

function buildGorge(group, T, ft, c, ctx) {
  const a = Math.max(c.s0, ft.s0);
  const b = Math.min(c.s1, ft.s1);
  const rng = mulberry32(Math.round(a * 13) + 7);
  const mats = [];
  const cols = [];
  const palette = [0x9a6a4a, 0x8a7a6a, 0xb07850, 0x7a6a62];
  for (let s = Math.ceil(a / 9) * 9; s < b; s += 9) {
    if (rng() > 0.6) continue;
    const f = T.frame(s, tmpF);
    const side = rng() < 0.5 ? -1 : 1;
    const d = side * (11 + rng() * 6);
    const sc = 1.2 + rng() * 2.4;
    // Rest on the lowest nearby ground so boulders sit at the foot of the wall.
    const hAt = (dd) => (ctx.heightAt ? ctx.heightAt(f, dd) : T.roadY(f, dd));
    const y = Math.min(hAt(d), hAt(d - side * 2)) - T.roadY(f, d) - sc * 0.25;
    _p.set(f.x + f.cos * d, T.roadY(f, d) + y + sc * 0.5, f.z + f.sin * d);
    _q.setFromEuler(_e.set(rng() * 3, rng() * 6, rng() * 3));
    _s.set(sc, sc, sc);
    mats.push(new THREE.Matrix4().compose(_p, _q, _s));
    cols.push(palette[Math.floor(rng() * palette.length)]);
  }
  const mesh = instanced(G.boulder, M.rockTint, mats, cols);
  if (mesh) group.add(mesh);
}

function buildTorii(group, T, ft, c) {
  const gates = [];
  const toro = [];
  for (let k = 0; ft.s0 + k * 24 <= ft.s1; k++) {
    const s = ft.s0 + k * 24;
    if (s < c.s0 || s >= c.s1) continue;
    const f = T.frame(s, tmpF);
    gates.push(frameMatrix(T, f, 0, 0));
    if (k % 2 === 0) for (const side of [-1, 1]) toro.push(frameMatrix(T, f, side * (HALF_W + 4.8), 0, Math.PI / 4));
  }
  const gm = instanced(G.torii, M.vc, gates);
  if (gm) group.add(gm);
  const tm = instanced(G.toro, M.vc, toro);
  if (tm) group.add(tm);
  const lm = instanced(G.toroLight, M.lantern, toro, null, false);
  if (lm) group.add(lm);
}

function highwaySign(lines, w = 10, h = 3.4) {
  const t = canvasTex(640, 220, (g, cw, ch) => {
    g.fillStyle = '#0b6e3c';
    g.fillRect(0, 0, cw, ch);
    g.strokeStyle = '#fff';
    g.lineWidth = 8;
    g.strokeRect(10, 10, cw - 20, ch - 20);
    g.fillStyle = '#fff';
    g.textAlign = 'center';
    g.font = '700 66px "Arial Narrow", Arial, sans-serif';
    g.fillText(lines[0], cw / 2, 100, cw - 40);
    g.font = '700 46px "Arial Narrow", Arial, sans-serif';
    g.fillText(lines[1], cw / 2, 168, cw - 40);
  });
  const mat = new THREE.MeshStandardMaterial({ map: t, emissiveMap: t, emissive: 0xffffff, emissiveIntensity: 0.25, roughness: 0.5 });
  mat.userData.owned = true;
  return new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
}

function buildOverpass(group, T, ft, c, ctx) {
  const sm = (ft.s0 + ft.s1) / 2;
  if (sm < c.s0 || sm >= c.s1) return;
  const { g, f } = anchorGroup(T, sm, 0, 0, null);
  const deckY = 10;
  const span = 440;
  const deck = new THREE.Mesh(new THREE.BoxGeometry(span, 1.6, 14).translate(0, deckY, 0), M.concrete);
  deck.castShadow = true;
  deck.receiveShadow = true;
  g.add(deck);
  for (const z of [-6.7, 6.7]) {
    const wall = new THREE.Mesh(new THREE.BoxGeometry(span, 1.2, 0.5).translate(0, deckY + 1.4, z), M.concrete);
    wall.castShadow = true;
    g.add(wall);
    g.add(new THREE.Mesh(new THREE.BoxGeometry(span, 0.28, 0.1).translate(0, deckY - 0.35, z * 1.05), z > 0 ? M.neonC : M.neonP));
  }
  // Pillars, following the ground across the road.
  const base = T.roadY(f, 0);
  const pillars = [];
  for (const d of [HALF_W + 4.5, 40, 80, 125, 170, 210]) {
    for (const side of [-1, 1]) {
      const x = side * d;
      const ground = (ctx.heightAt ? ctx.heightAt(f, x) : base) - base - 3;
      const h = deckY - 0.8 - ground;
      for (const z of [-4, 4]) pillars.push(new THREE.Matrix4().compose(_p.set(x, ground, z), _q.identity(), _s.set(1.8, h, 1.8)));
    }
  }
  const pm = instanced(G.unitBox, M.concrete, pillars);
  g.add(pm);
  const s1 = highwaySign(['DOWNTOWN ▸', 'EXIT 88 · NEON BLVD']);
  s1.position.set(3.6, deckY - 2.5, 7.2);
  const s2 = highwaySign(['◂ AIRPORT', 'BEACH 12 · ARCADE 3'], 8.4, 3.2);
  s2.position.set(-5.4, deckY - 2.4, 7.2);
  g.add(s1, s2);
  group.add(g);
}

function buildWorks(group, T, ft, c) {
  const lane = clamp(ft.lane ?? 0, 0, 2);
  const laneD = LANES[lane];
  const bounds = lane === 0 ? [[-HALF_W, -2.5]] : lane === 2 ? [[HALF_W, 2.5]] : [[0, -2.5], [0, 2.5]];
  const openSide = lane === 0 ? 1 : lane === 2 ? -1 : 1;
  const cones = [];
  const barriers = [];
  const bcol = [];
  const beacons = [];
  const offset = (s, from, to) => lerp(from, to, smoothstep(ft.s0, ft.s0 + 60, s) * (1 - smoothstep(ft.s1 - 30, ft.s1, s)));
  for (let s = Math.ceil(c.s0 / 4) * 4; s < c.s1; s += 4) {
    if (s < ft.s0 || s > ft.s1) continue;
    const taper = s < ft.s0 + 64 || s > ft.s1 - 34;
    if (!taper && Math.round(s / 4) % 2) continue;
    const f = T.frame(s, tmpF);
    for (const [from, to] of bounds) cones.push(frameMatrix(T, f, offset(s, from, to), 0.02));
  }
  for (let s = Math.ceil(c.s0 / 2) * 2; s < c.s1; s += 2) {
    if (s < ft.s0 + 70 || s > ft.s1 - 40) continue;
    const f = T.frame(s, tmpF);
    for (const [, to] of bounds) {
      const d = to + Math.sign(laneD - to || -to) * 0.9;
      barriers.push(frameMatrix(T, f, d, 0.02));
      bcol.push(Math.round(s / 2) % 2 ? 0xf2f2f2 : 0xe8202a);
      if (Math.round(s / 2) % 12 === 0) beacons.push(frameMatrix(T, f, d, 0.95));
    }
  }
  const cm = instanced(G.cone, M.vc, cones, null, false);
  if (cm) group.add(cm);
  const bm = instanced(G.barrier, M.tint, barriers, bcol);
  if (bm) group.add(bm);
  const be = instanced(G.beacon, M.beacon, beacons, null, false);
  if (be) group.add(be);

  // Flashing arrow board trailer in the closed lane.
  const sa = ft.s0 + 18;
  if (sa >= c.s0 && sa < c.s1) {
    const { g } = anchorGroup(T, sa, laneD);
    const yellow = new THREE.MeshStandardMaterial({ color: 0xffc400, roughness: 0.5 });
    yellow.userData.owned = true;
    const body = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.8, 2.2).translate(0, 0.75, 0), yellow);
    const mast = new THREE.Mesh(new THREE.BoxGeometry(0.15, 1.6, 0.15).translate(0, 1.9, 0), M.dark);
    const board = new THREE.Mesh(new THREE.BoxGeometry(2.6, 1.7, 0.12).translate(0, 3.4, 0), M.dark);
    const face = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 1.5).translate(0, 3.4, 0.07), openSide > 0 ? M.arrowR : M.arrowL);
    for (const x of [-0.95, 0.95]) {
      const w = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.35, 0.25, 12).rotateZ(Math.PI / 2).translate(x, 0.35, 0), M.dark);
      g.add(w);
    }
    for (const m of [body, mast, board]) m.castShadow = true;
    g.add(body, mast, board, face);
    group.add(g);
  }
  // A road roller parked in the closed lane halfway along.
  const sr = (ft.s0 + ft.s1) / 2;
  if (sr >= c.s0 && sr < c.s1 && ft.s1 - ft.s0 > 140) {
    const { g } = anchorGroup(T, sr, laneD, 0.05);
    const yellow = new THREE.MeshStandardMaterial({ color: 0xffb000, roughness: 0.45 });
    yellow.userData.owned = true;
    const drum = new THREE.Mesh(new THREE.CylinderGeometry(0.75, 0.75, 2.0, 16).rotateZ(Math.PI / 2).translate(0, 0.75, -1.6), M.dark);
    const body = new THREE.Mesh(new THREE.BoxGeometry(1.9, 1.1, 2.6).translate(0, 1.15, 0.6), yellow);
    const cab = new THREE.Mesh(new THREE.BoxGeometry(1.4, 1.3, 1.2).translate(0, 2.35, 1.0), yellow);
    const roof = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.12, 1.6).translate(0, 3.05, 1.0), M.dark);
    const light = new THREE.Mesh(new THREE.BoxGeometry(0.25, 0.25, 0.25).translate(0, 3.25, 1.0), M.beacon);
    for (const m of [drum, body, cab, roof]) m.castShadow = true;
    g.add(drum, body, cab, roof, light);
    group.add(g);
  }
  // Lane closed sign on the closed side before the taper.
  const ss = ft.s0 - 30;
  if (ss >= c.s0 && ss < c.s1) {
    const side = lane === 2 ? 1 : lane === 0 ? -1 : 1;
    addSign(group, T, ss, side * (HALF_W + 2.6), 'works', 'LANE CLOSED');
  }
}

function addSign(group, T, s, d, kind, text) {
  const village = kind === 'village';
  const { g } = anchorGroup(T, s, d);
  const mat = signMaterial(kind, text);
  if (village) {
    const posts = new THREE.Mesh(mergeGeometries([box(0.14, 2.4, 0.14, -1.7), box(0.14, 2.4, 0.14, 1.7)]), M.dark);
    const panel = new THREE.Mesh(new THREE.PlaneGeometry(4.4, 2.2).translate(0, 3.4, 0.08), mat);
    g.add(posts, panel);
  } else {
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 2.6, 8).translate(0, 1.3, 0), M.dark);
    const panel = new THREE.Mesh(new THREE.PlaneGeometry(2.7, 3.54).translate(0, 3.55, 0.09), mat);
    post.castShadow = true;
    g.add(post, panel);
  }
  group.add(g);
}

const VILLAGES = ['SUNNYVALE', 'MAPLE CREEK', 'PINE HOLLOW', 'ROSEWOOD', 'CEDAR FALLS', 'WILLOW BEND'];

function buildVillage(group, T, ft, c, ctx) {
  const name = VILLAGES[Math.floor(hash2(Math.round(ft.s0), 11) * VILLAGES.length) % VILLAGES.length];
  const inChunk = (s) => s >= c.s0 && s < c.s1;
  if (inChunk(ft.s0)) addSign(group, T, ft.s0, HALF_W + 3.5, 'village', name);
  const ground = (f, d) => (ctx.heightAt ? ctx.heightAt(f, d) : T.roadY(f, d));

  // Church with a spire, facing the road on the left.
  const sc = ft.s0 + 0.3 * (ft.s1 - ft.s0);
  if (inChunk(sc)) {
    const d = -(HALF_W + 26);
    const f = T.frame(sc, {});
    const { g } = anchorGroup(T, sc, d, Math.PI / 2, ground(f, d));
    const white = new THREE.MeshStandardMaterial({ color: 0xfaf6ee, roughness: 0.8 });
    const roofM = new THREE.MeshStandardMaterial({ color: 0x9a3a2a, roughness: 0.8, flatShading: true });
    white.userData.owned = roofM.userData.owned = true;
    const nave = new THREE.Mesh(box(9, 7, 16), white);
    const roof = new THREE.Mesh(new THREE.CylinderGeometry(5.4, 5.4, 16.6, 3, 1).rotateX(Math.PI / 2).rotateZ(Math.PI).scale(1.03, 0.5, 1).translate(0, 8.35, 0), roofM);
    const tower = new THREE.Mesh(box(4, 15, 4, 0, 0, 9.5), white);
    const spire = new THREE.Mesh(new THREE.ConeGeometry(3, 10, 4).rotateY(Math.PI / 4).translate(0, 20, 9.5), roofM);
    const cross = new THREE.Mesh(mergeGeometries([box(0.25, 2, 0.25, 0, 25, 9.5), box(1.2, 0.25, 0.25, 0, 26.1, 9.5)]), M.lamp);
    const win = new THREE.Mesh(mergeGeometries([box(0.1, 2.4, 1.1, 4.52, 2.5, -4), box(0.1, 2.4, 1.1, 4.52, 2.5, 0), box(0.1, 2.4, 1.1, 4.52, 2.5, 4), box(1.4, 1.4, 0.1, 0, 11, 11.52)]), M.windows);
    for (const m of [nave, roof, tower, spire]) {
      m.castShadow = true;
      m.receiveShadow = true;
    }
    g.add(nave, roof, tower, spire, cross, win);
    group.add(g);
  }
  // Water tower with the town name.
  const sw = ft.s0 + 0.65 * (ft.s1 - ft.s0);
  if (inChunk(sw)) {
    const d = HALF_W + 34;
    const f = T.frame(sw, {});
    const { g } = anchorGroup(T, sw, d, 0, ground(f, d));
    const tex = canvasTex(1024, 128, (cx, w, h) => {
      cx.fillStyle = '#8fd3f0';
      cx.fillRect(0, 0, w, h);
      cx.fillStyle = '#16406a';
      cx.textAlign = 'center';
      cx.font = '900 64px Orbitron, "Arial Black", sans-serif';
      cx.fillText(name, w / 4, 88);
      cx.fillText(name, (w * 3) / 4, 88);
    });
    const tankM = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.5, metalness: 0.3 });
    tankM.userData.owned = true;
    const legs = new THREE.Mesh(
      mergeGeometries([-1, 1].flatMap((sx) => [-1, 1].map((sz) => cyl(0.25, 0.3, 15, 6, sx * 3, 0, sz * 3)))),
      M.dark,
    );
    const tank = new THREE.Mesh(new THREE.CylinderGeometry(4.6, 4.6, 5.5, 24).translate(0, 17.7, 0), tankM);
    const cap = new THREE.Mesh(new THREE.ConeGeometry(4.9, 2.4, 24).translate(0, 21.6, 0), M.dark);
    for (const m of [legs, tank, cap]) m.castShadow = true;
    g.add(legs, tank, cap);
    group.add(g);
  }
  // White picket fences along both sides.
  if (!G.picket) {
    const parts = [box(3, 0.1, 0.06, 0, 0.35, 0).translate(0, 0, 0).rotateY(Math.PI / 2), box(3, 0.1, 0.06, 0, 0.75, 0).rotateY(Math.PI / 2)];
    for (let i = 0; i < 6; i++) parts.push(new THREE.BoxGeometry(0.08, 1.0, 0.12).translate(0, 0.5, -1.25 + i * 0.5));
    G.picket = shared(mergeGeometries(parts.map((p) => (p.index ? p.toNonIndexed() : p))));
  }
  const pickets = [];
  for (let s = Math.ceil(c.s0 / 3) * 3; s < c.s1; s += 3) {
    if (s < ft.s0 + 20 || s > ft.s1 - 10) continue;
    const f = T.frame(s, tmpF);
    for (const side of [-1, 1]) {
      const d = side * (HALF_W + 4.4);
      _p.set(f.x + f.cos * d, ground(f, d), f.z + f.sin * d);
      _q.setFromEuler(_e.set(0, -f.h, 0));
      pickets.push(new THREE.Matrix4().compose(_p, _q, _s.set(1, 1, 1)));
    }
  }
  const whiteP = M.picketMat || (M.picketMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.7 }));
  const pk = instanced(G.picket, whiteP, pickets, null, false);
  if (pk) group.add(pk);
}

// ---------- public API ----------

export function buildFeatures(group, track, sStart, sEnd, ctx = {}) {
  if (!track.featuresIn) return;
  init();
  const c = { s0: sStart, s1: sEnd };
  for (const ft of track.featuresIn(sStart, sEnd)) {
    switch (ft.type) {
      case 'tunnel':
        buildTunnel(group, track, ft, c);
        break;
      case 'bridge':
        buildBridge(group, track, ft, c, ctx);
        break;
      case 'arch':
        buildRockArchFeature(group, track, ft, c);
        break;
      case 'gorge':
        buildGorge(group, track, ft, c, ctx);
        break;
      case 'torii':
        buildTorii(group, track, ft, c);
        break;
      case 'overpass':
        buildOverpass(group, track, ft, c, ctx);
        break;
      case 'works':
        buildWorks(group, track, ft, c);
        break;
      case 'village':
        buildVillage(group, track, ft, c, ctx);
        break;
      case 'sign':
        if (ft.s0 >= sStart && ft.s0 < sEnd) addSign(group, track, ft.s0, HALF_W + 3, ft.kind || 'curve', ft.text);
        break;
      default:
        break;
    }
  }
}

// Emissive features: tunnel lights stay on; lanterns glow at night; arrow boards
// and beacons blink regardless of the time of day.
export function updateFeatureLights(night, time = 0) {
  if (!M) return;
  const flash = Math.floor(time * 2) % 2 === 0;
  M.arrowR.emissiveIntensity = M.arrowL.emissiveIntensity = flash ? 2.6 : 0.12;
  const blink = Math.sin(time * 7) > 0.2 ? 1 : 0.1;
  M.beacon.color.setRGB(0.3 + blink * 2.4, 0.15 + blink * 1.3, 0.02);
  const av = Math.sin(time * 2.2) > 0.5 ? 1 : 0.12;
  M.aviation.color.setRGB(0.4 + av * 2.4 * (0.4 + night), 0.03, 0.02);
  M.lantern.color.setRGB(0.5 + night * 2.6, 0.32 + night * 1.7, 0.12 + night * 0.7);
  M.windows.color.setRGB(0.55 + night * 2.2, 0.45 + night * 1.6, 0.25 + night * 0.8);
  const neon = 1.3 + night * 1.0;
  M.neonC.color.setRGB(0.12 * neon, 0.95 * neon, 1.2 * neon);
  M.neonP.color.setRGB(1.2 * neon, 0.12 * neon, 0.95 * neon);
  M.necklace.color.setRGB(0.6 + night * 2.6, 0.55 + night * 2.2, 0.45 + night * 1.6);
  M.bridgeLamp.color.setRGB(0.6 + night * 3.0, 0.5 + night * 2.4, 0.3 + night * 1.4);
  M.bridgePool.color.setRGB(night * 0.55, night * 0.4, night * 0.2);
  M.bridgePool.visible = night > 0.05;
  for (const key of ['suspension', 'arch', 'girder']) {
    const m = M.steel[key];
    m.emissive.copy(m.color);
    m.emissiveIntensity = night * 0.35;
  }
  const pool = 0.25 + night * 0.25;
  M.pool.color.setRGB(pool * 1.6, pool * 1.0, pool * 0.4);
}

// Reflections for the river water (pass the sky PMREM texture), plus an optional ripple normal map.
export function setFeatureEnvMap(texture, normalMap = null) {
  init();
  M.water.envMap = texture;
  if (normalMap) {
    M.water.normalMap = normalMap;
    M.water.normalScale = new THREE.Vector2(0.5, 0.5);
  }
  M.water.needsUpdate = true;
}
