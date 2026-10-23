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

  constructor(private readonly k: Kernel) {}

  /**
   * Mint an event. Adds its fields as simulation contributions, a `core:located-in` edge to its place,
   * and emits one `event` change (not also `minted`, `contribution` or `edge`: SPEC-NOTES 30).
   * Minting the same (creator, cause, name) again returns the same node and does nothing.
   */
  mintEvent(spec: EventSpec): Id {
    const k = this.k;
    k.assertWritable();
    const nid = H(hs('mint'), hid(spec.creator), hid(spec.cause), hs(spec.name));
    if (k.store.header(nid)) return nid;
    k.mintSilent(spec.creator, spec.cause, spec.name, 'core:event');
    const put = (node: Id, slot: SlotPath, value: Value): void => {
      k.contribute({
        source: { layer: 'simulation', origin: nid },
        target: { slot, scope: { nodes: [node] } },
        form: { f: 'const', value },
        mode: 'constrain',
        silent: true,
      });
    };
    put(nid, 'time', spec.time);
    put(nid, 'kind', spec.kind);
    if (spec.place !== undefined) put(nid, 'place', spec.place);
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
    if (spec.place !== undefined && k.store.header(spec.place)) {
      k.addEdge({ type: 'core:located-in', from: nid, to: spec.place, cause: nid, valid: { from: spec.time }, silent: true });
    }
    k.bump();
    const ch: Parameters<Kernel['emit']>[0] = {
      c: 'event', event: nid, kind: spec.kind,
      participants: participants.map((p) => ({ who: p.who, role: p.role })),
      effects: effects.map((e) => ({ on: e.on, effect: e.effect })),
    };
    if (spec.place !== undefined) ch.place = spec.place;
    k.emit(ch);
    return nid;
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

  clear(): void {
    this.canonRecords.clear();
  }

  capture(): unknown {
    return structuredClone(this.canonRecords);
  }

  restoreFrom(cap: unknown): void {
    this.canonRecords = structuredClone(cap) as Map<Id, CanonEntry[]>;
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
