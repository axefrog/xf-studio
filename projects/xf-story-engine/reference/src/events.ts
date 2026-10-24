// Events (spec 9.2): minted nodes of kind `core:event`, and how an event becomes canon.
//
// A minted event carries its fields as `simulation`-layer Const contributions (SPEC-NOTES 6): a pin in
// effect is a retention root, so pinning every minted event would make forgetting impossible. An event
// becomes canon when V observes it, a seed commits it, or a persisted effect depends on it; only then
// are the named fields pinned (`observed` at 600 or `committed` at 300).

import { H, id as hid, s as hs } from './id.ts';
import type { Kernel } from './kernel.ts';
import type { Effect, GameTime, Id, PinReason, SlotPath, Value } from './types.ts';

export interface EventSpec {
  creator: Id;
  cause: Id;
  name: string;
  time: GameTime;
  kind: string;
  place?: Id;
  participants?: Array<{ who: Id; role: string }>;
  effects?: Array<{ on: Id; effect: Effect }>;
  witnesses?: Id[];
  causes?: Id[];
  /** v4 (V4-3): an attempt, a success or a prevented act. Optional. */
  outcome?: 'done' | 'failed' | 'prevented';
  /** v4 (V4-3): the Id of the frame whose goal the act served. Optional. */
  served?: Id;
}

export type EventField = 'time' | 'place' | 'kind' | 'participants' | 'effects' | 'witnesses' | 'causes' | 'outcome' | 'served';
/** An opened summary item's descriptor belongs to its summary; its other fields belong to the opening process. */
export interface EventProvenance { descriptor: Id; materialisation: Id }
export interface EventMaterialisation { event: Id; provenance: EventProvenance }
/** The fields every event has (spec 9.2). `outcome` and `served` are optional and joined in only when the event carries them. */
export const EVENT_FIELDS: readonly EventField[] = ['time', 'place', 'kind', 'participants', 'effects', 'witnesses', 'causes'];

/** One canon declaration: which fields were pinned, with what reason, and the pins that did it. */
export interface CanonEntry {
  reason: PinReason;
  fields: EventField[];
  pins: Id[];
}

export interface EventCanonRecord {
  event: Id;
  entries: CanonEntry[];
}

export class Events {
  private canonRecords = new Map<Id, CanonEntry[]>();
  private materialisations = new Map<Id, EventProvenance>();
  /** Summary items published as events in this session (V4-47). Not persisted: the publishing layer keeps its own record. */
  readonly published = new Set<Id>();
  /** The kind and time each event was minted with: a cache for queries to reject a candidate before resolving it. Not persisted. */
  private minted = new Map<Id, { kind: string; time: number; local: number }>();

  /**
   * The kind and time an event was minted with, while nothing local has touched it since: a pin or a contribution that names the event
   * may restate either, and then the resolved value is the one a query must test (S0 8.3).
   */
  mintedFacts(id: Id): { kind: string; time: number } | undefined {
    const f = this.minted.get(id);
    return f !== undefined && this.k.store.localState(id) === f.local ? f : undefined;
  }

  constructor(private readonly k: Kernel) {}

  /** Explicit ownership of an opened item's facts, shared by views and retention (S0 14.1). */
  materialisationOf(event: Id): EventProvenance | undefined {
    const provenance = this.materialisations.get(event);
    return provenance && { ...provenance };
  }

  materialisationRecords(): EventMaterialisation[] {
    return [...this.materialisations].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
      .map(([event, provenance]) => ({ event, provenance: { ...provenance } }));
  }

