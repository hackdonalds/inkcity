/**
 * Façade composition and context-aware pieces of the building grammar (called from `Gen` in tower.ts):
 * - a per-tower window grid (consistent widths, columns aligned across floors, symmetric fronts),
 *   piano nobile, string courses, quoins, window surrounds, pilasters, bay stacks;
 * - closes (arched pends through terrace houses) and stepped alleys with an arch or bridge-room;
 * - terrace rooflines (shared pitch/material, eaves raised to meet a taller neighbour, party chimneys);
 * - condition dressing: boarded windows, flower boxes, roof patches, exposed battens, weeds.
 */
import { Builder, M, V3, XF, beam, box, lathe } from './builder';
import { RNG } from './rng';
import { Q } from './quality';
import type { Gen, Face, Lot, Site } from './tower';
import { faceXf, hashSeed } from './tower';
import type { NearNb, Passage } from './context';
import { drawIcon, type Trade } from './trades';

const clamp = (x: number, a: number, b: number) => Math.max(a, Math.min(b, x));
const stony = (m: number) => m === M.STONE || m === M.BRICK || m === M.PLASTER;

/** Per-tower façade rules, fixed when the tower starts so every floor agrees. */
export interface Grid {
  /** column spacing / offset (0: a column on the axis, 0.5: columns either side) for F/K and R/L faces */
  sx: number; px: number; sz: number; pz: number;
  ww: number; wh: number;
  /** taller first-floor windows (piano nobile) and their shape */
  noble: boolean; nobleShape: number; shape: number;
  quoins: number; pilasters: boolean;
  /** a stack of canted bay windows on the front, from block `from` up */
  bay: { a: number; from: number } | null;
  /** ground-front layout: door on the axis, or door to one side of a shop window (sign: which side) */
  shop: 0 | 1 | -1;
}

export function makeGrid(g: Gen, w0: number, d0: number, seed: number): Grid {
  const r = new RNG(hashSeed(seed, 4242));
  const st = g.style;
  const ww = st.winW * r.range(0.92, 1.1), wh = st.winH * r.range(0.92, 1.12);
  const axis = (len: number) => {
    const n = Math.max(1, Math.round((len - 0.6) / (ww * 2.2)));
    return { s: clamp((len - 0.4) / n, 1.3, 2.1), p: n % 2 ? 0 : 0.5 };
  };
  const X = axis(w0), Z = axis(d0);
  const nCols = Math.max(1, Math.round((w0 - 0.6) / (ww * 2.2)));
  const bayOk = !g.flush.includes('F') && w0 >= 3.6 && g.role !== 'farm' && g.role !== 'wood';
  const bay = bayOk && r.chance(0.3) ? { a: X.p ? X.s / 2 * (r.chance(0.5) ? 1 : -1) : 0, from: 1 } : null;
  const shopTrade = ['baker', 'tailor', 'apothecary', 'chandler', 'weaver'].includes(g.trade);
  const plainShop = g.trade === 'none' && (g.role === 'house' || g.role === 'inn') && r.chance(0.35);
  const shop: 0 | 1 | -1 = w0 >= 3.6 && !g.close && (shopTrade || plainShop) ? (r.chance(0.5) ? 1 : -1) : 0;
  return {
    sx: X.s * r.range(0.97, 1.03), px: X.p, sz: Z.s, pz: Z.p, ww, wh,
    noble: r.chance(0.65), nobleShape: r.chance(g.archP * 1.6) ? 1 : 0, shape: r.chance(g.archP * 0.6) ? 1 : 0,
    quoins: r.next(), pilasters: nCols >= 2 && r.chance(g.role === 'keep' || g.role === 'inn' ? 0.6 : 0.18),
    bay, shop,
  };
}

/** Window columns on a face of length `len`, aligned to the tower grid. */
export function columns(gr: Grid, f: Face, len: number) {
  const s = f === 'F' || f === 'K' ? gr.sx : gr.sz, p = f === 'F' || f === 'K' ? gr.px : gr.pz;
  const lim = len / 2 - gr.ww / 2 - 0.3, out: number[] = [];
  for (let k = -6; k <= 6; k++) { const a = (k + p) * s; if (Math.abs(a) <= lim + 1e-6) out.push(a); }
  if (!out.length) out.push(0);
  return out;
}

/** The faces left and right of `f` (seen from outside). */
const SIDES: Record<Face, [Face, Face]> = { F: ['L', 'R'], R: ['F', 'K'], K: ['R', 'L'], L: ['K', 'F'] };

/**
 * Lay out one face of a block (face-local frame: a along, y up, n out).
 * `yw` is the block's world height at y=0; `bi` the block index within its tower.
 */
