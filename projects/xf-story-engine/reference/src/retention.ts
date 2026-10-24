// Retention and forgetting (spec 7.3): mark and sweep over current semantic facts.
//
// The roots are the facts the world still stands on, not the records that merely support them:
// pins in effect now (or observed, or committed), edges that have not ended, memorable beliefs, canon
// events and the canon items of summaries, live seeds, the active and blocked frames of demand roots and
// live seeds with every ancestor, the nodes those frames focus on, and the mirrored nodes the game
// currently streams in. Marking follows every root's Id fields, origin chains and owned-value links.
// Sweeping discards unmarked nodes' in-memory state; a swept node regenerates identically (I-3).

import { idsIn as idFields } from './canon.ts';
import type { Kernel } from './kernel.ts';
import { splitWindowPath } from './kernel.ts';
import { isId } from './id.ts';
import type { Edge, GameTime, Id, Pin, Region, Value } from './types.ts';
import { type Budget, Worklist } from './work.ts';

export interface SeedRecord {
  id: Id;
  /** The seed's own state (S2's), plain data. */
  state: unknown;
  /** Nodes the seed holds live. */
  nodes: Id[];
  /** The seed's demand-root actor, if it has one. */
  actor?: Id;
}

const cmpId = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

export class Retention {
  readonly seeds = new Map<Id, SeedRecord>();
  readonly streamed = new Set<Id>();
  private cache: { revision: number; now: GameTime; marked: Set<Id>; maxMember: Map<string, number>; eventFacts: Set<Id> } | null = null;
  private sweepList = new Worklist<{ id: Id }>();

  constructor(private readonly k: Kernel) {}

  // ---- seeds and streaming ----

  setSeed(rec: SeedRecord): void {
    this.k.assertWritable();
    this.seeds.set(rec.id, { ...rec, nodes: [...rec.nodes] });
    if (rec.actor !== undefined) this.k.frames.demandRoots.add(rec.actor);
    this.k.bump();
  }

  endSeed(id: Id): void {
    this.k.assertWritable();
    const s = this.seeds.get(id);
    if (!s) return;
    this.seeds.delete(id);
    if (s.actor !== undefined) this.k.frames.demandRoots.delete(s.actor);
    this.k.bump();
  }

  streamIn(ids: Id[]): void {
    this.k.assertWritable();
    for (const i of ids) this.streamed.add(i);
    this.k.bump();
  }

  streamOut(ids: Id[]): void {
    this.k.assertWritable();
    for (const i of ids) this.streamed.delete(i);
    this.k.bump();
  }

  invalidate(): void {
    this.cache = null;
  }

  /** A deep copy of the seeds, streaming and sweep state, for a staged batch's discard (spec 14.2a). */
  capture(): unknown {
    return structuredClone({ seeds: this.seeds, streamed: this.streamed, sweep: this.sweepList.snapshot() });
  }

  restoreFrom(cap: unknown): void {
    const c = structuredClone(cap) as { seeds: Map<Id, SeedRecord>; streamed: Set<Id>; sweep: Array<{ id: Id }> };
    this.seeds.clear();
    for (const [k, v] of c.seeds) this.seeds.set(k, v);
    this.streamed.clear();
    for (const i of c.streamed) this.streamed.add(i);
    this.sweepList.restore(c.sweep);
    this.cache = null;
  }

  clear(): void {
    this.seeds.clear();
    this.streamed.clear();
    this.cache = null;
    this.sweepList.clear();
  }

  // ---- roots ----

  /** Whether an edge is a root: not ended, or ended but referenced by a canon event. An event's own location edge is not. */
  isRootEdge(e: Edge, canonEvents: Set<Id> = new Set(this.k.events.canonEvents())): boolean {
    const k = this.k;
    const live = e.valid.to === undefined || e.valid.to > k.now;
    const fromHeader = k.store.header(e.from);
    const ownEventEdge = e.cause === e.from && e.type === 'core:located-in' && fromHeader !== undefined &&
      k.schema.hasFacet(fromHeader.kind, 'event') && !canonEvents.has(e.from);
    const referenced = canonEvents.has(e.from) || canonEvents.has(e.to) || canonEvents.has(e.cause);
    return (live && !ownEventEdge) || (!live && referenced);
  }

