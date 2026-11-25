import * as THREE from 'three';
import { Builder, M, V3, XF, beam, box, gableX, gableZ, hip, lathe } from './builder';
import { RNG, noise3 } from './rng';

export type Terrain = 'island' | 'crag';
export interface GenParams { seed: number; height: number; lean: number; wonk: number; terrain: Terrain }
export interface GenResult { geo: THREE.BufferGeometry; top: number; radius: number; seaLevel: number | null }

interface Style {
  base: number[]; mid: number[]; top: number[]; roofs: number[];
  halfTimber: number; shutters: boolean; annexP: number; overhangP: number; annexMats: number[];
  winW: number; winH: number;
}
const S = M;
const STYLES: Style[] = [
  { base: [S.STONE], mid: [S.STONE, S.PLASTER, S.STONE], top: [S.PLASTER, S.STONE], roofs: [S.SLATE, S.SLATE, S.COPPER],
    halfTimber: 0.1, shutters: false, annexP: 0.2, overhangP: 0.25, annexMats: [S.STONE, S.PLASTER], winW: 0.75, winH: 1.3 },
  { base: [S.STONE, S.PLANK], mid: [S.PLANK, S.PLASTER, S.PLANK], top: [S.PLANK, S.PLASTER], roofs: [S.TILE, S.TILE, S.SLATE],
    halfTimber: 0.2, shutters: false, annexP: 0.55, overhangP: 0.5, annexMats: [S.PLANK, S.PLASTER], winW: 0.7, winH: 1.0 },
  { base: [S.STONE], mid: [S.BRICK, S.PLASTER, S.PLANK, S.STONE], top: [S.PLASTER, S.BRICK, S.PLANK], roofs: [S.SLATE, S.TILE],
    halfTimber: 0.6, shutters: true, annexP: 0.35, overhangP: 0.4, annexMats: [S.PLASTER, S.PLANK], winW: 0.7, winH: 1.15 },
];

