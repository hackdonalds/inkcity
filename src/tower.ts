import * as THREE from 'three';
import { Builder, M, V3, XF, beam, box, crowSteps, gableX, gableZ, hip, lathe } from './builder';
import { RNG, noise3 } from './rng';
import { BESPOKE, type Role } from './economy';
import { innYard, landmark, type Sails } from './landmarks';
import { Q } from './quality';
import { NO_CTX, type BuildCtx, type Passage } from './context';
import { type Grid, alley, backSteps, closeShell, eavesCourse, facade, kneeFor, kneeWall, makeGrid, mural, roofWear, terraceGable } from './facades';
import { type Trade, dressTrade, hayloft, tradeOf, tradeShop } from './trades';

export type Terrain = 'island' | 'crag' | 'hilltop';
export interface GenParams { seed: number; height: number; lean: number; wonk: number; terrain: Terrain; count: number }

interface Style {
  archP: number; craneP: number;
  base: number[]; mid: number[]; top: number[]; roofs: number[];
  halfTimber: number; shutters: boolean; annexP: number; overhangP: number; annexMats: number[];
  winW: number; winH: number;
}
const S = M;
export const STYLES: Style[] = [
  { archP: 0.3, craneP: 0.1, base: [S.STONE], mid: [S.STONE, S.PLASTER, S.STONE], top: [S.PLASTER, S.STONE], roofs: [S.SLATE, S.SLATE, S.COPPER],
    halfTimber: 0.1, shutters: false, annexP: 0.2, overhangP: 0.25, annexMats: [S.STONE, S.PLASTER], winW: 0.75, winH: 1.3 },
  { archP: 0.05, craneP: 0.45, base: [S.STONE, S.PLANK], mid: [S.PLANK, S.PLASTER, S.PLANK], top: [S.PLANK, S.PLASTER], roofs: [S.TILE, S.TILE, S.SLATE],
    halfTimber: 0.2, shutters: false, annexP: 0.55, overhangP: 0.5, annexMats: [S.PLANK, S.PLASTER], winW: 0.7, winH: 1.0 },
  { archP: 0.2, craneP: 0.2, base: [S.STONE], mid: [S.BRICK, S.PLASTER, S.PLANK, S.STONE], top: [S.PLASTER, S.BRICK, S.PLANK], roofs: [S.SLATE, S.TILE],
    halfTimber: 0.6, shutters: true, annexP: 0.35, overhangP: 0.4, annexMats: [S.PLASTER, S.PLANK], winW: 0.7, winH: 1.15 },
];

export interface BlockRec { y0: number; h: number; w: number; d: number; xf: XF }

export type Face = 'F' | 'K' | 'R' | 'L';
/** Face-local frame: a = along the face (left→right seen from outside), y = up, n = outward. */
export function faceXf(f: Face, w: number, d: number): XF {
  switch (f) {
    case 'F': return ([a, y, n]) => [a, y, d / 2 + n];
    case 'K': return ([a, y, n]) => [-a, y, -d / 2 - n];
    case 'R': return ([a, y, n]) => [w / 2 + n, y, -a];
    case 'L': return ([a, y, n]) => [-w / 2 - n, y, a];
  }
}
const faceLen = (f: Face, w: number, d: number) => (f === 'F' || f === 'K' ? w : d);
const clamp = (x: number, a: number, b: number) => Math.max(a, Math.min(b, x));
export const hashSeed = (a: number, b: number) => (Math.imul(a ^ 0x9e3779b9, 2654435761) ^ Math.imul(b + 1, 40503)) >>> 0;

export class Gen {
  b = new Builder();
  rng: RNG;
  style: Style;
  top = 0;
  archP = 0.15;
  /** what the building is for (shopfronts etc.) */
  role: Role = 'house';
  /** exterior chimney flue running up one face of the main stack */
  flue: { f: Face; a: number; mat: number } | null = null;
  usedShop = false;
  noTiles = false;
  /** faces (R L F K, lot-local) that share a wall with a neighbour */
  flush = '';
  /** chimney tops recorded while building (world space, pre-warp) */
  smoke: V3[] = [];
  /** activity spots recorded while building (world space) */
  spots: Spot[] = [];
  /** pennant poles recorded while building — drawn animated elsewhere */
  flags: V3[] = [];
  usedStair = false;
  groundY = 0;
  // ---- context, trade, condition and façade rules (see context.ts, trades.ts, ageing.ts, facades.ts)
  /** neighbours / terrace / condition tier for the building being built */
  ctx: BuildCtx = NO_CTX;
  /** condition tier: 0 thriving · 1 kept · 2 shabby · 3 derelict */
  tier = 1;
  trade: Trade = 'none';
  /** this building wants a close (arched pend) through its ground floor; `closeArch` is set once it is built */
  close = false;
  closeArch: { w: number; top: number } | null = null;
  /** ground-front layout of the main tower: 0 door on the axis, ±1 door to that side of a shop window */
  shopSide = 0;
  /** walk-through passages recorded while building (world space) */
  passages: Passage[] = [];
  /** per-tower window grid and façade rules */
  grid: Grid | null = null;
  /** seed of the tower being grown (for stable per-block dressing) */
  tseed = 0;
  /** dressing rolls (boards, flower boxes): reseeded per block so condition changes never shift anything else */
  wr = new RNG(1);
  constructor(public p: GenParams) {
    this.rng = new RNG(p.seed);
    this.style = this.rng.pick(STYLES);
  }
  r() { return this.rng.next(); }

  // ------------------------------------------------------------ details
  /** shape: 0 rect, 1 arched, 2 round (shape is cut in the shader). */
  window(a: number, y: number, ww: number, wh: number, wallMat: number, shape = -1) {
    const { b, rng } = this;
    if (shape < 0) shape = rng.chance(this.archP) ? 1 : 0;
    const glass = rng.chance(0.04) ? M.ACCENT : M.GLASS;
    b.begin(glass, this.r());
    const i0 = b.U.length;
    box(b, a - ww / 2, y, 0, a + ww / 2, y + wh, shape ? 0.03 : 0.09, { mats: { R: M.TIMBER, L: M.TIMBER, T: M.TIMBER, B: M.TIMBER }, norm: 'F', skip: 'K' });
    if (shape) for (let k = 0; k < 6; k++) b.U[i0 + 2 * k] += shape * 2;
    if (shape === 2) return;
    b.begin(wallMat === M.STONE || wallMat === M.BRICK || rng.chance(0.3) ? M.STONE : M.TIMBER, this.r());
    box(b, a - ww / 2 - 0.12, y - 0.14, 0, a + ww / 2 + 0.12, y, 0.2, { skip: 'K' });
    if (shape) return;
    if (wallMat === M.STONE && rng.chance(0.7)) {
      b.begin(M.STONE, this.r());
      box(b, a - ww / 2 - 0.1, y + wh, 0, a + ww / 2 + 0.1, y + wh + 0.22, 0.12, { skip: 'K' });
    }
    if (rng.chance(0.07)) { this.awning(a, y + wh + 0.05, ww + 0.3, 0.55); return; }
    if (this.style.shutters && rng.chance(0.55)) {
      for (const s of [-1, 1]) {
        b.begin(M.ACCENT, this.r());
        const x0 = a + s * (ww / 2 + 0.05), x1 = a + s * (ww / 2 + 0.05 + ww * 0.45);
        box(b, Math.min(x0, x1), y, 0, Math.max(x0, x1), y + wh, 0.06, { skip: 'K' });
      }
    }
    if (rng.chance(0.12)) { // flower box
      b.begin(M.TIMBER, this.r());
      box(b, a - ww / 2, y, 0.12, a + ww / 2, y + 0.2, 0.4, { skip: 'K' });
      b.begin(M.GRASS, this.r());
      const n = Math.max(2, Math.round(ww / 0.22));
      for (let i = 0; i < n; i++) lathe(b, a - ww / 2 + (i + 0.5) * ww / n, y + 0.18, 0.26, [[0.12, 0], [0.13, 0.08], [0.0, 0.2 + rng.range(0, 0.1)]], 5);
    }
  }

  door(a: number, wallMat: number, extras = true) {
    const { b, rng } = this;
    const dw = 1.2, dh = 2.1;
    b.begin(M.DOOR, this.r());
    box(b, a - dw / 2, 0, 0, a + dw / 2, dh, 0.05, { norm: 'F', skip: 'K' });
    b.begin(M.STONE, this.r());
    box(b, a - dw / 2 - 0.25, 0, 0, a - dw / 2, dh + 0.3, 0.22, { skip: 'K' });
    box(b, a + dw / 2, 0, 0, a + dw / 2 + 0.25, dh + 0.3, 0.22, { skip: 'K' });
    box(b, a - dw / 2 - 0.35, dh, 0, a + dw / 2 + 0.35, dh + 0.4, 0.3, { skip: 'K' });
    if (wallMat !== M.STONE) {
      b.begin(M.SLATE, this.r());
      b.quad([a - 1, dh + 0.9, 0], [a + 1, dh + 0.9, 0], [a + 1, dh + 0.45, 0.9], [a - 1, dh + 0.45, 0.9], [[0, 0], [2, 0], [2, 1], [0, 1]]);
    }
    if (!extras) return;
    if (rng.chance(0.6)) this.wallLantern(a + dw / 2 + 0.55, 2.2);
    else if (rng.chance(0.5)) this.hangingBasket(a + dw / 2 + 0.6, 2.5);
    if (rng.chance(0.3)) this.hangingBasket(a - dw / 2 - 0.6, 2.5);
    if (rng.chance(0.35)) this.sign(a - dw / 2 - 0.95, 2.9);
    // props at the door
    const np = rng.int(0, 3);
    for (let i = 0; i < np; i++) {
      const side = rng.chance(0.5) ? 1 : -1;
      const px = a + side * rng.range(1.0, 1.9), pz = rng.range(0.45, 1.0);
      if (rng.chance(0.55)) {
        b.begin(M.PLANK, this.r());
        lathe(b, px, 0, pz, [[0.26, 0], [0.32, 0.4], [0.26, 0.8], [0.0, 0.8]], 8);
      } else {
        b.begin(M.PLANK, this.r());
        const s = rng.range(0.4, 0.6);
        box(b, px - s / 2, 0, pz - s / 2, px + s / 2, s, pz + s / 2);
      }
    }
  }

  wallLantern(a: number, y: number) {
    const { b } = this;
    b.begin(M.IRON, this.r());
    beam(b, [a, y + 0.35, 0], [a, y + 0.35, 0.45], 0.05);
    beam(b, [a, y - 0.1, 0], [a, y + 0.35, 0.3], 0.04);
    b.begin(M.GLASS, 0.995);
    lathe(b, a, y - 0.05, 0.45, [[0.08, 0], [0.15, 0.3], [0.0, 0.31]], 6);
    b.begin(M.IRON, this.r());
    lathe(b, a, y + 0.25, 0.45, [[0.18, 0], [0.0, 0.18]], 6);
  }

  sign(a: number, y: number) {
    const { b, rng } = this;
    b.begin(M.IRON, this.r());
    beam(b, [a, y, 0], [a, y, 1.05], 0.06);
    beam(b, [a, y - 0.6, 0], [a, y, 0.7], 0.04);
    b.begin(rng.chance(0.5) ? M.ACCENT : M.TIMBER, this.r());
    box(b, a - 0.04, y - 0.85, 0.35, a + 0.04, y - 0.1, 0.95);
  }

  oriel(a: number, y: number, fh: number, mat: number) {
    const { b, rng } = this;
    const ow = rng.range(1.2, 1.7), od = rng.range(0.6, 0.85), oh = fh * rng.range(0.7, 0.85);
    b.begin(mat, this.r());
    box(b, a - ow / 2, y, 0, a + ow / 2, y + oh, od, { skip: 'K' });
    b.begin(mat === M.STONE ? M.STONE : M.TIMBER, this.r());
    lathe(b, a, y - 0.9, od * 0.45, [[0.1, 0], [ow * 0.35, 0.6], [ow * 0.5, 0.9]], 4, Math.PI / 4);
    b.with(([x, yy, z]) => [x, yy, od + z], () => this.window(a, y + oh * 0.2, ow * 0.62, oh * 0.6, mat, 0));
    for (const s of [-1, 1]) {
      b.with(([x, yy, z]) => [a + s * (ow / 2 + z), yy, od / 2 - s * x], () => this.window(0, y + oh * 0.2, od * 0.5, oh * 0.6, mat, 0));
    }
    hip(b, a - ow / 2, a + ow / 2, 0, od, y + oh, 0.55, 0.12, rng.pick(this.style.roofs) === M.TILE ? M.TILE : M.SLATE, this.r());
  }

  buttress(a: number, h: number) {
    const { b } = this;
    b.begin(M.STONE, this.r());
    box(b, a - 0.28, 0, 0, a + 0.28, h * 0.45, 0.75, { skip: 'K' });
    box(b, a - 0.24, h * 0.45, 0, a + 0.24, h * 0.75, 0.42, { skip: 'K' });
    b.begin(M.STONE, this.r());
    b.quad([a - 0.28, h * 0.45, 0.75], [a + 0.28, h * 0.45, 0.75], [a + 0.24, h * 0.55, 0.42], [a - 0.24, h * 0.55, 0.42], [[0, 0], [0.5, 0], [0.5, 0.3], [0, 0.3]]);
  }

  /** Outside stair climbing along a face to an upper door. Returns false if it doesn't fit. */
  outsideStair(len: number, yTop: number, mat: number) {
    const { b } = this;
    const n = Math.ceil(yTop / 0.27), run = 0.3;
    const a0 = -len / 2 + 0.2, a1 = a0 + n * run;
    if (a1 + 1.4 > len / 2) return false;
    b.begin(mat === M.STONE ? M.STONE : M.PLANK, this.r());
    for (let i = 0; i < n; i++) box(b, a0 + i * run, mat === M.STONE ? 0 : (i + 1) * (yTop / n) - 0.12, 0, a0 + (i + 1) * run, (i + 1) * (yTop / n), 0.95, { skip: 'K' });
    box(b, a1, yTop - 0.15, 0, a1 + 1.3, yTop, 0.95, { skip: 'K' });
    b.begin(M.TIMBER, this.r());
    beam(b, [a0, 1.0, 0.9], [a1, yTop + 0.95, 0.9], 0.07);
    beam(b, [a1, yTop + 0.95, 0.9], [a1 + 1.3, yTop + 0.95, 0.9], 0.07);
    for (const p of [a1, a1 + 1.3]) beam(b, [p, mat === M.STONE ? yTop : 0, 0.9], [p, yTop + 0.95, 0.9], 0.1);
    if (mat !== M.STONE) beam(b, [a0 + 0.3, 0, 0.85], [a1 - 0.2, yTop - 0.2, 0.85], 0.12);
    b.with(([x, y, z]) => [x, y + yTop, z], () => this.door(a1 + 0.65, mat, false));
    return true;
  }

