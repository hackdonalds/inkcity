/**
 * The land itself: streams and ponds carved into the heightfield, soil fertility, groundwater,
 * landmarks of nature (stone ring, ruins, caves, the village well, shrine, pier) and the state of
 * the woods (felled / regrowing trees). One per Site; deterministic per seed + terrain.
 */
import { RNG, noise3 } from './rng';
import type { V3 } from './builder';
import type { Site } from './tower';

export interface Stream {
  /** centre line: x, water-bed level, z (bed never rises downstream) */
  pts: V3[];
  /** half width per point */
  w: number[];
  /** where it pours off a cliff (crag): lip point and outward direction */
  fall?: { p: V3; dx: number; dz: number };
}
export interface Pond { x: number; z: number; r: number; level: number }
export type FeatureKind = 'ring' | 'ruin' | 'cave' | 'shrine' | 'well' | 'pier';
export interface Feature { id: number; kind: FeatureKind; x: number; z: number; r: number; yaw: number }
export interface TreeRec { id: number; x: number; z: number; s: number; kind: number; y: number }

export const FEATURE_NAME: Record<FeatureKind, string> = {
  ring: 'the standing stones', ruin: 'an old ruin', cave: 'a cave mouth', shrine: 'the wayside shrine', well: 'the village well', pier: 'the old pier',
};
/** days a felled tree needs to grow back to full size */
export const REGROW_DAYS = 12;
/** stumps stay bare this long before a sapling shows */
export const STUMP_DAYS = 3;
/** wells need groundwater at most this deep (m) */
export const WELL_MAX_DEPTH = 4.5;

const smooth = (a: number, b: number, x: number) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

export class Landscape {
  streams: Stream[] = [];
  ponds: Pond[] = [];
  features: Feature[] = [];
  /** tree id → day it was felled (removed once grown back) */
  felled = new Map<number, number>();
  /** ruins that have been cleared for stone */
  cleared = new Set<number>();
  /** every tree spot of the last ground build (incl. stumps / saplings) */
  trees: TreeRec[] = [];
  /** current in-game day (drives crops and regrowth visuals) */
  day = 1;
  /** groundwater base level away from streams and ponds */
  tableBase: number;

  readonly E: number;
  private cell = 0.5;
  private N: number;
  private carveG: Float32Array; // carved height cap
  private wetG: Float32Array; // >0 inside water
  private levelG: Float32Array; // water surface
  private kindG: Uint8Array; // 0 none, 1 stream, 2 pond
  private distG: Float32Array; // distance to the nearest centre line (stamping)
  // coarse moisture grid: distance to fresh water + that water's level
  private mCell = 2;
  private mN: number;
  private moistD: Float32Array;
  private moistL: Float32Array;

  constructor(private site: Site) {
    const { RI, p } = site;
    this.E = RI * (p.terrain === 'island' ? 1.3 : 1.2);
    this.N = Math.ceil((2 * this.E) / this.cell) + 2;
    const NN = this.N * this.N;
    this.carveG = new Float32Array(NN).fill(1e4);
    this.wetG = new Float32Array(NN).fill(-10);
    this.levelG = new Float32Array(NN).fill(-100);
    this.kindG = new Uint8Array(NN);
    this.distG = new Float32Array(NN).fill(1e4);
    this.tableBase = site.sea ?? (p.terrain === 'hilltop' ? -1.5 : 0.5);
    const rng = new RNG((p.seed * 7919 + 1234) >>> 0);
    this.makeStreams(rng);
    this.makePonds(rng);
    this.mN = Math.ceil((2 * this.E) / this.mCell) + 2;
    this.moistD = new Float32Array(this.mN * this.mN).fill(1e4);
    this.moistL = new Float32Array(this.mN * this.mN).fill(-100);
    this.makeMoisture();
    this.makeFeatures(rng);
  }

  // ------------------------------------------------------------ height
  /** carved height at (x,z) given the uncarved terraced height h0 */
  carve(x: number, z: number, h0: number) {
    const c = this.bilerp(this.carveG, x, z);
    return c < h0 ? c : h0;
  }
  private Hc(x: number, z: number) { return this.carve(x, z, this.site.H0(x, z)); }

