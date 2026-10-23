// Predicate evaluation (S2 section 2.6): Kleene's strong three-valued logic over kernel reads, an explanation
// of every node, and the exposure ledger. Evaluation is read-only and emits nothing (S0 I-13).

import { contains } from '../region.ts';
import { evalPredicate } from '../predicate.ts';
import { newOpCtx } from '../resolve.ts';
import { LimitExceeded } from '../work.ts';
import { ceilingOf } from '../settings.ts';
import type { GameTime, Id, Predicate, Region, Value } from '../types.ts';
import { canonicalKey } from '../canon.ts';
import * as ids from './ids.ts';
import type { Instance, Layer2 } from './layer2.ts';
import { compare, kAll, kAny, kNot, verdictOf } from './pred.ts';
import { readCall, resolveReadArgs } from './reads.ts';
import type {
  Cmp, EventPattern, ExposureGrade, ExposurePattern, Pred, RolePredicate, Verdict,
} from './types.ts';

export interface Explain {
  pred: Pred;
  v: Verdict;
  /** For a `maybe`: the missing reading or the undecided guard behind it. */
  why?: string;
  kids?: Explain[];
}

export interface EvalCtx {
  inst?: Instance;
  t: GameTime;
}

const DAY = 86_400;
export const hourOf = (t: GameTime): number => Math.floor((((t % DAY) + DAY) % DAY) / 3600);

const GRADE: Record<ExposureGrade, number> = { ambient: 0, presented: 1, confirmed: 2 };
export const gradeAtLeast = (g: ExposureGrade | undefined, min: ExposureGrade): boolean => g !== undefined && GRADE[g] >= GRADE[min];

// ---- events ----

export interface EventFacts {
  id: Id;
  time: GameTime;
  kind: string;
  place?: Id;
  participants: Array<{ who: Id; role: string }>;
  effects: Array<{ on: Id; effect: string }>;
  witnesses: Id[];
}

/** The fields of an event node, read at its own time. Undefined when the event's time does not resolve. */
export function eventFacts(l2: Layer2, event: Id): EventFacts | undefined {
  const k = l2.k;
  const h = k.store.header(event);
  if (!h || !k.schema.isKind(h.kind, 'core:event')) return undefined;
  const time = k.value(event, 'time', k.now);
  if (typeof time !== 'number') return undefined;
  const kind = k.value(event, 'kind', time);
  if (typeof kind !== 'string') return undefined;
  const out: EventFacts = { id: event, time, kind, participants: [], effects: [], witnesses: [] };
  const place = k.value(event, 'place', time);
  if (typeof place === 'string') out.place = place;
  const count = (slot: string): number => {
    const c = k.value(event, `${slot}#count`, time);
    return typeof c === 'number' ? c : 0;
  };
  for (let i = 0; i < count('participants'); i++) {
    const m = k.address(event, `participants[${i}]`);
    const who = k.value(m, 'who', time);
    const role = k.value(m, 'role', time);
    if (typeof who === 'string' && typeof role === 'string') out.participants.push({ who, role });
  }
  for (let i = 0; i < count('effects'); i++) {
    const m = k.address(event, `effects[${i}]`);
    const on = k.value(m, 'on', time);
    const effect = k.value(m, 'effect', time);
    if (typeof on === 'string' && typeof effect === 'string') out.effects.push({ on, effect });
  }
  for (let i = 0; i < count('witnesses'); i++) {
    const w = k.value(event, `witnesses[${i}]`, time);
    if (typeof w === 'string') out.witnesses.push(w);
  }
  return out;
}

/**
 * The node a pattern's role or Id names. `committedOnly` is the consumption rule: a role in a pattern means
 * that role's committed cast at the event's time, and before the role commits nothing matches it (S2 section 2.14).
 */
