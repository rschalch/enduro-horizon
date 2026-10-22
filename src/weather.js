import * as THREE from 'three';
import { mulberry32 } from './math.js';

// Falling particles that live in a box around the camera: snow, sakura petals
// or autumn leaves depending on the biome.

const TYPES = {
  snow: { colors: [0xffffff, 0xeef4ff], size: 0.32, fall: 5, sway: 1.2 },
  petals: { colors: [0xffb7d5, 0xff8fbf, 0xffe0ee], size: 0.36, fall: 1.8, sway: 2.6 },
  leaves: { colors: [0xff7b1c, 0xe8471c, 0xffb627, 0xc9302c], size: 0.42, fall: 2.4, sway: 2.2 },
};
const N = 3200;
const HALF = [45, 28, 60];

function flakeTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 32;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(16, 16, 0, 16, 16, 16);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.5, 'rgba(255,255,255,0.85)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 32, 32);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export class Weather {
  constructor(scene) {
    this.rng = mulberry32(5);
    this.pos = new Float32Array(N * 3);
    this.col = new Float32Array(N * 3);
    this.phase = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      for (let a = 0; a < 3; a++) this.pos[i * 3 + a] = (this.rng() * 2 - 1) * HALF[a];
      this.phase[i] = this.rng() * Math.PI * 2;
    }
    this.geo = new THREE.BufferGeometry();
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    this.geo.setAttribute('color', new THREE.BufferAttribute(this.col, 3));
    this.mat = new THREE.PointsMaterial({
      size: 0.35,
      map: flakeTexture(),
      vertexColors: true,
      transparent: true,
      opacity: 0,
      depthWrite: false,
    });
    this.points = new THREE.Points(this.geo, this.mat);
    this.points.frustumCulled = false;
    scene.add(this.points);
    this.type = null;
    this.time = 0;
    this.initialized = false;
  }

  setType(name) {
    this.type = name;
    const t = TYPES[name];
    const c = new THREE.Color();
    for (let i = 0; i < N; i++) {
      c.setHex(t.colors[Math.floor(this.rng() * t.colors.length)]);
      this.col.set([c.r, c.g, c.b], i * 3);
    }
    this.geo.attributes.color.needsUpdate = true;
    this.mat.size = t.size;
  }

  update(dt, camPos, wanted, weight, night = 0) {
    this.mat.color.setScalar(0.3 + (1 - night) * 0.7);
    this.time += dt;
    // Fade out before switching to a different particle type.
    if (wanted && wanted !== this.type && this.mat.opacity < 0.05) this.setType(wanted);
    const target = wanted && wanted === this.type ? weight : 0;
    this.mat.opacity += (target - this.mat.opacity) * Math.min(1, dt * 1.5);
    this.points.visible = this.mat.opacity > 0.01;
    if (!this.points.visible || !this.type) return;

    if (!this.initialized) {
      for (let i = 0; i < N; i++) {
        this.pos[i * 3] += camPos.x;
        this.pos[i * 3 + 1] += camPos.y;
        this.pos[i * 3 + 2] += camPos.z;
      }
      this.initialized = true;
    }
    const t = TYPES[this.type];
    const p = this.pos;
    const center = [camPos.x, camPos.y, camPos.z];
    for (let i = 0; i < N; i++) {
      const ph = this.phase[i];
      p[i * 3] += Math.sin(this.time * 1.3 + ph) * t.sway * dt + dt * 1.5;
      p[i * 3 + 1] -= t.fall * dt * (0.7 + 0.3 * Math.sin(ph * 3));
      p[i * 3 + 2] += Math.cos(this.time * 0.9 + ph) * t.sway * dt;
      for (let a = 0; a < 3; a++) {
        const rel = p[i * 3 + a] - center[a];
        if (rel > HALF[a]) p[i * 3 + a] -= HALF[a] * 2;
        else if (rel < -HALF[a]) p[i * 3 + a] += HALF[a] * 2;
      }
      // Flakes right in front of the lens look like giant blobs; push them away.
      const rx = p[i * 3] - center[0];
      const ry = p[i * 3 + 1] - center[1];
      const rz = p[i * 3 + 2] - center[2];
      if (rx * rx + ry * ry + rz * rz < 16) p[i * 3 + 1] = center[1] + HALF[1] * 0.9;
    }
    this.geo.attributes.position.needsUpdate = true;
  }
}
