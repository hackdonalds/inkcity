export type Role = 'keep' | 'house' | 'wood' | 'quarry' | 'kiln' | 'farm' | 'market' | 'inn' | 'windmill' | 'belltower' | 'lighthouse' | 'well' | 'pier';
export const LANDMARKS: Role[] = ['market', 'inn', 'windmill', 'belltower', 'lighthouse'];
/** landmarks built from bespoke geometry (fixed size, can't grow or share walls) */
export const BESPOKE: Role[] = ['market', 'windmill', 'belltower', 'lighthouse', 'well', 'pier'];
export type ResKey = 'wood' | 'stone' | 'tiles' | 'food';
export type Res = Record<ResKey, number>;
export type Cost = Partial<Res>;
export const RES_KEYS: ResKey[] = ['wood', 'stone', 'tiles', 'food'];

export interface RoleDef {
  name: string; verb: string;
  /** population needed to unlock (landmarks) */
  unlock?: number; perk?: string; size?: [number, number];
  found: Cost;
  housing: number; // residents per block
  jobs: number; // workers per block
  makes: Cost; // per fully staffed block per day
  uses: Cost;
}

export const ROLES: Record<Role, RoleDef> = {
  keep: { name: 'Keep', verb: 'houses the founders', found: {}, housing: 3, jobs: 0, makes: {}, uses: {} },
  house: { name: 'House', verb: 'houses residents', found: { wood: 8 }, housing: 4, jobs: 0, makes: {}, uses: {} },
  wood: { name: 'Woodcutter', verb: 'cuts timber', found: { wood: 6 }, housing: 1, jobs: 2, makes: { wood: 5 }, uses: {} },
  quarry: { name: 'Stonecutter', verb: 'dresses stone', found: { wood: 10 }, housing: 1, jobs: 2, makes: { stone: 3 }, uses: {} },
  kiln: { name: 'Tile kiln', verb: 'fires roof tiles', found: { wood: 8, stone: 6 }, housing: 1, jobs: 2, makes: { tiles: 2 }, uses: { wood: 1 } },
  farm: { name: 'Granary farm', verb: 'grows food', found: { wood: 8 }, housing: 1, jobs: 2, makes: { food: 5 }, uses: {} },
  market: { name: 'Market square', verb: 'trades goods', unlock: 10, perk: '+10% food, +8 happiness', size: [6.2, 5.2],
    found: { wood: 20, stone: 10 }, housing: 0, jobs: 2, makes: {}, uses: {} },
  inn: { name: 'The Inn', verb: 'pours ale', unlock: 15, perk: 'newcomers arrive twice as fast, +10 happiness',
    found: { wood: 25, stone: 5 }, housing: 2, jobs: 2, makes: {}, uses: {} },
  windmill: { name: 'Windmill', verb: 'grinds grain', unlock: 20, perk: 'farms produce 30% more', size: [4.4, 4.4],
    found: { wood: 30, stone: 10 }, housing: 0, jobs: 1, makes: {}, uses: {} },
  lighthouse: { name: 'Lighthouse', verb: 'guides trade boats', unlock: 25, perk: 'boats bring 3 wood + 3 stone a day', size: [4.4, 4.4],
    found: { wood: 15, stone: 50 }, housing: 0, jobs: 1, makes: { wood: 3, stone: 3 }, uses: {} },
  well: { name: 'Well', verb: 'draws groundwater', perk: 'homes within 14 m are happier (+10 happiness if every home has one)', size: [1.6, 1.6],
    found: { stone: 6, wood: 2 }, housing: 0, jobs: 0, makes: {}, uses: {} },
  pier: { name: 'Fishing pier', verb: 'lands fish', perk: 'shore only; 2 fishermen land 4 food each a day', size: [3.0, 2.8],
    found: { wood: 14, stone: 2 }, housing: 0, jobs: 2, makes: { food: 4 }, uses: {} },
  belltower: { name: 'Bell tower', verb: 'keeps the hours', unlock: 30, perk: 'storm warnings two days ahead, +6 happiness', size: [3.6, 3.6],
    found: { wood: 10, stone: 40, tiles: 4 }, housing: 0, jobs: 0, makes: {}, uses: {} },
};

export const COSTS = {
  timberBlock: { wood: 6 } as Cost,
  stoneBlock: { stone: 5, wood: 2 } as Cost,
  roofTiles: { tiles: 2 } as Cost,
  bridge: { wood: 8 } as Cost,
  brace: { wood: 6, stone: 2 } as Cost,
};
export const FOOD_PER_RESIDENT = 0.5;

export interface Census {
  housing: number; jobs: number; workers: number;
  rates: Res; // net per day at current staffing
  shaky: number; // residents living in wobbly buildings
}

export interface EconBuilding {
  role: Role; blocks: number; stability: number; bridges: number;
  /** output multiplier from the land (soil for farms, woods within reach for woodcutters) */
  mul?: number;
  /** a home with a well within reach */
  well?: boolean;
}
/** happiness when every home has a well within reach (scaled by the share that do) */
export const WELL_HAPPY = 10;
export const WELL_REACH = 14;

