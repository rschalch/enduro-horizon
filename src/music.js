// Real-time 80s synthwave soundtrack. Everything is synthesized and sequenced
// with lookahead scheduling: gated-reverb drums, Moroder-style bass, Juno-ish
// chorused pads, ping-pong arps, FM bells/e-piano, brass stabs and a lead with
// vibrato and portamento playing composed melodies.

const PC = { C: 0, 'C#': 1, Db: 1, D: 2, 'D#': 3, Eb: 3, E: 4, F: 5, 'F#': 6, Gb: 6, G: 7, 'G#': 8, Ab: 8, A: 9, 'A#': 10, Bb: 10, B: 11 };
const mtof = (n) => 440 * Math.pow(2, (n - 69) / 12);

function noteToMidi(s) {
  const m = /^([A-G][#b]?)(-?\d)$/.exec(s);
  if (!m) throw new Error(`bad note ${s}`);
  return 12 * (Number(m[2]) + 1) + PC[m[1]];
}

// "E5:4 A4:2 | -:4 ..." -> step-indexed notes. Durations are in 16th notes.
export function parseMelody(str) {
  const byStep = new Map();
  let step = 0;
  let prev = null;
  for (const tok of str.trim().split(/\s+/)) {
    if (tok === '|') continue;
    const [n, l] = tok.split(':');
    const len = Number(l);
    if (n !== '-') {
      const midi = noteToMidi(n);
      byStep.set(step, { midi, len, prev });
      prev = midi;
    } else {
      prev = null;
    }
    step += len;
  }
  return { byStep, length: step };
}

function parseChord(name) {
  const m = /^([A-G][#b]?)(m?)(7?)$/.exec(name);
  const root = PC[m[1]];
  const minor = m[2] === 'm';
  const tones = [0, minor ? 3 : 4, 7];
  if (m[3]) tones.push(minor ? 10 : 11);
  return { root, tones: tones.map((t) => root + t) };
}

// Pitch classes voiced into a register starting at `low`.
const voice = (pcs, low) => pcs.map((p) => {
  let n = low - (low % 12) + (p % 12);
  if (n < low) n += 12;
  return n;
}).sort((a, b) => a - b);

// ---------------------------------------------------------------- Songs

const SONGS = [
  {
    title: 'Neon Overdrive',
    bpm: 118,
    lead: 'saw',
    phrases: {
      verse: `E5:4 A4:2 C5:2 E5:3 D5:1 C5:2 B4:2 | C5:6 A4:2 F4:4 A4:2 C5:2 | G4:4 C5:2 E5:2 G5:3 F5:1 E5:2 D5:2 | D5:8 B4:4 -:4 |
              E5:4 A4:2 C5:2 E5:3 D5:1 C5:2 E5:2 | F5:6 E5:2 C5:4 A4:4 | G4:2 A4:2 C5:2 E5:2 G5:4 E5:4 | D5:4 E5:4 A4:8`,
      chorus: `A5:6 G5:2 F5:4 E5:4 | D5:6 E5:2 G5:8 | E5:4 C5:4 A4:4 C5:4 | E5:12 -:4 |
               A5:6 G5:2 F5:4 A5:4 | B5:6 A5:2 G5:8 | G5:4 E5:4 C5:4 E5:4 | G#5:8 B5:8`,
    },
    sections: [
      { bars: 4, chords: ['Am', 'F', 'C', 'G'], drums: 'intro', bass: 'moroder', pad: true },
      { bars: 8, chords: ['Am', 'F', 'C', 'G'], drums: 'beat', bass: 'moroder', pad: true, arp: true, lead: 'verse' },
      { bars: 8, chords: ['F', 'G', 'Am', 'Am', 'F', 'G', 'C', 'E'], drums: 'drive', bass: 'drive', pad: true, arp: true, lead: 'chorus', keys: 'stabs' },
      { bars: 4, chords: ['F', 'G', 'Am', 'Am'], drums: 'none', pad: true, keys: 'arp' },
      { bars: 2, chords: ['F', 'G'], drums: 'build', bass: 'pulse', pad: true, keys: 'arp' },
      { bars: 8, chords: ['Am', 'F', 'C', 'G'], drums: 'beat', bass: 'moroder', pad: true, arp: true, lead: 'verse', keys: 'stabs' },
      { bars: 8, chords: ['F', 'G', 'Am', 'Am', 'F', 'G', 'C', 'E'], drums: 'drive', bass: 'drive', pad: true, arp: true, lead: 'chorus', brass: true },
      { bars: 8, chords: ['F', 'G', 'Am', 'Am', 'F', 'G', 'C', 'E'], drums: 'drive', bass: 'moroder', pad: true, arp: true, lead: 'chorus', keys: 'stabs', brass: true },
      { bars: 4, chords: ['Am', 'F', 'C', 'Am'], drums: 'intro', bass: 'moroder', pad: true, arp: true },
    ],
  },
  {
    title: 'Midnight Coastline',
    bpm: 100,
    lead: 'bell',
    phrases: {
      verse: `B4:4 G4:2 B4:2 E5:6 D5:2 | C5:4 E5:4 G5:6 E5:2 | D5:4 B4:2 D5:2 G5:4 F#5:4 | F#5:8 A5:4 F#5:4 |
              G5:4 F#5:2 E5:2 B4:6 E5:2 | E5:4 G5:4 C6:4 B5:4 | B5:6 A5:2 G5:4 D5:4 | F#5:12 -:4`,
      chorus: `G5:4 E5:4 G5:4 A5:4 | F#5:6 E5:2 D5:4 A5:4 | B5:6 A5:2 F#5:4 D5:4 | E5:12 -:4 |
               G5:4 E5:4 G5:4 C6:4 | B5:4 A5:4 F#5:4 D6:4 | B5:8 D6:4 B5:4 | E6:12 -:4`,
    },
    sections: [
      { bars: 4, chords: ['Em', 'C', 'G', 'D'], drums: 'none', pad: true, keys: 'arp' },
      { bars: 4, chords: ['Em', 'C', 'G', 'D'], drums: 'half', bass: 'eighths', pad: true, arp: true },
      { bars: 8, chords: ['Em', 'C', 'G', 'D'], drums: 'beat', bass: 'eighths', pad: true, arp: true, lead: 'verse' },
      { bars: 8, chords: ['C', 'D', 'Bm', 'Em', 'C', 'D', 'Bm', 'Em'], drums: 'beat', bass: 'moroder', pad: true, arp: true, lead: 'chorus', keys: 'stabs' },
      { bars: 4, chords: ['C', 'D', 'Bm', 'Em'], drums: 'half', bass: 'eighths', pad: true, keys: 'arp' },
      { bars: 8, chords: ['Em', 'C', 'G', 'D'], drums: 'beat', bass: 'eighths', pad: true, arp: true, lead: 'verse', keys: 'stabs' },
      { bars: 8, chords: ['C', 'D', 'Bm', 'Em', 'C', 'D', 'Bm', 'Em'], drums: 'drive', bass: 'moroder', pad: true, arp: true, lead: 'chorus', brass: true },
      { bars: 4, chords: ['Em', 'C', 'G', 'Em'], drums: 'none', pad: true, keys: 'arp' },
    ],
  },
  {
    title: 'Turbo Sunset',
    bpm: 128,
    lead: 'sync',
    phrases: {
      verse: `F#5:2 F#5:2 A5:2 F#5:2 E5:4 D5:4 | E5:2 E5:2 A5:2 E5:2 C#5:8 | D5:2 F#5:2 B5:4 A5:2 F#5:2 D5:4 | B4:4 D5:4 G5:4 F#5:2 E5:2 |
              F#5:2 F#5:2 A5:2 F#5:2 E5:4 D5:4 | E5:2 E5:2 A5:2 C#6:2 B5:4 A5:4 | D5:2 F#5:2 B5:4 A5:2 F#5:2 D5:4 | G5:8 A5:8`,
      chorus: `B5:4 A5:2 G5:2 D6:8 | C#6:4 B5:2 A5:2 E5:8 | F#5:2 A5:2 C#6:4 B5:2 A5:2 F#5:4 | B5:12 -:4 |
               B5:4 A5:2 G5:2 D6:6 E6:2 | C#6:4 E6:4 A5:8 | F#6:4 E6:2 D6:2 A5:8 | D6:12 -:4`,
    },
    sections: [
      { bars: 4, chords: ['D', 'A', 'Bm', 'G'], drums: 'intro', bass: 'gallop', arp: true },
      { bars: 8, chords: ['D', 'A', 'Bm', 'G'], drums: 'drive', bass: 'gallop', pad: true, arp: true, lead: 'verse' },
      { bars: 8, chords: ['G', 'A', 'F#m', 'Bm', 'G', 'A', 'D', 'D'], drums: 'drive', bass: 'drive', pad: true, arp: true, lead: 'chorus', brass: true },
      { bars: 4, chords: ['G', 'A', 'Bm', 'Bm'], drums: 'half', pad: true, keys: 'arp' },
      { bars: 2, chords: ['G', 'A'], drums: 'build', bass: 'pulse', pad: true },
      { bars: 8, chords: ['D', 'A', 'Bm', 'G'], drums: 'drive', bass: 'gallop', pad: true, arp: true, lead: 'verse', keys: 'stabs' },
      { bars: 8, chords: ['G', 'A', 'F#m', 'Bm', 'G', 'A', 'D', 'D'], drums: 'drive', bass: 'drive', pad: true, arp: true, lead: 'chorus', brass: true, keys: 'stabs' },
      { bars: 4, chords: ['D', 'A', 'Bm', 'D'], drums: 'intro', bass: 'gallop', pad: true, arp: true },
    ],
  },
];

for (const song of SONGS) {
  song.parsed = {};
  for (const [k, v] of Object.entries(song.phrases)) {
    const p = parseMelody(v);
    if (p.length % 16) console.warn(`[music] ${song.title}/${k} length ${p.length} is not whole bars`);
    song.parsed[k] = p;
  }
  // Flatten sections into a bar list.
  song.bars = [];
  for (const sec of song.sections) {
    for (let b = 0; b < sec.bars; b++) {
      song.bars.push({ sec, inSec: b, last: b === sec.bars - 1, first: b === 0, chord: parseChord(sec.chords[b % sec.chords.length]) });
    }
  }
}

export const SONG_LIST = SONGS.map((s) => s.title);

// ---------------------------------------------------------------- Engine

function impulse(ctx, seconds, decay, bright = 1) {
  const len = Math.floor(ctx.sampleRate * seconds);
  const buf = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let c = 0; c < 2; c++) {
    const d = buf.getChannelData(c);
    let lp = 0;
    for (let i = 0; i < len; i++) {
      const w = Math.random() * 2 - 1;
      lp += (w - lp) * bright;
      d[i] = lp * Math.pow(1 - i / len, decay);
    }
  }
  return buf;
}

export class Music {
  constructor(ctx, out) {
    this.ctx = ctx;
    this.enabled = true;
    this.songIdx = 0;
    this.bar = 0;
    this.step = 0;
    this.nextTime = 0;
    this.prevLead = null;
    this.onSongChange = null;

    const noise = ctx.createBuffer(1, ctx.sampleRate * 1.5, ctx.sampleRate);
    const nd = noise.getChannelData(0);
    for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;
    this.noise = noise;

    this.out = ctx.createGain();
    this.out.gain.value = 0.85;
    this.out.connect(out);

    // Buses
    this.drumBus = this.gain(1, this.out);
    this.synthBus = this.gain(1, this.out);
    this.padBus = this.gain(1, this.synthBus); // ducked by the kick

    // Hall reverb for leads, pads and keys.
    this.hall = ctx.createConvolver();
    this.hall.buffer = impulse(ctx, 2.8, 3, 0.35);
    this.hallSend = this.gain(1, this.hall);
    this.hall.connect(this.gain(0.32, this.out));

    // Gated reverb, the sound of 1984 snares.
    this.gateVerb = ctx.createConvolver();
    this.gateVerb.buffer = impulse(ctx, 1.2, 1.2, 0.6);
    this.gate = this.gain(0, this.drumBus);
    this.gateVerb.connect(this.gate);
    this.gateSend = this.gain(1, this.gateVerb);

    // Stereo ping-pong delay.
    this.delayIn = ctx.createGain();
    this.dl = ctx.createDelay(2);
    this.dr = ctx.createDelay(2);
    const fb = this.gain(0.38);
    const pl = ctx.createStereoPanner();
    const pr = ctx.createStereoPanner();
    pl.pan.value = -0.85;
    pr.pan.value = 0.85;
    const dlp = ctx.createBiquadFilter();
    dlp.type = 'lowpass';
    dlp.frequency.value = 3200;
    this.delayIn.connect(dlp).connect(this.dl);
    this.dl.connect(pl).connect(this.out);
    this.dl.connect(this.dr);
    this.dr.connect(pr).connect(this.out);
    this.dr.connect(fb).connect(this.dl);

    // Juno-style chorus on pads: two modulated short delays panned wide.
    this.padIn = ctx.createGain();
    this.padIn.connect(this.padBus);
    for (const [pan, rate, phase] of [[-0.7, 0.53, 0], [0.7, 0.61, 0.5]]) {
      const d = ctx.createDelay(0.05);
      d.delayTime.value = 0.012 + phase * 0.004;
      const lfo = ctx.createOscillator();
      lfo.frequency.value = rate;
      const depth = this.gain(0.0035);
      lfo.connect(depth).connect(d.delayTime);
      lfo.start();
      const p = ctx.createStereoPanner();
      p.pan.value = pan;
      this.padIn.connect(d).connect(p).connect(this.padBus);
    }
    this.padBus.connect(this.hallSend);

    this.setSong(0, false);
  }

  gain(v, dest) {
    const g = this.ctx.createGain();
    g.gain.value = v;
    if (dest) g.connect(dest);
    return g;
  }

  get song() {
    return SONGS[this.songIdx];
  }

  setSong(i, announce = true) {
    this.songIdx = ((i % SONGS.length) + SONGS.length) % SONGS.length;
    this.bar = 0;
    this.step = 0;
    this.prevLead = null;
    this.stepDur = 60 / this.song.bpm / 4;
    const t = this.ctx.currentTime;
    this.dl.delayTime.setValueAtTime(this.stepDur * 3, t);
    this.dr.delayTime.setValueAtTime(this.stepDur * 3, t);
    if (announce && this.onSongChange) this.onSongChange(this.song.title, 'Enduro Horizon OST');
  }

  next() {
    this.setSong(this.songIdx + 1);
    this.nextTime = this.ctx.currentTime + 0.1;
  }

  setEnabled(on) {
    this.enabled = on;
  }

  tick() {
    const now = this.ctx.currentTime;
    if (!this.enabled) {
      this.nextTime = now + 0.05;
      return;
    }
    if (this.nextTime < now) this.nextTime = now + 0.05;
    this.scheduleUntil(now + 0.15);
  }

  scheduleUntil(time) {
    while (this.nextTime < time) {
      this.playStep(this.nextTime);
      this.nextTime += this.stepDur;
      if (++this.step === 16) {
        this.step = 0;
        if (++this.bar >= this.song.bars.length) this.setSong(this.songIdx + 1);
      }
    }
  }

  // -------------------------------------------------------------- Sequencing

  playStep(t) {
    const song = this.song;
    const bar = song.bars[this.bar];
    const sec = bar.sec;
    const s = this.step;
    const barDur = this.stepDur * 16;

    this.drums(sec.drums, s, t, bar);
    if (sec.bass) this.bassStep(sec.bass, s, t, bar.chord.root);
    if (sec.pad && s === 0) this.pad(bar.chord, t, barDur);
    if (sec.arp) {
      const tones = voice(bar.chord.tones, 64);
      const seq = [tones[0], tones[1], tones[2], tones[0] + 12, tones[2] + 12, tones[1] + 12, tones[2], tones[1]];
      this.pluck(seq[s % 8], t, s % 2 ? -0.4 : 0.4);
    }
    if (sec.keys === 'stabs' && (s === 0 || s === 6 || s === 12)) {
      for (const n of voice(bar.chord.tones, 60)) this.fm(n, t, 0.7, 1, 2.2, 0.05);
    }
    if (sec.keys === 'arp' && s % 2 === 0) {
      const tones = voice(bar.chord.tones, 72);
      this.fm(tones[(s / 2) % tones.length] + (s >= 8 ? 12 : 0), t, 1.4, 3.5, 3, 0.05);
    }
    if (sec.brass && (s === 0 || s === 3 || s === 10)) this.brass(bar.chord, t, this.stepDur * (s === 10 ? 4 : 2));
    if (sec.lead) {
      const phrase = song.parsed[sec.lead];
      const local = ((bar.inSec * 16) % phrase.length) + s;
      const note = phrase.byStep.get(local);
      if (note) this.lead(note.midi, t, note.len * this.stepDur, note.prev);
    }
  }

  drums(kind, s, t, bar) {
    if (!kind || kind === 'none') return;
    const fill = bar.last && kind !== 'intro' && kind !== 'build' && s >= 12;
    if (bar.first && s === 0 && this.bar > 0) this.crash(t);
    if (kind === 'build') {
      const bi = bar.inSec * 16 + s;
      const total = bar.sec.bars * 16;
      if (bar.inSec === 0 ? s % 2 === 0 : true) this.snare(t, 0.15 + (bi / total) * 0.5, false);
      if (s % 4 === 0) this.kick(t, 0.7);
      return;
    }
    if (fill) {
      this.tom([0, 1, 2, 2][s - 12], t);
      if (s === 12) this.kick(t, 0.9);
      return;
    }
    if (kind === 'intro') {
      if (s % 4 === 0) this.kick(t, 0.85);
      if (s % 4 === 2) this.hat(t, 0.11, true);
      return;
    }
    if (kind === 'half') {
      if (s === 0 || s === 10) this.kick(t, 0.8);
      if (s === 8) this.snare(t, 0.8, true);
      if (s % 2 === 0) this.hat(t, 0.07, false);
      return;
    }
    if (kind === 'beat') {
      if (s === 0 || s === 6 || s === 8 || s === 11) this.kick(t, s === 0 || s === 8 ? 0.95 : 0.7);
      if (s === 4 || s === 12) this.snare(t, 0.85, true);
      if (s % 2 === 0) this.hat(t, s % 4 === 2 ? 0.1 : 0.06, false);
      if (s === 14) this.hat(t, 0.09, true);
      return;
    }
    // drive: four on the floor, claps, 16th hats.
    if (s % 4 === 0) this.kick(t, 0.95);
    if (s === 4 || s === 12) {
      this.snare(t, 0.8, true);
      this.clap(t);
    }
    this.hat(t, s % 4 === 2 ? 0.11 : s % 2 ? 0.04 : 0.06, s % 4 === 2 && s === 14);
  }

  bassStep(kind, s, t, rootPc) {
    const root = 28 + (rootPc % 12) + (rootPc % 12 < 4 ? 12 : 0);
    let n = null;
    if (kind === 'moroder') n = root + (s % 2 ? 12 : 0);
    else if (kind === 'drive') n = s % 2 === 0 ? root + (s % 4 === 2 ? 12 : 0) : null;
    else if (kind === 'eighths') n = s % 2 === 0 ? root : null;
    else if (kind === 'pulse') n = s % 4 === 0 ? root : null;
    else if (kind === 'gallop') n = s % 4 !== 1 ? root + (s % 4 === 3 ? 12 : 0) : null;
    if (n !== null) this.bass(n, t, this.stepDur * (kind === 'pulse' ? 3 : 0.9));
  }

  // -------------------------------------------------------------- Instruments

  env(param, t, attack, peak, decay, sustain = 0.0001) {
    param.setValueAtTime(0.0001, t);
    param.exponentialRampToValueAtTime(peak, t + attack);
    param.exponentialRampToValueAtTime(Math.max(0.0001, sustain), t + attack + decay);
  }

  noiseSrc(t, dur) {
    const src = this.ctx.createBufferSource();
    src.buffer = this.noise;
    src.start(t, Math.random() * 0.5);
    src.stop(t + dur + 0.05);
    return src;
  }

  kick(t, vel) {
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(160, t);
    o.frequency.exponentialRampToValueAtTime(44, t + 0.12);
    const g = this.gain(0);
    g.gain.setValueAtTime(vel, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.42);
    o.connect(g).connect(this.drumBus);
    o.start(t);
    o.stop(t + 0.45);
    // Click
    const c = this.noiseSrc(t, 0.02);
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 2500;
    const cg = this.gain(0);
    this.env(cg.gain, t, 0.001, vel * 0.25, 0.015);
    c.connect(hp).connect(cg).connect(this.drumBus);
    // Sidechain pump on the pads.
    const pg = this.padBus.gain;
    pg.cancelScheduledValues(t);
    pg.setValueAtTime(0.45, t);
    pg.linearRampToValueAtTime(1, t + this.stepDur * 3);
  }

  snare(t, vel, gated) {
    const ctx = this.ctx;
    const n = this.noiseSrc(t, 0.25);
    const bp = ctx.createBiquadFilter();
    bp.type = 'highpass';
    bp.frequency.value = 1200;
    const ng = this.gain(0);
    this.env(ng.gain, t, 0.001, vel * 0.5, 0.18);
    n.connect(bp).connect(ng).connect(this.drumBus);
    const o = ctx.createOscillator();
    o.type = 'triangle';
    o.frequency.setValueAtTime(200, t);
    o.frequency.exponentialRampToValueAtTime(150, t + 0.08);
    const og = this.gain(0);
    this.env(og.gain, t, 0.001, vel * 0.4, 0.1);
    o.connect(og).connect(this.drumBus);
    o.start(t);
    o.stop(t + 0.15);
    if (gated) {
      ng.connect(this.gateSend);
      og.connect(this.gateSend);
      const g = this.gate.gain;
      g.cancelScheduledValues(t);
      g.setValueAtTime(0.9, t);
      g.setValueAtTime(0.9, t + 0.2);
      g.linearRampToValueAtTime(0, t + 0.23);
    }
  }

  clap(t) {
    const ctx = this.ctx;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 1300;
    bp.Q.value = 1.2;
    const g = this.gain(0);
    g.gain.setValueAtTime(0.0001, t);
    for (let i = 0; i < 3; i++) {
      g.gain.setValueAtTime(0.35, t + i * 0.011);
      g.gain.exponentialRampToValueAtTime(0.05, t + i * 0.011 + 0.009);
    }
    g.gain.setValueAtTime(0.25, t + 0.034);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.2);
    this.noiseSrc(t, 0.22).connect(bp).connect(g).connect(this.drumBus);
    g.connect(this.gateSend);
  }

  hat(t, vel, open) {
    const hp = this.ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 7500;
    const g = this.gain(0);
    const dur = open ? 0.28 : 0.045;
    this.env(g.gain, t, 0.001, vel, dur);
    const p = this.ctx.createStereoPanner();
    p.pan.value = 0.3;
    this.noiseSrc(t, dur).connect(hp).connect(g).connect(p).connect(this.drumBus);
  }

  crash(t) {
    const hp = this.ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 5000;
    const g = this.gain(0);
    this.env(g.gain, t, 0.002, 0.13, 1.4);
    const src = this.ctx.createBufferSource();
    src.buffer = this.noise;
    src.start(t);
    src.stop(t + 1.45);
    src.connect(hp).connect(g).connect(this.drumBus);
    g.connect(this.hallSend);
  }

  tom(i, t) {
    const f = [220, 165, 120][i];
    const o = this.ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(f * 1.6, t);
    o.frequency.exponentialRampToValueAtTime(f, t + 0.12);
    const g = this.gain(0);
    this.env(g.gain, t, 0.002, 0.55, 0.32);
    const p = this.ctx.createStereoPanner();
    p.pan.value = [-0.4, 0, 0.4][i];
    o.connect(g).connect(p).connect(this.drumBus);
    g.connect(this.gateSend);
    o.start(t);
    o.stop(t + 0.4);
  }

  bass(n, t, dur) {
    const ctx = this.ctx;
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.Q.value = 7;
    f.frequency.setValueAtTime(2200, t);
    f.frequency.exponentialRampToValueAtTime(180, t + 0.14);
    const g = this.gain(0);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.24, t + 0.004);
    g.gain.setValueAtTime(0.24, t + dur * 0.8);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur + 0.04);
    for (const det of [-7, 7]) {
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = mtof(n);
      o.detune.value = det;
      o.connect(f);
      o.start(t);
      o.stop(t + dur + 0.06);
    }
    const sub = ctx.createOscillator();
    sub.type = 'square';
    sub.frequency.value = mtof(n - 12);
    const sg = this.gain(0.35);
    sub.connect(sg).connect(f);
    sub.start(t);
    sub.stop(t + dur + 0.06);
    f.connect(g).connect(this.synthBus);
  }

  pad(chord, t, dur) {
    const ctx = this.ctx;
    const notes = voice(chord.tones, 52);
    notes.push(notes[0] + 12);
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.Q.value = 1.5;
    f.frequency.setValueAtTime(700, t);
    f.frequency.linearRampToValueAtTime(1700, t + dur * 0.6);
    f.frequency.linearRampToValueAtTime(1000, t + dur);
    const g = this.gain(0);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.05, t + 0.35);
    g.gain.setValueAtTime(0.05, t + dur - 0.05);
    g.gain.linearRampToValueAtTime(0.0001, t + dur + 0.5);
    for (const n of notes) {
      for (const det of [-11, 0, 11]) {
        const o = ctx.createOscillator();
        o.type = det ? 'sawtooth' : 'square';
        o.frequency.value = mtof(n);
        o.detune.value = det;
        o.connect(f);
        o.start(t);
        o.stop(t + dur + 0.55);
      }
    }
    f.connect(g).connect(this.padIn);
  }

  pluck(n, t, pan) {
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    o.type = 'square';
    o.frequency.value = mtof(n);
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.Q.value = 4;
    f.frequency.setValueAtTime(4000, t);
    f.frequency.exponentialRampToValueAtTime(400, t + 0.12);
    const g = this.gain(0);
    this.env(g.gain, t, 0.002, 0.05, 0.14);
    const p = ctx.createStereoPanner();
    p.pan.value = pan;
    o.connect(f).connect(g).connect(p).connect(this.synthBus);
    g.connect(this.delayIn);
    o.start(t);
    o.stop(t + 0.2);
  }

  // Two-operator FM: ratio 1 = e-piano, 3.5 = bell.
  fm(n, t, dur, ratio, index, vel) {
    const ctx = this.ctx;
    const f = mtof(n);
    const car = ctx.createOscillator();
    car.frequency.value = f;
    const mod = ctx.createOscillator();
    mod.frequency.value = f * ratio;
    const mg = this.gain(0);
    mg.gain.setValueAtTime(f * index, t);
    mg.gain.exponentialRampToValueAtTime(f * 0.05, t + dur * 0.6);
    mod.connect(mg).connect(car.frequency);
    const g = this.gain(0);
    this.env(g.gain, t, 0.003, vel, dur);
    car.connect(g).connect(this.synthBus);
    g.connect(this.hallSend);
    g.connect(this.delayIn);
    for (const o of [car, mod]) {
      o.start(t);
      o.stop(t + dur + 0.05);
    }
  }

  brass(chord, t, dur) {
    const ctx = this.ctx;
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.Q.value = 2;
    f.frequency.setValueAtTime(500, t);
    f.frequency.exponentialRampToValueAtTime(3200, t + 0.05);
    f.frequency.exponentialRampToValueAtTime(1300, t + dur);
    const g = this.gain(0);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.06, t + 0.03);
    g.gain.setValueAtTime(0.06, t + dur * 0.7);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur + 0.08);
    for (const n of voice(chord.tones, 57)) {
      for (const det of [-8, 8]) {
        const o = ctx.createOscillator();
        o.type = 'sawtooth';
        o.frequency.value = mtof(n);
        o.detune.value = det;
        o.connect(f);
        o.start(t);
        o.stop(t + dur + 0.1);
      }
    }
    f.connect(g).connect(this.synthBus);
    g.connect(this.hallSend);
  }

  lead(n, t, dur, prev) {
    const ctx = this.ctx;
    const type = this.song.lead;
    const freq = mtof(n);
    if (type === 'bell') {
      this.fm(n, t, Math.max(0.6, dur * 1.2), 3.5, 2.6, 0.11);
      this.fm(n - 12, t, dur, 1, 1.4, 0.05);
      return;
    }
    const g = this.gain(0);
    const rel = 0.12;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.085, t + 0.012);
    g.gain.exponentialRampToValueAtTime(0.065, t + 0.15);
    g.gain.setValueAtTime(0.065, t + dur * 0.92);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur + rel);
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.Q.value = type === 'sync' ? 6 : 2;
    f.frequency.setValueAtTime(type === 'sync' ? 5000 : 3400, t);
    f.frequency.exponentialRampToValueAtTime(type === 'sync' ? 2200 : 1900, t + 0.25);
    // Delayed vibrato.
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 5.6;
    const vib = this.gain(0);
    vib.gain.setValueAtTime(0, t);
    vib.gain.linearRampToValueAtTime(dur > 0.3 ? 22 : 6, t + Math.min(0.35, dur));
    lfo.connect(vib);
    lfo.start(t);
    lfo.stop(t + dur + rel + 0.05);
    const parts = type === 'sync' ? [['sawtooth', 0, 1], ['sawtooth', 9, 1], ['square', 1200, 0.4]] : [['sawtooth', -6, 1], ['square', 6, 0.7]];
    for (const [wave, det, lvl] of parts) {
      const o = ctx.createOscillator();
      o.type = wave;
      o.detune.value = det;
      // Portamento from the previous note when the line is legato.
      if (prev !== null && prev !== undefined) {
        o.frequency.setValueAtTime(mtof(prev), t);
        o.frequency.exponentialRampToValueAtTime(freq, t + 0.045);
      } else {
        o.frequency.setValueAtTime(freq, t);
      }
      vib.connect(o.detune);
      const og = this.gain(lvl);
      o.connect(og).connect(f);
      o.start(t);
      o.stop(t + dur + rel + 0.05);
    }
    f.connect(g).connect(this.synthBus);
    g.connect(this.hallSend);
    const ds = this.gain(0.5);
    g.connect(ds).connect(this.delayIn);
  }
}
