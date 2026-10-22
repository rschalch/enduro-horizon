import * as THREE from 'three';
import { celestial, sampleTimeOfDay } from './timeofday.js';
import { fbm, hash2, lerp, mulberry32, smoothstep } from './math.js';

// Sky dome, stars, clouds, distant mountain/skyline rings, ocean and the
// lights/fog that follow the time of day.

const skyVert = /* glsl */ `
  varying vec3 vDir;
  void main() {
    vDir = position;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;
const skyFrag = /* glsl */ `
  uniform vec3 top; uniform vec3 hor; uniform vec3 gnd;
  uniform vec3 sunDir; uniform vec3 sunCol; uniform float sunVis;
  uniform vec3 moonDir; uniform float moonVis;
  varying vec3 vDir;
  void main() {
    vec3 d = normalize(vDir);
    float h = d.y;
    vec3 col = mix(hor, top, pow(clamp(h, 0.0, 1.0), 0.55));
    col = mix(col, gnd, smoothstep(0.0, -0.25, h));
    float sd = max(dot(d, sunDir), 0.0);
    col += sunCol * (pow(sd, 1400.0) * 8.0 + pow(sd, 60.0) * 0.5 + pow(sd, 5.0) * 0.22 * (1.0 - clamp(h, 0.0, 1.0))) * sunVis;
    float md = max(dot(d, moonDir), 0.0);
    col += vec3(1.0, 1.0, 1.15) * smoothstep(0.99955, 0.9998, md) * 2.2 * moonVis;
    col += vec3(0.35, 0.45, 0.9) * pow(md, 30.0) * 0.18 * moonVis;
    gl_FragColor = vec4(col, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

const ringVert = /* glsl */ `
  attribute float shade;
  attribute vec2 wuv;
  varying float vShade;
  varying vec2 vUv;
  void main() {
    vShade = shade;
    vUv = wuv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;
const ringFrag = /* glsl */ `
  uniform vec3 colTop; uniform vec3 colBottom; uniform float windows;
  uniform vec3 snowCol; uniform float snow; uniform float snowLine;
  varying float vShade;
  varying vec2 vUv;
  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  void main() {
    vec3 col = mix(colBottom, colTop, vShade);
    float cap = smoothstep(snowLine, snowLine + 90.0, vUv.y + sin(vUv.x * 0.05) * 40.0);
    col = mix(col, snowCol, cap * snow);
    if (windows > 0.0) {
      vec2 cell = floor(vUv / vec2(5.0, 6.0));
      vec2 f = fract(vUv / vec2(5.0, 6.0));
      float lit = step(0.7, hash(cell)) * step(0.25, f.x) * step(f.x, 0.75) * step(0.3, f.y) * step(f.y, 0.75);
      col += vec3(1.0, 0.75, 0.4) * lit * windows * vShade;
    }
    gl_FragColor = vec4(col, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

// Tileable ripple normal map for the ocean (sum of integer-frequency waves).
function waveNormalMap() {
  const N = 128;
  const hgt = new Float32Array(N * N);
  const rng = mulberry32(77);
  const waves = [];
  for (let i = 0; i < 9; i++) waves.push([1 + Math.floor(rng() * 6), Math.floor(rng() * 7) - 3, rng() * 6.28, 0.5 + rng()]);
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      let v = 0;
      for (const [kx, ky, ph, a] of waves) v += Math.sin(((kx * x + ky * y) / N) * Math.PI * 2 + ph) * a / (kx + Math.abs(ky));
      hgt[y * N + x] = v;
    }
  }
  const data = new Uint8Array(N * N * 4);
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const dx = hgt[y * N + ((x + 1) % N)] - hgt[y * N + ((x + N - 1) % N)];
      const dy = hgt[((y + 1) % N) * N + x] - hgt[((y + N - 1) % N) * N + x];
      const n = new THREE.Vector3(-dx * 2, -dy * 2, 1).normalize();
      const i = (y * N + x) * 4;
      data[i] = (n.x * 0.5 + 0.5) * 255;
      data[i + 1] = (n.y * 0.5 + 0.5) * 255;
      data[i + 2] = (n.z * 0.5 + 0.5) * 255;
      data[i + 3] = 255;
    }
  }
  const t = new THREE.DataTexture(data, N, N);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.needsUpdate = true;
  return t;
}

