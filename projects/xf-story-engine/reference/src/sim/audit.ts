// The honesty audits (S1 12): static checks over S1's registry, its declared read sets, its schema, its packs and its source. Each audit
// is a pure function of the structure it checks, so a test can hand it a faulty structure and see exactly the fault reported. Zero
// findings is the pass. They report to P9 and run at every build.
//
// The source lint in source-audit.ts walks TypeScript compiler ASTs: executable template expressions remain executable, and a literal's
// contents cannot masquerade as code. Each event policy's first rejecting conditional is checked as a guard.

import type { ProcessOp } from '../evolution.ts';
import type { SchemaDefs } from '../schema-types.ts';
import { Schema, SchemaError } from '../schema.ts';
import type { Registry } from '../registry.ts';
import type { Config } from '../config.ts';
import type { KindDef1 } from './kinds.ts';
import type { S1Read } from './reads.ts';
import type { Sim } from './sim.ts';

export interface Finding {
  audit: string;
  where: string;
  detail: string;
}

export interface SourceFile {
  /** The file's base name, e.g. `proc-events.ts`. */
  path: string;
  text: string;
}

export { codeOf, lintSources, COARSE_FILES, MARK_OPEN, MARK_CLOSE, type StringMode } from './source-audit.ts';

// ---- the registry audits ----

/** V-exclusion over the kinds (S1 12): no kind casts V, and none gives V a victim or target role. */
export function auditKinds(kinds: Iterable<KindDef1>): Finding[] {
  const out: Finding[] = [];
  for (const k of kinds) {
    for (const r of k.roles) {
      const from = (r.source as { from: string }).from;
      if (from === 'v' || from === 'player') out.push({ audit: 'v-exclusion', where: `kind ${k.name}`, detail: `the role ${r.role} is cast from V` });
    }
    for (const e of k.effects) {
      if (e.role === 'v') out.push({ audit: 'v-exclusion', where: `kind ${k.name}`, detail: `the effect ${e.effect} lands on V` });
    }
  }
  return out;
}

/** The firewall over the declared read sets (S1 12): no registered read depends on the director's model of V, an orientation or a bond. */
export function auditReads(reads: Iterable<S1Read>): Finding[] {
  const out: Finding[] = [];
  const forbidden = /director|orientation|bond/i;
  for (const r of reads) {
    for (const i of r.deps.interests) {
      if (forbidden.test(`${i.kind ?? ''} ${i.slot}`)) out.push({ audit: 'firewall', where: `read ${r.name}`, detail: `depends on ${i.kind ?? '*'} ${i.slot}` });
    }
    for (const d of [...r.deps.digests, ...r.deps.roles]) {
      if (forbidden.test(d)) out.push({ audit: 'firewall', where: `read ${r.name}`, detail: `depends on ${d}` });
    }
  }
  return out;
}

/** The slots a schema's derives, conditioned inputs and `enum-by` read, one line each: the audit "lists every slot a derive reads". */
export function deriveReads(defs: SchemaDefs): string[] {
  const out: string[] = [];
  for (const k of defs.kinds) {
    for (const s of k.slots) {
      for (const inp of s.derive?.inputs ?? []) out.push(`${k.id}.${s.key} <- ${inp}`);
      for (const inp of s.conditioned?.inputs ?? []) out.push(`${k.id}.${s.key} <~ ${inp}`);
      const vt = defs.dims.find((d) => d.id === s.dim)?.value;
      if (vt?.t === 'enum-by') out.push(`${k.id}.${s.key} <= ${vt.by}`);
    }
  }
  return out.sort();
}

/** The schema audits (S1 12): order (the loader refuses a read of a later slot or of an owned value) and the source lint of attributes. */
export function auditSchema(defs: SchemaDefs, registry: Registry, config?: Config): Finding[] {
  const out: Finding[] = [];
  try {
    Schema.load(defs, registry, config);
  } catch (e) {
    if (e instanceof SchemaError) for (const p of e.problems) out.push({ audit: 'schema-order', where: 'schema', detail: p });
    else throw e;
  }
  // S1's own kinds read no heritage, gender or name origin; the kernel's name kind draws names by an origin, which is display and no decision
  const heritage = /heritage|gender|ethnic|nationality|name-origin|nameorigin|origin/i;
  for (const line of deriveReads(defs)) {
    // the pack's own name kind (the wide registry's origin-keyed names) is display like the core's, and nothing reads it
    if (!line.startsWith('core:') && !line.startsWith('xf:name.') && heritage.test(line)) out.push({ audit: 'source-lint', where: 'schema', detail: `a derive reads a forbidden attribute: ${line}` });
  }
  return out;
}

// ---- who writes what ----

/** What a write is called for the one-writer audit (S1-I-7): the kind and slot of a pin, a node family minted, an edge type, a belief path. */
export function writeKeys(sim: Sim, op: ProcessOp): string[] {
  const kindOf = (n: string): string => sim.k.store.header(n)?.kind ?? '?';
  const family = (name: string): string => /^[a-z]+/i.exec(name)?.[0] ?? name;
  switch (op.op) {
    case 'pin':
      return [`pin:${kindOf(op.node)}.${op.slot.replace(/@w\d+$/, '').replace(/^(gap|label)-.*$/, '$1-*')}`];
    case 'contribute':
      return [`contribute:${(op.target.slot ?? '*').replace(/[[#].*$/, '')}`];
    case 'edge':
      return [`edge:${op.type}`];
    case 'end-edge':
      return [`edge:${sim.k.store.edges.get(op.id)?.type ?? '?'}`];
    case 'mint-event':
      return [`mint:${family(op.spec.name)}`];
    case 'mint-summary':
      return [`mint:${family(op.spec.name)}`];
    case 'belief-set':
      return [`belief:${op.belief.path.replace(/\[\d+\]/, '[]')}`];
    case 'belief-drop':
      return ['belief:drop'];
    case 'record':
      return [];
    default:
      return [`op:${op.op}`];
  }
}

