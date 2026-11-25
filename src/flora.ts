/**
 * Layered plant life. Each layer is a Poisson-disk style scatter with its own spacing and an ecology
 * rule; later layers avoid everything placed before (rocks → trees → bushes → flowers → grass), plus
 * buildings, paths, fields and water. Each site has its own flora.
 */
import { Builder, M, V3, beam, lathe } from './builder';
import { RNG, noise3 } from './rng';
import { Q } from './quality';
import { hashSeed, type GroundOut, type Site } from './tower';
import type { TreeRec } from './landscape';

/** Spatial hash of occupied circles (plan view). */
export class Occ {
  private cell = 2;
  private map = new Map<number, number[]>();
  private key(i: number, j: number) { return (i + 1000) * 4096 + (j + 1000); }
  add(x: number, z: number, r: number) {
    const c = this.cell;
    for (let i = Math.floor((x - r) / c); i <= Math.floor((x + r) / c); i++) for (let j = Math.floor((z - r) / c); j <= Math.floor((z + r) / c); j++) {
      const k = this.key(i, j);
      let a = this.map.get(k);
      if (!a) this.map.set(k, (a = []));
      a.push(x, z, r);
    }
  }
  hit(x: number, z: number, r: number) {
    const c = this.cell;
    for (let i = Math.floor((x - r) / c); i <= Math.floor((x + r) / c); i++) for (let j = Math.floor((z - r) / c); j <= Math.floor((z + r) / c); j++) {
      const a = this.map.get(this.key(i, j));
      if (!a) continue;
      for (let k = 0; k < a.length; k += 3) { const dx = a[k] - x, dz = a[k + 1] - z, rr = a[k + 2] + r; if (dx * dx + dz * dz < rr * rr) return true; }
    }
    return false;
  }
}

interface Profile {
  rock: number; tree: number; bush: number; flower: number; tuft: number;
  /** tree mix: [pine, bent pine, broadleaf, oak] weights */
  mix: [number, number, number, number];
  bushKind: 'gorse' | 'juniper' | 'hazel';
  flowers: number[];
  heather: number; dune: boolean;
}
const PROFILES: Record<string, Profile> = {
  island: { rock: 0.5, tree: 1.3, bush: 1.0, flower: 0.8, tuft: 1.2, mix: [0.15, 0.6, 0.25, 0], bushKind: 'gorse', flowers: [M.PLASTER, M.ACCENT, M.PLASTER], heather: 0.3, dune: true },
  crag: { rock: 1.7, tree: 1.0, bush: 0.8, flower: 0.5, tuft: 0.9, mix: [0.8, 0, 0.2, 0], bushKind: 'juniper', flowers: [M.ACCENT, M.PLASTER], heather: 1.0, dune: false },
  hilltop: { rock: 0.35, tree: 0.85, bush: 1.0, flower: 1.4, tuft: 1.0, mix: [0.12, 0, 0.3, 0.58], bushKind: 'hazel', flowers: [M.ACCENT, M.PLASTER, M.SLATE, M.TILE], heather: 0.15, dune: false },
};

const smooth = (a: number, b: number, x: number) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
/** the terrain's ink id: things drawn with it get no outline of their own (soft colour dabs) */
export const TERRAIN_ID = 900_000_000;
const SEG = Q.low ? 5 : 7;

