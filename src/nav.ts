import type * as THREE from 'three';
import type { World } from './world';
import type { Leaf, Lot } from './tower';

/**
 * Where citizens may walk: a 2D grid (0.5 unit cells) over the site, built from building geometry
 * (sampled in a knee-to-head band above the local floor, so annexes, stairs, stalls, braces and yards
 * all count), obstacle circles (trees, lamps, rocks…), water and steep slopes. Paths and stairs stay
 * walkable and are cheaper, doors and activity spots are carved open. A* (octile) + line-of-sight
 * smoothing, with a small cache; rebuilt whenever `world.navVersion` changes.
 */
type V3 = [number, number, number];
export const CELL = 0.5;
const AGENT = 0.25; // body radius kept clear of walls
const BAND_LO = 0.14, BAND_HI = 1.9;
const COST_PATH = 1, COST_GRASS = 1.8;
const SQ2 = Math.SQRT2;

/** Seat against a tree: back to the trunk, looking out. */
export interface TreeSeat { p: V3; look: V3; tree: number }

export class NavGrid {
  n = 0; x0 = 0; z0 = 0;
  /** final walkability (1 = walkable) */
  walk = new Uint8Array(0);
  /** walkable before temporary obstacles */
  base = new Uint8Array(0);
  path = new Uint8Array(0);
  /** floor height per cell (terrain, foundation tops, path / stair heights) */
  F = new Float32Array(0);
  /** lowest clutter above the floor per cell (geometry samples), for headroom checks */
  low = new Float32Array(0);
  comp = new Int32Array(0);
  water = new Uint8Array(0);
  temp = new Uint8Array(0);
  version = -1;
  seats: TreeSeat[] = [];
  shore: { p: V3; look: V3 }[] = [];
  /** per nav-lot: point in front of the main door (latch side, outside the swing) and just inside it */
  doors: ({ out: V3; inside: V3; leaf: Leaf } | null)[] = [];
  private cache = new Map<string, number[] | null>();
  // A* scratch
  private g = new Float32Array(0);
  private from = new Int32Array(0);
  private stamp = new Uint32Array(0);
  private closed = new Uint32Array(0);
  private gen = 0;
  private heap: number[] = [];
  private hf = new Float32Array(0);
  buildMs = 0;

  idx(x: number, z: number) {
    const i = Math.floor((x - this.x0) / CELL), j = Math.floor((z - this.z0) / CELL);
    return i < 0 || j < 0 || i >= this.n || j >= this.n ? -1 : j * this.n + i;
  }
  cx(c: number) { return this.x0 + ((c % this.n) + 0.5) * CELL; }
  cz(c: number) { return this.z0 + (Math.floor(c / this.n) + 0.5) * CELL; }
  free(x: number, z: number) { const c = this.idx(x, z); return c >= 0 && this.walk[c] === 1; }
  onPath(x: number, z: number) { const c = this.idx(x, z); return c >= 0 && this.path[c] === 1; }
  isWater(x: number, z: number) { const c = this.idx(x, z); return c >= 0 && this.water[c] === 1; }

  /** Smooth floor height, using walkable cells only where there are any. */
  heightAt(x: number, z: number) {
    const fx = (x - this.x0) / CELL - 0.5, fz = (z - this.z0) / CELL - 0.5;
    const i = Math.floor(fx), j = Math.floor(fz), u = fx - i, v = fz - j;
    let s = 0, w = 0, s2 = 0, w2 = 0;
    for (const [di, dj, k] of [[0, 0, (1 - u) * (1 - v)], [1, 0, u * (1 - v)], [0, 1, (1 - u) * v], [1, 1, u * v]] as const) {
      const ii = Math.min(this.n - 1, Math.max(0, i + di)), jj = Math.min(this.n - 1, Math.max(0, j + dj)), c = jj * this.n + ii;
      s2 += this.F[c] * k; w2 += k;
      if (this.base[c]) { s += this.F[c] * k; w += k; }
    }
    return w > 0.05 ? s / w : s2 / Math.max(1e-6, w2);
  }

