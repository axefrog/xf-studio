// `ties` (S1 4.7, 8.7): stable ties and recorded interactions, the core of the relationship layer. As a policy, `ties` materialises a tie
// when V observes it, a belief about it is formed or told, or a seed casts through it; updates the NPC's regard from the typed events;
// classifies replies; decides status changes by the NPC's own acceptance; and keeps the retract. Its only draw is `accept`.
//
// For a tie with V only the NPC's side exists: there is no `regard(V -> NPC)` and no field that models V's feelings (D-09). No value of
// this module is shown to V; they reach traces and the decision log only.

import { H, id as hid, s as hs } from '../id.ts';
import type { Edge, GameTime, Id } from '../types.ts';
import { clip01, clamp, q64 } from './arith.ts';
import type { TiesData } from './data.ts';
import type { TieRecord } from './record.ts';
import type { EventView } from './policies.ts';
import type { Sim } from './sim.ts';

export const RUNGS = ['friendly', 'close'] as const;
export type Rung = (typeof RUNGS)[number];
export type TieStatus = 'acquainted' | 'friendly' | 'close' | 'strained' | 'estranged' | 'ended';

/** `pAccept = clip01(accBase[rung] + 0.4 warmth + 0.3 (trustMean - 0.5) + 0.2 (sociability - 0.5))` (S1 4.7). */
export function acceptP(accBase: number, warmth: number, trustMean: number, sociability: number): number {
  return clip01(accBase + 0.4 * warmth + 0.3 * (trustMean - 0.5) + 0.2 * (sociability - 0.5));
}

export interface Regard {
  warmth: number;
  respect: number;
  trustA: number;
  trustB: number;
  trustI: number;
  evN: number;
}

const DAY = 86400;
export const tieEdgeId = (a: Id, b: Id): Id => {
  const [lo, hi] = a < b ? [a, b] : [b, a];
  return H(hs('edge'), hs('xf:tie'), hid(lo), hid(hi));
};
export const regardEdgeId = (npc: Id, toward: Id): Id => H(hs('edge'), hs('xf:regard'), hid(npc), hid(toward));
const SAMPLED = H(hs('tie'), hs('sampled'));
/** The ended intervals of one tie that the record keeps, newest last. */
const SPAN_MAX = 16;

/** Pure projection of recorded interactions; never restores or materialises a tie. */
export function recordedTieStrength(rec: TieRecord | undefined, s: TiesData['strength'], t: GameTime): number {
  if (!rec) return 0;
  const timeP = Math.min(1, rec.hours / s.sharedHoursFull);
  let intensityP = 0;
  for (const e of rec.entries) {
    const age = (t - e.at) / DAY;
    let rec_ = 0;
    for (const r of s.recency) {
      if (age <= r.upToDays) { rec_ = r.weight; break; }
    }
    intensityP = Math.max(intensityP, (e.salience / 3) * rec_);
  }
  const intimacyP = Math.min(1, rec.disclosures * s.disclosureStep);
  const servicesP = Math.min(1, rec.favours / s.favoursFull);
  return q64(0.25 * (timeP + intensityP + intimacyP + servicesP));
}

export class TiePolicy {
  constructor(private readonly sim: Sim) {}

  private get k() {
    return this.sim.k;
  }
  private get cfg(): TiesData {
    return this.sim.data.ties;
  }

  // ---- the materialised tie ----

  edge(a: Id, b: Id): Edge | undefined {
    const e = this.k.persistence.restoreEdge(tieEdgeId(a, b));
    return e && (e.valid.to === undefined || e.valid.to > this.k.now) ? e : undefined;
  }
  hasEdge(a: Id, b: Id): boolean {
    return this.edge(a, b) !== undefined;
  }

  record(a: Id, b: Id): TieRecord {
    const id = tieEdgeId(a, b);
    return (this.sim.record.tieHistory[id] ??= { entries: [], hours: 0, disclosures: 0, favours: 0, lastLoss: { trustA: 0, trustB: 0, trustI: 0 } });
  }