function patternNode(l2: Layer2, inst: Instance | undefined, ref: string | undefined, atTime: GameTime | undefined, committedOnly: boolean): Id | null | undefined {
  if (ref === undefined) return undefined;
  if (ref === 'v') return l2.k.vId;
  if (/^[0-9a-f]{32}$/.test(ref)) return ref;
  if (ref.startsWith('root:')) return l2.k.expandId(ref);
  if (ref.startsWith('game:')) return l2.k.mirrored(ref.slice(5), 'core:thing');
  const r = inst?.st.roles[ref];
  if (!r || r.cast === undefined) return null;
  if (committedOnly && (!r.committed || (atTime !== undefined && (r.committedAt ?? Infinity) > atTime))) return null;
  return r.cast;
}

/** Whether an event matches a pattern; returns the roles the match used, or null. */
export function matchPattern(
  l2: Layer2, inst: Instance | undefined, pat: EventPattern, ev: EventFacts, committedOnly: boolean,
): Record<string, Id> | null {
  const used: Record<string, Id> = {};
  if (pat.kind !== undefined && pat.kind !== ev.kind) return null;
  const node = (ref: string | undefined): Id | null | undefined => {
    const n = patternNode(l2, inst, ref, ev.time, committedOnly);
    if (n && ref && !/^[0-9a-f]{32}$/.test(ref) && ref !== 'v') used[ref] = n;
    return n;
  };
  if (pat.participant !== undefined) {
    const who = node(pat.participant);
    if (who === null || who === undefined) return null;
    if (!ev.participants.some((p) => p.who === who && (pat.role === undefined || p.role === pat.role))) return null;
  } else if (pat.role !== undefined && !ev.participants.some((p) => p.role === pat.role)) return null;
  if (pat.place !== undefined) {
    const pl = node(pat.place);
    if (pl === null || pl === undefined || ev.place !== pl) return null;
  }
  if (pat.effect !== undefined && !ev.effects.some((e) => e.effect === pat.effect)) return null;
  if (pat.witnessedByV && !ev.witnesses.includes(l2.k.vId)) return null;
  if (pat.witnessedBy !== undefined) {
    const w = node(pat.witnessedBy);
    if (w === null || w === undefined || !ev.witnesses.includes(w)) return null;
  }
  return used;
}

/** The event fields a pattern reads, for committing them when an event is consumed (S2 section 2.14). */
export function patternFields(pat: EventPattern): Array<'time' | 'place' | 'kind' | 'participants' | 'effects' | 'witnesses'> {
  const f: Array<'time' | 'place' | 'kind' | 'participants' | 'effects' | 'witnesses'> = ['time'];
  if (pat.kind !== undefined) f.push('kind');
  if (pat.participant !== undefined || pat.role !== undefined) f.push('participants');
  if (pat.place !== undefined) f.push('place');
  if (pat.effect !== undefined) f.push('effects');
  if (pat.witnessedByV || pat.witnessedBy !== undefined) f.push('witnesses');
  return f;
}

// ---- seed facts, since points, counts ----

export function readSeedFact(l2: Layer2, inst: Instance, key: string): number {
  const decl = inst.st.document.facts?.[key];
  const cur = inst.st.facts[key];
  if (cur?.pin !== undefined && !l2.k.store.isWithdrawn(cur.pin)) {
    const p = l2.k.store.pin(cur.pin);
    if (p && typeof p.value === 'number') return p.value;
  }
  return decl?.initial ?? 0;
}

/** The game time a state was last entered, or undefined if it never was. */
export const stateSince = (inst: Instance, state: string): GameTime | undefined => inst.st.entered[state as keyof Instance['st']['entered']];

/** The `since` point of a beat: its last move into a final or deferred state (SPEC-NOTES). */
export const beatSince = (inst: Instance, beat: string): GameTime | undefined => inst.st.beats[beat]?.finalAt;

/** The cumulative play time at which a state was last entered, or undefined if it never was (the `since` point of a play-clock duration). */
export const stateSincePlay = (inst: Instance, state: string): number | undefined => inst.st.enteredPlay[state as keyof Instance['st']['entered']];

/** The cumulative play time of a beat's last move into a final or deferred state. */
export const beatSincePlay = (inst: Instance, beat: string): number | undefined => inst.st.beats[beat]?.finalAtPlay;

/** The key of a play-clock `since` duration, for its restart at a load. */
export const sinceRestartKey = (since: { beat: string } | { state: string }, s: number): string => `since:${canonicalKey(since)}:${s}`;
export const PLAN_RESTART_KEY = 'plan';

