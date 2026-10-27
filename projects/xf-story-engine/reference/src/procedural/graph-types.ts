import type { Id, Change } from '../types.ts';
import type { FillerRef } from '../sim/fillers.ts';
import type { Pattern, Vocabulary } from '../seeding/pattern-types.ts';
import type { SiftPattern } from './types.ts';
export interface MatchedFiller {
  ref: FillerRef; id: Id; fn: string; at: number; args: Record<string, Id>;
  source: 'found' | 'offered' | 'nudged' | 'constructed' | 'refined';
  by?: Id; causes?: Id[]; until?: number;
}
export interface JState {
  state: 'open' | 'ready' | 'pending' | 'matched' | 'refined' | 'foreclosed' | 'skipped';
  filler?: MatchedFiller; pending?: Id; readySince?: number; perceived?: { at: number; play: number };
}
/** Copied descriptors only. This is the graph portion of a pool entry. */
export interface GraphState {
  state: 'forming' | 'live' | 'aftermath' | 'resolved' | 'parked' | 'lapsed';
  junctures: Record<string, JState>;
  used: Array<{ occurrence: Id; fns: string[] }>;
  outcome?: { name: string; kind: 'resolved' | 'failed' | 'parked'; at: number; story: Id };
  armed?: { outcome: string; since: number };
  aftermathUntil?: number;
  depth: number;
  lineage: Id[];
  layers: Array<{ with: Id; juncture: string; filler: Id; cross?: { juncture: string; at: number } }>;
  closing?: 'needed' | 'sown' | 'none'; retired: boolean;
  seeds: Array<{ seed: Id; for: string }>;
  refusals: Record<string, { n: number; until: number }>;
  shown: Record<string, Array<{ channel: string; modality: string; at: number; play: number }>>;
}
export interface MatcherOccurrence { id: Id; at: number; change: Change }

/** The facade keeps the stage form's identity/kit fields while both forms use
 * the same pool and owner. No graph is converted into an ordered scene plot. */
export function patternDocument(p: Pattern): SiftPattern {
  const kind = (r: Pattern['roles'][string]): string => {
    const ks = Array.isArray(r.kind) ? r.kind : [r.kind];
    if (ks[0] === 'actor' || ks.every(k=>k==='person'||k==='group')) return ks.length===1&&ks[0]!=='actor'?`core:${ks[0]}`:'core:actor';
    if (ks.length > 1) return 'core:thing';
    return ks[0] === 'item' ? 'xf:item' : ks[0] === 'fact' ? 'core:thing' : `core:${ks[0]}`;
  };
  return { id: p.id, version: p.version, graph: structuredClone(p),
    roles: Object.fromEntries(Object.entries(p.roles).map(([v, r]) => [v, { kind: kind(r) }])),
    stages: [], within: p.within ? p.within.days * 86400 : undefined, once: p.once,
    tags: [], telling: p.tell ?? { form: 'rumour', binds: {} } };
}
export type { Pattern, Vocabulary, FillerRef };