/** Plant everything. Records trees (with stable ids) in site.land.trees. */
export function plantLife(b: Builder, site: Site, occ: Occ, out: GroundOut) {
  const P = PROFILES[site.p.terrain] ?? PROFILES.hilltop;
  const { RI, land, sea } = site;
  const Rmax = RI * (site.p.terrain === 'hilltop' ? 1.12 : 1.02);
  const area = Math.PI * Rmax * Rmax;
  const windA = (site.p.seed % 7) * 0.9;
  const wind: [number, number] = [Math.cos(windA), Math.sin(windA)];
  // ecology fields
  const forestN = (x: number, z: number) => land.forestN(x, z);
  const forest = (x: number, z: number) => land.forest(x, z);
  const edge = (x: number, z: number) => Math.max(0, 1 - Math.abs(forestN(x, z) - 0.5) / 0.07);
  const sand = (h: number) => (sea !== null ? 1 - smooth(sea + 0.6, sea + 1.8, h) : 0);
  const info = (x: number, z: number) => {
    const [lo, hi] = site.span(x, z, 0.9);
    return { lo, hi, slope: hi - lo, h: site.H(x, z), wet: land.water(x, z) };
  };
  const inRange = (x: number, z: number) => Math.hypot(x, z) < land.E * 0.97;
  const disk = (rng: RNG): [number, number] => { const a = rng.range(0, Math.PI * 2), r = Math.sqrt(rng.next()) * Rmax; return [Math.cos(a) * r, Math.sin(a) * r]; };

  // ---- 1. rocks & boulders: steep ground, ridges, rocky sites
  {
    const rng = new RNG(hashSeed(site.p.seed, 101));
    const n = Math.round(area * 0.02 * P.rock * (Q.low ? 0.6 : 1));
    for (let i = 0; i < n; i++) {
      const [x, z] = disk(rng);
      const r = 0.3 + rng.next() ** 2.2 * 1.0, seed = rng.next(), roll = rng.next();
      if (!inRange(x, z)) continue;
      const I = info(x, z);
      if (I.wet || (sea !== null && I.lo < sea - 0.2)) continue;
      const ridge = Math.max(0, I.h - site.H(x + 4, z) * 0.5 - site.H(x - 4, z) * 0.5);
      const dens = 0.12 + smooth(0.5, 2.5, I.slope) * 0.9 + smooth(0.3, 1.5, ridge) * 0.5 + (land.waterDist(x, z) < 2 ? 0.3 : 0);
      if (roll > dens) continue;
      if (occ.hit(x, z, r + 0.2)) continue;
      occ.add(x, z, r + 0.1);
      boulder(b, x, I.lo, z, r, seed);
      if (r > 0.45) out.obstacles.push({ x, z, r: r * 0.9, kind: 'rock' });
    }
  }

  // ---- 2. trees: woods shaped by noise (with clearings), none on steep rock, sand or water
  const trees: TreeRec[] = [];
  {
    const rng = new RNG(hashSeed(site.p.seed, 777));
    const n = Math.round(area * 0.1 * P.tree);
    for (let i = 0; i < n; i++) {
      const [x, z] = disk(rng);
      const s = rng.range(0.8, 1.3), roll = rng.next(), kindR = rng.next(), seed = rng.next();
      if (!inRange(x, z)) continue;
      const I = info(x, z);
      if (I.wet || I.slope > 1.2 || sand(I.lo) > 0.3 || (sea !== null && I.lo < sea + 0.7)) continue;
      if (site.p.terrain !== 'hilltop' && Math.hypot(x, z) > RI * 0.9) continue;
      const dens = 0.07 + forest(x, z) * 0.93;
      if (roll > dens) continue;
      if (land.waterDist(x, z) < 1.4) continue;
      if (occ.hit(x, z, 1.15 * s)) continue;
      occ.add(x, z, 0.9 * s);
      const kind = pickKind(P.mix, kindR);
      const t: TreeRec = { id: i, x, z, s, kind, y: I.lo };
      trees.push(t);
      const g = land.growth(i);
      if (g < 1) stump(b, x, I.lo, z, s);
      if (g > 0) tree(b, site, x, I.lo, z, kind, s * (g < 1 ? 0.3 + 0.6 * g : 1), seed, wind);
      out.obstacles.push({ x, z, r: g > 0 ? 0.45 * s : 0.3, kind: g > 0 ? 'tree' : 'stump' });
    }
  }
  land.trees = trees;

  // ---- 3. bushes: forest edges, scrub on slopes, gorse on island braes
  {
    const rng = new RNG(hashSeed(site.p.seed, 303));
    const n = Math.round(area * 0.04 * P.bush * (Q.low ? 0.5 : 1));
    for (let i = 0; i < n; i++) {
      const [x, z] = disk(rng);
      const s = rng.range(0.7, 1.15), roll = rng.next(), seed = rng.next();
      if (!inRange(x, z)) continue;
      const I = info(x, z);
      if (I.wet || I.slope > 1.6 || (sea !== null && I.lo < sea + 0.5)) continue;
      const dens = 0.03 + edge(x, z) * 0.6 + forest(x, z) * 0.12 + (P.bushKind === 'gorse' ? smooth(0.3, 1.2, I.slope) * 0.3 : 0);
      if (roll > dens) continue;
      if (occ.hit(x, z, 0.65 * s)) continue;
      occ.add(x, z, 0.55 * s);
      bush(b, x, I.lo, z, s, seed, P.bushKind);
      out.obstacles.push({ x, z, r: 0.6 * s, kind: 'bush' });
    }
  }

  // ---- 4. flowers: meadow patches on flat fertile ground, banks of streams; heather on ridges
  {
    const rng = new RNG(hashSeed(site.p.seed, 404));
    const n = Math.round(area * 0.05 * P.flower * (Q.low ? 0.4 : 1));
    for (let i = 0; i < n; i++) {
      const [x, z] = disk(rng);
      const roll = rng.next(), seed = rng.next(), col = rng.pick(P.flowers);
      if (!inRange(x, z)) continue;
      const I = info(x, z);
      if (I.wet || (sea !== null && I.lo < sea + 0.4)) continue;
      const wd = land.waterDist(x, z);
      const heath = P.heather * (smooth(0.6, 2.0, I.slope) * 0.6 + smooth(4, 9, I.h) * 0.4);
      const meadow = (1 - forest(x, z)) * smooth(0.9, 0.2, I.slope) * (0.25 + 0.75 * land.soil(x, z));
      const bank = wd < 2.5 ? 0.6 : 0;
      const isHeath = heath > meadow && heath > bank;
      const dens = Math.max(meadow * 0.55, bank, heath * 0.7) * (sand(I.lo) > 0.5 ? 0.2 : 1);
      if (roll > dens) continue;
      if (occ.hit(x, z, 0.5)) continue;
      occ.add(x, z, 0.45);
      if (isHeath) heather(b, site, x, z, seed);
      else flowerPatch(b, site, x, z, seed, col);
    }
  }

  // ---- 5. grass tufts: meadow tufts, dune grass on island sand, reeds on banks
  {
    const rng = new RNG(hashSeed(site.p.seed, 505));
    const n = Math.round(area * 0.07 * P.tuft * (Q.low ? 0.35 : 1));
    for (let i = 0; i < n; i++) {
      const [x, z] = disk(rng);
      const roll = rng.next(), seed = rng.next();
      if (!inRange(x, z)) continue;
      const I = info(x, z);
      if (I.wet || (sea !== null && I.lo < sea + 0.15)) continue;
      const wd = land.waterDist(x, z);
      const dune = P.dune ? sand(I.lo) : 0;
      const reed = wd < 1.6 ? 1 : 0;
      const dens = Math.max(0.12 + (1 - forest(x, z)) * 0.25, dune * 0.9, reed * 0.95) * smooth(2.5, 1.0, I.slope);
      if (roll > dens) continue;
      if (occ.hit(x, z, 0.25)) continue;
      occ.add(x, z, 0.2);
      if (reed) reeds(b, site, x, z, seed);
      else tuft(b, site, x, z, seed, dune > 0.5, wind);
    }
  }
}

