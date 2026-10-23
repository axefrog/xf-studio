// The world-index slice (S1 3.1): static place data, built offline once per installed game and mod set, the same on every
// machine for the same install. It is not part of the save; its version and hash are in the lineage record. S1 never
// edits it. A cell that appears or disappears is a new lineage.

import type { Id } from '../types.ts';
import type { KindName, Per4 } from './data.ts';

/** A `Factions.*` record name such as "TygerClaws"; "civilian" and "ncpd" are fixed names. */
export type Aff = string;
export type AffClass = 'civilian' | 'gang' | 'corp' | 'ncpd';

export interface DistrictIndex {
  id: Id;
  /** The place key, e.g. "wat_kab". */
  key: string;
  /** False: a tier-1 stub with counts only. */
  simulated: boolean;
  /** Districts whose polygon touches this one. */
  neighbours: Id[];
  /** Entry quantity, largest first. */
  entry: { total: number; byAff: Array<{ aff: Aff; cls: AffClass; q: number }> };
  /** The headcount scale [tunable 1.0]. */
  rho: number;
  /** The targets of the recipe fit, each summing to 1. */
  marginals: {
    age: number[];
    role: number[];
    income: number[];
    aff: number[];
    household: { type: number[]; tenure: number[]; wealth: number[] };
  };
  /** The six affiliation-class names of the recipe (S1 4.2). */
  affOrder: Aff[];
  /** Starting efficacy, cynicism and police legitimacy. */
  trust: { E0: number; Y0: number; L0: number };
  priceAnchor: 0 | 1 | 2 | 3;
  /** The sum of A over the district's cells; stubs use it directly. */
  staticTotalA: Record<KindName, Per4>;
  /** In grid order, then venues. */
  cellIds: Id[];
}

export interface CellIndex {
  id: Id;
  district: Id;
  kind: 'grid' | 'venue';
  /** A venue's grid cell. */
  host?: Id;
  /** Cells at graph distance 1 and 2, each sorted by Id. */
  adj1: Id[];
  adj2: Id[];
  public: 'public' | 'semi' | 'private';
  /** People present per period; the share of the district's residents (0 for venues). */
  pop: Per4;
  headShare: number;
  /** Shares of entry quantity in the cell. */
  presence: Record<Aff, number>;
  /** The opportunity A, by kind and period. */
  A: Record<KindName, Per4>;
  /** The propensity weighting, in [0.5, 2]. */
  F: Record<KindName, number>;
  /** Gang pairs with a weight (presence product x border x hostility); both orientations are listed. */
  pairs: Array<{ a: Aff; b: Aff; w: number }>;
  /** 0 to 1, static: the share of the kind the game already covers here (S1 7.2). */
  gameCoverage: Record<KindName, number>;
  services: Array<{ id: Id; type: string; poi?: string }>;
  marketCell: boolean;
}

export interface WorldIndex {
  version: string;
  hash: string;
  clock?: { dow0: number; sod0: number };
  /** Simulated and stub districts. */
  districts: Record<Id, DistrictIndex>;
  /** Cells of simulated districts only. */
  cells: Record<Id, CellIndex>;
  /** The opportunity of all districts not listed. */
  rest: { totalA: Record<KindName, Per4> };
}

/** The simulated districts, in `Id` order. */
export const simulatedDistricts = (ix: WorldIndex): DistrictIndex[] =>
  Object.values(ix.districts).filter((d) => d.simulated).sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

export const cmpIdStr = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
