/**
 * Adaptive detail. `Q.low` is true on phones / small or touch screens: features should thin out
 * (fewer scattered plants, fewer citizens, simpler props) to stay smooth there.
 */
const coarse = typeof window !== 'undefined' && (window.matchMedia?.('(pointer: coarse)').matches || window.innerWidth < 720);
export const Q = {
  low: !!coarse || (typeof location !== 'undefined' && new URLSearchParams(location.search).get('q') === 'low'),
  /** scale a count by quality */
  n(full: number, lowFraction = 0.5) { return this.low ? Math.max(1, Math.round(full * lowFraction)) : full; },
};