/**
 * The cumulative play time a play-clock `since` runs from: its state or beat's stamp, or the load it was restarted from if that is later.
 * The stamp itself is history and is never rewritten, so another duration on the same stamp that had already passed stays passed.
 */
export function sincePlayFrom(inst: Instance, since: { beat: string } | { state: string }, s: number): number | undefined {
  const base = 'beat' in since ? beatSincePlay(inst, since.beat) : stateSincePlay(inst, since.state);
  if (base === undefined) return undefined;
  const r = inst.st.playRestarts?.[sinceRestartKey(since, s)];
  return r === undefined ? base : Math.max(base, r);
}

/** The cumulative play time the unattended plan's play-clock `after` runs from. */
export function planPlayFrom(inst: Instance): number | undefined {
  const base = inst.st.enteredPlay.unattended;
  if (base === undefined) return undefined;
  const r = inst.st.playRestarts?.[PLAN_RESTART_KEY];
  return r === undefined ? base : Math.max(base, r);
}

/**
 * Game time as layer 2 reads a duration: the last simulation window boundary at or before `t`. A game-clock duration is
 * checked at window boundaries only (S2 section 4.3), so a result never depends on where the host's ticks fell.
 */
export const gameTick = (l2: Layer2, t: GameTime = l2.k.now): GameTime => {
  const w = l2.k.config.wSim;
  return Math.floor(t / w) * w;
};

export const subKey = (pat: EventPattern): string => canonicalKey(pat);

export function countOf(inst: Instance, pat: EventPattern, since: { beat: string } | { state: string } | undefined): number {
  let from: GameTime | undefined;
  if (since) {
    from = 'beat' in since ? beatSince(inst, since.beat) : stateSince(inst, since.state);
    if (from === undefined) return 0;
  }
  const key = subKey(pat);
  return inst.st.consumed.filter((c) => c.sub === key && (from === undefined || c.at >= from)).length;
}

// ---- the exposure ledger (S2 section 10.2): derived, not stored ----

export type LedgerEntry =
  | { kind: 'event'; event: Id; grade: ExposureGrade; at: GameTime; facts: EventFacts }
  | { kind: 'delivery'; delivery: Id; seed: Id; template: string; fragment?: string; grade: ExposureGrade; at: GameTime; playTotal: number };

export function ledger(l2: Layer2): LedgerEntry[] {
  const k = l2.k;
  const v = k.vId;
  const out: LedgerEntry[] = [];
  for (const ev of k.events.canonEvents()) {
    const facts = eventFacts(l2, ev);
    if (!facts) continue;
    const acts = facts.participants.some((p) => p.who === v);
    const saw = facts.witnesses.includes(v);
    if (!acts && !saw) continue;
    out.push({ kind: 'event', event: ev, grade: acts ? 'confirmed' : 'presented', at: facts.time, facts });
  }
  const seen = new Set<Id>();
  const add = (r: { delivery: Id; seed: Id; template: string; fragment?: string; grade: ExposureGrade; at: GameTime; playTotal: number }): void => {
    if (seen.has(r.delivery)) {
      // The highest grade a delivery reached counts.
      const e = out.find((x) => x.kind === 'delivery' && x.delivery === r.delivery);
      if (e && e.kind === 'delivery' && GRADE[r.grade] > GRADE[e.grade]) e.grade = r.grade;
      return;
    }
    seen.add(r.delivery);
    const e: LedgerEntry = { kind: 'delivery', delivery: r.delivery, seed: r.seed, template: r.template, grade: r.grade, at: r.at, playTotal: r.playTotal };
    if (r.fragment !== undefined) e.fragment = r.fragment;
    out.push(e);
  };
  for (const inst of l2.all()) {
    for (const r of inst.st.receipts) add(r);
    for (const d of inst.st.deliveries) {
      if (d.grade !== undefined && d.grade !== 'ambient') {
        add({ delivery: d.id, seed: inst.id, template: inst.st.template.id, ...(d.fragment !== undefined ? { fragment: d.fragment } : {}), grade: d.grade, at: d.displayedAt === undefined ? k.now : k.now, playTotal: l2.playTotal() });
      }
    }
  }
  for (const r of l2.global.receipts) add(r);
  return out;
}

