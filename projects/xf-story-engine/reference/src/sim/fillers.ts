// The state fillers of the story patterns (S1 9.1a, v0.6): what fills a story function that is a state, not an event. The composite's matcher fills a
// pattern's state junctures from records, and binds roles nothing has bound yet by a bounded query from an argument already bound. S1 registers each row as
// a state rule in the form S3 v0.6 defines (its 2.2a): the function, an id, the Changes that can make the state true, `fromChange`, `endsBy`, a bounded
// `search` from an argument in `searchFrom`, and `holdsAt`.
//
// Every rule reads only durable records: retained goal frames and the `people.goals` digest, memorable beliefs, edges, and the group digest (S1 11, S0 14.1).
// A rule never returns a frame, a belief, a want or an intention whose actor or believer is V: the engine holds none (S3 2.2a, S1-I-8).

import type { Change, GameTime, Id, Selector } from '../types.ts';
import type { GoalsDigest, GoalView } from './proc-goals.ts';
import type { PostRec } from './outcomes.ts';
import type { GroupDigest } from './proc-groups.ts';
import { groupOf } from './outcomes.ts';
import type { Sim } from './sim.ts';

export type FillerRef =
  | { event: Id } | { edge: Id } | { frame: Id } | { belief: Id }
  | { intent: { group: Id; id: Id } }
  | { norm: { norm: Id; who: Id } }
  | { dilemma: Id };

export interface StateFill {
  filler: FillerRef;
  args: Record<string, Id>;
  /** When the state began. */
  at: GameTime;
  /** What the record rests on: its cause event, a belief's evidence, an intention's decision and grounding act; at most 8. */
  causes: Id[];
}

export interface StateRule {
  fn: string;
  id: string;
  durable: true;
  changes: Selector[];
  fromChange(c: Change, view: Sim): StateFill[];
  endsBy(c: Change, f: FillerRef, view: Sim): boolean;
  /** Candidates in record `Id` order, at most `limit`; only from an argument the function lists in `searchFrom`. */
  search(arg: string, node: Id, t: GameTime, view: Sim, limit: number): { fills: StateFill[]; truncated: boolean };
  holdsAt(f: FillerRef, t: GameTime, view: Sim): 'yes' | 'no' | 'maybe';
}

const HARM = ['harm', 'kill', 'take', 'expose'];
const cmp = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
const FRAME_CHANGES: Selector[] = [{ slot: '*', where: [{ path: '@role', op: 'eq', arg: 'actor' }] }];
const EDGE_CHANGES = (type: string): Selector[] => [{ slot: '*', where: [{ path: '@edge', op: 'eq', arg: type }] }];

const goalsOf = (sim: Sim): GoalView[] => sim.k.evolution.digestPeek<GoalsDigest>('people.goals')?.goals ?? [];
const groupsOf = (sim: Sim): GroupDigest['groups'] => sim.k.evolution.digestPeek<GroupDigest>('group.decide')?.groups ?? {};
const byId = <T extends StateFill>(xs: T[]): T[] => xs.sort((a, b) => cmp(JSON.stringify(a.filler), JSON.stringify(b.filler)));
const cut = (xs: StateFill[], limit: number): { fills: StateFill[]; truncated: boolean } => ({ fills: xs.slice(0, limit), truncated: xs.length > limit });

/** A goal frame's fill: its owner and what it is aimed at, never V as owner (S1 7.10 never gives V a goal). */
const goalFill = (g: GoalView, W: number, args: Record<string, Id>): StateFill => ({ filler: { frame: g.id }, args, at: g.opened * W, causes: [g.source].slice(0, 8) });

/**
 * The goal frames of a rule, as the digest holds them, filtered and mapped to a fill. Each function says which states of a goal it is true in: a
 * blocked goal is still wanted (and owed) but is not pursued, and does not threaten.
 */
