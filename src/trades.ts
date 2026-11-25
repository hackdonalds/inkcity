/**
 * Trades: each working building looks like what it does. Work roles map to a trade; houses get a
 * seeded trade (or none). A trade brings a painted hanging sign (flat icon shapes), shop goods and
 * workshop fittings: the baker's domed oven, the smith's forge and anvil, the weaver's loom window,
 * the cooper's barrel stacks, the carpenter's big doors and saw-horse, the granary's hayloft hoist…
 */
import { M, V3, XF, beam, box, gableZ, lathe } from './builder';
import { RNG } from './rng';
import { Q } from './quality';
import type { Role } from './economy';
import type { BSpec, Face, Gen, Lot, Site } from './tower';
import { faceXf, hashSeed } from './tower';

export type Trade = 'none' | 'baker' | 'smith' | 'weaver' | 'cooper' | 'tailor' | 'apothecary' | 'chandler'
  | 'carpenter' | 'mason' | 'potter' | 'granary' | 'tavern';

const ROLE_TRADE: Partial<Record<Role, Trade>> = { wood: 'carpenter', quarry: 'mason', kiln: 'potter', farm: 'granary', inn: 'tavern' };
const HOUSE_TRADES: Trade[] = ['none', 'none', 'none', 'baker', 'smith', 'weaver', 'cooper', 'tailor', 'apothecary', 'chandler'];

/** The trade a building plies (stable: from its role, or seeded for houses). */
export function tradeOf(s: Pick<BSpec, 'role' | 'seed' | 'main'>): Trade {
  if (s.main) return 'none';
  if (s.role === 'house') return new RNG(hashSeed(s.seed, 0x7ade)).pick(HOUSE_TRADES);
  return ROLE_TRADE[s.role] ?? 'none';
}

export const TRADE_NAMES: Record<Trade, string> = {
  none: '', baker: 'Baker', smith: 'Smithy', weaver: 'Weaver', cooper: 'Cooper', tailor: 'Tailor', apothecary: 'Apothecary',
  chandler: 'Chandler', carpenter: 'Carpenter', mason: 'Mason', potter: 'Potter', granary: 'Granary', tavern: 'Tavern',
};

// ------------------------------------------------------------------ icons
type P2 = [number, number];

/**
 * Flat icon for a trade in the local x/y plane (z=0), about one unit across, centred on the origin.
 * Every shape is its own piece so it gets its own ink outline. `vari` sets the paint freshness.
 */
