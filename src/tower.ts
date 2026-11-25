import * as THREE from 'three';
import { Builder, M, V3, XF, beam, box, gableX, gableZ, hip, lathe } from './builder';
import { RNG, noise3 } from './rng';

export type Terrain = 'island' | 'crag' | 'hilltop';
export interface GenParams { seed: number; height: number; lean: number; wonk: number; terrain: Terrain; count: number }
export interface GenResult { geo: THREE.BufferGeometry; top: number; extent: number; seaLevel: number | null; buildings: number }

interface Style {
  archP: number; craneP: number;
  base: number[]; mid: number[]; top: number[]; roofs: number[];
  halfTimber: number; shutters: boolean; annexP: number; overhangP: number; annexMats: number[];
  winW: number; winH: number;
}
const S = M;
const STYLES: Style[] = [
  { archP: 0.3, craneP: 0.1, base: [S.STONE], mid: [S.STONE, S.PLASTER, S.STONE], top: [S.PLASTER, S.STONE], roofs: [S.SLATE, S.SLATE, S.COPPER],
    halfTimber: 0.1, shutters: false, annexP: 0.2, overhangP: 0.25, annexMats: [S.STONE, S.PLASTER], winW: 0.75, winH: 1.3 },
  { archP: 0.05, craneP: 0.45, base: [S.STONE, S.PLANK], mid: [S.PLANK, S.PLASTER, S.PLANK], top: [S.PLANK, S.PLASTER], roofs: [S.TILE, S.TILE, S.SLATE],
    halfTimber: 0.2, shutters: false, annexP: 0.55, overhangP: 0.5, annexMats: [S.PLANK, S.PLASTER], winW: 0.7, winH: 1.0 },
  { archP: 0.2, craneP: 0.2, base: [S.STONE], mid: [S.BRICK, S.PLASTER, S.PLANK, S.STONE], top: [S.PLASTER, S.BRICK, S.PLANK], roofs: [S.SLATE, S.TILE],
    halfTimber: 0.6, shutters: true, annexP: 0.35, overhangP: 0.4, annexMats: [S.PLASTER, S.PLANK], winW: 0.7, winH: 1.15 },
];

export interface BlockRec { y0: number; h: number; w: number; d: number; xf: XF }

type Face = 'F' | 'K' | 'R' | 'L';
/** Face-local frame: a = along the face (left→right seen from outside), y = up, n = outward. */
function faceXf(f: Face, w: number, d: number): XF {
  switch (f) {
    case 'F': return ([a, y, n]) => [a, y, d / 2 + n];
    case 'K': return ([a, y, n]) => [-a, y, -d / 2 - n];
    case 'R': return ([a, y, n]) => [w / 2 + n, y, -a];
    case 'L': return ([a, y, n]) => [-w / 2 - n, y, a];
  }
}
const faceLen = (f: Face, w: number, d: number) => (f === 'F' || f === 'K' ? w : d);
const clamp = (x: number, a: number, b: number) => Math.max(a, Math.min(b, x));