  scaffold(len: number, h: number) {
    const { b, rng } = this;
    b.begin(M.TIMBER, this.r());
    const np = Math.max(2, Math.round(len / 1.8));
    for (let i = 0; i <= np; i++) {
      const a = -len / 2 + 0.1 + (i * (len - 0.2)) / np;
      beam(b, [a + rng.range(-0.05, 0.05), 0, 1.0], [a, h + 1.0, 1.0], 0.09);
      beam(b, [a, 0, 0.15], [a, h + 1.0, 0.15], 0.07);
    }
    for (let y = 1.4; y < h + 0.5; y += 1.4) {
      b.begin(M.TIMBER, this.r());
      beam(b, [-len / 2, y + 0.9, 1.0], [len / 2, y + 0.9, 1.0], 0.06);
      b.begin(M.PLANK, this.r());
      box(b, -len / 2, y - 0.06, 0.15, len / 2, y + 0.04, 1.05);
    }
    b.begin(M.TIMBER, this.r());
    beam(b, [-len / 2 + 0.1, 0.2, 1.0], [len / 2 - 0.1, h * 0.9, 1.0], 0.06);
  }

  crane(h: number, drop: number) {
    const { b, rng } = this;
    const L = rng.range(1.8, 2.6), y = h - 0.5;
    b.begin(M.TIMBER, this.r());
    beam(b, [0, y, -0.3], [0, y, L], 0.16);
    beam(b, [0, y - 1.3, 0], [0, y, L * 0.65], 0.12);
    b.begin(M.IRON, this.r());
    lathe(b, 0, y - 0.25, L - 0.1, [[0.16, 0], [0.16, 0.2], [0, 0.2]], 8);
    beam(b, [0, y - 0.2, L - 0.1], [0, y - drop, L - 0.1], 0.025);
    b.begin(M.PLANK, this.r());
    box(b, -0.35, y - drop - 0.7, L - 0.45, 0.35, y - drop, L + 0.25);
  }

  roundBlock(r: number, h: number, floors: number, mat: number) {
    const { b, rng } = this;
    b.begin(mat, this.r());
    lathe(b, 0, 0, 0, [[r, 0], [r, h], [0.01, h]], 14);
    b.begin(M.STONE, this.r());
    lathe(b, 0, -0.05, 0, [[r + 0.12, 0], [r + 0.12, 0.22], [r, 0.22]], 14);
    const fh = h / floors;
    const nw = Math.max(3, Math.round((Math.PI * 2 * r) / 2.4));
    const t0 = rng.range(0, 1);
    for (let fl = 0; fl < floors; fl++) for (let i = 0; i < nw; i++) {
      if (rng.chance(0.3)) continue;
      const t = t0 + (i / nw) * Math.PI * 2 + fl * 0.4;
      const rot: XF = ([a, y, n]) => [(r - 0.05 + n) * Math.cos(t) - a * Math.sin(t), y, (r - 0.05 + n) * Math.sin(t) + a * Math.cos(t)];
      b.with(rot, () => this.window(0, fl * fh + fh * 0.32, 0.6, Math.min(1.1, fh * 0.5), mat));
    }
  }

  halfTimber(len: number, h: number, floors: number) {
    const { b } = this;
    b.begin(M.TIMBER, this.r());
    const t = 0.16;
    const n = Math.max(2, Math.round(len / 1.3));
    for (let i = 0; i <= n; i++) {
      const a = -len / 2 + (i * len) / n;
      box(b, a - t / 2, 0, 0, a + t / 2, h, 0.05, { skip: 'K' });
    }
    const fh = h / floors;
    for (let f = 0; f <= floors; f++) box(b, -len / 2, f * fh - (f ? t / 2 : 0), 0, len / 2, f * fh + (f < floors ? t / 2 : 0), 0.05, { skip: 'K' });
    for (let f = 0; f < floors; f++) {
      for (let i = 0; i < n; i++) {
        if (this.r() < 0.55) continue;
        const a0 = -len / 2 + (i * len) / n, a1 = -len / 2 + ((i + 1) * len) / n;
        const flip = this.r() < 0.5;
        beam(b, [flip ? a0 : a1, f * fh, 0.02], [flip ? a1 : a0, f * fh + fh * 0.6, 0.02], 0.13, 0.06);
      }
    }
  }

  /** Striped canvas awning over an opening (face-local). */
  awning(a: number, y: number, w: number, depth: number) {
    const { b, rng } = this;
    const n = Math.max(3, Math.round(w / 0.3)), c2 = rng.chance(0.5) ? M.PLASTER : M.SMOKE;
    for (let i = 0; i < n; i++) {
      const a0 = a - w / 2 + (i * w) / n, a1 = a - w / 2 + ((i + 1) * w) / n;
      b.begin(i % 2 ? c2 : M.ACCENT, 0.55);
      b.quad([a0, y + 0.35, 0.02], [a1, y + 0.35, 0.02], [a1, y - 0.05, depth], [a0, y - 0.05, depth], [[a0, 0], [a1, 0], [a1, depth], [a0, depth]]);
      b.quad([a0, y - 0.05, depth], [a1, y - 0.05, depth], [a1, y - 0.25, depth + 0.02], [a0, y - 0.25, depth + 0.02], [[a0, 0], [a1, 0], [a1, 0.2], [a0, 0.2]]);
    }
    b.begin(M.IRON, this.r());
    for (const s of [-1, 1]) beam(b, [a + s * w / 2, y - 0.3, 0], [a + s * w / 2, y - 0.05, depth], 0.03);
  }

  hangingBasket(a: number, y: number) {
    const { b, rng } = this;
    b.begin(M.IRON, this.r());
    beam(b, [a, y, 0], [a, y, 0.5], 0.04); beam(b, [a, y, 0.45], [a, y - 0.35, 0.45], 0.015);
    b.begin(M.PLANK, this.r()); lathe(b, a, y - 0.65, 0.45, [[0.02, 0], [0.22, 0.12], [0.26, 0.3], [0.02, 0.3]], 7);
    b.begin(M.GRASS, rng.range(0.1, 0.4));
    lathe(b, a, y - 0.4, 0.45, [[0.3, 0], [0.32, 0.1], [0.18, 0.22], [0.02, 0.26]], 7);
    b.begin(M.ACCENT, 0.7); for (let i = 0; i < 3; i++) { const t = i * 2.1; lathe(b, a + Math.cos(t) * 0.22, y - 0.38, 0.45 + Math.sin(t) * 0.22, [[0.07, 0], [0.0, 0.08]], 5); }
  }

  /** Ground-floor shop window with stall board, awning and sign (face-local). */
  shopfront(a: number, wallMat: number) {
    const { b } = this;
    const w = 1.9, y0 = 0.55, h = 1.35;
    b.begin(M.STONE, this.r()); box(b, a - w / 2 - 0.2, 0, 0, a + w / 2 + 0.2, y0, 0.3, { skip: 'K' });
    b.begin(M.GLASS, this.r()); box(b, a - w / 2, y0, 0, a + w / 2, y0 + h, 0.06, { mats: { R: M.TIMBER, L: M.TIMBER, T: M.TIMBER, B: M.TIMBER }, norm: 'F', skip: 'K' });
    b.begin(M.TIMBER, this.r());
    for (const x of [-w / 2, 0, w / 2]) box(b, a + x - 0.07, y0, 0, a + x + 0.07, y0 + h, 0.1, { skip: 'K' });
    box(b, a - w / 2 - 0.1, y0 + h, 0, a + w / 2 + 0.1, y0 + h + 0.12, 0.12, { skip: 'K' });
    b.begin(M.PLANK, this.r()); box(b, a - w / 2 + 0.1, y0 - 0.02, 0.06, a + w / 2 - 0.1, y0 + 0.08, 0.55, { skip: 'K' });
    for (let i = 0; i < 4; i++) { b.begin(this.rng.pick([M.TILE, M.GRASS, M.ACCENT]), this.r()); lathe(b, a - w / 2 + 0.35 + i * 0.42, y0 + 0.08, 0.32, [[0.12, 0], [0.14, 0.08], [0, 0.17]], 6); }
    this.awning(a, y0 + h + 0.4, w + 0.5, 0.9);
    b.begin(this.rng.chance(0.5) ? M.ACCENT : M.TIMBER, this.r()); box(b, a - 0.8, y0 + h + 0.95, 0, a + 0.8, y0 + h + 1.4, 0.08, { skip: 'K' });
    void wallMat;
  }

  /** Ground-floor shop window: the trade's own, or a general shopfront. */
  shopFor(a: number, wallMat: number) {
    if (this.trade !== 'none') tradeShop(this, a, this.trade);
    else this.shopfront(a, wallMat);
  }

  /** Covered wooden gallery running along a face (face-local, block coords). */
  gallery(len: number, h: number) {
    const { b } = this;
    const dep = 1.15, y = 0.05, top = Math.min(h - 0.15, 2.6);
    b.begin(M.PLANK, this.r()); box(b, -len / 2, y - 0.15, 0, len / 2, y + 0.05, dep);
    b.begin(M.TIMBER, this.r());
    const n = Math.max(2, Math.round(len / 1.3));
    for (let i = 0; i <= n; i++) {
      const a = -len / 2 + 0.1 + (i * (len - 0.2)) / n;
      beam(b, [a, y, dep - 0.08], [a, top, dep - 0.08], 0.12);
      beam(b, [a, y - 1.2, 0], [a, y - 0.1, dep - 0.1], 0.1);
    }
    beam(b, [-len / 2, y + 0.9, dep - 0.08], [len / 2, y + 0.9, dep - 0.08], 0.07);
    beam(b, [-len / 2, y + 0.45, dep - 0.08], [len / 2, y + 0.45, dep - 0.08], 0.05);
    for (let a = -len / 2 + 0.25; a < len / 2; a += 0.25) beam(b, [a, y + 0.05, dep - 0.08], [a, y + 0.9, dep - 0.08], 0.03);
    b.begin(this.rng.pick(this.style.roofs) === M.TILE ? M.TILE : M.SLATE, this.r());
    b.quad([-len / 2 - 0.2, top + 0.45, 0], [len / 2 + 0.2, top + 0.45, 0], [len / 2 + 0.2, top, dep + 0.3], [-len / 2 - 0.2, top, dep + 0.3], [[0, 0], [len, 0], [len, dep], [0, dep]]);
  }

  ladder(a: number, h: number) {
    const { b } = this;
    b.begin(M.TIMBER, this.r());
    const top = h * 0.85, foot = 0.75;
    for (const s of [-0.22, 0.22]) beam(b, [a + s, 0, foot], [a + s, top, 0.1], 0.07);
    for (let y = 0.35; y < top - 0.1; y += 0.38) { const k = y / top; beam(b, [a - 0.22, y, foot * (1 - k) + 0.1 * k], [a + 0.22, y, foot * (1 - k) + 0.1 * k], 0.04); }
  }

  rainSpouts(len: number, h: number, mat: number) {
    const { b } = this;
    for (const s of [-1, 1]) {
      b.begin(mat === M.STONE ? M.STONE : M.IRON, this.r());
      const a = s * (len / 2 - 0.25);
      beam(b, [a, h - 0.35, 0], [a, h - 0.45, 0.7], 0.14, 0.12);
      box(b, a - 0.1, h - 0.6, 0.55, a + 0.1, h - 0.36, 0.8);
    }
  }

  balcony(a: number, y: number, bw: number) {
    const { b } = this;
    b.begin(M.STONE, this.r());
    box(b, a - bw / 2, y - 0.2, 0, a + bw / 2, y, 0.9);
    b.begin(M.IRON, this.r());
    const rh = 0.9;
    for (let x = -bw / 2; x <= bw / 2 + 1e-3; x += 0.22) box(b, a + x - 0.025, y, 0.85, a + x + 0.025, y + rh, 0.9);
    for (const s of [-1, 1]) for (let z = 0.1; z < 0.9; z += 0.22) box(b, a + s * bw / 2 - 0.025, y, z, a + s * bw / 2 + 0.025, y + rh, z + 0.05);
    box(b, a - bw / 2, y + rh, 0, a + bw / 2, y + rh + 0.06, 0.92, { skip: 'B' });
    // brackets
    b.begin(M.IRON, this.r());
    for (const s of [-1, 1]) beam(b, [a + s * (bw / 2 - 0.2), y - 0.9, 0], [a + s * (bw / 2 - 0.2), y - 0.2, 0.8], 0.06);
  }

  chimney(x: number, z: number, y0: number, y1: number, mat: number) {
    const { b, rng } = this;
    const cluster = rng.chance(0.28);
    const cw = cluster ? rng.range(1.5, 2.3) : rng.range(0.6, 1.1), cd = rng.range(0.6, 0.9);
    b.begin(mat === M.PLANK ? M.BRICK : mat === M.PLASTER ? M.STONE : mat, this.r());
    box(b, x - cw / 2, y0, z - cd / 2, x + cw / 2, y1, z + cd / 2, { skip: 'B' });
    b.begin(M.STONE, this.r());
    box(b, x - cw / 2 - 0.1, y1, z - cd / 2 - 0.1, x + cw / 2 + 0.1, y1 + 0.15, z + cd / 2 + 0.1);
    const pots = Math.max(1, Math.round(cw / 0.35));
    for (let i = 0; i < pots; i++) {
      const px = x - cw / 2 + ((i + 0.5) * cw) / pots;
      const ph = rng.range(0.35, 0.7);
      b.begin(M.TILE, this.r());
      lathe(b, px, y1 + 0.15, z, [[0.13, 0], [0.12, ph], [0.15, ph + 0.05], [0.15, ph + 0.12], [0.1, ph + 0.12]], 8);
      if (i === 0) this.smoke.push(b.xf([px, y1 + ph + 0.4, z]));
    }
  }

  finial(x: number, y: number, z: number, tall: number) {
    const { b } = this;
    b.begin(M.IRON, this.r());
    lathe(b, x, y, z, [[0.07, 0], [0.04, tall * 0.5], [0.12, tall * 0.55], [0.1, tall * 0.62], [0.03, tall * 0.65], [0.0, tall]], 6);
    if (this.rng.chance(0.35)) this.flags.push(b.xf([x, y + tall * 0.95, z])); // pennant waves in ambient.ts
    else if (this.rng.chance(0.4)) this.weatherVane(x, y + tall * 0.8, z);
  }

  /** Arrow + rooster weathervane. */
  weatherVane(x: number, y: number, z: number) {
    const { b, rng } = this;
    const t = rng.range(0, Math.PI * 2), c = Math.cos(t), s = Math.sin(t);
    b.with(([px, py, pz]) => [x + px * c - pz * s, y + py, z + px * s + pz * c], () => {
      b.begin(M.IRON, this.r());
      beam(b, [-0.55, 0, 0], [0.6, 0, 0], 0.04);
      b.tri([0.6, 0, 0], [0.42, 0.12, 0], [0.42, -0.12, 0], [0, 0], [0.2, 0], [0.1, 0.2]);
      b.quad([-0.55, 0.02, 0], [-0.35, 0.02, 0], [-0.4, 0.22, 0], [-0.62, 0.22, 0], [[0, 0], [0.2, 0], [0.2, 0.2], [0, 0.2]]);
      // the rooster
      b.tri([-0.15, 0.08, 0], [0.18, 0.08, 0], [0.05, 0.38, 0], [0, 0], [0.3, 0], [0.15, 0.3]);
      b.tri([0.05, 0.3, 0], [0.2, 0.32, 0], [0.12, 0.52, 0], [0, 0], [0.15, 0], [0.08, 0.2]);
      b.tri([-0.15, 0.1, 0], [-0.32, 0.42, 0], [-0.05, 0.3, 0], [0, 0], [0.2, 0.3], [0.1, 0]);
      for (const [dx, dz] of [[0.22, 0], [0, 0.22], [-0.22, 0], [0, -0.22]]) beam(b, [0, -0.25, 0], [dx, -0.25, dz], 0.025);
    });
  }

