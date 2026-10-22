import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import './style.css';
import { HALF_W, LANES, Track } from './track.js';
import { World } from './world.js';
import { Environment } from './sky.js';
import { beamMaterial, buildPlayerCar, setCarEnvMap, trafficLights } from './cars.js';
import { Traffic } from './traffic.js';
import { Weather } from './weather.js';
import { AudioFX } from './audio.js';
import { Input } from './input.js';
import { HUD } from './hud.js';
import { initSettings } from './settings.js';
import { initProps, updatePropLights } from './props.js';
import { clamp, lerp, smoothstep } from './math.js';

const DAY_LEN = 200; // seconds per in-game day
const MAX_V = 63; // m/s, ~227 km/h
// Top speed (m/s) of each gear at the redline; index 0 unused.
const GEAR_TOP = [0, 16, 27, 37, 47, 56, 66];
const IDLE_RPM = 900;
const REDLINE = 7600;
const params = new URLSearchParams(location.search);
const START_S = Number(params.get('s')) || 40;
const coarse = matchMedia('(pointer: coarse)').matches;

// ---------- Renderer ----------
const canvas = document.getElementById('game');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setSize(innerWidth, innerHeight);
renderer.toneMapping = THREE.NeutralToneMapping;
renderer.toneMappingExposure = 1.0;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(62, innerWidth / innerHeight, 0.3, 8000);
const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
const bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.5, 0.45, 0.9);
composer.addPass(bloom);
composer.addPass(new OutputPass());

// Final color grade (in display space): saturation, contrast, warm/cool tint, vignette.
const grade = new ShaderPass({
  uniforms: { tDiffuse: { value: null }, sat: { value: 1 }, con: { value: 1 }, tint: { value: new THREE.Color(1, 1, 1) }, vig: { value: 0.18 } },
  vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
  fragmentShader: `
    uniform sampler2D tDiffuse; uniform float sat; uniform float con; uniform vec3 tint; uniform float vig;
    varying vec2 vUv;
    void main() {
      vec4 c = texture2D(tDiffuse, vUv);
      vec3 col = c.rgb;
      float l = dot(col, vec3(0.299, 0.587, 0.114));
      col = mix(vec3(l), col, sat);
      col = (col - 0.5) * con + 0.5;
      col *= tint;
      col *= 1.0 - vig * smoothstep(0.35, 0.9, distance(vUv, vec2(0.5)));
      gl_FragColor = vec4(clamp(col, 0.0, 1.0), c.a);
    }`,
});
composer.addPass(grade);
const gradeTint = new THREE.Color();

// ---------- Game objects ----------
initProps();
const newSeed = () => Number(params.get('seed')) || Math.floor(Math.random() * 1e9);
let track = new Track(newSeed());
const world = new World(scene, track);
const env = new Environment(scene);
const traffic = new Traffic(scene);
const weather = new Weather(scene);
const audio = new AudioFX();
const input = new Input();
const hud = new HUD();
initSettings(audio);
audio.onSongChange = (title, artist) => hud.nowPlaying(title, artist);
const car = buildPlayerCar();
scene.add(car);

const player = { s: START_S, d: 0, v: 0, latV: 0, yawVis: 0, camD: 0, shake: 0, crashCool: 0, drift: 0, offroad: false, gear: 1, rpm: 0 };
const state = {
  mode: 'title',
  day: 1,
  dayT: 0.5,
  passed: 0,
  totalPassed: 0,
  target: 50,
  odo: 0,
  countdown: 0,
  goalShown: false,
  biomeIdx: -1,
  low: coarse,
  best: loadBest(),
};
const targetFor = (day) => Math.min(40 + (day - 1) * 10, 120);
const densityFor = (day) => Math.min(16 + day * 2, 32);

function loadBest() {
  try {
    return JSON.parse(localStorage.getItem('enduro-horizon-best')) || null;
  } catch {
    return null;
  }
}

function showBest() {
  const b = state.best;
  document.getElementById('best').textContent = b ? `BEST · DAY ${b.day} · ${b.km.toFixed(1)} KM · ${b.cars} CARS` : '';
}

function applyQuality() {
  renderer.setPixelRatio(state.low ? Math.min(devicePixelRatio, 1) : Math.min(devicePixelRatio, 2));
  composer.setPixelRatio(renderer.getPixelRatio());
  composer.setSize(innerWidth, innerHeight);
  bloom.enabled = !state.low;
  env.sun.castShadow = !state.low;
}

