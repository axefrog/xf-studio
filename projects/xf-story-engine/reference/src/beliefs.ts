// Beliefs and perspectives (spec 11): per-believer records that never constrain world state, the kernel
// rules (one active belief per question, only independent evidence corroborates, telling passes
// evidence on unchanged), and `knows`.
//
// What a believer forms, tells, forgets and how an audience aggregates are S1's policies. The policy
// below is a marked STUB with the simplest behaviour that keeps the kernel rules testable.

import { canonicalEqual, hrec } from './canon.ts';
import { H, id as hid, i as hi, s as hs } from './id.ts';
import type { TellOperator } from './evolution.ts';
import type { Kernel } from './kernel.ts';
import type { DimId, Edge, GameTime, Id, Region, SlotPath, Value } from './types.ts';
import { type Budget, Worklist } from './work.ts';
import { valueKey } from './value.ts';

export type BeliefSource =
  | { by: 'observed'; event: Id }
  | { by: 'told'; teller: Id; event: Id }
  | { by: 'inferred'; rule: { name: string; version: number }; from: Id[] };

export interface Belief {
  id: Id;
  believer: Id;
  subject: Id;
  path: SlotPath;
  value?: Value;
  region?: Region;
  at?: GameTime;
  confidence: number;
  evidence: Id[];
  source: BeliefSource;
  formed: GameTime;
  refreshed: GameTime;
  memorable: boolean;
  /**
   * How much the belief mattered when it formed, 0 to 3 (S1 8.3; the one field of S0 V4-9 the simulation layer
   * needs). Optional, and omitted when 0, so a record without one is what it was before. `uses` and `widened`, and the
   * memory machinery, stay deferred (V4-30).
   */
  salience?: number;
  /**
   * How many tellings the belief has been through (S1 8.4: a hop limit of 4). Optional, omitted at 0. The simulation layer's field;
   * it changes no kernel rule.
   */
  hop?: number;
}

/** A belief as an operation or a policy states it: the record without its Id, which the kernel derives unless one is given. */
export type BeliefSpec = Omit<Belief, 'id'> & { id?: Id };

export interface BeliefEntry {
  belief: Belief;
  /** False for a memorable loser kept as history. */
  active: boolean;
}

export type SetOutcome = 'added' | 'refreshed' | 'corroborated' | 'replaced' | 'kept';

export type Known =
  | { k: 'belief'; belief: Belief }
  | { k: 'seen'; value?: Value; edges?: Edge[] }
  | { k: 'unknown' };

/** S1's policy hooks (spec 11.2). This is the stub the reference model ships. */
export interface BeliefPolicy {
  /** Beliefs an observer forms on witnessing an event. */
  onWitness(k: Kernel, event: Id, observer: Id): Array<Omit<Belief, 'id' | 'formed' | 'refreshed' | 'believer'> & { id?: Id }>;
  /** Overrides applied to a belief being told (confidence, memorability). Evidence is never overridden. */
  onSocial(k: Kernel, belief: Belief, teller: Id, listener: Id, operator?: TellOperator | null): Partial<Pick<Belief, 'confidence' | 'memorable' | 'path' | 'value' | 'region' | 'salience' | 'hop'>>;
  /** A boundary passed: `at` is the boundary's time (spec 11.2, SPEC-NOTES 50). */
  onTick(k: Kernel, believer: Id, at: GameTime): void;
  aggregate(k: Kernel, audience: Id[], subject: Id, path: SlotPath): { value?: Value; confidence: number; mass?: number; items?: number } | undefined;
  /** Whether a contradicting newcomer replaces the existing belief. */
  replaces(existing: Belief, incoming: Belief): boolean;
  /** Confidence after corroboration by independent evidence. */
  mergeConfidence(a: number, b: number): number;
  /** Dimensions a witness perceives on a mirrored slot (an outfit, for example). */
  visibleDims: Set<DimId>;
}

/** STUB for S1: a witness believes the event's kind with full confidence; a newcomer replaces only if more confident. */
export const STUB_POLICY: BeliefPolicy = {
  onWitness(k, event) {
    const kind = k.value(event, 'kind');
    if (kind === undefined) return [];
    return [{ subject: event, path: 'kind', value: kind, confidence: 1, evidence: [event], source: { by: 'observed', event }, memorable: true }];
  },
  onSocial() {
    return {};
  },
  onTick() {},
  aggregate(k, audience, subject, path) {
    const tally = new Map<string, { value: Value; weight: number }>();
    for (const who of audience) {
      const b = k.beliefs.get(who, subject, path);
      if (!b || b.value === undefined) continue;
      const key = valueKey(b.value);
      const cur = tally.get(key) ?? { value: b.value, weight: 0 };
      cur.weight += b.confidence;
      tally.set(key, cur);
    }
    let best: { value: Value; weight: number } | undefined;
    for (const [, v] of [...tally.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1))) if (!best || v.weight > best.weight) best = v;
    return best ? { value: best.value, confidence: best.weight / Math.max(1, audience.length) } : undefined;
  },
  replaces: (existing, incoming) => incoming.confidence > existing.confidence,
  mergeConfidence: (a, b) => 1 - (1 - a) * (1 - b),
  visibleDims: new Set(),
};

