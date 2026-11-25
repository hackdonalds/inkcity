/** Water geometry: streams, ponds, cascades, waterfalls off the crag, footbridges, the old pier + boathouse. */
import { Builder, M, V3, beam, box, gableX, lathe } from './builder';
import { RNG } from './rng';
import type { Site } from './tower';

const foam = (b: Builder, x: number, y: number, z: number, r: number, a: number) =>
  lathe(b, x, y - r * 0.3, z, [[0.01, 0], [r * 0.8, r * 0.3], [r, r * 0.7], [r * 0.6, r * 1.05], [0.01, r * 1.2]], 7, a);

/** Static water of a site (built once with the terrain). */
export function buildWater(b: Builder, site: Site) {
  const L = site.land;
  const rng = new RNG(site.p.seed ^ 0x51ea);
  for (const s of L.streams) {
    const P = s.pts, n = P.length;
    // ribbon a little wider than the bed: the banks clip it into a natural shoreline
    b.begin(M.WATER, 0.5);
    const waterId = b.id;
    const side = (i: number): [V3, V3] => {
      const a = P[Math.max(0, i - 1)], c = P[Math.min(n - 1, i + 1)];
      let tx = c[0] - a[0], tz = c[2] - a[2];
      const tl = Math.hypot(tx, tz) || 1; tx /= tl; tz /= tl;
      const w = s.w[i] + 0.7, y = Math.max(P[i][1] + 0.3, site.sea !== null ? site.sea - 0.2 : -1e9);
      return [[P[i][0] - tz * w, y, P[i][2] + tx * w], [P[i][0] + tz * w, y, P[i][2] - tx * w]];
    };
    let prev = side(0);
    for (let i = 1; i < n; i++) {
      const cur = side(i);
      b.quad(prev[0], cur[0], cur[1], prev[1], [[0, 0], [1, 0], [1, 1], [0, 1]]);
      prev = cur;
    }
    // white water where it tumbles down a terrace step (same piece as the water: dabs of white, no outlines)
    b.begin(M.SMOKE, 0.9);
    b.id = waterId;
    for (let i = 0; i + 1 < n; i++) {
      const drop = P[i][1] - P[i + 1][1];
      if (drop < 0.22) continue;
      const k = Math.min(2, Math.ceil(drop / 0.35));
      for (let j = 0; j < k; j++) {
        const t = rng.range(0, 1);
        const x = P[i][0] + (P[i + 1][0] - P[i][0]) * t + rng.range(-0.4, 0.4), z = P[i][2] + (P[i + 1][2] - P[i][2]) * t + rng.range(-0.4, 0.4);
        foam(b, x, P[i + 1][1] + 0.3, z, rng.range(0.16, 0.28), rng.range(0, 6));
      }
    }
    if (s.fall) waterfall(b, site, s.fall, s.w[n - 1], rng);
  }
  for (const pd of L.ponds) {
    b.begin(M.WATER, 0.45);
    lathe(b, pd.x, pd.level - 0.04, pd.z, [[pd.r * 1.07, 0], [0.01, 0]], 22);
    // lily pads
    b.begin(M.GRASS, 0.3);
    const k = rng.int(3, 6), a0 = rng.range(0, 6);
    for (let i = 0; i < k; i++) {
      const a = a0 + rng.range(-0.9, 0.9), r = pd.r * rng.range(0.45, 0.85), pr = rng.range(0.22, 0.38);
      lathe(b, pd.x + Math.cos(a) * r, pd.level - 0.02, pd.z + Math.sin(a) * r, [[pr, 0], [pr, 0.03], [0.01, 0.03]], 7, rng.range(0, 6));
    }
  }
}

/** A water sheet pouring off the crag edge into the clouds, with foam at the lip. */
function waterfall(b: Builder, site: Site, f: { p: V3; dx: number; dz: number }, w: number, rng: RNG) {
  const { p, dx, dz } = f;
  const nx = -dz, nz = dx;
  const rows: { c: V3; hw: number }[] = [];
  let out = 0.2;
  for (let k = 0; k <= 16; k++) {
    const t = k / 16;
    const y = p[1] - 0.05 - t * t * 26 - t * 3;
    out = Math.max(out, 0.2 + 3.2 * Math.sqrt(t)); // thrown clear of the lip
    // stay in front of the cliff face
    for (let g = 0; g < 30 && site.H(p[0] + dx * out, p[2] + dz * out) > y - 0.3; g++) out += 0.25;
    rows.push({ c: [p[0] + dx * out, y, p[2] + dz * out], hw: w * (1.1 + 0.9 * t) });
  }
  b.begin(M.WATER, 0.7);
  for (let k = 0; k + 1 < rows.length; k++) {
    const A = rows[k], B = rows[k + 1];
    const a0: V3 = [A.c[0] - nx * A.hw, A.c[1], A.c[2] - nz * A.hw], a1: V3 = [A.c[0] + nx * A.hw, A.c[1], A.c[2] + nz * A.hw];
    const b0: V3 = [B.c[0] - nx * B.hw, B.c[1], B.c[2] - nz * B.hw], b1: V3 = [B.c[0] + nx * B.hw, B.c[1], B.c[2] + nz * B.hw];
    b.quad(a0, a1, b1, b0, [[0, 0], [1, 0], [1, 1], [0, 1]]);
  }
  // stream bed spill from the last carved point to the lip
  b.begin(M.SMOKE, 0.95);
  for (let i = 0; i < 4; i++) foam(b, p[0] + dx * 0.4 + nx * rng.range(-w, w), p[1] + 0.05, p[2] + dz * 0.4 + nz * rng.range(-w, w), rng.range(0.25, 0.4), rng.range(0, 6));
  b.begin(M.SMOKE, 0.95);
  const last = rows[rows.length - 4];
  for (let i = 0; i < 5; i++) foam(b, last.c[0] + nx * rng.range(-1.3, 1.3) * last.hw, last.c[1] + rng.range(-1, 1.5), last.c[2] + nz * rng.range(-1.3, 1.3) * last.hw, rng.range(0.5, 0.9), rng.range(0, 6));
}

