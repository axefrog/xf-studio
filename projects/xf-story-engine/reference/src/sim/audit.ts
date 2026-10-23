// The honesty audits (S1 12): static checks over S1's registry, its declared read sets, its schema, its packs and its source. Each audit
// is a pure function of the structure it checks, so a test can hand it a faulty structure and see exactly the fault reported. Zero
// findings is the pass. They report to P9 and run at every build.
//
// The source lint reads the text of the model's own files with comments removed. Most rules read it with the contents of strings blanked, so
// a word in a message is not a finding; the rules that must see a string (a slot named by a literal) read it with the strings kept. The files
// it is given are the decision code of S1 (everything in `src/sim/` except the table generator, the game-side port and this file).

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

// ---- source text without comments and strings ----

/** How the contents of a string or template literal are read: dropped (`blank`), kept as they are (`keep`), or kept between two marks (`mark`). */
export type StringMode = 'blank' | 'keep' | 'mark';
/** The marks around a literal's contents in `mark` mode: characters that never occur in source, so a quote inside a string cannot pass for the start of one. */
export const MARK_OPEN = '\u0001';
export const MARK_CLOSE = '\u0002';

/**
 * The code of a TypeScript file: comments removed and, unless the strings are kept, the contents of string and template literals blanked,
 * line structure kept. The expressions inside a template literal (`${...}`) are code, whatever the mode: they are read like the rest.
 */
export function codeOf(text: string, strings: boolean | StringMode = 'blank'): string {
  const mode: StringMode = strings === true ? 'keep' : strings === false ? 'blank' : strings;
  return scan(text, 0, mode, false).out;
}

/** One level of the scan: the whole text, or (inside `${`) up to the brace that closes the expression. */
function scan(text: string, from: number, mode: StringMode, inExpression: boolean): { out: string; end: number } {
  let out = '';
  let i = from;
  let depth = 0;
  const n = text.length;
  /** A literal's own character: kept in `keep` and `mark`; in `blank` only the line breaks stay. */
  const literalChar = (ch: string): void => {
    if (mode !== 'blank') out += ch;
    else if (ch === '\n') out += '\n';
  };
  while (i < n) {
    const c = text[i]!;
    const d = text[i + 1];
    if (inExpression) {
      if (c === '{') depth++;
      else if (c === '}') {
        if (depth === 0) return { out, end: i };
        depth--;
      }
    }
    if (c === '/' && d === '/') {
      while (i < n && text[i] !== '\n') i++;
    } else if (c === '/' && d === '*') {
      i += 2;
      while (i < n && !(text[i] === '*' && text[i + 1] === '/')) {
        if (text[i] === '\n') out += '\n';
        i++;
      }
      i += 2;
    } else if (c === '"' || c === "'") {
      out += c;
      if (mode === 'mark') out += MARK_OPEN;
      i++;
      while (i < n && text[i] !== c) {
        if (text[i] === '\\') {
          if (mode !== 'blank') out += text[i]!;
          i++;
        }
        if (i < n) literalChar(text[i]!);
        i++;
      }
      if (mode === 'mark') out += MARK_CLOSE;
      out += c;
      i++;
    } else if (c === '`') {
      out += c;
      if (mode === 'mark') out += MARK_OPEN;
      i++;
      while (i < n && text[i] !== '`') {
        if (text[i] === '$' && text[i + 1] === '{') {
          // the expression is code
          if (mode === 'mark') out += MARK_CLOSE;
          out += '${';
          const inner = scan(text, i + 2, mode, true);
          out += inner.out + '}';
          i = inner.end + 1;
          if (mode === 'mark') out += MARK_OPEN;
          continue;
        }
        if (text[i] === '\\') {
          if (mode !== 'blank') out += text[i]!;
          i++;
        }
        if (i < n) literalChar(text[i]!);
        i++;
      }
      if (mode === 'mark') out += MARK_CLOSE;
      out += c;
      i++;
    } else {
      out += c;
      i++;
    }
  }
  return { out, end: n };
}

const lineOf = (code: string, index: number): number => {
  let line = 1;
  for (let i = 0; i < index; i++) if (code[i] === '\n') line++;
  return line;
};

// ---- the source lint ----

/** Files with their own rules: the table generator (it builds the frozen tables), the game-side port, and the generator of the stand-in slice. */
const EXEMPT: Record<string, string[]> = {
  'make-tables.ts': ['arithmetic', 'keys', 'no-load-reads'],
  'port.ts': ['no-load-reads'],
  'slices.ts': ['keys'],
  'audit.ts': ['arithmetic', 'keys', 'no-load-reads', 'coarse-independence', 'firewall', 'source-lint', 'forbidden-policy', 'v-exclusion', 'feeds'],
};

/** The tier 0 to 2 processes: they read neither the game's ownership, V's cell or position, nor demand (S1-I-5). */
export const COARSE_FILES = ['proc-events.ts', 'proc-stocks.ts', 'proc-mirror.ts', 'proc-norms.ts', 'proc-groups.ts', 'ledger.ts'];

