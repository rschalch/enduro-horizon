import { buildCar } from './cars.js';
import { LANES } from './track.js';
import { mulberry32, pick } from './math.js';

// Rival cars: slower than the player at full throttle, they cruise in lanes,
// follow each other and change lanes when blocked.

const COLORS = [0x2ec4ff, 0xffd23f, 0xff8c1a, 0x7cff4f, 0x9b5cff, 0xf5f5f5, 0x3a66ff, 0xff3b3b, 0x00e0b0, 0xff6ad5];
const POOL = 36;
// Trucks are 1 in 9; the rest is a mix of coupes, sedans, hatchbacks, vans and pickups.
const MIX = ['sport', 'sedan', 'hatch', 'sedan', 'van', 'sport', 'pickup', 'hatch', 'truck'];

export class Traffic {
  constructor(scene) {
    this.scene = scene;
    this.rng = mulberry32(2024);
    this.cars = [];
    for (let i = 0; i < POOL; i++) {
      const type = MIX[i % MIX.length];
      const model = buildCar(type, COLORS[(i * 7) % COLORS.length]);
      model.visible = false;
      scene.add(model);
      this.cars.push({ model, type, active: false, s: 0, d: 0, lane: 1, targetD: 0, speed: 0, base: 0, wasAhead: true, yaw: 0, ...model.userData });
    }
    this.frame = {};
    this.density = 18;
  }

  get active() {
    return this.cars.filter((c) => c.active);
  }

  reset(track, playerS, density) {
    this.track = track;
    this.density = density;
    for (const c of this.cars) {
      c.active = false;
      c.model.visible = false;
    }
    for (let i = 0; i < density; i++) this.spawn(playerS, playerS + 120, playerS + 1100);
  }

  spawn(playerS, minS, maxS) {
    const car = this.cars.find((c) => !c.active && (this.rng() < 0.85 || c.type !== 'truck'));
    if (!car) return;
    for (let tries = 0; tries < 8; tries++) {
      const lane = Math.floor(this.rng() * 3);
      const s = minS + this.rng() * (maxS - minS);
      const clash = this.cars.some((o) => o.active && Math.abs(o.s - s) < 40 && Math.abs(o.d - LANES[lane]) < 3);
      if (clash) continue;
      car.active = true;
      car.model.visible = true;
      car.s = s;
      car.lane = lane;
      car.d = car.targetD = LANES[lane];
      car.base = (car.type === 'truck' ? 22 : car.type === 'van' ? 24 : 25) + this.rng() * 13;
      car.speed = car.base;
      car.wasAhead = s > playerS;
      car.laneTimer = 2 + this.rng() * 6;
      return;
    }
  }

  laneFree(car, lane) {
    const d = LANES[lane];
    return !this.cars.some((o) => o !== car && o.active && Math.abs(o.s - car.s) < 26 && Math.abs(o.d - d) < 3);
  }

  update(dt, playerS, playerV) {
    const act = this.active;
    for (const car of act) {
      // Follow slower cars in the same lane, or try to overtake them.
      let leader = null;
      for (const o of act) {
        if (o === car) continue;
        const ds = o.s - car.s;
        if (ds > 0 && ds < 45 && Math.abs(o.d - car.d) < 2.8 && (!leader || ds < leader.s - car.s)) leader = o;
      }
      let target = car.base;
      if (leader) {
        const gap = leader.s - car.s - leader.halfLen - car.halfLen;
        if (gap < 30) target = Math.min(target, leader.speed - (gap < 12 ? 4 : 0));
        car.laneTimer -= dt * 3;
      }
      car.laneTimer -= dt;
      if (car.laneTimer <= 0) {
        car.laneTimer = 3 + this.rng() * 8;
        const options = [car.lane - 1, car.lane + 1].filter((l) => l >= 0 && l < 3 && this.laneFree(car, l));
        if (options.length && (leader || this.rng() < 0.35)) {
          car.lane = pick(this.rng, options);
          car.targetD = LANES[car.lane];
        }
      }
      car.speed += Math.max(-12, Math.min(4, target - car.speed)) * dt;
      const prevD = car.d;
      car.d += Math.max(-2.2 * dt, Math.min(2.2 * dt, car.targetD - car.d));
      car.yaw = Math.atan2(car.d - prevD, Math.max(1, car.speed * dt)) * 1.5;
      const steer = -Math.max(-0.35, Math.min(0.35, (car.targetD - car.d) * 0.12));
      for (const p of car.frontWheels) p.rotation.y = steer;
      car.s += car.speed * dt;
    }

    // Recycle cars that fell far behind or ran away ahead, and keep the road busy.
    for (const car of act) {
      if (car.s < playerS - 150 || car.s > playerS + 1600) {
        car.active = false;
        car.model.visible = false;
      }
    }
    const need = this.density - this.active.length;
    const minAhead = playerS + Math.max(650, playerV * 14);
    for (let i = 0; i < need; i++) this.spawn(playerS, minAhead, minAhead + 500);

    const f = this.frame;
    for (const car of this.cars) {
      if (!car.active) continue;
      this.track.frame(car.s, f);
      const m = car.model;
      m.position.set(f.x + f.cos * car.d, f.y, f.z + f.sin * car.d);
      m.rotation.set(Math.atan(f.g), -f.h - car.yaw, 0, 'YXZ');
      const spin = (car.speed * dt) / 0.37;
      for (const w of car.wheels) w.rotation.x -= spin;
    }
  }
}
