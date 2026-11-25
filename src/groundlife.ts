/**
 * Glue between the ground builder (tower.ts) and the landscape modules: static scenery that is built
 * once with the terrain, and the dynamic layers rebuilt with the ground (tracks, ruins, shrine,
 * farmland, flora, viewpoints).
 */
import { Builder, M, V3 } from './builder';
import { RNG, noise3 } from './rng';
import type { GroundOut, Lot, NavEdge, Site } from './tower';
import { buildPier, buildWater } from './water';
import { Occ, plantLife } from './flora';
import { farmland } from './farmland';
import { bench, caveMouth, ruin, shrine, standingStones, villageWell } from './features';

/** Streams, ponds, waterfalls, the old pier, standing stones, cave mouth and village well. */
export function groundStatics(tb: Builder, site: Site) {
  buildWater(tb, site);
  for (const f of site.land.features) {
    if (f.kind === 'pier') buildPier(tb, site, f.x, f.z, f.yaw);
    else if (f.kind === 'ring') standingStones(tb, site, f);
    else if (f.kind === 'cave') caveMouth(tb, site, f);
    else if (f.kind === 'well') villageWell(tb, site, f);
  }
}

/** Ring stone positions (shared by geometry and obstacles). */
export function ringStones(f: { x: number; z: number; yaw: number }) {
  return Array.from({ length: 9 }, (_, i) => { const a = f.yaw + (i / 9) * Math.PI * 2; return [f.x + Math.cos(a) * 3.1, f.z + Math.sin(a) * 3.1] as [number, number]; });
}

export function groundFeatures(tb: Builder, site: Site, lots: Lot[], nav: NavEdge[], pathPts: V3[], out: GroundOut): Occ {
  const occ = new Occ();
  for (const L of lots) occ.add(L.x, L.z, L.rad + 0.4);
  for (let i = 0; i < pathPts.length; i++) occ.add(pathPts[i][0], pathPts[i][2], 1.05);
  wornTracks(tb, site, lots, nav);
  const sea = site.sea ?? 0;
  for (const f of site.land.live()) {
    if (f.kind === 'ring') {
      occ.add(f.x, f.z, 4.0);
      for (const [x, z] of ringStones(f)) out.obstacles.push({ x, z, r: 0.55, kind: 'standing stone' });
      out.obstacles.push({ x: f.x, z: f.z, r: 0.9, kind: 'standing stone' });
      const a = Math.atan2(-f.z, -f.x); // from the town side
      const px = f.x + Math.cos(a) * 5.4, pz = f.z + Math.sin(a) * 5.4;
      if (!site.isWater(px, pz)) out.spots.push({ kind: 'view', p: [px, site.H(px, pz), pz], look: [f.x, site.H(f.x, f.z) + 1.2, f.z] });
    } else if (f.kind === 'ruin') {
      occ.add(f.x, f.z, 3.6);
      ruin(tb, site, f, out);
    } else if (f.kind === 'cave') {
      occ.add(f.x, f.z, 2.2);
      out.obstacles.push({ x: f.x, z: f.z, r: 1.3, kind: 'cave' });
    } else if (f.kind === 'well') {
      occ.add(f.x, f.z, 1.5);
      out.obstacles.push({ x: f.x, z: f.z, r: 0.95, kind: 'well' });
      const y = site.H(f.x, f.z);
      for (const a of [f.yaw + Math.PI / 2, f.yaw - Math.PI / 2]) {
        const px = f.x + Math.cos(a) * 1.25, pz = f.z + Math.sin(a) * 1.25;
        out.spots.push({ kind: 'well', p: [px, site.H(px, pz), pz], look: [f.x, y + 0.8, f.z] });
      }
    } else if (f.kind === 'pier') {
      const ux = Math.cos(f.yaw), uz = Math.sin(f.yaw), nx = -uz, nz = ux;
      occ.add(f.x, f.z, 2.5);
      const bx = f.x + nx * 3.6 + ux * 1.2, bz = f.z + nz * 3.6 + uz * 1.2;
      occ.add(bx, bz, 2.4);
      out.obstacles.push({ x: bx, z: bz, r: 2.1, kind: 'boathouse' });
      const ex = f.x + ux * 8.4, ez = f.z + uz * 8.4;
      out.spots.push({ kind: 'pier', p: [ex, sea + 0.65, ez], look: [ex + ux * 10, sea, ez + uz * 10] });
      out.spots.push({ kind: 'pier', p: [ex - ux * 2 + nx * 0.4, sea + 0.65, ez - uz * 2 + nz * 0.4], look: [ex + nx * 10, sea, ez + nz * 10] });
    } else if (f.kind === 'shrine') {
      // by the nearest path, facing it
      let best: V3 | null = null, bd = 14, dir: [number, number] = [1, 0];
      for (let i = 1; i + 1 < pathPts.length; i++) {
        const q = pathPts[i], d = Math.hypot(q[0] - f.x, q[2] - f.z);
        if (d < bd) { bd = d; best = q; dir = [pathPts[i + 1][0] - pathPts[i - 1][0], pathPts[i + 1][2] - pathPts[i - 1][2]]; }
      }
      let x = f.x, z = f.z, yaw = f.yaw;
      if (best) {
        const dl = Math.hypot(dir[0], dir[1]) || 1, nx = -dir[1] / dl, nz = dir[0] / dl;
        const sd = (f.x - best[0]) * nx + (f.z - best[2]) * nz >= 0 ? 1 : -1;
        x = best[0] + nx * sd * 1.9; z = best[2] + nz * sd * 1.9;
        // local +z of the shrine faces the path
        yaw = Math.atan2(nx * sd, -nz * sd);
      }
      if (!site.isWater(x, z) && !occ.hit(x, z, 0.4)) shrine(tb, site, x, z, yaw, out, occ);
    }
  }
  farmland(tb, site, lots, pathPts, occ, out);
  return occ;
}