const cmpId = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
const qkey = (subject: Id, path: SlotPath, at: GameTime | undefined): string => `${subject}|${path}|${at === undefined ? '' : at}`;

export class Beliefs {
  private byBeliever = new Map<Id, Map<string, Belief>>();
  private history: Belief[] = [];
  policy: BeliefPolicy = STUB_POLICY;
  private tickList = new Worklist<{ believer: Id; boundary: number; at: GameTime }>();
  /** A run of hooks stopped part-way through a boundary's list (the budget ran out) and has not finished. */
  private hooksStopped = false;
  /**
   * Heard when a belief is added, replaced or dropped, at the time it happens, whoever does it. Beliefs emit no Changes (spec 11), so a
   * layer that keeps a history of what they say (S1's divergence log) cannot wait for the next boundary to learn of one (SIM-08).
   */
  readonly onChange: Array<(believer: Id, subject: Id) => void> = [];

  /**
   * Boundary `boundary` (at game time `at`) was processed: every believer is due its `onTick` for it
   * (fading and the like are S1's, spec 11.2). Every boundary queues its own work, so the hook runs once
   * per believer per boundary, in boundary order, however the ticks fell (SPEC-NOTES 50).
   */
  onBoundary(boundary: number, at: GameTime): void {
    for (const b of [...this.byBeliever.keys()].sort(cmpId)) this.tickList.push({ believer: b, boundary, at });
  }

  get pendingTicks(): number {
    return this.tickList.length;
  }

  /**
   * Whether the hooks of a boundary have begun and not finished. The kernel then resumes them before any
   * frame or dispatch work (SPEC-NOTES 56), so what the later hooks of a boundary see does not depend on
   * where a budget stopped the run.
   */
  get hooksUnderway(): boolean {
    return this.hooksStopped && this.tickList.length > 0;
  }

  /** Call the policy's `onTick` for each believer due, one unit each, resumable. */
  runTicks(budget: Budget): number {
    const steps = this.tickList.run(budget, (item) => {
      this.policy.onTick(this.k, item.believer, item.at);
      return { cost: 1, done: true };
    });
    this.hooksStopped = steps > 0 && this.tickList.length > 0;
    return steps;
  }

  constructor(private readonly k: Kernel) {}

  // ---- reads ----

  get(believer: Id, subject: Id, path: SlotPath, at?: GameTime): Belief | undefined {
    return this.byBeliever.get(believer)?.get(qkey(subject, path, at));
  }

  activeOf(believer: Id): Belief[] {
    return [...(this.byBeliever.get(believer)?.values() ?? [])].sort((a, b) => cmpId(a.id, b.id));
  }

  /** Every belief record kept, active or history, sorted by Id. */
  entries(): BeliefEntry[] {
    const out: BeliefEntry[] = [];
    for (const m of this.byBeliever.values()) for (const b of m.values()) out.push({ belief: b, active: true });
    for (const b of this.history) out.push({ belief: b, active: false });
    return out.sort((a, b) => cmpId(a.belief.id, b.belief.id) || Number(b.active) - Number(a.active));
  }

  /** The memorable records, in the order `entries` gives: the same list, without sorting the texture beliefs that are about to be dropped from it. */
  memorable(): BeliefEntry[] {
    const out: BeliefEntry[] = [];
    for (const m of this.byBeliever.values()) for (const b of m.values()) if (b.memorable) out.push({ belief: b, active: true });
    for (const b of this.history) if (b.memorable) out.push({ belief: b, active: false });
    return out.sort((a, b) => cmpId(a.belief.id, b.belief.id) || Number(b.active) - Number(a.active));
  }

  // ---- writes ----

  private idFor(b: Omit<Belief, 'id'>): Id {
    return H(
      hs('belief'), hid(b.believer), hid(b.subject), hs(b.path), hs(b.at === undefined ? '' : String(b.at)), hi(b.formed),
      hrec(b.value ?? b.region ?? null), hrec(b.source),
    );
  }

