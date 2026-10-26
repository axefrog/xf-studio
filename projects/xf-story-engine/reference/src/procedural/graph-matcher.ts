// Graph advancement is owned by the sifter, over copied pool entries and bounded world reads.
import type { Change, Id, Selector } from '../types.ts';
import type { Pattern, Juncture, RelReq } from '../seeding/pattern-types.ts';
import { bound } from '../seeding/doc.ts';
import { actingArgument } from '../seeding/pattern-lint.ts';
import { fillerId, GraphWorld } from './graph-world.ts';
import { linkHolds } from './graph-links.ts';
import type { MatchedFiller, GraphState } from './graph-types.ts';
import type { EventView, PoolEntry, SiftPattern } from './types.ts';
import type { Sifter } from './sifter.ts';
import { cmp } from './keys.ts';

export class GraphMatcher {
  constructor(readonly owner: Sifter) {}
  get world(): GraphWorld { return new GraphWorld(this.owner.k, this.owner.l2, this.owner.view, this.owner.l2.reg.vocabulary ?? { functions: {}, relations: {}, tokenPrecedence: [] }); }
  private value(term: string, binds: Record<string, Id>, e?: PoolEntry): string | undefined {
    return term === 'v' ? this.owner.k.vId : term.startsWith('?') ? binds[term] : e?.graph?.junctures[term]?.filler?.id ?? term;
  }
  private accepts(p: Pattern, variable: string, value: string, binds: Record<string, Id>, at: number): boolean {
    if (binds[variable] !== undefined && binds[variable] !== value) return false;
    const role = p.roles[variable];
    if (!role || (value === this.owner.k.vId && role.v !== 'may')) return false;
    const fixed = bound(role.identity);
    if (fixed.status === 'fixed' && fixed.value && this.owner.k.expandId(fixed.value === 'v' ? 'root:v' : fixed.value) !== value) return false;
    const kind = this.owner.view.kind(value), ks = Array.isArray(role.kind) ? role.kind : [role.kind];
    if (!kind || !ks.some((k) => k === 'actor' ? ['core:person', 'core:group'].some((x) => this.owner.view.isKind(kind, x))
      : k === 'fact' ? true : this.owner.view.isKind(kind, k === 'item' ? 'xf:item' : `core:${k}`))) return false;
    binds[variable] = value;
    return this.requirements(p, role.must ?? [], binds, at);
  }
  private requirements(p: Pattern, reqs: RelReq[], binds: Record<string, Id>, at: number, e?: PoolEntry): boolean {
    return !reqs.length || this.require(p, reqs[0], binds, at, e, () => this.requirements(p, reqs.slice(1), binds, at, e));
  }
  private require(p: Pattern, req: RelReq, binds: Record<string, Id>, at: number, e?: PoolEntry, next: () => boolean = () => true): boolean {
    if ('not' in req) {
      const inner = req.not;
      return 'rel' in inner && inner.args.every((a) => this.value(a, binds, e) !== undefined)
        && this.world.relation(inner.rel, inner.args.map((a) => this.value(a, binds, e)!), at) === 'no' && next();
    }
    const values = req.args.map((a) => this.value(a, binds, e));
    if (values.every((v) => v !== undefined)) return this.world.relation(req.rel, values as string[], at) === 'yes' && next();
    const spec = this.world.vocabulary.relations[req.rel];
    if (!spec) return false;
    const query = Object.fromEntries(spec.args.flatMap((a, i) => values[i] === undefined ? [] : [[a, values[i]!]]));
    if (!spec.args.some((a) => query[a] && spec.searchFrom?.includes(a))) return false;
    const result = this.world.relationSearch(req.rel, query, at, this.owner.data.sifter.stateCandidates);
    if (result.truncated) this.owner.log('match', 'query-truncated', { relation: req.rel });
    for (const tuple of result.tuples.slice().sort((a, b) => cmp(a.id, b.id)).slice(0, this.owner.data.sifter.stateCandidates)) {
      const trial = { ...binds };
      if (req.args.every((term, i) => values[i] !== undefined ? tuple.args[spec.args[i]] === values[i]
        : this.accepts(p, term, tuple.args[spec.args[i]], trial, at))) {
        const prior = { ...binds }; Object.assign(binds, trial);
        if (next()) return true;
        for (const key of Object.keys(binds)) delete binds[key]; Object.assign(binds, prior);
      }
    }
    return false;
  }
  private test(p: Pattern, j: Juncture, f: MatchedFiller, binds: Record<string, Id>, e?: PoolEntry): Record<string, Id> | null {
    if (f.fn !== j.fn || ((j.form ?? this.world.vocabulary.functions[j.fn]?.form) === 'event' && !('event' in f.ref) && !('dilemma' in f.ref))) return null;
    const out = { ...binds };
    for (const [arg, term] of Object.entries(j.args)) {
      if (term === 'any' || term === '*') continue;
      const n = f.args[arg];
      // A named juncture denotes the subject of a state, rather than an extra role.
      if (!n && !term.startsWith('?') && term !== 'v' && p.junctures[term]) continue;
      if (!n || (term.startsWith('?') ? !this.accepts(p, term, n, out, f.at) : this.value(term, out, e) !== n)) return null;
    }
    const act = actingArgument(j, this.world.vocabulary);
    if (act && f.args[act] === this.owner.k.vId && f.fn !== 'learn') {
      const event = 'event' in f.ref ? this.owner.view.event(f.ref.event) : undefined;
      if (!event || !this.world.acts(event, this.owner.k.vId)) return null;
    }
    if (!this.requirements(p, j.requires ?? [], out, f.at, e)) return null;
    const fill = bound(j.fill), ev = 'event' in f.ref ? this.owner.view.event(f.id) : undefined;
    if (fill.status === 'fixed' && fill.value && !fill.value.some((x) => {
      if ('kinds' in x) return !!ev && x.kinds.includes(ev.kind);
      if ('tags' in x) return !!ev && x.tags.some((t) => this.owner.view.eventKind(ev.kind)?.tags.includes(t));
      if ('seed' in x) { const by = this.owner.l2.mintedBy(f.id); return !!by && this.owner.l2.instance(by.seed)?.st.template.id === x.seed && by.by === x.by; }
      return ev?.data?.pattern === x.pattern && (!x.outcome || x.outcome === '*' || ev.data.outcome === x.outcome);
    })) return null;
    if (j.fn === 'story') {
      if (!ev || ev.data?.pattern === p.id || Number(ev.data?.depth ?? 1) >= this.owner.data.sifter.lineageDepth) return null;
      const seen = new Set<string>(), walk = [ev];
      while (walk.length && seen.size < this.owner.data.sifter.causeWalkMax) {
        const next = walk.shift()!;
        if (seen.has(next.id)) continue;
        seen.add(next.id);
        if (next.data?.pattern === p.id) return null;
        for (const id of next.causes) { const c = this.owner.view.event(id); if (c?.kind === 'meta:story') walk.push(c); }
      }
      for (const [role, variable] of Object.entries(j.binds ?? {})) {
        const person = role === 'anyParticipant' ? ev.participants.find((x) => this.owner.view.isKind(this.owner.view.kind(x.who) ?? '', 'core:person'))
          : ev.participants.find((x) => x.role === role.replace(/^\?/, ''));
        if (!person || !this.accepts(p, variable, person.who, out, f.at)) return null;
      }
    }
    return out;
  }
  private join(p: Pattern, key: string, e: PoolEntry, f?: MatchedFiller): boolean {
    const j = p.junctures[key], g = e.graph!;
    const incoming = p.edges.filter((x) => x.to === key && x.link !== 'forecloses');
    const holds = (edge: typeof incoming[number]) => {
      const earlier = g.junctures[edge.from]?.filler;
      return !!earlier && (!f || linkHolds(this.world, edge.link, earlier, f, j, this.owner.data.sifter, e));
    };
    if (!incoming.length) return true;
    if (j.join === 'any') return incoming.some(holds);
    if (j.join && typeof j.join === 'object') return j.join.all.every((a) => incoming.filter((x) => x.from === a).every(holds))
      && (!j.join.any.length || incoming.some((x) => j.join && typeof j.join === 'object' && j.join.any.includes(x.from) && holds(x)));
    return incoming.every(holds);
  }
  private ready(p: Pattern, e: PoolEntry, at: number): void {
    for (const [key, state] of Object.entries(e.graph!.junctures)) if (['open', 'ready'].includes(state.state)) {
      if (this.join(p, key, e)) { state.state = 'ready'; state.readySince ??= at; }
      else state.state = 'open';
    }
  }
  private match(p: Pattern, key: string, e: PoolEntry, f: MatchedFiller, entry = false): boolean {
    if (e.graph!.used.some((u) => u.occurrence === f.id && u.fns.includes(f.fn))) return false;
    const g = e.graph!, j = p.junctures[key], binds = this.test(p, j, f, e.bindings, e);
    if (!binds) return false;
    if (!entry && !this.join(p, key, e, f)) { this.owner.log('match', 'near-miss', { instance: e.id, juncture: key }); return false; }
    if (!entry) for (const edge of p.edges.filter((x) => x.to === key && x.link !== 'forecloses')) {
      const source = g.junctures[edge.from].filler;
      if (source && !linkHolds(this.world, edge.link, source, f, j, this.owner.data.sifter, e))
        this.owner.log('match', 'unborne', { instance: e.id, from: edge.from, to: key });
    }
    if (entry && p.edges.some((edge) => edge.to === key && edge.link !== 'forecloses' && g.junctures[edge.from].filler
      && (!j.join || j.join === 'all' || typeof j.join === 'object' && j.join.all.includes(edge.from))
      && !linkHolds(this.world, edge.link, g.junctures[edge.from].filler!, f, j, this.owner.data.sifter, e))) return false;
    for (const edge of p.edges.filter((x) => x.from === key && x.link !== 'forecloses')) {
      const target = g.junctures[edge.to]?.filler;
      if (!target || linkHolds(this.world, edge.link, f, target, p.junctures[edge.to], this.owner.data.sifter, e)) continue;
      const join = p.junctures[edge.to].join;
      if (!join || join === 'all' || (typeof join === 'object' && join.all.includes(key))) return false;
      this.owner.log('match', 'unborne', { instance: e.id, from: key, to: edge.to });
    }
    e.bindings = binds;
    g.junctures[key] = { ...g.junctures[key], state: 'matched', filler: structuredClone(f), pending: undefined };
    let used = g.used.find((u) => u.occurrence === f.id);
    if (!used) { used = { occurrence: f.id, fns: [] }; g.used.push(used); }
    if (!used.fns.includes(f.fn)) used.fns.push(f.fn);
    if ('event' in f.ref && !e.stages.some((x) => x.event === f.id)) e.stages.push({ event: f.id, time: f.at });
    e.lastTime = Math.max(e.lastTime, f.at);
    if (j.fn === 'story') g.depth = Math.max(g.depth, Number(this.owner.view.event(f.id)?.data?.depth ?? 1) + 1);
    for (const edge of p.edges.filter((x) => x.from === key && x.link === 'forecloses')) g.junctures[edge.to].state = 'foreclosed';
    this.layers(e, key, f);
    this.ready(p, e, f.at);
    this.owner.log('match', f.source === 'nudged' || f.source === 'constructed' ? 'adaptation' : 'consequence',
      { instance: e.id, juncture: key, source: f.source }, [f.id]);
    this.outcomes(p, e, f.at);
    return true;
  }
  private layers(e: PoolEntry, key: string, f: MatchedFiller): void {
    const cap = this.owner.data.sifter.maxLayers;
    for (const other of this.owner.state().pool.filter((o) => o.id !== e.id && o.graph && !o.graph.retired)) {
      const shared = Object.values(other.graph!.junctures).some((j) => j.filler?.id === f.id);
      if (shared) {
        for (const [a, b] of [[e, other], [other, e]]) if (a.graph!.layers.length < cap
          && !a.graph!.layers.some((l) => l.with === b.id && l.filler === f.id))
          a.graph!.layers.push({ with: b.id, juncture: key, filler: f.id });
      }
      if (e.graph!.layers.some((l) => l.with === other.id) && Object.values(other.graph!.junctures).some((j) =>
        j.filler && this.world.walk(f, j.filler.id, this.owner.data.sifter.causeHops, this.owner.data.sifter.causeWalkMax))) {
        for (const [a, b] of [[e, other], [other, e]]) for (const layer of a.graph!.layers.filter((l) => l.with === b.id)) layer.cross ??= { juncture: key, at: f.at };
      }
    }
  }
  private queries(p: Pattern, e: PoolEntry, at: number): void {
    for (let pass = 0; pass < this.owner.data.sifter.maxJunctures; pass++) {
      if (!['forming', 'live'].includes(e.graph!.state)) return;
      let advanced = false;
      for (const [key, j] of Object.entries(p.junctures).sort(([a], [b]) => cmp(a, b))) {
        if (e.graph!.junctures[key].filler || ['foreclosed', 'skipped'].includes(e.graph!.junctures[key].state)
          || (j.form ?? this.world.vocabulary.functions[j.fn]?.form) !== 'state') continue;
        const args = Object.fromEntries(Object.entries(j.args).flatMap(([a, t]) => { const n = this.value(t, e.bindings, e); return n && (t.startsWith('?') || t === 'v') ? [[a, n]] : []; }));
        const searchArg = Object.keys(this.world.vocabulary.functions[j.fn]?.args ?? {}).find((a) => args[a] && this.world.vocabulary.functions[j.fn]?.searchFrom?.includes(a));
        if (!searchArg) continue;
        for (const rule of this.world.rules(j.fn)) {
          const result = rule.search(searchArg, args[searchArg], at, this.owner.data.sifter.stateCandidates);
          this.owner.work++;
          if (result.truncated) this.owner.log('match', 'query-truncated', { instance: e.id, function: j.fn });
          for (const s of result.fills.slice().sort((a, b) => cmp(fillerId(a.filler), fillerId(b.filler)))) {
            const f: MatchedFiller = { ref: s.filler, id: fillerId(s.filler), at: s.at, fn: j.fn, args: s.args, causes: s.causes.slice(0, 8), source: 'found' };
            if (this.match(p, key, e, f, true)) { advanced = true; break; }
          }
          if (e.graph!.junctures[key].filler) break;
        }
      }
      if (!advanced) break;
    }
  }
  private advance(p: Pattern, e: PoolEntry, fills: MatchedFiller[], at: number): void {
    const g = e.graph!;
    for (let pass = 0; pass < this.owner.data.sifter.maxFills; pass++) {
      let advanced = false;
      for (const key of Object.keys(p.junctures).sort(cmp)) {
        if (!['ready', 'pending'].includes(g.junctures[key].state)) continue;
        if (g.state === 'aftermath' && !p.outcomes[g.outcome!.name]?.aftermath?.junctures.includes(key)) continue;
        for (const f of fills) {
          if (g.used.find((u) => u.occurrence === f.id)?.fns.includes(f.fn)) continue;
          this.owner.work++;
          if (this.match(p, key, e, f)) { advanced = true; break; }
        }
        if (advanced) break;
      }
      if (!advanced || !['forming', 'live', 'aftermath'].includes(g.state)) break;
    }
    if (['forming', 'live'].includes(g.state)) this.queries(p, e, at);
    this.promote(p, e);
  }
  private promote(p: Pattern, e: PoolEntry): void {
    const g = e.graph!;
    if (g.state !== 'forming' || p.family === 'shape') return;
    if (Object.values(g.junctures).filter((j) => j.filler).length > 1 || Object.values(e.bindings).some((n) => this.owner.l2.exposedNode(n, 'presented'))) g.state = 'live';
  }
  private fix(p: Pattern, e: PoolEntry, name: string, at: number): void {
    const g = e.graph!;
    if (g.outcome) return;
    const outcome = p.outcomes[name], kind = outcome?.kind ?? 'parked';
    const causes = [...new Set(Object.values(g.junctures).flatMap((j) => j.filler ? 'event' in j.filler.ref ? [j.filler.id] : j.filler.causes ?? [] : []))]
      .filter((n) => !!this.owner.view.event(n)).slice(0, this.owner.data.sifter.maxJunctures);
    const story = this.owner.k.events.mintEvent({ creator: this.owner.keys.director, cause: e.id, name: 'meta:story', time: at,
      kind: 'meta:story', participants: Object.keys(e.bindings).sort(cmp).map((v) => ({ who: e.bindings[v], role: v.slice(1) })),
      effects: [], causes, witnesses: [], data: { pattern: p.id, instance: e.id, outcome: name, kind, depth: g.depth } });
    g.outcome = { name, kind, at, story }; g.armed = undefined; e.story = story; e.complete = true;
    g.state = outcome?.aftermath ? 'aftermath' : kind === 'parked' ? 'parked' : 'resolved';
    if (outcome?.aftermath) g.aftermathUntil = at + (outcome.aftermath.days ?? this.owner.data.sifter.aftermathDays) * 86400;
    const seen = Object.values(g.junctures).some((j) => j.perceived);
    const aware = this.owner.countsAsThread?.(e) ?? seen;
    g.closing = aware && (name === '@parked' || !(outcome?.reached ?? []).every((key) => g.junctures[key].perceived)) ? 'needed' : 'none';
    this.owner.tombstone(this.owner.patterns.get(p.id)!, e, e.lastTime + this.owner.data.sifter.tombstoneSpans * this.owner.within(this.owner.patterns.get(p.id)!));
    this.owner.log('match', 'match-complete', { instance: e.id, outcome: name, story }, causes);
    // Director stories are inert to S1, but are ordinary buffered input for story junctures.
    for (const target of this.owner.patterns.values()) if (target.graph && Object.values(target.graph.junctures).some((j) => j.fn === 'story')) {
      const event = this.owner.view.event(story)!;
      if (!this.owner.state().buffer.some((b) => b.pattern === target.id && b.event.id === story))
        this.owner.state().buffer.push({ pattern: target.id, version: target.version, event });
    }
  }
  private outcomes(p: Pattern, e: PoolEntry, at: number): void {
    const g = e.graph!;
    if (g.outcome) {
      if (g.state === 'aftermath' && p.outcomes[g.outcome.name]?.aftermath?.junctures.every((k) => g.junctures[k].filler))
        g.state = g.outcome.kind === 'parked' ? 'parked' : 'resolved';
      return;
    }
    for (const [name, o] of Object.entries(p.outcomes)) if (o.reached.every((k) => g.junctures[k].filler)
      && (o.foreclosed ?? []).every((k) => g.junctures[k].state === 'foreclosed')) {
      if (o.after) g.armed ??= { outcome: name, since: at };
      else { this.fix(p, e, name, at); return; }
    }
  }
  private end(p: Pattern, e: PoolEntry, at: number): void {
    if (Object.values(e.graph!.junctures).some((j) => j.perceived)) this.fix(p, e, '@parked', at);
    else { e.graph!.state = 'lapsed'; e.graph!.closing = 'none'; }
    for (const [key, j] of Object.entries(p.junctures)) if (j.optional && !e.graph!.junctures[key].filler) e.graph!.junctures[key].state = 'skipped';
    this.owner.tombstone(this.owner.patterns.get(p.id)!, e, at + this.owner.data.sifter.tombstoneSpans * this.owner.within(this.owner.patterns.get(p.id)!));
  }
  selectors(p: Pattern): Selector[] {
    const junctures = [...Object.values(p.junctures), ...(p.unless ?? []).map((u) => u.juncture)];
    const fns = new Set(junctures.map((j) => j.fn));
    const names = this.owner.view.eventKinds().filter((kind) => this.owner.k.eventKinds.eventKind(kind)?.fills?.some((f) => fns.has(f.fn)));
    for (const j of junctures) for (const f of bound(j.fill).value ?? []) {
      if ('kinds' in f) names.push(...f.kinds);
      if ('tags' in f) names.push(...this.owner.view.eventKinds().filter((k) => f.tags.some((t) => this.owner.view.eventKind(k)?.tags.includes(t))));
    }
    names.push('seed-outcome');
    names.push(...this.owner.view.eventKinds().filter((kind) => kind === 'game.death' || this.owner.k.eventKinds.eventKind(kind)?.tags.includes('death')));
    if (fns.has('story')) names.push('meta:story');
    return [...new Set(names)].sort(cmp).map((kind) => ({ kind: 'core:event', slot: '*', where: [{ path: 'kind', op: 'eq', arg: kind }] } as Selector))
      .concat([...fns].flatMap((fn) => this.world.rules(fn).flatMap((r) => r.changes)));
  }
  onChange(doc: SiftPattern, change: Change, event?: EventView, occurredAt?: number, supplied?: MatchedFiller[]): void {
    const p = doc.graph!, at = event?.time ?? occurredAt ?? this.owner.k.now;
    const fills = supplied ?? [...(event ? this.world.eventFills(event) : []), ...this.world.stateFills([...Object.values(p.junctures), ...(p.unless ?? []).map((u) => u.juncture)].map((j) => j.fn), change)];
    for (const e of this.owner.state().pool.filter((e) => e.pattern === p.id && e.graph && !e.graph.retired).slice().sort((a, b) => a.seq - b.seq)) {
      const g = e.graph!;
      for (const j of Object.values(g.junctures)) if (j.filler && !('event' in j.filler.ref) && j.filler.until === undefined
        && this.world.rules(j.filler.fn).some((r) => r.endsBy(change, j.filler!.ref))) j.filler.until = at;
      if (!['forming', 'live', 'aftermath'].includes(g.state) || at > (g.state === 'aftermath' ? g.aftermathUntil! : e.firstTime + this.owner.within(doc))) continue;
      if ((p.unless ?? []).some((u) => g.junctures[u.between[0]].filler && !g.junctures[u.between[1]].filler && fills.some((f) => this.test(p, u.juncture, f, e.bindings, e)))) { this.end(p, e, at); continue; }
      if (event) for (const [key, j] of Object.entries(p.junctures)) {
        const a = actingArgument(j, this.world.vocabulary), who = a ? this.value(j.args[a], e.bindings, e) : undefined;
        if (!g.junctures[key].filler && who && (event.effects.some((ef) => ef.on === who && ef.effect === 'kill')
          || event.kind === 'game.death' && event.participants.some((p) => p.who === who))) g.junctures[key].state = 'foreclosed';
      }
      this.advance(p, e, fills, at);
    }
    for (const key of p.entry.slice().sort(cmp)) for (const f of fills) {
      const fixed = Object.fromEntries(Object.entries(p.roles).flatMap(([v, r]) => { const b = bound(r.identity); return b.status === 'fixed' && b.value ? [[v, this.owner.k.expandId(b.value === 'v' ? 'root:v' : b.value)]] : []; }));
      if (!Object.entries(fixed).every(([v, n]) => this.accepts(p, v, n, fixed, at))) continue;
      const binds = this.test(p, p.junctures[key], f, fixed);
      if (!binds) continue;
      const nodes = [...Object.values(f.args), ...(event?.participants.map((x) => x.who) ?? []), ...(event?.place ? [event.place] : [])];
      if (this.owner.data.sifter.relevanceGate && !nodes.some((n) => n === this.owner.k.vId || this.owner.l2.exposedNode(n, 'presented'))
        && !(event?.place && this.owner.l2.reg.sim?.eval('depth', [event.place], at) === 'open')
        && !(['concern', 'drive', 'standing'].includes(p.scale) && Object.values(binds).every((n) => this.owner.view.isKind(this.owner.view.kind(n) ?? '', 'core:group')))
        && !(event?.kind === 'meta:story' && event.causes.some((n) => this.owner.l2.exposure(n)?.grade !== undefined && this.owner.l2.exposure(n)?.grade !== 'ambient'))) continue;
      const bindingKey = this.owner.keys.bindings('bind', p.id, binds), id = this.owner.keys.match(p.id, bindingKey, f.id), st = this.owner.state();
      if (st.pool.some((e) => e.id === id || (e.pattern === p.id && e.graph && !e.graph.retired && ['forming', 'live'].includes(e.graph.state) && e.bindingKey === bindingKey))) return;
      if (p.once?.length && st.tombstones.some((t) => t.key === this.owner.keys.bindings('tomb', p.id, binds, p.once) && at <= t.until)) return;
      const free = (rows: PoolEntry[], cap: number) => {
        rows = rows.filter((e) => !e.graph?.retired);
        if (rows.length < cap) return true;
        const victim = rows.filter((e) => e.graph && e.graph.state === 'forming' && !Object.values(e.graph.junctures).some((j) => j.pending || j.perceived))
          .concat(rows.filter((e) => e.graph?.state === 'live' && !Object.values(e.graph.junctures).some((j) => j.pending || j.perceived)))
          .sort((a, b) => Number(a.graph?.state !== 'forming') - Number(b.graph?.state !== 'forming') || a.firstTime - b.firstTime || a.seq - b.seq)[0];
        this.owner.log('match', 'pool-full', { pattern: p.id, evicted: victim?.id });
        if (victim) this.owner.drop(victim, 'pool-evicted');
        return !!victim;
      };
      if (!free(st.pool.filter((e) => e.pattern === p.id), this.owner.data.sifter.poolPerPattern) || !free(st.pool, this.owner.data.sifter.poolTotal)) return;
      const graph: GraphState = { state: 'forming', junctures: Object.fromEntries(Object.keys(p.junctures).map((k) => [k, { state: 'open' }])), used: [], depth: 1,
        lineage: [], layers: [], retired: false, seeds: [], refusals: {}, shown: {} };
      const e: PoolEntry = { id, bindingKey, seq: st.nextSeq++, pattern: p.id, version: p.version, bindings: binds, stages: [], firstTime: at, lastTime: at,
        complete: false, refusals: 0, cooldownUntil: 0, graph };
      st.pool.push(e); this.ready(p, e, at);
      this.match(p, key, e, f, true); this.advance(p, e, fills, at);
      return;
    }
  }
  boundary(horizon: number): void {
    // All buffered input through the horizon is installed. Perception must be available
    // to deadline/closing decisions as well as to retirement below.
    this.owner.beforeRetire?.();
    for (const e of this.owner.state().pool.filter((e) => e.graph && !e.graph.retired).sort((a, b) => a.seq - b.seq)) {
      const g = e.graph!, doc = this.owner.patterns.get(e.pattern), p = doc?.graph;
      if (!p || !doc) continue;
      this.promote(p, e);
      if (g.armed && horizon >= g.armed.since + p.outcomes[g.armed.outcome].after!.days * 86400)
        this.fix(p, e, g.armed.outcome, g.armed.since + p.outcomes[g.armed.outcome].after!.days * 86400);
      if (['forming', 'live'].includes(g.state) && horizon > e.firstTime + this.owner.within(doc)) this.end(p, e, e.firstTime + this.owner.within(doc));
      if (g.state === 'aftermath' && horizon > g.aftermathUntil!) g.state = g.outcome?.kind === 'parked' ? 'parked' : 'resolved';
      if (['forming', 'live'].includes(g.state) && Object.values(p.outcomes).every((o) => o.reached.some((k) => g.junctures[k].state === 'foreclosed'))) this.end(p, e, horizon);
    }
    this.owner.beforeRetire?.();
    for (const e of this.owner.state().pool.filter((e) => e.graph && !e.graph.retired)) {
      const g = e.graph!, p = this.owner.patterns.get(e.pattern)?.graph;
      if (!p) continue;
      if (['resolved', 'parked', 'lapsed'].includes(g.state) && g.closing !== 'needed'
        && !g.seeds.some((s) => !['told', 'closing'].includes(s.for) && this.owner.l2.instance(s.seed) && !['resolved', 'withdrawn', 'withered'].includes(this.owner.l2.instance(s.seed)!.st.state))
        && (!p.tell || g.seeds.some((s) => s.for === 'told') || horizon > (g.outcome?.at ?? e.lastTime) + this.owner.data.sifter.candidateTtl)) g.retired = true;
    }
  }
}
