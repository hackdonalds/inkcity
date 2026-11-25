import * as THREE from 'three';
import { Builder, M, box } from './builder';
import type { Built, Leaf } from './tower';
import type { World } from './world';
import { doorGeom } from './nav';
import { Q } from './quality';

/**
 * Doors, shutters and casements. The building grammar records hinged leaves instead of baking them;
 * here every building gets one small mesh holding all its leaves, swung on the CPU (only leaves that
 * move are rewritten). Doors open when citizens come and go, shutters open in the morning and close
 * at dusk (or in a storm), and now and then somebody throws a casement window open.
 */
interface LeafRec {
  l: Leaf; start: number; count: number; local: Float32Array;
  p: THREE.Vector3; a: THREE.Vector3; u: THREE.Vector3; n: THREE.Vector3;
  ang: number; target: number; max: number; speed: number; phase: number; timer: number;
}
interface BRec { built: object; mesh: THREE.Mesh; recs: LeafRec[]; dirty: boolean }

const OPEN = { door: 1.45, shutter: Math.PI - 0.06, casement: 1.25 };

export class Fixtures {
  group = new THREE.Group();
  private bs = new Map<number, BRec>();
  private byLeaf = new Map<Leaf, LeafRec>();
  private nid = 0;
  private acc = 0;

  constructor(private mat: () => THREE.Material | null, private neutral: (m: THREE.Mesh) => void) {}

  private make(id: number, built: Built & { mesh: THREE.Mesh }): BRec {
    const b = new Builder(450_000_000 + (this.nid++ % 4000) * 4000);
    const recs: LeafRec[] = [];
    let at = 0;
    built.leaves.forEach((l, i) => {
      if (Q.low && l.kind === 'casement') return;
      const g = doorGeom(l);
      const w = g.w, h = l.u[1] - l.p[1];
      const v0 = b.P.length;
      if (l.kind === 'door') {
        b.begin(M.DOOR, l.vari); box(b, 0, 0, 0, w, h, 0.06, { norm: 'FK' });
      } else if (l.kind === 'shutter') {
        b.begin(M.ACCENT, l.vari); box(b, 0, 0, 0.01, w, h, 0.06);
      } else {
        b.begin(M.GLASS, l.vari); box(b, 0, 0, 0, w, h, 0.04, { mats: { R: M.TIMBER, L: M.TIMBER, T: M.TIMBER, B: M.TIMBER }, norm: 'FK' });
      }
      const count = (b.P.length - v0) / 3;
      const u = new THREE.Vector3(l.u[0] - l.p[0], l.u[1] - l.p[1], l.u[2] - l.p[2]).normalize();
      const rec: LeafRec = {
        l, start: at, count, local: new Float32Array(b.P.slice(v0)),
        p: new THREE.Vector3(...l.p), a: new THREE.Vector3(...g.a), u, n: new THREE.Vector3(...g.n),
        ang: l.kind === 'shutter' ? l.max ?? OPEN.shutter : 0, target: 0, max: l.max ?? OPEN[l.kind], speed: l.kind === 'door' ? 2.6 : l.kind === 'shutter' ? 2.2 : 1.4,
        phase: ((Math.sin((id * 131 + Math.floor(i / 2)) * 12.9898) * 43758.5453) % 1 + 1) % 1, timer: 0,
      };
      recs.push(rec);
      at += count;
    });
    const geo = b.build();
    const mesh = new THREE.Mesh(geo, this.mat()!);
    const bm = built.mesh;
    this.neutral(mesh);
    const neutralHook = mesh.onBeforeRender;
    // borrow the building's per-object uniforms (sway, reveal, construction sketch) when it has them
    mesh.onBeforeRender = (...args) => { if (bm?.userData.hooked) bm.onBeforeRender(...args); else neutralHook.apply(mesh, args); };
    geo.boundingSphere = built.geo.boundingSphere?.clone() ?? null;
    if (geo.boundingSphere) geo.boundingSphere.radius += 2;
    const r: BRec = { built, mesh, recs, dirty: true };
    for (const q of recs) { this.byLeaf.set(q.l, q); this.place(r, q); }
    this.group.add(mesh);
    return r;
  }

