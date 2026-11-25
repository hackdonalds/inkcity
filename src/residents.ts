import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { charFrag, charVert } from './shaders';
import { CitizenKit, Look, Slot, skinTone } from './citizens';
import { PropKind, makeBall, makeBird, makeEasel, makeFish, makeFloat, makeLine, makeProp } from './props';
import { NavGrid } from './nav';
import { Fixtures } from './fixtures';
import { M } from './builder';
import { Q } from './quality';
import type { World } from './world';
import type { Role } from './economy';
import type { Leaf, Spot } from './tower';

/**
 * Townsfolk. Every citizen is assembled from mixed KayKit Adventurers parts (CC0, Kay Lousberg),
 * recoloured and reproportioned so no two look alike, and lives a little daily routine: work with
 * tools, carry goods, sweep, play music, sit, drink, chat while strolling, read under a tree, paint at
 * an easel, fish off the shore, feed the birds, draw water, gossip over a fence, play games.
 * They walk on a navigation grid (nav.ts) around buildings, trees and each other, and swing doors
 * open as they come and go (fixtures.ts).
 */
const MODELS = ['Rogue_Hooded', 'Rogue', 'Mage', 'Barbarian', 'Knight'];
const FIRST = ['Maren', 'Tobin', 'Ilse', 'Corwin', 'Aldo', 'Petra', 'Wim', 'Odile', 'Hesper', 'Brann', 'Lotte', 'Ewan', 'Fenna', 'Jory', 'Mabel',
  'Quill', 'Rosamund', 'Silas', 'Tamsin', 'Ulric', 'Vesna', 'Wendel', 'Yara', 'Bertil', 'Agnes', 'Cosmo', 'Dagny', 'Elric', 'Greta', 'Hob',
  'Ingrid', 'Jasper', 'Kestrel', 'Linnea', 'Mungo', 'Nell', 'Osric', 'Pim', 'Rhosyn', 'Sabine', 'Teodor', 'Una', 'Vid', 'Wren', 'Ysolde'];
const TRADE: Partial<Record<Role, string>> = { wood: 'woodcutter', quarry: 'stonecutter', farm: 'farmer', kiln: 'tiler', market: 'trader', inn: 'innkeeper', windmill: 'miller', lighthouse: 'keeper', pier: 'fisherman' };
const SCALE = 0.72;
const UPPER = /^(chest|upperarm|lowerarm|wrist|hand|head|elbowIK|handIK)/;
/** bones nudged after the mixer (reset to rest first, since rest-pose tracks are stripped from the clips) */
const TOUCHED = ['spine', 'head', 'lowerarmr', 'wristr', 'lowerarml'];
const SEP = 1.0; // personal space while walking

type V3 = [number, number, number];
/** An animation: a full clip, or an upper-body clip over a lower-body clip. */
interface AnimSpec { full?: string; up?: string; low?: string; speed?: number }
const A = {
  walk: (c: Cit): AnimSpec => ({ full: c.walk, speed: c.look.elder ? 0.8 : 1 }),
  run: { full: 'Running_A' }, runKid: { full: 'Running_B' },
  idle: { full: 'Idle' }, idle2: { full: 'Unarmed_Idle' }, idleA: { full: 'Idle_A' }, idleB: { full: 'Idle_B' },
  chop: { full: 'Chopping' }, pickaxe: { full: 'Pickaxing' }, hammer: { full: 'Hammering' }, dig: { full: 'Digging' }, saw: { full: 'Sawing' },
  hoe: { full: '2H_Melee_Attack_Chop', speed: 0.6 }, work: { full: 'Working_A' }, workB: { full: 'Working_B' }, workC: { full: 'Working_C' },
  tinker: { up: 'Use_Item', low: 'Idle' }, interact: { full: 'Interact' }, pickup: { full: 'PickUp' },
  carry: { up: 'Holding_C', low: 'Walking_A' }, carryStand: { up: 'Holding_C', low: 'Idle' }, carryOne: { up: 'Holding_A', low: 'Walking_B' },
  sweep: { up: '2H_Melee_Attack_Slice', low: 'Idle', speed: 0.55 },
  talk: { up: 'Spellcasting', low: 'Idle', speed: 0.7 }, walkTalk: { up: 'Spellcasting', low: 'Walking_B', speed: 0.8 },
  lute: { up: '2H_Ranged_Aiming', low: 'Sit_Floor_Idle' }, luteStand: { up: '2H_Ranged_Aiming', low: 'Idle' },
  sit: { full: 'Sit_Chair_Idle' }, sitFloor: { full: 'Sit_Floor_Idle' }, lie: { full: 'Lie_Idle' },
  sitDown: { full: 'Sit_Floor_Down' }, sitUp: { full: 'Sit_Floor_StandUp' }, chairDown: { full: 'Sit_Chair_Down' }, chairUp: { full: 'Sit_Chair_StandUp' },
  read: { up: 'Holding_C', low: 'Sit_Floor_Idle' }, readChair: { up: 'Holding_C', low: 'Sit_Chair_Idle' },
  write: { up: 'Holding_C', low: 'Sit_Floor_Idle' }, writeChair: { up: 'Holding_C', low: 'Sit_Chair_Idle' },
  paint: { up: 'Use_Item', low: 'Idle', speed: 0.45 }, admire: { full: 'Idle_B' },
  fishCast: { full: 'Fishing_Cast' }, fishIdle: { full: 'Fishing_Idle' }, fishBite: { full: 'Fishing_Bite' }, fishReel: { full: 'Fishing_Reeling' }, fishCatch: { full: 'Fishing_Catch' },
  pour: { up: 'Working_C', low: 'Idle', speed: 0.6 }, crouch: { full: 'Crouching', speed: 0.5 }, wave: { full: 'Waving' },
  drink: { up: 'Use_Item', low: 'Sit_Chair_Idle', speed: 0.6 }, cheer: { full: 'Cheer' }, dance: { up: 'Cheering', low: 'Jump_Idle' },
  jump: { full: 'Jump_Full_Short' }, throw: { full: 'Throw', speed: 0.9 }, catch: { up: 'Block', low: 'Idle' },
} satisfies Record<string, AnimSpec | ((c: Cit) => AnimSpec)>;

type Fx = 'strum' | 'talk' | 'ball' | 'scribble' | 'brush';
type Task =
  | { k: 'go'; to: V3; pts?: V3[]; seg: number; anim: AnimSpec; speed: number; label: string; through?: boolean; best: number; stuck: number; replans: number; bestSeg?: number }
  | { k: 'do'; anim: AnimSpec; time: number; look?: V3; label: string; fx?: Fx; at?: V3; tick?: (c: Cit, dt: number, t: DoTask) => void; t0?: number; dur?: number }
  | { k: 'follow'; leader: Cit; anim: AnimSpec; side: number; lag: number; label: string }
  | { k: 'prop'; kind: PropKind | null; left?: PropKind | null }
  | { k: 'door'; leaf: Leaf; secs: number }
  | { k: 'run'; fn: (c: Cit) => void }
  | { k: 'gone' };
type DoTask = Extract<Task, { k: 'do' }>;

interface Cit {
  id: number; name: string; look: Look; root: THREE.Object3D; bones: Record<string, THREE.Bone>; mixer: THREE.AnimationMixer;
  actions: THREE.AnimationAction[]; animKey: string; walk: string; speed: number;
  home: number; work: number; at: number; pos: THREE.Vector3; heading: number;
  tasks: Task[]; label: string; prop: THREE.Mesh | null; prop2: THREE.Mesh | null; fx?: Fx; partner?: Cit; spotKey?: string; mats: THREE.Material[];
  rest: Map<THREE.Bone, THREE.Quaternion>; trail: number[]; moving: boolean; cleanup: (() => void)[]; doing?: string;
}

/** Something to do somewhere: an activity spot a citizen can claim. */
interface Offer { p: V3; look: V3; kind: string; seat?: 'floor' | 'chair' }

export class Residents {
  group = new THREE.Group();
  nav = new NavGrid();
  fixtures: Fixtures;
  private kit!: CitizenKit;
  private clips = new Map<string, THREE.AnimationClip>();
  private cits: Cit[] = [];
  private navVersion = -1;
  private nid = 1;
  private taken = new Map<string, Cit>(); // spot occupancy, keyed by position
  private bad = new Set<string>(); // targets that turned out unreachable
  private sigs = new Set<string>();
  private balls: { a: Cit; b: Cit; mesh: THREE.Mesh; t0: number }[] = [];
  private flocks: { birds: { m: THREE.Mesh; x: number; z: number; y: number; ph: number }[]; leave: number }[] = [];
  private temps: [number, number, number][] = [];
  private propMat: THREE.Material | null = null;
  private clock = 0;
  ready = false;

  constructor(private shared: Record<string, THREE.IUniform>) {
    this.fixtures = new Fixtures(() => this.propMat, (m) => this.neutral(m));
    this.group.add(this.fixtures.group);
  }

  /** The building material is needed for props/balls (they go through the same G-buffer). */
  setPropMaterial(m: THREE.Material) { this.propMat = m; }

  async load(base = './characters/') {
    const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
    const [anim, ...models] = await Promise.all([loader.loadAsync(base + 'anims.glb'), ...MODELS.map((m) => loader.loadAsync(base + m + '.glb'))]);
    for (const c of anim.animations) {
      this.clips.set(c.name, c);
      this.clips.set(c.name + ':up', new THREE.AnimationClip(c.name + ':up', c.duration, c.tracks.filter((t) => UPPER.test(t.name))));
      this.clips.set(c.name + ':low', new THREE.AnimationClip(c.name + ':low', c.duration, c.tracks.filter((t) => !UPPER.test(t.name))));
    }
    this.kit = new CitizenKit(models.map((g) => g.scene));
    this.ready = true;
  }

