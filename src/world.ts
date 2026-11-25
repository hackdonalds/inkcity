import * as THREE from 'three';
import { BSpec, Built, Gen, GenParams, Lot, NavEdge, STYLES, Site, bridgePoints, buildBuilding, buildGround, buildScaffold, buildTerrain, obbOverlap, wallDist } from './tower';
import type { Laundry } from './ambient';

export const BUILD_MS = 5000, WASH_MS = 1800;
import { RNG } from './rng';
import { BESPOKE, COSTS, Cost, EconBuilding, Economy, LANDMARKS, ROLES, Role, fmtCost } from './economy';

export const MAX_BLOCKS = 14;
export type Sfx = 'wood' | 'stone' | 'knock' | 'bridge' | 'demolish' | 'crash' | 'creak';
export interface SaveCore { specs: BSpec[]; bridges: [number, number][]; nextId: number; econ: ReturnType<Economy['snapshot']> }
export const MAX_BRACES = 4;
export type MatMode = 'auto' | 'T' | 'S';

interface Snapshot { specs: BSpec[]; bridges: [number, number][]; nextId: number; econ: ReturnType<Economy['snapshot']> }

export type Pick =
  | { kind: 'building'; id: number; point: THREE.Vector3 }
  | { kind: 'ground'; point: THREE.Vector3 }
  | null;

export interface Debris { mesh: THREE.Mesh; t0: number; pivot: THREE.Vector3; axis: THREE.Vector3; clip: number }

export const stabilityWord = (s: number) => (s >= 0.35 ? 'solid' : s >= 0.15 ? 'creaky' : s >= 0 ? 'wobbly' : 'collapsing');

