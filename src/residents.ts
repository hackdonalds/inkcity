import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { charFrag, charVert } from './shaders';
import { CitizenKit, Look, Slot, skinTone } from './citizens';
import { PropKind, makeBall, makeProp } from './props';
import type { World } from './world';
import type { Role } from './economy';

/**
 * Townsfolk. Every citizen is assembled from mixed KayKit Adventurers parts (CC0, Kay Lousberg),
 * recoloured and reproportioned so no two look alike, and lives a little daily routine:
 * work with tools, carry goods, sweep, play music, sit, drink, chat while strolling, play games.
 */
const MODELS = ['Rogue_Hooded', 'Rogue', 'Mage', 'Barbarian', 'Knight'];
const FIRST = ['Maren', 'Tobin', 'Ilse', 'Corwin', 'Aldo', 'Petra', 'Wim', 'Odile', 'Hesper', 'Brann', 'Lotte', 'Ewan', 'Fenna', 'Jory', 'Mabel',
  'Quill', 'Rosamund', 'Silas', 'Tamsin', 'Ulric', 'Vesna', 'Wendel', 'Yara', 'Bertil', 'Agnes', 'Cosmo', 'Dagny', 'Elric', 'Greta', 'Hob',
  'Ingrid', 'Jasper', 'Kestrel', 'Linnea', 'Mungo', 'Nell', 'Osric', 'Pim', 'Rhosyn', 'Sabine', 'Teodor', 'Una', 'Vid', 'Wren', 'Ysolde'];
const TRADE: Partial<Record<Role, string>> = { wood: 'woodcutter', quarry: 'stonecutter', farm: 'farmer', kiln: 'tiler', market: 'trader', inn: 'innkeeper', windmill: 'miller', lighthouse: 'keeper' };
const SCALE = 0.72;
const UPPER = /^(chest|upperarm|lowerarm|wrist|hand|head|elbowIK|handIK)/;

type V3 = [number, number, number];
/** An animation: a full clip, or an upper-body clip over a lower-body clip. */
interface AnimSpec { full?: string; up?: string; low?: string; speed?: number }
const A = {
  walk: (c: Cit): AnimSpec => ({ full: c.walk, speed: c.look.elder ? 0.8 : 1 }),
  run: { full: 'Running_A' }, runKid: { full: 'Running_B' },
  idle: { full: 'Idle' }, idle2: { full: 'Unarmed_Idle' },
  chop: { full: '2H_Melee_Attack_Chop', speed: 0.8 }, hammer: { full: '1H_Melee_Attack_Chop', speed: 0.85 }, hoe: { full: '2H_Melee_Attack_Chop', speed: 0.6 },
  tinker: { up: 'Use_Item', low: 'Idle' }, interact: { full: 'Interact' }, pickup: { full: 'PickUp' },
  carry: { up: '2H_Melee_Idle', low: 'Walking_A' }, carryStand: { up: '2H_Melee_Idle', low: 'Idle' },
  sweep: { up: '2H_Melee_Attack_Slice', low: 'Idle', speed: 0.55 },
  talk: { up: 'Spellcasting', low: 'Idle', speed: 0.7 }, walkTalk: { up: 'Spellcasting', low: 'Walking_B', speed: 0.8 },
  lute: { up: '2H_Ranged_Aiming', low: 'Sit_Floor_Idle' }, luteStand: { up: '2H_Ranged_Aiming', low: 'Idle' },
  sit: { full: 'Sit_Chair_Idle' }, sitFloor: { full: 'Sit_Floor_Idle' }, lie: { full: 'Lie_Idle' },
  drink: { up: 'Use_Item', low: 'Sit_Chair_Idle', speed: 0.6 }, cheer: { full: 'Cheer' }, dance: { up: 'Cheer', low: 'Jump_Idle' },
  jump: { full: 'Jump_Full_Short' }, throw: { full: 'Throw', speed: 0.9 }, catch: { up: 'Block', low: 'Idle' },
} satisfies Record<string, AnimSpec | ((c: Cit) => AnimSpec)>;