export function facade(g: Gen, f: Face, len: number, h: number, floors: number, mat: number, ground: boolean, bi: number, yw: number) {
  const { b, rng } = g;
  const gr = g.grid!;
  const fh = h / floors;
  const front = f === 'F';
  const cols = columns(gr, f, len);
  const low = Q.low;
  const course = mat === M.PLANK ? M.TIMBER : M.STONE;

  // string courses: at the block base (upper blocks) and between floors
  if (!ground || floors > 1) {
    b.begin(course, g.r());
    if (!ground) box(b, -len / 2 - 0.06, -0.06, 0, len / 2 + 0.06, 0.16, 0.12, { skip: 'K' });
    if (stony(mat) || mat === M.PLANK) for (let fl = 1; fl < floors; fl++) box(b, -len / 2 - 0.04, fl * fh - 0.06, 0, len / 2 + 0.04, fl * fh + 0.07, 0.09, { skip: 'K' });
  }
  // pilasters between the bays of a grand front, else quoins on the open corners
  const pil = front && gr.pilasters && stony(mat) && cols.length >= 2;
  if (pil) {
    const xs = [-len / 2 + 0.2, len / 2 - 0.2];
    for (let i = 0; i + 1 < cols.length; i++) xs.push((cols[i] + cols[i + 1]) / 2);
    for (const x of xs) {
      if (ground && (Math.abs(x) < 0.95 || (gr.shop && Math.abs(x - shopA(gr, len)) < 1.3))) continue;
      b.begin(M.STONE, g.r());
      box(b, x - 0.16, 0, 0, x + 0.16, h, 0.07, { skip: 'K' });
      if (!low) box(b, x - 0.23, h - 0.24, 0, x + 0.23, h - 0.06, 0.13, { skip: 'K' });
    }
  } else if (!low && stony(mat) && gr.quoins < (mat === M.STONE ? 0.75 : 0.5)) {
    const [lf, rf] = SIDES[f];
    for (const [e, adj] of [[-1, lf], [1, rf]] as [number, Face][]) {
      if (g.flush.includes(adj)) continue;
      b.begin(M.STONE, g.r());
      const nq = Math.floor((h - 0.05) / 0.44);
      for (let i = 0; i < nq; i++) {
        const long = (i + (front || f === 'K' ? 0 : 1)) % 2 === 0, L = long ? 0.52 : 0.3, y = i * 0.44 + 0.03;
        box(b, e > 0 ? len / 2 - L : -len / 2 - 0.03, y, 0, e > 0 ? len / 2 + 0.03 : -len / 2 + L, y + 0.39, 0.045, { skip: 'KTB' });
      }
    }
  }

  const bayHere = front && gr.bay && bi >= gr.bay.from && Math.abs(gr.bay.a) + gr.ww / 2 + 0.95 < len / 2 ? gr.bay : null;
  // whole blind side walls now and then: room for a painted advert
  const blind = !front && !ground && len >= 2.8 && h >= 2.3 && rng.chance(0.1);
  if (blind) { mural(g, len, h, g.trade, rng.next()); }
  const blindCol = cols.map(() => !front && rng.chance(0.12));
  const closeW = g.closeArch ? g.closeArch.w / 2 + 0.75 : 0;

  for (let fl = 0; fl < floors && !blind; fl++) {
    const floorY = yw + fl * fh - g.groundY;
    const noble = gr.noble && stony(mat) && floorY > 1.8 && floorY < 3.6;
    const attic = floorY > 9 && fl === floors - 1;
    const wh = Math.min(gr.wh * (noble ? 1.32 : attic ? 0.85 : 1), fh * (noble ? 0.62 : 0.55));
    const wy = fl * fh + fh * (noble ? 0.26 : 0.32) + rng.range(-0.03, 0.03);
    const shape = noble ? gr.nobleShape : gr.shape;
    const groundFront = ground && fl === 0 && front;
    if (groundFront) groundFrontage(g, len, mat);
    for (let i = 0; i < cols.length; i++) {
      const a = cols[i] + rng.range(-0.04, 0.04);
      if (blindCol[i]) continue;
      if (bayHere && Math.abs(cols[i] - bayHere.a) < 0.3) continue;
      if (groundFront && (gr.shop || Math.abs(a) < (g.closeArch ? closeW : 1.28))) continue;
      if (ground && fl === 0 && f === 'K' && g.closeArch && Math.abs(a) < closeW) continue;
      if (rng.chance(0.04)) continue;
      g.window(a, wy, gr.ww, wh, mat, shape);
      if (!low) surround(g, a, wy, gr.ww, wh, mat, shape, noble);
      dress(g, a, wy, gr.ww, wh);
    }
    if (bayHere) bayFloor(g, bayHere.a, fl * fh, fh, wy - fl * fh, wh, mat, shape);
  }
  if (bayHere) bayShell(g, bayHere.a, h, mat, bi === bayHere.from && !ground);
}

/** Shop window beside a door at one end of the front: its centre and glazed width. */
const shopSpan = (gr: Grid, len: number) => {
  const aD = gr.shop * (len / 2 - 0.9);
  const lo = gr.shop > 0 ? -len / 2 + 0.15 : aD + 0.95, hi = gr.shop > 0 ? aD - 0.95 : len / 2 - 0.15;
  return { aD, a: (lo + hi) / 2, w: Math.min(1.9, hi - lo - 0.4) };
};
const shopA = (gr: Grid, len: number) => shopSpan(gr, len).a;