  /** `strength = q64(0.25 (timeP + intensityP + intimacyP + servicesP))`, read from the history and `t`, never pinned (S1 4.7). */
  strengthOf(a: Id, b: Id, t: GameTime = this.k.now): number {
    if (!this.hasEdge(a, b)) return 0;
    return recordedTieStrength(this.sim.record.tieHistory[tieEdgeId(a, b)], this.cfg.strength, t);
  }

  /**
   * Materialise the tie between two nodes (S1 4.6): a person has at most 20; a new one beyond that ends the weakest that nothing depends on.
   * V is outside the cap: the record of whom V knows is never trimmed. When the other end is full and nothing of theirs can be ended,
   * nothing is ended and nothing is made: the result is `undefined` and the refusal is logged `tie-cap` (the cap is a hard limit on
   * retained state, S1-I-12).
   *
   * A tie that was materialised and ended is opened again under its stable Id (SIM-07): the edge is live from now, and the interval that
   * ended is kept in the tie's record for the reads of the past (`intervalsOf`).
   */
  materialise(a: Id, b: Id): Edge | undefined {
    const have = this.edge(a, b);
    if (have) return have;
    const t = this.sim.ties.tie(a, b);
    const [lo, hi] = a < b ? [a, b] : [b, a];
    // both ends are asked before anything is ended
    const drops: Edge[] = [];
    for (const who of [a, b]) {
      const room = this.roomFor(who, who === a ? b : a);
      if (room === 'none') {
        this.sim.logNow({ w: this.sim.windowNow(), proc: 'ties', kind: 'admission', reason: 'tie-cap', key: tieEdgeId(a, b), refs: [who] });
        return undefined;
      }
      if (room !== 'free') drops.push(room);
    }
    for (const e of drops) this.k.endEdge(e.id, this.k.now);
    const id = tieEdgeId(a, b);
    const attrs = { kind: t?.kind ?? 'neighbour', status: 'acquainted', strength: 0, lastContact: -1 };
    const ended = this.k.persistence.restoreEdge(id);
    if (ended) {
      this.addSpan(this.record(a, b), ended.valid.from, ended.valid.to!);
      return this.k.reopenEdge(id, this.k.now, attrs);
    }
    return this.k.addEdge({ id, type: 'xf:tie', from: lo, to: hi, cause: SAMPLED, valid: { from: this.k.now }, attrs });
  }

  /** Remember an interval in which a tie was materialised and ended: the newest `SPAN_MAX`, without repeats. */
  private addSpan(rec: TieRecord, from: GameTime, to: GameTime): void {
    const spans = (rec.spans ??= []);
    if (spans.some((s) => s.from === from && s.to === to)) return;
    spans.push({ from, to });
    spans.sort((x, y) => x.from - y.from || x.to - y.to);
    // what an interval dropped said is no longer known: the record keeps how far back it can still answer
    while (spans.length > SPAN_MAX) rec.spanFloor = Math.max(rec.spanFloor ?? Number.NEGATIVE_INFINITY, spans.shift()!.to);
  }

  /** Before this time the intervals kept do not say whether the pair's tie was materialised: the oldest were dropped. Undefined when none was. */
  coverageFloor(a: Id, b: Id): GameTime | undefined {
    return this.sim.record.tieHistory[tieEdgeId(a, b)]?.spanFloor;
  }