  // ------------------------------------------------------------ building the grid
  build(world: World) {
    const t0 = performance.now();
    const site = world.site;
    const half = site.RI * 1.12;
    this.n = Math.ceil((2 * half) / CELL);
    this.x0 = -half; this.z0 = -half;
    const N = this.n * this.n, n = this.n;
    this.F = new Float32Array(N); this.low = new Float32Array(N).fill(99);
    const H = new Float32Array(N);
    this.water = new Uint8Array(N); this.path = new Uint8Array(N);
    const steep = new Uint8Array(N), gGeo = new Uint8Array(N), bGeo = new Uint8Array(N), obst = new Uint8Array(N), carve = new Uint8Array(N), floor = new Uint8Array(N);
    const gLow = new Float32Array(N).fill(99);
    for (let c = 0; c < N; c++) {
      const x = this.cx(c), z = this.cz(c);
      H[c] = site.H(x, z);
      if (site.isWater(x, z) || (site.sea !== null && H[c] < site.sea + 0.3)) this.water[c] = 1;
    }
    this.F.set(H);
    for (let j = 1; j < n - 1; j++) for (let i = 1; i < n - 1; i++) {
      const c = j * n + i, h = H[c];
      const d = Math.max(Math.abs(H[c + 1] - h), Math.abs(H[c - 1] - h), Math.abs(H[c + n] - h), Math.abs(H[c - n] - h));
      if (d > 0.42) steep[c] = 1;
    }
    // foundation tops are floors at L.top
    const lots = world.navLots;
    world.specs.forEach((s, li) => {
      const L = lots[li];
      if (!L) return;
      const fl = s.flush ?? '';
      const m = (f: string) => (fl.includes(f) ? 0.01 : 0.78);
      if (s.main && !fl) { this.forDisc(L.x, L.z, L.rad - 0.1, (c) => { this.F[c] = L.top; floor[c] = 1; }); return; }
      const x0 = -L.w / 2 - m('L'), x1 = L.w / 2 + m('R'), z0 = -L.d / 2 - m('K'), z1 = L.d / 2 + m('F');
      this.forRect(L, x0, x1, z0, z1, (c) => { this.F[c] = Math.max(this.F[c], L.top); floor[c] = 1; });
    });
    // paths and stairs: walkable, cheap, at the path's height
    for (const e of world.nav) for (let k = 0; k + 1 < e.pts.length; k++) this.forSeg(e.pts[k], e.pts[k + 1], 0.72, (c, t) => {
      this.path[c] = 1; this.F[c] = e.pts[k][1] + (e.pts[k + 1][1] - e.pts[k][1]) * t - 0.02;
    });
    // geometry in the knee-to-head band above the floor (1 = within a body's width, 2 = the thing itself)
    for (const b of world.built.values()) this.raster(b.geo, bGeo, this.low);
    if (world.ground) this.raster(world.ground.geometry, gGeo, gLow);
    // obstacles: on paths only their core blocks (people squeeze past a lamp post), elsewhere keep a body's width
    for (const o of world.obstacles) {
      this.forDisc(o.x, o.z, o.r + AGENT, (c) => { obst[c] = Math.max(obst[c], 1); });
      this.forDisc(o.x, o.z, Math.max(0.12, o.r * 0.5), (c) => { obst[c] = 2; });
    }
    // inside the walls (the band test only sees the walls themselves)
    world.specs.forEach((s, li) => {
      const L = lots[li], k = L?.blocks[0];
      if (!L || s.role === 'market') return;
      const w = (k?.w ?? L.w) / 2 + AGENT, d = (k?.d ?? L.d) / 2 + AGENT;
      this.forRect(L, -w, w, -d, d, (c) => { obst[c] = 2; });
    });
    // doors: a ramp from the lot front up the steps to the threshold
    this.doors = lots.map((L, li) => {
      const b = world.built.get(world.specs[li]?.id);
      const leaf = b ? mainDoor(b.leaves, L) : null;
      if (!leaf) return null;
      const g = doorGeom(leaf);
      const out: V3 = [g.p[0] + g.a[0] * (g.w + 0.2) + g.n[0] * 0.6, leaf.p[1], g.p[2] + g.a[2] * (g.w + 0.2) + g.n[2] * 0.6];
      const mid: V3 = [g.p[0] + g.a[0] * g.w * 0.5 + g.n[0] * 0.7, leaf.p[1], g.p[2] + g.a[2] * g.w * 0.5 + g.n[2] * 0.7];
      const inside: V3 = [g.p[0] + g.a[0] * g.w * 0.5 - g.n[0] * 0.25, leaf.p[1], g.p[2] + g.a[2] * g.w * 0.5 - g.n[2] * 0.25];
      const keep = L.main && !world.specs[li].flush; // reached by its curling stair instead
      if (Math.hypot(mid[0] - L.front[0], mid[2] - L.front[2]) > (keep ? 12 : 6)) return null;
      if (!keep) this.forSeg(L.front, mid, 0.42, (c, t) => { carve[c] = 1; this.F[c] = L.front[1] + (leaf.p[1] - L.front[1]) * t; });
      this.forSeg(mid, out, 0.42, (c) => { carve[c] = 1; this.F[c] = leaf.p[1]; });
      return { out, inside, leaf };
    });
    // the keep's curling stair up its plinth, and a way through the parapet at the top
    world.specs.forEach((s, li) => {
      const L = lots[li];
      if (!L || !s.main || s.flush) return;
      const steps = Math.ceil((L.top - L.base - 1.5) / 0.25);
      const at = (t: number, r: number, y: number): V3 => { const q = L.xf([Math.cos(t) * r, 0, Math.sin(t) * r]); return [q[0], y, q[2]]; };
      const t0 = Math.PI / 2 - 0.35;
      const pts: V3[] = [at(t0 + 0.05, L.rad - 1.0, L.top)];
      for (let i = 0; i < steps; i += 2) pts.push(at(t0 - i * 0.075, L.rad + 0.75, L.top - i * 0.25));
      pts.push([L.front[0], L.front[1], L.front[2]]);
      for (let k = 0; k + 1 < pts.length; k++) this.forSeg(pts[k], pts[k + 1], 0.45, (c, t) => { carve[c] = 1; this.F[c] = pts[k][1] + (pts[k + 1][1] - pts[k][1]) * t; });
    });
    for (const sp of [...world.allSpots(), ...world.groundSpots]) this.forDisc(sp.p[0], sp.p[2], 0.4, (c) => { carve[c] = 1; });
    (this as unknown as { dbg: unknown }).dbg = { obst, bGeo, gGeo, steep, carve };
    this.base = new Uint8Array(N);
    for (let c = 0; c < N; c++) {
      let ok: boolean;
      if (this.path[c]) ok = obst[c] < 2 && bGeo[c] < 2;
      else ok = !obst[c] && !bGeo[c] && !this.water[c] && !(steep[c] && !floor[c]) && !gGeo[c];
      if (carve[c]) ok = true;
      this.base[c] = ok ? 1 : 0;
    }
    // border cells are never walkable (keeps neighbour lookups in range)
    for (let k = 0; k < n; k++) { this.base[k] = this.base[N - 1 - k] = this.base[k * n] = this.base[k * n + n - 1] = 0; }
    this.temp = new Uint8Array(N);
    this.walk = this.base.slice();
    this.labelComponents();
    for (let c = 0; c < N; c++) this.low[c] = Math.min(this.low[c], gLow[c]);
    this.g = new Float32Array(N); this.from = new Int32Array(N); this.stamp = new Uint32Array(N); this.closed = new Uint32Array(N); this.hf = new Float32Array(N);
    this.cache.clear();
    this.findSeats(world);
    this.findShore();
    this.version = world.navVersion;
    this.buildMs = performance.now() - t0;
  }

