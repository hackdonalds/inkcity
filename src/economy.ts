export type Role = 'keep' | 'house' | 'wood' | 'quarry' | 'kiln' | 'farm' | 'market' | 'inn' | 'windmill' | 'belltower' | 'lighthouse' | 'well' | 'pier';
export const LANDMARKS: Role[] = ['market', 'inn', 'windmill', 'belltower', 'lighthouse'];
/** landmarks built from bespoke geometry (fixed size, can't grow or share walls) */
export const BESPOKE: Role[] = ['market', 'windmill', 'belltower', 'lighthouse', 'well', 'pier'];
export type ResKey = 'wood' | 'stone' | 'tiles' | 'food' | 'bread' | 'tools' | 'cloth' | 'ale';
export type Res = Record<ResKey, number>;
export type Cost = Partial<Res>;
/** goods made by the trades (shown on the top bar once the town has some) */
export const GOODS: ResKey[] = ['bread', 'tools', 'cloth', 'ale'];
export const RES_KEYS: ResKey[] = ['wood', 'stone', 'tiles', 'food', ...GOODS];

// ------------------------------------------------------------ trades (a house's ground-floor shop)
export type Shop = 'baker' | 'butcher' | 'brewer' | 'smith' | 'carpenter' | 'cooper' | 'weaver' | 'tailor' | 'dyer' | 'apothecary' | 'chandler' | 'school';
export interface ShopDef {
  name: string; verb: string; group: 'Food' | 'Craft' | 'Cloth' | 'Services';
  /** cost to fit out the ground floor */
  fit: Cost;
  jobs: number;
  /** per day when staffed and supplied */
  makes: Cost; uses: Cost;
  /** happiness for homes within reach while it works (scaled by the share of homes it serves) */
  happy: number;
  perk: string;
}
export const SHOPS: Record<Shop, ShopDef> = {
  baker: { name: 'Bakery', verb: 'bakes bread', group: 'Food', fit: { wood: 6, stone: 4 }, jobs: 2, makes: { bread: 3 }, uses: { food: 3 }, happy: 4,
    perk: 'turns grain into bread; a town with bread on the table is happier' },
  butcher: { name: 'Butcher', verb: 'dresses meat', group: 'Food', fit: { wood: 8 }, jobs: 2, makes: { food: 3 }, uses: {}, happy: 2,
    perk: '+3 food a day from the town\'s pigs and sheep' },
  brewer: { name: 'Brewery', verb: 'brews ale', group: 'Food', fit: { wood: 8, stone: 2 }, jobs: 2, makes: { ale: 2 }, uses: { food: 2 }, happy: 2,
    perk: 'brews ale from grain; an inn with ale to pour is a merrier place' },
  smith: { name: 'Smithy', verb: 'forges tools', group: 'Craft', fit: { stone: 8, wood: 4 }, jobs: 2, makes: { tools: 1 }, uses: { wood: 1, stone: 1 }, happy: 1,
    perk: 'forges tools; each tool takes a quarter off the wood and stone of a building job' },
  carpenter: { name: 'Carpenter', verb: 'mends frames', group: 'Craft', fit: { wood: 10 }, jobs: 2, makes: {}, uses: { wood: 1 }, happy: 2,
    perk: 'mends frames and shutters: buildings within reach age more slowly' },
  cooper: { name: 'Cooper', verb: 'makes barrels', group: 'Craft', fit: { wood: 8 }, jobs: 2, makes: {}, uses: { wood: 1 }, happy: 1,
    perk: 'barrels and casks: food, bread and ale keep instead of spoiling' },
  weaver: { name: 'Weaver', verb: 'weaves cloth', group: 'Cloth', fit: { wood: 8 }, jobs: 2, makes: { cloth: 2 }, uses: { food: 1 }, happy: 1,
    perk: 'weaves cloth from the farms\' flax and wool (needs a farm)' },
  tailor: { name: 'Tailor', verb: 'sews clothes', group: 'Cloth', fit: { wood: 6 }, jobs: 2, makes: {}, uses: { cloth: 1 }, happy: 5,
    perk: 'sews clothes from cloth: smartly dressed neighbours are happier' },
  dyer: { name: 'Dyer', verb: 'dyes cloth', group: 'Cloth', fit: { wood: 6, stone: 2 }, jobs: 2, makes: {}, uses: { cloth: 1 }, happy: 3,
    perk: 'dyes cloth in bright vats; colour along the street cheers it up' },
  apothecary: { name: 'Apothecary', verb: 'mixes remedies', group: 'Services', fit: { wood: 6, tiles: 2 }, jobs: 1, makes: {}, uses: {}, happy: 3,
    perk: 'remedies and good advice: families are slower to give up and leave' },
  chandler: { name: 'Chandler', verb: 'dips candles', group: 'Services', fit: { wood: 6 }, jobs: 1, makes: {}, uses: { food: 1 }, happy: 3,
    perk: 'candles from tallow: lit windows late into the night' },
  school: { name: 'School', verb: 'teaches the children', group: 'Services', fit: { wood: 10, stone: 6, tiles: 2 }, jobs: 1, makes: {}, uses: {}, happy: 2,
    perk: 'families with children settle here: newcomers arrive half again as fast' },
};
export const SHOP_LIST = Object.keys(SHOPS) as Shop[];
/** how far a shop serves homes (metres, centre to centre) */
export const SHOP_REACH = 18;
/** kinds of working shops in reach for a home to upgrade (+1 resident per floor), and again (+2) */
export const VARIETY_COMFY = 3, VARIETY_FINE = 6;
export const HOME_TIER_NAMES = ['plain', 'comfortable', 'fine'];
export const homeTier = (variety: number) => (variety >= VARIETY_FINE ? 2 : variety >= VARIETY_COMFY ? 1 : 0);
/** a smith's tool takes this share off the wood and stone of a building job */
export const TOOL_DISCOUNT = 0.25;
const BREAD_PER_RESIDENT = 0.15, SPOIL = 0.015, SPOIL_COOPER = 0.003;
/** a loaf goes further than the grain it was baked from: each bread eaten saves this much food */
const BREAD_FILLS = 1.6;

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
  /** per building: how well its shop is working today (0 idle … 1 staffed and supplied) */
  shopRun: number[];
  /** per building: kinds of working shops within reach */
  variety: number[];
  /** happiness from shops in reach of homes */
  shopHappy: number;
  /** which trades are working anywhere in town (run factor) */
  active: Partial<Record<Shop, number>>;
}

