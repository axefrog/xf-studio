// The simulation layer, composed (S1 0.2): the world, the people, the tie function, casting and the gate, the S1 record, the seven
// processes and the policies, attached to a kernel. `Sim.create` builds a kernel over the S1 schema and registers everything; the
// processes run when the kernel's boundaries are processed, the policies behind the kernel's hooks.

import type { Config } from '../config.ts';
import type { ProcessDef } from '../evolution.ts';
import { processCause } from '../evolution.ts';
import { H, ownedId, id as hid, mintedId, rand, s as hs } from '../id.ts';
import type { Kernel } from '../kernel.ts';
import type { SettingsEntry } from '../settings.ts';
import { ceilingOf } from '../settings.ts';
import type { Effect, GameTime, Id } from '../types.ts';
import { invCum, spacingCount } from './arith.ts';
import { Casting } from './cast.ts';
import { CityModel } from './city-model.ts';
import type { S1Data } from './data.ts';
import { Gate } from './gate.ts';
import { type IdentityKeys, identityKeys } from './keys.ts';
import type { CastEntry, Descriptor, Occurrence } from './occ.ts';
import { People } from './people.ts';
import { type EvidenceFacts, type S1Record, appendLog, emptyRecord, recordFrom } from './record.ts';
import { PROCESS_VERSIONS, toProcessDef } from './s1ctx.ts';
import { Ties } from './ties.ts';
import { type WorldOptions, World } from './world.ts';
import type { EventsState } from './proc-events.ts';
import { eventsProcess } from './proc-events.ts';
import { groupsProcess } from './proc-groups.ts';
import { mirrorProcess } from './proc-mirror.ts';
import { normsProcess } from './proc-norms.ts';
import { stocksProcess } from './proc-stocks.ts';
import { actsProcess } from './proc-acts.ts';
import { Ledger, ledgerProcess } from './ledger.ts';
import type { RingEntry } from './occ.ts';
import { Policies, reconcileAll } from './policies.ts';
import { TiePolicy } from './tie-policy.ts';
import { VFrames } from './vframes.ts';
import { Divergence } from './divergence.ts';
import { Protection } from './protection.ts';
import { Reads } from './reads.ts';
import type { LogDraft } from './occ.ts';
import type { StocksDigest } from './proc-stocks.ts';
import type { NormsDigest } from './proc-norms.ts';
import { recipeClasses } from './fit.ts';
import { hrec } from '../canon.ts';
import { PACK_ID } from './world-schema.ts';
import { itemTime } from '../summary.ts';

export interface SimOptions extends WorldOptions {
  /** Build only these processes (a test that wants one process alone). */
  only?: string[];
}

const DAY = 86400;

export class Sim {
  readonly w: World;
  readonly k: Kernel;
  readonly data: S1Data;
  readonly ids: IdentityKeys;
  readonly people: People;
  readonly ties: Ties;
  readonly casting: Casting;
  readonly city: CityModel;
  readonly gate: Gate;
  readonly ledger: Ledger;
  readonly policies: Policies;
  readonly tiePolicy: TiePolicy;
  readonly vFrames: VFrames;
  readonly divergence: Divergence;
  readonly reads: Reads;
  readonly protection: Protection;
  /** The canon characters of the main story (S1 4.4), joined to mirrored nodes by game key. */
  readonly spine = new Set<Id>();
  readonly mirrorProc: Id = processCause('city.mirror');
  record: S1Record = emptyRecord();
  readonly defs = new Map<string, ProcessDef>();