function resetRun(mode) {
  track = new Track(newSeed());
  world.setTrack(track);
  Object.assign(player, { s: START_S, d: mode === 'title' ? LANES[1] : 0, v: mode === 'title' ? 40 : 0, latV: 0, yawVis: 0, camD: 0, shake: 0, gear: 1, rpmReal: IDLE_RPM, bob: 0, bobV: 0, shiftT: 0 });
  Object.assign(state, { day: 1, passed: 0, totalPassed: 0, target: targetFor(1), odo: 0, goalShown: false, biomeIdx: -1 });
  state.dayT = params.has('t') ? Number(params.get('t')) : mode === 'title' ? 0.5 : 0.03;
  traffic.reset(track, player.s, mode === 'title' ? 18 : densityFor(1));
  world.update(player.s, 999);
}

function startRace() {
  audio.init();
  resetRun('race');
  state.mode = 'countdown';
  state.countdown = 3;
  state.lastCount = 4;
  for (const id of ['title', 'gameover', 'pause']) document.getElementById(id).classList.add('hidden');
  hud.show(true);
  document.getElementById('touch').classList.add('on');
}

function gameOver() {
  state.mode = 'gameover';
  audio.gameOver();
  const km = state.odo / 1000;
  const run = { day: state.day, km, cars: state.totalPassed };
  const b = state.best;
  const isBest = !b || run.day > b.day || (run.day === b.day && run.km > b.km);
  if (isBest) {
    state.best = run;
    try {
      localStorage.setItem('enduro-horizon-best', JSON.stringify(run));
    } catch {
      /* storage unavailable */
    }
  }
  document.getElementById('goStats').innerHTML =
    `You reached <b>Day ${run.day}</b><br>Distance <b>${km.toFixed(1)} km</b> · Cars passed <b>${run.cars}</b>` +
    `<br>Needed <b>${state.target - state.passed}</b> more cars before dawn` +
    (isBest ? '<br><b>★ NEW BEST ★</b>' : '');
  document.getElementById('gameover').classList.remove('hidden');
  document.getElementById('touch').classList.remove('on');
  showBest();
}

function togglePause() {
  if (state.mode === 'race') {
    state.mode = 'paused';
    document.getElementById('pause').classList.remove('hidden');
  } else if (state.mode === 'paused') {
    state.mode = 'race';
    document.getElementById('pause').classList.add('hidden');
  }
}

addEventListener('keydown', (e) => {
  audio.init();
  if (e.code === 'Enter' && (state.mode === 'title' || state.mode === 'gameover')) startRace();
  if (e.code === 'KeyP' || e.code === 'Escape') togglePause();
  if (e.code === 'KeyM') hud.center(audio.toggleMusic() ? '♪ ON' : '♪ OFF', 'small', 800);
  if (e.code === 'KeyQ') {
    state.low = !state.low;
    applyQuality();
    hud.center(state.low ? 'FAST' : 'FANCY', 'small', 800);
  }
});
addEventListener('pointerdown', () => audio.init());
input.onStart = () => (state.mode === 'title' || state.mode === 'gameover' ? startRace() : togglePause());
document.getElementById('startBtn').addEventListener('click', startRace);
document.getElementById('retryBtn').addEventListener('click', startRace);
document.getElementById('resumeBtn').addEventListener('click', togglePause);
addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
  composer.setSize(innerWidth, innerHeight);
});

// ---------- Simulation ----------
const fr = {};
const cf1 = {};
const cf2 = {};

function autopilot() {
  // Pick the lane with the most room ahead; used on the title screen.
  let best = player.lane ?? 1;
  let bestRoom = -1;
  for (let l = 0; l < 3; l++) {
    let room = 400;
    for (const c of traffic.active) {
      const ds = c.s - player.s;
      if (ds > -6 && Math.abs(c.d - LANES[l]) < 2.6) room = Math.min(room, ds);
    }
    if (l === best) room += 25;
    if (room > bestRoom) {
      bestRoom = room;
      best = l;
    }
  }
  player.lane = best;
  const want = (LANES[best] - player.d) * 1.6 + player.drift;
  return { steer: clamp(want / (5 + player.v * 0.17), -1, 1), throttle: player.v < 46 ? 1 : 0, brake: bestRoom < 20 ? 0.5 : 0 };
}