function pickKind(mix: number[], r: number) {
  const t = mix.reduce((a, b) => a + b, 0);
  let acc = 0;
  for (let i = 0; i < mix.length; i++) { acc += mix[i] / t; if (r < acc) return i; }
  return mix.length - 1;
}

// ---------------------------------------------------------------- plant geometry

export function boulder(b: Builder, x: number, y: number, z: number, r: number, seed: number) {
  const rng = new RNG(Math.floor(seed * 1e9));
  b.begin(M.ROCK, rng.range(0.25, 0.75));
  const h = r * rng.range(0.6, 1.0);
  lathe(b, x, y - r * 0.35, z, [[r * 0.9, 0], [r * 1.05, h * 0.45], [r * 0.7, h * 0.95], [r * 0.15, h * 1.15]], 5 + (r > 0.7 ? 1 : 0), rng.range(0, 6));
  if (r > 0.6) { // a little companion stone
    const a = rng.range(0, 6), rr = r * 0.4;
    lathe(b, x + Math.cos(a) * r * 1.1, y - rr * 0.4, z + Math.sin(a) * r * 1.1, [[rr, 0], [rr * 1.05, rr * 0.5], [rr * 0.4, rr * 1.0], [0.02, rr * 1.1]], 5, rng.range(0, 6));
  }
}

export function stump(b: Builder, x: number, y: number, z: number, s: number) {
  b.begin(M.TIMBER, 0.55);
  lathe(b, x, y - 0.2, z, [[0.3 * s, 0], [0.24 * s, 0.25], [0.22 * s, 0.5], [0.01, 0.52]], 6);
}

const blob = (b: Builder, r: RNG, cx: number, cy: number, cz: number, rad: number, sy = 1) =>
  lathe(b, cx, cy - rad * sy, cz, [[0.02, 0], [rad * 0.75, rad * 0.3 * sy], [rad, rad * 0.95 * sy], [rad * 0.8, rad * 1.55 * sy], [0.02, rad * 1.9 * sy]], SEG, r.range(0, 6));