  private constructor(opts: SimOptions) {
    this.w = World.create(opts);
    this.k = this.w.k;
    this.data = this.w.data;
    this.ids = identityKeys(this.k.worldSeed);
    this.people = new People(this.w, this.ids);
    this.casting = new Casting(this.w, this.people, this.ids);
    this.ties = new Ties(this.w, this.people, this.ids);
    this.city = new CityModel(this.w, this.people, this.ids, this.casting);
    this.gate = new Gate(this.w, this.people);
    this.ledger = new Ledger(this);
    this.policies = new Policies(this);
    this.tiePolicy = new TiePolicy(this);
    this.vFrames = new VFrames(this);
    this.divergence = new Divergence(this);
    this.reads = new Reads(this);
    this.protection = new Protection(this);
    this.people.hooks = {
      closed: (v, t) => this.closedAt(v.role, v.cell, t),
      isSpine: (n) => this.spine.has(n),
      defect: (kind, detail) => this.logNow({ w: this.windowNow(), proc: 'people', kind: 'defect', reason: kind, refs: [], key: detail }),
      protectedBefore: (n, t) => this.protection.protectedBefore(n, t),
    };
    // The record's sink for the processes' log entries, the hooks that save and restore the record.
    this.k.evolution.sinks.set('s1', (entries) => {
      for (const e of entries as LogDraft[]) appendLog(this.record, e, this.data.log.max);
    });
    this.k.beliefs.onChange.push((believer, subject) => this.divergence.noteBelief(believer, subject));
    this.k.readingHooks.push((node, slot) => this.divergence.noteReading(node, slot));
    this.k.edgeHooks.push((edge, ended) => this.tiePolicy.noteEdge(edge, ended));
    this.k.saveHooks.push(() => this.flush());
    this.k.loadHooks.push((rec, report) => this.onLoad(rec, report));
    this.installPins();
    this.registerProcesses(opts.only);
    this.policies.install();
  }

  static create(opts: SimOptions): Sim {
    return new Sim(opts);
  }

  // ---- registration ----

  private registerProcesses(only?: string[]): void {
    const defs = [eventsProcess(this), groupsProcess(this), stocksProcess(this), mirrorProcess(this), ledgerProcess(this), normsProcess(this), actsProcess(this)].map((p) => toProcessDef(this, p as never));
    for (const d of defs) {
      if (only && !only.includes(d.id)) continue;
      this.defs.set(d.id, d);
      this.k.evolution.register(d);
    }
  }

  /**
   * The lineage record pins the data, the tables and the processes it runs on (S1 1.4): packs with no contributions that carry versions.
   * A process is pinned by its id and its version, whether or not this instance runs it, so a save made under another version of any of
   * them opens read-only.
   */
  private installPins(): void {
    const procs = Object.keys(PROCESS_VERSIONS).sort().map((id) => [id, PROCESS_VERSIONS[id]!] as const);
    this.k.persistence.installPack({
      id: 'xf.s1.sim@1', version: H(hs('s1sim'), hrec({ data: this.data, procs, index: this.w.index.hash })), contributions: [],
    });
    void PACK_ID;
  }

  // ---- the record ----

  windowStart(w: number): GameTime {
    return w * this.data.time.W;
  }

  windowNow(): number {
    return Math.floor(this.k.now / this.data.time.W);
  }

  logNow(e: LogDraft): void {
    appendLog(this.record, e, this.data.log.max);
  }

  /**
   * Write the S1 record to the seed table, so a save holds it (S0 14.1). First the history the kernel would drop in the save is written into
   * the record: the spans of protection, the facts of the events behind memorable beliefs and the intervals of ended ties.
   */
  flush(): void {
    if (!this.k.readOnly) {
      this.protection.capture();
      this.captureEvidence();
      this.tiePolicy.captureSpans();
    }
    this.k.retention.setSeed({ id: this.w.s1, state: structuredClone(this.record), nodes: [] });
  }

  /** The events whose facts a memorable belief is read back through (S1 8.4): the source of an observed belief, the first evidence, the inference's cause. A ledger item reads none. */
  private evidenceNeeded(): Set<Id> {
    const out = new Set<Id>();
    for (const { belief: b } of this.k.beliefs.memorable()) {
      if (b.path.startsWith('rep-')) continue;
      if (b.source.by === 'observed') out.add(b.source.event);
      if (b.evidence[0] !== undefined) out.add(b.evidence[0]);
      if (b.source.by === 'inferred' && b.source.from[0] !== undefined) out.add(b.source.from[0]);
    }
    return out;
  }