/** Ground floor of the front: door on the axis, a close, or a shop with the door beside it. */
function groundFrontage(g: Gen, len: number, mat: number) {
  const gr = g.grid!;
  if (g.closeArch) return; // the close's arch takes the middle; its door is inside the passage
  if (gr.shop) {
    const sp = shopSpan(gr, len);
    g.door(sp.aD, mat, false); // no lantern/basket clutter: the shop and its sign fill the front
    g.shopFor(sp.a, mat, sp.w);
    return;
  }
  g.door(0, mat);
}

/** Architrave on stone, painted band on plaster, keystone on arches, pediment on the piano nobile. */
function surround(g: Gen, a: number, y: number, ww: number, wh: number, mat: number, shape: number, noble: boolean) {
  const { b } = g;
  if (mat === M.PLANK) return;
  const t = 0.1, n = mat === M.PLASTER ? 0.015 : 0.035, x0 = a - ww / 2 - t, x1 = a + ww / 2 + t;
  b.begin(M.STONE, g.r());
  const q = (u0: number, v0: number, u1: number, v1: number) => b.quad([u0, v0, n], [u1, v0, n], [u1, v1, n], [u0, v1, n], [[u0, v0], [u1, v0], [u1, v1], [u0, v1]]);
  const top = shape === 1 ? y + wh * 0.68 : y + wh;
  q(x0, y, a - ww / 2, top); q(a + ww / 2, y, x1, top);
  if (shape === 0) q(x0, y + wh, x1, y + wh + t);
  if (shape === 1 || (mat !== M.PLASTER && noble)) { b.begin(M.STONE, g.r()); box(b, a - 0.12, y + wh - 0.06, 0, a + 0.12, y + wh + 0.22, 0.09, { skip: 'K' }); }
  if (noble && shape === 0 && mat !== M.PLASTER) { // little pediment
    b.begin(M.STONE, g.r());
    box(b, x0 - 0.06, y + wh + 0.1, 0, x1 + 0.06, y + wh + 0.2, 0.16, { skip: 'K' });
    const yb = y + wh + 0.2, pk = 0.32;
    b.quad([x0 - 0.06, yb, 0.16], [x1 + 0.06, yb, 0.16], [a, yb + pk, 0.16], [a, yb + pk, 0.16], [[0, 0], [1, 0], [0.5, 1], [0.5, 1]]);
    b.quad([x0 - 0.06, yb, 0], [x0 - 0.06, yb, 0.16], [a, yb + pk, 0.16], [a, yb + pk, 0], [[0, 0], [1, 0], [1, 1], [0, 1]]);
    b.quad([x1 + 0.06, yb, 0], [x1 + 0.06, yb, 0.16], [a, yb + pk, 0.16], [a, yb + pk, 0], [[0, 0], [1, 0], [1, 1], [0, 1]]);
  }
}

/** Condition dressing for a window: boards when shabby/derelict, flower boxes when kept/thriving. */
export function dress(g: Gen, a: number, y: number, ww: number, wh: number) {
  const { b } = g;
  const r = g.wr.next(), r2 = g.wr.next(), r3 = g.wr.next();
  const tier = g.tier;
  if ((tier === 3 && r < 0.42) || (tier === 2 && r < 0.1)) {
    const n = wh > 1.1 ? 3 : 2;
    for (let i = 0; i < n; i++) {
      b.begin(M.PLANK, 0.15 + r3 * 0.2);
      const yy = y + (i + 0.5) * (wh / n), tilt = (g.wr.next() - 0.5) * 0.35;
      beam(b, [a - ww / 2 - 0.15, yy - tilt, 0.13], [a + ww / 2 + 0.15, yy + tilt, 0.13], 0.2, 0.04);
    }
    return;
  }
  if ((tier === 0 && r2 > 0.35) || (tier === 1 && r2 > 0.9)) {
    b.begin(M.TIMBER, g.r());
    box(b, a - ww / 2 - 0.05, y - 0.02, 0.1, a + ww / 2 + 0.05, y + 0.2, 0.36, { skip: 'K' });
    if (Q.low) return;
    b.begin(M.GRASS, 0.2 + r3 * 0.2);
    const k = Math.max(2, Math.round(ww / 0.24));
    for (let i = 0; i < k; i++) lathe(b, a - ww / 2 + (i + 0.5) * ww / k, y + 0.16, 0.23, [[0.11, 0], [0.13, 0.08], [0.0, 0.18]], 5);
    b.begin(r3 < 0.5 ? M.ACCENT : M.TILE, 0.75);
    for (let i = 0; i < k; i += 2) lathe(b, a - ww / 2 + (i + 0.5) * ww / k, y + 0.28, 0.28, [[0.07, 0], [0.0, 0.08]], 4);
  }
}

