import { Music } from './music.js';

// All sound is synthesized with WebAudio: a V8-style engine, tires, wind,
// gravel, crashes, UI cues and the 80s soundtrack (see music.js).
//
// Mix: master -> compressor -> out, with music / sfx / engine buses whose
// volumes (and mute) persist in localStorage.

const STORE = 'enduro-horizon-audio';
const DEFAULTS = { master: 0.8, music: 0.6, sfx: 0.8, engine: 0.7, muted: false, musicOn: true };
const CYL = 8;

function loadSettings() {
  try {
    return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(STORE) || '{}') };
  } catch {
    return { ...DEFAULTS };
  }
}

export class AudioFX {
  constructor() {
    this.ctx = null;
    this.settings = loadSettings();
    this.onSongChange = null;
    this.prev = { gear: 1, throttle: 0, rpm: 800 };
    this.lastCrackle = 0;
    this.lastWhoosh = 0;
  }

  get musicOn() {
    return this.settings.musicOn;
  }

  // ------------------------------------------------------------ Setup

  init(ctxOverride) {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC && !ctxOverride) return;
    const ctx = (this.ctx = ctxOverride || new AC());
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.ratio.value = 4;
    comp.connect(ctx.destination);
    this.master = this.gain(0, comp);
    this.musicBus = this.gain(0, this.master);
    this.sfxBus = this.gain(0, this.master);
    this.engineBus = this.gain(0, this.master);
    // Tunnel echo: engine and effects feed short slapback delays off the walls.
    this.tunnelSend = this.gain(0, null);
    const tone = ctx.createBiquadFilter();
    tone.type = 'lowpass';
    tone.frequency.value = 2600;
    this.tunnelSend.connect(tone);
    for (const [time, fbAmt] of [[0.085, 0.42], [0.155, 0.35]]) {
      const dl = ctx.createDelay(0.5);
      dl.delayTime.value = time;
      const fb = this.gain(fbAmt, dl);
      tone.connect(dl);
      dl.connect(fb);
      dl.connect(this.master);
    }
    this.engineBus.connect(this.tunnelSend);
    this.sfxBus.connect(this.tunnelSend);
    this.noise = this.makeNoise(2);
    this.buildEngine();
    this.buildAmbience();

