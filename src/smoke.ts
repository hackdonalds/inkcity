import * as THREE from 'three';
import { Builder, M, lathe } from './builder';

const h = (i: number) => { const x = Math.sin(i * 127.1) * 43758.5453; return x - Math.floor(x); };
const PUFFS = 5, LIFE = 7;

/**
 * Stateless chimney smoke: every puff's position is a function of time, so the
 * mesh can be rebuilt each frame and still keep stable ids (stable ink lines).
 */
export function buildSmoke(sources: [number, number, number][], time: number, wind: [number, number], rain: number): THREE.BufferGeometry {
  const b = new Builder(700_000_000);
  const n = Math.min(sources.length, 48);
  for (let i = 0; i < n; i++) {
    const [sx, sy, sz] = sources[i];
    b.begin(M.SMOKE, 0.5 + 0.4 * h(i * 7)); // one id per plume: only its silhouette gets inked
    for (let k = 0; k < PUFFS; k++) {
      const age = (time / LIFE + k / PUFFS + h(i)) % 1;
      const t = age * LIFE;
      const rise = t * (0.9 - rain * 0.4);
      const x = sx + wind[0] * t * 0.5 + Math.sin(t * 1.3 + i) * 0.18 * t * 0.3;
      const z = sz + wind[1] * t * 0.5 + Math.cos(t * 1.1 + i * 2) * 0.15 * t * 0.3;
      let r = 0.3 + t * 0.24;
      r *= age > 0.8 ? 1 - (age - 0.8) / 0.2 * 0.9 : 1;
      r *= age < 0.08 ? age / 0.08 : 1;
      if (r < 0.04) continue;
      lathe(b, x, sy + rise - r * 0.8, z, [[0.01, 0], [r * 0.8, r * 0.35], [r, r * 0.85], [r * 0.75, r * 1.35], [0.01, r * 1.6]], 7, h(i + k) * 6);
    }
  }
  return b.build();
}
