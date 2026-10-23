// Persistence: the logical record (spec 14).
//
// Each save is a record { saveKey, parent, ops }: an append-only log of operations that takes the state
// of the parent save to the state of this one. The reference model generates the ops at save time by
// diffing the live persistable state against a mirror of what the chain already holds (SPEC-NOTES 20).
// Loading is replacement: all branch-local state goes, the nearest snapshot is replayed silently, the
// mirrored state is reconciled with the game, and a new epoch starts.

import type { BeliefEntry } from './beliefs.ts';
import { canonicalEqual } from './canon.ts';
import { rootId } from './id.ts';
import type { EventCanonRecord } from './events.ts';
import type { ProcessState } from './evolution.ts';
import type { ContextFrame } from './frames.ts';
import type { Kernel } from './kernel.ts';
import type { SeedRecord } from './retention.ts';
import type { SettingsEntry } from './settings.ts';
import type { SummaryRecord } from './summary.ts';
import type { Contribution, Edge, Form, GameTime, Id, NodeHeader, Pin, Tier, Value } from './types.ts';

export type PersistOp =
  | { op: 'HeaderAdded'; header: NodeHeader }
  | { op: 'PinAdded'; pin: Pin }
  | { op: 'PinWithdrawn'; pin: Id; by: Id; at: GameTime }
  | { op: 'PinEnded'; pin: Id; to: GameTime }
  | { op: 'EdgeAdded'; edge: Edge }
  | { op: 'EdgeEnded'; edge: Id; to: GameTime }
  | { op: 'ContributionAdded'; contribution: Contribution }
  | { op: 'ContributionEnded'; contribution: Id; to: GameTime }
  | { op: 'BeliefSet'; entry: BeliefEntry }
  | { op: 'BeliefDropped'; belief: Id }
  | { op: 'EventCanon'; canon: EventCanonRecord }
  | { op: 'SummarySet'; summary: SummaryRecord }
  | { op: 'FrameState'; id: Id; frame: ContextFrame | null }
  | { op: 'SeedState'; id: Id; seed: SeedRecord | null }
  | { op: 'ProcessState'; state: ProcessState }
  /** Every player setting that changes what is offered or remembered, in force from `settings.at` (v4, V4-12). Sensitive. */
  | { op: 'SettingsSet'; settings: SettingsEntry };

export type PersistOpKind = PersistOp['op'];

/** The lineage record kept with every save (spec 14.1, 14.4). */
export interface SaveMeta {
  worldSeed: Id;
  /** The game time of the save. */
  time: GameTime;
  /** The evolution cursor: the last boundary processed. */
  cursor: number;
  /** Schema and function versions in force (spec 14.4). */
  versions: string[];
  /** Packs installed, with their versions (their contributions are reloaded, not stored). */
  packs: Array<{ id: string; version: string }>;
  demandRoots: Id[];
  demand: Array<{ tier: Tier; from: GameTime; to?: GameTime }>;
  /** Ops since the last snapshot, including this record's. */
  sinceSnapshot: number;
  /** Ops in the whole chain. */
  total: number;
}

export interface SaveRecord {
  saveKey: string;
  parent: string | null;
  ops: PersistOp[];
  snapshot?: PersistedData;
  meta: SaveMeta;
}

/** A plain-data image of the persisted state (a snapshot, and the form the mirror is held in). */
export interface PersistedData {
  headers: NodeHeader[];
  pins: Array<{ pin: Pin; withdrawn?: { by: Id; at: GameTime } }>;
  edges: Edge[];
  contributions: Contribution[];
  beliefs: BeliefEntry[];
  canon: EventCanonRecord[];
  summaries: SummaryRecord[];
  frames: ContextFrame[];
  seeds: SeedRecord[];
  processes: ProcessState[];
  /** Left out when empty, so a record with no settings change is what it was before v4. */
  settings?: SettingsEntry[];
}

export interface GamePort {
  /** The game's current time. */
  now(): GameTime;
  /** The mirrored state the game currently holds: it becomes `game` readings at the current time (spec 14.3 step 3). */
  readMirrored(): Array<{ gameKey: string; kind: string; slot: string; value: Value }>;
}

export interface LoadReport {
  saveKey: string;
  readOnly: boolean;
  message?: string;
  epoch: Id;
  missingPacks: string[];
  /** How many ops were replayed from the nearest snapshot. */
  replayed: number;
}

export interface Pack {
  id: string;
  version: string;
  contributions: Array<Omit<Parameters<Kernel['contribute']>[0], 'source'> & { layer: Contribution['source']['layer'] }>;
}