  /** Silent ownership declaration; replay and process application use the same authority as restoration. */
  setMaterialisation(event: Id, provenance: EventProvenance): void {
    const h = this.k.store.header(event);
    if (!h || h.origin.by !== 'minted' || h.origin.creator !== provenance.descriptor ||
      h.origin.cause !== provenance.descriptor || !/^item:\d+$/.test(h.origin.name) ||
      !this.k.schema.hasFacet(this.k.store.header(provenance.descriptor)?.kind ?? '', 'summary'))
      throw new Error(`not an item of summary ${provenance.descriptor}: ${event}`);
    const have = this.materialisations.get(event);
    if (have && (have.descriptor !== provenance.descriptor || have.materialisation !== provenance.materialisation))
      throw new Error(`materialisation owner already declared: ${event}`);
    if (have) return;
    this.materialisations.set(event, { ...provenance });
    this.k.retention.invalidate();
  }

  forgetMaterialisation(event: Id): void {
    this.materialisations.delete(event);
  }

  /**
   * Mint an event. Adds its fields as simulation contributions, a `core:located-in` edge to its place,
   * and emits one `event` change (not also `minted`, `contribution` or `edge`: SPEC-NOTES 30).
   * Minting the same (creator, cause, name) again returns the same node and does nothing.
   */
  mintEvent(spec: EventSpec): Id {
    return this.put(spec, false);
  }

  /**
   * Put an event's fields back under its own Id and announce nothing (S0 14.3, SPEC-NOTES 116, 140): the occurrence was announced when it
   * first happened. Referenced events retain their own facts across loads (S0 14.1); a layer may also regenerate unretained materialisation
   * here, whether or not the header survived. An event whose fields are already there is left alone.
   */
  restoreEvent(spec: EventSpec, provenance?: EventProvenance): Id {
    return this.put(spec, true, provenance);
  }

  /**
   * The fields a minted event carries, read from the contributions that hold them (the simulation-layer constants whose origin is the event
   * itself), not from what the event resolves to now: a pin or a rule that restates a field for a while changes what it resolves to and not
   * what it was minted with. Undefined for a node that is not a minted event, or whose own fields are not there.
   */
  mintedSpec(id: Id, item?: { descriptor: Pick<EventSpec, 'time' | 'kind' | 'place'>; provenance: EventProvenance }): EventSpec | undefined {
    const k = this.k;
    const h = k.store.header(id);
    if (!h || h.origin.by !== 'minted' || !k.schema.isKind(h.kind, 'core:event')) return undefined;
    const own = (node: Id, slot: SlotPath): Value | undefined => {
      for (const c of k.store.contributionsNaming(node)) {
        if (c.source.layer === 'simulation' && c.source.origin === (item?.provenance.materialisation ?? id) && c.target.slot === slot && c.form.f === 'const') return c.form.value;
      }
      return undefined;
    };
    const time = item?.descriptor.time ?? own(id, 'time');
    const kind = item?.descriptor.kind ?? own(id, 'kind');
    if (typeof time !== 'number' || typeof kind !== 'string') return undefined;
    const count = (slot: SlotPath): number | undefined => {
      const c = own(id, slot);
      return typeof c === 'number' ? c : undefined;
    };
    const np = count('participants#count');
    const ne = count('effects#count');
    const nw = count('witnesses#count');
    const nc = count('causes#count');
    if (np === undefined || ne === undefined || nw === undefined || nc === undefined) return undefined;
    const spec: EventSpec = { creator: h.origin.creator, cause: h.origin.cause, name: h.origin.name, time, kind, participants: [], effects: [], witnesses: [], causes: [] };
    const place = item ? item.descriptor.place : own(id, 'place');
    if (typeof place === 'string') spec.place = place;
    for (let i = 0; i < np; i++) {
      const m = k.address(id, `participants[${i}]`);
      const who = own(m, 'who');
      const role = own(m, 'role');
      if (typeof who !== 'string' || typeof role !== 'string') return undefined;
      spec.participants!.push({ who, role });
    }
    for (let i = 0; i < ne; i++) {
      const m = k.address(id, `effects[${i}]`);
      const on = own(m, 'on');
      const effect = own(m, 'effect');
      if (typeof on !== 'string' || typeof effect !== 'string') return undefined;
      spec.effects!.push({ on, effect: effect as Effect });
    }
    for (let i = 0; i < nw; i++) {
      const w = own(id, `witnesses[${i}]`);
      if (typeof w !== 'string') return undefined;
      spec.witnesses!.push(w);
    }
    for (let i = 0; i < nc; i++) {
      const c = own(id, `causes[${i}]`);
      if (typeof c !== 'string') return undefined;
      spec.causes!.push(c);
    }
    const outcome = own(id, 'outcome');
    if (outcome === 'done' || outcome === 'failed' || outcome === 'prevented') spec.outcome = outcome;
    const served = own(id, 'served');
    if (typeof served === 'string') spec.served = served;
    return spec;
  }