  /**
   * Set a belief under the kernel rules (spec 11.2). One active belief per (believer, subject, path, at)
   * (I-9). The same answer with no new independent evidence only refreshes; with new evidence it
   * corroborates. A contradicting newcomer is S1's call (`replaces`); a memorable loser is kept as history.
   */
  set(incoming: Omit<Belief, 'id'> & { id?: Id }): SetOutcome {
    this.k.assertWritable();
    const b: Belief = { ...incoming, id: incoming.id ?? this.idFor(incoming), evidence: [...incoming.evidence].sort(cmpId) };
    if (!(b.confidence > 0 && b.confidence <= 1)) throw new Error('belief confidence is in (0, 1]');
    if ((b.value === undefined) === (b.region === undefined)) throw new Error('a belief has exactly one of value and region');
    let m = this.byBeliever.get(b.believer);
    if (!m) this.byBeliever.set(b.believer, (m = new Map()));
    const key = qkey(b.subject, b.path, b.at);
    const existing = m.get(key);
    let outcome: SetOutcome;
    if (!existing) {
      m.set(key, b);
      outcome = 'added';
    } else if (canonicalEqual(existing.value ?? existing.region, b.value ?? b.region)) {
      const fresh = b.evidence.filter((e) => !existing.evidence.includes(e));
      existing.refreshed = Math.max(existing.refreshed, b.refreshed);
      if (fresh.length === 0) outcome = 'refreshed';
      else {
        existing.evidence = [...existing.evidence, ...fresh].sort(cmpId);
        existing.confidence = this.policy.mergeConfidence(existing.confidence, b.confidence);
        outcome = 'corroborated';
      }
    } else if (this.policy.replaces(existing, b)) {
      if (existing.memorable) this.history.push(existing);
      m.set(key, b);
      outcome = 'replaced';
    } else {
      if (b.memorable) this.history.push(b);
      outcome = 'kept';
    }
    this.k.bump();
    if (outcome === 'added' || outcome === 'replaced') this.notify(b.believer, b.subject);
    return outcome;
  }

  /**
   * Tell the listeners that a believer's belief about a subject changed. A listener keeps state outside the kernel's tables, which a staged
   * batch's discard does not put back, so while a batch is open the notification waits for its commit and goes with a discard (R2-08).
   */
  private notify(believer: Id, subject: Id): void {
    if (this.onChange.length === 0) return;
    const run = (): void => {
      for (const f of this.onChange) f(believer, subject);
    };
    const batch = this.k.batch;
    if (batch !== null && batch.state === 'open') batch.after.push(run);
    else run();
  }

  drop(believer: Id, beliefId: Id): boolean {
    this.k.assertWritable();
    const m = this.byBeliever.get(believer);
    if (!m) return false;
    for (const [key, b] of m) {
      if (b.id === beliefId) {
        m.delete(key);
        this.k.bump();
        this.notify(believer, b.subject);
        return true;
      }
    }
    return false;
  }

  /** Put a record back as it was persisted (a load; no rules applied). */
  restore(entry: BeliefEntry): void {
    if (entry.active) {
      let m = this.byBeliever.get(entry.belief.believer);
      if (!m) this.byBeliever.set(entry.belief.believer, (m = new Map()));
      m.set(qkey(entry.belief.subject, entry.belief.path, entry.belief.at), { ...entry.belief, evidence: [...entry.belief.evidence] });
    } else this.history.push({ ...entry.belief, evidence: [...entry.belief.evidence] });
  }

  /** A deep copy of the belief state, for a staged batch's discard (spec 14.2a). */
  capture(): unknown {
    return structuredClone({ byBeliever: this.byBeliever, history: this.history, tickList: this.tickList.snapshot(), hooksStopped: this.hooksStopped });
  }

  restoreFrom(cap: unknown): void {
    const c = structuredClone(cap) as Record<string, any>;
    this.byBeliever = c.byBeliever;
    this.history = c.history;
    this.tickList.restore(c.tickList);
    this.hooksStopped = c.hooksStopped;
  }

  clear(): void {
    this.byBeliever.clear();
    this.history.length = 0;
    // Work queued for believers of the discarded branch goes with it (spec 14.3).
    this.tickList.clear();
    this.hooksStopped = false;
  }

  /** An observer witnesses an event: the policy's beliefs are set (spec 11.2). */
  observe(observer: Id, event: Id): SetOutcome[] {
    const now = this.k.now;
    return this.policy.onWitness(this.k, event, observer).map((p) =>
      this.set({ ...p, believer: observer, formed: now, refreshed: now }),
    );
  }

  /**
   * A teller passes a belief to a listener. The teller's evidence is passed on unchanged, so a rumour
   * from one origin never corroborates itself (spec 11.2).
   */
  tell(teller: Id, listener: Id, beliefId: Id): SetOutcome | undefined {
    return this.tellWith(teller, listener, beliefId, undefined, null);
  }

