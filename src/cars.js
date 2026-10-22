import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// Cars built from extruded side profiles with real wheel arches and heavy
// bevels, plus lathe-turned tires with spoked rims. Models face -Z and the
// tires touch y = 0. Profiles are written in "shape space": x runs along the
// car (front = +x), y is up; toCar() turns them so the front points to -Z.

const B = 0.1; // body bevel
const BC = 0.06; // cabin bevel

// Side profiles. body: front-bottom → over the top → rear-bottom; the builder
// closes it along the bottom, cutting an arch over each axle.
const SPECS = {
  sport: {
    W: 1.84, wheelR: 0.33, tireW: 0.26, axles: [1.33, -1.3], cabinW: 1.4, bumperY: 0.36,
    body: [[2.15, 0.3], [2.22, 0.5], ['Q', 2.2, 0.7, 1.85, 0.76], [0.85, 0.9], [-1.55, 0.95], ['Q', -2.15, 0.96, -2.2, 0.74], [-2.17, 0.3]],
    cabin: [[0.85, 0.88], [0.05, 1.27], [-0.75, 1.28], [-1.5, 0.93]],
    tail: { y: 0.8, x: 0.56, w: 0.5, h: 0.13 },
    head: { y: 0.6, x: 0.6, w: 0.42, h: 0.11 },
  },
  sedan: {
    W: 1.8, wheelR: 0.33, tireW: 0.25, axles: [1.4, -1.4], cabinW: 1.42, bumperY: 0.38, grille: true,
    body: [[2.25, 0.3], [2.3, 0.62], ['Q', 2.3, 0.82, 2.0, 0.84], [0.95, 0.9], [-1.45, 0.92], [-2.2, 0.92], ['Q', -2.32, 0.92, -2.32, 0.75], [-2.28, 0.3]],
    cabin: [[0.95, 0.88], [0.35, 1.42], [-0.95, 1.42], [-1.5, 0.9]],
    tail: { y: 0.74, x: 0.56, w: 0.52, h: 0.18 },
    head: { y: 0.64, x: 0.6, w: 0.44, h: 0.15 },
  },
  hatch: {
    W: 1.74, wheelR: 0.31, tireW: 0.24, axles: [1.25, -1.2], cabinW: 1.38, bumperY: 0.36, grille: true,
    body: [[1.95, 0.3], [2.0, 0.58], ['Q', 1.98, 0.78, 1.7, 0.82], [0.85, 0.92], [-1.75, 0.95], [-1.9, 0.92], [-1.95, 0.3]],
    cabin: [[0.85, 0.9], [0.2, 1.42], [-1.45, 1.44], [-1.85, 0.94]],
    tail: { y: 0.84, x: 0.62, w: 0.26, h: 0.28 },
    head: { y: 0.64, x: 0.58, w: 0.36, h: 0.14 },
  },
  van: {
    W: 1.94, wheelR: 0.36, tireW: 0.27, axles: [1.55, -1.6], cabinW: 1.8, bumperY: 0.42, grille: true,
    body: [[2.4, 0.34], [2.46, 0.72], ['Q', 2.44, 1.0, 2.05, 1.05], [1.3, 1.12], [-2.35, 1.15], [-2.42, 1.05], [-2.42, 0.34]],
    cabin: [[1.3, 1.1], [0.55, 2.0], [-2.28, 2.02], [-2.36, 1.13]],
    tail: { y: 1.0, x: 0.84, w: 0.16, h: 0.44 },
    head: { y: 0.74, x: 0.62, w: 0.44, h: 0.17 },
  },
  pickup: {
    W: 1.92, wheelR: 0.38, tireW: 0.29, axles: [1.6, -1.55], cabinW: 1.62, bumperY: 0.46, grille: true, bed: true,
    body: [[2.45, 0.36], [2.5, 0.76], ['Q', 2.48, 1.0, 2.15, 1.03], [0.9, 1.1], [-2.45, 1.12], [-2.5, 0.36]],
    cabin: [[0.9, 1.08], [0.42, 1.78], [-0.82, 1.8], [-0.88, 1.1]],
    tail: { y: 0.95, x: 0.82, w: 0.16, h: 0.34 },
    head: { y: 0.8, x: 0.6, w: 0.46, h: 0.17 },
  },
  // The player's 80s wedge supercar.
  wedge: {
    W: 1.96, wheelR: 0.34, tireW: 0.3, axles: [1.38, -1.35], cabinW: 1.34, bumperY: 0.32, noFrontBumper: true,
    body: [[2.25, 0.28], [2.32, 0.52], ['Q', 2.3, 0.7, 1.95, 0.76], [0.6, 0.9], [-1.9, 0.98], [-2.22, 0.98], [-2.26, 0.28]],
    cabin: [[0.62, 0.88], [-0.25, 1.2], [-0.95, 1.2], [-1.75, 0.97]],
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

const glassMat = envMat(new THREE.MeshPhysicalMaterial({ color: 0x0b1320, metalness: 0.1, roughness: 0.05, side: THREE.DoubleSide }), 1.3);
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
      envMat(new THREE.MeshPhysicalMaterial({ color, metalness: 0.35, roughness: 0.38, clearcoat: 1, clearcoatRoughness: 0.12 }), 0.9),
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
const toCar = (g) => g.rotateY(Math.PI / 2);
const flat = (g) => (g.index ? g.toNonIndexed() : g);
const merge = (list) => mergeGeometries(list.map(flat));
const rbox = (w, h, d, r = 0.04, seg = 2) => new RoundedBoxGeometry(w, h, d, seg, Math.min(r, w * 0.49, h * 0.49, d * 0.49));

function pathShape(points, shape = new THREE.Shape()) {
  points.forEach((p, i) => {
    if (p[0] === 'Q') shape.quadraticCurveTo(p[1], p[2], p[3], p[4]);
    else if (i === 0) shape.moveTo(p[0], p[1]);
    else shape.lineTo(p[0], p[1]);
  });
  return shape;
}

function bodyShape(spec) {
  const s = pathShape(spec.body);
  const yb = spec.body[0][1];
  const R = spec.wheelR + 0.06 + B;
  const cy = spec.wheelR - 0.06;
  for (const ax of [...spec.axles].sort((a, b) => a - b)) {
    s.lineTo(ax - R, yb);
    s.absarc(ax, cy, R, Math.PI, 0, true);
    s.lineTo(ax + R, yb);
  }
  s.closePath();
  return s;
}

function extrude(shape, width, bevel, segments = 4) {
  const depth = width - bevel * 2;
  const g = new THREE.ExtrudeGeometry(shape, {
    depth,
    bevelEnabled: true,
    bevelThickness: bevel,
    bevelSize: bevel,
    bevelSegments: segments,
    curveSegments: 10,
  });
  g.translate(0, 0, -depth / 2);
  return g;
}

// Glass panels on a cabin: side windows plus windshield and rear glass.
function cabinGlass(spec) {
  const pts = spec.cabin;
  const panels = [];
  const cx = pts.reduce((a, p) => a + p[0], 0) / pts.length;
  const cy = pts.reduce((a, p) => a + p[1], 0) / pts.length;
  const inset = pts.map(([x, y]) => new THREE.Vector2(cx + (x - cx) * 0.84, cy + (y - cy) * 0.78 + 0.02));
  for (const side of [-1, 1]) {
    const g = new THREE.ShapeGeometry(new THREE.Shape(inset));
    g.translate(0, 0, side * (spec.cabinW / 2 + 0.012));
    panels.push(g);
  }
  const depth = spec.cabinW - BC * 2;
  const slope = (a, b) => {
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const len = Math.hypot(dx, dy);
    let nx = -dy / len;
    let ny = dx / len;
    if (ny < 0) {
      nx = -nx;
      ny = -ny;
    }
    const g = new THREE.PlaneGeometry(len * 0.86, depth * 0.94).rotateX(-Math.PI / 2);
    g.rotateZ(Math.atan2(dy, dx));
    g.translate((a[0] + b[0]) / 2 + nx * (BC + 0.012), (a[1] + b[1]) / 2 + ny * (BC + 0.012), 0);
    panels.push(g);
  };
  slope(pts[0], pts[1]);
  slope(pts[pts.length - 2], pts[pts.length - 1]);
  return toCar(mergeGeometries(panels));
}

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
  const tire = new THREE.LatheGeometry(pts, 22).rotateZ(-Math.PI / 2);

  const rimY = hw * 0.58;
  const parts = [
    new THREE.TorusGeometry(R * 0.6, R * 0.055, 6, 22).rotateX(Math.PI / 2).translate(0, rimY, 0),
    new THREE.CylinderGeometry(R * 0.16, R * 0.18, 0.08, 10).translate(0, rimY, 0),
  ];
  for (let i = 0; i < 5; i++) {
    parts.push(new THREE.BoxGeometry(R * 0.16, 0.05, R * 0.5).translate(0, rimY, R * 0.33).rotateY((i / 5) * Math.PI * 2));
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
  const xs = spec.body.map((p) => (p[0] === 'Q' ? p[3] : p[0]));
  const frontX = Math.max(...xs) + B;
  const rearX = Math.min(...xs) - B;
  const frontZ = -frontX;
  const rearZ = -rearX;
  const belt = Math.max(...spec.cabin.map((p) => p[1]));
  const windBase = spec.cabin[0];

  const paint = [toCar(extrude(bodyShape(spec), spec.W, B)), toCar(extrude(pathShape(spec.cabin), spec.cabinW, BC, 3))];
  // Mirrors
  for (const sx of [-1, 1]) {
    paint.push(rbox(0.2, 0.12, 0.1, 0.04).translate(sx * (spec.cabinW / 2 + 0.12), windBase[1] + 0.16, -windBase[0] + 0.12));
  }
  const trim = [];
  // Bumpers
  if (!spec.noFrontBumper) trim.push(rbox(spec.W * 0.98, 0.17, 0.26, 0.07).translate(0, spec.bumperY, frontZ + 0.06));
  trim.push(rbox(spec.W * 0.98, 0.17, 0.26, 0.07).translate(0, spec.bumperY, rearZ - 0.06));
  if (spec.grille && spec.head) trim.push(rbox(spec.head.x * 2 - spec.head.w - 0.08, spec.head.h * 0.95, 0.08, 0.02).translate(0, spec.head.y, frontZ + 0.02));
  if (spec.bed) trim.push(rbox(spec.W - 0.34, 0.06, 1.45, 0.02).translate(0, 1.2, 1.7));
  // Side rub strips
  for (const sx of [-1, 1]) trim.push(rbox(0.04, 0.06, (frontX - rearX) * 0.42, 0.02).translate(sx * (spec.W / 2 + 0.005), spec.bumperY + 0.18, (frontZ + rearZ) / 2));

  const tail = [];
  const head = [];
  if (spec.tail) {
    const t = spec.tail;
    for (const sx of [-1, 1]) tail.push(rbox(t.w, t.h, 0.12, 0.03).translate(sx * t.x, t.y, rearZ - 0.03));
  }
  if (spec.head) {
    const h = spec.head;
    for (const sx of [-1, 1]) head.push(rbox(h.w, h.h, 0.12, 0.03).translate(sx * h.x, h.y, frontZ + 0.03));
  }

  const geos = {
    spec,
    frontZ,
    rearZ,
    belt,
    paint: merge(paint),
    glass: cabinGlass(spec),
    trim: merge(trim),
    tail: tail.length ? merge(tail) : null,
    head: head.length ? merge(head) : null,
  };
  typeCache.set(type, geos);
  return geos;
}

function buildProfileCar(type, color, lights) {
  const g = profileCar(type);
  const { spec } = g;
  const root = new THREE.Group();
  const body = new THREE.Mesh(g.paint, paintMat(color));
  body.castShadow = true;
  root.add(body, new THREE.Mesh(g.glass, glassMat), new THREE.Mesh(g.trim, trimMat));
  if (g.tail) root.add(new THREE.Mesh(g.tail, lights.tail));
  if (g.head) root.add(new THREE.Mesh(g.head, lights.head));
  const wx = spec.W / 2 + 0.06 - spec.tireW / 2;
  const spots = [];
  for (const ax of spec.axles) for (const sx of [-1, 1]) spots.push({ x: sx * wx, z: -ax, front: ax > 0 });
  const { wheels, frontWheels } = addWheels(root, spots, spec.wheelR, spec.tireW, type === 'wedge' ? goldMat : chromeMat);
  const beam = addBeam(root, g.frontZ);
  root.userData = { wheels, frontWheels, beam, halfLen: (g.rearZ - g.frontZ) / 2, halfW: spec.W / 2 };
  return root;
}

// ---------- Semi truck ----------
let truckGeos = null;
function truckParts() {
  if (truckGeos) return truckGeos;
  const cab = [rbox(2.4, 2.5, 2.2, 0.2, 3).translate(0, 2.15, -4.4), rbox(2.44, 0.7, 0.5, 0.15).translate(0, 1.0, -5.3)];
  // Front fenders over the steer axle.
  for (const sx of [-1, 1]) cab.push(rbox(0.42, 0.18, 1.3, 0.06).translate(sx * 1.08, 1.12, -4.5));
  const trailer = [rbox(2.5, 3.0, 8.0, 0.1).translate(0, 2.7, 1.0)];
  const stripe = [rbox(2.54, 0.34, 7.9, 0.04).translate(0, 1.75, 1.0), rbox(2.44, 0.16, 2.24, 0.04).translate(0, 3.0, -4.4)];
  const trim = [
    rbox(2.5, 0.22, 0.3, 0.06).translate(0, 0.62, -5.55),
    new THREE.BoxGeometry(1.9, 0.4, 9.6).translate(0, 0.8, -0.4),
    rbox(2.3, 0.16, 0.12, 0.04).translate(0, 0.95, 5.02),
    rbox(0.08, 1.6, 0.08, 0.03).translate(-1.05, 3.2, -3.35),
    // Trailer rear doors: seam and frame.
    rbox(0.05, 2.7, 0.04, 0.02).translate(0, 2.75, 5.01),
    rbox(2.3, 0.08, 0.04, 0.02).translate(0, 4.05, 5.01),
  ];
  for (const sx of [-1, 1]) trim.push(rbox(0.12, 0.4, 0.14, 0.03).translate(sx * 1.32, 2.8, -5.15)); // mirrors
  const chrome = [rbox(1.5, 0.75, 0.06, 0.03).translate(0, 1.6, -5.52), rbox(0.05, 2.2, 0.06, 0.02).translate(-0.45, 2.6, 5.02), rbox(0.05, 2.2, 0.06, 0.02).translate(0.45, 2.6, 5.02), new THREE.CylinderGeometry(0.09, 0.09, 1.9, 10).translate(1.05, 3.3, -3.35)];
  const windshield = new THREE.PlaneGeometry(2.1, 0.95).translate(0, 2.75, -5.515);
  const sideL = new THREE.PlaneGeometry(0.9, 0.8).rotateY(-Math.PI / 2).translate(-1.215, 2.75, -4.9);
  const sideR = new THREE.PlaneGeometry(0.9, 0.8).rotateY(Math.PI / 2).translate(1.215, 2.75, -4.9);
  const tail = [];
  const head = [];
  for (const sx of [-1, 1]) {
    tail.push(rbox(0.32, 0.18, 0.1, 0.03).translate(sx * 0.95, 1.05, 5.04));
    head.push(rbox(0.42, 0.18, 0.1, 0.03).translate(sx * 0.86, 1.0, -5.56));
  }
  truckGeos = {
    cab: merge(cab),
    trailer: merge(trailer),
    stripe: merge(stripe),
    trim: merge(trim),
    chrome: merge(chrome),
    glass: mergeGeometries([windshield, sideL, sideR]),
    tail: merge(tail),
    head: merge(head),
  };
  return truckGeos;
}

function buildTruck(color, lights) {
  const g = truckParts();
  const root = new THREE.Group();
  const cab = new THREE.Mesh(g.cab, paintMat(color));
  const trailer = new THREE.Mesh(g.trailer, paintMat(0xeef0f5));
  cab.castShadow = trailer.castShadow = true;
  root.add(cab, trailer, new THREE.Mesh(g.stripe, paintMat(color)), new THREE.Mesh(g.trim, trimMat), new THREE.Mesh(g.chrome, chromeMat));
  root.add(new THREE.Mesh(g.glass, glassMat), new THREE.Mesh(g.tail, lights.tail), new THREE.Mesh(g.head, lights.head));
  const spots = [];
  for (const [z, front] of [[-4.5, true], [-2.1, false], [-0.9, false], [3.4, false], [4.5, false]]) {
    for (const sx of [-1, 1]) spots.push({ x: sx * 1.08, z, front });
  }
  const { wheels, frontWheels } = addWheels(root, spots, 0.5, 0.36);
  const beam = addBeam(root, -5.6);
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

export function buildPlayerCar() {
  const lights = {
    tail: new THREE.MeshStandardMaterial({ color: 0x330000, emissive: 0xff1030, emissiveIntensity: 1 }),
    head: new THREE.MeshStandardMaterial({ color: 0x333333, emissive: 0xf4fbff, emissiveIntensity: 2 }),
  };
  const car = buildCar('wedge', 0xff2a6d, lights);
  const spec = SPECS.wedge;
  const W = spec.W;
  const rearZ = 2.26 + B;

  const trim = [];
  const paint = [];
  const chrome = [];
  // Full-width taillight bar with louvers over a black panel.
  trim.push(rbox(W - 0.22, 0.34, 0.08, 0.03).translate(0, 0.72, rearZ - 0.02));
  for (const y of [0.65, 0.72, 0.79]) trim.push(rbox(W - 0.3, 0.025, 0.05, 0.01).translate(0, y, rearZ + 0.045));
  // Side strakes ahead of the rear wheels.
  for (const sx of [-1, 1]) {
    for (let i = 0; i < 5; i++) trim.push(rbox(0.04, 0.035, 1.05, 0.015).translate(sx * (W / 2 + 0.01), 0.5 + i * 0.065, 0.22));
  }
  // Pop-up headlight pods.
  for (const sx of [-1, 1]) paint.push(rbox(0.46, 0.15, 0.38, 0.05).translate(sx * 0.52, 0.93, -1.72));
  // Front intake and rear diffuser.
  trim.push(rbox(W * 0.7, 0.12, 0.1, 0.03).translate(0, 0.42, -2.36));
  trim.push(rbox(W * 0.9, 0.12, 0.3, 0.04).translate(0, 0.25, rearZ - 0.12));
  // Rear wing on struts.
  trim.push(rbox(W, 0.06, 0.44, 0.03).translate(0, 1.28, 1.95));
  for (const sx of [-0.62, 0.62]) trim.push(new THREE.BoxGeometry(0.06, 0.22, 0.22).translate(sx, 1.15, 1.98));
  // Twin exhausts.
  for (const sx of [-0.5, 0.5]) chrome.push(new THREE.CylinderGeometry(0.065, 0.065, 0.24, 12, 1, true).rotateX(Math.PI / 2).translate(sx, 0.3, rearZ));
  const trimMesh = new THREE.Mesh(merge(trim), trimMat);
  trimMesh.castShadow = true;
  const paintMesh = new THREE.Mesh(merge(paint), paintMat(0xff2a6d));
  car.add(trimMesh, paintMesh, new THREE.Mesh(merge(chrome), chromeMat));

  const tailBar = new THREE.Mesh(rbox(W - 0.32, 0.2, 0.06, 0.02), lights.tail);
  tailBar.position.set(0, 0.72, rearZ + 0.02);
  const pops = new THREE.Mesh(merge([-1, 1].map((sx) => rbox(0.38, 0.08, 0.04, 0.015).translate(sx * 0.52, 0.93, -1.92))), lights.head);
  const plate = new THREE.Mesh(new THREE.PlaneGeometry(0.52, 0.13), new THREE.MeshStandardMaterial({ map: plateTexture(), roughness: 0.5 }));
  plate.position.set(0, 0.46, rearZ + 0.005);
  car.add(tailBar, pops, plate);

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