/** Record the writes of every process of a sim from now on, by process id. The result fills as the sim runs. */
export function observeWrites(sim: Sim): Record<string, Set<string>> {
  const seen: Record<string, Set<string>> = {};
  for (const [id, def] of sim.defs) {
    const run = def.run.bind(def);
    const set = (seen[id] = new Set());
    def.run = (pctx, k) => {
      const res = run(pctx, k);
      for (const op of Array.isArray(res) ? res : res.ops) for (const key of writeKeys(sim, op)) set.add(key);
      return res;
    };
  }
  return seen;
}

/** The writes each process declares (S1 2.1). The run's observed writes must lie inside them, and no two processes share one. */
export const PROCESS_WRITES: Record<string, string[]> = {
  'city.events': ['mint:ev', 'mint:child', 'mint:sum', 'mint:regime', 'pin:xf:cell.band', 'pin:xf:service.status', 'state:admit', 'state:calendar', 'state:ring', 'state:regimes'],
  'order.stocks': ['state:stocks'],
  'city.mirror': ['mint:mir', 'state:seen'],
  'order.ledger': ['pin:xf:standing.label-*', 'state:labels'],
  'order.norms': ['mint:enf', 'pin:xf:district.gap-*', 'state:slots'],
  'group.decide': ['pin:xf:group.group-gap', 'state:groups'],
  'scene.acts': ['op:publish-item', 'contribute:time', 'contribute:place', 'contribute:kind', 'contribute:participants', 'contribute:effects', 'contribute:witnesses', 'contribute:causes', 'contribute:outcome', 'state:published'],
};

/** The state owned by the admission owner (S1 6, 7.2): only `city.events` changes it, and the gate holds none. */
export const ADMISSION_STATE = ['admit', 'calendar'];
export const ADMISSION_OWNER = 'city.events';

export function auditWriters(declared: Record<string, string[]>, observed?: Record<string, Iterable<string>>): Finding[] {
  const out: Finding[] = [];
  const owner = new Map<string, string>();
  for (const [proc, keys] of Object.entries(declared)) {
    for (const key of keys) {
      const have = owner.get(key);
      if (have !== undefined && have !== proc) out.push({ audit: 'one-writer', where: key, detail: `written by ${have} and ${proc}` });
      else owner.set(key, proc);
      if (proc !== ADMISSION_OWNER && key.startsWith('state:') && ADMISSION_STATE.includes(key.slice(6).split('.')[0]!)) {
        out.push({ audit: 'one-writer', where: key, detail: `${proc} writes admission state, which only ${ADMISSION_OWNER} owns` });
      }
    }
  }
  for (const [proc, keys] of Object.entries(observed ?? {})) {
    const allowed = new Set(declared[proc] ?? []);
    for (const key of keys) if (!allowed.has(key)) out.push({ audit: 'one-writer', where: key, detail: `${proc} wrote what it does not declare` });
  }
  return out;
}

/** The gate holds no budget and no counter (S1 6): its own fields are the world, the people and the set of persons marked real. */
export function auditGate(gate: object): Finding[] {
  const allowed = new Set(['w', 'people', 'real']);
  return Object.keys(gate).filter((k) => !allowed.has(k)).map((k) => ({ audit: 'one-writer', where: 'gate', detail: `the gate holds the field ${k}` }));
}

/** The feed cursors each consumer keeps in its state (S1 2.2, S1-I-26). */
export const FEED_CURSORS: Record<string, string[]> = {
  'group.decide': ['cursors.events', 'cursors.mirror'],
  'order.stocks': ['cursors.events', 'cursors.norms'],
};

/** Every declared cursor lies in the process's state, as a number. */
export function auditCursors(sim: Sim, declared: Record<string, string[]> = FEED_CURSORS): Finding[] {
  const out: Finding[] = [];
  for (const [proc, paths] of Object.entries(declared)) {
    const st = sim.stateOf<Record<string, unknown>>(proc);
    for (const path of paths) {
      let cur: unknown = st;
      for (const seg of path.split('.')) cur = typeof cur === 'object' && cur !== null ? (cur as Record<string, unknown>)[seg] : undefined;
      if (typeof cur !== 'number') out.push({ audit: 'feeds', where: `${proc}.${path}`, detail: 'a feed is read with no cursor in the reader\'s state' });
    }
  }
  return out;
}

// ---- the representation audit ----

/** Who is cast in the roles of harm, by every tag (S1 12): counts of the persons named, for dossier 18 to set thresholds from data. */
export interface Representation {
  roles: Record<string, { total: number; byTag: Record<string, Record<string, number>> }>;
}

export function tabulate(sim: Sim, casts: Array<Array<{ role: string; who?: string }>>): Representation {
  const out: Representation = { roles: {} };
  for (const cast of casts) {
    for (const e of cast) {
      if (e.who === undefined) continue;
      const v = sim.people.view(e.who);
      if (!v) continue;
      const r = (out.roles[e.role] ??= { total: 0, byTag: {} });
      r.total++;
      const add = (tag: string, value: string | number): void => {
        const t = (r.byTag[tag] ??= {});
        t[String(value)] = (t[String(value)] ?? 0) + 1;
      };
      add('occupation', v.role);
      add('age-band', v.aband);
      add('affiliation-class', v.affc);
      add('archetype', v.archetype);
      add('district', sim.w.cell(v.cell).district);
    }
  }
  return out;
}
