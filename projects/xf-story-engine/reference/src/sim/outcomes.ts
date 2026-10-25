// Outcomes (S1 5.2a, v0.6): an occurrence of a kind with `outcomes` draws its outcome once, from its own `Id`, at the moment it is
// produced. The draw is a pure function of the occurrence and of recorded state at its time (the guard posts of the post history, the
// compliance mask in force in the occurrence's window, the cast), so re-minting or re-opening it gives the same outcome.

import type { EventOutcome } from '../event-kinds.ts';
import type { GameTime, Id } from '../types.ts';
import { invCum } from './arith.ts';
import type { CastEntry, Descriptor } from './occ.ts';
import type { NormsDigest } from './proc-norms.ts';
import type { Sim } from './sim.ts';

/** One post of the `people.goals` post history (S1 7.10): where a goal's owner stood, in which periods, from which window to which. */
export interface PostRec { person: Id; cell: Id; periods: number[]; from: number; until?: number; goal: Id; ward?: Id }

/** What an outcome reads: the digests of a snapshot. Absent, the answer is the one a world with no such process gives. */
export interface OutcomeView {
  norms?: NormsDigest | undefined;
  /** The post history of `people.goals`. */
  posts?: readonly PostRec[] | undefined;
}

/** The group node a person belongs to at `t` (S1 4.8): a resident's profile affiliation, a mirrored person's live `core:member-of` edge. */
export function groupOf(sim: Sim, p: Id, t: GameTime): Id | undefined {
  const v = sim.people.view(p);
  if (v) {
    if (v.affc < 2 || v.affc > 4) return undefined;
    return sim.w.group(sim.w.cell(v.cell).district, (['A1', 'A2', 'A3'] as const)[v.affc - 2]!);
  }
  const k = sim.k;
  k.persistence.recoverIfSaved(p);
  for (const e of k.store.edgesFrom(p)) if (e.type === 'core:member-of' && e.valid.from <= t && (e.valid.to === undefined || t < e.valid.to)) return e.to;
  return undefined;
}

/** The affiliation slot (`A1` to `A3`) a group node stands for, or undefined. */
export function affOfGroup(sim: Sim, g: Id): 'A1' | 'A2' | 'A3' | undefined {
  for (const d of sim.w.districts) for (const slot of ['A1', 'A2', 'A3'] as const) if (sim.w.group(d.id, slot) === g) return slot;
  return undefined;
}

/** `hostile(g1, g2)` reads `data.groups.hostile` (S1 5.2a): symmetric. */
export function hostile(sim: Sim, g1: Id | undefined, g2: Id | undefined): boolean {
  if (g1 === undefined || g2 === undefined) return false;
  const a = affOfGroup(sim, g1);
  const b = affOfGroup(sim, g2);
  if (a === undefined || b === undefined) return false;
  return sim.data.groups.hostile.some(([x, y]) => (x === a && y === b) || (x === b && y === a));
}

/** The bit mask of the resident types that comply with a norm at the given relaxation values (S1 7.5). */
export function complianceMask(share: readonly number[], taue: readonly number[], taun: readonly number[], qe: number, qn: number): number {
  let mask = 0;
  for (let j = 0; j < share.length; j++) if (qe >= taue[j]! && qn >= taun[j]!) mask |= 1 << j;
  return mask;
}

/**
 * `complies(r, norm, t)` (S1 5.2a, 7.5): bit `type(r)` of the `compliers` entry of `r`'s district in force in `t`'s window. Where no run has
 * published one, the norm's starting values stand.
 */
export function compliesAt(sim: Sim, r: Id, normId: string, t: GameTime, view: OutcomeView): boolean {
  const norm = sim.data.norms.norms.find((n) => n.id === normId);
  if (!norm) return false;
  const v = sim.people.view(r);
  const district = v ? sim.w.cell(v.cell).district : undefined;
  const hist = district === undefined ? undefined : view.norms?.norms[district]?.[normId]?.compliers;
  const j = invCumType(sim, norm, r);
  const wt = Math.floor(t / sim.data.time.W);
  if (!hist || hist.length === 0) return (complianceMask(norm.share, norm.taue, norm.taun, norm.beh0, norm.perc0) & (1 << j)) !== 0;
  let mask = hist[0]!.mask;
  for (const e of hist) if (e.from <= wt) mask = e.mask;
  return (mask & (1 << j)) !== 0;
}
const invCumType = (sim: Sim, norm: { id: string; share: number[] }, r: Id): number => invCum(norm.share, sim.ids.ntype(norm.id, r));

