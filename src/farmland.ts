/**
 * Farmland around farms: crop fields in rows whose growth follows the in-game day, orchards, haystacks,
 * carts — and the boundaries that go with each site (dry-stone walls on the crag, hedges on the hilltop,
 * post-and-rail fences on the island).
 */
import { Builder, M, V3, beam, box, lathe } from './builder';
import { RNG, noise3 } from './rng';
import type { GroundOut, Lot, Site } from './tower';
import type { Occ } from './flora';
import { tree } from './flora';

/** crops cycle: 0 ploughed, 1-2 seedlings, 3-4 growing, 5-6 ripe, 7 harvested (stubble + stooks) */
export const CROP_DAYS = 8;
export const cropStage = (day: number, k: number) => (((day + k * 3) % CROP_DAYS) + CROP_DAYS) % CROP_DAYS;
export const STAGE_NAME = ['ploughed', 'sown', 'sprouting', 'growing', 'tall', 'ripe', 'harvest time', 'harvested'];

type Boundary = 'wall' | 'hedge' | 'fence';

export function farmland(b: Builder, site: Site, lots: Lot[], pathPts: V3[], occ: Occ, out: GroundOut) {
  const kind: Boundary = site.p.terrain === 'crag' ? 'wall' : site.p.terrain === 'hilltop' ? 'hedge' : 'fence';
  const farms = lots.filter((L) => L.role === 'farm');
  farms.forEach((L, fi) => {
    const rng = new RNG(Math.floor(L.x * 131 + L.z * 71) ^ site.p.seed);
    const c = Math.cos(L.rot), s = Math.sin(L.rot);
    const W = (lx: number, lz: number): [number, number] => [L.x + lx * c - lz * s, L.z + lx * s + lz * c];
    const fw = 6.4, fd = 4.6;
    const cands: [number, number][] = [];
    for (const extra of [0, 2.5, 5]) for (let k = 0; k < 12; k++) {
      const a = -Math.PI / 2 + (k % 2 ? 1 : -1) * Math.ceil(k / 2) * (Math.PI / 6); // back first, then round the sides
      const D = L.rad + 0.9 + extra + 0.5 * (Math.abs(Math.cos(a)) * (fw + 1) + Math.abs(Math.sin(a)) * (fd + 1));
      cands.push([Math.cos(a) * D, Math.sin(a) * D]);
    }
    cands.sort((u, v) => Math.hypot(...W(u[0], u[1])) - Math.hypot(...W(v[0], v[1])));
    let made = 0;
    for (const [ox, oz] of cands) {
      if (made >= 2) break;
      if (!fieldOk(site, lots, pathPts, occ, W, ox, oz, fw, fd)) continue;
      field(b, site, W, ox, oz, fw, fd, kind, cropStage(site.land.day, fi + made), site.land.soil(...W(ox, oz)), rng, out, occ);
      made++;
    }
    // haystack and cart in the yard (other side from the field)
    const yard: [number, number][] = [[-(L.w / 2 + 1.4), L.d / 2 + 1.2], [L.w / 2 + 1.4, L.d / 2 + 1.2], [-(L.w / 2 + 2.2), -L.d / 2], [L.w / 2 + 2.2, -L.d / 2]];
    let props = 0;
    for (const [yx, yz] of yard) {
      if (props >= 2) break;
      const [x, z] = W(yx, yz);
      if (site.isWater(x, z) || occ.hit(x, z, 1.1) || nearPath(pathPts, x, z, 1.6)) continue;
      const [lo, hi] = site.span(x, z, 1);
      if (hi - lo > 0.8) continue;
      if (props === 0 || rng.chance(0.5)) haystack(b, x, lo, z, rng); else cart(b, x, lo, z, L.rot + rng.range(-0.6, 0.6), rng);
      out.obstacles.push({ x, z, r: 1.0, kind: props === 0 ? 'haystack' : 'cart' });
      occ.add(x, z, 1.2);
      props++;
    }
    // orchard (not on the crag)
    if (site.p.terrain !== 'crag' && fi % 2 === 0) {
      const oc: [number, number][] = [[-(L.w / 2 + 6), L.d / 2 + 2], [L.w / 2 + 6, L.d / 2 + 2], [0, L.d / 2 + 6.5]];
      for (const [ox, oz] of oc) {
        const pts: [number, number][] = [];
        for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) pts.push(W(ox + i * 2.3 + (j % 2) * 0.4, oz + j * 2.3));
        const good = pts.filter(([x, z]) => !site.isWater(x, z) && !occ.hit(x, z, 0.9) && !nearPath(pathPts, x, z, 1.5) && site.span(x, z, 0.8)[1] - site.span(x, z, 0.8)[0] < 0.7);
        if (good.length < 6) continue;
        for (const [x, z] of good) {
          tree(b, site, x, site.span(x, z, 0.5)[0], z, 4, rng.range(0.9, 1.15), rng.next(), [1, 0]);
          occ.add(x, z, 0.9);
          out.obstacles.push({ x, z, r: 0.35, kind: 'tree' });
        }
        break;
      }
    }
  });
}

