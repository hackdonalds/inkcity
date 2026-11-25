import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { GenParams, Terrain, bridgePoints } from './tower';
import { MAX_BLOCKS, MAX_BRACES, MatMode, Pick, World, stabilityWord } from './world';
import { COSTS, LANDMARKS, RES_KEYS, ROLES, Role, fmtCost } from './economy';
import { PALETTES } from './palettes';
import { gbufFrag, gbufVert, postFrag, postVert } from './shaders';
import { buildSmoke } from './smoke';
import { Sound } from './audio';
import { Residents } from './residents';
import { buildAmbient } from './ambient';
import { BUILD_MS, WASH_MS } from './world';
import type { SaveCore } from './world';

const params = new URLSearchParams(location.search);
const state = {
  seed: Number(params.get('seed') ?? 7),
  height: Number(params.get('h') ?? 22),
  count: Number(params.get('n') ?? 7),
  lean: Number(params.get('lean') ?? 1),
  wonk: Number(params.get('wonk') ?? 0.5),
  terrain: (params.get('terrain') ?? 'crag') as Terrain,
  palette: Number(params.get('pal') ?? 0),
  boil: params.get('boil') !== '0',
  hatch: params.get('hatch') !== '0',
  line: Number(params.get('line') ?? 1.1),
};

// ---------------------------------------------------------------- renderer
const renderer = new THREE.WebGLRenderer({ antialias: false, preserveDrawingBuffer: true });
renderer.autoClear = false;
const dpr = Math.min(window.devicePixelRatio, 2);
renderer.setPixelRatio(dpr);
document.body.appendChild(renderer.domElement);

const camera = new THREE.PerspectiveCamera(28, 1, 1, 600);
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.maxPolarAngle = Math.PI * 0.52;

const scene = new THREE.Scene();
const gbuf = new THREE.WebGLRenderTarget(1, 1, { count: 3, type: THREE.HalfFloatType, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter });
const shadowRT = new THREE.WebGLRenderTarget(2048, 2048);
shadowRT.depthTexture = new THREE.DepthTexture(2048, 2048);
const lightCam = new THREE.OrthographicCamera(-30, 30, 30, -30, 1, 200);
const shadowMat = new THREE.MeshBasicMaterial({ colorWrite: false, side: THREE.DoubleSide });

const gmat = new THREE.RawShaderMaterial({
  glslVersion: THREE.GLSL3,
  vertexShader: gbufVert,
  fragmentShader: gbufFrag,
  side: THREE.DoubleSide,
  uniforms: {
    uPal: { value: Array.from({ length: 17 }, () => new THREE.Vector3()) },
    uShade: { value: new THREE.Vector3() }, uLight: { value: new THREE.Vector3() }, uFrame: { value: new THREE.Vector3() },
    uSun: { value: new THREE.Vector3() }, uCam: { value: new THREE.Vector3() }, uFar: { value: 600 },
    uShadow: { value: shadowRT.depthTexture }, uLightVP: { value: new THREE.Matrix4() },
    uHatch: { value: 1 }, uDetail: { value: 1 }, uNight: { value: 0 },
    uFade: { value: new THREE.Vector2(9, 16) }, uSea: { value: 0 }, uReveal: { value: 1e6 }, uClip: { value: -1e6 },
    uSway: { value: new THREE.Vector4() }, uTime: { value: 0 }, uSketch: { value: 1e6 }, uIvy: { value: new THREE.Vector2() },
  },
});

const post = new THREE.Mesh(
  new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3)),
  new THREE.RawShaderMaterial({
    glslVersion: THREE.GLSL3, vertexShader: postVert, fragmentShader: postFrag, depthTest: false, depthWrite: false,
    uniforms: {
      tCol: { value: gbuf.textures[0] }, tNrm: { value: gbuf.textures[1] }, tInfo: { value: gbuf.textures[2] },
      uRes: { value: new THREE.Vector2() }, uBoil: { value: 0 }, uScale: { value: dpr },
      uPaper: { value: new THREE.Vector3() }, uInk: { value: new THREE.Vector3() },
      uCloudA: { value: new THREE.Vector3() }, uCloudB: { value: new THREE.Vector3() }, uCloud: { value: 0 }, uFadeLight: { value: 0 },
      uLineW: { value: 1.1 }, uWobble: { value: 1.6 }, uBleed: { value: 2.5 },
      uNight: { value: 0 }, uFog: { value: 0 }, uRain: { value: 0 }, uTime: { value: 0 }, uFlash: { value: 0 }, uGlow: { value: new THREE.Vector3(1.0, 0.72, 0.32) },
    },
  }),
);
post.frustumCulled = false;
const postScene = new THREE.Scene();
postScene.add(post);
const postCam = new THREE.Camera();

// ---------------------------------------------------------------- content
const group = new THREE.Group();
scene.add(group);
const U = gmat.uniforms;
const residents = new Residents({ uShade: U.uShade, uLight: U.uLight, uSun: U.uSun, uCam: U.uCam, uFar: U.uFar, uShadow: U.uShadow, uLightVP: U.uLightVP });
scene.add(residents.group);
residents.load('./characters/').catch((e) => console.warn('residents failed to load', e));
let world: World;
let topY = 20, extent = 20;
let populate = params.get('empty') !== '1';
const genParams = (): GenParams => ({ seed: state.seed, height: state.height, lean: state.lean, wonk: state.wonk, terrain: state.terrain, count: state.count });