  /**
   * Keep, in the record, the facts of the events a memorable belief is read back through (SIM-03). The simulation-layer contributions that
   * hold an event's fields are not saved, so a load keeps the header of such an event and none of its fields; the facts are put back from
   * here when the save is loaded, whether or not the ring still holds the event.
   */
  private captureEvidence(): void {
    const need = this.evidenceNeeded();
    const rec = this.record.evidence;
    for (const id of Object.keys(rec)) if (!need.has(id)) delete rec[id];
    for (const id of need) {
      // the fields the event was minted with, not what it resolves to now (R2-04); one that has none of its own (a load dropped them) keeps its record
      const item = this.summaryOfItem(id);
      let original: Parameters<Kernel['events']['mintedSpec']>[1];
      if (item) {
        const h = this.k.persistence.restoreReferencedHeader(item.summary);
        // Read the summary's original committed descriptor, never a resolved overlay. S1 summaries use their cell as scope/place.
        const own = (slot: string) => this.k.store.pinsOfNode(item.summary).find((p) => p.slot === slot && p.reason === 'committed' && h?.origin.by === 'minted' && p.cause === h.origin.cause)?.value;
        const from = own('from'), length = own('length'), kind = own('kind'), place = own('scope');
        if (typeof from === 'number' && typeof length === 'number' && typeof kind === 'string' && typeof place === 'string') {
          original = { descriptor: { time: itemTime(item.summary, item.index, from, length), kind, place }, provenance: { descriptor: item.summary, materialisation: 'scene.acts' } };
        }
      }
      const spec = this.k.events.mintedSpec(id, original);
      if (spec) rec[id] = { ...(original ? { provenance: original.provenance } : {}), creator: spec.creator, cause: spec.cause, name: spec.name, time: spec.time, kind: spec.kind, ...(spec.place !== undefined ? { place: spec.place } : {}), participants: spec.participants!, effects: spec.effects!, witnesses: spec.witnesses!, causes: spec.causes!, ...(spec.outcome !== undefined ? { outcome: spec.outcome } : {}), ...(spec.served !== undefined ? { served: spec.served } : {}) };
    }
  }

  /** Put the recorded events back, silently: each was announced when it happened (S0 14.3). An event whose own fields are there (an opened item the scene regenerated) is left alone by `restoreEvent`. */
  private restoreEvidence(): void {
    for (const id of Object.keys(this.record.evidence).sort()) {
      const f = this.record.evidence[id]!;
      const spec: Parameters<Kernel['events']['restoreEvent']>[0] = {
        creator: f.creator, cause: f.cause, name: f.name, time: f.time, kind: f.kind, participants: f.participants, effects: f.effects, witnesses: f.witnesses, causes: f.causes,
      };
      if (f.place !== undefined) spec.place = f.place;
      if (f.outcome !== undefined) spec.outcome = f.outcome;
      if (f.served !== undefined) spec.served = f.served;
      this.k.events.restoreEvent(spec, f.provenance);
    }
  }

  private onLoad(rec: { meta: { packs: Array<{ id: string; version: string }> } }, report: { changedPacks?: string[] }): void {
    const seed = this.k.retention.seeds.get(this.w.s1);
    this.record = seed ? recordFrom(seed.state) : emptyRecord();
    this.people.dropCaches();
    this.ties.dropCaches();
    // The simulation data are pinned for the lineage (S1 1.4): another version of the pack, the data or the index opens the save read-only.
    const mine = (report.changedPacks ?? []).filter((x) => x.startsWith('xf.core.world@1@') || x.startsWith('xf.s1.sim@1@'));
    if (mine.length > 0) {
      this.k.readOnly = { message: `This save was made with other simulation data (${mine.join(', ')}). It opens read-only.` };
      return;
    }
    // a save the kernel opened read-only (a function it needs is missing) is looked at and not written: nothing here may write (SIM-12)
    if (this.k.readOnly) return;
    // Old logs have no shared chronology to recover. Guessing one would create a different oracle; keep those saves inspectable only.
    const unorderedDivergence = Object.values(this.record.divLog).some((list) => list.some((e) => !Number.isSafeInteger(e.ord)));
    const unorderedFeeds = [...this.defs.keys()].some((id) => {
      const digest = this.k.evolution.digestPeek<{ changes?: { windows: Array<{ items: Array<{ ord?: number }> }> } }>(id);
      return digest?.changes?.windows.some((w) => w.items.some((e) => !Number.isSafeInteger(e.ord)));
    });
    const unorderedTies = Object.keys(this.record.tieLog).length === 0 && (Object.values(this.record.tieHistory).some((r) => r.spans?.length) || [...this.k.store.allEdges()].some((e) => e.type === 'xf:tie'));
    if (unorderedDivergence || unorderedFeeds || unorderedTies) {
      this.k.readOnly = { message: 'This save has simulation history without a recorded transition order. It opens read-only.' };
      return;
    }
    this.w.buildNodes();
    this.restoreEvidence();
    this.policies.openWatch();
    reconcileAll(this.policies);
    void rec;
  }

