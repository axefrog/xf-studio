// The policies (S1 8): event-driven code that runs behind a kernel hook or a relevance emission and keeps no schedule of its own. Its
// state is the S1 record and the beliefs. Relevance emissions reach S1 in the kernel's order; S1 applies its own threshold on top of
// the kernel's `theta_react`.
//
// The watch frame (S1 8): one frame on the root `city`. Its `reactsTo` selectors are V's acts, the readings of the mirrored slots a
// correction reaches, and the events that have witnesses to form beliefs. `witness` forms beliefs, `absorb` puts V's acts in the
// carriers, `reconcile` ends what the game now contradicts, `v.frames` opens only what the game states.

import { type Belief, type BeliefPolicy, STUB_POLICY } from '../beliefs.ts';
import { CONFLICT_TABLE } from '../registry.ts';
import { H, id as hid, mintedId, s as hs } from '../id.ts';
import type { Kernel } from '../kernel.ts';
import type { Relevance } from '../relevance.ts';
import type { Change, Effect, GameTime, Id, Region } from '../types.ts';
import { ln } from '../fdlibm-log.ts';
import { clamp, invCum, q64 } from './arith.ts';
import { RAW_KIND_NAMES, TIE_KIND_NAMES } from './kinds.ts';
import type { Occurrence } from './occ.ts';
import { recipeClasses } from './fit.ts';
import { grievanceFromAct, grievanceFromBelief, seedGoals } from './grievance.ts';
import type { Sim } from './sim.ts';

export interface EventView {
  id: Id;
  kind: string;
  time: GameTime;
  place?: Id;
  participants: Array<{ who: Id; role: string }>;
  effects: Array<{ on: Id; effect: Effect }>;
  witnesses: Id[];
  causes: Id[];
  outcome?: string;
  creator: Id | undefined;
}

const CLASS_NAMES = ['civilian', 'ncpd', 'A1', 'A2', 'A3', 'other'] as const;
const ACTOR_ROLES = ['actor', 'aggressor', 'enforcer'];
const RAW = new Set<string>(RAW_KIND_NAMES);
const TIES = new Set<string>(TIE_KIND_NAMES);
const cmp = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

export class Policies {
  /** The watch frame's Id: `H("mint", city, city, "frame:s1-watch")` (S1 8). */
  readonly watch: Id;
  /** Beliefs formed, tellings made and items absorbed: counters for the tests and the evidence tools. */
  readonly stats = { witnessed: 0, absorbed: 0, told: 0, corrections: 0 };

  constructor(readonly sim: Sim) {
    this.watch = mintedId(sim.w.city, sim.w.city, 'frame:s1-watch');
  }

  private get k(): Kernel {
    return this.sim.k;
  }

  // ---- installation ----

  /** Install the belief policy, open the watch frame and listen for relevance. The frame is not persisted, so a load opens it again. */
  install(): void {
    const k = this.k;
    k.beliefs.policy = this.beliefPolicy();
    k.frames.demandRoots.add(this.sim.w.v);
    this.openWatch();
    k.dispatcher.onRelevance((r) => this.hear(r));
  }

  openWatch(): void {
    const k = this.k;
    if (k.frames.frame(this.watch)) return;
    const v = this.sim.w.v;
    k.frames.open({
      id: this.watch, actor: this.sim.w.city, level: 'situation', origin: this.sim.w.city, weight: 1, focus: { nodes: [], tier: 0 }, cause: this.sim.w.city,
      own: {
        reactsTo: [
          // V's acts
          { slot: '*', scope: { nodes: [v] }, where: [{ path: '@role', op: 'in', arg: ACTOR_ROLES }] },
          // the readings a correction reaches
          { kind: 'xf:person', slot: 'alive' }, { kind: 'xf:person', slot: 'affiliation' }, { kind: 'xf:person', slot: 'quest-linked' },
          // what V's mirrored state and the journal say
          { kind: 'xf:v-state', slot: 'cell' }, { kind: 'xf:journal', slot: 'tracked' }, { kind: 'xf:journal', slot: 'jstate' },
          // every event, for the witnesses to form beliefs
          { kind: 'core:event', slot: '*' },
          // v0.6 (S1 8.9): a belief about V, which a group member's told grievance rests on, and (S1 8.10) the frames of people, which a seed's role goal is among
          { slot: '*', scope: { nodes: [v] }, where: [{ path: '@role', op: 'eq', arg: 'subject' }] },
          { kind: 'core:person', slot: '*', where: [{ path: '@role', op: 'eq', arg: 'actor' }] },
          { kind: 'xf:resident', slot: '*', where: [{ path: '@role', op: 'eq', arg: 'actor' }] },
        ],
      },
    });
  }

  // ---- reading events ----