function siteUniforms() {
  const u = gmat.uniforms;
  extent = world.extent;
  if (state.terrain === 'island') u.uFade.value.set(extent * 1.1, extent * 1.8);
  else u.uFade.value.set(extent * 0.7, extent * 1.1);
  const S = extent * 1.5 + 12;
  Object.assign(lightCam, { left: -S, right: S, top: S, bottom: -S, far: 400 });
  lightCam.updateProjectionMatrix();
  u.uSea.value = state.terrain === 'island' ? 1 : 0;
}
function stats(ms?: number) {
  let tris = 0;
  group.traverse((o) => { if ((o as THREE.Mesh).isMesh) tris += (o as THREE.Mesh).geometry.attributes.position.count / 3; });
  (document.getElementById('stats') as HTMLElement).textContent =
    `${world.specs.length} buildings · ${Math.round(tris).toLocaleString()} tris` + (ms !== undefined ? ` · ${ms.toFixed(0)} ms` : '');
}
/** New site. Keeps the camera unless asked. */
function regenerate(resetCam = false) {
  const t0 = performance.now();
  if (!world) { world = new World(genParams(), group, gmat); world.onChange = () => { topY = world.top; stats(); checkRecord(); hud(); refreshHover(); }; world.onEvent = toast; world.onSfx = (n) => sound.play(n); }
  residents.clear();
  world.reset(genParams(), populate);
  topY = world.top;
  primeUnlocks();
  loadRecord();
  siteUniforms();
  if (resetCam) frame();
  stats(performance.now() - t0);
}
/** Same buildings, new lean / wonkiness. */
function restyle() {
  world.p = genParams(); world.g.p = world.p; world.site.p = world.p;
  for (const s of world.specs) world.rebuild(s.id, false);
  world.rebuildGround();
}

function frame() {
  const h = topY;
  const span = Math.max(h * 1.2, extent * 0.6);
  controls.target.set(0, h * 0.5 - extent * 0.12, 0);
  const t = Math.tan((camera.fov * Math.PI) / 360);
  const dist = Math.max(span / (2 * t), (extent * 1.8) / (2 * t * camera.aspect)) * 1.02;
  const dir = new THREE.Vector3(0.55, 0.28, 0.82).normalize();
  camera.position.copy(controls.target).addScaledVector(dir, dist);
  controls.update();
}
function applyPalette() {
  const p = PALETTES[state.palette];
  const u = gmat.uniforms;
  p.mats.forEach((c, i) => u.uPal.value[i].set(...c));
  u.uShade.value.set(...p.shade); u.uLight.value.set(...p.light); u.uFrame.value.set(...p.frame);
  u.uSun.value.set(...p.sun).normalize();
  const pu = post.material.uniforms;
  pu.uPaper.value.set(...p.paper); pu.uInk.value.set(...p.ink);
  pu.uCloudA.value.set(...p.cloudA); pu.uCloudB.value.set(...p.cloudB); pu.uCloud.value = p.cloud;
  pu.uFadeLight.value = p.fadeLight;
  document.body.style.background = `rgb(${p.paper.map((x) => x * 255).join(',')})`;
}

// ---------------------------------------------------------------- loop
function resize() {
  const w = window.innerWidth, h = window.innerHeight;
  renderer.setSize(w, h);
  camera.aspect = w / h; camera.updateProjectionMatrix();
  gbuf.setSize(w * dpr, h * dpr);
  post.material.uniforms.uRes.value.set(w * dpr, h * dpr);
}
window.addEventListener('resize', resize);

let frameCount = 0;
const DAY_SECONDS = 20;
let lastT = 0, dayClock = DAY_SECONDS * 0.25;
// ---------------------------------------------------------------- atmosphere
type Weather = 'clear' | 'fog' | 'rain' | 'storm';
const atmos = { cycle: params.get('cycle') !== '0', weather: (params.get('weather') ?? 'auto') as 'auto' | Weather, kind: 'clear' as Weather, fog: 0, rain: 0, storm: 0, night: 0, tod: 0.25, forecast: ['clear', 'clear'] as Weather[], flash: 0, nextBolt: 0 };
if (params.get('tod')) atmos.tod = Number(params.get('tod'));
const sound = new Sound();
let smokeMesh: THREE.Mesh | null = null, ambientMesh: THREE.Mesh | null = null, smokeT = 0, creakT = 0;
const wind: [number, number] = [0.6, 0.25];
const smooth = (a: number, b: number, x: number) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

