/**
 * What a building knows about its surroundings when it is built: who it shares walls with (and how
 * tall they are), who stands close by across a narrow gap, which terrace it belongs to, and its
 * condition tier. World computes this (`neighbourCtx`) and passes it to `buildBuilding`.
 */
import type { V3 } from './builder';
import type { BSpec, Face } from './tower';

/** A neighbour sharing one of our walls. `top`: its natural wall-top height (world y, roof excluded), null if not built yet. */
export interface FlushNb { face: Face; id: number; top: number | null }

/** A neighbour standing close (not touching) across one of our faces: room for a stepped alley. */
export interface NearNb {
  id: number;
  /** our face that looks at it (lot-local) */
  face: Face;
  /** clear gap between the walls */
  gap: number;
  /** stretch along our face (face-local `a`) that both walls share */
  a0: number; a1: number;
  /** its natural wall-top (world y) and foundation top, null/NaN if unknown */
  top: number | null; base: number;
}

/**
 * A walk-through passage reported for navigation: a close through a terrace house's ground floor or
 * a stepped alley between two close houses. `pts` is the walking line (world space, floor level),
 * end to end; `width` its clear width.
 */
export interface Passage { kind: 'close' | 'alley'; pts: V3[]; width: number; /** buildings it runs between/through */ ids: number[] }

export interface BuildCtx {
  flushNb: FlushNb[];
  near: NearNb[];
  /** set when this house stands in a side-by-side terrace: roof pitch/material come from the oldest member */
  terrace: { seed: number; d: number } | null;
  /** condition tier (see ageing.ts): 0 thriving … 3 derelict */
  tier: number;
}

export const NO_CTX: BuildCtx = { flushNb: [], near: [], terrace: null, tier: 1 };

/** Stable string for change detection (rebuild neighbours only when what they see changed). */
export function ctxKey(c: BuildCtx) {
  const r = (v: number | null) => (v === null ? 'n' : v.toFixed(2));
  return [c.tier, c.terrace ? c.terrace.seed + ':' + c.terrace.d.toFixed(2) : '-',
    c.flushNb.map((f) => `${f.face}${f.id}@${r(f.top)}`).join(','),
    c.near.map((n) => `${n.face}${n.id}@${r(n.top)}/${n.gap.toFixed(2)}`).join(',')].join('|');
}

const quarterOff = (a: number, b: number) => { const q = Math.PI / 2; const d = (((a - b) % q) + q) % q; return Math.min(d, q - d); };

/**
 * Work out a building's neighbourhood.
 * @param flushWith which of s's faces touch o (World.flushOf restricted to o)
 * @param info natural wall-top and foundation top of a built neighbour, or null
 * @param bespoke roles that never join terraces or alleys (landmarks)
 */