  // ------------------------------------------------------------ making people
  private spawn(world: World, home: number, kid: boolean): Cit {
    const rnd = Math.random;
    const look = this.kit.look(rnd, this.sigs, kid);
    this.sigs.add(look.sig);
    const id = this.nid++;
    const mats: THREE.Material[] = [];
    const skin = skinTone(look.skin);
    let part = 0;
    const idBase = 500_000_000 + id * 64;
    const { root, bones } = this.kit.build(look, (src, slot: Slot, skinned) => {
      const map = (src.material as THREE.MeshStandardMaterial).map!;
      map.colorSpace = THREE.NoColorSpace; map.updateMatrix();
      const m = new THREE.RawShaderMaterial({
        glslVersion: THREE.GLSL3, vertexShader: charVert, fragmentShader: charFrag, defines: skinned ? { SKINNED: 1 } : {},
        uniforms: { ...this.shared, uMap: { value: map }, uUvT: { value: map.matrix.clone() }, uId: { value: idBase + part++ },
          uRecol: { value: new THREE.Vector4(...look.recol[slot]) }, uSkin: { value: skin } },
      });
      mats.push(m);
      return m;
    });
    root.scale.set(SCALE * look.height * look.build, SCALE * look.height, SCALE * look.height * look.build);
    const name = FIRST[(id - 1) % FIRST.length] + ((id - 1) >= FIRST.length ? ` ${String.fromCharCode(65 + Math.floor((id - 1) / FIRST.length) % 26)}.` : '');
    const rest = new Map<THREE.Bone, THREE.Quaternion>();
    for (const n of TOUCHED) if (bones[n]) rest.set(bones[n], bones[n].quaternion.clone());
    const c: Cit = {
      id, name, look, root, bones, mixer: new THREE.AnimationMixer(root), actions: [], animKey: '', mats, rest, trail: [], moving: false, cleanup: [],
      walk: kid ? 'Walking_C' : ['Walking_A', 'Walking_B', 'Walking_C'][Math.floor(rnd() * 3)], speed: (kid ? 1.25 : look.elder ? 0.8 : 1.0) + rnd() * 0.25,
      home, work: -1, at: home, pos: new THREE.Vector3(), heading: rnd() * 6.28, tasks: [], label: 'stepping out', prop: null, prop2: null,
    };
    const d = this.nav.doors[home];
    const front = world.navLots[home]?.front as V3 | undefined;
    if (d) {
      c.pos.set(...d.inside);
      c.heading = Math.atan2(d.out[0] - d.inside[0], d.out[2] - d.inside[2]);
      c.tasks.push({ k: 'door', leaf: d.leaf, secs: 2.6 }, { k: 'do', anim: A.idle, time: 0.5, label: 'stepping out' });
      this.go(c, d.out, A.walk(c), 'stepping out', { through: true });
    } else {
      if (front) c.pos.set(front[0], front[1], front[2]);
      c.tasks.push({ k: 'do', anim: A.interact, time: 1.2, label: 'stepping out' });
    }
    root.position.copy(c.pos);
    this.play(c, A.idle);
    this.group.add(root);
    this.cits.push(c);
    return c;
  }

  private remove(c: Cit) {
    this.group.remove(c.root);
    c.mixer.stopAllAction();
    for (const m of c.mats) m.dispose();
    this.sigs.delete(c.look.sig);
    if (c.spotKey) this.taken.delete(c.spotKey);
    this.finish(c);
    this.balls = this.balls.filter((b) => { if (b.a === c || b.b === c) { this.group.remove(b.mesh); return false; } return true; });
    for (const o of this.cits) if (o.partner === c) o.partner = undefined;
    this.cits.splice(this.cits.indexOf(c), 1);
  }

  /** Run (and forget) whatever an activity left in the world: easels, birds, fishing lines. */
  private finish(c: Cit) { for (const f of c.cleanup.splice(0)) f(); c.doing = undefined; }

  clear() { for (const c of [...this.cits]) this.remove(c); this.taken.clear(); this.fixtures.clear(); }

  // ------------------------------------------------------------ animation
  private play(c: Cit, spec: AnimSpec, fade = 0.3) {
    const key = JSON.stringify(spec);
    if (c.animKey === key) return;
    c.animKey = key;
    const want: THREE.AnimationAction[] = [];
    const add = (name: string) => {
      const clip = this.clips.get(name) ?? this.clips.get('Idle')!;
      const a = c.mixer.clipAction(clip);
      a.setEffectiveTimeScale(spec.speed ?? 1);
      if (!c.actions.includes(a)) a.reset().fadeIn(fade).play(); else a.setEffectiveWeight(1);
      want.push(a);
    };
    if (spec.full) add(spec.full); else { add(spec.up + ':up'); add(spec.low + ':low'); }
    for (const a of c.actions) if (!want.includes(a)) a.fadeOut(fade);
    c.actions = want;
  }

  /** Props share the building material; give them neutral per-object uniforms. */
  neutral(mesh: THREE.Mesh) {
    mesh.onBeforeRender = () => {
      const m = this.propMat as THREE.RawShaderMaterial | null;
      if (!m) return;
      const u = m.uniforms;
      u.uReveal.value = 1e6; u.uSketch.value = 1e6; u.uClip.value = -1e6;
      u.uIvy.value.set(0, 0); u.uSway.value.set(0, 0, 0, 0);
      m.uniformsNeedUpdate = true;
    };
    return mesh;
  }

  private setProp(c: Cit, kind: PropKind | null, left: PropKind | null = null) {
    for (const p of [c.prop, c.prop2]) p?.removeFromParent();
    c.prop = c.prop2 = null;
    if (!this.propMat) return;
    const hand = c.bones['handslotr'] ?? c.bones['handslot.r'], handL = c.bones['handslotl'] ?? c.bones['handslot.l'];
    if (kind && hand) {
      c.prop = this.neutral(makeProp(kind, this.propMat));
      if (kind === 'crate' || kind === 'sack' || kind === 'basket') {
        // held in front of the chest by both arms — ride on the body, not one hand
        c.prop.rotation.set(0, 0, 0);
        c.prop.position.set(0, kind === 'sack' ? 1.05 : 1.15, 0.62);
        c.root.add(c.prop);
      } else hand.add(c.prop);
    }
    if (left === 'notebook' || left === 'sketchbook') { // open on the lap, pages tilted up to the face
      c.prop2 = this.neutral(makeProp(left, this.propMat));
      c.prop2.position.set(0.05, 0.62, 0.5); c.prop2.rotation.set(-0.55, 0, 0);
      c.root.add(c.prop2);
    } else if (left && handL) { c.prop2 = this.neutral(makeProp(left, this.propMat, true)); handL.add(c.prop2); }
  }

  // ------------------------------------------------------------ navigation
  private rebuildNav(world: World) {
    this.bad.clear();
    this.nav.build(world);
    for (const [x, z, r] of this.temps) this.nav.addTemp(x, z, r, true);
    this.navVersion = world.navVersion;
    const n = world.navLots.length;
    for (const c of [...this.cits]) {
      if (n === 0) { this.remove(c); continue; }
      if (c.home >= n || c.at >= n || c.work >= n) {
        c.home = Math.min(c.home, n - 1); c.at = Math.max(0, Math.min(c.at, n - 1)); c.work = c.work >= n ? -1 : c.work;
        this.drop(c);
      }
      for (const t of c.tasks) if (t.k === 'go') t.pts = undefined; // replan on the new grid
      // doors may have moved: forget door tasks that point at old leaves
      c.tasks = c.tasks.filter((t) => t.k !== 'door');
    }
    this.taken.clear();
    for (const c of this.cits) if (c.spotKey) this.taken.set(c.spotKey, c);
  }

  /** Drop everything a citizen planned (and what they had set up). */
  private drop(c: Cit) {
    c.tasks = []; this.release(c); this.finish(c); this.setProp(c, null);
    if (c.partner?.partner === c) c.partner.partner = undefined;
    c.partner = undefined;
  }

  private lotPos(world: World, lot: number): V3 | null {
    const d = this.nav.doors[lot];
    if (d) return d.out;
    return (world.navLots[lot]?.front as V3) ?? null;
  }

  /** Where the citizen will be once the tasks planned so far are done. */
  private planPos(c: Cit): V3 {
    for (let i = c.tasks.length - 1; i >= 0; i--) { const t = c.tasks[i]; if (t.k === 'go') return t.to; }
    return [c.pos.x, c.pos.y, c.pos.z];
  }
  private canReach(c: Cit, to: V3) { return this.nav.reachable(this.planPos(c), to); }

  /** Queue a walk (the route is worked out when it starts). */
  private go(c: Cit, to: V3, anim: AnimSpec, label: string, o: { speed?: number; through?: boolean } = {}) {
    c.tasks.push({ k: 'go', to: [to[0], to[1], to[2]], seg: 0, anim, speed: o.speed ?? c.speed, label, through: o.through, best: Infinity, stuck: 0, replans: 0 });
  }
  /** Walk to a place if it can be reached. */
  private goIf(c: Cit, to: V3, anim: AnimSpec, label: string, o: { speed?: number } = {}) {
    if (!this.canReach(c, to)) return false;
    this.go(c, to, anim, label, o);
    return true;
  }