class Gen {
  b = new Builder();
  rng: RNG;
  style: Style;
  top = 0;
  archP = 0.15;
  usedStair = false;
  groundY = 0;
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
    const cw = rng.range(0.6, 1.1), cd = rng.range(0.6, 0.9);
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
    }
  }

  finial(x: number, y: number, z: number, tall: number) {
    const { b } = this;
    b.begin(M.IRON, this.r());
    lathe(b, x, y, z, [[0.07, 0], [0.04, tall * 0.5], [0.12, tall * 0.55], [0.1, tall * 0.62], [0.03, tall * 0.65], [0.0, tall]], 6);
    if (this.rng.chance(0.35)) {
      // pennant
      b.begin(M.ACCENT, this.r());
      const L = 1.6, yt = y + tall * 0.95;
      const seg = 6;
      for (let i = 0; i < seg; i++) {
        const t0 = i / seg, t1 = (i + 1) / seg;
        const P = (t: number, s: number): V3 => [x + t * L, yt - s * 0.35 * (1 - t) - t * 0.25, z + Math.sin(t * 5) * 0.25];
        b.quad(P(t0, -0.5), P(t1, -0.5), P(t1, 0.5), P(t0, 0.5), [[t0, 0], [t1, 0], [t1, 1], [t0, 1]]);
      }
    }
  }

  // ------------------------------------------------------------ building pieces
  wallMat(y: number, topY: number) {
    const st = this.style;
    if (y < this.groundY + 3) return this.rng.pick(st.base);
    if (y > topY - 6) return this.rng.pick(st.top);
    return this.rng.pick(st.mid);
  }

  /** One storey-block in block-local coords (centered in x/z, y from 0). */
  block(w: number, d: number, h: number, floors: number, mat: number, ground: boolean, pw: number, pd: number) {
    const { b, rng, style } = this;
    const vari = this.r();
    b.begin(mat, vari);
    box(b, -w / 2, 0, -d / 2, w / 2, h, d / 2, { skip: 'B' });

    if (!ground && rng.chance(0.55)) {
      b.begin(mat === M.PLANK || mat === M.PLASTER ? M.TIMBER : M.STONE, this.r());
      box(b, -w / 2 - 0.1, -0.05, -d / 2 - 0.1, w / 2 + 0.1, 0.22, d / 2 + 0.1);
    }

    const ht = mat === M.PLASTER && rng.chance(style.halfTimber);
    const fh = h / floors;
    for (const f of ['F', 'K', 'R', 'L'] as Face[]) {
      const len = faceLen(f, w, d);
      b.with(faceXf(f, w, d), () => {
        if (ht) this.halfTimber(len, h, floors);
        const ww = style.winW * rng.range(0.85, 1.15), wh = style.winH * rng.range(0.85, 1.15);
        const n = Math.max(1, Math.floor(len / (ww * 2.3)));
        const balconyFloor = !ground && f === 'F' && rng.chance(0.18) ? rng.int(0, floors - 1) : -1;
        for (let fl = 0; fl < floors; fl++) {
          for (let i = 0; i < n; i++) {
            const a = -len / 2 + ((i + 0.5) * len) / n + rng.range(-0.15, 0.15);
            if (ground && fl === 0 && f === 'F' && i === Math.floor(n / 2)) { this.door(a, mat); continue; }
            if (rng.chance(f === 'F' ? 0.15 : 0.35)) continue;
            this.window(a, fl * fh + fh * 0.32, ww, Math.min(wh, fh * 0.55), mat);
          }
          if (fl === balconyFloor) this.balcony(0, fl * fh + 0.05, Math.min(len - 0.4, rng.range(1.6, 2.6)));
        }
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
        if (ground && mat === M.STONE && rng.chance(0.3)) for (const s of [-1, 1]) this.buttress(s * (len / 2 - 0.35), h);
        if (ground && !this.usedStair && floors >= 2 && (f === 'R' || f === 'L') && rng.chance(0.35)) this.usedStair = this.outsideStair(len, fh, mat);
        else if (ground && rng.chance(0.06)) this.scaffold(len, h);
        if (!ground && rng.chance(0.12) && len > 2.6) this.oriel(rng.range(-len / 2 + 0.9, len / 2 - 0.9), rng.int(0, floors - 1) * fh + 0.35, fh, mat);
        // annex
        if (rng.chance(style.annexP * (f === 'F' ? 0.5 : 1))) this.annex(len, h, ground);
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

  roof(w: number, d: number, mat: number, depth: number, round = false) {
    const { b, rng, style } = this;
    const roofMat = rng.pick(style.roofs);
    const vari = this.r();
    if (round) {
      const r = w / 2 + 0.35, rh = r * rng.range(1.3, 2.2);
      b.begin(roofMat, vari);
      lathe(b, 0, -0.15, 0, rng.chance(0.5)
        ? [[r, 0], [r * 0.5, rh * 0.5], [0.05, rh]]
        : [[r, 0], [r * 0.9, rh * 0.25], [r * 0.6, rh * 0.55], [0.05, rh]], 14);
      this.finial(0, rh - 0.3, 0, rng.range(1, 2.4));
      return rh;
    }
    const steep = rng.range(0.6, 1.1);
    const o = rng.range(0.4, 0.75);
    let rh: number, peak: V3;
    const kind = Math.abs(w - d) < 0.9 ? rng.pick(['hip', 'gable', 'hip']) : 'gable';
    const along = w >= d;
    if (kind === 'hip') {
      rh = Math.min(w, d) * steep;
      hip(b, -w / 2, w / 2, -d / 2, d / 2, 0, rh, o, roofMat, vari);
      peak = [0, rh, 0];
    } else {
      rh = (along ? d : w) * 0.5 * steep * 1.6;
      if (along) gableX(b, -w / 2, w / 2, -d / 2, d / 2, 0, rh, o, mat, roofMat, vari);
      else gableZ(b, -w / 2, w / 2, -d / 2, d / 2, 0, rh, o, mat, roofMat, vari);
      peak = [along ? w / 2 : 0, rh, along ? 0 : d / 2];
      if (rh > 2 && rng.chance(0.5)) {
        const s = Math.min(0.8, rh * 0.3);
        for (const f of (along ? ['R', 'L'] : ['F', 'K']) as Face[]) b.with(faceXf(f, w, d), () => this.window(0, rh * 0.28, s, s, mat, 2));
      }
      // dormers on the front slope
      const span = along ? w : d;
      const half = (along ? d : w) / 2;
      const dh = Math.min(1.35, rh * 0.5);
      if (span > 3 && rh > 1.8) {
        const nd = span > 5 ? rng.int(1, 2) : 1;
        for (let i = 0; i < nd; i++) {
          const c = -span / 2 + ((i + 0.5) * span) / nd + rng.range(-0.3, 0.3);
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
    }
    // chimneys
    const nc = rng.int(depth === 0 ? 1 : 0, 2);
    for (let i = 0; i < nc; i++) {
      const cx = rng.range(-w / 2 + 0.6, w / 2 - 0.6), cz = rng.range(-d / 2 + 0.6, d / 2 - 0.6);
      this.chimney(cx, cz, -0.3, rh + rng.range(0.6, 2.4), mat);
    }
    if (kind === 'hip' || rng.chance(0.4)) this.finial(peak[0] * (kind === 'hip' ? 1 : 0.9), peak[1] - 0.1, peak[2], rng.range(1.2, 2.6));
    return rh;
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
      const bell = rng.chance(0.5);
      lathe(b, cx, yt + 0.2, cz, bell
        ? [[ro, -0.15], [ro * 0.92, rh * 0.2], [ro * 0.7, rh * 0.5], [ro * 0.35, rh * 0.8], [0.05, rh]]
        : [[ro, -0.15], [ro * 0.5, rh * 0.5], [0.05, rh]], 12);
      this.finial(cx, yt + 0.2 + rh * 0.95, cz, rng.range(0.8, 2.0));
    });
    this.top = Math.max(this.top, blk.y0 + yt + 3);
    void topY;
  }

  /** Grow a stack of blocks upward from (ox, y, oz). Returns its blocks. */
  tower(ox: number, oz: number, y: number, w: number, d: number, lx: number, lz: number, topY: number, depth: number): BlockRec[] {
    const { b, rng, p, style } = this;
    const blocks: BlockRec[] = [];
    let pw = w, pd = d;
    const leanMax = 0.1 * p.lean;
    let lastMat: number = M.STONE;
    let yaw = depth ? rng.range(-0.1, 0.1) : 0;
    let lastRound = false;
    while (topY - y > 1.5) {
      const remaining = topY - y;
      const floors = remaining < 5.5 ? 1 : rng.int(1, 2);
      const h = Math.min(floors * rng.range(2.4, 2.9), remaining);
      lx = clamp(lx + rng.range(-1, 1) * 0.04 * p.lean, -leanMax, leanMax);
      lz = clamp(lz + rng.range(-1, 1) * 0.03 * p.lean, -leanMax, leanMax);
      const mat = this.wallMat(y, topY);
      lastMat = mat;
      yaw = clamp(yaw + rng.range(-1, 1) * 0.06 * p.lean, -0.14 * p.lean, 0.14 * p.lean);
      const y0 = y, ox0 = ox, oz0 = oz, lx0 = lx, lz0 = lz, cy = Math.cos(yaw), sy = Math.sin(yaw);
      const xf: XF = ([x, yy, z]) => [ox0 + x * cy - z * sy + lx0 * yy, y0 + yy, oz0 + x * sy + z * cy + lz0 * yy];
      const ground = y < this.groundY + 0.1;
      const round = !ground && Math.abs(w - d) < 1.3 && rng.chance(0.13);
      if (round) {
        const r = (Math.min(w, d) / 2) * 1.05;
        w = d = r * 2;
        b.with(xf, () => this.roundBlock(r, h, floors, mat));
      } else b.with(xf, () => this.block(w, d, h, floors, mat, ground, pw, pd));
      lastRound = round;
      blocks.push({ y0, h, w, d, xf });
      ox += lx * h; oz += lz * h; y += h;
      pw = w; pd = d;
      if (rng.chance(style.overhangP)) { w += rng.range(0.3, 0.9); d += rng.range(0.2, 0.7); }
      else if (rng.chance(0.45)) { w *= rng.range(0.78, 0.95); d *= rng.range(0.8, 0.97); }
      w = clamp(w, 2.6, 7.2); d = clamp(d, 2.6, 6.5);
      ox += rng.range(-0.45, 0.45) * p.lean; oz += rng.range(-0.35, 0.35) * p.lean;

      // split into two towers joined by a bridge
      if (depth === 0 && Math.max(w, d) > 4.2 && topY - y > 9 && rng.chance(0.35)) {
        const alongX = w >= d;
        const sw = (alongX ? w : d) / 2 - 0.15;
        const off = sw / 2 + 0.15;
        const topA = topY + rng.range(-3, 4), topB = topY + rng.range(-8, 0);
        const mk = (s: number, t: number) => alongX
          ? this.tower(ox + s * off, oz, y, sw, d * rng.range(0.75, 1), lx + s * 0.02, lz, t, depth + 1)
          : this.tower(ox, oz + s * off, y, w * rng.range(0.75, 1), sw, lx, lz + s * 0.02, t, depth + 1);
        const A = mk(-1, topA), B = mk(1, topB);
        this.bridge(A, B, alongX, y + rng.range(2.5, Math.min(topA, topB) - y - 3));
        return blocks.concat(A, B);
      }
    }
    const last = blocks[blocks.length - 1];
    if (last) {
      const lx1 = lx, lz1 = lz, oxr = ox, ozr = oz, yr = y, cy = Math.cos(yaw), sy = Math.sin(yaw);
      const rxf: XF = ([x, yy, z]) => [oxr + x * cy - z * sy + lx1 * yy, yr + yy, ozr + x * sy + z * cy + lz1 * yy];
      let rh = 0;
      b.with(rxf, () => { rh = this.roof(last.w, last.d, lastMat, depth, lastRound); });
      this.top = Math.max(this.top, y + rh + 2);
      if (blocks.length > 2 && rng.chance(style.craneP) && !lastRound) {
        const f = rng.pick(['F', 'K', 'R', 'L'] as Face[]);
        const drop = rng.range(2, Math.max(2.5, Math.min(8, last.y0 - this.groundY)));
        b.with(last.xf, () => b.with(faceXf(f, last.w, last.d), () => this.crane(last.h, drop)));
      }
      if (rng.chance(depth === 0 ? 0.55 : 0.3) && blocks.length > 1) this.turret(blocks[blocks.length - 1], topY);
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

interface Lot {
  x: number; z: number; w: number; d: number; rot: number;
  base: number; top: number; height: number; main: boolean; parent: number;
  rad: number; blocks: BlockRec[]; xf: XF; front: V3;
}

class Site {
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

  lots(): Lot[] {
    const { g, p, TR } = this;
    const rng = g.rng;
    const lots: Lot[] = [];
    const make = (x: number, z: number, w: number, d: number, main: boolean, height: number): Lot => {
      const rad = Math.hypot(w, d) / 2 + (main ? 1.8 : 0.9);
      const [lo, hi] = this.span(x, z, rad);
      return { x, z, w, d, rot: 0, base: lo - 1.5, top: hi + (main ? 1.2 : 0.35), height, main, parent: -1, rad, blocks: [], xf: (q) => q, front: [x, 0, z] };
    };
    // main tower: highest reasonably flat spot near the middle
    let best: Lot | null = null, bestScore = -Infinity;
    const w0 = rng.range(3.8, 5.6), d0 = rng.range(3.6, 5.0);
    for (let i = 0; i < 50; i++) {
      const a = rng.range(0, Math.PI * 2), r = Math.sqrt(rng.next()) * TR * 0.35;
      const L = make(Math.cos(a) * r, Math.sin(a) * r, w0, d0, true, p.height);
      const score = L.top - (L.top - L.base) * 0.4;
      if (score > bestScore) { bestScore = score; best = L; }
    }
    lots.push(best!);
    for (let tries = 0; tries < 600 && lots.length < p.count; tries++) {
      const a = rng.range(0, Math.PI * 2), r = Math.sqrt(rng.next()) * TR;
      const x = Math.cos(a) * r, z = Math.sin(a) * r;
      const w = rng.range(3.0, 4.8), d = rng.range(3.0, 4.4);
      const k = Math.hypot(x - best!.x, z - best!.z) / TR;
      const L = make(x, z, w, d, false, Math.max(6, p.height * rng.range(0.3, 0.75) * (1 - 0.35 * k)));
      if (L.top - L.base > 5.5) continue;
      if (this.sea !== null && L.base + 1.5 < this.sea + 0.8) continue;
      if (lots.some((o) => Math.hypot(o.x - x, o.z - z) < o.rad + L.rad + 1.6)) continue;
      lots.push(L);
    }
    // minimum spanning tree from the main tower → paths & orientation
    const inTree = [0];
    while (inTree.length < lots.length) {
      let bi = -1, bj = -1, bd = Infinity;
      for (const i of inTree) for (let j = 0; j < lots.length; j++) {
        if (inTree.includes(j)) continue;
        const dd = Math.hypot(lots[i].x - lots[j].x, lots[i].z - lots[j].z) + Math.abs(lots[i].top - lots[j].top) * 1.5;
        if (dd < bd) { bd = dd; bi = i; bj = j; }
      }
      lots[bj].parent = bi; inTree.push(bj);
    }
    for (const L of lots) {
      const P = L.parent >= 0 ? lots[L.parent] : null;
      const dx = P ? P.x - L.x : -L.x, dz = P ? P.z - L.z : -L.z;
      L.rot = (P || Math.hypot(dx, dz) > 1 ? Math.atan2(-dx, dz) : rng.range(0, 6.28)) + rng.range(-0.2, 0.2);
      const c = Math.cos(L.rot), s = Math.sin(L.rot);
      L.xf = ([x, y, z]) => [L.x + x * c - z * s, y, L.z + x * s + z * c];
    }
    return lots;
  }

  /** Square-ish stone foundation with front steps down to the terrain. */
  foundation(L: Lot) {
    const { g } = this; const b = g.b;
    const fw = L.w + 1.4, fd = L.d + 1.4;
    b.begin(M.STONE, g.r());
    box(b, -fw / 2, L.base, -fd / 2, fw / 2, L.top, fd / 2, { skip: 'B' });
    b.begin(M.STONE, g.r());
    box(b, -fw / 2 - 0.08, L.top - 0.2, -fd / 2 - 0.08, fw / 2 + 0.08, L.top + 0.05, fd / 2 + 0.08);
    const fz = fd / 2;
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
      for (const [p0, p1, p2] of [[a, c, e], [a, e, f]] as V3[][]) {
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

  boat(b: Builder) {
    const { g, sea } = this;
    if (sea === null) return;
    const a = g.rng.range(0, Math.PI * 2);
    let r = this.RI * 0.6;
    while (r < this.RI * 2 && this.H(Math.cos(a) * r, Math.sin(a) * r) > sea - 0.4) r += 0.5;
    r += 2.5;
    const cx = Math.cos(a) * r, cz = Math.sin(a) * r, yaw = a + g.rng.range(1.2, 1.9);
    const c = Math.cos(yaw), s = Math.sin(yaw);
    b.with(([x, y, z]) => [cx + x * c - z * s, sea + y, cz + x * s + z * c], () => {
      b.begin(M.PLANK, g.r());
      const sec = 8;
      const S = (i: number) => { const x = -1.6 + (3.2 * i) / sec; const w = 0.65 * Math.sqrt(Math.max(0, 1 - (x / 1.65) ** 2)) + 0.02; return { x, w }; };
      for (let i = 0; i < sec; i++) {
        const A = S(i), B = S(i + 1);
        for (const sd of [-1, 1]) b.quad([A.x, 0.35, sd * A.w], [B.x, 0.35, sd * B.w], [B.x, -0.15, 0], [A.x, -0.15, 0], [[A.x, 0], [B.x, 0], [B.x, 0.6], [A.x, 0.6]]);
      }
      b.begin(M.TIMBER, g.r());
      beam(b, [-0.6, 0.25, -0.5], [-0.6, 0.25, 0.5], 0.15, 0.06);
      beam(b, [0.4, 0.25, -0.55], [0.4, 0.25, 0.55], 0.15, 0.06);
      beam(b, [0.1, 0.3, 0.2], [-0.9, 0.3, 1.3], 0.05);
    });
  }
}

export function generate(p: GenParams): GenResult {
  const g = new Gen(p);
  const site = new Site(p, g);
  const rng = g.rng;
  const dominant = g.style;
  const lots = site.lots();
  const tb = new Builder(1_000_000);
  let top = 0;

  for (const L of lots) {
    g.style = L.main || rng.chance(0.65) ? dominant : rng.pick(STYLES);
    g.archP = g.style.archP;
    g.groundY = L.top;
    g.usedStair = false;
    g.top = 0;
    g.b.with(L.xf, () => {
      if (L.main) {
        g.plinth(L.rad, L.base, L.top);
        const steps = Math.ceil((L.top - L.base - 1.5) / 0.25);
        // front stair hugging the plinth
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
      L.blocks = g.tower(0, 0, L.top, L.w, L.d, 0, 0, L.top + L.height, 0);
    });
    top = Math.max(top, g.top, L.top + L.height);
  }

  // high bridges between neighbouring towers
  for (let i = 0; i < lots.length; i++) for (let j = i + 1; j < lots.length; j++) {
    const A = lots[i], B = lots[j];
    const dist = Math.hypot(A.x - B.x, A.z - B.z);
    if (dist > 12 || !rng.chance(0.55)) continue;
    const yb = Math.min(A.top + A.height, B.top + B.height) - rng.range(2.5, 5);
    if (yb < Math.max(A.top, B.top) + 3) continue;
    const ba = A.blocks.find((k) => yb >= k.y0 && yb < k.y0 + k.h), bb = B.blocks.find((k) => yb >= k.y0 && yb < k.y0 + k.h);
    if (!ba || !bb) continue;
    const ca = A.xf(ba.xf([0, yb - ba.y0, 0])), cb = B.xf(bb.xf([0, yb - bb.y0, 0]));
    const dx = cb[0] - ca[0], dz = cb[2] - ca[2], dl = Math.hypot(dx, dz);
    const ra = Math.min(ba.w, ba.d) / 2 - 0.1, rb = Math.min(bb.w, bb.d) / 2 - 0.1;
    if (dl - ra - rb < 1.5) continue;
    g.bridgeWorld([ca[0] + (dx / dl) * ra, yb, ca[2] + (dz / dl) * ra], [cb[0] - (dx / dl) * rb, yb, cb[2] - (dz / dl) * rb]);
  }

  // wonky hand-drawn warp on the buildings only
  const wonk = p.wonk, s = 0.16;
  g.b.warp(([x, y, z]) => [
    x + (noise3(x * s, y * s, z * s) - 0.5) * wonk * 0.9,
    y + (noise3(x * s + 9, y * s, z * s) - 0.5) * wonk * 0.3,
    z + (noise3(x * s, y * s + 17, z * s) - 0.5) * wonk * 0.9,
  ]);

  // ground: terrain, paths, lamps, people, boat
  site.terrain(tb);
  const pathPts: V3[] = [];
  for (const L of lots) {
    if (L.parent < 0) continue;
    const P = lots[L.parent];
    const dx = L.front[0] - P.x, dz = L.front[2] - P.z, dl = Math.hypot(dx, dz) || 1;
    const end: V3 = P.main || dl < P.rad + 3 ? P.front : [P.x + (dx / dl) * (P.rad + 1.2), 0, P.z + (dz / dl) * (P.rad + 1.2)];
    const pts = site.path(tb, L.front, end);
    if (pts) pathPts.push(...pts);
  }
  for (let i = 6; i < pathPts.length; i += 14) {
    const q = pathPts[i], side = i % 28 < 14 ? 1 : -1;
    const x = q[0] + side * 1.1, z = q[2] + side * 0.4;
    site.lamp(tb, x, site.H(x, z), z);
  }
  const nf = Math.min(pathPts.length, rng.int(2, 5));
  for (let i = 0; i < nf; i++) {
    const q = pathPts[Math.floor(rng.next() * pathPts.length)];
    if (q) site.figure(tb, q[0] + rng.range(-0.3, 0.3), q[1] - 0.05, q[2] + rng.range(-0.3, 0.3));
  }
  site.boat(tb);

  g.b.append(tb);
  const geo = g.b.build();
  return { geo, top, extent: site.RI, seaLevel: site.sea, buildings: lots.length };
}
