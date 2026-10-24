// The composed kernel facade (spec 0.1). It owns the revision counter, the epoch, the change queue and
// the defect log, and exposes the writes. Subsystems take the kernel as a type-only dependency, so
// there are no runtime import cycles.

import { hrec } from './canon.ts';
import { type Config, makeConfig } from './config.ts';
import { H, b as hb, f as hf, i as hi, id as hid, isId, memberId, mirroredId, ownedId, rootId, s as hs, val as hval } from './id.ts';
import { Events } from './events.ts';
import { Evolution, type AdvanceReport, type Envelope, type SubmitResult } from './evolution.ts';
import { Beliefs } from './beliefs.ts';
import { StagedBatch } from './batch.ts';
import { Settings } from './settings.ts';
import { type Dilemma, Frames } from './frames.ts';
import { Groups } from './groups.ts';
import { Dispatcher, type Relevance } from './relevance.ts';
import { type LoadReport, Persistence, type SaveRecord } from './persistence.ts';
import { Provenance } from './provenance.ts';
import { Queries } from './query.ts';
import { CONFLICT_TABLE, type InterestType, type Registry, coreRegistry } from './registry.ts';
import { Resolver, type Trace } from './resolve.ts';
import { Retention } from './retention.ts';
import type { Schema } from './schema.ts';
import { Schema as SchemaClass, parseSlotPath } from './schema.ts';
import type { SchemaDefs } from './schema-types.ts';
import { Store } from './store.ts';
import { Summaries } from './summary.ts';
import type {
  FnRef,
  Change, Contribution, Edge, Form, GameTime, Id, KindId, Layer, NodeHeader, Pin, PinReason, Query, QueryOutcome, Region,
  ResolveResult, Selector, SlotPath, Value,
} from './types.ts';
import { PIN_PRECEDENCE, type PendingChange } from './types.ts';
import { checkValue, encodeValue, normalizeRegion } from './value.ts';
import { Budget, DefectLog } from './work.ts';

/**
 * What the seeding layer (S2) gives the kernel (spec 10.5, 10.8; S0 v4, V4-5, V4-27). The kernel routes
 * relevance and dilemmas for the actors layer 2 has registered, and runs its work in the tick.
 */
export interface Layer2Hook {
  /** The actors layer 2 has registered: every `core:seed` instance and the pack roots that carry sowing watchers. */
  actors(): ReadonlySet<Id>;
  onRelevance(r: Relevance): void;
  onDilemma(d: Dilemma): void;
  /** A simulation window boundary was processed (game-time wake-ups are checked here, S2 section 4.3). */
  onBoundary(boundary: number, at: GameTime): void;
  /** Queued re-evaluations. */
  readonly pending: number;
  /** Run queued work within the tick budget; returns the work units used. */
  run(budget: Budget): number;
  /** Write the layer's records to the kernel's seed table, before a save. */
  flush(): void;
  /** A load finished replaying: rebuild from the seed table (S2 section 12.2). */
  onLoad(): void;
}

/** The procedural sifter's bounded work, after dispatch and S2, before forgetting. */
export interface Layer3KernelHook {readonly pending: number; run(budget: Budget): number}

export interface KernelOptions {
  schema: Schema;
  worldSeed: Id;
  now?: GameTime;
  /** A fresh epoch Id source. The default is a counter, which is deterministic for tests. */
  epochSource?: () => Id;
}

export interface PinSpec {
  node: Id;
  /** "slot", "slot[i]", "slot#count", and "slot@w<k>" for a simulated temporal slot. */
  slot: SlotPath;
  value?: Value;
  region?: Region;
  reason: PinReason;
  valid?: { from?: GameTime; to?: GameTime };
  at?: GameTime;
  cause: Id;
  evidence?: Id;
  /** Forces the Id (tests use it to order pins; a replay carries the recorded Id). */
  id?: Id;
  /** Write without emitting a change. */
  silent?: boolean;
}

export interface ContributionSpec {
  source: { layer: Layer; origin: Id | string };
  target: Selector;
  form: Form;
  mode: 'constrain' | 'weight' | 'replace-prior';
  strength?: number;
  valid?: { from?: GameTime; to?: GameTime };
  id?: Id;
  silent?: boolean;
}

export interface EdgeSpec {
  type: string;
  from: Id;
  to: Id;
  attrs?: Record<string, Value>;
  data?: Record<string, unknown>;
  valid?: { from?: GameTime; to?: GameTime };
  cause: Id;
  id?: Id;
  silent?: boolean;
}

export interface TickReport {
  boundaries: number;
  runs: number;
  frameSteps: number;
  dispatchSteps: number;
  materialised: number;
  forgotten: number;
  /** Nothing is left pending. */
  done: boolean;
}

