// What each kind fills, and how it can fail (S1 5.2a, v0.6). `fills` are the story functions a kind's events fill, as `FillDecl`s over
// the kind's roles with conditions on the outcome and on which roles are present; `outcomes` say how an occurrence can fail or be
// prevented and what each outcome effects. Both are registry data: no kind has code of its own. The kernel stores `fills` and never
// reads them (S0 V4-51); the readers here (`applicableFills`) are S1's and the pulses' (S1 7.8).

import type { FillDecl, EventOutcome } from '../event-kinds.ts';
import type { Effect, Id } from '../types.ts';

export interface OutcomeRules {
  /** The role a guard protects, and the chance when that person is guarded. */
  prevent?: { ward: string; p: number };
  /** A refusal by the victim of a demand, or a flat chance. */
  fail?: { refusal: { refuser: string; demander: string; norm: string } } | { chance: number };
  effects: Record<EventOutcome, Array<{ role: string; effect: Effect }>>;
}

const f = (fn: string, args: Record<string, string>, when?: FillDecl['when']): FillDecl => (when ? { fn, args, when } : { fn, args });
const done = { outcome: ['done'] as EventOutcome[] };
const prev = { outcome: ['prevented'] as EventOutcome[] };

/** The fills of the city kinds and the other fixed kinds, from the table of S1 5.2a. */
export function fillsOfFixedKind(name: string): FillDecl[] | undefined {
  switch (name) {
    case 'theft':
      return [f('wrong', { by: 'aggressor', to: 'victim' }, done), f('transfer', { what: 'item', from: 'victim', to: 'aggressor' }, done),
        f('threaten', { by: 'aggressor', to: 'victim' }, prev), f('protect', { guard: 'guard', ward: 'victim' }, prev)];
    case 'assault':
      return [f('wrong', { by: 'aggressor', to: 'victim' }, done), f('threaten', { by: 'aggressor', to: 'victim' }, prev), f('protect', { guard: 'guard', ward: 'victim' }, prev)];
    case 'gang-clash':
      return [f('wrong', { by: 'aggressor|aggressor-group', to: 'victim|victim-group' }), f('compete', { a: 'aggressor-group|aggressor', b: 'victim-group|victim', prize: '@place' })];
    case 'shakedown':
      return [f('demand', { by: 'aggressor|aggressor-group', of: 'victim' }),
        f('comply', { who: 'victim', to: 'aggressor|aggressor-group' }, done), f('transfer', { from: 'victim', to: 'aggressor|aggressor-group' }, done),
        f('wrong', { by: 'aggressor|aggressor-group', to: 'victim' }, done),
        f('refuse', { who: 'victim', to: 'aggressor|aggressor-group' }, { outcome: ['failed', 'prevented'] }), f('protect', { guard: 'guard', ward: 'victim' }, prev)];
    case 'police-action':
      return [f('protect', { guard: 'responder', ward: 'victim' }, { has: ['responder', 'victim'] }), f('wrong', { by: 'responder', to: 'target' }, { has: ['responder', 'target'] })];
    case 'psycho-break':
      return [f('wrong', { by: 'aggressor', to: 'victim' })];
    case 'disorder':
      return [f('wrong', { by: 'participant', to: 'victim' }, { has: ['victim'] })];
    case 'accident':
      return [f('befall', { who: 'victim' })];
    case 'outage':
    case 'regime-start':
      return [f('befall', { who: '@place' })];
    case 'commerce':
      return [f('transfer', { from: 'giver', to: 'taker' })];
    case 'tell':
      return [f('learn', { who: 'listener', what: 'told' }),
        f('expose', { by: 'teller', what: 'told', to: 'listener' }, { state: { fn: 'conceal', args: { what: 'told', from: 'listener' } } })];
    case 'presence':
      return [f('protect', { guard: 'guard', ward: 'ward' }), f('help', { by: 'guard', to: 'ward' })];
    case 'call-in':
      return [f('demand', { by: 'creditor', of: 'debtor' }), f('repay', { debtor: 'debtor', creditor: 'creditor' }, done), f('comply', { who: 'debtor', to: 'creditor' }, done),
        f('refuse', { who: 'debtor', to: 'creditor' }, { outcome: ['failed'] }), f('wrong', { by: 'debtor', to: 'creditor' }, { outcome: ['failed'] })];
    case 'warning':
      return [f('threaten', { by: 'warner', to: 'warned' })];
    case 'price':
      return [f('threaten', { by: 'warner', to: 'warned' }), f('demand', { by: 'warner', of: 'warned' })];
    case 'search':
      return [f('ask', { by: 'searcher', of: 'asked', what: 'sought' }, { has: ['asked'] })];
    case 'confront':
      return [f('threaten', { by: 'confronter', to: 'confronted' })];
    case 'gig-outcome':
    case 'regime-end':
      return [];
    default:
      return undefined;
  }
}

