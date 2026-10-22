import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { mulberry32 } from './math.js';

// Low-poly scenery. Every prop is a list of parts [geometry, materialKey];
// the world places them as InstancedMeshes, one per part per chunk.

const prep = (g) => (g.index ? g.toNonIndexed() : g);
function merge(list) {
  const m = mergeGeometries(list.map(prep));
  m.userData.shared = true;
  return m;
}
const shared = (g) => ((g.userData.shared = true), g);
const cyl = (rt, rb, h, seg, x = 0, y = 0, z = 0) => new THREE.CylinderGeometry(rt, rb, h, seg).translate(x, y + h / 2, z);
const cone = (r, h, seg, x = 0, y = 0, z = 0) => new THREE.ConeGeometry(r, h, seg).translate(x, y + h / 2, z);
const ico = (r, x, y, z, detail = 0) => new THREE.IcosahedronGeometry(r, detail).translate(x, y, z);
const box = (w, h, d, x = 0, y = 0, z = 0) => new THREE.BoxGeometry(w, h, d).translate(x, y + h / 2, z);

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
  const warm = ['#ffd27a', '#ffb347', '#fff2c4', '#7af3ff', '#ff8ad8'];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const x = c * cw + cw * 0.18;
      const y = r * rh + rh * 0.22;
      const w = cw * 0.64;
      const h = rh * 0.56;
      m.fillStyle = '#3a4660';
      m.fillRect(x, y, w, h);
      if (rng() < 0.45) {
        e.fillStyle = warm[Math.floor(rng() * warm.length)];
        e.fillRect(x, y, w, h);
        m.fillStyle = '#8a8a70';
        m.fillRect(x, y, w, h);
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

export const MATS = {};
export const PROPS = {};

export function initProps() {
  const [winMap, winEmi] = windowTextures();
  Object.assign(MATS, {
    tint: new THREE.MeshStandardMaterial({ color: 0xffffff, flatShading: true, roughness: 0.9 }),
    trunk: new THREE.MeshStandardMaterial({ color: 0x7a4a2a, flatShading: true, roughness: 1 }),
    palmTrunk: new THREE.MeshStandardMaterial({ color: 0xb98d5a, flatShading: true, roughness: 1 }),
    white: new THREE.MeshStandardMaterial({ color: 0xf4f6fa, flatShading: true, roughness: 0.8 }),
    dark: new THREE.MeshStandardMaterial({ color: 0x2a2d36, metalness: 0.6, roughness: 0.4 }),
    glow: new THREE.MeshBasicMaterial({ color: new THREE.Color(2.2, 2.2, 2.2) }),
    bulb: new THREE.MeshBasicMaterial({ color: new THREE.Color(1, 0.85, 0.6) }),
    reflector: new THREE.MeshBasicMaterial({ color: new THREE.Color(1, 0.5, 0.1) }),
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

  PROPS.roundTree = {
    parts: [
      [shared(cyl(0.25, 0.4, 3.2, 6)), 'trunk'],
      [merge([ico(2.3, 0, 4.4, 0), ico(1.6, 1.2, 3.6, 0.6), ico(1.5, -1.0, 3.8, -0.5)]), 'tint'],
    ],
    minD: 13, maxD: 190, scale: [0.8, 1.7], tint: greens,
  };
  PROPS.pine = {
    parts: [
      [shared(cyl(0.22, 0.3, 1.6, 6)), 'trunk'],
      [merge([cone(2.4, 3.2, 7, 0, 1.2), cone(1.9, 2.8, 7, 0, 2.9), cone(1.3, 2.4, 7, 0, 4.5)]), 'tint'],
    ],
    minD: 13, maxD: 190, scale: [0.8, 1.9], tint: [0x2f6b4f, 0x3f7f5f],
  };
  PROPS.bush = {
    parts: [[merge([ico(1.1, 0, 0.6, 0).scale(1, 0.8, 1), ico(0.8, 0.8, 0.45, 0.3)]), 'tint']],
    minD: 11, maxD: 120, scale: [0.6, 1.5], tint: greens,
  };
  const petals = [];
  for (let i = 0; i < 7; i++) {
    const a = rng() * Math.PI * 2;
    const r = rng() * 0.9;
    petals.push(new THREE.OctahedronGeometry(0.2).translate(Math.cos(a) * r, 0.25 + rng() * 0.2, Math.sin(a) * r));
  }
  PROPS.flowers = { parts: [[merge(petals), 'tint']], minD: 10, maxD: 80, scale: [0.8, 1.6], tint: [0xff4d6d, 0xffd23f], noShadow: true };
  PROPS.rock = {
    parts: [[shared(new THREE.DodecahedronGeometry(1.2).scale(1.3, 0.8, 1).translate(0, 0.45, 0)), 'tint']],
    minD: 12, maxD: 190, scale: [0.5, 2.6], tint: [0x8a8f99, 0x9a9faa],
  };
  PROPS.cactus = {
    parts: [[merge([
      cyl(0.35, 0.42, 3.6, 7),
      cyl(0.24, 0.24, 1.1, 6, 0, 0, 0).rotateZ(Math.PI / 2).translate(0.55, 1.6, 0),
      cyl(0.24, 0.24, 1.3, 6, 1.1, 1.6, 0),
      cyl(0.22, 0.22, 0.9, 6, 0, 0, 0).rotateZ(-Math.PI / 2).translate(-0.45, 2.2, 0),
      cyl(0.22, 0.22, 0.9, 6, -0.9, 2.2, 0),
    ]), 'tint']],
    minD: 12, maxD: 160, scale: [0.8, 1.6], tint: [0x3f9b4a, 0x5aaa48, 0x2f8a40],
  };
  PROPS.mesa = {
    parts: [[merge([cyl(1, 1.2, 1, 7), cyl(0.7, 0.85, 0.35, 7, 0.1, 1, 0.05)]).scale(16, 22, 16), 'tint']],
    minD: 75, maxD: 200, scale: [0.6, 1.8], tint: [0xd9622b, 0xc2452d],
  };
  const trunk = [];
  for (let i = 0; i < 6; i++) trunk.push(cyl(0.3 - i * 0.02, 0.32 - i * 0.02, 1.25, 6, 0.045 * i * i, i * 1.2, 0));
  const leaves = [];
  for (let i = 0; i < 8; i++) {
    leaves.push(
      new THREE.BoxGeometry(0.75, 0.08, 3.4)
        .translate(0, 0, 1.7)
        .rotateX(0.5 + (i % 2) * 0.25)
        .rotateY((i / 8) * Math.PI * 2)
        .translate(1.62, 7.3, 0),
    );
  }
  PROPS.palm = {
    parts: [[merge(trunk), 'palmTrunk'], [merge(leaves), 'tint']],
    minD: 12, maxD: 90, scale: [0.9, 1.35], tint: [0x2fa84f, 0x45c060, 0x1f8f45],
  };
  PROPS.balloon = {
    parts: [
      [merge([ico(4, 0, 6.5, 0, 1).scale(1, 1.15, 1), cone(2.6, 3.2, 10, 0, 0, 0).rotateX(Math.PI).translate(0, 4.4, 0)]), 'tint'],
      [shared(box(1.2, 1, 1.2)), 'trunk'],
    ],
    minD: 40, maxD: 190, scale: [1, 1.6], lift: [30, 90], tint: [0xff3b6b, 0xffc93c, 0x3bc9ff, 0x9b5cff, 0x3ddc84], noShadow: true,
  };
  PROPS.snowman = {
    parts: [
      [merge([ico(1, 0, 1, 0, 1), ico(0.72, 0, 2.4, 0, 1), ico(0.48, 0, 3.35, 0, 1)]), 'white'],
      [merge([cyl(0.42, 0.42, 0.08, 10, 0, 3.7, 0), cyl(0.3, 0.3, 0.5, 10, 0, 3.75, 0)]), 'dark'],
      [shared(cone(0.09, 0.5, 6).rotateX(-Math.PI / 2).translate(0, 3.4, -0.6)), 'tint'],
    ],
    minD: 12, maxD: 40, scale: [0.9, 1.3], tint: [0xff8c1a],
  };
  PROPS.sailboat = {
    parts: [
      [merge([box(1.6, 0.8, 5), cyl(0.06, 0.06, 6.5, 4, 0, 0.8, 0)]), 'white'],
      [shared(cone(1.9, 5.5, 3, 0, 1.1, 0.9).scale(0.12, 1, 1)), 'tint'],
    ],
    onWater: true, minD: 60, maxD: 190, scale: [0.9, 1.6], tint: [0xff3b6b, 0xffd23f, 0xffffff, 0x3bc9ff], noShadow: true,
  };
  const bldTint = [0x8aa0c8, 0x6c7aa8, 0xb0b8d0, 0x9b8ac8, 0x5e6f9a, 0xc8a0b8];
  PROPS.bldA = { parts: [[building(12, 32, 12), 'building']], minD: 24, maxD: 150, scale: [0.8, 1.5], align: true, tint: bldTint };
  PROPS.bldB = { parts: [[building(16, 60, 16), 'building']], minD: 35, maxD: 190, scale: [0.8, 1.4], align: true, tint: bldTint };
  PROPS.bldC = { parts: [[building(10, 18, 14), 'building']], minD: 22, maxD: 120, scale: [0.8, 1.4], align: true, tint: bldTint };
  PROPS.neon = {
    parts: [
      [merge([cyl(0.15, 0.15, 6, 6, -1.8), cyl(0.15, 0.15, 6, 6, 1.8)]), 'dark'],
      [shared(box(5, 1.6, 0.25, 0, 6)), 'glow'],
    ],
    minD: 12, maxD: 22, scale: [0.9, 1.3], align: true, tint: [0xff2bd6, 0x00f0ff, 0xffe600, 0x7cff4f, 0xff6a00, 0xb84dff], noShadow: true,
  };
  // Regularly spaced roadside props (placed by the world, not randomly).
  PROPS.lamp = {
    parts: [
      [merge([cyl(0.12, 0.17, 8, 6), box(2.6, 0.12, 0.12, -1.2, 7.85)]), 'dark'],
      [shared(box(1, 0.18, 0.45, -2.35, 7.7)), 'bulb'],
    ],
  };
  PROPS.reflector = {
    parts: [
      [shared(box(0.16, 1, 0.16)), 'white'],
      [shared(box(0.18, 0.16, 0.18, 0, 0.82)), 'reflector'],
    ],
    noShadow: true,
  };
}

// Brightness of emissive scenery follows the night factor.
export function updatePropLights(night) {
  MATS.building.emissiveIntensity = 0.06 + night * 0.65;
  MATS.bulb.color.setRGB(0.6 + night * 3.0, 0.5 + night * 2.4, 0.3 + night * 1.4);
  MATS.reflector.color.setRGB(0.9 + night * 2.2, 0.4 + night * 0.9, 0.05);
}
