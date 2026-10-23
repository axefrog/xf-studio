// The key registry (S1 1.5): every draw S1 makes is built here, and nowhere else. After "rng" and the tag, `worldSeed` is always
// the next argument (an `id`), then the rest in the order shown. No key reads the session epoch, a load count, the play clock or
// the wall clock (S1-I-1). The audit (`audit.ts`) refuses a call of `rand` or `procRand` outside this file.
//
// Process draws are `procRand(w, tag, ...)`, which the kernel keys `rand("proc", worldSeed, processId, w, ...)` for the window `w`
// being computed (S0 V4-41). Identity draws are `rand(tag, worldSeed, ...)` and carry no window.

import { type HArg, id as hid, i as hi, rand, s as hs } from '../id.ts';
import type { Id } from '../types.ts';

export type ProcRand = (w: number, ...key: HArg[]) => number;

/** The registry as data, for the audit and for a reader: every tag, who draws it and the argument types. */
export const KEY_REGISTRY: Record<string, { process?: string; args: string }> = {
  regime: { process: 'city.events', args: 'id s i' },
  'regime-size': { process: 'city.events', args: 'id s' },
  'regime-t': { process: 'city.events', args: 'id s' },
  'regime-exit': { process: 'city.events', args: 'id' },
  cnt: { process: 'city.events', args: 'id s i i' },
  size: { process: 'city.events', args: 'id s i' },
  cell: { process: 'city.events', args: 'id s i' },
  t: { process: 'city.events', args: 'id s i' },
  enf: { process: 'order.norms', args: 'id s i' },
  rung: { process: 'order.norms', args: 'id s i' },
  ecell: { process: 'order.norms', args: 'id s i' },
  et: { process: 'order.norms', args: 'id s i' },
  retal: { process: 'group.decide', args: 'id i' },
  'cast-f': { args: 'id' },
  'cast-pair': { args: 'id' },
  'cast-n': { args: 'id s' },
  'cast-who': { args: 'id s i' },
  child: { args: 'id i s' },
  thin: { args: 'id i' },
  report: { args: 'id i' },
  wit: { args: 'id i' },
  prop: { args: 'id' },
  spell: { args: 'id s i' },
  spellv: { args: 'id s i' },
  anchor: { args: 'id s' },
  absent: { args: 'id i' },
  sched: { args: 'id i i' },
  'work-place': { args: 'id' },
  'out-place': { args: 'id i i' },
  present: { args: 'id id' },
  focus: { args: 's id' },
  'rank-anchor': { args: 'id id' },
  tie: { args: 'id id' },
  knows: { args: 'id id' },
  ntype: { args: 's id' },
  bind: { args: 's s s i i' },
  accept: { args: 'id id' },
  tell: { args: 'id id id i' },
  op: { args: 'id id id i' },
};

/** The identity draws, bound to a world seed. */
export function identityKeys(worldSeed: Id) {
  const ir = (tag: string, ...args: HArg[]): number => rand(hs(tag), hid(worldSeed), ...args);
  return {
    castF: (occ: Id) => ir('cast-f', hid(occ)),
    castPair: (occ: Id) => ir('cast-pair', hid(occ)),
    castN: (occ: Id, role: string) => ir('cast-n', hid(occ), hs(role)),
    castWho: (occ: Id, role: string, i: number) => ir('cast-who', hid(occ), hs(role), hi(i)),
    child: (parent: Id, index: number, aspect: string) => ir('child', hid(parent), hi(index), hs(aspect)),
    thin: (parent: Id, index: number) => ir('thin', hid(parent), hi(index)),
    report: (parent: Id, index: number) => ir('report', hid(parent), hi(index)),
    wit: (occ: Id, i: number) => ir('wit', hid(occ), hi(i)),
    prop: (cell: Id) => ir('prop', hid(cell)),
    spell: (person: Id, track: string, k: number) => ir('spell', hid(person), hs(track), hi(k)),
    spellv: (person: Id, track: string) => ir('spellv', hid(person), hs(track), hi(0)),
    anchor: (person: Id, track: string) => ir('anchor', hid(person), hs(track)),
    absent: (person: Id, day: number) => ir('absent', hid(person), hi(day)),
    sched: (person: Id, day: number, p: number) => ir('sched', hid(person), hi(day), hi(p)),
    workPlace: (person: Id) => ir('work-place', hid(person)),
    outPlace: (person: Id, day: number, p: number) => ir('out-place', hid(person), hi(day), hi(p)),
    present: (cell: Id, person: Id) => ir('present', hid(cell), hid(person)),
    focus: (type: string, person: Id) => ir('focus', hs(type), hid(person)),
    rankAnchor: (a: Id, block: Id) => ir('rank-anchor', hid(a), hid(block)),
    tie: (lo: Id, hi_: Id) => ir('tie', hid(lo), hid(hi_)),
    knows: (resident: Id, item: Id) => ir('knows', hid(resident), hid(item)),
    ntype: (norm: string, resident: Id) => ir('ntype', hs(norm), hid(resident)),
    bind: (community: string, entry: string, spot: string, ordinal: number, attempt: number) => ir('bind', hs(community), hs(entry), hs(spot), hi(ordinal), hi(attempt)),
    accept: (tie: Id, event: Id) => ir('accept', hid(tie), hid(event)),
    tell: (teller: Id, listener: Id, item: Id, window: number) => ir('tell', hid(teller), hid(listener), hid(item), hi(window)),
    op: (teller: Id, listener: Id, item: Id, hop: number) => ir('op', hid(teller), hid(listener), hid(item), hi(hop)),
  };
}
export type IdentityKeys = ReturnType<typeof identityKeys>;

/** The process draws, bound to a run's `procRand`. */
export function processKeys(pr: ProcRand) {
  return {
    regime: (w: number, d: Id, r: string, i: number) => pr(w, hs('regime'), hid(d), hs(r), hi(i)),
    regimeSize: (w: number, d: Id, r: string) => pr(w, hs('regime-size'), hid(d), hs(r)),
    regimeT: (w: number, d: Id, r: string) => pr(w, hs('regime-t'), hid(d), hs(r)),
    regimeExit: (w: number, regime: Id) => pr(w, hs('regime-exit'), hid(regime)),
    cnt: (w: number, d: Id, k: string, part: number, i: number) => pr(w, hs('cnt'), hid(d), hs(k), hi(part), hi(i)),
    size: (w: number, d: Id, k: string, i: number) => pr(w, hs('size'), hid(d), hs(k), hi(i)),
    cell: (w: number, d: Id, k: string, i: number) => pr(w, hs('cell'), hid(d), hs(k), hi(i)),
    t: (w: number, d: Id, k: string, i: number) => pr(w, hs('t'), hid(d), hs(k), hi(i)),
    enf: (w: number, d: Id, norm: string, i: number) => pr(w, hs('enf'), hid(d), hs(norm), hi(i)),
    rung: (w: number, d: Id, norm: string, i: number) => pr(w, hs('rung'), hid(d), hs(norm), hi(i)),
    ecell: (w: number, d: Id, norm: string, i: number) => pr(w, hs('ecell'), hid(d), hs(norm), hi(i)),
    et: (w: number, d: Id, norm: string, i: number) => pr(w, hs('et'), hid(d), hs(norm), hi(i)),
    retal: (w: number, group: Id, rival: number) => pr(w, hs('retal'), hid(group), hi(rival)),
  };
}
export type ProcessKeys = ReturnType<typeof processKeys>;