  private gi(x: number) { return (x + this.E) / this.cell; }
  private bilerp(G: Float32Array, x: number, z: number) {
    const fx = this.gi(x), fz = this.gi(z);
    const i = Math.floor(fx), j = Math.floor(fz);
    const N = this.N;
    if (i < 0 || j < 0 || i >= N - 1 || j >= N - 1) return G === this.carveG ? 1e4 : G[0];
    const tx = fx - i, tz = fz - j, k = i * N + j;
    const a = G[k], b = G[k + N], c = G[k + 1], d = G[k + N + 1];
    return (a * (1 - tx) + b * tx) * (1 - tz) + (c * (1 - tx) + d * tx) * tz;
  }

  // ------------------------------------------------------------ water
  /** 'stream' | 'pond' | 'sea' | null */
  water(x: number, z: number): 'stream' | 'pond' | 'sea' | null {
    const { site } = this;
    if (this.bilerp(this.wetG, x, z) > 0) {
      const i = Math.round(this.gi(x)), j = Math.round(this.gi(z));
      const k = this.kindG[i * this.N + j];
      return k === 2 ? 'pond' : 'stream';
    }
    if (site.sea !== null && site.H(x, z) < site.sea + 0.05) return 'sea';
    return null;
  }
  /** fresh-water surface height near (x,z) (streams/ponds) */
  waterLevel(x: number, z: number) {
    const i = Math.round(this.gi(x)), j = Math.round(this.gi(z));
    if (i < 0 || j < 0 || i >= this.N || j >= this.N) return -100;
    return this.levelG[i * this.N + j];
  }

  private stampSeg(a: V3, b: V3, wa: number, wb: number) {
    const R = 5.5, { cell, N, E } = this;
    const x0 = Math.min(a[0], b[0]) - R, x1 = Math.max(a[0], b[0]) + R, z0 = Math.min(a[2], b[2]) - R, z1 = Math.max(a[2], b[2]) + R;
    const dx = b[0] - a[0], dz = b[2] - a[2], L2 = dx * dx + dz * dz || 1e-6;
    for (let i = Math.max(0, Math.floor((x0 + E) / cell)); i <= Math.min(N - 1, Math.ceil((x1 + E) / cell)); i++) {
      const x = -E + i * cell;
      for (let j = Math.max(0, Math.floor((z0 + E) / cell)); j <= Math.min(N - 1, Math.ceil((z1 + E) / cell)); j++) {
        const z = -E + j * cell;
        const t = Math.min(1, Math.max(0, ((x - a[0]) * dx + (z - a[2]) * dz) / L2));
        const d = Math.hypot(x - a[0] - dx * t, z - a[2] - dz * t);
        if (d > R) continue;
        const bed = a[1] + (b[1] - a[1]) * t, w = wa + (wb - wa) * t;
        const e = Math.max(0, d - 0.5 * w);
        const C = bed + e * 0.9 + e * e * 0.12;
        const k = i * N + j;
        if (C < this.carveG[k]) this.carveG[k] = C;
        const wet = (w * 0.85 - d) / w;
        if (wet > this.wetG[k]) this.wetG[k] = wet;
        if (d < this.distG[k]) { this.distG[k] = d; this.levelG[k] = bed + 0.3; if (d < w + 2) this.kindG[k] = 1; }
      }
    }
  }

  private makeStreams(rng: RNG) {
    const { site } = this, { RI, p } = site;
    const want = p.terrain === 'hilltop' ? 2 : 2;
    const cands: { x: number; z: number; a: number; s: number }[] = [];
    for (let i = 0; i < 36; i++) for (const rr of [0.3, 0.4, 0.5]) {
      const a = (i / 36) * Math.PI * 2 + rng.range(-0.05, 0.05), r = rr * RI;
      const x = Math.cos(a) * r, z = Math.sin(a) * r;
      cands.push({ x, z, a, s: site.H0(x, z) + rng.range(0, 2.5) });
    }
    cands.sort((u, v) => v.s - u.s);
    const used: number[] = [];
    for (const c of cands) {
      if (this.streams.length >= want) break;
      if (used.some((a) => Math.abs(Math.atan2(Math.sin(a - c.a), Math.cos(a - c.a))) < 1.7)) continue;
      const s = this.trace(c.x, c.z, rng);
      if (!s) continue;
      used.push(c.a);
      this.streams.push(s);
    }
    for (const s of this.streams) for (let i = 0; i + 1 < s.pts.length; i++) this.stampSeg(s.pts[i], s.pts[i + 1], s.w[i], s.w[i + 1]);
  }

