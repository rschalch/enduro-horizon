import * as THREE from 'three';
import { clamp, mulberry32 } from './math.js';

// Dynamic weather: a small state machine that picks clear skies, clouds,
// rain, thunderstorms, snow or blizzards based on the biome, and smoothly
// drives intensities that the sky, road, particles, audio and handling read.

export const WEATHER = {
  clear: { label: 'Clear', icon: '', cloud: 0, rain: 0, snow: 0, fog: 1, wind: 0 },
  cloudy: { label: 'Overcast', icon: '☁️', cloud: 0.75, rain: 0, snow: 0, fog: 0.85, wind: 0.3 },
  rain: { label: 'Rain', icon: '🌧️', cloud: 0.9, rain: 0.75, snow: 0, fog: 0.6, wind: 0.5 },
  storm: { label: 'Thunderstorm', icon: '⛈️', cloud: 1, rain: 1, snow: 0, fog: 0.45, wind: 1, lightning: true },
  hurricane: { label: 'Hurricane', icon: '🌀', cloud: 1, rain: 1, snow: 0, fog: 0.38, wind: 2.6, lightning: true, twister: true },
  snow: { label: 'Snow', icon: '🌨️', cloud: 0.85, rain: 0, snow: 0.7, fog: 0.6, wind: 0.3 },
  blizzard: { label: 'Blizzard', icon: '❄️', cloud: 1, rain: 0, snow: 1, fog: 0.3, wind: 1 },
};

// Odds of each weather per biome key.
const ODDS = {
  meadow: { clear: 4, cloudy: 2, rain: 2.5, storm: 1, hurricane: 0.5, snow: 0.8 },
  desert: { clear: 8, cloudy: 1, rain: 0.6, storm: 0.6, hurricane: 0.4 },
  coast: { clear: 4, cloudy: 1.5, rain: 2, storm: 1.5, hurricane: 1.2 },
  sakura: { clear: 4, cloudy: 1.5, rain: 2.5, storm: 0.5, hurricane: 0.3, snow: 0.6 },
  alps: { clear: 2, cloudy: 1, snow: 4, blizzard: 2 },
  autumn: { clear: 3, cloudy: 2, rain: 3, storm: 1, hurricane: 0.5, snow: 1 },
  city: { clear: 3, cloudy: 1.5, rain: 3.5, storm: 1.5, hurricane: 0.6, snow: 0.8 },
};

export class Climate {
  constructor(forced = null) {
    this.rng = mulberry32(Date.now() & 0xffff);
    this.forced = WEATHER[forced] ? forced : null;
    this.state = this.forced || 'clear';
    this.timer = this.forced ? Infinity : 40 + this.rng() * 50;
    this.cloud = 0;
    this.rain = 0;
    this.snow = 0;
    this.fog = 1;
    this.wind = 0;
    this.wet = 0; // road wetness, lags behind rain
    this.cover = 0; // snow lying on the ground
    this.flash = 0;
    this.gust = 0;
    this.twister = 0;
    this.time = 0;
    this.nextBolt = 5;
    this.onThunder = null;
    this.onChange = null;
    if (this.forced) {
      // Testing aid (?weather=...): start fully developed.
      const w = WEATHER[this.forced];
      Object.assign(this, { cloud: w.cloud, rain: w.rain, snow: w.snow, fog: w.fog, wind: w.wind, wet: w.rain ? 1 : 0, cover: w.snow ? 0.85 : 0 });
    }
  }

  get info() {
    return WEATHER[this.state];
  }

  pick(biomeKey) {
    const odds = ODDS[biomeKey] || ODDS.meadow;
    let total = 0;
    for (const w of Object.values(odds)) total += w;
    let r = this.rng() * total;
    for (const [k, w] of Object.entries(odds)) {
      r -= w;
      if (r <= 0) return k;
    }
    return 'clear';
  }

