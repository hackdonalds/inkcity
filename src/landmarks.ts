import { M, V3, XF, beam, box, hip, lathe } from './builder';
import type { BlockRec, Gen, Lot } from './tower';
import { faceXf } from './tower';
import type { Role } from './economy';

/** Windmill sails are animated in ambient.ts; buildings report their hubs. */
export interface Sails { hub: V3; normal: V3 }
export interface LandmarkOut { blocks: BlockRec[]; sails: Sails[] }

const around = (r: (y: number) => number, t: number): XF => ([a, y, n]) =>
  [(r(y) - 0.05 + n) * Math.cos(t) - a * Math.sin(t), y, (r(y) - 0.05 + n) * Math.sin(t) + a * Math.cos(t)];

/** Build a bespoke landmark in lot-local space (call inside b.with(L.xf)). */
export function landmark(g: Gen, L: Lot, role: Role): LandmarkOut {
  const y = L.top;
  const col: XF = ([x, yy, z]) => [x, y + yy, z];
  const block = (h: number, w: number, d: number): BlockRec => ({ y0: y, h, w, d, xf: col });
  const b = g.b;
  const sails: Sails[] = [];

  if (role === 'windmill') {
    const r = (yy: number) => 2.0 - 0.45 * (yy / 6.8);
    b.with(col, () => {
      b.begin(M.STONE, g.r()); lathe(b, 0, -0.3, 0, [[2.2, 0], [2.2, 1.0], [2.0, 1.0]], 8, Math.PI / 8);
      b.begin(M.PLASTER, g.r()); lathe(b, 0, 0, 0, [[2.0, 0], [1.55, 6.8], [1.62, 7.0]], 8, Math.PI / 8);
      b.begin(M.TIMBER, g.r()); lathe(b, 0, 6.9, 0, [[1.75, 0], [1.75, 0.18], [1.5, 0.18]], 10);
      b.begin(M.SLATE, g.r()); lathe(b, 0, 7.05, 0, [[1.8, 0], [1.7, 0.5], [1.15, 1.35], [0.4, 1.85], [0, 1.95]], 10);
      for (const [t, yy] of [[Math.PI / 2, 0], [0.4, 2.4], [2.6, 3.4], [1.3, 4.8]] as [number, number][]) {
        b.with(around(r, t), () => (yy === 0 ? g.door(0, M.PLASTER, false) : g.window(0, yy, 0.55, 0.8, M.PLASTER, 1)));
      }
      b.begin(M.TIMBER, g.r()); beam(b, [0, 7.6, 1.0], [0, 7.6, 2.25], 0.34);
    });
    const hub = b.xf([0, y + 7.6, 2.3]), back = b.xf([0, y + 7.6, 1.3]);
    const nl = Math.hypot(hub[0] - back[0], hub[2] - back[2]) || 1;
    sails.push({ hub, normal: [(hub[0] - back[0]) / nl, 0, (hub[2] - back[2]) / nl] });
    return { blocks: [block(7.6, 3.6, 3.6)], sails };
  }

  if (role === 'belltower') {
    const w = 3.2, H = 10.5;
    b.with(col, () => {
      b.begin(M.STONE, g.r()); box(b, -w / 2, 0, -w / 2, w / 2, H, w / 2, { skip: 'B' });
      for (const yy of [3.4, 7.0]) { b.begin(M.STONE, g.r()); box(b, -w / 2 - 0.12, yy, -w / 2 - 0.12, w / 2 + 0.12, yy + 0.25, w / 2 + 0.12); }
      for (const f of ['F', 'K', 'R', 'L'] as const) b.with(faceXf(f, w, w), () => {
        if (f === 'F') g.door(0, M.STONE, false); else g.window(0, 1.2, 0.6, 1.2, M.STONE, 1);
        g.window(0, 4.4, 0.55, 1.3, M.STONE, 1);
        if (f === 'F' || f === 'R') { // clock
          g.window(0, 7.8, 1.5, 1.5, M.STONE, 2);
          b.begin(M.IRON, g.r());
          beam(b, [0, 8.55, 0.06], [0.35, 8.95, 0.06], 0.07); beam(b, [0, 8.55, 0.06], [-0.1, 8.05, 0.06], 0.07);
        }
      });
      // open belfry: corner piers, bell, cornice
      b.begin(M.STONE, g.r()); box(b, -w / 2 - 0.1, H, -w / 2 - 0.1, w / 2 + 0.1, H + 0.25, w / 2 + 0.1);
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) { b.begin(M.STONE, g.r()); box(b, sx * w / 2 - 0.35 * sx - 0.3, H, sz * w / 2 - 0.35 * sz - 0.3, sx * w / 2 - 0.35 * sx + 0.3, H + 3, sz * w / 2 - 0.35 * sz + 0.3); }
      b.begin(M.STONE, g.r()); box(b, -w / 2 - 0.15, H + 3, -w / 2 - 0.15, w / 2 + 0.15, H + 3.4, w / 2 + 0.15);
      b.begin(M.TIMBER, g.r()); beam(b, [-w / 2 + 0.3, H + 2.7, 0], [w / 2 - 0.3, H + 2.7, 0], 0.2);
      b.begin(M.COPPER, g.r()); lathe(b, 0, H + 1.1, 0, [[0.75, 0], [0.68, 0.1], [0.45, 0.55], [0.38, 1.05], [0.2, 1.3], [0, 1.35]], 10);
      hip(b, -w / 2 - 0.1, w / 2 + 0.1, -w / 2 - 0.1, w / 2 + 0.1, H + 3.4, 4.6, 0.35, M.COPPER, g.r());
      g.finial(0, H + 7.9, 0, 2.2);
    });
    return { blocks: [block(H + 3.4, w, w)], sails };
  }

  if (role === 'lighthouse') {
    const r = (yy: number) => 2.0 - 0.6 * (yy / 13);
    b.with(col, () => {
      b.begin(M.STONE, g.r()); lathe(b, 0, -0.3, 0, [[2.25, 0], [2.25, 0.9], [2.05, 0.9]], 12);
      for (let i = 0; i < 4; i++) {
        const y0 = (i * 13) / 4, y1 = ((i + 1) * 13) / 4;
        b.begin(i % 2 ? M.ACCENT : M.PLASTER, g.r()); lathe(b, 0, y0, 0, [[r(y0), 0], [r(y1), y1 - y0]], 12);
      }
      b.with(around(r, Math.PI / 2), () => g.door(0, M.PLASTER, false));
      for (const [t, yy] of [[0.9, 3.5], [2.4, 6.4], [-0.6, 9.4]] as [number, number][]) b.with(around(r, t), () => g.window(0, yy, 0.5, 0.75, M.PLASTER, 1));
      b.begin(M.STONE, g.r()); lathe(b, 0, 13, 0, [[2.05, 0], [2.05, 0.28], [1.2, 0.28]], 14);
      b.begin(M.IRON, g.r());
      for (let i = 0; i < 16; i++) { const t = (i / 16) * Math.PI * 2; beam(b, [Math.cos(t) * 1.95, 13.28, Math.sin(t) * 1.95], [Math.cos(t) * 1.95, 14.1, Math.sin(t) * 1.95], 0.05); }
      for (let i = 0; i < 16; i++) { const t0 = (i / 16) * Math.PI * 2, t1 = ((i + 1) / 16) * Math.PI * 2; beam(b, [Math.cos(t0) * 1.95, 14.1, Math.sin(t0) * 1.95], [Math.cos(t1) * 1.95, 14.1, Math.sin(t1) * 1.95], 0.05); }
      b.begin(M.GLASS, 0.995); lathe(b, 0, 13.28, 0, [[1.05, 0], [1.05, 1.7], [1.0, 1.7]], 10);
      b.begin(M.IRON, g.r());
      for (let i = 0; i < 8; i++) { const t = (i / 8) * Math.PI * 2; beam(b, [Math.cos(t) * 1.08, 13.28, Math.sin(t) * 1.08], [Math.cos(t) * 1.08, 15.0, Math.sin(t) * 1.08], 0.06); }
      b.begin(M.COPPER, g.r()); lathe(b, 0, 14.95, 0, [[1.3, 0], [1.05, 0.5], [0.55, 1.0], [0, 1.35]], 12);
      g.finial(0, 16.2, 0, 1.4);
    });
    return { blocks: [block(15, 3.2, 3.2)], sails };
  }

  // market square
  const [w, d] = [6.2, 5.2];
  b.with(col, () => {
    b.begin(M.COBBLE, g.r()); box(b, -w / 2, -0.1, -d / 2, w / 2, 0.12, d / 2, { skip: 'B' });
    const stall = (x: number, z: number, t: number) => b.with(([a, yy, n]) => [x + a * Math.cos(t) + n * Math.sin(t), yy, z - a * Math.sin(t) + n * Math.cos(t)], () => {
      b.begin(M.PLANK, g.r()); box(b, -0.85, 0.12, -0.35, 0.85, 0.95, 0.35);
      b.begin(M.TIMBER, g.r());
      for (const [px, pz, ph] of [[-0.85, -0.5, 2.35], [0.85, -0.5, 2.35], [-0.85, 0.55, 1.95], [0.85, 0.55, 1.95]]) beam(b, [px, 0.12, pz], [px, ph, pz], 0.09);
      for (let i = 0; i < 6; i++) { // striped awning
        const a0 = -1.0 + (i * 2.0) / 6, a1 = -1.0 + ((i + 1) * 2.0) / 6;
        b.begin(i % 2 ? M.PLASTER : M.ACCENT, g.r());
        b.quad([a0, 2.4, -0.65], [a1, 2.4, -0.65], [a1, 1.85, 0.95], [a0, 1.85, 0.95], [[a0, 0], [a1, 0], [a1, 1.7], [a0, 1.7]]);
      }
      for (let i = 0; i < 4; i++) { b.begin(g.rng.pick([M.TILE, M.GRASS, M.ACCENT, M.PLASTER]), g.r()); lathe(b, -0.6 + i * 0.4, 0.95, 0, [[0.16, 0], [0.18, 0.1], [0, 0.22]], 6); }
      b.begin(M.PLANK, g.r()); lathe(b, 1.25, 0.12, 0.6, [[0.25, 0], [0.3, 0.35], [0.25, 0.7], [0, 0.7]], 8);
    });
    stall(-1.9, -1.3, 0.15); stall(1.9, -1.2, -0.2); stall(-1.7, 1.5, Math.PI - 0.1);
    b.begin(M.STONE, g.r()); lathe(b, 1.3, 0.12, 1.2, [[0.85, 0], [0.85, 0.6], [0.7, 0.6], [0.7, 0.25], [0.01, 0.25]], 12);
    b.begin(M.WATER, g.r()); lathe(b, 1.3, 0.5, 1.2, [[0.72, 0], [0.01, 0]], 12);
    b.begin(M.STONE, g.r()); lathe(b, 1.3, 0.12, 1.2, [[0.18, 0], [0.12, 1.3], [0.35, 1.4], [0.0, 1.55]], 8);
  });
  return { blocks: [block(2.6, w, d)], sails };
}

