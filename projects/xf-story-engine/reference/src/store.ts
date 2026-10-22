// Plain tables with indexes and no policy (spec 3, 4, 6). The kernel owns the revision counter; the
// store only holds records. Rules (who may withdraw a pin, what a write emits) live in the kernel.

import type {
  Contribution, Edge, GameTime, Id, KindId, Node, NodeHeader, Pin, SlotKey, SlotState,
} from './types.ts';

export interface Withdrawal {
  pin: Id;
  by: Id;
  at: GameTime;
}

const slotKeyOf = (node: Id, slot: string): string => `${node}|${slot}`;

export class Store {
  /** Every known node header. Persisted only for the retained closure (spec 7.3). */
  readonly headers = new Map<Id, NodeHeader>();
  /** Materialised nodes (slot caches). Dropping one never loses a fact. */
  readonly nodes = new Map<Id, Node>();
  private readonly headersByKind = new Map<KindId, Set<Id>>();
  /** owner id to the owned values and members headed under it. */
  private readonly ownedBy = new Map<Id, Set<Id>>();
  /** "owner|slot" to the member headers of that many-slot. */
  private readonly membersOf = new Map<string, Set<Id>>();

  private readonly pinsById = new Map<Id, Pin>();
  private readonly pinIndex = new Map<string, Id[]>();
  readonly withdrawn = new Map<Id, Withdrawal>();

  private readonly contribs = new Map<Id, Contribution>();
  private readonly contribByNode = new Map<Id, Id[]>();
  private readonly contribGeneral: Id[] = [];

  readonly edges = new Map<Id, Edge>();
  private readonly edgesFromIdx = new Map<Id, Id[]>();
  private readonly edgesToIdx = new Map<Id, Id[]>();

  /** Drop every record (a load replaces all branch-local state, spec 14.3). */
  clear(): void {
    this.headers.clear();
    this.nodes.clear();
    this.headersByKind.clear();
    this.ownedBy.clear();
    this.membersOf.clear();
    this.pinsById.clear();
    this.pinIndex.clear();
    this.withdrawn.clear();
    this.contribs.clear();
    this.contribByNode.clear();
    this.contribGeneral.length = 0;
    this.edges.clear();
    this.edgesFromIdx.clear();
    this.edgesToIdx.clear();
  }

  // ---- headers and nodes ----

  /** Add a header. Returns false (and changes nothing) if the Id is already known. */
  addHeader(h: NodeHeader): boolean {
    if (this.headers.has(h.id)) return false;
    this.headers.set(h.id, h);
    let set = this.headersByKind.get(h.kind);
    if (!set) this.headersByKind.set(h.kind, (set = new Set()));
    set.add(h.id);
    if (h.origin.by === 'value' || h.origin.by === 'member') {
      let owned = this.ownedBy.get(h.origin.owner);
      if (!owned) this.ownedBy.set(h.origin.owner, (owned = new Set()));
      owned.add(h.id);
      if (h.origin.by === 'member') {
        const key = slotKeyOf(h.origin.owner, h.origin.slot);
        let m = this.membersOf.get(key);
        if (!m) this.membersOf.set(key, (m = new Set()));
        m.add(h.id);
      }
    }
    return true;
  }

  removeHeader(id: Id): void {
    const h = this.headers.get(id);
    if (!h) return;
    this.headers.delete(id);
    this.nodes.delete(id);
    this.headersByKind.get(h.kind)?.delete(id);
    if (h.origin.by === 'value' || h.origin.by === 'member') {
      this.ownedBy.get(h.origin.owner)?.delete(id);
      if (h.origin.by === 'member') this.membersOf.get(slotKeyOf(h.origin.owner, h.origin.slot))?.delete(id);
    }
  }

  header(id: Id): NodeHeader | undefined {
    return this.headers.get(id);
  }

  /** The node's slot cache, created on first use. The header must exist. */
  ensureNode(id: Id, now: GameTime): Node {
    let n = this.nodes.get(id);
    if (!n) {
      const h = this.headers.get(id);
      if (!h) throw new Error(`unknown node: ${id}`);
      n = { ...h, slots: new Map<SlotKey, SlotState>(), touched: now };
      this.nodes.set(id, n);
    }
    return n;
  }

  idsOfKind(kind: KindId): Id[] {
    return [...(this.headersByKind.get(kind) ?? [])].sort();
  }

  /** Owned values and members headed under an owner, sorted. */
  ownedOf(owner: Id): Id[] {
    return [...(this.ownedBy.get(owner) ?? [])].sort();
  }

  /** Member headers of one many-slot. */
  membersOfSlot(owner: Id, slotKey: string): Id[] {
    return [...(this.membersOf.get(slotKeyOf(owner, slotKey)) ?? [])].sort();
  }

  // ---- pins ----

  addPin(p: Pin): boolean {
    if (this.pinsById.has(p.id)) return false;
    this.pinsById.set(p.id, p);
    const k = slotKeyOf(p.node, p.slot);
    let list = this.pinIndex.get(k);
    if (!list) this.pinIndex.set(k, (list = []));
    list.push(p.id);
    return true;
  }

  pin(id: Id): Pin | undefined {
    return this.pinsById.get(id);
  }

  allPins(): Pin[] {
    return [...this.pinsById.values()];
  }

  /** Every pin recorded on (node, slot), withdrawn or not, in insertion order. */
  pinsOn(node: Id, slot: string): Pin[] {
    return (this.pinIndex.get(slotKeyOf(node, slot)) ?? []).map((i) => this.pinsById.get(i)!);
  }

  /** The pins on (node, slot) that are not withdrawn. */
  livePinsOn(node: Id, slot: string): Pin[] {
    return this.pinsOn(node, slot).filter((p) => !this.withdrawn.has(p.id));
  }

