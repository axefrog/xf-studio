// Predicates (S2 section 2.6): the tree, its text form, the Kleene combinators, and a visitor.
//
// The text form prints to and parses from `Pred` one to one. The grammar is the one in section 2.6, with the
// small extensions the page leaves open (SPEC-NOTES): `all(...)` and `any(...)` for an empty or one-member
// group, a role predicate's other operators (`in {..}`, `not in {..}`, `in [a, b]`, `has-edge(..)`), `@role` for
// a role named as an argument, durations as `<seconds>g` (game) or `<seconds>p` (play), and generic `{key: value}`
// patterns.

import type { Pred, RolePredicate, Cmp, Verdict } from './types.ts';

// ---- Kleene (strong three-valued logic) ----

export const kAll = (vs: Verdict[]): Verdict => {
  let maybe = false;
  for (const v of vs) {
    if (v === 'no') return 'no';
    if (v === 'maybe') maybe = true;
  }
  return maybe ? 'maybe' : 'yes';
};
export const kAny = (vs: Verdict[]): Verdict => {
  let maybe = false;
  for (const v of vs) {
    if (v === 'yes') return 'yes';
    if (v === 'maybe') maybe = true;
  }
  return maybe ? 'maybe' : 'no';
};
export const kNot = (v: Verdict): Verdict => (v === 'yes' ? 'no' : v === 'no' ? 'yes' : 'maybe');
export const verdictOf = (b: boolean): Verdict => (b ? 'yes' : 'no');

export function compare(a: number, op: Cmp, b: number): boolean {
  switch (op) {
    case 'eq': return a === b;
    case 'ne': return a !== b;
    case 'lt': return a < b;
    case 'le': return a <= b;
    case 'gt': return a > b;
    case 'ge': return a >= b;
  }
}

// ---- structure ----

/** The immediate sub-predicates of a node. */
export function children(p: Pred): Pred[] {
  if (typeof p === 'string') return [];
  if ('all' in p) return p.all;
  if ('any' in p) return p.any;
  if ('not' in p) return [p.not];
  return [];
}

export function walkPred(p: Pred, fn: (p: Pred, path: string) => void, path = ''): void {
  fn(p, path);
  if (typeof p === 'string') return;
  if ('all' in p) p.all.forEach((c, i) => walkPred(c, fn, `${path}.all[${i}]`));
  else if ('any' in p) p.any.forEach((c, i) => walkPred(c, fn, `${path}.any[${i}]`));
  else if ('not' in p) walkPred(p.not, fn, `${path}.not`);
}

// ---- printing ----

const IDENT = /^[A-Za-z_][A-Za-z0-9_\-:.\/]*$/;
const CMP_SYM: Record<Cmp, string> = { eq: '==', ne: '!=', lt: '<', le: '<=', gt: '>', ge: '>=' };
const SYM_CMP: Record<string, Cmp> = { '==': 'eq', '!=': 'ne', '<': 'lt', '<=': 'le', '>': 'gt', '>=': 'ge' };

const isDuration = (x: unknown): x is { clock: 'game' | 'play'; s: number } =>
  typeof x === 'object' && x !== null && !Array.isArray(x) && 'clock' in x && 's' in x && Object.keys(x).length === 2 &&
  ((x as { clock: unknown }).clock === 'game' || (x as { clock: unknown }).clock === 'play') && typeof (x as { s: unknown }).s === 'number';

function printValue(v: unknown): string {
  if (typeof v === 'number') return String(v);
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  if (typeof v === 'string') return IDENT.test(v) && v !== 'true' && v !== 'false' ? v : JSON.stringify(v);
  if (isDuration(v)) return `${v.s}${v.clock === 'game' ? 'g' : 'p'}`;
  if (Array.isArray(v)) return `[${v.map(printValue).join(', ')}]`;
  if (typeof v === 'object' && v !== null) {
    const e = Object.entries(v as Record<string, unknown>).filter(([, x]) => x !== undefined);
    return `{${e.map(([k, x]) => `${k}: ${printValue(x)}`).join(', ')}}`;
  }
  throw new Error(`cannot print ${String(v)}`);
}

const printSet = (xs: string[]): string => `{${xs.map(printValue).join(', ')}}`;