/** One floor of a canted bay: windows on the front and both cants. */
function bayFloor(g: Gen, ba: number, y0: number, fh: number, wy: number, wh: number, mat: number, shape: number) {
  const { b } = g;
  const gr = g.grid!, ww = gr.ww, bw = ww + 0.55, dep = 0.6, side = 0.45;
  b.with(([x, y, z]) => [x, y, dep + z], () => { g.window(ba, y0 + wy, ww, wh, mat, shape); dress(g, ba, y0 + wy, ww, wh); });
  const cl = Math.hypot(side, dep);
  for (const s of [-1, 1]) {
    const ax = ba + s * (bw / 2 + side / 2), an = dep / 2;
    // along the cant (left→right seen from outside) and its outward normal
    const ta: [number, number] = [side / cl, -s * dep / cl], nx = s * dep / cl, nz = side / cl;
    const xf: XF = ([u, y, n]) => [ax + ta[0] * u + nx * n, y, an + ta[1] * u + nz * n];
    b.with(xf, () => g.window(0, y0 + wy + 0.05, Math.min(0.4, cl * 0.55), wh * 0.9, mat, shape));
  }
}

function bayShell(g: Gen, ba: number, h: number, mat: number, corbel: boolean) {
  const { b } = g;
  const gr = g.grid!, bw = gr.ww + 0.55, dep = 0.6, side = 0.45;
  const P: [number, number][] = [[ba - bw / 2 - side, 0], [ba - bw / 2, dep], [ba + bw / 2, dep], [ba + bw / 2 + side, 0]];
  b.begin(mat, g.r());
  for (let i = 0; i < 3; i++) {
    const [a0, n0] = P[i], [a1, n1] = P[i + 1], L = Math.hypot(a1 - a0, n1 - n0);
    b.quad([a0, 0, n0], [a1, 0, n1], [a1, h, n1], [a0, h, n0], [[0, 0], [L, 0], [L, h], [0, h]]);
  }
  // cap slab
  b.begin(M.STONE, g.r());
  const o = 0.08, Q2: [number, number][] = [[P[0][0] - o, 0], [P[1][0] - o * 0.5, dep + o], [P[2][0] + o * 0.5, dep + o], [P[3][0] + o, 0]];
  for (const yy of [h - 0.04, h + 0.12]) b.quad([Q2[0][0], yy, Q2[0][1]], [Q2[1][0], yy, Q2[1][1]], [Q2[2][0], yy, Q2[2][1]], [Q2[3][0], yy, Q2[3][1]], [[0, 0], [1, 0], [1, 1], [0, 1]]);
  for (let i = 0; i < 3; i++) {
    const [a0, n0] = Q2[i], [a1, n1] = Q2[i + 1];
    b.quad([a0, h - 0.04, n0], [a1, h - 0.04, n1], [a1, h + 0.12, n1], [a0, h + 0.12, n0], [[0, 0], [1, 0], [1, 0.16], [0, 0.16]]);
  }
  if (corbel) {
    b.begin(M.STONE, g.r());
    const tip: V3 = [ba, -1.0, 0.05];
    for (let i = 0; i < 3; i++) b.tri([P[i][0], 0, P[i][1]], [P[i + 1][0], 0, P[i + 1][1]], tip, [0, 0], [1, 0], [0.5, 1]);
    b.quad([P[0][0], 0, P[0][1]], [P[1][0], 0, P[1][1]], [P[2][0], 0, P[2][1]], [P[3][0], 0, P[3][1]], [[0, 0], [1, 0], [1, 1], [0, 1]]);
  }
}

// ------------------------------------------------------------------ closes (pends through a terrace house)

