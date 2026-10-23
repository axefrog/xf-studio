// Consumed events (S2 section 2.14): `count` atoms read only events layer 2 has consumed. When a relevance
// event reports a canon event that matches a count pattern, layer 2 commits every field the pattern used
// (so the match can never change on a reload) and records the consumption per subscription: the event's Id,
// its time and the cast binding used. Each is recorded once and never recomputed.

import { fragmentSites, predSites, atoms } from './doc.ts';
import { eventFacts, matchPattern, patternFields, subKey } from './eval.ts';
import type { Instance, Layer2 } from './layer2.ts';
import type { EventPattern } from './types.ts';
import type { Id } from '../types.ts';

const cache = new WeakMap<object, EventPattern[]>();

/** The distinct count patterns of an instance: its subscriptions. */
export function countPatterns(inst: Instance): EventPattern[] {
  const hit = cache.get(inst.st.document);
  if (hit) return hit;
  const seen = new Map<string, EventPattern>();
  const sites = [...predSites(inst.st.document), ...inst.st.closure.fragments.flatMap((f) => fragmentSites(f))];
  for (const s of sites) for (const { atom } of atoms(s.pred)) if ('count' in atom) seen.set(subKey(atom.count), atom.count);
  const out = [...seen.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1)).map((e) => e[1]);
  cache.set(inst.st.document, out);
  return out;
}

export function consumeEvent(l2: Layer2, inst: Instance, event: Id): void {
  const pats = countPatterns(inst);
  if (pats.length === 0) return;
  const facts = eventFacts(l2, event);
  if (!facts) return;
  for (const pat of pats) {
    const key = subKey(pat);
    if (inst.st.consumed.some((c) => c.sub === key && c.event === event)) continue;
    const used = matchPattern(l2, inst, pat, facts, true);
    if (!used) continue;
    // Commit every field the pattern read, so the match can never change on a reload (S0 section 9.2).
    l2.k.events.makeCanon(event, 'committed', inst.id, patternFields(pat));
    inst.st.consumed.push({ sub: key, event, at: facts.time, cast: used });
  }
}