const nearPath = (pts: V3[], x: number, z: number, d: number) => pts.some((q) => Math.abs(q[0] - x) < d && Math.abs(q[2] - z) < d);

function fieldOk(site: Site, lots: Lot[], pathPts: V3[], occ: Occ, W: (x: number, z: number) => [number, number], ox: number, oz: number, fw: number, fd: number) {
  let lo = Infinity, hi = -Infinity;
  for (let i = 0; i <= 4; i++) for (let j = 0; j <= 3; j++) {
    const [x, z] = W(ox + (i / 4 - 0.5) * (fw + 1), oz + (j / 3 - 0.5) * (fd + 1));
    if (site.land.water(x, z)) return false;
    if (Math.hypot(x, z) > site.land.E * 0.92) return false;
    const h = site.H(x, z);
    lo = Math.min(lo, h); hi = Math.max(hi, h);
    if (site.sea !== null && h < site.sea + 0.9) return false;
    if (lots.some((L) => Math.hypot(L.x - x, L.z - z) < L.rad + 0.6)) return false;
    if (nearPath(pathPts, x, z, 1.1)) return false;
    if (occ.hit(x, z, 0.5)) return false;
  }
  return hi - lo < 1.7;
}

/** Extrude a cross-section (x across, y up) along a ground polyline: rows, walls, hedges without seams. */
export function sweep(b: Builder, pts: V3[], sec: [number, number][], jitter?: (i: number, k: number) => number) {
  const n = pts.length;
  const ring = (i: number) => {
    const a = pts[Math.max(0, i - 1)], c = pts[Math.min(n - 1, i + 1)];
    let tx = c[0] - a[0], tz = c[2] - a[2];
    const tl = Math.hypot(tx, tz) || 1; tx /= tl; tz /= tl;
    return sec.map(([sx, sy], k): V3 => [pts[i][0] - tz * sx, pts[i][1] + sy + (jitter ? jitter(i, k) : 0), pts[i][2] + tx * sx]);
  };
  let prev = ring(0);
  for (let i = 1; i < n; i++) {
    const cur = ring(i);
    for (let k = 0; k + 1 < sec.length; k++) b.quad(prev[k], cur[k], cur[k + 1], prev[k + 1], [[0, 0], [1, 0], [1, 1], [0, 1]]);
    prev = cur;
  }
  // end caps
  for (const r of [ring(0), ring(n - 1)]) for (let k = 1; k + 1 < r.length; k++) b.tri(r[0], r[k], r[k + 1], [0, 0], [1, 0], [1, 1]);
}