  // ------------------------------------------------------------ building pieces
  wallMat(y: number, topY: number) {
    const st = this.style;
    if (y < this.groundY + 3) return this.rng.pick(st.base);
    if (y > topY - 6) return this.rng.pick(st.top);
    return this.rng.pick(st.mid);
  }

  /**
   * One storey-block in block-local coords (centered in x/z, y from 0).
   * `bi`: block index in its tower; `yw`: world height of the block's base.
   */
  block(w: number, d: number, h: number, floors: number, mat: number, ground: boolean, pw: number, pd: number, bi = 0, yw = this.groundY) {
    const { b, rng, style } = this;
    this.wr = new RNG(hashSeed(this.tseed ^ 0x5eed, bi));
    if (!this.grid) this.grid = makeGrid(this, w, d, this.tseed);
    if (ground) this.shopSide = this.grid.shop;
    const vari = this.r();
    if (ground) this.closeArch = this.close && h >= 3.0 && w >= 3.0 ? { w: 1.4, top: 0 } : null;
    if (ground && this.closeArch) closeShell(this, w, d, h, mat, vari);
    else { b.begin(mat, vari); box(b, -w / 2, 0, -d / 2, w / 2, h, d / 2, { skip: 'B' }); }

    const ht = mat === M.PLASTER && rng.chance(style.halfTimber);
    const fh = h / floors;
    const near = this.ctx.near.map((n) => n.face).join('');
    for (const f of ['F', 'K', 'R', 'L'] as Face[]) {
      const len = faceLen(f, w, d);
      if (this.flush.includes(f)) { // party wall: bare, unless it rises well above the neighbour — then an old painted advert
        const nb = this.ctx.flushNb.find((q) => q.face === f);
        const nbTop = nb && nb.top !== null ? nb.top : null;
        const exposed = nbTop !== null ? yw + h - (nbTop + 4.2) : -1;
        if (nbTop !== null && exposed > 2.0 && len > 2.6 && this.wr.next() < 0.45) {
          const y0 = Math.max(0, nbTop + 4.2 - yw);
          b.with(faceXf(f, w, d), () => mural(this, len, h - y0, this.trade, this.wr.next(), y0));
        }
        continue;
      }
      const quiet = near.includes(f); // an alley runs along this face: keep it clear
      b.with(faceXf(f, w, d), () => {
        if (ht) this.halfTimber(len, h, floors);
        facade(this, f, len, h, floors, mat, ground, bi, yw);
        const balconyFloor = !ground && f === 'F' && !this.grid!.bay && rng.chance(0.18) ? rng.int(0, floors - 1) : -1;
        if (balconyFloor >= 0) this.balcony(0, balconyFloor * fh + 0.05, Math.min(len - 0.4, rng.range(1.6, 2.4)));
        // struts under jetties
        const pl = faceLen(f, pw, pd);
        const ov = (f === 'F' || f === 'K' ? d - pd : w - pw) / 2;
        if (!ground && ov > 0.2) {
          b.begin(M.TIMBER, this.r());
          const ns = Math.max(2, Math.round(len / 1.6));
          for (let i = 0; i < ns; i++) {
            const a = -Math.min(len, pl) / 2 + 0.2 + (i * (Math.min(len, pl) - 0.4)) / (ns - 1);
            beam(b, [a, -1.4, -ov], [a, 0, 0], 0.16);
          }
        }
        if (ground && mat === M.STONE && !quiet && rng.chance(0.3) && !(f === 'F' && (this.grid!.shop || this.closeArch))) for (const s of [-1, 1]) this.buttress(s * (len / 2 - 0.35), h);
        if (!ground && len > 3 && !quiet && rng.chance(0.1) && (mat === M.PLANK || mat === M.PLASTER || rng.chance(0.3))) this.gallery(len, h);
        if ((mat === M.STONE || mat === M.BRICK) && rng.chance(0.3)) this.rainSpouts(len, h, mat);
        if (ground && !quiet && rng.chance(0.08) && f !== 'F') this.ladder(rng.range(-len / 2 + 0.6, len / 2 - 0.6), h);
        if (this.flue && this.flue.f === f) {
          const fa = Math.max(-len / 2 + 0.5, Math.min(len / 2 - 0.5, this.flue.a));
          b.begin(this.flue.mat, this.r());
          box(b, fa - 0.42, ground ? 0 : -0.05, -0.05, fa + 0.42, h + 0.05, 0.5, { skip: 'K' });
          if (ground) { b.begin(this.flue.mat, this.r()); box(b, fa - 0.55, 0, -0.05, fa + 0.55, 1.2, 0.65, { skip: 'K' }); }
        }
        if (ground && !quiet && !this.usedStair && floors >= 2 && (f === 'R' || f === 'L') && rng.chance(0.35)) this.usedStair = this.outsideStair(len, fh, mat);
        else if (ground && !quiet && rng.chance(0.06) && !(this.closeArch && (f === 'F' || f === 'K'))) this.scaffold(len, h);
        if (!ground && rng.chance(0.12) && len > 2.6 && !(f === 'F' && this.grid!.bay)) this.oriel(rng.range(-len / 2 + 0.9, len / 2 - 0.9), rng.int(0, floors - 1) * fh + 0.35, fh, mat);
        // annex
        if (!quiet && !(ground && f === 'K' && this.closeArch) && rng.chance(style.annexP * (f === 'F' ? 0.5 : 1))) this.annex(len, h, ground);
      });
    }
  }

  annex(len: number, h: number, ground: boolean) {
    const { b, rng } = this;
    const aw = rng.range(1.4, Math.max(1.6, len * 0.7));
    const a0 = rng.range(-len / 2, len / 2 - aw);
    const a1 = a0 + aw;
    const ad = rng.range(1.0, 1.9);
    const ya = ground ? 0 : rng.range(-0.6, h * 0.4);
    const ah = rng.range(1.7, 2.4);
    const mat = rng.pick(this.style.annexMats);
    b.begin(mat, this.r());
    box(b, a0, ya, -0.05, a1, ya + ah, ad, { skip: 'K' });
    b.with(([x, y, z]) => [x, y, ad + z], () => {
      const ww = 0.6;
      if (aw > 1.2) this.window((a0 + a1) / 2, ya + 0.7, ww, 0.9, mat);
    });
    const yt = ya + ah, rise = rng.range(0.6, 1.0);
    if (rng.chance(0.4)) {
      const rm = rng.pick(this.style.roofs);
      gableX(b, a0, a1, -0.05, ad, yt, rng.range(0.9, 1.5), 0.25, mat, rm === M.COPPER ? M.SLATE : rm, this.r());
      this.annexSupports(a0, a1, ya, ad, ground);
      return;
    }
    // shed roof
    const k = rise / ad;
    const roofMat = rng.pick(this.style.roofs);
    b.begin(roofMat === M.COPPER ? M.SLATE : roofMat, this.r());
    const e0 = -0.05, e1 = ad + 0.35;
    b.quad([a0 - 0.25, yt + rise - k * e0, e0], [a1 + 0.25, yt + rise - k * e0, e0], [a1 + 0.25, yt + rise - k * e1, e1], [a0 - 0.25, yt + rise - k * e1, e1],
      [[0, 0], [aw + 0.5, 0], [aw + 0.5, ad + 0.4], [0, ad + 0.4]]);
    b.begin(mat, this.r());
    for (const a of [a0, a1]) b.tri([a, yt, -0.05], [a, yt, ad], [a, yt + rise, -0.05], [0, 0], [ad, 0], [0, rise]);
    this.annexSupports(a0, a1, ya, ad, ground);
  }

  annexSupports(a0: number, a1: number, ya: number, ad: number, ground: boolean) {
    const { b } = this;
    if (!ground && ya > -0.5) {
      b.begin(M.TIMBER, this.r());
      for (const a of [a0 + 0.15, a1 - 0.15]) beam(b, [a, ya - 1.6, 0], [a, ya, ad - 0.15], 0.15);
      b.begin(M.TIMBER, this.r());
      box(b, a0, ya - 0.2, 0, a1, ya, ad + 0.05);
    }
  }

  roof(w: number, d: number, mat: number, depth: number, round = false, terrace: { seed: number; d: number } | null = null) {
    const { b, rng, style } = this;
    const pickedRoof = rng.pick(style.roofs);
    const roofMat = this.noTiles ? M.PLANK : pickedRoof;
    const vari = this.r();
    if (terrace && !round) { // a terrace shares one roofline: the oldest house sets pitch and covering
      const tr = new RNG(hashSeed(terrace.seed, 31));
      const rh = terrace.d * 0.5 * tr.range(0.8, 1.05) * 1.45;
      const tm = this.noTiles ? M.PLANK : tr.pick([M.SLATE, M.SLATE, M.TILE]);
      const r = terraceGable(this, w, d, mat, tm, rh, tr.next());
      roofWear(this, r.xa, r.xb, d / 2, r.o, r.ye, rh, tm);
      this.dormers(w, d, rh, mat, tm, true);
      if (this.flush.includes('R')) this.chimney(w / 2, 0, -0.3, rh + rng.range(0.7, 1.4), mat); // party-wall stack
      if (!this.flush.includes('L') && rng.chance(0.6)) this.chimney(-w / 2 + 0.5, 0, -0.3, rh + rng.range(0.6, 1.4), mat);
      return rh;
    }
    if (round) {
      const r = w / 2 + 0.35, rh = r * rng.range(1.3, 2.2);
      b.begin(roofMat, vari);
      const shape = rng.next();
      lathe(b, 0, -0.15, 0, shape < 0.4
        ? [[r, 0], [r * 0.5, rh * 0.5], [0.05, rh]]
        : shape < 0.7 ? [[r, 0], [r * 0.9, rh * 0.25], [r * 0.6, rh * 0.55], [0.05, rh]]
        : [[r * 0.9, 0], [r * 1.12, rh * 0.22], [r * 0.95, rh * 0.45], [r * 0.4, rh * 0.7], [0.12, rh * 0.86], [0.05, rh]], 14);
      this.finial(0, rh - 0.3, 0, rng.range(1, 2.4));
      return rh;
    }
    const steep = rng.range(0.6, 1.1);
    const o = rng.range(0.4, 0.75);
    let rh: number, peak: V3;
    let kind = Math.abs(w - d) < 0.9 ? rng.pick(['hip', 'gable', 'hip']) : 'gable';
    const along = w >= d;
    const roll = rng.next(), stoneWall = mat === M.STONE || mat === M.BRICK;
    if (depth === 0 || roll < 0.5) {
      if (stoneWall && roll < 0.13) kind = 'battlement';
      else if (roll < 0.24 && Math.min(w, d) > 3) kind = 'mansard';
      else if (!stoneWall && roll < 0.34) kind = 'gambrel';
      else if (!stoneWall && roll < 0.4) kind = 'garden';
    }
    if (kind === 'battlement') {
      rh = this.battlements(w, d, mat);
      peak = [w / 2 - 0.5, rh, d / 2 - 0.5];
    } else if (kind === 'mansard') {
      rh = this.mansard(w, d, mat, roofMat, vari);
      peak = [0, rh, 0];
    } else if (kind === 'gambrel') {
      const g = () => this.gambrel(along ? w : d, along ? d : w, mat, roofMat, vari);
      rh = 0; if (along) rh = g(); else b.with(([x, yy, z]) => [z, yy, x], () => { rh = g(); });
      peak = [along ? w / 2 : 0, rh, along ? 0 : d / 2];
    } else if (kind === 'garden') {
      rh = this.roofGarden(w, d);
      peak = [-w / 2 + 0.4, rh, -d / 2 + 0.4];
    } else if (kind === 'hip') {
      rh = Math.min(w, d) * steep;
      hip(b, -w / 2, w / 2, -d / 2, d / 2, 0, rh, o, roofMat, vari);
      peak = [0, rh, 0];
      const span = Math.max(w, d), hd = Math.min(w, d) / 2;
      const wear = () => { if (span - 2 * hd > 1.2) roofWear(this, -(span / 2 - hd), span / 2 - hd, hd, o, -(rh * o) / hd, rh, roofMat); };
      if (w >= d) wear(); else b.with(([x, yy, z]) => [z, yy, x], wear);
    } else {
      rh = (along ? d : w) * 0.5 * steep * 1.6;
      const crow = (mat === M.STONE || mat === M.BRICK) && rng.chance(0.45);
      const go = crow ? { endMul: 0.05, barge: false } : {};
      if (along) gableX(b, -w / 2, w / 2, -d / 2, d / 2, 0, rh, o, mat, roofMat, vari, go);
      else gableZ(b, -w / 2, w / 2, -d / 2, d / 2, 0, rh, o, mat, roofMat, vari, go);
      if (crow) {
        const steps = () => crowSteps(b, along ? -w / 2 : -d / 2, along ? w / 2 : d / 2, along ? -d / 2 : -w / 2, along ? d / 2 : w / 2, rh, mat, this.r());
        if (along) steps(); else b.with(([x, yy, z]) => [z, yy, x], steps);
      }
      peak = [along ? w / 2 : 0, rh, along ? 0 : d / 2];
      if (rh > 2 && rng.chance(0.5)) {
        const s = Math.min(0.8, rh * 0.3);
        for (const f of (along ? ['R', 'L'] : ['F', 'K']) as Face[]) b.with(faceXf(f, w, d), () => this.window(0, rh * 0.28, s, s, mat, 2));
      }
      const span = along ? w : d, hd = (along ? d : w) / 2, em = crow ? 0.05 : 0.6;
      const wear = () => roofWear(this, -span / 2 - o * em, span / 2 + o * em, hd, o, -(rh * o) / hd, rh, roofMat);
      if (along) wear(); else b.with(([x, yy, z]) => [z, yy, x], wear);
      this.dormers(w, d, rh, mat, roofMat, along);
    }
    // roof clutter: dovecotes and water cisterns
    if ((kind === 'gable' || kind === 'hip') && rng.chance(0.1)) this.dovecote(rng.range(-w / 4, w / 4), rh * 0.62, kind === 'hip' ? 0 : rng.range(-0.2, 0.2));
    if ((kind === 'gable' || kind === 'hip' || kind === 'garden') && rng.chance(this.style.annexP > 0.4 ? 0.18 : 0.06)) this.cistern(rng.range(-w / 3, w / 3), kind === 'garden' ? 0.2 : rh * 0.5, rng.range(-d / 4, d / 4), kind === 'garden' ? 0 : rh * 0.55);
    // chimneys
    const nc = kind === 'battlement' || kind === 'garden' ? rng.int(0, 1) : rng.int(depth === 0 ? 1 : 0, 2);
    for (let i = 0; i < nc; i++) {
      const cx = rng.range(-w / 2 + 0.6, w / 2 - 0.6), cz = rng.range(-d / 2 + 0.6, d / 2 - 0.6);
      this.chimney(cx, cz, -0.3, rh + rng.range(0.6, 2.4), mat);
    }
    if (kind === 'battlement') this.finial(peak[0], peak[1] - 0.6, peak[2], rng.range(2.2, 3.2));
    else if (kind !== 'garden' && kind !== 'mansard' && (kind === 'hip' || rng.chance(0.4))) this.finial(peak[0] * (kind === 'hip' ? 1 : 0.9), peak[1] - 0.1, peak[2], rng.range(1.2, 2.6));
    else if (kind === 'mansard' && rng.chance(0.6)) this.finial(0, rh - 0.05, 0, rng.range(1.0, 2.0));
    return rh;
  }