  private forDisc(x: number, z: number, r: number, f: (c: number) => void) {
    const i0 = Math.floor((x - r - this.x0) / CELL), i1 = Math.floor((x + r - this.x0) / CELL);
    const j0 = Math.floor((z - r - this.z0) / CELL), j1 = Math.floor((z + r - this.z0) / CELL);
    for (let j = Math.max(0, j0); j <= Math.min(this.n - 1, j1); j++) for (let i = Math.max(0, i0); i <= Math.min(this.n - 1, i1); i++) {
      const c = j * this.n + i;
      // nearest point of the cell to the centre
      const px = Math.max(this.x0 + i * CELL, Math.min(x, this.x0 + (i + 1) * CELL)), pz = Math.max(this.z0 + j * CELL, Math.min(z, this.z0 + (j + 1) * CELL));
      if (Math.hypot(px - x, pz - z) <= r) f(c);
    }
  }

  /** Cells whose centre lies in a lot-local rectangle. */
  private forRect(L: Lot, x0: number, x1: number, z0: number, z1: number, f: (c: number) => void) {
    const c = Math.cos(L.rot), s = Math.sin(L.rot), R = Math.hypot(Math.max(-x0, x1), Math.max(-z0, z1));
    this.forDisc(L.x, L.z, R, (k) => {
      const dx = this.cx(k) - L.x, dz = this.cz(k) - L.z;
      const lx = dx * c + dz * s, lz = -dx * s + dz * c;
      if (lx >= x0 && lx <= x1 && lz >= z0 && lz <= z1) f(k);
    });
  }