function atmosphere(time: number, dt: number) {
  if (atmos.cycle) atmos.tod = dayClock / DAY_SECONDS;
  const tod = atmos.tod;
  // 0 = dawn, ~0.36 = noon, 0.72 = dusk, then night until 1
  const night = Math.max(smooth(0.68, 0.78, tod) * (1 - smooth(0.95, 1.0, tod)), 1 - smooth(0.0, 0.04, tod));
  const dusk = Math.max(1 - smooth(0.0, 0.12, tod), smooth(0.56, 0.7, tod) * (1 - smooth(0.74, 0.8, tod)));
  atmos.night = night;
  const target = atmos.weather === 'auto' ? atmos.kind : atmos.weather;
  const k = Math.min(1, dt * 0.35);
  atmos.fog += ((target === 'fog' ? 1 : target === 'rain' ? 0.25 : target === 'storm' ? 0.4 : 0) - atmos.fog) * k;
  atmos.rain += ((target === 'rain' || target === 'storm' ? 1 : 0) - atmos.rain) * k;
  atmos.storm += ((target === 'storm' ? 1 : 0) - atmos.storm) * k;
  world.setStorm(atmos.storm > 0.5 ? 0.15 : 0);
  // lightning
  if (atmos.storm > 0.6 && time > atmos.nextBolt) {
    atmos.nextBolt = time + 3000 + Math.random() * 7000;
    atmos.flash = 1;
    setTimeout(() => sound.play('thunder'), 300 + Math.random() * 1200);
  }
  atmos.flash = Math.max(0, atmos.flash - dt * 4);
  post.material.uniforms.uFlash.value = atmos.flash > 0.5 ? atmos.flash : atmos.flash * 0.3;
  wind[0] = 0.6 * (1 + atmos.storm * 1.5); wind[1] = 0.25 * (1 + atmos.storm * 1.5);
  const p = PALETTES[state.palette];
  const u = gmat.uniforms, pu = post.material.uniforms;
  // sun sweeps east → west; at night a dim moon from the palette's sun direction
  const dayPhase = Math.min(1, tod / 0.72);
  const base = new THREE.Vector3(...p.sun);
  const az = Math.atan2(base.z, base.x) + (dayPhase - 0.5) * 2.4;
  const el = night > 0.5 ? 0.6 : 0.12 + 0.9 * Math.sin(Math.PI * dayPhase);
  u.uSun.value.set(Math.cos(az), el, Math.sin(az)).normalize();
  const warm = [1.2, 0.93, 0.72], cool = [0.8, 0.82, 1.0];
  const overcast = Math.max(atmos.rain, atmos.fog * 0.6);
  u.uLight.value.set(...p.light.map((c, i) => c * (1 + (warm[i] - 1) * dusk) * (1 - overcast * 0.12) * (1 + (cool[i] - 1) * night)));
  u.uShade.value.set(...p.shade.map((c, i) => Math.min(1, c * (1 + overcast * 0.25) * (1 + (cool[i] - 1) * night * 0.5))));
  u.uNight.value = night;
  pu.uNight.value = night * 0.92;
  pu.uFog.value = atmos.fog;
  pu.uRain.value = atmos.rain;
  pu.uTime.value = time / 1000;
  world.econ.foodMul = atmos.rain > 0.5 ? 1.25 : 1;
  // smoke ~30 fps
  if (time - smokeT > 33) {
    smokeT = time;
    if (smokeMesh) { group.remove(smokeMesh); smokeMesh.geometry.dispose(); }
    smokeMesh = new THREE.Mesh(buildSmoke(world.smokeSources(), time / 1000, wind, atmos.rain), gmat);
    smokeMesh.userData.hooked = false;
    group.add(smokeMesh);
    if (ambientMesh) { group.remove(ambientMesh); ambientMesh.geometry.dispose(); }
    ambientMesh = new THREE.Mesh(buildAmbient(world, world.laundry, world.boats, time / 1000, wind, atmos.night, atmos.rain), gmat);
    group.add(ambientMesh);
  }
  // sound
  sound.env = { night, rain: atmos.rain, sea: state.terrain === 'island', fog: atmos.fog };
  sound.update();
  if (time - creakT > 4000) {
    creakT = time;
    if ([...world.built.values()].some((b) => b.stability < 0.15)) sound.play('creak');
  }
  const todEl = document.getElementById('tod');
  if (todEl) todEl.textContent = night > 0.5 ? '☾' : dusk > 0.5 ? '◐' : '☀';
  const wEl = document.getElementById('wx');
  if (wEl) wEl.textContent = atmos.storm > 0.5 ? '⚡ storm' : atmos.rain > 0.5 ? '☂ rain' : atmos.fog > 0.5 ? '≋ fog' : '';
}

function newDay() {
  for (const e of world.dayTick()) toast(e);
  if (atmos.weather === 'auto') {
    const prev = atmos.kind;
    atmos.kind = atmos.forecast.shift()!;
    const r = Math.random();
    atmos.forecast.push(r < 0.5 ? atmos.kind === 'storm' ? 'rain' : atmos.kind : r < 0.62 ? 'clear' : r < 0.74 ? 'fog' : r < 0.9 ? 'rain' : world.econ.day > 4 ? 'storm' : 'rain');
    if (atmos.kind !== prev) toast(atmos.kind === 'rain' ? 'Rain rolls in — the farms drink it up (+25% food)' : atmos.kind === 'fog' ? 'A sea fog settles over the town'
      : atmos.kind === 'storm' ? '⚡ The storm breaks! Every tower is under strain — shaky ones may fall' : 'The skies clear');
    if (atmos.forecast[0] === 'storm' && atmos.kind !== 'storm') toast('⚡ A storm is coming tomorrow — brace or bridge your shakiest towers');
    else if (atmos.forecast[1] === 'storm' && world.specs.some((s) => s.role === 'belltower')) toast('🔔 The bell-ringer sees a storm in two days');
  }
  checkRecord();
  sound.play('bell');
  hud();
  autosave();
}