  viewEvent(id: Id): EventView | undefined {
    const k = this.k;
    const kind = k.value(id, 'kind');
    const time = k.value(id, 'time');
    if (typeof kind !== 'string' || typeof time !== 'number') return undefined;
    const count = (key: string): number => {
      const c = k.value(id, `${key}#count`);
      return typeof c === 'number' ? c : 0;
    };
    const participants: EventView['participants'] = [];
    for (let i = 0; i < count('participants'); i++) {
      const m = k.address(id, `participants[${i}]`);
      const who = k.value(m, 'who');
      const role = k.value(m, 'role');
      if (typeof who === 'string' && typeof role === 'string') participants.push({ who, role });
    }
    const effects: EventView['effects'] = [];
    for (let i = 0; i < count('effects'); i++) {
      const m = k.address(id, `effects[${i}]`);
      const on = k.value(m, 'on');
      const effect = k.value(m, 'effect');
      if (typeof on === 'string' && typeof effect === 'string') effects.push({ on, effect: effect as Effect });
    }
    const witnesses: Id[] = [];
    for (let i = 0; i < count('witnesses'); i++) {
      const w = k.value(id, `witnesses[${i}]`);
      if (typeof w === 'string') witnesses.push(w);
    }
    const causes: Id[] = [];
    for (let i = 0; i < count('causes'); i++) {
      const c = k.value(id, `causes[${i}]`);
      if (typeof c === 'string') causes.push(c);
    }
    const h = k.persistence.restoreReferencedHeader(id);
    const v: EventView = { id, kind, time, participants, effects, witnesses, causes, creator: h?.origin.by === 'minted' ? h.origin.creator : undefined };
    const place = k.value(id, 'place');
    if (typeof place === 'string') v.place = place;
    const outcome = k.value(id, 'outcome');
    if (typeof outcome === 'string') v.outcome = outcome;
    return v;
  }

  changeOf(ev: EventView): Extract<Change, { c: 'event' }> {
    const ch: Extract<Change, { c: 'event' }> = { c: 'event', event: ev.id, kind: ev.kind, participants: ev.participants, effects: ev.effects };
    if (ev.place !== undefined) ch.place = ev.place;
    return ch;
  }

  /** The canonical originating evidence (S1 8.6): the raw event behind a mirrored one, the teller's evidence behind a telling, else the event itself. */
  origin(ev: EventView): Id {
    const mirror = this.sim.mirrorProc;
    if (ev.creator === mirror && ev.causes[0] !== undefined) return ev.causes[0];
    if (ev.kind === 'tell' && ev.causes[0] !== undefined) {
      const src = this.viewEvent(ev.causes[0]);
      return src ? this.origin(src) : ev.causes[0];
    }
    return ev.id;
  }

  // ---- classes ----

  /** The class name of a node for a district (S1 8.6): `civilian`, `ncpd`, `A1` ... `A3`, `other`. */
  classNameOf(node: Id, district: Id): string {
    const d = this.sim.w.district(district);
    const v = this.sim.people.view(node);
    if (v) return CLASS_NAMES[v.affc]!;
    for (const a of ['A1', 'A2', 'A3'] as const) if (this.sim.w.group(district, a) === node) return a;
    const aff = this.k.value(node, 'affiliation');
    if (typeof aff === 'string') return CLASS_NAMES[this.sim.casting.classIndexOf(d, aff)]!;
    return 'civilian';
  }

  districtOfPlace(place: Id | undefined): Id {
    if (place !== undefined) {
      const c = this.sim.w.index.cells[place];
      if (c) return c.district;
      if (this.sim.w.index.districts[place]) return place;
    }
    const vd = this.k.value(this.sim.w.vState, 'district');
    return typeof vd === 'string' && this.sim.w.index.districts[vd] ? vd : this.sim.w.districts[0]!.id;
  }

  /** Whether a node has authored state of its own, or V has met it: S1 forms beliefs only for these (S1 8.3). */
  focal(n: Id): boolean {
    return this.k.frames.framesOf(n).length > 0;
  }

  observedByV(n: Id): boolean {
    this.k.persistence.recoverIfSaved(n);
    for (const p of this.k.store.pinsOfNode(n)) if (p.reason === 'observed' && !this.k.store.isWithdrawn(p.id)) return true;
    return false;
  }

  // ---- hearing relevance ----

  hear(r: Relevance): void {
    if (r.frame !== this.watch || r.r < this.sim.data.minds.thetaS1) return;
    if (this.k.readOnly) return;
    const ch = r.change;
    if (ch.c === 'event') {
      const ev = this.viewEvent(ch.event);
      if (ev) this.heardEvent(ev);
    } else if (ch.c === 'reading') {
      this.heardReading(ch);
    } else if (ch.c === 'belief') {
      grievanceFromBelief(this, ch);
    } else if (ch.c === 'frame') {
      seedGoals(this, ch);
    } else if (ch.c === 'pin' && ch.slot === 'outcome') {
      // v0.6 (S1 8.6): a promise is absorbed once the record gives it an outcome
      const ev = this.viewEvent(ch.node);
      if (ev && ev.kind === 'promise') this.absorb(ev);
    }
  }

