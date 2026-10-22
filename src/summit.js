import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { HALF_W } from './track.js';
import { featureMaterial } from './features.js';
import { hash2, mulberry32 } from './math.js';

// Mountain pass summit: an alpine lake on the uphill side, prayer-flag bunting
// strung across the road, stone cairns and a viewpoint over the drop.

const FLAG_COLORS = [0x2f6fff, 0xffffff, 0xff3344, 0x2fbf5a, 0xffd23f];
let M = null;

function init() {
  if (M) return;
  M = {
    ice: new THREE.MeshStandardMaterial({ color: 0xd6ecf7, roughness: 0.12, metalness: 0.1 }),
    flags: new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide }),
    pole: new THREE.MeshStandardMaterial({ color: 0x6b4a2e, roughness: 0.8 }),
    stone: new THREE.MeshStandardMaterial({ color: 0x9a968e, roughness: 0.95, flatShading: true }),
    wood: new THREE.MeshStandardMaterial({ color: 0x9a6a3e, roughness: 0.8 }),
    metal: new THREE.MeshStandardMaterial({ color: 0x3a6a8a, roughness: 0.35, metalness: 0.6 }),
    string: new THREE.LineBasicMaterial({ color: 0x333333 }),
  };
}

// Displayed altitude in meters (the climb is exaggerated: it is a game).
export const passAltitude = (ft, y) => Math.round(ft.alt0 + (y - ft.base) * 4.2);

export const lakeLevel = (ft) => ft.top - 2.3;

// Elliptic lake distance in road coordinates (< 1 inside the water).
export function inLake(ft, s, ad) {
  if (ft.sum0 === undefined) return 9;
  const sc = (ft.sum0 + ft.sum1) / 2;
  const half = Math.max(80, (ft.sum1 - ft.sum0) / 2 - 110);
  const a = (s - sc) / half;
  const b = (ad - 64) / 34;
  return a * a + b * b;
}

function lake(group, T, ft, s0, s1) {
  const sc = (ft.sum0 + ft.sum1) / 2;
  const half = Math.max(80, (ft.sum1 - ft.sum0) / 2 - 110);
  const a0 = Math.max(s0, sc - half * 1.12);
  const a1 = Math.min(s1, sc + half * 1.12);
  if (a1 <= a0) return;
  const rows = Math.max(2, Math.ceil((a1 - a0) / 4) + 1);
  const pos = [];
  const idx = [];
  const y = lakeLevel(ft);
  const f = {};
  for (let k = 0; k < rows; k++) {
    const s = a0 + ((a1 - a0) * k) / (rows - 1);
    T.frame(s, f);
    const q = (s - sc) / half;
    const w = Math.sqrt(Math.max(0, 1.25 - q * q)) * 34;
    for (const ad of [64 - w, 64 + w]) {
      const d = ft.lakeSide * ad;
      pos.push(f.x + f.cos * d, y, f.z + f.sin * d);
    }
    if (k) {
      const i = k * 2;
      idx.push(i - 2, i - 1, i, i - 1, i + 1, i);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  const mat = ft.snowy ? M.ice : featureMaterial('water');
  const mesh = new THREE.Mesh(geo, mat);
  mesh.material.side = THREE.DoubleSide;
  mesh.receiveShadow = true;
  group.add(mesh);
}

// A string of prayer flags across the road between two poles.
function bunting(group, T, s, seed) {
  const f = T.frame(s, {});
  const ends = [-1, 1].map((side) => {
    const d = side * (HALF_W + 3.2);
    return new THREE.Vector3(f.x + f.cos * d, T.roadY(f, d), f.z + f.sin * d);
  });
  const poleGeo = new THREE.CylinderGeometry(0.12, 0.16, 9, 8).translate(0, 4.5, 0);
  for (const e of ends) {
    const p = new THREE.Mesh(poleGeo, M.pole);
    p.position.copy(e);
    p.castShadow = true;
    group.add(p);
  }
  const a = ends[0].clone().setY(ends[0].y + 8.6);
  const b = ends[1].clone().setY(ends[1].y + 8.6);
  const n = 26;
  const pts = [];
  const pt = (t) => new THREE.Vector3().lerpVectors(a, b, t).setY(a.y + (b.y - a.y) * t - Math.sin(t * Math.PI) * 1.8);
  for (let i = 0; i <= 24; i++) pts.push(pt(i / 24));
  group.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), M.string));
  const pos = [];
  const col = [];
  const c = new THREE.Color();
  const fwd = new THREE.Vector3(f.sin, 0, -f.cos);
  for (let i = 1; i < n; i++) {
    const p0 = pt((i - 0.42) / n);
    const p1 = pt((i + 0.42) / n);
    const tip = pt(i / n).setY(pt(i / n).y - 1.15).addScaledVector(fwd, 0.25 * Math.sin(i * 1.7 + seed));
    pos.push(p0.x, p0.y, p0.z, p1.x, p1.y, p1.z, tip.x, tip.y, tip.z);
    c.setHex(FLAG_COLORS[(i + seed) % FLAG_COLORS.length]);
    for (let k = 0; k < 3; k++) col.push(c.r, c.g, c.b);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  geo.computeVertexNormals();
  group.add(new THREE.Mesh(geo, M.flags));
}