function render(time: number) {
  controls.update();
  const dt = Math.min(0.1, (time - lastT) / 1000); lastT = time;
  gmat.uniforms.uTime.value = time / 1000;
  if (world) {
    atmosphere(time, dt);
    world.update(performance.now());
    residents.update(dt, world, atmos.night, atmos.rain);
    if (speed > 0 && world.specs.length) {
      dayClock += dt * speed;
      if (dayClock >= DAY_SECONDS) { dayClock = 0; newDay(); }
    }
    const bar = document.getElementById('daybar');
    if (bar) bar.style.width = `${(dayClock / DAY_SECONDS) * 100}%`;
  }
  if (needsPick) { needsPick = false; refreshHover(); }
  // "drawing in" animation for new floors
  const now = performance.now();
  for (const o of group.children) {
    const rv = o.userData.reveal;
    if (!o.onBeforeRender || !o.userData.hooked) {
      o.userData.hooked = true;
      o.onBeforeRender = () => {
        const r = o.userData.reveal;
        let y = 1e6;
        if (r) {
          const k = Math.min(1, (performance.now() - r.t0) / (300 + (r.to - r.from) * 45));
          y = r.from + (r.to - r.from) * (1 - (1 - k) ** 2);
        }
        gmat.uniforms.uReveal.value = y;
        const sw = o.userData.sway;
        if (sw) gmat.uniforms.uSway.value.set(sw.x, sw.base, sw.z, sw.amp); else gmat.uniforms.uSway.value.set(0, 0, 0, 0);
        gmat.uniforms.uClip.value = o.userData.clip ?? -1e6;
        const sk = o.userData.sketch, nowMs = performance.now();
        gmat.uniforms.uSketch.value = !sk ? 1e6 : nowMs - sk.t0 < BUILD_MS ? sk.y : sk.y + (sk.top + 3 - sk.y) * Math.min(1, (nowMs - sk.t0 - BUILD_MS) / WASH_MS);
        const sid = o.userData.id, spec = sid !== undefined && world ? world.spec(sid) : undefined;
        if (spec) gmat.uniforms.uIvy.value.set(Math.min(0.85, Math.max(0, (world.econ.day - (spec.born ?? 0)) / 25)), world.built.get(sid)?.lot.top ?? 0);
        else gmat.uniforms.uIvy.value.set(0, 0);
        gmat.uniformsNeedUpdate = true;
      };
    }
    if (rv && now - rv.t0 > 300 + (rv.to - rv.from) * 45) delete o.userData.reveal;
  }
  const u = gmat.uniforms;
  // shadow pass
  const sun = u.uSun.value as THREE.Vector3;
  const c = new THREE.Vector3(0, topY * 0.4, 0);
  lightCam.position.copy(c).addScaledVector(sun, 150);
  lightCam.lookAt(c);
  lightCam.updateMatrixWorld();
  u.uLightVP.value.multiplyMatrices(lightCam.projectionMatrix, lightCam.matrixWorldInverse);
  scene.overrideMaterial = shadowMat;
  renderer.setRenderTarget(shadowRT);
  renderer.clear();
  renderer.render(scene, lightCam);
  scene.overrideMaterial = null;
  // g-buffer
  u.uCam.value.copy(camera.position);
  u.uHatch.value = state.hatch ? 1 : 0;
  renderer.setRenderTarget(gbuf);
  renderer.setClearColor(0x000000, 0);
  renderer.clear();
  renderer.render(scene, camera);
  // compose
  const pu = post.material.uniforms;
  pu.uBoil.value = state.boil ? Math.floor(time / 1000 * 5) % 7 : 0;
  pu.uLineW.value = state.line;
  renderer.setRenderTarget(null);
  renderer.render(postScene, postCam);
  renderer.render(overlay, camera);
  frameCount++;
  requestAnimationFrame(render);
}

// ---------------------------------------------------------------- UI
function ui() {
  const el = document.getElementById('ui')!;
  const bind = (id: string, key: keyof typeof state, regen: boolean, fn?: (v: string) => unknown) => {
    const input = document.getElementById(id) as HTMLInputElement | HTMLSelectElement;
    const cur = state[key];
    if (input instanceof HTMLInputElement && input.type === 'checkbox') input.checked = cur as boolean;
    else input.value = String(cur);
    input.addEventListener('input', () => {
      const v = input instanceof HTMLInputElement && input.type === 'checkbox' ? input.checked : (fn ? fn(input.value) : Number(input.value));
      (state as Record<string, unknown>)[key] = v;
      if (key === 'palette') { applyPalette(); applyInk(); }
      if (key === 'lean' || key === 'wonk') restyle();
      else if (regen) regenerate(key === 'height' || key === 'count' || key === 'terrain');
      syncUrl();
    });
  };
  bind('seed', 'seed', true);
  bind('height', 'height', true);
  bind('count', 'count', true);
  bind('lean', 'lean', true);
  bind('wonk', 'wonk', true);
  bind('terrain', 'terrain', true, (v) => v);
  bind('palette', 'palette', false);
  bind('boil', 'boil', false);
  bind('hatch', 'hatch', false);
  bind('line', 'line', false);
  document.getElementById('dice')!.addEventListener('click', () => {
    state.seed = Math.floor(Math.random() * 99999);
    (document.getElementById('seed') as HTMLInputElement).value = String(state.seed);
    populate = true; regenerate(true); syncUrl();
  });
  document.getElementById('empty')!.addEventListener('click', () => { populate = false; regenerate(true); });
  document.getElementById('refs')!.addEventListener('click', () => document.body.classList.toggle('show-refs'));
  void el;
}
function syncUrl() {
  const q = new URLSearchParams({
    seed: String(state.seed), h: String(state.height), n: String(state.count), lean: String(state.lean), wonk: String(state.wonk),
    terrain: state.terrain, pal: String(state.palette), boil: state.boil ? '1' : '0', hatch: state.hatch ? '1' : '0', line: String(state.line),
  });
  history.replaceState(null, '', '?' + q.toString());
}

// ---------------------------------------------------------------- interaction
type Tool = 'look' | 'build' | 'brace' | 'bridge' | 'demolish';

