// S2 2.24: the implicit graph is a pure projection of a seed, never a matched instance.
import type { EventKindEntry } from '../event-kinds.ts';
import { atoms, bound, playOf } from './doc.ts';
import type { CompiledSeed, Fragment } from './types.ts';
import type { Juncture, Pattern, Vocabulary } from './pattern-types.ts';

/** Static fills applicable to a seed event declaration. State conditions remain world checks. */
export function declarationFills(event: import('./types.ts').SeedEventSpec, kind: EventKindEntry | undefined): Array<{ fn: string; args: Record<string, string> }> {
  const participants = event.participants ?? [];
  const role = (r: string): string | undefined => r === '@place' ? event.place : r === '@self' ? undefined
    : r.split('|').map((v) => participants.find((p) => p.role === v)?.who).find((v) => v !== undefined);
  return (kind?.fills ?? []).filter((f) => {
    const w = f.when;
    return (!w?.outcome || w.outcome.includes(event.outcome ?? 'done'))
      && (!w?.has || w.has.every((r) => !!role(r))) && (!w?.lacks || w.lacks.every((r) => !role(r)));
  }).map((f) => ({ fn: f.fn, args: Object.fromEntries(Object.entries(f.args).flatMap(([a, r]) => {
    const v = role(r); return v === undefined ? [] : [[a, v]];
  })) }));
}

export function implicitPattern(c: CompiledSeed, fragment: (ref: string) => Fragment | undefined,
  patterns: ReadonlyMap<string, Pattern>, vocabulary: Vocabulary | undefined,
  kind: (name: string) => EventKindEntry | undefined): { junctures: Record<string, Juncture>; edges: Pattern['edges']; outcomes: Pattern['outcomes']; abstraction: number } {
  const junctures: Record<string, Juncture> = {}, edges: Pattern['edges'] = [], outcomes: Pattern['outcomes'] = {};
  for (const [key, b] of Object.entries(c.beats)) {
    if (b.kind === 'texture') continue;
    const realises = c.realises?.find((r) => r.by === key), pattern = realises && patterns.get(realises.pattern),
      declared = realises && pattern?.junctures[realises.juncture];
    if (realises && declared) {
      junctures[key] = { fn: declared.fn, args: Object.fromEntries(Object.entries(declared.args).map(([a, v]) => [a, realises.binds[v] ?? v])) };
      continue;
    }
    const fs = playOf(b).refs.flatMap((r) => { const f = fragment(r); return f ? [f] : []; });
    const offer = fs.find((f) => f.offer)?.offer;
    if (offer) { junctures[key] = { fn: 'ask', args: { ...(offer.asker ? { by: offer.asker } : {}), of: 'v' } }; continue; }
    const fills = [...(b.leaves ?? []), ...fs.flatMap((f) => f.leaves ?? [])]
      .flatMap((e) => 'event' in e ? declarationFills(e.event, kind(e.event.kind)) : []);
    fills.sort((a, b) => (vocabulary?.tokenPrecedence.indexOf(a.fn) ?? 0) - (vocabulary?.tokenPrecedence.indexOf(b.fn) ?? 0));
    if (fills[0]) junctures[key] = structuredClone(fills[0]);
  }
  for (const [key, b] of Object.entries(c.beats)) {
    for (const l of b.links ?? []) if ('because' in l && junctures[key] && junctures[l.because])
      edges.push({ from: l.because, to: key, link: l.on && atoms(l.on).some(({ atom }) => 'response' in atom) ? 'answers' : 'because' });
    if (b.kind === 'exit') outcomes[key] = { reached: junctures[key] ? [key] : [], kind: 'resolved' };
  }
  outcomes.end = { reached: [], kind: 'resolved' };
  outcomes.unattended = { reached: [], kind: 'parked' };
  const roles = Object.values(c.roles), fillers = Object.values(junctures);
  const openRoles = roles.filter((r) => bound(r.identity).status !== 'fixed').length;
  // Every implicit filler names its authored beat; only role identities may be open.
  return { junctures, edges, outcomes, abstraction: openRoles / Math.max(1, roles.length + fillers.length) };
}