  private trace(sx: number, sz: number, rng: RNG): Stream | null {
    const { site, E } = this, { RI, p } = site;
    let x = sx, z = sz;
    const r0 = Math.hypot(x, z) || 1;
    let dx = x / r0, dz = z / r0;
    const pts: V3[] = [];
    let level = Infinity, fall: Stream['fall'];
    const depth = 0.6, step = 0.6, eps = 1.2;
    const mOff = rng.range(0, 100);
    for (let i = 0; i < 400; i++) {
      const h0 = site.H0(x, z);
      level = Math.min(level - 0.004, h0 - depth);
      pts.push([x, level, z]);
      if (site.sea !== null && h0 < site.sea - 0.5) {
        for (let k = 1; k <= 4; k++) pts.push([x + dx * step * k, level, z + dz * step * k]);
        break;
      }
      const r = Math.hypot(x, z);
      if (r > E * 0.96) break;
      if (p.terrain === 'crag' && r > RI * 0.5) {
        const ah = site.H0(x + dx * 1.6, z + dz * 1.6);
        if (ah < h0 - 2.6) { fall = { p: [x, level + 0.3, z], dx, dz }; break; }
      }
      const gx = (site.Hs(x + eps, z) - site.Hs(x - eps, z)) / (2 * eps), gz = (site.Hs(x, z + eps) - site.Hs(x, z - eps)) / (2 * eps);
      const gl = Math.hypot(gx, gz) || 1e-6;
      const ox = x / (r || 1), oz = z / (r || 1);
      const m = (noise3(i * 0.07 + mOff, 0.5, 3.3) - 0.5) * 1.6;
      let wx = (-gx / gl) * Math.min(1, gl * 2.5) + ox * 0.4 - oz * m, wz = (-gz / gl) * Math.min(1, gl * 2.5) + oz * 0.4 + ox * m;
      const wl = Math.hypot(wx, wz) || 1;
      wx /= wl; wz /= wl;
      dx = dx * 0.6 + wx * 0.4; dz = dz * 0.6 + wz * 0.4;
      const dl = Math.hypot(dx, dz) || 1;
      dx /= dl; dz /= dl;
      x += dx * step; z += dz * step;
    }
    if (pts.length < 18) return null;
    // a stream that would cut a deep gorge through a ridge is no good
    let deep = 0;
    for (const q of pts) deep = Math.max(deep, site.H0(q[0], q[2]) - q[1]);
    if (deep > 4.5) return null;
    const w = pts.map((_, i) => 0.9 + 0.6 * (i / pts.length));
    return { pts, w, fall };
  }