/**
 * The Id of a contribution, a pure function of what it says (V4-43): its source, target, form, mode, strength and
 * validity. It reads no epoch, revision or clock, so the same statement made again is the same contribution (V4-48).
 */
export function contributionId(spec: Pick<ContributionSpec, 'source' | 'target' | 'form' | 'mode'> & { strength?: number; valid?: ContributionSpec['valid'] }): Id {
  return H(
    hs('contrib'), hs(spec.source.layer), hs(spec.source.origin), hrec(spec.target), hrec(spec.form),
    hs(spec.mode), hf(spec.strength ?? 1), hrec(spec.valid ?? {}),
  );
}

export function splitWindowPath(raw: string): { path: SlotPath; window?: number } {
  const m = /^(.*)@w(-?\d+)$/.exec(raw);
  if (!m) return { path: raw };
  return { path: m[1]!, window: Number(m[2]) };
}

export class Kernel {
  readonly schema: Schema;
  readonly config: Config;
  readonly registry: Registry;
  readonly worldSeed: Id;
  readonly store = new Store();
  readonly defects = new DefectLog();

  /** The revision counter, incremented by every write (spec 5.5). */
  revision = 0;
  /** The engine time: the default `t` of a resolution. */
  now: GameTime;
  epoch: Id;
  /** Semantic changes waiting for relevance dispatch (spec 10.5). */
  pending: PendingChange[] = [];

  readonly resolver: Resolver;
  readonly queries: Queries;
  readonly summaries: Summaries;
  readonly events: Events;
  readonly beliefs: Beliefs;
  readonly provenance: Provenance;
  readonly persistence: Persistence;
  readonly frames: Frames;
  readonly groups: Groups;
  readonly dispatcher: Dispatcher;
  readonly evolution: Evolution;
  readonly retention: Retention;
  /** Player settings (S0 14.2 `SettingsSet`, v4). */
  readonly settings: Settings;

  /** The open staged batch, if any (spec 14.2a). While one is open no other write is allowed. */
  batch: StagedBatch | null = null;
  /** True while a write runs through the open batch. */
  batchWriting = false;
  /** The seeding layer, attached by S2 (spec 10.5, v4: relevance and dilemmas routed to layer 2). */
  layer2: Layer2Hook | null = null;
  layer3: Layer3KernelHook | null = null;
  /** Layers that keep their own records run these before a save writes them (S1's record, flushed to the seed table). */
  readonly saveHooks: Array<() => void> = [];
  /** ... and these after a load has replayed, once the packs are back (a layer rebuilds from the records and checks its pins). */
  readonly loadHooks: Array<(rec: SaveRecord, report: LoadReport) => void> = [];
  /** Committed edge changes, in write order. Layer-owned history waits for a staged commit and is dropped with a discard. */
  readonly edgeHooks: Array<(edge: Readonly<Edge>, ended: boolean) => void> = [];
  /** Mirrored readings at application, before later writes or deferred relevance dispatch can hide intermediate values. */
  readonly readingHooks: Array<(node: Id, slot: SlotPath) => void> = [];

  /** The effect conflict table in force (spec 10.8): a registry function owned by S1. */
  conflictTable: FnRef = CONFLICT_TABLE;
  /** A load under newer versions that cannot satisfy a persisted record is read-only (spec 14.4, SPEC-NOTES 55). */
  readOnly: { message: string } | null = null;

  private epochSource: () => Id;
  private epochCount = 0;

  constructor(opts: KernelOptions) {
    this.schema = opts.schema;
    this.config = opts.schema.config;
    this.registry = opts.schema.registry;
    this.worldSeed = opts.worldSeed;
    this.now = opts.now ?? 0;
    this.epochSource = opts.epochSource ?? (() => H(hs('epoch'), hid(this.worldSeed), hi(this.epochCount++)));
    this.epoch = this.epochSource();
    this.resolver = new Resolver(this);
    this.queries = new Queries(this);
    this.summaries = new Summaries(this);
    this.events = new Events(this);
    this.beliefs = new Beliefs(this);
    this.provenance = new Provenance(this);
    this.persistence = new Persistence(this);
    this.frames = new Frames(this);
    this.groups = new Groups(this);
    this.dispatcher = new Dispatcher(this);
    this.evolution = new Evolution(this);
    this.retention = new Retention(this);
    this.settings = new Settings(this);
  }

  /** Load a schema from definitions and make a kernel over it. */
  static create(opts: { defs: SchemaDefs; worldSeed: Id; registry?: Registry; config?: Partial<Config>; now?: GameTime; validate?: boolean }): Kernel {
    const registry = opts.registry ?? coreRegistry();
    const schema = SchemaClass.load(opts.defs, registry, makeConfig(opts.config), opts.validate === false ? { validate: false } : {});
    const ko: KernelOptions = { schema, worldSeed: opts.worldSeed };
    if (opts.now !== undefined) ko.now = opts.now;
    return new Kernel(ko);
  }