type Task =
  | { k: 'go'; pts: V3[]; seg: number; t: number; anim: AnimSpec; speed: number; label: string }
  | { k: 'do'; anim: AnimSpec; time: number; look?: V3; label: string; fx?: 'strum' | 'talk' | 'ball' }
  | { k: 'follow'; leader: Cit; anim: AnimSpec; side: number; lag: number; label: string }
  | { k: 'prop'; kind: PropKind | null }
  | { k: 'gone' };

interface Cit {
  id: number; name: string; look: Look; root: THREE.Object3D; bones: Record<string, THREE.Bone>; mixer: THREE.AnimationMixer;
  actions: THREE.AnimationAction[]; animKey: string; walk: string; speed: number;
  home: number; work: number; at: number; pos: THREE.Vector3; heading: number;
  tasks: Task[]; label: string; prop: THREE.Mesh | null; fx?: 'strum' | 'talk' | 'ball'; partner?: Cit; spotKey?: string; mats: THREE.Material[];
}

export class Residents {
  group = new THREE.Group();
  private kit!: CitizenKit;
  private clips = new Map<string, THREE.AnimationClip>();
  private cits: Cit[] = [];
  private navVersion = -1;
  private adj: { to: number; pts: V3[] }[][] = [];
  private nid = 1;
  private taken = new Map<string, Cit>(); // spot occupancy
  private sigs = new Set<string>();
  private balls: { a: Cit; b: Cit; mesh: THREE.Mesh; t0: number }[] = [];
  private propMat: THREE.Material | null = null;
  ready = false;

