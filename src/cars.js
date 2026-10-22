import * as THREE from 'three';

// Low-poly cars built from extruded side profiles. Models face -Z.

const PROFILES = {
  sport: {
    body: [[-2.2, 0.32], [-2.28, 0.78], [-1.95, 0.98], [1.05, 0.98], [2.1, 0.76], [2.28, 0.48], [2.2, 0.32]],
    cabin: [[-1.55, 0.92], [-0.7, 1.38], [0.35, 1.38], [1.15, 0.92]],
    width: 1.78,
    cabinW: 1.44,
  },
  sedan: {
    body: [[-2.15, 0.34], [-2.2, 0.9], [-1.9, 1.0], [1.2, 1.0], [2.1, 0.86], [2.2, 0.5], [2.12, 0.34]],
    cabin: [[-1.6, 0.95], [-1.2, 1.62], [0.55, 1.62], [1.15, 0.95]],
    width: 1.74,
    cabinW: 1.5,
  },
};

function extrude(points, depth) {
  const shape = new THREE.Shape(points.map(([x, y]) => new THREE.Vector2(x, y)));
  const g = new THREE.ExtrudeGeometry(shape, {
    depth,
    bevelEnabled: true,
    bevelThickness: 0.06,
    bevelSize: 0.06,
    bevelSegments: 2,
    curveSegments: 1,
  });
  g.translate(0, 0, -depth / 2);
  g.rotateY(Math.PI / 2);
  return g;
}

const geoCache = {};
function profileGeos(type) {
  if (!geoCache[type]) {
    const p = PROFILES[type];
    geoCache[type] = { body: extrude(p.body, p.width), cabin: extrude(p.cabin, p.cabinW) };
  }
  return geoCache[type];
}

const wheelGeo = new THREE.CylinderGeometry(0.37, 0.37, 0.3, 16).rotateZ(Math.PI / 2);
const rimGeo = new THREE.CylinderGeometry(0.22, 0.22, 0.32, 8).rotateZ(Math.PI / 2);
const lightGeo = new THREE.BoxGeometry(0.42, 0.14, 0.06);
const tireMat = new THREE.MeshStandardMaterial({ color: 0x15151a, roughness: 0.9 });
const rimMat = new THREE.MeshStandardMaterial({ color: 0xd0d4dc, metalness: 0.9, roughness: 0.3 });
const glassMat = new THREE.MeshStandardMaterial({ color: 0x0c1220, metalness: 0.9, roughness: 0.12 });
const trimMat = new THREE.MeshStandardMaterial({ color: 0x1b1d24, metalness: 0.4, roughness: 0.5 });

export const trafficLights = {
  tail: new THREE.MeshStandardMaterial({ color: 0x220000, emissive: 0xff1020, emissiveIntensity: 1 }),
  head: new THREE.MeshStandardMaterial({ color: 0x222222, emissive: 0xfff2c0, emissiveIntensity: 0.5 }),
};

const bodyMats = new Map();
function bodyMat(color) {
  if (!bodyMats.has(color)) bodyMats.set(color, new THREE.MeshStandardMaterial({ color, metalness: 0.5, roughness: 0.3 }));
  return bodyMats.get(color);
}

function addWheels(root, spots) {
  const wheels = [];
  for (const [x, z] of spots) {
    const w = new THREE.Mesh(wheelGeo, tireMat);
    w.add(new THREE.Mesh(rimGeo, rimMat));
    w.position.set(x, 0.37, z);
    w.castShadow = true;
    root.add(w);
    wheels.push(w);
  }
  return wheels;
}

function addLights(root, lights, rearZ, frontZ, rearY, frontY, spread) {
  for (const sx of [-1, 1]) {
    const t = new THREE.Mesh(lightGeo, lights.tail);
    t.position.set(sx * spread, rearY, rearZ);
    const h = new THREE.Mesh(lightGeo, lights.head);
    h.position.set(sx * spread, frontY, frontZ);
    root.add(t, h);
  }
}