/** Ground block with an arched pend running front to back through its middle (block-local). */
export function closeShell(g: Gen, w: number, d: number, h: number, mat: number, vari: number) {
  const { b } = g;
  const pw = g.closeArch!.w, r = pw / 2, spring = Math.min(2.0, h - 1.05), top = spring + r;
  g.closeArch!.top = top;
  b.begin(mat, vari);
  box(b, -w / 2, 0, -d / 2, -r, h, d / 2, { skip: 'B' });
  box(b, r, 0, -d / 2, w / 2, h, d / 2, { skip: 'B' });
  box(b, -r, top, -d / 2, r, h, d / 2);
  const N = 6;
  for (const f of ['F', 'K'] as Face[]) b.with(faceXf(f, w, d), () => {
    b.begin(mat, vari);
    for (const s of [-1, 1]) for (let i = 0; i < N; i++) { // spandrels
      const t0 = Math.PI / 2 + s * (Math.PI / 2) * (i / N), t1 = Math.PI / 2 + s * (Math.PI / 2) * ((i + 1) / N);
      b.tri([s * r, top, 0], [Math.cos(t0) * r, spring + Math.sin(t0) * r, 0], [Math.cos(t1) * r, spring + Math.sin(t1) * r, 0], [0, 0], [1, 0], [0, 1]);
    }
    const ns = 7, th = 0.3; // voussoirs + keystone
    for (let i = 0; i < ns; i++) {
      b.begin(M.STONE, g.r());
      const t0 = Math.PI * (i / ns), t1 = Math.PI * ((i + 1) / ns), ro = r + th + (i === 3 ? 0.14 : 0);
      const p = (t: number, rr: number, n: number): V3 => [Math.cos(t) * rr, spring + Math.sin(t) * rr, n];
      b.quad(p(t0, r, 0.06), p(t1, r, 0.06), p(t1, ro, 0.06), p(t0, ro, 0.06), [[0, 0], [1, 0], [1, 1], [0, 1]]);
      b.quad(p(t0, r, 0), p(t1, r, 0), p(t1, r, 0.06), p(t0, r, 0.06), [[0, 0], [1, 0], [1, 0.06], [0, 0.06]]);
      b.quad(p(t1, r, 0), p(t1, ro, 0), p(t1, ro, 0.06), p(t1, r, 0.06), [[0, 0], [1, 0], [1, 0.06], [0, 0.06]]);
    }
    b.begin(M.STONE, g.r());
    for (const s of [-1, 1]) box(b, s * r - (s > 0 ? 0 : 0.3), spring - 0.18, 0, s * r + (s > 0 ? 0.3 : 0), spring, 0.08, { skip: 'K' });
    if (f === 'F' && !Q.low) { // name plaque over the arch
      b.begin(M.TIMBER, g.r()); box(b, -0.55, top + 0.42, 0, 0.55, top + 0.72, 0.04, { skip: 'K' });
      b.begin(M.IRON, g.r());
      for (let k = 0; k < 6; k++) { const x = -0.42 + k * 0.17; box(b, x, top + 0.52, 0.04, x + 0.1 + (k % 3) * 0.02, top + 0.6, 0.05); }
    }
  });
  b.begin(M.COBBLE, g.r());
  b.quad([-r, 0.03, d / 2], [r, 0.03, d / 2], [r, 0.03, -d / 2], [-r, 0.03, -d / 2], [[-r, d / 2], [r, d / 2], [r, -d / 2], [-r, -d / 2]]);
  // the house door opens off the close; a lantern hangs at the mouth
  b.with(([a, y, n]) => [-r + n, y, -a], () => g.door(0, mat, false));
  if (!Q.low) b.with(faceXf('F', w, d), () => g.wallLantern(r + 0.55, Math.min(2.3, spring + 0.2)));
}

/** Steps down from the back of the foundation (close exit). Returns the bottom (world). */
export function backSteps(g: Gen, site: Site, L: Lot): V3 {
  const b = g.b, bz = -L.d / 2 - 0.7;
  const gp = L.xf([0, 0, bz - 0.6]);
  const gy = site.H(gp[0], gp[2]), total = L.top - gy;
  const n = Math.max(0, Math.ceil(total / 0.26));
  b.begin(M.STONE, g.r());
  for (let i = 0; i < n; i++) {
    const yt = L.top - ((i + 1) * total) / n;
    box(b, -0.8, Math.min(gy, yt) - 1, bz - (i + 1) * 0.32, 0.8, yt, bz - i * 0.32, { skip: 'B' });
  }
  const p = L.xf([0, 0, bz - n * 0.32 - 0.4]);
  return [p[0], site.H(p[0], p[2]), p[2]];
}

// ------------------------------------------------------------------ stepped alleys between close neighbours

/**
 * A stepped alley along the gap between this building and a close neighbour, with a stone arch or a
 * little bridge-room spanning it. Drawn in lot-local space (inside L.xf). Returns the walking line.
 */
