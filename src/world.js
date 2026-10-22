import * as THREE from 'three';
import { BIOME_BLEND, BIOME_LEN, HALF_W, STEP, biomeForSegment } from './track.js';
import { BILLBOARD, MATS, PROPS } from './props.js';
import { buildFeatures } from './features.js';
import { buildSummit, inLake, lakeLevel, passAltitude } from './summit.js';
import { clamp, fbm, hash2, lerp, mulberry32, pick, smoothstep } from './math.js';

// Streams the world in 100 m chunks: road, kerbs, terrain and instanced props.

const CS = 50; // samples per chunk
export const CHUNK_LEN = CS * STEP;
const AHEAD = 1600;
const BEHIND = 120;
const TERRAIN_COLS = [HALF_W + 1.2, HALF_W + 3, HALF_W + 6, 17, 21, 26, 32, 40, 50, 62, 76, 92, 110, 132, 156, 178, 200];
// Mountain passes reach much further so the valley far below is visible.
const PASS_COLS = [...TERRAIN_COLS, 236, 280, 335, 400, 480, 580, 700];
const FIELD_CELL = 10;
const FIELD_R = 300;

const tmpColor = new THREE.Color();
const tmpF = {};
const tmpColor2 = new THREE.Color();

function roadTexture() {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 512;
  const g = c.getContext('2d');
  g.fillStyle = '#3b3e48';
  g.fillRect(0, 0, 512, 512);
  const rng = mulberry32(3);
  for (let i = 0; i < 9000; i++) {
    const v = 50 + Math.floor(rng() * 30);
    g.fillStyle = `rgb(${v},${v + 2},${v + 8})`;
    g.fillRect(rng() * 512, rng() * 512, 2, 2);
  }
  // Tire wear darkening in the middle of each lane.
  for (const u of [1 / 6, 3 / 6, 5 / 6]) {
    const grad = g.createLinearGradient(u * 512 - 50, 0, u * 512 + 50, 0);
    grad.addColorStop(0, 'rgba(0,0,0,0)');
    grad.addColorStop(0.5, 'rgba(0,0,0,0.12)');
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grad;
    g.fillRect(u * 512 - 50, 0, 100, 512);
  }
  g.fillStyle = '#f4f4f0';
  g.fillRect(10, 0, 9, 512);
  g.fillRect(512 - 19, 0, 9, 512);
  for (const u of [1 / 3, 2 / 3]) g.fillRect(u * 512 - 4, 0, 8, 190);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

function kerbTexture() {
  const c = document.createElement('canvas');
  c.width = 32;
  c.height = 64;
  const g = c.getContext('2d');
  g.fillStyle = '#e8203a';
  g.fillRect(0, 0, 32, 32);
  g.fillStyle = '#f6f6f6';
  g.fillRect(0, 32, 32, 32);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.magFilter = THREE.NearestFilter;
  return t;
}

function bannerTexture(top, title, accent) {
  const c = document.createElement('canvas');
  c.width = 1024;
  c.height = 192;
  const g = c.getContext('2d');
  const grad = g.createLinearGradient(0, 0, 1024, 0);
  grad.addColorStop(0, accent[0]);
  grad.addColorStop(1, accent[1]);
  g.fillStyle = grad;
  g.fillRect(0, 0, 1024, 192);
  g.strokeStyle = 'rgba(255,255,255,0.9)';
  g.lineWidth = 10;
  g.strokeRect(8, 8, 1008, 176);
  g.textAlign = 'center';
  g.fillStyle = '#fff';
  g.shadowColor = 'rgba(0,0,0,0.45)';
  g.shadowBlur = 12;
  g.font = '700 34px Orbitron, "Arial Black", sans-serif';
  g.fillText(top, 512, 56);
  g.font = '900 84px Orbitron, "Arial Black", sans-serif';
  g.fillText(title.toUpperCase(), 512, 150, 980);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

// Generic strip mesh: rows along the road, columns across it (left to right).
function makeStrip(nRows, nCols, fill, { colors = false, uvs = false } = {}) {
  const n = nRows * nCols;
  const pos = new Float32Array(n * 3);
  const col = colors ? new Float32Array(n * 3) : null;
  const uv = uvs ? new Float32Array(n * 2) : null;
  const v = { x: 0, y: 0, z: 0, r: 1, g: 1, b: 1, u: 0, w: 0 };
  for (let k = 0; k < nRows; k++) {
    for (let j = 0; j < nCols; j++) {
      fill(k, j, v);
      const i = k * nCols + j;
      pos[i * 3] = v.x;
      pos[i * 3 + 1] = v.y;
      pos[i * 3 + 2] = v.z;
      if (col) {
        col[i * 3] = v.r;
        col[i * 3 + 1] = v.g;
        col[i * 3 + 2] = v.b;
      }
      if (uv) {
        uv[i * 2] = v.u;
        uv[i * 2 + 1] = v.w;
      }
    }
  }
  const idx = [];
  for (let k = 0; k < nRows - 1; k++) {
    for (let j = 0; j < nCols - 1; j++) {
      const a = k * nCols + j;
      const b = a + 1;
      const c = a + nCols;
      const d = c + 1;
      idx.push(a, b, c, b, d, c);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  if (col) geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  if (uv) geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  return geo;
}

export class World {
  constructor(scene, track) {
    this.scene = scene;
    this.track = track;
    this.chunks = new Map();
    this.roadMat = new THREE.MeshStandardMaterial({ map: roadTexture(), roughness: 0.85, metalness: 0.05 });
    this.kerbMat = new THREE.MeshStandardMaterial({ map: kerbTexture(), roughness: 0.7 });
    // Double-sided: on passes you can look at the back of another leg's mountainside.
    this.terrainMat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true, side: THREE.DoubleSide });
    this.pillarMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.4, metalness: 0.3 });
    this.railMat = new THREE.MeshStandardMaterial({ color: 0xc8d0dc, metalness: 0.75, roughness: 0.3, side: THREE.DoubleSide });
    this.cableMat = new THREE.LineBasicMaterial({ color: 0x1a1a22 });
    this.fields = new Map();
    this.pcCache = { s: NaN, v: null };
  }

  // Mountain pass context at s: the pass, its weight and how much of the summit plateau we are on.
  passCtx(s) {
    if (this.pcCache.s === s && this.pcCache.n === this.track.passes.length) return this.pcCache.v;
    const ft = this.track.passAt(s, 30);
    let v = null;
    if (ft) {
      this.track.completePass(ft);
      const w = smoothstep(ft.s0 - 20, ft.s0 + 220, s) * (1 - (ft.open ? 0 : smoothstep(ft.s1 - 260, ft.s1, s)));
      const sum = ft.sum0 === undefined ? 0 : smoothstep(ft.sum0 - 160, ft.sum0 + 60, s) * (1 - smoothstep(ft.sum1 - 60, ft.sum1 + 160, s));
      if (w > 0) v = { ft, w, sum };
    }
    this.pcCache.s = s;
    this.pcCache.n = this.track.passes.length;
    this.pcCache.v = v;
    return v;
  }

  // Envelope that keeps a pass's terrain from burying (or undercutting) any of
  // its own road legs: around every road sample the ground must stay within a
  // cone, so the terrain between stacked switchbacks forms a proper slope.
  passField(ft) {
    let fld = this.fields.get(ft);
    if (fld) return fld;
    const T = this.track;
    T.completePass(ft);
    const i0 = Math.max(0, Math.floor((ft.s0 - 200) / STEP));
    const i1 = Math.floor((ft.s1 + 200) / STEP);
    T.ensure(i1 * STEP + 4);
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (let i = i0; i <= i1; i++) {
      x0 = Math.min(x0, T.x[i]);
      x1 = Math.max(x1, T.x[i]);
      z0 = Math.min(z0, T.z[i]);
      z1 = Math.max(z1, T.z[i]);
    }
    x0 -= FIELD_R;
    z0 -= FIELD_R;
    const nx = Math.ceil((x1 + FIELD_R - x0) / FIELD_CELL) + 1;
    const nz = Math.ceil((z1 + FIELD_R - z0) / FIELD_CELL) + 1;
    const hi = new Float32Array(nx * nz).fill(1e9);
    const lo = new Float32Array(nx * nz).fill(-1e9);
    const rc = Math.ceil(FIELD_R / FIELD_CELL);
    for (let i = i0; i <= i1; i += 4) {
      const px = T.x[i], pz = T.z[i], py = T.y[i];
      const cx = Math.round((px - x0) / FIELD_CELL);
      const cz = Math.round((pz - z0) / FIELD_CELL);
      for (let jz = Math.max(0, cz - rc); jz <= Math.min(nz - 1, cz + rc); jz++) {
        const dz = z0 + jz * FIELD_CELL - pz;
        for (let jx = Math.max(0, cx - rc); jx <= Math.min(nx - 1, cx + rc); jx++) {
          const dx = x0 + jx * FIELD_CELL - px;
          const dd = dx * dx + dz * dz;
          if (dd > FIELD_R * FIELD_R) continue;
          const dist = Math.sqrt(dd);
          const j = jz * nx + jx;
          const h = py - 0.9 + 1.15 * Math.max(0, dist - 11);
          const l = py - 1.5 - 1.05 * Math.max(0, dist - 13);
          if (h < hi[j]) hi[j] = h;
          if (l > lo[j]) lo[j] = l;
        }
      }
    }
    fld = { x0, z0, nx, nz, hi, lo };
    this.fields.set(ft, fld);
    if (this.fields.size > 3) this.fields.delete(this.fields.keys().next().value);
    return fld;
  }

  // Clamp a height to the pass envelope (bilinear lookup).
  fieldClamp(fld, wx, wz, y) {
    const gx = (wx - fld.x0) / FIELD_CELL;
    const gz = (wz - fld.z0) / FIELD_CELL;
    const ix = Math.floor(gx);
    const iz = Math.floor(gz);
    if (ix < 0 || iz < 0 || ix >= fld.nx - 1 || iz >= fld.nz - 1) return y;
    const fx = gx - ix;
    const fz = gz - iz;
    const j = iz * fld.nx + ix;
    const bil = (a) => lerp(lerp(a[j], a[j + 1], fx), lerp(a[j + fld.nx], a[j + fld.nx + 1], fx), fz);
    const h = bil(fld.hi);
    const l = bil(fld.lo);
    if (l > h) return (l + h) / 2;
    return clamp(y, l, h);
  }

  // Terrain of a mountain pass: a craggy mountainside on the uphill side, a
  // drop to the valley floor on the other, meadows and a lake at the summit.
  passHeight(f, d, wx, wz, pc) {
    const ft = pc.ft;
    const ad = Math.abs(d);
    const side = d < 0 ? -1 : 1;
    const a = clamp((f.u || 0) * side, -1, 1);
    const nA = fbm(wx * 0.0045 + 11, wz * 0.0045 - 7, 4);
    const nB = fbm(wx * 0.013 - 3, wz * 0.013 + 5, 3);
    const ledge = 19 + pc.sum * (a > 0 ? 100 : 6);
    const meadow = f.y - 0.12 + smoothstep(HALF_W + 4, 60, ad) * (nB - 0.4) * 7;
    const t = Math.max(0, ad - ledge);
    // Fine crags fade out with distance: far columns are too sparse to carry them (they turn into slivers).
    const crag = (Math.pow(nB, 2) * 26 * smoothstep(0, 60, t) + fbm(wx * 0.05, wz * 0.05, 2) * 6 * smoothstep(5, 40, t)) * (1 - smoothstep(110, 240, ad));
    // Steep near the road, leveling off into a ridge a few hundred meters up.
    const rise = 280 * (1 - Math.exp((-t * (0.5 + 0.45 * nA)) / 280));
    // Far away every leg's mountainside converges on one shared massif, so
    // terrain from different switchbacks agrees instead of forming loose sheets.
    // The massif is a world-space height field shared by all legs.
    const ridge = ft.base + 20 + (ft.top - ft.base + 140) * smoothstep(0.28, 0.78, fbm(wx * 0.0022 + 3, wz * 0.0022 - 8, 4));
    const far = smoothstep(120, 460, t);
    const up = lerp(meadow + rise + crag + Math.pow(smoothstep(60, 520, t), 1.3) * nA * 110, ridge, far);
    const floorY = ft.base - 10 + fbm(wx * 0.003, wz * 0.003, 3) * 34;
    const dn = Math.max(floorY, meadow - t * (0.62 + 0.45 * nA) + crag * 0.4);
    const mid = lerp(meadow + smoothstep(40, 300, ad) * (20 + nA * 100) + crag * 0.5, ridge, smoothstep(160, 560, ad) * 0.8);
    let y = a >= 0 ? lerp(mid, up, a) : lerp(mid, dn, -a);
    // The outermost columns fall back to the valley, giving far ridges a back side.
    y = lerp(y, floorY, smoothstep(560, 700, ad));
    if (pc.sum > 0 && side === ft.lakeSide) {
      const e = inLake(ft, f.s, ad);
      if (e < 1.6) {
        const lakeY = lakeLevel(ft);
        y = e < 1 ? Math.min(y, lakeY - 0.6 - 4.5 * (1 - e)) : lerp(lakeY + 0.35 + (e - 1) * 2, y, smoothstep(1.15, 1.6, e));
      }
    }
    return y;
  }

  setTrack(track) {
    for (const ch of this.chunks.values()) this.disposeChunk(ch);
    this.chunks.clear();
    this.track = track;
  }

  update(s, maxBuild = 2) {
    const c0 = Math.max(0, Math.floor((s - BEHIND) / CHUNK_LEN));
    const c1 = Math.floor((s + AHEAD) / CHUNK_LEN);
    for (const [c, ch] of this.chunks) {
      if (c < c0 || c > c1) {
        this.disposeChunk(ch);
        this.chunks.delete(c);
      }
    }
    let built = 0;
    for (let c = c0; c <= c1 && built < maxBuild; c++) {
      if (this.chunks.has(c)) continue;
      const ch = this.buildChunk(c);
      this.chunks.set(c, ch);
      this.scene.add(ch);
      built++;
    }
  }

  // Turn wind turbine rotors.
  animate(time) {
    const m = new THREE.Matrix4();
    const r = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const e = new THREE.Euler();
    const p = new THREE.Vector3();
    const sc = new THREE.Vector3();
    for (const ch of this.chunks.values()) {
      for (const mesh of ch.userData.spinners || []) {
        const sp = mesh.userData.spin;
        sp.list.forEach((it, i) => {
          const cos = Math.cos(it.yaw);
          const sin = Math.sin(it.yaw);
          const hz = sp.z * it.scale;
          p.set(it.x + sin * hz, it.y + sp.y * it.scale, it.z + cos * hz);
          q.setFromEuler(e.set(0, it.yaw, 0));
          sc.setScalar(it.scale);
          m.compose(p, q, sc).multiply(r.makeRotationZ(time * sp.speed + sp.phase + i));
          mesh.setMatrixAt(i, m);
        });
        mesh.instanceMatrix.needsUpdate = true;
      }
    }
  }

  disposeChunk(ch) {
    this.scene.remove(ch);
    ch.traverse((o) => {
      if (o.isInstancedMesh) o.dispose();
      if (o.geometry && !o.geometry.userData.shared) o.geometry.dispose();
      if (o.material && o.material.userData.owned) {
        o.material.map?.dispose();
        o.material.dispose();
      }
    });
  }

  // How set pieces reshape the land at distance s.
  mods(s) {
    const m = { drop: 0, lid: 0, cliff: 0, gorge: 0, calm: 0 };
    for (const ft of this.track.featuresIn(s - 130, s + 130)) {
      if (ft.type === 'bridge') m.drop = Math.max(m.drop, ft.depth * smoothstep(ft.s0, ft.s0 + 45, s) * smoothstep(ft.s1, ft.s1 - 45, s));
      else if (ft.type === 'tunnel') {
        if (s >= ft.s0 && s <= ft.s1) m.lid = 1;
        const c = s < ft.s0 ? smoothstep(ft.s0 - 120, ft.s0, s) : s > ft.s1 ? smoothstep(ft.s1 + 120, ft.s1, s) : 1;
        m.cliff = Math.max(m.cliff, c);
      } else if (ft.type === 'gorge') m.gorge = Math.max(m.gorge, smoothstep(ft.s0, ft.s0 + 90, s) * smoothstep(ft.s1, ft.s1 - 90, s));
      else if (ft.type !== 'sign' && ft.type !== 'pass') m.calm = Math.max(m.calm, smoothstep(ft.s0 - 70, ft.s0, s) * smoothstep(ft.s1 + 70, ft.s1, s));
    }
    return m;
  }

  // Terrain height at lateral offset d for a track frame. dShape is the
  // uncompressed offset used for the valley-wall profile on tight curves.
  heightAt(f, d, bw, water, mods = this.mods(f.s), dShape = d) {
    const wx = f.x + f.cos * d;
    const wz = f.z + f.sin * d;
    const ad = Math.abs(d);
    const hills = lerp(bw.a.hills, bw.b.hills, bw.t);
    const wall = lerp(bw.a.wall, bw.b.wall, bw.t);
    const n1 = fbm(wx * 0.006, wz * 0.006, 3);
    const n2 = fbm(wx * 0.0025 + 50, wz * 0.0025 - 20, 3);
    const near = smoothstep(HALF_W + 4, 70, ad);
    let y = f.y - 0.12 + near * n1 * hills;
    const wallY = Math.pow(smoothstep(70, 200, Math.abs(dShape)), 1.6) * wall * (0.45 + n2);
    if (bw.coastW > 0 && d < 0) {
      const drop = smoothstep(HALF_W + 8, 50, ad);
      const beach = lerp(f.y - 0.12 + near * n1 * 2, water - 4, drop);
      y = lerp(y + wallY, beach, bw.coastW);
    } else {
      y += wallY;
    }
    const pc = this.passCtx(f.s);
    if (pc) {
      let py = this.passHeight(f, d, wx, wz, pc);
      if (ad > 16) py = lerp(py, this.fieldClamp(this.passField(pc.ft), wx, wz, py), smoothstep(16, 30, ad));
      y = lerp(y, py, pc.w);
    }
    if (mods.calm > 0) y = lerp(y, f.y - 0.12 + near * n1 * 2, mods.calm * 0.75);
    if (mods.gorge > 0 && ad > 14) y = Math.max(y, f.y + mods.gorge * (6 + 62 * smoothstep(14, 30, ad) + n2 * 28 + fbm(wx * 0.06, wz * 0.06, 2) * 9));
    if (mods.cliff > 0 && ad > HALF_W + 2.5) y = Math.max(y, f.y + mods.cliff * (27 + n1 * 14 + smoothstep(30, 120, ad) * 25));
    if (mods.drop > 0.3) y = Math.min(y, f.y - mods.drop + n1 * 5);
    return y;
  }

  groundColor(f, d, y, bw, water, out) {
    const wx = f.x + f.cos * d;
    const wz = f.z + f.sin * d;
    const ad = Math.abs(d);
    const n = fbm(wx * 0.02, wz * 0.02, 2);
    tmpColor.setHex(bw.a.ground[0]).lerp(tmpColor2.setHex(bw.a.ground[1]), n);
    const cb = new THREE.Color(bw.b.ground[0]).lerp(tmpColor2.setHex(bw.b.ground[1]), n);
    out.copy(tmpColor).lerp(cb, bw.t);
    const shoulder = tmpColor.setHex(bw.a.shoulder).lerp(tmpColor2.setHex(bw.b.shoulder), bw.t);
    out.lerp(shoulder, 1 - smoothstep(HALF_W + 2, HALF_W + 7, ad));
    // Exposed rock on steep valley walls, snow caps up high, wet sand near the sea.
    const rel = y - f.y;
    const rockC = tmpColor.setHex(bw.a.rock).lerp(tmpColor2.setHex(bw.b.rock), bw.t);
    const strata = 0.75 + 0.25 * Math.sin(y * 0.35 + n * 3);
    out.lerp(rockC.multiplyScalar(strata), Math.max(smoothstep(95, 165, ad) * smoothstep(8, 30, rel) * 0.75, smoothstep(4, 14, rel) * smoothstep(HALF_W + 2, 16, ad) * 0.85));
    if (rel > 60) out.lerp(tmpColor.setRGB(0.95, 0.97, 1), smoothstep(60, 110, rel) * 0.8);
    if (bw.coastW > 0 && d < 0 && y < water + 1.5) out.lerp(tmpColor.setHex(0xc9a86a), 0.6 * bw.coastW);
    const pc = this.passCtx(f.s);
    if (pc) this.passColor(f, d, y, n, pc, bw, out);
    const jitter = 0.9 + hash2(Math.floor(wx * 0.3), Math.floor(wz * 0.3)) * 0.18;
    out.multiplyScalar(jitter);
    return out;
  }

  // Pass colors by altitude: lush valley, alpine meadow, bare rock on steep
  // faces and snow on the high crags (everything white on a snowy pass).
  passColor(f, d, y, n, pc, bw, out) {
    const ft = pc.ft;
    const ad = Math.abs(d);
    const alt = (y - ft.base) / Math.max(1, ft.top - ft.base);
    const c = tmpColor.copy(out);
    const shoulder = smoothstep(HALF_W + 2, HALF_W + 7, ad);
    if (!ft.snowy) c.lerp(tmpColor2.setHex(0xa9c95a), smoothstep(0.45, 1.0, alt) * 0.55 * shoulder);
    const ledge = 19 + pc.sum * 6;
    const steep = Math.abs(y - f.y) / Math.max(6, ad - Math.min(ledge, 40));
    const rockC = tmpColor2.setHex(bw.a.rock).lerp(new THREE.Color(bw.b.rock), bw.t).multiplyScalar(0.8 + 0.25 * Math.sin(y * 0.3 + n * 4));
    c.lerp(rockC, smoothstep(0.55, 0.95, steep + (n - 0.5) * 0.5) * 0.85 * shoulder);
    const snowLine = ft.snowy ? 0.15 : 1.08 + (n - 0.5) * 0.5;
    const patch = ft.snowy ? 1 : smoothstep(0.35, 0.6, fbm(f.x * 0.01 + d * 0.013, f.z * 0.01 - d * 0.009, 3) + (alt - snowLine) * 0.6);
    c.lerp(tmpColor2.setRGB(0.95, 0.97, 1), smoothstep(snowLine, snowLine + 0.18, alt) * patch * (ft.snowy ? 0.85 : 0.95) * (1 - 0.6 * smoothstep(0.8, 1.2, steep)));
    out.lerp(c, pc.w);
  }

  buildChunk(c) {
    const T = this.track;
    const i0 = c * CS;
    const sStart = i0 * STEP;
    const sEnd = (i0 + CS) * STEP;
    T.ensure(sEnd + 650); // plan ahead so features and their warning signs are known
    const group = new THREE.Group();
    const rows = CS + 1;
    const frames = [];
    const blends = [];
    for (let k = 0; k < rows; k++) {
      const s = (i0 + k) * STEP;
      frames.push(T.frame(s, {}));
      blends.push(T.blend(s));
    }
    const mods = frames.map((f) => this.mods(f.s));
    const coastSeg = T.coastSegmentNear(sStart);
    const water = coastSeg >= 0 ? T.waterLevel(coastSeg) : -1e6;

    // Road surface.
    const road = new THREE.Mesh(
      makeStrip(rows, 2, (k, j, v) => {
        const f = frames[k];
        const d = j ? HALF_W : -HALF_W;
        v.x = f.x + f.cos * d;
        v.y = T.roadY(f, d) + 0.02;
        v.z = f.z + f.sin * d;
        v.u = j;
        v.w = f.s / 20;
      }, { uvs: true }),
      this.roadMat,
    );
    road.receiveShadow = true;
    group.add(road);

    // Kerbs.
    for (const side of [-1, 1]) {
      const inner = HALF_W * side;
      const outer = (HALF_W + 1.3) * side;
      const kerb = new THREE.Mesh(
        makeStrip(rows, 2, (k, j, v) => {
          const f = frames[k];
          const d = side < 0 ? (j ? inner : outer) : j ? outer : inner;
          v.x = f.x + f.cos * d;
          v.y = T.roadY(f, d) + 0.06;
          v.z = f.z + f.sin * d;
          v.u = j;
          v.w = f.s / 8;
        }, { uvs: true }),
        this.kerbMat,
      );
      kerb.receiveShadow = true;
      group.add(kerb);
    }

    // Terrain, one strip per side.
    const inPass = !!(this.track.passAt(sStart, 400) || this.track.passAt(sEnd, 400));
    const COLS = inPass ? PASS_COLS : TERRAIN_COLS;
    const cols = COLS.length;
    const dMax = COLS[cols - 1];
    // Per row: strongest left/right curvature within reach of the far columns.
    const kWin = frames.map((f) => {
      const w = [0, 0];
      if (dMax <= 200) return w;
      for (let ds = -360; ds <= 360; ds += 12) {
        const k = T.frame(f.s + ds, tmpF).k;
        const fade = 1 - Math.abs(ds) / 420;
        if (k < 0) w[0] = Math.max(w[0], -k * fade);
        else w[1] = Math.max(w[1], k * fade);
      }
      return w;
    });
    const col = new THREE.Color();
    for (const side of [-1, 1]) {
      const geo = makeStrip(rows, cols, (k, j, v) => {
        const f = frames[k];
        const bw = blends[k];
        const dShape = side < 0 ? -COLS[cols - 1 - j] : COLS[j];
        // On the inside of tight curves, squeeze the terrain so it never folds over itself.
        let d = dShape;
        const maxInner = f.k !== 0 ? 0.8 / Math.abs(f.k) : 1e9;
        if (Math.sign(f.k) === side && maxInner < Math.min(dMax, 200) && Math.abs(d) > 20) d = side * (20 + (Math.abs(d) - 20) * Math.max(0.2, (maxInner - 20) / 180));
        // Far pass columns: honor the tightest same-side curve nearby, or rows would cross.
        // The outside of hairpins is squeezed more gently, so it doesn't fan out into feathery slivers.
        if (dMax > 200 && Math.abs(d) > 20) {
          const w = kWin[k];
          const reach = Math.min(0.8 / Math.max(1e-6, w[side < 0 ? 0 : 1]), 2.5 / Math.max(1e-6, w[side < 0 ? 1 : 0]));
          if (reach < dMax) d = side * (20 + (Math.abs(dShape) - 20) * clamp((reach - 20) / (dMax - 20), 0.03, 1));
        }
        const m = mods[k];
        const edge = j === (side < 0 ? cols - 1 : 0);
        let y;
        if (edge && m.lid) y = f.y + 23.5;
        else if (edge && m.drop <= 0.3) y = T.roadY(f, d) - 0.05;
        else y = this.heightAt(f, d, bw, water, m, dShape);
        v.x = f.x + f.cos * d;
        v.y = y;
        v.z = f.z + f.sin * d;
        this.groundColor(f, d, y, bw, water, col);
        v.r = col.r;
        v.g = col.g;
        v.b = col.b;
      }, { colors: true });
      const mesh = new THREE.Mesh(geo, this.terrainMat);
      mesh.receiveShadow = true;
      mesh.castShadow = mods.some((m) => m.lid || m.cliff > 0.5);
      group.add(mesh);
    }

    // Mountain lid over tunnel sections, closing the gap above the road.
    const lidRows = [];
    mods.forEach((m, k) => m.lid && lidRows.push(k));
    if (lidRows.length > 1) {
      const lid = new THREE.Mesh(
        makeStrip(lidRows.length, 2, (k, j, v) => {
          const f = frames[lidRows[k]];
          const d = j ? HALF_W + 1.2 : -(HALF_W + 1.2);
          v.x = f.x + f.cos * d;
          v.y = f.y + 23.5;
          v.z = f.z + f.sin * d;
          this.groundColor(f, d, f.y + 23.5, blends[lidRows[k]], water, col);
          v.r = col.r;
          v.g = col.g;
          v.b = col.b;
        }, { colors: true }),
        this.terrainMat,
      );
      lid.castShadow = true;
      lid.receiveShadow = true;
      group.add(lid);
    }

    this.placeProps(group, c, sStart, sEnd, water);
    this.placeGates(group, sStart, sEnd);
    const pft = this.track.passAt(sStart, 200);
    if (pft && pft.sum0 !== undefined) buildSummit(group, T, pft, sStart, sEnd, { heightAt: (f, d) => this.heightAt(f, d, T.blend(f.s), water) });
    buildFeatures(group, T, sStart, sEnd, { heightAt: (f, d) => this.heightAt(f, d, T.blend(f.s), water) });
    return group;
  }

  placeProps(group, c, sStart, sEnd, water) {
    const T = this.track;
    const rng = mulberry32((c + 1) * 7919 + T.seed * 13);
    const bw0 = T.blend(sStart);
    const items = {};
    const add = (type, x, y, z, yaw, scale, color) => (items[type] ||= []).push({ x, y, z, yaw, scale, color, r: rng() });
    const f = {};

    for (const biome of new Set([bw0.a, bw0.b])) {
      for (const [type, density] of Object.entries(biome.props)) {
        const def = type === 'billboard' ? BILLBOARD : PROPS[type];
        const count = Math.round(density * (CHUNK_LEN / 100) * (0.7 + rng() * 0.6));
        const palette = biome.tints[type] || def.tint;
        for (let n = 0; n < count; n++) {
          const s = sStart + rng() * CHUNK_LEN;
          const bw = T.blend(s);
          const w = biome === bw.a ? 1 - bw.t : biome === bw.b ? bw.t : 0;
          if (rng() > w) continue;
          let side = rng() < 0.5 ? -1 : 1;
          if (def.onWater) side = -1;
          const d = side * (def.minD + Math.pow(rng(), 1.4) * (def.maxD - def.minD));
          T.frame(s, f);
          if (Math.sign(d) === Math.sign(f.k) && Math.abs(d) > 0.8 / Math.abs(f.k || 1e-9) - 6) continue;
          if ((def.align || def.faceTraffic) && Math.abs(d) < 60 && this.mods(s).gorge > 0.2) continue;
          const y = this.heightAt(f, d, bw, water);
          const pc = this.passCtx(s);
          if (pc) {
            const band = biome.bands?.[type];
            const alt = (y - pc.ft.base) / Math.max(1, pc.ft.top - pc.ft.base);
            if (band && (alt < band[0] || alt > band[1])) continue;
            if (pc.sum > 0 && Math.sign(d) === pc.ft.lakeSide && inLake(pc.ft, s, Math.abs(d)) < 1.5) continue;
          }
          const seaSide = bw.coastW > 0.3 && d < 0;
          if (def.onWater) {
            if (bw.coastW < 0.9 || y > water - 1.5) continue;
          } else if (seaSide && y < water + 0.6) continue;
          if (def.beach && !(seaSide && y > water + 0.3)) continue;
          const lift = def.lift ? def.lift[0] + rng() * (def.lift[1] - def.lift[0]) : 0;
          const yaw = def.faceTraffic ? -f.h - side * 0.35 : def.align ? -f.h + (side < 0 ? Math.PI : 0) : rng() * Math.PI * 2;
          const sc = def.scale[0] + rng() * (def.scale[1] - def.scale[0]);
          add(def.variants ? def.variants[Math.floor(rng() * def.variants.length)] : type, f.x + f.cos * d, def.onWater ? water : y + lift, f.z + f.sin * d, yaw, sc, palette ? pick(rng, palette) : 0xffffff);
        }
      }
    }

    // Regular roadside posts: lamps or reflectors depending on the biome.
    const spacing = { lamp: 40, reflector: 30 };
    for (const type of ['lamp', 'reflector']) {
      const sp = spacing[type];
      for (let s = Math.ceil(sStart / sp) * sp; s < sEnd; s += sp) {
        const bw = T.blend(s);
        const biome = bw.t > 0.5 ? bw.b : bw.a;
        if (biome.posts !== type || this.covered(s)) continue;
        T.frame(s, f);
        for (const side of [-1, 1]) {
          const d = side * (HALF_W + (type === 'lamp' ? 2.6 : 2.0));
          add(type, f.x + f.cos * d, T.roadY(f, d) - 0.05, f.z + f.sin * d, -f.h + (side < 0 ? Math.PI : 0), 1, 0xffffff);
        }
      }
    }

    this.placeRoadside(group, sStart, sEnd, add, rng);

    // Villages: rows of houses facing the road.
    for (const ft of T.featuresIn(sStart, sEnd)) {
      if (ft.type !== 'village') continue;
      for (let s = Math.max(sStart, ft.s0); s < Math.min(sEnd, ft.s1); s += 18 + rng() * 14) {
        T.frame(s, f);
        const side = rng() < 0.5 ? -1 : 1;
        const d = side * (22 + rng() * 14);
        const bw = T.blend(s);
        add('house', f.x + f.cos * d, this.heightAt(f, d, bw, water), f.z + f.sin * d, -f.h + (side < 0 ? Math.PI / 2 : -Math.PI / 2), 0.9 + rng() * 0.3, 0xffffff);
      }
    }

    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const e = new THREE.Euler();
    const p = new THREE.Vector3();
    const sc = new THREE.Vector3();
    for (const [type, list] of Object.entries(items)) {
      const def = PROPS[type];
      for (const [geo, matKey, palette, opts] of def.parts) {
        const mesh = new THREE.InstancedMesh(geo, MATS[matKey], list.length);
        const tinted = matKey === 'tint' || matKey === 'foliage' || matKey === 'glow' || matKey === 'building';
        list.forEach((it, i) => {
          p.set(it.x, it.y, it.z);
          q.setFromEuler(e.set(0, it.yaw, 0));
          sc.setScalar(it.scale);
          mesh.setMatrixAt(i, m.compose(p, q, sc));
          if (tinted) mesh.setColorAt(i, tmpColor.setHex(palette ? palette[Math.floor(it.r * palette.length)] : it.color));
        });
        if (opts?.spin) {
          mesh.userData.spin = { ...opts.spin, list, phase: rng() * 6 };
          group.userData.spinners ||= [];
          group.userData.spinners.push(mesh);
        }
        mesh.castShadow = !def.noShadow && matKey !== 'glow';
        mesh.receiveShadow = matKey !== 'glow' && matKey !== 'bulb';
        mesh.computeBoundingSphere();
        group.add(mesh);
      }
    }
  }

  // Inside a tunnel or on a bridge: no roadside posts, rails or signs of our own.
  covered(s) {
    return !!(this.track.featureAt(s, 'tunnel', 8) || this.track.featureAt(s, 'bridge', 8));
  }

  // Fences, power lines, guardrails and curve chevrons.
  placeRoadside(group, sStart, sEnd, add, rng) {
    const T = this.track;
    const f = {};
    const mid = T.blend((sStart + sEnd) / 2);
    const biome = mid.t > 0.5 ? mid.b : mid.a;
    const rs = biome.roadside || {};

    if (rs.fence) {
      for (let s = Math.ceil(sStart / 4) * 4; s < sEnd; s += 4) {
        if (fbm(s * 0.004, 7.3, 2) < 0.48 || this.track.featureAt(s, 'village', 30) || this.covered(s)) continue;
        T.frame(s, f);
        for (const side of [-1, 1]) {
          const d = side * (HALF_W + 6.5);
          add('fence', f.x + f.cos * d, this.heightAt(f, d, T.blend(s), -1e6), f.z + f.sin * d, -f.h, 1, 0xffffff);
        }
      }
    }

    if (rs.power) {
      const tops = [];
      for (let s = Math.ceil(sStart / 45) * 45; s <= sEnd; s += 45) {
        if (this.covered(s) || this.mods(s).gorge > 0.1) {
          tops.push(null); // gap in the line
          continue;
        }
        T.frame(s, f);
        const d = HALF_W + 11;
        const y = this.heightAt(f, d, T.blend(s), -1e6);
        add('powerPole', f.x + f.cos * d, y, f.z + f.sin * d, -f.h, 1, 0xffffff);
        tops.push({ x: f.x + f.cos * d, y: y + 10.3, z: f.z + f.sin * d, cos: f.cos, sin: f.sin });
      }
      const pts = [];
      for (let i = 0; i < tops.length - 1; i++) {
        const a = tops[i];
        const b = tops[i + 1];
        if (!a || !b) continue;
        for (const off of [-1.4, 1.4]) {
          for (let k = 0; k < 8; k++) {
            for (const kk of [k, k + 1]) {
              const t = kk / 8;
              const sag = Math.sin(t * Math.PI) * 1.2;
              pts.push(
                a.x + (b.x - a.x) * t + (a.cos + (b.cos - a.cos) * t) * off,
                a.y + (b.y - a.y) * t - sag,
                a.z + (b.z - a.z) * t + (a.sin + (b.sin - a.sin) * t) * off,
              );
            }
          }
        }
      }
      if (pts.length) {
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
        group.add(new THREE.LineSegments(g, this.cableMat));
      }
    }

    if (rs.rails && !this.covered(sStart) && !this.covered(sEnd)) {
      const sides = rs.rails === 'sea' ? [-1] : [-1, 1];
      for (const side of sides) {
        const d = side * (HALF_W + 1.9);
        const rows = Math.round((sEnd - sStart) / STEP) + 1;
        const geo = makeStrip(rows, 2, (k, j, v) => {
          T.frame(sStart + k * STEP, f);
          v.x = f.x + f.cos * d;
          v.y = T.roadY(f, d) + (j ? 0.78 : 0.42);
          v.z = f.z + f.sin * d;
        });
        const rail = new THREE.Mesh(geo, this.railMat);
        rail.castShadow = true;
        group.add(rail);
        for (let s = Math.ceil(sStart / 4) * 4; s < sEnd; s += 4) {
          T.frame(s, f);
          add('railPost', f.x + f.cos * (d + side * 0.12), T.roadY(f, d), f.z + f.sin * (d + side * 0.12), -f.h, 1, 0xffffff);
        }
      }
    }

    // Chevrons on the outside of sharp curves.
    for (let s = Math.ceil(sStart / 22) * 22; s < sEnd; s += 22) {
      T.frame(s, f);
      if (Math.abs(f.k) < 0.0019 || this.covered(s)) continue;
      const side = f.k > 0 ? -1 : 1;
      const d = side * (HALF_W + (rs.rails ? 3.0 : 2.4));
      add(f.k > 0 ? 'chevR' : 'chevL', f.x + f.cos * d, T.roadY(f, d), f.z + f.sin * d, -f.h, 1, 0xffffff);
    }
  }

  // Arches announcing each new biome, plus the start line.
  placeGates(group, sStart, sEnd) {
    const T = this.track;
    const gates = [];
    if (sStart <= 70 && sEnd > 70) gates.push({ s: 70, top: 'DAY ONE', title: 'Start', accent: ['#ff2a6d', '#ffb800'] });
    const seg = Math.floor(sEnd / BIOME_LEN) + 1;
    for (const n of [seg - 1, seg]) {
      const gs = n * BIOME_LEN - BIOME_BLEND / 2;
      if (n >= 1 && gs >= sStart && gs < sEnd && biomeForSegment(n) !== biomeForSegment(n - 1)) {
        const b = biomeForSegment(n);
        gates.push({ s: gs, top: 'NOW ENTERING', title: b.name, accent: b.accent });
      }
    }
    const pft = T.passAt(sStart, 50);
    if (pft && pft.sum0 !== undefined && pft.sum0 + 30 >= sStart && pft.sum0 + 30 < sEnd) {
      const accent = biomeForSegment(Math.floor(pft.s0 / BIOME_LEN)).accent;
      gates.push({ s: pft.sum0 + 30, top: `SUMMIT · ${passAltitude(pft, pft.top).toLocaleString('en-US')} M`, title: pft.name, accent });
    }
    for (const gdef of gates) {
      const f = T.frame(gdef.s, {});
      const gate = new THREE.Group();
      const pillarGeo = new THREE.BoxGeometry(1.2, 9.5, 1.2).translate(0, 4.75, 0);
      for (const side of [-1, 1]) {
        const p = new THREE.Mesh(pillarGeo, this.pillarMat);
        p.position.x = side * (HALF_W + 2.6);
        p.castShadow = true;
        gate.add(p);
      }
      const mat = new THREE.MeshBasicMaterial({ map: bannerTexture(gdef.top, gdef.title, gdef.accent), side: THREE.DoubleSide });
      mat.userData.owned = true;
      const banner = new THREE.Mesh(new THREE.PlaneGeometry(HALF_W * 2 + 6.4, 3.4), mat);
      banner.position.y = 8.2;
      gate.add(banner);
      gate.position.set(f.x, f.y, f.z);
      gate.rotation.y = -f.h;
      group.add(gate);
    }
  }
}