  /** The active and blocked frames of demand roots and live seeds, and every ancestor frame of those (spec 7.3, 14.1). */
  rootFrameIds(): Set<Id> {
    const k = this.k;
    const rootActors = new Set<Id>(k.frames.demandRoots);
    for (const s of this.seeds.values()) {
      if (s.actor !== undefined) rootActors.add(s.actor);
      rootActors.add(s.id);
    }
    const frameIds = new Set<Id>();
    for (const f of k.frames.all()) {
      if (rootActors.has(f.actor) && k.frames.eligible(f)) for (const a of k.frames.ancestorsOrSelf(f.id)) frameIds.add(a);
    }
    return frameIds;
  }

  /** Whether a pin is in effect now (spec 6.1, 6.2, 6.3, SPEC-NOTES 5). */
  pinInEffectNow(p: Pin): boolean {
    const k = this.k;
    const h = k.store.header(p.node);
    if (!h) return false;
    const { path, window } = splitWindowPath(p.slot);
    const info = k.schema.slotInfo(h.kind, path);
    if (!info) return false;
    const temporal = window !== undefined;
    const timeline = h.origin.by === 'mirrored' && info.def.mode === 'mirrored';
    if (!temporal && !timeline) return true;
    return p.valid.from <= k.now && (p.valid.to === undefined || k.now < p.valid.to);
  }

  private idsIn(v: Value | Region | undefined, out: Id[]): void {
    if (v === undefined) return;
    if (typeof v === 'string') {
      if (isId(v)) out.push(v);
    } else if (!Array.isArray(v) && typeof v === 'object' && v.r === 'set') {
      for (const x of v.values) if (isId(x)) out.push(x);
    }
  }

  /** The Ids of every root and the Id fields of the records that make it one (spec 7.3). */
  rootIds(): Id[] {
    const k = this.k;
    const out: Id[] = [];
    const push = (...ids: Array<Id | undefined>): void => {
      for (const i of ids) if (i !== undefined) out.push(i);
    };
    const expand = (idStr: string): Id => k.expandId(idStr);
    for (const p of k.store.allPins()) {
      if (k.store.isWithdrawn(p.id)) continue;
      if (!(p.reason === 'observed' || p.reason === 'committed' || this.pinInEffectNow(p))) continue;
      push(p.node, p.cause, p.evidence);
      this.idsIn(p.value, out);
      this.idsIn(p.region, out);
    }
    const canonEvents = new Set(k.events.canonEvents());
    for (const e of k.store.edgeValues()) {
      if (this.isRootEdge(e, canonEvents)) push(e.from, e.to, e.cause);
    }
    for (const { belief: b } of k.beliefs.memorable()) {
      push(b.believer, b.subject, ...b.evidence);
      this.idsIn(b.value, out);
      this.idsIn(b.region, out);
      if (b.source.by === 'observed') push(b.source.event);
      else if (b.source.by === 'told') push(b.source.teller, b.source.event);
      else push(...b.source.from);
    }
    push(...canonEvents, ...k.summaries.canonItemIds());
    for (const s of k.summaries.records()) if (s.canon.length > 0) push(s.summary);
    for (const s of this.seeds.values()) push(s.id, s.actor, ...s.nodes);
    // Outstanding process batches: the Ids their operations name must stay addressable until they apply (SPEC-NOTES 33).
    for (const st of k.evolution.states.values()) {
      for (const b of st.outstanding) push(...idFields(b.ops, expand));
    }
    // Frames of demand roots and live seeds, with every ancestor. The Id fields of a frame are its links, its
    // focus, its goal's targets and every Id its interests name (SPEC-NOTES 33).
    for (const fid of this.rootFrameIds()) {
      const f = k.frames.frame(fid)!;
      push(f.actor, f.origin, f.payload.place, f.cause, ...f.focus.nodes);
      for (const p of f.parents) push(p.frame);
      push(...idFields(f.payload.goal, expand), ...idFields(f.own, expand));
    }
    push(...this.streamed);
    return out;
  }

  /** The marked set: every root's closure over Id fields, origin chains and owned-value links (spec 7.3). Cached per revision and engine time. */
  marked(): Set<Id> {
    return this.compute().marked;
  }

  /** Own event constants that persisted consumers cannot regenerate after replay. */
  eventFacts(): ReadonlySet<Id> { return this.compute().eventFacts; }