function updatePlayer(dt, ctl) {
  track.frame(player.s, fr);
  const bw = track.blend(player.s);
  const grip = lerp(bw.a.grip, bw.b.grip, bw.t);
  const offroad = Math.abs(player.d) > HALF_W + 0.9;
  const vmax = offroad ? 24 : MAX_V;
  let acc;
  player.shiftT = Math.max(0, (player.shiftT || 0) - dt);
  const power = player.shiftT > 0 ? 0.25 : 1; // brief torque cut while shifting
  if (ctl.brake > 0) acc = -34 * ctl.brake;
  else if (ctl.throttle > 0) acc = player.v < vmax ? (17 * ctl.throttle * (1 - Math.pow(player.v / vmax, 2)) + 1) * power : 0;
  else acc = -3 - player.v * 0.03;
  if (player.v > vmax) acc = Math.min(acc, -(player.v - vmax) * 1.6);
  acc -= 9.8 * fr.g * 0.35;
  player.v = clamp(player.v + acc * dt, 0, 80);

  const steerRate = (5 + Math.min(player.v, 60) * 0.17) * Math.min(1, player.v / 4);
  player.latV += (ctl.steer * steerRate - player.latV) * (1 - Math.exp(-dt * 7 * grip));
  player.drift = fr.k * player.v * player.v * 0.5 * (1.4 - 0.4 * grip);
  player.d += (player.latV - player.drift) * dt;
  const limit = HALF_W + 11;
  if (Math.abs(player.d) > limit) {
    player.d = Math.sign(player.d) * limit;
    player.v *= 1 - dt * 1.5;
  }
  player.s += player.v * dt;
  player.offroad = offroad;
  if (offroad && player.v > 5) player.shake = Math.max(player.shake, 0.12);

  // Automatic gearbox: upshift near the redline, downshift when lugging.
  let g = player.gear || 1;
  const rpmAt = (gear) => IDLE_RPM + (player.v / GEAR_TOP[gear]) * (REDLINE - IDLE_RPM);
  if (g < 6 && rpmAt(g) > 7250) {
    g++;
    player.shiftT = 0.16;
  } else if (g > 1 && rpmAt(g - 1) < 6000 && rpmAt(g) < 3700) {
    g--;
  }
  player.gear = g;
  let target = Math.min(REDLINE + 150, rpmAt(g));
  if (state.mode === 'countdown') target = IDLE_RPM + ctl.rev * 6200; // free revs on the grid
  if (player.shiftT > 0) target *= 0.92;
  player.rpmReal = lerp(player.rpmReal || IDLE_RPM, Math.max(IDLE_RPM, target), 1 - Math.exp(-dt * 12));
  player.rpm = player.rpmReal / REDLINE; // 0..1 for anything that wants a normalized value

  // Tire squeal: hard cornering relative to grip, or heavy braking at speed.
  const lateral = Math.abs(player.latV - player.drift) + Math.abs(player.drift) * 0.6;
  const corner = smoothstep(7, 16, lateral * (player.v / MAX_V) * 1.6);
  const brakeSlip = ctl.brake > 0 && player.v > 12 ? 0.55 : 0;
  player.slip = offroad ? 0 : clamp((corner + brakeSlip) * (0.4 + 0.6 * grip), 0, 1);

  // Suspension: the car floats over crests and squats into dips.
  const g0 = track.frame(player.s - 6, cf1).g;
  const g1 = track.frame(player.s + 6, cf2).g;
  const vAcc = player.v * player.v * ((g1 - g0) / 12);
  player.bobV = (player.bobV || 0) + ((clamp(-vAcc * 0.03, -0.12, 0.35) - (player.bob || 0)) * 90 - player.bobV * 11) * dt;
  player.bob = (player.bob || 0) + player.bobV * dt;
  player.air = vAcc < -8.5 ? 1 : 0;
  return ctl;
}