const RULES: Array<{ audit: string; re: RegExp; only?: string[]; /** Read the text with its strings kept: the rule needs a literal. */ literal?: true; detail: (m: string) => string }> = [
  { audit: 'arithmetic', re: /\bMath\.(exp|expm1|pow|log|log1p|log2|log10|sinh|cosh|tanh|asinh|acosh|atanh|cbrt|hypot)\s*\(/g, detail: (m) => `${m.replace(/\s*\($/, '')} in a decision; only the functions of S1 1.2 may be used` },
  { audit: 'arithmetic', re: /\b(gamma|lgamma|fma)\s*\(/g, detail: (m) => `${m.replace(/\s*\($/, '')}: a gamma function or a fused multiply-add` },
  { audit: 'arithmetic', re: /[A-Za-z_)\]][\w)\]]*\s*\*\*\s*[\w(]|\d\s*\*\*\s*[A-Za-z_(]/g, detail: () => 'the ** operator (a power) in a decision' },
  { audit: 'no-load-reads', re: /\b(epoch|loadCount|loadClass|playClock|playTotal|wallClock|hrtime)\b|\bDate\.now\b|\bnew Date\b|\bperformance\.now\b|\bMath\.random\b/g, detail: (m) => `${m}: the epoch, a load, the play clock, the wall clock or a random source` },
  { audit: 'keys', re: /(?<![.\w])(rand|procRand)\s*\(|\bpctx\.(rand|procRand)\s*\(|(?<![\w.])pr\s*\(/g, detail: (m) => `${m.replace(/\s*\($/, '')} called outside the key registry` },
  { audit: 'coarse-independence', re: /\b(gameOwnedNow|demanded|demandTier|demandRoots|vFrames|demandLookback)\b/g, only: COARSE_FILES, detail: (m) => `${m} read by a process of tier 0 to 2` },
  // V's cell and position: no slot of that name in a coarse file, and V's mirrored state is read only for its district and its wanted level (SIM audit round 1)
  { audit: 'coarse-independence', re: /['"`](cell|position)['"`]/g, literal: true, only: COARSE_FILES, detail: (m) => `${m}: V's cell or position named by a process of tier 0 to 2` },
  { audit: 'coarse-independence', re: /\bvState\b(?!\s*,\s*['"`](district|wanted)['"`])/g, literal: true, only: COARSE_FILES, detail: () => "V's mirrored state used other than to read its district or its wanted level, in a process of tier 0 to 2" },
  { audit: 'firewall', re: /\b(director|orientation|bond)\b/gi, detail: (m) => `${m}: the director's beliefs about V, an orientation or a bond are outside S1's read sets` },
  { audit: 'source-lint', re: /\b(heritage|gender|ethnic\w*|nationality|nameOrigin)\b/gi, detail: (m) => `${m}: an attribute that never feeds a decision` },
  { audit: 'forbidden-policy', re: /\b(guilt\w*|streak\w*|nsfw|explicit)\b/gi, detail: (m) => `${m}: a forbidden mechanic` },
  { audit: 'v-exclusion', re: /\b(pin|reading)\s*\(\s*\{\s*node:\s*(this\.)?(sim\.)?(w\.)?v\b/g, detail: () => 'a write on V' },
  { audit: 'v-exclusion', re: /\bop:\s*'pin'\s*,\s*node:\s*(sim\.)?(w\.)?v\b/g, detail: () => 'a pin on V' },
  { audit: 'feeds', re: /\bfeedAfter\s*\(\s*[^,()]+,(?!\s*\w+\.cursors\.\w+\s*\))[^)]*\)/g, detail: () => 'a feed read with no cursor in the reader\'s state' },
];

export function lintSources(files: SourceFile[]): Finding[] {
  const out: Finding[] = [];
  for (const f of files) {
    const code = codeOf(f.text);
    const literal = codeOf(f.text, true);
    const exempt = EXEMPT[f.path] ?? [];
    for (const rule of RULES) {
      if (exempt.includes(rule.audit)) continue;
      if (rule.only && !rule.only.includes(f.path)) continue;
      if (rule.audit === 'keys' && f.path === 'keys.ts') continue;
      const text = rule.literal ? literal : code;
      rule.re.lastIndex = 0;
      for (let m = rule.re.exec(text); m !== null; m = rule.re.exec(text)) {
        out.push({ audit: rule.audit, where: `${f.path}:${lineOf(text, m.index)}`, detail: rule.detail(m[0].trim()) });
        if (m[0].length === 0) rule.re.lastIndex++;
      }
    }
  }
  // the policies that hear events ignore the director's kinds
  const policies = files.find((f) => f.path === 'policies.ts');
  // the guards are code: a string that merely contains the call does not count, so the literal is read between the marks
  if (policies && (codeOf(policies.text, 'mark').match(new RegExp(`startsWith\\(\\s*['"\`]${MARK_OPEN}meta:${MARK_CLOSE}['"\`]\\s*\\)`, 'g')) ?? []).length < 2) {
    out.push({ audit: 'meta-inert', where: 'policies.ts', detail: 'the policies do not ignore every meta: kind (witness and absorb)' });
  }
  // a decision that reads beliefs reads memorable ones: every read of a believer's beliefs tests it within a few lines
  for (const f of files) {
    if (EXEMPT[f.path]) continue;
    const code = codeOf(f.text);
    const lines = code.split('\n');
    for (let i = 0; i < lines.length; i++) {
      if (!/\.activeOf\(/.test(lines[i]!)) continue;
      if (!/\bmemorable\b/.test(lines.slice(i, i + MEMORABLE_REACH).join('\n'))) {
        out.push({ audit: 'forbidden-policy', where: `${f.path}:${i + 1}`, detail: 'reads beliefs and does not test whether they are memorable' });
      }
    }
  }
  return out;
}

/** How many lines after a read of a believer's beliefs the test for `memorable` may come. */
const MEMORABLE_REACH = 3;

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
    if (!line.startsWith('core:') && heritage.test(line)) out.push({ audit: 'source-lint', where: 'schema', detail: `a derive reads a forbidden attribute: ${line}` });
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
