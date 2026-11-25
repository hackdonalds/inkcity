import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import * as SkeletonUtils from 'three/examples/jsm/utils/SkeletonUtils.js';
import { charFrag, charVert } from './shaders';
import type { World } from './world';
import { bridgePoints } from './tower';

/**
 * Animated townsfolk. Models + animations: KayKit Adventurers (CC0, Kay Lousberg),
 * weapons stripped, sharing one rig so a single clip file drives everyone.
 */
const MODELS = ['Rogue_Hooded', 'Rogue', 'Mage', 'Barbarian', 'Knight'];
const FIRST = ['Maren', 'Tobin', 'Ilse', 'Corwin', 'Aldo', 'Petra', 'Wim', 'Odile', 'Hesper', 'Brann', 'Lotte', 'Ewan', 'Fenna', 'Jory', 'Mabel',
  'Quill', 'Rosamund', 'Silas', 'Tamsin', 'Ulric', 'Vesna', 'Wendel', 'Yara', 'Bertil', 'Agnes', 'Cosmo', 'Dagny', 'Elric', 'Greta', 'Hob'];
const IDLES = ['Idle', 'Interact', 'Cheer', 'PickUp', 'Use_Item', 'Unarmed_Idle'];
const WALKS = ['Walking_A', 'Walking_B', 'Walking_C'];
const SCALE = 0.72;

type V3 = [number, number, number];
interface Agent {
  root: THREE.Object3D; mixer: THREE.AnimationMixer; action: THREE.AnimationAction | null; anim: string;
  name: string; walk: string; speed: number;
  route: V3[]; seg: number; segT: number; at: number; // current lot index (or -1 on a bridge)
  wait: number; leaving: boolean; heading: number; bridge: [V3, V3] | null; bt: number; bdir: number;
}

export class Residents {
  group = new THREE.Group();
  private proto: THREE.Object3D[] = [];
  private clips = new Map<string, THREE.AnimationClip>();
  private agents: Agent[] = [];
  private navVersion = -1;
  private adj: { to: number; pts: V3[] }[][] = [];
  private nameIx = 0;
  ready = false;

  constructor(private shared: Record<string, THREE.IUniform>) {}

  async load(base = './characters/') {
    const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
    const [anim, ...models] = await Promise.all([loader.loadAsync(base + 'anims.glb'), ...MODELS.map((m) => loader.loadAsync(base + m + '.glb'))]);
    for (const c of anim.animations) this.clips.set(c.name, c);
    this.proto = models.map((g) => g.scene);
    this.ready = true;
  }

  private material(src: THREE.MeshStandardMaterial, id: number, tint: THREE.Color) {
    const map = src.map!;
    map.colorSpace = THREE.NoColorSpace; // sample raw sRGB like the rest of the pipeline
    map.updateMatrix();
    return new THREE.RawShaderMaterial({
      glslVersion: THREE.GLSL3, vertexShader: charVert, fragmentShader: charFrag,
      uniforms: { ...this.shared, uMap: { value: map }, uUvT: { value: map.matrix.clone() }, uId: { value: id }, uTint: { value: tint } },
    });
  }

  private spawn(world: World, at: number): Agent {
    const k = Math.floor(Math.random() * this.proto.length);
    const root = SkeletonUtils.clone(this.proto[k]);
    root.scale.setScalar(SCALE);
    const tint = new THREE.Color().setHSL(Math.random(), 0.25, 0.5).lerp(new THREE.Color(1, 1, 1), 0.78);
    let part = 0;
    const idBase = 500_000_000 + Math.floor(Math.random() * 1e7) * 16;
    root.traverse((o) => {
      const m = o as THREE.SkinnedMesh;
      if (m.isMesh) { m.material = this.material(m.material as THREE.MeshStandardMaterial, idBase + part++, tint); m.frustumCulled = false; }
    });
    const mixer = new THREE.AnimationMixer(root);
    const name = FIRST[this.nameIx++ % FIRST.length];
    const a: Agent = {
      root, mixer, action: null, anim: '', name, walk: WALKS[Math.floor(Math.random() * WALKS.length)], speed: 1.0 + Math.random() * 0.35,
      route: [], seg: 0, segT: 0, at, wait: Math.random() * 3, leaving: false, heading: Math.random() * 6.28, bridge: null, bt: 0, bdir: 1,
    };
    const L = world.navLots[at];
    if (L) root.position.set(L.front[0], L.front[1] + 0.05, L.front[2]);
    this.play(a, 'Idle');
    this.group.add(root);
    return a;
  }