  private nearestLot(world: World, p: V3) {
    let best = 0, bd = Infinity;
    world.navLots.forEach((L, i) => { const d = Math.hypot(L.front[0] - p[0], L.front[2] - p[2]); if (d < bd) { bd = d; best = i; } });
    return best;
  }

  private key(p: V3, kind = '') { return `${kind}:${p[0].toFixed(1)}:${p[2].toFixed(1)}`; }
  private claim(c: Cit, key: string) {
    const [, x, z] = key.split(':').map(Number);
    if (!this.free([x, 0, z], 0.9, c)) return false;
    if (c.spotKey && c.spotKey !== key) this.taken.delete(c.spotKey);
    this.taken.set(key, c); c.spotKey = key; return true;
  }
  private release(c: Cit) { if (c.spotKey) { if (this.taken.get(c.spotKey) === c) this.taken.delete(c.spotKey); c.spotKey = undefined; } }
  /** Nobody has claimed a spot within r of here (spots are claimed by position). */
  private free(p: V3, r = 0.9, me?: Cit) {
    if (this.bad.has(this.key(p))) return false;
    for (const [k, o] of this.taken) { if (o === me) continue; const [, x, z] = k.split(':').map(Number); if (Math.hypot(x - p[0], z - p[2]) < r) return false; }
    return true;
  }
  /** A free walkable place a little way from p (to stand and set things down, chat…), off the doorstep. */
  private standNear(p: V3): V3 | null {
    for (let i = 0; i < 12; i++) {
      const a = Math.random() * 6.28, r = 1.2 + Math.random() * 1.6;
      const q: V3 = [p[0] + Math.sin(a) * r, 0, p[2] + Math.cos(a) * r];
      if (!this.nav.free(q[0], q[2]) || !this.free(q, 1.1) || this.byDoor(q, 1.2) || !this.nav.reachable(p, q)) continue;
      if (this.cits.some((o) => Math.hypot(o.pos.x - q[0], o.pos.z - q[2]) < 1)) continue;
      q[1] = this.nav.heightAt(q[0], q[2]);
      return q;
    }
    return null;
  }
  /** Open ground all round (so whoever stops here doesn't block a passage). */
  private roomy(p: V3, r = 1.5) {
    let n = 0, f = 0;
    for (let i = -r; i <= r; i += 0.5) for (let j = -r; j <= r; j += 0.5) { if (i * i + j * j > r * r) continue; n++; if (this.nav.free(p[0] + i, p[2] + j)) f++; }
    return f >= n * 0.85;
  }
  /** Too close to a doorway (where people come and go)? */
  private byDoor(p: V3, r = 1.6) { return this.nav.doors.some((d) => d && Math.hypot(d.out[0] - p[0], d.out[2] - p[2]) < r); }
  private pick<T>(arr: T[]): T | null { return arr.length ? arr[Math.floor(Math.random() * arr.length)] : null; }

  /** Someone nearby who is free, or only pottering about (they drop what they planned and come along). */
  private idleMate(c: Cit, pred: (o: Cit) => boolean, range = 14) {
    const easy = (o: Cit) => {
      if (o.partner || o.doing || o.prop || o.prop2) return false;
      const t = o.tasks[0];
      if (!t) return true;
      if (o.tasks.some((q) => q.k === 'gone' || q.k === 'follow' || q.k === 'run' || q.k === 'door')) return false;
      return (t.k === 'go' && !t.through) || (t.k === 'do' && !t.fx && !t.tick);
    };
    const o = this.cits.find((o) => o !== c && !o.look.kid === !c.look.kid && easy(o) && pred(o) && o.pos.distanceTo(c.pos) < range) ?? null;
    if (o) this.drop(o);
    return o;
  }

  // ------------------------------------------------------------ activity spots
  private ground(world: World, ...kinds: Spot['kind'][]) { return world.groundSpots.filter((s) => kinds.includes(s.kind)); }

  /** Places to sit with a book: benches and walls, tree trunks, viewpoints. */
  private seats(world: World): Offer[] {
    const out: Offer[] = [];
    for (const s of this.ground(world, 'bench')) out.push({ p: s.p, look: s.look, kind: 'bench', seat: 'chair' });
    for (const s of this.nav.seats) out.push({ p: s.p, look: s.look, kind: 'tree', seat: 'floor' });
    for (const s of this.ground(world, 'view')) out.push({ p: s.p, look: s.look, kind: 'view', seat: 'floor' });
    return out.filter((o) => this.free(o.p));
  }

  /** Water's edge: piers and shore spots from the landscape, else the shore found on the grid. */
  private shore(world: World): Offer[] {
    const g = this.ground(world, 'pier', 'shore').map((s) => ({ p: s.p, look: s.look, kind: s.kind as string }));
    const all = g.length >= 3 ? g : [...g, ...this.nav.shore.map((s) => ({ ...s, kind: 'shore' }))];
    return all.filter((o) => this.free(o.p));
  }

  // ------------------------------------------------------------ the day planner
  private plan(c: Cit, world: World, night: number, rain: number, tod: number, leaving: boolean) {
    const rnd = Math.random, kid = c.look.kid;
    if (leaving || (night > 0.6 && rnd() < 0.7) || (rain > 0.6 && rnd() < 0.6)) {
      if (this.goHome(c, world, rain > 0.6 ? 'hurrying home out of the rain' : 'heading home', rain > 0.6 ? A.run : A.walk(c))) return;
    }
    const day = night < 0.3, evening = tod > 0.55 && tod < 0.8, dry = rain < 0.3;
    const job = c.work >= 0 && world.navLots[c.work] ? world.specs[c.work]?.role : undefined;
    const W: [number, () => boolean][] = kid ? [
      [3, () => this.actPlay(c, world)],
      [day && dry ? 0.8 : 0, () => this.actBirds(c, world)],
      [0.5, () => this.actErrand(c, world)],
    ] : [
      [evening && world.lamps.length && !this.cits.some((o) => o.doing === 'lamps') ? 4 : 0, () => this.actLamps(c, world)],
      [job && job !== 'pier' && day ? 4.5 : 0, () => this.actWork(c, world, job!)],
      [job === 'pier' && (day || evening) && rain < 0.7 ? 5 : 0, () => this.actFish(c, world)], // fishermen work the pier
      [day ? 0.8 : 0, () => this.actSweep(c, world)],
      [1.0, () => this.actStroll(c, world)],
      [0.5, () => this.actMusic(c, world)],
      [night > 0.3 || evening ? 2 : 0.6, () => this.actInn(c, world)],
      [day && dry ? 0.6 : 0, () => this.actGrass(c, world)],
      [day && dry ? 1.6 : 0, () => this.actSeat(c, world)],
      [day && dry ? 0.9 : 0, () => this.actPaint(c, world)],
      [(day || evening) && rain < 0.5 ? 1.2 : 0, () => this.actFish(c, world)],
      [day && dry ? 0.5 : 0, () => this.actWater(c, world)],
      [day && dry ? 0.6 : 0, () => this.actBirds(c, world)],
      [day ? 0.9 : 0, () => this.actWell(c, world)],
      [day && dry ? 0.9 : 0, () => this.actFence(c, world)],
      [0.6, () => this.actErrand(c, world)],
    ];
    let pool = W.filter(([w]) => w > 0);
    while (pool.length) {
      const tot = pool.reduce((s, [w]) => s + w, 0);
      let r = rnd() * tot, k = 0;
      while (k < pool.length - 1 && (r -= pool[k][0]) > 0) k++;
      if (pool[k][1]()) return;
      pool = pool.filter((_, i) => i !== k);
    }
    c.tasks.push({ k: 'do', anim: A.idleA, time: 3, label: 'looking about' });
  }

  private goHome(c: Cit, world: World, label: string, anim: AnimSpec) {
    this.release(c);
    const d = this.nav.doors[c.home];
    if (d && this.goIf(c, d.out, anim, label)) {
      c.tasks.push({ k: 'do', anim: A.interact, time: 0.7, label: 'opening the door', look: d.inside }, { k: 'door', leaf: d.leaf, secs: 2.4 },
        { k: 'do', anim: A.idle, time: 0.35, label: 'going inside', look: d.inside });
      this.go(c, d.inside, A.walk(c), 'going inside', { through: true, speed: c.speed * 0.8 });
      c.tasks.push({ k: 'gone' });
      return true;
    }
    const f = world.navLots[c.home]?.front as V3 | undefined;
    if (f && this.goIf(c, f, anim, label)) { c.tasks.push({ k: 'do', anim: A.interact, time: 1, label: 'going inside' }, { k: 'gone' }); return true; }
    return false;
  }

  /** Walk to an offer, claim it, and do something there. */
  private atSpot(c: Cit, o: { p: V3; look?: V3 }, anim: AnimSpec, time: number, label: string, walkLabel: string, prop: PropKind | null = null, fx?: Fx, left: PropKind | null = null) {
    if (!this.claim(c, this.key(o.p))) return false;
    if (!this.goIf(c, o.p, A.walk(c), walkLabel)) { this.release(c); return false; }
    if (prop || left) c.tasks.push({ k: 'prop', kind: prop, left });
    c.tasks.push({ k: 'do', anim, time, look: o.look, label, fx, at: o.p });
    if (prop || left) c.tasks.push({ k: 'prop', kind: null });
    return true;
  }

  private spots(world: World) { return world.allSpots(); }