function exposedMatches(l2: Layer2, ctx: EvalCtx, pat: ExposurePattern): boolean {
  const min = pat.atLeast ?? 'confirmed';
  const t = ctx.t;
  for (const e of ledger(l2)) {
    if (!gradeAtLeast(e.grade, min)) continue;
    if (pat.since !== undefined) {
      if (pat.since.clock === 'game' && e.at < t - pat.since.s) continue;
      if (pat.since.clock === 'play' && e.kind === 'delivery' && e.playTotal < l2.playTotal() - pat.since.s) continue;
    }
    if (pat.event !== undefined) {
      if (e.kind !== 'event') continue;
      if (!matchPattern(l2, ctx.inst, pat.event, e.facts, false)) continue;
    }
    if (pat.fragment !== undefined && !(e.kind === 'delivery' && e.fragment === pat.fragment)) continue;
    if (pat.seed !== undefined && !(e.kind === 'delivery' && (e.template === pat.seed || e.seed === pat.seed))) continue;
    if (pat.delivery !== undefined && !(e.kind === 'delivery' && e.delivery === pat.delivery)) continue;
    return true;
  }
  return false;
}

// ---- the evaluator ----

export const respMatches = (resp: string | undefined, pats: string[]): boolean => {
  if (resp === undefined) return false;
  return pats.some((p) => p === resp || (p === 'action' && resp.startsWith('action:')) || (p === 'decline' && resp.startsWith('decline:')) || (p.endsWith(':*') && resp.startsWith(p.slice(0, -1))));
};

function substituteRoles(l2: Layer2, inst: Instance | undefined, arg: unknown): { value: unknown; missing?: string } {
  if (Array.isArray(arg)) {
    const out: unknown[] = [];
    for (const a of arg) {
      const r = substituteRoles(l2, inst, a);
      if (r.missing) return r;
      out.push(r.value);
    }
    return { value: out };
  }
  if (typeof arg === 'object' && arg !== null) {
    const o = arg as Record<string, unknown>;
    if (Object.keys(o).length === 1 && typeof o.role === 'string') {
      const c = inst?.st.roles[o.role]?.cast;
      return c === undefined ? { value: arg, missing: o.role } : { value: c };
    }
    const out: Record<string, unknown> = {};
    for (const [key, v] of Object.entries(o)) {
      const r = substituteRoles(l2, inst, v);
      if (r.missing) return r;
      out[key] = r.value;
    }
    return { value: out };
  }
  return { value: arg };
}

/** A kernel predicate on a cast node: `maybe` when the role is not cast or the kernel's resolution is anything but `ok` (S2 section 2.6). */
export function roleVerdict(l2: Layer2, ctx: EvalCtx, role: string, p: RolePredicate): { v: Verdict; why?: string } {
  const inst = ctx.inst;
  const r = inst?.st.roles[role];
  if (!r || r.cast === undefined) return { v: 'maybe', why: `the role "${role}" is not cast` };
  const sub = substituteRoles(l2, inst, p.arg);
  if (sub.missing) return { v: 'maybe', why: `the role "${sub.missing}", named in the test, is not cast` };
  const k = l2.k;
  const op = newOpCtx(k.config.allowance);
  const env = k.resolver.makeEnv(op, ctx.t);
  let bad: string | undefined;
  const base = env.read;
  env.read = (n, path) => {
    const res = base(n, path);
    if (res.status !== 'ok' || res.value === undefined) bad ??= `${path} of ${n} reads ${res.status}`;
    return res;
  };
  try {
    const yes = evalPredicate(env, { ...p, arg: sub.value } as Predicate, r.cast);
    if (bad !== undefined) return { v: 'maybe', why: `the kernel's resolution is not ok: ${bad}` };
    return { v: verdictOf(yes) };
  } catch (e) {
    if (e instanceof LimitExceeded) return { v: 'maybe', why: `a work limit was reached: ${e.reason}` };
    throw e;
  }
}