  private makePonds(rng: RNG) {
    const { site } = this, { RI, p } = site;
    const want = p.terrain === 'hilltop' ? 2 : 1;
    let best: { x: number; z: number; s: number; r: number }[] = [];
    for (let i = 0; i < 260; i++) {
      const a = rng.range(0, Math.PI * 2), rr = Math.sqrt(rng.range(0.09, 0.62)) * RI;
      const x = Math.cos(a) * rr, z = Math.sin(a) * rr;
      const R = rng.range(2.2, 3.4);
      if (this.bilerp(this.distG, x, z) < R + 5) continue;
      const [lo, hi] = site.span(x, z, R * 1.2);
      if (hi - lo > 1.0) continue;
      if (site.sea !== null && lo < site.sea + 1.2) continue;
      let ring = 0;
      for (let k = 0; k < 12; k++) { const t = (k / 12) * Math.PI * 2; ring += site.H0(x + Math.cos(t) * (R + 4), z + Math.sin(t) * (R + 4)); }
      const s = ring / 12 - site.H0(x, z) + rng.range(0, 0.6) - Math.abs(rr / RI - 0.5);
      best.push({ x, z, s, r: R });
    }
    best = best.sort((u, v) => v.s - u.s);
    for (const c of best) {
      if (this.ponds.length >= want) break;
      if (this.ponds.some((o) => Math.hypot(o.x - c.x, o.z - c.z) < o.r + c.r + 10)) continue;
      let level = Infinity;
      for (let k = 0; k < 24; k++) for (const f of [1.0, 1.12, 1.25]) {
        const t = (k / 24) * Math.PI * 2;
        level = Math.min(level, this.Hc(c.x + Math.cos(t) * c.r * f, c.z + Math.sin(t) * c.r * f));
      }
      level -= 0.08;
      this.ponds.push({ x: c.x, z: c.z, r: c.r, level });
    }
    const { cell, N, E } = this;
    for (const pd of this.ponds) {
      const R = pd.r + 5;
      for (let i = Math.max(0, Math.floor((pd.x - R + E) / cell)); i <= Math.min(N - 1, Math.ceil((pd.x + R + E) / cell)); i++) {
        for (let j = Math.max(0, Math.floor((pd.z - R + E) / cell)); j <= Math.min(N - 1, Math.ceil((pd.z + R + E) / cell)); j++) {
          const x = -E + i * cell, z = -E + j * cell, d = Math.hypot(x - pd.x, z - pd.z);
          const q = d / pd.r;
          const C = q < 1 ? pd.level - 0.9 * (1 - q * q) : pd.level + (d - pd.r) * 0.7 + (d - pd.r) ** 2 * 0.1;
          const k = i * N + j;
          if (C < this.carveG[k]) this.carveG[k] = C;
          const wet = (pd.r * 0.95 - d) / pd.r;
          if (wet > this.wetG[k]) { this.wetG[k] = wet; }
          if (d < pd.r + 1.5) { this.kindG[k] = 2; this.levelG[k] = pd.level; this.distG[k] = Math.min(this.distG[k], Math.max(0, d - pd.r)); }
        }
      }
    }
  }

  private makeMoisture() {
    const { mN, mCell, E } = this;
    const src: { x: number; z: number; r: number; l: number }[] = [];
    for (const s of this.streams) for (let i = 0; i < s.pts.length; i += 2) src.push({ x: s.pts[i][0], z: s.pts[i][2], r: s.w[i], l: s.pts[i][1] + 0.3 });
    for (const pd of this.ponds) src.push({ x: pd.x, z: pd.z, r: pd.r, l: pd.level });
    for (let i = 0; i < mN; i++) for (let j = 0; j < mN; j++) {
      const x = -E + i * mCell, z = -E + j * mCell;
      let bd = 1e4, bl = -100;
      for (const s of src) { const d = Math.hypot(x - s.x, z - s.z) - s.r; if (d < bd) { bd = d; bl = s.l; } }
      this.moistD[i * mN + j] = Math.max(0, bd); this.moistL[i * mN + j] = bl;
    }
  }
  private moist(x: number, z: number): [number, number] {
    const { mN, mCell, E } = this;
    const fx = (x + E) / mCell, fz = (z + E) / mCell;
    const i = Math.min(mN - 2, Math.max(0, Math.floor(fx))), j = Math.min(mN - 2, Math.max(0, Math.floor(fz)));
    const tx = Math.min(1, Math.max(0, fx - i)), tz = Math.min(1, Math.max(0, fz - j)), k = i * mN + j;
    const L = (G: Float32Array) => (G[k] * (1 - tx) + G[k + mN] * tx) * (1 - tz) + (G[k + 1] * (1 - tx) + G[k + mN + 1] * tx) * tz;
    return [L(this.moistD), this.moistL[Math.round(fx) * mN + Math.round(fz)] ?? -100];
  }
  /** distance to the nearest stream or pond */
  waterDist(x: number, z: number) { return this.moist(x, z)[0]; }

  // ------------------------------------------------------------ woods
  /** raw woodland noise 0..1 (woods where it is high, clearings where it dips) */
  forestN(x: number, z: number) {
    const o = this.site.nOff;
    return noise3(x * 0.05 + o, 7.7, z * 0.05) * 0.75 + noise3(x * 0.14, 3.1, z * 0.14 + o) * 0.25;
  }
  /** how wooded the land wants to be here, 0..1 */
  forest(x: number, z: number) { return smooth(0.4, 0.56, this.forestN(x, z)); }