/** kind: 0 pine, 1 wind-bent pine, 2 round broadleaf, 3 oak, 4 fruit tree */
export function tree(b: Builder, site: Site, x: number, y: number, z: number, kind: number, s: number, seed: number, wind: [number, number]) {
  const r = new RNG(Math.floor(seed * 1e9));
  if (kind === 2) { site.tree(b, x, y, z, 0.5, s, seed); return; }
  if (kind === 0) {
    const h = r.range(3.2, 4.8) * s;
    b.begin(M.TIMBER, r.next());
    beam(b, [x, y - 0.3, z], [x, y + 0.9 * s, z], 0.2 * s, 0.2 * s);
    b.begin(M.GRASS, r.range(0.0, 0.15));
    for (let i = 0; i < 3; i++) {
      const y0 = y + 0.6 * s + i * h * 0.25, rad = (1.25 - i * 0.32) * s;
      lathe(b, x, y0, z, [[rad, 0], [rad * 0.45, h * 0.3], [0.02, h * 0.42]], SEG + 1, r.range(0, 6));
    }
    return;
  }
  if (kind === 1) { // wind-bent pine: trunk leans downwind, flat canopy pads streaming away
    const h = r.range(2.4, 3.4) * s, lean = r.range(0.7, 1.3) * s;
    const mid: V3 = [x + wind[0] * lean * 0.4, y + h * 0.55, z + wind[1] * lean * 0.4];
    const top: V3 = [x + wind[0] * lean, y + h, z + wind[1] * lean];
    b.begin(M.TIMBER, r.next());
    beam(b, [x, y - 0.3, z], mid, 0.22 * s);
    beam(b, mid, top, 0.17 * s);
    b.begin(M.GRASS, r.range(0.0, 0.2));
    for (let i = 0; i < 3; i++) {
      const t = i / 2, rad = (1.0 - i * 0.18) * s;
      lathe(b, top[0] + wind[0] * t * 0.9 * s - wind[0] * 0.3, top[1] - 0.4 + i * 0.35 * s, top[2] + wind[1] * t * 0.9 * s - wind[1] * 0.3,
        [[0.02, 0], [rad * 1.2, rad * 0.18], [rad * 1.05, rad * 0.45], [0.02, rad * 0.6]], SEG, r.range(0, 6));
    }
    return;
  }
  if (kind === 3) { // oak: stout trunk, wide spreading crown
    const h = r.range(1.9, 2.5) * s;
    b.begin(M.TIMBER, r.next());
    beam(b, [x, y - 0.3, z], [x, y + h, z], 0.36 * s);
    for (const a of [r.range(0, 6), r.range(0, 6)]) beam(b, [x, y + h * 0.75, z], [x + Math.cos(a) * 1.0 * s, y + h + 0.5 * s, z + Math.sin(a) * 1.0 * s], 0.18 * s);
    b.begin(M.GRASS, r.range(0.0, 0.2));
    const k = r.int(4, 6);
    for (let i = 0; i < k; i++) {
      const a = (i / k) * Math.PI * 2 + r.next();
      blob(b, r, x + Math.cos(a) * 1.2 * s, y + h + r.range(0.2, 0.8) * s, z + Math.sin(a) * 1.2 * s, r.range(0.95, 1.2) * s, 0.8);
    }
    blob(b, r, x, y + h + 1.1 * s, z, 1.2 * s, 0.85);
    return;
  }
  // fruit tree: small round crown with fruit dabs (same piece: no extra outlines)
  const h = r.range(1.2, 1.6) * s;
  b.begin(M.TIMBER, r.next());
  beam(b, [x, y - 0.3, z], [x, y + h, z], 0.16 * s);
  b.begin(M.GRASS, r.range(0.15, 0.35));
  blob(b, r, x, y + h + 0.4 * s, z, 0.85 * s, 0.9);
  b.mat = M.ACCENT;
  for (let i = 0; i < 5; i++) {
    const a = r.range(0, 6), e = r.range(-0.2, 0.7);
    lathe(b, x + Math.cos(a) * 0.82 * s, y + h + 0.4 * s + e * 0.9 * s, z + Math.sin(a) * 0.82 * s, [[0.01, 0], [0.11, 0.06], [0.01, 0.17]], 4);
  }
}

