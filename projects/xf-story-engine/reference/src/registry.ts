// The function registry (spec 2.1) and the core functions the reference model ships.
//
// Packs reference registry functions with parameters and supply no code. Function versions are part
// of the compatibility record (spec 14.4). The conflict table is a registry function that belongs to
// S1: the version registered here is the specification's first version (spec 10.8), a stand-in until
// S1 supplies its own.

import type { DimensionDef } from './schema-types.ts';
import type { Effect, FnRef, GameTime, Region, Value } from './types.ts';
import { ivlRegion } from './region.ts';
import { valueKey } from './value.ts';

type Params = Record<string, unknown>;

export type Prior = (dim: DimensionDef, F: Value[], params: Params) => number[];
/** A derive receives the query time `t` (S0 v4, V4-1); one that ignores it behaves exactly as before. */
export type Derive = (inputs: Value[], params: Params, t: GameTime) => Value;
export type Preimage = (output: Region, otherInputs: Value[], params: Params) => Region;
export type Conditioned = (inputs: Value[], F: Value[], params: Params) => number[];
export type FieldMap = (fieldValue: number, F: Value[], params: Params) => number[];
export type Buckets = (value: Value, params: Params) => string[];
export type Bound = (inputBounds: Region[], params: Params) => Region;

export type InterestType = 'wants' | 'reactsTo' | 'blockedBy' | 'threatenedBy' | 'protects';
export const INTEREST_TYPES: readonly InterestType[] = ['wants', 'reactsTo', 'blockedBy', 'threatenedBy', 'protects'];
export type Verdict = 'violates' | 'ok';
/** The effect conflict table (spec 10.8): maps (interest type, effect) to violates or ok. S1 owns its contents. */
export type ConflictTable = (interest: InterestType, effect: Effect, params: Params) => Verdict;

export interface FnCategories {
  prior: Prior;
  derive: Derive;
  preimage: Preimage;
  conditioned: Conditioned;
  fieldmap: FieldMap;
  buckets: Buckets;
  bound: Bound;
  conflict: ConflictTable;
}
export type FnCategory = keyof FnCategories;

export class Registry {
  private fns = new Map<string, unknown>();

  private key(category: FnCategory, name: string, version: number): string {
    return `${category}:${name}@${version}`;
  }

  register<C extends FnCategory>(category: C, name: string, version: number, fn: FnCategories[C]): this {
    const k = this.key(category, name, version);
    if (this.fns.has(k)) throw new Error(`function already registered: ${k}`);
    this.fns.set(k, fn);
    return this;
  }

  has(category: FnCategory, ref: FnRef): boolean {
    return this.fns.has(this.key(category, ref.name, ref.version));
  }

  get<C extends FnCategory>(category: C, ref: FnRef): FnCategories[C] {
    const fn = this.fns.get(this.key(category, ref.name, ref.version));
    if (!fn) throw new Error(`unknown function: ${this.key(category, ref.name, ref.version)}`);
    return fn as FnCategories[C];
  }

  /** The names and versions registered, sorted: the registry's side of the compatibility record. */
  list(): string[] {
    return [...this.fns.keys()].sort();
  }
}

const pos = (n: unknown, what: string): number => {
  if (typeof n !== 'number' || !Number.isFinite(n) || n <= 0) throw new Error(`${what} must be a positive number`);
  return n;
};

