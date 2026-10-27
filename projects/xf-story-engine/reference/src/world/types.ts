import type { WorldIndex } from '../sim/index-types.ts';

export type XY = [number, number];
export type XYZ = [number, number, number];
export interface Volume { poly: XY[]; zlo: number; zhi: number }
export interface PackArea extends Volume { id: string; name?: string; kind: string; parent?: string }
export interface W1Pack { schema: 'xfh/world-pack-1'; areas: PackArea[] }
export interface W1Record {
  kind: 'person' | 'vehicle' | 'other'; affiliationName?: string; affiliation?: string;
  role?: string; crowd?: boolean;
}
export interface W1Content {
  schema: 'xfh/world-content-1'; slice: { id: string; places: string[] };
  records: Record<string, W1Record>;
  communities: Array<{ id: string; entries: Array<{ name: string; record?: string; phases: Array<{ name: string; spots: string[] }> }> }>;
  spots: Array<{ id: string; at: XYZ; communities: string[] }>;
  pois: Array<{ id: string; at: XYZ; kind: string }>;
  spawners: unknown[];
}
export interface CellGeometry {
  key: string;
  grid?: [number, number];
  place?: string;
  name: string;
  volumes: Volume[];
  area: number;
  centre: XYZ;
}
export interface Binding { community: string; entry: string; spot: string }
export interface ImportedWorldIndex extends WorldIndex {
  worldImport: {
    schema: 'xf.s1-world-import@1'; gridMetres: 200;
    sources: { pack: string; content: string };
    districtPlaces: Record<string, string>;
    geometry: Record<string, CellGeometry>;
    bindings: Record<string, Binding[]>;
    /** Counts by original POI kind; never S1's fractional rate multiplier. */
    gameCoverageEvidence: Record<string, Record<string, number>>;
  };
}
export function importedWorld(index: WorldIndex): ImportedWorldIndex | undefined {
  const candidate = index as ImportedWorldIndex;
  return candidate.worldImport?.schema === 'xf.s1-world-import@1' ? candidate : undefined;
}