  /** Cells within r of a segment; t = position along it. */
  private forSeg(a: V3, b: V3, r: number, f: (c: number, t: number) => void) {
    const dx = b[0] - a[0], dz = b[2] - a[2], L2 = dx * dx + dz * dz || 1e-6;
    const i0 = Math.floor((Math.min(a[0], b[0]) - r - this.x0) / CELL), i1 = Math.floor((Math.max(a[0], b[0]) + r - this.x0) / CELL);
    const j0 = Math.floor((Math.min(a[2], b[2]) - r - this.z0) / CELL), j1 = Math.floor((Math.max(a[2], b[2]) + r - this.z0) / CELL);
    for (let j = Math.max(0, j0); j <= Math.min(this.n - 1, j1); j++) for (let i = Math.max(0, i0); i <= Math.min(this.n - 1, i1); i++) {
      const c = j * this.n + i, x = this.cx(c), z = this.cz(c);
      const t = Math.max(0, Math.min(1, ((x - a[0]) * dx + (z - a[2]) * dz) / L2));
      if (Math.hypot(x - a[0] - dx * t, z - a[2] - dz * t) <= r) f(c, t);
    }
  }

  /** Sample triangles; anything between knee and head height above the local floor blocks its cells. */
  private raster(geo: THREE.BufferGeometry, out: Uint8Array, low: Float32Array) {
    const P = geo.getAttribute('position').array as ArrayLike<number>;
    const n = this.n, F = this.F;
    const mark = (x: number, y: number, z: number) => {
      const i = Math.floor((x - this.x0) / CELL), j = Math.floor((z - this.z0) / CELL);
      if (i < 1 || j < 1 || i >= n - 1 || j >= n - 1) return;
      const c = j * n + i, rel = y - F[c];
      if (rel < BAND_LO) return;
      if (rel < low[c]) low[c] = rel;
      if (rel > BAND_HI) return;
      // grow by the body radius
      const fx = (x - this.x0) / CELL - i, fz = (z - this.z0) / CELL - j, r = AGENT / CELL;
      const ia = fx < r ? -1 : 0, ib = fx > 1 - r ? 1 : 0, ja = fz < r ? -1 : 0, jb = fz > 1 - r ? 1 : 0;
      for (let dj = ja; dj <= jb; dj++) for (let di = ia; di <= ib; di++) if (!out[c + dj * n + di]) out[c + dj * n + di] = 1;
      out[c] = 2;
    };
    for (let t = 0; t + 8 < P.length; t += 9) {
      const ax = P[t], ay = P[t + 1], az = P[t + 2], bx = P[t + 3], by = P[t + 4], bz = P[t + 5], qx = P[t + 6], qy = P[t + 7], qz = P[t + 8];
      const c0 = this.idx((ax + bx + qx) / 3, (az + bz + qz) / 3);
      if (c0 < 0) continue;
      const ylo = Math.min(ay, by, qy);
      if (ylo > F[c0] + 3.5) continue; // roofs, upper floors
      const e = Math.max(Math.hypot(bx - ax, by - ay, bz - az), Math.hypot(qx - bx, qy - by, qz - bz), Math.hypot(ax - qx, ay - qy, az - qz));
      const k = Math.min(60, Math.max(1, Math.ceil(e / (CELL * 0.45))));
      for (let u = 0; u <= k; u++) for (let v = 0; u + v <= k; v++) {
        const s = u / k, r = v / k, w = 1 - s - r;
        mark(ax * w + bx * s + qx * r, ay * w + by * s + qy * r, az * w + bz * s + qz * r);
      }
    }
  }

