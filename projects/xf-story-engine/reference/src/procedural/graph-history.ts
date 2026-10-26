import type { Id } from '../types.ts';
import { eventFacts } from '../seeding/eval.ts';
import type { Layer3 } from './layer3.ts';
import type { EventView } from './types.ts';

type Projection = { acts: Array<[Id, number]>; known: Array<[Id, number]> };

/** Lazy deletion keeps replacement and extrema logarithmic; occasional compaction bounds storage. */
class Times {
  private values = new Map<string, number>();
  private heap: Array<{ key: string; at: number }> = [];
  constructor(private readonly direction: 1 | -1) {}
  private push(row: { key: string; at: number }): void {
    let n = this.heap.length; this.heap.push(row);
    while (n > 0) {
      const parent = (n - 1) >> 1;
      if (this.direction * (this.heap[parent].at - row.at) <= 0) break;
      this.heap[n] = this.heap[parent]; n = parent;
    }
    this.heap[n] = row;
  }
  set(key: string, at?: number): void {
    if (at === undefined) this.values.delete(key);
    else { this.values.set(key, at); this.push({ key, at }); }
    if (this.heap.length > Math.max(32, this.values.size * 2)) {
      this.heap = [];
      for (const [key, at] of this.values) this.push({ key, at });
    }
  }
  first(): number | undefined {
    while (this.heap.length && this.values.get(this.heap[0].key) !== this.heap[0].at) {
      const last = this.heap.pop()!;
      if (!this.heap.length) break;
      let n = 0;
      while (2 * n + 1 < this.heap.length) {
        let child = 2 * n + 1;
        if (child + 1 < this.heap.length && this.direction * (this.heap[child + 1].at - this.heap[child].at) < 0) child++;
        if (this.direction * (last.at - this.heap[child].at) <= 0) break;
        this.heap[n] = this.heap[child]; n = child;
      }
      this.heap[n] = last;
    }
    return this.heap[0]?.at;
  }
}

/** Session-local indexes, never roots or saved facts. Ordinary constant events are revisited only
 * when their facts change. Rules, descriptors and time-dependent fields retain the general reader. */
