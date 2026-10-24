// Schema definitions (spec 2.1, 2.2, 2.4, 2.5). Plain data: a pack supplies these, never code.

import type { DimId, EdgeTypeId, FnRef, KindId, Predicate, QueryScope, SlotPath, Tier } from './types.ts';

export interface CandidateQuery {
  find: KindId;
  scope: QueryScope;
  must: Predicate[];
  max: number;
}

export type ValueType =
  | { t: 'enum'; values: string[] }
  | { t: 'enum-by'; by: SlotPath; lists: Record<string, string[]> }
  | { t: 'int'; min: number; max: number }
  | { t: 'real'; min: number; max: number; quantum: number }
  | { t: 'cyclic'; period: number; quantum: number }
  | { t: 'vec'; n: number; quantum: number }
  | { t: 'text' }
  | { t: 'ref'; kind: KindId; candidates: CandidateQuery }
  | { t: 'node'; kind: KindId };

export interface DimensionDef {
  id: DimId;
  value: ValueType;
  structure: 'none' | 'order' | 'metric' | 'cyclic' | 'graph';
  prior: FnRef;
  buckets?: FnRef;
}

export type SlotMode = 'sampled' | 'derived' | 'mirrored' | 'assigned';

export interface SlotDef {
  key: string;
  dim: DimId;
  card: 'one' | { many: { count: DimId } };
  mode: SlotMode;
  derive?: { fn: FnRef; inputs: SlotPath[]; preimage?: FnRef };
  conditioned?: { fn: FnRef; inputs: SlotPath[] };
  temporal?: { window: number };
  tier: Tier;
}

export type Facet = 'actor' | 'group' | 'place' | 'event' | 'summary';

export interface KindDef {
  id: KindId;
  extends?: KindId[];
  /** Nominal role compatibility without inheriting slot layout (SPEC-NOTES 180). */
  classifiesAs?: KindId[];
  slots: SlotDef[];
  facets?: Facet[];
  tags?: string[];
}

export interface EdgeTypeDef {
  id: EdgeTypeId;
  from: KindId[];
  to: KindId[];
  attrs: Record<string, DimId>;
  data?: string[];
  perceivable?: boolean;
  symmetric?: boolean;
}

/** What a pack (or the core) supplies to the schema loader. */
export interface SchemaDefs {
  dims: DimensionDef[];
  kinds: KindDef[];
  edgeTypes: EdgeTypeDef[];
  /** Drive catalogue: drive id to family (spec 10.1, 12). Content packs may extend it. */
  drives?: Array<{ id: string; family: string }>;
}