function bush(b: Builder, x: number, y: number, z: number, s: number, seed: number, kind: Profile['bushKind']) {
  const r = new RNG(Math.floor(seed * 1e9));
  b.begin(M.GRASS, kind === 'juniper' ? r.range(0.0, 0.12) : r.range(0.1, 0.35));
  const k = kind === 'juniper' ? 2 : 3;
  const pts: V3[] = [];
  for (let i = 0; i < k; i++) {
    const p: V3 = [x + r.range(-0.45, 0.45) * s, y + 0.3 * s, z + r.range(-0.45, 0.45) * s];
    const rad = r.range(0.38, 0.55) * s;
    pts.push(p);
    if (kind === 'juniper') lathe(b, p[0], y - 0.1, p[2], [[rad, 0], [rad * 0.7, rad * 1.4], [0.02, rad * 2.2]], SEG, r.range(0, 6));
    else blob(b, r, p[0], p[1], p[2], rad, 0.85);
  }
  if (kind === 'gorse') { // yellow flowers on the same piece
    b.mat = M.PLASTER;
    for (let i = 0; i < 6; i++) {
      const p = r.pick(pts), a = r.range(0, 6), e = r.range(0.1, 0.8);
      lathe(b, p[0] + Math.cos(a) * 0.42 * s, p[1] + e * 0.45 * s, p[2] + Math.sin(a) * 0.42 * s, [[0.01, 0], [0.1, 0.05], [0.01, 0.14]], 4);
    }
  }
}

function flowerPatch(b: Builder, site: Site, x: number, z: number, seed: number, col: number) {
  const r = new RNG(Math.floor(seed * 1e9));
  b.begin(col, r.range(0.4, 0.9));
  b.id = TERRAIN_ID; // soft dabs of colour, inked only where they catch an edge
  const k = r.int(5, 9);
  for (let i = 0; i < k; i++) {
    const px = x + r.range(-0.55, 0.55), pz = z + r.range(-0.55, 0.55), y = site.H(px, pz);
    const fr = r.range(0.07, 0.12);
    lathe(b, px, y + r.range(0.12, 0.3), pz, [[0.01, 0], [fr, fr * 0.45], [fr * 0.7, fr * 0.9], [0.01, fr * 1.1]], 5, r.range(0, 6));
  }
}

function heather(b: Builder, site: Site, x: number, z: number, seed: number) {
  const r = new RNG(Math.floor(seed * 1e9));
  b.begin(M.ACCENT, r.range(0.05, 0.3));
  b.id = TERRAIN_ID;
  for (let i = 0; i < 3; i++) {
    const px = x + r.range(-0.4, 0.4), pz = z + r.range(-0.4, 0.4), y = site.H(px, pz), rad = r.range(0.25, 0.42);
    lathe(b, px, y - 0.08, pz, [[rad, 0], [rad * 0.8, 0.16], [0.02, 0.24]], 5, r.range(0, 6));
  }
}

function tuft(b: Builder, site: Site, x: number, z: number, seed: number, dune: boolean, wind: [number, number]) {
  const r = new RNG(Math.floor(seed * 1e9));
  const y = site.H(x, z);
  b.begin(M.GRASS, dune ? r.range(0.75, 1.0) : r.range(0.2, 0.5));
  b.id = TERRAIN_ID;
  const k = dune ? 5 : 3, H = dune ? 0.75 : 0.42;
  for (let i = 0; i < k; i++) {
    const a = r.range(0, Math.PI * 2), h = H * r.range(0.7, 1.2);
    const bx = x + Math.cos(a) * 0.08, bz = z + Math.sin(a) * 0.08;
    const lean = dune ? 0.35 : 0.15;
    const tx = bx + Math.cos(a) * h * 0.3 + wind[0] * h * lean, tz = bz + Math.sin(a) * h * 0.3 + wind[1] * h * lean;
    const px = -Math.sin(a) * 0.05, pz = Math.cos(a) * 0.05;
    b.tri([bx - px, y - 0.05, bz - pz], [bx + px, y - 0.05, bz + pz], [tx, y + h, tz], [0, 0], [1, 0], [0.5, 1]);
  }
}

function reeds(b: Builder, site: Site, x: number, z: number, seed: number) {
  const r = new RNG(Math.floor(seed * 1e9));
  const y = site.H(x, z);
  b.begin(M.GRASS, r.range(0.35, 0.6));
  const tops: V3[] = [];
  for (let i = 0; i < 5; i++) {
    const a = r.range(0, Math.PI * 2), h = r.range(0.8, 1.35);
    const bx = x + Math.cos(a) * 0.12, bz = z + Math.sin(a) * 0.12;
    const tx = bx + Math.cos(a) * 0.2, tz = bz + Math.sin(a) * 0.2;
    const px = -Math.sin(a) * 0.04, pz = Math.cos(a) * 0.04;
    b.tri([bx - px, y - 0.05, bz - pz], [bx + px, y - 0.05, bz + pz], [tx, y + h, tz], [0, 0], [1, 0], [0.5, 1]);
    if (i < 3) tops.push([tx, y + h * 0.8, tz]);
  }
  b.mat = M.TIMBER; // bulrush heads
  for (const t of tops) beam(b, [t[0], t[1] - 0.15, t[2]], [t[0], t[1] + 0.12, t[2]], 0.07);
}
