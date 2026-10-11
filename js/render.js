/* Barnocraft WEB — Three.js rendering: voxel material (port of Voxel.frag), procedural sky
 * (port of Atmosphere.frag), chunk streaming through a worker, creatures, players and drops. */
(function () {
'use strict';
const BC = globalThis.BC;
const THREE = globalThis.THREE;
const B = BC.B;
const LAYER_SIZE = 128;

// ---------------------------------------------------------------- shared uniforms and texture array
const shared = {
  daylight: { value: 1 }, sunDirection: { value: new THREE.Vector3(.4, .8, .3) }, sunTint: { value: new THREE.Color(1, 1, 1) },
  fogColor: { value: new THREE.Color(135 / 255, 206 / 255, 235 / 255) }, fogRange: { value: new THREE.Vector2(40, 64) },
  ambientFloor: { value: .012 }, heldTorch: { value: 0 }, torchPos: { value: new THREE.Vector3() }, underwater: { value: 0 },
  atlas: { value: null },
  layerAlpha: { value: BC.TEXTURES.map((t, i) => i === 34 ? .74 : i === 16 ? .38 : i === 5 ? .7 : 1) },
  layerEmission: { value: BC.TEXTURES.map((t, i) => i === 31 || i === 32 || i === 34 ? 1 : 0) }
};
let atlasPack = -1;
function buildAtlas() {
  if (atlasPack === BC.Textures.pack && shared.atlas.value) return;
  atlasPack = BC.Textures.pack;
  const n = BC.TEXTURES.length, data = new Uint8Array(LAYER_SIZE * LAYER_SIZE * 4 * n);
  BC.TEXTURES.forEach((name, i) => data.set(BC.Textures.layerPixels(name, LAYER_SIZE), i * LAYER_SIZE * LAYER_SIZE * 4));
  const texture = new THREE.DataArrayTexture(data, LAYER_SIZE, LAYER_SIZE, n);
  texture.format = THREE.RGBAFormat; texture.type = THREE.UnsignedByteType;
  texture.magFilter = THREE.NearestFilter; texture.minFilter = THREE.NearestMipmapNearestFilter;
  texture.generateMipmaps = true; texture.needsUpdate = true;
  if (shared.atlas.value) shared.atlas.value.dispose();
  shared.atlas.value = texture;
}

const VOXEL_VERTEX = `
in vec2 lit; in float lay;
uniform vec3 sunDirection;
out vec2 vUv; out vec2 vLight; out float vShade; out float vDist; out vec3 vWorld; flat out int vLayer;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  vWorld = position; vDist = length(mv.xyz); vUv = uv; vLight = lit; vLayer = int(lay + 0.5);
  vShade = 0.68 + 0.32 * max(0.0, dot(normal, normalize(sunDirection)));
}`;
const VOXEL_FRAGMENT = `
precision highp float; precision highp sampler2DArray;
uniform sampler2DArray atlas;
uniform float layerAlpha[${BC.TEXTURES.length}]; uniform float layerEmission[${BC.TEXTURES.length}];
uniform float threshold, daylight, ambientFloor, underwater, heldTorch;
uniform vec3 sunTint, fogColor, torchPos; uniform vec2 fogRange;
in vec2 vUv; in vec2 vLight; in float vShade; in float vDist; in vec3 vWorld; flat in int vLayer;
out vec4 outColor;
void main() {
  vec4 tex = texture(atlas, vec3(vUv, float(vLayer)));
  tex.a *= layerAlpha[vLayer];
  if (tex.a < threshold) discard;
  float sky = pow(vLight.x, 1.5) * (0.045 + 0.955 * daylight);
  float torch = pow(vLight.y, 1.5);
  if (heldTorch > 0.5) { float c = max(0.0, 1.0 - distance(vWorld, torchPos) / 8.0); torch = max(torch, c * c); }
  vec3 illumination = max(sunTint * sky, vec3(1.0, 0.72, 0.42) * torch) + vec3(ambientFloor);
  illumination = max(illumination, vec3(layerEmission[vLayer]));
  vec3 color = tex.rgb * illumination * vShade;
  float fog = clamp((vDist - fogRange.x) / (fogRange.y - fogRange.x), 0.0, 1.0);
  fog = fog * fog * (3.0 - 2.0 * fog);
  vec3 fogC = fogColor * max(ambientFloor, max(vLight.x, vLight.y));
  if (underwater > 0.5) {
    fog = clamp(vDist / 12.0, 0.0, 0.94);
    fogC = vec3(0.025, 0.12, 0.23) * max(0.08, max(sky, torch));
    color *= vec3(0.6, 0.85, 1.0);
  }
  outColor = vec4(mix(color, fogC, fog), tex.a);
}`;
function voxelMaterial(kind) {
  const uniforms = Object.assign({}, shared, { threshold: { value: kind === 'cutout' ? .5 : .01 } });
  return new THREE.ShaderMaterial({
    glslVersion: THREE.GLSL3, uniforms, vertexShader: VOXEL_VERTEX, fragmentShader: VOXEL_FRAGMENT,
    transparent: kind === 'transparent', depthWrite: kind !== 'transparent',
    side: kind === 'opaque' ? THREE.FrontSide : THREE.DoubleSide
  });
}
let materials = null;
function voxelMaterials() {
  if (!materials) materials = { opaque: voxelMaterial('opaque'), cutout: voxelMaterial('cutout'), transparent: voxelMaterial('transparent') };
  return materials;
}

// ---------------------------------------------------------------- sky
const SKY_VERTEX = `
out vec3 direction;
void main() { direction = position; vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0); gl_Position = p.xyww; }`;
const SKY_FRAGMENT = `
precision highp float;
uniform vec3 sunDir; uniform float daylight; uniform float time; uniform vec3 horizon;
in vec3 direction; out vec4 outColor;
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y); }
void main() {
  vec3 d = normalize(direction);
  float elevation = max(d.y, 0.0);
  vec3 zenith = mix(vec3(.008, .015, .045), vec3(.14, .40, .77), daylight);
  vec3 color = mix(horizon, zenith, pow(elevation, .45));
  float alignment = max(dot(d, sunDir), 0.0);
  float twilight = 1.0 - smoothstep(.0, .4, abs(sunDir.y));
  color += vec3(.65, .18, .035) * pow(alignment, 8.0) * twilight * exp(-elevation * 5.0);
  color += vec3(1.0, .65, .28) * pow(alignment, 180.0) * .35;
  color = mix(color, vec3(1.0, .91, .66), smoothstep(.99935, .99965, alignment));
  float moon = smoothstep(.99955, .99975, dot(d, -sunDir));
  color = mix(color, vec3(.72, .80, .94), moon * (1.0 - daylight));
  vec2 stars = floor(d.xz / max(.15, elevation) * 220.0);
  color += vec3(pow(hash(stars), 180.0)) * smoothstep(.05, .3, elevation) * (1.0 - smoothstep(0.0, .25, daylight)) * .55;
  if (d.y > .015) {
    vec2 p = d.xz / (d.y + .12) * 3.5 + vec2(time * .009, time * .003);
    float n = noise(p) * .58 + noise(p * 2.1) * .28 + noise(p * 4.3) * .14;
    float cloud = smoothstep(.49, .69, n) * smoothstep(.015, .16, d.y);
    vec3 cloudColor = mix(vec3(.08, .10, .17), vec3(.94, .96, 1.0), daylight);
    cloudColor = mix(cloudColor, vec3(.94, .49, .27), twilight * .55);
    cloudColor *= .78 + .22 * smoothstep(.5, .8, n);
    color = mix(color, cloudColor, cloud * .92);
  }
  outColor = vec4(color, 1.0);
}`;
class Atmosphere {
  constructor() {
    this.uniforms = { sunDir: { value: new THREE.Vector3(0, 1, 0) }, daylight: { value: 1 }, time: { value: 0 }, horizon: { value: new THREE.Color() } };
    this.mesh = new THREE.Mesh(new THREE.SphereGeometry(200, 48, 24), new THREE.ShaderMaterial({
      glslVersion: THREE.GLSL3, uniforms: this.uniforms, vertexShader: SKY_VERTEX, fragmentShader: SKY_FRAGMENT,
      side: THREE.BackSide, depthWrite: false, depthTest: false
    }));
    this.mesh.renderOrder = -10; this.mesh.frustumCulled = false;
    this.sun = new THREE.Vector3(); this.tint = new THREE.Color(); this.horizon = new THREE.Color(); this.elapsed = 0;
  }
  update(camera, time, dt) {
    this.elapsed += dt;
    const angle = (time - .25) * Math.PI * 2;
    this.sun.set(Math.cos(angle), Math.sin(angle), .22).normalize();
    const day = BC.clamp((this.sun.y + .08) / .78, 0, 1), dusk = 1 - BC.clamp(Math.abs(this.sun.y) / .38, 0, 1);
    this.tint.setRGB(1, .80 + .20 * day, .64 + .36 * day);
    this.horizon.setRGB(.035 + .55 * day + .38 * dusk, .055 + .67 * day + .15 * dusk, .12 + .70 * day);
    this.uniforms.sunDir.value.copy(this.sun); this.uniforms.daylight.value = day;
    this.uniforms.time.value = this.elapsed; this.uniforms.horizon.value.copy(this.horizon);
    this.mesh.position.copy(camera.position);
    return day;
  }
}
BC.Atmosphere = Atmosphere;

// ---------------------------------------------------------------- helpers for creature models
const texCache = new Map();
function canvasTexture(source, key) {
  let t = texCache.get(key); if (t) return t;
  t = new THREE.CanvasTexture(source); t.magFilter = THREE.NearestFilter; t.minFilter = THREE.NearestFilter; t.generateMipmaps = false;
  texCache.set(key, t); return t;
}
function mobTexture(base, shade, wool) {
  const key = 'mob' + base + ':' + shade + wool;
  if (texCache.has(key)) return texCache.get(key);
  const c = BC.canvas(16, 16), g = c.getContext('2d');
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
    const dark = wool ? (x % 4 === 0 && y % 4 < 3 || y % 4 === 0 && x % 4 < 3) : (x * 17 + y * 31) % 11 < 3;
    g.fillStyle = '#' + (dark ? shade : base).toString(16).padStart(6, '0'); g.fillRect(x, y, 1, 1);
  }
  return canvasTexture(c, key);
}
const boxGeometry = new Map();
function box(w, h, d) {
  const key = w + ',' + h + ',' + d; let g = boxGeometry.get(key);
  if (!g) { g = new THREE.BoxGeometry(w, h, d); boxGeometry.set(key, g); }
  return g;
}
/** Parts carry their base colour so lighting and the hurt flash can tint them. */
function part(parent, name, w, h, d, x, y, z, material) {
  const m = new THREE.Mesh(box(w, h, d), material.clone());
  m.name = name; m.userData.base = m.material.color.clone(); m.position.set(x, y, z); parent.add(m); return m;
}
function tint(model, brightness, hurt) {
  model.traverse(o => {
    if (!o.isMesh || !o.userData.base) return;
    o.material.color.copy(o.userData.base).multiplyScalar(brightness);
    if (hurt) o.material.color.multiply(new THREE.Color(1, .48, .48));
  });
}
const flat = color => new THREE.MeshBasicMaterial({ color });
const textured = (map, color = 0xffffff) => new THREE.MeshBasicMaterial({ map, color });

function sheepModel() {
  const n = new THREE.Group(), wool = textured(mobTexture(0xe5e1d1, 0xbdb9ad, true)), face = textured(mobTexture(0x9b8069, 0x6e5447, false)),
    legs = textured(mobTexture(0x715b48, 0x453b34, false));
  part(n, 'Wool', 1.1, .62, .72, 0, .66, 0, wool); part(n, 'Head', .44, .48, .48, .59, .76, 0, face);
  part(n, 'Front wool', .5, .4, .44, .40, .85, 0, wool);
  for (const dx of [-.36, .36]) for (const dz of [-.24, .24]) part(n, 'Leg', .18, .48, .18, dx, .25, dz, legs);
  for (const s of [-1, 1]) { part(n, 'Eye', .09, .09, .024, .66, .83, s * .245, flat(0x000000)); part(n, 'Ear', .2, .11, .14, .48, .91, s * .29, face); }
  part(n, 'Muzzle', .12, .2, .3, .82, .68, 0, legs); part(n, 'Tail', .26, .2, .2, -.61, .70, 0, wool);
  return n;
}
function zombieModel() {
  const n = new THREE.Group(), shirt = textured(mobTexture(0x387c83, 0x245057, false)), skin = textured(mobTexture(0x709153, 0x486639, false)),
    pants = textured(mobTexture(0x494568, 0x302e4c, false));
  part(n, 'Body', .6, .84, .36, 0, .88, 0, shirt); part(n, 'Head', .44, .44, .44, 0, 1.52, 0, skin);
  for (const [name, x] of [['Left leg', -.16], ['Right leg', .16]]) {
    const pivot = new THREE.Group(); pivot.name = name; pivot.position.set(x, .6, 0); n.add(pivot);
    part(pivot, 'Leg', .24, .6, .34, 0, -.3, 0, pants);
  }
  for (const s of [-1, 1]) part(n, 'Eye', .11, .07, .024, s * .10, 1.56, .225, flat(0x000000));
  part(n, 'Mouth', .2, .05, .024, 0, 1.40, .225, flat(0x2e381f));
  part(n, 'Left arm', .18, .72, .2, -.38, .88, 0, skin); part(n, 'Right arm', .18, .72, .2, .38, .88, 0, skin);
  return n;
}
function fishModel() {
  const n = new THREE.Group(), body = textured(mobTexture(0x79a8b0, 0x3c737e, false)), fin = textured(mobTexture(0x637d85, 0x344e58, false));
  fin.side = THREE.DoubleSide;
  const torso = new THREE.Mesh(new THREE.SphereGeometry(1, 12, 8), body.clone()); torso.userData.base = torso.material.color.clone();
  torso.scale.set(.14, .20, .43); n.add(torso);
  const finGeometry = (w, l) => { const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 0, w, -l, 0, -w, -l], 3)); return g; };
  const addFin = (x, y, z, w, l, rz) => { const m = new THREE.Mesh(finGeometry(w, l), fin.clone()); m.userData.base = m.material.color.clone(); m.position.set(x, y, z); m.rotation.z = rz; n.add(m); };
  addFin(0, 0, -.39, .23, .25, 0); addFin(0, .15, .03, .18, .24, Math.PI / 2);
  for (const s of [-1, 1]) {
    part(n, 'Eye white', .024, .09, .09, s * .11, .065, .27, flat(0xffffff)); part(n, 'Pupil', .028, .05, .05, s * .12, .065, .285, flat(0x000000));
    addFin(s * .12, -.05, .08, .12, .17, s * 1.1);
  }
  return n;
}
function hellMobModel(kind) {
  const n = new THREE.Group();
  const tex = name => canvasTexture(BC.Textures.source(name), 'hell:' + name);
  const skin = textured(tex(kind === 'IMP' ? 'hell_stone.png' : 'hell_basalt.png'));
  const eyes = textured(tex('ember_crystal.png'), new THREE.Color(1, 1, .6)), horn = textured(tex('hell_soil.png'), new THREE.Color(.85, .7, .65));
  const legPart = (name, x, y, z, w, h, d) => { const p = new THREE.Group(); p.name = name; p.position.set(x, y + h / 2, z); n.add(p); part(p, name, w, h, d, 0, -h / 2, 0, skin); };
  if (kind === 'IMP') {
    part(n, 'Body', .34, .54, .28, 0, .48, 0, skin); part(n, 'Head', .48, .42, .40, 0, .94, .02, skin);
    for (const s of [-1, 1]) { part(n, 'Horn', .10, .30, .12, s * .20, 1.23, 0, horn); part(n, 'Eye', .10, .085, .025, s * .13, .99, .23, eyes); }
    legPart('Left leg', -.13, 0, 0, .12, .32, .14); legPart('Right leg', .13, 0, 0, .12, .32, .14);
    part(n, 'Left wing', .6, .30, .05, -.45, .64, -.04, skin); part(n, 'Right wing', .6, .30, .05, .45, .64, -.04, skin);
  } else {
    part(n, 'Body', .90, .64, 1.12, 0, .61, 0, skin); part(n, 'Head', .72, .54, .50, 0, .67, .63, skin);
    part(n, 'Snout', .40, .22, .20, 0, .57, .92, horn);
    for (const s of [-1, 1]) {
      part(n, 'Tusk', .10, .34, .13, s * .31, .54, .86, horn); part(n, 'Eye', .10, .075, .025, s * .26, .81, .89, eyes);
      legPart(s < 0 ? 'Left leg' : 'Right leg', s * .32, 0, .36, .19, .40, .22);
      legPart(s < 0 ? 'Rear left' : 'Rear right', s * .32, 0, -.36, .19, .40, .22);
    }
    part(n, 'Bristles', .14, .15, .82, 0, .98, -.12, horn);
  }
  return n;
}

