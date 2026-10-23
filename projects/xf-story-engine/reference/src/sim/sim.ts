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
import { type S1Record, appendLog, emptyRecord } from './record.ts';
import { toProcessDef } from './s1ctx.ts';
import { Ties } from './ties.ts';
import { type WorldOptions, World } from './world.ts';
import type { EventsState } from './proc-events.ts';
import { eventsProcess } from './proc-events.ts';
import type { LogDraft } from './occ.ts';
import type { StocksDigest } from './proc-stocks.ts';
import type { NormsDigest } from './proc-norms.ts';
import { recipeClasses } from './fit.ts';
import { hrec } from '../canon.ts';
import { PACK_ID } from './world-schema.ts';

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
    this.people.hooks = {
      closed: (v, t) => this.closedAt(v.role, v.cell, t),
      isSpine: () => false,
      defect: (kind, detail) => this.logNow({ w: this.windowNow(), proc: 'people', kind: 'defect', reason: kind, refs: [], key: detail }),
    };
    // The record's sink for the processes' log entries, the hooks that save and restore the record.
    this.k.evolution.sinks.set('s1', (entries) => {
      for (const e of entries as LogDraft[]) appendLog(this.record, e, this.data.log.max);
    });
    this.k.saveHooks.push(() => this.flush());
    this.k.loadHooks.push((rec, report) => this.onLoad(rec, report));
    this.installPins();
    this.registerProcesses(opts.only);
  }

  static create(opts: SimOptions): Sim {
    return new Sim(opts);
  }

  // ---- registration ----

  private registerProcesses(only?: string[]): void {
    const defs = [eventsProcess(this)].map((p) => toProcessDef(this, p as never));
    for (const d of defs) {
      if (only && !only.includes(d.id)) continue;
      this.defs.set(d.id, d);
      this.k.evolution.register(d);
    }
  }

  /** The lineage record pins the data, the tables and the processes it runs on (S1 1.4): packs with no contributions that carry versions. */
  private installPins(): void {
    const procs = ['city.events', 'group.decide', 'order.stocks', 'city.mirror', 'order.ledger', 'order.norms', 'scene.acts'];
    this.k.persistence.installPack({
      id: 'xf.s1.sim@1', version: H(hs('s1sim'), hrec({ data: this.data, procs, index: this.w.index.hash })), contributions: [],
    });
    void PACK_ID;
  }

  // ---- the record ----

  windowNow(): number {
    return Math.floor(this.k.now / this.data.time.W);
  }

  logNow(e: LogDraft): void {
    appendLog(this.record, e, this.data.log.max);
  }

  /** Write the S1 record to the seed table, so a save holds it (S0 14.1). */
  flush(): void {
    this.k.retention.setSeed({ id: this.w.s1, state: structuredClone(this.record), nodes: [] });
  }

  private onLoad(rec: { meta: { packs: Array<{ id: string; version: string }> } }, report: { changedPacks?: string[] }): void {
    const seed = this.k.retention.seeds.get(this.w.s1);
    this.record = seed ? (structuredClone(seed.state) as S1Record) : emptyRecord();
    this.people.dropCaches();
    this.ties.dropCaches();
    this.w.buildNodes();
    const mine = (report.changedPacks ?? []).filter((x) => x.startsWith('xf.core.world@1@') || x.startsWith('xf.s1.sim@1@'));
    if (mine.length > 0) {
      this.k.readOnly = { message: `This save was made with other simulation data (${mine.join(', ')}). It opens read-only.` };
    }
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

  /** Start the world at a window (a test that does not want to run the windows before): the kernel's cursor and time move, nothing runs. */
  startAt(window: number): void {
    this.k.evolution.cursor = window - 1;
    this.k.now = window * this.data.time.W;
    this.k.bump();
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
    const dg = this.k.evolution.digestOf<{ regimes: Array<{ scope: Id; closes: string[] }> }>('city.events');
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