/** Trampled earth either side of the busiest paths (traffic = routes between buildings that use the edge). */
function wornTracks(tb: Builder, site: Site, lots: Lot[], nav: NavEdge[]) {
  const n = lots.length;
  if (n < 4) return;
  const size = new Array(n).fill(1);
  const depth = lots.map((L) => { let d = 0, p = L.parent; while (p >= 0 && d < n) { d++; p = lots[p].parent; } return d; });
  const order = lots.map((_, i) => i).sort((a, b) => depth[b] - depth[a]);
  for (const i of order) if (lots[i].parent >= 0) size[lots[i].parent] += size[i];
  const traffic = nav.map((e) => size[e.a] * (n - size[e.a]));
  const max = Math.max(1, ...traffic);
  nav.forEach((e, k) => {
    const t = traffic[k] / max;
    if (t < 0.34) return;
    const pts = e.pts;
    tb.begin(M.ROCK, 0.75);
    const side = (i: number, sgn: number): V3 => {
      const a = pts[Math.max(0, i - 1)], c = pts[Math.min(pts.length - 1, i + 1)];
      let dx = c[0] - a[0], dz = c[2] - a[2];
      const dl = Math.hypot(dx, dz) || 1; dx /= dl; dz /= dl;
      const w = 0.85 + 0.55 * t + (noise3(pts[i][0] * 0.6, sgn * 3, pts[i][2] * 0.6) - 0.5) * 0.6;
      const x = pts[i][0] - dz * w * sgn, z = pts[i][2] + dx * w * sgn;
      return [x, Math.min(pts[i][1] - 0.04, site.H(x, z) + 0.05), z];
    };
    for (let i = 0; i + 1 < pts.length; i++) {
      const w0 = site.land.water(pts[i][0], pts[i][2]), w1 = site.land.water(pts[i + 1][0], pts[i + 1][2]);
      if (w0 || w1) continue;
      const l0 = side(i, 1), r0 = side(i, -1), l1 = side(i + 1, 1), r1 = side(i + 1, -1);
      const c0: V3 = [pts[i][0], pts[i][1] - 0.1, pts[i][2]], c1: V3 = [pts[i + 1][0], pts[i + 1][1] - 0.1, pts[i + 1][2]];
      const uv = (q: V3): [number, number] => [q[0], q[2]];
      tb.quad(l0, l1, c1, c0, [uv(l0), uv(l1), uv(c1), uv(c0)]);
      tb.quad(c0, c1, r1, r0, [uv(c0), uv(c1), uv(r1), uv(r0)]);
    }
  });
}