/**
 * Plank footbridge over a stream: deck from bank to bank with a slight hump, posts and hand rails.
 * `pts` are path points (already lifted to the deck); the deck is drawn between a and c.
 */
export function footbridge(b: Builder, a: V3, c: V3, waterY: number) {
  const dx = c[0] - a[0], dz = c[2] - a[2], L = Math.hypot(dx, dz) || 1;
  const ux = dx / L, uz = dz / L, nx = -uz, nz = ux;
  const n = Math.max(2, Math.ceil(L / 0.7));
  const P = (t: number, off: number, dy = 0): V3 => {
    const y = a[1] + (c[1] - a[1]) * t + Math.sin(t * Math.PI) * 0.35 + dy;
    return [a[0] + dx * t + nx * off, y, a[2] + dz * t + nz * off];
  };
  b.begin(M.PLANK, 0.55);
  for (let i = 0; i < n; i++) {
    const t0 = i / n, t1 = (i + 1) / n;
    beam(b, P(t0, 0, -0.08), P(t1, 0, -0.08), 1.25, 0.16);
  }
  b.begin(M.TIMBER, 0.45);
  for (const s of [-0.62, 0.62]) {
    for (const t of [0, 0.5, 1]) {
      const top = P(t, s, 0.85), foot = P(t, s, -0.1);
      foot[1] = t === 0.5 ? Math.min(foot[1], waterY - 0.3) : foot[1] - 0.3;
      beam(b, foot, top, 0.1);
    }
    for (let i = 0; i < 4; i++) beam(b, P(i / 4, s, 0.82), P((i + 1) / 4, s, 0.82), 0.08);
  }
}

/** The old pier and boathouse on an island shore (static scenery). */
export function buildPier(b: Builder, site: Site, x: number, z: number, a: number) {
  const sea = site.sea ?? 0;
  const ux = Math.cos(a), uz = Math.sin(a), nx = -uz, nz = ux;
  const deckY = sea + 0.65, len = 9;
  b.begin(M.PLANK, 0.5);
  const s0 = -2.2; // start a little inland so it meets the beach
  for (let k = 0; k < 6; k++) {
    const t0 = s0 + ((len - s0) * k) / 6, t1 = s0 + ((len - s0) * (k + 1)) / 6;
    const y0 = Math.max(deckY, site.H(x + ux * t0, z + uz * t0) + 0.12), y1 = Math.max(deckY, site.H(x + ux * t1, z + uz * t1) + 0.12);
    beam(b, [x + ux * t0, y0 - 0.08, z + uz * t0], [x + ux * t1, y1 - 0.08, z + uz * t1], 1.5, 0.16);
  }
  b.begin(M.TIMBER, 0.4);
  for (let t = 0; t <= len; t += 1.8) for (const sd of [-0.75, 0.75]) {
    const px = x + ux * t + nx * sd, pz = z + uz * t + nz * sd;
    beam(b, [px, Math.min(site.H(px, pz), sea - 1.2), pz], [px, deckY + (t > len - 2 ? 0.7 : 0.15), pz], 0.16);
  }
  // mooring bollard + coiled rope at the end
  lathe(b, x + ux * (len - 0.4) + nx * 0.45, deckY, z + uz * (len - 0.4) + nz * 0.45, [[0.16, 0], [0.16, 0.45], [0.2, 0.5], [0, 0.55]], 6);
  // boathouse on stilts beside the pier, open to the sea
  const bx = x + nx * 3.6 + ux * 1.2, bz = z + nz * 3.6 + uz * 1.2;
  const fy = Math.max(deckY, site.H(bx - ux * 1.6, bz - uz * 1.6) + 0.05);
  b.with(([lx, ly, lz]) => [bx + lz * ux + lx * nx, ly, bz + lz * uz + lx * nz], () => {
    b.begin(M.TIMBER, 0.45);
    for (const sx of [-1.4, 1.4]) for (const sz of [-1.6, 1.6]) {
      const wx = bx + sz * ux + sx * nx, wz = bz + sz * uz + sx * nz;
      beam(b, [sx, Math.min(site.H(wx, wz), sea - 1), sz], [sx, fy, sz], 0.18);
    }
    b.begin(M.PLANK, 0.35);
    box(b, -1.5, fy - 0.15, -1.7, 1.5, fy, 1.7);
    b.begin(M.PLANK, 0.62);
    box(b, -1.5, fy, -1.7, 1.5, fy + 2.1, 1.5, { skip: 'TF' });
    gableX(b, -1.5, 1.5, -1.7, 1.5, fy + 2.1, 1.3, 0.35, M.PLANK, M.SLATE, 0.5);
    b.begin(M.DOOR, 0.4);
    b.quad([-0.6, fy, -1.72], [0.6, fy, -1.72], [0.6, fy + 1.7, -1.72], [-0.6, fy + 1.7, -1.72], [[0, 0], [1, 0], [1, 1], [0, 1]]);
  });
}