  private labelComponents() {
    const N = this.n * this.n, n = this.n;
    this.comp = new Int32Array(N).fill(-1);
    let id = 0;
    const q = new Int32Array(N);
    for (let s = 0; s < N; s++) {
      if (!this.base[s] || this.comp[s] >= 0) continue;
      let h = 0, t = 0; q[t++] = s; this.comp[s] = id;
      while (h < t) {
        const c = q[h++];
        for (const d of [1, -1, n, -n]) { const o = c + d; if (this.base[o] && this.comp[o] < 0) { this.comp[o] = id; q[t++] = o; } }
      }
      id++;
    }
  }

  /** Seats under trees: back to the trunk, facing open walkable ground with headroom. */
  private findSeats(world: World) {
    this.seats = [];
    world.obstacles.forEach((o, ti) => {
      if (o.kind !== 'tree') return;
      const trunk = 0.11 * (o.r / 0.45) + 0.34;
      for (let k = 0; k < 8; k++) {
        const a = (k / 8) * Math.PI * 2 + ti;
        const dx = Math.cos(a), dz = Math.sin(a);
        const x = o.x + dx * trunk, z = o.z + dz * trunk;
        const c = this.idx(x, z), f = this.idx(o.x + dx * (o.r + 0.9), o.z + dz * (o.r + 0.9));
        if (c < 0 || f < 0 || !this.base[f] || this.water[c] || this.low[c] < 1.15) continue;
        const y = this.heightAt(o.x + dx * (o.r + 0.9), o.z + dz * (o.r + 0.9));
        const yc = world.site.H(x, z);
        if (Math.abs(y - yc) > 0.5) continue;
        this.seats.push({ p: [x, yc, z], look: [x + dx * 5, yc, z + dz * 5], tree: ti });
        const fp: V3 = [this.cx(f), 0, this.cz(f)];
        this.forSeg([x, 0, z], fp, 0.4, (q) => { this.base[q] = 1; this.walk[q] = 1; this.comp[q] = this.comp[f]; });
        break;
      }
    });
  }

  /** Walkable cells right at the water's edge, looking out over it (for fishing / sketching the sea). */
  private findShore() {
    this.shore = [];
    const n = this.n;
    for (let c = n; c < n * n - n; c++) {
      if (!this.base[c] || this.path[c]) continue;
      for (let k = 0; k < 8; k++) {
        const a = (k / 8) * Math.PI * 2, dx = Math.cos(a), dz = Math.sin(a);
        const x = this.cx(c), z = this.cz(c);
        const w1 = this.idx(x + dx * 0.9, z + dz * 0.9), w3 = this.idx(x + dx * 3, z + dz * 3);
        if (w1 < 0 || w3 < 0 || !this.water[w1] || !this.water[w3]) continue;
        if (this.shore.some((s) => Math.hypot(s.p[0] - x, s.p[2] - z) < 3)) break;
        this.shore.push({ p: [x, this.F[c], z], look: [x + dx * 6, this.F[c], z + dz * 6] });
        break;
      }
    }
  }