function collide(dt) {
  player.crashCool -= dt;
  for (const c of traffic.active) {
    const ds = c.s - player.s;
    const dd = c.d - player.d;
    const lenSum = c.halfLen + 2.25;
    const wSum = c.halfW + 0.95;
    if (Math.abs(ds) >= lenSum || Math.abs(dd) >= wSum) continue;
    const overlapS = lenSum - Math.abs(ds);
    const overlapD = wSum - Math.abs(dd);
    if (overlapS < overlapD * 1.4) {
      if (ds > 0) {
        // Rear-ended a rival: lose most of the speed, like the original.
        player.s = c.s - lenSum;
        player.v = Math.min(player.v, c.speed * 0.45);
      } else {
        c.s = player.s - lenSum;
        c.speed = Math.min(c.speed, player.v * 0.8);
      }
    } else {
      const sign = Math.sign(dd) || 1;
      player.d = c.d - sign * wSum;
      player.latV = -sign * 6;
      player.v *= 0.82;
    }
    const hit = clamp(Math.abs(player.v - c.speed) / 25 + 0.25, 0, 1);
    player.shake = 0.6;
    if (player.crashCool <= 0) {
      audio.crash(hit);
      player.crashCool = 0.5;
    }
  }
}

function countPasses() {
  for (const c of traffic.active) {
    const ahead = c.s > player.s;
    if (ahead !== c.wasAhead) {
      c.wasAhead = ahead;
      if (state.mode !== 'race') continue;
      const delta = ahead ? -1 : 1;
      const side = c.d - player.d;
      if (Math.abs(side) < 7) audio.whoosh(clamp(side / 5, -1, 1));
      state.passed = Math.max(0, state.passed + delta);
      state.totalPassed = Math.max(0, state.totalPassed + delta);
      audio.pass(delta > 0);
    }
  }
  if (state.mode === 'race' && !state.goalShown && state.passed >= state.target) {
    state.goalShown = true;
    hud.center('GOAL!', 'small', 1600);
    audio.fanfare();
  }
}

function advanceDay(dt) {
  if (state.mode === 'title') {
    state.dayT = (state.dayT + dt / 90) % 1;
    return;
  }
  if (state.mode !== 'race') return;
  state.dayT += dt / DAY_LEN;
  if (state.dayT < 1) return;
  if (state.passed >= state.target) {
    state.dayT -= 1;
    state.day++;
    state.passed = 0;
    state.target = targetFor(state.day);
    state.goalShown = false;
    traffic.density = densityFor(state.day);
    hud.center(`DAY ${state.day}`, '', 2000);
    audio.fanfare();
  } else {
    state.dayT = 0.999;
    gameOver();
  }
}

function updateCountdown(dt) {
  state.countdown -= dt;
  const n = Math.ceil(state.countdown);
  if (n !== state.lastCount) {
    state.lastCount = n;
    if (n > 0) {
      hud.center(String(n), '', 900);
      audio.countdown(false);
    } else {
      hud.center('GO!', '', 900);
      audio.countdown(true);
      state.mode = 'race';
    }
  }
}

// ---------- Presentation ----------
function placeCar(dt) {
  track.frame(player.s, fr);
  car.position.set(fr.x + fr.cos * player.d, fr.y + Math.max(-0.06, player.bob || 0), fr.z + fr.sin * player.d);
  const slip = Math.atan2(player.latV - player.drift, Math.max(player.v, 6));
  player.yawVis = lerp(player.yawVis, slip * 0.8, 1 - Math.exp(-dt * 10));
  car.rotation.set(Math.atan(fr.g), -fr.h - player.yawVis, player.yawVis * 0.3, 'YXZ');
  const spin = (player.v * dt) / 0.37;
  for (const w of car.userData.wheels) w.rotation.x -= spin;
  for (const p of car.userData.frontWheels || []) p.rotation.y = lerp(p.rotation.y, -ctl.steer * 0.35, 1 - Math.exp(-dt * 12));
}

function updateCamera(dt) {
  const back = track.frame(player.s - 8.2 - player.v * 0.025, cf1);
  const ahead = track.frame(player.s + 16, cf2);
  player.camD = lerp(player.camD, player.d * 0.85, 1 - Math.exp(-dt * 6));
  const d = player.camD;
  camera.position.set(back.x + back.cos * d, back.y + 3.1, back.z + back.sin * d);
  const sh = player.shake;
  if (sh > 0) {
    camera.position.x += (Math.random() - 0.5) * sh;
    camera.position.y += (Math.random() - 0.5) * sh;
    player.shake = Math.max(0, sh - dt * 1.8);
  }
  camera.lookAt(ahead.x + ahead.cos * d, ahead.y + 1.1, ahead.z + ahead.sin * d);
  const fov = 60 + (player.v / MAX_V) * 14;
  if (Math.abs(camera.fov - fov) > 0.05) {
    camera.fov = fov;
    camera.updateProjectionMatrix();
  }
}

