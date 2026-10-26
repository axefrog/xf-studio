import { expect } from 'bun:test';
import { world, event, type World } from './helpers.ts';
import { library, vocabulary } from './library.ts';
import type { Pattern } from '../../src/seeding/pattern-types.ts';
import type { EventView } from '../../src/procedural/types.ts';
import { patternDocument } from '../../src/procedural/graph-types.ts';
import { H, s } from '../../src/id.ts';
import type { FillDecl } from '../../src/event-kinds.ts';

export const graphPattern = (name: string): Pattern => structuredClone(library.find((p) => p.id === 'xf.composite:' + name)!);
export function graphWorld(name: string, patterns: Pattern[] = []) {
  const w = world(name, { patterns: [] });
  w.l2.reg.vocabulary = structuredClone(vocabulary);
  for (const p of library) w.l2.reg.patterns.set(p.id, structuredClone(p));
  const entries: Array<{ name: string; fills: FillDecl[] }> = [
    { name: 'favour', fills: [{ fn: 'help', args: { by: 'actor', to: 'target' } }, { fn: 'obligate', args: { debtor: 'target', creditor: 'actor' } }] },
    { name: 'demand', fills: [{ fn: 'demand', args: { by: 'actor', of: 'target', what: 'told' } }] },
    { name: 'payment', fills: [{ fn: 'repay', args: { debtor: 'actor', creditor: 'target' } }, { fn: 'comply', args: { who: 'actor', to: 'target' } }] },
    { name: 'wrong', fills: [{ fn: 'wrong', args: { by: 'actor', to: 'target' } }] },
    { name: 'guarded', fills: [{ fn: 'protect', args: { guard: 'actor', ward: 'target' } }] },
    { name: 'helped', fills: [{ fn: 'help', args: { by: 'actor', to: 'target' } }] },
    { name: 'wanted', fills: [{ fn: 'want', args: { who: 'actor', what: 'told' } }] },
    { name: 'shakedown', fills: [{ fn: 'demand', args: { by: 'actor', of: 'target' } }, { fn: 'comply', args: { who: 'target', to: 'actor' } }, { fn: 'wrong', args: { by: 'actor', to: 'target' } }] },
    { name: 'confront', fills: [{ fn: 'threaten', args: { by: 'actor', to: 'target' } }] },
    { name: 'decide.punish', fills: [{ fn: 'decide', args: { group: 'actor', what: 'target' } }] },
    { name: 'warning', fills: [{ fn: 'threaten', args: { by: 'actor', to: 'target' } }] },
    { name: 'price', fills: [{ fn: 'threaten', args: { by: 'actor', to: 'target' } }] },
  ];
  for (const entry of entries) w.k.eventKinds.register({ ...entry, producers: ['port'], roles: ['actor', 'target', 'told'] });
  // The library fixture supplies producers for its named kinds; this does not replace S1's registry in an attached simulation.
  const namedKinds = library.flatMap((p) => Object.values(p.junctures).flatMap((j) => {
    const fill = j.fill;
    const values = Array.isArray(fill) ? fill : fill && 'fixed' in fill ? fill.fixed : [];
    return values.flatMap((f) => 'kinds' in f ? f.kinds : []);
  }));
  for (const name of new Set(namedKinds)) if (!w.k.eventKinds.eventKind(name)) w.k.eventKinds.register({ name, producers: ['fixture'], fills: [] });
  for (const [dimName, values] of [['core:event-kind', entries.map((e) => e.name)], ['core:participant-role', ['told']]] as Array<[string,string[]]>) {
    const dim = w.k.schema.dims.get(dimName)!; if (dim.value.t === 'enum') dim.value.values = [...new Set([...dim.value.values, ...values])];
  }
  w.l3.data.sifter.relevanceGate = false;
  const findings = w.l3.installPatterns(patterns);
  expect(findings.filter((f) => f.level === 'error')).toEqual([]);
  return w;
}
export function emit(w: World, kind: string, time: number, extra: Partial<EventView> = {}): EventView {
  const ev = event(w, `${kind}:${time}:${w.l3.state.nextSeq}`, kind, time, extra);
  for (const p of w.l3.sifter.patterns.values()) if (p.graph) w.l3.sifter.onEvent(p, ev);
  return ev;
}
export function simple(over: Partial<Pattern> = {}): Pattern {
  return { id: 'xf.test:chain', version: 1, family: 'tension', use: 'authored', scale: 'situation', roles: { '?a': { kind: 'person' }, '?b': { kind: 'person' } },
    entry: ['first'], junctures: { first: { fn: 'wrong', args: { by: '?a', to: '?b' } }, second: { fn: 'help', args: { by: '?b', to: '?a' }, realise: [{ wait: true }] } },
    edges: [{ from: 'first', to: 'second', link: 'because' }], outcomes: { done: { reached: ['second'], kind: 'resolved' } },
    show: { junctures: ['first'], edges: 0 }, within: { clock: 'game', days: 2 }, ...over };
}
export function perceive(w: World, node = w.a): string {
  const ev = w.k.events.mintEvent({ creator: w.v, cause: H(s('met')), name: 'met:' + node, kind: 'generic', time: 0, participants: [{ who: w.v, role: 'actor' }, { who: node, role: 'target' }] });
  w.k.events.makeCanon(ev, 'observed', w.v);
  return ev;
}
export { patternDocument };