  // ---- revision and changes ----

  bump(): number {
    return ++this.revision;
  }

  /**
   * Queue a semantic change. It is stamped with the engine time, or with `time` when the occurrence it reports is
   * earlier than the boundary that applies it (an event minted late, V4-45).
   */
  emit(change: Change, time: GameTime = this.now): void {
    // Callers can retain and edit nested contribution records. A queued change is an independent snapshot, including its form and selector.
    const snapshot: Change = structuredClone(change);
    const pc: PendingChange = { change: snapshot, time: Math.min(time, this.now), revision: this.revision, epoch: this.epoch };
    // An open staged batch is silent: its changes wait for the commit (spec 14.2a).
    if (this.batch) this.batch.changes.push(pc);
    else this.pending.push(pc);
    if (snapshot.c === 'edge' && this.edgeHooks.length) {
      const notify = () => { for (const hook of this.edgeHooks) hook(snapshot.edge, snapshot.ended); };
      if (this.batch) this.batch.after.push(notify);
      else notify();
    }
    if (snapshot.c === 'reading' && this.readingHooks.length) {
      const notify = () => { for (const hook of this.readingHooks) hook(snapshot.node, snapshot.slot); };
      if (this.batch) this.batch.after.push(notify);
      else notify();
    }
  }

  /** Open a staged batch (spec 14.2a, v4, V4-26). */
  stage(): StagedBatch {
    this.assertWritable();
    if (this.batch) throw new Error('a staged batch is already open');
    this.batch = new StagedBatch(this);
    return this.batch;
  }

  /** Forget every cache. A staged batch's discard puts the revision back, so entries made since are stale. */
  invalidateCaches(): void {
    this.resolver.invalidate();
    this.queries.invalidate();
    this.summaries.invalidate();
    this.retention.invalidate();
  }

  /** A fresh epoch (spec 14.3). */
  newEpoch(): Id {
    this.epoch = this.epochSource();
    return this.epoch;
  }

  // ---- identity ----

  /** Every re-creation completes saved replay before a caller can synthesise defaults. */
  private recoverOrAddHeader(header: NodeHeader): boolean {
    if (this.store.header(header.id)) return false;
    if (this.persistence.restoreReferencedHeader(header.id)) return false;
    const added = this.store.addHeader(header);
    // The header may never have been saved, while authored contributions naming it were.
    this.persistence.restoreReferencedHeader(header.id);
    return added;
  }

  expandId(idStr: string): Id {
    if (idStr.startsWith('root:')) return rootId(this.worldSeed, idStr.slice(5));
    return idStr;
  }

  /** A root node (spec 1.1): `city`, `director`, `v`. Silent. */
  root(name: string, kind: KindId): Id {
    const nid = rootId(this.worldSeed, name);
    this.recoverOrAddHeader({ id: nid, kind, origin: { by: 'root', name } });
    return nid;
  }

  /** A node the game owns (spec 1.1). Silent. */
  mirrored(gameKey: string, kind: KindId): Id {
    const nid = mirroredId(gameKey);
    this.recoverOrAddHeader({ id: nid, kind, origin: { by: 'mirrored', gameKey } });
    return nid;
  }

  /** A minted node: made by an event, a seed, a process or a summary. Emits a `minted` change the first time. */
  mint(creator: Id, cause: Id, name: string, kind: KindId): Id {
    this.assertWritable();
    const nid = H(hs('mint'), hid(creator), hid(cause), hs(name));
    if (this.recoverOrAddHeader({ id: nid, kind, origin: { by: 'minted', creator, cause, name } })) {
      this.bump();
      this.emit({ c: 'minted', node: nid, kind });
    }
    return nid;
  }

  /** Mint without emitting a change (cache population, spec 9.3). Does not bump the revision. */
  mintSilent(creator: Id, cause: Id, name: string, kind: KindId): Id {
    const nid = H(hs('mint'), hid(creator), hid(cause), hs(name));
    this.recoverOrAddHeader({ id: nid, kind, origin: { by: 'minted', creator, cause, name } });
    return nid;
  }

  /**
   * The node an address leads to ("name", "traits[2]"): an owned value or a member. Creates the header
   * lazily and silently (no revision bump, no change). A member of a non-node slot has an Id for
   * identity only (SPEC-NOTES 9).
   */
  address(owner: Id, path: SlotPath): Id {
    const h = this.store.header(owner);
    if (!h) throw new Error(`unknown node: ${owner}`);
    const info = this.schema.slotInfo(h.kind, path);
    if (!info || info.isCount) throw new Error(`cannot address "${path}" of ${h.kind}`);
    if (info.index === undefined) {
      if (!info.isNode) throw new Error(`"${path}" of ${h.kind} holds a value, not a node`);
      const nid = ownedId(owner, info.def.key);
      this.recoverOrAddHeader({ id: nid, kind: (info.vt as { kind: KindId }).kind, origin: { by: 'value', owner, slot: info.def.key } });
      return nid;
    }
    const nid = memberId(owner, info.def.key, info.index);
    if (info.isNode) {
      this.recoverOrAddHeader({
        id: nid, kind: (info.vt as { kind: KindId }).kind,
        origin: { by: 'member', owner, slot: info.def.key, index: info.index },
      });
    }
    return nid;
  }