  private actLamps(c: Cit, world: World) {
    let ok = false;
    c.doing = 'lamps';
    for (const lp of world.lamps.slice(0, 3)) {
      const p: V3 = [lp[0] + 0.75, lp[1], lp[2]];
      if (!this.goIf(c, p, A.walk(c), 'off to light the lamps')) break;
      c.tasks.push({ k: 'do', anim: A.interact, time: 2, look: lp, label: 'lighting the lamps' });
      ok = true;
    }
    c.tasks.push({ k: 'run', fn: (q) => { q.doing = undefined; } });
    if (!ok) c.doing = undefined;
    return ok;
  }

  private actWork(c: Cit, world: World, role: Role) {
    const spots = this.spots(world);
    const ws = spots.find((s) => s.lot === c.work && (s.kind === 'work' || s.kind === 'stall'));
    const rnd = Math.random;
    if (!ws) return false;
    let anim: AnimSpec = A.tinker, verb = 'tending the kiln', tool: PropKind | null = null;
    if (ws.tool === 'axe') { anim = A.chop; verb = 'chopping wood'; tool = 'axe'; }
    else if (ws.tool === 'hammer') { if (rnd() < 0.5) { anim = A.pickaxe; verb = 'breaking stone'; tool = 'pickaxe'; } else { anim = A.hammer; verb = 'dressing stone'; tool = 'hammer'; } }
    else if (ws.tool === 'hoe') {
      if (rnd() < 0.35) return this.actWater(c, world, ws);
      if (rnd() < 0.5) { anim = A.dig; verb = 'digging the beds'; tool = 'shovel'; } else { anim = A.hoe; verb = 'hoeing the beds'; tool = 'hoe'; }
    } else if (ws.kind === 'stall') { anim = rnd() < 0.5 ? A.workC : A.tinker; verb = 'minding the stall'; }
    else if (role === 'kiln') { if (rnd() < 0.5) { anim = A.saw; verb = 'sawing kindling'; tool = 'saw'; } else { anim = A.workB; verb = 'stoking the kiln'; } }
    if (!this.atSpot(c, ws, anim, 10 + rnd() * 10, verb, 'off to work', tool)) return false;
    if (rnd() < 0.5) { // haul the goods somewhere
      const main = world.navLots.findIndex((L) => L.main);
      const door = this.lotPos(world, main >= 0 ? main : c.home);
      const dest = door && this.standNear(door);
      const goods: PropKind = role === 'farm' ? (rnd() < 0.5 ? 'sack' : 'basket') : 'crate';
      if (dest && this.canReach(c, dest)) {
        c.tasks.push({ k: 'do', anim: A.pickup, time: 1.1, label: 'picking up the goods' }, { k: 'prop', kind: goods });
        this.go(c, dest, A.carry, `carrying ${goods === 'crate' ? 'a crate' : goods === 'sack' ? 'a sack of grain' : 'a basket of greens'}`, { speed: c.speed * 0.85 });
        c.tasks.push({ k: 'do', anim: A.pickup, time: 1.0, label: 'setting it down' }, { k: 'prop', kind: null });
      }
    }
    return true;
  }

  private actSweep(c: Cit, world: World) {
    const d = this.spots(world).find((s) => s.lot === c.home && s.kind === 'door');
    return !!d && this.atSpot(c, d, A.sweep, 7, 'sweeping the doorstep', 'heading home', 'broom');
  }

  private actStroll(c: Cit, world: World) {
    const mate = this.idleMate(c, (o) => !o.look.kid, 12);
    if (!mate || world.navLots.length < 2) return false;
    const door = this.lotPos(world, Math.floor(Math.random() * world.navLots.length));
    const dest = door && this.standNear(door);
    if (!dest || Math.hypot(dest[0] - c.pos.x, dest[2] - c.pos.z) < 6 || !this.canReach(c, dest) || !this.nav.reachable([mate.pos.x, 0, mate.pos.z], dest)) return false;
    this.go(c, dest, A.walkTalk, `strolling with ${mate.name}, deep in talk`, { speed: Math.min(c.speed, mate.speed) * 0.9 });
    c.tasks.push({ k: 'do', anim: A.talk, time: 5, label: `chatting with ${mate.name}`, fx: 'talk' });
    mate.tasks.push({ k: 'follow', leader: c, anim: A.walkTalk, side: 1, lag: 0, label: `strolling with ${c.name}, deep in talk` });
    mate.tasks.push({ k: 'do', anim: A.talk, time: 5, label: `chatting with ${c.name}`, fx: 'talk' });
    c.partner = mate; mate.partner = c;
    return true;
  }

  private actMusic(c: Cit, world: World) {
    const sp = this.spots(world).filter((s) => (s.kind === 'fountain' || (s.kind === 'door' && (s.role === 'inn' || s.role === 'keep'))) && this.free(s.p));
    const s = this.pick(sp);
    return !!s && this.atSpot(c, s, s.kind === 'fountain' ? A.lute : A.luteStand, 14, 'playing the lute', 'off to busk', 'lute', 'strum');
  }

  private actInn(c: Cit, world: World) {
    const sp = this.spots(world).filter((s) => (s.kind === 'drink' || s.kind === 'fountain') && this.free(s.p));
    const s = this.pick(sp.filter((q) => q.kind === 'drink')) ?? this.pick(sp);
    if (!s) return false;
    return this.atSpot(c, s, s.kind === 'drink' ? A.drink : A.sit, 12, s.kind === 'drink' ? 'having an ale' : 'resting by the fountain', 'wandering over', s.kind === 'drink' ? 'mug' : null);
  }

  /** A free walkable patch of grass near one of the open spots. */
  private grassAt(world: World): V3 | null {
    for (let i = 0; i < 6; i++) {
      const g = this.pick(world.open);
      if (!g) return null;
      const p: V3 = [g[0] + (Math.random() - 0.5) * 2.5, 0, g[2] + (Math.random() - 0.5) * 2.5];
      if (!this.nav.free(p[0], p[2]) || this.nav.onPath(p[0], p[2]) || !this.free(p, 1.3) || this.byDoor(p)) continue;
      if (this.temps.some(([x, z]) => Math.hypot(x - p[0], z - p[2]) < 1.8) || !this.roomy(p)) continue;
      if (this.cits.some((o) => Math.hypot(o.pos.x - p[0], o.pos.z - p[2]) < 1.4)) continue;
      p[1] = this.nav.heightAt(p[0], p[2]);
      return p;
    }
    return null;
  }

  private actGrass(c: Cit, world: World) {
    const g = this.grassAt(world);
    if (!g) return false;
    const lie = Math.random() < 0.4 && !c.look.elder;
    const look: V3 = [g[0] + Math.sin(Math.random() * 6.3) * 3, g[1], g[2] + Math.cos(Math.random() * 6.3) * 3];
    return this.atSpot(c, { p: g, look }, lie ? A.lie : A.sitFloor, 10, lie ? 'lazing in the grass' : 'sitting in the grass', 'out for some air');
  }

  /** Read, write or sketch on a bench, against a tree, or at a viewpoint. */
  private actSeat(c: Cit, world: World, force?: 'read' | 'write' | 'sketch') {
    const seats = this.seats(world);
    const g = this.grassAt(world);
    if (g) seats.push({ p: g, look: [g[0] + 3, g[1], g[2] + 1], kind: 'grass', seat: 'floor' });
    const near = seats.filter((s) => this.canReach(c, s.p)).sort((a, b) => Math.hypot(a.p[0] - c.pos.x, a.p[2] - c.pos.z) - Math.hypot(b.p[0] - c.pos.x, b.p[2] - c.pos.z)).slice(0, 6);
    const s = this.pick(near);
    if (!s) return false;
    const what = force ?? (Math.random() < 0.45 ? 'read' : Math.random() < 0.5 ? 'write' : 'sketch');
    const chair = s.seat === 'chair';
    const where = s.kind === 'tree' ? ' under a tree' : s.kind === 'bench' ? ' on a bench' : s.kind === 'view' ? ' with a view' : ' in the grass';
    const anim = what === 'read' ? (chair ? A.readChair : A.read) : chair ? A.writeChair : A.write;
    const label = what === 'read' ? `reading a book${where}` : what === 'write' ? `writing in a notebook${where}` : `sketching${s.kind === 'view' ? ' the view' : where}`;
    const prop: PropKind = what === 'read' ? 'book' : what === 'write' ? 'pencil' : 'pencil';
    const left: PropKind | null = what === 'read' ? null : what === 'write' ? 'notebook' : 'sketchbook';
    if (!this.atSpot(c, s, anim, 18 + Math.random() * 14, label, 'looking for a quiet spot', prop, what === 'read' ? undefined : 'scribble', left)) return false;
    return true;
  }