export class GraphHistory {
  readonly actTimes = new Map<Id, number>();
  readonly knownTimes = new Map<Id, number>();
  version = 0;
  private canon = new Set<Id>();
  private dirty = new Set<Id>();
  private replace = true;
  private volatile = new Set<Id>();
  private due = new Map<Id, number>();
  private rows = new Map<string, Projection>();
  private acts = new Map<Id, Times>();
  private known = new Map<Id, Times>();
  private receiptKey = '';
  private receiptCites = new Set<Id>();
  private receiptDirty = true;
  private lastNow = -Infinity;
  private lastRevision = -1;
  private catalogue = '';
  private registry: unknown;
  private agentRoles: unknown;
  constructor(private readonly h: Layer3) {
    h.k.store.factObservers.push((node) => {
      if (node === undefined) this.replace = true;
      else this.dirty.add(node);
      this.receiptDirty = true;
    });
    h.k.changeObservers.push((change) => {
      if (change.c === 'pin' || change.c === 'reading') {
        let node = change.node, header = h.k.store.header(node);
        while (header && (header.origin.by === 'member' || header.origin.by === 'value')) {
          node = header.origin.owner; header = h.k.store.header(node);
        }
        this.dirty.add(node); this.receiptDirty = true;
      }
    });
    h.k.events.projectionObservers.push((event, canon) => {
      if (event === undefined) this.replace = true;
      else { if (canon) this.canon.add(event); this.dirty.add(event); }
      this.receiptDirty = true;
    });
  }
  private put(key: string, projection: Projection): void {
    const prior = this.rows.get(key);
    for (const [field, index, values, reduce] of [
      ['acts', this.acts, this.actTimes, Math.max], ['known', this.known, this.knownTimes, Math.min],
    ] as const) {
      const touched = new Set([...(prior?.[field] ?? []).map(([node]) => node), ...projection[field].map(([node]) => node)]);
      for (const [node] of prior?.[field] ?? []) index.get(node)?.set(key);
      const combined = new Map<Id, number>();
      for (const [node, at] of projection[field]) {
        combined.set(node, combined.has(node) ? reduce(combined.get(node)!, at) : at);
      }
      for (const [node, at] of combined) {
        if (!index.has(node)) index.set(node, new Times(field === 'acts' ? -1 : 1));
        index.get(node)!.set(key, at);
      }
      for (const node of touched) {
        const first = index.get(node)!.first();
        if (first !== undefined) values.set(node, first);
        else { index.delete(node); values.delete(node); }
      }
    }
    this.rows.set(key, projection);
  }
  private stable(event: Id, view: EventView): boolean {
    const k = this.h.k, fields = /^(time|kind|place|participants|effects|witnesses|causes|who|role|on|effect|outcome|served|data)(#|\[|$)/;
    // Header-only summary items have live descriptor dependencies even without provenance.
    const origin = k.store.header(event)?.origin;
    if (origin?.by === 'minted' && origin.creator === origin.cause && /^item:\d+$/.test(origin.name)) {
      const owner = k.store.header(origin.creator);
      if (owner && k.schema.hasFacet(owner.kind, 'summary')) return false;
    }
    if (k.events.materialisationOf(event) || k.store.generalContributions().some((c) => c.target.slot === '*' || fields.test(c.target.slot))) return false;
    let until = Infinity;
    const boundary = (t: number | undefined) => { if (t !== undefined && t > k.now) until = Math.min(until, t); };
    const nodes = [event];
    for (let n = 0; n < nodes.length; n++) {
      const node = nodes[n], header = k.store.header(node);
      if (!header) return false;
      // A retained extra member can raise a count without editing an event's constants. Such
      // unusual events use the general reader until their entire owned structure fits the count.
      if (header.origin.by === 'member' && header.origin.owner === event) {
        const field = header.origin.slot;
        if (['participants', 'effects', 'witnesses', 'causes'].includes(field)
          && header.origin.index >= view[field as 'participants'].length) return false;
      }
      nodes.push(...k.store.ownedOf(node));
      for (const slot of k.schema.kind(header.kind).slots.filter((s) => fields.test(s.key)))
        if (slot.temporal || slot.conditioned || slot.derive || slot.mode === 'mirrored') return false;
      for (const c of k.store.contributionsNaming(node)) {
        if (c.form.f !== 'const' || c.mode !== 'constrain' || c.target.where?.length || !c.target.scope || !('nodes' in c.target.scope)) return false;
        boundary(c.valid.from); boundary(c.valid.to);
      }
      for (const p of k.store.pinsOfNode(node)) {
        if (p.region !== undefined) return false;
        boundary(p.valid.from); boundary(p.valid.to);
      }
    }
    if (until < Infinity) this.due.set(event, until);
    else this.due.delete(event);
    return true;
  }
  refresh(): void {
    const h = this.h, receipts = [...h.l2.global.receipts, ...h.l2.all().flatMap((i) => i.st.receipts)];
    const catalogue = JSON.stringify([h.k.eventKinds.version, h.l2.reg.vocabulary]);
    if (catalogue !== this.catalogue || this.registry !== h.l2.worldRegistry || this.agentRoles !== h.l2.worldRegistry.agentRoles) this.replace = true;
    this.catalogue = catalogue; this.registry = h.l2.worldRegistry; this.agentRoles = h.l2.worldRegistry.agentRoles;
    if (h.k.now < this.lastNow) this.replace = true;
    // Receipt citations need not be canon, so their validity boundaries aren't in `due`.
    // Re-read them on clock/revision changes as well as explicit fact notifications.
    if (h.k.now !== this.lastNow || h.k.revision !== this.lastRevision) this.receiptDirty = true;
    this.lastNow = h.k.now;
    this.lastRevision = h.k.revision;
    const receiptKey = JSON.stringify(receipts.map((r) => [r, h.l2.instance(r.seed)?.st.deliveries.find((d) => d.id === r.delivery)?.bindings]));
    const receiptsChanged = receiptKey !== this.receiptKey;
    const replaced = this.replace;
    if (this.replace) {
      this.canon = new Set(h.k.events.canonEvents());
      this.dirty = new Set(this.canon);
      this.rows.clear(); this.acts.clear(); this.known.clear(); this.actTimes.clear(); this.knownTimes.clear();
      this.volatile.clear(); this.due.clear(); this.receiptDirty = true;
      this.replace = false;
    }
    if (receiptsChanged) {
      for (const event of this.receiptCites) this.dirty.add(event);
      this.receiptCites = new Set(receipts.flatMap((r) => r.cites));
      for (const event of this.receiptCites) this.dirty.add(event);
      this.receiptDirty = true;
    }
    for (const event of this.volatile) this.dirty.add(event);
    for (const [event, at] of this.due) if (h.k.now >= at) { this.dirty.add(event); this.due.delete(event); }
    const dirty = this.dirty; this.dirty = new Set();
    if (dirty.size || this.receiptDirty || receiptsChanged || replaced) this.version++;
    for (const event of [...dirty].sort()) {
      if (!this.canon.has(event)) continue;
      const view = h.kv.event(event), facts = eventFacts(h.l2, event), exposed = h.l2.exposure(event);
      const acts: Projection['acts'] = view && h.sifter.graph.world.acts(view, h.k.vId)
        ? [...view.participants.map((p) => p.who), ...view.effects.map((e) => e.on), ...(view.place ? [view.place] : [])].map((node) => [node, view.time]) : [];
      const known: Projection['known'] = facts && exposed && exposed.grade !== 'ambient'
        ? [event, ...facts.participants.map((p) => p.who), ...(facts.place ? [facts.place] : [])].map((node) => [node, exposed.at]) : [];
      this.put(event, { acts, known });
      if (view && facts && this.stable(event, view)) this.volatile.delete(event);
      else this.volatile.add(event);
    }
    if (this.receiptDirty) {
      const known: Projection['known'] = [];
      for (const r of receipts) {
        if (r.grade === 'ambient') continue;
        const d = h.l2.instance(r.seed)?.st.deliveries.find((d) => d.id === r.delivery), at = r.presentedAt ?? r.at;
        for (const node of [...Object.values(r.cue), ...Object.values(d?.bindings ?? {})]) if (node !== undefined) known.push([node, at]);
        for (const event of r.cites) {
          known.push([event, at]);
          const facts = eventFacts(h.l2, event);
          for (const node of [...(facts?.participants.map((p) => p.who) ?? []), ...(facts?.place ? [facts.place] : [])]) known.push([node, at]);
        }
      }
      this.put('@receipts', { acts: [], known });
      this.receiptDirty = false;
    }
    this.receiptKey = receiptKey;
  }
}
