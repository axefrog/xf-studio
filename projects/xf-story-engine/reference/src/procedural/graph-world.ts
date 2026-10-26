// Copied evidence and bounded reads for the graph matcher. World writes stay in S2.
import { H, id, s } from '../id.ts';
import type { Kernel } from '../kernel.ts';
import type { Change, Id } from '../types.ts';
import type { Layer2 } from '../seeding/layer2.ts';
import type { PatternWorldPort, Vocabulary } from '../seeding/pattern-types.ts';
import type { FillerRef, MatchedFiller } from './graph-types.ts';
import type { EventView, KernelView } from './types.ts';
import { cmp } from './keys.ts';
import { agentRoles } from '../seeding/actors.ts';

export function fillerId(ref: FillerRef): Id {
  if ('event' in ref) return ref.event;
  const [form, value] = Object.entries(ref)[0];
  const fields = typeof value === 'string' ? [value] : Object.values(value) as string[];
  // S1's synthetic membership edge names are regenerable addresses, not Ids.
  return H(s('filler'), s(form), ...fields.map((v) => /^[0-9a-f]{32}$/.test(v) ? id(v) : s(v)));
}

export class GraphWorld {
  constructor(readonly k: Kernel, readonly l2: Layer2, readonly view: KernelView, readonly vocabulary: Vocabulary) {}
  acts(event: EventView, actor: Id): boolean {
    const roles = agentRoles(this.l2, event.kind);
    return event.participants.some((p) => p.who === actor && roles.includes(p.role));
  }
  rules(fn: string): ReturnType<PatternWorldPort['stateRules']> {
    return (this.l2.reg.patternWorld?.stateRules(fn) ?? []).filter((r) => r.durable === true).sort((a, b) => cmp(a.id, b.id));
  }
  source(event: EventView): Pick<MatchedFiller, 'source' | 'by'> {
    let seed = this.l2.instance(event.creator);
    let frame = event.served;
    const visited = new Set<string>();
    while (!seed && frame && visited.size < 8 && !visited.has(frame)) {
      visited.add(frame); this.k.persistence.recoverIfSaved(frame);
      const f = this.k.frames.frame(frame);
      if (!f) break;
      seed = this.l2.instance(f.cause) ?? this.l2.instance(f.origin) ?? this.l2.instance(f.actor);
      frame = f.parents[0]?.frame ?? f.cause;
    }
    if (!seed) return { source: 'found' };
    if (seed.st.document.nudge) return { source: 'nudged', by: seed.id };
    if (seed.st.source.by === 'director' && seed.st.document.growsFrom && typeof seed.st.document.growsFrom === 'object'
      && 'instance' in seed.st.document.growsFrom) return { source: 'offered', by: seed.id };
    return { source: 'found', by: seed.id };
  }
  eventFills(event: EventView): MatchedFiller[] {
    const value = (r: string): string | undefined => r === '@self' ? event.id : r === '@place' ? event.place
      : r.split('|').map((role) => event.participants.find((p) => p.role === role)?.who).find((x) => x !== undefined);
    const result: MatchedFiller[] = [];
    const response = event.kind === 'response' ? this.l2.responseOf(event.id) : undefined;
    const stance = response?.kind.startsWith('decline:') ? 'decline' : response?.stance;
    for (const f of this.k.eventKinds.eventKind(event.kind)?.fills ?? []) {
      const w = f.when;
      if (w?.outcome && !w.outcome.includes(event.outcome ?? 'done')) continue;
      if (w?.has?.some((r) => !value(r)) || w?.lacks?.some((r) => !!value(r))) continue;
      if (w?.stance && (!stance || !w.stance.includes(stance))) continue;
      const args = Object.fromEntries(Object.entries(f.args).flatMap(([a, r]) => { const n = value(r); return n ? [[a, n]] : []; }));
      if (w?.state) {
        const bound = Object.fromEntries(Object.entries(w.state.args).flatMap(([a, r]) => { const n = value(r); return n ? [[a, n]] : []; }));
        if (!this.stateHolds(w.state.fn, bound, event.time)) continue;
      }
      result.push({ ref: { event: event.id }, id: event.id, fn: f.fn, at: event.time, args, causes: event.causes.slice(), ...this.source(event) });
    }
    if (event.kind === 'seed-outcome') for (const f of this.l2.realisedBy(event.id))
      result.push({ ref: { event: event.id }, id: event.id, fn: f.fn, at: event.time, args: f.args, causes: event.causes.slice(), ...this.source(event) });
    if (event.kind === 'meta:story' && typeof event.data?.pattern === 'string' && typeof event.data.outcome === 'string')
      result.push({ ref: { event: event.id }, id: event.id, fn: 'story', at: event.time,
        args: { pattern: event.data.pattern, outcome: event.data.outcome }, causes: event.causes.slice(), source: 'found' });
    for (const who of event.witnesses) result.push({ ref: { event: event.id }, id: event.id, fn: 'learn', at: event.time,
      args: { who, what: event.id }, causes: event.causes.slice(), source: 'found' });
    return result;
  }
  stateFills(functions: string[], change: Change): MatchedFiller[] {
    return [...new Set(functions)].flatMap((fn) => this.rules(fn).flatMap((r) => r.fromChange(change).map((f) => ({
      ref: structuredClone(f.filler), id: fillerId(f.filler), fn, at: f.at, args: { ...f.args }, causes: f.causes.slice(0, 8), source: 'found' as const,
    }))));
  }
  stateHolds(fn: string, args: Record<string, string>, at: number): boolean {
    const searchable = this.vocabulary.functions[fn]?.searchFrom ?? [];
    const arg = Object.keys(this.vocabulary.functions[fn]?.args ?? {}).find((a) => args[a] && searchable.includes(a));
    if (!arg) return false;
    return this.rules(fn).some((r) => r.search(arg, args[arg], at, 8).fills.some((f) =>
      Object.entries(args).every(([a, n]) => f.args[a] === n) && r.holdsAt(f.filler, at) === 'yes'));
  }
  causes(f: MatchedFiller): Id[] {
    return f.causes?.slice() ?? ('event' in f.ref ? this.view.event(f.ref.event)?.causes.slice() ?? [] : []);
  }
  walk(f: MatchedFiller, target: Id, hops: number, max: number): boolean {
    const seen = new Set<Id>([f.id]), queue = this.causes(f).map((n) => ({ n, depth: 1 }));
    while (queue.length && seen.size < max) {
      const { n, depth } = queue.shift()!;
      if (depth > hops || seen.has(n)) continue;
      if (n === target) return true;
      seen.add(n);
      if (depth < hops) for (const cause of this.view.event(n)?.causes ?? []) queue.push({ n: cause, depth: depth + 1 });
    }
    return false;
  }
  relation(name: string, args: string[], at: number): 'yes' | 'no' | 'maybe' {
    if (name === 'distinct') return args[0] !== args[1] ? 'yes' : 'no';
    if (name === 'known-to-protagonist') return this.l2.exposedNode(args[0], 'presented') ? 'yes' : 'no';
    if (name === 'knows' || name === 'unaware') {
      const knows = this.k.beliefs.knows(args[0], args[1], 'kind', at).k !== 'unknown';
      return (name === 'knows' ? knows : !knows) ? 'yes' : 'no';
    }
    if (name === 'witnessed') return this.view.event(args[1])?.witnesses.includes(args[0]) ? 'yes' : 'no';
    if (name === 'observed-act') {
      const e = this.view.event(args[0]);
      return e && e.witnesses.length && this.acts(e, args[1]) ? 'yes' : 'no';
    }
    if (name === 'outcome-kind') return this.view.event(args[0])?.data?.kind === args[1] ? 'yes' : 'no';
    if (name === 'irreversible') return this.view.event(args[0])?.effects.some((e) => ['kill', 'expose'].includes(e.effect)) ? 'yes' : 'no';
    if (name === 'at') {
      const e = this.view.event(args[0]);
      if (e?.place) return e.place === args[1] ? 'yes' : 'no';
      const place = this.k.value(args[0], 'where', at);
      if (typeof place === 'string') return place === args[1] ? 'yes' : 'no';
    }
    if (name === 'member' || name === 'leads') {
      this.k.persistence.recoverIfSaved(args[0], args[1]);
      const type = name === 'member' ? 'core:member-of' : 'xf:leads';
      if (this.k.store.edgesFrom(args[0]).some((e) => e.type === type && e.to === args[1]
        && e.valid.from <= at && (e.valid.to === undefined || at < e.valid.to))) return 'yes';
    }
    return this.l2.reg.patternWorld?.relation?.(name, args, at) ?? 'maybe';
  }
  relationSearch(name: string, bound: Record<string, string>, at: number, limit: number): { tuples: Array<{ id: Id; args: Record<string, string> }>; truncated: boolean } {
    if (this.l2.reg.patternWorld?.relationSearch) return this.l2.reg.patternWorld.relationSearch(name, bound, at, limit);
    const type = name === 'member' ? 'core:member-of' : name === 'leads' ? 'xf:leads' : undefined;
    if (!type) return { tuples: [], truncated: false };
    const node = bound.who ?? bound.group;
    if (!node) return { tuples: [], truncated: false };
    this.k.persistence.recoverIfSaved(node);
    const edges = (bound.who ? this.k.store.edgesFrom(node) : this.k.store.edgesTo(node)).filter((e) => e.type === type
      && e.valid.from <= at && (e.valid.to === undefined || at < e.valid.to)).sort((a, b) => cmp(a.id, b.id));
    const rows = edges.filter((e) => (!bound.who || e.from === bound.who) && (!bound.group || e.to === bound.group));
    return { tuples: rows.slice(0, limit).map((e) => ({ id: e.id, args: { who: e.from, group: e.to } })), truncated: rows.length > limit };
  }
}