  // ---- open and close (spec 7.1, 7.2) ----

  /**
   * Materialise a slot as open. A many slot resolves its count first; its members come into being
   * lazily, when first addressed.
   */
  open(node: Id, path: SlotPath, t: GameTime = this.now): void {
    const h = this.store.header(node);
    if (!h) throw new Error(`unknown node: ${node}`);
    const parsed = parseSlotPath(path);
    if (!parsed) throw new Error(`bad slot path: ${path}`);
    const rk = this.schema.kind(h.kind);
    const at = rk.index.get(parsed.key);
    if (at === undefined) throw new Error(`${h.kind} has no slot "${parsed.key}"`);
    const n = this.store.ensureNode(node, this.now);
    if (rk.slots[at]!.card !== 'one' && parsed.index === undefined && !parsed.isCount) {
      this.resolve(node, `${parsed.key}#count`, t);
    }
    if (!n.slots.has(path)) n.slots.set(path, { s: 'open' });
  }

  /** Drop the resolved caches of a node and of its unretained owned values and members. Pins, edges and headers stay. */
  close(node: Id): void {
    const drop = (id: Id, root: boolean): void => {
      if (!root && this.retention.isRetained(id)) return;
      this.store.dropNode(id);
      for (const o of this.store.ownedOf(id)) drop(o, false);
    };
    drop(node, true);
    this.resolver.clearCache();
  }

  // ---- reads ----

  /** Resolve a slot (spec 5). `t` defaults to the engine time. */
  resolve(node: Id, path: SlotPath, t: GameTime = this.now): ResolveResult {
    return this.resolver.resolve(node, path, t);
  }

  /** The value of a slot, or undefined unless it resolved ok or contradicted. */
  value(node: Id, path: SlotPath, t: GameTime = this.now): Value | undefined {
    const r = this.resolve(node, path, t);
    return r.status === 'ok' || r.status === 'contradiction' ? r.value : undefined;
  }

  trace(node: Id, path: SlotPath, t: GameTime = this.now): Trace {
    return this.resolver.trace(node, path, t);
  }

  query(q: Query): QueryOutcome {
    return this.queries.run(q);
  }

  // ---- writes: pins ----

  /** The root node of V (spec 1.1). */
  get vId(): Id {
    return rootId(this.worldSeed, 'v');
  }

  /** Whether (node, slot) is part of V's drives: nothing pins or sets those (I-12). */
  isVDrive(node: Id, slot: SlotPath = ''): boolean {
    const v = this.vId;
    if (node === v) return slot.startsWith('drives');
    let cur: Id | undefined = node;
    for (let n = 0; n < 8 && cur !== undefined; n++) {
      const h = this.store.header(cur);
      if (!h) return false;
      if ((h.origin.by === 'member' || h.origin.by === 'value') && h.origin.slot === 'drives' && h.origin.owner === v) return true;
      cur = h.origin.by === 'member' || h.origin.by === 'value' ? h.origin.owner : undefined;
    }
    return false;
  }

  /** Refuse a write while the save is read-only (spec 14.4). Every public write calls this first, before it changes anything. */
  assertWritable(): void {
    if (this.readOnly) throw new Error(`the save loaded read-only: ${this.readOnly.message}`);
    if (this.batch && !this.batchWriting) throw new Error('a staged batch is open: other writes are not interleaved with it (spec 14.2a)');
  }

