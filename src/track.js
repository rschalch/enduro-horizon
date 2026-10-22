import { BIOMES, BIOME_ORDER } from './biomes.js';
import { clamp, lerp, mulberry32, smoothstep } from './math.js';

// The track is an endless center line sampled every STEP meters. A planner
// lays it out as designed sections (sweepers, esses, hairpins, hill runs,
// tunnels, bridges, gorges, torii avenues, roadworks...) picked per biome,
// and records set-piece "features" that the world builds around the road.

export const STEP = 2;
export const ROAD_W = 15;
export const HALF_W = ROAD_W / 2;
export const LANES = [-5, 0, 5];
export const BIOME_LEN = 5000;
export const BIOME_BLEND = 700;
export const TUNNEL_TOP = 10.5;

const FEATURE_SECTIONS = new Set(['tunnel', 'bridge', 'gorge', 'arch', 'torii', 'overpass', 'works', 'village']);
const SIGN_KIND = { tunnel: 'tunnel', bridge: 'bridge', works: 'works', gorge: 'gorge', village: 'village', hairpin: 'curve' };

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
    this.b = [0];
    this.u = [0]; // which side the mountain rises on (+1 right, -1 left), for passes
    this.queue = [];
    this.section = null;
    this.sectionLeft = 0;
    this.gTarget = 0;
    this.gLeft = 0;
    this.features = [];
    this.lastFeatureEnd = 0;
    this.passes = [];
    this.passSegs = new Set();
    this.waterCache = new Map();
  }

  ensure(s) {
    const need = Math.ceil(s / STEP) + 3;
    while (this.x.length < need) this._step();
  }

  // ---------- Planner ----------
  _plan(s) {
    const r = this.rng;
    const bw = this.blend(s);
    const biome = bw.t > 0.5 ? bw.b : bw.a;
    const maxK = lerp(bw.a.curve, bw.b.curve, bw.t);
    const maxG = lerp(bw.a.grade, bw.b.grade, bw.t) * (1 - bw.coastW);
    const local = s - Math.floor(s / BIOME_LEN) * BIOME_LEN;
    const h = this.h[this.h.length - 1];
    // Turn back toward the main direction when the heading drifts.
    const dir = h > 0.55 ? -1 : h < -0.55 ? 1 : r() < 0.5 ? -1 : 1;
    const q = this.queue;

    if (s < 600) {
      q.push({ len: 600 - s, k: 0, g: 0 });
      return;
    }
    if (biome.pass && bw.t === 0 && biomeForSegment(bw.seg - 1) !== biome && !this.passSegs.has(bw.seg) && local > 60 && local < 1400) {
      this.passSegs.add(bw.seg);
      this._planPass(s, biome, dir);
      return;
    }
    const featureOk = local > 350 && local < BIOME_LEN - BIOME_BLEND - 700 && s - this.lastFeatureEnd > 350 && s > 1200;
    // Set pieces are the highlights: favor them whenever there is room for one.
    let choices = Object.entries(biome.sections).map(([t, w]) => [t, FEATURE_SECTIONS.has(t) ? w * 3 : w]);
    if (!featureOk) choices = choices.filter(([t]) => !FEATURE_SECTIONS.has(t));
    const total = choices.reduce((a, [, w]) => a + w, 0);
    let pickW = r() * total;
    let type = choices[0][0];
    for (const [t, w] of choices) {
      pickW -= w;
      if (pickW <= 0) {
        type = t;
        break;
      }
    }
    const tight = Math.min(0.0062, maxK * 1.75);
    const style = biome.featureStyle || {};

    switch (type) {
      case 'straight':
        q.push({ len: 200 + r() * 350, k: 0 });
        break;
      case 'sweeper':
        q.push({ len: 300 + r() * 450, k: dir * maxK * (0.6 + 0.4 * r()) });
        break;
      case 'esses': {
        let d = dir;
        const n = 3 + Math.floor(r() * 3);
        for (let i = 0; i < n; i++, d = -d) q.push({ len: 85 + r() * 70, k: d * tight * (0.75 + 0.25 * r()), fast: true });
        q.push({ len: 60, k: 0 });
        break;
      }
      case 'hairpin': {
        const k = 0.0072;
        const hd = Math.abs(h) < 0.1 ? dir : h > 0 ? -1 : 1;
        const angle = Math.min(0.9 + 0.3 * r(), 1.15 + Math.abs(h));
        q.push({ len: 70, k: 0, sign: { kind: 'curve', text: hd > 0 ? 'RIGHT' : 'LEFT' } });
        q.push({ len: angle / k, k: hd * k, fast: true });
        q.push({ len: 60, k: 0 });
        q.push({ len: 0.75 / 0.0055, k: -hd * 0.0055, fast: true });
        q.push({ len: 80, k: 0 });
        break;
      }
      case 'hills':
        q.push({ len: 500 + r() * 300, k: dir * maxK * 0.3, roll: 1.35 });
        break;
      case 'climb': {
        const y = this.y[this.y.length - 1];
        const sign = y > 60 ? -1 : y < -60 ? 1 : r() < 0.5 ? -1 : 1;
        q.push({ len: 400 + r() * 300, k: dir * maxK * 0.4, g: sign * maxG });
        break;
      }
      case 'tunnel': {
        const len = 260 + r() * 340;
        q.push({ len: 100, k: 0, g: 0, flat: true });
        q.push({ len, k: dir * maxK * 0.35, g: 0, flat: true, feature: { type: 'tunnel', style: style.tunnel || 'rock' } });
        q.push({ len: 70, k: 0, g: 0, flat: true });
        break;
      }
      case 'bridge': {
        const bs = style.bridge || 'girder';
        const len = bs === 'suspension' ? 420 + r() * 140 : 220 + r() * 220;
        q.push({ len: 110, k: 0, g: 0, flat: true });
        q.push({ len, k: 0, g: 0, flat: true, feature: { type: 'bridge', style: bs, depth: bs === 'suspension' ? 40 + r() * 10 : 24 + r() * 14 } });
        q.push({ len: 60, k: 0, g: 0, flat: true });
        break;
      }
      case 'gorge':
        q.push({ len: 650 + r() * 300, k: dir * maxK * 0.75, feature: { type: 'gorge' } });
        if (r() < 0.6) q.push({ len: 260, k: 0, g: 0, feature: { type: 'arch', at: 120 } });
        break;
      case 'arch':
        q.push({ len: 300, k: 0, feature: { type: 'arch', at: 150 } });
        break;
      case 'torii':
        q.push({ len: 70, k: 0, g: 0 });
        q.push({ len: 220 + r() * 160, k: dir * maxK * 0.3, g: 0, feature: { type: 'torii' } });
        break;
      case 'overpass':
        q.push({ len: 340, k: 0, g: 0, flat: true, feature: { type: 'overpass', at: 170 } });
        break;
      case 'works':
        q.push({ len: 280 + r() * 220, k: dir * maxK * 0.25, g: 0, flat: true, feature: { type: 'works', lane: r() < 0.5 ? 0 : 2 } });
        q.push({ len: 60, k: 0 });
        break;
      case 'village':
        q.push({ len: 420 + r() * 220, k: dir * maxK * 0.3, g: 0, feature: { type: 'village' } });
        break;
      default:
        q.push({ len: 300, k: 0 });
    }
  }

  // A mountain pass: a long climb along the valley wall and up a stack of
  // switchbacks, a summit plateau with a lake and a view over the clouds, then
  // a long descent back down to the valley floor.
  _planPass(s, biome, dir) {
    const r = this.rng;
    const q = this.queue;
    const P = biome.pass;
    const base = this.y[this.y.length - 1];
    const top = base + P.rise;
    const G = biome.grade;
    const ft = { type: 'pass', s0: s, s1: Infinity, base, top, name: P.name, alt0: P.alt0, snowy: !!P.snowy, open: true, lakeSide: r() < 0.5 ? -1 : 1 };
    this.features.push(ft);
    this.passes.push(ft);
    const KC = 0.011; // switchback curvature
    const HT = 1.05; // traverse heading
    const climb = (sec) => q.push({ capY: top, ...sec });
    const fall = (sec) => q.push({ floorY: base, ...sec });
    const hairpin = (push, u, turn, g) => {
      push({ len: 60, hTo: -turn * HT, kc: 0.004, g, up: u, sign: { kind: 'curve', text: turn > 0 ? 'RIGHT' : 'LEFT' } });
      push({ len: 120, hTo: turn * HT, kc: KC, dk: 0.0004, g: g * 0.45, up: -u, upRate: 0.02 });
    };

    // Climb: along the valley wall, up a stack of switchbacks, then a final ramp.
    let u = r() < 0.5 ? -1 : 1;
    climb({ len: 320 + r() * 120, k: dir * biome.curve * 0.5, g: G * 0.6, up: u });
    climb({ len: 330, hTo: u * 0.45, kc: 0.003, g: G, up: u });
    climb({ len: 330, hTo: -u * 0.3, kc: 0.003, g: G, up: u });
    climb({ len: 200, hTo: -u * HT, kc: 0.0035, g: G, up: u });
    const nUp = 4 + (r() < 0.4 ? 1 : 0);
    for (let n = 0; n < nUp; n++) {
      hairpin(climb, u, u, G);
      u = -u;
      climb({ len: 160 + r() * 120, hTo: -u * HT * 0.8, kc: 0.0025, g: G, up: u });
    }
    q.push({ len: 200, untilY: top, hTo: 0, kc: 0.0025, g: G * 0.85, up: u });

    // Summit plateau: the lake lies on the uphill side, the drop on the other.
    q.push({ len: 760 + r() * 200, k: -u * biome.curve * 0.25, g: 0, up: ft.lakeSide, upRate: 0.012, mark: 'summit' });
    u = ft.lakeSide;

    // Descent: switchbacks first, then long sweeping runs down the valley wall.
    const Gd = G * 1.1;
    fall({ len: 160, hTo: 0, kc: 0.0025, g: -Gd, up: u });
    for (let n = 0; n < 3; n++) {
      fall({ len: 160 + r() * 100, hTo: u * HT * 0.8, kc: 0.0025, g: -Gd, up: u });
      hairpin(fall, u, -u, -Gd);
      u = -u;
    }
    fall({ len: 400, hTo: dir * 0.5, kc: 0.003, g: -Gd, up: u });
    fall({ len: 400, hTo: -dir * 0.4, kc: 0.003, g: -Gd, up: u });
    q.push({ len: 200, untilY: base, hTo: 0, kc: 0.003, g: -Gd * 0.9, up: u });
    q.push({ len: 120, k: 0, g: 0, up: 0, mark: 'passEnd' });
  }

  _beginSection(sec, s) {
    this.section = sec;
    this.sectionLeft = Math.max(1, Math.round(sec.len / STEP));
    sec.n = 0;
    if (sec.hTo !== undefined || sec.untilY !== undefined) this.sectionLeft = 1e6; // ends on its goal
    if (sec.mark) {
      const ft = this.passes[this.passes.length - 1];
      if (sec.mark === 'summit') {
        ft.top = this.y[this.y.length - 1];
        ft.sum0 = s;
        ft.sum1 = s + sec.len;
      } else {
        ft.s1 = s + sec.len;
        ft.open = false;
        this.lastFeatureEnd = ft.s1;
      }
    }
    if (sec.sign) this.features.push({ type: 'sign', s0: s, s1: s, kind: sec.sign.kind, text: sec.sign.text });
    const f = sec.feature;
    if (!f) return;
    let feat;
    if (f.at !== undefined) feat = { ...f, s0: s + f.at, s1: s + f.at + (f.type === 'overpass' ? 16 : 20) };
    else feat = { ...f, s0: s, s1: s + sec.len };
    delete feat.at;
    this.features.push(feat);
    this.lastFeatureEnd = s + sec.len;
    const kind = SIGN_KIND[feat.type];
    if (kind) this.features.push({ type: 'sign', s0: feat.s0 - 250, s1: feat.s0 - 250, kind, text: feat.type.toUpperCase() });
  }

  _step() {
    const i = this.x.length - 1;
    const s = i * STEP;
    const r = this.rng;
    if (!this.section || --this.sectionLeft <= 0) {
      if (!this.queue.length) this._plan(s);
      this._beginSection(this.queue.shift(), s);
    }
    const sec = this.section;
    const bw = this.blend(s);
    const maxK = lerp(bw.a.curve, bw.b.curve, bw.t);
    const maxG = lerp(bw.a.grade, bw.b.grade, bw.t) * (1 - bw.coastW);

    // Grade: forced by the section, or rolling hills. Passes ease off at the top and bottom.
    let gT;
    const y0 = this.y[i];
    if (sec.g !== undefined) {
      gT = sec.g;
      if (sec.capY !== undefined) gT *= clamp((sec.capY - y0) / 22, 0, 1);
      if (sec.floorY !== undefined) gT *= clamp((y0 - sec.floorY) / 22, 0, 1);
      if (sec.untilY !== undefined) gT = Math.sign(gT) * Math.max(Math.abs(gT) * clamp(Math.abs(sec.untilY - y0) / 22, 0, 1), 0.02);
    } else {
      if (--this.gLeft <= 0) {
        this.gLeft = Math.floor((70 + r() * 170) / STEP);
        const sign = r() < 0.8 ? -Math.sign(this.gTarget || this.g[i] || 1) : Math.sign(this.gTarget || 1);
        this.gTarget = r() < 0.1 ? 0 : sign * maxG * (0.7 + 0.3 * r());
        if (this.y[i] > 160) this.gTarget = -Math.abs(this.gTarget);
        if (this.y[i] < -160) this.gTarget = Math.abs(this.gTarget);
      }
      const roll = sec.roll || 1;
      gT = clamp(this.gTarget * roll, -maxG * roll, maxG * roll);
    }

    let kT = sec.k;
    const dk = sec.dk || (sec.fast ? 0.00013 : Math.max(maxK / 45, 0.00004));
    const kNow = this.k[i];
    if (sec.hTo !== undefined) {
      // Steer toward a target heading, easing the curvature off just in time.
      const rem = sec.hTo - this.h[i];
      const stop = (kNow * kNow * STEP) / (2 * dk) + Math.abs(kNow) * STEP;
      kT = Math.abs(rem) <= stop && Math.sign(rem) === Math.sign(kNow) ? 0 : Math.sign(rem) * Math.min(sec.kc, Math.abs(rem) / 40);
    }
    const k = kNow + clamp(kT - kNow, -dk, dk);
    const g = this.g[i] + clamp(gT - this.g[i], -0.0034, 0.0034);
    const nh = clamp(this.h[i] + k * STEP, -1.3, 1.3);
    const kEff = (nh - this.h[i]) / STEP; // stays consistent if the heading clamp kicks in
    // Bank into curves, flat on bridges, in tunnels and through roadworks.
    const bT = sec.flat ? 0 : clamp(kEff * 22, -0.09, 0.09);
    const b = this.b[i] + clamp(bT - this.b[i], -0.0025, 0.0025);
    const uR = sec.upRate || 0.01;
    const u = this.u[i] + clamp((sec.up || 0) - this.u[i], -uR, uR);

    // Goal-driven sections end once their heading / height goal is met.
    sec.n++;
    const minN = sec.len / STEP;
    if (sec.n >= minN || sec.n > 4000) {
      const hDone = sec.hTo === undefined || (Math.abs(sec.hTo - nh) < 0.015 && Math.abs(k) < dk * 2);
      const yNow = this.y[i] + g * STEP;
      const yDone = sec.untilY === undefined || Math.abs(sec.untilY - yNow) < 1.5 || (sec.g > 0 ? yNow > sec.untilY : yNow < sec.untilY);
      if ((hDone && yDone) || sec.n > 4000) this.sectionLeft = Math.min(this.sectionLeft, 1);
    }

    this.x.push(this.x[i] + Math.sin(nh) * STEP);
    this.z.push(this.z[i] - Math.cos(nh) * STEP);
    this.y.push(this.y[i] + g * STEP);
    this.h.push(nh);
    this.k.push(kEff);
    this.g.push(g);
    this.b.push(b);
    this.u.push(u);
  }

  // ---------- Queries ----------

  // Biome cross-fade at distance s: a = current segment, b = next, t = blend.
  blend(s) {
    const seg = Math.max(0, Math.floor(s / BIOME_LEN));
    const local = s - seg * BIOME_LEN;
    const t = smoothstep(BIOME_LEN - BIOME_BLEND, BIOME_LEN, local);
    const a = biomeForSegment(seg);
    const b = biomeForSegment(seg + 1);
    return { a, b, t, seg, coastW: (a.coast ? 1 - t : 0) + (b.coast ? t : 0) };
  }

  // Interpolated frame: position, heading, curvature, grade, bank.
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
    out.bank = this.b[i] + (this.b[i + 1] - this.b[i]) * f;
    out.u = this.u[i] + (this.u[i + 1] - this.u[i]) * f;
    out.sin = Math.sin(out.h);
    out.cos = Math.cos(out.h);
    out.s = s;
    return out;
  }

  // Road surface height at lateral offset d (banked: the inside of a curve is lower).
  roadY(f, d) {
    return f.y - d * f.bank;
  }

  // The mountain pass around distance s (with a margin), or null.
  passAt(s, margin = 0) {
    for (let n = this.passes.length - 1; n >= 0; n--) {
      const p = this.passes[n];
      if (s >= p.s0 - margin && s <= p.s1 + margin) return p;
    }
    return null;
  }

  // Make sure a pass is fully laid out (its end is only known once it is generated).
  completePass(p) {
    while (p.open) this.ensure(this.x.length * STEP + 400);
  }

  featuresIn(s0, s1) {
    return this.features.filter((ft) => ft.s1 >= s0 && ft.s0 < s1);
  }

  featureAt(s, type, margin = 0) {
    for (const ft of this.features) if (ft.type === type && s >= ft.s0 - margin && s <= ft.s1 + margin) return ft;
    return null;
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
