import * as THREE from 'three';
import { Builder, M, beam, box, lathe } from './builder';

/**
 * Hand props drawn through the ink/watercolour pipeline. Built in the character's model units
 * (a citizen is ~2.2 tall before scaling) in the KayKit hand-slot convention: handle along +Y.
 */
export type PropKind = 'axe' | 'hammer' | 'hoe' | 'broom' | 'lute' | 'mug' | 'crate' | 'sack' | 'basket' | 'bucket';

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
  }
  return b.build();
}

/** A prop mesh positioned for a hand slot. */
export function makeProp(kind: PropKind, mat: THREE.Material): THREE.Mesh {
  if (!cache.has(kind)) cache.set(kind, geo(kind));
  const m = new THREE.Mesh(cache.get(kind)!, mat);
  m.rotation.y = Math.PI;
  if (kind === 'crate' || kind === 'sack' || kind === 'basket') { m.position.set(-0.35, 0.05, 0.35); }
  if (kind === 'lute') { m.rotation.set(0, Math.PI, -1.2); m.position.set(0.1, 0.2, 0); }
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