/** The fills of an enforcement kind `enf.<norm>.<rung>` (S1 5.2a). */
export function fillsOfEnforcement(rung: string): FillDecl[] {
  const out: FillDecl[] = [];
  if (rung === 'word') out.push(f('demand', { by: 'enforcer', of: 'target' }), f('threaten', { by: 'enforcer', to: 'target' }));
  else out.push(f('wrong', { by: 'enforcer', to: 'target' }, done));
  if (rung === 'fine') out.push(f('transfer', { from: 'target', to: 'enforcer' }, done));
  out.push(f('protect', { guard: 'guard', ward: 'target' }, prev));
  return out;
}

/** The outcome rules of the kinds that have them (S1 5.2a): `shakedown`, `theft`, `assault`, `enf.*`; every other kind is always `done`. */
export function outcomeRulesOf(name: string, effects: Array<{ role: string; effect: Effect }>, enforcement?: { rungEffect: Effect }): OutcomeRules | undefined {
  switch (name) {
    case 'shakedown':
      return {
        prevent: { ward: 'victim', p: 0.7 }, fail: { refusal: { refuser: 'victim', demander: 'aggressor|aggressor-group', norm: 'fee' } },
        effects: { done: [{ role: 'victim', effect: 'take' }], failed: [], prevented: [{ role: 'victim', effect: 'protect' }] },
      };
    case 'theft':
    case 'assault':
      return { prevent: { ward: 'victim', p: 0.5 }, effects: { done: effects, failed: [], prevented: [{ role: 'victim', effect: 'protect' }] } };
    case 'call-in':
      return { fail: { chance: 0.4 }, effects: { done: [{ role: 'creditor', effect: 'give' }], failed: [], prevented: [] } };
    default:
      if (enforcement) {
        return { prevent: { ward: 'target', p: 0.5 }, effects: { done: [{ role: 'target', effect: enforcement.rungEffect }], failed: [], prevented: [{ role: 'target', effect: 'protect' }] } };
      }
      return undefined;
  }
}

export interface AppliedFill {
  fn: string;
  args: Record<string, Id | undefined>;
  /** The conditions only a reader that holds more state can settle: a `stance`, or a `state`. */
  pending?: { stance?: string[]; state?: { fn: string; args: Record<string, Id | undefined> } };
}

/**
 * The fills of an event that apply at its outcome and with its participants (S1 5.2a). An argument names a role (`a|b` takes the first
 * present, `@place` is the event's place, `@self` the event); one whose role the event lacks stays unbound. `when.outcome` limits a fill
 * to those outcomes (an event without an outcome counts as `done`), `has` and `lacks` to the roles present or absent. A `state` condition
 * is the reader's to evaluate and is returned as pending, never decided here.
 */
export function applicableFills(decls: readonly FillDecl[], outcome: EventOutcome | undefined, participants: ReadonlyArray<{ who: Id; role: string }>, place?: Id, self?: Id): AppliedFill[] {
  const at = outcome ?? 'done';
  const present = new Set(participants.map((p) => p.role));
  const bind = (spec: string): Id | undefined => {
    for (const r of spec.split('|')) {
      if (r === '@place') return place;
      if (r === '@self') return self;
      const p = participants.find((x) => x.role === r);
      if (p) return p.who;
    }
    return undefined;
  };
  const out: AppliedFill[] = [];
  for (const d of decls) {
    const w = d.when;
    if (w?.outcome && !w.outcome.includes(at)) continue;
    if (w?.has && !w.has.every((r) => present.has(r))) continue;
    if (w?.lacks && w.lacks.some((r) => present.has(r))) continue;
    const args: Record<string, Id | undefined> = {};
    for (const [k, spec] of Object.entries(d.args)) args[k] = bind(spec);
    const a: AppliedFill = { fn: d.fn, args };
    if (w?.stance || w?.state) {
      a.pending = {};
      if (w.stance) a.pending.stance = [...w.stance];
      if (w.state) a.pending.state = { fn: w.state.fn, args: Object.fromEntries(Object.entries(w.state.args).map(([k, spec]) => [k, bind(spec)])) };
    }
    out.push(a);
  }
  return out;
}