  /** Dormers on the front slope of a gable whose ridge runs along x (`along`) or z. */
  dormers(w: number, d: number, rh: number, mat: number, roofMat: number, along: boolean) {
    const { b, rng } = this;
    const span = along ? w : d;
    const half = (along ? d : w) / 2;
    const dh = Math.min(1.35, rh * 0.5);
    if (span <= 3 || rh <= 1.8) return;
    const nd = span > 5 ? rng.int(1, 2) : 1;
    for (let i = 0; i < nd; i++) {
      // dormers sit over a window column when the grid has one there
      let c = -span / 2 + ((i + 0.5) * span) / nd + rng.range(-0.3, 0.3);
      const gr = this.grid;
      if (gr && along) { const cs = gr.px ? gr.sx / 2 : 0; const snap = Math.round((c - cs) / gr.sx) * gr.sx + cs; if (Math.abs(snap) < span / 2 - 0.8) c = snap; }
      const dw = rng.range(0.9, 1.3);
      const front = half - 0.15;
      const make = () => {
        b.begin(mat, this.r());
        box(b, c - dw / 2, -0.2, 0, c + dw / 2, dh, front, { skip: 'B' });
        b.with(([x, y, z]) => [x, y, front + z], () => this.window(c, 0.1, dw * 0.6, dh * 0.6, mat));
        gableZ(b, c - dw / 2, c + dw / 2, 0, front, dh, 0.55, 0.15, mat, roofMat, this.r(), { barge: false });
      };
      if (along) make();
      else b.with(([x, y, z]) => [z, y, -x], make);
    }
  }