let speed = 1;
let role: Role = 'house';
let matMode: MatMode = 'auto';
let tool: Tool = 'build';
let hover: Pick = null;
let bridgeFrom: number | null = null;
let shift = false;
let needsPick = false;
const ndc = new THREE.Vector2(-9, -9);
const raycaster = new THREE.Raycaster();
const overlay = new THREE.Scene();
const inkMat = new THREE.LineBasicMaterial({ color: 0x2b231f, transparent: true, opacity: 0.85, depthTest: false });
const okMat = new THREE.LineBasicMaterial({ color: 0x2f6b4f, transparent: true, opacity: 0.95, depthTest: false });
const badMat = new THREE.LineBasicMaterial({ color: 0xb3261e, transparent: true, opacity: 0.95, depthTest: false });
const tipEl = document.getElementById('tip')!;
const hintEl = document.getElementById('hint')!;
let mouse = { x: 0, y: 0 };

const HINTS: Record<Tool, string> = {
  look: 'Drag to orbit · scroll to zoom · right-drag to pan',
  build: 'Click ground to found the chosen building · click a building to add a floor · Shift-click to remove one',
  brace: 'Click a building to prop it up with timber braces (+stability)',
  bridge: 'Click a building, then another, to string a bridge between their upper floors (both get steadier)',
  demolish: 'Click a building to pull it down',
};

function setTool(t: Tool) {
  tool = t; bridgeFrom = null;
  document.querySelectorAll<HTMLButtonElement>('#tools [data-tool]').forEach((b) => b.classList.toggle('on', b.dataset.tool === t));
  hintEl.textContent = HINTS[t];
  document.getElementById('buildbar')!.style.display = t === 'build' ? 'flex' : 'none';
  refreshHover();
}

/** Sketchy wire lines: each segment drawn twice with a little jitter. */
function lines(segs: THREE.Vector3[], mat: THREE.LineBasicMaterial) {
  const pts: number[] = [];
  for (let pass = 0; pass < 2; pass++) for (let i = 0; i < segs.length; i += 2) {
    const j = pass ? 0.06 : 0;
    const a = segs[i], b = segs[i + 1];
    const e = b.clone().sub(a).multiplyScalar(pass ? 0.04 : 0.02);
    pts.push(a.x - e.x + j, a.y - e.y, a.z - e.z - j, b.x + e.x - j, b.y + e.y + j, b.z + e.z);
  }
  const g = new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
  const l = new THREE.LineSegments(g, mat);
  l.renderOrder = 10;
  overlay.add(l);
}
const V = (p: number[]) => new THREE.Vector3(p[0], p[1], p[2]);
/** Box edges in a block's frame, mapped to world by `xf`. */
function boxLines(xf: (p: number[]) => number[], w: number, d: number, y0: number, y1: number, mat: THREE.LineBasicMaterial) {
  const c = [[-w / 2, -d / 2], [w / 2, -d / 2], [w / 2, d / 2], [-w / 2, d / 2]];
  const s: THREE.Vector3[] = [];
  for (let i = 0; i < 4; i++) {
    const [x0, z0] = c[i], [x1, z1] = c[(i + 1) % 4];
    s.push(V(xf([x0, y0, z0])), V(xf([x1, y0, z1])), V(xf([x0, y1, z0])), V(xf([x1, y1, z1])), V(xf([x0, y0, z0])), V(xf([x0, y1, z0])));
  }
  lines(s, mat);
}
function buildingLines(id: number, mat: THREE.LineBasicMaterial, onlyTop = false) {
  const b = world.built.get(id);
  if (!b) return;
  const L = b.lot;
  const bl = onlyTop ? b.lot.blocks.slice(-1) : b.lot.blocks;
  for (const k of bl) boxLines((p) => L.xf(k.xf([p[0], p[1] - k.y0, p[2]]) as [number, number, number]), k.w, k.d, k.y0, k.y0 + k.h, mat);
}
function clearOverlay() {
  for (const o of [...overlay.children]) { overlay.remove(o); (o as THREE.LineSegments).geometry.dispose(); }
}