  /** Add a pin (spec 6.1). Idempotent for the same Id. Emits a `pin` change unless silent. */
  pin(spec: PinSpec): Pin {
    this.assertWritable();
    if (this.isVDrive(spec.node, spec.slot)) throw new Error("V is never owned: nothing pins or sets V's drives (I-12)");
    const h = this.store.header(spec.node);
    if (!h) throw new Error(`pin on an unknown node: ${spec.node}`);
    const { path, window } = splitWindowPath(spec.slot);
    const info = this.schema.slotInfo(h.kind, path);
    if (!info || info.isNode) throw new Error(`cannot pin "${spec.slot}" of ${h.kind}`);
    const temporal = !info.isCount && info.index === undefined ? info.def.temporal : undefined;
    if (temporal && window === undefined) throw new Error(`a pin on the simulated temporal slot "${path}" names its window ("${path}@w<k>")`);
    if (!temporal && window !== undefined) throw new Error(`"${path}" is not a simulated temporal slot`);
    if ((spec.value === undefined) === (spec.region === undefined)) throw new Error('a pin has exactly one of value and region');
    if (spec.value !== undefined) {
      const bad = checkValue(info.vt, spec.value);
      if (bad) throw new Error(`pin value for "${spec.slot}": ${bad}`);
    }
    const at = spec.at ?? this.now;
    let from = spec.valid?.from ?? at;
    let to = spec.valid?.to;
    if (temporal && window !== undefined) {
      from = spec.valid?.from ?? window * temporal.window;
      to = spec.valid?.to ?? (window + 1) * temporal.window;
    }
    const valid: Pin['valid'] = to === undefined ? { from } : { from, to };
    const region = spec.region === undefined ? undefined : this.safeNormalize(info.vt, spec.region);
    const pid = spec.id ?? H(
      hs('pin'), hid(spec.node), hs(spec.slot), hs(spec.reason), hi(from), hb(to !== undefined), hi(to ?? 0), hi(at), hid(spec.cause),
      hs(spec.evidence ?? ''),
      spec.value !== undefined ? hval(encodeValue(info.vt, spec.value)) : hrec(region),
    );
    const existing = this.store.pin(pid);
    if (existing) return existing;
    const pin: Pin = { id: pid, node: spec.node, slot: spec.slot, reason: spec.reason, valid, at, cause: spec.cause };
    if (spec.value !== undefined) pin.value = spec.value;
    if (region !== undefined) pin.region = region;
    if (spec.evidence !== undefined) pin.evidence = spec.evidence;
    const old = this.strongestPin(spec.node, spec.slot);
    this.store.addPin(pin);
    this.bump();
    if (!spec.silent) {
      const ch: Change = { c: 'pin', node: spec.node, slot: spec.slot, new: spec.value !== undefined ? spec.value : region!, reason: spec.reason, at: from };
      const was = old ? (old.value !== undefined ? old.value : old.region) : undefined;
      if (was !== undefined) ch.old = was;
      this.emit(ch);
    }
    return pin;
  }

  private safeNormalize(vt: Parameters<typeof normalizeRegion>[0], r: Region): Region {
    if (r.r === 'all' || r.r === 'set') return r;
    if (vt.t === 'enum' || vt.t === 'enum-by' || vt.t === 'text' || vt.t === 'ref' || vt.t === 'node') return r;
    return normalizeRegion(vt, r);
  }

  private strongestPin(node: Id, slot: string): Pin | undefined {
    const live = this.store.livePinsOn(node, slot);
    let best: Pin | undefined;
    for (const p of live) if (!best || PIN_PRECEDENCE[p.reason] > PIN_PRECEDENCE[best.reason]) best = p;
    return best;
  }

  /**
   * Withdraw a pin (spec 6.6). Only authored and committed pins can be withdrawn, and only by the source
   * that created them (`by` equals the pin's cause). Observations and game readings never are.
   */
  withdrawPin(pinId: Id, by: Id, at: GameTime = this.now): boolean {
    this.assertWritable();
    const p = this.store.pin(pinId);
    if (!p) throw new Error(`unknown pin: ${pinId}`);
    if (p.reason === 'observed' || p.reason === 'game') throw new Error(`a ${p.reason} pin is never withdrawn`);
    if (p.cause !== by) throw new Error('a pin is withdrawn only by the source that created it');
    if (this.store.isWithdrawn(pinId)) return false;
    this.store.withdrawn.set(pinId, { pin: pinId, by, at });
    this.bump();
    this.emit({
      c: 'pin', node: p.node, slot: p.slot, old: p.value !== undefined ? p.value : p.region!, new: { r: 'all' }, reason: 'withdrawn',
    });
    return true;
  }

  // ---- writes: game readings (spec 6.3) ----

  /** A game reading of a mirrored slot of a mirrored node. Emits a `reading` change when the value changes. */
  reading(node: Id, slot: SlotPath, value: Value, time: GameTime = this.now, silent = false): Pin {
    this.assertWritable();
    const h = this.store.header(node);
    if (!h) throw new Error(`reading of an unknown node: ${node}`);
    if (h.origin.by !== 'mirrored') throw new Error('only a mirrored node has readings');
    const info = this.schema.slotInfo(h.kind, slot);
    if (!info || info.isNode || info.def.mode !== 'mirrored') throw new Error(`"${slot}" is not a mirrored slot`);
    const bad = checkValue(info.vt, value);
    if (bad) throw new Error(`reading for "${slot}": ${bad}`);
    const prev = this.readingAt(node, slot, time);
    const pid = H(hs('pin'), hid(node), hs(slot), hs('game'), hi(time), hval(encodeValue(info.vt, value)));
    const existing = this.store.pin(pid);
    if (existing) return existing;
    const pin: Pin = { id: pid, node, slot, value, reason: 'game', valid: { from: time }, at: time, cause: node };
    this.store.addPin(pin);
    this.store.recomputeTimeline(node, slot);
    this.bump();
    const changed = !prev || JSON.stringify(prev.value) !== JSON.stringify(value);
    if (changed && !silent) {
      const ch: Change = { c: 'reading', node, slot, new: value, at: time };
      if (prev?.value !== undefined) ch.old = prev.value;
      this.emit(ch);
    }
    return pin;
  }