export class Economy {
  res: Res = { wood: 60, stone: 25, tiles: 6, food: 30 };
  pop = 3;
  happy = 60;
  day = 1;
  /** weather bonus on farms (rain) */
  foodMul = 1;

  snapshot() { return { res: { ...this.res }, pop: this.pop, happy: this.happy, day: this.day }; }
  restore(s: ReturnType<Economy['snapshot']>) { this.res = { ...s.res }; this.pop = s.pop; this.happy = s.happy; this.day = s.day; }

  can(c: Cost) { return RES_KEYS.every((k) => (c[k] ?? 0) <= this.res[k] + 1e-9); }
  pay(c: Cost) { for (const k of RES_KEYS) this.res[k] -= c[k] ?? 0; }
  missing(c: Cost) {
    return RES_KEYS.filter((k) => (c[k] ?? 0) > this.res[k] + 1e-9).map((k) => `${Math.ceil((c[k] ?? 0) - this.res[k])} ${k}`).join(', ');
  }

  census(bs: EconBuilding[]): Census {
    let housing = 0, jobs = 0, shakyHousing = 0;
    for (const b of bs) {
      const R = ROLES[b.role];
      housing += R.housing * b.blocks;
      jobs += R.jobs * b.blocks;
      if (b.stability < 0.15) shakyHousing += R.housing * b.blocks;
    }
    const has = (r: Role) => bs.some((b) => b.role === r);
    const workers = Math.min(Math.floor(this.pop), jobs);
    const staffing = jobs ? workers / jobs : 0;
    const rates: Res = { wood: 0, stone: 0, tiles: 0, food: -this.pop * FOOD_PER_RESIDENT };
    for (const b of bs) {
      const R = ROLES[b.role];
      const mul = (k: ResKey) => (k === 'food' ? this.foodMul * (has('windmill') ? 1.3 : 1) * (has('market') ? 1.1 : 1) : 1);
      const blocks = b.role === 'lighthouse' ? 1 : b.blocks;
      const land = b.mul ?? 1;
      for (const k of RES_KEYS) rates[k] += ((R.makes[k] ?? 0) * mul(k) * land - (R.uses[k] ?? 0)) * blocks * (b.role === 'lighthouse' ? 1 : staffing);
    }
    const shaky = housing ? (shakyHousing / housing) * this.pop : 0;
    return { housing, jobs, workers, rates, shaky };
  }

  /** Happiness from homes that have a well within reach. */
  wellBonus(bs: EconBuilding[]) {
    let homes = 0, served = 0;
    for (const b of bs) { const n = ROLES[b.role].housing * b.blocks; homes += n; if (b.well) served += n; }
    return homes ? (WELL_HAPPY * served) / homes : 0;
  }

  /** Advance one day. Returns notable events for the player. */
  tick(bs: EconBuilding[]): string[] {
    const ev: string[] = [];
    const c = this.census(bs);
    for (const k of RES_KEYS) this.res[k] = Math.max(0, this.res[k] + c.rates[k]);
    const starving = this.res.food <= 0 && c.rates.food < 0;
    const bridges = bs.reduce((s, b) => s + b.bridges, 0) / 2;
    let h = 60;
    if (starving) h -= 35;
    if (c.housing && this.pop / c.housing > 0.95) h -= 8;
    if (this.pop > 0) h -= 15 * Math.max(0, (this.pop - c.workers - (c.housing - c.jobs) * 0.5) / this.pop);
    h -= this.pop > 0 ? 30 * (c.shaky / this.pop) : 0;
    h += Math.min(12, bridges * 3);
    const has = (r: Role) => bs.some((b) => b.role === r);
    if (has('market')) h += 8;
    if (has('inn')) h += 10;
    if (has('belltower')) h += 6;
    h += this.wellBonus(bs);
    this.happy += (Math.max(0, Math.min(100, h)) - this.happy) * 0.5;

    const free = c.housing - this.pop;
    if (this.pop > c.housing) { this.pop = c.housing; ev.push('Some residents left: not enough housing'); }
    else if (starving) { this.pop = Math.max(0, this.pop - 1); ev.push('Food has run out — residents are leaving'); }
    else if (this.happy < 25 && this.pop > 0) { this.pop -= 1; ev.push('An unhappy family moved away'); }
    else if (free > 0 && this.happy >= 40) {
      const n = Math.min(free, (1 + Math.floor(free / 4)) * (has('inn') ? 2 : 1));
      this.pop += n;
      if (n > 1) ev.push(`${n} newcomers arrived`);
    }
    if (!starving && this.res.food < this.pop * FOOD_PER_RESIDENT * 3 && c.rates.food < 0) ev.push('Food is running low — build a farm');
    this.day++;
    return ev;
  }
}

export const fmtCost = (c: Cost) => RES_KEYS.filter((k) => c[k]).map((k) => `${c[k]} ${k}`).join(' + ') || 'free';