  update(dt, biomeKey, sheltered = 0) {
    this.timer -= dt;
    // Snow can't last in the desert, so force a change when it would look wrong.
    const misfit = biomeKey === 'desert' && (this.state === 'snow' || this.state === 'blizzard');
    if (this.timer <= 0 || (misfit && this.timer > 8)) {
      let next = this.pick(biomeKey);
      if (this.state === 'storm' && next !== 'hurricane' && this.rng() < 0.3 && (ODDS[biomeKey] || {}).hurricane) next = 'hurricane';
      this.timer = misfit ? 8 : 70 + this.rng() * 110;
      if (next !== this.state) {
        this.state = next;
        this.onChange?.(WEATHER[next]);
      }
    }
    const w = WEATHER[this.state];
    const ease = (cur, target, rate) => cur + (target - cur) * Math.min(1, dt * rate);
    this.cloud = ease(this.cloud, w.cloud, 0.08);
    this.rain = ease(this.rain, w.rain * smoothCloud(this.cloud), 0.12);
    this.snow = ease(this.snow, w.snow * smoothCloud(this.cloud), 0.1);
    this.fog = ease(this.fog, w.fog, 0.08);
    this.wind = ease(this.wind, w.wind, 0.1);
    this.wet = clamp(this.wet + (this.rain > 0.1 ? dt * 0.06 * this.rain : -dt * 0.012), 0, 1);
    this.cover = clamp(this.cover + (this.snow > 0.1 ? dt * 0.02 * this.snow : -dt * 0.006), 0, 1);

    // Lightning: a bright double flash, thunder arrives a moment later.
    // Gusty crosswind (m/s of sideways push), strongest in hurricanes.
    this.time = (this.time || 0) + dt;
    const t = this.time;
    const gust = Math.sin(t * 0.55) * 0.6 + Math.sin(t * 1.7 + 1.3) * 0.3 + Math.sin(t * 3.9) * 0.1;
    this.gust = Math.max(0, this.wind - 0.8) * gust * 2.2;
    this.twister = w.twister ? Math.min(1, (this.twister || 0) + dt * 0.1) : Math.max(0, (this.twister || 0) - dt * 0.1);
    this.flash = Math.max(0, this.flash - dt * 6);
    if (w.lightning && this.rain > 0.6) {
      this.nextBolt -= dt;
      if (this.nextBolt <= 0) {
        this.nextBolt = (w.twister ? 3 : 5) + this.rng() * (w.twister ? 6 : 11);
        this.flash = 1;
        this.secondFlash = 0.12 + this.rng() * 0.1;
        this.onThunder?.(0.4 + this.rng() * 2.2, 0.5 + this.rng() * 0.5);
      }
      if (this.secondFlash !== undefined) {
        this.secondFlash -= dt;
        if (this.secondFlash <= 0) {
          this.flash = Math.max(this.flash, 0.8);
          this.secondFlash = undefined;
        }
      }
    }
    this.sheltered = sheltered;
  }
}

const smoothCloud = (c) => clamp((c - 0.4) / 0.4, 0, 1);

// Rain streaks: line segments in a box around the camera, slanted by wind
// and by the car's own speed so the rain seems to rush at the windshield.
const RN = 5000;
const RH = [40, 26, 55];

export class Rain {
  constructor(scene) {
    this.rng = mulberry32(9);
    this.drops = new Float32Array(RN * 3);
    for (let i = 0; i < RN; i++) for (let a = 0; a < 3; a++) this.drops[i * 3 + a] = (this.rng() * 2 - 1) * RH[a];
    this.pos = new Float32Array(RN * 6);
    this.geo = new THREE.BufferGeometry();
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    this.mat = new THREE.LineBasicMaterial({ color: 0xc8d6ea, transparent: true, opacity: 0, depthWrite: false });
    this.lines = new THREE.LineSegments(this.geo, this.mat);
    this.lines.frustumCulled = false;
    scene.add(this.lines);
    this.started = false;
  }