export function alley(g: Gen, site: Site, L: Lot, nb: NearNb, myTop: number, ids: number[]): Passage | null {
  const { b } = g;
  const f = nb.face, half = f === 'F' || f === 'K' ? L.d / 2 : L.w / 2;
  const a0 = nb.a0 + 0.3, a1 = nb.a1 - 0.3;
  if (a1 - a0 < 1.2) return null;
  const nOff = half + nb.gap / 2; // alley centre line, measured out from our wall
  const fx = faceXf(f, 0, 0);
  const toLot = (a: number, y: number, n: number): V3 => { const p = fx([a, y, n]); return [p[0] + (f === 'R' ? half : f === 'L' ? -half : 0), p[1], p[2] + (f === 'F' ? half : f === 'K' ? -half : 0)]; };
  const gH = (a: number, n: number) => { const p = L.xf(toLot(a, 0, n)); return site.H(p[0], p[2]); };
  const wdt = clamp(nb.gap - 0.5, 0.9, 1.5);
  const ext = 1.2; // run past both ends of the shared stretch
  const A0 = a0 - ext, A1 = a1 + ext;
  const nSeg = Math.max(3, Math.ceil((A1 - A0) / 0.45));
  const pts: V3[] = [];
  b.begin(M.STONE, g.r());
  for (let i = 0; i < nSeg; i++) {
    const t0 = A0 + (A1 - A0) * (i / nSeg), t1 = A0 + (A1 - A0) * ((i + 1) / nSeg);
    const y = Math.max(gH((t0 + t1) / 2, nb.gap / 2), gH((t0 + t1) / 2, nb.gap / 2 - wdt / 2), gH((t0 + t1) / 2, nb.gap / 2 + wdt / 2));
    const yq = Math.round(y / 0.22) * 0.22 + 0.06;
    b.with(([x, yy, z]) => toLot(x, yy, z), () => box(b, t0, yq - 0.9, nb.gap / 2 - wdt / 2, t1 + 0.02, yq, nb.gap / 2 + wdt / 2, { skip: 'B' }));
    pts.push(L.xf(toLot((t0 + t1) / 2, yq, nb.gap / 2)));
  }
  // low kerb walls where the alley is open to the ground
  if (!Q.low) {
    b.begin(M.STONE, g.r());
    for (const s of [-1, 1]) for (const [u0, u1] of [[A0, a0], [a1, A1]]) {
      const n = nb.gap / 2 + s * (wdt / 2 + 0.08), y = gH((u0 + u1) / 2, n);
      b.with(([x, yy, z]) => toLot(x, yy, z), () => box(b, u0, y - 0.4, n - 0.08, u1, y + 0.45, n + 0.08, { skip: 'B' }));
    }
  }
  // what spans it: a bridge-room if both walls rise high enough, else a stone arch
  const floor = Math.max(L.top, isNaN(nb.base) ? L.top : nb.base) + 3.0;
  const am = (a0 + a1) / 2, span = nb.gap;
  const roll = new RNG(hashSeed(ids[0] * 977 + ids[1], 5)).next();
  const room = nb.top !== null && nb.top > floor + 2.6 && myTop > floor + 2.6 && roll < 0.6;
  b.with(([x, yy, z]) => toLot(x, yy, z), () => {
    if (room) {
      const rd = Math.min(2.4, a1 - a0), rh = 2.3, mat = g.rng.pick([M.PLASTER, M.PLANK, M.PLASTER]);
      b.begin(mat, g.r());
      box(b, am - rd / 2, floor, -0.3, am + rd / 2, floor + rh, span + 0.3);
      b.begin(M.TIMBER, g.r());
      for (const s of [-1, 1]) beam(b, [am + s * (rd / 2 - 0.2), floor - 1.3, 0.02], [am + s * (rd / 2 - 0.2), floor - 0.05, span * 0.45], 0.14);
      box(b, am - rd / 2 - 0.05, floor - 0.18, -0.3, am + rd / 2 + 0.05, floor, span + 0.3);
      // windows on both open ends (along the alley)
      for (const s of [-1, 1]) b.with(([u, y, n]) => [am + s * (rd / 2 + n), y, span / 2 - s * u], () => { g.window(0, floor + 0.7, Math.min(0.7, span * 0.4), 1.0, mat, 0); dress(g, 0, floor + 0.7, Math.min(0.7, span * 0.4), 1.0); });
      // little gable roof, ridge across the alley
      const rm = g.noTiles ? M.PLANK : M.SLATE, rr = 0.9, o = 0.3, y = floor + rh;
      for (const s of [-1, 1]) {
        b.begin(rm, g.r());
        b.quad([am + s * (rd / 2 + o), y - 0.15, -0.3], [am + s * (rd / 2 + o), y - 0.15, span + 0.3], [am, y + rr, span + 0.3], [am, y + rr, -0.3], [[0, 0], [span, 0], [span, 1], [0, 1]]);
      }
    } else {
      const r = span / 2, yA = floor - 0.4, th = 0.35;
      for (let i = 0; i < 7; i++) {
        b.begin(M.STONE, g.r());
        const t0 = Math.PI * (i / 7), t1 = Math.PI * ((i + 1) / 7);
        const p = (t: number, rr: number, u: number): V3 => [am + u, yA + Math.sin(t) * rr, r - Math.cos(t) * rr];
        for (const u of [-0.35, 0.35]) b.quad(p(t0, r, u), p(t1, r, u), p(t1, r + th, u), p(t0, r + th, u), [[0, 0], [1, 0], [1, 1], [0, 1]]);
        b.quad(p(t0, r, -0.35), p(t1, r, -0.35), p(t1, r, 0.35), p(t0, r, 0.35), [[0, 0], [1, 0], [1, 1], [0, 1]]);
        b.quad(p(t0, r + th, -0.35), p(t1, r + th, -0.35), p(t1, r + th, 0.35), p(t0, r + th, 0.35), [[0, 0], [1, 0], [1, 1], [0, 1]]);
      }
      b.begin(M.STONE, g.r());
      box(b, am - 0.4, yA + r + th - 0.05, -0.2, am + 0.4, yA + r + th + 0.25, span + 0.2);
    }
  });
  return { kind: 'alley', pts, width: wdt, ids };
}

// ------------------------------------------------------------------ roofs

/** Natural eave height a terrace neighbour asks us to raise our wall-top to (0 = none). */
export function kneeFor(g: Gen, y: number) {
  let k = 0;
  for (const f of g.ctx.flushNb) if ((f.face === 'R' || f.face === 'L') && f.top !== null && f.top - y > 0.05 && f.top - y <= 2.2) k = Math.max(k, f.top - y);
  return k;
}

