/**
 * Landmarks of nature and small rural fixtures: standing stones, ruins, cave mouths, the village well,
 * a wayside shrine, benches at viewpoints — plus the bespoke `well` and `pier` buildings.
 */
import { Builder, M, V3, XF, beam, box, gableX, hip, lathe } from './builder';
import { RNG } from './rng';
import { faceXf, type BlockRec, type Gen, type GroundOut, type Lot, type Site } from './tower';
import type { Feature } from './landscape';
import type { Occ } from './flora';

const rot = (x: number, z: number, a: number, y0 = 0): XF => {
  const c = Math.cos(a), s = Math.sin(a);
  return ([lx, ly, lz]) => [x + lx * c - lz * s, y0 + ly, z + lx * s + lz * c];
};

// ---------------------------------------------------------------- static (terrain) pieces

/** Ring of leaning standing stones with a fallen one and a flat altar stone. */
export function standingStones(b: Builder, site: Site, f: Feature) {
  const rng = new RNG(site.p.seed * 31 + f.id);
  const n = 9, R = 3.1;
  for (let i = 0; i < n; i++) {
    const a = f.yaw + (i / n) * Math.PI * 2;
    const x = f.x + Math.cos(a) * R, z = f.z + Math.sin(a) * R, y = site.H(x, z);
    const h = rng.range(1.5, 2.6), w = rng.range(0.55, 0.8), d = rng.range(0.35, 0.5);
    const fallen = i === 3;
    const lean = rng.range(-0.12, 0.12), lean2 = rng.range(-0.08, 0.08);
    b.begin(M.ROCK, rng.range(0.3, 0.7));
    b.with(([lx, ly, lz]) => {
      const c = Math.cos(a + Math.PI / 2), s = Math.sin(a + Math.PI / 2);
      if (fallen) { const t = ly; ly = lz + 0.3; lz = t; }
      const px = lx + ly * lean, pz = lz * (d / w) + ly * lean2;
      return [x + px * c - pz * s, y + ly - 0.4, z + px * s + pz * c];
    }, () => {
      // slightly tapering slab with a bevelled top
      lathe(b, 0, 0, 0, [[w * 0.7, 0], [w * 0.78, h * 0.35], [w * 0.68, h * 0.75], [w * 0.4, h * 0.97], [0.05, h + 0.1]], 5, rng.range(0, 6));
    });
  }
  b.begin(M.ROCK, 0.6);
  const y = site.H(f.x, f.z);
  box(b, f.x - 0.8, y - 0.3, f.z - 0.5, f.x + 0.8, y + 0.35, f.z + 0.5);
}

/** A dark cave mouth set into a cliff, framed by rocks. */
export function caveMouth(b: Builder, site: Site, f: Feature) {
  const rng = new RNG(site.p.seed * 17 + f.id);
  const y0 = site.H(f.x, f.z);
  // face the open ground: local +z points away from the cliff
  const a = f.yaw - Math.PI / 2;
  const c = Math.cos(a), s = Math.sin(a);
  const W = 1.25, Ht = 1.9;
  const X: XF = ([lx, ly, lz]) => [f.x + lx * c - (lz - 0.55) * s, y0 + ly, f.z + lx * s + (lz - 0.55) * c];
  b.with(X, () => {
    b.begin(M.IRON, 0.1);
    const k = 9;
    for (let i = 0; i < k; i++) {
      const t0 = Math.PI * (i / k), t1 = Math.PI * ((i + 1) / k);
      b.tri([0, -0.4, 0], [Math.cos(t0) * W, -0.4 + Math.sin(t0) * Ht, 0], [Math.cos(t1) * W, -0.4 + Math.sin(t1) * Ht, 0], [0, 0], [1, 0], [1, 1]);
    }
    // rough rock frame
    b.begin(M.ROCK, 0.55);
    for (let i = 0; i <= 6; i++) {
      const t = Math.PI * (i / 6);
      const r = rng.range(0.45, 0.7);
      lathe(b, Math.cos(t) * (W + 0.35), -0.6 + Math.sin(t) * (Ht + 0.2), 0.15, [[0.02, 0], [r, r * 0.5], [r * 0.85, r * 1.2], [0.02, r * 1.5]], 5, rng.range(0, 6));
    }
  });
}