  /** Something worth painting: a viewpoint, the sea, the tallest tower, a landmark. */
  private subject(world: World, from: V3): { p: V3; what: string; cols: number[] } | null {
    const out: { p: V3; what: string; cols: number[] }[] = [];
    let tall = -1, th = 0;
    world.specs.forEach((s, i) => { const b = world.built.get(s.id); if (b && b.top - b.lot.top > th) { th = b.top - b.lot.top; tall = i; } });
    const L = world.navLots;
    if (tall >= 0 && L[tall]) out.push({ p: [L[tall].x, L[tall].top + th * 0.4, L[tall].z], what: 'the great tower', cols: [M.SMOKE, M.GRASS, M.STONE, M.SLATE, M.TILE, M.PLASTER] });
    world.specs.forEach((s, i) => { if (['market', 'windmill', 'lighthouse', 'belltower', 'inn'].includes(s.role) && L[i]) out.push({ p: [L[i].x, L[i].top + 2, L[i].z], what: `the ${s.role === 'belltower' ? 'bell tower' : s.role}`, cols: [M.SMOKE, M.GRASS, M.PLASTER, M.ACCENT, M.SLATE, M.TIMBER] }); });
    if (world.site.sea !== null) {
      const a = Math.atan2(from[2], from[0]), R = world.site.RI * 1.25;
      out.push({ p: [Math.cos(a) * R, world.site.sea, Math.sin(a) * R], what: 'the sea', cols: [M.SMOKE, M.WATER, M.WATER, M.ACCENT, M.PLASTER, M.PLANK] });
      out.push({ p: [Math.cos(a) * R, world.site.sea, Math.sin(a) * R], what: 'the boats in the bay', cols: [M.SMOKE, M.WATER, M.PLANK, M.ACCENT, M.PLASTER] });
    }
    const ok = out.filter((s) => { const d = Math.hypot(s.p[0] - from[0], s.p[2] - from[2]); return d > 7 && d < 45; });
    return this.pick(ok);
  }

  private actPaint(c: Cit, world: World) {
    if (this.cits.filter((o) => o.doing === 'paint').length >= (Q.low ? 1 : 2) || !this.propMat) return false;
    const views = this.ground(world, 'view').filter((s) => this.free(s.p));
    const cand: V3[] = views.map((s) => s.p);
    for (let i = 0; i < 6; i++) { const g = this.grassAt(world); if (g) cand.push(g); }
    for (const s of this.nav.shore.slice(0, 40)) if (Math.random() < 0.15) cand.push(s.p);
    for (const p of cand) {
      if (!this.free(p, 1.4) || !this.roomy(p, 1.8) || !this.canReach(c, p)) continue;
      const view = views.find((v) => v.p === p);
      const sub = view ? { p: view.look, what: 'the view', cols: [M.SMOKE, M.GRASS, M.WATER, M.STONE, M.TILE] } : this.subject(world, p);
      if (!sub) continue;
      const dx = sub.p[0] - p[0], dz = sub.p[2] - p[2], dl = Math.hypot(dx, dz) || 1;
      const E: V3 = [p[0] + (dx / dl) * 0.8, 0, p[2] + (dz / dl) * 0.8];
      if (!this.nav.free(E[0], E[2]) || this.nav.onPath(E[0], E[2]) || this.cits.some((o) => Math.hypot(o.pos.x - E[0], o.pos.z - E[2]) < 1.2)) continue;
      E[1] = this.nav.heightAt(E[0], E[2]);
      if (!this.claim(c, this.key(p))) continue;
      this.go(c, p, A.walk(c), 'off to paint, easel under one arm');
      const easel = makeEasel(this.propMat, c.id * 7 + Math.floor(Math.random() * 1000), sub.cols);
      this.neutral(easel.mesh);
      easel.mesh.position.set(E[0], E[1], E[2]);
      easel.mesh.rotation.y = Math.atan2(dx, dz);
      const temp: [number, number, number] = [E[0], E[2], 0.4];
      const pack = () => { this.group.remove(easel.mesh); easel.mesh.geometry.dispose(); this.temps = this.temps.filter((t) => t !== temp); this.nav.addTemp(temp[0], temp[1], temp[2], false); };
      c.tasks.push({ k: 'run', fn: (q) => { q.doing = 'paint'; this.group.add(easel.mesh); this.temps.push(temp); this.nav.addTemp(temp[0], temp[1], temp[2], true); q.cleanup.push(pack); } });
      c.tasks.push({ k: 'do', anim: A.pickup, time: 1.2, look: E, label: 'setting up an easel', at: p });
      c.tasks.push({ k: 'prop', kind: 'brush', left: 'palette' });
      const dur = 34 + Math.random() * 20;
      c.tasks.push({ k: 'do', anim: A.paint, time: dur, dur, look: E, label: `painting ${sub.what}`, fx: 'brush', at: p, tick: (_q, _dt, t) => easel.paint(1 - t.time / (t.dur ?? 1)) });
      c.tasks.push({ k: 'prop', kind: null });
      c.tasks.push({ k: 'do', anim: A.admire, time: 3, look: E, label: 'stepping back to admire the picture', at: p });
      c.tasks.push({ k: 'do', anim: A.pickup, time: 1.2, look: E, label: 'packing up the easel', at: p });
      c.tasks.push({ k: 'run', fn: (q) => this.finish(q) });
      return true;
    }
    return false;
  }