  private put(spec: EventSpec, quiet: boolean, provenance?: EventProvenance): Id {
    const k = this.k;
    k.assertWritable();
    const nid = H(hs('mint'), hid(spec.creator), hid(spec.cause), hs(spec.name));
    // Reusing a header is silent: the occurrence was announced when it first happened.
    const have = k.persistence.restoreReferencedHeader(nid) !== undefined;
    if (!have) k.mintSilent(spec.creator, spec.cause, spec.name, 'core:event');
    if (provenance) this.setMaterialisation(nid, provenance);
    // A surviving constant proves only that constant exists. Check the complete owned payload,
    // including member fields, and repair the spatial link from the original stored description.
    const complete = have ? this.mintedSpec(nid, provenance ? { descriptor: spec, provenance } : undefined) : undefined;
    if (complete) {
      if (!provenance && complete.place !== undefined) k.addEdge({ type: 'core:located-in', from: nid,
        to: complete.place, cause: nid, valid: { from: complete.time }, silent: true });
      return nid;
    }
    // a pin that survived a load may already restate the kind or the time: then what the event was minted with is not what it resolves to, and nothing is cached
    const untouched = k.store.localState(nid) === 0;
    const put = (node: Id, slot: SlotPath, value: Value): void => {
      k.contribute({
        source: { layer: 'simulation', origin: provenance?.materialisation ?? nid },
        target: { slot, scope: { nodes: [node] } },
        form: { f: 'const', value },
        mode: 'constrain',
        silent: true,
      });
    };
    // Summary items keep their live descriptor dependency through Summaries.itemConstraint.
    // Only their materialisation is restored here; constants would override a later summary edit.
    if (!provenance) {
      put(nid, 'time', spec.time);
      put(nid, 'kind', spec.kind);
      if (spec.place !== undefined) put(nid, 'place', spec.place);
    }
    const participants = spec.participants ?? [];
    put(nid, 'participants#count', participants.length);
    participants.forEach((p, i) => {
      const m = k.address(nid, `participants[${i}]`);
      put(m, 'who', p.who);
      put(m, 'role', p.role);
    });
    const effects = spec.effects ?? [];
    put(nid, 'effects#count', effects.length);
    effects.forEach((e, i) => {
      const m = k.address(nid, `effects[${i}]`);
      put(m, 'on', e.on);
      put(m, 'effect', e.effect);
    });
    const witnesses = spec.witnesses ?? [];
    put(nid, 'witnesses#count', witnesses.length);
    witnesses.forEach((w, i) => put(nid, `witnesses[${i}]`, w));
    const causes = spec.causes ?? [];
    put(nid, 'causes#count', causes.length);
    causes.forEach((c, i) => put(nid, `causes[${i}]`, c));
    if (spec.outcome !== undefined) put(nid, 'outcome', spec.outcome);
    if (spec.served !== undefined) put(nid, 'served', spec.served);
    if (!provenance && spec.place !== undefined && k.store.header(spec.place)) {
      k.addEdge({ type: 'core:located-in', from: nid, to: spec.place, cause: nid, valid: { from: spec.time }, silent: true });
    }
    if (untouched && !provenance) this.minted.set(nid, { kind: spec.kind, time: spec.time, local: k.store.localState(nid) });
    else this.minted.delete(nid);
    k.bump();
    if (have || quiet) return nid;
    const ch: Parameters<Kernel['emit']>[0] = {
      c: 'event', event: nid, kind: spec.kind,
      participants: participants.map((p) => ({ who: p.who, role: p.role })),
      effects: effects.map((e) => ({ on: e.on, effect: e.effect })),
    };
    if (spec.place !== undefined) ch.place = spec.place;
    k.emit(ch, spec.time);
    return nid;
  }