/** Round stone well with a little roof, windlass and bucket. `X` places it (local, y = ground). */
export function wellGeo(b: Builder, rng: RNG) {
  b.begin(M.STONE, rng.range(0.3, 0.7));
  lathe(b, 0, -0.3, 0, [[0.78, 0], [0.8, 1.1], [0.62, 1.1], [0.6, 0.6]], 10);
  b.begin(M.WATER, 0.2);
  lathe(b, 0, 0.55, 0, [[0.61, 0], [0.01, 0]], 10);
  b.begin(M.TIMBER, rng.range(0.3, 0.6));
  for (const sx of [-0.72, 0.72]) beam(b, [sx, 0.5, 0], [sx, 2.15, 0], 0.13);
  beam(b, [-0.85, 1.55, 0], [0.85, 1.55, 0], 0.1);
  hip(b, -0.95, 0.95, -0.7, 0.7, 2.15, 0.55, 0.12, M.TILE, rng.range(0.3, 0.7));
  b.begin(M.PLANK, 0.4);
  lathe(b, 0.15, 1.05, 0, [[0.18, 0], [0.2, 0.3], [0.0, 0.3]], 6);
  b.begin(M.IRON, 0.5);
  beam(b, [0.15, 1.35, 0], [0.15, 1.55, 0], 0.03);
}

export function villageWell(b: Builder, site: Site, f: Feature) {
  const rng = new RNG(site.p.seed * 13 + f.id);
  b.with(rot(f.x, f.z, f.yaw, site.H(f.x, f.z)), () => wellGeo(b, rng));
}

// ---------------------------------------------------------------- dynamic (ground) pieces

/** Broken walls of an old stone house, a fallen column and rubble. */
export function ruin(b: Builder, site: Site, f: Feature, out: GroundOut) {
  const rng = new RNG(site.p.seed * 41 + f.id);
  const w = 4.6, d = 3.8;
  const y = site.span(f.x, f.z, 2.5)[0];
  const c = Math.cos(f.yaw), s = Math.sin(f.yaw);
  const W = (lx: number, lz: number): [number, number] => [f.x + lx * c - lz * s, f.z + lx * s + lz * c];
  b.with(rot(f.x, f.z, f.yaw, y), () => {
    const sides: [number, number, number, number][] = [[-w / 2, -d / 2, w / 2, -d / 2], [w / 2, -d / 2, w / 2, d / 2], [w / 2, d / 2, -w / 2, d / 2], [-w / 2, d / 2, -w / 2, -d / 2]];
    sides.forEach(([x0, z0, x1, z1], si) => {
      const segs = 4;
      for (let k = 0; k < segs; k++) {
        if (si === 2 && k === 1) continue; // the old doorway
        if (rng.chance(0.18)) continue;
        const t0 = k / segs, t1 = (k + 1) / segs;
        const ax = x0 + (x1 - x0) * t0, az = z0 + (z1 - z0) * t0, bx = x0 + (x1 - x0) * t1, bz = z0 + (z1 - z0) * t1;
        const h = si === 0 ? rng.range(1.2, 2.8) : rng.range(0.3, 1.6);
        b.begin(M.STONE, rng.range(0.25, 0.6));
        const thick = 0.45;
        const minx = Math.min(ax, bx) - (az === bz ? 0 : thick / 2), maxx = Math.max(ax, bx) + (az === bz ? 0 : thick / 2);
        const minz = Math.min(az, bz) - (ax === bx ? 0 : thick / 2), maxz = Math.max(az, bz) + (ax === bx ? 0 : thick / 2);
        box(b, minx, -0.6, minz, maxx, h, maxz);
        // ragged top: a couple of loose blocks
        if (h > 0.8) for (let j = 0; j < 2; j++) {
          const q = rng.range(0.15, 0.85), qx = minx + (maxx - minx) * q, qz = minz + (maxz - minz) * q;
          box(b, qx - 0.22, h, qz - 0.2, qx + 0.22, h + rng.range(0.15, 0.4), qz + 0.2);
        }
        for (let t = 0; t <= 1; t += 0.5) {
          const [ox, oz] = W(ax + (bx - ax) * t, az + (bz - az) * t);
          out.obstacles.push({ x: ox, z: oz, r: 0.5, kind: 'ruin' });
        }
      }
    });
    // fallen column + rubble
    b.begin(M.STONE, 0.5);
    beam(b, [-1.0, 0.2, 0.4], [0.9, 0.25, 1.2], 0.42);
    for (let i = 0; i < 7; i++) {
      b.begin(M.STONE, rng.range(0.2, 0.7));
      const px = rng.range(-w / 2 - 1, w / 2 + 1), pz = rng.range(-d / 2 - 1, d / 2 + 1), r = rng.range(0.18, 0.35);
      box(b, px - r, site.H(...W(px, pz)) - y - 0.15, pz - r * 0.8, px + r, site.H(...W(px, pz)) - y + r * 0.9, pz + r * 0.8);
    }
  });
}