function frameRule(fn: string, id: string, states: ReadonlyArray<GoalView['state']>, pick: (g: GoalView, W: number) => StateFill | undefined): StateRule {
  const all = (sim: Sim): StateFill[] => goalsOf(sim).flatMap((g) => { const f = states.includes(g.state) ? pick(g, sim.data.time.W) : undefined; return f ? [f] : []; });
  return {
    fn, id, durable: true, changes: FRAME_CHANGES,
    fromChange: (c, sim) => (c.c === 'frame' && c.level === 'goal' && (c.new === 'active' || c.new === 'blocked') ? byId(all(sim).filter((f) => 'frame' in f.filler && f.filler.frame === c.frame)) : []),
    endsBy: (c, f) => {
      if (c.c !== 'frame' || !('frame' in f) || c.frame !== f.frame) return false;
      return c.new === 'satisfied' || c.new === 'abandoned' || !states.includes(c.new as GoalView['state']) && (c.new === 'active' || c.new === 'blocked');
    },
    search: (arg, node, _t, sim, limit) => cut(byId(all(sim).filter((f) => Object.entries(f.args).some(([k, v]) => k === arg && v === node))), limit),
    holdsAt: (f, t, sim) => {
      if (!('frame' in f)) return 'no';
      const g = goalsOf(sim).find((x) => x.id === f.frame);
      if (g !== undefined && states.includes(g.state) && g.opened * sim.data.time.W <= t) return 'yes';
      return t >= sim.k.now ? 'no' : 'maybe';
    },
  };
}

/** An intention of a group as a state: its object, from the group digest. */
function intentRule(fn: string, id: string, names: string[], argsOf: (group: Id, a: NonNullable<GroupDigest['groups'][Id]['active']>, sim: Sim) => Record<string, Id> | undefined): StateRule {
  const all = (sim: Sim): StateFill[] => Object.entries(groupsOf(sim)).sort((a, b) => cmp(a[0], b[0])).flatMap(([group, g]) => {
    const a = g.active;
    if (!a || !names.includes(a.name)) return [];
    const args = argsOf(group, a, sim);
    return args ? [{ filler: { intent: { group, id: a.id } }, args, at: a.since * sim.data.time.W, causes: [a.id, a.grounds].filter((x): x is Id => x !== undefined).slice(0, 8) }] : [];
  });
  return {
    fn, id, durable: true, changes: [{ kind: 'core:event', slot: '*', where: [{ path: 'kind', op: 'in', arg: names.flatMap((n) => [`decide.${n}`, `relent.${n}`]) }] }],
    fromChange: (c, sim) => (c.c === 'event' && names.some((n) => c.kind === `decide.${n}`) ? all(sim).filter((f) => 'intent' in f.filler && f.filler.intent.id === c.event) : []),
    endsBy: (c, f) => c.c === 'event' && 'intent' in f && names.some((n) => c.kind === `relent.${n}`) && c.participants.some((p) => p.role === 'group' && p.who === f.intent.group),
    search: (arg, node, _t, sim, limit) => cut(all(sim).filter((f) => f.args[arg] === node || (arg === 'who' && 'intent' in f.filler && f.filler.intent.group === node)), limit),
    holdsAt: (f, t, sim) => ('intent' in f && groupsOf(sim)[f.intent.group]?.active?.id === f.intent.id && t >= (groupsOf(sim)[f.intent.group]?.active?.since ?? 0) * sim.data.time.W ? 'yes' : t >= sim.k.now ? 'no' : 'maybe'),
  };
}

/** The live holder edges of every item, each as a fill; the edges and items are recovered first (S0 14.1). */
function heldBy(sim: Sim): StateFill[] {
  const out: StateFill[] = [];
  for (const item of sim.k.store.idsOfKind('xf:item')) {
    sim.k.persistence.recoverIfSaved(item);
    for (const e of sim.k.store.edgesFrom(item)) {
      if (e.type === 'xf:held-by' && (e.valid.to === undefined || e.valid.to > sim.k.now)) out.push({ filler: { edge: e.id }, args: { who: e.to, what: item }, at: e.valid.from, causes: [e.cause] });
    }
  }
  return out;
}