  constructor(private shared: Record<string, THREE.IUniform>) {}

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
    const c: Cit = {
      id, name, look, root, bones, mixer: new THREE.AnimationMixer(root), actions: [], animKey: '', mats,
      walk: kid ? 'Walking_C' : ['Walking_A', 'Walking_B', 'Walking_C'][Math.floor(rnd() * 3)], speed: (kid ? 1.25 : look.elder ? 0.8 : 1.0) + rnd() * 0.25,
      home, work: -1, at: home, pos: new THREE.Vector3(), heading: rnd() * 6.28, tasks: [], label: 'stepping out', prop: null,
    };
    const door = this.door(world, home);
    if (door) c.pos.set(door[0], door[1], door[2]);
    root.position.copy(c.pos);
    this.play(c, A.interact);
    c.tasks.push({ k: 'do', anim: A.interact, time: 1.2, label: 'stepping out' });
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
    this.balls = this.balls.filter((b) => { if (b.a === c || b.b === c) { this.group.remove(b.mesh); return false; } return true; });
    this.cits.splice(this.cits.indexOf(c), 1);
  }

  clear() { for (const c of [...this.cits]) this.remove(c); this.taken.clear(); }

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
  private neutral(mesh: THREE.Mesh) {
    const u = (this.propMat as THREE.RawShaderMaterial).uniforms;
    mesh.onBeforeRender = () => {
      u.uReveal.value = 1e6; u.uSketch.value = 1e6; u.uClip.value = -1e6;
      u.uIvy.value.set(0, 0); u.uSway.value.set(0, 0, 0, 0);
      (this.propMat as THREE.RawShaderMaterial).uniformsNeedUpdate = true;
    };
    return mesh;
  }

  private setProp(c: Cit, kind: PropKind | null) {
    if (c.prop) { c.prop.removeFromParent(); c.prop = null; }
    if (!kind || !this.propMat) return;
    const hand = c.bones['handslotr'] ?? c.bones['handslot.r'];
    if (!hand) return;
    c.prop = this.neutral(makeProp(kind, this.propMat));
    if (kind === 'crate' || kind === 'sack' || kind === 'basket') {
      // held in front of the chest by both arms (2H idle pose) — ride on the body, not one hand
      c.prop.rotation.set(0, 0, 0);
      c.prop.position.set(0, kind === 'sack' ? 1.05 : 1.15, 0.62);
      c.root.add(c.prop);
    } else hand.add(c.prop);
  }

  // ------------------------------------------------------------ navigation
  private rebuildGraph(world: World) {
    this.adj = world.navLots.map(() => []);
    for (const e of world.nav) {
      if (!this.adj[e.a] || !this.adj[e.b]) continue;
      this.adj[e.a].push({ to: e.b, pts: e.pts });
      this.adj[e.b].push({ to: e.a, pts: [...e.pts].reverse() });
    }
    this.navVersion = world.navVersion;
    const n = world.navLots.length;
    for (const c of [...this.cits]) {
      if (c.home >= n || c.at >= n || c.work >= n) { c.home = Math.min(c.home, n - 1); c.at = Math.max(0, Math.min(c.at, n - 1)); c.work = c.work >= n ? -1 : c.work; c.tasks = []; }
      if (n === 0) this.remove(c);
    }
    this.taken.clear();
  }

  private door(world: World, lot: number): V3 | null { return (world.navLots[lot]?.front as V3) ?? null; }

  private route(from: number, to: number): V3[] | null {
    if (from === to) return [];
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

  /** Walk task(s) from the citizen's position to lot `to` (and on to `spot` if given). */
  private goTo(c: Cit, to: number, anim: AnimSpec, label: string, spot?: V3): boolean {
    const r = this.route(c.at, to);
    if (!r) return false;
    const pts: V3[] = [[c.pos.x, c.pos.y, c.pos.z], ...r];
    if (spot) pts.push(spot);
    c.tasks.push({ k: 'go', pts, seg: 0, t: 0, anim, speed: c.speed, label });
    c.at = to;
    return true;
  }

  private nearestLot(world: World, p: V3) {
    let best = 0, bd = Infinity;
    world.navLots.forEach((L, i) => { const d = Math.hypot(L.front[0] - p[0], L.front[2] - p[2]); if (d < bd) { bd = d; best = i; } });
    return best;
  }

  private claim(c: Cit, key: string) { if (this.taken.has(key)) return false; if (c.spotKey) this.taken.delete(c.spotKey); this.taken.set(key, c); c.spotKey = key; return true; }
  private release(c: Cit) { if (c.spotKey) { this.taken.delete(c.spotKey); c.spotKey = undefined; } }

  // ------------------------------------------------------------ the day planner
  private plan(c: Cit, world: World, night: number, rain: number, tod: number, leaving: boolean) {
    const spots = world.allSpots();
    const rnd = Math.random, kid = c.look.kid;
    const pickSpot = (pred: (s: (typeof spots)[number]) => boolean) => {
      const free = spots.filter((s) => pred(s) && !this.taken.has(`${s.lot}:${s.kind}:${s.p[0].toFixed(1)}:${s.p[2].toFixed(1)}`));
      return free.length ? free[Math.floor(rnd() * free.length)] : null;
    };
    const keyOf = (s: (typeof spots)[number]) => `${s.lot}:${s.kind}:${s.p[0].toFixed(1)}:${s.p[2].toFixed(1)}`;
    const atSpot = (s: (typeof spots)[number], anim: AnimSpec, time: number, label: string, walkLabel: string, prop: PropKind | null = null, fx?: 'strum') => {
      if (!this.claim(c, keyOf(s))) return false;
      if (!this.goTo(c, s.lot, A.walk(c), walkLabel, s.p)) { this.release(c); return false; }
      if (prop) c.tasks.push({ k: 'prop', kind: prop });
      c.tasks.push({ k: 'do', anim, time, look: s.look, label, fx });
      if (prop) c.tasks.push({ k: 'prop', kind: null });
      return true;
    };
    const goHome = (label: string, anim = A.walk(c)) => {
      this.release(c);
      if (this.goTo(c, c.home, anim, label)) { c.tasks.push({ k: 'do', anim: A.interact, time: 1, label: 'going inside' }, { k: 'gone' }); return true; }
      return false;
    };

    if (leaving || (night > 0.6 && rnd() < 0.7) || (rain > 0.6 && rnd() < 0.6)) {
      if (goHome(rain > 0.6 ? 'hurrying home out of the rain' : 'heading home', rain > 0.6 ? A.run : A.walk(c))) return;
    }
    const open = world.open;
    const grass = () => open[Math.floor(rnd() * open.length)];

    if (kid) {
      const g = open.length ? grass() : null;
      if (g && rnd() < 0.85) {
        const lot = this.nearestLot(world, g);
        const mate = this.cits.find((o) => o !== c && o.look.kid && o.tasks.length === 0 && o.at === c.at);
        const r = rnd();
        if (mate && r < 0.45) { // ball game
          const a: V3 = [g[0] - 2, g[1], g[2]], b: V3 = [g[0] + 2, g[1], g[2]];
          if (this.goTo(c, lot, A.runKid, 'running off to play', a) && this.goTo(mate, lot, A.runKid, 'running off to play', b)) {
            c.tasks.push({ k: 'do', anim: A.throw, time: 12, look: b, label: 'playing catch', fx: 'ball' });
            mate.tasks.push({ k: 'do', anim: A.throw, time: 12, look: a, label: 'playing catch', fx: 'ball' });
            c.partner = mate; mate.partner = c;
            return;
          }
        }
        if (mate && r < 0.8) { // tag
          if (this.goTo(c, lot, A.runKid, 'playing tag', g)) {
            for (let i = 0; i < 4; i++) c.tasks.push({ k: 'go', pts: [g, [g[0] + (rnd() - 0.5) * 7, g[1], g[2] + (rnd() - 0.5) * 7]], seg: 0, t: 0, anim: A.runKid, speed: 2.2, label: 'playing tag — "you\'re it!"' });
            mate.tasks.push({ k: 'follow', leader: c, anim: A.runKid, side: 0, lag: 1.6, label: 'playing tag — chasing' });
            return;
          }
        }
        if (this.goTo(c, lot, A.walk(c), 'skipping about', g)) { c.tasks.push({ k: 'do', anim: rnd() < 0.5 ? A.jump : A.dance, time: 6, label: 'jumping about' }); return; }
      }
    }

    // grown-ups
    const job = c.work >= 0 ? world.navLots[c.work] : null;
    const workSpot = c.work >= 0 ? spots.find((s) => s.lot === c.work && (s.kind === 'work' || s.kind === 'stall')) : null;
    const day = night < 0.3, evening = tod > 0.55 && tod < 0.8;
    const r = rnd();
    // lamplighter at dusk
    if (evening && world.lamps.length && !this.cits.some((o) => o.label.startsWith('lighting')) && r < 0.25) {
      for (const lp of world.lamps.slice(0, 3)) {
        const lot = this.nearestLot(world, lp);
        if (!this.goTo(c, lot, A.walk(c), 'off to light the lamps', [lp[0] + 0.7, lp[1], lp[2]])) break;
        c.tasks.push({ k: 'do', anim: A.interact, time: 2, look: lp, label: 'lighting the lamps' });
      }
      return;
    }
    if (job && workSpot && day && r < 0.5) {
      const t = workSpot.tool;
      const anim = t === 'axe' ? A.chop : t === 'hammer' ? A.hammer : t === 'hoe' ? A.hoe : workSpot.kind === 'stall' ? A.tinker : A.tinker;
      const verb = t === 'axe' ? 'chopping wood' : t === 'hammer' ? 'dressing stone' : t === 'hoe' ? 'hoeing the beds' : workSpot.kind === 'stall' ? 'minding the stall' : 'tending the kiln';
      if (atSpot(workSpot, anim, 10 + rnd() * 10, verb, 'off to work', t ?? null)) {
        if (rnd() < 0.5) { // haul the goods somewhere
          const dest = world.navLots.findIndex((L) => L.main) >= 0 ? world.navLots.findIndex((L) => L.main) : c.home;
          const goods: PropKind = c.work >= 0 && world.specs[c.work]?.role === 'farm' ? (rnd() < 0.5 ? 'sack' : 'basket') : 'crate';
          c.tasks.push({ k: 'do', anim: A.pickup, time: 1.1, label: 'picking up the goods' }, { k: 'prop', kind: goods });
          const lot = dest;
          const r2 = this.route(c.work, lot);
          if (r2) { c.tasks.push({ k: 'go', pts: r2, seg: 0, t: 0, anim: A.carry, speed: c.speed * 0.85, label: `carrying ${goods === 'crate' ? 'a crate' : goods === 'sack' ? 'a sack of grain' : 'a basket of greens'}` }); }
          c.tasks.push({ k: 'do', anim: A.pickup, time: 1.0, label: 'setting it down' }, { k: 'prop', kind: null });
          c.at = r2 ? lot : c.work;
        }
        return;
      }
    }
    if (r < 0.62 && day) { // sweep the doorstep
      const d = spots.find((s) => s.lot === c.home && s.kind === 'door');
      if (d && atSpot(d, A.sweep, 7, 'sweeping the doorstep', 'heading home', 'broom')) return;
    }
    if (r < 0.74) { // stroll and chat with a neighbour
      const mate = this.cits.find((o) => o !== c && !o.look.kid && o.tasks.length === 0 && o.at === c.at);
      const dest = Math.floor(rnd() * world.navLots.length);
      if (mate && dest !== c.at && this.goTo(c, dest, A.walkTalk, `strolling with ${mate.name}, deep in talk`)) {
        c.tasks.push({ k: 'do', anim: A.talk, time: 5, label: `chatting with ${mate.name}`, fx: 'talk' });
        mate.tasks.push({ k: 'follow', leader: c, anim: A.walkTalk, side: 1, lag: 0, label: `strolling with ${c.name}, deep in talk` });
        mate.tasks.push({ k: 'do', anim: A.talk, time: 5, label: `chatting with ${c.name}`, fx: 'talk' });
        c.partner = mate; mate.partner = c;
        mate.at = dest;
        return;
      }
    }
    if (r < 0.82) { // music
      const s = pickSpot((s) => s.kind === 'fountain') ?? pickSpot((s) => s.kind === 'door' && (s.role === 'inn' || s.role === 'keep'));
      if (s && atSpot(s, s.kind === 'fountain' ? A.lute : A.luteStand, 14, 'playing the lute', 'off to busk', 'lute', 'strum')) return;
    }
    if (r < 0.9) { // the inn / the fountain
      const s = pickSpot((s) => s.kind === 'drink') ?? pickSpot((s) => s.kind === 'fountain');
      if (s && atSpot(s, s.kind === 'drink' ? A.drink : A.sit, 12, s.kind === 'drink' ? 'having an ale' : 'resting by the fountain', 'wandering over', s.kind === 'drink' ? 'mug' : null)) return;
    }
    if (open.length && day && rain < 0.3) { // the grass
      const g = grass(), lot = this.nearestLot(world, g);
      const lie = rnd() < 0.4 && !c.look.elder;
      if (this.goTo(c, lot, A.walk(c), 'out for some air', g)) { c.tasks.push({ k: 'do', anim: lie ? A.lie : A.sitFloor, time: 10, label: lie ? 'lazing in the grass' : 'sitting in the grass' }); return; }
    }
    // otherwise visit somewhere and look around
    const dest = Math.floor(rnd() * world.navLots.length);
    if (this.goTo(c, dest, A.walk(c), 'running errands')) c.tasks.push({ k: 'do', anim: rnd() < 0.5 ? A.interact : A.idle2, time: 2 + rnd() * 3, label: 'knocking on a door' });
    else c.tasks.push({ k: 'do', anim: A.idle, time: 3, label: 'looking about' });
  }

  // ------------------------------------------------------------ simulation
  private target(world: World, night: number, rain: number) {
    return Math.round(Math.min(30, world.econ.pop * 0.75) * (1 - 0.6 * night) * (1 - 0.45 * rain));
  }

  update(dt: number, world: World, night: number, rain: number, tod = 0.4) {
    if (!this.ready) return;
    if (this.navVersion !== world.navVersion) this.rebuildGraph(world);
    const lots = world.navLots;
    if (!lots.length) return;
    const want = this.target(world, night, rain);
    if (this.cits.length < want && Math.random() < dt * 1.5) {
      const homes = world.specs.map((s, i) => [s, i] as const).filter(([s]) => ['house', 'keep', 'inn'].includes(s.role) || Math.random() < 0.2);
      const home = homes.length ? homes[Math.floor(Math.random() * homes.length)][1] : 0;
      const kid = Math.random() < 0.22;
      const c = this.spawn(world, home, kid);
      if (!kid) { // take a job where one is free
        const jobs = world.specs.map((s, i) => [s, i] as const).filter(([s]) => TRADE[s.role]);
        const free = jobs.filter(([s, i]) => this.cits.filter((o) => o.work === i).length < Math.max(1, s.blocks * 2));
        if (free.length && Math.random() < 0.8) c.work = free[Math.floor(Math.random() * free.length)][1];
      }
    }
    const leaving = this.cits.length > want + 1;
    const t = performance.now() / 1000;

    for (const c of [...this.cits]) {
      c.mixer.update(dt);
      if (!c.tasks.length) this.plan(c, world, night, rain, tod, leaving && !c.partner);
      const task = c.tasks[0];
      if (!task) continue;
      c.label = 'label' in task ? task.label : c.label;
      c.fx = undefined;
      if (task.k === 'gone') { this.remove(c); continue; }
      if (task.k === 'prop') { this.setProp(c, task.kind); c.tasks.shift(); continue; }
      if (task.k === 'go') {
        this.play(c, task.anim);
        let move = dt * task.speed * (task.anim === A.run || task.anim === A.runKid ? 2.0 : task.anim === A.carry ? 0.85 : 1);
        while (move > 0 && task.seg < task.pts.length - 1) {
          const p0 = task.pts[task.seg], p1 = task.pts[task.seg + 1];
          const len = Math.hypot(p1[0] - p0[0], p1[2] - p0[2]) || 1e-3;
          const left = (1 - task.t) * len;
          if (move < left) { task.t += move / len; move = 0; } else { move -= left; task.seg++; task.t = 0; }
        }
        if (task.pts.length < 2 || task.seg >= task.pts.length - 1) { const e = task.pts[task.pts.length - 1]; if (e) c.pos.set(e[0], e[1], e[2]); c.tasks.shift(); }
        else {
          const p0 = task.pts[task.seg], p1 = task.pts[task.seg + 1];
          c.pos.set(p0[0] + (p1[0] - p0[0]) * task.t, p0[1] + (p1[1] - p0[1]) * task.t, p0[2] + (p1[2] - p0[2]) * task.t);
          this.face(c, Math.atan2(p1[0] - p0[0], p1[2] - p0[2]), dt * 8);
        }
      } else if (task.k === 'do') {
        this.play(c, task.anim);
        if (task.look) this.face(c, Math.atan2(task.look[0] - c.pos.x, task.look[2] - c.pos.z), dt * 6);
        c.fx = task.fx;
        task.time -= dt;
        if (task.fx === 'ball' && c.partner && !this.balls.some((b) => b.a === c || b.b === c) && this.propMat) {
          const mesh = this.neutral(makeBall(this.propMat)); this.group.add(mesh); this.balls.push({ a: c, b: c.partner, mesh, t0: t });
        }
        if (task.time <= 0) {
          c.tasks.shift();
          if (!c.tasks.length || c.tasks[0].k !== 'do') this.release(c);
          if (task.fx === 'ball' || task.fx === 'talk') c.partner = undefined;
          this.balls = this.balls.filter((b) => { if (b.a === c) { this.group.remove(b.mesh); return false; } return true; });
        }
      } else if (task.k === 'follow') {
        const L = task.leader;
        if (!this.cits.includes(L) || !L.tasks.length || L.tasks[0].k !== 'go') { c.tasks.shift(); continue; }
        this.play(c, task.anim);
        const fx = Math.sin(L.heading), fz = Math.cos(L.heading);
        const tx = L.pos.x + fz * 0.75 * task.side - fx * task.lag, tz = L.pos.z - fx * 0.75 * task.side - fz * task.lag;
        const k = Math.min(1, dt * (task.lag ? 3 : 6));
        const dx = tx - c.pos.x, dz = tz - c.pos.z;
        c.pos.set(c.pos.x + dx * k, L.pos.y, c.pos.z + dz * k);
        this.face(c, task.lag ? Math.atan2(L.pos.x - c.pos.x, L.pos.z - c.pos.z) : L.heading, dt * 6);
        c.fx = task.side ? 'talk' : undefined;
      }
      c.root.position.copy(c.pos);
      c.root.rotation.y = c.heading;
    }
    // post-animation touches: strumming, heads turned in conversation, children's big heads, elders' stoop
    for (const c of this.cits) {
      const B = c.bones;
      if (c.look.kid && B.head) B.head.scale.setScalar(1.28);
      if (c.look.elder && B.spine) B.spine.rotateX(0.22);
      if (c.fx === 'strum' && B.lowerarmr) B.lowerarmr.rotateZ(Math.sin(t * 13 + c.id) * 0.22);
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
  census() { return this.cits.map((c) => ({ name: c.name, kid: c.look.kid, sig: c.look.sig, label: c.label })); }
}