/** Little roofed shrine on a post with flowers, and a bench to sit by it. */
export function shrine(b: Builder, site: Site, x: number, z: number, yaw: number, out: GroundOut, occ: Occ) {
  const y = site.H(x, z);
  const rng = new RNG(Math.floor(x * 100) ^ Math.floor(z * 77));
  b.with(rot(x, z, yaw, y), () => {
    b.begin(M.STONE, 0.5);
    box(b, -0.3, -0.3, -0.3, 0.3, 1.1, 0.3);
    box(b, -0.42, 1.1, -0.36, 0.42, 1.75, 0.36, { skip: 'F' });
    b.begin(M.ACCENT, 0.6);
    lathe(b, 0, 1.15, 0.05, [[0.12, 0], [0.1, 0.35], [0.0, 0.42]], 6);
    gableX(b, -0.5, 0.5, -0.45, 0.45, 1.75, 0.45, 0.12, M.STONE, M.TILE, 0.5, { barge: false });
    b.begin(M.PLASTER, 0.8); // posy of flowers at the foot
    for (let i = 0; i < 4; i++) lathe(b, rng.range(-0.3, 0.3), -0.05, 0.45 + rng.range(0, 0.15), [[0.08, 0], [0.1, 0.12], [0, 0.18]], 5);
  });
  out.obstacles.push({ x, z, r: 0.55, kind: 'shrine' });
  occ.add(x, z, 1.0);
  const c = Math.cos(yaw), s = Math.sin(yaw);
  // a bench beside it, facing the same way (out over the path)
  const bx = x + 1.6 * c - 0.2 * s, bz = z + 1.6 * s + 0.2 * c;
  if (!site.isWater(bx, bz) && !occ.hit(bx, bz, 0.5)) {
    bench(b, site, bx, bz, yaw, out, occ);
    out.spots.push({ kind: 'bench', p: [bx, site.H(bx, bz), bz], look: [bx - 3 * s, y + 0.5, bz + 3 * c] });
  }
}

/** A plank bench; `yaw` = the direction a sitter faces (local +z). */
export function bench(b: Builder, site: Site, x: number, z: number, yaw: number, out: GroundOut, occ: Occ) {
  const y = site.H(x, z);
  b.with(rot(x, z, yaw, y), () => {
    b.begin(M.PLANK, 0.55);
    box(b, -0.75, 0.42, -0.2, 0.75, 0.5, 0.2);
    box(b, -0.75, 0.5, -0.28, 0.75, 0.9, -0.2);
    b.begin(M.TIMBER, 0.4);
    for (const sx of [-0.6, 0.6]) beam(b, [sx, -0.2, 0], [sx, 0.43, 0], 0.1);
  });
  out.obstacles.push({ x, z, r: 0.6, kind: 'bench' });
  occ.add(x, z, 0.9);
}

// ---------------------------------------------------------------- bespoke buildings

const block = (y: number, h: number, w: number, d: number): BlockRec => ({ y0: y, h, w, d, xf: ([x, yy, z]) => [x, y + yy, z] });