export function drawIcon(g: Gen, t: Trade, vari = 0.6, gild = false) {
  const b = g.b;
  const poly = (mat: number, pts: P2[], z = 0) => {
    b.begin(gild && mat !== M.IRON ? M.PLASTER : mat, gild ? 0.95 : vari);
    let cx = 0, cy = 0; for (const p of pts) { cx += p[0]; cy += p[1]; } cx /= pts.length; cy /= pts.length;
    for (let i = 0; i < pts.length; i++) { const p = pts[i], q = pts[(i + 1) % pts.length]; b.tri([cx, cy, z], [p[0], p[1], z], [q[0], q[1], z], [cx, cy], p, q); }
  };
  const ell = (mat: number, cx: number, cy: number, rx: number, ry: number, n = 12, z = 0) =>
    poly(mat, Array.from({ length: n }, (_, i) => [cx + Math.cos((i / n) * Math.PI * 2) * rx, cy + Math.sin((i / n) * Math.PI * 2) * ry] as P2), z);
  const bar = (mat: number, x0: number, y0: number, x1: number, y1: number, w: number, z = 0.005) => {
    const dx = x1 - x0, dy = y1 - y0, l = Math.hypot(dx, dy) || 1, nx = (-dy / l) * w / 2, ny = (dx / l) * w / 2;
    poly(mat, [[x0 + nx, y0 + ny], [x1 + nx, y1 + ny], [x1 - nx, y1 - ny], [x0 - nx, y0 - ny]], z);
  };
  const arc = (mat: number, cx: number, cy: number, r0: number, r1: number, a0: number, a1: number, n = 10, z = 0) => {
    b.begin(gild && mat !== M.IRON ? M.PLASTER : mat, gild ? 0.95 : vari);
    for (let i = 0; i < n; i++) {
      const t0 = a0 + (a1 - a0) * (i / n), t1 = a0 + (a1 - a0) * ((i + 1) / n);
      const p = (t: number, r: number): V3 => [cx + Math.cos(t) * r, cy + Math.sin(t) * r, z];
      b.quad(p(t0, r0), p(t1, r0), p(t1, r1), p(t0, r1), [[0, 0], [1, 0], [1, 1], [0, 1]]);
    }
  };
  switch (t) {
    case 'baker':
      ell(M.TILE, 0, -0.02, 0.44, 0.26, 14);
      for (const x of [-0.18, 0, 0.18]) bar(M.PLASTER, x - 0.07, -0.12, x + 0.09, 0.1, 0.05, 0.01);
      break;
    case 'smith':
      arc(M.IRON, 0, 0.02, 0.24, 0.4, -0.3 * Math.PI, 1.3 * Math.PI, 14);
      for (let i = 0; i < 6; i++) { const a = -0.15 * Math.PI + (i / 5) * 1.3 * Math.PI; ell(M.PLASTER, Math.cos(a) * 0.32, 0.02 + Math.sin(a) * 0.32, 0.035, 0.035, 5, 0.01); }
      break;
    case 'weaver':
      poly(M.PLANK, [[-0.48, 0], [-0.24, 0.14], [0.24, 0.14], [0.48, 0], [0.24, -0.14], [-0.24, -0.14]]);
      poly(M.ACCENT, [[-0.14, -0.08], [0.14, -0.08], [0.14, 0.08], [-0.14, 0.08]], 0.01);
      bar(M.ACCENT, 0.1, 0.05, 0.35, 0.42, 0.04, 0.012);
      break;
    case 'cooper':
      poly(M.PLANK, [[-0.2, -0.4], [0.2, -0.4], [0.31, -0.15], [0.31, 0.15], [0.2, 0.4], [-0.2, 0.4], [-0.31, 0.15], [-0.31, -0.15]]);
      for (const y of [-0.24, 0.24]) bar(M.IRON, -0.29, y, 0.29, y, 0.07, 0.01);
      bar(M.IRON, -0.31, 0, 0.31, 0, 0.05, 0.01);
      break;
    case 'tailor':
      arc(M.IRON, -0.18, -0.28, 0.07, 0.13, 0, Math.PI * 2, 10);
      arc(M.IRON, 0.18, -0.28, 0.07, 0.13, 0, Math.PI * 2, 10);
      bar(M.STONE, -0.12, -0.16, 0.26, 0.44, 0.09, 0.008);
      bar(M.STONE, 0.12, -0.16, -0.26, 0.44, 0.09, 0.012);
      break;
    case 'apothecary':
      poly(M.COPPER, [[-0.34, -0.02], [0.34, -0.02], [0.3, -0.2], [0.18, -0.34], [0, -0.38], [-0.18, -0.34], [-0.3, -0.2]]);
      bar(M.STONE, -0.38, -0.02, 0.38, -0.02, 0.07, 0.01);
      bar(M.TIMBER, 0.02, -0.05, 0.3, 0.42, 0.09, 0.012);
      break;
    case 'chandler':
      poly(M.ACCENT, [[-0.11, -0.42], [0.11, -0.42], [0.11, 0.14], [-0.11, 0.14]]);
      poly(M.TILE, [[0, 0.44], [0.09, 0.28], [0.06, 0.19], [0, 0.17], [-0.06, 0.19], [-0.09, 0.28]], 0.01);
      bar(M.PLASTER, -0.06, 0.1, -0.06, -0.06, 0.04, 0.01);
      break;
    case 'carpenter':
      poly(M.IRON, [[-0.44, -0.04], [0.22, -0.04], [0.22, 0.16], [-0.44, 0.04]]);
      for (let i = 0; i < 6; i++) { const x = -0.42 + i * 0.11; poly(M.IRON, [[x, -0.04], [x + 0.1, -0.04], [x + 0.05, -0.12]]); }
      poly(M.TIMBER, [[0.2, -0.1], [0.44, -0.1], [0.44, 0.22], [0.2, 0.22]], 0.01);
      break;
    case 'mason':
      bar(M.TIMBER, -0.32, -0.36, 0.2, 0.26, 0.08);
      bar(M.IRON, 0.06, 0.4, 0.36, 0.1, 0.16, 0.01);
      bar(M.IRON, 0.32, -0.36, -0.22, 0.3, 0.07, 0.012);
      break;
    case 'potter':
      poly(M.TILE, [[-0.15, -0.4], [0.15, -0.4], [0.28, -0.15], [0.25, 0.1], [0.12, 0.25], [0.14, 0.38], [-0.14, 0.38], [-0.12, 0.25], [-0.25, 0.1], [-0.28, -0.15]]);
      arc(M.TILE, 0.27, 0.05, 0.08, 0.13, -Math.PI / 2, Math.PI / 2, 6, -0.005);
      bar(M.PLASTER, -0.26, -0.08, 0.26, -0.08, 0.05, 0.01);
      break;
    case 'granary':
      for (const dx of [-0.24, -0.12, 0, 0.12, 0.24]) bar(M.PLANK, dx * 0.3, -0.42, dx, 0.18, 0.04);
      for (const dx of [-0.24, -0.12, 0, 0.12, 0.24]) ell(M.TILE, dx * 1.05, 0.3, 0.06, 0.15, 8, 0.01);
      bar(M.ACCENT, -0.12, -0.12, 0.12, -0.12, 0.08, 0.012);
      break;
    case 'tavern':
      poly(M.PLANK, [[-0.22, -0.38], [0.14, -0.38], [0.14, 0.2], [-0.22, 0.2]]);
      arc(M.PLANK, 0.15, -0.08, 0.09, 0.17, -Math.PI / 2, Math.PI / 2, 8, -0.005);
      for (const y of [-0.26, 0.08]) bar(M.IRON, -0.22, y, 0.14, y, 0.05, 0.01);
      for (const [x, y, r] of [[-0.16, 0.22, 0.1], [0.0, 0.27, 0.12], [0.12, 0.21, 0.09]]) ell(M.PLASTER, x, y, r, r * 0.85, 8, 0.012);
      break;
    default:
      poly(M.ACCENT, [[-0.3, 0.38], [0.3, 0.38], [0.3, 0.0], [0, -0.4], [-0.3, 0.0]]);
      bar(M.PLASTER, -0.3, 0.18, 0.3, -0.02, 0.1, 0.01);
  }
}

