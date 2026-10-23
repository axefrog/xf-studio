import type { DigestBase, EventFact, Feed } from './occ.ts';
import type { Id } from '../types.ts';
export interface MirrorDigest extends DigestBase {
  cover: Array<{ kind: string; cell?: Id; district: Id; since: number }>;
  facts: Feed<EventFact>;
  counters: Record<Id, { gig: number; hustle: number; failed: number }>;
}