interface BlockRec { y0: number; h: number; w: number; d: number; xf: XF }

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
  constructor(public p: GenParams, public groundY: number) {
    this.rng = new RNG(p.seed);
    this.style = this.rng.pick(STYLES);
  }
  r() { return this.rng.next(); }

  // ------------------------------------------------------------ details
  window(a: number, y: number, ww: number, wh: number, wallMat: number) {
    const { b, rng } = this;
    const glass = rng.chance(0.04) ? M.ACCENT : M.GLASS;
    b.begin(glass, this.r());
    box(b, a - ww / 2, y, 0, a + ww / 2, y + wh, 0.09, { mats: { R: M.TIMBER, L: M.TIMBER, T: M.TIMBER, B: M.TIMBER }, norm: 'F', skip: 'K' });
    b.begin(wallMat === M.STONE || wallMat === M.BRICK || rng.chance(0.3) ? M.STONE : M.TIMBER, this.r());
    box(b, a - ww / 2 - 0.12, y - 0.14, 0, a + ww / 2 + 0.12, y, 0.2, { skip: 'K' });
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
  }

  door(a: number, wallMat: number) {
    const { b } = this;
    const dw = 1.2, dh = 2.1;
    b.begin(M.DOOR, this.r());
    box(b, a - dw / 2, 0, 0, a + dw / 2, dh, 0.05, { norm: 'F', skip: 'K' });
    b.begin(M.STONE, this.r());
    box(b, a - dw / 2 - 0.25, 0, 0, a - dw / 2, dh + 0.3, 0.22, { skip: 'K' });
    box(b, a + dw / 2, 0, 0, a + dw / 2 + 0.25, dh + 0.3, 0.22, { skip: 'K' });
    box(b, a - dw / 2 - 0.35, dh, 0, a + dw / 2 + 0.35, dh + 0.4, 0.3, { skip: 'K' });
    // little canopy
    if (wallMat !== M.STONE) {
      b.begin(M.SLATE, this.r());
      b.quad([a - 1, dh + 0.9, 0], [a + 1, dh + 0.9, 0], [a + 1, dh + 0.45, 0.9], [a - 1, dh + 0.45, 0.9], [[0, 0], [2, 0], [2, 1], [0, 1]]);
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

  roof(w: number, d: number, mat: number, depth: number) {
    const { b, rng, style } = this;
    const roofMat = rng.pick(style.roofs);
    const vari = this.r();
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
      b.with(xf, () => this.block(w, d, h, floors, mat, ground, pw, pd));
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
      b.with(rxf, () => { rh = this.roof(last.w, last.d, lastMat, depth); });
      this.top = Math.max(this.top, y + rh + 2);
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

  // ------------------------------------------------------------ site
  terrain(R: number) {
    const { b, p } = this;
    const rings = 34, segs = 72;
    const r0 = R + 3.5;
    const outer = p.terrain === 'island' ? r0 + 13 : r0 + 16;
    const height = (r: number, t: number) => {
      const x = Math.cos(t) * r, z = Math.sin(t) * r;
      const n = noise3(x * 0.25, 3.1, z * 0.25), n2 = noise3(x * 0.7, 7.7, z * 0.7);
      if (r < r0) return (n - 0.5) * 0.25 * (r / r0);
      const k = r - r0;
      const ridge = Math.abs(n2 - 0.5) * 2;
      return -Math.pow(k, 1.25) * 0.95 - ridge * 1.2 * Math.min(1, k / 2) + (n - 0.5) * 1.5 * Math.min(1, k / 3);
    };
    b.begin(M.ROCK, 0.5);
    const pt = (i: number, j: number): V3 => {
      const r = (i / rings) ** 1.3 * outer;
      const t = (j / segs) * Math.PI * 2 + (noise3(i * 0.7, j * 0.3, 1) - 0.5) * 0.03;
      const rr = r * (1 + (noise3(Math.cos(t) * 2, 5, Math.sin(t) * 2) - 0.5) * 0.35 * Math.min(1, r / r0));
      return [Math.cos(t) * rr, height(rr, t), Math.sin(t) * rr];
    };
    for (let i = 0; i < rings; i++) {
      for (let j = 0; j < segs; j++) {
        const a = pt(i, j), c = pt(i + 1, j), e = pt(i + 1, j + 1), f = pt(i, j + 1);
        for (const tri of [[a, c, e], [a, e, f]] as V3[][]) {
          const [p0, p1, p2] = tri;
          const u: V3 = [p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]], v: V3 = [p2[0] - p0[0], p2[1] - p0[1], p2[2] - p0[2]];
          const n: V3 = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
          const ny = Math.abs(n[1]) / (Math.hypot(...n) || 1);
          const rm = Math.hypot(p0[0], p0[2]);
          b.mat = rm < R + 1.2 ? M.COBBLE : ny > 0.82 ? M.GRASS : M.ROCK;
          // planar uv: use horizontal for flat, vertical-ish for cliffs
          const uv = (q: V3): [number, number] => (ny > 0.7 ? [q[0], q[2]] : [Math.atan2(q[2], q[0]) * rm, q[1]]);
          b.tri(p0, p1, p2, uv(p0), uv(p1), uv(p2));
        }
      }
    }
    if (p.terrain === 'island') {
      b.begin(M.WATER, 0.5);
      const sea = -6.5;
      const W = 120;
      b.quad([-W, sea, -W], [W, sea, -W], [W, sea, W], [-W, sea, W], [[-W, -W], [W, -W], [W, W], [-W, W]]);
    }
  }

  plinth(R: number, h: number) {
    const { b, rng } = this;
    b.begin(M.STONE, this.r());
    lathe(b, 0, -1.5, 0, [[R + 0.5, 0], [R, h + 1.5]], 11, 0.2);
    b.begin(M.COBBLE, this.r());
    lathe(b, 0, h, 0, [[R, 0], [0.01, 0]], 11, 0.2);
    // parapet stones
    b.begin(M.STONE, this.r());
    lathe(b, 0, h, 0, [[R + 0.05, 0], [R + 0.05, 0.45], [R - 0.35, 0.45], [R - 0.35, 0]], 11, 0.2);
    // stair climbing around the plinth
    const steps = Math.ceil(h / 0.25);
    const t0 = rng.range(0, Math.PI * 2);
    b.begin(M.STONE, this.r());
    for (let i = 0; i < steps; i++) {
      const t = t0 + i * 0.075;
      const rot: XF = ([x, y, z]) => [Math.cos(t) * (R + 0.75 + x) - Math.sin(t) * z, y, Math.sin(t) * (R + 0.75 + x) + Math.cos(t) * z];
      b.with(rot, () => box(b, -0.7, -0.5, -0.35, 0.7, h - i * 0.25, 0.35));
    }
    // lamp post at the foot of the stairs
    const tl = t0 + steps * 0.075 + 0.15;
    const lxp = Math.cos(tl) * (R + 1.6), lzp = Math.sin(tl) * (R + 1.6);
    b.begin(M.IRON, this.r());
    lathe(b, lxp, 0, lzp, [[0.16, 0], [0.12, 0.4], [0.07, 0.5], [0.06, 3.6], [0.1, 3.7]], 6);
    b.begin(M.GLASS, 0.99);
    lathe(b, lxp, 3.7, lzp, [[0.15, 0], [0.25, 0.55], [0.0, 0.56]], 6);
    b.begin(M.IRON, this.r());
    lathe(b, lxp, 4.25, lzp, [[0.3, 0], [0.0, 0.3]], 6);
    // a lone figure
    const tf = t0 - 0.5;
    const fx = Math.cos(tf) * (R + 2.2), fz = Math.sin(tf) * (R + 2.2);
    b.begin(M.DOOR, this.r());
    lathe(b, fx, 0, fz, [[0.32, 0], [0.26, 0.9], [0.2, 1.35], [0.0, 1.45]], 8);
    b.begin(M.PLASTER, this.r());
    lathe(b, fx, 1.4, fz, [[0.0, 0], [0.13, 0.08], [0.13, 0.25], [0.0, 0.33]], 6);
    b.begin(M.IRON, this.r());
    lathe(b, fx, 1.62, fz, [[0.22, 0], [0.12, 0.02], [0.12, 0.2], [0.0, 0.2]], 8);
  }
}

export function generate(p: GenParams): GenResult {
  const plinthH = 1.5 + (p.seed % 3) * 0.6;
  const g = new Gen(p, plinthH);
  const rng = g.rng;
  const w = rng.range(3.6, 5.6), d = rng.range(3.4, 5.0);
  const R = Math.hypot(w, d) / 2 + rng.range(1.2, 2.2);
  g.plinth(R, plinthH);
  g.top = 0;
  g.tower(rng.range(-0.4, 0.4), rng.range(-0.4, 0.4), plinthH, w, d, 0, 0, plinthH + p.height, 0);
  g.terrain(R);
  const wonk = p.wonk;
  const geo = g.b.build(([x, y, z]) => {
    if (y < plinthH - 0.01 && Math.hypot(x, z) > R + 2) return [x, y, z];
    const s = 0.16;
    return [
      x + (noise3(x * s, y * s, z * s) - 0.5) * wonk * 0.9,
      y + (noise3(x * s + 9, y * s, z * s) - 0.5) * wonk * 0.3,
      z + (noise3(x * s, y * s + 17, z * s) - 0.5) * wonk * 0.9,
    ];
  });
  return { geo, top: Math.max(g.top, plinthH + p.height), radius: R, seaLevel: p.terrain === 'island' ? -6.5 : null };
}