/** Wall raised between our top floor and the roof to meet a taller neighbour's eaves. */
export function kneeWall(g: Gen, w: number, d: number, knee: number, mat: number) {
  const { b } = g;
  b.begin(mat, g.r());
  box(b, -w / 2, -0.02, -d / 2, w / 2, knee, d / 2, { skip: 'BT' });
  if (knee > 0.9) for (const f of ['F', 'K'] as Face[]) {
    if (g.flush.includes(f)) continue;
    const len = f === 'F' || f === 'K' ? w : d;
    b.with(faceXf(f, w, d), () => { for (const a of columns(g.grid!, f, len)) g.window(a, knee * 0.2, 0.5, Math.min(0.5, knee * 0.55), mat, 0); });
  }
}

/** Eaves course under the roof (stone and plaster walls). */
export function eavesCourse(g: Gen, w: number, d: number, mat: number) {
  if (!stony(mat) || Q.low) return;
  const { b } = g;
  b.begin(M.STONE, g.r());
  for (const f of ['F', 'K', 'R', 'L'] as Face[]) {
    if (g.flush.includes(f)) continue;
    const len = f === 'F' || f === 'K' ? w : d;
    b.with(faceXf(f, w, d), () => {
      box(b, -len / 2 - 0.1, -0.42, 0, len / 2 + 0.1, -0.3, 0.1, { skip: 'K' });
      box(b, -len / 2 - 0.16, -0.3, 0, len / 2 + 0.16, -0.12, 0.17, { skip: 'K' });
    });
  }
}

/**
 * Terrace gable: ridge along the row (x), shared pitch, no overhang where it meets a neighbour.
 * Returns the ridge height.
 */
export function terraceGable(g: Gen, w: number, d: number, mat: number, roofMat: number, rh: number, vari: number) {
  const { b } = g;
  const hd = d / 2, o = 0.45, drop = (rh * o) / hd, ye = -drop;
  const fl = g.flush.includes('L'), fr = g.flush.includes('R');
  const xa = -w / 2 - (fl ? -0.005 : 0.35), xb = w / 2 + (fr ? 0.01 : 0.35), L = xb - xa, sl = Math.hypot(hd + o, rh + drop);
  b.begin(roofMat, vari);
  b.quad([xa, ye, hd + o], [xb, ye, hd + o], [xb, rh, 0], [xa, rh, 0], [[0, 0], [L, 0], [L, sl], [0, sl]]);
  b.begin(roofMat, vari);
  b.quad([xb, ye, -hd - o], [xa, ye, -hd - o], [xa, rh, 0], [xb, rh, 0], [[0, 0], [L, 0], [L, sl], [0, sl]]);
  b.begin(M.TIMBER, vari);
  for (const s of [-1, 1]) b.quad([xa, ye, s * (hd + o)], [xb, ye, s * (hd + o)], [xb, ye - 0.12, s * (hd + o)], [xa, ye - 0.12, s * (hd + o)], [[0, 0], [L, 0], [L, 0.12], [0, 0.12]]);
  for (const x of [-w / 2, w / 2]) { b.begin(mat, vari); b.tri([x, 0, -hd], [x, 0, hd], [x, rh, 0], [0, 0], [d, 0], [hd, rh]); }
  b.begin(M.TIMBER, vari);
  for (const [x, flush] of [[xa, fl], [xb, fr]] as [number, boolean][]) {
    if (flush) continue;
    beam(b, [x, ye - 0.05, hd + o], [x, rh, 0], 0.14, 0.2);
    beam(b, [x, ye - 0.05, -hd - o], [x, rh, 0], 0.14, 0.2);
  }
  // the ridge itself, a little proud, reads as one line along the row
  b.begin(roofMat === M.TILE ? M.TILE : M.SLATE, vari);
  beam(b, [xa, rh + 0.04, 0], [xb, rh + 0.04, 0], 0.16, 0.12);
  return { rh, o, ye, xa, xb };
}

/**
 * Wear on a gable-type roof whose ridge runs along x: mismatched patches (shabby+), exposed battens and
 * weeds on the ridge (derelict). Eave at y=ye, z=±(hd+o); ridge at y=rh, z=0; x in [xa, xb].
 */
