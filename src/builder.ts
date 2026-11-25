import * as THREE from 'three';

/** Material ids — indexes into the palette uniform array in the shader. */
/** variety value that makes iron glow red-hot (sparks, an oven's mouth); see the g-buffer shader */
export const IRON_GLOW = 0.999;
export const M = {
  STONE: 0, PLASTER: 1, PLANK: 2, BRICK: 3, SLATE: 4, TILE: 5, COPPER: 6, GLASS: 7,
  TIMBER: 8, ROCK: 9, GRASS: 10, DOOR: 11, IRON: 12, COBBLE: 13, WATER: 14, ACCENT: 15, SMOKE: 16,
} as const;

export type V3 = [number, number, number];
export type XF = (p: V3) => V3;
type UV = [number, number];

/**
 * Accumulates non-indexed triangles. Normals are derived in the fragment shader
 * from screen derivatives, so winding order never matters.
 * Every `begin()` starts a new "piece" with its own id — id changes are inked as lines.
 */
export class Builder {
  P: number[] = []; U: number[] = []; Mt: number[] = []; Vr: number[] = []; Id: number[] = [];
  xf: XF = (p) => p;
  mat = 0; vari = 0.5; id = 0;
  private nid: number;
  constructor(idStart = 1) { this.nid = idStart; }

  /** Apply a deformation to every vertex accumulated so far. */
  warp(fn: (p: V3) => V3) {
    const P = this.P;
    for (let i = 0; i < P.length; i += 3) {
      const q = fn([P[i], P[i + 1], P[i + 2]]);
      P[i] = q[0]; P[i + 1] = q[1]; P[i + 2] = q[2];
    }
  }
  append(o: Builder) {
    for (const k of ['P', 'U', 'Mt', 'Vr', 'Id'] as const) for (const v of o[k]) this[k].push(v);
  }

  begin(mat: number, vari = Math.random()) {
    // iron glows red-hot only when asked for with IRON_GLOW; random variety never reaches the glow band
    if (mat === M.IRON && vari > 0.99 && vari !== IRON_GLOW) vari = 0.99;
    this.mat = mat; this.vari = vari; this.id = this.nid++;
    return this;
  }
  v(p: V3, uv: UV) {
    const q = this.xf(p);
    this.P.push(q[0], q[1], q[2]);
    this.U.push(uv[0], uv[1]);
    this.Mt.push(this.mat); this.Vr.push(this.vari); this.Id.push(this.id);
  }
  tri(a: V3, b: V3, c: V3, ua: UV, ub: UV, uc: UV) {
    this.v(a, ua); this.v(b, ub); this.v(c, uc);
  }
  quad(a: V3, b: V3, c: V3, d: V3, uv: [UV, UV, UV, UV]) {
    this.tri(a, b, c, uv[0], uv[1], uv[2]);
    this.tri(a, c, d, uv[0], uv[2], uv[3]);
  }
  /** Run `cb` with an extra local transform applied before the current one. */
  with(f: XF, cb: () => void) {
    const old = this.xf;
    this.xf = (p) => old(f(p));
    try { cb(); } finally { this.xf = old; }
  }