const NODE_SELECT = (n: Id): Id => n;

function guardOf(l2: Layer2, ctx: EvalCtx, name: string, depth: number): Explain | undefined {
  const g = l2.facts[name]?.decidedBy;
  if (g === undefined) return undefined;
  const pred = typeof g === 'string' && g !== 'yes' && g !== 'no' ? l2.parseCached(g) : (g as Pred);
  return ex(l2, ctx, pred, depth + 1, true);
}

function ex(l2: Layer2, ctx: EvalCtx, p: Pred, depth: number, explain: boolean): Explain {
  const k = l2.k;
  const done = (v: Verdict, why?: string, kids?: Explain[]): Explain => {
    const out: Explain = { pred: p, v };
    if (why !== undefined) out.why = why;
    if (explain && kids) out.kids = kids;
    return out;
  };
  if (depth > 16) return done('maybe', 'predicates nest too deeply');
  if (p === 'yes') return done('yes');
  if (p === 'no') return done('no');
  if ('all' in p) {
    const kids = p.all.map((c) => ex(l2, ctx, c, depth + 1, explain));
    return done(kAll(kids.map((x) => x.v)), undefined, kids);
  }
  if ('any' in p) {
    const kids = p.any.map((c) => ex(l2, ctx, c, depth + 1, explain));
    return done(kAny(kids.map((x) => x.v)), undefined, kids);
  }
  if ('not' in p) {
    const kid = ex(l2, ctx, p.not, depth + 1, explain);
    return done(kNot(kid.v), kid.why, [kid]);
  }
  if ('fact' in p) {
    const guard = guardOf(l2, ctx, p.fact, depth);
    if (guard && guard.v !== 'yes') return done('maybe', `the guard of ${p.fact} is ${guard.v}${guard.why ? ` (${guard.why})` : ''}`, [guard]);
    const node = l2.factNode(p.fact);
    const r = k.resolve(node, 'value', ctx.t);
    if (r.status !== 'ok' || typeof r.value !== 'number') return done('maybe', `no game reading of ${p.fact} is in effect at ${ctx.t}`);
    return done(verdictOf(compare(r.value, p.op, p.value)));
  }
  if ('decided' in p) {
    const guard = guardOf(l2, ctx, p.decided, depth);
    return done(guard ? guard.v : 'yes', guard && guard.v !== 'yes' ? `the guard of ${p.decided} is ${guard.v}` : undefined, guard ? [guard] : undefined);
  }
  if ('seedFact' in p) {
    if (!ctx.inst) return done('maybe', 'there is no instance to read');
    return done(verdictOf(compare(readSeedFact(l2, ctx.inst, p.seedFact), p.op, p.value)));
  }
  if ('role' in p) {
    const r = roleVerdict(l2, ctx, p.role, p.p);
    return done(r.v, r.why);
  }
  if ('cast' in p) {
    const r = ctx.inst?.st.roles[p.cast];
    return done(verdictOf(!!r && (r.cast !== undefined || r.standIn !== undefined)));
  }
  if ('seed' in p) {
    const isId = /^[0-9a-f]{32}$/.test(p.seed);
    let yes = false;
    if (isId) {
      const i = l2.insts.get(p.seed);
      yes = i ? p.state.includes(i.st.state) : l2.global.history.some((h) => h.seed === p.seed && p.state.includes(h.state));
    } else {
      yes = l2.ofTemplate(p.seed).some((i) => p.state.includes(i.st.state)) ||
        l2.global.history.some((h) => h.template === p.seed && p.state.includes(h.state));
    }
    return done(verdictOf(yes));
  }
  if ('beat' in p) {
    const b = ctx.inst?.st.beats[p.beat];
    return done(verdictOf(!!b && p.state.includes(b.state)));
  }
  if ('response' in p) {
    const b = ctx.inst?.st.beats[p.response];
    return done(verdictOf(respMatches(b?.response, p.is)));
  }
  if ('hour' in p) {
    const h = hourOf(ctx.t);
    const [a, b] = p.hour;
    return done(verdictOf(a <= b ? h >= a && h < b : h >= a || h < b));
  }
  if ('count' in p) {
    if (!ctx.inst) return done('maybe', 'there is no instance to read');
    return done(verdictOf(compare(countOf(ctx.inst, p.count, p.since), p.op, p.value)));
  }
  if ('since' in p && 'atLeast' in p) {
    if (!ctx.inst) return done('maybe', 'there is no instance to read');
    if (p.atLeast.clock === 'play') {
      const fromPlay = sincePlayFrom(ctx.inst, p.since, p.atLeast.s);
      if (fromPlay === undefined) return done('no');
      return done(verdictOf(l2.playTotal() - fromPlay >= p.atLeast.s));
    }
    const from = 'beat' in p.since ? beatSince(ctx.inst, p.since.beat) : stateSince(ctx.inst, p.since.state);
    if (from === undefined) return done('no');
    return done(verdictOf(gameTick(l2, ctx.t) - from >= p.atLeast.s));
  }
  if ('exposed' in p) return done(verdictOf(exposedMatches(l2, ctx, p.exposed)));
  if ('cap' in p) return done(l2.port.cap(p.cap));
  if ('setting' in p) {
    const s = k.settings.at(ctx.t);
    let value: string | undefined;
    if (p.setting.startsWith('content.')) value = String(ceilingOf(s, p.setting.slice('content.'.length)));
    else if (p.setting === 'tempo') value = s.tempo;
    return done(verdictOf(value !== undefined && p.is.includes(value)));
  }
  if ('believes' in p) {
    const b = p.believes;
    const who = ctx.inst?.st.roles[b.who]?.cast;
    if (who === undefined) return done('maybe', `the role "${b.who}" is not cast`);
    let subject: Id | undefined;
    if (b.of === 'v') subject = k.vId;
    else if (/^[0-9a-f]{32}$/.test(b.of)) subject = b.of;
    else subject = ctx.inst?.st.roles[b.of]?.cast;
    if (subject === undefined) return done('maybe', `the role "${b.of}" is not cast`);
    const known = k.beliefs.knows(who, subject, b.path, ctx.t);
    if (known.k === 'unknown') return done('maybe', `${b.who} holds no belief about ${b.path}`);
    const value: Value | undefined = known.k === 'belief' ? known.belief.value : known.value;
    const conf = known.k === 'belief' ? known.belief.confidence : 1;
    if (value === undefined) return done('no');
    const region: Region | undefined = b.is;
    const inIs = region === undefined ? true : contains(region, value);
    return done(verdictOf(inIs && conf >= (b.atLeast ?? 0)));
  }
  if ('fn' in p) {
    const f = l2.reg.pred(p.fn.name, p.fn.version);
    if (!f) return done('maybe', `the function ${p.fn.name}@${p.fn.version} is not registered`);
    return done(f.eval(p.args, { now: ctx.t }));
  }
  if ('city' in p || 'social' in p) {
    // The simulation layer's reads (S2 2.16, 2.17): a read it builds is asked of it, and answers `maybe` until it has a reading for the scope.
    const call = readCall(p);
    if ('error' in call) return done('maybe', call.error);
    const port = l2.reg.sim;
    if (!port?.builds(call.name)) return done('maybe', `the ${call.family} read "${call.name}" is not supported yet`);
    const args = resolveReadArgs(call, ctx.inst);
    if (args === undefined) return done('maybe', 'a role of the read is not cast');
    const value = port.eval(call.name, args, ctx.t);
    if (value === 'maybe') return done('maybe', `the simulation layer has no reading of ${call.name} yet`);
    return done(verdictOf(p.is.includes(value)));
  }
  // clocks are a later capability; compile refuses them (section 0.3).
  return done('maybe', 'a later capability, not supported yet');
}

export function evalPred(l2: Layer2, ctx: EvalCtx, p: Pred): Verdict {
  return ex(l2, ctx, p, 0, false).v;
}

/** A read-only explanation of every node of a predicate (S2 section 2.6): its value and, for a `maybe`, what is missing. */
export function explainPred(l2: Layer2, ctx: EvalCtx, p: Pred): Explain {
  return ex(l2, ctx, p, 0, true);
}

void NODE_SELECT;
export type { Cmp };
