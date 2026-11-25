export type Role = 'keep' | 'house' | 'wood' | 'quarry' | 'kiln' | 'farm';
export type ResKey = 'wood' | 'stone' | 'tiles' | 'food';
export type Res = Record<ResKey, number>;
export type Cost = Partial<Res>;
export const RES_KEYS: ResKey[] = ['wood', 'stone', 'tiles', 'food'];

export interface RoleDef {
  name: string; verb: string;
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

export interface EconBuilding { role: Role; blocks: number; stability: number; bridges: number }

export class Economy {
  res: Res = { wood: 60, stone: 25, tiles: 6, food: 30 };
  pop = 3;
  happy = 60;
  day = 1;

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
    const workers = Math.min(Math.floor(this.pop), jobs);
    const staffing = jobs ? workers / jobs : 0;
    const rates: Res = { wood: 0, stone: 0, tiles: 0, food: -this.pop * FOOD_PER_RESIDENT };
    for (const b of bs) {
      const R = ROLES[b.role];
      for (const k of RES_KEYS) rates[k] += ((R.makes[k] ?? 0) - (R.uses[k] ?? 0)) * b.blocks * staffing;
    }
    const shaky = housing ? (shakyHousing / housing) * this.pop : 0;
    return { housing, jobs, workers, rates, shaky };
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
    this.happy += (Math.max(0, Math.min(100, h)) - this.happy) * 0.5;

    const free = c.housing - this.pop;
    if (this.pop > c.housing) { this.pop = c.housing; ev.push('Some residents left: not enough housing'); }
    else if (starving) { this.pop = Math.max(0, this.pop - 1); ev.push('Food has run out — residents are leaving'); }
    else if (this.happy < 25 && this.pop > 0) { this.pop -= 1; ev.push('An unhappy family moved away'); }
    else if (free > 0 && this.happy >= 40) {
      const n = Math.min(free, 1 + Math.floor(free / 4));
      this.pop += n;
      if (n > 1) ev.push(`${n} newcomers arrived`);
    }
    if (!starving && this.res.food < this.pop * FOOD_PER_RESIDENT * 3 && c.rates.food < 0) ev.push('Food is running low — build a farm');
    this.day++;
    return ev;
  }
}

export const fmtCost = (c: Cost) => RES_KEYS.filter((k) => c[k]).map((k) => `${c[k]} ${k}`).join(' + ') || 'free';