/** Beer garden + big sign for the inn (lot-local, called from roleProps). */
export function innYard(g: Gen, x0: number, y0: number, z0: number, side: number) {
  const b = g.b;
  for (let i = 0; i < 2; i++) {
    const z = z0 - 0.9 + i * 1.9;
    b.begin(M.PLANK, g.r()); box(b, x0 - 0.8, y0 + 0.75, z - 0.4, x0 + 0.8, y0 + 0.85, z + 0.4);
    b.begin(M.TIMBER, g.r());
    for (const sx of [-0.65, 0.65]) beam(b, [x0 + sx, y0 - 0.2, z], [x0 + sx, y0 + 0.76, z], 0.1);
    for (const sz of [-0.75, 0.75]) { b.begin(M.PLANK, g.r()); box(b, x0 - 0.75, y0 + 0.42, z + sz - 0.15, x0 + 0.75, y0 + 0.5, z + sz + 0.15); }
    b.begin(M.TILE, g.r()); lathe(b, x0 + 0.3, y0 + 0.85, z, [[0.08, 0], [0.09, 0.2], [0, 0.2]], 6);
  }
  b.begin(M.PLANK, g.r()); lathe(b, x0 + side * 1.3, y0 - 0.1, z0 + 1.9, [[0.3, 0], [0.36, 0.45], [0.3, 0.9], [0, 0.9]], 8);
  b.begin(M.PLANK, g.r()); lathe(b, x0 + side * 1.3, y0 - 0.1, z0 + 2.6, [[0.3, 0], [0.36, 0.45], [0.3, 0.9], [0, 0.9]], 8);
  b.begin(M.TIMBER, g.r()); beam(b, [x0 + side * 1.4, y0 - 0.2, z0 - 2.0], [x0 + side * 1.4, y0 + 3.2, z0 - 2.0], 0.14);
  b.begin(M.IRON, g.r()); beam(b, [x0 + side * 1.4, y0 + 3.0, z0 - 2.0], [x0 + side * 0.2, y0 + 3.0, z0 - 2.0], 0.06);
  b.begin(M.ACCENT, g.r()); box(b, x0 + side * 0.8 - 0.5, y0 + 1.7, z0 - 2.04, x0 + side * 0.8 + 0.5, y0 + 2.85, z0 - 1.96);
}