function field(b: Builder, site: Site, W: (x: number, z: number) => [number, number], ox: number, oz: number, fw: number, fd: number,
  kind: Boundary, stage: number, soil: number, rng: RNG, out: GroundOut, occ: Occ) {
  const at = (lx: number, lz: number, dy = 0): V3 => { const [x, z] = W(ox + lx, oz + lz); return [x, site.H(x, z) + dy, z]; };
  const rows = Math.floor(fd / 0.9);
  const vigor = 0.55 + 0.6 * soil;
  const crop = rng.chance(0.65) ? 'grain' : 'veg';
  const segs = 8;
  const grow = stage === 0 ? 0 : stage <= 2 ? 0.1 * stage : stage <= 4 ? 0.25 + 0.15 * (stage - 2) : stage <= 6 ? 0.6 : 0.1;
  const h = grow * vigor * (crop === 'grain' ? 1.15 : 0.8);
  // soil ridges + crops: one piece, so only the field's silhouette and the row edges are inked
  b.begin(M.TIMBER, 0.3 + rng.range(0, 0.15));
  for (let r = 0; r < rows; r++) {
    const lz = -fd / 2 + 0.45 + r * 0.9;
    const line = Array.from({ length: segs + 1 }, (_, k) => at(-fw / 2 + (fw * k) / segs, lz));
    b.mat = M.TIMBER;
    sweep(b, line, [[-0.42, -0.15], [-0.3, 0.08], [0.3, 0.08], [0.42, -0.15]]);
    if (stage === 0) continue;
    if (stage <= 2 || (crop === 'veg' && stage < 7)) { // seedlings / cabbage heads in a row
      b.mat = M.GRASS;
      const n = segs * 2;
      for (let q = 0; q < n; q++) {
        const p = at(-fw / 2 + (fw * (q + 0.5)) / n, lz, 0.06), rr = stage <= 2 ? 0.1 + 0.05 * stage : 0.12 + h * 0.45;
        lathe(b, p[0], p[1], p[2], [[0.02, 0], [rr, rr * 0.45], [rr * 0.75, rr * 0.95], [0.02, rr * 1.15]], 5, q);
      }
    } else { // grain: a continuous band of stalks, green then gold, stubble after harvest
      b.mat = stage >= 5 ? M.PLASTER : M.GRASS;
      const top = (i: number, k: number) => (k === 1 || k === 2 ? (noise3(i * 0.9, r * 1.7, 4) - 0.5) * h * 0.35 : 0);
      sweep(b, line.map((p) => [p[0], p[1] + 0.06, p[2]] as V3), [[-0.24, 0], [-0.2, h], [0.2, h], [0.24, 0]], top);
    }
  }
  if (stage === 6 || stage === 7) { // stooks at harvest
    for (let i = 0; i < 3; i++) {
      const p = at(-fw / 2 + 1.2 + i * 2.0, rng.range(-1, 1) * fd * 0.25);
      b.begin(M.PLASTER, 0.55);
      lathe(b, p[0], p[1] - 0.1, p[2], [[0.42, 0], [0.36, 0.5], [0.01, 0.9]], 6, rng.range(0, 6));
    }
  }
  for (let i = 0; i <= 6; i++) for (let j = 0; j <= 4; j++) {
    const [x, z] = W(ox + (i / 6 - 0.5) * fw, oz + (j / 4 - 0.5) * fd);
    occ.add(x, z, 0.75);
  }
  // spots: farmers stand at the row ends and work along them
  for (let r = 0; r < rows; r += 2) {
    const lz = -fd / 2 + 0.45 + r * 0.9;
    out.spots.push({ kind: 'field', p: at(fw / 2 - 0.4, lz + 0.45), look: at(-fw / 2, lz + 0.45) });
  }
  boundary(b, site, fw + 1.0, fd + 1.0, kind, rng, out, at);
}

