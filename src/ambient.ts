import * as THREE from 'three';
import { Builder, M, V3, beam, lathe } from './builder';
import type { World } from './world';

/**
 * Small moving things rebuilt every frame from time alone (so ids — and ink lines — stay stable):
 * waving pennants, washing lines, circling birds, bobbing boats.
 */
export interface Laundry { p0: V3; p1: V3; n: number; seed: number }

const h = (i: number) => { const x = Math.sin(i * 91.7) * 43758.5453; return x - Math.floor(x); };

export function buildAmbient(world: World, laundry: Laundry[], boats: { x: number; z: number; yaw: number }[], time: number, wind: [number, number], night: number, rain: number): THREE.BufferGeometry {
  const b = new Builder(650_000_000);
  const gust = 1 + rain * 0.8;

  // pennants
  let k = 0;
  for (const bt of world.built.values()) for (const f of bt.flags) {
    b.begin(M.ACCENT, 0.4 + 0.5 * h(k));
    const L = 1.6, seg = 7, dir = Math.atan2(wind[1], wind[0]) + Math.sin(time * 0.3 + k) * 0.3;
    const dx = Math.cos(dir), dz = Math.sin(dir);
    for (let i = 0; i < seg; i++) {
      const P = (t: number, s: number): V3 => {
        const wave = Math.sin(time * 5 * gust - t * 7 + k) * 0.28 * t;
        return [f[0] + dx * t * L - dz * wave, f[1] - s * 0.33 * (1 - t) - t * 0.2, f[2] + dz * t * L + dx * wave];
      };
      const t0 = i / seg, t1 = (i + 1) / seg;
      b.quad(P(t0, -0.5), P(t1, -0.5), P(t1, 0.5), P(t0, 0.5), [[t0, 0], [t1, 0], [t1, 1], [t0, 1]]);
    }
    k++;
  }

  // washing lines
  const cloth = [M.ACCENT, M.PLASTER, M.GLASS, M.TILE, M.COBBLE, M.SMOKE];
  laundry.forEach((ln, li) => {
    const sag = 0.55;
    const at = (t: number): V3 => [ln.p0[0] + (ln.p1[0] - ln.p0[0]) * t, ln.p0[1] + (ln.p1[1] - ln.p0[1]) * t - Math.sin(Math.PI * t) * sag, ln.p0[2] + (ln.p1[2] - ln.p0[2]) * t];
    b.begin(M.IRON, 0.5);
    for (let i = 0; i < 8; i++) beam(b, at(i / 8), at((i + 1) / 8), 0.025);
    const dx = ln.p1[0] - ln.p0[0], dz = ln.p1[2] - ln.p0[2], L = Math.hypot(dx, dz) || 1;
    const nx = -dz / L, nz = dx / L;
    for (let i = 0; i < ln.n; i++) {
      const t = (i + 1) / (ln.n + 1) + (h(ln.seed + i) - 0.5) * 0.04;
      const w = 0.35 + h(ln.seed * 3 + i) * 0.35, hgt = 0.45 + h(ln.seed * 7 + i) * 0.45;
      const swing = Math.sin(time * 3.2 * gust + i * 1.7 + li) * 0.35 * gust;
      const top = at(t), ta = at(t - w / L / 2), tb = at(t + w / L / 2);
      b.begin(cloth[Math.floor(h(ln.seed + i * 13) * cloth.length)], 0.3 + 0.6 * h(ln.seed + i * 5));
      const low = (p: V3): V3 => [p[0] + nx * swing * hgt, p[1] - hgt * Math.cos(swing * 0.6), p[2] + nz * swing * hgt];
      b.quad(ta, tb, low(tb), low(ta), [[0, 0], [w, 0], [w, hgt], [0, hgt]]);
      void top;
    }
  });

  // birds wheeling round the tallest tower (daytime, fair weather)
  if (night < 0.5 && rain < 0.6 && world.built.size) {
    let tall: { x: number; z: number; top: number } | null = null;
    for (const bt of world.built.values()) if (!tall || bt.top > tall.top) tall = { x: bt.lot.x, z: bt.lot.z, top: bt.top };
    const n = 7;
    for (let i = 0; i < n; i++) {
      const r = 7 + h(i) * 7, sp = 0.18 + h(i + 9) * 0.12, a = time * sp + i * 0.9;
      const x = tall!.x + Math.cos(a) * r, z = tall!.z + Math.sin(a) * r, y = tall!.top + 3 + h(i + 3) * 5 + Math.sin(time * 0.7 + i) * 0.8;
      const fx = -Math.sin(a), fz = Math.cos(a); // flight direction
      const sx = -fz, sz = fx; // wing span direction
      const flap = Math.sin(time * 9 + i * 2) * 0.5;
      const s = 0.7;
      b.begin(M.IRON, 0.5);
      for (const side of [-1, 1]) {
        const tip: V3 = [x + sx * side * s * 1.6, y + flap * s * 1.2, z + sz * side * s * 1.6];
        const mid: V3 = [x + sx * side * s * 0.7, y + 0.12 - flap * 0.1, z + sz * side * s * 0.7];
        b.tri([x - fx * 0.15, y, z - fz * 0.15], [x + fx * 0.25, y, z + fz * 0.25], mid, [0, 0], [0.4, 0], [0.2, 0.4]);
        b.tri([mid[0] - fx * 0.12, mid[1], mid[2] - fz * 0.12], [mid[0] + fx * 0.18, mid[1], mid[2] + fz * 0.18], tip, [0, 0], [0.3, 0], [0.15, 0.6]);
      }
    }
  }

  // boats
  boats.forEach((s, i) => world.site.boatAt(b, s, time, i));
  void lathe;
  return b.build();
}