function refreshHover() {
  if (!world) return;
  clearOverlay();
  raycaster.setFromCamera(ndc, camera);
  hover = ndc.x < -2 ? null : world.pick(raycaster.ray);
  let tip = '';
  if (tool === 'build' && hover?.kind === 'ground') {
    const { spec, error, cost, snapped } = world.proposal(hover.point.x, hover.point.z, role, matMode);
    const L = world.site.makeLot(spec);
    const mat = error ? badMat : okMat;
    // footprint following the ground + a ghost ground floor
    const mg = (f: string) => (spec.flush?.includes(f) ? 0 : 0.7), seg: THREE.Vector3[] = [];
    const c = [[-spec.w / 2 - mg('L'), -spec.d / 2 - mg('K')], [spec.w / 2 + mg('R'), -spec.d / 2 - mg('K')], [spec.w / 2 + mg('R'), spec.d / 2 + mg('F')], [-spec.w / 2 - mg('L'), spec.d / 2 + mg('F')]];
    for (let i = 0; i < 4; i++) for (let k = 0; k < 8; k++) {
      const P = (t: number) => { const [x0, z0] = c[i], [x1, z1] = c[(i + 1) % 4]; const q = L.xf([x0 + (x1 - x0) * t, 0, z0 + (z1 - z0) * t]); q[1] = world.site.H(q[0], q[2]) + 0.15; return V(q); };
      seg.push(P(k / 8), P((k + 1) / 8));
    }
    lines(seg, mat);
    boxLines((p) => L.xf(p as [number, number, number]), spec.w, spec.d, L.top, L.top + 2.7, mat);
    const r0 = L.xf([-spec.w / 2, L.top + 2.7, 0]), r1 = L.xf([spec.w / 2, L.top + 2.7, 0]);
    const ridge = (p: number[]) => V([p[0], p[1] + 1.8, p[2]]);
    lines([ridge(r0), ridge(r1), ridge(r0), V(L.xf([-spec.w / 2, L.top + 2.7, -spec.d / 2])), ridge(r0), V(L.xf([-spec.w / 2, L.top + 2.7, spec.d / 2])),
      ridge(r1), V(L.xf([spec.w / 2, L.top + 2.7, -spec.d / 2])), ridge(r1), V(L.xf([spec.w / 2, L.top + 2.7, spec.d / 2]))], mat);
    tip = error ? `Can't build: ${error}` : world.specs.length ? `Found ${ROLES[spec.role].name.toLowerCase()}${snapped ? ' against its neighbour' : ''} — ${fmtCost(cost)}` : 'Found the keep (free)';
  } else if (hover?.kind === 'building') {
    const id = hover.id, b = world.built.get(id)!, s = world.spec(id)!;
    tip = world.label(id);
    if (tool === 'build') {
      const k = b.lot.blocks[b.lot.blocks.length - 1];
      if (shift) {
        buildingLines(id, s.blocks > 1 ? badMat : inkMat, true);
        tip += s.blocks > 1 ? ' · remove top floor' : ' · only the ground floor left';
      } else if (s.blocks < MAX_BLOCKS) {
        const plan = world.blockPlan(matMode);
        const after = world.previewStability(id, { blocks: s.blocks + 1, mats: s.mats.padEnd(s.blocks, '?') + plan.mat });
        const afford = world.econ.can(plan.cost);
        boxLines((p) => b.lot.xf(k.xf([p[0], p[1] - k.y0, p[2]]) as [number, number, number]), k.w, k.d, k.y0 + k.h, k.y0 + k.h + 2.7, afford && after >= 0.15 ? okMat : badMat);
        tip += ` · add ${plan.mat === 'S' ? 'stone' : 'timber'} floor: ${fmtCost(plan.cost)}${afford ? '' : ' (can\'t afford)'} → ${stabilityWord(after)} (${Math.round(after * 100)})`;
      } else tip += ' · as tall as it gets';
    } else if (tool === 'brace') {
      if (s.braces < MAX_BRACES) {
        const after = world.previewStability(id, { braces: s.braces + 1 });
        tip += ` · brace: ${fmtCost(COSTS.brace)} → ${stabilityWord(after)} (${Math.round(after * 100)})`;
        buildingLines(id, okMat, true);
      } else tip += ' · fully braced';
    } else if (tool === 'demolish') {
      buildingLines(id, badMat); tip += ' · demolish';
    } else if (tool === 'bridge') {
      buildingLines(id, inkMat, true);
      if (bridgeFrom !== null && bridgeFrom !== id) {
        const A = world.built.get(bridgeFrom)!.lot, P = bridgePoints(A, b.lot);
        if (P) { lines([V(P[0]), V(P[1])], okMat); tip += ` · connect: ${fmtCost(COSTS.bridge)}`; } else tip += ' · no shared height in reach';
      } else tip += bridgeFrom === null ? ' · start a bridge here' : '';
    }
  }
  if (tool === 'bridge' && bridgeFrom !== null) buildingLines(bridgeFrom, okMat, true);
  if (!tip || hover?.kind !== 'building') {
    const who = residents.nameAt(camera, mouse.x, mouse.y, window.innerWidth, window.innerHeight);
    if (who) tip = who + (tip ? ' · ' + tip : '');
  }
  tipEl.textContent = tip;
  tipEl.style.display = tip ? 'block' : 'none';
  tipEl.style.transform = `translate(${mouse.x + 16}px, ${mouse.y + 18}px)`;
}

function toast(msg: string) {
  const el = document.getElementById('toast')!;
  el.textContent = msg; el.classList.add('show');
  clearTimeout((el as unknown as { _t: number })._t);
  (el as unknown as { _t: number })._t = window.setTimeout(() => el.classList.remove('show'), 2200);
}

function act() {
  if (!hover || tool === 'look') return;
  let err: string | null = null;
  if (tool === 'build') {
    if (hover.kind === 'ground') err = world.found(hover.point.x, hover.point.z, role, matMode);
    else err = shift ? world.removeFloor(hover.id) : world.addFloor(hover.id, matMode);
  } else if (tool === 'brace' && hover.kind === 'building') { err = world.brace(hover.id);
  } else if (tool === 'demolish' && hover.kind === 'building') world.demolish(hover.id);
  else if (tool === 'bridge' && hover.kind === 'building') {
    if (bridgeFrom === null) bridgeFrom = hover.id;
    else if (bridgeFrom !== hover.id) { err = world.bridge(bridgeFrom, hover.id); bridgeFrom = null; }
  }
  if (err) toast(`Can't do that: ${err}`);
  refreshHover();
}