function cairn(group, x, y, z, rng) {
  const parts = [];
  let h = 0;
  for (let i = 0; i < 5; i++) {
    const r = 0.75 - i * 0.12 + rng() * 0.1;
    parts.push(new THREE.IcosahedronGeometry(r, 0).scale(1, 0.6, 1).rotateY(rng() * 3).translate(rng() * 0.12, h + r * 0.5, rng() * 0.12));
    h += r * 0.95;
  }
  const m = new THREE.Mesh(mergeGeometries(parts), M.stone);
  m.position.set(x, y - 0.1, z);
  m.castShadow = true;
  group.add(m);
}

// Wooden viewing deck with a railing and a coin telescope, looking over the drop.
function viewpoint(group, T, s, d, ground) {
  const f = T.frame(s, {});
  const g = new THREE.Group();
  const parts = [new THREE.BoxGeometry(9, 0.35, 5).translate(0, 0.6, 0)];
  for (const x of [-4.2, 4.2]) for (const z of [-2.2, 2.2]) parts.push(new THREE.BoxGeometry(0.3, 1.2, 0.3).translate(x, 0, z));
  for (let x = -4.2; x <= 4.21; x += 1.4) parts.push(new THREE.BoxGeometry(0.12, 1.1, 0.12).translate(x, 1.3, 2.3));
  parts.push(new THREE.BoxGeometry(8.6, 0.14, 0.18).translate(0, 1.85, 2.3));
  g.add(new THREE.Mesh(mergeGeometries(parts), M.wood));
  const scope = mergeGeometries([
    new THREE.CylinderGeometry(0.08, 0.1, 1.3, 8).translate(0, 1.4, 0),
    new THREE.CylinderGeometry(0.16, 0.2, 0.9, 12).rotateX(Math.PI / 2 - 0.2).translate(0, 2.15, 0.15),
    new THREE.BoxGeometry(0.3, 0.3, 0.3).translate(0, 2.1, -0.1),
  ]);
  const sm = new THREE.Mesh(scope, M.metal);
  sm.position.set(1.5, 0.6, 1.2);
  g.add(sm);
  g.children.forEach((c) => (c.castShadow = true));
  g.position.set(f.x + f.cos * d, ground(f, d), f.z + f.sin * d);
  // Face away from the road, toward the view.
  g.rotation.y = -f.h + (d < 0 ? -Math.PI / 2 : Math.PI / 2);
  group.add(g);
}

export function buildSummit(group, T, ft, sStart, sEnd, ctx) {
  init();
  const ground = ctx.heightAt;
  lake(group, T, ft, sStart, sEnd);
  const inChunk = (s) => s >= sStart && s < sEnd;
  const span = ft.sum1 - ft.sum0;
  [0.12, 0.24, 0.76, 0.88].forEach((t, i) => {
    const s = ft.sum0 + span * t;
    if (inChunk(s)) bunting(group, T, s, i * 2);
  });
  const sc = (ft.sum0 + ft.sum1) / 2;
  if (inChunk(sc)) viewpoint(group, T, sc, -ft.lakeSide * 21, ground);
  const rng = mulberry32(Math.floor(ft.s0) + Math.floor(sStart));
  const f = {};
  for (let s = Math.ceil(sStart / 37) * 37; s < sEnd; s += 37) {
    if (s < ft.sum0 + 40 || s > ft.sum1 - 40 || hash2(s, 5) < 0.45) continue;
    T.frame(s, f);
    const d = ft.lakeSide * (HALF_W + 9 + rng() * 10);
    cairn(group, f.x + f.cos * d, ground(f, d), f.z + f.sin * d, rng);
  }
}