/** Painted hanging sign on an iron bracket (face-local; a = position along the wall, y = bracket height). */
export function tradeSign(g: Gen, a: number, y: number, t: Trade, big = false) {
  const b = g.b, tier = g.tier;
  const k = big ? 1.35 : 1;
  b.begin(M.IRON, g.r());
  beam(b, [a, y, 0], [a, y, 1.1 * k], 0.06);
  beam(b, [a, y - 0.55 * k, 0], [a, y, 0.75 * k], 0.04);
  if (!Q.low) lathe(b, a, y - 0.04, 1.1 * k, [[0.06, 0], [0.0, 0.08]], 5);
  const gild = tier === 0, crooked = tier === 3;
  const W = 0.68 * k, H = 0.78 * k, nC = 0.68 * k, top = y - 0.12;
  const tilt = crooked ? 0.32 : 0;
  // board hangs from two rings; derelict boards hang from one, askew
  const xf: XF = ([u, v, z]) => {
    const pu = u, pv = v - top; // pivot at the hook on the bracket
    const cu = pu * Math.cos(tilt) - pv * Math.sin(tilt), cv = pu * Math.sin(tilt) + pv * Math.cos(tilt);
    return [a + z, top + cv, nC + cu];
  };
  b.with(xf, () => {
    b.begin(M.IRON, g.r());
    for (const s of crooked ? [-1] : [-1, 1]) beam(b, [s * W * 0.35, top + 0.1, 0], [s * W * 0.35, top - 0.05, 0], 0.025);
    b.begin(gild ? M.ACCENT : tier >= 2 ? M.PLANK : M.PLASTER, gild ? 0.7 : tier >= 2 ? 0.1 : 0.55);
    box(b, -W / 2, top - 0.05 - H, -0.035, W / 2, top - 0.05, 0.035);
    if (!Q.low) {
      b.begin(gild ? M.PLASTER : M.TIMBER, gild ? 0.95 : g.r());
      const fr = 0.05, y0 = top - 0.05 - H, y1 = top - 0.05;
      for (const s of [-1, 1]) {
        const z = s * 0.04;
        b.quad([-W / 2, y0, z], [W / 2, y0, z], [W / 2, y0 + fr, z], [-W / 2, y0 + fr, z], [[0, 0], [1, 0], [1, 1], [0, 1]]);
        b.quad([-W / 2, y1 - fr, z], [W / 2, y1 - fr, z], [W / 2, y1, z], [-W / 2, y1, z], [[0, 0], [1, 0], [1, 1], [0, 1]]);
        b.quad([-W / 2, y0, z], [-W / 2 + fr, y0, z], [-W / 2 + fr, y1, z], [-W / 2, y1, z], [[0, 0], [1, 0], [1, 1], [0, 1]]);
        b.quad([W / 2 - fr, y0, z], [W / 2, y0, z], [W / 2, y1, z], [W / 2 - fr, y1, z], [[0, 0], [1, 0], [1, 1], [0, 1]]);
      }
    }
    const s = Math.min(W, H) * 0.78, yc = top - 0.05 - H / 2;
    for (const side of [-1, 1]) b.with(([x, yy, z]) => [x * s * side, yc + yy * s, side * (0.045 + z)], () => drawIcon(g, t, tier >= 2 ? 0.15 : 0.65, gild));
  });
}

// ------------------------------------------------------------------ shop goods