  update(dt, cam, amount, light, carVel, wind) {
    this.mat.opacity = 0.5 * amount;
    this.mat.color.setRGB(0.55 + light * 0.25, 0.62 + light * 0.25, 0.75 + light * 0.2);
    this.lines.visible = amount > 0.02;
    if (!this.lines.visible) return;
    const d = this.drops;
    if (!this.started) {
      for (let i = 0; i < RN; i++) {
        d[i * 3] += cam.x;
        d[i * 3 + 1] += cam.y;
        d[i * 3 + 2] += cam.z;
      }
      this.started = true;
    }
    const fall = 24;
    // Apparent velocity of the rain relative to the moving car.
    const vx = wind * 7 - carVel.x * 0.55;
    const vy = -fall;
    const vz = -carVel.z * 0.55;
    const inv = 1 / Math.hypot(vx, vy, vz);
    const len = 0.6 + Math.hypot(carVel.x, carVel.z) * 0.012;
    const c = [cam.x, cam.y, cam.z];
    const count = Math.floor(RN * clamp(amount * 1.15, 0, 1));
    for (let i = 0; i < RN; i++) {
      d[i * 3] += wind * 7 * dt;
      d[i * 3 + 1] -= fall * dt;
      for (let a = 0; a < 3; a++) {
        const rel = d[i * 3 + a] - c[a];
        if (rel > RH[a]) d[i * 3 + a] -= RH[a] * 2;
        else if (rel < -RH[a]) d[i * 3 + a] += RH[a] * 2;
      }
      const o = i * 6;
      if (i >= count) {
        this.pos[o] = this.pos[o + 3] = c[0];
        this.pos[o + 1] = this.pos[o + 4] = c[1] - 500;
        this.pos[o + 2] = this.pos[o + 5] = c[2];
        continue;
      }
      this.pos[o] = d[i * 3];
      this.pos[o + 1] = d[i * 3 + 1];
      this.pos[o + 2] = d[i * 3 + 2];
      this.pos[o + 3] = d[i * 3] - vx * inv * len;
      this.pos[o + 4] = d[i * 3 + 1] - vy * inv * len;
      this.pos[o + 5] = d[i * 3 + 2] - vz * inv * len;
    }
    this.geo.attributes.position.needsUpdate = true;
  }
}

// Spray kicked up by the player's tires on a wet road.
const SN = 500;

export class Spray {
  constructor(scene) {
    this.pos = new Float32Array(SN * 3);
    this.vel = new Float32Array(SN * 3);
    this.life = new Float32Array(SN);
    this.next = 0;
    this.acc = 0;
    this.rng = mulberry32(17);
    this.geo = new THREE.BufferGeometry();
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    const c = document.createElement('canvas');
    c.width = c.height = 32;
    const g = c.getContext('2d');
    const grad = g.createRadialGradient(16, 16, 0, 16, 16, 16);
    grad.addColorStop(0, 'rgba(255,255,255,0.9)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, 32, 32);
    this.mat = new THREE.PointsMaterial({ size: 0.55, map: new THREE.CanvasTexture(c), transparent: true, opacity: 0, depthWrite: false, color: 0xdde6f0 });
    this.points = new THREE.Points(this.geo, this.mat);
    this.points.frustumCulled = false;
    scene.add(this.points);
    for (let i = 0; i < SN; i++) this.pos[i * 3 + 1] = -1e5;
  }

  update(dt, car, speed, wet, light, cam) {
    this.mat.opacity = 0.22 * wet;
    this.mat.color.setScalar(0.35 + light * 0.6);
    this.points.visible = wet > 0.05;
    if (!this.points.visible) return;
    // Emit from behind both rear wheels, proportional to speed.
    this.acc += dt * speed * 3 * wet;
    const back = new THREE.Vector3(0, 0, 1).applyQuaternion(car.quaternion);
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(car.quaternion);
    while (this.acc > 1) {
      this.acc -= 1;
      const i = this.next;
      this.next = (this.next + 1) % SN;
      const side = this.rng() < 0.5 ? -1 : 1;
      const p = car.position;
      this.pos[i * 3] = p.x + back.x * 2.1 + right.x * side * 0.85;
      this.pos[i * 3 + 1] = p.y + 0.25;
      this.pos[i * 3 + 2] = p.z + back.z * 2.1 + right.z * side * 0.85;
      this.vel[i * 3] = (this.rng() - 0.5) * 2 + right.x * side * 1.5;
      this.vel[i * 3 + 1] = 1 + this.rng() * 2.5;
      this.vel[i * 3 + 2] = (this.rng() - 0.5) * 2 + right.z * side * 1.5;
      this.life[i] = 0.7 + this.rng() * 0.5;
    }
    for (let i = 0; i < SN; i++) {
      if (this.life[i] <= 0) continue;
      this.life[i] -= dt;
      this.vel[i * 3 + 1] -= 4 * dt;
      this.pos[i * 3] += this.vel[i * 3] * dt;
      this.pos[i * 3 + 1] += this.vel[i * 3 + 1] * dt;
      this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
      // The chase camera flies through old spray; hide drops right at the lens.
      const dx = this.pos[i * 3] - cam.x;
      const dy = this.pos[i * 3 + 1] - cam.y;
      const dz = this.pos[i * 3 + 2] - cam.z;
      if (this.life[i] <= 0 || dx * dx + dy * dy + dz * dz < 30) {
        this.life[i] = 0;
        this.pos[i * 3 + 1] = -1e5;
      }
    }
    this.geo.attributes.position.needsUpdate = true;
  }
}

// Snow settling on flat, upward-facing surfaces. Patch a material once; every
// patched material shares the same cover uniform.
export const snowCover = { value: 0 };
export function addSnowCover(material, strength = 1) {
  const prev = material.onBeforeCompile;
  material.onBeforeCompile = (shader, renderer) => {
    prev?.(shader, renderer);
    shader.uniforms.snowCover = snowCover;
    shader.uniforms.snowStrength = { value: strength };
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float snowCover;\nuniform float snowStrength;')
      .replace(
        '#include <normal_fragment_maps>',
        `#include <normal_fragment_maps>
        {
          vec3 upView = normalize((viewMatrix * vec4(0.0, 1.0, 0.0, 0.0)).xyz);
          float snowFlat = smoothstep(0.35, 0.8, dot(normal, upView));
          diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.93, 0.95, 1.0), snowCover * snowStrength * snowFlat);
        }`,
      );
  };
  material.customProgramCacheKey = () => (material.userData.sway ? 'snow+sway' : 'snow');
  material.needsUpdate = true;
}

// Vegetation bending in the wind (instanced props): taller parts sway more.
export const windSway = { value: 0 };
export const windTime = { value: 0 };
export function addWindSway(material) {
  const prev = material.onBeforeCompile;
  material.userData.sway = true;
  material.onBeforeCompile = (shader, renderer) => {
    prev?.(shader, renderer);
    shader.uniforms.windSway = windSway;
    shader.uniforms.windTime = windTime;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float windSway;\nuniform float windTime;')
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        #ifdef USE_INSTANCING
        {
          float hh = max(position.y, 0.0);
          vec3 ip = instanceMatrix[3].xyz;
          float ph = ip.x * 0.11 + ip.z * 0.07;
          float bend = windSway * hh * hh * 0.0035 * (0.75 + 0.25 * sin(windTime * 2.3 + ph)) + windSway * hh * 0.02 * sin(windTime * 5.1 + ph * 3.0);
          transformed.x += bend;
          transformed.y -= abs(bend) * 0.15;
        }
        #endif`,
      );
  };
  material.customProgramCacheKey = () => 'snow+sway';
  material.needsUpdate = true;
}