/** The registry functions a form uses, nested forms included, written as `category:name@version` (spec 14.4). */
export function formFunctions(form: Form, out: Set<string>): void {
  switch (form.f) {
    case 'field':
      out.add(`fieldmap:${form.map.name}@${form.map.version}`);
      break;
    case 'derive':
      out.add(`derive:${form.fn.name}@${form.fn.version}`);
      break;
    case 'rule':
      formFunctions(form.then, out);
      break;
  }
}

const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;
const cmp = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
const same = (a: unknown, b: unknown): boolean => canonicalEqual(a, b);

/** The persisted state as keyed maps, so diffing and replay are lookups. */
export class PersistedView {
  headers = new Map<Id, NodeHeader>();
  pins = new Map<Id, { pin: Pin; withdrawn?: { by: Id; at: GameTime } }>();
  edges = new Map<Id, Edge>();
  contributions = new Map<Id, Contribution>();
  beliefs = new Map<Id, BeliefEntry>();
  canon = new Map<Id, EventCanonRecord>();
  summaries = new Map<Id, SummaryRecord>();
  frames = new Map<Id, ContextFrame>();
  seeds = new Map<Id, SeedRecord>();
  processes = new Map<string, ProcessState>();
  /** The settings log, in order (append-only). */
  settings: SettingsEntry[] = [];

  static fromData(d: PersistedData): PersistedView {
    const v = new PersistedView();
    for (const h of d.headers) v.headers.set(h.id, clone(h));
    for (const p of d.pins) v.pins.set(p.pin.id, clone(p));
    for (const e of d.edges) v.edges.set(e.id, clone(e));
    for (const c of d.contributions) v.contributions.set(c.id, clone(c));
    for (const b of d.beliefs) v.beliefs.set(b.belief.id, clone(b));
    for (const c of d.canon) v.canon.set(c.event, clone(c));
    for (const s of d.summaries) v.summaries.set(s.summary, clone(s));
    for (const f of d.frames) v.frames.set(f.id, clone(f));
    for (const s of d.seeds) v.seeds.set(s.id, clone(s));
    for (const p of d.processes) v.processes.set(p.id, clone(p));
    v.settings = clone(d.settings ?? []);
    return v;
  }

  toData(): PersistedData {
    const sorted = <T>(m: Map<string, T>): T[] => [...m.entries()].sort((a, b) => cmp(a[0], b[0])).map((e) => clone(e[1]));
    const out: PersistedData = {
      headers: sorted(this.headers), pins: sorted(this.pins), edges: sorted(this.edges), contributions: sorted(this.contributions),
      beliefs: sorted(this.beliefs), canon: sorted(this.canon), summaries: sorted(this.summaries), frames: sorted(this.frames),
      seeds: sorted(this.seeds), processes: sorted(this.processes),
    };
    if (this.settings.length > 0) out.settings = clone(this.settings);
    return out;
  }

  clone(): PersistedView {
    return PersistedView.fromData(this.toData());
  }

  /** Apply one operation (append-only: nothing here deletes a header or a pin). */
  apply(op: PersistOp): void {
    switch (op.op) {
      case 'HeaderAdded':
        this.headers.set(op.header.id, clone(op.header));
        break;
      case 'PinAdded':
        this.pins.set(op.pin.id, { pin: clone(op.pin) });
        break;
      case 'PinWithdrawn': {
        const p = this.pins.get(op.pin);
        if (p) p.withdrawn = { by: op.by, at: op.at };
        break;
      }
      case 'PinEnded': {
        const p = this.pins.get(op.pin);
        if (p) p.pin.valid = { from: p.pin.valid.from, to: op.to };
        break;
      }
      case 'EdgeAdded':
        this.edges.set(op.edge.id, clone(op.edge));
        break;
      case 'EdgeEnded': {
        const e = this.edges.get(op.edge);
        if (e) e.valid = { from: e.valid.from, to: op.to };
        break;
      }
      case 'ContributionAdded':
        this.contributions.set(op.contribution.id, clone(op.contribution));
        break;
      case 'ContributionEnded': {
        const c = this.contributions.get(op.contribution);
        if (c) c.valid = { ...c.valid, to: op.to };
        break;
      }
      case 'BeliefSet':
        this.beliefs.set(op.entry.belief.id, clone(op.entry));
        break;
      case 'BeliefDropped':
        this.beliefs.delete(op.belief);
        break;
      case 'EventCanon':
        this.canon.set(op.canon.event, clone(op.canon));
        break;
      case 'SummarySet':
        this.summaries.set(op.summary.summary, clone(op.summary));
        break;
      case 'FrameState':
        if (op.frame) this.frames.set(op.id, clone(op.frame));
        else this.frames.delete(op.id);
        break;
      case 'SeedState':
        if (op.seed) this.seeds.set(op.id, clone(op.seed));
        else this.seeds.delete(op.id);
        break;
      case 'ProcessState':
        this.processes.set(op.state.id, clone(op.state));
        break;
      case 'SettingsSet':
        this.settings.push(clone(op.settings));
        break;
    }
  }