/**
 * `guarded(p, t)` (S1 7.10): the post history alone says who stood between `p` and harm. A post of `wards[p]` covers `windowOf(t)` and
 * `periodOf(t)`, its cell is the cell of `where(p, t)`, and its holder is alive at `t`. Returns the guard, or undefined.
 */
export function guardOf(sim: Sim, p: Id, t: GameTime, view: OutcomeView): Id | undefined {
  const posts = view.posts;
  if (!posts || posts.length === 0) return undefined;
  const wt = Math.floor(t / sim.data.time.W);
  const period = sim.people.periodOf(t);
  const at = sim.people.where(p, t).cell;
  if (at === undefined) return undefined;
  for (const post of posts) {
    if (post.ward !== p) continue;
    if (!(post.from <= wt && (post.until === undefined || wt < post.until))) continue;
    if (!post.periods.includes(period) || post.cell !== at) continue;
    if (sim.people.view(post.person) ? !sim.people.alive(post.person, t) : sim.k.value(post.person, 'alive', t) === 'no') continue;
    return post.person;
  }
  return undefined;
}

const personIn = (cast: readonly CastEntry[], spec: string): Id | undefined => {
  for (const role of spec.split('|')) {
    const e = cast.find((x) => x.role === role && x.who !== undefined);
    if (e) return e.who;
  }
  return undefined;
};
const groupIn = (sim: Sim, cast: readonly CastEntry[], spec: string, t: GameTime): Id | undefined => {
  for (const role of spec.split('|')) {
    const e = cast.find((x) => x.role === role);
    if (!e) continue;
    return e.who !== undefined ? groupOf(sim, e.who, t) : e.group;
  }
  return undefined;
};

/** `pRefuse` of a demand of `r` by group `g` (S1 5.2a). */
export function pRefuse(sim: Sim, r: Id, g: Id | undefined, t: GameTime, norm: string, view: OutcomeView): number {
  const o = sim.data.outcomes;
  const base = compliesAt(sim, r, norm, t, view) ? o.refuseC : o.refuseNC;
  const mine = groupOf(sim, r, t);
  const backed = g !== undefined && mine !== undefined && hostile(sim, mine, g);
  const p = base + (backed ? o.backing : 0);
  return p < 0 ? 0 : p > 1 ? 1 : p;
}

/**
 * `outcomeOf(occ, cast)` (S1 5.2a): `prevented` when a guard stood by the ward and the draw is below `p`, `failed` when the victim refuses, else
 * `done`; two roundings, in this order. Returns the guard too, who joins a prevented occurrence as its `guard` participant.
 */
export function outcomeOf(sim: Sim, d: Pick<Descriptor, 'id' | 'kind' | 'time'>, cast: readonly CastEntry[], view: OutcomeView): { outcome: EventOutcome; guard?: Id } {
  const rules = sim.w.kinds.get(d.kind)?.outcomes;
  if (rules === undefined) return { outcome: 'done' };
  const u = sim.ids.outcome(d.id);
  const ward = rules.prevent ? personIn(cast, rules.prevent.ward) : undefined;
  const guard = ward === undefined ? undefined : guardOf(sim, ward, d.time, view);
  const pP = rules.prevent && guard !== undefined ? rules.prevent.p : 0;
  let pF = 0;
  if (rules.fail) {
    if ('chance' in rules.fail) pF = rules.fail.chance;
    else {
      const r = personIn(cast, rules.fail.refusal.refuser);
      pF = r === undefined ? 0 : pRefuse(sim, r, groupIn(sim, cast, rules.fail.refusal.demander, d.time), d.time, rules.fail.refusal.norm, view);
    }
  }
  if (u < pP) return { outcome: 'prevented', guard: guard! };
  if (u < pP + (1 - pP) * pF) return { outcome: 'failed' };
  return { outcome: 'done' };
}

/** The `parties` of an event fact (S1 7.2): every participant, with each person's group at the event's time; a `-group` participant carries its own node. */
export function partiesOf(sim: Sim, participants: ReadonlyArray<{ who: Id; role: string }>, t: GameTime): Array<{ role: string; who: Id; group?: Id }> {
  return participants.map((p) => {
    if (p.role.endsWith('-group')) return { role: p.role, who: p.who, group: p.who };
    const g = groupOf(sim, p.who, t);
    return g === undefined ? { role: p.role, who: p.who } : { role: p.role, who: p.who, group: g };
  });
}