/** The rules S1 registers (S1 9.1a): each row of the table, over the durable records. */
export function stateRules(sim: Sim): StateRule[] {
  const v = sim.w.v;
  const rules: StateRule[] = [];
  const objectOf = (group: Id, a: NonNullable<GroupDigest['groups'][Id]['active']>): Id | undefined => {
    if (a.name === 'punish') return v;
    if (a.name === 'retaliate' && a.rival !== undefined) { const aff = (['A1', 'A2', 'A3'] as const)[a.rival - 2]; return aff === undefined ? undefined : sim.w.group(groupsOf(sim)[group]!.district, aff); }
    return a.ward;
  };

  // hold(who, what): an `xf:held-by` edge (S1 4.9), searchable from the holder or the item
  const heldEdges = (): StateFill[] => byId(heldBy(sim));
  rules.push({
    fn: 'hold', id: 'hold.held-by', durable: true, changes: EDGE_CHANGES('xf:held-by'),
    fromChange: (c) => (c.c === 'edge' && c.edge.type === 'xf:held-by' && !c.ended ? [{ filler: { edge: c.edge.id }, args: { who: c.edge.to, what: c.edge.from }, at: c.edge.valid.from, causes: [c.edge.cause] }] : []),
    endsBy: (c, f) => c.c === 'edge' && 'edge' in f && c.edge.id === f.edge && c.ended,
    search: (arg, node, _t, _s, limit) => cut(heldEdges().filter((f) => f.args[arg === 'who' ? 'who' : 'what'] === node), limit),
    holdsAt: (f, t) => {
      if (!('edge' in f)) return 'no';
      const e = sim.k.persistence.restoreEdge(f.edge);
      return e === undefined ? 'maybe' : e.valid.from <= t && (e.valid.to === undefined || t < e.valid.to) ? 'yes' : 'no';
    },
  });

  // want, pursue, threaten, protect: goal frames, and a group's intention with its object
  const aimed = (g: GoalView): Id | undefined => g.target ?? g.item ?? g.ward;
  rules.push(frameRule('want', 'want.goal', ['active', 'blocked'], (g, W) => (aimed(g) !== undefined ? goalFill(g, W, { who: g.owner, what: aimed(g)! }) : undefined)));
  rules.push(intentRule('want', 'want.intent', ['collect-fee', 'protect-members', 'retaliate', 'punish'], (group, a) => { const o = objectOf(group, a); return o === undefined ? undefined : { who: group, what: o }; }));
  rules.push(frameRule('pursue', 'pursue.goal', ['active'], (g, W) => (aimed(g) !== undefined ? goalFill(g, W, { who: g.owner, target: aimed(g)! }) : undefined)));
  rules.push(intentRule('pursue', 'pursue.intent', ['collect-fee', 'protect-members', 'retaliate', 'punish'], (group, a) => { const o = objectOf(group, a); return o === undefined ? undefined : { who: group, target: o }; }));
  rules.push(frameRule('threaten', 'threaten.goal', ['active'], (g, W) => (g.target !== undefined && g.target !== v && g.acts.some((k) => (sim.w.kinds.get(k)?.effects ?? []).some((e) => HARM.includes(e.effect))) ? goalFill(g, W, { by: g.owner, to: g.target }) : undefined)));
  // protect(guard, ward) by a goal: the post history says when a guard stood for a ward, so a guard whose post has ended no longer protects (S1 4.5, 9.1a)
  const posts = (): PostRec[] => sim.k.evolution.digestPeek<GoalsDigest>('people.goals')?.posts ?? [];
  const W = sim.data.time.W;
  const postFill = (p: PostRec): StateFill => ({ filler: { frame: p.goal }, args: { guard: p.person, ward: p.ward! }, at: p.from * W, causes: [p.goal] });
  const standing = (p: PostRec, t: GameTime): boolean => p.ward !== undefined && p.from * W <= t && (p.until === undefined || t < p.until * W);
  rules.push({
    fn: 'protect', id: 'protect.goal', durable: true, changes: FRAME_CHANGES,
    fromChange: (c) => (c.c === 'frame' && c.level === 'goal' && c.new === 'active' ? byId(posts().filter((p) => p.goal === c.frame && p.until === undefined && p.ward !== undefined).map(postFill)) : []),
    endsBy: (c, f) => c.c === 'frame' && 'frame' in f && c.frame === f.frame && c.new !== 'active',
    search: (arg, node, t, _s, limit) => cut(byId(posts().filter((p) => standing(p, t) && (arg === 'guard' ? p.person : p.ward) === node).map(postFill)), limit),
    holdsAt: (f, t) => {
      if (!('frame' in f)) return 'no';
      const mine = posts().filter((p) => p.goal === f.frame && p.ward !== undefined);
      if (mine.length === 0) return t >= sim.k.now ? 'no' : 'maybe';
      return mine.some((p) => standing(p, t)) ? 'yes' : 'no';
    },
  });
  rules.push(intentRule('protect', 'protect.intent', ['protect-members'], (group, a) => (a.ward === undefined ? undefined : { guard: group, ward: a.ward })));

  // obligate(debtor, creditor): an open collect goal; a membership (debtor the member, creditor the group)
  rules.push(frameRule('obligate', 'obligate.collect', ['active', 'blocked'], (g, W) => (g.kind === 'collect' && g.target !== undefined ? goalFill(g, W, { debtor: g.target, creditor: g.owner }) : undefined)));
  rules.push({
    fn: 'obligate', id: 'obligate.member', durable: true, changes: EDGE_CHANGES('core:member-of'),
    fromChange: (c) => (c.c === 'edge' && c.edge.type === 'core:member-of' && !c.ended ? [{ filler: { edge: c.edge.id }, args: { debtor: c.edge.from, creditor: c.edge.to }, at: c.edge.valid.from, causes: [c.edge.cause] }] : []),
    endsBy: (c, f) => c.c === 'edge' && 'edge' in f && c.edge.id === f.edge && c.ended,
    search: (arg, node, t, _s, limit) => {
      if (arg !== 'debtor') return { fills: [], truncated: false };
      const g = groupOf(sim, node, t);
      return cut(g === undefined ? [] : [{ filler: { edge: `member:${node}` }, args: { debtor: node, creditor: g }, at: 0, causes: [] }], limit);
    },
    holdsAt: (f, t) => ('edge' in f && f.edge.startsWith('member:') ? (groupOf(sim, f.edge.slice(7), t) !== undefined ? 'yes' : 'no') : 'maybe'),
  });

  // member(who, group), leads(who, group): `groupOf` (S1 4.8) and `xf:leads`
  rules.push({
    fn: 'member', id: 'member.group', durable: true, changes: EDGE_CHANGES('core:member-of'),
    fromChange: (c) => (c.c === 'edge' && c.edge.type === 'core:member-of' && !c.ended ? [{ filler: { edge: c.edge.id }, args: { who: c.edge.from, group: c.edge.to }, at: c.edge.valid.from, causes: [c.edge.cause] }] : []),
    endsBy: (c, f) => c.c === 'edge' && 'edge' in f && c.edge.id === f.edge && c.ended,
    search: (arg, node, t, _s, limit) => {
      if (arg !== 'who') return { fills: [], truncated: false };
      const g = groupOf(sim, node, t);
      return cut(g === undefined ? [] : [{ filler: { edge: `member:${node}` }, args: { who: node, group: g }, at: 0, causes: [] }], limit);
    },
    holdsAt: (f, t) => ('edge' in f && f.edge.startsWith('member:') ? (groupOf(sim, f.edge.slice(7), t) !== undefined ? 'yes' : 'no') : 'maybe'),
  });
  // leads(who, group): the `xf:leads` edge itself, by its own Id and its recorded interval; searched from the holder or from the group
  const leadsAt = (e: { valid: { from: GameTime; to?: GameTime } }, t: GameTime): boolean => e.valid.from <= t && (e.valid.to === undefined || t < e.valid.to);
  rules.push({
    fn: 'leads', id: 'leads.seat', durable: true, changes: EDGE_CHANGES('xf:leads'),
    fromChange: (c) => (c.c === 'edge' && c.edge.type === 'xf:leads' && !c.ended ? [{ filler: { edge: c.edge.id }, args: { who: c.edge.from, group: c.edge.to }, at: c.edge.valid.from, causes: [c.edge.cause] }] : []),
    endsBy: (c, f) => c.c === 'edge' && 'edge' in f && c.edge.id === f.edge && c.ended,
    search: (arg, node, t, _s, limit) => {
      sim.k.persistence.recoverIfSaved(node);
      const edges = arg === 'who' ? sim.k.store.edgesFrom(node) : sim.k.store.edgesTo(node);
      return cut(byId(edges.filter((e) => e.type === 'xf:leads' && leadsAt(e, t)).map((e) => ({ filler: { edge: e.id }, args: { who: e.from, group: e.to }, at: e.valid.from, causes: [e.cause] }))), limit);
    },
    holdsAt: (f, t) => {
      if (!('edge' in f)) return 'no';
      const e = sim.k.persistence.restoreEdge(f.edge);
      return e === undefined ? 'maybe' : leadsAt(e, t) ? 'yes' : 'no';
    },
  });

  // blame(who, of, for): a memorable belief of `who` about an act (S1 9.1a). Two forms: a person's `did.<effect>` belief, where `of` is the belief's `subject` (the actor)
  // and `for` the act its evidence names (the first, its canonical origin); and a group's grievance, where `of` is its subject (V) and `for` its value, the act it rests on.
  // Never read from a did.* belief's value, which is the act's target.
  const blames = (believer: Id, t: GameTime): StateFill[] => sim.k.beliefs.activeOf(believer).filter((b) => b.memorable && (b.at ?? 0) <= t).flatMap((b) => {
    if (b.path.startsWith('did.') && b.evidence[0] !== undefined) return [{ filler: { belief: b.id }, args: { who: believer, of: b.subject, for: b.evidence[0] }, at: b.at ?? 0, causes: [...b.evidence].slice(0, 8) }];
    if (b.path === 'against' && typeof b.value === 'string') return [{ filler: { belief: b.id }, args: { who: believer, of: b.subject, for: b.value }, at: b.at ?? 0, causes: [...b.evidence].slice(0, 8) }];
    return [];
  });
  rules.push({
    fn: 'blame', id: 'blame.belief', durable: true, changes: [{ slot: '*', where: [{ path: '@role', op: 'eq', arg: 'believer' }] }],
    fromChange: (c) => (c.c === 'belief' && c.op !== 'dropped' && (c.path.startsWith('did.') || c.path === 'against') ? blames(c.believer, Number.POSITIVE_INFINITY).filter((f) => 'belief' in f.filler && f.filler.belief === c.belief) : []),
    endsBy: (c, f) => c.c === 'belief' && 'belief' in f && c.belief === f.belief && c.op === 'dropped',
    search: (arg, node, t, _s, limit) => (arg === 'who' ? cut(byId(blames(node, t)), limit) : { fills: [], truncated: false }),
    holdsAt: (f, t) => {
      if (!('belief' in f)) return 'no';
      for (const e of sim.k.beliefs.entries()) if (e.belief.id === f.belief) return e.active && (e.belief.at ?? 0) <= t ? 'yes' : 'no';
      return t >= sim.k.now ? 'no' : 'maybe';
    },
  });
  return rules.sort((a, b) => cmp(a.id, b.id));
}
