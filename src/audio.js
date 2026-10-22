// All sound is synthesized with WebAudio: engine, wind, crashes, UI blips and
// a small synthwave soundtrack sequenced in real time.

const midi = (n) => 440 * Math.pow(2, (n - 69) / 12);

// Am - F - C - G, twice, then Am - F - C - E for a little lift.
const PROGRESSION = [
  { root: 45, chord: [57, 60, 64] },
  { root: 41, chord: [53, 57, 60] },
  { root: 48, chord: [55, 60, 64] },
  { root: 43, chord: [55, 59, 62] },
  { root: 45, chord: [57, 60, 64] },
  { root: 41, chord: [53, 57, 60] },
  { root: 48, chord: [55, 60, 64] },
  { root: 40, chord: [56, 59, 64] },
];

export class AudioFX {
  constructor() {
    this.ctx = null;
    this.musicOn = true;
  }

  init() {
    if (this.ctx) {
      this.ctx.resume();
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = (this.ctx = new AC());
    const comp = ctx.createDynamicsCompressor();
    comp.connect(ctx.destination);
    this.master = ctx.createGain();
    this.master.gain.value = 0.7;
    this.master.connect(comp);

    // Engine: detuned saw + square through a resonant lowpass.
    this.engFilter = ctx.createBiquadFilter();
    this.engFilter.type = 'lowpass';
    this.engFilter.Q.value = 5;
    this.engGain = ctx.createGain();
    this.engGain.gain.value = 0;
    this.osc1 = ctx.createOscillator();
    this.osc1.type = 'sawtooth';
    this.osc2 = ctx.createOscillator();
    this.osc2.type = 'square';
    const o2g = ctx.createGain();
    o2g.gain.value = 0.35;
    this.osc1.connect(this.engFilter);
    this.osc2.connect(o2g).connect(this.engFilter);
    this.engFilter.connect(this.engGain).connect(this.master);
    this.osc1.start();
    this.osc2.start();

    // Wind / tire noise.
    this.noise = this.makeNoise(2);
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    this.windFilter = ctx.createBiquadFilter();
    this.windFilter.type = 'bandpass';
    this.windFilter.frequency.value = 700;
    this.windFilter.Q.value = 0.6;
    this.windGain = ctx.createGain();
    this.windGain.gain.value = 0;
    src.connect(this.windFilter).connect(this.windGain).connect(this.master);
    src.start();

    // Music bus with a feedback delay for that wide synthwave sound.
    this.music = ctx.createGain();
    this.music.gain.value = this.musicOn ? 0.32 : 0;
    this.music.connect(this.master);
    this.delay = ctx.createDelay(1);
    this.delay.delayTime.value = (60 / 108) * 0.75;
    const fb = ctx.createGain();
    fb.gain.value = 0.32;
    const wet = ctx.createGain();
    wet.gain.value = 0.35;
    this.delay.connect(fb).connect(this.delay);
    this.delay.connect(wet).connect(this.music);
    this.step = 0;
    this.stepDur = 60 / 108 / 4;
    this.nextTime = ctx.currentTime + 0.1;
    setInterval(() => this.schedule(), 25);
  }

  makeNoise(seconds) {
    const buf = this.ctx.createBuffer(1, this.ctx.sampleRate * seconds, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    return buf;
  }

  toggleMusic() {
    this.musicOn = !this.musicOn;
    if (this.ctx) this.music.gain.setTargetAtTime(this.musicOn ? 0.32 : 0, this.ctx.currentTime, 0.2);
    return this.musicOn;
  }

  setEngine(rpm, throttle, speed, offroad, active) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const f = 42 + rpm * 150;
    this.osc1.frequency.setTargetAtTime(f, t, 0.04);
    this.osc2.frequency.setTargetAtTime(f * 0.5 + 1.5, t, 0.04);
    this.engFilter.frequency.setTargetAtTime(380 + rpm * 1700 + throttle * 900, t, 0.06);
    this.engGain.gain.setTargetAtTime(active ? 0.07 + throttle * 0.06 : 0, t, 0.1);
    const wind = active ? Math.min(0.1, (speed / 63) * 0.07) + (offroad ? 0.14 : 0) : 0;
    this.windGain.gain.setTargetAtTime(wind, t, 0.1);
    this.windFilter.frequency.setTargetAtTime(offroad ? 260 : 600 + speed * 12, t, 0.1);
  }

  burst({ freq = 800, type = 'lowpass', dur = 0.4, gain = 0.5, when = 0, dest = this.master }) {
    const ctx = this.ctx;
    const t = ctx.currentTime + when;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(f).connect(g).connect(dest);
    src.start(t, Math.random());
    src.stop(t + dur + 0.05);
  }

  tone({ freq, freq2 = freq, type = 'square', dur = 0.12, gain = 0.15, when = 0, dest = this.master, cutoff = 4000 }) {
    const ctx = this.ctx;
    const t = ctx.currentTime + when;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (freq2 !== freq) o.frequency.exponentialRampToValueAtTime(freq2, t + dur);
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = cutoff;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(f).connect(g).connect(dest);
    o.start(t);
    o.stop(t + dur + 0.05);
    return g;
  }

  crash() {
    if (!this.ctx) return;
    this.burst({ freq: 900, dur: 0.5, gain: 0.7 });
    this.tone({ freq: 140, freq2: 45, type: 'sawtooth', dur: 0.35, gain: 0.35, cutoff: 900 });
  }

  pass(up) {
    if (!this.ctx) return;
    if (up) this.tone({ freq: 1046, freq2: 1568, type: 'triangle', dur: 0.12, gain: 0.12 });
    else this.tone({ freq: 392, freq2: 262, type: 'triangle', dur: 0.18, gain: 0.12 });
  }

  countdown(final) {
    if (!this.ctx) return;
    this.tone({ freq: final ? 1318 : 659, type: 'square', dur: final ? 0.6 : 0.25, gain: 0.18, cutoff: 3000 });
  }

  fanfare() {
    if (!this.ctx) return;
    [523, 659, 784, 1046, 1318].forEach((f, i) => this.tone({ freq: f, type: 'square', dur: 0.22, gain: 0.12, when: i * 0.09, cutoff: 3500 }));
  }

  gameOver() {
    if (!this.ctx) return;
    [392, 330, 262, 196].forEach((f, i) => this.tone({ freq: f, type: 'sawtooth', dur: 0.4, gain: 0.12, when: i * 0.22, cutoff: 1500 }));
  }

  schedule() {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running') return;
    while (this.nextTime < ctx.currentTime + 0.12) {
      if (this.musicOn) this.playStep(this.step, this.nextTime - ctx.currentTime);
      this.nextTime += this.stepDur;
      this.step = (this.step + 1) % (16 * PROGRESSION.length);
    }
  }

  playStep(step, when) {
    if (when < 0) return;
    const bar = PROGRESSION[Math.floor(step / 16)];
    const s = step % 16;
    const m = this.music;
    // Drums
    if (s % 4 === 0) this.tone({ freq: 140, freq2: 42, type: 'sine', dur: 0.16, gain: 0.8, when, dest: m, cutoff: 600 });
    if (s === 4 || s === 12) {
      this.burst({ freq: 1800, type: 'highpass', dur: 0.16, gain: 0.32, when, dest: m });
      this.tone({ freq: 190, freq2: 150, type: 'triangle', dur: 0.1, gain: 0.25, when, dest: m });
    }
    if (s % 4 === 2) this.burst({ freq: 7000, type: 'highpass', dur: 0.05, gain: 0.14, when, dest: m });
    // Bass on eighths, octave bounce.
    if (s % 2 === 0) this.tone({ freq: midi(bar.root + (s % 4 === 2 ? 12 : 0)), type: 'sawtooth', dur: 0.2, gain: 0.22, when, dest: m, cutoff: 700 });
    // Arpeggio into the delay.
    const note = bar.chord[s % 3] + (Math.floor(s / 3) % 2) * 12;
    const g = this.tone({ freq: midi(note), type: 'square', dur: 0.13, gain: 0.045, when, dest: m, cutoff: 2600 });
    g.connect(this.delay);
    // Pad at the start of each bar.
    if (s === 0) {
      for (const n of bar.chord) {
        for (const det of [-6, 6]) {
          const o = this.ctx.createOscillator();
          o.type = 'sawtooth';
          o.frequency.value = midi(n - 12);
          o.detune.value = det;
          const f = this.ctx.createBiquadFilter();
          f.type = 'lowpass';
          f.frequency.value = 900;
          const pg = this.ctx.createGain();
          const t = this.ctx.currentTime + when;
          const len = this.stepDur * 16;
          pg.gain.setValueAtTime(0.0001, t);
          pg.gain.exponentialRampToValueAtTime(0.03, t + 0.4);
          pg.gain.exponentialRampToValueAtTime(0.0001, t + len);
          o.connect(f).connect(pg).connect(m);
          o.start(t);
          o.stop(t + len + 0.05);
        }
      }
    }
  }
}
