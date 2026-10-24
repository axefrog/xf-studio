// Schema loading and validation (spec 2.1 to 2.5).
//
// The schema is data. Loading rejects a kind that breaks the dependency rules of spec 2.3: a slot may
// read only the same node's earlier slots and the slots of its owner chain, never an owned value's or
// a member's slot (except the count of a `many` slot), and never through a ref.

import type { Config } from './config.ts';
import { makeConfig } from './config.ts';
import type { Registry } from './registry.ts';
import type {
  DimensionDef, EdgeTypeDef, Facet, KindDef, SchemaDefs, SlotDef, ValueType,
} from './schema-types.ts';
import type { DimId, EdgeTypeId, KindId, SlotPath } from './types.ts';

export class SchemaError extends Error {
  constructor(public readonly problems: string[]) {
    super(`invalid schema:\n  ${problems.join('\n  ')}`);
  }
}

export interface ResolvedKind {
  id: KindId;
  /** Flattened, in declaration order after inheritance (spec 2.3). */
  slots: SlotDef[];
  index: Map<string, number>;
  facets: Set<Facet>;
  tags: Set<string>;
  /** The kind itself and every kind it extends, transitively. */
  ancestors: KindId[];
  /** Kind compatibility through inheritance and nominal classification, without changing query membership. */
  compatibleKinds: KindId[];
}

/** A slot path resolved against a kind. */
export interface SlotInfo {
  def: SlotDef;
  /** The slot's position in the flattened kind (declaration order). */
  order: number;
  index?: number;
  isCount: boolean;
  /** The dimension the addressed value belongs to (the count's dimension for `key#count`). */
  dim: DimensionDef;
  vt: ValueType;
  /** True when the path addresses a node (an owned value, or a member of a node slot). */
  isNode: boolean;
}

