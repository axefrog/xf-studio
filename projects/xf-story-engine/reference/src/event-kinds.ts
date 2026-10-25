// The event-kind registry (S0 10.5, v4.8; v4.17, V4-50 and V4-51): the kinds a pack registers, with their tags and producers, the
// participant roles their events use, the story functions they fill (`fills`) and, for a `meta:` kind, the declared fields of its
// `data` record (`dataFields`).
//
// The kernel stores `fills` and returns it with the entry; no kernel decision reads it. At registration it checks the form only: every
// role a fill or condition names is in `roles` (when `roles` is given) or is `@place` or `@self`, and every `outcome` value is one of
// S0 9.2's. Whether a function name belongs to the loaded vocabulary is the loader's check (S4) and layer 3's.

import type { Value } from './types.ts';

export type EventOutcome = 'done' | 'failed' | 'prevented';
export const EVENT_OUTCOMES: readonly EventOutcome[] = ['done', 'failed', 'prevented'];

export interface FillDecl {
  fn: string;
  args: Record<string, string>;
  when?: {
    outcome?: EventOutcome[];
    has?: string[];
    lacks?: string[];
    stance?: string[];
    state?: { fn: string; args: Record<string, string> };
  };
}

/** The type of one field of a `meta:` event's data record (S0 9.2): `enum`, `int`, `text` or `ref`. */
export type DataFieldType = { t: 'enum'; values: string[] } | { t: 'int' } | { t: 'text' } | { t: 'ref' };

export interface EventKindEntry {
  name: string;
  tags: string[];
  producers: string[];
  roles?: string[];
  fills?: FillDecl[];
  /** Only on a `meta:` kind. */
  dataFields?: Record<string, DataFieldType>;
}

const isId = (v: unknown): boolean => typeof v === 'string' && /^[0-9a-f]{32}$/.test(v);

export class EventKinds {
  private entries = new Map<string, EventKindEntry>();

  /** Register a kind. A refused registration throws and registers nothing. Registering the same name again replaces nothing and throws. */
  register(entry: Omit<EventKindEntry, 'tags' | 'producers'> & { tags?: string[]; producers?: string[] }): void {
    if (this.entries.has(entry.name)) throw new Error(`event kind already registered: ${entry.name}`);
    if (entry.dataFields !== undefined && !entry.name.startsWith('meta:')) throw new Error(`only a meta: kind declares data fields: ${entry.name}`);
    const roles = entry.roles;
    const check = (what: string, role: string): void => {
      if (role === '@place' || role === '@self') return;
      if (roles !== undefined && !roles.includes(role)) throw new Error(`${entry.name}: ${what} names the role ${role}, which the kind does not list`);
    };
    for (const f of entry.fills ?? []) {
      for (const [arg, spec] of Object.entries(f.args)) for (const r of spec.split('|')) check(`fill ${f.fn} argument ${arg}`, r);
      const w = f.when;
      if (!w) continue;
      for (const o of w.outcome ?? []) if (!EVENT_OUTCOMES.includes(o)) throw new Error(`${entry.name}: fill ${f.fn} names the outcome ${String(o)}, which no event has`);
      for (const r of [...(w.has ?? []), ...(w.lacks ?? [])]) check(`fill ${f.fn} condition`, r);
      if (w.state) for (const [arg, spec] of Object.entries(w.state.args)) for (const r of spec.split('|')) check(`fill ${f.fn} state ${w.state.fn} argument ${arg}`, r);
    }
    const stored: EventKindEntry = { name: entry.name, tags: [...(entry.tags ?? [])], producers: [...(entry.producers ?? [])] };
    if (entry.roles !== undefined) stored.roles = [...entry.roles];
    if (entry.fills !== undefined) stored.fills = structuredClone(entry.fills);
    if (entry.dataFields !== undefined) stored.dataFields = structuredClone(entry.dataFields);
    this.entries.set(entry.name, stored);
  }

  /** The entry, as a copy. */
  eventKind(name: string): EventKindEntry | undefined {
    const e = this.entries.get(name);
    return e && structuredClone(e);
  }

  names(): string[] {
    return [...this.entries.keys()].sort();
  }

  /** The reason a `data` record is refused for an event of `kind`, or undefined when it is allowed (S0 9.2). Absent data on a kind with declared fields is not allowed either. */
  dataProblem(kind: string, data: Record<string, Value> | undefined): string | undefined {
    if (data === undefined) {
      const declared = this.entries.get(kind)?.dataFields;
      return declared !== undefined && Object.keys(declared).length > 0 ? `${kind} needs its data record` : undefined;
    }
    if (!kind.startsWith('meta:')) return `only a meta: kind carries data, not ${kind}`;
    const fields = this.entries.get(kind)?.dataFields;
    if (fields === undefined) return `${kind} declares no data fields`;
    for (const key of Object.keys(data)) if (!(key in fields)) return `${kind} declares no data field ${key}`;
    for (const [key, type] of Object.entries(fields)) {
      const v = data[key];
      if (v === undefined) return `${kind}: data field ${key} is missing`;
      if (type.t === 'int' ? !(typeof v === 'number' && Number.isInteger(v)) : typeof v !== 'string') return `${kind}: data field ${key} is not of type ${type.t}`;
      if (type.t === 'enum' && !type.values.includes(v as string)) return `${kind}: data field ${key} is not one of ${type.values.join(', ')}`;
      if (type.t === 'ref' && !isId(v)) return `${kind}: data field ${key} is not an Id`;
    }
    return undefined;
  }
}

/** Canonical encoding of a data record (S0 9.2): its keys in sorted order, each followed by its value's canonical encoding. */
export function encodeData(data: Record<string, Value>): string {
  return JSON.stringify(Object.keys(data).sort().map((k) => [k, data[k]]));
}

export function decodeData(text: string): Record<string, Value> | undefined {
  try {
    const arr = JSON.parse(text) as Array<[string, Value]>;
    return Object.fromEntries(arr);
  } catch {
    return undefined;
  }
}