  // ------------------------------------------------------------ soil & groundwater
  /** Fertility 0..1: rich near fresh water and on flat meadow, poor on rock, steep ground and sand. */
  soil(x: number, z: number) {
    const { site } = this;
    const [lo, hi] = site.span(x, z, 1.6);
    const slope = hi - lo;
    const h = site.H(x, z);
    let f = 0.5;
    f += 0.38 * Math.exp(-this.waterDist(x, z) / 7);
    f -= 0.45 * smooth(0.4, 2.2, slope);
    if (site.sea !== null) f -= 0.4 * (1 - smooth(site.sea + 0.8, site.sea + 2.6, h)); // sand and salt
    if (site.p.terrain === 'crag') f -= 0.12 * smooth(4, 9, h); // thin soil on the high rock
    if (site.p.terrain === 'hilltop') f += 0.06;
    f += (noise3(x * 0.06 + 11, 2.2, z * 0.06 - site.nOff) - 0.5) * 0.4;
    if (this.water(x, z)) f = 0;
    return Math.min(1, Math.max(0, f));
  }
  /** Farm output multiplier from the soil around a spot (0.4 .. 1.6). */
  soilMul(x: number, z: number, r = 5) {
    let s = this.soil(x, z) * 2, n = 2;
    for (let k = 0; k < 8; k++) { const t = (k / 8) * Math.PI * 2; s += this.soil(x + Math.cos(t) * r, z + Math.sin(t) * r); n++; }
    const f = s / n;
    return { soil: f, mul: 0.4 + 1.2 * f };
  }
  /** How far down the groundwater is (m). Near streams/ponds and on low ground it is shallow. */
  tableDepth(x: number, z: number) {
    const [d, l] = this.moist(x, z);
    const level = Math.max(this.tableBase, l - 0.09 * d);
    return Math.max(0, this.site.H(x, z) - level);
  }