  /** The reading in effect at a time, or undefined. */
  readingAt(node: Id, slot: SlotPath, t: GameTime): Pin | undefined {
    const live = this.store.livePinsOn(node, slot).filter((p) => p.reason === 'game' && p.valid.from <= t && (p.valid.to === undefined || t < p.valid.to));
    return live.sort((a, b) => (a.id < b.id ? -1 : 1))[live.length - 1];
  }

  /**
   * V's observation of a mirrored value: an `observed` pin over the same interval as the reading it
   * saw (spec 6.3). Returns undefined when there is no reading in effect at `t`.
   */
  observeReading(node: Id, slot: SlotPath, t: GameTime, cause: Id, evidence?: Id): Pin | undefined {
    const r = this.readingAt(node, slot, t);
    if (!r || r.value === undefined) return undefined;
    const spec: PinSpec = { node, slot, value: r.value, reason: 'observed', valid: { from: r.valid.from }, at: this.now, cause };
    if (r.valid.to !== undefined) spec.valid = { from: r.valid.from, to: r.valid.to };
    if (evidence !== undefined) spec.evidence = evidence;
    return this.pin(spec);
  }

  /**
   * An observer saw a node's slot as it stood at `at` (S0 9.4, V4-38): a mirrored slot's reading, or the resolved value
   * of any other, pinned `observed`. The cause is the observer. Returns undefined when there is nothing to see.
   */
  observeAs(observer: Id, node: Id, slot: SlotPath, at: GameTime, evidence?: Id): Pin | undefined {
    this.assertWritable();
    const h = this.store.header(node);
    if (!h) return undefined;
    if (h.origin.by === 'mirrored') return this.observeReading(node, slot, at, observer, evidence);
    const r = this.resolve(node, slot, at);
    if (r.value === undefined || (r.status !== 'ok' && r.status !== 'contradiction')) return undefined;
    const info = this.schema.slotInfo(h.kind, splitWindowPath(slot).path);
    const key = info?.def.temporal && !/@w-?\d+$/.test(slot) ? `${slot}@w${Math.floor(at / info.def.temporal.window)}` : slot;
    const spec: PinSpec = { node, slot: key, value: r.value, reason: 'observed', cause: observer, at };
    if (evidence !== undefined) spec.evidence = evidence;
    return this.pin(spec);
  }

  /** The greatest relevance a change has against an actor's eligible frames, optionally for some interest types only (S0 10.5, V4-44). */
  matchStrength(actor: Id, change: Change, types?: readonly InterestType[], time: GameTime = this.now): number {
    return this.dispatcher.matchStrength(actor, change, types, time);
  }

  // ---- writes: contributions ----

  contribute(spec: ContributionSpec): Contribution {
    this.assertWritable();
    const named = spec.target.scope && 'nodes' in spec.target.scope ? spec.target.scope.nodes : [];
    if (named.some((n) => this.isVDrive(n, spec.target.slot === '*' ? '' : spec.target.slot))) {
      throw new Error("V is never owned: nothing pins or sets V's drives (I-12)");
    }
    const strength = spec.strength ?? 1;
    if (!(strength > 0) || !Number.isFinite(strength)) throw new Error('a contribution strength is positive');
    const valid = spec.valid ?? {};
    const cid = spec.id ?? contributionId({ ...spec, strength, valid });
    const existing = this.store.contribution(cid);
    if (existing) return existing;
    const c: Contribution = { id: cid, source: spec.source, target: spec.target, form: spec.form, mode: spec.mode, strength, valid };
    this.store.addContribution(c);
    this.bump();
    if (!spec.silent) this.emit({ c: 'contribution', contribution: c, ended: false });
    return c;
  }

  endContribution(id: Id, at: GameTime = this.now, silent = false): void {
    this.assertWritable();
    const c = this.store.contribution(id);
    if (!c) throw new Error(`unknown contribution: ${id}`);
    if (c.valid.to !== undefined && c.valid.to <= at) return;
    c.valid = { ...c.valid, to: at };
    this.bump();
    if (!silent) this.emit({ c: 'contribution', contribution: c, ended: true });
  }

  // ---- writes: edges ----