  private heardEvent(ev: EventView): void {
    if (ev.kind.startsWith('meta:')) return;
    this.witness(ev);
    this.absorb(ev);
    // v0.6 (S1 8.9): what a group comes to believe of V's act; a raw record of what the game did is not an act of V's but the mirror's derived event re-describes it
    if (!RAW.has(ev.kind)) grievanceFromAct(this, ev);
    this.sim.tiePolicy.hear(ev);
  }

  // ---- witness: perception, salience and attribution (S1 8.3) ----

  /** Who forms beliefs about an event: its witnesses that are focal, that V has met, or that belong to a carrier. */
  witness(ev: EventView): void {
    if (RAW.has(ev.kind) || TIES.has(ev.kind) || ev.kind === 'tell') return;
    let n = 0;
    for (const w of ev.witnesses) {
      if (!(this.focal(w) || this.observedByV(w) || this.belongsToCarrier(w, ev))) continue;
      this.k.beliefs.observe(w, ev.id);
      n++;
    }
    this.stats.witnessed += n;
  }

  belongsToCarrier(n: Id, ev: EventView): boolean {
    const v = this.sim.people.view(n);
    if (!v) return false;
    const district = this.districtOfPlace(ev.place);
    return this.sim.data.ledger.carriers.some((c) => {
      if (c.type === 'circle') return c.roles?.includes(v.role) ?? false;
      if (c.type === 'group') return v.affc === ({ A1: 2, A2: 3, A3: 4 })[c.aff!] && this.sim.w.cell(v.cell).district === district;
      return this.sim.w.cell(v.cell).district === district;
    });
  }

  /** Salience at formation, 0 to 3, one point each (S1 8.3). */
  salienceOf(observer: Id, ev: EventView): number {
    const m = this.sim.data.minds;
    const kd = this.sim.w.kinds.get(ev.kind);
    let s = 0;
    if (this.k.matchStrength(observer, this.changeOf(ev)) >= m.salienceStakes) s++;
    if ((kd?.pulse ?? 0) >= m.pulseMemorable) s++;
    if (ev.participants.some((p) => p.who !== observer && this.tiedTo(observer, p.who))) s++;
    return Math.min(3, s);
  }

  /** A tie at layer 2 or inner, or a materialised tie (S1 8.3). */
  tiedTo(a: Id, b: Id): boolean {
    if (this.sim.tiePolicy.hasEdge(a, b)) return true;
    const t = this.sim.ties.tie(a, b);
    return t !== undefined && t.tied && t.layer <= 2;
  }

  memorableByRule(observer: Id, ev: EventView, salience: number): boolean {
    if (salience >= this.sim.data.minds.salienceMemorable) return true;
    if (ev.kind === 'betrayal' || ev.kind === 'promise') return true;
    const ch = this.changeOf(ev);
    if (this.k.matchStrength(observer, ch, ['protects']) >= this.sim.data.minds.protectsMemorable) {
      const violates = ev.effects.some((e) => this.k.registry.get('conflict', CONFLICT_TABLE)('protects', e.effect, {}) === 'violates');
      if (violates) return true;
    }
    return false;
  }

