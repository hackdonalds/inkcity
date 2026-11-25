import * as THREE from 'three';
import { Builder, M, beam, box, lathe } from './builder';

/**
 * Hand props drawn through the ink/watercolour pipeline. Built in the character's model units
 * (a citizen is ~2.2 tall before scaling) in the KayKit hand-slot convention: handle along +Y.
 */
export type PropKind = 'axe' | 'hammer' | 'hoe' | 'broom' | 'lute' | 'mug' | 'crate' | 'sack' | 'basket' | 'bucket'
  | 'pickaxe' | 'shovel' | 'saw' | 'book' | 'notebook' | 'pencil' | 'sketchbook' | 'brush' | 'palette' | 'rod' | 'can' | 'pouch';

const cache = new Map<PropKind, THREE.BufferGeometry>();
let nid = 0;

function geo(kind: PropKind) {
  const b = new Builder(400_000_000 + (nid++ % 50) * 1000);
  const t = (m: number, v = 0.4) => b.begin(m, v);
  switch (kind) {
    case 'axe': t(M.TIMBER); beam(b, [0, -0.25, 0], [0, 1.15, 0], 0.08); t(M.IRON); box(b, -0.04, 0.85, -0.02, 0.32, 1.12, 0.02); break;
    case 'hammer': t(M.TIMBER); beam(b, [0, -0.2, 0], [0, 0.85, 0], 0.07); t(M.IRON); box(b, -0.17, 0.78, -0.08, 0.17, 0.95, 0.08); break;
    case 'hoe': t(M.TIMBER); beam(b, [0, -0.5, 0], [0, 1.5, 0], 0.07); t(M.IRON); box(b, -0.02, 1.32, -0.02, 0.3, 1.5, 0.02); break;
    case 'broom':
      t(M.TIMBER); beam(b, [0, -0.6, 0], [0, 1.3, 0], 0.06);
      t(M.PLANK, 0.7); lathe(b, 0, -1.05, 0, [[0.03, 0], [0.22, 0.12], [0.16, 0.45], [0.05, 0.5]], 6); break;
    case 'lute':
      t(M.PLANK, 0.6); lathe(b, 0, -0.55, 0, [[0.02, 0], [0.32, 0.15], [0.36, 0.38], [0.22, 0.62], [0.08, 0.72]], 9);
      t(M.TIMBER); beam(b, [0, 0.1, 0], [0, 0.85, 0], 0.08, 0.05); box(b, -0.06, 0.82, -0.03, 0.06, 0.98, 0.03); break;
    case 'mug': t(M.PLANK, 0.5); lathe(b, 0.15, -0.1, 0, [[0.12, 0], [0.13, 0.28], [0.0, 0.28]], 7); t(M.SMOKE, 0.9); lathe(b, 0.15, 0.18, 0, [[0.12, 0], [0.0, 0.05]], 7); break;
    case 'crate': t(M.PLANK, 0.5); box(b, -0.42, -0.1, -0.3, 0.42, 0.55, 0.42); t(M.TIMBER); box(b, -0.44, 0.15, -0.32, 0.44, 0.25, 0.44); break;
    case 'sack': t(M.PLASTER, 0.6); lathe(b, 0, -0.1, 0.05, [[0.05, 0], [0.38, 0.15], [0.42, 0.45], [0.25, 0.75], [0.08, 0.85]], 8); break;
    case 'basket':
      t(M.PLANK, 0.7); lathe(b, 0, -0.05, 0.05, [[0.25, 0], [0.4, 0.35], [0.02, 0.35]], 9);
      t(M.GRASS, 0.3); for (let i = 0; i < 3; i++) lathe(b, -0.15 + i * 0.15, 0.3, 0.05, [[0.1, 0], [0.12, 0.1], [0, 0.2]], 6); break;
    case 'bucket': t(M.PLANK, 0.5); lathe(b, 0, -0.45, 0, [[0.18, 0], [0.23, 0.35], [0.02, 0.35]], 8); t(M.IRON); beam(b, [-0.22, -0.1, 0], [0, 0.15, 0], 0.025); beam(b, [0, 0.15, 0], [0.22, -0.1, 0], 0.025); break;
    case 'pickaxe':
      t(M.TIMBER); beam(b, [0, -0.3, 0], [0, 1.12, 0], 0.08);
      t(M.IRON); beam(b, [0, 1.02, 0], [0.42, 0.86, 0], 0.07, 0.06); beam(b, [0, 1.02, 0], [-0.42, 0.86, 0], 0.07, 0.06); break;
    case 'shovel':
      t(M.TIMBER); beam(b, [0, -0.45, 0], [0, 1.3, 0], 0.07); box(b, -0.12, -0.5, -0.03, 0.12, -0.42, 0.03);
      t(M.IRON); box(b, -0.17, 1.28, -0.025, 0.17, 1.72, 0.025); break;
    case 'saw':
      t(M.PLANK, 0.6); box(b, -0.07, -0.12, -0.05, 0.07, 0.2, 0.05);
      t(M.IRON); box(b, -0.015, 0.18, -0.13, 0.015, 1.05, 0.06); break;
    case 'book': // open, pages up (the hand-slot transform below turns it toward the reader)
      t(M.ACCENT, 0.3); box(b, -0.34, -0.02, -0.24, 0.34, 0.0, 0.24);
      t(M.PLASTER, 0.9); box(b, -0.31, 0.0, -0.22, -0.01, 0.06, 0.22); t(M.PLASTER, 0.85); box(b, 0.01, 0.0, -0.22, 0.31, 0.06, 0.22); break;
    case 'notebook':
      t(M.DOOR, 0.3); box(b, -0.2, -0.02, -0.28, 0.2, 0.0, 0.28); t(M.PLASTER, 0.9); box(b, -0.18, 0.0, -0.26, 0.18, 0.04, 0.26); break;
    case 'sketchbook':
      t(M.PLANK, 0.4); box(b, -0.36, -0.03, -0.28, 0.36, 0.0, 0.28); t(M.PLASTER, 0.95); box(b, -0.33, 0.0, -0.25, 0.33, 0.02, 0.25);
      t(M.TIMBER, 0.2); for (let i = 0; i < 3; i++) box(b, -0.25 + i * 0.12, 0.02, -0.12 + i * 0.07, -0.05 + i * 0.12, 0.025, -0.1 + i * 0.07); break;
    case 'pencil': t(M.TILE, 0.6); beam(b, [0, -0.15, 0], [0, 0.32, 0], 0.035); t(M.TIMBER); beam(b, [0, 0.32, 0], [0, 0.4, 0], 0.02); break;
    case 'brush': t(M.TIMBER, 0.5); beam(b, [0, -0.15, 0], [0, 0.5, 0], 0.035); t(M.ACCENT, 0.7); beam(b, [0, 0.5, 0], [0, 0.62, 0], 0.05, 0.03); break;
    case 'palette':
      t(M.PLANK, 0.7); lathe(b, 0, -0.01, 0, [[0.2, 0], [0.2, 0.02], [0.0, 0.02]], 9);
      for (const [m, a] of [[M.ACCENT, 0.4], [M.WATER, 1.5], [M.GRASS, 2.6], [M.TILE, 3.8]] as [number, number][]) { t(m, 0.6); lathe(b, Math.cos(a) * 0.12, 0.02, Math.sin(a) * 0.12, [[0.04, 0], [0.0, 0.03]], 5); } break;
    case 'rod':
      t(M.TIMBER, 0.6); beam(b, [0, -0.35, 0], [0, 2.9, 0], 0.045); t(M.IRON); lathe(b, 0.06, 0.15, 0, [[0.07, -0.04], [0.07, 0.04], [0, 0.04]], 6); break;
    case 'can':
      t(M.COPPER, 0.6); lathe(b, 0, -0.55, 0.12, [[0.2, 0], [0.22, 0.32], [0.16, 0.36], [0.0, 0.36]], 8);
      beam(b, [0, -0.35, 0.3], [0, -0.05, 0.75], 0.05); lathe(b, 0, -0.08, 0.75, [[0.03, 0], [0.07, 0.06], [0, 0.06]], 6);
      t(M.IRON); beam(b, [0, -0.2, -0.08], [0, 0.05, 0.05], 0.03); beam(b, [0, 0.05, 0.05], [0, -0.2, 0.3], 0.03); break;
    case 'pouch': t(M.PLASTER, 0.4); lathe(b, 0, -0.25, 0, [[0.03, 0], [0.16, 0.08], [0.17, 0.22], [0.07, 0.3], [0.1, 0.36], [0, 0.37]], 7); break;
  }
  return b.build();
}