function printRolePredicate(role: string, p: RolePredicate): string {
  const arg = (a: unknown): string =>
    typeof a === 'object' && a !== null && !Array.isArray(a) && 'role' in a && Object.keys(a).length === 1 ? `@${(a as { role: string }).role}` : printValue(a);
  const head = `${role}.${p.path}`;
  switch (p.op) {
    case 'eq': return `${head} == ${arg(p.arg)}`;
    case 'field-at-least': return `${head} >= ${arg(p.arg)}`;
    case 'field-at-most': return `${head} <= ${arg(p.arg)}`;
    case 'in': case 'not-in': {
      const a = p.arg;
      const kw = p.op === 'in' ? 'in' : 'not in';
      if (Array.isArray(a)) return `${head} ${kw} {${a.map(arg).join(', ')}}`;
      if (typeof a === 'object' && a !== null && 'r' in a) return `${head} ${kw} ${printValue(a)}`;
      return `${head} ${kw} {${arg(a)}}`;
    }
    case 'range': return `${head} in range ${printValue(p.arg)}`;
    case 'has-edge': case 'lacks-edge': {
      const a = p.arg as { edge: string; to?: unknown };
      const to = a.to === undefined ? '' : `, ${arg(a.to)}`;
      return `${head === `${role}.` ? role : head} ${p.op}(${a.edge}${to})`;
    }
  }
}

function printPatternArg(pat: unknown): string {
  return printValue(pat);
}

export function printPred(p: Pred): string {
  const group = (c: Pred, ctx: 'and' | 'or' | 'not'): string => {
    const s = printPred(c);
    if (typeof c === 'string') return s;
    if ('all' in c && c.all.length >= 2) return ctx === 'and' || ctx === 'not' ? `(${s})` : s;
    if ('any' in c && c.any.length >= 2) return `(${s})`;
    return s;
  };
  if (p === 'yes' || p === 'no') return p;
  if ('all' in p) return p.all.length >= 2 ? p.all.map((c) => group(c, 'and')).join(' and ') : `all(${p.all.map(printPred).join(', ')})`;
  if ('any' in p) return p.any.length >= 2 ? p.any.map((c) => group(c, 'or')).join(' or ') : `any(${p.any.map(printPred).join(', ')})`;
  if ('not' in p) return `not ${group(p.not, 'not')}`;
  if ('fact' in p) return `${p.fact} ${CMP_SYM[p.op]} ${p.value}`;
  if ('seedFact' in p) return `seedFact(${p.seedFact}) ${CMP_SYM[p.op]} ${p.value}`;
  if ('decided' in p) return `decided(${p.decided})`;
  if ('role' in p) return printRolePredicate(p.role, p.p);
  if ('cast' in p) return `cast(${p.cast})`;
  if ('seed' in p) return `seed(${printValue(p.seed)}) in ${printSet(p.state)}`;
  if ('beat' in p) return `beat(${p.beat}) in ${printSet(p.state)}`;
  if ('response' in p) return `response(${p.response}) is ${printSet(p.is)}`;
  if ('hour' in p) return `hour in [${p.hour[0]}, ${p.hour[1]})`;
  if ('count' in p) {
    const ref = p.since === undefined ? '' : 'beat' in p.since ? `, beat ${p.since.beat}` : `, state ${p.since.state}`;
    return `count(${printPatternArg(p.count)}${ref}) ${CMP_SYM[p.op]} ${p.value}`;
  }
  if ('since' in p && 'atLeast' in p) {
    const ref = 'beat' in p.since ? `beat ${p.since.beat}` : `state ${p.since.state}`;
    return `since(${ref}) >= ${printValue(p.atLeast)}`;
  }
  if ('clock' in p) return `clock(${p.clock}) ${CMP_SYM[p.op]} ${p.value}`;
  if ('exposed' in p) {
    const { atLeast, ...rest } = p.exposed;
    return `exposed(${printPatternArg(rest)}${atLeast === undefined ? '' : `, ${atLeast}`})`;
  }
  if ('cap' in p) return `cap(${p.cap})`;
  if ('setting' in p) return `setting(${p.setting}) in ${printSet(p.is)}`;
  if ('believes' in p) {
    const b = p.believes;
    const extra = [b.is === undefined ? '' : `, is: ${printValue(b.is)}`, b.atLeast === undefined ? '' : `, atLeast: ${b.atLeast}`].join('');
    return `believes(${b.who}, ${printValue(b.of)}, ${b.path}${extra})`;
  }
  if ('city' in p) return `city(${printValue(p.city)}) in ${printSet(p.is)}`;
  if ('social' in p) return `social(${printValue(p.social)}) in ${printSet(p.is)}`;
  if ('fn' in p) {
    const reads = p.reads.length === 0 ? '' : ` reads ${printValue(p.reads)}`;
    const items = p.args.map(printValue);
    if (p.fn.params !== undefined) items.push(`params: ${printValue(p.fn.params)}`);
    return `${p.fn.name}@${p.fn.version}(${items.join(', ')})${reads}`;
  }
  throw new Error('unprintable predicate');
}