  addEdge(spec: EdgeSpec): Edge {
    this.assertWritable();
    const def = this.schema.edgeType(spec.type);
    const fh = this.store.header(spec.from);
    const th = this.store.header(spec.to);
    if (!fh || !th) throw new Error('an edge joins two known nodes');
    if (!def.from.some((k) => this.schema.isKind(fh.kind, k))) throw new Error(`${spec.type} cannot leave a ${fh.kind}`);
    if (!def.to.some((k) => this.schema.isKind(th.kind, k))) throw new Error(`${spec.type} cannot reach a ${th.kind}`);
    const attrs = spec.attrs ?? {};
    for (const [k, v] of Object.entries(attrs)) {
      const dimId = def.attrs[k];
      if (!dimId) throw new Error(`${spec.type} has no attribute "${k}"`);
      const bad = checkValue(this.schema.dim(dimId).value, v);
      if (bad) throw new Error(`${spec.type} attribute "${k}": ${bad}`);
    }
    const from = spec.valid?.from ?? this.now;
    const valid: Edge['valid'] = spec.valid?.to === undefined ? { from } : { from, to: spec.valid.to };
    const eid = spec.id ?? H(
      hs('edge'), hs(spec.type), hid(spec.from), hid(spec.to), hi(from), hid(spec.cause), hrec(attrs),
    );
    const existing = this.store.edges.get(eid);
    if (existing) return existing;
    const e: Edge = { id: eid, type: spec.type, from: spec.from, to: spec.to, attrs, valid, cause: spec.cause };
    if (spec.data !== undefined) e.data = spec.data;
    this.store.addEdge(e);
    this.bump();
    if (!spec.silent) this.emit({ c: 'edge', edge: e, ended: false });
    this.groups.onEdgeChange(e);
    return e;
  }

  endEdge(id: Id, at: GameTime = this.now): void {
    this.assertWritable();
    const e = this.store.edges.get(id);
    if (!e) throw new Error(`unknown edge: ${id}`);
    if (e.valid.to !== undefined && e.valid.to <= at) return;
    e.valid = { from: e.valid.from, to: at };
    this.bump();
    this.emit({ c: 'edge', edge: e, ended: true });
    this.groups.onEdgeChange(e);
  }

  /**
   * Open an ended edge again under its own Id (SPEC-NOTES 141): the edge is live from `at`, with the attributes given (its old ones where
   * none are). An edge has one interval, so a layer that reads its past keeps the interval that ended; `addEdge` returns an ended edge
   * unchanged, which is right for an edge whose identity includes its time and wrong for one with a stable Id.
   */
  reopenEdge(id: Id, at: GameTime = this.now, attrs?: Record<string, Value>): Edge {
    this.assertWritable();
    const e = this.store.edges.get(id);
    if (!e) throw new Error(`unknown edge: ${id}`);
    if (e.valid.to === undefined || e.valid.to > at) throw new Error(`the edge is not ended: ${id}`);
    const def = this.schema.edgeType(e.type);
    for (const [key, v] of Object.entries(attrs ?? {})) {
      const dimId = def.attrs[key];
      if (!dimId) throw new Error(`${e.type} has no attribute "${key}"`);
      const bad = checkValue(this.schema.dim(dimId).value, v);
      if (bad) throw new Error(`${e.type} attribute "${key}": ${bad}`);
    }
    e.valid = { from: at };
    if (attrs) e.attrs = { ...e.attrs, ...attrs };
    this.bump();
    this.emit({ c: 'edge', edge: e, ended: false });
    this.groups.onEdgeChange(e);
    return e;
  }

  /** Change an edge's attributes or data in place (a membership's strength or obligations, spec 10.8). */
  updateEdge(id: Id, patch: { attrs?: Record<string, Value>; data?: Record<string, unknown> }): Edge {
    this.assertWritable();
    const e = this.store.edges.get(id);
    if (!e) throw new Error(`unknown edge: ${id}`);
    const def = this.schema.edgeType(e.type);
    for (const [k, v] of Object.entries(patch.attrs ?? {})) {
      const dimId = def.attrs[k];
      if (!dimId) throw new Error(`${e.type} has no attribute "${k}"`);
      const bad = checkValue(this.schema.dim(dimId).value, v);
      if (bad) throw new Error(`${e.type} attribute "${k}": ${bad}`);
    }
    if (patch.attrs) e.attrs = { ...e.attrs, ...patch.attrs };
    if (patch.data) e.data = { ...(e.data ?? {}), ...patch.data };
    this.bump();
    this.emit({ c: 'edge', edge: e, ended: false });
    this.groups.onEdgeChange(e);
    return e;
  }

  // ---- external operations and ticking ----

  /** Queue an external operation under an epoch (spec 9.4, 14.3). Stale epochs are refused. */
  submit(env: Envelope): SubmitResult {
    if (this.readOnly) return { accepted: false, reason: `the save loaded read-only: ${this.readOnly.message}` };
    if (this.batch) return { accepted: false, reason: 'a staged batch is open' };
    return this.evolution.submit(env);
  }