  /** Flat top with corbelled, crenellated parapet and a roof hatch. */
  battlements(w: number, d: number, mat: number) {
    const { b, rng } = this;
    b.begin(M.STONE, this.r()); box(b, -w / 2 - 0.25, -0.3, -d / 2 - 0.25, w / 2 + 0.25, 0.0, d / 2 + 0.25);
    b.begin(M.STONE, this.r());
    for (const [sx, sz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) beam(b, [sx * (w / 2 - 0.1), -0.9, sz * (d / 2 - 0.1)], [sx * (w / 2 + 0.15), -0.3, sz * (d / 2 + 0.15)], 0.3);
    b.begin(M.COBBLE, this.r()); box(b, -w / 2, -0.05, -d / 2, w / 2, 0.08, d / 2, { skip: 'B' });
    b.begin(mat, this.r());
    const t = 0.28, ph = 0.55;
    box(b, -w / 2 - 0.25, 0, -d / 2 - 0.25, w / 2 + 0.25, ph, -d / 2 - 0.25 + t);
    box(b, -w / 2 - 0.25, 0, d / 2 + 0.25 - t, w / 2 + 0.25, ph, d / 2 + 0.25);
    box(b, -w / 2 - 0.25, 0, -d / 2 - 0.25, -w / 2 - 0.25 + t, ph, d / 2 + 0.25);
    box(b, w / 2 + 0.25 - t, 0, -d / 2 - 0.25, w / 2 + 0.25, ph, d / 2 + 0.25);
    b.begin(mat, this.r());
    const mer = (x0: number, z0: number, x1: number, z1: number) => {
      const L = Math.hypot(x1 - x0, z1 - z0), n = Math.max(2, Math.round(L / 0.9));
      for (let i = 0; i <= n; i += 2) { const k = i / n; const x = x0 + (x1 - x0) * k, z = z0 + (z1 - z0) * k; box(b, x - 0.2, ph, z - 0.16, x + 0.2, ph + 0.45, z + 0.16); }
    };
    const W = w / 2 + 0.11, D = d / 2 + 0.11;
    mer(-W, -D, W, -D); mer(-W, D, W, D); mer(-W, -D, -W, D); mer(W, -D, W, D);
    if (rng.chance(0.7)) { // stair hatch
      b.begin(mat, this.r()); box(b, -w / 2 + 0.3, 0.05, -d / 2 + 0.3, -w / 2 + 1.4, 1.5, -d / 2 + 1.3, { skip: 'B' });
      b.begin(M.SLATE, this.r()); b.quad([-w / 2 + 0.15, 1.75, -d / 2 + 0.15], [-w / 2 + 1.55, 1.75, -d / 2 + 0.15], [-w / 2 + 1.55, 1.45, -d / 2 + 1.5], [-w / 2 + 0.15, 1.45, -d / 2 + 1.5], [[0, 0], [1.4, 0], [1.4, 1.4], [0, 1.4]]);
      b.with(([x, y, z]) => [x, y, -d / 2 + 1.3 + z], () => this.door(-w / 2 + 0.85, mat, false));
    }
    return 1.0;
  }

  /** Steep lower slopes + low upper hip, with dormers. */
  mansard(w: number, d: number, mat: number, roofMat: number, vari: number) {
    const { b, rng } = this;
    const o = 0.2, ins = 0.6, h1 = 1.7;
    const A: V3 = [-w / 2 - o, -0.1, -d / 2 - o], B2: V3 = [w / 2 + o, -0.1, -d / 2 - o], C: V3 = [w / 2 + o, -0.1, d / 2 + o], D: V3 = [-w / 2 - o, -0.1, d / 2 + o];
    const a: V3 = [-w / 2 + ins, h1, -d / 2 + ins], b2: V3 = [w / 2 - ins, h1, -d / 2 + ins], c: V3 = [w / 2 - ins, h1, d / 2 - ins], dd: V3 = [-w / 2 + ins, h1, d / 2 - ins];
    const sl = Math.hypot(ins + o, h1);
    for (const [p, q, r, s] of [[D, C, c, dd], [B2, A, a, b2], [A, D, dd, a], [C, B2, b2, c]] as V3[][]) {
      b.begin(roofMat, vari);
      const L = Math.hypot(q[0] - p[0], q[2] - p[2]);
      b.quad(p, q, r, s, [[0, 0], [L, 0], [L - ins, sl], [ins, sl]]);
    }
    b.begin(M.TIMBER, this.r()); box(b, -w / 2 + ins - 0.05, h1 - 0.05, -d / 2 + ins - 0.05, w / 2 - ins + 0.05, h1 + 0.1, d / 2 - ins + 0.05);
    const rh2 = 0.7;
    hip(b, -w / 2 + ins, w / 2 - ins, -d / 2 + ins, d / 2 - ins, h1 + 0.1, rh2, 0.08, roofMat === M.TILE ? M.SLATE : roofMat, vari);
    // dormers through the steep slopes, front and back
    const n = Math.max(1, Math.floor(w / 1.7));
    for (const s of [1, -1]) for (let i = 0; i < n; i++) {
      if (rng.chance(0.25)) continue;
      const x = -w / 2 + ((i + 0.5) * w) / n;
      b.with(([px, py, pz]) => [px, py, s * pz], () => {
        b.begin(mat, this.r()); box(b, x - 0.42, 0.15, d / 2 - 0.3, x + 0.42, 1.35, d / 2 + 0.12, { skip: 'B' });
        b.with(([px, py, pz]) => [px, py, d / 2 + 0.12 + pz], () => this.window(x, 0.3, 0.55, 0.8, mat, rng.chance(0.4) ? 1 : 0));
        gableZ(b, x - 0.42, x + 0.42, d / 2 - 0.6, d / 2 + 0.12, 1.35, 0.4, 0.1, mat, roofMat, this.r(), { barge: false });
      });
    }
    return h1 + rh2 + 0.1;
  }

  /** Barn-like two-pitch gambrel roof, ridge along x. */
  gambrel(w: number, d: number, mat: number, roofMat: number, vari: number) {
    const { b, rng } = this;
    const hd = d / 2, rh = d * 0.5 * rng.range(0.95, 1.25), kz = hd * 0.5, ky = rh * 0.62, o = 0.35, eo = 0.35;
    const k = ky / (hd - kz), ye = -k * o;
    const xa = -w / 2 - eo, xb = w / 2 + eo;
    const prof: [number, number][] = [[-hd - o, ye], [-kz, ky], [0, rh], [kz, ky], [hd + o, ye]];
    for (let i = 0; i < 4; i++) {
      const [z0, y0] = prof[i], [z1, y1] = prof[i + 1];
      b.begin(roofMat, vari);
      const sl = Math.hypot(z1 - z0, y1 - y0);
      b.quad([xa, y0, z0], [xb, y0, z0], [xb, y1, z1], [xa, y1, z1], [[0, 0], [xb - xa, 0], [xb - xa, sl], [0, sl]]);
    }
    for (const x of [-w / 2, w / 2]) {
      b.begin(mat, vari);
      const pts: [number, number][] = [[-hd, 0], [-kz, ky], [0, rh], [kz, ky], [hd, 0]];
      for (let i = 0; i < 4; i++) b.tri([x, 0, 0], [x, pts[i][1], pts[i][0]], [x, pts[i + 1][1], pts[i + 1][0]], [0, 0], [pts[i][0], pts[i][1]], [pts[i + 1][0], pts[i + 1][1]]);
      b.with(([a, y, n]) => [x + (x > 0 ? n : -n), y, x > 0 ? -a : a], () => { if (rh > 1.8) this.window(0, ky * 0.55, 0.8, 0.9, mat, rng.chance(0.5) ? 1 : 0); });
    }
    b.begin(M.TIMBER, this.r());
    for (const x of [xa, xb]) for (let i = 0; i < 4; i++) beam(b, [x, prof[i][1], prof[i][0]], [x, prof[i + 1][1], prof[i + 1][0]], 0.12, 0.18);
    return rh;
  }

  /** Flat roof terrace with railing, potted plants and a pergola. */
  roofGarden(w: number, d: number) {
    const { b, rng } = this;
    b.begin(M.TIMBER, this.r()); box(b, -w / 2 - 0.15, -0.1, -d / 2 - 0.15, w / 2 + 0.15, 0.1, d / 2 + 0.15);
    b.begin(M.PLANK, this.r()); box(b, -w / 2, 0.1, -d / 2, w / 2, 0.14, d / 2, { skip: 'B' });
    b.begin(M.IRON, this.r());
    const rail = (x0: number, z0: number, x1: number, z1: number) => {
      beam(b, [x0, 1.0, z0], [x1, 1.0, z1], 0.05);
      const L = Math.hypot(x1 - x0, z1 - z0), n = Math.max(2, Math.round(L / 0.3));
      for (let i = 0; i <= n; i++) { const k = i / n; beam(b, [x0 + (x1 - x0) * k, 0.12, z0 + (z1 - z0) * k], [x0 + (x1 - x0) * k, 1.0, z0 + (z1 - z0) * k], 0.03); }
    };
    const W = w / 2 + 0.05, D = d / 2 + 0.05;
    rail(-W, -D, W, -D); rail(-W, D, W, D); rail(-W, -D, -W, D); rail(W, -D, W, D);
    const pots = rng.int(3, 6);
    for (let i = 0; i < pots; i++) {
      const x = rng.range(-w / 2 + 0.4, w / 2 - 0.4), z = rng.chance(0.5) ? -d / 2 + 0.4 : d / 2 - 0.4;
      b.begin(M.TILE, this.r()); lathe(b, x, 0.12, z, [[0.18, 0], [0.24, 0.35], [0.02, 0.35]], 7);
      b.begin(M.GRASS, rng.range(0.1, 0.4)); lathe(b, x, 0.4, z, [[0.02, 0], [0.32, 0.2], [0.26, 0.5], [0.02, 0.62]], 7);
    }
    if (rng.chance(0.6)) { // pergola
      b.begin(M.TIMBER, this.r());
      const px = w / 2 - 1.6, pz = d / 2 - 1.6;
      for (const [x, z] of [[px, pz], [w / 2 - 0.3, pz], [px, d / 2 - 0.3], [w / 2 - 0.3, d / 2 - 0.3]]) beam(b, [x, 0.12, z], [x, 2.2, z], 0.1);
      for (let z = pz; z <= d / 2 - 0.2; z += 0.35) beam(b, [px - 0.2, 2.25, z], [w / 2 - 0.1, 2.25, z], 0.06);
      b.begin(M.GRASS, 0.2); lathe(b, px, 2.2, pz, [[0.02, 0], [0.5, 0.15], [0.35, 0.45], [0.02, 0.5]], 7);
    }
    return 1.1;
  }

  dovecote(x: number, y: number, z: number) {
    const { b } = this;
    b.begin(M.PLANK, this.r()); box(b, x - 0.4, y, z - 0.35, x + 0.4, y + 0.8, z + 0.35, { skip: 'B' });
    b.begin(M.DOOR, this.r());
    for (const dx of [-0.2, 0.2]) box(b, x + dx - 0.09, y + 0.3, z + 0.34, x + dx + 0.09, y + 0.5, z + 0.37);
    b.begin(M.TIMBER, this.r()); box(b, x - 0.45, y + 0.25, z + 0.35, x + 0.45, y + 0.3, z + 0.55);
    hip(this.b, x - 0.4, x + 0.4, z - 0.35, z + 0.35, y + 0.8, 0.5, 0.1, M.SLATE, this.r());
  }

  cistern(x: number, y: number, z: number, legs: number) {
    const { b } = this;
    b.begin(M.TIMBER, this.r());
    for (const [dx, dz] of [[-0.45, -0.45], [0.45, -0.45], [-0.45, 0.45], [0.45, 0.45]]) beam(b, [x + dx, y - 0.2, z + dz], [x + dx, y + legs + 0.6, z + dz], 0.1);
    box(b, x - 0.6, y + legs + 0.55, z - 0.6, x + 0.6, y + legs + 0.65, z + 0.6);
    b.begin(M.PLANK, this.r()); lathe(b, x, y + legs + 0.65, z, [[0.55, 0], [0.6, 0.55], [0.55, 1.1], [0.05, 1.12]], 10);
    b.begin(M.IRON, this.r()); for (const hy of [0.2, 0.85]) lathe(b, x, y + legs + 0.65 + hy, z, [[0.6, 0], [0.6, 0.06], [0.55, 0.06]], 10);
  }

  turret(blk: BlockRec, topY: number) {
    const { b, rng } = this;
    const sx = rng.chance(0.5) ? 1 : -1, sz = rng.chance(0.5) ? 1 : -1;
    const r = rng.range(0.9, 1.35);
    const cx = sx * (blk.w / 2 - r * 0.35), cz = sz * (blk.d / 2 - r * 0.35);
    const yb = blk.h * rng.range(0.1, 0.5);
    const yt = blk.h + rng.range(1.2, 3.2);
    const mat = rng.pick([M.STONE, M.PLASTER, M.STONE]);
    b.with(blk.xf, () => {
      b.begin(mat, this.r());
      lathe(b, cx, yb - 1.6, cz, [[0.15, 0], [r * 0.6, 0.8], [r, 1.6]], 12);
      b.begin(mat, this.r());
      lathe(b, cx, yb, cz, [[r, 0], [r, yt - yb]], 12);
      b.begin(M.STONE, this.r());
      lathe(b, cx, yt - 0.1, cz, [[r + 0.12, 0], [r + 0.12, 0.25], [r, 0.25]], 12);
      // windows around the drum
      const nw = rng.int(2, 3);
      for (let i = 0; i < nw; i++) {
        const t = Math.atan2(sz, sx) + (i - (nw - 1) / 2) * 0.9;
        const rot: XF = ([a, y, n]) => [cx + (r - 0.05 + n) * Math.cos(t) - a * Math.sin(t), y, cz + (r - 0.05 + n) * Math.sin(t) + a * Math.cos(t)];
        b.with(rot, () => this.window(0, yt - 1.7, 0.5, 0.9, mat));
      }
      // bell / cone roof
      const roofMat = rng.chance(0.6) ? M.COPPER : M.SLATE;
      const rh = r * rng.range(1.6, 2.8);
      b.begin(roofMat, this.r());
      const ro = r + 0.3;
      const shape = rng.next();
      lathe(b, cx, yt + 0.2, cz, shape < 0.4
        ? [[ro, -0.15], [ro * 0.92, rh * 0.2], [ro * 0.7, rh * 0.5], [ro * 0.35, rh * 0.8], [0.05, rh]]
        : shape < 0.75 ? [[ro, -0.15], [ro * 0.5, rh * 0.5], [0.05, rh]]
        : [[ro * 0.8, -0.15], [ro * 1.1, rh * 0.25], [ro * 0.9, rh * 0.48], [ro * 0.35, rh * 0.72], [0.1, rh * 0.86], [0.05, rh]], 12);
      this.finial(cx, yt + 0.2 + rh * 0.95, cz, rng.range(0.8, 2.0));
    });
    this.top = Math.max(this.top, blk.y0 + yt + 3);
    void topY;
  }

  /**
   * Grow a stack of blocks upward from (ox, y, oz). Returns its blocks.
   * Growth mode (opts.blocks): every block is seeded by its index, so adding a
   * block leaves everything below unchanged — only the roof moves up.
   */
  tower(ox: number, oz: number, y: number, w: number, d: number, lx: number, lz: number, topY: number, depth: number,
    opts: { blocks?: number; seed?: number; splitAt?: number; mats?: string } = {}): BlockRec[] {
    const { b, p, style } = this;
    const grow = opts.blocks !== undefined;
    const seed = opts.seed ?? 0;
    if (grow) this.rng = new RNG(hashSeed(seed, 77));
    this.tseed = grow ? seed : Math.floor(this.rng.next() * 1e9);
    this.grid = null; // each tower (and each split-off tower) lays out its own façade grid
    if (depth === 0) {
      const r0 = this.rng;
      const fl = r0.chance(0.2) ? r0.pick(['R', 'L', 'K'] as Face[]) : null;
      this.flue = fl && !this.flush.includes(fl) ? { f: fl, a: r0.range(-0.8, 0.8), mat: r0.pick([M.STONE, M.BRICK]) } : null;
    }
    const blocks: BlockRec[] = [];
    let pw = w, pd = d;
    const leanMax = 0.1 * p.lean;
    let lastMat: number = M.STONE;
    let yaw = depth ? this.rng.range(-0.1, 0.1) : 0;
    let lastRound = false;
    const fX = depth === 0 && /[RL]/.test(this.flush), fZ = depth === 0 && /[FK]/.test(this.flush);
    const w0 = w, d0 = d, ox00 = ox, oz00 = oz;
    while (grow ? blocks.length < opts.blocks! : topY - y > 1.5) {
      if (grow) this.rng = new RNG(hashSeed(seed, blocks.length));
      const rng = this.rng;
      const remaining = grow ? 99 : topY - y;
      const floors = remaining < 5.5 ? 1 : rng.int(1, 2);
      const h = Math.min(floors * rng.range(2.4, 2.9), remaining);
      lx = clamp(lx + rng.range(-1, 1) * 0.04 * p.lean, -leanMax, leanMax);
      lz = clamp(lz + rng.range(-1, 1) * 0.03 * p.lean, -leanMax, leanMax);
      const mc = opts.mats?.[blocks.length];
      const mat = mc === 'S' ? rng.pick([M.STONE, M.STONE, M.BRICK]) : mc === 'T' ? rng.pick([M.PLANK, M.PLASTER, M.PLANK])
        : !grow ? this.wallMat(y, topY)
        : blocks.length === 0 ? rng.pick(style.base)
        : blocks.length >= 2 && rng.chance(0.3) ? rng.pick(style.top) : rng.pick(style.mid);
      lastMat = mat;
      yaw = clamp(yaw + rng.range(-1, 1) * 0.06 * p.lean, -0.14 * p.lean, 0.14 * p.lean);
      // shared walls stay plumb so neighbours don't collide
      if (fX) lx = 0;
      if (fZ) lz = 0;
      if (fX || fZ) yaw = 0;
      const y0 = y, ox0 = ox, oz0 = oz, lx0 = lx, lz0 = lz, cy = Math.cos(yaw), sy = Math.sin(yaw);
      const xf: XF = ([x, yy, z]) => [ox0 + x * cy - z * sy + lx0 * yy, y0 + yy, oz0 + x * sy + z * cy + lz0 * yy];
      const ground = y < this.groundY + 0.1;
      const round = !ground && Math.abs(w - d) < 1.3 && rng.chance(0.13) && !this.flush;
      if (round) {
        const r = (Math.min(w, d) / 2) * 1.05;
        w = d = r * 2;
        b.with(xf, () => this.roundBlock(r, h, floors, mat));
      } else b.with(xf, () => this.block(w, d, h, floors, mat, ground, pw, pd, blocks.length, y0));
      lastRound = round;
      blocks.push({ y0, h, w, d, xf });
      ox += lx * h; oz += lz * h; y += h;
      pw = w; pd = d;
      // the shape of what comes next must not depend on how many details the block drew
      // (those vary with neighbours and condition), so it draws from its own stream
      const rs = grow ? new RNG(hashSeed(seed, 7000 + blocks.length)) : rng;
      if (rs.chance(style.overhangP)) { w += rs.range(0.3, 0.9); d += rs.range(0.2, 0.7); }
      else if (rs.chance(0.45)) { w *= rs.range(0.78, 0.95); d *= rs.range(0.8, 0.97); }
      w = clamp(w, 2.6, 7.2); d = clamp(d, 2.6, 6.5);
      ox += rs.range(-0.45, 0.45) * p.lean; oz += rs.range(-0.35, 0.35) * p.lean;
      if (fX) { w = w0; ox = ox00; }
      if (fZ) { d = d0; oz = oz00; }

      // split into two towers joined by a bridge
      const left = grow ? opts.blocks! - blocks.length : 0;
      const splitNow = grow
        ? depth === 0 && opts.splitAt === blocks.length && left >= 2 && Math.max(w, d) > 4.0 && !this.flush
        : depth === 0 && Math.max(w, d) > 4.2 && topY - y > 9 && rs.chance(0.35);
      if (splitNow) {
        const alongX = w >= d;
        const sw = (alongX ? w : d) / 2 - 0.15;
        const off = sw / 2 + 0.15;
        const topA = topY + rs.range(-3, 4), topB = topY + rs.range(-8, 0);
        const shrink = rs.range(0.75, 1);
        const mk = (s: number, t: number, n: number, sd: number) => {
          const o = grow ? { blocks: n, seed: sd, mats: opts.mats?.slice(blocks.length) } : {};
          return alongX
            ? this.tower(ox + s * off, oz, y, sw, d * shrink, lx + s * 0.02, lz, t, depth + 1, o)
            : this.tower(ox, oz + s * off, y, w * shrink, sw, lx, lz + s * 0.02, t, depth + 1, o);
        };
        const A = mk(-1, topA, left, hashSeed(seed, 101)), B = mk(1, topB, Math.max(1, left - 1), hashSeed(seed, 202));
        const topOf = (bl: BlockRec[]) => { const k = bl[bl.length - 1]; return k.y0 + k.h; };
        const hi = Math.min(topOf(A), topOf(B)) - 1.2;
        if (hi > y + 2) {
          this.rng = new RNG(hashSeed(seed, 303));
          this.bridge(A, B, alongX, y + this.rng.range(2, hi - y));
        }
        return blocks.concat(A, B);
      }
    }
    if (grow) this.rng = new RNG(hashSeed(seed, 999));
    const rng = this.rng;
    const last = blocks[blocks.length - 1];
    if (last) {
      const lx1 = lx, lz1 = lz, oxr = ox, ozr = oz, yr = y, cy = Math.cos(yaw), sy = Math.sin(yaw);
      const rxf: XF = ([x, yy, z]) => [oxr + x * cy - z * sy + lx1 * yy, yr + yy, ozr + x * sy + z * cy + lz1 * yy];
      let rh = 0;
      // terraces: one roofline along the row; eaves raised to meet a slightly taller neighbour
      const terr = depth === 0 && !lastRound && this.ctx.terrace && /[RL]/.test(this.flush) ? this.ctx.terrace : null;
      const knee = terr ? kneeFor(this, y) : 0;
      if (knee > 0) b.with(rxf, () => kneeWall(this, last.w, last.d, knee, lastMat));
      const rxk: XF = knee ? ([x, yy, z]) => rxf([x, yy + knee, z]) : rxf;
      if (!lastRound) b.with(rxk, () => eavesCourse(this, last.w, last.d, lastMat));
      b.with(rxk, () => { rh = this.roof(last.w, last.d, lastMat, depth, lastRound, terr); });
      if (depth === 0 && this.role === 'farm' && !lastRound && !this.flush.includes('F')) b.with(rxk, () => b.with(faceXf('F', last.w, last.d), () => hayloft(this, Math.min(last.y0 + last.h - this.groundY - 1.5, 4.5))));
      if (depth === 0 && this.flue && !lastRound) { // the flue rises past the eaves into a stack with pots
        const fl = this.flue, len = faceLen(fl.f, last.w, last.d), fa = Math.max(-len / 2 + 0.5, Math.min(len / 2 - 0.5, fl.a));
        b.with(rxk, () => b.with(faceXf(fl.f, last.w, last.d), () => {
          b.begin(fl.mat, this.r()); box(b, fa - 0.42, -0.05 - knee, -0.05, fa + 0.42, rh + 1.0, 0.5, { skip: 'K' });
          b.begin(M.STONE, this.r()); box(b, fa - 0.5, rh + 1.0, -0.12, fa + 0.5, rh + 1.15, 0.58);
          b.begin(M.TILE, this.r()); for (const dx of [-0.18, 0.18]) lathe(b, fa + dx, rh + 1.15, 0.22, [[0.13, 0], [0.12, 0.5], [0.15, 0.55], [0.1, 0.6]], 8);
          this.smoke.push(b.xf([fa, rh + 2.0, 0.22]));
        }));
      }
      this.top = Math.max(this.top, y + knee + rh + 2);
      if (blocks.length > 2 && rng.chance(style.craneP) && !lastRound) {
        const f = rng.pick(['F', 'K', 'R', 'L'] as Face[]);
        const drop = rng.range(2, Math.max(2.5, Math.min(8, last.y0 - this.groundY)));
        if (!(depth === 0 && this.flush.includes(f))) b.with(last.xf, () => b.with(faceXf(f, last.w, last.d), () => this.crane(last.h, drop)));
      }
      if (rng.chance(depth === 0 ? 0.55 : 0.3) && blocks.length > 1 && !(depth === 0 && this.flush)) this.turret(blocks[blocks.length - 1], topY);
    }
    return blocks;
  }

  bridge(A: BlockRec[], B: BlockRec[], alongX: boolean, yb: number) {
    const find = (bl: BlockRec[]) => bl.find((k) => yb >= k.y0 && yb < k.y0 + k.h);
    const a = find(A), c = find(B);
    if (!a || !c) return;
    const pa = alongX ? a.xf([a.w / 2, yb - a.y0, 0]) : a.xf([0, yb - a.y0, a.d / 2]);
    const pc = alongX ? c.xf([-c.w / 2, yb - c.y0, 0]) : c.xf([0, yb - c.y0, -c.d / 2]);
    if (Math.hypot(pa[0] - pc[0], pa[2] - pc[2]) < 0.4) return;
    const { b } = this;
    b.begin(M.PLANK, this.r());
    beam(b, pa, pc, 1.1, 0.18);
    b.begin(M.IRON, this.r());
    const dx = pc[0] - pa[0], dz = pc[2] - pa[2], L = Math.hypot(dx, dz);
    const nx = -dz / L * 0.55, nz = dx / L * 0.55;
    for (const s of [-1, 1]) {
      const o = (p: V3, h: number): V3 => [p[0] + nx * s, p[1] + h, p[2] + nz * s];
      beam(b, o(pa, 0.9), o(pc, 0.9), 0.06);
      const np = Math.max(2, Math.round(L / 0.35));
      for (let i = 0; i <= np; i++) {
        const t = i / np;
        const q: V3 = [pa[0] + dx * t, pa[1] + (pc[1] - pa[1]) * t, pa[2] + dz * t];
        beam(b, o(q, 0), o(q, 0.9), 0.04);
      }
    }
  }


  // ------------------------------------------------------------ bridges between anything
  bridgeWorld(pa: V3, pc: V3) {
    const { b } = this;
    const dx = pc[0] - pa[0], dz = pc[2] - pa[2], L = Math.hypot(dx, dz);
    if (L < 0.4) return;
    b.begin(M.PLANK, this.r());
    beam(b, pa, pc, 1.1, 0.18);
    b.begin(M.IRON, this.r());
    const nx = -dz / L * 0.55, nz = dx / L * 0.55;
    for (const s of [-1, 1]) {
      const o = (p: V3, h: number): V3 => [p[0] + nx * s, p[1] + h, p[2] + nz * s];
      beam(b, o(pa, 0.9), o(pc, 0.9), 0.06);
      const np = Math.max(2, Math.round(L / 0.35));
      for (let i = 0; i <= np; i++) {
        const t = i / np;
        const q: V3 = [pa[0] + dx * t, pa[1] + (pc[1] - pa[1]) * t, pa[2] + dz * t];
        beam(b, o(q, 0), o(q, 0.9), 0.04);
      }
    }
    if (L > 5) { // hanging struts from the middle
      b.begin(M.TIMBER, this.r());
      const m: V3 = [(pa[0] + pc[0]) / 2, (pa[1] + pc[1]) / 2, (pa[2] + pc[2]) / 2];
      beam(b, [pa[0], pa[1] - 1.6, pa[2]], m, 0.12);
      beam(b, [pc[0], pc[1] - 1.6, pc[2]], m, 0.12);
    }
  }

  /** Main tower's round plinth with parapet and curling stair. */
  plinth(R: number, base: number, top: number) {
    const { b, rng } = this;
    const h = top - base;
    b.begin(M.STONE, this.r());
    lathe(b, 0, base, 0, [[R + 0.5, 0], [R, h]], 11, 0.2);
    b.begin(M.COBBLE, this.r());
    lathe(b, 0, top, 0, [[R, 0], [0.01, 0]], 11, 0.2);
    b.begin(M.STONE, this.r());
    lathe(b, 0, top, 0, [[R + 0.05, 0], [R + 0.05, 0.45], [R - 0.35, 0.45], [R - 0.35, 0]], 11, 0.2);
    return rng.range(0, Math.PI * 2);
  }
}

const smooth = (a: number, b: number, x: number) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };

export interface Lot {
  x: number; z: number; w: number; d: number; rot: number;
  base: number; top: number; height: number; main: boolean; parent: number;
  rad: number; blocks: BlockRec[]; xf: XF; front: V3;
}

export class Site {
  RI: number; TR: number; sea: number | null; nOff: number;
  constructor(public p: GenParams, public g: Gen) {
    this.RI = 9 + p.count * 2.4;
    this.TR = this.RI * 0.62;
    this.sea = p.terrain === 'island' ? -2 : null;
    this.nOff = (p.seed % 997) * 0.37;
  }

  H(x: number, z: number): number {
    const { RI, nOff, p } = this;
    const s = Math.hypot(x, z) / RI;
    const n = noise3(x * 0.07 + nOff, 1.3, z * 0.07) - 0.5;
    const n2 = noise3(x * 0.25, 4.4, z * 0.25 + nOff) - 0.5;
    let h: number, T: number;
    if (p.terrain === 'island') {
      h = 6 * (1 - s * s) + n * 6 + n2 * 0.8 - smooth(0.78, 1.1, s + n * 0.25) * 12; T = 1.7;
    } else if (p.terrain === 'crag') {
      h = 8 * (1 - 0.8 * s * s) + n * 5 + n2 * 0.8 - smooth(0.72, 1.0, s + n * 0.3) * 18; T = 2.0;
    } else {
      h = 10 * Math.exp(-s * s * 2.4) + n * 4 + n2 * 0.6 - 2; T = 1.3;
    }
    const q = h / T, fq = Math.floor(q);
    return (fq + smooth(0.5, 1.0, q - fq)) * T * 0.75 + h * 0.25;
  }

  span(x: number, z: number, r: number) {
    let lo = Infinity, hi = -Infinity;
    for (let i = 0; i < 9; i++) {
      const a = (i / 8) * Math.PI * 2;
      const rr = i === 8 ? 0 : r;
      const h = this.H(x + Math.cos(a) * rr, z + Math.sin(a) * rr);
      lo = Math.min(lo, h); hi = Math.max(hi, h);
    }
    return [lo, hi];
  }

  makeLot(s: BSpec): Lot {
    const rad = Math.hypot(s.w, s.d) / 2 + (s.main ? 1.8 : 0.9);
    const [lo, hi] = this.span(s.x, s.z, rad);
    const c = Math.cos(s.rot), sn = Math.sin(s.rot);
    return {
      x: s.x, z: s.z, w: s.w, d: s.d, rot: s.rot, base: lo - 1.5, top: hi + (s.main ? 1.2 : 0.35), height: 0, main: s.main,
      parent: -1, rad, blocks: [], front: [s.x, 0, s.z],
      xf: ([x, y, z]) => [s.x + x * c - z * sn, y, s.z + x * sn + z * c],
    };
  }

  /** Can a building of this size stand here? */
  check(x: number, z: number, w: number, d: number, others: BSpec[], main = false): string | null {
    if (Math.hypot(x, z) > this.TR * 1.15) return 'too far from the town';
    const rad = Math.hypot(w, d) / 2 + (main ? 1.8 : 0.9);
    const [lo, hi] = this.span(x, z, rad);
    if (hi - lo > 5.5) return 'too steep';
    if (this.sea !== null && lo < this.sea + 0.6) return 'too close to the water';
    for (const o of others) {
      const orad = Math.hypot(o.w, o.d) / 2 + (o.main ? 1.8 : 0.9);
      if (Math.hypot(o.x - x, o.z - z) < orad + rad + 1.2) return 'too close to another building';
    }
    return null;
  }

  /** Footprint test with rotated rectangles. `partners` may touch; everyone else keeps path room. */
  checkRect(s: { x: number; z: number; w: number; d: number; rot: number; main: boolean; flush?: string }, others: BSpec[], partners: number[] = []): string | null {
    if (Math.hypot(s.x, s.z) > this.TR * 1.15) return 'too far from the town';
    const rad = Math.hypot(s.w, s.d) / 2 + (s.main ? 1.8 : 0.9);
    const [lo, hi] = this.span(s.x, s.z, Math.min(rad, Math.max(s.w, s.d) / 2 + 0.6));
    if (hi - lo > 5.5) return 'too steep';
    if (this.sea !== null && lo < this.sea + 0.6) return 'too close to the water';
    for (const o of others) {
      const touching = partners.includes(o.id);
      const pad = (q: { main: boolean; flush?: string }) => (touching ? -0.04 : q.main && !q.flush ? 2.4 : 1.0);
      if (obbOverlap(s, pad(s), o, pad(o))) return touching ? 'overlaps its neighbour' : 'too close to another building';
    }
    return null;
  }

  /** Facing toward the nearest other building (so doors meet paths). */
  facing(x: number, z: number, others: BSpec[]) {
    let best: BSpec | null = null, bd = Infinity;
    for (const o of others) { const dd = Math.hypot(o.x - x, o.z - z); if (dd < bd) { bd = dd; best = o; } }
    const dx = best ? best.x - x : -x, dz = best ? best.z - z : -z;
    return Math.hypot(dx, dz) > 0.5 ? Math.atan2(-dx, dz) : 0;
  }

  /** A whole generated town as building specs. */
  plan(nextId: () => number): BSpec[] {
    const { g, p, TR } = this;
    const rng = g.rng;
    const dom = STYLES.indexOf(g.style);
    const specs: BSpec[] = [];
    const spec = (x: number, z: number, w: number, d: number, main: boolean, height: number): BSpec => ({
      id: nextId(), seed: Math.floor(rng.next() * 1e9), x, z, w, d, rot: 0, main,
      blocks: Math.max(1, Math.round(height / 4.2)), style: main || rng.chance(0.65) ? dom : rng.int(0, STYLES.length - 1),
      splitAt: rng.chance(0.3) ? rng.int(1, 3) : -1,
      role: main ? 'keep' : 'house', mats: '', tiles: true, braces: 0, born: -Math.floor(rng.range(5, 40)),
    });
    let best: BSpec | null = null, bestScore = -Infinity;
    const w0 = rng.range(3.8, 5.6), d0 = rng.range(3.6, 5.0);
    for (let i = 0; i < 50; i++) {
      const a = rng.range(0, Math.PI * 2), r = Math.sqrt(rng.next()) * TR * 0.35;
      const x = Math.cos(a) * r, z = Math.sin(a) * r;
      const [lo, hi] = this.span(x, z, Math.hypot(w0, d0) / 2 + 1.8);
      const score = hi - (hi - lo) * 0.4;
      if (score > bestScore) { bestScore = score; best = spec(x, z, w0, d0, true, p.height); }
    }
    specs.push(best!);
    for (let tries = 0; tries < 600 && specs.length < p.count; tries++) {
      const a = rng.range(0, Math.PI * 2), r = Math.sqrt(rng.next()) * TR;
      const x = Math.cos(a) * r, z = Math.sin(a) * r;
      const w = rng.range(3.0, 4.8), d = rng.range(3.0, 4.4);
      if (this.check(x, z, w, d, specs)) continue;
      const k = Math.hypot(x - best!.x, z - best!.z) / TR;
      specs.push(spec(x, z, w, d, false, Math.max(6, p.height * rng.range(0.3, 0.75) * (1 - 0.35 * k))));
    }
    const work: Role[] = ['farm', 'wood', 'quarry', 'farm', 'kiln', 'wood'];
    specs.slice(1).forEach((s, i) => { if (i % 2 === 0) s.role = work[(i / 2) % work.length]; });
    for (const s of specs) s.rot = this.facing(s.x, s.z, specs.filter((o) => o !== s)) + rng.range(-0.2, 0.2);
    return specs;
  }

  /** Square-ish stone foundation with front steps down to the terrain. */
  foundation(L: Lot) {
    const { g } = this; const b = g.b;
    const fl = g.flush, m = (f: string) => (fl.includes(f) ? 0.01 : 0.7), c = (f: string) => (fl.includes(f) ? 0 : 0.08);
    const x0 = -L.w / 2 - m('L'), x1 = L.w / 2 + m('R'), z0 = -L.d / 2 - m('K'), z1 = L.d / 2 + m('F');
    b.begin(M.STONE, g.r());
    box(b, x0, L.base, z0, x1, L.top, z1, { skip: 'B' });
    b.begin(M.STONE, g.r());
    box(b, x0 - c('L'), L.top - 0.2, z0 - c('K'), x1 + c('R'), L.top + 0.05, z1 + c('F'));
    const fz = z1;
    const gp = L.xf([0, 0, fz + 0.6]);
    const gy = this.H(gp[0], gp[2]);
    const total = L.top - gy;
    const n = Math.max(0, Math.ceil(total / 0.26));
    b.begin(M.STONE, g.r());
    for (let i = 0; i < n; i++) {
      const yt = L.top - ((i + 1) * total) / n;
      box(b, -0.85, Math.min(gy, yt) - 1, fz + i * 0.32, 0.85, yt, fz + (i + 1) * 0.32, { skip: 'B' });
    }
    L.front = L.xf([0, 0, fz + n * 0.32 + 0.4]);
    L.front[1] = this.H(L.front[0], L.front[2]);
  }