export function roofWear(g: Gen, xa: number, xb: number, hd: number, o: number, ye: number, rh: number, roofMat: number) {
  const tier = g.tier;
  if (tier < 2 || Q.low) return;
  const { b } = g;
  const r = new RNG(hashSeed(g.tseed ^ 0x2007, Math.round((xb - xa) * 10)));
  const alt = roofMat === M.SLATE ? [M.TILE, M.PLANK] : roofMat === M.TILE ? [M.SLATE, M.PLANK] : [M.SLATE, M.TILE];
  const Z = hd + o, ny = Z, nz = rh - ye, nl = Math.hypot(ny, nz);
  const P = (s: number, x: number, t: number, lift: number): V3 => [x, ye + (rh - ye) * t + (ny / nl) * lift, s * (Z * (1 - t) + (nz / nl) * lift)];
  const patch = (s: number, x: number, t: number, su: number, sv: number, mat: number, vari: number, lift = 0.045) => {
    b.begin(mat, vari);
    b.quad(P(s, x - su / 2, t - sv / 2, lift), P(s, x + su / 2, t - sv / 2, lift), P(s, x + su / 2, t + sv / 2, lift), P(s, x - su / 2, t + sv / 2, lift), [[0, 0], [su, 0], [su, sv * 3], [0, sv * 3]]);
  };
  const np = tier === 3 ? 4 : 2, W = xb - xa;
  for (let i = 0; i < np; i++) {
    const s = r.chance(0.5) ? 1 : -1, su = r.range(0.6, 1.1), sv = r.range(0.15, 0.3);
    patch(s, xa + su / 2 + 0.2 + r.next() * Math.max(0.01, W - su - 0.4), r.range(0.2, 0.75), su, sv, r.pick(alt), r.next());
  }
  if (tier === 3) {
    const s = r.chance(0.5) ? 1 : -1, x = xa + 0.6 + r.next() * Math.max(0.01, W - 1.2), t = r.range(0.3, 0.6);
    patch(s, x, t, 0.8, 0.22, M.IRON, 0.1, 0.03); // hole: dark gap with battens across
    b.begin(M.TIMBER, r.next());
    for (const dt of [-0.06, 0.04]) beam(b, P(s, x - 0.45, t + dt, 0.07), P(s, x + 0.45, t + dt, 0.07), 0.06, 0.04);
    b.begin(M.GRASS, 0.3);
    for (let i = 0; i < 4; i++) lathe(b, xa + 0.4 + r.next() * Math.max(0.01, W - 0.8), rh - 0.02, 0, [[0.14, 0], [0.18, 0.1], [0.0, 0.26 + r.next() * 0.15]], 5);
  }
}

// ------------------------------------------------------------------ painted adverts

/** A painted wall advert / mural on a blank wall (face-local; covers the middle of the face). */
export function mural(g: Gen, len: number, h: number, trade: Trade, roll: number, y0 = 0) {
  if (Q.low) return;
  const { b } = g;
  const W = Math.min(len - 0.6, 3.6), H = Math.min(h - 0.5, W * 0.6), yc = y0 + h * 0.52;
  const faded = g.tier >= 2, v = faded ? 0.12 : 0.6;
  const bg = roll < 0.5 ? M.PLASTER : M.ACCENT, fg = bg === M.ACCENT ? M.PLASTER : M.ACCENT;
  const n = 0.016;
  const q = (x0: number, y0q: number, x1: number, y1: number, nn: number) => b.quad([x0, y0q, nn], [x1, y0q, nn], [x1, y1, nn], [x0, y1, nn], [[x0, y0q], [x1, y0q], [x1, y1], [x0, y1]]);
  b.begin(bg, v); q(-W / 2, yc - H / 2, W / 2, yc + H / 2, n);
  b.begin(fg, v);
  const t = 0.07;
  q(-W / 2 + 0.1, yc - H / 2 + 0.1, W / 2 - 0.1, yc - H / 2 + 0.1 + t, n * 2);
  q(-W / 2 + 0.1, yc + H / 2 - 0.1 - t, W / 2 - 0.1, yc + H / 2 - 0.1, n * 2);
  const ic: Trade = trade === 'none' ? (['tavern', 'baker', 'chandler', 'tailor'] as Trade[])[Math.floor(roll * 4)] : trade;
  const s = H * 0.62;
  b.with(([x, y, z]) => [-W / 2 + 0.25 + s / 2 + x * s, yc + y * s, n * 3 + z], () => drawIcon(g, ic, faded ? 0.15 : 0.7));
  // "lettering": a row or two of dark dashes
  b.begin(M.IRON, faded ? 0.3 : 0.1);
  const x0 = -W / 2 + 0.45 + s, rows = H > 1.0 ? 2 : 1;
  for (let rI = 0; rI < rows; rI++) {
    const yy = yc + (rows === 2 ? (rI ? -0.22 : 0.2) : 0) * H;
    let x = x0;
    let k = 0;
    while (x < W / 2 - 0.3) {
      const lw = 0.12 + ((k * 37 + rI * 11) % 5) * 0.03;
      if (!(faded && (k * 7 + rI) % 3 === 0)) q(x, yy - H * 0.09, Math.min(x + lw, W / 2 - 0.3), yy + H * 0.09, n * 3);
      x += lw + 0.07; k++;
    }
  }
}

/** Ink-friendly flat helper used by the trade signs (kept here so facades and trades share it). */
export function flatQuad(b: Builder, x0: number, y0: number, x1: number, y1: number, n: number) {
  b.quad([x0, y0, n], [x1, y0, n], [x1, y1, n], [x0, y1, n], [[x0, y0], [x1, y0], [x1, y1], [x0, y1]]);
}