  // ------------------------------------------------------------ temporary obstacles (easels…)
  addTemp(x: number, z: number, r: number, on: boolean) {
    this.forDisc(x, z, r + AGENT, (c) => {
      this.temp[c] = Math.max(0, this.temp[c] + (on ? 1 : -1));
      this.walk[c] = this.base[c] && !this.temp[c] ? 1 : 0;
    });
    this.cache.clear();
  }

  // ------------------------------------------------------------ queries
  /** Nearest walkable cell to a point (within r), or -1. */
  nearest(x: number, z: number, r = 3): number {
    const c = this.idx(x, z);
    if (c >= 0 && this.walk[c]) return c;
    let best = -1, bd = Infinity;
    const k = Math.ceil(r / CELL), i0 = Math.floor((x - this.x0) / CELL), j0 = Math.floor((z - this.z0) / CELL);
    for (let dj = -k; dj <= k; dj++) for (let di = -k; di <= k; di++) {
      const i = i0 + di, j = j0 + dj;
      if (i < 0 || j < 0 || i >= this.n || j >= this.n) continue;
      const q = j * this.n + i;
      if (!this.walk[q]) continue;
      const d = Math.hypot(this.cx(q) - x, this.cz(q) - z);
      if (d < bd && d <= r) { bd = d; best = q; }
    }
    return best;
  }

  reachable(a: V3, b: V3) {
    const s = this.nearest(a[0], a[2]), g = this.nearest(b[0], b[2]);
    return s >= 0 && g >= 0 && this.comp[s] === this.comp[g];
  }

  /** Walking route a → b as waypoints (heights from the floor), or null. Both ends are kept exactly. */
  route(a: V3, b: V3): V3[] | null {
    const s = this.nearest(a[0], a[2]), g = this.nearest(b[0], b[2]);
    if (s < 0 || g < 0 || this.comp[s] !== this.comp[g]) return null;
    const key = s + ':' + g;
    let cells = this.cache.get(key);
    if (cells === undefined) {
      cells = this.astar(s, g);
      if (cells) cells = this.smooth(cells);
      if (this.cache.size > 160) this.cache.delete(this.cache.keys().next().value!);
      this.cache.set(key, cells);
    }
    if (!cells) return null;
    const out: V3[] = [[a[0], a[1], a[2]]];
    for (let k = 1; k < cells.length - 1; k++) { const x = this.cx(cells[k]), z = this.cz(cells[k]); out.push([x, this.heightAt(x, z), z]); }
    if (cells.length > 1 && Math.hypot(this.cx(cells[cells.length - 1]) - b[0], this.cz(cells[cells.length - 1]) - b[2]) > 0.6) {
      const q = cells[cells.length - 1]; out.push([this.cx(q), this.heightAt(this.cx(q), this.cz(q)), this.cz(q)]);
    }
    out.push([b[0], b[1], b[2]]);
    return out;
  }