/** Ground-floor shop window with a stall board, awning, fascia and the trade's goods (face-local). */
export function tradeShop(g: Gen, a: number, t: Trade) {
  const b = g.b, rng = g.rng;
  if (t === 'weaver') { loomWindow(g, a, 0.5, 1.9, 1.55); return; }
  const w = 1.9, y0 = 0.55, h = 1.35;
  b.begin(M.STONE, g.r()); box(b, a - w / 2 - 0.2, 0, 0, a + w / 2 + 0.2, y0, 0.3, { skip: 'K' });
  b.begin(M.GLASS, g.r()); box(b, a - w / 2, y0, 0, a + w / 2, y0 + h, 0.06, { mats: { R: M.TIMBER, L: M.TIMBER, T: M.TIMBER, B: M.TIMBER }, norm: 'F', skip: 'K' });
  b.begin(M.TIMBER, g.r());
  for (const x of [-w / 2, 0, w / 2]) box(b, a + x - 0.07, y0, 0, a + x + 0.07, y0 + h, 0.1, { skip: 'K' });
  box(b, a - w / 2 - 0.1, y0 + h, 0, a + w / 2 + 0.1, y0 + h + 0.12, 0.12, { skip: 'K' });
  b.begin(M.PLANK, g.r()); box(b, a - w / 2 + 0.1, y0 - 0.02, 0.06, a + w / 2 - 0.1, y0 + 0.08, 0.6, { skip: 'K' });
  const yb = y0 + 0.08;
  if (t === 'baker') {
    for (let i = 0; i < 5; i++) { b.begin(M.TILE, 0.25 + rng.next() * 0.3); lathe(b, a - w / 2 + 0.3 + i * 0.32, yb, 0.33, [[0.13, 0], [0.13, 0.07], [0.08, 0.14], [0, 0.16]], 7); }
    b.begin(M.PLANK, g.r()); lathe(b, a + w / 2 - 0.25, yb, 0.33, [[0.2, 0], [0.24, 0.12], [0, 0.12]], 8);
  } else if (t === 'apothecary') {
    for (let i = 0; i < 6; i++) { b.begin(rng.pick([M.COPPER, M.ACCENT, M.TILE, M.WATER]), 0.6); const x = a - w / 2 + 0.25 + i * 0.27; lathe(b, x, yb, 0.3, [[0.08, 0], [0.09, 0.16], [0.03, 0.22], [0.03, 0.3], [0, 0.3]], 6); }
    if (!Q.low) { b.begin(M.GRASS, 0.2); for (const s of [-1, 1]) { const x = a + s * (w / 2 - 0.3); beam(b, [x, y0 + h + 0.32, 0.55], [x, y0 + h - 0.05, 0.55], 0.03); lathe(b, x, y0 + h - 0.35, 0.55, [[0.02, 0], [0.12, 0.12], [0.06, 0.3], [0, 0.32]], 5); } }
  } else if (t === 'tailor') {
    for (let i = 0; i < 4; i++) { b.begin(rng.pick([M.ACCENT, M.WATER, M.GRASS, M.PLASTER, M.SLATE]), 0.6); const x = a - w / 2 + 0.3 + i * 0.42; box(b, x - 0.16, yb, 0.15, x + 0.16, yb + 0.14, 0.5); }
    b.begin(M.ACCENT, 0.6); box(b, a - 0.12, yb + 0.14, 0.2, a + 0.2, yb + 0.26, 0.45);
  } else if (t === 'chandler') {
    for (let i = 0; i < 7; i++) { b.begin(M.PLASTER, 0.9); const x = a - w / 2 + 0.25 + i * 0.23; lathe(b, x, yb, 0.33, [[0.05, 0], [0.05, 0.25 + (i % 3) * 0.08], [0, 0.27 + (i % 3) * 0.08]], 5); }
    if (!Q.low) { b.begin(M.PLASTER, 0.8); for (const s of [-1, 1]) { const x = a + s * (w / 2 - 0.25); for (let k = -1; k <= 1; k++) beam(b, [x + k * 0.06, y0 + h + 0.3, 0.55], [x + k * 0.06, y0 + h - 0.15, 0.55], 0.04); } }
  } else {
    for (let i = 0; i < 4; i++) { b.begin(rng.pick([M.TILE, M.GRASS, M.ACCENT]), g.r()); lathe(b, a - w / 2 + 0.35 + i * 0.42, yb, 0.32, [[0.12, 0], [0.14, 0.08], [0, 0.17]], 6); }
  }
  g.awning(a, y0 + h + 0.4, w + 0.5, 0.9);
  b.begin(g.tier === 0 ? M.ACCENT : M.TIMBER, g.tier === 0 ? 0.7 : g.r()); box(b, a - 0.85, y0 + h + 0.95, 0, a + 0.85, y0 + h + 1.4, 0.08, { skip: 'K' });
  if (!Q.low) b.with(([x, y, z]) => [a + x * 0.38, y0 + h + 1.175 + y * 0.38, 0.09 + z], () => drawIcon(g, t, 0.65, g.tier === 0));
}

/** A big mullioned window with a loom inside it: dark room, loom frame and warp, then the glazing bars. */
function loomWindow(g: Gen, a: number, y: number, w: number, h: number) {
  const b = g.b;
  b.begin(M.DOOR, 0.05); box(b, a - w / 2, y, 0, a + w / 2, y + h, 0.02, { skip: 'K' });
  b.begin(M.TIMBER, g.r()); // loom
  for (const s of [-1, 1]) beam(b, [a + s * w * 0.32, y, 0.06], [a + s * w * 0.32, y + h * 0.9, 0.06], 0.07);
  for (const yy of [0.25, 0.8]) beam(b, [a - w * 0.36, y + h * yy, 0.07], [a + w * 0.36, y + h * yy, 0.07], 0.06);
  b.begin(M.PLASTER, 0.9);
  const nWarp = Q.low ? 5 : 11;
  for (let i = 0; i < nWarp; i++) { const x = a - w * 0.28 + (i / (nWarp - 1)) * w * 0.56; box(b, x - 0.012, y + h * 0.27, 0.075, x + 0.012, y + h * 0.78, 0.085); }
  b.begin(M.ACCENT, 0.6); box(b, a - w * 0.28, y + h * 0.27, 0.07, a + w * 0.28, y + h * 0.45, 0.09); // the woven cloth
  b.begin(M.TIMBER, g.r()); // glazing bars + frame
  for (const s of [-1, 1]) box(b, a + s * w / 2 - 0.08, y, 0, a + s * w / 2 + 0.08, y + h, 0.16, { skip: 'K' });
  box(b, a - w / 2 - 0.08, y + h, 0, a + w / 2 + 0.08, y + h + 0.14, 0.16, { skip: 'K' });
  for (const x of [-w / 6, w / 6]) box(b, a + x - 0.03, y, 0.12, a + x + 0.03, y + h, 0.16);
  box(b, a - w / 2, y + h * 0.55 - 0.03, 0.12, a + w / 2, y + h * 0.55 + 0.03, 0.16);
  b.begin(M.STONE, g.r()); box(b, a - w / 2 - 0.15, y - 0.14, 0, a + w / 2 + 0.15, y, 0.24, { skip: 'K' });
}