export interface EconBuilding {
  role: Role; blocks: number; stability: number; bridges: number;
  /** output multiplier from the land (soil for farms, woods within reach for woodcutters) */
  mul?: number;
  /** a home with a well within reach */
  well?: boolean;
  /** the trade plied on its ground floor */
  shop?: Shop;
  /** indices (into the same list) of shops within reach of this building */
  near?: number[];
  /** a farm somewhere in town (weavers need flax and wool) — set on the list by the world */
}
/** happiness when every home has a well within reach (scaled by the share that do) */
export const WELL_HAPPY = 10;
export const WELL_REACH = 14;

export class Economy {
  res: Res = { wood: 60, stone: 25, tiles: 6, food: 30, bread: 0, tools: 0, cloth: 0, ale: 0 };
  pop = 3;
  happy = 60;
  day = 1;
  /** weather bonus on farms (rain) */
  foodMul = 1;

  snapshot() { return { res: { ...this.res }, pop: this.pop, happy: this.happy, day: this.day }; }
  restore(s: ReturnType<Economy['snapshot']>) {
    this.res = Object.assign(Object.fromEntries(RES_KEYS.map((k) => [k, 0])) as Res, s.res); // older saves have no goods
    this.pop = s.pop; this.happy = s.happy; this.day = s.day;
  }

  can(c: Cost) { return RES_KEYS.every((k) => (c[k] ?? 0) <= this.res[k] + 1e-9); }
  pay(c: Cost) { for (const k of RES_KEYS) this.res[k] -= c[k] ?? 0; }
  /** What a building job really costs: a smith's tool takes a quarter off its wood and stone. */
  price(c: Cost): Cost {
    if (this.res.tools < 1 || !(c.wood || c.stone)) return c;
    const o: Cost = { ...c };
    for (const k of ['wood', 'stone'] as const) if (o[k]) o[k] = Math.ceil(o[k]! * (1 - TOOL_DISCOUNT));
    return o;
  }
  /** Pay a priced building job (uses up the tool that made it cheaper). */
  payJob(c: Cost) {
    this.pay(c);
    if (this.res.tools >= 1 && (c.wood || c.stone)) this.res.tools -= 1;
  }
  missing(c: Cost) {
    return RES_KEYS.filter((k) => (c[k] ?? 0) > this.res[k] + 1e-9).map((k) => `${Math.ceil((c[k] ?? 0) - this.res[k])} ${k}`).join(', ');
  }