const SLOT_KEY_RE = /^[a-z0-9-]+$/;
const SLOT_PATH_RE = /^([a-z0-9-]+)(?:\[(\d+)\]|(#count))?$/;

export interface ParsedSlotPath {
  key: string;
  index?: number;
  isCount: boolean;
}

export function parseSlotPath(p: SlotPath): ParsedSlotPath | null {
  const m = SLOT_PATH_RE.exec(p);
  if (!m) return null;
  const out: ParsedSlotPath = { key: m[1]!, isCount: m[3] === '#count' };
  if (m[2] !== undefined) out.index = Number(m[2]);
  return out;
}

export interface LoadOptions {
  /** Skip validation. Only the cycle-guard test uses this, to install a schema the loader would reject. */
  validate?: boolean;
}

export class Schema {
  readonly dims = new Map<DimId, DimensionDef>();
  readonly edgeTypes = new Map<EdgeTypeId, EdgeTypeDef>();
  readonly driveFamily = new Map<string, string>();
  private kindDefs = new Map<KindId, KindDef>();
  private resolved = new Map<KindId, ResolvedKind>();

  private constructor(
    public readonly registry: Registry,
    public readonly config: Config,
  ) {}

  static load(defs: SchemaDefs, registry: Registry, config: Config = makeConfig(), opts: LoadOptions = {}): Schema {
    const schema = new Schema(registry, config);
    for (const d of defs.dims) schema.dims.set(d.id, d);
    for (const k of defs.kinds) schema.kindDefs.set(k.id, k);
    for (const e of defs.edgeTypes) schema.edgeTypes.set(e.id, e);
    for (const d of defs.drives ?? []) schema.driveFamily.set(d.id, d.family);
    if (opts.validate !== false) {
      const problems = schema.validate(defs);
      if (problems.length > 0) throw new SchemaError(problems);
    }
    for (const id of schema.kindDefs.keys()) schema.resolveKind(id);
    return schema;
  }

  // ---- lookups ----

  dim(id: DimId): DimensionDef {
    const d = this.dims.get(id);
    if (!d) throw new Error(`unknown dimension: ${id}`);
    return d;
  }

  hasKind(id: KindId): boolean {
    return this.kindDefs.has(id);
  }

  kind(id: KindId): ResolvedKind {
    const k = this.resolveKind(id);
    if (!k) throw new Error(`unknown kind: ${id}`);
    return k;
  }

  edgeType(id: EdgeTypeId): EdgeTypeDef {
    const e = this.edgeTypes.get(id);
    if (!e) throw new Error(`unknown edge type: ${id}`);
    return e;
  }

  kindIds(): KindId[] {
    return [...this.kindDefs.keys()].sort();
  }

  /** True when `kind` is `ancestor` or extends it. */
  isKind(kind: KindId, ancestor: KindId): boolean {
    return this.kind(kind).ancestors.includes(ancestor);
  }

  /** Explicit identity and pattern compatibility; nominal classification does not inherit slots or widen queries. */
  isCompatibleKind(kind: KindId, target: KindId): boolean {
    return this.kind(kind).compatibleKinds.includes(target);
  }

  hasFacet(kind: KindId, facet: Facet): boolean {
    return this.kind(kind).facets.has(facet);
  }

  /** Every kind that is `ancestor` or extends it. */
  kindsOf(ancestor: KindId): KindId[] {
    return this.kindIds().filter((k) => this.isKind(k, ancestor));
  }

  /** Resolve a slot path against a kind, or null if the kind has no such slot (or the path is malformed). */
  slotInfo(kind: KindId, path: SlotPath): SlotInfo | null {
    const parsed = parseSlotPath(path);
    if (!parsed) return null;
    const rk = this.kind(kind);
    const order = rk.index.get(parsed.key);
    if (order === undefined) return null;
    const def = rk.slots[order]!;
    const base = this.dim(def.dim);
    const many = def.card !== 'one';
    if (parsed.isCount) {
      if (!many) return null;
      const dim = this.dim((def.card as { many: { count: DimId } }).many.count);
      return { def, order, isCount: true, dim, vt: dim.value, isNode: false };
    }
    if (many && parsed.index === undefined) return null;
    if (!many && parsed.index !== undefined) return null;
    const info: SlotInfo = { def, order, isCount: false, dim: base, vt: base.value, isNode: base.value.t === 'node' };
    if (parsed.index !== undefined) info.index = parsed.index;
    return info;
  }

  /** The schema's side of the compatibility record (spec 14.4): every function it references. */
  functionVersions(): string[] {
    const out = new Set<string>();
    const add = (cat: string, ref: { name: string; version: number } | undefined) => {
      if (ref) out.add(`${cat}:${ref.name}@${ref.version}`);
    };
    for (const d of this.dims.values()) {
      add('prior', d.prior);
      add('buckets', d.buckets);
    }
    for (const k of this.kindIds()) {
      for (const s of this.kind(k).slots) {
        add('derive', s.derive?.fn);
        add('preimage', s.derive?.preimage);
        add('conditioned', s.conditioned?.fn);
      }
    }
    return [...out].sort();
  }

  // ---- kind resolution ----

  private resolveKind(id: KindId): ResolvedKind | undefined {
    const cached = this.resolved.get(id);
    if (cached) return cached;
    const def = this.kindDefs.get(id);
    if (!def) return undefined;
    // Guard against an inheritance cycle in an unvalidated schema.
    this.resolved.set(id, { id, slots: [], index: new Map(), facets: new Set(), tags: new Set(), ancestors: [id], compatibleKinds: [id] });
    const slots: SlotDef[] = [];
    const index = new Map<string, number>();
    const facets = new Set<Facet>();
    const tags = new Set<string>();
    const ancestors: KindId[] = [id];
    const compatibleKinds: KindId[] = [id];
    const put = (s: SlotDef) => {
      const at = index.get(s.key);
      if (at === undefined) {
        index.set(s.key, slots.length);
        slots.push(s);
      } else slots[at] = s;
    };
    for (const parentId of def.extends ?? []) {
      const p = this.resolveKind(parentId);
      if (!p) continue;
      for (const s of p.slots) put(s);
      for (const f of p.facets) facets.add(f);
      for (const t of p.tags) tags.add(t);
      for (const a of p.ancestors) if (!ancestors.includes(a)) ancestors.push(a);
      for (const a of p.compatibleKinds) if (!compatibleKinds.includes(a)) compatibleKinds.push(a);
    }
    for (const s of def.slots) put(s);
    for (const parentId of def.classifiesAs ?? []) {
      const p = this.resolveKind(parentId);
      for (const a of p?.compatibleKinds ?? []) if (!compatibleKinds.includes(a)) compatibleKinds.push(a);
    }
    for (const f of def.facets ?? []) facets.add(f);
    for (const t of def.tags ?? []) tags.add(t);
    const rk: ResolvedKind = { id, slots, index, facets, tags, ancestors, compatibleKinds };
    this.resolved.set(id, rk);
    return rk;
  }

  // ---- validation ----

  /**
   * Check a dependency path (a derive or conditioned input, or an enum-by `by`) read by the slot at
   * position `order` of `kind` (spec 2.3). Returns a problem description, or null if the read is legal.
   * Owner-chain reads (`^/key`) cannot be checked against a kind statically; resolution checks them.
   */
  checkDependencyPath(kind: KindId, order: number, path: SlotPath): string | null {
    let rest = path;
    let viaOwner = false;
    while (rest.startsWith('^/')) {
      viaOwner = true;
      rest = rest.slice(2);
    }
    const parsed = parseSlotPath(rest);
    if (!parsed || parsed.index !== undefined) return `a dependency may name only a slot or its count, not "${path}"`;
    if (viaOwner) return null;
    const rk = this.kind(kind);
    const at = rk.index.get(parsed.key);
    if (at === undefined) return `reads unknown slot "${path}"`;
    if (at >= order) return `reads "${path}", which is not an earlier slot`;
    const def = rk.slots[at]!;
    if (parsed.isCount) {
      if (def.card === 'one') return `"${path}" has no count`;
      return null;
    }
    if (def.card !== 'one') return `reads the members of "${path}"; only its count may be read`;
    const vt = this.dim(def.dim).value;
    if (vt.t === 'ref') return `reads the ref slot "${path}": refs are not resolution dependencies`;
    if (vt.t === 'node') return `reads the owned value "${path}": an owner never reads its owned values' slots`;
    return null;
  }

  private validate(defs: SchemaDefs): string[] {
    const problems: string[] = [];
    const cfg = this.config;
    const seen = <T extends { id: string }>(list: T[], what: string) => {
      const ids = new Set<string>();
      for (const x of list) {
        if (ids.has(x.id)) problems.push(`duplicate ${what} id: ${x.id}`);
        ids.add(x.id);
      }
    };
    seen(defs.dims, 'dimension');
    seen(defs.kinds, 'kind');
    seen(defs.edgeTypes, 'edge type');

    const fnOk = (cat: 'prior' | 'derive' | 'preimage' | 'conditioned' | 'buckets', ref: { name: string; version: number } | undefined, where: string) => {
      if (ref && !this.registry.has(cat, ref)) problems.push(`${where}: unknown ${cat} function ${ref.name}@${ref.version}`);
    };

    // Dimensions.
    for (const d of defs.dims) {
      const w = `dimension ${d.id}`;
      fnOk('prior', d.prior, w);
      fnOk('buckets', d.buckets, w);
      const vt = d.value;
      switch (vt.t) {
        case 'enum':
          if (vt.values.length === 0) problems.push(`${w}: an enum needs values`);
          if (new Set(vt.values).size !== vt.values.length) problems.push(`${w}: duplicate enum values`);
          if (vt.values.length > cfg.nEnum) problems.push(`${w}: ${vt.values.length} values exceed N_enum`);
          break;
        case 'enum-by':
          for (const [by, list] of Object.entries(vt.lists)) {
            if (list.length > cfg.nEnum) problems.push(`${w}: the list for "${by}" has ${list.length} values, more than N_enum`);
            if (new Set(list).size !== list.length) problems.push(`${w}: the list for "${by}" repeats a value`);
          }
          break;
        case 'int':
          if (!Number.isInteger(vt.min) || !Number.isInteger(vt.max) || vt.min > vt.max) problems.push(`${w}: bad int range`);
          break;
        case 'real':
          if (!(vt.quantum > 0) || vt.min > vt.max) problems.push(`${w}: bad real range or quantum`);
          break;
        case 'cyclic':
          if (!(vt.quantum > 0) || !(vt.period > 0) || Math.abs(vt.period / vt.quantum - Math.round(vt.period / vt.quantum)) > 1e-9)
            problems.push(`${w}: the period must be a whole number of quanta`);
          break;
        case 'vec':
          if (!(vt.n >= 1) || !(vt.quantum > 0)) problems.push(`${w}: bad vec`);
          break;
        case 'ref':
          if (!defs.kinds.some((k) => k.id === vt.kind)) problems.push(`${w}: ref to unknown kind ${vt.kind}`);
          if (!defs.kinds.some((k) => k.id === vt.candidates.find)) problems.push(`${w}: candidates find unknown kind ${vt.candidates.find}`);
          if (!(vt.candidates.max >= 1)) problems.push(`${w}: candidates max must be at least 1`);
          // A candidate query may test only the candidates' non-ref, non-temporal slots (spec 2.3).
          for (const p of vt.candidates.must) {
            if (p.path === '' || p.path === '.' || p.path.startsWith('@') || p.op === 'has-edge' || p.op === 'lacks-edge') continue;
            const first = p.path.replace(/:bucket$/, '').split('/')[0]!;
            if (first === '^') continue;
            const slotDef = this.kindDefs.has(vt.candidates.find) ? this.kind(vt.candidates.find).slots.find((sd) => sd.key === (parseSlotPath(first)?.key ?? first)) : undefined;
            if (!slotDef) continue;
            const sdim = this.dims.get(slotDef.dim);
            if (sdim?.value.t === 'ref') problems.push(`${w}: a candidate query reads the ref slot "${first}"`);
            if (slotDef.temporal) problems.push(`${w}: a candidate query reads the temporal slot "${first}"`);
          }
          break;
        case 'node':
          if (!defs.kinds.some((k) => k.id === vt.kind)) problems.push(`${w}: node of unknown kind ${vt.kind}`);
          break;
        case 'text':
          break;
      }
    }

    // Kinds: inheritance.
    const kindIds = new Set(defs.kinds.map((k) => k.id));
    for (const k of defs.kinds) {
      for (const p of k.extends ?? []) if (!kindIds.has(p)) problems.push(`kind ${k.id}: extends unknown kind ${p}`);
      for (const p of k.classifiesAs ?? []) if (!kindIds.has(p)) problems.push(`kind ${k.id}: classifies as unknown kind ${p}`);
    }
    const visiting = new Set<string>();
    const done = new Set<string>();
    const walk = (id: string, trail: string[]) => {
      if (done.has(id)) return;
      if (visiting.has(id)) {
        problems.push(`inheritance cycle: ${[...trail, id].join(' -> ')}`);
        return;
      }
      visiting.add(id);
      const def = this.kindDefs.get(id);
      for (const p of [...def?.extends ?? [],...def?.classifiesAs ?? []]) if (this.kindDefs.has(p)) walk(p, [...trail, id]);
      visiting.delete(id);
      done.add(id);
    };
    for (const k of defs.kinds) walk(k.id, []);
    if (problems.some((p) => p.startsWith('inheritance cycle'))) return problems;

    // Kinds: slots.
    for (const k of defs.kinds) {
      const rk = this.kind(k.id);
      rk.slots.forEach((s, order) => {
        const w = `kind ${k.id}, slot ${s.key}`;
        if (!SLOT_KEY_RE.test(s.key)) problems.push(`${w}: a slot key is [a-z0-9-]+`);
        const dim = this.dims.get(s.dim);
        if (!dim) {
          problems.push(`${w}: unknown dimension ${s.dim}`);
          return;
        }
        const vt = dim.value;
        const many = s.card !== 'one';
        if (many) {
          const cd = this.dims.get((s.card as { many: { count: DimId } }).many.count);
          if (!cd) problems.push(`${w}: unknown count dimension`);
          else if (cd.value.t !== 'int') problems.push(`${w}: the count dimension must be an int`);
          else if (cd.value.max - cd.value.min + 1 > cfg.nEnum) problems.push(`${w}: the count domain exceeds N_enum`);
          if (s.mode === 'derived') problems.push(`${w}: a many slot cannot be derived`);
        }
        if (!(s.tier >= 0 && s.tier <= 5)) problems.push(`${w}: tier must be 0..5`);
        if (s.temporal && !(s.temporal.window > 0 && Number.isInteger(s.temporal.window))) problems.push(`${w}: a temporal window is a positive whole number of seconds`);
        if (vt.t === 'node') return; // node slots are structural: owned values and members
        const enumerable = vt.t === 'enum' || vt.t === 'enum-by' || vt.t === 'int' || vt.t === 'real' || vt.t === 'cyclic' || vt.t === 'ref';
        const domainSize = (): number => {
          if (vt.t === 'int') return vt.max - vt.min + 1;
          if (vt.t === 'real') return Math.floor((vt.max - vt.min) / vt.quantum + 1e-9) + 1;
          if (vt.t === 'cyclic') return Math.round(vt.period / vt.quantum);
          return 0;
        };
        if (s.mode === 'sampled' || s.mode === 'mirrored') {
          // A mirrored slot is sampled on a generated node, so it needs a sampleable domain unless it can be derived or assigned.
          if (!enumerable && !(s.mode === 'mirrored' && (vt.t === 'vec' || vt.t === 'text' || s.derive)))
            problems.push(`${w}: a ${vt.t} slot is never drawn; it must be derived, mirrored or assigned`);
          if (enumerable && domainSize() > cfg.nEnum && !s.derive)
            problems.push(`${w}: a sampled domain of ${domainSize()} values exceeds N_enum`);
        }
        if (s.mode === 'derived' && !s.derive) problems.push(`${w}: a derived slot needs derive`);
        if (s.derive) {
          if (s.mode !== 'derived' && s.mode !== 'mirrored') problems.push(`${w}: derive only applies to derived or mirrored slots`);
          fnOk('derive', s.derive.fn, w);
          fnOk('preimage', s.derive.preimage, w);
          if (s.derive.preimage && s.derive.inputs.length !== 1) problems.push(`${w}: a preimage needs exactly one input`);
          for (const inp of s.derive.inputs) {
            const p = this.checkDependencyPath(k.id, order, inp);
            if (p) problems.push(`${w}: derive ${p}`);
          }
        }
        if (s.conditioned) {
          if (s.mode !== 'sampled' && s.mode !== 'mirrored') problems.push(`${w}: conditioned only applies to sampled slots`);
          fnOk('conditioned', s.conditioned.fn, w);
          for (const inp of s.conditioned.inputs) {
            const p = this.checkDependencyPath(k.id, order, inp);
            if (p) problems.push(`${w}: conditioned ${p}`);
          }
        }
        if (vt.t === 'enum-by') {
          const p = this.checkDependencyPath(k.id, order, vt.by);
          if (p) problems.push(`${w}: enum-by ${p}`);
          else if (!vt.by.startsWith('^/')) {
            const byDef = rk.slots[rk.index.get(vt.by.replace(/#count$/, ''))!]!;
            const byVt = this.dims.get(byDef.dim)?.value;
            if (byVt?.t === 'enum') {
              for (const v of byVt.values) if (!(v in vt.lists)) problems.push(`${w}: enum-by has no list for "${v}" of ${vt.by}`);
            }
          }
        }
      });
    }

    // Edge types.
    for (const e of defs.edgeTypes) {
      for (const kk of [...e.from, ...e.to]) if (!kindIds.has(kk)) problems.push(`edge type ${e.id}: unknown kind ${kk}`);
      for (const [attr, dimId] of Object.entries(e.attrs)) if (!this.dims.has(dimId)) problems.push(`edge type ${e.id}: attr ${attr} has unknown dimension ${dimId}`);
    }
    return problems;
  }
}