  equals(other: PersistedView): boolean {
    return same(this.toData(), other.toData());
  }
}

export class Persistence {
  readonly chain = new Map<string, SaveRecord>();
  /** What the chain at the current lineage position holds. */
  private base = new PersistedView();
  private baseKey: string | null = null;
  readonly packs = new Map<string, Pack>();
  private installed = new Map<string, string>();

  constructor(private readonly k: Kernel) {}

  get parentKey(): string | null {
    return this.baseKey;
  }

  // ---- packs (spec 14.1: reloaded, not stored) ----

  /**
   * Install a content pack: its contributions are reloaded from the pack, not stored in saves. A read-only
   * world refuses a pack, empty or not, before either pack map changes (SPEC-NOTES 55).
   */
  installPack(pack: Pack): void {
    this.k.assertWritable();
    this.packs.set(pack.id, pack);
    this.installed.set(pack.id, pack.version);
    for (const c of pack.contributions) {
      const { layer, ...rest } = c;
      this.k.contribute({ ...rest, source: { layer, origin: `pack:${pack.id}` } });
    }
  }

  private static isPackContribution(c: Contribution): boolean {
    return typeof c.source.origin === 'string' && c.source.origin.startsWith('pack:');
  }

  // ---- the live persistable state (spec 14.1) ----

  /** Build the persistable view of the live state. */
  currentView(base: PersistedView = this.base): PersistedView {
    const k = this.k;
    const v = new PersistedView();
    const marked = k.retention.marked();
    for (const id of marked) {
      const h = k.store.header(id);
      if (h) v.headers.set(id, clone(h));
    }
    // Edges that are retention roots.
    // (An edge or pin the chain already holds stays in the view, so its end or withdrawal is recorded even when it is no longer a root.)
    for (const e of k.store.allEdges()) if (k.retention.isRootEdge(e) || base.edges.has(e.id)) v.edges.set(e.id, clone(e));
    // Contributions packs cannot reproduce: not simulation-layer, not from a pack.
    for (const c of k.store.allContributions()) {
      if (c.source.layer === 'simulation' || Persistence.isPackContribution(c)) continue;
      v.contributions.set(c.id, clone(c));
    }
    for (const e of k.beliefs.memorable()) v.beliefs.set(e.belief.id, clone(e));
    for (const id of k.events.canonEvents()) v.canon.set(id, clone(k.events.canonRecord(id)!));
    for (const s of k.summaries.records()) v.summaries.set(s.summary, clone(s));
    for (const fid of k.retention.rootFrameIds()) v.frames.set(fid, clone(k.frames.frame(fid)!));
    for (const s of k.retention.seeds.values()) v.seeds.set(s.id, clone(s));
    for (const p of k.evolution.snapshotStates()) v.processes.set(p.id, clone(p));
    v.settings = k.settings.all();
    // Pins: those on persisted nodes; a game reading only when something retains it.
    const keep = new Set<Id>();
    for (const e of v.edges.values()) keep.add(e.cause);
    for (const c of v.contributions.values()) if (typeof c.source.origin === 'string') keep.add(c.source.origin);
    for (const f of v.frames.values()) keep.add(f.cause);
    for (const { belief: b } of v.beliefs.values()) for (const ev of b.evidence) keep.add(ev);
    const all = k.store.allPins().filter((p) => marked.has(p.node) || base.pins.has(p.id));
    for (const p of all) if (p.reason !== 'game') { keep.add(p.cause); if (p.evidence) keep.add(p.evidence); }
    for (const p of all) {
      if (p.reason === 'game' && !base.pins.has(p.id)) {
        const observedTwin = all.some((o) => o.reason === 'observed' && o.node === p.node && o.slot === p.slot && o.valid.from === p.valid.from);
        if (!observedTwin && !keep.has(p.id)) continue;
      }
      const w = k.store.withdrawn.get(p.id);
      // A pin withdrawn before it was ever persisted is history, not state (SPEC-NOTES 19).
      if (w && !base.pins.has(p.id)) continue;
      v.pins.set(p.id, w ? { pin: clone(p), withdrawn: { by: w.by, at: w.at } } : { pin: clone(p) });
    }
    return v;
  }