// ------------------------------------------------------------------ workshop dressing

/**
 * Trade fittings around the ground block (lot-local space; call after the tower is built, inside L.xf).
 * Picks a free side face for big fittings (oven, forge, workshop doors, barrel stacks).
 */
export function dressTrade(g: Gen, site: Site, L: Lot, t: Trade, nearFaces: string) {
  if (t === 'none' || !L.blocks.length) return;
  const b = g.b, k = L.blocks[0];
  const rng = new RNG(hashSeed(g.tseed, 0x7ad3));
  const free = (f: Face) => !g.flush.includes(f) && !nearFaces.includes(f);
  const sides = (['R', 'L', 'K'] as Face[]).filter(free);
  const side: Face | null = sides.length ? (sides.length > 1 && rng.chance(0.5) ? sides[1] : sides[0]) : null;
  const len = (f: Face) => (f === 'F' || f === 'K' ? k.w : k.d);
  const onFace = (f: Face, cb: (len: number, gy: (a: number, n: number) => number) => void) =>
    b.with(k.xf, () => b.with(faceXf(f, k.w, k.d), () => {
      const gy = (a: number, n: number) => { const p = b.xf([a, 0, n]); return site.H(p[0], p[2]) - k.y0; };
      cb(len(f), gy);
    }));
  const front = !g.flush.includes('F');
    // sign by the door (or by the close's arch)
  if (front) onFace('F', (l) => {
    const doorA = g.closeArch ? 0 : g.shopSide ? g.shopSide * (l / 2 - 0.95) : 0;
    const off = g.closeArch ? g.closeArch.w / 2 + 0.75 : 0.95;
    const sA = clamp(doorA + (doorA > 0 ? -off : off), -l / 2 + 0.35, l / 2 - 0.35);
    tradeSign(g, sA, 2.95, t, t === 'tavern');
  });
  const at = (f: Face | null, cb: (len: number, gy: (a: number, n: number) => number) => void) => { if (f) onFace(f, cb); };
  switch (t) {
    case 'baker': at(side, (l) => breadOven(g, -l / 2 + 1.1)); break;
    case 'smith': at(side, (l) => forge(g, l / 2 - 1.2)); if (front) onFace('F', (l) => anvil(g, -(g.shopSide || 1) * (l / 2 - 0.6), 0.45)); break;
    case 'weaver': if (!g.shopSide) at(side, (l) => loomWindow(g, 0, 0.55, Math.min(1.9, l - 1.2), 1.5)); break;
    case 'cooper': at(side ?? (front ? 'F' : null), (l) => barrels(g, side ? 0 : -l / 2 + 0.9, Math.min(l - 0.8, 2.6))); break;
    case 'tailor': if (side && !Q.low) at(side, (l) => clothLine(g, l)); break;
    case 'apothecary': case 'chandler': if (side && !Q.low) at(side, () => skep(g, 0)); break;
    case 'carpenter': at(side, (l, gy) => workshopDoors(g, l, gy)); break;
    case 'mason': at(side ?? (front ? 'F' : null), (l) => banker(g, side ? 0 : l / 2 - 0.9)); break;
    case 'potter': at(side, (l) => potShelf(g, l)); break;
    case 'granary': if (front) onFace('F', (l) => sacks(g, l / 2 - 0.7)); break;
    case 'tavern': if (front) onFace('F', (l) => barrelRack(g, -(g.shopSide || 1) * (l / 2 - 0.85))); break;
  }
}

const clamp = (x: number, a: number, b: number) => Math.max(a, Math.min(b, x));

const BARREL: [number, number][] = [[0.24, 0], [0.3, 0.2], [0.3, 0.45], [0.24, 0.65], [0, 0.65]];
function barrel(g: Gen, x: number, y: number, z: number) {
  const b = g.b;
  b.begin(M.PLANK, g.r());
  lathe(b, x, y, z, BARREL, Q.low ? 6 : 8);
  if (Q.low) return;
  b.begin(M.IRON, g.r());
  for (const hy of [0.12, 0.5]) lathe(b, x, y + hy, z, [[0.29, 0], [0.31, 0.04], [0.29, 0.06]], 8);
}
/** A barrel on its side centred at (a, yc, n); axis along the wall (alongA) or pointing out of it. */
function lyingBarrel(g: Gen, a: number, yc: number, n: number, alongA: boolean) {
  const b = g.b;
  b.begin(M.PLANK, g.r());
  b.with(([px, py, pz]) => (alongA ? [a + py - 0.325, yc + px, n + pz] : [a + px, yc + pz, n + py - 0.325]), () => lathe(b, 0, 0, 0, BARREL, Q.low ? 6 : 8));
}

