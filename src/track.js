import { BIOMES, BIOME_ORDER } from './biomes.js';
import { clamp, lerp, mulberry32, smoothstep } from './math.js';

// The track is an endless, procedurally generated center line sampled every
// STEP meters. Curvature and grade drift toward random targets whose ranges
// depend on the biome, so deserts get long sweepers and mountains get twisties.

export const STEP = 2;
export const ROAD_W = 15;
export const HALF_W = ROAD_W / 2;
export const LANES = [-5, 0, 5];
export const BIOME_LEN = 5000;
export const BIOME_BLEND = 700;

export const biomeForSegment = (seg) => BIOMES[BIOME_ORDER[((seg % BIOME_ORDER.length) + BIOME_ORDER.length) % BIOME_ORDER.length]];

export class Track {
  constructor(seed = 1) {
    this.seed = seed;
    this.rng = mulberry32(seed);
    this.x = [0];
    this.y = [0];
    this.z = [0];
    this.h = [0];
    this.k = [0];
    this.g = [0];
    this.kTarget = 0;
    this.kLeft = 0;
    this.gTarget = 0;
    this.gLeft = 0;
    this.waterCache = new Map();
  }

  ensure(s) {
    const need = Math.ceil(s / STEP) + 3;
    while (this.x.length < need) this._step();
  }

  _step() {
    const i = this.x.length - 1;
    const s = i * STEP;
    const r = this.rng;
    const bw = this.blend(s);
    const maxK = lerp(bw.a.curve, bw.b.curve, bw.t);
    const maxG = lerp(bw.a.grade, bw.b.grade, bw.t) * (1 - bw.coastW);
    const h = this.h[i];

    if (--this.kLeft <= 0) {
      this.kLeft = Math.floor((140 + r() * 480) / STEP);
      const straight = r() < 0.25;
      let k = straight ? 0 : (r() < 0.5 ? -1 : 1) * maxK * (0.35 + 0.65 * r());
      // Keep the overall heading roughly forward so the road never loops back on itself.
      if (h > 0.85) k = -Math.abs(k || maxK * 0.6);
      if (h < -0.85) k = Math.abs(k || maxK * 0.6);
      this.kTarget = k;
    }
    if (--this.gLeft <= 0) {
      // Rolling hills: mostly alternate climbs and descents so the road crests
      // and dips, with the occasional long flat or long climb.
      const long = r() < 0.12;
      this.gLeft = Math.floor((long ? 400 + r() * 300 : 70 + r() * 170) / STEP);
      const flat = r() < 0.1;
      const sign = r() < 0.8 ? -Math.sign(this.gTarget || this.g[i] || 1) : Math.sign(this.gTarget || 1);
      this.gTarget = flat ? 0 : sign * maxG * (0.7 + 0.3 * r());
      // Keep the road from drifting too far from its starting altitude.
      if (this.y[i] > 160) this.gTarget = -Math.abs(this.gTarget);
      if (this.y[i] < -160) this.gTarget = Math.abs(this.gTarget);
    }
    const kT = s < 500 ? 0 : this.kTarget;
    const gT = s < 400 ? 0 : clamp(this.gTarget, -maxG, maxG);

    const dk = (maxK / 45) || 0.00005;
    const k = clamp(this.k[i] + clamp(kT - this.k[i], -dk, dk), -maxK - 0.0002, maxK + 0.0002);
    const g = this.g[i] + clamp(gT - this.g[i], -0.0034, 0.0034);
    const nh = clamp(h + k * STEP, -1.25, 1.25);

    this.x.push(this.x[i] + Math.sin(nh) * STEP);
    this.z.push(this.z[i] - Math.cos(nh) * STEP);
    this.y.push(this.y[i] + g * STEP);
    this.h.push(nh);
    this.k.push(k);
    this.g.push(g);
  }

  // Biome cross-fade at distance s: a = current segment, b = next, t = blend.
  blend(s) {
    const seg = Math.max(0, Math.floor(s / BIOME_LEN));
    const local = s - seg * BIOME_LEN;
    const t = smoothstep(BIOME_LEN - BIOME_BLEND, BIOME_LEN, local);
    const a = biomeForSegment(seg);
    const b = biomeForSegment(seg + 1);
    return { a, b, t, seg, coastW: (a.coast ? 1 - t : 0) + (b.coast ? t : 0) };
  }

  // Interpolated frame: position, heading, curvature, grade.
  // forward = (sin h, 0, -cos h), right = (cos h, 0, sin h).
  frame(s, out = {}) {
    s = Math.max(0, s);
    this.ensure(s + STEP * 2);
    const fi = s / STEP;
    const i = Math.floor(fi);
    const f = fi - i;
    out.x = this.x[i] + (this.x[i + 1] - this.x[i]) * f;
    out.y = this.y[i] + (this.y[i + 1] - this.y[i]) * f;
    out.z = this.z[i] + (this.z[i + 1] - this.z[i]) * f;
    out.h = this.h[i] + (this.h[i + 1] - this.h[i]) * f;
    out.k = this.k[i] + (this.k[i + 1] - this.k[i]) * f;
    out.g = this.g[i] + (this.g[i + 1] - this.g[i]) * f;
    out.sin = Math.sin(out.h);
    out.cos = Math.cos(out.h);
    out.s = s;
    return out;
  }

  // Sea level for a coast segment: a bit below the lowest road point in it.
  waterLevel(seg) {
    if (this.waterCache.has(seg)) return this.waterCache.get(seg);
    const s0 = Math.max(0, seg * BIOME_LEN - BIOME_BLEND);
    const s1 = (seg + 1) * BIOME_LEN;
    this.ensure(s1);
    let min = Infinity;
    for (let i = Math.floor(s0 / STEP); i <= Math.floor(s1 / STEP); i += 5) min = Math.min(min, this.y[i]);
    const level = min - 6;
    this.waterCache.set(seg, level);
    return level;
  }

  // The coast segment that is relevant at distance s (current or the next one), or -1.
  coastSegmentNear(s, lookahead = 0) {
    const seg = Math.max(0, Math.floor(s / BIOME_LEN));
    for (const n of [seg, seg + 1]) {
      if (!biomeForSegment(n).coast) continue;
      const start = n * BIOME_LEN - BIOME_BLEND - lookahead;
      const end = (n + 1) * BIOME_LEN + 400;
      if (s >= start && s <= end) return n;
    }
    return -1;
  }
}