/** Two original block characters with shoulder/hip pivots and procedural animation. */
class PlayerModel {
  constructor(skin, nameTag) {
    this.skin = skin; this.group = new THREE.Group(); this.clock = 0; this.stride = 0; this.initialized = false;
    const c = v => flat(v);
    const flesh = skin === 0 ? 0xe5b18c : 0xd29a73, shirt = skin === 0 ? 0x388bab : 0xb34b3d, pants = skin === 0 ? 0x273e65 : 0x354733, hair = skin === 0 ? 0x6b422c : 0x322a26;
    const g = this.group;
    part(g, 'Shirt', .48, .61, .28, 0, 1.055, 0, c(shirt)); part(g, 'Collar', .18, .08, .292, 0, 1.335, 0, c(0xe9dbb8));
    part(g, 'Belt', .49, .07, .29, 0, .77, 0, c(0x433b32));
    const pivot = (x, y, z) => { const p = new THREE.Group(); p.position.set(x, y, z); g.add(p); return p; };
    this.head = pivot(0, 1.44, 0);
    part(this.head, 'Face', .45, .45, .43, 0, .135, 0, c(flesh)); part(this.head, 'Hair', .47, .14, .45, 0, .32, 0, c(hair));
    part(this.head, 'Back hair', .46, .30, .06, 0, .17, .205, c(hair));
    part(this.head, 'Fringe', skin === 0 ? .21 : .45, .08, .045, skin === 0 ? -.12 : 0, .245, -.22, c(hair));
    for (const x of [-.108, .108]) {
      part(this.head, 'Eye white', .082, .065, .014, x, .14, -.222, c(0xffffff));
      part(this.head, 'Pupil', .035, .052, .018, x, .137, -.232, c(skin === 0 ? 0x3a634f : 0x3d5169));
      part(this.head, 'Eyebrow', .095, .025, .02, x, .20, -.228, c(hair));
    }
    part(this.head, 'Nose', .07, .075, .055, 0, .07, -.235, c(new THREE.Color(flesh).multiplyScalar(.91).getHex()));
    part(this.head, 'Mouth', .10, .022, .015, 0, -.002, -.222, c(0x86594b));
    if (skin === 1) {
      part(this.head, 'Beard', .26, .075, .022, 0, -.04, -.224, c(hair)); part(this.head, 'Moustache', .16, .025, .02, 0, .021, -.228, c(hair));
      part(g, 'Pocket', .12, .14, .018, -.12, 1.16, -.15, c(0xd07b58));
    } else {
      part(this.head, 'Freckle', .032, .021, .016, -.16, .064, -.225, c(0xae7050)); part(this.head, 'Freckle', .032, .021, .016, .16, .064, -.225, c(0xae7050));
      part(g, 'Shirt stripe', .49, .10, .292, 0, 1.08, 0, c(0xe2d7b5));
    }
    this.leftArm = pivot(-.35, 1.32, 0); this.rightArm = pivot(.35, 1.32, 0);
    for (const arm of [this.leftArm, this.rightArm]) { part(arm, 'Sleeve', .20, .30, .25, 0, -.13, 0, c(shirt)); part(arm, 'Hand', .18, .32, .22, 0, -.43, 0, c(flesh)); }
    this.leftLeg = pivot(-.125, .76, 0); this.rightLeg = pivot(.125, .76, 0);
    for (const leg of [this.leftLeg, this.rightLeg]) { part(leg, 'Trousers', .22, .61, .25, 0, -.29, 0, c(pants)); part(leg, 'Boot', .23, .16, .31, 0, -.68, -.025, c(0x302f2d)); }
    if (nameTag) {
      const label = BC.CubeFont.render(skin === 0 ? 'Саня' : 'Ваня', 24);
      const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: canvasTexture(label, 'tag' + skin), depthWrite: false }));
      sprite.scale.set(label.width * .007, label.height * .007, 1); sprite.position.set(0, 2.1, 0); g.add(sprite);
    }
  }
  update(target, dt) {
    const g = this.group, p = new THREE.Vector3(target.x, target.y, target.z);
    if (!this.initialized || g.position.distanceToSquared(p) > 64) { g.position.copy(p); this.initialized = true; }
    else g.position.lerp(p, 1 - Math.exp(-dt * 16));
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, target.yaw, 0));
    g.quaternion.slerp(q, 1 - Math.exp(-dt * 18));
    this.animate(dt, target.moving, target.airborne, target.swinging, target.pitch);
  }
  animate(dt, moving, airborne, swinging, pitch) {
    this.clock += dt; this.stride += ((moving ? 1 : 0) - this.stride) * Math.min(1, dt * 12);
    const step = Math.sin(this.clock * 10) * .72 * this.stride;
    this.head.rotation.set(pitch, 0, 0);
    this.leftLeg.rotation.set(airborne ? -.3 : step, 0, 0); this.rightLeg.rotation.set(airborne ? .3 : -step, 0, 0);
    this.leftArm.rotation.set(-step, 0, .035 + Math.sin(this.clock * 2) * .02);
    this.rightArm.rotation.set(swinging ? -1 - Math.sin(this.clock * 20) * .65 : step, 0, -.035);
  }
}
BC.PlayerModel = PlayerModel;