  // ---- state access for tests and tools ----

  /** A copy of a process's applied state. */
  stateOf<S>(id: string): S | undefined {
    const s = this.k.evolution.states.get(id)?.state;
    return s === null || s === undefined ? undefined : (structuredClone(s) as S);
  }

  /**
   * Change a process's state (a fixture's initial state, or fault injection): the applied state, and the state of every batch still
   * outstanding, which would otherwise replace the change when it applies.
   */
  setState(id: string, f: (s: unknown) => void): void {
    const st = this.k.evolution.stateOf(id);
    const cur = (st.state ?? this.defs.get(id)?.init?.({ worldSeed: this.k.worldSeed })) as unknown;
    f(cur);
    st.state = cur;
    for (const b of st.outstanding) if (b.state !== undefined) f(b.state);
    this.k.bump();
  }

  digestOf<D>(id: string): D | undefined {
    return this.k.evolution.digestOf<D>(id);
  }

  /** A summary's ring entry (S1 9.4 `why`, 7.9): the descriptor fields the ring keeps for seven days, read from the events process's applied state. */
  ringEntry(summary: Id): RingEntry | undefined {
    const st = this.k.evolution.states.get('city.events')?.state as EventsState | null | undefined;
    return st?.ring.find((e) => e.id === summary);
  }

  /**
   * The cause chain of a minted occurrence (S1 9.4 `why`): the occurrence, then its ancestors nearest first, to an immigrant (generation 0).
   * It has at most `genMax` links after the occurrence. An ancestor that the ring no longer holds is an Id only, marked `beyondRing`.
   */
  why(occurrence: Id): Array<{ id: Id; kind?: string; gen?: number; beyondRing?: true }> | undefined {
    const st = this.k.evolution.states.get('city.events')?.state as EventsState | null | undefined;
    if (!st) return undefined;
    const lookup = (id: Id): { kind: string; gen: number; chain: Id[] } | undefined => {
      const ev = st.ring.find((e) => e.id === id);
      if (ev?.event) return { kind: ev.event.kind, gen: ev.event.gen, chain: ev.event.chain };
      const it = this.summaryOfItem(id);
      const sum = it ? st.ring.find((e) => e.id === it.summary) : undefined;
      const meta = sum?.meta?.[it!.index];
      return sum && meta ? { kind: sum.kind, gen: meta.gen, chain: meta.chain } : undefined;
    };
    const first = lookup(occurrence);
    if (!first) return undefined;
    const out: Array<{ id: Id; kind?: string; gen?: number; beyondRing?: true }> = [{ id: occurrence, kind: first.kind, gen: first.gen }];
    for (const a of first.chain) {
      const known = lookup(a);
      out.push(known ? { id: a, kind: known.kind, gen: known.gen } : { id: a, beyondRing: true });
    }
    return out;
  }

  /**
   * Mint an occurrence of the ring again under its own Id (S1 11): an event or a summary within seven days regenerates identically,
   * its cast being a pure function of its descriptor and recorded history. Returns the Id, or undefined when the ring no longer holds it.
   * It publishes nothing: restoring an occurrence is silent.
   */
  remint(id: Id): Id | undefined {
    const e = this.ringEntry(id);
    if (!e) return undefined;
    const proc = processCause('city.events');
    const W = this.data.time.W;
    if (e.count !== undefined) {
      return this.k.summaries.mintSummary({ creator: proc, cause: proc, name: `sum/${e.w}/${e.cell}/${e.kind}`, kind: e.kind, from: e.w * W, length: W, scope: e.cell, count: e.count });
    }
    if (!e.event || !e.mint) return undefined;
    const d: Descriptor = { ...e.event, witnesses: 0 };
    this.completeDescriptor(d);
    const cast = this.casting.cast(d);
    if (cast === 'no-cast') return undefined;
    // the occurrence was announced when it first happened, so restoring it announces nothing, whether or not its header survived a load (SIM-02)
    return this.k.events.restoreEvent(this.eventSpecOf(d, cast, proc, e.mint.cause, e.mint.name));
  }