  census(bs: EconBuilding[]): Census {
    let jobs = 0, shakyHousing = 0;
    for (const b of bs) jobs += ROLES[b.role].jobs * b.blocks + (b.shop ? SHOPS[b.shop].jobs : 0);
    const has = (r: Role) => bs.some((b) => b.role === r);
    const workers = Math.min(Math.floor(this.pop), jobs);
    const staffing = jobs ? workers / jobs : 0;
    const rates: Res = { wood: 0, stone: 0, tiles: 0, food: -this.pop * FOOD_PER_RESIDENT, bread: 0, tools: 0, cloth: 0, ale: 0 };
    for (const b of bs) {
      const R = ROLES[b.role];
      const mul = (k: ResKey) => (k === 'food' ? this.foodMul * (has('windmill') ? 1.3 : 1) * (has('market') ? 1.1 : 1) : 1);
      const blocks = b.role === 'lighthouse' ? 1 : b.blocks;
      const land = b.mul ?? 1;
      for (const k of RES_KEYS) rates[k] += ((R.makes[k] ?? 0) * mul(k) * land - (R.uses[k] ?? 0)) * blocks * (b.role === 'lighthouse' ? 1 : staffing);
    }
    // shops: staffed, and supplied from what is in store plus what the day brings
    const shopRun = bs.map(() => 0), active: Partial<Record<Shop, number>> = {};
    const farm = has('farm');
    bs.forEach((b, i) => {
      if (!b.shop) return;
      const S = SHOPS[b.shop];
      let run = staffing;
      for (const k of RES_KEYS) {
        const u = (S.uses[k] ?? 0) * run;
        if (u > 0) run *= Math.min(1, Math.max(0, this.res[k] + Math.max(0, rates[k])) / u);
      }
      if (b.shop === 'weaver' && !farm) run = 0;
      shopRun[i] = run;
      for (const k of RES_KEYS) rates[k] += ((S.makes[k] ?? 0) - (S.uses[k] ?? 0)) * run;
      active[b.shop] = Math.max(active[b.shop] ?? 0, run);
    });
    // goods are used up: bread on the table, ale at the inn; food, bread and ale spoil without casks
    const eaten = Math.min(this.pop * BREAD_PER_RESIDENT, Math.max(0, this.res.bread + rates.bread));
    rates.bread -= eaten; rates.food += eaten * BREAD_FILLS;
    if (active.brewer && has('inn')) rates.ale -= 1;
    const spoil = (active.cooper ?? 0) > 0.3 ? SPOIL_COOPER : SPOIL;
    for (const k of ['food', 'bread', 'ale'] as const) rates[k] -= this.res[k] * spoil;
    // homes: kinds of working shops in reach; enough variety upgrades the home
    const variety = bs.map((b) => new Set((b.near ?? []).filter((j) => shopRun[j] > 0.3).map((j) => bs[j].shop)).size);
    let housing = 0, homes = 0;
    const served: Partial<Record<Shop, number>> = {};
    bs.forEach((b, i) => {
      const R = ROLES[b.role];
      const h = R.housing ? (R.housing + homeTier(variety[i])) * b.blocks : 0;
      housing += h;
      if (b.stability < 0.15) shakyHousing += h;
      if (!h) return;
      homes += h;
      for (const k of new Set((b.near ?? []).filter((j) => shopRun[j] > 0.3).map((j) => bs[j].shop!))) served[k] = (served[k] ?? 0) + h;
    });
    let shopHappy = 0;
    for (const k of Object.keys(served) as Shop[]) shopHappy += SHOPS[k].happy * (served[k]! / Math.max(1, homes));
    shopHappy = Math.min(20, shopHappy);
    const shaky = housing ? (shakyHousing / housing) * this.pop : 0;
    return { housing, jobs, workers, rates, shaky, shopRun, variety, shopHappy, active };
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
    h += c.shopHappy;
    if (this.res.bread > 0.5 && (c.active.baker ?? 0) > 0) h += 5; // fresh bread on the table
    if (this.res.ale > 0.5 && has('inn')) h += 6; // ale at the inn
    this.happy += (Math.max(0, Math.min(100, h)) - this.happy) * 0.5;

    const free = c.housing - this.pop;
    if (this.pop > c.housing) { this.pop = c.housing; ev.push('Some residents left: not enough housing'); }
    else if (starving) { this.pop = Math.max(0, this.pop - 1); ev.push('Food has run out — residents are leaving'); }
    else if (this.happy < ((c.active.apothecary ?? 0) > 0.3 ? 15 : 25) && this.pop > 0) { this.pop -= 1; ev.push('An unhappy family moved away'); }
    else if (free > 0 && this.happy >= 40) {
      const n = Math.min(free, Math.round((1 + Math.floor(free / 4)) * (has('inn') ? 2 : 1) * ((c.active.school ?? 0) > 0.3 ? 1.5 : 1)));
      this.pop += n;
      if (n > 1) ev.push(`${n} newcomers arrived`);
    }
    if (!starving && this.res.food < this.pop * FOOD_PER_RESIDENT * 3 && c.rates.food < 0) ev.push('Food is running low — build a farm');
    this.day++;
    return ev;
  }
}

export const fmtCost = (c: Cost) => RES_KEYS.filter((k) => c[k]).map((k) => `${c[k]} ${k}`).join(' + ') || 'free';