  /** The actual write order of independent tie boundaries, including equal-time writes on different pairs. */
  noteEdge(edge: Readonly<Edge>, ended: boolean): void {
    if (edge.type !== 'xf:tie') return;
    const log = (this.sim.record.tieLog[edge.id] ??= []);
    const push = (t: GameTime, value: 'yes' | 'no') => log.push({ t, value, ord: this.sim.record.ord++ });
    // Attribute writes restate the same validity: they neither allocate nor evict a boundary.
    let start = log.length - 1;
    while (start >= 0 && log[start]!.value !== 'yes') start--;
    const opening = log[start];
    // Reopening clears the end; an attribute update keeps it. The new interval may start in the very same second.
    const reopening = !ended && log[start + 1] !== undefined && edge.valid.to === undefined;
    if (!opening || opening.t !== edge.valid.from || reopening) {
      push(edge.valid.from, 'yes');
      start = log.length - 1;
    }
    const end = log[start + 1];
    if (end?.t !== edge.valid.to) {
      // A scheduled end is still the kernel's. Replace its superseded boundary, keeping the opening's ordinal.
      log.splice(start + 1);
      if (edge.valid.to !== undefined) push(edge.valid.to, 'no');
    }
    this.pruneLog(edge.from, edge.to);
  }

  private pruneLog(a: Id, b: Id): void {
    const id = tieEdgeId(a, b), spans = this.intervalsOf(a, b), floor = this.coverageFloor(a, b);
    if (!this.sim.record.tieLog[id]) return;
    this.sim.record.tieLog[id] = this.sim.record.tieLog[id]!.filter((e) =>
      e.value === 'no' && e.t === floor || spans.some((s) => (e.value === 'yes' ? s.from : s.to) === e.t));
  }

  transitionsOf(a: Id, b: Id): Array<{ t: GameTime; value: 'yes' | 'no'; ord: number }> {
    const spans = this.intervalsOf(a, b);
    // An edge's scheduled future end can be shortened; its superseded boundary must not be replayed.
    const floor = this.coverageFloor(a, b);
    return (this.sim.record.tieLog[tieEdgeId(a, b)] ?? []).filter((e) =>
      e.value === 'no' && e.t === floor || spans.some((s) => (e.value === 'yes' ? s.from : s.to) === e.t));
  }

  /** Keep ended intervals in S1's bounded history, independently of saved edges' physical residency. */
  captureSpans(): void {
    for (const e of this.k.store.allEdges()) {
      if (e.type !== 'xf:tie' || e.valid.to === undefined || e.valid.to > this.k.now) continue;
      this.addSpan(this.record(e.from, e.to), e.valid.from, e.valid.to);
      this.pruneLog(e.from, e.to);
    }
  }

  /** Every interval in which the pair's tie was materialised: those that ended and were opened again, and the edge's own (live or ended). */
  intervalsOf(a: Id, b: Id): Array<{ from: GameTime; to?: GameTime }> {
    const id = tieEdgeId(a, b);
    const out: Array<{ from: GameTime; to?: GameTime }> = [...(this.sim.record.tieHistory[id]?.spans ?? [])];
    const e = this.k.persistence.restoreEdge(id);
    if (e && !out.some((s) => s.from === e.valid.from && s.to === e.valid.to)) out.push(e.valid.to === undefined ? { from: e.valid.from } : { from: e.valid.from, to: e.valid.to });
    return out;
  }

  private ties(who: Id): Edge[] {
    const out: Edge[] = [];
    for (const e of [...this.k.store.edgesFrom(who), ...this.k.store.edgesTo(who)]) if (e.type === 'xf:tie' && (e.valid.to === undefined || e.valid.to > this.k.now)) out.push(e);
    return out.sort((x, y) => (x.id < y.id ? -1 : 1));
  }

  /**
   * Room for one more tie of `who`: `free` under the cap, else the weakest tie that neither V, a live frame nor a memorable belief depends
   * on, or `none` (S1 4.6). V has no cap, and a tie to V never counts as the weakest: V's ties are never trimmed.
   */
  private roomFor(who: Id, other: Id): Edge | 'free' | 'none' {
    const v = this.sim.w.v;
    if (who === v) return 'free';
    const mine = this.ties(who);
    if (mine.length < this.cfg.maxMaterialised) return 'free';
    let weakest: Edge | undefined;
    let weakestS = Number.POSITIVE_INFINITY;
    for (const e of mine) {
      const o = e.from === who ? e.to : e.from;
      if (o === other || o === v) continue;
      if (this.k.frames.framesOf(o).length > 0) continue;
      if (this.k.beliefs.memorable().some((x) => x.belief.believer === who && (x.belief.subject === o || x.belief.evidence.includes(e.id)))) continue;
      const s = this.strengthOf(e.from, e.to);
      if (s < weakestS) {
        weakestS = s;
        weakest = e;
      }
    }
    return weakest ?? 'none';
  }