  /**
   * Publish a materialised summary item once, as one `event` change (S0 9.3, V4-47). An opened item carries its fields as
   * silent contributions; this is the one semantic announcement of it, so a reader that hears events hears the item. A second
   * call for the same item in a session does nothing (the layer that publishes keeps its own persisted record, which is what
   * makes a reload quiet), and regeneration never calls it. Returns whether a change was emitted.
   */
  publishItem(item: Id): boolean {
    const k = this.k;
    k.assertWritable();
    const h = k.store.header(item);
    if (!h || h.origin.by !== 'minted' || h.origin.creator !== h.origin.cause || !/^item:\d+$/.test(h.origin.name)) {
      throw new Error(`not a summary item: ${item}`);
    }
    if (this.published.has(item)) return false;
    const t = k.now;
    const kind = k.value(item, 'kind', t);
    const time = k.value(item, 'time', t);
    if (typeof kind !== 'string' || typeof time !== 'number') throw new Error(`the item has no kind or time yet: ${item}`);
    const place = k.value(item, 'place', t);
    const count = (key: 'participants' | 'effects'): number => {
      const c = k.value(item, `${key}#count`, t);
      return typeof c === 'number' ? c : 0;
    };
    const participants: Array<{ who: Id; role: string }> = [];
    for (let n = 0; n < count('participants'); n++) {
      const m = k.address(item, `participants[${n}]`);
      const who = k.value(m, 'who', t);
      const role = k.value(m, 'role', t);
      if (typeof who === 'string' && typeof role === 'string') participants.push({ who, role });
    }
    const effects: Array<{ on: Id; effect: Effect }> = [];
    for (let n = 0; n < count('effects'); n++) {
      const m = k.address(item, `effects[${n}]`);
      const on = k.value(m, 'on', t);
      const effect = k.value(m, 'effect', t);
      if (typeof on === 'string' && typeof effect === 'string') effects.push({ on, effect: effect as Effect });
    }
    this.published.add(item);
    k.bump();
    const ch: Parameters<Kernel['emit']>[0] = { c: 'event', event: item, kind, participants, effects };
    if (typeof place === 'string') ch.place = place;
    k.emit(ch, time);
    return true;
  }

  // ---- canon ----

  /** The pin targets of a field, as (node, slot) pairs. Counts come first. */
  private fieldTargets(event: Id, field: EventField): Array<{ node: Id; slot: SlotPath }> {
    const k = this.k;
    const t = this.k.now;
    const out: Array<{ node: Id; slot: SlotPath }> = [];
    const many = (key: 'participants' | 'effects' | 'witnesses' | 'causes', sub: string[]): void => {
      out.push({ node: event, slot: `${key}#count` });
      const count = k.resolve(event, `${key}#count`, t).value;
      if (typeof count !== 'number') return;
      for (let i = 0; i < count; i++) {
        if (sub.length === 0) out.push({ node: event, slot: `${key}[${i}]` });
        else {
          const m = k.address(event, `${key}[${i}]`);
          for (const s of sub) out.push({ node: m, slot: s });
        }
      }
    };
    switch (field) {
      case 'time':
      case 'place':
      case 'kind':
      case 'outcome':
      case 'served':
        out.push({ node: event, slot: field });
        break;
      case 'participants':
        many('participants', ['who', 'role']);
        break;
      case 'effects':
        many('effects', ['on', 'effect']);
        break;
      case 'witnesses':
        many('witnesses', []);
        break;
      case 'causes':
        many('causes', []);
        break;
    }
    return out;
  }