  // ------------------------------------------------------------ landmarks of nature
  private makeFeatures(rng: RNG) {
    const { site } = this, { RI, TR, p } = site;
    const F = this.features;
    const add = (kind: FeatureKind, x: number, z: number, r: number, yaw: number) => F.push({ id: F.length, kind, x, z, r, yaw });
    const clear = (x: number, z: number, r: number) =>
      !F.some((f) => Math.hypot(f.x - x, f.z - z) < f.r + r + 3) && this.bilerp(this.distG, x, z) > r + 2.5 && !this.water(x, z);
    const flat = (x: number, z: number, r: number, tol: number) => { const [lo, hi] = site.span(x, z, r); return hi - lo < tol && (site.sea === null || lo > site.sea + 0.9); };
    const find = (n: number, rMin: number, rMax: number, ok: (x: number, z: number) => boolean, score: (x: number, z: number) => number) => {
      let best: [number, number] | null = null, bs = -Infinity;
      for (let i = 0; i < n; i++) {
        const a = rng.range(0, Math.PI * 2), r = rng.range(rMin, rMax);
        const x = Math.cos(a) * r, z = Math.sin(a) * r;
        if (!ok(x, z)) continue;
        const s = score(x, z) + rng.range(0, 1);
        if (s > bs) { bs = s; best = [x, z]; }
      }
      return best;
    };
    // island: the old pier and boathouse on the shore
    if (site.sea !== null) {
      for (let tries = 0; tries < 40; tries++) {
        const a = rng.range(0, Math.PI * 2);
        let r = RI * 0.5, prev = r;
        while (r < RI * 1.6 && this.Hc(Math.cos(a) * r, Math.sin(a) * r) > site.sea + 0.35) { prev = r; r += 0.3; }
        const x = Math.cos(a) * prev, z = Math.sin(a) * prev;
        if (this.waterDist(x, z) < 8 || !clear(x, z, 3)) continue;
        // gentle beach: the ground a few metres inland is not a cliff
        const hin = this.Hc(Math.cos(a) * (prev - 3), Math.sin(a) * (prev - 3));
        if (hin - site.sea > 2.6) continue;
        add('pier', x, z, 2.5, a);
        break;
      }
    }
    // the village well: in town where the groundwater is shallowest
    const w = find(160, TR * 0.25, TR * 0.85, (x, z) => flat(x, z, 1.4, 0.5) && clear(x, z, 1.5), (x, z) => -this.tableDepth(x, z));
    if (w && this.tableDepth(w[0], w[1]) < WELL_MAX_DEPTH) add('well', w[0], w[1], 1.2, rng.range(0, 6));
    // a ruin inside the town limits (clear it for stone and building room) and one out in the wilds
    const r1 = find(120, TR * 0.6, TR * 1.05, (x, z) => flat(x, z, 3, 1.0) && clear(x, z, 3), () => 0);
    if (r1) add('ruin', r1[0], r1[1], 3.0, rng.range(0, 6));
    const r2 = find(120, TR * 1.2, RI * 0.9, (x, z) => flat(x, z, 3, 1.4) && clear(x, z, 3), (x, z) => site.H(x, z) * 0.2);
    if (r2) add('ruin', r2[0], r2[1], 3.0, rng.range(0, 6));
    // standing stones on a high, open spot out of town
    const sr = find(200, TR * 1.15, RI * (p.terrain === 'hilltop' ? 1.0 : 0.88), (x, z) => flat(x, z, 3.6, 1.2) && clear(x, z, 4), (x, z) => site.H(x, z));
    if (sr) add('ring', sr[0], sr[1], 4.0, rng.range(0, 6));
    // a cave mouth in a cliff / terrace step
    let cv: { x: number; z: number; yaw: number; s: number } | null = null;
    for (let i = 0; i < 400; i++) {
      const a = rng.range(0, Math.PI * 2), r = rng.range(TR * 0.9, RI * (p.terrain === 'crag' ? 0.9 : 1.0));
      const x = Math.cos(a) * r, z = Math.sin(a) * r;
      const e = 0.8, gx = this.Hc(x + e, z) - this.Hc(x - e, z), gz = this.Hc(x, z + e) - this.Hc(x, z - e);
      const g = Math.hypot(gx, gz);
      if (g < 2.4 || !clear(x, z, 2)) continue;
      const fx = x - (gx / g) * 1.6, fz = z - (gz / g) * 1.6; // foot of the cliff
      const drop = this.Hc(x + (gx / g) * 1.6, z + (gz / g) * 1.6) - this.Hc(fx, fz);
      if (drop < 2.6 || (site.sea !== null && this.Hc(fx, fz) < site.sea + 0.5) || this.water(fx, fz)) continue;
      const s = drop + rng.range(0, 1);
      if (!cv || s > cv.s) cv = { x: fx, z: fz, yaw: Math.atan2(-gz, -gx), s };
    }
    if (cv) add('cave', cv.x, cv.z, 2.0, cv.yaw);
    // shrine anchor (snapped to the nearest path when the ground is built)
    const sh = find(80, TR * 0.7, TR * 1.1, (x, z) => flat(x, z, 1, 0.6) && clear(x, z, 1), () => 0);
    if (sh) add('shrine', sh[0], sh[1], 1.0, rng.range(0, 6));
  }

  /** Features that are still standing (cleared ruins are gone). */
  live() { return this.features.filter((f) => !(f.kind === 'ruin' && this.cleared.has(f.id))); }
  /** The ruin under (x,z), if any. */
  ruinAt(x: number, z: number) {
    return this.live().find((f) => f.kind === 'ruin' && Math.hypot(f.x - x, f.z - z) < f.r + 0.6) ?? null;
  }

  // ------------------------------------------------------------ woods
  /** 0 = stump, (0..1) sapling growing, 1 = full tree */
  growth(id: number) {
    const d = this.felled.get(id);
    if (d === undefined) return 1;
    const age = this.day - d;
    if (age < STUMP_DAYS) return 0;
    return Math.min(1, (age - STUMP_DAYS + 1) / (REGROW_DAYS - STUMP_DAYS + 1));
  }
  /** Advance regrowth: trees that have grown back are no longer 'felled'. */
  regrow() { for (const [id, d] of [...this.felled]) if (this.day - d >= REGROW_DAYS) this.felled.delete(id); }
  /** Standing mature trees within reach of a point. */
  standingNear(x: number, z: number, reach: number) {
    return this.trees.filter((t) => !this.felled.has(t.id) && Math.hypot(t.x - x, t.z - z) < reach);
  }
}