  // ---- the NPC's regard of V ----

  regardOf(npc: Id, toward: Id): Regard {
    const e = this.k.persistence.restoreEdge(regardEdgeId(npc, toward));
    if (!e) return { warmth: 0, respect: 0, trustA: 0.5, trustB: 0.5, trustI: 0.5, evN: 0 };
    const a = e.attrs;
    return { warmth: a.warmth as number, respect: a.respect as number, trustA: a.trustA as number, trustB: a.trustB as number, trustI: a.trustI as number, evN: a.evN as number };
  }

  private writeRegard(npc: Id, toward: Id, r: Regard): void {
    const attrs = {
      warmth: q64(clamp(r.warmth, -1, 1)), respect: q64(clamp(r.respect, -1, 1)), trustA: q64(clip01(r.trustA)), trustB: q64(clip01(r.trustB)),
      trustI: q64(clip01(r.trustI)), evN: r.evN,
    };
    const id = regardEdgeId(npc, toward);
    if (this.k.persistence.restoreEdge(id)) this.k.updateEdge(id, { attrs });
    else this.k.addEdge({ id, type: 'xf:regard', from: npc, to: toward, cause: SAMPLED, valid: { from: this.k.now }, attrs });
  }

  /** The multiplier on a negative trust delta by the NPC's belief about the cause (S1 4.7): dispositional 1.5, situational 0.5, unknown 1. */
  attributionMultiplier(npc: Id, subject: Id, at: GameTime | undefined): number {
    // a decision that persists reads only what persists: a texture belief is dropped on a load (S1 8.3, 11), and regard is saved
    const b = this.k.beliefs.activeOf(npc).find((x) => x.memorable && x.subject === subject && x.path === 'reason' && (at === undefined || x.at === at));
    if (!b || b.region === undefined || b.region.r !== 'set') return 1;
    const classes = Object.values(this.sim.data.minds.reasons);
    const disp = classes.some((c) => c.dispositional.some((x) => (b.region as { values: string[] }).values.includes(x)));
    const sit = classes.some((c) => c.situational.some((x) => (b.region as { values: string[] }).values.includes(x)));
    return disp && !sit ? 1.5 : sit && !disp ? 0.5 : 1;
  }

  /** Apply a typed interaction to the NPC's regard (S1 4.7): the deltas of the table, each row once, a negative trust delta scaled by the attribution. */
  applyInteraction(npc: Id, toward: Id, row: string, opts: { at?: GameTime; hours?: number; sign?: 1 | -1 } = {}): Regard {
    const d = this.cfg.deltas[row];
    if (!d) throw new Error(`no interaction row ${row}`);
    const r = this.regardOf(npc, toward);
    const sign = opts.sign ?? 1;
    const mAtt = this.attributionMultiplier(npc, toward, opts.at);
    const rec = this.record(npc, toward);
    const trust = (cur: number, delta: number, key: 'trustA' | 'trustB' | 'trustI'): number => {
      const dd = delta < 0 ? delta * mAtt : delta;
      if (dd < 0) rec.lastLoss[key] = -dd;
      return cur + dd;
    };
    const next: Regard = {
      warmth: r.warmth + sign * d.warmth, respect: r.respect + sign * d.respect,
      trustA: trust(r.trustA, d.trustA, 'trustA'), trustB: trust(r.trustB, d.trustB, 'trustB'), trustI: trust(r.trustI, d.trustI, 'trustI'), evN: r.evN + 1,
    };
    if (row === 'disclosure') rec.disclosures++;
    if (row === 'favour') rec.favours++;
    if (row === 'joint-activity') rec.hours += opts.hours ?? 0;
    this.writeRegard(npc, toward, next);
    return this.regardOf(npc, toward);
  }

