import * as THREE from 'three';
import { clamp, lerp, mulberry32, smoothstep } from './math.js';

// Things that happen in a clear night sky: shooting stars, the odd meteor
// shower, blazing fireballs that crash beyond the horizon, and UFOs that
// buzz the road, beam something up and shoot off into space.

const SKY_R = 1600;

function glowTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.3, 'rgba(255,255,255,0.5)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// ---------- Meteors ----------
const STREAKS = 8;
const TRAIL = 14;

class Meteors {
  constructor(scene, glow) {
    this.rng = mulberry32(404);
    this.list = [];
    // Shooting stars: short glowing line segments with a bright head.
    const pos = new Float32Array(STREAKS * 6);
    const col = new Float32Array(STREAKS * 6);
    this.geo = new THREE.BufferGeometry();
    this.geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    this.lines = new THREE.LineSegments(this.geo, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
    this.lines.frustumCulled = false;
    this.lines.renderOrder = -7;
    scene.add(this.lines);
    for (let i = 0; i < STREAKS; i++) this.list.push({ life: 0 });

    // Fireball: blazing head plus a smoky, glowing trail of sprites.
    this.ball = new THREE.Sprite(new THREE.SpriteMaterial({ map: glow, color: new THREE.Color(4, 2.6, 1.4), blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
    this.ball.scale.setScalar(40);
    this.ball.visible = false;
    this.ball.renderOrder = -6;
    scene.add(this.ball);
    const tp = new Float32Array(TRAIL * 3);
    this.trailGeo = new THREE.BufferGeometry();
    this.trailGeo.setAttribute('position', new THREE.BufferAttribute(tp, 3));
    this.trail = new THREE.Points(this.trailGeo, new THREE.PointsMaterial({ map: glow, size: 26, color: new THREE.Color(2.2, 1.1, 0.5), transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
    this.trail.frustumCulled = false;
    this.trail.visible = false;
    scene.add(this.trail);
    this.fire = null;
    this.timer = 3;
    this.shower = 0;
  }

  // Mostly in the sky ahead of the driver, low enough to be in view.
  spawnStreak(fwdAz) {
    const m = this.list.find((x) => x.life <= 0);
    if (!m) return;
    const r = this.rng;
    const az = fwdAz + (r() - 0.5) * 2.2;
    const el = 0.1 + r() * 0.32;
    m.p = new THREE.Vector3(Math.cos(az) * Math.cos(el), Math.sin(el), Math.sin(az) * Math.cos(el)).multiplyScalar(SKY_R);
    // Fall roughly downward and sideways across the sky.
    const side = new THREE.Vector3(-Math.sin(az), 0, Math.cos(az)).multiplyScalar(r() < 0.5 ? -1 : 1);
    m.v = side.multiplyScalar(0.8 + r() * 0.6).add(new THREE.Vector3(0, -0.5 - r() * 0.4, 0)).normalize().multiplyScalar(700 + r() * 500);
    m.life = m.max = 0.5 + r() * 0.9;
    m.len = 60 + r() * 90;
    m.bright = 1.5 + r() * 2.5;
  }

  spawnFireball(onImpact, fwdAz) {
    const r = this.rng;
    const az = fwdAz + (r() - 0.5) * 1.2;
    this.fire = {
      p: new THREE.Vector3(Math.cos(az), 0.36, Math.sin(az)).normalize().multiplyScalar(SKY_R),
      v: new THREE.Vector3(Math.cos(az + 1.4), -0.22, Math.sin(az + 1.4)).normalize().multiplyScalar(260),
      life: 4.5,
      hist: [],
      onImpact,
    };
  }

  update(dt, cam, sky, hooks) {
    const r = this.rng;
    const fwdAz = hooks.fwdAz || 0;
    this.timer -= dt;
    if (sky > 0.2 && this.timer <= 0) {
      // Usually a lone shooting star; sometimes a shower or a fireball.
      const roll = r();
      if (roll < 0.06 && !this.fire) {
        this.spawnFireball(hooks.onImpact, fwdAz);
        hooks.onFireball?.();
      } else if (roll < 0.14) this.shower = 4 + r() * 4;
      else this.spawnStreak(fwdAz);
      this.timer = (2.5 + r() * 7) / hooks.rate;
    }
    if (this.shower > 0) {
      this.shower -= dt;
      if (r() < dt * 5) this.spawnStreak(fwdAz);
    }

    const pos = this.geo.attributes.position.array;
    const col = this.geo.attributes.color.array;
    this.list.forEach((m, i) => {
      const o = i * 6;
      if (m.life <= 0) {
        pos.fill(0, o, o + 6);
        col.fill(0, o, o + 6);
        return;
      }
      m.life -= dt;
      m.p.addScaledVector(m.v, dt);
      const fade = Math.sin(clamp(1 - m.life / m.max, 0, 1) * Math.PI) * sky * m.bright;
      const dir = m.v.clone().normalize();
      pos[o] = cam.x + m.p.x;
      pos[o + 1] = cam.y + m.p.y;
      pos[o + 2] = cam.z + m.p.z;
      pos[o + 3] = pos[o] - dir.x * m.len;
      pos[o + 4] = pos[o + 1] - dir.y * m.len;
      pos[o + 5] = pos[o + 2] - dir.z * m.len;
      col.set([fade, fade * 0.95, fade * 0.85, 0, 0, 0], o);
    });
    this.geo.attributes.position.needsUpdate = true;
    this.geo.attributes.color.needsUpdate = true;

    const f = this.fire;
    this.ball.visible = this.trail.visible = !!f;
    if (!f) return;
    f.life -= dt;
    f.p.addScaledVector(f.v, dt);
    f.hist.unshift(f.p.clone());
    if (f.hist.length > TRAIL) f.hist.length = TRAIL;
    this.ball.position.copy(cam).add(f.p);
    this.ball.material.opacity = sky;
    const tp = this.trailGeo.attributes.position.array;
    f.hist.forEach((h, k) => tp.set([cam.x + h.x - f.v.x * k * 0.012, cam.y + h.y - f.v.y * k * 0.012, cam.z + h.z - f.v.z * k * 0.012], k * 3));
    this.trailGeo.attributes.position.needsUpdate = true;
    this.trailGeo.setDrawRange(0, f.hist.length);
    this.trail.material.opacity = 0.8 * sky;
    if (f.life <= 0 || f.p.y < 15) {
      f.onImpact?.();
      this.fire = null;
    }
  }
}

// ---------- UFO ----------
function buildSaucer(glow) {
  const g = new THREE.Group();
  const hull = new THREE.LatheGeometry(
    [[0, -1.6], [3.5, -1.4], [7.5, -0.4], [9.5, 0], [7.5, 0.6], [4, 1.2], [0, 1.3]].map(([x, y]) => new THREE.Vector2(x, y)),
    40,
  );
  const metal = new THREE.MeshStandardMaterial({ color: 0x9aa4b8, metalness: 0.9, roughness: 0.25, emissive: 0x1a2030, emissiveIntensity: 1 });
  g.add(new THREE.Mesh(hull, metal));
  const dome = new THREE.Mesh(
    new THREE.SphereGeometry(3.4, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2).translate(0, 1.1, 0),
    new THREE.MeshStandardMaterial({ color: 0x40ffd0, emissive: 0x20e0b0, emissiveIntensity: 1.6, transparent: true, opacity: 0.85, roughness: 0.1 }),
  );
  g.add(dome);
  // Chasing rim lights.
  const lights = [];
  for (let i = 0; i < 14; i++) {
    const a = (i / 14) * Math.PI * 2;
    const m = new THREE.Mesh(new THREE.SphereGeometry(0.45, 8, 6), new THREE.MeshBasicMaterial({ color: 0xffffff }));
    m.position.set(Math.cos(a) * 8.6, 0.05, Math.sin(a) * 8.6);
    g.add(m);
    lights.push(m);
  }
  // Belly glow and tractor beam.
  const belly = new THREE.Sprite(new THREE.SpriteMaterial({ map: glow, color: new THREE.Color(0.3, 1.4, 1.1), blending: THREE.AdditiveBlending, depthWrite: false }));
  belly.scale.set(9, 9, 1);
  belly.position.y = -1.8;
  g.add(belly);
  const c = document.createElement('canvas');
  c.width = 8;
  c.height = 128;
  const cg = c.getContext('2d');
  const grad = cg.createLinearGradient(0, 0, 0, 128);
  grad.addColorStop(0, 'rgba(160,255,230,0.9)');
  grad.addColorStop(1, 'rgba(160,255,230,0.05)');
  cg.fillStyle = grad;
  cg.fillRect(0, 0, 8, 128);
  const beamMat = new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(c), transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
  const beam = new THREE.Mesh(new THREE.CylinderGeometry(3, 11, 1, 24, 1, true).translate(0, -0.5, 0), beamMat);
  beam.position.y = -1.6;
  g.add(beam);
  g.userData = { lights, beam, belly, metal };
  return g;
}

// A very important passenger for the tractor beam.
function buildCow() {
  const g = new THREE.Group();
  const white = new THREE.MeshStandardMaterial({ color: 0xf4f4f0, flatShading: true });
  const black = new THREE.MeshStandardMaterial({ color: 0x1a1a1a, flatShading: true });
  g.add(new THREE.Mesh(new THREE.BoxGeometry(2.2, 1.1, 1).translate(0, 1.2, 0), white));
  g.add(new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.7, 0.7).translate(1.4, 1.5, 0), black));
  g.add(new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.6, 1.02).translate(-0.3, 1.35, 0), black));
  for (const [x, z] of [[-0.8, -0.35], [-0.8, 0.35], [0.8, -0.35], [0.8, 0.35]]) g.add(new THREE.Mesh(new THREE.BoxGeometry(0.25, 0.7, 0.25).translate(x, 0.35, z), white));
  return g;
}

class Ufo {
  constructor(scene, glow) {
    this.saucer = buildSaucer(glow);
    this.saucer.visible = false;
    scene.add(this.saucer);
    this.cow = buildCow();
    this.cow.visible = false;
    scene.add(this.cow);
    this.active = false;
    this.t = 0;
    this.f = {};
  }

  start(track, playerS) {
    this.active = true;
    this.t = 0;
    this.side = Math.random() < 0.5 ? -1 : 1;
    this.cowS = playerS + 470;
    this.cowD = this.side * (38 + Math.random() * 18);
    this.cowUp = 0;
    this.saucer.visible = true;
    this.cow.visible = true;
  }

  // Choreography (seconds): arrive -> beam up a cow -> buzz the car -> leave.
  update(dt, track, player, hooks) {
    if (!this.active) return 0;
    this.t += dt;
    const t = this.t;
    const s = this.saucer;
    const f = this.f;
    let target;
    let beam = 0;
    const cowF = track.frame(this.cowS, {});
    const cowPos = new THREE.Vector3(cowF.x + cowF.cos * this.cowD, cowF.y, cowF.z + cowF.sin * this.cowD);
    if (t < 4) {
      // Swoop in from high and far away toward the field with the cow.
      const k = smoothstep(0, 4, t);
      target = cowPos.clone().add(new THREE.Vector3(0, lerp(260, 32, k), 0));
      target.lerp(cowPos.clone().add(new THREE.Vector3(-400 * this.side, 260, -300)), 1 - k);
    } else if (t < 9.5) {
      target = cowPos.clone().add(new THREE.Vector3(Math.sin(t * 2) * 1.2, 32 + Math.sin(t * 3) * 0.8, 0));
      beam = smoothstep(4.2, 5, t) * smoothstep(9.5, 8.8, t);
      this.cowUp = Math.min(30, this.cowUp + dt * beam * 6);
    } else if (t < 17) {
      // Buzz the player: hover just above and ahead of the car.
      track.frame(player.s + 42 + Math.sin(t) * 8, f);
      target = new THREE.Vector3(f.x + f.cos * Math.sin(t * 0.9) * 7, f.y + 10 + Math.sin(t * 2.3) * 1.5, f.z + f.sin * Math.sin(t * 0.9) * 7);
    } else {
      // Shoot off into space.
      const k = (t - 17) * (t - 17);
      track.frame(player.s + 45 + k * 40, f);
      target = new THREE.Vector3(f.x, f.y + 10 + k * 90, f.z);
    }
    const follow = t < 9.5 || t > 17 ? 1 - Math.exp(-dt * 3) : 1 - Math.exp(-dt * 6);
    s.position.lerp(target, t < 0.05 ? 1 : follow);
    s.rotation.y += dt * 2.5;
    s.rotation.z = Math.sin(t * 1.3) * 0.12;
    s.userData.lights.forEach((m, i) => {
      const on = (Math.floor(t * 10) + i) % 4 === 0;
      const hue = ((i / 14 + t * 0.2) % 1);
      m.material.color.setHSL(hue, 1, on ? 0.7 : 0.35).multiplyScalar(on ? 3 : 1.2);
    });
    const ud = s.userData;
    const h = Math.max(1, s.position.y - cowPos.y);
    ud.beam.scale.set(1, h, 1);
    ud.beam.material.opacity = beam * 0.8;
    // The cow floats up into the beam, then vanishes inside.
    this.cow.visible = this.cowUp < 29.5;
    this.cow.position.copy(cowPos).add(new THREE.Vector3(0, this.cowUp, 0));
    this.cow.rotation.set(this.cowUp * 0.05, t * 0.7 * Math.min(1, this.cowUp), this.cowUp * 0.03);

    if (t > 24) {
      this.active = false;
      s.visible = false;
      this.cow.visible = false;
    }
    const dist = s.position.distanceTo(hooks.camPos);
    return { near: clamp(1 - dist / 220, 0, 1), overhead: t > 9.5 && t < 17 ? 1 : 0, beam };
  }
}

export class SkyEvents {
  constructor(scene, opts = {}) {
    const glow = glowTexture();
    this.meteors = new Meteors(scene, glow);
    this.ufo = new Ufo(scene, glow);
    this.ufoTimer = opts.ufo ? 3 : 50 + Math.random() * 60;
    this.rate = opts.meteors ? 4 : 1;
    this.onUfo = null;
    this.onFireball = null;
    this.onImpact = null;
    this.state = { near: 0, overhead: 0, beam: 0 };
  }

  // sky: 0..1 how clear and dark the sky is right now.
  update(dt, { sky, camPos, camDir, track, player, tunnel }) {
    this.meteors.update(dt, camPos, sky * (1 - tunnel), {
      fwdAz: Math.atan2(camDir.z, camDir.x),
      rate: this.rate,
      onImpact: () => this.onImpact?.(),
      onFireball: () => this.onFireball?.(),
    });
    if (!this.ufo.active) {
      this.ufoTimer -= dt;
      if (this.ufoTimer <= 0 && sky > 0.5 && tunnel < 0.1) {
        this.ufo.start(track, player.s);
        this.ufoTimer = 70 + Math.random() * 90;
        this.onUfo?.();
      }
      this.state = { near: 0, overhead: 0, beam: 0 };
      return this.state;
    }
    this.state = this.ufo.update(dt, track, player, { camPos });
    return this.state;
  }
}