  private compute(): { marked: Set<Id>; maxMember: Map<string, number>; eventFacts: Set<Id> } {
    if (this.cache && this.cache.revision === this.k.revision && this.cache.now === this.k.now) return this.cache;
    const store = this.k.store;
    const marked = new Set<Id>();
    const stack = [...this.rootIds()];
    const eventRoots = new Set([...this.seeds.values()].flatMap(s => s.nodes));
    for (const st of this.k.evolution.states.values())
      for (const batch of st.outstanding)
        for (const ref of idFields(batch.ops, (id) => this.k.expandId(id))) eventRoots.add(ref);
    const traversedEvents = new Set<Id>();
    const eventFacts = new Set<Id>();
    while (stack.length > 0) {
      const id = stack.pop()!;
      const firstVisit = !marked.has(id);
      const traverseEvent = eventRoots.has(id) && !traversedEvents.has(id);
      if (!firstVisit && !traverseEvent) continue;
      marked.add(id);
      const h = store.header(id);
      if (!h) continue;
      if (traverseEvent) traversedEvents.add(id);
      if (h.origin.by === 'value' || h.origin.by === 'member') stack.push(h.origin.owner);
      else if (h.origin.by === 'minted') stack.push(h.origin.creator, h.origin.cause);
      // A retained non-canon event keeps its described people, place and causes too (S3-I-22).
      // Its fields are simulation constants, so they need not have canon pins. Read the stored
      // constants directly: resolution here would recursively ask retention about member counts.
      if (traverseEvent && this.k.schema.isKind(h.kind, 'core:event')) {
        const fields = [id], seenFields = new Set<Id>();
        for (let n = 0; n < fields.length; n++) {
          const field = fields[n]; if (seenFields.has(field)) continue; seenFields.add(field);
          stack.push(field);
          fields.push(...store.ownedOf(field));
          for (const c of store.contributionsNaming(field)) if (c.form.f === 'const') {
            if (c.source.layer === 'simulation' && c.source.origin === id) eventFacts.add(c.id);
            const refs: Id[] = []; this.idsIn(c.form.value, refs); stack.push(...refs); for (const ref of refs) eventRoots.add(ref);
          }
        }
      }
      for (const o of store.ownedOf(id)) {
        if (store.header(o)?.origin.by === 'value') stack.push(o);
      }
    }
    const maxMember = new Map<string, number>();
    for (const id of marked) {
      const h = store.header(id);
      if (h && h.origin.by === 'member') {
        const key = `${h.origin.owner}|${h.origin.slot}`;
        const cur = maxMember.get(key);
        if (cur === undefined || h.origin.index > cur) maxMember.set(key, h.origin.index);
      }
    }
    this.cache = { revision: this.k.revision, now: this.k.now, marked, maxMember, eventFacts };
    return this.cache;
  }

  /** The highest index of a retained member of a many-slot, or undefined (spec 6.5). */
  maxRetainedMember(owner: Id, slotKey: string): number | undefined {
    return this.compute().maxMember.get(`${owner}|${slotKey}`);
  }

  isRetained(id: Id): boolean {
    return this.marked().has(id);
  }

  // ---- forgetting (spec 7.3, 10.7) ----

  /** Queue every unmarked header for the sweep. Returns how many were queued. */
  scheduleSweep(): number {
    const marked = this.marked();
    let n = 0;
    for (const id of [...this.k.store.headers.keys()].sort(cmpId)) {
      if (!marked.has(id)) {
        this.sweepList.push({ id });
        n++;
      }
    }
    return n;
  }

  get pendingForgetting(): number {
    return this.sweepList.length;
  }

  /** Discard one node's in-memory state. A minted node, which nothing can regenerate, goes entirely with the records it owns. */
  sweepNode(id: Id): void {
    const store = this.k.store;
    const h = store.header(id);
    if (!h) return;
    store.dropNode(id);
    if (h.origin.by === 'minted') {
      for (const c of store.contributionsOrigin(id)) store.removeContribution(c.id);
      for (const e of store.edgesFrom(id)) if (e.cause === id) store.removeEdge(e.id);
      this.removeTree(id);
      // Removing a node's records changes what resolves, so cached results go (no change is emitted).
      this.k.bump();
    } else if ((h.origin.by === 'value' || h.origin.by === 'member') && !store.header(h.origin.owner)) {
      store.removeHeader(id);
    }
  }

  /** Remove a header and, under it, every owned value and member header. */
  private removeTree(id: Id): void {
    for (const o of this.k.store.ownedOf(id)) this.removeTree(o);
    this.k.store.removeHeader(id);
  }

  /** Run the forgetting worklist under a budget: one node per step, resumable. Silent: no revision, no change. */
  runForgetting(budget: Budget): number {
    return this.sweepList.run(budget, (item) => {
      if (!this.marked().has(item.id)) this.sweepNode(item.id);
      return { cost: 1, done: true };
    });
  }
}
