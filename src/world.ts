import * as THREE from 'three';
import { BSpec, Built, Gen, GenParams, Lot, STYLES, Site, bridgePoints, buildBuilding, buildGround, buildTerrain } from './tower';
import { RNG } from './rng';

export const MAX_BLOCKS = 14;

interface Snapshot { specs: BSpec[]; bridges: [number, number][]; nextId: number }

export type Pick =
  | { kind: 'building'; id: number; point: THREE.Vector3 }
  | { kind: 'ground'; point: THREE.Vector3 }
  | null;

/** Holds the city state (building specs + bridges) and keeps meshes in sync with it. */
export class World {
  g: Gen;
  site: Site;
  specs: BSpec[] = [];
  bridges: [number, number][] = [];
  nextId = 1;
  built = new Map<number, Built & { mesh: THREE.Mesh }>();
  terrain: THREE.Mesh | null = null;
  ground: THREE.Mesh | null = null;
  undoStack: Snapshot[] = [];
  onChange: (() => void) | null = null;

  constructor(public p: GenParams, public group: THREE.Group, public mat: THREE.Material) {
    this.g = new Gen(p);
    this.site = new Site(p, this.g);
  }

  get dominantStyle() { return STYLES.indexOf(new Gen(this.p).style); }
  get extent() { return this.site.RI; }
  get top() { let t = 10; for (const b of this.built.values()) t = Math.max(t, b.top); return t; }

  /** Fresh site; optionally populated with a generated town. */
  reset(p: GenParams, populate: boolean) {
    this.p = p;
    this.g = new Gen(p);
    this.site = new Site(p, this.g);
    for (const b of this.built.values()) { this.group.remove(b.mesh); b.geo.dispose(); }
    this.built.clear();
    if (this.terrain) { this.group.remove(this.terrain); this.terrain.geometry.dispose(); }
    this.terrain = new THREE.Mesh(buildTerrain(this.site), this.mat);
    this.group.add(this.terrain);
    this.nextId = 1;
    this.bridges = [];
    this.undoStack = [];
    this.specs = populate ? this.site.plan(() => this.nextId++) : [];
    if (populate) this.autoBridges();
    for (const s of this.specs) this.rebuild(s.id, false);
    this.rebuildGround();
  }

  private autoBridges() {
    // build once to learn block heights, then connect close tall pairs
    const rng = new RNG(this.p.seed ^ 0xb21d);
    const lots = new Map<number, Lot>();
    for (const s of this.specs) lots.set(s.id, buildBuilding(this.g, this.site, s).lot);
    for (let i = 0; i < this.specs.length; i++) for (let j = i + 1; j < this.specs.length; j++) {
      const A = this.specs[i], B = this.specs[j];
      if (Math.hypot(A.x - B.x, A.z - B.z) > 12 || !rng.chance(0.55)) continue;
      if (bridgePoints(lots.get(A.id)!, lots.get(B.id)!)) this.bridges.push([A.id, B.id]);
    }
  }

  spec(id: number) { return this.specs.find((s) => s.id === id); }

  rebuild(id: number, ground = true, reveal = false) {
    const s = this.spec(id);
    const old = this.built.get(id);
    const oldTop = old ? old.lot.blocks.reduce((m, b) => Math.max(m, b.y0 + b.h), old.lot.top) : null;
    if (old) { this.group.remove(old.mesh); old.geo.dispose(); this.built.delete(id); }
    if (s) {
      const b = buildBuilding(this.g, this.site, s);
      const mesh = new THREE.Mesh(b.geo, this.mat);
      mesh.userData.id = id;
      if (reveal) mesh.userData.reveal = { from: oldTop ?? b.lot.base, to: b.top + 6, t0: performance.now() };
      this.group.add(mesh);
      this.built.set(id, { ...b, mesh });
    }
    if (ground) this.rebuildGround();
  }

  rebuildGround() {
    if (this.ground) { this.group.remove(this.ground); this.ground.geometry.dispose(); }
    const byId = (id: number) => this.built.get(id)?.lot;
    const pairs: [Lot, Lot][] = [];
    for (const [a, b] of this.bridges) { const A = byId(a), B = byId(b); if (A && B) pairs.push([A, B]); }
    const lots = this.specs.map((s) => this.built.get(s.id)!.lot);
    this.ground = new THREE.Mesh(buildGround(this.g, this.site, lots, pairs, this.p.seed), this.mat);
    this.group.add(this.ground);
    this.onChange?.();
  }

  // ------------------------------------------------------------ actions (all undoable)
  private snap() {
    this.undoStack.push(structuredClone({ specs: this.specs, bridges: this.bridges, nextId: this.nextId }));
    if (this.undoStack.length > 100) this.undoStack.shift();
  }

  undo() {
    const s = this.undoStack.pop();
    if (!s) return false;
    const before = new Map(this.specs.map((x) => [x.id, JSON.stringify(x)]));
    this.specs = s.specs; this.bridges = s.bridges; this.nextId = s.nextId;
    const ids = new Set([...before.keys(), ...this.specs.map((x) => x.id)]);
    for (const id of ids) {
      const now = this.spec(id);
      if (!now || before.get(id) !== JSON.stringify(now)) this.rebuild(id, false);
    }
    this.rebuildGround();
    return true;
  }