  /**
   * Make an event canon: pin the named fields with the current resolved values (spec 9.2). `observed`
   * (V saw it) pins at 600 with the event as evidence; `committed` (a seed, or an effect that depends on
   * it) pins at 300. The pins are written silently: the event change already announced the event.
   */
  makeCanon(event: Id, reason: 'observed' | 'committed', cause: Id, fields?: readonly EventField[]): Id[] {
    const k = this.k;
    k.assertWritable();
    fields ??= this.defaultFields(event);
    const h = k.store.header(event);
    if (!h || !k.schema.isKind(h.kind, 'core:event')) throw new Error(`not an event: ${event}`);
    const pins: Id[] = [];
    for (const field of fields) {
      for (const tg of this.fieldTargets(event, field)) {
        const r = k.resolve(tg.node, tg.slot, k.now);
        if (r.value === undefined || (r.status !== 'ok' && r.status !== 'contradiction')) continue;
        const spec: Parameters<Kernel['pin']>[0] = { node: tg.node, slot: tg.slot, value: r.value, reason, cause, silent: true };
        if (reason === 'observed') spec.evidence = event;
        pins.push(k.pin(spec).id);
      }
    }
    const entries = this.canonRecords.get(event) ?? [];
    entries.push({ reason, fields: [...fields], pins });
    this.canonRecords.set(event, entries);
    k.bump();
    return pins;
  }

  /** Every field the event has: the seven of spec 9.2, and `outcome` and `served` when the event carries them (v4). */
  defaultFields(event: Id): EventField[] {
    const out: EventField[] = [...EVENT_FIELDS];
    const h = this.k.store.header(event);
    if (h && this.k.schema.slotInfo(h.kind, 'outcome')) {
      for (const f of ['outcome', 'served'] as const) {
        if (this.k.resolve(event, f, this.k.now).status === 'ok') out.push(f);
      }
    }
    return out;
  }

  isCanon(event: Id): boolean {
    return this.canonRecords.has(event);
  }

  canonEvents(): Id[] {
    return [...this.canonRecords.keys()].sort();
  }

  canonRecord(event: Id): EventCanonRecord | undefined {
    const e = this.canonRecords.get(event);
    return e ? { event, entries: e.map((x) => ({ ...x, fields: [...x.fields], pins: [...x.pins] })) } : undefined;
  }

  setCanonRecord(rec: EventCanonRecord): void {
    this.canonRecords.set(rec.event, rec.entries.map((x) => ({ ...x, fields: [...x.fields], pins: [...x.pins] })));
  }

  /** Replacement clears canon and materialisation records, session publications and the minting cache (S0 14.3). */
  clear(): void {
    this.canonRecords.clear();
    this.materialisations.clear();
    this.minted.clear();
    this.published.clear();
  }

  /** The records and session publications a staged batch can discard (S0 14.2a). */
  capture(): unknown {
    return structuredClone({ canon: this.canonRecords, published: this.published, materialisations: this.materialisations });
  }

  restoreFrom(cap: unknown): void {
    const c = structuredClone(cap) as { canon: Map<Id, CanonEntry[]>; published: Set<Id>; materialisations: Map<Id, EventProvenance> };
    this.canonRecords = c.canon;
    this.materialisations = c.materialisations;
    this.published.clear();
    for (const id of c.published) this.published.add(id);
    // events minted in the discarded stage are gone from the store: the cache of what they were minted with goes too
    this.minted.clear();
  }

  /** Known events whose `time` resolves to exactly `t` (used by `knows`, SPEC-NOTES 21). */
  eventsAtTime(t: GameTime): Id[] {
    const out: Id[] = [];
    for (const kindId of this.k.schema.kindsOf('core:event')) {
      for (const id of this.k.store.idsOfKind(kindId)) {
        if (this.k.value(id, 'time', t) === t) out.push(id);
      }
    }
    return out.sort();
  }
}