/** Wall / hedge / fence round a rectangle with a gate gap on the +x side. */
function boundary(b: Builder, site: Site, w: number, d: number, kind: Boundary, rng: RNG, out: GroundOut, at: (lx: number, lz: number, dy?: number) => V3) {
  const corners: [number, number][] = [[-w / 2, -d / 2], [w / 2, -d / 2], [w / 2, d / 2], [-w / 2, d / 2]];
  const sec: Record<Boundary, [number, number][]> = {
    wall: [[-0.3, -0.3], [-0.26, 0.45], [-0.12, 0.7], [0.12, 0.7], [0.26, 0.45], [0.3, -0.3]],
    hedge: [[-0.38, -0.3], [-0.42, 0.45], [-0.25, 0.95], [0.25, 0.95], [0.42, 0.45], [0.38, -0.3]],
    fence: [],
  };
  const mat = kind === 'wall' ? M.STONE : kind === 'hedge' ? M.GRASS : M.TIMBER;
  // the whole boundary is one piece; gaps (gate, water) split it into runs
  b.begin(mat, kind === 'hedge' ? rng.range(0.0, 0.15) : rng.range(0.3, 0.55));
  for (let e = 0; e < 4; e++) {
    const [ax, az] = corners[e], [bx, bz] = corners[(e + 1) % 4];
    const L = Math.hypot(bx - ax, bz - az), n = Math.max(2, Math.ceil(L / 0.9));
    const runs: V3[][] = [[]];
    for (let k = 0; k <= n; k++) {
      const t = k / n;
      const gate = e === 1 && Math.abs(t - 0.5) < 0.16;
      const p = at(ax + (bx - ax) * t, az + (bz - az) * t);
      if (gate || site.isWater(p[0], p[2])) { if (runs[runs.length - 1].length) runs.push([]); continue; }
      runs[runs.length - 1].push(p);
      if (k % 2 === 0) out.obstacles.push({ x: p[0], z: p[2], r: kind === 'hedge' ? 0.45 : 0.32, kind });
    }
    for (const run of runs) {
      if (run.length < 2) continue;
      if (kind === 'fence') {
        for (const p of run) beam(b, [p[0], p[1] - 0.3, p[2]], [p[0], p[1] + 1.0, p[2]], 0.12);
        for (let k = 0; k + 1 < run.length; k++) for (const y of [0.45, 0.85]) beam(b, [run[k][0], run[k][1] + y, run[k][2]], [run[k + 1][0], run[k + 1][1] + y, run[k + 1][2]], 0.08);
      } else {
        const seed = rng.range(0, 99);
        sweep(b, run, sec[kind], (i, k) => (k > 0 && k < sec[kind].length - 1 ? (noise3(i * 1.3, seed, k) - 0.5) * (kind === 'hedge' ? 0.3 : 0.12) : 0));
      }
    }
    // somebody can lean on it from outside, looking in
    if (e === 0 || e === 2) {
      const mx = (ax + bx) / 2, mz = (az + bz) / 2, sg = Math.sign(mz);
      const p = at(mx + 0.8, mz + sg * 0.75), look = at(mx + 0.8, mz - sg * 2);
      if (!site.isWater(p[0], p[2])) out.spots.push({ kind: 'fence', p, look });
    }
  }
}

export function haystack(b: Builder, x: number, y: number, z: number, rng: RNG) {
  b.begin(M.PLASTER, rng.range(0.45, 0.7));
  lathe(b, x, y - 0.2, z, [[0.95, 0], [0.98, 0.7], [0.7, 1.4], [0.25, 1.8], [0.01, 1.9]], 8, rng.range(0, 6));
  b.begin(M.TIMBER, 0.5);
  beam(b, [x, y + 1.7, z], [x, y + 2.2, z], 0.08);
}

export function cart(b: Builder, x: number, y: number, z: number, a: number, rng: RNG) {
  const c = Math.cos(a), s = Math.sin(a);
  b.with(([lx, ly, lz]) => [x + lx * c - lz * s, y + ly, z + lx * s + lz * c], () => {
    b.begin(M.PLANK, rng.range(0.4, 0.7));
    box(b, -0.65, 0.55, -0.95, 0.65, 1.05, 0.95);
    b.begin(M.TIMBER, 0.4);
    for (const sd of [-1, 1]) {
      // wheel: a flat disc standing on its edge
      b.with(([wx, wy, wz]) => [sd * 0.75 + wy, 0.5 + wx, wz], () => {
        lathe(b, 0, -0.05, 0, [[0.5, 0], [0.5, 0.1], [0.01, 0.1]], 8);
      });
    }
    beam(b, [-0.3, 0.6, 0.95], [-0.3, 0.45, 2.1], 0.07);
    beam(b, [0.3, 0.6, 0.95], [0.3, 0.45, 2.1], 0.07);
    b.begin(M.PLASTER, 0.6); // a load of hay
    lathe(b, 0, 1.0, 0, [[0.6, 0], [0.5, 0.35], [0.01, 0.5]], 6);
  });
}