  /**
   * Every function the save depends on (spec 14.4, SPEC-NOTES 39): those the schema names, the effect
   * conflict table in force, and those used by the forms of the persisted contributions and of the
   * operations in outstanding process batches, which load back into the world.
   */
  private functionVersions(state: PersistedView): string[] {
    const k = this.k;
    const out = new Set<string>(k.schema.functionVersions());
    out.add(`conflict:${k.conflictTable.name}@${k.conflictTable.version}`);
    for (const c of state.contributions.values()) formFunctions(c.form, out);
    for (const st of state.processes.values()) {
      for (const b of st.outstanding) for (const op of b.ops) if (op.op === 'contribute') formFunctions(op.form, out);
    }
    return [...out].sort();
  }

  private meta(total: number, sinceSnapshot: number, state: PersistedView): SaveMeta {
    const k = this.k;
    return {
      worldSeed: k.worldSeed, time: k.now, cursor: k.evolution.cursor, versions: this.functionVersions(state),
      packs: [...this.installed.entries()].sort((a, b) => cmp(a[0], b[0])).map(([id, version]) => ({ id, version })),
      demandRoots: [...k.frames.demandRoots].sort(cmp), demand: k.frames.demandHistory(), sinceSnapshot, total,
    };
  }

  // ---- diffing (SPEC-NOTES 20) ----

  /** The operations that take `base` to `cur`. */
  static diff(base: PersistedView, cur: PersistedView): PersistOp[] {
    const ops: PersistOp[] = [];
    for (const [id, h] of [...cur.headers].sort((a, b) => cmp(a[0], b[0]))) if (!base.headers.has(id)) ops.push({ op: 'HeaderAdded', header: clone(h) });
    for (const [id, c] of [...cur.pins].sort((a, b) => cmp(a[0], b[0]))) {
      const was = base.pins.get(id);
      if (!was) {
        ops.push({ op: 'PinAdded', pin: clone(c.pin) });
        if (c.withdrawn) ops.push({ op: 'PinWithdrawn', pin: id, by: c.withdrawn.by, at: c.withdrawn.at });
        continue;
      }
      const to = c.pin.valid.to;
      if (to !== undefined && to !== was.pin.valid.to) ops.push({ op: 'PinEnded', pin: id, to });
      if (c.withdrawn && !was.withdrawn) ops.push({ op: 'PinWithdrawn', pin: id, by: c.withdrawn.by, at: c.withdrawn.at });
    }
    for (const [id, e] of [...cur.edges].sort((a, b) => cmp(a[0], b[0]))) {
      const was = base.edges.get(id);
      if (!was) ops.push({ op: 'EdgeAdded', edge: clone(e) });
      else if (!same(was, e)) {
        const onlyEnd = same({ ...was, valid: { from: was.valid.from } }, { ...e, valid: { from: e.valid.from } }) && e.valid.to !== undefined;
        ops.push(onlyEnd ? { op: 'EdgeEnded', edge: id, to: e.valid.to! } : { op: 'EdgeAdded', edge: clone(e) });
      }
    }
    for (const [id, c] of [...cur.contributions].sort((a, b) => cmp(a[0], b[0]))) {
      const was = base.contributions.get(id);
      if (!was) ops.push({ op: 'ContributionAdded', contribution: clone(c) });
      else if (c.valid.to !== undefined && c.valid.to !== was.valid.to) ops.push({ op: 'ContributionEnded', contribution: id, to: c.valid.to });
    }
    for (const [id, b] of [...cur.beliefs].sort((a, c) => cmp(a[0], c[0]))) {
      const was = base.beliefs.get(id);
      if (!was || !same(was, b)) ops.push({ op: 'BeliefSet', entry: clone(b) });
    }
    for (const id of [...base.beliefs.keys()].sort(cmp)) if (!cur.beliefs.has(id)) ops.push({ op: 'BeliefDropped', belief: id });
    for (const [id, c] of [...cur.canon].sort((a, b) => cmp(a[0], b[0]))) if (!same(base.canon.get(id), c)) ops.push({ op: 'EventCanon', canon: clone(c) });
    for (const [id, s] of [...cur.summaries].sort((a, b) => cmp(a[0], b[0]))) if (!same(base.summaries.get(id), s)) ops.push({ op: 'SummarySet', summary: clone(s) });
    for (const [id, f] of [...cur.frames].sort((a, b) => cmp(a[0], b[0]))) if (!same(base.frames.get(id), f)) ops.push({ op: 'FrameState', id, frame: clone(f) });
    for (const id of [...base.frames.keys()].sort(cmp)) if (!cur.frames.has(id)) ops.push({ op: 'FrameState', id, frame: null });
    for (const [id, s] of [...cur.seeds].sort((a, b) => cmp(a[0], b[0]))) if (!same(base.seeds.get(id), s)) ops.push({ op: 'SeedState', id, seed: clone(s) });
    for (const id of [...base.seeds.keys()].sort(cmp)) if (!cur.seeds.has(id)) ops.push({ op: 'SeedState', id, seed: null });
    for (const [id, p] of [...cur.processes].sort((a, b) => cmp(a[0], b[0]))) if (!same(base.processes.get(id), p)) ops.push({ op: 'ProcessState', state: clone(p) });
    // Settings are an append-only log: the entries the chain does not hold yet (a branch always starts from its parent's log).
    for (let n = base.settings.length; n < cur.settings.length; n++) ops.push({ op: 'SettingsSet', settings: clone(cur.settings[n]!) });
    return ops;
  }