  /** A repair restores each trust component by `repairFraction x its last loss`, never more than was lost (S1 4.7). */
  repair(npc: Id, toward: Id, withRestitution: boolean): Regard {
    const f = withRestitution ? this.cfg.repairFraction.restitution : this.cfg.repairFraction.apology;
    const r = this.regardOf(npc, toward);
    const rec = this.record(npc, toward);
    const back = (cur: number, loss: number): number => cur + Math.min(loss, f * loss);
    this.writeRegard(npc, toward, { ...r, trustA: back(r.trustA, rec.lastLoss.trustA), trustB: back(r.trustB, rec.lastLoss.trustB), trustI: back(r.trustI, rec.lastLoss.trustI), evN: r.evN + 1 });
    rec.lastLoss = { trustA: 0, trustB: 0, trustI: 0 };
    return this.regardOf(npc, toward);
  }

  // ---- status ----

  statusOf(a: Id, b: Id): TieStatus {
    const e = this.edge(a, b);
    return (e?.attrs.status as TieStatus | undefined) ?? 'acquainted';
  }

  /** Whether the NPC has a boundary against a rung: a persistent pin on the NPC's `boundary` slot (S1 4.7). */
  boundaryAt(npc: Id, rung: string): boolean {
    for (const p of this.k.store.livePinsOn(npc, 'boundary')) {
      if (p.reason !== 'authored' && p.reason !== 'observed') continue;
      if (typeof p.value === 'string' && p.value.split(',').includes(rung)) return true;
    }
    return false;
  }

  sociabilityOf(npc: Id): number {
    return this.sim.people.view(npc)?.sociability ?? 0.5;
  }

  /** `accepted = !boundaryAt(npc, rung) && rand("accept", tie, event) < pAccept`: the key names the tie and the act, so a reload reproduces it. */
  accepts(npc: Id, v: Id, rung: Rung, event: Id): { accepted: boolean; p: number } {
    const r = this.regardOf(npc, v);
    const trustMean = (r.trustA + r.trustB + r.trustI) / 3;
    const p = acceptP(this.cfg.accBase[rung], r.warmth, trustMean, this.sociabilityOf(npc));
    if (this.boundaryAt(npc, rung)) return { accepted: false, p };
    return { accepted: this.sim.ids.accept(tieEdgeId(npc, v), event) < p, p };
  }

  /** V proposes a rung and the NPC answers by its own acceptance; a status change needs an observed V act (S1 4.7). */
  bid(npc: Id, rung: Rung, event: Id): boolean {
    const v = this.sim.w.v;
    // a thread V has retracted is switched off: no bid is made for it (S1 4.7)
    if (this.excluded(npc, v)) {
      this.sim.logNow({ w: this.sim.windowNow(), proc: 'ties', kind: 'admission', reason: 'excluded-thread', key: tieEdgeId(npc, v), refs: [npc, event] });
      return false;
    }
    const edge = this.materialise(npc, v);
    if (!edge) return false;
    const res = this.accepts(npc, v, rung, event);
    if (res.accepted) this.k.updateEdge(edge.id, { attrs: { status: rung } });
    this.applyInteraction(npc, v, res.accepted ? 'reply-accept' : 'reply-decline');
    this.sim.logNow({ w: this.sim.windowNow(), proc: 'ties', kind: 'decision', reason: 'accept', key: `${edge.id}|${event}`, refs: [npc, event] });
    this.fall(npc, v);
    return res.accepted;
  }