/** Hand-slot offsets for flat things (position xyz, rotation xyz): books are read, not brandished. */
const HOLD: Partial<Record<PropKind, [number, number, number, number, number, number]>> = {
  book: [0, 0.1, 0.18, 1.2, 0, 0], notebook: [0, 0.1, 0.15, 1.2, 0, 0], sketchbook: [0, 0.12, 0.2, 1.1, 0, 0], palette: [0, 0.05, 0.12, 1.4, 0, 0],
};

/** A prop mesh positioned for a hand slot. */
export function makeProp(kind: PropKind, mat: THREE.Material, left = false): THREE.Mesh {
  if (!cache.has(kind)) cache.set(kind, geo(kind));
  const m = new THREE.Mesh(cache.get(kind)!, mat);
  m.rotation.y = Math.PI;
  if (kind === 'crate' || kind === 'sack' || kind === 'basket') { m.position.set(-0.35, 0.05, 0.35); }
  if (kind === 'lute') { m.rotation.set(0, Math.PI, -1.2); m.position.set(0.1, 0.2, 0); }
  const t = HOLD[kind];
  if (t) { m.position.set(t[0], t[1], t[2]); m.rotation.set(t[3], t[4], t[5]); }
  if (left) { // the left hand slot is the right one turned half a turn about its z axis
    const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), Math.PI);
    m.quaternion.premultiply(q); m.position.applyQuaternion(q);
  }
  m.frustumCulled = false;
  return m;
}