  // ---- save ----

  /** Write a save record for the current state, as a child of the save last written or loaded (spec 14.2). */
  save(saveKey: string): SaveRecord {
    this.k.assertWritable();
    // The seeding layer writes its records to the seed table first (spec 14.1).
    this.k.layer2?.flush();
    if (this.chain.has(saveKey)) throw new Error(`save key already used: ${saveKey}`);
    const k = this.k;
    const cur = this.currentView();
    const ops = Persistence.diff(this.base, cur);
    const parent = this.baseKey ? this.chain.get(this.baseKey)! : undefined;
    const total = (parent?.meta.total ?? 0) + ops.length;
    let since = (parent?.meta.sinceSnapshot ?? 0) + ops.length;
    const next = this.base.clone();
    for (const op of ops) next.apply(op);
    const rec: SaveRecord = { saveKey, parent: this.baseKey, ops, meta: this.meta(total, since, next) };
    if (since >= k.config.snapshotEvery) {
      rec.snapshot = next.toData();
      since = 0;
      rec.meta.sinceSnapshot = 0;
    }
    this.chain.set(saveKey, rec);
    this.base = next;
    this.baseKey = saveKey;
    return rec;
  }

  /** The state a save holds, rebuilt from the nearest snapshot (spec 14.3 step 2). */
  rebuild(saveKey: string): { view: PersistedView; replayed: number } {
    const path: SaveRecord[] = [];
    for (let key: string | null = saveKey; key !== null; key = this.chain.get(key)?.parent ?? null) {
      const r = this.chain.get(key);
      if (!r) throw new Error(`unknown save: ${key}`);
      path.push(r);
    }
    path.reverse();
    let start = 0;
    let view = new PersistedView();
    for (let n = path.length - 1; n >= 0; n--) {
      const snap = path[n]!.snapshot;
      if (snap) {
        view = PersistedView.fromData(snap);
        start = n + 1;
        break;
      }
    }
    let replayed = 0;
    for (let n = start; n < path.length; n++) {
      for (const op of path[n]!.ops) {
        view.apply(op);
        replayed++;
      }
    }
    return { view, replayed };
  }

  // ---- load (spec 14.3) ----