// ---- parsing ----

type Tok =
  | { t: 'num'; v: number; pos: number }
  | { t: 'dur'; v: { clock: 'game' | 'play'; s: number }; pos: number }
  | { t: 'str'; v: string; pos: number }
  | { t: 'id'; v: string; pos: number }
  | { t: 'role'; v: string; pos: number }
  | { t: 'sym'; v: string; pos: number }
  | { t: 'end'; pos: number };

export class PredSyntaxError extends Error {
  constructor(message: string, public readonly pos: number) {
    super(`${message} (at ${pos})`);
  }
}

function lex(src: string): Tok[] {
  const out: Tok[] = [];
  let i = 0;
  const syms = ['<=', '>=', '==', '!=', '<', '>', '(', ')', '[', ']', '{', '}', ',', ':', '.', '@'];
  while (i < src.length) {
    const c = src[i]!;
    if (/\s/.test(c)) { i++; continue; }
    if (c === '"') {
      let j = i + 1;
      let s = '';
      while (j < src.length && src[j] !== '"') {
        if (src[j] === '\\') { s += src[j + 1] ?? ''; j += 2; } else s += src[j++];
      }
      if (src[j] !== '"') throw new PredSyntaxError('unterminated string', i);
      out.push({ t: 'str', v: JSON.parse(src.slice(i, j + 1)) as string, pos: i });
      i = j + 1;
      continue;
    }
    const num = /^-?\d+(\.\d+)?([eE][+-]?\d+)?/.exec(src.slice(i));
    if (num && !/[A-Za-z_]/.test(src[i + num[0].length] ?? '') ) {
      out.push({ t: 'num', v: Number(num[0]), pos: i });
      i += num[0].length;
      continue;
    }
    const dur = /^(\d+)([gp])(?![A-Za-z0-9_])/.exec(src.slice(i));
    if (dur) {
      out.push({ t: 'dur', v: { clock: dur[2] === 'g' ? 'game' : 'play', s: Number(dur[1]) }, pos: i });
      i += dur[0].length;
      continue;
    }
    if (c === '@' && /[A-Za-z_]/.test(src[i + 1] ?? '')) {
      const m = /^@([A-Za-z_][A-Za-z0-9_\-]*)/.exec(src.slice(i))!;
      out.push({ t: 'role', v: m[1]!, pos: i });
      i += m[0].length;
      continue;
    }
    const id = /^[A-Za-z_0-9][A-Za-z0-9_\-:.\/\[\]#^]*/.exec(src.slice(i));
    if (id && /[A-Za-z_0-9]/.test(c)) {
      // An identifier may not end in `.`, `:` or `-`, which are separators when they end a word.
      let v = id[0];
      while (/[.:\-]$/.test(v)) v = v.slice(0, -1);
      // A trailing bracket group only belongs to a path (key[i]); keep it.
      out.push({ t: 'id', v, pos: i });
      i += v.length;
      continue;
    }
    const sym = syms.find((s) => src.startsWith(s, i));
    if (sym) {
      out.push({ t: 'sym', v: sym, pos: i });
      i += sym.length;
      continue;
    }
    throw new PredSyntaxError(`unexpected character "${c}"`, i);
  }
  out.push({ t: 'end', pos: src.length });
  return out;
}

const BUILTINS = new Set([
  'seedFact', 'decided', 'cast', 'seed', 'beat', 'response', 'hour', 'since', 'count', 'clock', 'exposed', 'cap', 'setting',
  'believes', 'city', 'social', 'all', 'any',
]);

class Parser {
  private toks: Tok[];
  private p = 0;

  constructor(private readonly src: string) {
    this.toks = lex(src);
  }

  private peek(n = 0): Tok {
    return this.toks[Math.min(this.p + n, this.toks.length - 1)]!;
  }
  private next(): Tok {
    return this.toks[this.p++]!;
  }
  private isSym(v: string, n = 0): boolean {
    const t = this.peek(n);
    return t.t === 'sym' && t.v === v;
  }
  private isId(v: string, n = 0): boolean {
    const t = this.peek(n);
    return t.t === 'id' && t.v === v;
  }
  private eatSym(v: string): void {
    const t = this.next();
    if (t.t !== 'sym' || t.v !== v) throw new PredSyntaxError(`expected "${v}"`, t.pos);
  }
  private eatId(v: string): void {
    const t = this.next();
    if (t.t !== 'id' || t.v !== v) throw new PredSyntaxError(`expected "${v}"`, t.pos);
  }

  parseAll(): Pred {
    const p = this.pred();
    const t = this.peek();
    if (t.t !== 'end') throw new PredSyntaxError('unexpected text after the predicate', t.pos);
    return p;
  }

  private pred(): Pred {
    const first = this.conj();
    if (!this.isId('or')) return first;
    const xs = [first];
    while (this.isId('or')) {
      this.next();
      xs.push(this.conj());
    }
    return { any: xs };
  }

  private conj(): Pred {
    const first = this.unary();
    if (!this.isId('and')) return first;
    const xs = [first];
    while (this.isId('and')) {
      this.next();
      xs.push(this.unary());
    }
    return { all: xs };
  }

  private unary(): Pred {
    if (this.isId('not')) {
      this.next();
      return { not: this.unary() };
    }
    return this.atom();
  }

  private ident(what: string): string {
    const t = this.next();
    if (t.t !== 'id') throw new PredSyntaxError(`expected ${what}`, t.pos);
    return t.v;
  }

  private cmp(): Cmp {
    const t = this.next();
    if (t.t === 'sym' && SYM_CMP[t.v] !== undefined) return SYM_CMP[t.v]!;
    throw new PredSyntaxError('expected a comparison', t.pos);
  }

  private num(): number {
    const t = this.next();
    if (t.t !== 'num') throw new PredSyntaxError('expected a number', t.pos);
    return t.v;
  }

  private stringSet(): string[] {
    this.eatSym('{');
    const out: string[] = [];
    while (!this.isSym('}')) {
      const t = this.next();
      if (t.t === 'id' || t.t === 'str') out.push(t.v);
      else if (t.t === 'num') out.push(String(t.v));
      else throw new PredSyntaxError('expected a name', t.pos);
      if (this.isSym(',')) this.next();
    }
    this.eatSym('}');
    return out;
  }

  private value(): unknown {
    const t = this.peek();
    if (t.t === 'num') { this.next(); return t.v; }
    if (t.t === 'dur') { this.next(); return t.v; }
    if (t.t === 'str') { this.next(); return t.v; }
    if (t.t === 'role') { this.next(); return { role: t.v }; }
    if (t.t === 'id') {
      this.next();
      if (t.v === 'true') return true;
      if (t.v === 'false') return false;
      return t.v;
    }
    if (this.isSym('[')) {
      this.next();
      const xs: unknown[] = [];
      while (!this.isSym(']')) {
        xs.push(this.value());
        if (this.isSym(',')) this.next();
      }
      this.eatSym(']');
      return xs;
    }
    if (this.isSym('{')) {
      this.next();
      const o: Record<string, unknown> = {};
      while (!this.isSym('}')) {
        const k = this.next();
        if (k.t !== 'id' && k.t !== 'str') throw new PredSyntaxError('expected a key', k.pos);
        this.eatSym(':');
        o[k.v] = this.value();
        if (this.isSym(',')) this.next();
      }
      this.eatSym('}');
      return o;
    }
    throw new PredSyntaxError('expected a value', t.pos);
  }

  private object(): Record<string, unknown> {
    const v = this.value();
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new PredSyntaxError('expected a {key: value} pattern', this.peek().pos);
    return v as Record<string, unknown>;
  }

  private since(): { beat: string } | { state: string } {
    const kind = this.ident('"beat" or "state"');
    const v = this.ident('a name');
    if (kind === 'beat') return { beat: v };
    if (kind === 'state') return { state: v };
    throw new PredSyntaxError('expected "beat" or "state"', this.peek().pos);
  }

  private atom(): Pred {
    const t = this.peek();
    if (this.isSym('(')) {
      this.next();
      const p = this.pred();
      this.eatSym(')');
      return p;
    }
    if (t.t !== 'id') throw new PredSyntaxError('expected a predicate', t.pos);
    const nextIsParen = this.isSym('(', 1);
    // Keywords.
    if (t.v === 'yes' && !nextIsParen) { this.next(); return 'yes'; }
    if (t.v === 'no' && !nextIsParen) { this.next(); return 'no'; }
    if (t.v === 'hour' && this.isId('in', 1)) {
      this.next(); this.next();
      this.eatSym('[');
      const a = this.num();
      this.eatSym(',');
      const b = this.num();
      this.eatSym(')');
      return { hour: [a, b] };
    }
    if (BUILTINS.has(t.v) && nextIsParen) return this.builtin();
    // fn name@version(args)
    const at = this.peek(1);
    if (nextIsParen === false && at.t === 'sym' && at.v === '@' && this.peek(2).t === 'num') return this.fn();
    // A name with a dot is a role predicate; a bare name is a fact.
    const m = /^([A-Za-z_][A-Za-z0-9_\-]*)\.(.+)$/.exec(t.v);
    if (m && !nextIsParen) {
      this.next();
      return this.rolePred(m[1]!, m[2]!);
    }
    if (!nextIsParen && /^[A-Za-z_][A-Za-z0-9_\-]*$/.test(t.v) && this.isSym('.', 1)) {
      // `role . path` split by the lexer's dot handling.
      this.next();
      this.eatSym('.');
      const path = this.ident('a slot path');
      return this.rolePred(t.v, path);
    }
    if (!nextIsParen && this.peek(1).t === 'sym' && SYM_CMP[(this.peek(1) as { v: string }).v] !== undefined) {
      this.next();
      const op = this.cmp();
      return { fact: t.v, op, value: this.num() };
    }
    // `has-edge`/`lacks-edge` directly on a role: `role has-edge(type)`.
    if (this.peek(1).t === 'id' && /^(has|lacks)-edge$/.test((this.peek(1) as { v: string }).v)) {
      this.next();
      return this.rolePred(t.v, '');
    }
    throw new PredSyntaxError(`cannot read "${t.v}" as a predicate`, t.pos);
  }

  private fn(): Pred {
    const name = this.ident('a function name');
    this.eatSym('@');
    const version = this.num();
    this.eatSym('(');
    const args: unknown[] = [];
    let params: Record<string, unknown> | undefined;
    while (!this.isSym(')')) {
      if (this.peek().t === 'id' && (this.peek() as { v: string }).v === 'params' && this.isSym(':', 1)) {
        this.next(); this.next();
        params = this.object();
      } else args.push(this.value());
      if (this.isSym(',')) this.next();
    }
    this.eatSym(')');
    let reads: unknown[] = [];
    if (this.isId('reads')) {
      this.next();
      const v = this.value();
      if (!Array.isArray(v)) throw new PredSyntaxError('"reads" takes a list', this.peek().pos);
      reads = v;
    }
    const fnRef: { name: string; version: number; params?: Record<string, unknown> } = { name, version };
    if (params) fnRef.params = params;
    return { fn: fnRef, args, reads: reads as never };
  }

  private rolePred(role: string, path: string): Pred {
    const t = this.peek();
    const mk = (p: RolePredicate): Pred => ({ role, p });
    if (t.t === 'id' && (t.v === 'has-edge' || t.v === 'lacks-edge')) {
      this.next();
      this.eatSym('(');
      const edge = this.ident('an edge type');
      let to: unknown;
      if (this.isSym(',')) { this.next(); to = this.value(); }
      this.eatSym(')');
      const arg: { edge: string; to?: unknown } = { edge };
      if (to !== undefined) arg.to = to;
      return mk({ path, op: t.v, arg: arg as never });
    }
    if (t.t === 'id' && t.v === 'not') {
      this.next();
      this.eatId('in');
      return mk({ path, op: 'not-in', arg: this.setArg() as never });
    }
    if (t.t === 'id' && t.v === 'in') {
      this.next();
      if (this.isId('range')) {
        this.next();
        return mk({ path, op: 'range', arg: this.value() as never });
      }
      return mk({ path, op: 'in', arg: this.setArg() as never });
    }
    const op = this.cmp();
    const value = this.value();
    if (op === 'eq') return mk({ path, op: 'eq', arg: value as never });
    if (op === 'ge') return mk({ path, op: 'field-at-least', arg: value as never });
    if (op === 'le') return mk({ path, op: 'field-at-most', arg: value as never });
    if (op === 'ne') return { not: mk({ path, op: 'eq', arg: value as never }) };
    throw new PredSyntaxError('a role predicate compares with ==, !=, >= or <=', t.pos);
  }

  private setArg(): unknown {
    if (this.isSym('{') && !this.looksLikeObject()) {
      this.next();
      const xs: unknown[] = [];
      while (!this.isSym('}')) {
        xs.push(this.value());
        if (this.isSym(',')) this.next();
      }
      this.eatSym('}');
      return xs;
    }
    return this.value();
  }

  /** `{r: set, ...}` is a region; `{a, b}` is a list. */
  private looksLikeObject(): boolean {
    const a = this.peek(1);
    const b = this.peek(2);
    return (a.t === 'id' || a.t === 'str') && b.t === 'sym' && b.v === ':';
  }

  private builtin(): Pred {
    const name = this.ident('a name');
    this.eatSym('(');
    switch (name) {
      case 'all':
      case 'any': {
        const xs: Pred[] = [];
        while (!this.isSym(')')) {
          xs.push(this.pred());
          if (this.isSym(',')) this.next();
        }
        this.eatSym(')');
        return name === 'all' ? { all: xs } : { any: xs };
      }
      case 'seedFact': {
        const key = this.ident('a fact');
        this.eatSym(')');
        const op = this.cmp();
        return { seedFact: key, op, value: this.num() };
      }
      case 'decided': {
        const f = this.ident('a fact');
        this.eatSym(')');
        return { decided: f };
      }
      case 'cast': {
        const r = this.ident('a role');
        this.eatSym(')');
        return { cast: r };
      }
      case 'seed': {
        const v = this.value();
        this.eatSym(')');
        this.eatId('in');
        return { seed: String(v), state: this.stringSet() as never };
      }
      case 'beat': {
        const b = this.ident('a beat');
        this.eatSym(')');
        this.eatId('in');
        return { beat: b, state: this.stringSet() as never };
      }
      case 'response': {
        const b = this.ident('a beat');
        this.eatSym(')');
        this.eatId('is');
        return { response: b, is: this.stringSet() };
      }
      case 'since': {
        const ref = this.since();
        this.eatSym(')');
        const t = this.next();
        if (t.t !== 'sym' || t.v !== '>=') throw new PredSyntaxError('expected ">="', t.pos);
        const d = this.next();
        if (d.t !== 'dur') throw new PredSyntaxError('expected a duration such as 600g', d.pos);
        return { since: ref as never, atLeast: d.v };
      }
      case 'count': {
        const pattern = this.object();
        let since: { beat: string } | { state: string } | undefined;
        if (this.isSym(',')) { this.next(); since = this.since(); }
        this.eatSym(')');
        const op = this.cmp();
        const value = this.num();
        const out: { count: unknown; since?: unknown; op: Cmp; value: number } = { count: pattern, op, value };
        if (since) out.since = since;
        return out as Pred;
      }
      case 'clock': {
        const key = this.ident('a clock');
        this.eatSym(')');
        const op = this.cmp();
        return { clock: key, op, value: this.num() };
      }
      case 'exposed': {
        const pattern = this.object();
        if (this.isSym(',')) { this.next(); pattern.atLeast = this.ident('a grade'); }
        this.eatSym(')');
        return { exposed: pattern as never };
      }
      case 'cap': {
        const r = this.ident('a capability');
        this.eatSym(')');
        return { cap: r };
      }
      case 'setting': {
        const key = this.ident('a setting');
        this.eatSym(')');
        this.eatId('in');
        return { setting: key, is: this.stringSet() };
      }
      case 'believes': {
        const who = this.ident('a role');
        this.eatSym(',');
        const of = this.value();
        this.eatSym(',');
        const path = this.ident('a slot path');
        const b: { who: string; of: unknown; path: string; is?: unknown; atLeast?: number } = { who, of: of as string, path };
        while (this.isSym(',')) {
          this.next();
          const k = this.ident('a key');
          this.eatSym(':');
          const v = this.value();
          if (k === 'is') b.is = v;
          else if (k === 'atLeast') b.atLeast = v as number;
          else throw new PredSyntaxError(`unknown believes option "${k}"`, this.peek().pos);
        }
        this.eatSym(')');
        return { believes: b as never };
      }
      case 'city':
      case 'social': {
        const v = this.value();
        this.eatSym(')');
        this.eatId('in');
        const is = this.stringSet();
        return name === 'city' ? { city: v, is } : { social: v, is };
      }
    }
    throw new PredSyntaxError(`unknown predicate "${name}"`, this.peek().pos);
  }
}

export function parsePred(src: string): Pred {
  return new Parser(src).parseAll();
}

/** A predicate given as a tree or as its text form. */
export function toPred(x: Pred | string): Pred {
  return typeof x === 'string' && !(x === 'yes' || x === 'no') ? parsePred(x) : (x as Pred);
}