// Debris flying across the road in a hurricane: leaves, twigs, paper.
const DN = 600;
const DH = [60, 14, 70];
export class Debris {
  constructor(scene) {
    this.rng = mulberry32(31);
    this.pos = new Float32Array(DN * 3);
    this.col = new Float32Array(DN * 3);
    const cols = [[0.35, 0.5, 0.2], [0.55, 0.4, 0.2], [0.85, 0.85, 0.8], [0.3, 0.25, 0.2]];
    for (let i = 0; i < DN; i++) {
      for (let a = 0; a < 3; a++) this.pos[i * 3 + a] = (this.rng() * 2 - 1) * DH[a];
      this.col.set(cols[i % cols.length], i * 3);
    }
    this.geo = new THREE.BufferGeometry();
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    this.geo.setAttribute('color', new THREE.BufferAttribute(this.col, 3));
    this.mat = new THREE.PointsMaterial({ size: 0.35, vertexColors: true, transparent: true, opacity: 0, depthWrite: false });
    this.points = new THREE.Points(this.geo, this.mat);
    this.points.frustumCulled = false;
    scene.add(this.points);
    this.started = false;
    this.t = 0;
  }

  update(dt, cam, amount, light) {
    this.mat.opacity = amount;
    this.mat.color.setScalar(0.3 + light * 0.7);
    this.points.visible = amount > 0.02;
    if (!this.points.visible) return;
    this.t += dt;
    const p = this.pos;
    if (!this.started) {
      for (let i = 0; i < DN; i++) {
        p[i * 3] += cam.x;
        p[i * 3 + 1] += cam.y;
        p[i * 3 + 2] += cam.z;
      }
      this.started = true;
    }
    const c = [cam.x, cam.y - 4, cam.z];
    for (let i = 0; i < DN; i++) {
      p[i * 3] += (26 + (i % 7) * 3) * dt;
      p[i * 3 + 1] += Math.sin(this.t * 3 + i) * 4 * dt;
      p[i * 3 + 2] += Math.cos(this.t * 2 + i * 0.7) * 5 * dt;
      for (let a = 0; a < 3; a++) {
        const rel = p[i * 3 + a] - c[a];
        if (rel > DH[a]) p[i * 3 + a] -= DH[a] * 2;
        else if (rel < -DH[a]) p[i * 3 + a] += DH[a] * 2;
      }
      const dx = p[i * 3] - cam.x;
      const dy = p[i * 3 + 1] - cam.y;
      const dz = p[i * 3 + 2] - cam.z;
      if (dx * dx + dy * dy + dz * dz < 25) p[i * 3 + 1] += DH[1];
    }
    this.geo.attributes.position.needsUpdate = true;
  }
}

