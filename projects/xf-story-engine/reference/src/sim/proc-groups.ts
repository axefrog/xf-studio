import type { DigestBase, Feed, Transition } from './occ.ts';
import type { Id } from '../types.ts';
export interface GroupDigest extends DigestBase {
  groups: Record<Id, { aff: string; U: Record<string, number>; W: Record<string, number>; D: number; intent: string; until?: number }>;
  boost: Record<Id, Record<number, Record<string, number>>>;
  pairBoost: Record<Id, Array<{ a: number; b: number; mult: number; until: number }>>;
  changes: Feed<Transition>;
}