    this.music = new Music(ctx, this.musicBus);
    this.music.onSongChange = (t, a) => this.onSongChange && this.onSongChange(t, a);
    this.music.setEnabled(this.settings.musicOn);
    this.music.nextTime = ctx.currentTime + 0.2;
    if (!ctxOverride) {
      this.timer = setInterval(() => this.ctx.state === 'running' && this.music.tick(), 25);
      setTimeout(() => this.onSongChange && this.onSongChange(this.music.song.title, 'Enduro Horizon OST'), 400);
    }
    this.applyVolumes();
  }

  gain(v, dest) {
    const g = this.ctx.createGain();
    g.gain.value = v;
    if (dest) g.connect(dest);
    return g;
  }

  filter(type, freq, q = 1, dest) {
    const f = this.ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    if (dest) f.connect(dest);
    return f;
  }

  makeNoise(seconds) {
    const buf = this.ctx.createBuffer(1, this.ctx.sampleRate * seconds, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    return buf;
  }

  loopNoise() {
    const src = this.ctx.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    src.start(0, Math.random() * 1.5);
    return src;
  }

  osc(type, freq) {
    const o = this.ctx.createOscillator();
    if (type instanceof PeriodicWave) o.setPeriodicWave(type);
    else o.type = type;
    o.frequency.value = freq;
    o.start();
    return o;
  }

  // Engine: firing-order oscillator with a rich custom wave, crank-order sub,
  // uneven-firing amplitude burble, saturation and a throttle-driven filter.
  buildEngine() {
    const ctx = this.ctx;
    const n = 40;
    const re = new Float32Array(n);
    const im = new Float32Array(n);
    for (let k = 1; k < n; k++) {
      im[k] = (1 / Math.pow(k, 1.05)) * (k % 2 ? 1 : 0.65) * (k === 2 || k === 3 ? 1.4 : 1);
      re[k] = (k % 3 === 0 ? 0.25 : 0) / k;
    }
    const wave = ctx.createPeriodicWave(re, im);
    const subRe = new Float32Array(8);
    const subIm = new Float32Array([0, 1, 0.5, 0.35, 0.2, 0.12, 0.08, 0.05]);
    const subWave = ctx.createPeriodicWave(subRe, subIm);

    this.eng = {};
    const E = this.eng;
    E.fire = this.osc(wave, 60);
    E.fire2 = this.osc(wave, 60);
    E.fire2.detune.value = 14;
    E.sub = this.osc(subWave, 15);
    // Burble: an LFO at crank frequency wobbling the amplitude.
    E.am = this.gain(1);
    E.lfo = this.osc('triangle', 15);
    E.lfoDepth = this.gain(0.3);
    E.lfo.connect(E.lfoDepth).connect(E.am.gain);
    const mix = this.gain(1);
    E.fire.connect(this.gain(0.55, mix));
    E.fire2.connect(this.gain(0.3, mix));
    E.subGain = this.gain(0.6, mix);
    E.sub.connect(E.subGain);
    mix.connect(E.am);

    const shaper = ctx.createWaveShaper();
    const curve = new Float32Array(1024);
    for (let i = 0; i < 1024; i++) {
      const x = (i / 1023) * 2 - 1;
      curve[i] = Math.tanh(x * 2.6) * 0.8;
    }
    shaper.curve = curve;
    shaper.oversample = '2x';
    E.drive = this.gain(1);
    E.am.connect(E.drive).connect(shaper);
    E.load = this.filter('lowpass', 800, 1.8);
    E.body = ctx.createBiquadFilter();
    E.body.type = 'peaking';
    E.body.frequency.value = 110;
    E.body.gain.value = 7;
    E.body.Q.value = 0.9;
    E.out = this.gain(0, this.engineBus);
    shaper.connect(E.load).connect(E.body).connect(E.out);

    // Intake roar: noise tuned to the engine order.
    E.intake = this.filter('bandpass', 300, 1.4);
    E.intakeGain = this.gain(0, this.engineBus);
    this.loopNoise().connect(E.intake).connect(E.intakeGain);
  }

  buildAmbience() {
    // Tire squeal with wobble.
    this.squeal = this.filter('bandpass', 2500, 9);
    const wob = this.osc('sine', 7);
    const wobDepth = this.gain(220);
    wob.connect(wobDepth).connect(this.squeal.frequency);
    const sq2 = this.filter('peaking', 3300, 4);
    sq2.gain.value = 9;
    this.squealGain = this.gain(0, this.sfxBus);
    this.loopNoise().connect(this.squeal).connect(sq2).connect(this.squealGain);

    // Gravel rumble when off-road.
    this.gravel = this.filter('lowpass', 450, 1.5);
    const rumbleAm = this.gain(0.7);
    const rumble = this.osc('square', 13);
    const rd = this.gain(0.3);
    rumble.connect(rd).connect(rumbleAm.gain);
    this.gravelGain = this.gain(0, this.sfxBus);
    this.loopNoise().connect(this.gravel).connect(rumbleAm).connect(this.gravelGain);

    // Wind and road roar.
    this.wind = this.filter('bandpass', 600, 0.5);
    this.windGain = this.gain(0, this.sfxBus);
    this.loopNoise().connect(this.wind).connect(this.windGain);
    this.road = this.filter('lowpass', 180, 0.7);
    this.roadGain = this.gain(0, this.sfxBus);
    this.loopNoise().connect(this.road).connect(this.roadGain);
  }

  // ------------------------------------------------------------ Volume

  applyVolumes() {
    if (!this.ctx) return;
    const s = this.settings;
    const t = this.ctx.currentTime;
    this.master.gain.setTargetAtTime(s.muted ? 0 : s.master, t, 0.05);
    this.musicBus.gain.setTargetAtTime(s.musicOn ? s.music : 0, t, 0.15);
    this.sfxBus.gain.setTargetAtTime(s.sfx, t, 0.05);
    this.engineBus.gain.setTargetAtTime(s.engine, t, 0.05);
    this.music.setEnabled(s.musicOn);
  }

  save() {
    try {
      localStorage.setItem(STORE, JSON.stringify(this.settings));
    } catch {
      /* storage unavailable */
    }
  }

  setVolume(name, v) {
    this.settings[name] = Math.max(0, Math.min(1, v));
    this.applyVolumes();
    this.save();
  }

  setMuted(m) {
    this.settings.muted = m;
    this.applyVolumes();
    this.save();
  }

  // 0 = open road, 1 = deep inside a tunnel.
  setTunnel(amount) {
    if (!this.ctx) return;
    this.tunnelSend.gain.setTargetAtTime(amount * 0.55, this.ctx.currentTime, 0.12);
  }

  toggleMute() {
    this.setMuted(!this.settings.muted);
    return this.settings.muted;
  }

  toggleMusic() {
    this.settings.musicOn = !this.settings.musicOn;
    this.applyVolumes();
    this.save();
    return this.settings.musicOn;
  }

  nextSong() {
    if (!this.ctx) return;
    this.music.next();
  }

  get songTitle() {
    return this.music ? this.music.song.title : '';
  }

  // ------------------------------------------------------------ Engine per frame

  setEngine(arg, throttleArg, speedArg, offroadArg, activeArg) {
    if (!this.ctx) return;
    // Back-compat with the old positional signature (rpm 0..1).
    const p = typeof arg === 'object'
      ? arg
      : { rpm: 800 + arg * 7000, throttle: throttleArg, speed: speedArg, offroad: offroadArg, active: activeArg, gear: 1, slip: 0 };
    const { throttle = 0, speed = 0, gear = 1, slip = 0, offroad = false, active = true, braking = false } = p;
    const rpm = Math.max(600, Math.min(8200, p.rpm || 800));
    const t = this.ctx.currentTime;
    const E = this.eng;
    const r = (rpm - 800) / 7000;
    const fire = (rpm / 60) * (CYL / 2);

    // Gear changes: cut and chirp on upshift, blip on downshift.
    let cut = 1;
    if (active && gear !== this.prev.gear) {
      if (gear > this.prev.gear) {
        cut = 0.25;
        this.shiftChirp(t);
      } else {
        this.blip(t);
      }
      this.prev.shiftT = t;
    }
    if (this.prev.shiftT && t - this.prev.shiftT < 0.09) cut = 0.3;

    E.fire.frequency.setTargetAtTime(fire, t, 0.03);
    E.fire2.frequency.setTargetAtTime(fire * 1.002, t, 0.03);
    E.sub.frequency.setTargetAtTime(rpm / 60, t, 0.03);
    E.lfo.frequency.setTargetAtTime((rpm / 60) * 0.5, t, 0.03);
    const burble = (1 - throttle) * (1 - r) * 0.55 + 0.12;
    E.lfoDepth.gain.setTargetAtTime(burble, t, 0.08);
    E.subGain.gain.setTargetAtTime(0.7 - r * 0.35, t, 0.08);
    E.drive.gain.setTargetAtTime(0.8 + throttle * 1.6, t, 0.06);
    E.load.frequency.setTargetAtTime(220 + Math.pow(r, 1.2) * 3200 * (0.3 + 0.7 * throttle) + 150, t, 0.05);
    const vol = active ? (0.18 + throttle * 0.17 + r * 0.1) * cut : 0;
    E.out.gain.setTargetAtTime(vol, t, cut < 1 ? 0.01 : 0.06);
    E.intake.frequency.setTargetAtTime(fire * 2.5, t, 0.05);
    E.intakeGain.gain.setTargetAtTime(active ? throttle * (0.02 + r * 0.09) : 0, t, 0.06);

    // Exhaust crackle when lifting off at high revs.
    if (active && this.prev.throttle > 0.5 && throttle < 0.2 && rpm > 4200 && t - this.lastCrackle > 1) {
      this.lastCrackle = t;
      this.crackles(t, 4 + Math.floor(r * 6));
    } else if (active && throttle < 0.1 && rpm > 5000 && Math.random() < 0.01) {
      this.crackles(t, 1);
    }

    const squeal = active && speed > 4 ? Math.pow(Math.max(0, slip), 1.5) * 0.3 : 0;
    this.squealGain.gain.setTargetAtTime(squeal, t, 0.05);
    this.squeal.frequency.setTargetAtTime(2200 + slip * 700 + (braking ? 300 : 0), t, 0.1);
    const gravel = active && offroad ? Math.min(1, speed / 20) * 0.35 : 0;
    this.gravelGain.gain.setTargetAtTime(gravel, t, 0.08);
    this.gravel.frequency.setTargetAtTime(250 + speed * 8, t, 0.1);
    const sp = Math.min(1, speed / 63);
    this.windGain.gain.setTargetAtTime(active ? sp * sp * 0.12 : 0, t, 0.1);
    this.wind.frequency.setTargetAtTime(400 + speed * 16, t, 0.1);
    this.roadGain.gain.setTargetAtTime(active && !offroad ? sp * 0.18 : 0, t, 0.1);

    this.prev.gear = gear;
    this.prev.throttle = throttle;
    this.prev.rpm = rpm;
  }

  // ------------------------------------------------------------ One-shots

  burst({ freq = 800, type = 'lowpass', q = 1, dur = 0.4, gain = 0.5, when = 0, dest = this.sfxBus, pan = 0 }) {
    const ctx = this.ctx;
    const t = ctx.currentTime + when;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const f = this.filter(type, freq, q);
    const g = this.gain(0);
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0005, t + dur);
    let node = src.connect(f).connect(g);
    if (pan) {
      const p = ctx.createStereoPanner();
      p.pan.value = pan;
      node = node.connect(p);
    }
    node.connect(dest);
    src.start(t, Math.random());
    src.stop(t + dur + 0.05);
    return { f, g, t };
  }

  tone({ freq, freq2 = freq, type = 'square', dur = 0.12, gain = 0.15, when = 0, dest = this.sfxBus, cutoff = 4000, attack = 0.01 }) {
    const ctx = this.ctx;
    const t = ctx.currentTime + when;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (freq2 !== freq) o.frequency.exponentialRampToValueAtTime(freq2, t + dur);
    const f = this.filter('lowpass', cutoff);
    const g = this.gain(0);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(f).connect(g).connect(dest);
    o.start(t);
    o.stop(t + dur + 0.05);
    return g;
  }

  crackles(t0, count) {
    for (let i = 0; i < count; i++) {
      const when = 0.04 + Math.random() * 0.6 * (i / count + 0.2);
      this.burst({ freq: 1200 + Math.random() * 2200, type: 'bandpass', q: 1.5, dur: 0.03 + Math.random() * 0.03, gain: 0.35 + Math.random() * 0.4, when, dest: this.engineBus });
      this.tone({ freq: 90 + Math.random() * 40, freq2: 50, type: 'sine', dur: 0.06, gain: 0.25, when, dest: this.engineBus, attack: 0.002 });
    }
  }

  shiftChirp() {
    this.burst({ freq: 900, type: 'bandpass', q: 2, dur: 0.07, gain: 0.12, dest: this.engineBus });
    this.tone({ freq: 2800, freq2: 2000, type: 'triangle', dur: 0.05, gain: 0.025, dest: this.engineBus });
  }

  blip(t) {
    const E = this.eng;
    E.load.frequency.cancelScheduledValues(t);
    E.load.frequency.setValueAtTime(E.load.frequency.value, t);
    E.load.frequency.linearRampToValueAtTime(3800, t + 0.06);
    E.load.frequency.setTargetAtTime(1200, t + 0.08, 0.08);
    this.crackles(t, 2);
  }

  crash(intensity = 1) {
    if (!this.ctx) return;
    const k = Math.max(0.2, Math.min(1, intensity));
    this.burst({ freq: 700 + k * 600, dur: 0.5 + k * 0.3, gain: 0.7 * k });
    this.tone({ freq: 140, freq2: 40, type: 'sawtooth', dur: 0.35, gain: 0.4 * k, cutoff: 700, attack: 0.003 });
    // Metallic clank: inharmonic partials.
    for (const [f, d] of [[420, 0.35], [613, 0.28], [947, 0.22], [1380, 0.18]]) {
      this.tone({ freq: f, freq2: f * 0.97, type: 'triangle', dur: d * (0.6 + k), gain: 0.06 * k, cutoff: 6000, attack: 0.002 });
    }
    if (k > 0.5) this.burst({ freq: 6500, type: 'highpass', dur: 0.4, gain: 0.18 * k, when: 0.03 });
  }

  whoosh(pan = 0) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    if (t - this.lastWhoosh < 0.15) return;
    this.lastWhoosh = t;
    const b = this.burst({ freq: 1400, type: 'bandpass', q: 0.8, dur: 0.55, gain: 0.0001, pan });
    b.g.gain.cancelScheduledValues(t);
    b.g.gain.setValueAtTime(0.0001, t);
    b.g.gain.exponentialRampToValueAtTime(0.32, t + 0.12);
    b.g.gain.exponentialRampToValueAtTime(0.0005, t + 0.55);
    b.f.frequency.setValueAtTime(1600, t);
    b.f.frequency.exponentialRampToValueAtTime(350, t + 0.5);
    // The other car's engine, dropping in pitch as it goes by.
    const o = this.ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(190, t);
    o.frequency.exponentialRampToValueAtTime(120, t + 0.45);
    const f = this.filter('lowpass', 700);
    const g = this.gain(0);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.06, t + 0.1);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.5);
    const p = this.ctx.createStereoPanner();
    p.pan.setValueAtTime(pan, t);
    p.pan.linearRampToValueAtTime(pan * 0.3, t + 0.5);
    o.connect(f).connect(g).connect(p).connect(this.sfxBus);
    o.start(t);
    o.stop(t + 0.55);
  }

  pass(up) {
    if (!this.ctx) return;
    if (up) this.tone({ freq: 1046, freq2: 1568, type: 'triangle', dur: 0.12, gain: 0.1 });
    else this.tone({ freq: 392, freq2: 262, type: 'triangle', dur: 0.18, gain: 0.1 });
  }

  countdown(final) {
    if (!this.ctx) return;
    this.tone({ freq: final ? 1318 : 659, type: 'square', dur: final ? 0.6 : 0.25, gain: 0.16, cutoff: 3000 });
  }

  fanfare() {
    if (!this.ctx) return;
    [523, 659, 784, 1046, 1318].forEach((f, i) => this.tone({ freq: f, type: 'sawtooth', dur: 0.25, gain: 0.08, when: i * 0.09, cutoff: 3500 }));
  }

  gameOver() {
    if (!this.ctx) return;
    [392, 330, 262, 196].forEach((f, i) => this.tone({ freq: f, type: 'sawtooth', dur: 0.4, gain: 0.1, when: i * 0.22, cutoff: 1500 }));
  }
}