/** The buildable well (lot-local coordinates; called inside b.with(L.xf)). */
export function wellBuilding(g: Gen, L: Lot): BlockRec[] {
  const b = g.b;
  b.with(([x, y, z]) => [x, L.top + y, z], () => wellGeo(b, g.rng));
  g.spots.push({ kind: 'well', p: b.xf([0, L.top, 1.15]), look: b.xf([0, L.top, 0]) });
  return [block(L.top, 2.4, 1.6, 1.6)];
}

/**
 * The buildable fishing pier: a net shed on the shore and a plank jetty running out to sea behind it
 * (local -z faces the water). Fishermen work at the jetty's end.
 */
export function pierBuilding(g: Gen, site: Site, L: Lot): BlockRec[] {
  const b = g.b, rng = g.rng, sea = site.sea ?? 0;
  const top = L.top, w = L.w, d = L.d;
  // net shed
  b.begin(M.PLANK, g.r());
  box(b, -w / 2, top, -d / 2, w / 2, top + 2.2, d / 2, { skip: 'B' });
  gableX(b, -w / 2, w / 2, -d / 2, d / 2, top + 2.2, 1.3, 0.35, M.PLANK, rng.chance(0.5) ? M.SLATE : M.TILE, g.r());
  b.with(([x, y, z]) => [x, top + y, z], () => b.with(faceXf('F', w, d), () => g.door(0, M.PLANK, false)));
  // jetty: find how far until the water is deep enough
  const deckY = sea + 0.7;
  let len = 4;
  for (; len < 14; len += 0.5) {
    const q = L.xf([0, 0, -d / 2 - len]);
    if (site.H(q[0], q[2]) < sea - 1.0 && len > 5) break;
  }
  b.begin(M.PLANK, g.r());
  const z0 = -d / 2 - 0.2, z1 = -d / 2 - len;
  const n = Math.ceil((z0 - z1) / 1.2);
  for (let i = 0; i < n; i++) {
    const za = z0 + ((z1 - z0) * i) / n, zb = z0 + ((z1 - z0) * (i + 1)) / n;
    const ya = Math.max(deckY, Math.min(top, groundY(site, L, 0, za) + 0.15)), yb = Math.max(deckY, Math.min(top, groundY(site, L, 0, zb) + 0.15));
    beam(b, [0, ya - 0.08, za], [0, yb - 0.08, zb], 1.5, 0.16);
  }
  b.begin(M.TIMBER, g.r());
  for (let z = z0 - 0.6; z > z1; z -= 1.8) for (const sx of [-0.78, 0.78]) {
    const gy = groundY(site, L, sx, z);
    beam(b, [sx, Math.min(gy, sea - 1.2), z], [sx, deckY + 0.2, z], 0.16);
  }
  // drying rack with nets and a moored boat-hook post
  beam(b, [-1.3, top - 0.2, d / 2 - 0.6], [-1.3, top + 1.6, d / 2 - 0.6], 0.1);
  beam(b, [-1.3, top + 1.5, d / 2 - 0.6], [-1.3 - 0.01, top + 1.5, -d / 2 + 0.6], 0.07);
  beam(b, [-1.3, top - 0.2, -d / 2 + 0.6], [-1.3, top + 1.6, -d / 2 + 0.6], 0.1);
  b.begin(M.SMOKE, 0.3);
  b.quad([-1.33, top + 1.45, d / 2 - 0.7], [-1.33, top + 1.45, -d / 2 + 0.7], [-1.33, top + 0.5, -d / 2 + 0.9], [-1.33, top + 0.5, d / 2 - 0.9], [[0, 0], [1, 0], [1, 1], [0, 1]]);
  // fishermen at the end of the jetty, looking out to sea
  for (const sx of [-0.4, 0.4]) {
    g.spots.push({ kind: 'work', p: b.xf([sx, deckY, z1 + 0.8]), look: b.xf([sx * 3, deckY, z1 - 4]) });
    g.spots.push({ kind: 'pier', p: b.xf([sx, deckY, z1 + 0.8]), look: b.xf([sx * 3, deckY, z1 - 4]) });
  }
  return [block(top, 2.2, w, d)];
}
const groundY = (site: Site, L: Lot, x: number, z: number) => { const q = L.xf([x, 0, z]); return site.H(q[0], q[2]); };
