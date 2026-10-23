import type { DigestBase, EventFact, Feed, Transition } from './occ.ts';
import type { Id } from '../types.ts';
export interface NormsDigest extends DigestBase {
  norms: Record<Id, Record<string, { priv: number; beh: number; perc: number; vis: number; gap: number }>>;
  facts: Feed<EventFact>;
  changes: Feed<Transition>;
}