  private play(a: Agent, name: string, fade = 0.3) {
    if (a.anim === name) return;
    const clip = this.clips.get(name) ?? this.clips.get('Idle');
    if (!clip) return;
    const next = a.mixer.clipAction(clip);
    next.reset().setEffectiveWeight(1).fadeIn(fade).play();
    if (a.action) a.action.fadeOut(fade);
    a.action = next; a.anim = name;
  }

  private rebuildGraph(world: World) {
    this.adj = world.navLots.map(() => []);
    for (const e of world.nav) {
      if (!this.adj[e.a] || !this.adj[e.b]) continue;
      this.adj[e.a].push({ to: e.b, pts: e.pts });
      this.adj[e.b].push({ to: e.a, pts: [...e.pts].reverse() });
    }
    this.navVersion = world.navVersion;
    // anyone standing at a lot that vanished goes somewhere valid
    for (const a of this.agents) if (!a.bridge && (a.at >= world.navLots.length || a.at < 0)) { a.at = 0; a.route = []; }
  }

  private routeTo(from: number, to: number): V3[] | null {
    const prev = new Map<number, { p: number; pts: V3[] }>();
    const q = [from]; prev.set(from, { p: -1, pts: [] });
    while (q.length) {
      const n = q.shift()!;
      if (n === to) break;
      for (const e of this.adj[n] ?? []) if (!prev.has(e.to)) { prev.set(e.to, { p: n, pts: e.pts }); q.push(e.to); }
    }
    if (!prev.has(to)) return null;
    const legs: V3[][] = [];
    for (let n = to; n !== from; n = prev.get(n)!.p) legs.unshift(prev.get(n)!.pts);
    return legs.flat();
  }

  /** How many people should be out and about. */
  target(world: World, night: number, rain: number) {
    return Math.round(Math.min(26, world.econ.pop * 0.7) * (1 - 0.65 * night) * (1 - 0.5 * rain));
  }

  update(dt: number, world: World, night: number, rain: number) {
    if (!this.ready) return;
    if (this.navVersion !== world.navVersion) this.rebuildGraph(world);
    const lots = world.navLots;
    const want = lots.length ? this.target(world, night, rain) : 0;
    const walkers = this.agents.filter((a) => !a.bridge);
    if (walkers.length < want && Math.random() < dt * 2) this.agents.push(this.spawn(world, Math.floor(Math.random() * lots.length)));
    if (walkers.length > want) { const a = walkers.find((x) => !x.leaving); if (a) a.leaving = true; }

    // one loiterer per bridge
    const decks = world.bridges.map(([x, y]) => {
      const A = world.built.get(x)?.lot, B = world.built.get(y)?.lot;
      return A && B ? bridgePoints(A, B) : null;
    }).filter((d): d is [V3, V3] => !!d);
    const onBridges = this.agents.filter((a) => a.bridge);
    if (onBridges.length < Math.min(decks.length, Math.ceil(want / 3))) {
      const a = this.spawn(world, -1);
      a.bridge = decks[onBridges.length % decks.length]; a.bt = 0.2 + Math.random() * 0.6; a.wait = 1 + Math.random() * 4;
      this.agents.push(a);
    }
    for (const a of onBridges) if (!decks.some((d) => d[0][0] === a.bridge![0][0] && d[1][2] === a.bridge![1][2]) || onBridges.length > decks.length) a.leaving = true;

    const speedMul = rain > 0.5 ? 1.5 : 1;
    for (const a of [...this.agents]) {
      a.mixer.update(dt);
      if (a.bridge) { this.updateBridge(a, dt); continue; }
      if (a.route.length > 1 && a.seg < a.route.length - 1) {
        // walk
        this.play(a, rain > 0.5 ? 'Running_A' : a.walk);
        let move = dt * a.speed * speedMul * (rain > 0.5 ? 1.6 : 1);
        while (move > 0 && a.seg < a.route.length - 1) {
          const p0 = a.route[a.seg], p1 = a.route[a.seg + 1];
          const len = Math.hypot(p1[0] - p0[0], p1[2] - p0[2]) || 1e-3;
          const left = (1 - a.segT) * len;
          if (move < left) { a.segT += move / len; move = 0; } else { move -= left; a.seg++; a.segT = 0; }
        }
        const i = Math.min(a.seg, a.route.length - 2);
        const p0 = a.route[i], p1 = a.route[i + 1], t = a.seg >= a.route.length - 1 ? 1 : a.segT;
        a.root.position.set(p0[0] + (p1[0] - p0[0]) * t, p0[1] + (p1[1] - p0[1]) * t + 0.02, p0[2] + (p1[2] - p0[2]) * t);
        const want2 = Math.atan2(p1[0] - p0[0], p1[2] - p0[2]);
        let d = want2 - a.heading; d = Math.atan2(Math.sin(d), Math.cos(d));
        a.heading += d * Math.min(1, dt * 8);
        a.root.rotation.y = a.heading;
        if (a.seg >= a.route.length - 1) { a.route = []; a.wait = 2 + Math.random() * 5; this.play(a, IDLES[Math.floor(Math.random() * IDLES.length)]); }
        continue;
      }
      // at a door
      a.wait -= dt;
      if (a.wait > 0) continue;
      if (a.leaving) { this.remove(a); continue; } // goes inside
      if (lots.length < 2) { a.wait = 3; continue; }
      let dest = a.at;
      while (dest === a.at) dest = Math.floor(Math.random() * lots.length);
      const r = this.routeTo(a.at, dest);
      if (!r || r.length < 2) { a.wait = 2; continue; }
      a.route = r; a.seg = 0; a.segT = 0; a.at = dest;
    }
  }