// ---------------------------------------------------------------- world view
class WorldView {
  constructor(world, options = {}) {
    this.world = world; this.group = new THREE.Group();
    this.chunks = new Map(); this.versions = new Map(); this.pending = new Set(); this.dirty = new Set();
    this.desired = new Set(); this.completed = [];
    this.entities = new THREE.Group(); this.group.add(this.entities);
    this.sheepModels = []; this.zombieModels = []; this.fishModels = [];
    this.hellModels = new Map(); this.modModels = new Map(); this.dropSprites = [];
    this.arrows = new THREE.Group(); this.group.add(this.arrows);
    this.workers = [];
    try { for (let i = 0; i < (options.workers || 2); i++) this.workers.push(this.makeWorker()); }
    catch (e) { this.workers = []; } // e.g. tests without Worker: build synchronously
    this.nextWorker = 0;
    this.unsubscribe = world.onChange((x, z) => this.changed(x, z));
    this.maxPending = 2 * Math.max(1, this.workers.length);
    buildAtlas(); voxelMaterials();
  }
  makeWorker() {
    const w = BC.createMesherWorker();
    w.onmessage = e => this.completed.push(e.data);
    return w;
  }
  key(cx, cz) { return cx * this.world.chunksZ + cz; }
  valid(cx, cz) { return cx >= 0 && cz >= 0 && cx < this.world.chunksX && cz < this.world.chunksZ; }
  loadedCount() { return this.chunks.size; }
  ready(x, z) {
    const cx = (x / BC.CHUNK) | 0, cz = (z / BC.CHUNK) | 0;
    for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++)
      if (this.valid(cx + dx, cz + dz) && !this.chunks.has(this.key(cx + dx, cz + dz))) return false;
    return true;
  }
  changed(x, z) {
    // Light reaches past the chunk border: rebuild the surrounding ring too.
    const cx = (x / BC.CHUNK) | 0, cz = (z / BC.CHUNK) | 0;
    for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) {
      if (!this.valid(cx + dx, cz + dz)) continue;
      const k = this.key(cx + dx, cz + dz);
      this.versions.set(k, (this.versions.get(k) || 0) + 1); this.dirty.add(k);
    }
  }
  update(x, z, radius, frameBudget = 2) {
    const cx = (x / BC.CHUNK) | 0, cz = (z / BC.CHUNK) | 0, W = this.world.chunksZ;
    const nearest = [];
    for (let dx = -radius; dx <= radius; dx++) for (let dz = -radius; dz <= radius; dz++)
      if (this.valid(cx + dx, cz + dz)) nearest.push(this.key(cx + dx, cz + dz));
    const d2 = k => { const dx = ((k / W) | 0) - cx, dz = k % W - cz; return dx * dx + dz * dz; };
    nearest.sort((a, b) => d2(a) - d2(b));
    this.desired = new Set(nearest);
    for (const [k, chunk] of this.chunks) if (!this.desired.has(k)) { this.disposeChunk(chunk); this.chunks.delete(k); }
    let attached = 0;
    while (this.completed.length && attached < frameBudget) {
      const result = this.completed.shift(); this.pending.delete(result.key);
      if (result.error) { console.error('[mesher]', result.error); continue; }
      if (this.desired.has(result.key) && result.version === (this.versions.get(result.key) || 0)) {
        this.attach(result); attached++;
        if (this.versions.get(result.key) === result.version) this.dirty.delete(result.key);
      }
    }
    for (const k of nearest) {
      if (this.pending.size >= this.maxPending) break;
      if (this.pending.has(k) || (this.chunks.has(k) && !this.dirty.has(k))) continue;
      this.request(k);
    }
    const near = radius * 16 - 12, far = radius * 16;
    shared.fogRange.value.set(near, far);
  }
  request(k) {
    const W = this.world.chunksZ, cx = (k / W) | 0, cz = k % W, version = this.versions.get(k) || 0;
    this.pending.add(k);
    const { snapshot, transfer } = BC.chunkSnapshot(this.world, cx, cz, k, version);
    if (!this.workers.length) { this.completed.push(BC.Mesher.buildChunk(snapshot).result); return; }
    this.workers[this.nextWorker++ % this.workers.length].postMessage(snapshot, transfer);
  }
  attach(result) {
    const old = this.chunks.get(result.key); if (old) this.disposeChunk(old);
    const chunk = new THREE.Group(), mats = voxelMaterials();
    for (const [name, g] of Object.entries(result.groups)) {
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.BufferAttribute(g.pos, 3));
      geometry.setAttribute('normal', new THREE.BufferAttribute(g.nrm, 3));
      geometry.setAttribute('uv', new THREE.BufferAttribute(g.uv, 2));
      geometry.setAttribute('lit', new THREE.BufferAttribute(g.lit, 2));
      geometry.setAttribute('lay', new THREE.BufferAttribute(g.lay, 1));
      geometry.setIndex(new THREE.BufferAttribute(g.idx, 1));
      geometry.computeBoundingSphere();
      const mesh = new THREE.Mesh(geometry, mats[name]);
      if (name === 'transparent') mesh.renderOrder = 1;
      chunk.add(mesh);
    }
    this.chunks.set(result.key, chunk); this.group.add(chunk);
  }
  disposeChunk(chunk) { this.group.remove(chunk); chunk.traverse(o => { if (o.isMesh) o.geometry.dispose(); }); }

  // ------------------------------------------------------------ creatures and items
  brightness(x, y, z) {
    const w = this.world;
    if (w.dimension === 'HELL_FOREST') return .8;
    let exposed = true;
    const bx = Math.floor(x), bz = Math.floor(z);
    for (let by = Math.floor(y + 1); by < BC.HEIGHT && exposed; by++) if (BC.BLOCKS_LIGHT[w.get(bx, by, bz)]) exposed = false;
    const day = shared.daylight.value;
    let light = (exposed ? 1 : .35) * (.045 + .955 * day);
    for (const t of this.torches || []) { const d = Math.hypot(t.x - x, t.y - y, t.z - z); if (d < 13) light = Math.max(light, Math.pow(1 - d / 14, 1.5)); }
    if (shared.heldTorch.value) { const d = shared.torchPos.value.distanceTo(new THREE.Vector3(x, y + .8, z)); if (d < 8) light = Math.max(light, (1 - d / 8) ** 2); }
    return BC.clamp(light + .1, .12, 1);
  }
  updateEntities(dt, px, pz) {
    const w = this.world;
    if (!this.torchClock || (this.torchClock -= dt) <= 0) { this.torches = w.torchesNear(px, pz, 48, 12); this.torchClock = .5; }
    const sync = (list, models, factory) => {
      while (models.length < list.length) { const m = factory(); models.push(m); this.entities.add(m); }
      while (models.length > list.length) this.entities.remove(models.pop());
    };
    sync(w.sheep, this.sheepModels, sheepModel);
    w.sheep.forEach((s, i) => {
      const m = this.sheepModels[i]; m.position.set(s.x, s.y, s.z); m.rotation.set(0, -Math.atan2(s.dz, s.dx), 0);
      tint(m, this.brightness(s.x, s.y, s.z), w.hurtFlash(s.id));
    });
    sync(w.zombies, this.zombieModels, zombieModel);
    w.zombies.forEach((z, i) => {
      const m = this.zombieModels[i]; m.position.set(z.x, z.y, z.z); m.rotation.set(0, z.heading, 0);
      tint(m, this.brightness(z.x, z.y, z.z), w.hurtFlash(z.id));
      const stride = Math.sin((z.x + z.z) * 5) * .45;
      m.getObjectByName('Left leg').rotation.x = stride; m.getObjectByName('Right leg').rotation.x = -stride;
    });
    sync(w.fish, this.fishModels, fishModel);
    w.fish.forEach((f, i) => { const m = this.fishModels[i]; m.position.set(f.x, f.y, f.z); m.rotation.set(0, Math.atan2(f.dx, f.dz), 0); tint(m, this.brightness(f.x, f.y, f.z), false); });
    // Hell creatures
    const alive = new Set();
    for (const mob of w.hellMobs) {
      alive.add(mob.id);
      let m = this.hellModels.get(mob.id);
      if (!m) { m = hellMobModel(mob.kind); this.hellModels.set(mob.id, m); this.entities.add(m); }
      m.position.set(mob.x, mob.y, mob.z); m.rotation.set(0, mob.heading, 0);
      tint(m, 1, w.hurtFlash(mob.id));
      const stride = Math.sin((mob.x + mob.z) * 6) * .55;
      for (const name of ['Left leg', 'Right leg', 'Rear left', 'Rear right']) {
        const leg = m.getObjectByName(name); if (leg) leg.rotation.x = name.toLowerCase().includes('left') ? stride : -stride;
      }
      if (mob.kind === 'IMP') {
        const flap = Math.sin(performance.now() / 1000 * 16) * .45;
        m.getObjectByName('Left wing').rotation.set(0, flap, .3); m.getObjectByName('Right wing').rotation.set(0, -flap, -.3);
      }
    }
    for (const [id, m] of this.hellModels) if (!alive.has(id)) { this.entities.remove(m); this.hellModels.delete(id); }
    this.updateMods();
    // Drops: billboards; the pool is reused frame to frame.
    const drops = w.drops;
    while (this.dropSprites.length < drops.length) { const s = new THREE.Sprite(new THREE.SpriteMaterial({ transparent: true })); s.center.set(.5, 0); this.dropSprites.push(s); this.entities.add(s); }
    while (this.dropSprites.length > drops.length) this.entities.remove(this.dropSprites.pop());
    drops.forEach((d, i) => {
      const s = this.dropSprites[i], texture = BC.item(d.item).texture, size = d.item === 'STICK' ? .65 : .42;
      if (s.userData.texture !== texture + BC.Textures.pack) {
        s.material.map = canvasTexture(BC.Textures.icon(texture, 32), 'icon:' + BC.Textures.path(texture));
        s.material.needsUpdate = true; s.userData.texture = texture + BC.Textures.pack;
      }
      s.scale.set(size, size, 1); s.position.set(d.x + .5, d.y + .03, d.z + .5);
      s.material.color.setScalar(this.brightness(d.x + .5, d.y, d.z + .5));
    });
  }
  updateMods() {
    const state = this.world.mods;
    for (const [id, m] of this.modModels) if (!state.entities.has(id)) { this.entities.remove(m); this.modModels.delete(id); }
    for (const e of state.entities.values()) {
      let m = this.modModels.get(e.id);
      if (!m) {
        m = new THREE.Group(); const def = state.definitions.get(e.type) || {};
        for (const p of def.model || []) {
          const mesh = part(m, String(p.name || 'part'), Math.abs(p.sx ?? .2), Math.abs(p.sy ?? .2), Math.abs(p.sz ?? .2), p.x || 0, p.y || 0, p.z || 0,
            flat(parseInt(p.color || 'dddddd', 16)));
          mesh.userData.tamed = p.tamed_only === true;
        }
        this.modModels.set(e.id, m); this.entities.add(m);
      }
      m.position.set(e.x, e.y, e.z); m.rotation.set(0, e.heading, 0);
      tint(m, this.brightness(e.x, e.y, e.z), e.hurtTime > 0);
      for (const child of m.children) {
        if (child.userData.tamed) child.visible = !!e.owner;
        if (child.name.includes('leg')) child.rotation.x = Math.sin((e.x + e.z) * 5) * (child.name.includes('left') ? 1 : -1) * .35;
      }
    }
    while (this.arrows.children.length < state.projectiles.length) {
      const a = new THREE.Group();
      a.add(new THREE.Mesh(box(.036, .036, .7), flat(0xaa8050)));
      const tip = new THREE.Mesh(box(.07, .07, .12), flat(0xd9d9cc)); tip.position.z = .37; a.add(tip);
      this.arrows.add(a);
    }
    while (this.arrows.children.length > state.projectiles.length) this.arrows.remove(this.arrows.children[this.arrows.children.length - 1]);
    state.projectiles.forEach((p, i) => {
      const a = this.arrows.children[i]; a.position.set(p.position.x, p.position.y, p.position.z);
      a.lookAt(p.position.x + p.velocity.x, p.position.y + p.velocity.y, p.position.z + p.velocity.z);
    });
  }
  close() {
    this.unsubscribe();
    for (const w of this.workers) w.terminate();
    for (const chunk of this.chunks.values()) this.disposeChunk(chunk);
    this.chunks.clear();
    if (this.group.parent) this.group.parent.remove(this.group);
  }
}
BC.WorldView = WorldView;