export function neighbourCtx(s: BSpec, specs: BSpec[], flushWith: (s: BSpec, o: BSpec) => string,
  info: (id: number) => { top: number; base: number } | null, tier: number, bespoke: (o: BSpec) => boolean): BuildCtx {
  const ctx: BuildCtx = { flushNb: [], near: [], terrace: null, tier };
  if (bespoke(s)) return ctx;
  const c = Math.cos(s.rot), sn = Math.sin(s.rot);
  const local = (x: number, z: number): [number, number] => { const dx = x - s.x, dz = z - s.z; return [dx * c + dz * sn, -dx * sn + dz * c]; };
  const others = specs.filter((o) => o.id !== s.id && !bespoke(o));
  for (const o of others) {
    const f = flushWith(s, o);
    if (f) for (const face of f) ctx.flushNb.push({ face: face as Face, id: o.id, top: info(o.id)?.top ?? null });
  }
  /** is a world point inside any other building's footprint (a little grown)? */
  const blocked = (x: number, z: number, skip: number) => specs.some((q) => {
    if (q.id === s.id || q.id === skip) return false;
    const qc = Math.cos(q.rot), qs = Math.sin(q.rot), dx = x - q.x, dz = z - q.z;
    return Math.abs(dx * qc + dz * qs) < q.w / 2 + 0.3 && Math.abs(-dx * qs + dz * qc) < q.d / 2 + 0.3;
  });
  for (const o of others) {
    if (ctx.flushNb.some((f) => f.id === o.id)) continue;
    if (Math.hypot(o.x - s.x, o.z - s.z) > (Math.hypot(s.w, s.d) + Math.hypot(o.w, o.d)) / 2 + 4.6) continue;
    if (quarterOff(o.rot, s.rot) > 0.3) continue;
    const oc = Math.cos(o.rot), osn = Math.sin(o.rot);
    const pts = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([i, j]) => local(o.x + (i * o.w / 2) * oc - (j * o.d / 2) * osn, o.z + (i * o.w / 2) * osn + (j * o.d / 2) * oc));
    const xs = pts.map((p) => p[0]), zs = pts.map((p) => p[1]);
    const cands: { face: Face; gap: number; lo: number; hi: number }[] = [
      { face: 'R', gap: Math.min(...xs) - s.w / 2, lo: Math.max(-s.d / 2, Math.min(...zs)), hi: Math.min(s.d / 2, Math.max(...zs)) },
      { face: 'L', gap: -s.w / 2 - Math.max(...xs), lo: Math.max(-s.d / 2, Math.min(...zs)), hi: Math.min(s.d / 2, Math.max(...zs)) },
      { face: 'F', gap: Math.min(...zs) - s.d / 2, lo: Math.max(-s.w / 2, Math.min(...xs)), hi: Math.min(s.w / 2, Math.max(...xs)) },
      { face: 'K', gap: -s.d / 2 - Math.max(...zs), lo: Math.max(-s.w / 2, Math.min(...xs)), hi: Math.min(s.w / 2, Math.max(...xs)) },
    ];
    for (const k of cands) {
      if (k.gap < 1.0 || k.gap > 4.5 || k.hi - k.lo < 1.8) continue;
      if (ctx.flushNb.some((f) => f.face === k.face)) continue; // a party wall on that side: nothing in between
      // the gap itself must be open ground (no third building standing in it)
      const mid = (k.lo + k.hi) / 2, off = (k.face === 'R' || k.face === 'F' ? 1 : -1) * ((k.face === 'R' || k.face === 'L' ? s.w : s.d) / 2 + k.gap / 2);
      const [lx, lz] = k.face === 'R' || k.face === 'L' ? [off, mid] : [mid, off];
      if (blocked(s.x + lx * c - lz * sn, s.z + lx * sn + lz * c, o.id)) continue;
      // face-local `a` runs left→right seen from outside: F: +x, K: -x, R: -z, L: +z
      const [a0, a1] = k.face === 'F' ? [k.lo, k.hi] : k.face === 'K' ? [-k.hi, -k.lo] : k.face === 'R' ? [-k.hi, -k.lo] : [k.lo, k.hi];
      const inf = info(o.id);
      ctx.near.push({ id: o.id, face: k.face, gap: k.gap, a0, a1, top: inf?.top ?? null, base: inf?.base ?? NaN });
      break;
    }
  }
  // terrace: the oldest house of the side-by-side run sets the roof
  if (ctx.flushNb.some((f) => f.face === 'R' || f.face === 'L')) {
    const seen = new Set([s.id]), queue = [s];
    let oldest = s;
    while (queue.length) {
      const q = queue.pop()!;
      for (const o of specs) {
        if (seen.has(o.id) || bespoke(o)) continue;
        if (!/[RL]/.test(flushWith(q, o))) continue;
        seen.add(o.id); queue.push(o);
        if (o.id < oldest.id) oldest = o;
      }
    }
    ctx.terrace = { seed: oldest.seed, d: oldest.d };
  }
  return ctx;
}