  /** The summary an item belongs to and its index, from the item's header. */
  summaryOfItem(item: Id): { summary: Id; index: number } | undefined {
    const h = this.k.persistence.restoreReferencedHeader(item);
    if (!h || h.origin.by !== 'minted' || h.origin.creator !== h.origin.cause) return undefined;
    const m = /^item:(\d+)$/.exec(h.origin.name);
    return m ? { summary: h.origin.creator, index: Number(m[1]) } : undefined;
  }

  /** Start the world at a window (a test that does not want to run the windows before): the kernel's cursor and time move, nothing runs. */
  startAt(window: number): void {
    this.k.evolution.cursor = window - 1;
    this.k.now = window * this.data.time.W;
    this.k.bump();
  }

  /** True from a tick that stopped short of its target until a tick reaches it: the coarse tiers are catching up (S1 10.2). */
  catchingUp = false;

  /**
   * Catch up toward a window boundary within a work budget (S1 10.2). The kernel stops between boundaries and resumes; S1 lags and
   * does not change a period, and a read made meanwhile answers as of the last processed boundary, flagged `catchingUp` (`Reads.read`).
   * Returns whether the target is reached.
   */
  catchUp(toWindow: number, budget?: number): boolean {
    const r = this.k.tick({ to: toWindow * this.data.time.W, ...(budget !== undefined ? { budget } : {}) });
    this.catchingUp = !r.done;
    return r.done;
  }

  /** Advance the world by whole windows. */
  advance(windows: number): void {
    const to = (this.windowNow() + windows) * this.data.time.W;
    this.k.settle({ to });
  }

  // ---- helpers the processes share ----

  /** Whether a city kind may be produced under the settings: no class it lists is at ceiling 0 (S1 6). */
  kindAllowed(kind: string, settings: SettingsEntry): boolean {
    const kd = this.w.kinds.get(kind);
    if (!kd || kd.classes === 'none') return true;
    return kd.classes.every((c) => ceilingOf(settings, c.class) !== 0);
  }

  /** Whether a regime of the district closes a person's stall at `t` (S1 4.5). */
  private closedAt(role: string, cell: Id, t: GameTime): boolean {
    if (role !== 'vendor' && role !== 'shopkeeper') return false;
    const dg = this.k.evolution.digestPeek<{ regimes: Array<{ scope: Id; closes: string[] }> }>('city.events');
    const district = this.w.cell(cell).district;
    return (dg?.regimes ?? []).some((r) => r.scope === district && r.closes.includes('vendor'));
    void t;
  }

  /** Witnesses of an occurrence and whether it is public: a count, from the people present (S1 7.2, 7.5). */
  completeDescriptor(d: Descriptor): void {
    const p = this.people.periodOf(d.time);
    const mean = this.city.meanPop(d.cell, p) * this.data.events.witFraction;
    d.witnesses = spacingCount(mean, (i) => this.ids.wit(d.id, i));
    d.public = this.w.cell(d.cell).public === 'public' && d.witnesses >= this.data.norms.publicMinWitnesses;
  }

  /** The persons a child inherits of a parent's cast: the original victim, and the original aggressor as its target (S1 5.4). */
  inheritFor(parent: Descriptor): Array<{ role: string; who: Id }> {
    const cast = this.casting.cast(parent);
    if (cast === 'no-cast') return [];
    const out: Array<{ role: string; who: Id }> = [];
    for (const e of cast) {
      if (e.who === undefined) continue;
      if (e.role === 'victim') out.push({ role: 'victim', who: e.who });
      else if (e.role === 'aggressor') out.push({ role: 'target', who: e.who });
    }
    return out;
  }