  private drop(r: BRec) {
    this.group.remove(r.mesh); r.mesh.geometry.dispose();
    for (const q of r.recs) this.byLeaf.delete(q.l);
  }

  clear() { for (const r of this.bs.values()) this.drop(r); this.bs.clear(); }

  /** Keep one leaf mesh per building in step with the world. */
  sync(world: World) {
    if (!this.mat()) return;
    for (const [id, r] of [...this.bs]) if (world.built.get(id) !== r.built) { this.drop(r); this.bs.delete(id); }
    for (const [id, b] of world.built) if (!this.bs.has(id) && b.leaves?.length) this.bs.set(id, this.make(id, b));
  }

  /** Swing a door open for a while (it closes by itself). */
  open(l: Leaf | undefined, secs = 2.5) { const q = l && this.byLeaf.get(l); if (q) q.timer = Math.max(q.timer, secs); }
  isOpen(l: Leaf | undefined) { const q = l && this.byLeaf.get(l); return !!q && q.ang > 0.9; }

  update(dt: number, world: World, tod: number, rain: number) {
    this.sync(world);
    this.acc += dt;
    const day = tod < 0.66 || tod > 0.985;
    // somebody opens a casement now and then
    if (day && rain < 0.3 && Math.random() < dt * 0.25 && this.bs.size) {
      const all = [...this.bs.values()];
      const r = all[Math.floor(Math.random() * all.length)];
      const cs = r.recs.filter((q) => q.l.kind === 'casement');
      if (cs.length) { const q = cs[Math.floor(Math.random() * cs.length)]; q.timer = 25 + Math.random() * 50; const mate = r.recs[r.recs.indexOf(q) + (r.recs.indexOf(q) % 2 ? -1 : 1)]; if (mate?.l.kind === 'casement') mate.timer = q.timer; }
    }
    for (const r of this.bs.values()) {
      for (const q of r.recs) {
        if (q.l.kind === 'shutter') {
          const openAt = 0.015 + q.phase * 0.09, closeAt = 0.64 + q.phase * 0.09;
          q.target = tod >= openAt && tod < closeAt && rain < 0.75 ? q.max : 0;
        } else {
          if (q.timer > 0) q.timer -= dt;
          q.target = q.timer > 0 && (q.l.kind === 'door' || (day && rain < 0.5)) ? q.max : 0;
        }
        if (q.ang !== q.target) {
          const d = q.target - q.ang, s = q.speed * dt;
          q.ang = Math.abs(d) <= s ? q.target : q.ang + Math.sign(d) * s;
          this.place(r, q);
        }
      }
      if (r.dirty) { (r.mesh.geometry.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true; r.dirty = false; }
    }
  }

  private place(r: BRec, q: LeafRec) {
    const P = r.mesh.geometry.getAttribute('position').array as Float32Array;
    const c = Math.cos(q.ang), s = Math.sin(q.ang);
    const hide = q.l.kind === 'casement' && q.ang < 0.02;
    for (let k = 0; k < q.count; k++) {
      const x = q.local[k * 3], y = q.local[k * 3 + 1], z = q.local[k * 3 + 2];
      const ax = hide ? 0 : x * c - z * s, nz = hide ? 0 : x * s + z * c, yy = hide ? 0 : y;
      const o = (q.start + k) * 3;
      P[o] = q.p.x + q.a.x * ax + q.u.x * yy + q.n.x * nz;
      P[o + 1] = q.p.y + q.a.y * ax + q.u.y * yy + q.n.y * nz;
      P[o + 2] = q.p.z + q.a.z * ax + q.u.z * yy + q.n.z * nz;
    }
    r.dirty = true;
  }

  /** For tests. */
  stats() {
    let doors = 0, shutters = 0, casements = 0, open = 0;
    for (const r of this.bs.values()) for (const q of r.recs) {
      if (q.l.kind === 'door') doors++; else if (q.l.kind === 'shutter') shutters++; else casements++;
      if (q.ang > 0.3) open++;
    }
    return { buildings: this.bs.size, doors, shutters, casements, open };
  }
}
