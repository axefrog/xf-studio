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
    const e = this.k.store.edges.get(tieEdgeId(a, b));
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
    const rec = this.sim.record.tieHistory[tieEdgeId(a, b)];
    if (!rec) return 0;
    const s = this.cfg.strength;
    const timeP = Math.min(1, rec.hours / s.sharedHoursFull);
    let intensityP = 0;
    for (const e of rec.entries) {
      const age = (t - e.at) / DAY;
      let rec_ = 0;
      for (const r of s.recency) {
        if (age <= r.upToDays) {
          rec_ = r.weight;
          break;
        }
      }
      intensityP = Math.max(intensityP, (e.salience / 3) * rec_);
    }
    const intimacyP = Math.min(1, rec.disclosures * s.disclosureStep);
    const servicesP = Math.min(1, rec.favours / s.favoursFull);
    return q64(0.25 * (timeP + intensityP + intimacyP + servicesP));
  }

  /**
   * Materialise the tie between two nodes (S1 4.6): a person has at most 20; a new one beyond that ends the weakest that nothing depends on.
   * When either end is full and nothing of theirs can be ended, nothing is ended and nothing is made: the result is `undefined` and the
   * refusal is logged (the cap is a hard limit on retained state, S1-I-12).
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
    return this.k.addEdge({
      id: tieEdgeId(a, b), type: 'xf:tie', from: lo, to: hi, cause: SAMPLED, valid: { from: this.k.now },
      attrs: { kind: t?.kind ?? 'neighbour', status: 'acquainted', strength: 0, lastContact: -1 },
    });
  }

  private ties(who: Id): Edge[] {
    const out: Edge[] = [];
    for (const e of [...this.k.store.edgesFrom(who), ...this.k.store.edgesTo(who)]) if (e.type === 'xf:tie' && (e.valid.to === undefined || e.valid.to > this.k.now)) out.push(e);
    return out.sort((x, y) => (x.id < y.id ? -1 : 1));
  }

  /**
   * Room for one more tie of `who`: `free` under the cap, else the weakest tie that neither V, a live frame nor a memorable belief depends
   * on (a tie to V is V's, so an NPC never gives one up; V's own are given up like anyone's, weakest first), or `none`.
   */
  private roomFor(who: Id, other: Id): Edge | 'free' | 'none' {
    const mine = this.ties(who);
    if (mine.length < this.cfg.maxMaterialised) return 'free';
    const v = this.sim.w.v;
    let weakest: Edge | undefined;
    let weakestS = Number.POSITIVE_INFINITY;
    for (const e of mine) {
      const o = e.from === who ? e.to : e.from;
      if (o === other || o === v) continue;
      if (this.k.frames.framesOf(o).length > 0) continue;
      // V holds no beliefs: a tie of V's is kept while the other end remembers V
      if (this.k.beliefs.memorable().some((x) => (x.belief.believer === who && (x.belief.subject === o || x.belief.evidence.includes(e.id))) || (who === v && x.belief.believer === o && x.belief.subject === v))) continue;
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
    const e = this.k.store.edges.get(regardEdgeId(npc, toward));
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
    if (this.k.store.edges.get(id)) this.k.updateEdge(id, { attrs });
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
    for (const p of ev.participants) if (p.who !== v && (this.sim.people.isResident(p.who) || this.k.store.header(p.who)?.kind === 'xf:person')) return p.who;
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
