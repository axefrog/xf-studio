// S2 owns these declarations, including when S1 installs its world first.
import type { EventKindEntry } from '../event-kinds.ts';
export const SEED_KINDS: EventKindEntry[] = [
  { name: 'offer', tags: [], producers: ['s2'], roles: ['asker', 'protagonist'], fills: [{ fn: 'ask', args: { by: 'asker', of: 'protagonist' } }] },
  { name: 'response', tags: [], producers: ['s2'], roles: ['protagonist', 'asker'], fills: [
    { fn: 'comply', args: { who: 'protagonist', to: 'asker' }, when: { stance: ['help', 'bargain'] } },
    { fn: 'refuse', args: { who: 'protagonist', to: 'asker' }, when: { stance: ['refuse', 'oppose', 'decline'] } },
    { fn: 'choose', args: { who: 'protagonist' }, when: { stance: ['help', 'bargain', 'refuse', 'oppose', 'ignore'] } },
  ] },
  { name: 'promise', tags: ['news'], producers: ['s2'], roles: ['promiser', 'promisee', 'subject'], fills: [
    { fn: 'obligate', args: { debtor: 'promiser', creditor: 'promisee' } },
    { fn: 'bind', args: { a: 'promiser', b: 'promisee' } },
  ] },
  { name: 'seed-outcome', tags: [], producers: ['s2'], roles: ['participant'], fills: [] },
];