export function groundLife(tb: Builder, site: Site, lots: Lot[], occ: Occ, out: GroundOut) {
  plantLife(tb, site, occ, out);
  const { RI, TR, sea } = site;
  const rng = new RNG(site.p.seed * 3 + 77);
  // viewpoints with benches at the edge of town
  const keep = lots.find((L) => L.main);
  const topOf = (L: Lot) => L.blocks.reduce((a, k) => Math.max(a, k.y0 + k.h), L.top);
  const tallest = lots.reduce<Lot | null>((m, L) => (!m || topOf(L) > topOf(m) ? L : m), null);
  const views: [number, number][] = [];
  const cands: { x: number; z: number; s: number }[] = [];
  for (let i = 0; i < 70; i++) {
    const a = rng.range(0, Math.PI * 2), r = rng.range(TR * 0.85, RI * (site.p.terrain === 'hilltop' ? 1.0 : 0.82));
    const x = Math.cos(a) * r, z = Math.sin(a) * r;
    const [lo, hi] = site.span(x, z, 1.0);
    if (hi - lo > 0.5 || site.isWater(x, z) || occ.hit(x, z, 0.9)) continue;
    if (sea !== null && lo < sea + 0.8) continue;
    // a drop in front (outward) makes a good view
    const ox = Math.cos(a), oz = Math.sin(a);
    const drop = lo - site.H(x + ox * 6, z + oz * 6);
    cands.push({ x, z, s: drop + site.H(x, z) * 0.15 + rng.range(0, 1) });
  }
  cands.sort((u, v) => v.s - u.s);
  for (const c of cands) {
    if (views.length >= 4) break;
    if (views.some(([vx, vz]) => Math.hypot(vx - c.x, vz - c.z) < 10)) continue;
    if (occ.hit(c.x, c.z, 0.9)) continue;
    views.push([c.x, c.z]);
    const r = Math.hypot(c.x, c.z) || 1, ox = c.x / r, oz = c.z / r;
    const y = site.H(c.x, c.z);
    // islands and crags look out over the sea / the drop; on the hilltop people turn to the town's tallest tower
    let look: V3 = [c.x + ox * 25, (sea ?? y - 4), c.z + oz * 25];
    if (site.p.terrain === 'hilltop' && (tallest ?? keep)) { const T = (tallest ?? keep)!; look = [T.x, topOf(T) - 2, T.z]; }
    // bench: local +z faces the view
    bench(tb, site, c.x, c.z, Math.atan2(-(look[0] - c.x), look[2] - c.z), out, occ);
    out.spots.push({ kind: 'bench', p: [c.x, y, c.z], look });
    const vx = c.x + ox * 1.6, vz = c.z + oz * 1.6;
    if (!site.isWater(vx, vz)) out.spots.push({ kind: 'view', p: [vx, site.H(vx, vz), vz], look });
  }
  // shore spots: on the beach, looking out to sea
  if (sea !== null) {
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2 + rng.range(-0.2, 0.2);
      const ox = Math.cos(a), oz = Math.sin(a);
      let r = RI * 0.6;
      while (r < RI * 1.6 && site.H(ox * r, oz * r) > sea + 0.45) r += 0.3;
      const x = ox * (r - 0.6), z = oz * (r - 0.6);
      const h = site.H(x, z);
      if (h - sea > 1.4 || site.land.water(x, z) || occ.hit(x, z, 0.5)) continue;
      out.spots.push({ kind: 'shore', p: [x, h, z], look: [x + ox * 15, sea, z + oz * 15] });
    }
  }
}