// A twister funnel crossing the landscape in the distance during a hurricane.
export class Twister {
  constructor(scene) {
    const c = document.createElement('canvas');
    c.width = 128;
    c.height = 256;
    const g = c.getContext('2d');
    const rng = mulberry32(5);
    g.fillStyle = 'rgba(255,255,255,0.55)';
    g.fillRect(0, 0, 128, 256);
    for (let i = 0; i < 260; i++) {
      g.fillStyle = `rgba(${rng() < 0.5 ? '40,40,48' : '255,255,255'},${0.15 + rng() * 0.35})`;
      g.fillRect(rng() * 128, rng() * 256, 10 + rng() * 40, 2 + rng() * 5);
    }
    const tex = new THREE.CanvasTexture(c);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(3, 2);
    this.tex = tex;
    this.group = new THREE.Group();
    this.layers = [];
    for (let i = 0; i < 3; i++) {
      const geo = new THREE.CylinderGeometry(70 - i * 12, 5 + i * 3, 360 - i * 25, 24, 8, true).translate(0, 180 - i * 12, 0);
      // Kink the funnel so it isn't a perfect cone.
      const pos = geo.attributes.position;
      for (let k = 0; k < pos.count; k++) {
        const y = pos.getY(k);
        pos.setX(k, pos.getX(k) + Math.sin(y * 0.012 + i) * 18);
        pos.setZ(k, pos.getZ(k) + Math.cos(y * 0.009) * 10);
      }
      const mat = new THREE.MeshBasicMaterial({ map: tex, color: 0x5a5e68, transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false, fog: false });
      const m = new THREE.Mesh(geo, mat);
      this.layers.push(m);
      this.group.add(m);
    }
    // Dust cloud at the base.
    const dust = new THREE.Mesh(new THREE.IcosahedronGeometry(40, 1).scale(1.6, 0.5, 1.6), new THREE.MeshBasicMaterial({ color: 0x6a6258, transparent: true, opacity: 0, depthWrite: false, fog: false }));
    this.dust = dust;
    this.group.add(dust);
    this.group.visible = false;
    scene.add(this.group);
    this.placed = false;
  }

  update(dt, amount, focus, fwd, right, fogColor, light) {
    this.group.visible = amount > 0.01;
    if (!this.group.visible) {
      this.placed = false;
      return;
    }
    const g = this.group;
    // Keep it ahead and off to one side; respawn once it falls behind.
    const rel = new THREE.Vector3().subVectors(g.position, focus);
    if (!this.placed || rel.dot(fwd) < -150 || rel.length() > 2200) {
      const side = Math.random() < 0.5 ? -1 : 1;
      g.position.copy(focus).addScaledVector(fwd, 900 + Math.random() * 500).addScaledVector(right, side * (380 + Math.random() * 420));
      g.position.y = focus.y - 20;
      this.drift = right.clone().multiplyScalar(-side * (8 + Math.random() * 8));
      this.placed = true;
    }
    g.position.addScaledVector(this.drift, dt);
    this.tex.offset.x += dt * 0.35;
    this.tex.offset.y -= dt * 0.12;
    this.layers.forEach((m, i) => {
      m.rotation.y += dt * (1.2 + i * 0.5);
      m.material.opacity = amount * (0.55 - i * 0.12);
      m.material.color.set(0x4a4e58).lerp(fogColor, 0.35).multiplyScalar(0.6 + light * 0.6);
    });
    this.dust.material.opacity = amount * 0.5;
    this.dust.material.color.set(0x6a6258).lerp(fogColor, 0.4).multiplyScalar(0.6 + light * 0.5);
    this.dust.rotation.y += dt * 0.6;
  }
}