  private actFish(c: Cit, world: World) {
    if (!this.propMat) return false;
    const sp = this.shore(world).filter((o) => this.canReach(c, o.p));
    const near = sp.sort((a, b) => Math.hypot(a.p[0] - c.pos.x, a.p[2] - c.pos.z) - Math.hypot(b.p[0] - c.pos.x, b.p[2] - c.pos.z)).slice(0, 5);
    const s = this.pick(near);
    if (!s || !this.claim(c, this.key(s.p))) return false;
    this.go(c, s.p, A.walk(c), s.kind === 'pier' ? 'off to fish from the pier' : 'off down to the water to fish');
    c.tasks.push({ k: 'prop', kind: 'rod' });
    const dur = 30 + Math.random() * 25;
    const water = world.site.sea ?? s.p[1] - 0.4;
    const where = s.kind === 'pier' ? 'off the pier' : 'off the shore';
    let line: THREE.Mesh | null = null, float: THREE.Mesh | null = null, fish: THREE.Mesh | null = null;
    let phase = 'cast', pt = 0, caught = 0;
    const tip = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0), tmp = new THREE.Vector3();
    const dx = s.look[0] - s.p[0], dz = s.look[2] - s.p[2], dl = Math.hypot(dx, dz) || 1;
    const bob = new THREE.Vector3(s.p[0] + (dx / dl) * 3.6, water + 0.02, s.p[2] + (dz / dl) * 3.6);
    c.tasks.push({
      k: 'do', anim: A.fishCast, time: dur, look: s.look, label: `fishing ${where}`, at: s.p,
      tick: (q, dt, t) => {
        if (!line && this.propMat) {
          line = this.neutral(makeLine(this.propMat)); float = this.neutral(makeFloat(this.propMat)); fish = this.neutral(makeFish(this.propMat));
          fish.visible = false;
          this.group.add(line, float, fish);
          q.cleanup.push(() => { for (const m of [line, float, fish]) if (m) this.group.remove(m); });
        }
        pt += dt;
        const next = (p: string, a: AnimSpec, label: string) => { phase = p; pt = 0; t.anim = a; t.label = label; };
        if (phase === 'cast' && pt > 1.9) next('wait', A.fishIdle, `fishing ${where}`);
        else if (phase === 'wait' && pt > 5 + (q.id % 5)) next('bite', A.fishBite, 'fishing — a bite!');
        else if (phase === 'bite' && pt > 2.2) next(Math.random() < 0.7 ? 'reel' : 'wait', Math.random() < 0.7 ? A.fishReel : A.fishIdle, 'reeling one in');
        else if (phase === 'reel' && pt > 3.2) { if (Math.random() < 0.75) { next('catch', A.fishCatch, 'landed a fish!'); caught++; } else next('wait', A.fishIdle, `fishing ${where} — it got away`); }
        else if (phase === 'catch' && pt > 3.2) next('cast', A.fishCast, `fishing ${where}${caught > 1 ? ` (${caught} caught)` : ''}`);
        if (t.time < 4 && phase !== 'catch') t.label = 'packing up the rod';
        // line from the rod tip to the float
        if (q.prop && line && float && fish) {
          q.root.updateMatrixWorld(true);
          q.prop.localToWorld(tip.set(0, 2.9, 0));
          const k = phase === 'cast' ? Math.min(1, Math.max(0, (pt - 0.9) / 0.8)) : phase === 'reel' ? 1 - pt / 3.4 : phase === 'catch' ? 0 : 1;
          const f = tmp.copy(tip).lerp(bob, k);
          f.y = k > 0.98 ? water + 0.03 + Math.sin(this.clock * 3 + q.id) * 0.02 - (phase === 'bite' ? 0.06 * Math.abs(Math.sin(pt * 9)) : 0) : f.y - Math.sin(Math.PI * k) * 0.4 + (phase === 'catch' ? -0.5 : 0);
          if (phase === 'cast' && pt < 0.9) f.copy(tip).y -= 0.05;
          float.position.copy(f); float.visible = phase !== 'catch';
          fish.visible = phase === 'catch' && pt < 2.6; fish.position.copy(f); fish.rotation.z = Math.sin(this.clock * 14) * 0.5;
          const d = f.clone().sub(tip), L = d.length();
          line.position.copy(tip); line.scale.set(1, Math.max(0.01, L), 1);
          line.quaternion.setFromUnitVectors(up, d.normalize());
        }
      },
    });
    c.tasks.push({ k: 'run', fn: (q) => this.finish(q) }, { k: 'prop', kind: null });
    c.tasks.push({ k: 'run', fn: (q) => { q.doing = undefined; } });
    c.tasks.splice(c.tasks.length - 4, 0, { k: 'run', fn: (q) => { q.doing = 'fish'; } });
    return true;
  }

  private actWater(c: Cit, world: World, farm?: { p: V3; look: V3 }) {
    const fields = this.ground(world, 'field').filter((s) => this.free(s.p));
    let s: { p: V3; look: V3 } | null = farm ?? this.pick(fields.filter((f) => this.canReach(c, f.p)));
    if (!s) {
      const fw = this.spots(world).filter((q) => q.kind === 'work' && q.tool === 'hoe' && this.free(q.p));
      s = this.pick(fw);
    }
    if (!s) return false;
    return this.atSpot(c, s, A.pour, 10 + Math.random() * 6, 'watering the crops', 'off to water the crops', 'can');
  }

  private actBirds(c: Cit, world: World) {
    if (!this.propMat || this.flocks.length >= (Q.low ? 1 : 3)) return false;
    const fountain = this.pick(this.spots(world).filter((s) => s.kind === 'fountain' && this.free(s.p)));
    const g = Math.random() < 0.4 && fountain ? fountain.p : this.grassAt(world);
    if (!g || !this.claim(c, this.key(g)) || !this.goIf(c, g, A.walk(c), c.look.kid ? 'chasing the pigeons' : 'off to feed the birds')) { this.release(c); return false; }
    const a = Math.random() * 6.28;
    const look: V3 = [g[0] + Math.sin(a), g[1], g[2] + Math.cos(a)];
    const flock = { birds: [] as { m: THREE.Mesh; x: number; z: number; y: number; ph: number }[], leave: -1 };
    c.tasks.push({ k: 'prop', kind: 'pouch' });
    c.tasks.push({ k: 'run', fn: (q) => {
      const n = Q.low ? 3 : 5;
      for (let i = 0; i < n; i++) {
        const r = 0.6 + Math.random() * 0.8, b = a + (Math.random() - 0.5) * 1.8;
        const x = g[0] + Math.sin(b) * r, z = g[2] + Math.cos(b) * r;
        const m = this.neutral(makeBird(this.propMat!, i + q.id));
        m.scale.setScalar(1.6);
        flock.birds.push({ m, x, z, y: this.nav.heightAt(x, z), ph: Math.random() * 6 });
        this.group.add(m);
      }
      this.flocks.push(flock);
      q.cleanup.push(() => { flock.leave = this.clock; });
    } });
    c.tasks.push({ k: 'do', anim: A.crouch, time: 14 + Math.random() * 8, look, label: c.look.kid ? 'scattering crumbs for the birds' : 'feeding the birds', at: g });
    c.tasks.push({ k: 'run', fn: (q) => this.finish(q) }, { k: 'prop', kind: null });
    return true;
  }

  private actWell(c: Cit, world: World) {
    const w = this.pick(this.ground(world, 'well').filter((s) => this.free(s.p) && this.canReach(c, s.p)));
    if (!w) return false;
    if (!this.atSpot(c, w, A.workB, 5, 'drawing water at the well', 'off to the well')) return false;
    c.tasks.push({ k: 'prop', kind: 'bucket' });
    this.goHome(c, world, 'carrying water home', A.carryOne);
    return true;
  }

  private actFence(c: Cit, world: World) {
    const fences = this.ground(world, 'fence').filter((s) => this.free(s.p) && this.canReach(c, s.p));
    const s = this.pick(fences);
    if (!s) return false;
    const dx = s.look[0] - s.p[0], dz = s.look[2] - s.p[2], dl = Math.hypot(dx, dz) || 1;
    const across = this.nav.nearest(s.p[0] + (dx / dl) * 1.3, s.p[2] + (dz / dl) * 1.3, 0.6);
    if (across < 0) return false;
    const q: V3 = [this.nav.cx(across), 0, this.nav.cz(across)];
    q[1] = this.nav.heightAt(q[0], q[2]);
    const mate = this.idleMate(c, (o) => !o.look.kid && this.nav.reachable([o.pos.x, 0, o.pos.z], q), 45);
    if (!mate || !this.free(q)) return false;
    const t = 12 + Math.random() * 8;
    if (!this.atSpot(c, { p: s.p, look: q }, A.talk, t, `chatting with ${mate.name} over the fence`, 'off for a word over the fence', null, 'talk')) return false;
    if (!this.atSpot(mate, { p: q, look: s.p }, A.talk, t + 1, `chatting with ${c.name} over the fence`, `off to see ${c.name}`, null, 'talk')) { this.drop(c); return false; }
    c.partner = mate; mate.partner = c;
    return true;
  }

  private actErrand(c: Cit, world: World) {
    const lot = Math.floor(Math.random() * world.navLots.length);
    const d = this.nav.doors[lot];
    const p = this.lotPos(world, lot);
    if (!p || !this.claim(c, this.key(p))) return false;
    if (!this.goIf(c, p, A.walk(c), 'running errands')) { this.release(c); return false; }
    if (d && lot !== c.home) {
      c.tasks.push({ k: 'do', anim: A.interact, time: 1.2, look: d.inside, label: 'knocking on a door' }, { k: 'door', leaf: d.leaf, secs: 3.5 },
        { k: 'do', anim: A.talk, time: 3, look: d.inside, label: 'a word at the door', fx: 'talk' });
    } else c.tasks.push({ k: 'do', anim: Math.random() < 0.5 ? A.idleB : A.idle2, time: 2 + Math.random() * 3, label: 'looking about' });
    return true;
  }

  private actPlay(c: Cit, world: World) {
    const g = this.grassAt(world);
    if (!g) return false;
    const rnd = Math.random;
    const mate = this.idleMate(c, (o) => o.look.kid, 12);
    const r = rnd();
    if (mate && r < 0.45) { // ball game
      for (let k = 0; k < 4; k++) {
        const a = rnd() * Math.PI;
        const pa: V3 = [g[0] - Math.cos(a) * 2, 0, g[2] - Math.sin(a) * 2], pb: V3 = [g[0] + Math.cos(a) * 2, 0, g[2] + Math.sin(a) * 2];
        if (!this.nav.free(pa[0], pa[2]) || !this.nav.free(pb[0], pb[2]) || !this.nav.reachable(pa, pb)) continue;
        pa[1] = this.nav.heightAt(pa[0], pa[2]); pb[1] = this.nav.heightAt(pb[0], pb[2]);
        if (!this.goIf(c, pa, A.runKid, 'running off to play') || !this.goIf(mate, pb, A.runKid, 'running off to play')) { this.drop(c); this.drop(mate); return false; }
        c.tasks.push({ k: 'do', anim: A.throw, time: 12, look: pb, label: 'playing catch', fx: 'ball', at: pa });
        mate.tasks.push({ k: 'do', anim: A.throw, time: 12, look: pa, label: 'playing catch', fx: 'ball', at: pb });
        c.partner = mate; mate.partner = c;
        return true;
      }
    }
    if (mate && r < 0.8 && this.goIf(c, g, A.runKid, 'playing tag')) { // tag
      for (let i = 0; i < 4; i++) {
        const p: V3 = [g[0] + (rnd() - 0.5) * 8, 0, g[2] + (rnd() - 0.5) * 8];
        if (!this.nav.free(p[0], p[2])) continue;
        p[1] = this.nav.heightAt(p[0], p[2]);
        this.go(c, p, A.runKid, 'playing tag — "you\'re it!"', { speed: 2.2 / 2 });
      }
      mate.tasks.push({ k: 'follow', leader: c, anim: A.runKid, side: 0, lag: 1.6, label: 'playing tag — chasing' });
      c.partner = mate; mate.partner = c;
      c.tasks.push({ k: 'run', fn: (q) => { q.partner = undefined; mate.partner = undefined; } });
      return true;
    }
    if (rnd() < 0.3) return this.actBirds(c, world);
    return this.atSpot(c, { p: g }, rnd() < 0.5 ? A.jump : A.dance, 6, 'jumping about', 'skipping about');
  }

  // ------------------------------------------------------------ simulation
  private target(world: World, night: number, rain: number) {
    return Math.round(Math.min(Q.low ? 16 : 30, world.econ.pop * 0.75) * (1 - 0.6 * night) * (1 - 0.45 * rain));
  }

  update(dt: number, world: World, night: number, rain: number, tod = 0.4) {
    this.clock += dt;
    if (this.navVersion !== world.navVersion) this.rebuildNav(world);
    this.fixtures.update(dt, world, tod, rain);
    if (!this.ready) return;
    const lots = world.navLots;
    if (!lots.length) return;
    const want = this.target(world, night, rain);
    if (this.cits.length < want && Math.random() < dt * 1.5) {
      // (not out of a door somebody is standing in)
      const busy = (i: number) => { const d = this.nav.doors[i]; return !!d && this.cits.some((o) => Math.hypot(o.pos.x - d.out[0], o.pos.z - d.out[2]) < 1.6 || Math.hypot(o.pos.x - d.inside[0], o.pos.z - d.inside[2]) < 1.2); };
      const homes = world.specs.map((s, i) => [s, i] as const).filter(([s, i]) => (['house', 'keep', 'inn'].includes(s.role) || Math.random() < 0.2) && !busy(i));
      const home = homes.length ? homes[Math.floor(Math.random() * homes.length)][1] : -1;
      const kid = Math.random() < 0.22;
      const c = home >= 0 ? this.spawn(world, home, kid) : null;
      if (c && !kid) { // take a job where one is free
        const jobs = world.specs.map((s, i) => [s, i] as const).filter(([s]) => TRADE[s.role]);
        const free = jobs.filter(([s, i]) => this.cits.filter((o) => o.work === i).length < Math.max(1, s.blocks * 2));
        if (free.length && Math.random() < 0.8) c.work = free[Math.floor(Math.random() * free.length)][1];
      }
    }
    const leaving = this.cits.length > want + 1;
    const t = this.clock;
    // who is near whom (1 m buckets)
    const grid = new Map<number, Cit[]>();
    const bucket = (x: number, z: number) => (Math.floor(x) + 512) * 1024 + Math.floor(z) + 512;
    for (const c of this.cits) { const k = bucket(c.pos.x, c.pos.z); let l = grid.get(k); if (!l) grid.set(k, (l = [])); l.push(c); }
    const near = (c: Cit, r: number) => {
      const out: Cit[] = [];
      for (let i = Math.floor(c.pos.x - r); i <= Math.floor(c.pos.x + r); i++) for (let j = Math.floor(c.pos.z - r); j <= Math.floor(c.pos.z + r); j++) {
        for (const o of grid.get((i + 512) * 1024 + j + 512) ?? []) if (o !== c) out.push(o);
      }
      return out;
    };

    for (const c of [...this.cits]) {
      if (!this.cits.includes(c)) continue;
      for (const [b, q] of c.rest) b.quaternion.copy(q);
      c.mixer.update(dt);
      if (!c.tasks.length) this.plan(c, world, night, rain, tod, leaving && !c.partner);
      const task = c.tasks[0];
      c.moving = false;
      if (!task) continue;
      c.label = 'label' in task ? task.label : c.label;
      c.fx = undefined;
      if (task.k === 'gone') { this.remove(c); continue; }
      if (task.k === 'prop') { this.setProp(c, task.kind, task.left ?? null); c.tasks.shift(); continue; }
      if (task.k === 'door') { this.fixtures.open(task.leaf, task.secs); c.tasks.shift(); continue; }
      if (task.k === 'run') { task.fn(c); c.tasks.shift(); continue; }
      if (task.k === 'go') this.walkStep(c, task, dt, near);
      else if (task.k === 'do') {
        this.play(c, task.anim);
        if (task.at) { // settle exactly onto the spot
          const k = Math.min(1, dt * 6);
          c.pos.x += (task.at[0] - c.pos.x) * k; c.pos.z += (task.at[2] - c.pos.z) * k; c.pos.y += (task.at[1] - c.pos.y) * k;
        }
        if (task.look) this.face(c, Math.atan2(task.look[0] - c.pos.x, task.look[2] - c.pos.z), dt * 6);
        c.fx = task.fx;
        task.tick?.(c, dt, task);
        task.time -= dt;
        if (task.fx === 'ball' && c.partner && !this.balls.some((b) => b.a === c || b.b === c) && this.propMat) {
          const mesh = this.neutral(makeBall(this.propMat)); this.group.add(mesh); this.balls.push({ a: c, b: c.partner, mesh, t0: t });
        }
        if (task.time <= 0) {
          c.tasks.shift();
          if (!c.tasks.length || (c.tasks[0].k !== 'do' && c.tasks[0].k !== 'prop' && c.tasks[0].k !== 'run')) this.release(c);
          if (task.fx === 'ball' || task.fx === 'talk') { if (c.partner?.partner === c && !c.partner.tasks.some((q) => q.k === 'do' && q.fx === task.fx)) c.partner.partner = undefined; c.partner = undefined; }
          this.balls = this.balls.filter((b) => { if (b.a === c) { this.group.remove(b.mesh); return false; } return true; });
        }
      } else if (task.k === 'follow') this.followStep(c, task, dt, near);
      c.root.position.copy(c.pos);
      c.root.rotation.y = c.heading;
    }
    // post-animation touches: strumming, scribbling, heads turned in conversation, children's big heads, elders' stoop
    for (const c of this.cits) {
      const B = c.bones;
      if (c.look.kid && B.head) B.head.scale.setScalar(1.28);
      if (c.look.elder && B.spine) B.spine.rotateX(0.22);
      if (c.fx === 'strum' && B.lowerarmr) B.lowerarmr.rotateZ(Math.sin(t * 13 + c.id) * 0.22);
      if (c.fx === 'scribble' && B.wristr) { B.wristr.rotateX(Math.sin(t * 9 + c.id) * 0.25); B.wristr.rotateZ(Math.sin(t * 5.3 + c.id) * 0.2); }
      if (c.fx === 'brush' && B.lowerarmr) B.lowerarmr.rotateZ(Math.sin(t * 2.3 + c.id) * 0.25);
      if (c.fx === 'talk' && B.head && c.partner) {
        const want = Math.atan2(c.partner.pos.x - c.pos.x, c.partner.pos.z - c.pos.z) - c.heading;
        const d = Math.atan2(Math.sin(want), Math.cos(want));
        B.head.rotateY(Math.max(-0.7, Math.min(0.7, d)) + Math.sin(t * 2 + c.id) * 0.08);
      }
    }
    // the ball arcs between the two players
    for (const b of this.balls) {
      const ph = ((t - b.t0) / 1.4) % 2, k = ph % 1, from = ph < 1 ? b.a : b.b, to = ph < 1 ? b.b : b.a;
      b.mesh.position.set(from.pos.x + (to.pos.x - from.pos.x) * k, from.pos.y + 1.4 + Math.sin(Math.PI * k) * 1.6, from.pos.z + (to.pos.z - from.pos.z) * k);
    }
    // birds peck about, then fly off
    for (const f of [...this.flocks]) {
      const gone = f.leave >= 0 ? t - f.leave : -1;
      for (const b of f.birds) {
        const peck = Math.max(0, Math.sin(t * 5 + b.ph * 3)) ** 4;
        if (gone < 0) {
          if (Math.sin(t * 0.7 + b.ph * 5) > 0.97) { b.x += Math.sin(b.ph) * dt * 0.8; b.z += Math.cos(b.ph) * dt * 0.8; b.ph += dt * 0.3; }
          b.m.position.set(b.x, b.y + Math.max(0, Math.sin(t * 9 + b.ph)) * 0.03, b.z);
          b.m.rotation.set(peck * 0.9, b.ph, 0);
        } else {
          b.m.position.set(b.x + Math.sin(b.ph) * gone * 4, b.y + gone * gone * 2.5 + gone, b.z + Math.cos(b.ph) * gone * 4);
          b.m.rotation.set(-0.4, b.ph, Math.sin(t * 30 + b.ph) * 0.4);
        }
      }
      if (gone > 2.5) { for (const b of f.birds) { this.group.remove(b.m); b.m.geometry.dispose(); } this.flocks.splice(this.flocks.indexOf(f), 1); }
    }
  }

  /** Push away from people nearby (not one's partner), keeping to the right when meeting head on. */
  private separation(c: Cit, dir: THREE.Vector2 | null, near: (c: Cit, r: number) => Cit[], out: THREE.Vector2) {
    out.set(0, 0);
    for (const o of near(c, SEP)) {
      if (o === c.partner || c === o.partner) continue;
      let dx = c.pos.x - o.pos.x, dz = c.pos.z - o.pos.z;
      let d = Math.hypot(dx, dz);
      if (d >= SEP) continue;
      if (d < 1e-3) { dx = Math.sin(c.id); dz = Math.cos(c.id); d = 1; } else { dx /= d; dz /= d; }
      const w = (SEP - d) / SEP;
      const k = o.moving ? 0.7 : 1.4;
      out.x += dx * w * k; out.y += dz * w * k;
      if (dir && dir.x * -dx + dir.y * -dz > 0.35) { out.x += dir.y * w * 0.9; out.y += -dir.x * w * 0.9; } // sidestep to the right
    }
    return out;
  }

  /** Step from the current position, staying on walkable cells (sliding along walls). */
  private stepTo(c: Cit, nx: number, nz: number, force: boolean) {
    const nav = this.nav;
    if (force || nav.free(nx, nz) || !nav.free(c.pos.x, c.pos.z)) { c.pos.x = nx; c.pos.z = nz; return true; }
    if (nav.free(nx, c.pos.z)) { c.pos.x = nx; return true; }
    if (nav.free(c.pos.x, nz)) { c.pos.z = nz; return true; }
    return false;
  }

  private trailAt(L: Cit, back: number): [number, number] {
    let x = L.pos.x, z = L.pos.z, acc = 0;
    for (let i = L.trail.length - 2; i >= 0; i -= 2) {
      const tx = L.trail[i], tz = L.trail[i + 1], d = Math.hypot(tx - x, tz - z);
      if (acc + d >= back) { const k = (back - acc) / (d || 1); return [x + (tx - x) * k, z + (tz - z) * k]; }
      acc += d; x = tx; z = tz;
    }
    return [x, z];
  }
  private record(c: Cit) {
    const n = c.trail.length;
    if (!n || Math.hypot(c.trail[n - 2] - c.pos.x, c.trail[n - 1] - c.pos.z) > 0.25) { c.trail.push(c.pos.x, c.pos.z); if (c.trail.length > 40) c.trail.splice(0, 2); }
  }

  private dir = new THREE.Vector2();
  private push = new THREE.Vector2();

  private walkStep(c: Cit, task: Extract<Task, { k: 'go' }>, dt: number, near: (c: Cit, r: number) => Cit[]) {
    if (!task.pts) {
      const r = task.through ? [[c.pos.x, c.pos.y, c.pos.z] as V3, task.to] : this.nav.route([c.pos.x, c.pos.y, c.pos.z], task.to);
      if (!r) { this.bad.add(this.key(task.to)); this.drop(c); return; }
      task.pts = r; task.seg = 0; task.best = Infinity; task.stuck = 0;
    }
    this.play(c, task.anim);
    const run = task.anim === A.run || task.anim === A.runKid ? 2.0 : task.anim === A.carry ? 0.85 : 1;
    const speed = task.speed * run;
    let wp = task.pts[task.seg + 1];
    while (wp && task.seg + 1 < task.pts.length - 1 && Math.hypot(wp[0] - c.pos.x, wp[2] - c.pos.z) < 0.45) { task.seg++; wp = task.pts[task.seg + 1]; }
    if (!wp) { c.tasks.shift(); return; }
    const final = task.seg + 1 === task.pts.length - 1;
    const dx = wp[0] - c.pos.x, dz = wp[2] - c.pos.z, dist = Math.hypot(dx, dz);
    if (final && dist < 0.06) { c.pos.set(wp[0], wp[1], wp[2]); c.tasks.shift(); return; }
    const dir = this.dir.set(dx / (dist || 1), dz / (dist || 1));
    const precise = task.through || (final && dist < 0.35);
    const sep = precise ? this.push.set(0, 0) : this.separation(c, dir, near, this.push);
    const give = task.stuck > 1 ? 0.15 : 1.3; // squeeze past when there is no way round
    let vx = dir.x + sep.x * give, vz = dir.y + sep.y * give;
    const vl = Math.hypot(vx, vz);
    if (vl > 1.25) { vx *= 1.25 / vl; vz *= 1.25 / vl; }
    let step = speed * dt;
    if (final) step = Math.min(step, dist);
    const ox = c.pos.x, oz = c.pos.z;
    this.stepTo(c, c.pos.x + vx * step, c.pos.z + vz * step, !!task.through || (final && dist < 1.6));
    const moved = Math.hypot(c.pos.x - ox, c.pos.z - oz);
    c.moving = true;
    if (moved > 1e-4) this.face(c, Math.atan2(c.pos.x - ox, c.pos.z - oz), dt * 8);
    // height: the floor, blending into the spot's own height on the last stretch
    const f = this.nav.heightAt(c.pos.x, c.pos.z);
    const ty = task.through ? task.pts[0][1] + (wp[1] - task.pts[0][1]) * Math.max(0, 1 - dist / Math.max(0.01, Math.hypot(wp[0] - task.pts[0][0], wp[2] - task.pts[0][2]))) : final && dist < 1.2 ? f + (wp[1] - f) * (1 - dist / 1.2) : f;
    c.pos.y += (ty - c.pos.y) * Math.min(1, dt * 12);
    this.record(c);
    // stuck? try a fresh route, then give up
    if (task.bestSeg !== task.seg) { task.bestSeg = task.seg; task.best = Infinity; }
    if (dist < task.best - 0.05) { task.best = dist; task.stuck = 0; } else task.stuck += dt;
    if (task.stuck > 2.5) {
      task.replans++; task.pts = undefined;
      if (task.replans > 3) { this.drop(c); }
    }
  }

  private followStep(c: Cit, task: Extract<Task, { k: 'follow' }>, dt: number, near: (c: Cit, r: number) => Cit[]) {
    const L = task.leader;
    if (!this.cits.includes(L) || !L.tasks.length || L.tasks[0].k !== 'go') { c.tasks.shift(); return; }
    this.play(c, task.anim);
    let tx: number, tz: number;
    if (task.lag) [tx, tz] = this.trailAt(L, task.lag);
    else {
      const fx = Math.sin(L.heading), fz = Math.cos(L.heading);
      tx = L.pos.x + fz * 0.75 * task.side; tz = L.pos.z - fx * 0.75 * task.side;
      if (!this.nav.free(tx, tz)) [tx, tz] = this.trailAt(L, 0.8);
    }
    const dx = tx - c.pos.x, dz = tz - c.pos.z, dist = Math.hypot(dx, dz);
    const dir = this.dir.set(dx / (dist || 1), dz / (dist || 1));
    const sep = this.separation(c, dir, (q, r) => near(q, r).filter((o) => o !== L), this.push);
    const lt = L.tasks[0] as Extract<Task, { k: 'go' }>;
    const sp = Math.min(dist * 4, lt.speed * (task.anim === A.runKid ? 2 : 1) * 1.5);
    const ox = c.pos.x, oz = c.pos.z;
    this.stepTo(c, c.pos.x + (dir.x * sp + sep.x * 1.2) * dt, c.pos.z + (dir.y * sp + sep.y * 1.2) * dt, false);
    c.moving = true;
    c.pos.y += (this.nav.heightAt(c.pos.x, c.pos.z) - c.pos.y) * Math.min(1, dt * 12);
    this.record(c);
    const moved = Math.hypot(c.pos.x - ox, c.pos.z - oz);
    this.face(c, task.lag ? Math.atan2(L.pos.x - c.pos.x, L.pos.z - c.pos.z) : moved > 0.01 ? Math.atan2(c.pos.x - ox, c.pos.z - oz) : L.heading, dt * 6);
    c.fx = task.side ? 'talk' : undefined;
  }

  private face(c: Cit, want: number, k: number) {
    let d = want - c.heading; d = Math.atan2(Math.sin(d), Math.cos(d));
    c.heading += d * Math.min(1, k);
  }

  // ------------------------------------------------------------ queries
  /** Nearest resident to a screen point: "Name the trade — doing something". */
  nameAt(camera: THREE.Camera, x: number, y: number, w: number, h: number, world?: World): string | null {
    let best: Cit | null = null, bd = 24;
    const v = new THREE.Vector3();
    for (const c of this.cits) {
      v.copy(c.pos); v.y += 1.1 * c.look.height; v.project(camera);
      const d = Math.hypot((v.x * 0.5 + 0.5) * w - x, (-v.y * 0.5 + 0.5) * h - y);
      if (d < bd && v.z < 1) { bd = d; best = c; }
    }
    if (!best) return null;
    const role = best.work >= 0 && world ? world.specs[best.work]?.role : undefined;
    const who = best.look.kid ? `${best.name} (a child)` : best.look.elder ? `old ${best.name}` : best.name;
    return `${who}${role && TRADE[role] ? ` the ${TRADE[role]}` : ''} — ${best.label}`;
  }
  get count() { return this.cits.length; }
  names() { return this.cits.filter((c) => !c.look.kid).map((c) => c.name); }
  positionOf(name: string) { return this.cits.find((c) => c.name === name)?.pos ?? null; }
  /** For tests: what everyone is doing. */
  census() { return this.cits.map((c) => ({ name: c.name, kid: c.look.kid, sig: c.look.sig, label: c.label, task: c.tasks[0]?.k ?? '', x: c.pos.x, y: c.pos.y, z: c.pos.z, partner: c.partner?.name ?? '' })); }

  /**
   * For tests: where people stand that they shouldn't. Walkers (not on their last stretch to a spot,
   * not stepping through a doorway) inside blocked cells, and pairs closer than `min` who aren't partners.
   */
  check(min = 0.45) {
    let blocked = 0, close = 0, walkers = 0;
    const bad: string[] = [];
    for (const c of this.cits) {
      const t = c.tasks[0];
      if (t?.k === 'go' && t.pts && !t.through) {
        const wp = t.pts[t.pts.length - 1];
        walkers++;
        if (Math.hypot(wp[0] - c.pos.x, wp[2] - c.pos.z) > 1.7 && Math.hypot(t.pts[0][0] - c.pos.x, t.pts[0][2] - c.pos.z) > 1.7 && !this.nav.free(c.pos.x, c.pos.z)) { blocked++; bad.push(`${c.name}@${c.pos.x.toFixed(1)},${c.pos.z.toFixed(1)}`); }
      }
    }
    for (let i = 0; i < this.cits.length; i++) for (let j = i + 1; j < this.cits.length; j++) {
      const a = this.cits[i], b = this.cits[j];
      if (a.partner === b || b.partner === a) continue;
      if (a.tasks[0]?.k === 'gone' || b.tasks[0]?.k === 'gone') continue;
      if (Math.hypot(a.pos.x - b.pos.x, a.pos.z - b.pos.z) < min) { close++; bad.push(`${a.name}~${b.name}`); }
    }
    return { n: this.cits.length, walkers, blocked, close, bad };
  }

  /** For tests: make an idle grown-up (or child) do a particular thing now. */
  debugDo(what: string, world: World, kid = false, extra?: string) {
    const c = this.cits.find((o) => o.look.kid === kid && !o.partner && !o.doing && (o.tasks.length === 0 || o.tasks[0].k === 'do' || o.tasks[0].k === 'go')) ?? null;
    if (!c) return null;
    this.drop(c);
    const f: Record<string, () => boolean> = {
      read: () => this.actSeat(c, world, 'read'), write: () => this.actSeat(c, world, 'write'), sketch: () => this.actSeat(c, world, 'sketch'),
      paint: () => this.actPaint(c, world), fish: () => this.actFish(c, world), water: () => this.actWater(c, world), birds: () => this.actBirds(c, world),
      well: () => this.actWell(c, world), fence: () => this.actFence(c, world), stroll: () => this.actStroll(c, world), home: () => this.goHome(c, world, 'heading home', A.walk(c)),
      errand: () => this.actErrand(c, world), play: () => this.actPlay(c, world), grass: () => this.actGrass(c, world), inn: () => this.actInn(c, world),
      work: () => {
        const want = extra ?? '';
        for (const [i, s] of world.specs.entries()) {
          if (!TRADE[s.role] || s.role === 'market' || (want && s.role !== want)) continue;
          c.work = i;
          if (this.actWork(c, world, s.role)) return true;
        }
        return false;
      },
    };
    const ok = f[what]?.() ?? false;
    return ok ? c.name : null;
  }
}