function breadOven(g: Gen, a: number) {
  const b = g.b, r = 0.9;
  b.begin(M.STONE, g.r()); box(b, a - r - 0.1, 0, 0, a + r + 0.1, 0.55, r + 0.35, { skip: 'K' });
  b.begin(M.BRICK, g.r()); lathe(b, a, 0.55, 0.35, [[r, 0], [r * 0.95, r * 0.4], [r * 0.7, r * 0.75], [r * 0.35, r * 0.95], [0.01, r]], Q.low ? 8 : 12);
  b.begin(M.IRON, 0.995); // glowing mouth
  b.quad([a - 0.28, 0.6, r + 0.33], [a + 0.28, 0.6, r + 0.33], [a + 0.22, 1.0, r + 0.25], [a - 0.22, 1.0, r + 0.25], [[0, 0], [1, 0], [1, 1], [0, 1]]);
  b.begin(M.BRICK, g.r()); box(b, a - 0.2, 1.2, 0.05, a + 0.2, 3.2, 0.45);
  b.begin(M.TILE, g.r()); lathe(b, a, 3.2, 0.25, [[0.12, 0], [0.11, 0.4], [0.14, 0.45], [0.09, 0.5]], 6);
  g.smoke.push(b.xf([a, 3.9, 0.25]));
  b.begin(M.TIMBER, g.r()); beam(b, [a + r + 0.2, 0, r + 0.5], [a + r + 0.05, 1.9, 0.1], 0.06); // peel leaning on it
  b.begin(M.TIMBER, g.r()); box(b, a + r - 0.1, 1.85, 0.0, a + r + 0.2, 2.15, 0.08);
}

function forge(g: Gen, a: number) {
  const b = g.b;
  b.begin(M.BRICK, g.r()); box(b, a - 0.8, 0, 0, a + 0.8, 0.95, 1.0, { skip: 'K' });
  b.begin(M.GLASS, 0.996); // the fire, seen through the hearth opening: always lit
  box(b, a - 0.4, 0.45, 0, a + 0.4, 0.85, 1.02, { norm: 'F', skip: 'K' });
  b.begin(M.BRICK, g.r()); // hood narrowing into a tall stack up the wall
  b.quad([a - 0.85, 1.6, 1.05], [a + 0.85, 1.6, 1.05], [a + 0.35, 2.5, 0.5], [a - 0.35, 2.5, 0.5], [[0, 0], [1.7, 0], [1.2, 1], [0.5, 1]]);
  for (const s of [-1, 1]) b.quad([a + s * 0.85, 1.6, 1.05], [a + s * 0.85, 1.6, 0], [a + s * 0.35, 2.5, 0], [a + s * 0.35, 2.5, 0.5], [[0, 0], [1, 0], [1, 1], [0, 1]]);
  b.begin(M.BRICK, g.r()); box(b, a - 0.35, 2.5, 0, a + 0.35, 5.4, 0.5);
  b.begin(M.STONE, g.r()); box(b, a - 0.45, 5.4, -0.05, a + 0.45, 5.55, 0.6);
  g.smoke.push(b.xf([a, 6.1, 0.25]), b.xf([a, 6.1, 0.25]));
  b.begin(M.TIMBER, g.r()); for (const s of [-1, 1]) beam(b, [a + s * 0.8, 0.95, 1.0], [a + s * 0.8, 1.6, 1.05], 0.1);
  if (!Q.low) { b.begin(M.PLANK, g.r()); lathe(b, a + 1.2, 0, 0.6, [[0.35, 0], [0.38, 0.5], [0.0, 0.5]], 8); b.begin(M.WATER, 0.5); lathe(b, a + 1.2, 0.48, 0.6, [[0.33, 0], [0, 0]], 8); } // quench tub
}

function anvil(g: Gen, a: number, n: number) {
  const b = g.b;
  b.begin(M.TIMBER, g.r()); lathe(b, a, 0, n, [[0.2, 0], [0.2, 0.45], [0, 0.45]], 7);
  b.begin(M.IRON, g.r());
  box(b, a - 0.1, 0.45, n - 0.08, a + 0.1, 0.6, n + 0.08);
  box(b, a - 0.24, 0.6, n - 0.1, a + 0.18, 0.75, n + 0.1);
  beam(b, [a + 0.18, 0.7, n], [a + 0.38, 0.72, n], 0.1, 0.06);
}