  /** Every slot with at least one pin on a node. */
  pinnedSlots(node: Id): string[] {
    const out: string[] = [];
    const prefix = `${node}|`;
    for (const k of this.pinIndex.keys()) if (k.startsWith(prefix)) out.push(k.slice(prefix.length));
    return out.sort();
  }

  isWithdrawn(pin: Id): boolean {
    return this.withdrawn.has(pin);
  }

  /** Remove a pin and its withdrawal entirely (a load replaces state; nothing else deletes a pin). */
  deletePin(id: Id): void {
    const p = this.pinsById.get(id);
    if (!p) return;
    this.pinsById.delete(id);
    this.withdrawn.delete(id);
    const k = slotKeyOf(p.node, p.slot);
    const list = this.pinIndex.get(k);
    if (list) {
      const at = list.indexOf(id);
      if (at >= 0) list.splice(at, 1);
      if (list.length === 0) this.pinIndex.delete(k);
    }
  }

  /**
   * Recompute the ends of a mirrored slot's timeline (spec 6.3). Game readings are ordered by time then
   * Id; each reading is valid until the next reading's time, and an earlier one at an equal time is
   * left with an empty interval so the last wins. An observed or game pin that began before a reading
   * and had no end, or a later end, is cut at that reading. Ends are only ever set or shortened, so a
   * retained pin whose end was persisted keeps it after a reload.
   */
  recomputeTimeline(node: Id, slot: string): Pin[] {
    const all = this.livePinsOn(node, slot);
    const readings = all.filter((p) => p.reason === 'game').sort((a, b) => a.valid.from - b.valid.from || (a.id < b.id ? -1 : 1));
    const changed: Pin[] = [];
    const shorten = (p: Pin, to: GameTime) => {
      if (p.valid.to === undefined || p.valid.to > to) {
        p.valid = { from: p.valid.from, to };
        changed.push(p);
      }
    };
    for (let n = 0; n < readings.length; n++) {
      const next = readings[n + 1];
      if (next) shorten(readings[n]!, next.valid.from);
    }
    for (const o of all) {
      if (o.reason !== 'observed') continue;
      const nextReading = readings.find((r) => r.valid.from > o.valid.from);
      if (nextReading) shorten(o, nextReading.valid.from);
    }
    return changed;
  }

  // ---- contributions ----

  addContribution(c: Contribution): boolean {
    if (this.contribs.has(c.id)) return false;
    this.contribs.set(c.id, c);
    const named = c.target.scope && 'nodes' in c.target.scope ? c.target.scope.nodes : null;
    if (named) {
      for (const n of named) {
        let list = this.contribByNode.get(n);
        if (!list) this.contribByNode.set(n, (list = []));
        list.push(c.id);
      }
    } else this.contribGeneral.push(c.id);
    return true;
  }

  contribution(id: Id): Contribution | undefined {
    return this.contribs.get(id);
  }

  removeContribution(id: Id): void {
    const c = this.contribs.get(id);
    if (!c) return;
    this.contribs.delete(id);
    const named = c.target.scope && 'nodes' in c.target.scope ? c.target.scope.nodes : null;
    const drop = (list: Id[] | undefined) => {
      if (!list) return;
      const at = list.indexOf(id);
      if (at >= 0) list.splice(at, 1);
    };
    if (named) for (const n of named) drop(this.contribByNode.get(n));
    else drop(this.contribGeneral);
  }

  allContributions(): Contribution[] {
    return [...this.contribs.values()].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  }

  /** Contributions that may apply to a node: those naming it, and those with no named nodes. Unsorted, deduplicated. */
  contributionCandidates(node: Id, extraNamed: Id[] = []): Contribution[] {
    const seen = new Set<Id>();
    const out: Contribution[] = [];
    const take = (ids: Id[] | undefined) => {
      for (const i of ids ?? []) {
        if (seen.has(i)) continue;
        seen.add(i);
        const c = this.contribs.get(i);
        if (c) out.push(c);
      }
    };
    take(this.contribByNode.get(node));
    for (const e of extraNamed) take(this.contribByNode.get(e));
    take(this.contribGeneral);
    return out;
  }

  contributionsOrigin(origin: Id): Contribution[] {
    return this.allContributions().filter((c) => c.source.origin === origin);
  }

  // ---- edges ----

  addEdge(e: Edge): boolean {
    if (this.edges.has(e.id)) return false;
    this.edges.set(e.id, e);
    const push = (idx: Map<Id, Id[]>, k: Id) => {
      let list = idx.get(k);
      if (!list) idx.set(k, (list = []));
      list.push(e.id);
    };
    push(this.edgesFromIdx, e.from);
    push(this.edgesToIdx, e.to);
    return true;
  }

  removeEdge(id: Id): void {
    const e = this.edges.get(id);
    if (!e) return;
    this.edges.delete(id);
    for (const [idx, k] of [[this.edgesFromIdx, e.from], [this.edgesToIdx, e.to]] as const) {
      const list = idx.get(k);
      if (list) {
        const at = list.indexOf(id);
        if (at >= 0) list.splice(at, 1);
      }
    }
  }

  edgesFrom(node: Id): Edge[] {
    return (this.edgesFromIdx.get(node) ?? []).map((i) => this.edges.get(i)!);
  }

  edgesTo(node: Id): Edge[] {
    return (this.edgesToIdx.get(node) ?? []).map((i) => this.edges.get(i)!);
  }

  allEdges(): Edge[] {
    return [...this.edges.values()].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  }

  /** Drop the materialised state of a node (spec 7.2, 7.3). Pins, edges and headers stay. */
  dropNode(id: Id): void {
    this.nodes.delete(id);
  }
}