export function buildCar(type, color, lights = trafficLights) {
  if (type === 'truck') return buildTruck(color, lights);
  const root = new THREE.Group();
  const g = profileGeos(type);
  const body = new THREE.Mesh(g.body, bodyMat(color));
  body.castShadow = true;
  const cabin = new THREE.Mesh(g.cabin, glassMat);
  cabin.castShadow = true;
  root.add(body, cabin);
  const wheels = addWheels(root, [[-0.84, -1.38], [0.84, -1.38], [-0.84, 1.32], [0.84, 1.32]]);
  addLights(root, lights, 2.37, -2.3, type === 'sedan' ? 0.82 : 0.74, 0.6, 0.58);
  root.userData = { wheels, halfLen: 2.3, halfW: 0.95 };
  return root;
}

function buildTruck(color, lights) {
  const root = new THREE.Group();
  const cab = new THREE.Mesh(new THREE.BoxGeometry(2.3, 2.1, 2.2).translate(0, 1.55, -3.6), bodyMat(color));
  const hood = new THREE.Mesh(new THREE.BoxGeometry(2.3, 1.0, 1.0).translate(0, 1.0, -5.0), bodyMat(color));
  const glass = new THREE.Mesh(new THREE.BoxGeometry(2.12, 0.8, 0.06).translate(0, 2.05, -4.72), glassMat);
  const trailer = new THREE.Mesh(new THREE.BoxGeometry(2.5, 3.0, 7.6).translate(0, 2.15, 1.3), bodyMat(0xeef0f5));
  const stripe = new THREE.Mesh(new THREE.BoxGeometry(2.54, 0.4, 7.62).translate(0, 1.4, 1.3), bodyMat(color));
  const chassis = new THREE.Mesh(new THREE.BoxGeometry(2.0, 0.35, 10).translate(0, 0.55, -0.3), trimMat);
  for (const m of [cab, hood, trailer, chassis]) m.castShadow = true;
  root.add(cab, hood, glass, trailer, stripe, chassis);
  const wheels = addWheels(root, [[-0.95, -4.6], [0.95, -4.6], [-1.05, 2.6], [1.05, 2.6], [-1.05, 3.8], [1.05, 3.8]]);
  addLights(root, lights, 5.12, -5.52, 0.9, 0.85, 0.85);
  root.userData = { wheels, halfLen: 5.4, halfW: 1.25 };
  return root;
}

export function buildPlayerCar() {
  const lights = {
    tail: new THREE.MeshStandardMaterial({ color: 0x220000, emissive: 0xff1030, emissiveIntensity: 1 }),
    head: new THREE.MeshStandardMaterial({ color: 0x333333, emissive: 0xf4fbff, emissiveIntensity: 2 }),
  };
  const car = buildCar('sport', 0xff2a6d, lights);
  // Rear wing.
  const wing = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.06, 0.42), trimMat);
  wing.position.set(0, 1.22, 1.95);
  wing.castShadow = true;
  for (const sx of [-0.6, 0.6]) {
    const strut = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.26, 0.2), trimMat);
    strut.position.set(sx, 1.08, 1.95);
    car.add(strut);
  }
  // Racing stripes over the hood and roof.
  const stripeMat = new THREE.MeshStandardMaterial({ color: 0xffffff, metalness: 0.4, roughness: 0.35 });
  for (const sx of [-0.18, 0.18]) {
    const s = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.02, 1.15), stripeMat);
    s.position.set(sx, 0.995, -1.0);
    s.rotation.x = -0.21;
    car.add(s);
  }
  car.add(wing);

  // Neon underglow, brighter at night.
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(64, 64, 4, 64, 64, 64);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  const glowMat = new THREE.MeshBasicMaterial({
    map: new THREE.CanvasTexture(c),
    color: new THREE.Color(0.1, 0.9, 1.6),
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  const glow = new THREE.Mesh(new THREE.PlaneGeometry(3.4, 6.2).rotateX(-Math.PI / 2), glowMat);
  glow.position.y = 0.06;
  car.add(glow);

  // Headlight beam.
  const spot = new THREE.SpotLight(0xfff4e0, 0, 150, 0.42, 0.6, 1.2);
  spot.position.set(0, 0.9, -1.8);
  spot.target.position.set(0, 0, -30);
  car.add(spot, spot.target);

  car.userData.lights = lights;
  car.userData.glow = glowMat;
  car.userData.spot = spot;
  return car;
}