BC.Render = {
  shared, buildAtlas,
  rebuildAtlas() { atlasPack = -1; buildAtlas(); for (const m of Object.values(voxelMaterials())) m.needsUpdate = true; texCache.clear(); },
  setDaylight(v) { shared.daylight.value = BC.clamp(v, 0, 1); },
  setAtmosphere(sun, tint, fog) { shared.sunDirection.value.copy(sun); shared.sunTint.value.copy(tint); shared.fogColor.value.copy(fog); },
  setHeldTorch(p) { shared.heldTorch.value = p ? 1 : 0; if (p) shared.torchPos.value.set(p.x, p.y, p.z); },
  setUnderwater(v) { shared.underwater.value = v ? 1 : 0; },
  setAmbientFloor(v) { shared.ambientFloor.value = v; },
  wireBox(color) {
    const geometry = new THREE.EdgesGeometry(new THREE.BoxGeometry(1, 1, 1));
    const lines = new THREE.LineSegments(geometry, new THREE.LineBasicMaterial({ color, transparent: true }));
    lines.visible = false; return lines;
  },
  canvasTexture
};

// ---------------------------------------------------------------- loading panorama
/** A separate, non-persistent exhibition world; never touches the player's save. */
class LoadingPanorama {
  constructor() {
    this.world = BC.World.flat(); this.time = 0;
    this.build();
    this.view = new WorldView(this.world, { workers: 1 });
    this.view.group.visible = false;
  }
  build() {
    const w = this.world;
    for (let x = 0; x < 80; x++) for (let z = 0; z < 80; z++) {
      const river = 40 + Math.trunc(3 * Math.sin(z * .13)), wet = Math.abs(x - river) < 4;
      const hill = Math.trunc(Math.max(0, Math.sin(x * .13) * Math.cos(z * .12)) * 4), top = wet ? 8 : 11 + hill;
      for (let y = 6; y <= top; y++) w.set(x, y, z, x > river || wet ? B.SAND : y === top ? B.GRASS : B.STONE);
      if (wet) for (let y = 9; y <= 10; y++) w.set(x, y, z, B.WATER);
    }
    for (const [x, z] of [[13, 23], [19, 32], [12, 43], [25, 20], [29, 28], [22, 48]]) {
      let y = BC.HEIGHT - 1; while (y > 0 && w.get(x, y, z) === B.AIR) y--; y++;
      for (let h = 0; h < 5; h++) w.set(x, y + h, z, B.LOG);
      for (let dx = -2; dx <= 2; dx++) for (let dz = -2; dz <= 2; dz++) for (let dy = 3; dy <= 5; dy++)
        if (Math.abs(dx) + Math.abs(dz) < 4) w.set(x + dx, y + dy, z + dz, B.LEAVES);
    }
    for (let x = 25; x <= 57; x++) for (let z = 31; z <= 44; z++) {
      const top = 12 + Math.min(2, Math.trunc((44 - z) / 4)) * 2;
      for (let y = 11; y <= top; y++) w.set(x, y, z, y === top ? B.PLANKS : B.STONE);
      for (let y = top + 1; y < 23; y++) w.set(x, y, z, B.AIR);
    }
    const absent = new BC.Player(); absent.position = { x: 1, y: 40, z: 1 };
    let index = 0;
    for (let block = 1; block < BC.BLOCK_COUNT; block++) {
      if (block === B.DOOR_TOP || block === B.BED_HEAD || block === B.ROTATOR) continue;
      const row = (index / 11) | 0, col = index % 11, x = 26 + col * 3, z = 43 - row * 4, y = 13 + row * 2; index++;
      if (block === B.DOOR) w.placeDoor(x, y, z, 0, absent);
      else if (block === B.BED) w.placeBed(x, y, z, 0, absent);
      else if (block === B.PORTAL_FRAME || block === B.FOREST_PORTAL) w.putEdit(w.key(x, y, z), x, z, block);
      else w.set(x, y, z, block);
    }
    for (const x of [30, 51]) for (let z = 47; z <= 50; z++) for (let dx = -2; dx <= 2; dx++) {
      for (let y = 11; y <= 12; y++) w.set(x + dx, y, z, B.PLANKS);
      for (let y = 13; y < 18; y++) w.set(x + dx, y, z, B.AIR);
    }
    w.sheep = [{ x: 30.5, y: 13, z: 48.5, health: 3, dx: 1, dz: 0, flee: 0, id: 'sheep:panorama' }];
    w.zombies = [{ x: 51.5, y: 13, z: 48.5, health: 8, cooldown: 0, vy: 0, heading: 0, id: 'zombie:panorama' }];
    for (let i = 0; i < 4; i++) w.fish.push({ x: 40 + i * .55, y: 10.35, z: 53 + i * .65, dx: 1, dz: 0 });
  }
  ready() { return this.view.loadedCount() >= 25; }
  update(camera, dt, visible) {
    this.view.group.visible = visible;
    if (this.view.loadedCount() < 25 || visible) this.view.update(40, 40, 2, 4);
    if (!visible) return;
    shared.fogRange.value.set(65, 85);
    this.time += dt; this.world.updateFish(dt);
    for (const [x, , z] of this.world.updateWater(dt)) { /* the world notifies the view itself */ void x; void z; }
    this.view.updateEntities(dt, 40, 40);
    camera.position.set(41 + Math.sin(this.time * .08) * 3, 23, 69);
    camera.lookAt(41, 13, 38);
  }
}
BC.LoadingPanorama = LoadingPanorama;
})();