function barrels(g: Gen, a: number, span: number) {
  const n = Math.max(2, Math.floor(span / 0.62));
  for (let i = 0; i < n; i++) barrel(g, a - span / 2 + 0.31 + i * 0.62, 0, 0.42);
  if (Q.low) return;
  for (let i = 0; i < n - 1; i++) { // second tier on planks
    const b = g.b; if (i === 0) { b.begin(M.PLANK, g.r()); box(g.b, a - span / 2 + 0.2, 0.65, 0.15, a + span / 2 - 0.2, 0.7, 0.7); }
    barrel(g, a - span / 2 + 0.62 + i * 0.62, 0.7, 0.42);
  }
  const b = g.b; b.begin(M.IRON, g.r()); // spare hoops on the wall
  for (const dx of [-0.3, 0.3]) lathe(b, a + dx, 1.85, 0.02, [[0.3, 0], [0.31, 0.03], [0.3, 0.05]], 8);
}

function clothLine(g: Gen, l: number) {
  const b = g.b, y = 2.4;
  b.begin(M.TIMBER, g.r()); beam(b, [-l / 2 + 0.6, y, 0.05], [-l / 2 + 0.6, y, 0.9], 0.07); beam(b, [l / 2 - 0.6, y, 0.05], [l / 2 - 0.6, y, 0.9], 0.07);
  beam(b, [-l / 2 + 0.6, y, 0.85], [l / 2 - 0.6, y, 0.85], 0.03);
  const n = Math.max(2, Math.floor((l - 1.4) / 0.55));
  for (let i = 0; i < n; i++) {
    b.begin(g.rng.pick([M.ACCENT, M.WATER, M.PLASTER, M.GRASS, M.COPPER]), 0.6);
    const x = -l / 2 + 0.9 + i * 0.55, hh = 0.9 + (i % 3) * 0.25;
    box(b, x - 0.2, y - hh, 0.83, x + 0.2, y, 0.87);
  }
}

function skep(g: Gen, a: number) { // straw beehive on a little shelf (chandlers and apothecaries keep bees)
  const b = g.b;
  b.begin(M.TIMBER, g.r()); box(b, a - 0.4, 0.9, 0, a + 0.4, 0.98, 0.6, { skip: 'K' });
  for (const s of [-1, 1]) beam(b, [a + s * 0.3, 0.4, 0.02], [a + s * 0.3, 0.92, 0.5], 0.05);
  b.begin(M.PLASTER, 0.4); lathe(b, a, 0.98, 0.3, [[0.32, 0], [0.33, 0.15], [0.26, 0.38], [0.12, 0.52], [0, 0.55]], 8);
}

function workshopDoors(g: Gen, l: number, gy: (a: number, n: number) => number) {
  const b = g.b, w = Math.min(2.6, l - 0.8), h = 2.5;
  b.begin(M.STONE, g.r()); box(b, -w / 2 - 0.2, 0, 0, w / 2 + 0.2, h + 0.3, 0.06, { skip: 'K' });
  for (const s of [-1, 1]) { // two leaves hinged at the jambs; the right one stands ajar
    const phi = s > 0 ? -0.5 : 0, hx = s * w / 2, c = Math.cos(phi), sn = Math.sin(phi);
    b.with(([x, y, z]) => { const dx = x - hx; return [hx + dx * c - z * sn, y, 0.08 + dx * sn + z * c]; }, () => {
      b.begin(M.DOOR, g.r()); box(b, s > 0 ? 0 : -w / 2, 0, 0, s > 0 ? w / 2 : 0, h, 0.06, { norm: 'F' });
      b.begin(M.TIMBER, g.r());
      const x0 = s > 0 ? 0.08 : -w / 2 + 0.08, x1 = s > 0 ? w / 2 - 0.08 : -0.08;
      for (const yy of [0.3, h - 0.3]) box(b, x0, yy - 0.07, 0.06, x1, yy + 0.07, 0.1);
      beam(b, [x0, 0.35, 0.09], [x1, h - 0.35, 0.09], 0.12, 0.04);
    });
  }
  b.begin(M.TIMBER, g.r()); box(b, -w / 2 - 0.25, h, 0, w / 2 + 0.25, h + 0.25, 0.2, { skip: 'K' });
  // saw-horse with a plank on it, out in the yard
  const n = 1.6, y0 = Math.min(0, gy(0, n));
  b.begin(M.TIMBER, g.r());
  for (const s of [-0.55, 0.55]) { beam(b, [s, y0, n - 0.3], [s, y0 + 0.7, n], 0.06); beam(b, [s, y0, n + 0.3], [s, y0 + 0.7, n], 0.06); }
  beam(b, [-0.65, y0 + 0.72, n], [0.65, y0 + 0.72, n], 0.1);
  b.begin(M.PLANK, g.r()); box(b, -1.1, y0 + 0.77, n - 0.18, 1.0, y0 + 0.83, n + 0.18);
  if (!Q.low) { // planks leaning against the wall
    for (let i = 0; i < 4; i++) { b.begin(M.PLANK, g.r()); const x = w / 2 + 0.35 + i * 0.12; if (x > l / 2 - 0.1) break; beam(b, [x, 0, 0.55], [x - 0.05, 2.2, 0.08], 0.22, 0.05); }
  }
}