  private updateBridge(a: Agent, dt: number) {
    const [p, q] = a.bridge!;
    if (a.wait > 0) {
      a.wait -= dt;
      if (a.anim.startsWith('Walk')) this.play(a, Math.random() < 0.5 ? 'Idle' : 'Cheer');
      if (a.wait <= 0) {
        if (a.leaving) { this.remove(a); return; }
        a.bdir = Math.random() < 0.5 ? 1 : -1;
      }
    } else {
      this.play(a, a.walk);
      const L = Math.hypot(q[0] - p[0], q[2] - p[2]) || 1;
      a.bt += (a.bdir * dt * a.speed * 0.8) / L;
      if (a.bt < 0.15 || a.bt > 0.85 || Math.random() < dt * 0.15) { a.bt = Math.min(0.85, Math.max(0.15, a.bt)); a.wait = 2 + Math.random() * 5; }
    }
    a.root.position.set(p[0] + (q[0] - p[0]) * a.bt, p[1] + (q[1] - p[1]) * a.bt + 0.1, p[2] + (q[2] - p[2]) * a.bt);
    const along = Math.atan2(q[0] - p[0], q[2] - p[2]);
    const want = a.wait > 0 ? along + Math.PI / 2 : along + (a.bdir < 0 ? Math.PI : 0);
    let d = want - a.heading; d = Math.atan2(Math.sin(d), Math.cos(d));
    a.heading += d * Math.min(1, dt * 5);
    a.root.rotation.y = a.heading;
  }

  private remove(a: Agent) {
    this.group.remove(a.root);
    a.mixer.stopAllAction();
    a.root.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh) (m.material as THREE.Material).dispose(); });
    this.agents.splice(this.agents.indexOf(a), 1);
  }

  clear() { for (const a of [...this.agents]) this.remove(a); }

  /** Nearest resident to a screen point (for tooltips). */
  nameAt(camera: THREE.Camera, x: number, y: number, w: number, h: number): string | null {
    let best: string | null = null, bd = 22;
    const v = new THREE.Vector3();
    for (const a of this.agents) {
      v.copy(a.root.position); v.y += 1.0; v.project(camera);
      const d = Math.hypot((v.x * 0.5 + 0.5) * w - x, (-v.y * 0.5 + 0.5) * h - y);
      if (d < bd && v.z < 1) { bd = d; best = a.name; }
    }
    return best;
  }
  get count() { return this.agents.length; }
  names() { return this.agents.filter((a) => !a.leaving).map((a) => a.name); }
  positionOf(name: string) { return this.agents.find((a) => a.name === name)?.root.position ?? null; }
}