  /**
   * A telling that happened in the event `event`, changed by the policy's `operator` (S1 8.4, V4-38). The listener's belief is
   * sourced to that event; its evidence is the teller's, unchanged.
   */
  tellAs(teller: Id, listener: Id, beliefId: Id, event: Id, operator: TellOperator | null): SetOutcome | undefined {
    return this.tellWith(teller, listener, beliefId, event, operator);
  }

  private tellWith(teller: Id, listener: Id, beliefId: Id, event: Id | undefined, operator: TellOperator | null): SetOutcome | undefined {
    const src = this.activeOf(teller).find((b) => b.id === beliefId);
    if (!src) return undefined;
    const now = this.k.now;
    const over = this.policy.onSocial(this.k, src, teller, listener, operator);
    const told: Omit<Belief, 'id'> = {
      believer: listener, subject: src.subject, path: over.path ?? src.path, confidence: over.confidence ?? src.confidence,
      evidence: [...src.evidence], source: { by: 'told', teller, event: event ?? src.evidence[0] ?? src.subject },
      formed: now, refreshed: now, memorable: over.memorable ?? src.memorable,
    };
    const value = over.value ?? (over.region === undefined ? src.value : undefined);
    const region = over.region ?? (over.value === undefined ? src.region : undefined);
    if (value !== undefined) told.value = value;
    if (region !== undefined) told.region = region;
    if (src.at !== undefined) told.at = src.at;
    const sal = over.salience ?? src.salience;
    if (sal) told.salience = sal;
    const hop = over.hop;
    if (hop) told.hop = hop;
    return this.set(told);
  }

  // ---- knowing (spec 11.4) ----

  private edgeTypeOf(path: string): string | null {
    if (this.k.schema.edgeTypes.has(path)) return path;
    if (this.k.schema.edgeTypes.has(`core:${path}`)) return `core:${path}`;
    return null;
  }

  /** Whether the observer witnessed the subject at `t`: some event at `t` lists it as a witness and involves the subject (SPEC-NOTES 21). */
  witnessed(observer: Id, subject: Id, t: GameTime): boolean {
    const k = this.k;
    for (const ev of k.events.eventsAtTime(t)) {
      const wc = k.value(ev, 'witnesses#count', t);
      let sees = false;
      for (let n = 0; typeof wc === 'number' && n < wc; n++) if (k.value(ev, `witnesses[${n}]`, t) === observer) sees = true;
      if (!sees) continue;
      if (ev === subject || k.value(ev, 'place', t) === subject) return true;
      const pc = k.value(ev, 'participants#count', t);
      for (let n = 0; typeof pc === 'number' && n < pc; n++) {
        const m = k.address(ev, `participants[${n}]`);
        if (k.value(m, 'who', t) === subject) return true;
      }
      const ec = k.value(ev, 'effects#count', t);
      for (let n = 0; typeof ec === 'number' && n < ec; n++) {
        const m = k.address(ev, `effects[${n}]`);
        if (k.value(m, 'on', t) === subject) return true;
      }
    }
    return false;
  }

  /**
   * What an observer knows of (subject, path) at `t`: its own belief; else what it can see, if it
   * witnessed the subject; else `unknown`. Never falls back to world truth.
   */
  knows(observer: Id, subject: Id, path: SlotPath, t: GameTime): Known {
    const b = this.get(observer, subject, path, t) ?? this.get(observer, subject, path);
    if (b) return { k: 'belief', belief: b };
    if (!this.witnessed(observer, subject, t)) return { k: 'unknown' };
    const k = this.k;
    const et = this.edgeTypeOf(path);
    if (et) {
      const def = k.schema.edgeType(et);
      if (!def.perceivable) return { k: 'unknown' };
      const edges = k.store
        .edgesFrom(subject)
        .filter((e) => e.type === et && e.valid.from <= t && (e.valid.to === undefined || t < e.valid.to) && e.attrs.visibility === 'open');
      return edges.length > 0 ? { k: 'seen', edges } : { k: 'unknown' };
    }
    const h = k.store.header(subject);
    const info = h ? k.schema.slotInfo(h.kind, path) : null;
    if (h && info && info.def.mode === 'mirrored' && h.origin.by === 'mirrored' && this.policy.visibleDims.has(info.def.dim)) {
      const r = k.resolve(subject, path, t);
      if (r.value !== undefined) return { k: 'seen', value: r.value };
    }
    return { k: 'unknown' };
  }

  aggregate(audience: Id[], subject: Id, path: SlotPath): { value?: Value; confidence: number; mass?: number; items?: number } | undefined {
    return this.policy.aggregate(this.k, audience, subject, path);
  }
}