  terrain(tb: Builder) {
    const { RI, p } = this;
    const E = RI * (p.terrain === 'island' ? 1.3 : 1.2);
    const N = 150, cell = (2 * E) / N;
    tb.begin(M.ROCK, 0.5);
    const P = (i: number, j: number): V3 => {
      const x = -E + i * cell + (noise3(i * 0.9, j * 0.9, 2) - 0.5) * cell * 0.5;
      const z = -E + j * cell + (noise3(i * 0.9, j * 0.9, 5) - 0.5) * cell * 0.5;
      return [x, this.H(x, z), z];
    };
    const grid: V3[][] = [];
    for (let i = 0; i <= N; i++) { grid.push([]); for (let j = 0; j <= N; j++) grid[i].push(P(i, j)); }
    for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) {
      const a = grid[i][j], c = grid[i + 1][j], e = grid[i + 1][j + 1], f = grid[i][j + 1];
      if (Math.hypot(a[0], a[2]) > E) continue;
      const tris = (Math.abs(a[1] - e[1]) <= Math.abs(c[1] - f[1]) ? [[a, c, e], [a, e, f]] : [[a, c, f], [c, e, f]]) as V3[][];
      for (const [p0, p1, p2] of tris) {
        const u = [p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]], v = [p2[0] - p0[0], p2[1] - p0[1], p2[2] - p0[2]];
        const n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
        const ny = Math.abs(n[1]) / (Math.hypot(n[0], n[1], n[2]) || 1);
        tb.mat = ny > 0.78 ? M.GRASS : M.ROCK;
        const uv = (q: V3): [number, number] => (ny > 0.7 ? [q[0], q[2]] : [q[0] * 0.7 + q[2] * 0.7, q[1]]);
        tb.tri(p0, p1, p2, uv(p0), uv(p1), uv(p2));
      }
    }
    if (this.sea !== null) {
      tb.begin(M.WATER, 0.5);
      const W = 160, y = this.sea;
      tb.quad([-W, y, -W], [W, y, -W], [W, y, W], [-W, y, W], [[-W, -W], [W, -W], [W, W], [-W, W]]);
    }
  }

  /** Cobbled path that hugs the terrain and turns into steps on steep bits. */
  path(tb: Builder, a: V3, c: V3) {
    const L = Math.hypot(c[0] - a[0], c[2] - a[2]);
    if (L < 0.5) return;
    const n = Math.max(2, Math.ceil(L / 0.55));
    const dx = (c[0] - a[0]) / L, dz = (c[2] - a[2]) / L;
    const pts: V3[] = [];
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      // gentle meander
      const m = Math.sin(t * Math.PI) * (noise3(a[0] + t * 3, 0, a[2]) - 0.5) * 2.5;
      const x = a[0] + (c[0] - a[0]) * t - dz * m, z = a[2] + (c[2] - a[2]) * t + dx * m;
      const y = Math.max(this.H(x, z), this.H(x - dz * 0.6, z + dx * 0.6), this.H(x + dz * 0.6, z - dx * 0.6));
      pts.push([x, y + 0.08, z]);
    }
    tb.begin(M.COBBLE, 0.5);
    for (let i = 0; i < n; i++) {
      const p0 = pts[i], p1 = pts[i + 1];
      const dy = p1[1] - p0[1];
      const seg = Math.hypot(p1[0] - p0[0], p1[2] - p0[2]);
      if (Math.abs(dy) / seg < 0.45) beam(tb, [p0[0], p0[1] - 0.1, p0[2]], [p1[0], p1[1] - 0.1, p1[2]], 1.3, 0.25);
      else {
        const k = Math.ceil(Math.abs(dy) / 0.22);
        tb.begin(M.STONE, 0.4);
        for (let j = 0; j < k; j++) {
          const t0 = j / k, t1 = (j + 1) / k;
          const yy = dy > 0 ? p0[1] + dy * t1 : p0[1] + dy * t0;
          const q0: V3 = [p0[0] + (p1[0] - p0[0]) * t0, yy - 0.3, p0[2] + (p1[2] - p0[2]) * t0];
          const q1: V3 = [p0[0] + (p1[0] - p0[0]) * t1, yy - 0.3, p0[2] + (p1[2] - p0[2]) * t1];
          beam(tb, q0, q1, 1.3, 0.6);
        }
        tb.begin(M.COBBLE, 0.5);
      }
    }
    return pts;
  }

  lamp(b: Builder, x: number, y: number, z: number) {
    b.begin(M.IRON, this.g.r());
    lathe(b, x, y, z, [[0.16, 0], [0.12, 0.4], [0.07, 0.5], [0.06, 3.6], [0.1, 3.7]], 6);
    b.begin(M.GLASS, 0.99);
    lathe(b, x, y + 3.7, z, [[0.15, 0], [0.25, 0.55], [0.0, 0.56]], 6);
    b.begin(M.IRON, this.g.r());
    lathe(b, x, y + 4.25, z, [[0.3, 0], [0.0, 0.3]], 6);
  }

  figure(b: Builder, x: number, y: number, z: number) {
    const g = this.g;
    b.begin(g.rng.pick([M.DOOR, M.TIMBER, M.ACCENT]), g.r());
    lathe(b, x, y, z, [[0.32, 0], [0.26, 0.9], [0.2, 1.35], [0.0, 1.45]], 8);
    b.begin(M.PLASTER, g.r());
    lathe(b, x, y + 1.4, z, [[0.0, 0], [0.13, 0.08], [0.13, 0.25], [0.0, 0.33]], 6);
    if (g.rng.chance(0.6)) {
      b.begin(M.IRON, g.r());
      lathe(b, x, y + 1.62, z, [[0.22, 0], [0.12, 0.02], [0.12, 0.2], [0.0, 0.2]], 8);
    }
  }

  /** Ink + watercolour trees and bushes on open grass, clear of buildings and paths. */
  trees(b: Builder, lots: Lot[], paths: V3[]): Obstacle[] {
    const obs: Obstacle[] = [];
    const rng = new RNG(hashSeed(this.p.seed, 777));
    const n = Math.round(this.RI * this.RI * 0.16 * (Q.low ? 0.6 : 1));
    const placed: [number, number, number][] = [];
    for (let i = 0; i < n; i++) {
      const a = rng.range(0, Math.PI * 2), r = Math.sqrt(rng.next()) * this.RI * 1.02;
      const x = Math.cos(a) * r, z = Math.sin(a) * r;
      const kind = rng.next(), size = rng.range(0.8, 1.35), seed = rng.next();
      const [lo, hi] = this.span(x, z, 1.0);
      if (hi - lo > 1.1) continue;
      if (this.sea !== null && lo < this.sea + 0.7) continue;
      if (this.p.terrain !== 'hilltop' && r > this.RI * 0.85) continue;
      if (lots.some((L) => Math.hypot(L.x - x, L.z - z) < L.rad + 1.6)) continue;
      if (paths.some((q) => Math.abs(q[0] - x) < 1.7 && Math.abs(q[2] - z) < 1.7)) continue;
      if (placed.some(([px, pz, ps]) => Math.hypot(px - x, pz - z) < 1.4 * (ps + size))) continue;
      placed.push([x, z, size]);
      this.tree(b, x, lo, z, kind, size, seed);
      obs.push({ x, z, r: kind < 0.25 ? 0.7 * size : 0.45 * size, kind: kind < 0.25 ? 'bush' : 'tree' });
    }
    return obs;
  }

  /** Is this point water (sea; streams and ponds may extend this)? */
  isWater(x: number, z: number) {
    return this.sea !== null && this.H(x, z) < this.sea + 0.05;
  }

  tree(b: Builder, x: number, y: number, z: number, kind: number, s: number, seed: number) {
    const r = new RNG(Math.floor(seed * 1e9));
    const blob = (cx: number, cy: number, cz: number, rad: number) =>
      lathe(b, cx, cy - rad, cz, [[0.02, 0], [rad * 0.75, rad * 0.3], [rad, rad * 0.95], [rad * 0.8, rad * 1.55], [0.02, rad * 1.9]], 7, r.range(0, 6));
    if (kind < 0.25) { // bush
      b.begin(M.GRASS, r.range(0.05, 0.3));
      for (let i = 0; i < 3; i++) blob(x + r.range(-0.5, 0.5) * s, y + 0.35 * s, z + r.range(-0.5, 0.5) * s, r.range(0.4, 0.6) * s);
      return;
    }
    const lean = r.range(-0.25, 0.25);
    b.begin(M.TIMBER, r.next());
    if (kind < 0.7) { // round broadleaf
      const h = r.range(2.0, 3.0) * s;
      beam(b, [x, y - 0.3, z], [x + lean, y + h, z + lean * 0.5], 0.22 * s, 0.22 * s);
      b.begin(M.GRASS, r.range(0.0, 0.25));
      const k = r.int(3, 5);
      for (let i = 0; i < k; i++) {
        const a = (i / k) * Math.PI * 2 + r.next();
        blob(x + lean + Math.cos(a) * 0.7 * s, y + h + r.range(-0.2, 0.6) * s, z + lean * 0.5 + Math.sin(a) * 0.7 * s, r.range(0.85, 1.15) * s);
      }
      blob(x + lean, y + h + 0.8 * s, z + lean * 0.5, 1.0 * s);
    } else { // conifer
      const h = r.range(3.2, 4.6) * s;
      beam(b, [x, y - 0.3, z], [x, y + 0.9 * s, z], 0.2 * s, 0.2 * s);
      b.begin(M.GRASS, r.range(0.0, 0.15));
      for (let i = 0; i < 3; i++) {
        const y0 = y + 0.6 * s + i * h * 0.25, rad = (1.3 - i * 0.32) * s;
        lathe(b, x, y0, z, [[rad, 0], [rad * 0.45, h * 0.3], [0.02, h * 0.42]], 8, r.range(0, 6));
      }
    }
  }

  /** Moored spots out on the water (island sites). */
  boatSpots(n: number): { x: number; z: number; yaw: number }[] {
    if (this.sea === null) return [];
    const rng = new RNG(hashSeed(this.p.seed, 4242));
    return Array.from({ length: n }, () => {
      const a = rng.range(0, Math.PI * 2);
      let r = this.RI * 0.6;
      while (r < this.RI * 2 && this.H(Math.cos(a) * r, Math.sin(a) * r) > this.sea! - 0.4) r += 0.5;
      r += rng.range(2, 6);
      return { x: Math.cos(a) * r, z: Math.sin(a) * r, yaw: a + rng.range(1.2, 1.9) };
    });
  }

  /** A rowboat, bobbing (time-driven). */
  boatAt(b: Builder, s: { x: number; z: number; yaw: number }, time: number, k: number) {
    const sea = this.sea ?? 0;
    const bob = Math.sin(time * 1.3 + k * 2) * 0.12, roll = Math.sin(time * 1.1 + k) * 0.07, pitch = Math.sin(time * 0.9 + k * 3) * 0.04;
    const c = Math.cos(s.yaw), sn = Math.sin(s.yaw);
    b.with(([x, y, z]) => {
      const y1 = y + z * roll + x * pitch;
      return [s.x + x * c - z * sn, sea + bob + y1, s.z + x * sn + z * c];
    }, () => {
      b.begin(M.PLANK, 0.3 + k * 0.1);
      const sec = 8;
      const S = (i: number) => { const x = -1.6 + (3.2 * i) / sec; const w = 0.65 * Math.sqrt(Math.max(0, 1 - (x / 1.65) ** 2)) + 0.02; return { x, w }; };
      for (let i = 0; i < sec; i++) {
        const A = S(i), B = S(i + 1);
        for (const sd of [-1, 1]) b.quad([A.x, 0.35, sd * A.w], [B.x, 0.35, sd * B.w], [B.x, -0.15, 0], [A.x, -0.15, 0], [[A.x, 0], [B.x, 0], [B.x, 0.6], [A.x, 0.6]]);
      }
      b.begin(M.TIMBER, 0.4);
      beam(b, [-0.6, 0.25, -0.5], [-0.6, 0.25, 0.5], 0.15, 0.06);
      beam(b, [0.4, 0.25, -0.55], [0.4, 0.25, 0.55], 0.15, 0.06);
      beam(b, [0.1, 0.3, 0.2], [-0.9, 0.3, 1.3], 0.05);
    });
  }
}

export interface BSpec {
  id: number; seed: number; x: number; z: number; w: number; d: number; rot: number;
  blocks: number; main: boolean; style: number; splitAt: number;
  role: Role;
  /** wall material per block: 'S' stone, 'T' timber, '?' the style decides */
  mats: string;
  /** roof paid with clay tiles (else wooden shingles) */
  tiles: boolean;
  braces: number;
  /** day the building was founded (ivy grows with age) */
  born?: number;
  /** faces sharing a wall with a neighbour (derived from placement) */
  flush?: string;
}

/** Somewhere a citizen can do something: stand at a workbench, sit on a bench, sweep a doorstep… */
export interface Spot {
  /** building spots: work/drink/stall/fountain/door. ground spots (landscape): well/pier/fence/view/bench/field/shore */
  kind: 'work' | 'drink' | 'stall' | 'fountain' | 'door' | 'well' | 'pier' | 'fence' | 'view' | 'bench' | 'field' | 'shore';
  p: V3; look: V3; tool?: 'axe' | 'hammer' | 'hoe';
}
export interface Built {
  geo: THREE.BufferGeometry; lot: Lot; top: number; smoke: V3[]; flags: V3[]; sails: Sails[]; spots: Spot[];
  /** walk-through passages (closes through the ground floor, stepped alleys to a close neighbour), world space */
  passages: Passage[];
  /** what trade the building plies (signs, shop goods, workshop fittings) */
  trade: Trade;
}

/**
 * Build one building (foundation + tower) into its own geometry.
 * `ctx` (optional, from World): neighbours, terrace and condition tier — see context.ts.
 */
export function buildBuilding(g: Gen, site: Site, s: BSpec, ctx: BuildCtx = NO_CTX): Built {
  g.b = new Builder(1 + s.id * 200_000);
  g.ctx = ctx;
  g.tier = ctx.tier;
  g.trade = tradeOf(s);
  g.passages = [];
  g.closeArch = null;
  g.grid = null;
  g.shopSide = 0;
  g.rng = new RNG(s.seed);
  g.style = STYLES[s.style];
  g.archP = g.style.archP;
  g.usedStair = false;
  g.noTiles = !s.tiles;
  g.top = 0;
  g.smoke = [];
  g.flags = [];
  g.spots = [];
  let sails: Sails[] = [];
  g.flush = s.flush ?? '';
  g.role = s.role;
  g.usedShop = false;
  // a close (arched pend) through the middle of some terrace houses, front to back
  g.close = (s.role === 'house' || s.role === 'inn') && !s.main && /[RL]/.test(g.flush) && !/[FK]/.test(g.flush) && s.w >= 3.2
    && new RNG(hashSeed(s.seed, 0xc105e)).chance(0.5);
  const L = site.makeLot(s);
  g.groundY = L.top;
  g.b.with(L.xf, () => {
    if (s.main && !g.flush) { // free-standing keep: round plinth with a curling stair
      g.plinth(L.rad, L.base, L.top);
      const steps = Math.ceil((L.top - L.base - 1.5) / 0.25);
      g.b.begin(M.STONE, g.r());
      for (let i = 0; i < steps; i++) {
        const t = Math.PI / 2 - 0.35 - i * 0.075;
        const rot: XF = ([x, y, z]) => [Math.cos(t) * (L.rad + 0.75 + x) - Math.sin(t) * z, y, Math.sin(t) * (L.rad + 0.75 + x) + Math.cos(t) * z];
        g.b.with(rot, () => box(g.b, -0.7, L.base, -0.35, 0.7, L.top - i * 0.25, 0.35));
      }
      const t = Math.PI / 2 - 0.35 - steps * 0.075 - 0.1;
      L.front = L.xf([Math.cos(t) * (L.rad + 1.2), 0, Math.sin(t) * (L.rad + 1.2)]);
      L.front[1] = site.H(L.front[0], L.front[2]);
    } else site.foundation(L);
    g.spots.push({ kind: 'door', p: [...L.front] as V3, look: [L.x, L.front[1], L.z] });
    if (BESPOKE.includes(s.role)) {
      const out = landmark(g, L, s.role);
      L.blocks = out.blocks; sails = out.sails;
      g.top = Math.max(g.top, ...L.blocks.map((k) => k.y0 + k.h + 6));
    } else L.blocks = g.tower(0, 0, L.top, s.w, s.d, 0, 0, Infinity, 0, { blocks: s.blocks, seed: s.seed, splitAt: s.splitAt, mats: s.mats });
    g.rng = new RNG(hashSeed(s.seed, 5000));
    if (g.closeArch && L.blocks.length) { // the close runs through: steps down at the back, recorded for walkers
      const back = backSteps(g, site, L), y = L.top + 0.03;
      g.passages.push({ kind: 'close', width: g.closeArch.w, ids: [s.id],
        pts: [[...L.front] as V3, L.xf([0, y, L.d / 2 + 0.6]), L.xf([0, y, -L.d / 2 - 0.6]), back] });
    }
    if (!BESPOKE.includes(s.role)) {
      const myTop = L.blocks.reduce((m, k) => Math.max(m, k.y0 + k.h), L.top);
      for (const nb of ctx.near) if (s.id < nb.id) { const pa = alley(g, site, L, nb, myTop, [s.id, nb.id]); if (pa) g.passages.push(pa); }
      if (!s.main) dressTrade(g, site, L, g.trade, ctx.near.map((n) => n.face).join(''));
    }
    if (!s.main && !BESPOKE.includes(s.role)) roleProps(g, site, L, s.role);
    const free = (['R', 'L', 'K', 'F'] as const).filter((f) => !g.flush.includes(f));
    for (let i = 0; i < Math.min(s.braces, free.length); i++) brace(g, site, L, free[i]);
  });
  const wonk = g.p.wonk, k = 0.16;
  const warp = ([x, y, z]: V3): V3 => [
    x + (noise3(x * k, y * k, z * k) - 0.5) * wonk * 0.9,
    y + (noise3(x * k + 9, y * k, z * k) - 0.5) * wonk * 0.3,
    z + (noise3(x * k, y * k + 17, z * k) - 0.5) * wonk * 0.9,
  ];
  g.b.warp(warp);
  const last = L.blocks.reduce((m, b) => Math.max(m, b.y0 + b.h), L.top);
  const smokey = s.role === 'house' || s.role === 'keep' || s.role === 'kiln';
  return { geo: g.b.build(), lot: L, top: Math.max(g.top, last), smoke: smokey || s.role === 'inn' ? g.smoke.map(warp) : [], flags: g.flags.map(warp), sails,
    spots: g.spots.map((sp) => ({ ...sp, p: sp.kind === 'door' ? sp.p : warp(sp.p), look: warp(sp.look) })),
    passages: g.passages, trade: g.trade };
}

export function buildTerrain(site: Site): THREE.BufferGeometry {
  const tb = new Builder(900_000_000);
  site.terrain(tb);
  return tb.build();
}

