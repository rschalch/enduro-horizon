import * as THREE from 'three';
import { smoothstep } from './math.js';

// One race day = t in [0, 1). Like the original Enduro the day runs from dawn
// through a bright day, a burning sunset, a dark night and a thick fog bank.
const RAW = [
  { t: 0.0, name: 'Dawn', icon: '🌅', top: 0x2b3a7a, hor: 0xff9e7a, gnd: 0x6a4a5a, sun: 0xffb08a, sunI: 1.6, hs: 0x9aa8dd, hg: 0x6a4a4a, hI: 1.0, fogN: 80, fogF: 900, night: 0.25 },
  { t: 0.07, name: 'Morning', icon: '☀️', top: 0x3d86e0, hor: 0xc4e6ff, gnd: 0x8aa0b0, sun: 0xfff0d6, sunI: 3.0, hs: 0xbfe0ff, hg: 0x7a8a5a, hI: 1.6, fogN: 200, fogF: 1500, night: 0 },
  { t: 0.45, name: 'Afternoon', icon: '🌤️', top: 0x2e74d6, hor: 0xd6ecff, gnd: 0x8aa0b0, sun: 0xfff4e0, sunI: 3.2, hs: 0xc4e2ff, hg: 0x7a8a5a, hI: 1.6, fogN: 200, fogF: 1500, night: 0 },
  { t: 0.56, name: 'Sunset', icon: '🌇', top: 0x4a3c96, hor: 0xff8a5c, gnd: 0x6a4a5a, sun: 0xff9a5a, sunI: 2.3, hs: 0xd0a0c0, hg: 0x6a4a3a, hI: 1.05, fogN: 150, fogF: 1300, night: 0.05 },
  { t: 0.64, name: 'Dusk', icon: '🌆', top: 0x1a1d4f, hor: 0xd94f7d, gnd: 0x2a2040, sun: 0xff6a7a, sunI: 0.8, hs: 0x6a5a9a, hg: 0x2a2030, hI: 0.65, fogN: 100, fogF: 1000, night: 0.55 },
  { t: 0.7, name: 'Night', icon: '🌙', top: 0x040616, hor: 0x18204a, gnd: 0x05060f, sun: 0x8fa8ff, sunI: 0.45, hs: 0x2a3a6a, hg: 0x0a0a18, hI: 0.5, fogN: 60, fogF: 750, night: 1 },
  { t: 0.86, name: 'Night', icon: '🌙', top: 0x040616, hor: 0x18204a, gnd: 0x05060f, sun: 0x8fa8ff, sunI: 0.45, hs: 0x2a3a6a, hg: 0x0a0a18, hI: 0.5, fogN: 60, fogF: 750, night: 1 },
  { t: 0.9, name: 'Fog', icon: '🌫️', top: 0x3c4258, hor: 0x7a8296, gnd: 0x5a6070, sun: 0xb0b8d0, sunI: 0.5, hs: 0x8a90a8, hg: 0x404550, hI: 0.85, fogN: 5, fogF: 115, night: 0.7 },
  { t: 0.96, name: 'Fog', icon: '🌫️', top: 0x5a5a80, hor: 0xb09090, gnd: 0x6a5a60, sun: 0xd0b0a0, sunI: 0.8, hs: 0xa0a0c0, hg: 0x504548, hI: 0.9, fogN: 20, fogF: 260, night: 0.45 },
];

const COLOR_KEYS = ['top', 'hor', 'gnd', 'sun', 'hs', 'hg'];
const NUM_KEYS = ['sunI', 'hI', 'fogN', 'fogF', 'night'];

const KEYS = RAW.map((k) => {
  const o = { ...k };
  for (const c of COLOR_KEYS) o[c] = new THREE.Color(k[c]);
  return o;
});
// Wrap back to dawn.
KEYS.push({ ...KEYS[0], t: 1 });

export function sampleTimeOfDay(t, out) {
  t = ((t % 1) + 1) % 1;
  let i = 0;
  while (i < KEYS.length - 2 && KEYS[i + 1].t <= t) i++;
  const a = KEYS[i];
  const b = KEYS[i + 1];
  const f = smoothstep(0, 1, (t - a.t) / (b.t - a.t));
  for (const c of COLOR_KEYS) (out[c] ||= new THREE.Color()).copy(a[c]).lerp(b[c], f);
  for (const n of NUM_KEYS) out[n] = a[n] + (b[n] - a[n]) * f;
  out.name = a.name;
  out.icon = a.icon;
  return out;
}

// Sun arcs across the sky between t = 0 and t = 0.66; the moon takes the rest.
export function celestial(t, sunDir, moonDir) {
  t = ((t % 1) + 1) % 1;
  const sa = Math.min(1, t / 0.66) * Math.PI;
  sunDir.set(Math.cos(sa) * 0.85, Math.sin(sa) * 0.8 - 0.04, -0.55).normalize();
  const ma = (((t - 0.62 + 1) % 1) / 0.42) * Math.PI;
  moonDir.set(-Math.cos(ma) * 0.7, Math.sin(Math.min(ma, Math.PI)) * 0.85 + 0.05, -0.7).normalize();
  const sunVis = t < 0.7 ? smoothstep(0.7, 0.62, t) : smoothstep(0.97, 1, t);
  const moonVis = smoothstep(0.64, 0.72, t) * smoothstep(0.98, 0.88, t);
  return { sunVis, moonVis };
}