/** Holds the city state (building specs + bridges + economy) and keeps meshes in sync with it. */
export class World {
  g: Gen;
  site: Site;
  specs: BSpec[] = [];
  bridges: [number, number][] = [];
  nextId = 1;
  built = new Map<number, Built & { mesh: THREE.Mesh; stability: number }>();
  terrain: THREE.Mesh | null = null;
  ground: THREE.Mesh | null = null;
  undoStack: Snapshot[] = [];
  econ = new Economy();
  debris: Debris[] = [];
  /** buildings that will give way shortly: id → time */
  doomed = new Map<number, number>();
  people = 0;
  /** walkable path graph for residents (indexes into navLots) */
  nav: NavEdge[] = [];
  navLots: Lot[] = [];
  navVersion = 0;
  laundry: Laundry[] = [];
  /** open grass for leisure + lamp posts (from the ground builder) */
  open: [number, number, number][] = [];
  lamps: [number, number, number][] = [];
  /** things citizens must walk around (from the ground builder) */
  obstacles: import('./tower').Obstacle[] = [];
  /** activity spots out in the landscape (wells, piers, fences, viewpoints…) */
  groundSpots: import('./tower').Spot[] = [];
  boats: { x: number; z: number; yaw: number }[] = [];
  /** floors under construction: drawn as ink sketches inside scaffolding until painted */
  building = new Map<number, { y: number; t0: number; scaffold: THREE.Mesh }>();
  onChange: (() => void) | null = null;
  onEvent: ((msg: string) => void) | null = null;
  onSfx: ((name: Sfx) => void) | null = null;
  /** storm load taken off every building's stability while a storm rages */
  storm = 0;
  private damage: { id: number; at: number }[] = [];
  private previewCache = new Map<string, number>();

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
    for (const d of this.debris) { this.group.remove(d.mesh); d.mesh.geometry.dispose(); }
    this.debris = [];
    this.doomed.clear();
    this.built.clear();
    this.previewCache.clear();
    if (this.terrain) { this.group.remove(this.terrain); this.terrain.geometry.dispose(); }
    for (const c of this.building.values()) { this.group.remove(c.scaffold); c.scaffold.geometry.dispose(); }
    this.building.clear();
    this.terrain = new THREE.Mesh(buildTerrain(this.site), this.mat);
    this.boats = this.site.boatSpots(2);
    this.group.add(this.terrain);
    this.nextId = 1;
    this.bridges = [];
    this.undoStack = [];
    this.econ = new Economy();
    this.specs = populate ? this.site.plan(() => this.nextId++) : [];
    if (populate) this.autoBridges();
    for (const s of this.specs) this.rebuild(s.id, false);
    // generated towns: everything that would fall gets braced, and the town starts settled
    if (populate) {
      for (const s of this.specs) {
        while (this.built.get(s.id)!.stability < 0.12 && s.braces < MAX_BRACES) { s.braces++; this.rebuild(s.id, false); }
        while (this.built.get(s.id)!.stability < 0.02 && s.blocks > 1) { s.blocks--; this.rebuild(s.id, false); }
      }
      const c = this.econ.census(this.econBuildings());
      this.econ.pop = Math.floor(Math.min(c.housing * 0.8, c.jobs + 4));
      this.econ.res = { wood: 40, stone: 20, tiles: 8, food: 40 };
    } else {
      this.econ.pop = 0;
    }
    this.rebuildGround();
  }

  private autoBridges() {
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
  bridgeCount(id: number) { return this.bridges.filter(([a, b]) => a === id || b === id).length; }

  // ------------------------------------------------------------ stability
  /**
   * 1 = rock solid, 0 = about to go. Tall + narrow + leaning + timber = bad;
   * a stone base, braces and bridges to neighbours help.
   */
  stabilityOf(s: BSpec, L: Lot): number {
    const bl = L.blocks;
    if (!bl.length) return 1;
    const base = bl[0];
    const B = Math.min(base.w, base.d);
    const top = bl.reduce((m, k) => Math.max(m, k.y0 + k.h), L.top);
    const H = top - L.top;
    const b0 = base.xf([0, 0, 0]);
    let mx = 0, mz = 0, mt = 0, timber = 0;
    bl.forEach((k, i) => {
      const c = k.xf([0, k.h / 2, 0]);
      const m = k.w * k.d * k.h;
      mx += c[0] * m; mz += c[2] * m; mt += m;
      if (s.mats[i] === 'T') timber++;
    });
    const off = Math.hypot(mx / mt - b0[0], mz / mt - b0[2]);
    const load = H / (B * 11) + 0.35 * (off / (B / 2)) + 0.03 * timber;
    const stoneBase = s.mats[0] === 'S' || (s.mats[0] !== 'T' && (s.main || s.role === 'quarry'));
    const cap = 1 + 0.35 * Math.min(s.braces, MAX_BRACES) + 0.25 * this.bridgeCount(s.id) + 0.2 * (s.flush?.length ?? 0) + (stoneBase ? 0.2 : 0) + (s.main ? 0.3 : 0);
    return 1 - load / cap - this.storm;
  }

  /** Stability if `change` were applied (cached; builds geometry off-scene). */
  previewStability(id: number, change: Partial<BSpec>): number {
    const s = this.spec(id)!;
    const t = { ...s, ...change };
    const key = JSON.stringify(t) + this.bridgeCount(id) + '|' + this.storm;
    let v = this.previewCache.get(key);
    if (v === undefined) {
      const b = buildBuilding(this.g, this.site, t);
      b.geo.dispose();
      v = this.stabilityOf(t, b.lot);
      if (this.previewCache.size > 200) this.previewCache.clear();
      this.previewCache.set(key, v);
    }
    return v;
  }

  // ------------------------------------------------------------ meshes
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
      const stability = this.stabilityOf(s, b.lot);
      mesh.userData.sway = { x: b.lot.x, z: b.lot.z, base: b.lot.top, amp: Math.max(0, 0.3 - stability) * 0.12 };
      this.group.add(mesh);
      this.built.set(id, { ...b, mesh, stability });
      if (stability < 0 && !this.doomed.has(id)) { this.doomed.set(id, performance.now() + 1600); this.onSfx?.('creak'); }
      if (stability >= 0) this.doomed.delete(id);
    }
    if (ground) this.rebuildGround();
  }

  rebuildGround() {
    if (this.ground) { this.group.remove(this.ground); this.ground.geometry.dispose(); }
    const byId = (id: number) => this.built.get(id)?.lot;
    const pairs: [Lot, Lot][] = [];
    for (const [a, b] of this.bridges) { const A = byId(a), B = byId(b); if (A && B) pairs.push([A, B]); }
    const lots = this.specs.map((s) => this.built.get(s.id)!.lot);
    this.people = Math.min(14, Math.ceil(this.econ.pop / 3));
    this.nav = [];
    this.navLots = lots;
    const gout = { open: [] as [number, number, number][], lamps: [] as [number, number, number][], obstacles: [] as import('./tower').Obstacle[], spots: [] as import('./tower').Spot[] };
    this.ground = new THREE.Mesh(buildGround(this.g, this.site, lots, pairs, this.p.seed, 0, this.nav, gout), this.mat);
    this.open = gout.open; this.lamps = gout.lamps; this.obstacles = gout.obstacles; this.groundSpots = gout.spots;
    this.navVersion++;
    this.computeLaundry();
    this.group.add(this.ground);
    this.restability();
    this.onChange?.();
  }

  /** Recompute every building's stability (bridges, party walls and storms affect neighbours). */
  restability() {
    for (const s of this.specs) {
      const b = this.built.get(s.id);
      if (!b) continue;
      b.stability = this.stabilityOf(s, b.lot);
      b.mesh.userData.sway.amp = Math.max(0, 0.3 - b.stability) * 0.12;
      if (b.stability < 0 && !this.doomed.has(s.id)) { this.doomed.set(s.id, performance.now() + 1600 + Math.random() * 2500); this.onSfx?.('creak'); }
      if (b.stability >= 0) this.doomed.delete(s.id);
    }
  }

  setStorm(v: number) {
    if (v === this.storm) return;
    this.storm = v;
    this.previewCache.clear();
    this.restability();
    this.onChange?.();
  }

  /** Height of the tallest building above its foundation. */
  tallest() {
    let best = 0;
    for (const b of this.built.values()) best = Math.max(best, b.lot.blocks.reduce((m, k) => Math.max(m, k.y0 + k.h), b.lot.top) - b.lot.top);
    return best;
  }

  /** Bridges whose ends no longer meet anything fall. */
  private pruneBridges() {
    const before = this.bridges.length;
    this.bridges = this.bridges.filter(([a, c]) => {
      const A = this.built.get(a)?.lot, B = this.built.get(c)?.lot;
      return A && B && bridgePoints(A, B);
    });
    const lost = before - this.bridges.length;
    if (lost) this.onEvent?.(lost > 1 ? `${lost} bridges fell` : 'A bridge fell');
  }

  /** Washing lines strung between neighbouring towers that face each other across a gap. */
  private computeLaundry() {
    this.laundry = [];
    for (let i = 0; i < this.specs.length; i++) for (let j = i + 1; j < this.specs.length; j++) {
      const A = this.specs[i], B = this.specs[j];
      const r = new RNG((A.seed ^ B.seed) >>> 0);
      const dist = Math.hypot(A.x - B.x, A.z - B.z);
      if (dist < 5 || dist > 11 || A.blocks < 2 || B.blocks < 2 || !r.chance(0.55)) continue;
      const la = this.built.get(A.id)?.lot, lb = this.built.get(B.id)?.lot;
      if (!la || !lb) continue;
      const topOf = (L: Lot) => L.blocks.reduce((m, k) => Math.max(m, k.y0 + k.h), L.top);
      const y = Math.max(la.top, lb.top) + r.range(2.2, 3.4);
      if (y > Math.min(topOf(la), topOf(lb)) - 0.8) continue;
      const ka = la.blocks.find((k) => y >= k.y0 && y < k.y0 + k.h), kb = lb.blocks.find((k) => y >= k.y0 && y < k.y0 + k.h);
      if (!ka || !kb) continue;
      const ca = la.xf(ka.xf([0, y - ka.y0, 0])), cb = lb.xf(kb.xf([0, y - kb.y0, 0]));
      const dx = cb[0] - ca[0], dz = cb[2] - ca[2], dl = Math.hypot(dx, dz);
      const ra = wallDist(la, ka, y, dx / dl, dz / dl) + 0.05, rb = wallDist(lb, kb, y, -dx / dl, -dz / dl) + 0.05;
      if (dl - ra - rb < 2) continue;
      this.laundry.push({
        p0: [ca[0] + (dx / dl) * ra, y, ca[2] + (dz / dl) * ra], p1: [cb[0] - (dx / dl) * rb, y, cb[2] - (dz / dl) * rb],
        n: Math.max(2, Math.floor((dl - ra - rb) / 0.9)), seed: (A.seed % 997) + j,
      });
    }
  }

  /** Begin the sketch → paint construction phase for a building from height y up. */
  private construct(id: number, y: number) {
    const b = this.built.get(id), s = this.spec(id);
    if (!b || !s) return;
    const old = this.building.get(id);
    if (old) { this.group.remove(old.scaffold); old.scaffold.geometry.dispose(); }
    const k = b.lot.blocks.filter((q) => q.y0 >= y - 0.05);
    const geo = new THREE.BufferGeometry();
    const parts = k.map((q) => buildScaffold(b.lot, q, s.flush ?? ''));
    const scaffold = new THREE.Mesh(parts.length === 1 ? parts[0] : mergeGeos(parts) ?? geo, this.mat);
    this.group.add(scaffold);
    const t0 = performance.now();
    this.building.set(id, { y: old ? Math.min(old.y, y) : y, t0, scaffold });
    b.mesh.userData.sketch = { y: old ? Math.min(old.y, y) : y, t0, top: b.top };
  }

  /** Called every frame: topple anything whose time has come. */
  update(now: number) {
    for (const [id, c] of [...this.building]) {
      const m = this.built.get(id)?.mesh;
      if (m && !m.userData.sketch) m.userData.sketch = { y: c.y, t0: c.t0, top: this.built.get(id)!.top };
      if (now - c.t0 > BUILD_MS + WASH_MS) {
        this.group.remove(c.scaffold); c.scaffold.geometry.dispose(); this.building.delete(id);
        if (m) delete m.userData.sketch;
      }
    }
    for (const [id, t] of [...this.doomed]) if (now >= t) { this.doomed.delete(id); this.collapse(id); }
    for (const d of [...this.damage]) if (now >= d.at) {
      this.damage.splice(this.damage.indexOf(d), 1);
      const v = this.spec(d.id);
      if (!v || BESPOKE.includes(v.role)) continue;
      if (v.blocks > 1) {
        v.blocks--; v.mats = v.mats.slice(0, v.blocks);
        this.rebuild(v.id, false);
        this.pruneBridges();
        this.rebuildGround();
        this.onSfx?.('demolish');
        this.onEvent?.(`Falling masonry smashed the top floor of the ${ROLES[v.role].name.toLowerCase()}!`);
      }
    }
    for (const d of [...this.debris]) {
      const k = (now - d.t0) / 1400;
      if (k >= 1) { this.group.remove(d.mesh); d.mesh.geometry.dispose(); this.debris.splice(this.debris.indexOf(d), 1); continue; }
      const ang = 1.3 * k * k, drop = 9 * k * k;
      const m = new THREE.Matrix4().makeTranslation(d.pivot.x, d.pivot.y - drop, d.pivot.z)
        .multiply(new THREE.Matrix4().makeRotationAxis(d.axis, ang))
        .multiply(new THREE.Matrix4().makeTranslation(-d.pivot.x, -d.pivot.y, -d.pivot.z));
      d.mesh.matrix.copy(m);
      d.mesh.matrixWorldNeedsUpdate = true;
    }
  }

  collapse(id: number) {
    const s = this.spec(id), b = this.built.get(id);
    if (!s || !b) return;
    let lost = 0;
    while (s.blocks > 1) {
      s.blocks--; s.mats = s.mats.slice(0, s.blocks); lost++;
      if (this.previewStability(id, {}) >= 0.08) break;
    }
    // the old mesh becomes falling debris, clipped to the part that broke off
    this.built.delete(id);
    this.rebuild(id, false);
    const nb = this.built.get(id)!;
    const clip = nb.lot.blocks.reduce((m, k) => Math.max(m, k.y0 + k.h), nb.lot.top) - 0.2;
    const mesh = b.mesh;
    mesh.matrixAutoUpdate = false;
    mesh.userData.clip = clip;
    mesh.userData.sway = { ...mesh.userData.sway, amp: 0 };
    const bl = b.lot.blocks;
    const c = b.lot.xf(bl[0].xf([0, 0, 0])), tp = b.lot.xf(bl[bl.length - 1].xf([0, 0, 0]));
    const dw = new THREE.Vector3(tp[0] - c[0], 0, tp[2] - c[2]);
    if (dw.lengthSq() < 1e-3) dw.set(Math.random() - 0.5, 0, Math.random() - 0.5);
    dw.normalize();
    const axis = new THREE.Vector3(0, 1, 0).cross(dw).normalize();
    this.group.add(mesh);
    this.debris.push({ mesh, t0: performance.now(), pivot: new THREE.Vector3(b.lot.x, clip, b.lot.z), axis, clip });
    this.onSfx?.('crash');
    // whatever stands where it falls gets hit
    const fall = b.top - clip;
    for (const o of this.specs) {
      if (o.id === id) continue;
      const ob = this.built.get(o.id);
      if (!ob) continue;
      const rx = o.x - b.lot.x, rz = o.z - b.lot.z;
      const along = rx * dw.x + rz * dw.z, across = Math.abs(-rx * dw.z + rz * dw.x);
      const hitTop = ob.lot.blocks.reduce((m, k) => Math.max(m, k.y0 + k.h), ob.lot.top);
      if (along > 0.5 && along < fall + 1.5 && across < Math.max(o.w, o.d) / 2 + 1.2 && hitTop > clip - fall * 0.8) {
        this.damage.push({ id: o.id, at: performance.now() + 500 + along * 60 });
      }
    }
    this.pruneBridges();
    this.rebuildGround();
    this.onEvent?.(`${s.main ? 'The keep' : ROLES[s.role].name} buckled — ${lost} block${lost > 1 ? 's' : ''} came crashing down!`);
  }

  // ------------------------------------------------------------ economy glue
  econBuildings(): EconBuilding[] {
    return this.specs.map((s) => ({ role: s.role, blocks: s.blocks, stability: this.built.get(s.id)?.stability ?? 1, bridges: this.bridgeCount(s.id) }));
  }
  dayTick(): string[] {
    const ev = this.econ.tick(this.econBuildings());
    if (Math.min(14, Math.ceil(this.econ.pop / 3)) !== this.people) this.rebuildGround();
    else this.onChange?.();
    return ev;
  }

  /** Material actually used for the next block in a mode, and its cost. */
  blockPlan(mode: MatMode): { mat: 'S' | 'T'; cost: Cost } {
    const mat = mode === 'auto' ? (this.econ.can(COSTS.stoneBlock) ? 'S' : 'T') : mode;
    return { mat, cost: mat === 'S' ? COSTS.stoneBlock : COSTS.timberBlock };
  }
  private payRoof(s: BSpec) {
    s.tiles = this.econ.can(COSTS.roofTiles);
    if (s.tiles) this.econ.pay(COSTS.roofTiles);
  }

  // ------------------------------------------------------------ actions (all undoable)
  private snap() {
    this.undoStack.push(structuredClone({ specs: this.specs, bridges: this.bridges, nextId: this.nextId, econ: this.econ.snapshot() }));
    if (this.undoStack.length > 100) this.undoStack.shift();
  }

  undo() {
    const s = this.undoStack.pop();
    if (!s) return false;
    const before = new Map(this.specs.map((x) => [x.id, JSON.stringify(x)]));
    this.specs = s.specs; this.bridges = s.bridges; this.nextId = s.nextId; this.econ.restore(s.econ);
    const ids = new Set([...before.keys(), ...this.specs.map((x) => x.id)]);
    for (const id of ids) {
      const now = this.spec(id);
      if (!now || before.get(id) !== JSON.stringify(now)) this.rebuild(id, false);
    }
    this.rebuildGround();
    return true;
  }

  // ------------------------------------------------------------ landmarks
  /** Why a landmark can't be founded right now (or null). */
  landmarkBlocked(r: Role): string | null {
    if (!LANDMARKS.includes(r)) return null;
    const R = ROLES[r];
    if (r === 'lighthouse' && this.site.sea === null) return 'a lighthouse needs the sea';
    if (this.specs.some((s) => s.role === r)) return `the town already has its ${R.name.toLowerCase()}`;
    if (this.econ.pop < (R.unlock ?? 0)) return `unlocks at ${R.unlock} residents`;
    return null;
  }
  /** Activity spots of every building, tagged with its nav-lot index and role. */
  allSpots() { return this.specs.flatMap((s, i) => (this.built.get(s.id)?.spots ?? []).map((sp) => ({ ...sp, lot: i, role: s.role }))); }
  allSails() { const out: import('./landmarks').Sails[] = []; for (const b of this.built.values()) out.push(...b.sails); return out; }

  // ------------------------------------------------------------ party walls
  /** Which of s's faces sit flush against another building. */
  flushOf(s: BSpec, among: BSpec[] = this.specs): string {
    const c = Math.cos(s.rot), sn = Math.sin(s.rot);
    const out = new Set<string>();
    for (const o of among) {
      if (o === s || o.id === s.id || BESPOKE.includes(o.role) || BESPOKE.includes(s.role)) continue;
      const q = Math.PI / 2;
      const dr = (((o.rot - s.rot) % q) + q) % q;
      if (Math.min(dr, q - dr) > 0.03) continue;
      const dx = o.x - s.x, dz = o.z - s.z;
      const lx = dx * c + dz * sn, lz = -dx * sn + dz * c;
      const swap = Math.abs(Math.sin(o.rot - s.rot)) > 0.5;
      const ow = swap ? o.d : o.w, od = swap ? o.w : o.d;
      if (Math.abs(lz) < (s.d + od) / 2 - 0.5 && Math.abs(Math.abs(lx) - (s.w + ow) / 2) < 0.3) out.add(lx > 0 ? 'R' : 'L');
      if (Math.abs(lx) < (s.w + ow) / 2 - 0.5 && Math.abs(Math.abs(lz) - (s.d + od) / 2) < 0.3) out.add(lz > 0 ? 'F' : 'K');
    }
    return [...out].sort().join('');
  }
  /** Recompute party walls; returns ids whose walls changed (they need rebuilding). */
  private refreshFlush(): number[] {
    const changed: number[] = [];
    for (const s of this.specs) {
      const f = this.flushOf(s);
      if ((s.flush ?? '') !== f) { s.flush = f; changed.push(s.id); }
    }
    return changed;
  }

  /**
   * Snap a new building flush against a neighbour's side (same facing, fronts aligned)
   * or its back (turned round so both doors face out).
   */
  private snap2(x: number, z: number, w: number, d: number) {
    let best: { x: number; z: number; rot: number; w: number; d: number; partner: number; dist: number } | null = null;
    for (const o of this.specs) {
      if (BESPOKE.includes(o.role)) continue;
      const c = Math.cos(o.rot), sn = Math.sin(o.rot);
      const dx = x - o.x, dz = z - o.z;
      const lx = dx * c + dz * sn, lz = -dx * sn + dz * c;
      const cands: { lx: number; lz: number; rot: number; w: number; d: number }[] = [];
      if (Math.abs(lz) < o.d / 2 + 1.2 && Math.abs(lx) > o.w / 2 - 0.6 && Math.abs(lx) < o.w / 2 + w + 1.8) {
        const sg = Math.sign(lx) || 1;
        cands.push({ lx: sg * (o.w / 2 + 0.02 + w / 2), lz: 0, rot: o.rot, w, d: o.d });
      }
      if (Math.abs(lx) < o.w / 2 + 0.6 && lz < -o.d / 2 + 0.6 && lz > -o.d / 2 - d - 1.8) {
        cands.push({ lx: 0, lz: -(o.d / 2 + 0.02 + d / 2), rot: o.rot + Math.PI, w: o.w, d });
      }
      for (const k of cands) {
        const dist = Math.hypot(lx - k.lx, lz - k.lz);
        if (!best || dist < best.dist) {
          best = { x: o.x + k.lx * c - k.lz * sn, z: o.z + k.lx * sn + k.lz * c, rot: k.rot, w: k.w, d: k.d, partner: o.id, dist };
        }
      }
    }
    return best && best.dist < 3.2 ? best : null;
  }

  /** Size + facing a new building at (x,z) would get (snapping to neighbours). */
  proposal(x: number, z: number, role: Role, mode: MatMode): { spec: BSpec; error: string | null; cost: Cost; snapped: boolean } {
    const seed = (Math.floor(x * 73.1) * 1013 + Math.floor(z * 91.7) * 7919 + this.p.seed) >>> 0;
    const rng = new RNG(seed);
    const main = this.specs.length === 0;
    let w = main ? rng.range(3.8, 5.4) : rng.range(3.0, 4.6), d = main ? rng.range(3.6, 4.8) : rng.range(3.0, 4.2);
    const dom = this.dominantStyle;
    const r: Role = main ? 'keep' : role;
    const plan = this.blockPlan(mode);
    let rot = this.site.facing(x, z, this.specs) + rng.range(-0.15, 0.15);
    const bespoke = !main && BESPOKE.includes(r);
    if (bespoke) [w, d] = ROLES[r].size!;
    const snap = main || bespoke ? null : this.snap2(x, z, w, d);
    if (snap) { x = snap.x; z = snap.z; rot = snap.rot; w = snap.w; d = snap.d; }
    const spec: BSpec = {
      id: -1, seed, x, z, w, d, rot, main,
      blocks: 1, style: rng.chance(0.7) ? dom : rng.int(0, STYLES.length - 1), splitAt: rng.chance(0.3) ? rng.int(1, 3) : -1,
      role: r, mats: main ? 'S' : plan.mat, tiles: true, braces: 0,
    };
    spec.flush = this.flushOf(spec);
    if (bespoke) spec.mats = 'S';
    const cost: Cost = main ? {} : bespoke ? ROLES[r].found : sum(ROLES[r].found, plan.cost);
    // aligned neighbours that touch (flush, or corner to corner in a terrace) may abut
    const q = Math.PI / 2;
    const aligned = (o: BSpec) => { const dr = (((o.rot - spec.rot) % q) + q) % q; return Math.min(dr, q - dr) < 0.03; };
    const partners = snap ? this.specs.filter((o) => aligned(o) && obbOverlap(spec, 0.15, o, 0.15)).map((o) => o.id) : [];
    let error = main ? null : this.landmarkBlocked(r);
    error ??= this.site.checkRect(spec, this.specs, partners);
    if (!error && !this.econ.can(cost)) error = `need ${this.econ.missing(cost)}`;
    return { spec, error, cost, snapped: partners.length > 0 };
  }

  found(x: number, z: number, role: Role, mode: MatMode): string | null {
    const { spec, error, cost } = this.proposal(x, z, role, mode);
    if (error) return error;
    this.snap();
    this.econ.pay(cost);
    this.payRoof(spec);
    spec.id = this.nextId++;
    this.specs.push(spec);
    const changed = this.refreshFlush().filter((id) => id !== spec.id);
    if (spec.main && this.econ.pop < 3) this.econ.pop = 3;
    spec.born = this.econ.day;
    for (const id of changed) this.rebuild(id, false);
    this.rebuild(spec.id, true, true);
    this.construct(spec.id, this.built.get(spec.id)!.lot.top - 0.3);
    this.onSfx?.(spec.mats[0] === 'S' ? 'stone' : 'wood');
    this.onEvent?.(`${ROLES[spec.role].name} founded${spec.flush ? ' against its neighbour' : ''} — ${fmtCost(cost)}`);
    return null;
  }

  floorCost(id: number, mode: MatMode) { void id; return this.blockPlan(mode); }

  addFloor(id: number, mode: MatMode): string | null {
    const s = this.spec(id);
    if (!s) return null;
    if (s.blocks >= MAX_BLOCKS) return 'it cannot grow any taller';
    if (BESPOKE.includes(s.role)) return `the ${ROLES[s.role].name.toLowerCase()} is finished as built`;
    const plan = this.blockPlan(mode);
    if (!this.econ.can(plan.cost)) return `need ${this.econ.missing(plan.cost)}`;
    this.snap();
    this.econ.pay(plan.cost);
    s.mats = (s.mats.padEnd(s.blocks, '?') + plan.mat).slice(0, s.blocks + 1);
    s.blocks++;
    this.payRoof(s);
    const prevTop = (() => { const b = this.built.get(id)!; return b.lot.blocks.reduce((m, k) => Math.max(m, k.y0 + k.h), b.lot.top); })();
    this.rebuild(id, true, true);
    this.construct(id, prevTop - 0.05);
    this.onSfx?.(plan.mat === 'S' ? 'stone' : 'wood');
    const st = this.built.get(id)!.stability;
    if (st < 0) this.onEvent?.('It groans and sways… it is not going to hold!');
    else if (st < 0.15) this.onEvent?.('The tower sways alarmingly — brace it or bridge it to a neighbour');
    return null;
  }

  removeFloor(id: number): string | null {
    const s = this.spec(id);
    if (!s) return null;
    if (s.blocks <= 1) return 'only the ground floor is left — use Demolish';
    this.snap();
    s.blocks--;
    s.mats = s.mats.slice(0, s.blocks);
    this.econ.res.wood += 2;
    this.rebuild(id);
    this.onSfx?.('knock');
    return null;
  }

  brace(id: number): string | null {
    const s = this.spec(id);
    if (!s) return null;
    if (s.braces >= MAX_BRACES) return 'no room for more braces';
    if (!this.econ.can(COSTS.brace)) return `need ${this.econ.missing(COSTS.brace)}`;
    this.snap();
    this.econ.pay(COSTS.brace);
    s.braces++;
    this.rebuild(id);
    this.onSfx?.('wood');
    return null;
  }

  demolish(id: number) {
    const s0 = this.spec(id);
    if (!s0) return;
    this.snap();
    this.econ.res.wood += Math.round(s0.blocks * 2);
    this.econ.res.stone += Math.round([...s0.mats].filter((c) => c === 'S').length * 2);
    const wasMain = s0.main;
    this.specs = this.specs.filter((s) => s.id !== id);
    this.bridges = this.bridges.filter(([a, b]) => a !== id && b !== id);
    this.doomed.delete(id);
    const cons = this.building.get(id);
    if (cons) { this.group.remove(cons.scaffold); cons.scaffold.geometry.dispose(); this.building.delete(id); }
    this.rebuild(id, false);
    for (const cid of this.refreshFlush()) this.rebuild(cid, false);
    if (wasMain && this.specs.length) {
      const next = this.specs.reduce((a, b) => (b.blocks > a.blocks ? b : a));
      next.main = true; next.role = 'keep';
      this.rebuild(next.id, false);
    }
    this.rebuildGround();
    this.onSfx?.('demolish');
  }

  bridge(a: number, b: number): string | null {
    if (a === b) return null;
    if (this.bridges.some(([x, y]) => (x === a && y === b) || (x === b && y === a))) return 'already connected';
    const A = this.built.get(a)?.lot, B = this.built.get(b)?.lot;
    if (!A || !B) return null;
    if (!bridgePoints(A, B)) return 'both buildings need upper floors at a shared height, within reach';
    if (!this.econ.can(COSTS.bridge)) return `need ${this.econ.missing(COSTS.bridge)}`;
    this.snap();
    this.econ.pay(COSTS.bridge);
    this.bridges.push([a, b]);
    this.rebuildGround();
    this.onSfx?.('bridge');
    return null;
  }

  // ------------------------------------------------------------ save / load
  serialize(): SaveCore {
    return structuredClone({ specs: this.specs, bridges: this.bridges, nextId: this.nextId, econ: this.econ.snapshot() });
  }
  /** Load a saved town onto a freshly reset site with matching params. */
  load(p: GenParams, d: SaveCore) {
    this.reset(p, false);
    this.specs = structuredClone(d.specs);
    this.bridges = structuredClone(d.bridges);
    this.nextId = d.nextId;
    this.econ.restore(d.econ);
    for (const s of this.specs) this.rebuild(s.id, false);
    this.rebuildGround();
  }
  smokeSources() {
    const out: [number, number, number][] = [];
    for (const b of this.built.values()) out.push(...b.smoke);
    return out;
  }

  // ------------------------------------------------------------ picking
  /** March the ray; buildings are approximated as columns over their footprint. */
  pick(ray: THREE.Ray): Pick {
    const p = new THREE.Vector3();
    const cols = [...this.built.entries()].map(([id, b]) => {
      const s = this.spec(id)!;
      return { id, b, round: s.main && !s.flush, flush: s.flush ?? '', c: Math.cos(b.lot.rot), sn: Math.sin(b.lot.rot) };
    });
    let prevT = 0;
    const ground = (x: number, z: number) => (this.site.sea !== null ? Math.max(this.site.H(x, z), this.site.sea) : this.site.H(x, z));
    for (let t = 1; t < 600; t += t < 80 ? 0.25 : 0.6) {
      ray.at(t, p);
      for (const col of cols) {
        const L = col.b.lot;
        if (p.y < L.base || p.y > col.b.top) continue;
        if (p.y < L.top + 0.1) { // foundation / plinth
          if (col.round) { if (Math.hypot(p.x - L.x, p.z - L.z) < L.rad) return { kind: 'building', id: col.id, point: p.clone() }; continue; }
          const dx = p.x - L.x, dz = p.z - L.z, lx = dx * col.c + dz * col.sn, lz = -dx * col.sn + dz * col.c;
          const m = (f: string) => (col.flush.includes(f) ? 0 : 0.7);
          if (lx > -L.w / 2 - m('L') && lx < L.w / 2 + m('R') && lz > -L.d / 2 - m('K') && lz < L.d / 2 + m('F')) return { kind: 'building', id: col.id, point: p.clone() };
          continue;
        }
        // the floor block at this height (or the top one, for roofs)
        const k = L.blocks.find((q) => p.y >= q.y0 && p.y < q.y0 + q.h) ?? L.blocks[L.blocks.length - 1];
        if (!k) continue;
        const ctr = L.xf(k.xf([0, Math.min(p.y - k.y0, k.h), 0]));
        const dx = p.x - ctr[0], dz = p.z - ctr[2], lx = dx * col.c + dz * col.sn, lz = -dx * col.sn + dz * col.c;
        const pad = p.y > k.y0 + k.h ? 0.6 : 0.25;
        if (Math.abs(lx) < k.w / 2 + pad && Math.abs(lz) < k.d / 2 + pad) return { kind: 'building', id: col.id, point: p.clone() };
      }
      if (p.y < ground(p.x, p.z)) {
        let a = prevT, b = t;
        for (let i = 0; i < 8; i++) {
          const m = (a + b) / 2; ray.at(m, p);
          if (p.y < ground(p.x, p.z)) b = m; else a = m;
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
    const R = ROLES[s.role];
    const bits = [`${R.name} · ${s.blocks} block${s.blocks > 1 ? 's' : ''}`];
    if (R.housing) bits.push(`homes ${R.housing * s.blocks}`);
    if (R.jobs) bits.push(`${R.jobs * s.blocks} jobs`);
    bits.push(`${stabilityWord(b.stability)} (${Math.round(b.stability * 100)})`);
    return bits.join(' · ');
  }
}

function sum(a: Cost, b: Cost): Cost {
  const o: Cost = { ...a };
  for (const k of Object.keys(b) as (keyof Cost)[]) o[k] = (o[k] ?? 0) + (b[k] ?? 0);
  return o;
}

function mergeGeos(gs: THREE.BufferGeometry[]): THREE.BufferGeometry | null {
  if (!gs.length) return null;
  const out = new THREE.BufferGeometry();
  for (const name of Object.keys(gs[0].attributes)) {
    const arrs = gs.map((g) => g.attributes[name].array as Float32Array);
    const all = new Float32Array(arrs.reduce((n, a) => n + a.length, 0));
    let o = 0; for (const a of arrs) { all.set(a, o); o += a.length; }
    out.setAttribute(name, new THREE.BufferAttribute(all, gs[0].attributes[name].itemSize));
  }
  for (const g of gs) g.dispose();
  return out;
}