function buildRing(radius, segs, heightFn, base = -260) {
  const pos = [];
  const shade = [];
  const wuv = [];
  const idx = [];
  const circ = 2 * Math.PI * radius;
  for (let i = 0; i < segs; i++) {
    const a0 = (i / segs) * Math.PI * 2;
    const a1 = ((i + 1) / segs) * Math.PI * 2;
    const [h0, h1] = heightFn(i, a0, a1);
    const v = pos.length / 3;
    const pts = [
      [a0, base, 0],
      [a1, base, 0],
      [a0, h0, 1],
      [a1, h1, 1],
    ];
    for (const [a, y, sh] of pts) {
      pos.push(Math.cos(a) * radius, y, Math.sin(a) * radius);
      shade.push(sh);
      wuv.push((a / (Math.PI * 2)) * circ, y - base);
    }
    idx.push(v, v + 2, v + 1, v + 1, v + 2, v + 3);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('shade', new THREE.Float32BufferAttribute(shade, 1));
  g.setAttribute('wuv', new THREE.Float32BufferAttribute(wuv, 2));
  g.setIndex(idx);
  return g;
}

function ringMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: {
      colTop: { value: new THREE.Color() },
      colBottom: { value: new THREE.Color() },
      windows: { value: 0 },
      snowCol: { value: new THREE.Color() },
      snow: { value: 0 },
      snowLine: { value: 800 },
    },
    vertexShader: ringVert,
    fragmentShader: ringFrag,
    side: THREE.DoubleSide,
    fog: false,
  });
}

function dotTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.4, 'rgba(255,255,255,0.8)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export class Environment {
  constructor(scene) {
    this.scene = scene;
    this.tod = {};
    this.sunDir = new THREE.Vector3();
    this.moonDir = new THREE.Vector3();
    this.lightDir = new THREE.Vector3();

    this.skyMat = new THREE.ShaderMaterial({
      uniforms: {
        top: { value: new THREE.Color() },
        hor: { value: new THREE.Color() },
        gnd: { value: new THREE.Color() },
        sunDir: { value: this.sunDir },
        sunCol: { value: new THREE.Color() },
        sunVis: { value: 1 },
        moonDir: { value: this.moonDir },
        moonVis: { value: 0 },
      },
      vertexShader: skyVert,
      fragmentShader: skyFrag,
      side: THREE.BackSide,
      depthWrite: false,
      depthTest: false,
      fog: false,
    });
    this.sky = new THREE.Mesh(new THREE.SphereGeometry(3500, 32, 16), this.skyMat);
    this.sky.renderOrder = -10;
    this.sky.frustumCulled = false;
    scene.add(this.sky);

    // Stars
    const rng = mulberry32(11);
    const sp = [];
    for (let i = 0; i < 1800; i++) {
      const u = rng() * Math.PI * 2;
      const v = Math.acos(rng() * 0.95);
      sp.push(Math.sin(v) * Math.cos(u) * 3000, Math.cos(v) * 3000, Math.sin(v) * Math.sin(u) * 3000);
    }
    const sg = new THREE.BufferGeometry();
    sg.setAttribute('position', new THREE.Float32BufferAttribute(sp, 3));
    this.starMat = new THREE.PointsMaterial({ size: 2.2, sizeAttenuation: false, map: dotTexture(), transparent: true, depthWrite: false, fog: false, opacity: 0 });
    this.stars = new THREE.Points(sg, this.starMat);
    this.stars.renderOrder = -9;
    this.stars.frustumCulled = false;
    scene.add(this.stars);

    // Distant rings: jagged mountains and a blocky city skyline.
    this.mountainMat = ringMaterial();
    this.mountains = new THREE.Mesh(
      buildRing(2600, 260, (i, a0, a1) => {
        const h = (a) => 60 + Math.pow(fbm(Math.cos(a) * 4 + 9, Math.sin(a) * 4 + 3, 5), 1.8) * 820;
        return [h(a0), h(a1)];
      }),
      this.mountainMat,
    );
    this.mountains.frustumCulled = false;
    scene.add(this.mountains);
    // A nearer, lower ridge line for depth.
    this.ridgeMat = ringMaterial();
    this.ridge = new THREE.Mesh(
      buildRing(1900, 300, (i, a0, a1) => {
        const h = (a) => 30 + Math.pow(fbm(Math.cos(a) * 7 + 31, Math.sin(a) * 7 - 5, 4), 1.4) * 360;
        return [h(a0), h(a1)];
      }),
      this.ridgeMat,
    );
    this.ridge.frustumCulled = false;
    scene.add(this.ridge);
    this.skylineMat = ringMaterial();
    this.skyline = new THREE.Mesh(
      buildRing(1700, 420, (i) => {
        const h = 40 + Math.pow(hash2(i >> 1, 77), 2.2) * 300;
        return [h, h];
      }),
      this.skylineMat,
    );
    this.skyline.frustumCulled = false;
    scene.add(this.skyline);

    // Clouds: one instanced merged-puff geometry.
    const puffs = [];
    for (let i = 0; i < 6; i++) {
      const g = new THREE.IcosahedronGeometry(18 + rng() * 14, 1);
      g.translate((i - 2.5) * 22 + rng() * 10, rng() * 10, rng() * 20 - 10);
      puffs.push(g);
    }
    const cloudGeo = new THREE.BufferGeometry();
    const merged = puffs.reduce((acc, g) => acc.concat(Array.from(g.attributes.position.array)), []);
    cloudGeo.setAttribute('position', new THREE.Float32BufferAttribute(merged, 3));
    cloudGeo.scale(1, 0.55, 1);
    cloudGeo.computeVertexNormals();
    const cc = [];
    const cp = cloudGeo.attributes.position;
    const cn = cloudGeo.attributes.normal;
    for (let i = 0; i < cp.count; i++) {
      const s = 0.72 + Math.max(0, cn.getY(i)) * 0.28;
      cc.push(s, s, s);
    }
    cloudGeo.setAttribute('color', new THREE.Float32BufferAttribute(cc, 3));
    this.cloudMat = new THREE.MeshBasicMaterial({ vertexColors: true, fog: false, transparent: true, opacity: 0.95, depthWrite: false });
    this.cloudCount = 34;
    this.clouds = new THREE.InstancedMesh(cloudGeo, this.cloudMat, this.cloudCount);
    this.clouds.frustumCulled = false;
    this.clouds.renderOrder = -8;
    this.cloudData = [];
    for (let i = 0; i < this.cloudCount; i++) {
      this.cloudData.push({ x: (rng() * 2 - 1) * 1800, y: 260 + rng() * 260, z: (rng() * 2 - 1) * 1800, s: 0.6 + rng() * 1.2, r: rng() * 6 });
    }
    scene.add(this.clouds);

    // Ocean
    this.waveMap = waveNormalMap();
    this.waveMap.repeat.set(500, 500);
    this.oceanMat = new THREE.MeshStandardMaterial({ color: 0x0fa3c4, roughness: 0.08, metalness: 0.15, normalMap: this.waveMap, normalScale: new THREE.Vector2(0.55, 0.55) });

    // Sky-only scene used to build a reflection environment map for cars and water.
    this.envScene = new THREE.Scene();
    this.envSky = new THREE.Mesh(new THREE.SphereGeometry(100, 32, 16), this.skyMat);
    this.envScene.add(this.envSky);
    this.envTimer = 0;
    this.envTarget = null;
    this.pmrem = null;
    this.ocean = new THREE.Mesh(new THREE.PlaneGeometry(9000, 9000).rotateX(-Math.PI / 2), this.oceanMat);
    this.ocean.receiveShadow = true;
    this.ocean.visible = false;
    scene.add(this.ocean);

    // Lights
    this.hemi = new THREE.HemisphereLight(0xffffff, 0x444444, 1);
    scene.add(this.hemi);
    this.sun = new THREE.DirectionalLight(0xffffff, 3);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    const sc = this.sun.shadow.camera;
    sc.left = -70;
    sc.right = 70;
    sc.top = 70;
    sc.bottom = -70;
    sc.near = 1;
    sc.far = 500;
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.04;
    scene.add(this.sun, this.sun.target);

    scene.fog = new THREE.Fog(0xffffff, 100, 1000);
  }

  // Rebuild the reflection map from the current sky every couple of seconds.
  updateEnvMap(renderer, dt, force = false) {
    this.envTimer -= dt;
    if (!force && this.envTimer > 0) return null;
    this.envTimer = 2;
    this.pmrem ||= new THREE.PMREMGenerator(renderer);
    const old = this.envTarget;
    this.envTarget = this.pmrem.fromScene(this.envScene, 0.02);
    old?.dispose();
    this.oceanMat.envMap = this.envTarget.texture;
    return this.envTarget.texture;
  }

  // t: time of day [0,1); focus: world position of the player; blend: biome blend.
  update(t, dt, focus, camera, blend, waterLevel) {
    const k = sampleTimeOfDay(t, this.tod);
    const { sunVis, moonVis } = celestial(t, this.sunDir, this.moonDir);
    const u = this.skyMat.uniforms;
    u.top.value.copy(k.top);
    u.hor.value.copy(k.hor);
    u.gnd.value.copy(k.gnd);
    u.sunCol.value.copy(k.sun);
    u.sunVis.value = sunVis;
    u.moonVis.value = moonVis;

    const fogMul = lerp(blend.a.fog, blend.b.fog, blend.t);
    this.scene.fog.color.copy(k.hor);
    this.scene.fog.near = k.fogN * fogMul;
    this.scene.fog.far = k.fogF * fogMul;

    const useMoon = sunVis < 0.5;
    this.lightDir.copy(useMoon ? this.moonDir : this.sunDir);
    if (this.lightDir.y < 0.12) this.lightDir.y = 0.12;
    this.lightDir.normalize();
    this.sun.color.copy(k.sun);
    this.sun.intensity = k.sunI;
    this.sun.position.copy(focus).addScaledVector(this.lightDir, 200);
    this.sun.target.position.copy(focus);
    this.hemi.color.copy(k.hs);
    this.hemi.groundColor.copy(k.hg);
    this.hemi.intensity = k.hI;

    this.starMat.opacity = Math.max(0, k.night - 0.2) * 1.2 * smoothstep(200, 600, k.fogF);
    const cp = camera.position;
    this.sky.position.copy(cp);
    this.stars.position.copy(cp);

    // Rings: blend toward the horizon color so they read as hazy silhouettes.
    const cityW = (blend.a.skyline ? 1 - blend.t : 0) + (blend.b.skyline ? blend.t : 0);
    const light = 0.25 + (1 - k.night) * 0.75;
    const haze = smoothstep(150, 700, k.fogF * fogMul);
    const mcol = new THREE.Color(blend.a.mountain).lerp(new THREE.Color(blend.b.mountain), blend.t).multiplyScalar(light);
    this.mountainMat.uniforms.colTop.value.copy(k.hor).lerp(mcol, 0.55 * (1 - cityW) * haze);
    this.mountainMat.uniforms.colBottom.value.copy(k.hor);
    this.mountains.visible = cityW < 0.98;
    this.mountains.position.set(cp.x, cp.y - 80, cp.z);
    const snowW = (blend.a.snowcaps ? 1 - blend.t : 0) + (blend.b.snowcaps ? blend.t : 0);
    const desertW = (blend.a.key === 'desert' ? 1 - blend.t : 0) + (blend.b.key === 'desert' ? blend.t : 0);
    const snowCol = new THREE.Color(0.95, 0.97, 1).multiplyScalar(light).lerp(k.hor, 1 - 0.75 * haze);
    const mu = this.mountainMat.uniforms;
    mu.snowCol.value.copy(snowCol);
    mu.snow.value = (0.35 + 0.65 * snowW) * (1 - desertW) * (1 - cityW);
    mu.snowLine.value = lerp(980, 640, snowW);
    const ru = this.ridgeMat.uniforms;
    const rcol = mcol.clone().multiplyScalar(0.72).lerp(new THREE.Color(blend.a.rock).lerp(new THREE.Color(blend.b.rock), blend.t).multiplyScalar(light), 0.35);
    ru.colTop.value.copy(k.hor).lerp(rcol, 0.7 * (1 - cityW) * haze);
    ru.colBottom.value.copy(k.hor).lerp(rcol, 0.25 * (1 - cityW) * haze);
    ru.snowCol.value.copy(snowCol);
    ru.snow.value = snowW;
    ru.snowLine.value = 420;
    this.ridge.visible = cityW < 0.98;
    this.ridge.position.set(cp.x, cp.y - 60, cp.z);
    const scol = new THREE.Color(0x30355a).multiplyScalar(light);
    this.skylineMat.uniforms.colTop.value.copy(k.hor).lerp(scol, 0.7 * cityW * haze);
    this.skylineMat.uniforms.colBottom.value.copy(k.hor);
    this.skylineMat.uniforms.windows.value = k.night * cityW * 1.4 * haze;
    this.skyline.visible = cityW > 0.02;
    this.skyline.position.set(cp.x, cp.y - 60, cp.z);

    // Clouds drift and wrap around the camera.
    // Clouds pick up the sun's color, so they glow orange and pink at the ends of the day.
    const cloudCol = new THREE.Color(1, 1, 1).lerp(k.sun, 0.45).lerp(k.hor, 0.2).multiplyScalar(0.12 + (1 - k.night) * 0.98);
    this.cloudMat.color.copy(cloudCol);
    this.cloudMat.opacity = (0.92 - k.night * 0.6) * haze;
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const e = new THREE.Euler();
    const p = new THREE.Vector3();
    const s = new THREE.Vector3();
    const R = 1800;
    this.cloudData.forEach((c, i) => {
      c.x += dt * 4;
      if (c.x - cp.x > R) c.x -= 2 * R;
      if (c.x - cp.x < -R) c.x += 2 * R;
      if (c.z - cp.z > R) c.z -= 2 * R;
      if (c.z - cp.z < -R) c.z += 2 * R;
      p.set(c.x, cp.y + c.y, c.z);
      q.setFromEuler(e.set(0, c.r, 0));
      s.setScalar(c.s);
      this.clouds.setMatrixAt(i, m.compose(p, q, s));
    });
    this.clouds.instanceMatrix.needsUpdate = true;

    // Ocean
    if (waterLevel !== null) {
      this.ocean.visible = true;
      this.ocean.position.set(cp.x, waterLevel, cp.z);
      this.oceanMat.color.setHex(0x0b8fb0).lerp(k.hor, 0.2).multiplyScalar(0.35 + (1 - k.night) * 0.65);
      this.waveMap.offset.x += dt * 0.004;
      this.waveMap.offset.y += dt * 0.0025;
    } else {
      this.ocean.visible = false;
    }
    return k;
  }
}