  /** The belief policy the kernel calls (S0 11.2). */
  beliefPolicy(): BeliefPolicy {
    const sim = this.sim;
    const self = this;
    return {
      ...STUB_POLICY,
      onWitness: (k, eventId, observer) => {
        const ev = self.viewEvent(eventId);
        if (!ev) return [];
        const out: ReturnType<BeliefPolicy['onWitness']> = [];
        const origin = self.origin(ev);
        const salience = self.salienceOf(observer, ev);
        let memorable = self.memorableByRule(observer, ev, salience);
        // the cap of memorable beliefs a person holds is kept by not promoting further low-salience beliefs (S1 8.5)
        if (memorable && salience < sim.data.minds.salienceMemorable && k.beliefs.activeOf(observer).filter((b) => b.memorable).length >= sim.data.minds.memorableCap) memorable = false;
        const kd = sim.w.kinds.get(ev.kind);
        const agentRoles = [...ACTOR_ROLES, ...(kd?.agentRoles ?? [])];
        const actor = ev.participants.find((p) => agentRoles.includes(p.role) && p.who !== observer);
        const base = { at: ev.time, confidence: 1, evidence: [origin], source: { by: 'observed' as const, event: ev.id }, memorable, ...(salience ? { salience } : {}) };
        // v0.6 (S1 8.3, S1-5): news (a promise, a warning) has no effect to form a `did.<effect>` belief from, so it forms `did.<kind>` about its agent, valued by the event: knowledge of a plan or a threat is then a belief that can be told
        if (kd?.tags.includes('news')) {
          const agent = ev.participants.find((p) => agentRoles.includes(p.role));
          if (agent !== undefined && agent.who !== observer) out.push({ ...base, id: H(hs('belief'), hid(observer), hid(agent.who), hs(`did.${ev.kind}`), hs(String(ev.time))), subject: agent.who, path: `did.${ev.kind}`, value: ev.id });
          return out;
        }
        if (actor === undefined || ev.kind === 'accident') {
          const target = ev.effects[0]?.on ?? ev.place ?? ev.id;
          out.push({ ...base, id: H(hs('belief'), hid(observer), hid(target), hs('cause'), hs(String(ev.time))), subject: target, path: 'cause', value: ev.kind });
          return out;
        }
        for (const e of ev.effects) {
          if (e.on === actor.who) continue;
          out.push({ ...base, id: H(hs('belief'), hid(observer), hid(actor.who), hs(`did.${e.effect}`), hs(String(ev.time))), subject: actor.who, path: `did.${e.effect}`, value: e.on });
        }
        // an intentional act also forms an attribution belief about the actor's reasons
        const first = ev.effects.find((e) => e.on !== actor.who);
        if (first) {
          const attr = sim.policies.attribution(observer, actor.who, ev, first.effect);
          out.push({
            id: H(hs('belief'), hid(observer), hid(actor.who), hs('reason'), hs(String(ev.time))), subject: actor.who, path: 'reason', at: ev.time, region: attr.region,
            confidence: attr.confidence, evidence: [origin], source: { by: 'inferred', rule: { name: 'attr', version: 1 }, from: [ev.id] }, memorable, ...(salience ? { salience } : {}),
          });
        }
        void k;
        return out;
      },
      onSocial: (_k, b, _teller, listener, operator) => self.toldBelief(b, listener, operator ?? null),
      onTick: (_k, believer, at) => {
        self.fade(believer, at);
        sim.divergence.onTick(believer, at);
      },
      aggregate: (_k, audience, subject, path) => {
        const axis = path.startsWith('rep-') ? path.slice(4).replace(/\[.*$/, '') : path;
        const a = sim.ledger.aggregate(audience, subject, axis, Number.POSITIVE_INFINITY);
        return { value: a.value as number, confidence: a.mass > 0 ? 1 - 1 / (1 + a.mass) : 0, mass: a.mass, items: a.items };
      },
      replaces: (existing, incoming) => incoming.confidence > existing.confidence + sim.data.minds.replaceMargin,
      visibleDims: new Set(['xf:alive', 'core:position', 'xf:affiliation']),
    };
  }

  /** Attribution (S1 8.3, `attr@1`): the weight on disposition against situation, and the region of reasons it picks. */
  attribution(observer: Id, actor: Id, ev: EventView, effect: Effect): { region: Region; confidence: number; wD: number } {
    const m = this.sim.data.minds;
    const constraintVisible = ev.causes.length > 0 ? 1 : 0;
    const load = 0;
    const tilt = this.attitudeTilt(observer, actor, ev);
    const wD = clamp(m.wD - m.wDConstraint * constraintVisible * (1 - load) + m.wDTilt * tilt, 0.2, 0.9);
    const classes = m.reasons[effect] ?? m.reasons.meet!;
    const values = wD >= 0.5 ? classes.dispositional : classes.situational;
    return { region: { r: 'set', values: [...values].sort() }, confidence: q64(0.4 + 0.5 * Math.abs(2 * wD - 1)), wD };
  }

  /** +1 when the observer's affiliation is hostile to the actor's, -1 when friendly (the same group), else 0 (S1 8.3). */
  attitudeTilt(observer: Id, actor: Id, ev: EventView): number {
    return this.tiltIn(observer, actor, this.districtOfPlace(ev.place));
  }

  private tiltIn(observer: Id, actor: Id, district: Id): number {
    const a = this.classNameOf(observer, district);
    const b = this.classNameOf(actor, district);
    if (a === 'civilian' || b === 'civilian') return 0;
    if (a === b) return -1;
    return 1;
  }

  // ---- fade (S1 8.5) ----

  /** Drop the beliefs of a believer that are not memorable and have not been refreshed for the hold (S1 8.5). Carrier evidence is outside this. */
  fade(believer: Id, at: GameTime): void {
    const hold = this.sim.data.minds.holdDays * 86400;
    for (const b of this.k.beliefs.activeOf(believer)) {
      if (b.memorable) continue;
      if (at - b.refreshed > hold) this.k.beliefs.drop(believer, b.id);
    }
  }

  // ---- social: telling (S1 8.4) ----

  private severityOf(ev: EventView): number {
    return this.sim.w.kinds.get(ev.kind)?.severity ?? 0;
  }

  /** `score(b) = protectiveRelevance(b, listener) x severity(kind(e)) x closeness(teller, listener)`. */
  tellScore(b: Belief, teller: Id, listener: Id): number {
    const src = this.viewEvent(b.source.by === 'observed' ? b.source.event : b.evidence[0] ?? '');
    if (!src) return 0;
    const rel = this.k.matchStrength(listener, this.changeOf(src), ['protects', 'threatenedBy']);
    return rel * this.severityOf(src) * this.closeness(teller, listener);
  }

  closeness(teller: Id, listener: Id): number {
    return Math.max(this.sim.tiePolicy.strengthOf(teller, listener), 0.1);
  }

  /** What changes in the telling: one operator at most per hop (S1 8.4). */
  toldBelief(b: Belief, listener: Id, operator: 'level' | 'sharpen' | 'assimilate' | null): Partial<Pick<Belief, 'confidence' | 'memorable' | 'path' | 'value' | 'region' | 'salience' | 'hop'>> {
    const m = this.sim.data.minds;
    let confidence = Math.min(b.confidence, m.toldCap) * m.toldFactor;
    let path = b.path;
    let region: Region | undefined;
    if (operator === 'level') confidence = confidence * m.levelFactor;
    if (operator === 'sharpen' && path.startsWith('did.')) {
      const i = m.ladder.indexOf(path.slice(4));
      if (i >= 0 && i < m.ladder.length - 1) path = `did.${m.ladder[i + 1]}`;
    }
    if (operator === 'assimilate' && b.path === 'reason' && b.region !== undefined) {
      const act = this.actOf(b);
      region = this.defaultReasons(listener, b.subject, act.effect, act.place);
    }
    const out: ReturnType<Policies['toldBelief']> = { confidence, hop: (b.hop ?? 0) + 1, path };
    if (region) out.region = region;
    return out;
  }

  /**
   * The act a belief about reasons is about: the effect it had on someone other than the actor, and where it happened, read from the event
   * the belief cites (the inference's cause, else its first evidence). When that event cannot be read the reasons themselves name their
   * class, and `meet` stands when nothing says (SIM-14).
   */
  private actOf(b: Belief): { effect: Effect; place?: Id } {
    const did = /^did\.(.+)$/.exec(b.path);
    const ids = [b.source.by === 'inferred' ? b.source.from[0] : undefined, b.evidence[0]].filter((x): x is Id => x !== undefined);
    for (const id of ids) {
      const ev = this.viewEvent(id);
      const e = ev?.effects.find((x) => x.on !== b.subject);
      if (ev && e) return { effect: e.effect, ...(ev.place !== undefined ? { place: ev.place } : {}) };
    }
    if (did) return { effect: did[1] as Effect };
    if (b.region?.r === 'set') {
      const held = b.region.values;
      for (const [effect, c] of Object.entries(this.sim.data.minds.reasons)) {
        if (held.every((x) => c.dispositional.includes(x) || c.situational.includes(x))) return { effect: effect as Effect };
      }
    }
    return { effect: 'meet' };
  }

  /**
   * The reasons a listener expects of an actor's group before anything of the situation is seen (S1 8.4 `assimilate`): the attribution of
   * `attr@1` from the listener's side, with no constraint visible, so only the listener's attitude to the actor's group tilts it (S1 8.3).
   */
  defaultReasons(listener: Id, actor: Id, effect: Effect, place: Id | undefined): Region {
    const m = this.sim.data.minds;
    const wD = clamp(m.wD + m.wDTilt * this.tiltIn(listener, actor, this.districtOfPlace(place)), 0.2, 0.9);
    const classes = m.reasons[effect] ?? m.reasons.meet!;
    return { r: 'set', values: [...(wD >= 0.5 ? classes.dispositional : classes.situational)].sort() };
  }

  /**
   * A teller and a listener meet (S1 8.4): choose the memorable belief of the teller about an event that scores highest for the listener,
   * draw whether it is told, and draw one operator at most per hop. The telling is a minted event of kind `tell`; it has no effects, and
   * its subject is an informational participant, so a telling about V or about a protected person is not refused by the gate.
   * Returns whether a telling happened.
   */
  encounter(teller: Id, listener: Id, w: number): boolean {
    const k = this.k;
    const m = this.sim.data.minds;
    let best: { b: Belief; score: number } | undefined;
    for (const b of k.beliefs.activeOf(teller)) {
      if (!b.memorable || !b.path.startsWith('did.')) continue;
      const score = this.tellScore(b, teller, listener);
      if (!best || score > best.score || (score === best.score && cmp(b.id, best.b.id) < 0)) best = { b, score };
    }
    if (!best) return false;
    const p = m.tellBase * best.score;
    if (!(this.sim.ids.tell(teller, listener, best.b.id, w) < p)) return false;
    // the volume rule: only in focus, or about V, a live seed's cast or a canon person; outside focus about ten an hour
    const inFocus = k.frames.demandTier(teller) >= 3 || k.frames.demandTier(listener) >= 3;
    const aboutSpecial = best.b.subject === this.sim.w.v || this.sim.people.protectedSet(best.b.subject);
    if (!inFocus && !aboutSpecial) return false;
    const rec = this.sim.record;
    if (!inFocus) {
      rec.tells = rec.tells.filter((x) => w - x < this.sim.data.acts.hourWindows);
      if (rec.tells.length >= m.tellsPerHour) return false;
    }
    // v0.6 (S1 8.4): the telling names what it tells, the event the belief is about (an act, or a plan such as a promise), as `told`
    const told = best.b.source.by === 'observed' ? best.b.source.event : best.b.evidence[0]!;
    // everything S1 produces passes the one gate before it is minted and before it takes any of the volume allowance (S1 6, S1-I-9)
    const occ: Occurrence = {
      kind: 'tell', origin: 'policy', size: 1, window: w, participants: [{ who: teller, role: 'teller' }, { who: listener, role: 'listener' }, { who: best.b.subject, role: 'subject' }, { who: told, role: 'told' }],
      effects: [], creator: this.sim.w.s1,
    };
    const gated = this.sim.gate.produce(occ, k.settings.at(k.now), k.now);
    if (!gated.ok) {
      this.sim.logNow({ w, proc: 'social', kind: 'gate', reason: gated.reason, refs: [teller, listener, best.b.subject] });
      return false;
    }
    if (!inFocus) rec.tells.push(w);
    const hop = best.b.hop ?? 0;
    const op = hop >= m.hopLimit ? 3 : invCum(m.operatorWeights, this.sim.ids.op(teller, listener, best.b.id, hop));
    const operator = (['level', 'sharpen', 'assimilate', null] as const)[op]!;
    const srcEvent = best.b.source.by === 'observed' ? best.b.source.event : best.b.evidence[0]!;
    const name = `tell/${teller}/${listener}/${best.b.id.slice(0, 8)}/${w}`;
    const place = this.k.value(srcEvent, 'place');
    const teller_ = k.events.mintEvent({
      creator: this.sim.w.s1, cause: srcEvent, name, time: k.now, kind: 'tell', ...(typeof place === 'string' ? { place } : {}),
      participants: [{ who: teller, role: 'teller' }, { who: listener, role: 'listener' }, { who: best.b.subject, role: 'subject' }, { who: told, role: 'told' }], causes: [srcEvent], outcome: 'done',
    });
    k.beliefs.tellAs(teller, listener, best.b.id, teller_, operator);
    // the reason belief of the same act travels with it unless the telling levelled it
    if (operator !== 'level') {
      const reason = k.beliefs.activeOf(teller).find((x) => x.memorable && x.path === 'reason' && x.subject === best!.b.subject && x.at === best!.b.at);
      if (reason) k.beliefs.tellAs(teller, listener, reason.id, teller_, operator);
    }
    this.sim.logNow({ w, proc: 'social', kind: 'decision', reason: 'tell', key: `${teller}|${listener}|${best.b.id}`, refs: [teller_] });
    if (operator) this.sim.logNow({ w, proc: 'social', kind: 'decision', reason: 'operator', key: operator, refs: [teller_] });
    this.stats.told++;
    return true;
  }

  // ---- absorb: reputation through carriers (S1 8.6) ----

  private diagOf(kind: string): number {
    const cfg = this.sim.data.ledger;
    const rate = this.sim.data.shape.rate[kind];
    if (!rate) return cfg.diag[kind] ?? 1;
    let all = 0;
    for (const name of Object.keys(this.sim.data.shape.rate).sort()) all = all + this.sim.data.shape.rate[name]!.reduce((a, b) => a + b, 0);
    const mine = rate.reduce((a, b) => a + b, 0);
    if (!(all > 0) || !(mine > 0)) return cfg.diag[kind] ?? 1;
    return clamp(-ln(mine / all), cfg.diagMin, cfg.diagMax);
  }

  sizeOf(ev: EventView): number {
    for (const id of ['city.mirror', 'city.events']) {
      const dg = this.k.evolution.digestPeek<{ facts: { windows: Array<{ items: Array<{ id: Id; size: number }> }> } }>(id);
      for (const win of dg?.facts.windows ?? []) for (const f of win.items) if (f.id === ev.id) return f.size;
    }
    return ev.kind === 'regime-start' ? 3 : 1;
  }

  /** `absorb(event)`: runs once per canonical origin, for the events with V as an actor (S1 8.6). */
  absorb(ev: EventView): void {
    if (RAW.has(ev.kind) || ev.kind.startsWith('meta:')) return;
    // v0.6 (S1 8.6): a plan made is neither kept nor broken: a promise with no outcome moves no reputation, and a missing outcome is never read as `done`
    if (ev.kind === 'promise' && ev.outcome !== 'done' && ev.outcome !== 'failed') return;
    const v = this.sim.w.v;
    if (!ev.participants.some((p) => p.who === v && ACTOR_ROLES.includes(p.role))) return;
    const cfg = this.sim.data.ledger;
    const origin = this.origin(ev);
    const district = this.districtOfPlace(ev.place);
    const dist = this.sim.w.district(district);
    const cell = ev.place !== undefined ? this.sim.w.index.cells[ev.place] : undefined;
    const size = this.sizeOf(ev);
    const pub = cell !== undefined && cell.public === 'public' && ev.witnesses.length >= this.sim.data.norms.publicMinWitnesses;
    const targets = ev.effects.filter((e) => e.on !== v);
    const diag = this.diagOf(ev.kind);
    const rec = this.sim.record;
    const headcount = Math.round(dist.rho * dist.entry.total);
    const norm = (a: number[]): number[] => a.map((x) => x / a.reduce((p, q) => p + q, 0));
    const roleShare = norm(dist.marginals.role);
    for (const car of cfg.carriers) {
      const node = this.sim.ledger.carrierNode(car.id, district);
      const belongs = (w: Id): boolean => {
        const rv = this.sim.people.view(w);
        if (!rv) return false;
        if (car.type === 'circle') return car.roles?.includes(rv.role) ?? false;
        if (car.type === 'group') return rv.affc === ({ A1: 2, A2: 3, A3: 4 })[car.aff!];
        return true;
      };
      const belonging = ev.witnesses.filter(belongs).length;
      const memberTarget = targets.some((t) => belongs(t.on) || (car.type === 'group' && t.on === this.sim.w.group(district, car.aff!)));
      let learns: boolean;
      if (car.type === 'circle') learns = belonging > 0 || (pub && cell !== undefined && (cell.marketCell || cell.adj1.some((x) => this.sim.w.cell(x).marketCell)));
      else if (car.type === 'group') learns = belonging > 0 || memberTarget;
      else learns = pub || size >= 2 || ev.witnesses.length > 0;
      if (!learns) continue;
      // the carrier's expected size and its reach, frozen at formation
      const csize = car.type === 'circle'
        ? headcount * (roleShare[0]! + roleShare[1]!)
        : car.type === 'group' ? headcount * norm(dist.marginals.aff)[({ A1: 2, A2: 3, A3: 4 })[car.aff!]]! : headcount;
      const direct = Math.min(1, belonging / Math.max(1, csize));
      const table = car.type === 'circle' ? cfg.reach.circle : car.type === 'group' ? cfg.reach.group : cfg.reach.district;
      const base = car.type === 'group' && memberTarget ? cfg.reach.groupMember : table[Math.min(4, Math.max(1, size)) - 1]!;
      const reach = clamp(Math.max(direct, base), cfg.reachMin, 1);
      const salience = (this.sim.w.kinds.get(ev.kind)?.pulse ?? 0) >= this.sim.data.minds.pulseMemorable ? 1 : 0;
      for (const axis of cfg.axes) {
        let verdict = 0;
        if (ev.kind === 'promise') {
          verdict = (cfg.judge[ev.outcome === 'failed' ? 'promise:failed' : 'promise:done']?.[axis]?.[1] ?? 0) * this.diagOfNonCity('promise');
        } else {
          for (const t of targets) {
            const viewName = cfg.view[car.id]?.[this.classNameOf(t.on, district)] ?? 'neutral';
            const row = cfg.judge[t.effect]?.[axis];
            if (!row) continue;
            verdict = verdict + row[viewName === 'good' ? 0 : viewName === 'neutral' ? 1 : 2]! * diag;
          }
        }
        if (verdict === 0) continue;
        const key = `${node}|${v}|${axis}`;
        const list = (rec.absorbed[key] ??= []);
        if (list.some((a) => a.origin === origin)) continue;
        this.setItem(node, v, axis, ev, origin, verdict, reach, salience, list);
        rec.dirty.push({ carrier: node, subject: v, axis, seq: rec.dirtySeq++ });
        this.stats.absorbed++;
      }
    }
    if (rec.dirty.length > 4096) rec.dirty = rec.dirty.slice(rec.dirty.length - 4096);
  }

  private diagOfNonCity(kind: string): number {
    return this.sim.data.ledger.diag[kind] ?? 1;
  }

  /** Add an evidence item to a carrier: the lowest free index in 0 to 31, or at the cap the weakest item goes (S1 8.6). */
  private setItem(node: Id, subject: Id, axis: string, ev: EventView, origin: Id, v: number, reach: number, salience: number, absorbed: Array<{ origin: Id; index: number }>): void {
    const cfg = this.sim.data.ledger;
    const items = this.sim.ledger.itemsOf(node, subject, axis);
    const used = new Set(items.map((i) => i.index));
    let index = -1;
    for (let i = 0; i < cfg.cap; i++) if (!used.has(i)) { index = i; break; }
    if (index < 0) {
      let weakest = items[0]!;
      const strength = (it: (typeof items)[number]): number => Math.abs(it.v) * cfg.salW[it.salience]!;
      for (const it of items) {
        const a = strength(it);
        const b = strength(weakest);
        if (a < b || (a === b && (it.at < weakest.at || (it.at === weakest.at && cmp(it.id, weakest.id) < 0)))) weakest = it;
      }
      index = weakest.index;
      this.k.beliefs.drop(node, weakest.id);
      for (const a of absorbed) if (a.origin === weakest.origin && a.index === weakest.index) a.index = -1;
      // the same origin may be recorded under other keys' lists only for its own carrier and axis
    }
    const path = `rep-${axis}[${index}]`;
    this.k.beliefs.set({
      id: H(hs('belief'), hid(node), hid(subject), hs(path), hs(String(ev.time))), believer: node, subject, path, at: ev.time, value: [q64(v), q64(reach)],
      confidence: cfg.confidence.witnessed, evidence: [origin], source: { by: 'observed', event: ev.id }, formed: this.k.now, refreshed: this.k.now, memorable: true,
      ...(salience ? { salience } : {}),
    });
    absorbed.push({ origin, index });
    while (absorbed.length > cfg.absorbedCap) absorbed.shift();
  }

  // ---- readings: reconcile and v.frames (S1 8.2, 8.8) ----

  private heardReading(ch: Extract<Change, { c: 'reading' }>): void {
    const h = this.k.persistence.restoreReferencedHeader(ch.node);
    if (!h) return;
    if (h.kind === 'xf:person' && (ch.slot === 'alive' || ch.slot === 'affiliation' || ch.slot === 'quest-linked')) this.reconcile(ch.node, ch.slot, ch.new, ch.old);
    else if (ch.node === this.sim.w.vState && ch.slot === 'cell') this.sim.vFrames.cellChanged(ch.old, ch.new);
    else if (h.kind === 'xf:journal') this.sim.vFrames.journalChanged(ch.node);
  }

  /**
   * The group node an affiliation joins (S1 8.8): the A1 to A3 of the person's current district, taken from the mirrored position, when that
   * district lists the affiliation; otherwise of the first simulated district, in `Id` order, that does; undefined when no group does.
   */
  groupOfAffiliation(aff: string, person?: Id): Id | undefined {
    const listed = (d: { id: Id; affOrder: string[] }): Id | undefined => {
      for (const [i, slot] of (['A1', 'A2', 'A3'] as const).entries()) if (d.affOrder[2 + i] === aff) return this.sim.w.group(d.id, slot);
      return undefined;
    };
    const here = person === undefined ? undefined : this.sim.w.districtAt(this.k.value(person, 'position'));
    const mine = here === undefined ? undefined : listed(here);
    if (mine !== undefined) return mine;
    for (const d of this.sim.w.districts) {
      const g = listed(d);
      if (g !== undefined) return g;
    }
    return undefined;
  }

  /** The game is ground truth (S1 8.8): end what the game now contradicts; beliefs are left, and the divergence is logged. */
  reconcile(person: Id, slot: string, value: unknown, old: unknown, quiet = false): void {
    this.k.persistence.recoverIfSaved(person);
    const k = this.k;
    const w = this.sim.windowNow();
    let corrected = false;
    if (slot === 'alive' && value === 'no') {
      for (const f of k.frames.framesOf(person)) {
        // a retained goal frame is `people.goals`' alone (S1 8.8, 12): it ends the goal when its owner is gone
        if (f.retain && f.level === 'goal') continue;
        if (f.status === 'active' || f.status === 'blocked') {
          k.frames.setStatus(f.id, 'abandoned', person);
          corrected = true;
        }
      }
      for (const e of [...k.groups.memberships(person), ...k.store.edgesFrom(person).filter((x) => x.type === 'xf:tie' && (x.valid.to === undefined || x.valid.to > k.now)), ...k.store.edgesTo(person).filter((x) => x.type === 'xf:tie' && (x.valid.to === undefined || x.valid.to > k.now))]) {
        k.endEdge(e.id, k.now);
        corrected = true;
      }
      // a reading with no earlier one is the game stating its state (a first reading, or a restatement after a load): it is logged only if it
      // corrected something, so a reload that restates what was handled leaves the log as it was
      if (corrected || (!quiet && old !== undefined && old !== value)) this.sim.logNow({ w, proc: 'reconcile', kind: 'correction', reason: 'game-dead', refs: [person] });
    } else if (slot === 'affiliation' && value !== old) {
      // end the old membership, add the new one when its group exists, caused by the game (S1 8.8 step 2); one already held is kept
      const target = typeof value === 'string' ? this.groupOfAffiliation(value, person) : undefined;
      for (const e of k.groups.memberships(person)) {
        if (e.to === target) continue;
        k.endEdge(e.id, k.now);
        corrected = true;
      }
      // only a move joins a group: the first reading, or one the game restates after a load, is not a change, and a dead person joins nothing
      if (old !== undefined && target !== undefined && k.value(person, 'alive') !== 'no' && !k.groups.memberships(person).some((e) => e.to === target)) {
        k.addEdge({ type: 'core:member-of', from: person, to: target, attrs: { role: 'member', strength: 1 }, cause: this.sim.w.port, valid: { from: k.now }, silent: quiet });
      }
      if (corrected || old !== undefined) this.sim.logNow({ w, proc: 'reconcile', kind: 'correction', reason: 'game-moved', refs: [person] });
    } else if (slot === 'quest-linked') {
      if (old !== undefined && value !== old) this.sim.logNow({ w, proc: 'reconcile', kind: 'correction', reason: 'game-fact', refs: [person] });
    }
    if (corrected) this.stats.corrections++;
    this.sim.divergence.noteReading(person, slot);
  }
}

export type { Kernel };

/** After a load (S1 8.8): the kernel read the game's state into readings silently, so reconcile looks at every mirrored person once. */
export function reconcileAll(p: Policies): void {
  const sim = p.sim;
  const k = sim.k;
  for (const person of k.store.idsOfKind('xf:person')) {
    const alive = k.value(person, 'alive');
    if (alive === 'no') p.reconcile(person, 'alive', 'no', undefined, true);
  }
}
