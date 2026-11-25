import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { generate, GenParams, Terrain } from './tower';
import { PALETTES } from './palettes';
import { gbufFrag, gbufVert, postFrag, postVert } from './shaders';

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
    uPal: { value: Array.from({ length: 16 }, () => new THREE.Vector3()) },
    uShade: { value: new THREE.Vector3() }, uLight: { value: new THREE.Vector3() }, uFrame: { value: new THREE.Vector3() },
    uSun: { value: new THREE.Vector3() }, uCam: { value: new THREE.Vector3() }, uFar: { value: 600 },
    uShadow: { value: shadowRT.depthTexture }, uLightVP: { value: new THREE.Matrix4() },
    uHatch: { value: 1 }, uDetail: { value: 1 }, uNight: { value: 0 },
    uFade: { value: new THREE.Vector2(9, 16) }, uSea: { value: 0 },
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
    },
  }),
);
post.frustumCulled = false;
const postScene = new THREE.Scene();
postScene.add(post);
const postCam = new THREE.Camera();

// ---------------------------------------------------------------- content
let mesh: THREE.Mesh | null = null;
let topY = 20, extent = 20;
function regenerate(resetCam = false) {
  const p: GenParams = { seed: state.seed, height: state.height, lean: state.lean, wonk: state.wonk, terrain: state.terrain, count: state.count };
  const t0 = performance.now();
  const res = generate(p);
  if (mesh) { mesh.geometry.dispose(); scene.remove(mesh); }
  mesh = new THREE.Mesh(res.geo, gmat);
  scene.add(mesh);
  topY = res.top; extent = res.extent;
  const u = gmat.uniforms;
  if (state.terrain === 'island') u.uFade.value.set(extent * 1.1, extent * 1.8);
  else u.uFade.value.set(extent * 0.7, extent * 1.1);
  const S = extent * 1.5 + topY * 0.3;
  Object.assign(lightCam, { left: -S, right: S, top: S, bottom: -S, far: 400 });
  lightCam.updateProjectionMatrix();
  u.uSea.value = state.terrain === 'island' ? 1 : 0;
  if (resetCam) frame();
  const tris = res.geo.attributes.position.count / 3;
  (document.getElementById('stats') as HTMLElement).textContent = `${res.buildings} buildings · ${tris.toLocaleString()} tris · ${(performance.now() - t0).toFixed(0)} ms`;
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
function render(time: number) {
  controls.update();
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
      if (key === 'palette') applyPalette();
      if (regen) regenerate(key === 'height' || key === 'count' || key === 'terrain');
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
    regenerate(true); syncUrl();
  });
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

const sel = document.getElementById('palette') as HTMLSelectElement;
PALETTES.forEach((p, i) => sel.add(new Option(p.name, String(i))));
ui();
applyPalette();
resize();
regenerate(true);
requestAnimationFrame(render);
(window as unknown as { __ready: () => number }).__ready = () => frameCount;