  /** The cell of a child: the parent's cell (1), its neighbours at distance 1 (0.4) and 2 (0.15); a gang clash by the pair's weight (S1 7.2). */
  childCell(d: Descriptor, childKind: string, index: number): Id {
    const ev = this.data.events;
    const u = this.ids.child(d.id, index, 'cell');
    if (childKind === 'gang-clash' && d.sides?.a !== undefined && d.sides?.b !== undefined) {
      const district = this.w.district(this.w.cell(d.cell).district);
      const weights = district.cellIds.map((cid) => {
        let w = 0;
        for (const pr of this.w.cell(cid).pairs) {
          if (this.casting.classIndexOf(district, pr.a) === d.sides!.a && this.casting.classIndexOf(district, pr.b) === d.sides!.b) w += pr.w;
        }
        return w;
      });
      if (weights.some((x) => x > 0)) return district.cellIds[invCum(weights, u)]!;
    }
    const c = this.w.cell(d.cell);
    const cells = [d.cell, ...c.adj1, ...c.adj2];
    const weights = [ev.placeKernel[0], ...c.adj1.map(() => ev.placeKernel[1]), ...c.adj2.map(() => ev.placeKernel[2])];
    return cells[invCum(weights, u)]!;
  }

  /** The chance that an incident is reported: trust, fear and the norm against talking to the uniforms (S1 7.2). */
  reportChance(district: Id, witnessBonus: number, stocks: StocksDigest | undefined, norms: NormsDigest | undefined): number {
    const d = this.w.district(district);
    const s = stocks?.districts[district];
    const E = s?.E ?? d.trust.E0;
    const Y = s?.Y ?? d.trust.Y0;
    let gang = 0;
    for (const b of d.entry.byAff) if (b.cls === 'gang') gang += b.q;
    const fear = s?.fear ?? this.data.stocks.fearBase * (gang / d.entry.total);
    const unif = this.data.norms.norms.find((n) => n.id === 'uniforms');
    const noSnitch = norms?.norms[district]?.uniforms?.beh ?? unif?.beh0 ?? 0;
    const r = this.data.stocks.r0 * (1 - Y) * (0.5 + 0.5 * E) * (1 - fear) * (1 - noSnitch) * (1 + 0.1 * witnessBonus);
    return r < 0 ? 0 : r > 1 ? 1 : r;
  }

  /** The occurrence the gate sees (S1 6). */
  occurrenceOf(d: Descriptor, cast: CastEntry[], creator: Id, origin: 'sim' | 'policy'): Occurrence {
    const kd = this.w.kinds.get(d.kind)!;
    const participants = cast.map((e) => ({ who: (e.who ?? e.group)!, role: e.role }));
    const effects: Array<{ on: Id; effect: Effect }> = [];
    for (const ef of kd.effects) {
      if (ef.role === 'place') {
        effects.push({ on: d.cell, effect: ef.effect });
        continue;
      }
      for (const e of cast) if (e.role === ef.role || e.role === `${ef.role}-group`) effects.push({ on: (e.who ?? e.group)!, effect: ef.effect });
    }
    return { kind: d.kind, origin, size: d.size, window: d.w, cell: d.cell, participants, effects, creator, tags: kd.tags };
  }

  /** The `mint-event` spec of an admitted occurrence. */
  eventSpecOf(d: Descriptor, cast: CastEntry[], creator: Id, cause: Id, name: string) {
    const occ = this.occurrenceOf(d, cast, creator, 'sim');
    const spec: { creator: Id; cause: Id; name: string; time: GameTime; kind: string; place: Id; participants: Array<{ who: Id; role: string }>; effects: Array<{ on: Id; effect: Effect }>; causes?: Id[]; outcome: 'done' } = {
      creator, cause, name, time: d.time, kind: d.kind, place: d.cell, participants: occ.participants, effects: occ.effects, outcome: 'done',
    };
    if (d.parent !== undefined) spec.causes = [d.parent];
    return spec;
  }
}

export { processCause, mintedId, rand, hid, ownedId, recipeClasses };
export type { EventsState };
export const DAY_SECONDS = DAY;
export type { Config };
