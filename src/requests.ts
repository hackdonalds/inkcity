import { LANDMARKS, ROLES, type Cost, type Role, RES_KEYS, fmtCost } from './economy';
import type { World } from './world';

/** Small wishes from named residents — goals with deadlines and rewards. */
export interface Req {
  id: number; who: string; trade: string; text: string;
  kind: string; role?: Role; base: number; target: number; due: number;
  reward: Cost; happy: number;
}

const TRADES = ['baker', 'cooper', 'ropemaker', 'weaver', 'fisher', 'mason', 'chandler', 'tanner', 'smith', 'scribe', 'lamplighter', 'midwife'];

export class Requests {
  active: Req[] = [];
  nextDay = 2;
  private nid = 1;
  onDone: ((r: Req) => void) | null = null;
  onFail: ((r: Req) => void) | null = null;

  /** Current value of what a request measures. */
  measure(r: Req, w: World): number {
    switch (r.kind) {
      case 'role': return w.specs.filter((s) => s.role === r.role).length;
      case 'height': return Math.floor(w.tallest());
      case 'bridge': return w.bridges.length;
      case 'brace': return [...w.built.values()].filter((b) => b.stability < 0.15).length;
      case 'homes': { const c = w.econ.census(w.econBuildings()); return c.housing - Math.floor(w.econ.pop); }
      case 'stone': return Math.max(0, ...w.specs.map((s) => (s.mats.slice(0, s.blocks).split('').every((c) => c === 'S') ? s.blocks : 0)));
      default: return 0;
    }
  }
  done(r: Req, w: World) { const v = this.measure(r, w); return r.kind === 'brace' ? v <= r.target : v >= r.target; }
  progress(r: Req, w: World) {
    const v = this.measure(r, w);
    if (r.kind === 'brace') return `${v} still shaky`;
    if (r.kind === 'role') return `${v}/${r.target}`;
    return `${Math.min(v, r.target)}/${r.target}${r.kind === 'height' ? ' m' : ''}`;
  }

  /** Called each new day: expire, then maybe someone asks for something. */
  day(w: World, names: string[]) {
    const day = w.econ.day;
    for (const r of [...this.active]) if (day > r.due) { this.active.splice(this.active.indexOf(r), 1); w.econ.happy = Math.max(0, w.econ.happy - 6); this.onFail?.(r); }
    if (day < this.nextDay || this.active.length >= 2 || w.specs.length < 2 || w.econ.pop < 3) return;
    const r = this.make(w, names);
    if (r) { this.active.push(r); this.nextDay = day + 2 + Math.floor(Math.random() * 3); }
  }

  /** Called whenever the town changes. */
  check(w: World) {
    for (const r of [...this.active]) if (this.done(r, w)) {
      this.active.splice(this.active.indexOf(r), 1);
      for (const k of RES_KEYS) w.econ.res[k] += r.reward[k] ?? 0;
      w.econ.happy = Math.min(100, w.econ.happy + r.happy);
      this.onDone?.(r);
    }
  }

  private make(w: World, names: string[]): Req | null {
    const c = w.econ.census(w.econBuildings());
    const taken = new Set(this.active.map((r) => r.who));
    const free = names.filter((n) => !taken.has(n));
    const who = free.length ? free[Math.floor(Math.random() * free.length)] : null;
    if (!who) return null;
    const trade = TRADES[Math.floor(Math.random() * TRADES.length)];
    const day = w.econ.day, due = day + 4 + Math.floor(Math.random() * 3);
    const base = { id: this.nid++, who, trade, due, happy: 8 };
    const kinds = new Set(this.active.map((r) => r.kind + (r.role ?? '')));
    const pick: Req[] = [];
    const add = (r: Omit<Req, 'id' | 'who' | 'trade' | 'due' | 'happy'> & { happy?: number }) => { if (!kinds.has(r.kind + (r.role ?? ''))) pick.push({ ...base, ...r, happy: r.happy ?? base.happy }); };
    const roleReq = (role: Role, text: string, reward: Cost) => { const n = w.specs.filter((s) => s.role === role).length; add({ kind: 'role', role, base: n, target: n + 1, text, reward }); };

    if (c.rates.food < 0) roleReq('farm', 'My little ones go to bed hungry. Could we have another farm?', { wood: 10, stone: 4 });
    const shaky = [...w.built.values()].filter((b) => b.stability < 0.15).length;
    if (shaky) add({ kind: 'brace', base: shaky, target: 0, text: 'That tower creaks all night and I cannot sleep. Please brace it or bridge it!', reward: {}, happy: 14 });
    if (c.housing - w.econ.pop < 3) add({ kind: 'homes', base: 0, target: 6, text: 'My cousins want to move here, but there is nowhere for them to live.', reward: { food: 12, wood: 6 } });
    if (pick.length === 0 || Math.random() < 0.5) {
      const h = Math.floor(w.tallest());
      add({ kind: 'height', base: h, target: h + 6 + Math.floor(Math.random() * 5), text: 'I dream of seeing the whole coast from a window. Build higher!', reward: { stone: 20, tiles: 4 } });
      if (w.specs.length >= 3) add({ kind: 'bridge', base: w.bridges.length, target: w.bridges.length + 1, text: 'Walking all the way down and up again is ruining my knees. A bridge, perhaps?', reward: { wood: 15 } });
      const lm = LANDMARKS.find((r) => !w.landmarkBlocked(r));
      if (lm) add({ kind: 'role', role: lm, base: 0, target: 1, text: `Every proper town has a ${ROLES[lm].name.toLowerCase()}. Why not ours?`, reward: { wood: 25, stone: 15 }, happy: 12 });
      add({ kind: 'stone', base: 0, target: 3, text: 'Timber burns and rots. I want to live in a stone house at least three blocks high.', reward: { tiles: 8, wood: 6 } });
      for (const [role, text, reward] of [['wood', 'We are short of timber. A woodcutter would help.', { stone: 8 }], ['quarry', 'A stonecutter would let us build properly.', { wood: 12 }], ['kiln', 'My roof leaks. We need a tile kiln.', { wood: 10 }]] as [Role, string, Cost][])
        if (!w.specs.some((s) => s.role === role)) roleReq(role, text, reward);
    }
    if (!pick.length) return null;
    return pick[Math.floor(Math.random() * Math.min(pick.length, 3))];
  }

  rewardText(r: Req) { return [fmtCost(r.reward) === 'free' ? '' : fmtCost(r.reward), r.happy ? `+${r.happy} happiness` : ''].filter(Boolean).join(', '); }
}