  private astar(s: number, goal: number): number[] | null {
    const n = this.n, gx = goal % n, gz = Math.floor(goal / n);
    const gen = ++this.gen;
    const heap = this.heap; heap.length = 0;
    const hf = this.hf;
    const push = (c: number, f: number) => {
      hf[c] = f; heap.push(c);
      let i = heap.length - 1;
      while (i > 0) { const p = (i - 1) >> 1; if (hf[heap[p]] <= f) break; heap[i] = heap[p]; i = p; }
      heap[i] = c;
    };
    const pop = () => {
      const top = heap[0], last = heap.pop()!;
      if (heap.length) {
        let i = 0; const f = hf[last];
        for (;;) {
          let l = 2 * i + 1; if (l >= heap.length) break;
          if (l + 1 < heap.length && hf[heap[l + 1]] < hf[heap[l]]) l++;
          if (hf[heap[l]] >= f) break;
          heap[i] = heap[l]; i = l;
        }
        heap[i] = last;
      }
      return top;
    };
    const h = (c: number) => { const dx = Math.abs((c % n) - gx), dz = Math.abs(Math.floor(c / n) - gz); return (dx + dz + (SQ2 - 2) * Math.min(dx, dz)) * COST_PATH; };
    this.g[s] = 0; this.stamp[s] = gen; this.from[s] = -1; push(s, h(s));
    const W = this.walk, Pth = this.path;
    let iter = 0;
    while (heap.length) {
      const c = pop();
      if (this.closed[c] === gen) continue;
      this.closed[c] = gen;
      if (c === goal) break;
      if (++iter > 120000) return null;
      const gc = this.g[c];
      for (let k = 0; k < 8; k++) {
        const di = k < 4 ? [1, -1, 0, 0][k] : [1, -1, 1, -1][k - 4], dj = k < 4 ? [0, 0, 1, -1][k] : [1, 1, -1, -1][k - 4];
        const o = c + dj * n + di;
        if (!W[o] || this.closed[o] === gen) continue;
        if (di && dj && (!W[c + di] || !W[c + dj * n])) continue; // no corner cutting
        const step = (di && dj ? SQ2 : 1) * (Pth[o] ? COST_PATH : COST_GRASS);
        const ng = gc + step;
        if (this.stamp[o] === gen && ng >= this.g[o]) continue;
        this.stamp[o] = gen; this.g[o] = ng; this.from[o] = c;
        push(o, ng + h(o));
      }
    }
    if (this.closed[goal] !== gen) return null;
    const out: number[] = [];
    for (let c = goal; c >= 0; c = this.from[c]) out.push(c);
    return out.reverse();
  }

  /** Line of sight on the grid; when both ends are on a path, the line has to stay on it. */
  los(a: number, b: number): boolean {
    const n = this.n;
    const x0 = (a % n) + 0.5, z0 = Math.floor(a / n) + 0.5;
    const x1 = (b % n) + 0.5, z1 = Math.floor(b / n) + 0.5;
    const pathOnly = this.path[a] && this.path[b];
    const dx = x1 - x0, dz = z1 - z0, L = Math.hypot(dx, dz);
    const steps = Math.ceil(L * 3);
    for (let k = 1; k < steps; k++) {
      const t = k / steps;
      const x = x0 + dx * t, z = z0 + dz * t;
      // sample the body's width either side of the line
      for (const o of [-0.45, 0, 0.45]) {
        const sx = x + (-dz / (L || 1)) * o, sz = z + (dx / (L || 1)) * o;
        const c = Math.floor(sz) * n + Math.floor(sx);
        if (!this.walk[c] || (pathOnly && o === 0 && !this.path[c])) return false;
      }
    }
    return true;
  }

  private smooth(cells: number[]): number[] {
    if (cells.length < 3) return cells;
    const out = [cells[0]];
    let i = 0;
    while (i < cells.length - 1) {
      let j = Math.min(cells.length - 1, i + 48);
      while (j > i + 1 && !this.los(cells[i], cells[j])) j--;
      out.push(cells[j]);
      i = j;
    }
    return out;
  }
}

/** Frame of a hinged leaf: hinge foot p, unit along a (to the latch), unit outward n, width, height. */
export function doorGeom(l: Leaf) {
  const ax = l.q[0] - l.p[0], az = l.q[2] - l.p[2], w = Math.hypot(ax, az) || 1;
  let nx = l.o[0] - l.p[0], nz = l.o[2] - l.p[2];
  const nl = Math.hypot(nx, nz) || 1; nx /= nl; nz /= nl;
  return { p: l.p, a: [ax / w, 0, az / w] as V3, n: [nx, 0, nz] as V3, w, h: l.u[1] - l.p[1] };
}

/** The building's street door: the ground-floor door nearest the lot front. */
export function mainDoor(leaves: Leaf[], L: Lot): Leaf | null {
  let best: Leaf | null = null, bd = Infinity;
  for (const l of leaves) {
    if (l.kind !== 'door' || Math.abs(l.p[1] - L.top) > 0.7) continue;
    const d = Math.hypot(l.p[0] - L.front[0], l.p[2] - L.front[2]);
    if (d < bd) { bd = d; best = l; }
  }
  return best;
}