const canvas = renderer.domElement;
let down: { x: number; y: number } | null = null;
canvas.addEventListener('pointermove', (e) => {
  mouse = { x: e.clientX, y: e.clientY };
  ndc.set((e.clientX / window.innerWidth) * 2 - 1, -(e.clientY / window.innerHeight) * 2 + 1);
  shift = e.shiftKey;
  needsPick = true;
});
canvas.addEventListener('pointerleave', () => { ndc.set(-9, -9); needsPick = true; });
canvas.addEventListener('pointerdown', (e) => { if (e.button === 0) down = { x: e.clientX, y: e.clientY }; });
canvas.addEventListener('pointerup', (e) => {
  if (e.button === 0 && down && Math.hypot(e.clientX - down.x, e.clientY - down.y) < 6) { shift = e.shiftKey; act(); }
  down = null;
});
window.addEventListener('keydown', (e) => {
  if ((e.target as HTMLElement).tagName === 'INPUT') return;
  if (e.key === 'Shift') { shift = true; refreshHover(); }
  const tools: Tool[] = ['look', 'build', 'brace', 'bridge', 'demolish'];
  if (e.key >= '1' && e.key <= '5') setTool(tools[Number(e.key) - 1]);
  if (e.key === ' ') { e.preventDefault(); setSpeed(speed ? 0 : 1); }
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); if (!world.undo()) toast('Nothing to undo'); }
  if (e.key === 'Escape') { bridgeFrom = null; refreshHover(); document.body.classList.remove('show-help'); }
  if (e.key.toLowerCase() === 'f' && !e.ctrlKey && !e.metaKey) { topY = world.top; frame(); }
  if (e.key === '?' || e.key === 'h') document.body.classList.toggle('show-help');
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); saveTo(saveSlot()); }
});
window.addEventListener('keyup', (e) => { if (e.key === 'Shift') { shift = false; refreshHover(); } });
document.querySelectorAll<HTMLButtonElement>('#tools [data-tool]').forEach((b) => b.addEventListener('click', () => setTool(b.dataset.tool as Tool)));
document.getElementById('undo')!.addEventListener('click', () => { if (!world.undo()) toast('Nothing to undo'); });
// ---------------------------------------------------------------- HUD
const ICON: Record<string, string> = { wood: '🪵', stone: '🪨', tiles: '🧱', food: '🌾' };
function hud() {
  if (!world) return;
  const e = world.econ, c = e.census(world.econBuildings());
  const fmt = (v: number) => (v >= 0 ? '+' : '−') + Math.abs(v).toFixed(v % 1 && Math.abs(v) < 10 ? 1 : 0);
  document.getElementById('res')!.innerHTML = RES_KEYS.map((k) =>
    `<span class="r" title="${k}"><i>${ICON[k]}</i><b>${Math.floor(e.res[k])}</b><em class="${c.rates[k] < 0 ? 'neg' : ''}">${c.rates[k] ? fmt(c.rates[k]) : ''}</em></span>`).join('') +
    `<span class="r" title="residents / homes"><i>👥</i><b>${Math.floor(e.pop)}</b><em>/${c.housing}</em></span>` +
    `<span class="r" title="workers / jobs"><i>⚒</i><b>${c.workers}</b><em>/${c.jobs}</em></span>` +
    `<span class="r" title="tallest tower now / best ever on this site"><i>🏰</i><b>${world.tallest().toFixed(0)}m</b><em>/${Math.max(record, world.tallest()).toFixed(0)}</em></span>` +
    `<span class="r" title="happiness"><i>${e.happy >= 60 ? '☺' : e.happy >= 35 ? '😐' : '☹'}</i><b>${Math.round(e.happy)}</b></span>`;
  document.getElementById('day')!.textContent = `Day ${e.day}`;
  document.querySelectorAll<HTMLButtonElement>('#buildbar [data-role]').forEach((b) => {
    const r = b.dataset.role as Role, R = ROLES[r];
    if (LANDMARKS.includes(r)) {
      const why = world.landmarkBlocked(r);
      b.classList.toggle('locked', !!why);
      b.title = `${R.name} — ${R.verb}. ${R.perk}. Cost: ${fmtCost(R.found)}${why ? ` (${why})` : ''}`;
      if (!why && !unlocked.has(r)) { unlocked.add(r); if (world.specs.length) { toast(`New landmark available: ${R.name} — ${R.perk}`); sound.play('bell'); } }
    } else b.title = `${R.name} — ${R.verb}. Found: ${fmtCost(R.found)} + first floor`;
  });
}
const unlocked = new Set<Role>();
function primeUnlocks() { unlocked.clear(); for (const r of LANDMARKS) if (!world.landmarkBlocked(r)) unlocked.add(r); }
// tallest-tower record per site
const recordKey = () => `inkcity.record.${state.terrain}-${state.seed}`;
let record = 0;
function loadRecord() { try { record = Number(localStorage.getItem(recordKey()) ?? 0); } catch { record = 0; } }
function checkRecord() {
  const h = world.tallest();
  if (h > record + 0.5 && world.specs.length) {
    const first = record === 0;
    record = h;
    try { localStorage.setItem(recordKey(), String(h)); } catch { /* storage blocked */ }
    if (!first) { toast(`🏆 New height record: ${h.toFixed(0)} m!`); sound.play('bell'); }
  }
}
function setSpeed(v: number) {
  speed = v;
  document.querySelectorAll<HTMLButtonElement>('#clock [data-speed]').forEach((b) => b.classList.toggle('on', Number(b.dataset.speed) === v));
}
document.querySelectorAll<HTMLButtonElement>('#clock [data-speed]').forEach((b) => b.addEventListener('click', () => setSpeed(Number(b.dataset.speed))));
document.querySelectorAll<HTMLButtonElement>('#buildbar [data-role]').forEach((b) => b.addEventListener('click', () => {
  role = b.dataset.role as Role;
  document.querySelectorAll<HTMLButtonElement>('#buildbar [data-role]').forEach((x) => x.classList.toggle('on', x === b));
  refreshHover();
}));
document.querySelectorAll<HTMLButtonElement>('#buildbar [data-mat]').forEach((b) => b.addEventListener('click', () => {
  matMode = b.dataset.mat as MatMode;
  document.querySelectorAll<HTMLButtonElement>('#buildbar [data-mat]').forEach((x) => x.classList.toggle('on', x === b));
  refreshHover();
}));