  /**
   * Advance the world to `to` (default: the engine time) within a work budget. Boundaries are taken one at
   * a time, in order (spec 9.4), and after each one the frame worklist, relevance dispatch and the belief
   * hooks finish before the next boundary starts, so what a boundary's crossings change is in place before
   * pull and interests are consumed, and the sequence of work does not depend on where ticks fall
   * (SPEC-NOTES 56). Then summary materialisation and forgetting. Each worklist runs in a fixed order,
   * takes its first step always, and resumes where it stopped (spec 10.7). The first boundary of a call is
   * always taken; a budget that runs out stops the advance between boundaries, and the engine time then
   * rests at the last boundary processed.
   */
  tick(opts: { to?: GameTime; budget?: number } = {}): TickReport {
    // A read-only world does not move: ticking would apply, refuse and discard its outstanding batches (SPEC-NOTES 55).
    this.assertWritable();
    const budget = new Budget(opts.budget ?? this.config.tickBudget);
    const to = opts.to ?? this.now;
    const adv: AdvanceReport = { done: true, boundaries: 0, runs: 0, applied: 0 };
    let frameSteps = 0;
    let dispatchSteps = 0;
    /**
     * Do the work that waits (from writes, earlier ticks and the last boundary), in phases: the frame
     * worklist and relevance dispatch first, then the belief hooks, then whatever the hooks queued. The
     * order does not depend on the budget. A budget that runs out stops inside a phase and the next call
     * resumes that phase: hooks that have begun finish before any frame or dispatch work starts again, and
     * hooks never start while frame work or dispatch is pending (SPEC-NOTES 56). True when nothing is left.
     */
    const drainWork = (): boolean => {
      for (;;) {
        if (!this.beliefs.hooksUnderway) {
          frameSteps += this.frames.runWorklist(budget);
          dispatchSteps += this.dispatcher.run(budget);
          if (!this.frames.worklist.isEmpty || !this.dispatcher.idle) return false;
          // The seeding layer's re-evaluations run once the frame work and dispatch are done; what they write
          // queues frame work and dispatch again (S2 section 4.4).
          if (this.layer2 && this.layer2.pending > 0) {
            budget.spend(this.layer2.run(budget));
            if (this.layer2.pending > 0 || !this.frames.worklist.isEmpty || !this.dispatcher.idle) {
              if (budget.exhausted) return false;
              continue;
            }
          }
          if (this.beliefs.pendingTicks === 0) {
            if (this.layer3 && this.layer3.pending > 0) {
              budget.spend(this.layer3.run(budget));
              if (this.layer3.pending > 0 || !this.frames.worklist.isEmpty || !this.dispatcher.idle) {
                if (budget.exhausted) return false;
                continue;
              }
            }
            return true;
          }
        }
        this.beliefs.runTicks(budget);
        if (this.beliefs.pendingTicks > 0) return false;
      }
    };
    let settled = drainWork();
    while (settled && this.evolution.nextBoundary(to) !== undefined) {
      if (adv.boundaries > 0 && budget.exhausted) {
        adv.done = false;
        break;
      }
      budget.spend(this.evolution.stepBoundary(adv));
      settled = drainWork();
    }
    if (!settled) adv.done = false;
    if (adv.done) {
      this.evolution.finishAdvance(to);
      settled = drainWork();
    }
    const materialised = this.summaries.runMaterialisation(budget);
    const forgotten = this.retention.runForgetting(budget);
    return {
      boundaries: adv.boundaries, runs: adv.runs, frameSteps, dispatchSteps, materialised, forgotten,
      done: adv.done && settled && this.summaries.pendingMaterialisation === 0 && this.retention.pendingForgetting === 0,
    };
  }

  /**
   * Run the frame work and the relevance dispatch that a boundary's operations queued to their end, with no budget. The evolution calls
   * it between the boundary's operations and its snapshot (S1 10.2): the work is the same whichever tick takes the boundary, so the
   * sequence of work does not depend on where ticks fall (SPEC-NOTES 56, 142).
   */
  settleInputs(): void {
    const budget = new Budget(Number.POSITIVE_INFINITY);
    for (let n = 0; n < 10_000; n++) {
      this.frames.runWorklist(budget);
      this.dispatcher.run(budget);
      if (this.frames.worklist.isEmpty && this.dispatcher.idle) return;
    }
  }

  /** Run ticks until nothing is pending (a test and tool convenience). */
  settle(opts: { to?: GameTime; budget?: number } = {}): TickReport {
    let r = this.tick(opts);
    for (let n = 0; n < 10_000 && !r.done; n++) r = this.tick(opts);
    return r;
  }

  isId(x: unknown): x is Id {
    return isId(x);
  }
}