  /** A fall is the NPC's own consequence: `strained` when warmth is under -0.4 and trust under 0.3, back to `acquainted` when both recover (S1 4.7). */
  fall(npc: Id, v: Id): void {
    const e = this.edge(npc, v);
    if (!e) return;
    const r = this.regardOf(npc, v);
    const trustMean = (r.trustA + r.trustB + r.trustI) / 3;
    const f = this.cfg.fall;
    const status = e.attrs.status as TieStatus;
    if (status !== 'strained' && status !== 'estranged' && status !== 'ended' && r.warmth < f.warmth && trustMean < f.trust) this.k.updateEdge(e.id, { attrs: { status: 'strained' } });
    else if (status === 'strained' && r.warmth > f.recoverWarmth && trustMean > f.recoverTrust) this.k.updateEdge(e.id, { attrs: { status: 'acquainted' } });
  }

  /** V's reply to a bid, classified from its acts within `replyWindow` (S1 4.7). */
  classifyReply(acts: Array<'accept' | 'decline' | 'deflect'>, vWasInDistrict: boolean): { kind: 'accept' | 'decline' | 'deflect' | 'none'; half: boolean } {
    if (acts.length > 0) return { kind: acts[0]!, half: false };
    return vWasInDistrict ? { kind: 'decline', half: true } : { kind: 'none', half: false };
  }

  // ---- hearing events ----

  private npcOf(ev: EventView): Id | undefined {
    const v = this.sim.w.v;
    for (const p of ev.participants) if (p.who !== v && (this.sim.people.isResident(p.who) || this.k.persistence.restoreReferencedHeader(p.who)?.kind === 'xf:person')) return p.who;
    return undefined;
  }

  hear(ev: EventView): void {
    const v = this.sim.w.v;
    const mine = ev.participants.some((p) => p.who === v);
    if (!mine) return;
    const npc = this.npcOf(ev);
    if (npc === undefined) return;
    // after a retract the thread stays visible and editable, and nothing is made for it
    const off = (): boolean => {
      if (!this.excluded(npc, v)) return false;
      this.sim.logNow({ w: this.sim.windowNow(), proc: 'ties', kind: 'admission', reason: 'excluded-thread', key: tieEdgeId(npc, v), refs: [npc, ev.id] });
      return true;
    };
    const rec = (): TieRecord => this.record(npc, v);
    const note = (reason: string): void => {
      const r = rec();
      r.entries.push({ event: ev.id, salience: this.sim.policies.salienceOf(npc, ev), reason, kind: ev.kind, at: ev.time });
      while (r.entries.length > this.cfg.historyMax) {
        let drop = 0;
        for (let i = 1; i < r.entries.length; i++) if (r.entries[i]!.salience < r.entries[drop]!.salience) drop = i;
        r.entries.splice(drop, 1);
      }
      const e = this.edge(npc, v);
      if (e) this.k.updateEdge(e.id, { attrs: { lastContact: ev.time } });
    };
    switch (ev.kind) {
      case 'disclosure':
      case 'favour':
      case 'conflict':
      case 'joint-activity':
      case 'crisis':
        if (off() || !this.materialise(npc, v)) return;
        this.applyInteraction(npc, v, ev.kind, { at: ev.time, hours: 1 });
        note(ev.kind);
        break;
      case 'repair':
        if (off() || !this.materialise(npc, v)) return;
        this.repair(npc, v, ev.effects.some((e) => e.effect === 'give'));
        note('repair');
        break;
      case 'retract': {
        const id = tieEdgeId(npc, v);
        if (!this.sim.record.softExcluded.includes(id)) this.sim.record.softExcluded.push(id);
        // `ended` is by V's retract (S1 4.7)
        const e = this.edge(npc, v);
        if (e && e.attrs.status !== 'ended') this.k.updateEdge(e.id, { attrs: { status: 'ended' } });
        note('retract');
        break;
      }
      default:
        return;
    }
    this.fall(npc, v);
  }

  /** Whether a thread is soft-excluded by a retract: no bid, event or frame is made for it (S1 4.7). */
  excluded(a: Id, b: Id): boolean {
    return this.sim.record.softExcluded.includes(tieEdgeId(a, b));
  }
}
