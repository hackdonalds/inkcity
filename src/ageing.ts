/**
 * Ageing & wealth. Every building has a condition derived from its age, the town's happiness and
 * its own stability. The gradual part (`wear`, `thrive`) drives a per-mesh shader uniform (moss,
 * grime, flaking plaster, fresh paint); the discrete part (`tier`) drives geometry chosen at rebuild
 * time (boarded windows, roof patches, flower boxes, gilded signs) — so a building is only rebuilt
 * when its tier changes.
 */
export interface Condition {
  /** 0 fresh … 1 worn out (moss, grime, flaking plaster) */
  wear: number;
  /** 0 … 1 how prosperous it looks (brighter paint) */
  thrive: number;
  /** 0 thriving · 1 kept · 2 shabby · 3 derelict */
  tier: number;
}

export const TIER_NAMES = ['thriving', 'kept', 'shabby', 'derelict'];

const clamp01 = (x: number) => Math.max(0, Math.min(1, x));

function tierAt(wear: number, thrive: number) {
  if (thrive >= 0.45 && wear < 0.3) return 0;
  if (wear < 0.42) return 1;
  if (wear < 0.68) return 2;
  return 3;
}

/**
 * @param age days since the building was founded
 * @param happy town happiness 0–100
 * @param stability building stability (storm load excluded), 1 solid … <0 collapsing
 * @param prevTier the tier it had before (hysteresis: it must clearly cross a boundary to change)
 * @param care a carpenter in reach (`mend`) and the home's shop comfort tier
 */
export function conditionOf(age: number, happy: number, stability: number, prevTier?: number, care: { mend?: boolean; comfort?: number } = {}): Condition {
  const a = 1 - Math.exp(-Math.max(0, age) / 35);
  const unhappy = clamp01((55 - happy) / 40);
  const shaky = clamp01((0.25 - stability) / 0.35);
  // shops all round keep a home smart (comfort 1–2); a carpenter in reach mends what age wears
  const thrive = clamp01(clamp01((happy - 62) / 25) * (1 - 0.6 * shaky) + 0.25 * (care.comfort ?? 0));
  const wear = clamp01((0.55 * a + 0.5 * unhappy + 0.3 * shaky - 0.35 * thrive) * (care.mend ? 0.6 : 1));
  let tier = tierAt(wear, thrive);
  if (prevTier !== undefined && tier !== prevTier) {
    const t1 = tierAt(wear - 0.04, thrive + 0.05), t2 = tierAt(wear + 0.04, thrive - 0.05);
    if (prevTier >= Math.min(t1, t2) && prevTier <= Math.max(t1, t2)) tier = prevTier;
  }
  return { wear, thrive, tier };
}