function banker(g: Gen, a: number) {
  const b = g.b;
  b.begin(M.STONE, g.r()); for (const s of [-0.45, 0.45]) box(b, a + s - 0.15, 0, 0.4, a + s + 0.15, 0.7, 0.9);
  b.begin(M.STONE, g.r()); box(b, a - 0.7, 0.7, 0.3, a + 0.7, 0.85, 1.0);
  b.begin(M.STONE, g.r()); box(b, a - 0.3, 0.85, 0.45, a + 0.25, 1.25, 0.85); // block being dressed
  b.begin(M.STONE, g.r()); lathe(b, a + 0.5, 0.85, 0.6, [[0.12, 0], [0.12, 0.25], [0.18, 0.3], [0.08, 0.4], [0.0, 0.55]], 6); // carved finial sample
}

function potShelf(g: Gen, l: number) {
  const b = g.b, w = Math.min(2.4, l - 1.0);
  for (const y of [0.9, 1.6]) {
    b.begin(M.PLANK, g.r()); box(b, -w / 2, y, 0, w / 2, y + 0.06, 0.45, { skip: 'K' });
    b.begin(M.TIMBER, g.r()); for (const s of [-1, 1]) beam(b, [s * (w / 2 - 0.15), y - 0.35, 0.02], [s * (w / 2 - 0.15), y, 0.4], 0.05);
    const n = Math.floor(w / 0.34);
    for (let i = 0; i < n; i++) {
      b.begin(g.rng.chance(0.7) ? M.TILE : M.COPPER, g.r());
      const x = -w / 2 + 0.2 + i * 0.34, hh = 0.25 + (i % 3) * 0.07;
      lathe(b, x, y + 0.06, 0.22, [[0.08, 0], [0.13, hh * 0.45], [0.06, hh * 0.85], [0.08, hh], [0, hh]], 6);
    }
  }
}

function sacks(g: Gen, a: number) {
  const b = g.b;
  for (let i = 0; i < (Q.low ? 2 : 4); i++) {
    b.begin(M.PLASTER, 0.3 + (i % 2) * 0.2);
    const x = a - (i % 3) * 0.42 + (i > 2 ? 0.2 : 0), y = i > 2 ? 0.45 : 0;
    lathe(b, x, y, 0.45, [[0.18, 0], [0.24, 0.12], [0.22, 0.42], [0.1, 0.55], [0.04, 0.62], [0, 0.62]], 7);
  }
}

function barrelRack(g: Gen, a: number) {
  const b = g.b, w = 1.5;
  b.begin(M.TIMBER, g.r());
  for (const s of [-1, 1]) { beam(b, [a + s * w / 2, 0, 0.25], [a + s * w / 2, 0.75, 0.25], 0.08); beam(b, [a + s * w / 2, 0, 0.6], [a + s * w / 2, 0.75, 0.6], 0.08); }
  for (const z of [0.25, 0.6]) beam(b, [a - w / 2, 0.42, z], [a + w / 2, 0.42, z], 0.07);
  for (let i = 0; i < 2; i++) lyingBarrel(g, a - w / 4 + i * (w / 2), 0.72, 0.42, false); // ends out
  if (!Q.low) lyingBarrel(g, a, 1.22, 0.42, false);
  if (!Q.low) barrel(g, a + w / 2 + 0.45, 0, 0.42);
}

/**
 * A granary's hoist loft (lucam): a gabled timber box pushed out through the eaves with a loft door,
 * a hoist beam out of its gable, pulley, rope and a sack on the way up. Face-local; y=0 at the wall top.
 */
export function hayloft(g: Gen, drop: number) {
  const b = g.b, w = 1.5, dep = 0.95, y0 = -1.9, y1 = 0.6;
  b.begin(M.PLANK, g.r()); box(b, -w / 2, y0, 0, w / 2, y1, dep, { skip: 'K' });
  b.begin(M.TIMBER, g.r());
  for (const s of [-1, 1]) beam(b, [s * 0.55, y0 - 0.9, 0.02], [s * 0.55, y0 - 0.02, dep - 0.12], 0.12);
  box(b, -w / 2 - 0.04, y0 - 0.12, 0, w / 2 + 0.04, y0, dep + 0.06);
  b.begin(M.DOOR, g.r()); box(b, -0.5, y0 + 0.15, dep, 0.5, y0 + 1.75, dep + 0.05, { norm: 'F', skip: 'K' });
  gableZ(b, -w / 2, w / 2, 0, dep, y1, 0.75, 0.22, M.PLANK, g.noTiles ? M.PLANK : M.SLATE, g.r());
  b.begin(M.TIMBER, g.r()); beam(b, [0, y1 + 0.42, 0.1], [0, y1 + 0.42, dep + 1.1], 0.18);
  b.begin(M.IRON, g.r()); lathe(b, 0, y1 + 0.12, dep + 0.95, [[0.14, 0], [0.14, 0.18], [0, 0.18]], 8);
  const yr = y1 + 0.15 - drop;
  beam(b, [0.02, y1 + 0.15, dep + 0.95], [0.02, yr, dep + 0.95], 0.02);
  b.begin(M.PLASTER, 0.35); lathe(b, 0, yr - 0.7, dep + 0.95, [[0.16, 0], [0.22, 0.15], [0.2, 0.5], [0.06, 0.66], [0, 0.7]], 7);
}