// ---------------------------------------------------------------- save / load
interface SaveFile { v: 1; savedAt: string; state: Partial<typeof state>; world: SaveCore; dayClock: number; weather: Weather }
const KEY = (slot: string) => `inkcity.save.${slot}`;
const saveSlot = () => (document.getElementById('slot') as HTMLSelectElement).value;
function snapshotSave(): SaveFile {
  const { seed, height, count, lean, wonk, terrain, palette } = state;
  return { v: 1, savedAt: new Date().toISOString(), state: { seed, height, count, lean, wonk, terrain, palette }, world: world.serialize(), dayClock, weather: atmos.kind };
}
function saveTo(slot: string, quiet = false) {
  try {
    localStorage.setItem(KEY(slot), JSON.stringify(snapshotSave()));
    if (!quiet) toast(`Saved to ${slot === 'auto' ? 'autosave' : 'slot ' + slot}`);
    refreshSlots();
  } catch { if (!quiet) toast('Could not save (storage unavailable)'); }
}
function autosave() { if (world.specs.length) saveTo('auto', true); }
function applySave(s: SaveFile) {
  if (!s || s.v !== 1 || !s.world) { toast('That is not an Inkcity save'); return; }
  Object.assign(state, s.state);
  syncInputs();
  applyPalette(); applyInk();
  residents.clear();
  world.load(genParams(), s.world);
  dayClock = s.dayClock ?? 0;
  atmos.kind = s.weather ?? 'clear';
  topY = world.top; primeUnlocks(); siteUniforms(); frame(); hud(); stats(); syncUrl();
  toast(`Loaded — day ${world.econ.day}, ${world.specs.length} buildings`);
}
function loadFrom(slot: string) {
  let raw: string | null = null;
  try { raw = localStorage.getItem(KEY(slot)); } catch { /* storage blocked */ }
  if (!raw) { toast('That slot is empty'); return; }
  try { applySave(JSON.parse(raw)); } catch { toast('That save is damaged'); }
}
function refreshSlots() {
  const sel = document.getElementById('slot') as HTMLSelectElement;
  for (const o of Array.from(sel.options)) {
    let info = '';
    try { const raw = localStorage.getItem(KEY(o.value)); if (raw) { const s = JSON.parse(raw) as SaveFile; info = ` — day ${s.world.econ.day}, ${s.world.specs.length} bldg`; } } catch { /* ignore */ }
    o.textContent = (o.value === 'auto' ? 'Autosave' : `Slot ${o.value}`) + (info || ' (empty)');
  }
}
function syncInputs() {
  for (const [id, key] of [['seed', 'seed'], ['height', 'height'], ['count', 'count'], ['lean', 'lean'], ['wonk', 'wonk'], ['terrain', 'terrain'], ['palette', 'palette']] as const)
    (document.getElementById(id) as HTMLInputElement).value = String(state[key]);
}
document.getElementById('save')!.addEventListener('click', () => saveTo(saveSlot()));
document.getElementById('load')!.addEventListener('click', () => loadFrom(saveSlot()));
document.getElementById('export')!.addEventListener('click', () => {
  const blob = new Blob([JSON.stringify(snapshotSave(), null, 1)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `inkcity-day${world.econ.day}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
});
const importInput = document.getElementById('importfile') as HTMLInputElement;
document.getElementById('import')!.addEventListener('click', () => importInput.click());
importInput.addEventListener('change', async () => {
  const f = importInput.files?.[0];
  if (!f) return;
  try { applySave(JSON.parse(await f.text())); } catch { toast('Could not read that file'); }
  importInput.value = '';
});
(document.getElementById('cycle') as HTMLInputElement).checked = atmos.cycle;
document.getElementById('cycle')!.addEventListener('input', (e) => { atmos.cycle = (e.target as HTMLInputElement).checked; if (!atmos.cycle) atmos.tod = 0.3; });
(document.getElementById('weather') as HTMLSelectElement).value = atmos.weather;
document.getElementById('weather')!.addEventListener('input', (e) => { atmos.weather = (e.target as HTMLSelectElement).value as typeof atmos.weather; });
const muteBtn = document.getElementById('mute')!;
let muted = false;
try { muted = localStorage.getItem('inkcity.muted') === '1'; } catch { /* ignore */ }
const syncMute = () => { muteBtn.textContent = muted ? '🔇' : '🔊'; sound.setMuted(muted); };
muteBtn.addEventListener('click', () => { muted = !muted; try { localStorage.setItem('inkcity.muted', muted ? '1' : '0'); } catch { /* ignore */ } sound.start(); syncMute(); });
syncMute();
const unlock = () => { sound.start(); window.removeEventListener('pointerdown', unlock); window.removeEventListener('keydown', unlock); };
window.addEventListener('pointerdown', unlock);
window.addEventListener('keydown', unlock);
document.getElementById('frame')!.addEventListener('click', () => { topY = world.top; frame(); });
document.getElementById('helpbtn')!.addEventListener('click', () => document.body.classList.toggle('show-help'));
document.getElementById('help')!.addEventListener('click', () => document.body.classList.remove('show-help'));

function applyInk() { const p = PALETTES[state.palette]; inkMat.color.setRGB(...p.ink); }

const sel = document.getElementById('palette') as HTMLSelectElement;
PALETTES.forEach((p, i) => sel.add(new Option(p.name, String(i))));
ui();
applyPalette();
applyInk();
setTool('build');
setSpeed(1);
refreshSlots();
if (params.get('load')) loadFrom(params.get('load')!);
resize();
regenerate(true);
requestAnimationFrame(render);
Object.assign(window as object, { __ready: () => frameCount, __world: () => world, __setTool: setTool, __camera: camera, __controls: controls, __atmos: atmos, __save: saveTo, __load: loadFrom, __sound: sound, __residents: residents });