  /** Size + facing a new building at (x,z) would get. */
  proposal(x: number, z: number): { spec: BSpec; error: string | null } {
    const seed = (Math.floor(x * 73.1) * 1013 + Math.floor(z * 91.7) * 7919 + this.p.seed) >>> 0;
    const rng = new RNG(seed);
    const main = this.specs.length === 0;
    const w = main ? rng.range(3.8, 5.4) : rng.range(3.0, 4.6), d = main ? rng.range(3.6, 4.8) : rng.range(3.0, 4.2);
    const dom = this.dominantStyle;
    const spec: BSpec = {
      id: -1, seed, x, z, w, d, rot: this.site.facing(x, z, this.specs) + rng.range(-0.15, 0.15), main,
      blocks: 1, style: rng.chance(0.7) ? dom : rng.int(0, STYLES.length - 1), splitAt: rng.chance(0.3) ? rng.int(1, 3) : -1,
    };
    return { spec, error: this.site.check(x, z, w, d, this.specs, main) };
  }

  found(x: number, z: number): string | null {
    const { spec, error } = this.proposal(x, z);
    if (error) return error;
    this.snap();
    spec.id = this.nextId++;
    this.specs.push(spec);
    this.rebuild(spec.id, true, true);
    return null;
  }

  addFloor(id: number): string | null {
    const s = this.spec(id);
    if (!s) return null;
    if (s.blocks >= MAX_BLOCKS) return 'it cannot grow any taller';
    this.snap();
    s.blocks++;
    this.rebuild(id, true, true);
    return null;
  }

  removeFloor(id: number): string | null {
    const s = this.spec(id);
    if (!s) return null;
    if (s.blocks <= 1) return 'only the ground floor is left — use Demolish';
    this.snap();
    s.blocks--;
    this.rebuild(id);
    return null;
  }

  demolish(id: number) {
    if (!this.spec(id)) return;
    this.snap();
    const wasMain = this.spec(id)!.main;
    this.specs = this.specs.filter((s) => s.id !== id);
    this.bridges = this.bridges.filter(([a, b]) => a !== id && b !== id);
    this.rebuild(id, false);
    if (wasMain && this.specs.length) { // the tallest remaining building inherits the plinth
      const next = this.specs.reduce((a, b) => (b.blocks > a.blocks ? b : a));
      next.main = true;
      this.rebuild(next.id, false);
    }
    this.rebuildGround();
  }

  bridge(a: number, b: number): string | null {
    if (a === b) return null;
    if (this.bridges.some(([x, y]) => (x === a && y === b) || (x === b && y === a))) return 'already connected';
    const A = this.built.get(a)?.lot, B = this.built.get(b)?.lot;
    if (!A || !B) return null;
    if (!bridgePoints(A, B)) return 'both buildings need upper floors at a shared height, within reach';
    this.snap();
    this.bridges.push([a, b]);
    this.rebuildGround();
    return null;
  }

  // ------------------------------------------------------------ picking
  /** March the ray; buildings are approximated as columns over their footprint. */
  pick(ray: THREE.Ray): Pick {
    const p = new THREE.Vector3();
    const cols = [...this.built.entries()].map(([id, b]) => ({ id, b, r: Math.max(b.lot.w, b.lot.d) / 2 + 0.6 }));
    let prevT = 0;
    for (let t = 1; t < 600; t += t < 80 ? 0.25 : 0.6) {
      ray.at(t, p);
      for (const c of cols) {
        const L = c.b.lot;
        if (p.y < L.base || p.y > c.b.top) continue;
        const r = p.y < L.top + 0.1 ? L.rad : c.r + (p.y - L.top) * 0.06;
        if (Math.hypot(p.x - L.x, p.z - L.z) < r) return { kind: 'building', id: c.id, point: p.clone() };
      }
      const h = this.site.sea !== null ? Math.max(this.site.H(p.x, p.z), this.site.sea) : this.site.H(p.x, p.z);
      if (p.y < h) {
        let a = prevT, b = t;
        for (let i = 0; i < 8; i++) {
          const m = (a + b) / 2; ray.at(m, p);
          const hm = this.site.sea !== null ? Math.max(this.site.H(p.x, p.z), this.site.sea) : this.site.H(p.x, p.z);
          if (p.y < hm) b = m; else a = m;
        }
        ray.at(b, p);
        return { kind: 'ground', point: p.clone() };
      }
      prevT = t;
    }
    return null;
  }

  label(id: number) {
    const s = this.spec(id);
    if (!s) return '';
    const b = this.built.get(id)!;
    const storeys = Math.round((b.top - b.lot.top) / 2.6);
    return `${s.main ? 'Keep' : 'House'} · ${s.blocks} block${s.blocks > 1 ? 's' : ''} · ~${Math.max(1, storeys)} storeys`;
  }
}