  /**
   * Loading is replacement. Discards all branch-local state, replays the save's ops silently, reconciles
   * with the game, and starts a new epoch.
   */
  load(saveKey: string, port?: GamePort): LoadReport {
    const k = this.k;
    const rec = this.chain.get(saveKey);
    if (!rec) throw new Error(`unknown save: ${saveKey}`);
    const { view, replayed } = this.rebuild(saveKey);

    // 1. Discard all branch-local state.
    if (k.batch) throw new Error('a staged batch is open: it is committed or discarded before a load (spec 14.2a)');
    k.store.clear();
    k.settings.clear();
    k.beliefs.clear();
    k.events.clear();
    k.summaries.clear();
    k.retention.clear();
    k.frames.clear();
    k.frames.demandRoots.clear();
    k.groups.clear();
    k.dispatcher.reset();
    k.evolution.clearQueue();
    k.pending.length = 0;
    k.defects.clear();
    k.readOnly = null;

    // 2. Replay silently (I-13): records go straight into the stores, with no changes and no relevance.
    for (const h of view.headers.values()) k.store.addHeader(clone(h));
    for (const { pin, withdrawn } of view.pins.values()) {
      k.store.addPin(clone(pin));
      if (withdrawn) k.store.withdrawn.set(pin.id, { pin: pin.id, by: withdrawn.by, at: withdrawn.at });
    }
    for (const e of view.edges.values()) k.store.addEdge(clone(e));
    for (const c of view.contributions.values()) k.store.addContribution(clone(c));
    for (const b of view.beliefs.values()) k.beliefs.restore(clone(b));
    for (const c of view.canon.values()) k.events.setCanonRecord(clone(c));
    for (const s of view.summaries.values()) k.summaries.setRecord(clone(s));
    k.settings.restore(view.settings);
    for (const f of view.frames.values()) k.frames.insert(clone(f));
    for (const s of view.seeds.values()) k.retention.seeds.set(s.id, clone(s));
    for (const r of rec.meta.demandRoots) k.frames.demandRoots.add(r);
    k.frames.setDemandHistory(rec.meta.demand);
    k.evolution.restore([...view.processes.values()].map(clone), rec.meta.cursor);
    for (const f of view.frames.values()) k.frames.worklist.push({ t: 'pull', frame: f.id });

    // Packs are reloaded, not stored.
    const missingPacks: string[] = [];
    this.installed.clear();
    for (const p of rec.meta.packs) {
      const pack = this.packs.get(p.id);
      if (!pack) {
        missingPacks.push(`${p.id}@${p.version}`);
        continue;
      }
      this.installPack(pack);
    }

    // 4a. Compatibility (spec 14.4): every function a persisted record depends on must still exist.
    const have = new Set(k.registry.list());
    const missing = rec.meta.versions.filter((v) => !have.has(v));
    let report: LoadReport = { saveKey, readOnly: false, epoch: k.epoch, missingPacks, replayed };
    k.now = rec.meta.time;
    k.groups.restoreAt(rec.meta.time);
    // The frames come back as saved. What the clock did to them between the last tick and the save is settled
    // now, at the saved time and before the game's time is adopted below, so no membership is read at a time
    // the catch-up has not reached (SPEC-NOTES 56). The catch-up then keeps inheritance right boundary by boundary.
    k.frames.settle();
    k.bump();

    // 3. Reconcile with the game: the mirrored state becomes `game` readings at the current time.
    if (port) {
      const t = port.now();
      k.now = t;
      for (const r of port.readMirrored()) {
        const node = k.mirrored(r.gameKey, r.kind);
        k.reading(node, r.slot, r.value, t, true);
      }
    }
    if (missing.length > 0) {
      k.readOnly = { message: `This save needs functions that are no longer available: ${missing.join(', ')}. It opens read-only.` };
      report = { ...report, readOnly: true, message: k.readOnly.message };
    }

    // 4. Start a new epoch and resume.
    report.epoch = k.newEpoch();
    this.base = view.clone();
    this.baseKey = saveKey;
    // The seeding layer rebuilds its instances from the seed table the replay put back (S2 section 12.2).
    k.layer2?.onLoad();
    return report;
  }

  records(): SaveRecord[] {
    return [...this.chain.values()];
  }
}

/**
 * A copy of a record fit for an export or a bug report (spec 14.2, v4, V4-21): the sensitive material is dropped
 * by default. That is the content settings, and the director's beliefs about V.
 */
export function redactSensitive(rec: SaveRecord, worldSeed: Id): SaveRecord {
  const director = rootId(worldSeed, 'director');
  const v = rootId(worldSeed, 'v');
  const secret = (e: BeliefEntry): boolean => e.belief.believer === director && e.belief.subject === v;
  const scrub = (s: SettingsEntry): SettingsEntry => ({ ...s, content: { preset: 'redacted', ceiling: {}, notice: {}, softExclusions: [] } });
  const out = clone(rec);
  out.ops = out.ops
    .filter((op) => !(op.op === 'BeliefSet' && secret(op.entry)))
    .map((op) => (op.op === 'SettingsSet' ? { op: 'SettingsSet' as const, settings: scrub(op.settings) } : op));
  if (out.snapshot) {
    out.snapshot.beliefs = out.snapshot.beliefs.filter((e) => !secret(e));
    if (out.snapshot.settings) out.snapshot.settings = out.snapshot.settings.map(scrub);
  }
  return out;
}
