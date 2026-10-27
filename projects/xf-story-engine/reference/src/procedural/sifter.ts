import type { Kernel } from '../kernel.ts';
import { H, s } from '../id.ts';
import { hrec } from '../canon.ts';
import { GraphMatcher } from './graph-matcher.ts';
import type { Relevance } from '../relevance.ts';
import type { Layer2 } from '../seeding/layer2.ts';
import type { Finding } from '../seeding/types.ts';
import type { Budget } from '../work.ts';
import { Keys, cmp } from './keys.ts';
import { clauses, kinds, patternFindings } from './lint.ts';
import type {
  EventClause,
  EventView,
  KernelView,
  Layer3Data,
  Layer3State,
  Log,
  PoolEntry,
  SiftPattern,
} from './types.ts';

export class Sifter {
  countsAsThread?: (e: PoolEntry) => boolean;
  beforeRetire?: () => void;
  readonly graph = new GraphMatcher(this);
  readonly patterns = new Map<string, SiftPattern>();
  /** Owned registration index, replaced in full whenever the loaded pattern set changes. */
  private readonly frameOwners = new Map<string, string>();
  active = false;
  work = 0;
  constructor(
    readonly k: Kernel,
    readonly l2: Layer2,
    readonly view: KernelView,
    readonly keys: Keys,
    readonly data: Layer3Data,
    readonly state: () => Layer3State,
    readonly log: Log,
    private readonly changed: () => void,
  ) {}
  install(input: SiftPattern[]): Finding[] {
    const findings: Finding[] = [],
      next = new Map<string, SiftPattern>();
    for (const p of input.slice().sort((a, b) => cmp(a.id, b.id))) {
      const f = patternFindings(p, this.l2, this.view, this.data);
      findings.push(...f.map((x) => ({ ...x, at: p.id })));
      if (!f.some((x) => x.level === 'error') && !next.has(p.id)) next.set(p.id, structuredClone(p));
      else if (next.has(p.id))
        findings.push({ code: 'S3-L-2', level: 'error', message: 'Duplicate pattern id.', at: p.id });
    }
    for (const p of this.patterns.values()) if (!next.has(p.id)) this.close(p.id);
    this.patterns.clear();
    this.frameOwners.clear();
    for (const [id, p] of next) {
      this.patterns.set(id, p);
      this.frameOwners.set(this.keys.frame(id), id);
    }
    this.reconcile();
    this.syncFrames();
    this.changed();
    return findings;
  }
  reconcile(): void {
    const st = this.state();
    for (const e of st.pool.slice())
      if (!this.patterns.has(e.pattern) || this.patterns.get(e.pattern)!.version !== e.version)
        this.drop(e, 'match-dropped');
    st.tombstones = st.tombstones.filter((t) => this.patterns.has(t.pattern));
    st.buffer = st.buffer.filter((b) => this.patterns.get(b.pattern)?.version === b.version);
  }
  setActive(active: boolean): void {
    if (this.active === active) return;
    this.active = active;
    if (!active) this.state().buffer = [];
    this.syncFrames();
    this.changed();
  }
  private close(pattern: string): void {
    const f = this.k.frames.frame(this.keys.frame(pattern));
    if (f?.status === 'active') this.k.frames.setStatus(f.id, 'abandoned', this.keys.director);
  }
  syncFrames(): void {
    for (const p of this.patterns.values()) {
      const id = this.keys.frame(p.id),
        have = this.k.frames.frame(id);
      if (!this.active) {
        this.close(p.id);
        continue;
      }
      const names = [...new Set(clauses(p).flatMap((c) => kinds(c, this.view)))].sort(cmp);
      const own = {
        reactsTo: p.graph ? this.graph.selectors(p.graph) : names.map((name) => ({
          kind: 'core:event',
          slot: '*' as const,
          where: [{ path: 'kind', op: 'eq' as const, arg: name }],
        })),
      };
      if (!have)
        this.k.frames.open({
          id,
          actor: this.keys.director,
          level: 'situation',
          weight: 1,
          parents: [],
          origin: this.keys.director,
          status: 'active',
          focus: { nodes: [], tier: 0 },
          payload: {},
          cause: this.keys.director,
          own,
        });
      else {
        this.k.frames.setInterests(id, own, this.keys.director);
        if (have.status !== 'active') this.k.frames.setStatus(id, 'active', this.keys.director);
      }
    }
  }
  hear(r: Relevance): void {
    if (!this.active || r.actor !== this.keys.director || r.type !== 'reactsTo' || r.change.c === 'contribution') return;
    const owner = this.frameOwners.get(r.frame);
    const p = owner ? this.patterns.get(owner) : undefined;
    if (!p) return;
    if (r.change.c !== 'event') {
      if (p.graph) this.state().buffer.push({ pattern: p.id, version: p.version, change: structuredClone(r.change),
        event: { id: H(s('change'), hrec(r.change)), creator: this.keys.director, cause: this.keys.director, name: '@state',
          kind: '@state', time: r.time, participants: [], causes: [], effects: [], witnesses: [] } });
      return;
    }
    const event = this.view.event(r.change.event);
    if (!event || ((event.creator === this.keys.director || event.kind.startsWith('meta:')) && !(p.graph && event.kind === 'meta:story'))) return;
    const st = this.state();
    if (st.buffer.some((b) => b.pattern === p.id && b.event.id === event.id)) return;
    st.buffer.push({
      pattern: p.id,
      version: p.version,
      event: structuredClone({
        ...event,
        kind: r.change.kind,
        time: r.time,
        participants: r.change.participants,
        effects: r.change.effects,
      }),
    });
    this.changed();
  }
  /** Host calls after the boundary's complete relevance dispatch, before sweeping or sowing. */
  boundary(boundary: number, lag: number, budget?: Budget): boolean {
    const horizon = boundary - lag * this.k.config.wSim,
      st = this.state();
    const order = (a: Layer3State['buffer'][number], b: Layer3State['buffer'][number]) =>
      a.event.time - b.event.time || cmp(a.event.id, b.event.id) || cmp(a.pattern, b.pattern);
    const ready = st.buffer
      .filter((b) => b.event.time <= horizon)
      .sort(order);
    let cost = 0;
    while (ready.length) {
      if (cost > 0 && budget && cost >= budget.remaining) {
        this.changed();
        return false;
      }
      const b = ready.shift()!;
      st.buffer = st.buffer.filter((x) => x !== b);
      const buffered = st.buffer.length;
      const p = this.patterns.get(b.pattern);
      const before = this.work;
      if (this.active && p?.version === b.version) {
        if (p.graph && b.dilemma) {
          const d = b.dilemma;
          this.k.persistence.recoverIfSaved(d.frameA);
          const source = this.k.frames.frame(d.frameA)?.origin;
          if (source) this.graph.onChange(p, { c: 'minted', node: d.id, kind: 'core:event' }, undefined, b.event.time,
            [{ ref: { dilemma: d.id }, id: d.id, at: b.event.time, fn: 'demand', args: { by: source, of: d.actor, what: d.target }, source: 'found', causes: [d.cause] }]);
        }
        else if (p.graph && b.change) this.graph.onChange(p, b.change, undefined, b.event.time);
        else this.onEvent(p, b.event);
      }
      // Empty or obsolete emissions still consume one resumable queue step.
      if (this.work === before) this.work++;
      cost += this.work - before;
      // Matching can publish a story at this occurrence's time. Merge it before
      // any later occurrence, retaining the same budget across the whole chain.
      for (const next of st.buffer.slice(buffered)) if (next.event.time <= horizon) {
        let low = 0, high = ready.length;
        while (low < high) {
          const mid = (low + high) >>> 1;
          if (order(ready[mid], next) <= 0) low = mid + 1;
          else high = mid;
        }
        ready.splice(low, 0, next);
      }
    }
    this.graph.boundary(horizon);
    this.sweep(boundary, horizon);
    this.changed();
    return true;
  }
  matchClause(
    p: SiftPattern,
    c: EventClause,
    event: EventView,
    bindings: Record<string, string>,
  ): Record<string, string> | null {
    if (!kinds(c, this.view).includes(event.kind)) return null;
    const out = { ...bindings };
    const accepts = (v: string, n: string): boolean => {
      if (out[v] !== undefined) return out[v] === n;
      const r = p.roles[v],
        kind = this.view.kind(n);
      if (
        !r ||
        !kind ||
        !this.view.isKind(kind, r.kind) ||
        !(r.where ?? []).every((pr) => this.view.holds(pr, n, event.time))
      )
        return false;
      out[v] = n;
      return true;
    };
    for (const who of c.who ?? [])
      if (!event.participants.some((r) => r.role === who.role && accepts(who.as, r.who))) return null;
    for (const ef of c.effects ?? []) {
      const effects = Array.isArray(ef.effect) ? ef.effect : [ef.effect];
      if (!event.effects.some((e) => effects.includes(e.effect) && accepts(ef.on, e.on))) return null;
    }
    if (!(c.where ?? []).every((pr) => this.view.holds(pr, event.id, event.time))) return null;
    return out;
  }
  private complete(p: SiftPattern, e: PoolEntry): void {
    e.complete = true;
    e.story = this.k.events.mintEvent({
      creator: this.keys.director,
      cause: e.id,
      name: 'meta:story',
      time: e.lastTime,
      kind: 'meta:story',
      participants: Object.keys(e.bindings)
        .sort(cmp)
        .map((v) => ({ who: e.bindings[v], role: v.slice(1) })),
      causes: e.stages.map((s) => s.event),
      effects: [],
      witnesses: [],
      // S3 2.2b / 6.6: the stage chain has one resolved outcome and no story
      // fillers. Keep the frozen v0.5 record when no typed story kind is loaded.
      ...(this.k.eventKinds.eventKind('meta:story')?.dataFields ? {
        data: { pattern: e.pattern, instance: e.id, outcome: 'complete', kind: 'resolved', depth: 1 },
      } : {}),
    });
    // As with graph outcomes, make the story available in this boundary's
    // chronological buffer; later relevance delivery is deduplicated by matching.
    for (const target of this.patterns.values())
      if (target.graph && Object.values(target.graph.junctures).some((j) => j.fn === 'story')) {
        const event = this.view.event(e.story)!;
        if (!this.state().buffer.some((b) => b.pattern === target.id && b.event.id === event.id))
          this.state().buffer.push({ pattern: target.id, version: target.version, event });
      }
    this.tombstone(p, e, e.lastTime + this.data.sifter.tombstoneSpans * this.within(p));
    this.log(
      'match',
      'match-complete',
      { pattern: p.id, version: p.version, stage: e.stages.length - 1, bindings: e.bindings, story: e.story },
      e.stages.map((s) => s.event),
    );
  }
  within(p: SiftPattern): number {
    return p.within ?? this.data.sifter.defaultWithin;
  }
  tombstone(p: SiftPattern, e: PoolEntry, until: number): void {
    if (!p.once?.length) return;
    const st = this.state(),
      key = this.keys.bindings('tomb', p.id, e.bindings, p.once),
      have = st.tombstones.find((t) => t.key === key);
    if (have) have.until = Math.max(have.until, until);
    else st.tombstones.push({ pattern: p.id, key, until });
  }
  drop(e: PoolEntry, reason: string, at?: number): void {
    const st = this.state(),
      p = this.patterns.get(e.pattern);
    if (p && (reason === 'match-killed' || reason === 'refusals'))
      this.tombstone(p, e, (at ?? this.k.now) + this.data.sifter.tombstoneSpans * this.within(p));
    if (p && reason === 'match-expired' && !e.complete)
      this.tombstone(p, e, e.firstTime + (1 + this.data.sifter.tombstoneSpans) * this.within(p));
    st.pool = st.pool.filter((x) => x.id !== e.id);
    this.log(
      'match',
      reason,
      { pattern: e.pattern, stage: e.stages.length - 1, bindings: e.bindings },
      e.stages.map((s) => s.event),
    );
  }
  sweep(now: number, openHorizon = now, reclaimSown = true): void {
    const st = this.state();
    // A stage descriptor owns its telling seed and the child's legibility. Keep
    // that connection until the last graph consumer retires (including queued ones).
    const heldStories = new Set([
      ...st.pool.flatMap((e) => e.graph && !e.graph.retired
        ? Object.values(e.graph.junctures).flatMap((j) => j.filler?.fn === 'story' ? [j.filler.id] : []) : []),
      ...st.buffer.filter((b) => b.event.kind === 'meta:story').map((b) => b.event.id),
    ]);
    for (const e of st.pool.slice().sort((a, b) => a.seq - b.seq)) {
      const p = this.patterns.get(e.pattern);
      if (!p) continue;
      if (e.graph) { if (e.graph.retired) st.pool = st.pool.filter((x) => x !== e); continue; }
      if (e.story && heldStories.has(e.story)) continue;
      if (e.seed && reclaimSown) this.drop(e, 'match-sown');
      else if (
        (e.complete ? now : openHorizon) >
        (e.complete ? e.lastTime + this.data.sifter.candidateTtl : e.firstTime + this.within(p))
      )
        this.drop(e, 'match-expired');
    }
    st.tombstones = st.tombstones.filter((t) => openHorizon <= t.until);
  }
  onEvent(p: SiftPattern, event: EventView): void {
    if (p.graph) {
      this.graph.onChange(p, { c: 'event', event: event.id, kind: event.kind, participants: event.participants,
        effects: event.effects, ...(event.place ? { place: event.place } : {}) }, event);
      return;
    }
    const st = this.state(),
      now = event.time;
    this.work++;
    for (const e of st.pool.filter((e) => e.pattern === p.id && !e.complete).sort((a, b) => a.seq - b.seq)) {
      this.work++;
      if (now > e.firstTime + this.within(p)) {
        this.drop(e, 'match-expired');
        continue;
      }
      if (e.stages.some((s) => s.event === event.id)) continue;
      if (
        (p.unless ?? []).some(
          (u) =>
            u.between[0] <= e.stages.length - 1 &&
            e.stages.length - 1 < u.between[1] &&
            this.matchClause(p, u.clause, event, e.bindings),
        )
      ) {
        this.drop(e, 'match-killed', now);
        continue;
      }
      const binds = this.matchClause(p, p.stages[e.stages.length], event, e.bindings);
      if (binds && now >= e.lastTime) {
        e.bindings = binds;
        e.stages.push({ event: event.id, time: now });
        e.lastTime = now;
        if (e.stages.length === p.stages.length) this.complete(p, e);
        else
          this.log(
            'match',
            'match-advanced',
            { pattern: p.id, stage: e.stages.length - 1, bindings: binds },
            e.stages.map((s) => s.event),
          );
      }
    }
    // Reclaim before admission, after advancement: a historical emission may just have
    // completed an entry whose TTL is already past at current game time.
    // Open entries use the chronological input horizon, like the advancement check above.
    this.sweep(Math.max(this.k.now, now), now);
    const bindings = this.matchClause(p, p.stages[0], event, {});
    if (!bindings) return;
    const bindingKey = this.keys.bindings('bind', p.id, bindings),
      id = this.keys.match(p.id, bindingKey, event.id);
    if (st.pool.some((e) => e.id === id || (!e.complete && e.bindingKey === bindingKey))) return;
    if (p.once?.length) {
      const key = this.keys.bindings('tomb', p.id, bindings, p.once);
      if (st.tombstones.some((t) => t.key === key && now <= t.until)) return;
    }
    const free = (entries: PoolEntry[], limit: number): boolean => {
      if (entries.length < limit) return true;
      const victim = entries.filter((e) => !e.complete).sort((a, b) => a.firstTime - b.firstTime || a.seq - b.seq)[0];
      this.log('match', 'pool-full', { pattern: p.id, evicted: victim?.id }, [event.id]);
      if (!victim) return false;
      this.drop(victim, 'pool-evicted');
      return true;
    };
    if (
      !free(
        st.pool.filter((e) => e.pattern === p.id),
        this.data.sifter.poolPerPattern,
      ) ||
      !free(st.pool, this.data.sifter.poolTotal)
    )
      return;
    const e: PoolEntry = {
      id,
      bindingKey,
      seq: st.nextSeq++,
      pattern: p.id,
      version: p.version,
      bindings,
      stages: [{ event: event.id, time: now }],
      firstTime: now,
      lastTime: now,
      complete: false,
      refusals: 0,
      cooldownUntil: 0,
    };
    st.pool.push(e);
    this.log('match', 'match-started', { pattern: p.id, stage: 0, bindings }, [event.id]);
    if (p.stages.length === 1) this.complete(p, e);
  }
}