/** Paths (MST from the main building), lamps, people, boat and high bridges. */
export interface NavEdge { a: number; b: number; pts: V3[] }
/** Something citizens must walk around (trees, lamps, rocks, walls, props…). Circle in plan view. */
export interface Obstacle { x: number; z: number; r: number; kind: string }
export interface GroundOut { open: V3[]; lamps: V3[]; obstacles: Obstacle[]; spots: Spot[] }
export function buildGround(g: Gen, site: Site, lots: Lot[], bridges: [Lot, Lot][], seed: number, people = -1, nav: NavEdge[] = [], out: GroundOut = { open: [], lamps: [], obstacles: [], spots: [] }): THREE.BufferGeometry {
  const tb = new Builder(800_000_000);
  g.rng = new RNG(hashSeed(seed, lots.length));
  const rng = g.rng;
  const root = Math.max(0, lots.findIndex((l) => l.main));
  const inTree = lots.length ? [root] : [];
  for (const l of lots) l.parent = -1;
  while (inTree.length < lots.length) {
    let bi = -1, bj = -1, bd = Infinity;
    for (const i of inTree) for (let j = 0; j < lots.length; j++) {
      if (inTree.includes(j)) continue;
      const dd = Math.hypot(lots[i].x - lots[j].x, lots[i].z - lots[j].z) + Math.abs(lots[i].top - lots[j].top) * 1.5;
      if (dd < bd) { bd = dd; bi = i; bj = j; }
    }
    lots[bj].parent = bi; inTree.push(bj);
  }
  const pathPts: V3[] = [];
  for (const L of lots) {
    if (L.parent < 0) continue;
    const P = lots[L.parent];
    const dx = L.front[0] - P.x, dz = L.front[2] - P.z, dl = Math.hypot(dx, dz) || 1;
    void dl;
    const end: V3 = P.front; // paths meet at doors so walkers can chain them
    const pts = site.path(tb, L.front, end);
    if (pts) nav.push({ a: lots.indexOf(L), b: L.parent, pts });
    if (pts) pathPts.push(...pts);
  }
  // open grass beside the paths, where people can sit, lie about or play
  for (let i = 3; i < pathPts.length; i += 9) {
    const q = pathPts[i], nb = pathPts[Math.min(pathPts.length - 1, i + 1)];
    const dx = nb[0] - q[0], dz = nb[2] - q[2], dl = Math.hypot(dx, dz) || 1;
    const side = i % 18 < 9 ? 1 : -1, off = 2.4 + (i % 5) * 0.4;
    const x = q[0] - (dz / dl) * off * side, z = q[2] + (dx / dl) * off * side;
    const [lo, hi] = site.span(x, z, 1.2);
    if (hi - lo > 0.6 || (site.sea !== null && lo < site.sea + 0.6)) continue;
    if (lots.some((L) => Math.hypot(L.x - x, L.z - z) < L.rad + 1.8)) continue;
    if (out.open.some((o) => Math.hypot(o[0] - x, o[2] - z) < 3)) continue;
    out.open.push([x, site.H(x, z), z]);
  }
  for (const t of site.trees(tb, lots, [...pathPts, ...out.open])) out.obstacles.push(t);
  for (let i = 6; i < pathPts.length; i += 14) {
    const q = pathPts[i], side = i % 28 < 14 ? 1 : -1;
    const x = q[0] + side * 1.1, z = q[2] + side * 0.4;
    site.lamp(tb, x, site.H(x, z), z);
    out.lamps.push([x, site.H(x, z), z]);
    out.obstacles.push({ x, z, r: 0.35, kind: 'lamp' });
  }
  const nf = Math.min(pathPts.length, people >= 0 ? people : Math.ceil(lots.length / 2));
  for (let i = 0; i < nf; i++) {
    const q = pathPts[Math.floor(rng.next() * pathPts.length)];
    if (q) site.figure(tb, q[0] + rng.range(-0.3, 0.3), q[1] - 0.05, q[2] + rng.range(-0.3, 0.3));
  }
  // bridges
  const ob = g.b;
  g.b = tb;
  for (const [A, B] of bridges) {
    const pts = bridgePoints(A, B);
    if (pts) g.bridgeWorld(pts[0], pts[1]);
  }
  g.b = ob;
  return tb.build();
}

/** Where a high bridge between two lots attaches, or null if they share no usable height. */
export function bridgePoints(A: Lot, B: Lot): [V3, V3] | null {
  const topOf = (L: Lot) => L.blocks.reduce((m, b) => Math.max(m, b.y0 + b.h), L.top);
  const yb = Math.min(topOf(A), topOf(B)) - 1.4;
  if (yb < Math.max(A.top, B.top) + 2.5) return null;
  const ba = A.blocks.find((k) => yb >= k.y0 && yb < k.y0 + k.h), bb = B.blocks.find((k) => yb >= k.y0 && yb < k.y0 + k.h);
  if (!ba || !bb) return null;
  const ca = A.xf(ba.xf([0, yb - ba.y0, 0])), cb = B.xf(bb.xf([0, yb - bb.y0, 0]));
  const dx = cb[0] - ca[0], dz = cb[2] - ca[2], dl = Math.hypot(dx, dz);
  const ra = wallDist(A, ba, yb, dx / dl, dz / dl) - 0.05, rb = wallDist(B, bb, yb, -dx / dl, -dz / dl) - 0.05;
  if (dl - ra - rb < 1.0 || dl > 20) return null;
  return [[ca[0] + (dx / dl) * ra, yb, ca[2] + (dz / dl) * ra], [cb[0] - (dx / dl) * rb, yb, cb[2] - (dz / dl) * rb]];
}

/** Distance from a block's centre to its wall along a horizontal world direction. */
export function wallDist(L: Lot, k: BlockRec, y: number, dx: number, dz: number) {
  const o = L.xf(k.xf([0, y - k.y0, 0])), ax = L.xf(k.xf([1, y - k.y0, 0])), az = L.xf(k.xf([0, y - k.y0, 1]));
  const ux = [ax[0] - o[0], ax[2] - o[2]], uz = [az[0] - o[0], az[2] - o[2]];
  const lx = Math.abs(dx * ux[0] + dz * ux[1]), lz = Math.abs(dx * uz[0] + dz * uz[1]);
  return Math.min(lx > 1e-4 ? k.w / 2 / lx : Infinity, lz > 1e-4 ? k.d / 2 / lz : Infinity);
}

const groundAt = (site: Site, L: Lot, x: number, z: number) => { const q = L.xf([x, 0, z]); return site.H(q[0], q[2]); };

/** Little yards that say what a building does. Lot-local coordinates. */
function roleProps(g: Gen, site: Site, L: Lot, role: Role) {
  const b = g.b, rng = g.rng;
  let side = rng.chance(0.5) ? 1 : -1;
  if (g.flush.includes('R') && g.flush.includes('L')) return;
  if (g.flush.includes('R')) side = -1;
  if (g.flush.includes('L')) side = 1;
  const x0 = side * ((L.w + 1.4) / 2 + 1.3), z0 = rng.range(-0.5, 1.2);
  const y0 = groundAt(site, L, x0, z0);
  if (role === 'inn') { innYard(g, x0, y0, z0, side); return; }
  const spot = (kind: Spot['kind'], x: number, z: number, lx: number, lz: number, tool?: Spot['tool']) =>
    g.spots.push({ kind, p: b.xf([x, groundAt(site, L, x, z), z]), look: b.xf([lx, groundAt(site, L, x, z), lz]), tool });
  if (role === 'wood') spot('work', x0 + side * 0.05, z0 + 1.6, x0 + side * 1.0, z0 + 1.6, 'axe');
  if (role === 'quarry') spot('work', x0, z0 - 1.15, x0, z0, 'hammer');
  if (role === 'farm') spot('work', x0, z0 - 2.0, x0, z0, 'hoe');
  if (role === 'kiln') spot('work', x0 - side * 1.6, z0, x0, z0);
  if (role === 'wood') { // log pile + chopping block
    for (let r = 0; r < 3; r++) for (let i = 0; i < 3 - r; i++) {
      b.begin(M.TIMBER, g.r());
      const z = z0 - 0.8 + i * 0.55 + r * 0.27, y = y0 + 0.25 + r * 0.45;
      beam(b, [x0 - 1.1, y, z], [x0 + 1.1, y, z], 0.42);
    }
    b.begin(M.PLANK, g.r());
    lathe(b, x0 + side * 1.0, y0, z0 + 1.6, [[0.35, 0], [0.35, 0.55], [0.0, 0.55]], 8);
    b.begin(M.IRON, g.r());
    beam(b, [x0 + side * 1.0, y0 + 0.55, z0 + 1.6], [x0 + side * 1.0 + 0.3, y0 + 1.2, z0 + 1.8], 0.05);
  } else if (role === 'quarry') { // stacked dressed stone
    for (let i = 0; i < 6; i++) {
      b.begin(M.STONE, g.r());
      const x = x0 + (i % 3) * 0.75 - 0.75, y = y0 + Math.floor(i / 3) * 0.5, z = z0 + (i % 2) * 0.1;
      box(b, x - 0.35, y - 0.3, z - 0.45, x + 0.35, y + 0.2, z + 0.45);
    }
    b.begin(M.PLANK, g.r());
    box(b, x0 - 0.7, y0 - 0.1, z0 + 1.2, x0 + 0.7, y0 + 0.5, z0 + 2.2, { skip: 'T' });
    b.begin(M.TIMBER, g.r());
    for (const s of [-1, 1]) lathe(b, x0 + s * 0.75, y0 + 0.3, z0 + 1.7, [[0.3, -0.06], [0.3, 0.06], [0, 0.06]], 8);
  } else if (role === 'kiln') { // squat brick kiln with a tall flue + tile stacks
    b.begin(M.BRICK, g.r());
    lathe(b, x0, y0 - 0.3, z0, [[1.0, 0], [1.0, 1.4], [0.6, 2.1], [0.35, 2.2]], 10);
    b.begin(M.BRICK, g.r());
    lathe(b, x0, y0 + 2.0, z0, [[0.35, 0], [0.3, 2.8], [0.4, 2.9], [0.4, 3.1], [0.2, 3.1]], 8);
    g.smoke.push(b.xf([x0, y0 + 5.4, z0]), b.xf([x0, y0 + 5.4, z0]));
    for (let i = 0; i < 3; i++) {
      b.begin(M.TILE, g.r());
      const z = z0 + 1.6 + i * 0.6;
      box(b, x0 - 0.4, y0 - 0.2, z - 0.22, x0 + 0.4, y0 + 0.35 + (i % 2) * 0.2, z + 0.22);
    }
  } else if (role === 'farm') { // garden beds with a fence
    for (let i = 0; i < 2; i++) {
      b.begin(M.TIMBER, g.r());
      const x = x0 + (i ? 1 : -1) * 0.75 * side;
      box(b, x - 0.6, y0 - 0.3, z0 - 1.5, x + 0.6, y0 + 0.2, z0 + 1.5, { skip: 'B' });
      b.begin(M.GRASS, g.r());
      for (let k = 0; k < 5; k++) lathe(b, x, y0 + 0.2, z0 - 1.2 + k * 0.6, [[0.35, 0], [0.3, 0.2], [0, 0.42 + rng.range(0, 0.2)]], 6);
    }
    b.begin(M.TIMBER, g.r());
    const fx = x0 + side * 1.6;
    for (let k = 0; k <= 4; k++) beam(b, [fx, y0 - 0.2, z0 - 1.8 + k * 0.9], [fx, y0 + 0.8, z0 - 1.8 + k * 0.9], 0.08);
    beam(b, [fx, y0 + 0.65, z0 - 1.8], [fx, y0 + 0.65, z0 + 1.8], 0.05);
    b.begin(M.PLASTER, g.r());
    lathe(b, x0 - side * 0.2, y0, z0 + 2.4, [[0.5, 0], [0.55, 0.4], [0.35, 0.8], [0, 0.9]], 8);
  }
}

/** Heavy timber props leaning against the tower — each one adds stability. */
function brace(g: Gen, site: Site, L: Lot, face: 'R' | 'L' | 'K' | 'F') {
  const b = g.b;
  const top = L.blocks.reduce((m, k) => Math.max(m, k.y0 + k.h), L.top);
  const yt = L.top + Math.min((top - L.top) * 0.5, 11);
  const k = L.blocks.find((q) => yt >= q.y0 && yt < q.y0 + q.h) ?? L.blocks[0];
  if (!k) return;
  const n: [number, number] = face === 'R' ? [1, 0] : face === 'L' ? [-1, 0] : face === 'K' ? [0, -1] : [0, 1];
  const t: [number, number] = [-n[1], n[0]];
  const half = face === 'R' || face === 'L' ? k.w / 2 : k.d / 2;
  const reach = (face === 'R' || face === 'L' ? L.w : L.d) / 2 + 0.7 + Math.min(5, (yt - L.top) * 0.4);
  for (const s of [-0.7, 0.7]) {
    const top3 = k.xf([n[0] * half + t[0] * s, yt - k.y0, n[1] * half + t[1] * s]);
    const fx = n[0] * reach + t[0] * s, fz = n[1] * reach + t[1] * s;
    const fy = groundAt(site, L, fx, fz);
    b.begin(M.TIMBER, g.r());
    beam(b, [fx, fy - 0.4, fz], top3, 0.32);
    b.begin(M.STONE, g.r());
    box(b, fx - 0.45, fy - 0.5, fz - 0.45, fx + 0.45, fy + 0.25, fz + 0.45);
  }
  // cross ties
  b.begin(M.TIMBER, g.r());
  for (const f of [0.35, 0.7]) {
    const p = (s: number): V3 => {
      const tp = k.xf([n[0] * half + t[0] * s, yt - k.y0, n[1] * half + t[1] * s]);
      const fx = n[0] * reach + t[0] * s, fz = n[1] * reach + t[1] * s, fy = groundAt(site, L, fx, fz) - 0.4;
      return [fx + (tp[0] - fx) * f, fy + (tp[1] - fy) * f, fz + (tp[2] - fz) * f];
    };
    beam(b, p(-0.7), p(0.7), 0.12);
  }
}

type Rect = { x: number; z: number; w: number; d: number; rot: number };
/** Separating-axis test for two rotated rectangles, each grown by its pad. */
export function obbOverlap(a: Rect, pa: number, b: Rect, pb: number) {
  const axes = (r: Rect): [number, number][] => [[Math.cos(r.rot), Math.sin(r.rot)], [-Math.sin(r.rot), Math.cos(r.rot)]];
  const corners = (r: Rect, p: number) => {
    const [ax, az] = axes(r), hw = r.w / 2 + p, hd = r.d / 2 + p;
    return [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([i, j]) => [r.x + ax[0] * hw * i + az[0] * hd * j, r.z + ax[1] * hw * i + az[1] * hd * j]);
  };
  const ca = corners(a, pa), cb = corners(b, pb);
  for (const [ux, uz] of [...axes(a), ...axes(b)]) {
    const pr = (cs: number[][]) => cs.map(([x, z]) => x * ux + z * uz);
    const A = pr(ca), B = pr(cb);
    if (Math.max(...A) <= Math.min(...B) || Math.max(...B) <= Math.min(...A)) return false;
  }
  return true;
}

/** Scaffolding around a block under construction (world space). */
export function buildScaffold(L: Lot, k: BlockRec, flush: string): THREE.BufferGeometry {
  const b = new Builder(950_000_000 + Math.floor(Math.random() * 1e6) * 64);
  b.with(L.xf, () => b.with(([x, y, z]) => k.xf([x, y - k.y0, z]), () => {
    const y0 = k.y0 - 0.3, y1 = k.y0 + k.h + 1.1, o = 0.55;
    for (const f of ['F', 'K', 'R', 'L'] as const) {
      if (flush.includes(f)) continue;
      const len = f === 'F' || f === 'K' ? k.w : k.d, half = f === 'F' || f === 'K' ? k.d / 2 : k.w / 2;
      const P = (a: number, y: number, n: number): V3 => (f === 'F' ? [a, y, half + n] : f === 'K' ? [-a, y, -half - n] : f === 'R' ? [half + n, y, -a] : [-half - n, y, a]);
      const np = Math.max(2, Math.round(len / 1.6));
      b.begin(M.TIMBER, 0.4);
      for (let i = 0; i <= np; i++) { const a = -len / 2 - 0.2 + (i * (len + 0.4)) / np; beam(b, P(a, y0, o), P(a, y1, o), 0.08); }
      for (let y = y0 + 1.25; y < y1; y += 1.25) {
        b.begin(M.TIMBER, 0.45);
        beam(b, P(-len / 2 - 0.2, y + 0.9, o), P(len / 2 + 0.2, y + 0.9, o), 0.05);
        b.begin(M.PLANK, 0.5);
        const q0 = P(-len / 2 - 0.2, y, 0.05), q1 = P(len / 2 + 0.2, y, o + 0.05);
        box(b, Math.min(q0[0], q1[0]), y - 0.05, Math.min(q0[2], q1[2]), Math.max(q0[0], q1[0]), y + 0.04, Math.max(q0[2], q1[2]));
      }
      b.begin(M.TIMBER, 0.42);
      beam(b, P(-len / 2, y0 + 0.2, o), P(len / 2, y1 - 0.4, o), 0.06);
    }
  }));
  return b.build();
}