  build(warp?: (p: V3) => V3): THREE.BufferGeometry {
    const P = this.P;
    if (warp) {
      for (let i = 0; i < P.length; i += 3) {
        const q = warp([P[i], P[i + 1], P[i + 2]]);
        P[i] = q[0]; P[i + 1] = q[1]; P[i + 2] = q[2];
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
    g.setAttribute('puv', new THREE.Float32BufferAttribute(this.U, 2));
    g.setAttribute('mat', new THREE.Float32BufferAttribute(this.Mt, 1));
    g.setAttribute('vari', new THREE.Float32BufferAttribute(this.Vr, 1));
    g.setAttribute('oid', new THREE.Float32BufferAttribute(this.Id, 1));
    g.computeBoundingSphere();
    return g;
  }
}

// ---------------------------------------------------------------- shapes

/** Faces: R(+x) L(-x) T(+y) B(-y) F(+z) K(-z) */
export interface BoxOpts { skip?: string; mats?: Partial<Record<string, number>>; norm?: string }

export function box(b: Builder, x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, o: BoxOpts = {}) {
  const base = b.mat;
  const W = x1 - x0, H = y1 - y0, D = z1 - z0;
  const face = (f: string, a: V3, bb: V3, c: V3, d: V3, w: number, h: number) => {
    if (o.skip?.includes(f)) return;
    b.mat = o.mats?.[f] ?? base;
    const n = o.norm?.includes(f);
    const sx = n ? 1 : w, sy = n ? 1 : h;
    b.quad(a, bb, c, d, [[0, 0], [sx, 0], [sx, sy], [0, sy]]);
  };
  face('F', [x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], W, H);
  face('K', [x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0], W, H);
  face('R', [x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1], D, H);
  face('L', [x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0], D, H);
  face('T', [x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0], W, D);
  face('B', [x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1], W, D);
  b.mat = base;
}

const sub = (a: V3, c: V3): V3 => [a[0] - c[0], a[1] - c[1], a[2] - c[2]];
const add = (a: V3, c: V3): V3 => [a[0] + c[0], a[1] + c[1], a[2] + c[2]];
const mul = (a: V3, s: number): V3 => [a[0] * s, a[1] * s, a[2] * s];
const cross = (a: V3, c: V3): V3 => [a[1] * c[2] - a[2] * c[1], a[2] * c[0] - a[0] * c[2], a[0] * c[1] - a[1] * c[0]];
const norm = (a: V3): V3 => { const l = Math.hypot(...a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };

/** Square-section beam between two points (struts, rails, posts, barge boards). */
export function beam(b: Builder, p0: V3, p1: V3, w: number, d = w) {
  const dir = sub(p1, p0);
  const len = Math.hypot(...dir);
  const ref: V3 = Math.abs(dir[1]) / len > 0.95 ? [1, 0, 0] : [0, 1, 0];
  const s = mul(norm(cross(dir, ref)), w / 2);
  const t = mul(norm(cross(s, dir)), d / 2);
  const c = (p: V3, ss: number, tt: number) => add(add(p, mul(s, ss)), mul(t, tt));
  const ring = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
  for (let i = 0; i < 4; i++) {
    const [a0, a1] = ring[i], [b0, b1] = ring[(i + 1) % 4];
    b.quad(c(p0, a0, a1), c(p0, b0, b1), c(p1, b0, b1), c(p1, a0, a1), [[0, 0], [w, 0], [w, len], [0, len]]);
  }
  b.quad(c(p0, -1, -1), c(p0, 1, -1), c(p0, 1, 1), c(p0, -1, 1), [[0, 0], [w, 0], [w, d], [0, d]]);
  b.quad(c(p1, -1, -1), c(p1, 1, -1), c(p1, 1, 1), c(p1, -1, 1), [[0, 0], [w, 0], [w, d], [0, d]]);
}

/** Surface of revolution around a vertical axis. profile = [radius, y][] bottom→top. */
export function lathe(b: Builder, cx: number, cy: number, cz: number, prof: [number, number][], segs: number, a0 = 0) {
  let vAcc = 0;
  for (let j = 0; j < prof.length - 1; j++) {
    const [r0, y0] = prof[j], [r1, y1] = prof[j + 1];
    const sl = Math.hypot(r1 - r0, y1 - y0);
    const rAvg = Math.max((r0 + r1) / 2, 0.05);
    for (let i = 0; i < segs; i++) {
      const t0 = a0 + (i / segs) * Math.PI * 2, t1 = a0 + ((i + 1) / segs) * Math.PI * 2;
      const P = (r: number, y: number, t: number): V3 => [cx + Math.cos(t) * r, cy + y, cz + Math.sin(t) * r];
      const u0 = (i / segs) * Math.PI * 2 * rAvg, u1 = ((i + 1) / segs) * Math.PI * 2 * rAvg;
      b.quad(P(r0, y0, t0), P(r0, y0, t1), P(r1, y1, t1), P(r1, y1, t0),
        [[u0, vAcc], [u1, vAcc], [u1, vAcc + sl], [u0, vAcc + sl]]);
    }
    vAcc += sl;
  }
}

/**
 * Gable roof over [x0,x1]×[z0,z1] whose wall-top is at y. Ridge along x.
 * The roof plane passes through the wall top edge and extends by `o` beyond it.
 */
export function gableX(b: Builder, x0: number, x1: number, z0: number, z1: number, y: number, rh: number, o: number,
  wallMat: number, roofMat: number, vari: number, opts: { skipGable?: boolean; barge?: boolean; endMul?: number } = {}) {
  const zc = (z0 + z1) / 2, hd = (z1 - z0) / 2;
  const drop = (rh * o) / hd;
  const em = opts.endMul ?? 0.6;
  const ye = y - drop, xa = x0 - o * em, xb = x1 + o * em;
  const sl = Math.hypot(hd + o, rh + drop);
  const L = xb - xa;
  b.begin(roofMat, vari);
  b.quad([xa, ye, z1 + o], [xb, ye, z1 + o], [xb, y + rh, zc], [xa, y + rh, zc], [[0, 0], [L, 0], [L, sl], [0, sl]]);
  b.begin(roofMat, vari);
  b.quad([xb, ye, z0 - o], [xa, ye, z0 - o], [xa, y + rh, zc], [xb, y + rh, zc], [[0, 0], [L, 0], [L, sl], [0, sl]]);
  // roof thickness rim (gives the eave a drawn edge)
  b.begin(M.TIMBER, vari);
  const t = 0.12;
  b.quad([xa, ye, z1 + o], [xb, ye, z1 + o], [xb, ye - t, z1 + o], [xa, ye - t, z1 + o], [[0, 0], [L, 0], [L, t], [0, t]]);
  b.quad([xa, ye, z0 - o], [xb, ye, z0 - o], [xb, ye - t, z0 - o], [xa, ye - t, z0 - o], [[0, 0], [L, 0], [L, t], [0, t]]);
  if (!opts.skipGable) {
    for (const x of [x0, x1]) {
      b.begin(wallMat, vari);
      const w = z1 - z0;
      b.tri([x, y, z0], [x, y, z1], [x, y + rh, zc], [0, 0], [w, 0], [w / 2, rh]);
    }
  }
  if (opts.barge !== false) {
    b.begin(M.TIMBER, vari);
    for (const x of [xa, xb]) {
      beam(b, [x, ye - 0.05, z1 + o], [x, y + rh, zc], 0.14, 0.2);
      beam(b, [x, ye - 0.05, z0 - o], [x, y + rh, zc], 0.14, 0.2);
    }
  }
}

/** Gable with ridge along z (axes swapped). */
export function gableZ(b: Builder, x0: number, x1: number, z0: number, z1: number, y: number, rh: number, o: number,
  wallMat: number, roofMat: number, vari: number, opts: { skipGable?: boolean; barge?: boolean; endMul?: number } = {}) {
  b.with(([x, yy, z]) => [z, yy, x], () => gableX(b, z0, z1, x0, x1, y, rh, o, wallMat, roofMat, vari, opts));
}

/** Hip roof (pyramid when square). */
export function hip(b: Builder, x0: number, x1: number, z0: number, z1: number, y: number, rh: number, o: number, roofMat: number, vari: number) {
  if (x1 - x0 < z1 - z0) {
    b.with(([x, yy, z]) => [z, yy, x], () => hip(b, z0, z1, x0, x1, y, rh, o, roofMat, vari));
    return;
  }
  const hd = (z1 - z0) / 2, zc = (z0 + z1) / 2;
  const drop = (rh * o) / hd, ye = y - drop;
  const A: V3 = [x0 - o, ye, z0 - o], B: V3 = [x1 + o, ye, z0 - o], C: V3 = [x1 + o, ye, z1 + o], D: V3 = [x0 - o, ye, z1 + o];
  const R0: V3 = [x0 + hd, y + rh, zc], R1: V3 = [x1 - hd, y + rh, zc];
  const L = x1 - x0 + 2 * o, sl = Math.hypot(hd + o, rh + drop);
  b.begin(roofMat, vari); b.quad(D, C, R1, R0, [[0, 0], [L, 0], [L - hd - o, sl], [hd + o, sl]]);
  b.begin(roofMat, vari); b.quad(B, A, R0, R1, [[0, 0], [L, 0], [L - hd - o, sl], [hd + o, sl]]);
  const W = z1 - z0 + 2 * o;
  b.begin(roofMat, vari); b.tri(A, D, R0, [0, 0], [W, 0], [W / 2, sl]);
  b.begin(roofMat, vari); b.tri(C, B, R1, [0, 0], [W, 0], [W / 2, sl]);
}

/** Scottish crow-stepped gable ends (gable walls at x0 and x1, ridge along x). */
export function crowSteps(b: Builder, x0: number, x1: number, z0: number, z1: number, rh: number, mat: number, vari: number) {
  const zc = (z0 + z1) / 2, hd = (z1 - z0) / 2, n = 5;
  for (const [x, s] of [[x0, -1], [x1, 1]] as [number, number][]) {
    b.begin(mat, vari);
    for (let i = 0; i < n; i++) for (const side of [-1, 1]) {
      const za = zc + side * hd * (1 - i / n), zb = zc + side * hd * (1 - (i + 1) / n);
      const top = rh * ((i + 1) / n) + 0.32;
      box(b, x - 0.2 + s * 0.06, rh * (i / n) - 0.15, Math.min(za, zb), x + 0.2 + s * 0.06, top, Math.max(za, zb));
    }
    box(b, x - 0.24 + s * 0.06, rh - 0.1, zc - 0.3, x + 0.24 + s * 0.06, rh + 0.75, zc + 0.3);
  }
}