/** A registry holding the core functions. */
export function coreRegistry(): Registry {
  const r = new Registry();

  // Priors: positive weights over F.
  r.register('prior', 'uniform', 1, (_dim, F) => F.map(() => 1));
  r.register('prior', 'weights', 1, (_dim, F, params) => {
    const table = (params.weights ?? {}) as Record<string, number>;
    const dflt = (params.default ?? 1) as number;
    return F.map((v) => {
      const w = table[valueKey(v)];
      return w === undefined ? pos(dflt, 'default weight') : pos(w, 'weight');
    });
  });

  // Conditioned priors: positive weights over F given the input values.
  r.register('conditioned', 'table', 1, (inputs, F, params) => {
    const table = (params.table ?? {}) as Record<string, Record<string, number>>;
    const row = table[inputs.map(valueKey).join('|')] ?? {};
    const dflt = (params.default ?? 1) as number;
    return F.map((v) => {
      const w = row[valueKey(v)];
      return w === undefined ? pos(dflt, 'default weight') : pos(w, 'weight');
    });
  });

  // Derivations.
  r.register('derive', 'identity', 1, (inputs) => inputs[0]!);
  r.register('derive', 'concat', 1, (inputs, params) => inputs.map(String).filter((x) => x !== '').join((params.sep ?? ' ') as string));
  r.register('derive', 'floor-div', 1, (inputs, params) => Math.floor((inputs[0] as number) / pos(params.divisor, 'divisor')));
  r.register('derive', 'sum', 1, (inputs) => inputs.reduce<number>((a, x) => a + (x as number), 0));
  r.register('derive', 'first-char', 1, (inputs) => String(inputs[0]).slice(0, 1));
  // v4.4 (V4-22): a person is an adult at 18 and over.
  r.register('derive', 'age-class', 1, (inputs, params) => ((inputs[0] as number) >= ((params.adultAt as number | undefined) ?? 18) ? 'adult' : 'minor'));

  // Preimages for unary views: the output region mapped back to a region of the input.
  r.register('preimage', 'identity', 1, (output) => output);
  r.register('preimage', 'floor-div', 1, (output, _other, params) => {
    const d = pos(params.divisor, 'divisor');
    if (output.r === 'all') return output;
    if (output.r !== 'ivl') throw new Error('floor-div preimage needs an interval region');
    return ivlRegion(output.ivls.map(([a, b]): [number, number] => [a * d, b * d + d - 1]));
  });

  // The preimage of the age class: the ages that give a set of classes (the dimension's own range clips the result).
  r.register('preimage', 'age-class', 1, (output, _other, params) => {
    const at = (params.adultAt as number | undefined) ?? 18;
    if (output.r === 'all') return output;
    if (output.r !== 'set') throw new Error('age-class preimage needs a set region');
    const adult = output.values.includes('adult');
    const minor = output.values.includes('minor');
    const ivls: Array<[number, number]> = [];
    if (minor) ivls.push([-(2 ** 31), at - 1]);
    if (adult) ivls.push([at, 2 ** 31]);
    return ivlRegion(ivls);
  });

  // Field maps: a field value to positive weights over F.
  r.register('fieldmap', 'boost-value', 1, (fieldValue, F, params) => {
    const gain = (params.gain ?? 1) as number;
    const target = valueKey(params.value as Value);
    return F.map((v) => (valueKey(v) === target ? 1 + gain * fieldValue : 1));
  });
  r.register('fieldmap', 'gradient', 1, (fieldValue, F, params) => {
    const gain = (params.gain ?? 1) as number;
    const n = F.length;
    return F.map((_v, idx) => 1 + gain * fieldValue * (n > 1 ? idx / (n - 1) : 0));
  });

  // Bucket keys: a value to coarse match keys.
  r.register('buckets', 'identity', 1, (value) => [valueKey(value)]);
  r.register('buckets', 'bucket-map', 1, (value, params) => {
    const map = (params.map ?? {}) as Record<string, string>;
    const k = valueKey(value);
    return [map[k] ?? k];
  });

  // Bounds (optional; the first implementation answers `maybe` without one).
  r.register('bound', 'identity', 1, (inputs) => inputs[0] ?? { r: 'all' });

  // The first version of the effect conflict table (spec 10.8). STUB for S1.
  r.register('conflict', 'first-table', 1, (interest, effect) => {
    if (interest === 'protects') return effect === 'harm' || effect === 'kill' || effect === 'take' || effect === 'expose' ? 'violates' : 'ok';
    if (interest === 'wants') return effect === 'conceal' || effect === 'take' ? 'violates' : 'ok';
    return 'ok';
  });

  return r;
}

export const UNIFORM_PRIOR: FnRef = { name: 'uniform', version: 1 };
export const CONFLICT_TABLE: FnRef = { name: 'first-table', version: 1 };