function updateLights(night, braking) {
  updatePropLights(night, performance.now() / 1000);
  trafficLights.tail.emissiveIntensity = 0.8 + night * 3.2;
  trafficLights.head.emissiveIntensity = 0.3 + night * 3;
  const L = car.userData.lights;
  L.tail.emissiveIntensity = braking ? 5 : 0.8 + night * 2.2;
  L.head.emissiveIntensity = 1 + night * 3;
  car.userData.glow.opacity = 0.04 + night * 0.96;
  car.userData.spot.intensity = night * 160;
  beamMaterial.opacity = night * 0.6;
  bloom.strength = 0.35 + night * 0.6;
}

function weatherFor(bw) {
  const wa = bw.a.weather ? 1 - bw.t : 0;
  const wb = bw.b.weather ? bw.t : 0;
  if (!wa && !wb) return [null, 0];
  return wa >= wb ? [bw.a.weather, wa] : [bw.b.weather, wb];
}

let last = performance.now();
let ctl = { steer: 0, throttle: 0, brake: 0 };
function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  input.poll();

  if (state.mode !== 'paused') {
    if (state.mode === 'title') ctl = autopilot();
    else if (state.mode === 'race') ctl = { steer: input.steer, throttle: input.throttle, brake: input.brake };
    else ctl = { steer: 0, throttle: 0, brake: state.mode === 'gameover' ? 0.3 : 0, rev: input.throttle };
    if (state.mode === 'countdown') updateCountdown(dt);
    const prevS = player.s;
    updatePlayer(dt, ctl);
    traffic.update(dt, player.s, player.v);
    if (state.mode !== 'title') collide(dt);
    countPasses();
    state.odo += Math.max(0, player.s - prevS);
    advanceDay(dt);
  }

  world.update(player.s);
  world.animate(now / 1000);
  placeCar(dt);
  updateCamera(dt);

  const bw = track.blend(player.s);
  const coastSeg = track.coastSegmentNear(player.s, 1600);
  const tod = env.update(state.dayT, dt, car.position, camera, bw, coastSeg >= 0 ? track.waterLevel(coastSeg) : null);
  updateLights(tod.night, ctl.brake > 0 && player.v > 1);
  const [wType, wWeight] = weatherFor(bw);
  weather.update(dt, camera.position, wType, wWeight, tod.night);
  audio.setEngine({
    rpm: player.rpmReal || IDLE_RPM,
    throttle: state.mode === 'countdown' ? ctl.rev : ctl.throttle,
    speed: player.v,
    gear: player.gear,
    slip: player.slip || 0,
    offroad: player.offroad && player.v > 5,
    active: state.mode !== 'title',
    braking: ctl.brake > 0,
  });
  const envTex = env.updateEnvMap(renderer, dt);
  if (envTex) setCarEnvMap(envTex);
  renderer.toneMappingExposure = tod.exp;
  grade.uniforms.sat.value = tod.sat;
  grade.uniforms.con.value = tod.con;
  gradeTint.copy(tod.tint).convertLinearToSRGB();
  grade.uniforms.tint.value.setRGB(1, 1, 1).lerp(gradeTint, 0.6);

  const dom = bw.t > 0.5 ? bw.b : bw.a;
  const domIdx = bw.t > 0.5 ? bw.seg + 1 : bw.seg;
  if (domIdx !== state.biomeIdx) {
    state.biomeIdx = domIdx;
    if (state.mode === 'race' || state.mode === 'countdown') hud.toast('NOW ENTERING', dom.name, dom.accent);
  }
  if (state.mode !== 'title') {
    hud.update({
      day: state.day,
      todName: tod.name,
      todIcon: tod.icon,
      dayT: Math.min(1, state.dayT),
      target: state.target,
      passed: state.passed,
      odo: state.odo,
      speed: player.v * 3.6,
      gear: String(player.gear),
      biome: dom.name,
      night: tod.night,
    });
  }

  if (state.low) renderer.render(scene, camera);
  else composer.render();
}

applyQuality();
resetRun('title');
showBest();
if (params.has('autostart')) startRace();
window.__game = { state, player, track: () => track, traffic, camera };
requestAnimationFrame(frame);