/** A ball for children's games (world space). */
export function makeBall(mat: THREE.Material) {
  const b = new Builder(410_000_000);
  b.begin(M.ACCENT, 0.6);
  lathe(b, 0, -0.18, 0, [[0.01, 0], [0.13, 0.05], [0.18, 0.18], [0.13, 0.31], [0.01, 0.36]], 8);
  return new THREE.Mesh(b.build(), mat);
}

// ---------------------------------------------------------------- world props (world units)

/** A painter's easel with a canvas that fills in patch by patch (`paint(k)`, k = 0…1). Faces −z. */
export function makeEasel(mat: THREE.Material, seed: number, colours: number[]) {
  const b = new Builder(420_000_000 + (seed % 997) * 100);
  b.begin(M.TIMBER, 0.45);
  beam(b, [-0.32, 0, 0.12], [-0.05, 1.62, 0.02], 0.05); beam(b, [0.32, 0, 0.12], [0.05, 1.62, 0.02], 0.05);
  b.begin(M.TIMBER, 0.5); beam(b, [0, 0, 0.62], [0, 1.5, 0.06], 0.045);
  b.begin(M.TIMBER, 0.4); box(b, -0.42, 0.78, -0.1, 0.42, 0.83, 0.07);
  b.begin(M.PLASTER, 0.97); box(b, -0.38, 0.83, -0.02, 0.38, 1.43, 0.03);
  const base = b.P.length / 3;
  // the picture: a sky wash, a horizon, a subject, highlights — each patch inked as its own piece
  let r = seed % 233280;
  const rnd = () => ((r = (r * 9301 + 49297) % 233280) / 233280);
  const patches: [number, number, number, number, number][] = [
    [-0.36, 1.12, 0.36, 1.41, colours[0]], [-0.36, 0.85, 0.36, 1.08, colours[1]],
  ];
  for (let i = 0; i < 8; i++) {
    const w = 0.08 + rnd() * 0.18, h = 0.06 + rnd() * 0.2, x = -0.34 + rnd() * (0.68 - w), y = 0.86 + rnd() * (0.54 - h);
    patches.push([x, y, x + w, y + h, colours[2 + (i % (colours.length - 2))]]);
  }
  const marks: number[] = [];
  patches.forEach(([x0, y0, x1, y1, m], i) => {
    b.begin(m, 0.3 + (i % 5) * 0.12);
    const z = -0.025 - i * 0.002;
    b.quad([x0, y0, z], [x1, y0, z], [x1, y1, z], [x0, y1, z], [[x0, y0], [x1, y0], [x1, y1], [x0, y1]]);
    marks.push(b.P.length / 3);
  });
  const geo = b.build();
  const mesh = new THREE.Mesh(geo, mat);
  const paint = (k: number) => { const n = Math.floor(Math.min(1, Math.max(0, k)) * marks.length); geo.setDrawRange(0, n ? marks[n - 1] : base); };
  paint(0);
  return { mesh, paint };
}

/** A small bird (world units), beak along +z. */
export function makeBird(mat: THREE.Material, i: number) {
  const b = new Builder(430_000_000 + (i % 500) * 10);
  b.begin(i % 3 ? M.TIMBER : M.SLATE, 0.3 + (i % 4) * 0.15);
  lathe(b, 0, 0.03, 0, [[0.01, 0], [0.06, 0.03], [0.065, 0.08], [0.04, 0.12], [0.01, 0.13]], 6);
  b.begin(i % 2 ? M.PLASTER : M.TIMBER, 0.5);
  lathe(b, 0, 0.12, 0.05, [[0.01, 0], [0.04, 0.02], [0.035, 0.06], [0.0, 0.07]], 5);
  b.begin(M.TILE, 0.8); beam(b, [0, 0.155, 0.08], [0, 0.15, 0.13], 0.015);
  b.begin(M.TIMBER, 0.2); beam(b, [0, 0.07, -0.05], [0, 0.1, -0.13], 0.06, 0.015);
  const g = b.build();
  g.rotateX(0);
  return new THREE.Mesh(g, mat);
}

/** Unit-length fishing line along +y (scale y to length), and a float. */
export function makeLine(mat: THREE.Material) {
  const b = new Builder(440_000_000);
  b.begin(M.IRON, 0.5); beam(b, [0, 0, 0], [0, 1, 0], 0.012);
  return new THREE.Mesh(b.build(), mat);
}
export function makeFloat(mat: THREE.Material) {
  const b = new Builder(441_000_000);
  b.begin(M.ACCENT, 0.7); lathe(b, 0, -0.04, 0, [[0.01, 0], [0.05, 0.04], [0.03, 0.08], [0.0, 0.1]], 6);
  return new THREE.Mesh(b.build(), mat);
}
export function makeFish(mat: THREE.Material) {
  const b = new Builder(442_000_000);
  b.begin(M.WATER, 0.2);
  lathe(b, 0, -0.18, 0, [[0.0, 0], [0.05, 0.06], [0.06, 0.2], [0.02, 0.3], [0.05, 0.36], [0.0, 0.37]], 6);
  return new THREE.Mesh(b.build(), mat);
}
